from sqlalchemy import func, select
from sqlalchemy.orm import aliased
from sqlalchemy.ext.asyncio import AsyncSession

from fastapi import APIRouter, Depends, HTTPException, Query, status as http_status

from app.db import get_session
from app.deps import get_current_profile
from app.models import CoachingSession, ExerciseScore, Profile, SessionExercise
from app.schemas import PastTrainingSessionOut

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

_SESSION_STATUSES = frozenset({"planned", "in_progress", "completed", "cancelled"})


@router.get("/sessions", response_model=list[PastTrainingSessionOut])
async def list_dashboard_sessions(
    profile: Profile = Depends(get_current_profile),
    session: AsyncSession = Depends(get_session),
    status_filter: str = Query(
        "all",
        alias="status",
        description='Use "all" or one of: planned, in_progress, completed, cancelled',
    ),
) -> list[PastTrainingSessionOut]:
    sf = status_filter.strip().lower()
    if sf != "all" and sf not in _SESSION_STATUSES:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail=f'status must be "all" or one of {sorted(_SESSION_STATUSES)}',
        )

    coach_p = aliased(Profile)
    player_p = aliased(Profile)

    session_ts = func.coalesce(CoachingSession.scheduled_at, CoachingSession.created_at)

    ownership = (CoachingSession.coach_id == profile.id) | (CoachingSession.player_id == profile.id)
    filters = [ownership]
    if sf != "all":
        filters.append(CoachingSession.status == sf)

    stmt = (
        select(
            CoachingSession.id.label("session_id"),
            CoachingSession.coach_id,
            CoachingSession.player_id,
            coach_p.full_name.label("coach_name"),
            player_p.full_name.label("player_name"),
            session_ts.label("session_date"),
            CoachingSession.venue_place.label("place"),
            CoachingSession.status.label("status"),
            func.avg(ExerciseScore.score).label("average_score"),
        )
        .select_from(CoachingSession)
        .join(coach_p, coach_p.id == CoachingSession.coach_id)
        .join(player_p, player_p.id == CoachingSession.player_id)
        .outerjoin(SessionExercise, SessionExercise.session_id == CoachingSession.id)
        .outerjoin(ExerciseScore, ExerciseScore.session_exercise_id == SessionExercise.id)
        .where(*filters)
        .group_by(
            CoachingSession.id,
            CoachingSession.coach_id,
            CoachingSession.player_id,
            CoachingSession.status,
            coach_p.full_name,
            player_p.full_name,
            CoachingSession.scheduled_at,
            CoachingSession.created_at,
            CoachingSession.venue_place,
        )
        .order_by(session_ts.desc())
    )

    rows = (await session.execute(stmt)).all()
    return [
        PastTrainingSessionOut(
            session_id=r.session_id,
            coach_id=r.coach_id,
            player_id=r.player_id,
            coach_name=r.coach_name,
            player_name=r.player_name,
            session_date=r.session_date,
            place=r.place,
            status=r.status,
            average_score=float(r.average_score) if r.average_score is not None else None,
        )
        for r in rows
    ]
