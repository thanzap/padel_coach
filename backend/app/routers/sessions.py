import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.coaching_session_actions import persist_coaching_session_from_program
from app.db import get_session
from app.deps import get_current_profile, require_coach, require_player
from app.models import (
    CoachingSession,
    ExerciseRecording,
    ExerciseScore,
    Profile,
    ProgramExercise,
    SessionExercise,
    TrainingProgram,
)
from app.schemas import (
    CoachingSessionCreate,
    CoachingSessionDetailOut,
    CoachingSessionPatch,
    ExerciseScoreOut,
    RecordingRegister,
    ScoreUpsert,
    SessionTrainingProgramExerciseOut,
    SessionTrainingProgramOut,
    TrainingProgramCreate,
)

router = APIRouter(prefix="/sessions", tags=["sessions"])


async def _get_owned_program(db: AsyncSession, coach_id: uuid.UUID, program_id: uuid.UUID) -> TrainingProgram:
    program = await db.scalar(
        select(TrainingProgram)
        .where(TrainingProgram.id == program_id)
        .options(selectinload(TrainingProgram.exercises))
    )
    if program is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Program not found")
    if program.coach_id != coach_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not own this program")
    return program


async def _create_adhoc_program(db: AsyncSession, coach_id: uuid.UUID, body: TrainingProgramCreate) -> TrainingProgram:
    program = TrainingProgram(
        coach_id=coach_id,
        title=body.title.strip(),
        description=body.description.strip() if body.description else None,
        adhoc=True,
    )
    db.add(program)
    await db.flush()
    for i, ex in enumerate(body.exercises):
        db.add(
            ProgramExercise(
                program_id=program.id,
                sort_order=i,
                title=ex.title.strip(),
                description=ex.description.strip() if ex.description else None,
                target_duration_sec=ex.target_duration_sec,
            )
        )
    await db.flush()
    reloaded = await db.scalar(
        select(TrainingProgram).where(TrainingProgram.id == program.id).options(selectinload(TrainingProgram.exercises))
    )
    assert reloaded is not None
    return reloaded


def _expected_storage_prefix(session_id: uuid.UUID, session_exercise_id: uuid.UUID) -> str:
    return f"{session_id}/{session_exercise_id}"


async def _session_detail(session: AsyncSession, coaching_session_id: uuid.UUID) -> CoachingSession | None:
    stmt = (
        select(CoachingSession)
        .where(CoachingSession.id == coaching_session_id)
        .options(
            selectinload(CoachingSession.exercises).selectinload(SessionExercise.recordings),
            selectinload(CoachingSession.exercises).selectinload(SessionExercise.scores),
        )
    )
    return await session.scalar(stmt)


async def _session_detail_response(db: AsyncSession, coaching_session_id: uuid.UUID) -> CoachingSessionDetailOut:
    loaded = await _session_detail(db, coaching_session_id)
    assert loaded is not None
    program_adhoc = await db.scalar(select(TrainingProgram.adhoc).where(TrainingProgram.id == loaded.program_id))
    base = CoachingSessionDetailOut.model_validate(loaded, from_attributes=True)
    return base.model_copy(update={"program_adhoc": program_adhoc})


@router.post("", response_model=CoachingSessionDetailOut, status_code=status.HTTP_201_CREATED)
async def create_session(
    body: CoachingSessionCreate,
    profile: Profile = Depends(require_coach),
    session: AsyncSession = Depends(get_session),
) -> CoachingSessionDetailOut:
    if body.program_id is not None:
        program = await _get_owned_program(session, profile.id, body.program_id)
    else:
        assert body.inline_program is not None
        program = await _create_adhoc_program(session, profile.id, body.inline_program)

    player = await session.scalar(select(Profile).where(Profile.id == body.player_id))
    if player is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Player not found")

    try:
        coaching = await persist_coaching_session_from_program(
            session,
            program,
            profile.id,
            body.player_id,
            title=body.title,
            scheduled_at=body.scheduled_at,
            ends_at=body.ends_at,
            venue_place=(body.venue_place.strip() if body.venue_place else None),
            status="pending_confirmation",
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    await session.commit()

    return await _session_detail_response(session, coaching.id)


@router.post("/{session_id}/confirm", response_model=CoachingSessionDetailOut)
async def confirm_coaching_session(
    session_id: uuid.UUID,
    profile: Profile = Depends(require_player),
    session: AsyncSession = Depends(get_session),
) -> CoachingSessionDetailOut:
    """Player accepts a coach-proposed session, moving it from pending_confirmation to planned."""
    loaded = await session.scalar(select(CoachingSession).where(CoachingSession.id == session_id))
    if loaded is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    if loaded.player_id != profile.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the assigned player can confirm")
    if loaded.status != "pending_confirmation":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Session is not awaiting confirmation")
    loaded.status = "planned"
    await session.commit()
    return await _session_detail_response(session, loaded.id)


@router.post("/{session_id}/decline", response_model=CoachingSessionDetailOut)
async def decline_coaching_session(
    session_id: uuid.UUID,
    profile: Profile = Depends(require_player),
    session: AsyncSession = Depends(get_session),
) -> CoachingSessionDetailOut:
    """Player declines a coach-proposed session, cancelling it."""
    loaded = await session.scalar(select(CoachingSession).where(CoachingSession.id == session_id))
    if loaded is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    if loaded.player_id != profile.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the assigned player can decline")
    if loaded.status != "pending_confirmation":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Session is not awaiting confirmation")
    loaded.status = "cancelled"
    await session.commit()
    return await _session_detail_response(session, loaded.id)


@router.get("", response_model=list[CoachingSessionDetailOut])
async def list_sessions(
    profile: Profile = Depends(get_current_profile),
    session: AsyncSession = Depends(get_session),
) -> list[CoachingSession]:
    stmt = (
        select(CoachingSession)
        .where((CoachingSession.coach_id == profile.id) | (CoachingSession.player_id == profile.id))
        .options(
            selectinload(CoachingSession.exercises).selectinload(SessionExercise.recordings),
            selectinload(CoachingSession.exercises).selectinload(SessionExercise.scores),
        )
        .order_by(CoachingSession.created_at.desc())
    )
    rows = (await session.scalars(stmt)).all()
    return list(rows)


@router.patch("/{session_id}", response_model=CoachingSessionDetailOut)
async def patch_coaching_session(
    session_id: uuid.UUID,
    body: CoachingSessionPatch,
    profile: Profile = Depends(require_coach),
    session: AsyncSession = Depends(get_session),
) -> CoachingSessionDetailOut:
    loaded = await session.scalar(select(CoachingSession).where(CoachingSession.id == session_id))
    if loaded is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    if loaded.coach_id != profile.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the session coach can update")
    data = body.model_dump(exclude_unset=True)
    if "venue_place" in data:
        vp = data["venue_place"]
        loaded.venue_place = vp.strip() if isinstance(vp, str) and vp.strip() else None
    if "status" in data and data["status"] is not None:
        loaded.status = data["status"]
    if "scheduled_at" in data:
        loaded.scheduled_at = data["scheduled_at"]
    if "ends_at" in data:
        loaded.ends_at = data["ends_at"]

    start = loaded.scheduled_at
    end = loaded.ends_at
    if start is not None and end is not None and end <= start:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ends_at must be after scheduled_at (start)",
        )

    await session.commit()
    return await _session_detail_response(session, session_id)


@router.get("/{session_id}/program", response_model=SessionTrainingProgramOut)
async def get_session_training_program(
    session_id: uuid.UUID,
    profile: Profile = Depends(get_current_profile),
    session: AsyncSession = Depends(get_session),
) -> SessionTrainingProgramOut:
    stmt = (
        select(CoachingSession, TrainingProgram)
        .join(TrainingProgram, TrainingProgram.id == CoachingSession.program_id)
        .where(CoachingSession.id == session_id)
        .options(selectinload(CoachingSession.exercises))
    )
    row = (await session.execute(stmt)).one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    coaching_session, program = row
    if coaching_session.coach_id != profile.id and coaching_session.player_id != profile.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")

    exercises_sorted = sorted(coaching_session.exercises, key=lambda e: e.sort_order)
    return SessionTrainingProgramOut(
        session_id=coaching_session.id,
        session_title=coaching_session.title,
        program_id=program.id,
        program_title=program.title,
        program_description=program.description,
        exercises=[
            SessionTrainingProgramExerciseOut(
                sort_order=e.sort_order,
                title=e.title,
                description=e.description,
                target_duration_sec=e.target_duration_sec,
            )
            for e in exercises_sorted
        ],
    )


@router.get("/{session_id}", response_model=CoachingSessionDetailOut)
async def get_session_detail(
    session_id: uuid.UUID,
    profile: Profile = Depends(get_current_profile),
    session: AsyncSession = Depends(get_session),
) -> CoachingSessionDetailOut:
    loaded = await _session_detail(session, session_id)
    if loaded is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    if loaded.coach_id != profile.id and loaded.player_id != profile.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")
    return await _session_detail_response(session, session_id)


@router.post(
    "/{session_id}/exercises/{session_exercise_id}/recording",
    status_code=status.HTTP_201_CREATED,
)
async def register_recording(
    session_id: uuid.UUID,
    session_exercise_id: uuid.UUID,
    body: RecordingRegister,
    profile: Profile = Depends(get_current_profile),
    session: AsyncSession = Depends(get_session),
) -> dict[str, uuid.UUID]:
    loaded = await session.scalar(select(CoachingSession).where(CoachingSession.id == session_id))
    if loaded is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    if loaded.coach_id != profile.id and loaded.player_id != profile.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")

    se = await session.scalar(
        select(SessionExercise).where(
            SessionExercise.id == session_exercise_id,
            SessionExercise.session_id == session_id,
        )
    )
    if se is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session exercise not found")

    prefix = _expected_storage_prefix(session_id, session_exercise_id)
    if not body.storage_object_path.startswith(prefix):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"storage_object_path must start with {prefix}/",
        )

    rec = ExerciseRecording(
        session_exercise_id=session_exercise_id,
        storage_object_path=body.storage_object_path,
        duration_ms=body.duration_ms,
        mime_type=body.mime_type,
        created_by=profile.id,
    )
    session.add(rec)
    await session.commit()
    await session.refresh(rec)
    return {"id": rec.id}


@router.put(
    "/{session_id}/exercises/{session_exercise_id}/score",
    response_model=ExerciseScoreOut,
)
async def upsert_score(
    session_id: uuid.UUID,
    session_exercise_id: uuid.UUID,
    body: ScoreUpsert,
    profile: Profile = Depends(require_coach),
    session: AsyncSession = Depends(get_session),
) -> ExerciseScore:
    loaded = await session.scalar(select(CoachingSession).where(CoachingSession.id == session_id))
    if loaded is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    if loaded.coach_id != profile.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the session coach can score")

    se = await session.scalar(
        select(SessionExercise).where(
            SessionExercise.id == session_exercise_id,
            SessionExercise.session_id == session_id,
        )
    )
    if se is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session exercise not found")

    stmt = (
        pg_insert(ExerciseScore)
        .values(
            session_exercise_id=session_exercise_id,
            coach_id=profile.id,
            score=body.score,
            notes=body.notes,
        )
        .on_conflict_do_update(
            index_elements=["session_exercise_id", "coach_id"],
            set_={"score": body.score, "notes": body.notes},
        )
        .returning(ExerciseScore)
    )
    result = await session.execute(stmt)
    row = result.scalar_one()
    await session.commit()
    return row
