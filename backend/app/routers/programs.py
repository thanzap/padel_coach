import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db import get_session
from app.deps import get_current_profile, require_coach
from app.models import CoachingSession, Profile, ProgramExercise, TrainingProgram
from app.schemas import TrainingProgramCreate, TrainingProgramOut, TrainingProgramUpdate

router = APIRouter(prefix="/programs", tags=["programs"])


@router.get("", response_model=list[TrainingProgramOut])
async def list_programs(
    profile: Profile = Depends(require_coach),
    session: AsyncSession = Depends(get_session),
) -> list[TrainingProgram]:
    stmt = (
        select(TrainingProgram)
        .where(TrainingProgram.coach_id == profile.id, TrainingProgram.adhoc.is_(False))
        .options(selectinload(TrainingProgram.exercises))
        .order_by(TrainingProgram.created_at.desc())
    )
    rows = (await session.scalars(stmt)).all()
    return list(rows)


@router.post("", response_model=TrainingProgramOut, status_code=status.HTTP_201_CREATED)
async def create_program(
    body: TrainingProgramCreate,
    profile: Profile = Depends(require_coach),
    session: AsyncSession = Depends(get_session),
) -> TrainingProgram:
    program = TrainingProgram(coach_id=profile.id, title=body.title, description=body.description, adhoc=False)
    session.add(program)
    await session.flush()

    for i, ex in enumerate(body.exercises):
        session.add(
            ProgramExercise(
                program_id=program.id,
                sort_order=i,
                title=ex.title,
                description=ex.description,
                target_duration_sec=ex.target_duration_sec,
            )
        )

    await session.commit()
    stmt = (
        select(TrainingProgram)
        .where(TrainingProgram.id == program.id)
        .options(selectinload(TrainingProgram.exercises))
    )
    loaded = await session.scalar(stmt)
    assert loaded is not None
    return loaded


@router.patch("/{program_id}", response_model=TrainingProgramOut)
async def update_program(
    program_id: uuid.UUID,
    body: TrainingProgramUpdate,
    profile: Profile = Depends(require_coach),
    session: AsyncSession = Depends(get_session),
) -> TrainingProgram:
    program = await session.scalar(select(TrainingProgram).where(TrainingProgram.id == program_id))
    if program is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Program not found")
    if program.coach_id != profile.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not own this program")

    upd = body.model_dump(exclude_unset=True)
    if "title" in upd and upd["title"] is not None:
        program.title = str(upd["title"]).strip()
    if "description" in upd:
        d = upd["description"]
        program.description = (d.strip() or None) if isinstance(d, str) else None

    if "adhoc" in upd and upd["adhoc"] is not None:
        if upd["adhoc"] is True and not program.adhoc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Saved library routines cannot be marked as one-off",
            )
        if upd["adhoc"] is False:
            program.adhoc = False

    if "exercises" in upd and body.exercises is not None:
        await session.execute(delete(ProgramExercise).where(ProgramExercise.program_id == program.id))
        for i, ex in enumerate(body.exercises):
            session.add(
                ProgramExercise(
                    program_id=program.id,
                    sort_order=i,
                    title=ex.title.strip(),
                    description=ex.description.strip() if ex.description else None,
                    target_duration_sec=ex.target_duration_sec,
                )
            )

    await session.commit()
    stmt = (
        select(TrainingProgram)
        .where(TrainingProgram.id == program.id)
        .options(selectinload(TrainingProgram.exercises))
    )
    loaded = await session.scalar(stmt)
    assert loaded is not None
    return loaded


@router.delete("/{program_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_program(
    program_id: uuid.UUID,
    profile: Profile = Depends(require_coach),
    session: AsyncSession = Depends(get_session),
) -> None:
    program = await session.scalar(select(TrainingProgram).where(TrainingProgram.id == program_id))
    if program is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Program not found")
    if program.coach_id != profile.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not own this program")

    await session.delete(program)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot delete this routine while sessions still reference it",
        ) from None


@router.get("/{program_id}", response_model=TrainingProgramOut)
async def get_program(
    program_id: uuid.UUID,
    profile: Profile = Depends(get_current_profile),
    session: AsyncSession = Depends(get_session),
) -> TrainingProgram:
    stmt = (
        select(TrainingProgram)
        .where(TrainingProgram.id == program_id)
        .options(selectinload(TrainingProgram.exercises))
    )
    program = await session.scalar(stmt)
    if program is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Program not found")

    if program.coach_id == profile.id:
        return program

    allowed = await session.scalar(
        select(CoachingSession.id).where(
            CoachingSession.program_id == program_id,
            (CoachingSession.coach_id == profile.id) | (CoachingSession.player_id == profile.id),
        )
    )
    if allowed is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to view this program")

    return program
