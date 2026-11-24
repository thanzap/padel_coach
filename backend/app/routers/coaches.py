import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.availability_service import compute_coach_free_intervals
from app.db import get_session
from app.deps import require_player
from app.models import CoachWeeklySlot, Profile
from app.schemas import CoachFreeSlotsOut, CoachPublicOut, CoachWeeklySlotOut, FreeSlotIntervalOut

router = APIRouter(prefix="/coaches", tags=["coaches"])


@router.get("/places", response_model=list[str])
async def list_coach_primary_places(
    _: Profile = Depends(require_player),
    session: AsyncSession = Depends(get_session),
) -> list[str]:
    stmt = (
        select(Profile.primary_place)
        .where(
            Profile.role == "coach",
            Profile.primary_place.isnot(None),
        )
        .distinct()
    )
    raw = (await session.scalars(stmt)).all()
    canonical: dict[str, str] = {}
    for cell in raw:
        if cell is None:
            continue
        s = str(cell).strip()
        if not s:
            continue
        key = s.casefold()
        if key not in canonical:
            canonical[key] = s
    return sorted(canonical.values(), key=lambda x: x.casefold())


@router.get("/search", response_model=list[CoachPublicOut])
async def search_coaches(
    place: str | None = Query(None, description="Substring match on primary_place (non-empty when used alone)"),
    name: str | None = Query(None, max_length=120, description="Substring match on coach full name"),
    _: Profile = Depends(require_player),
    session: AsyncSession = Depends(get_session),
) -> list[Profile]:
    p = place.strip() if place else ""
    n = name.strip() if name else ""
    if len(p) < 1 and len(n) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide non-empty `place` and/or `name` with at least 2 characters",
        )

    stmt = select(Profile).where(Profile.role == "coach")
    if p:
        stmt = stmt.where(
            Profile.primary_place.isnot(None),
            Profile.primary_place.ilike(f"%{p}%"),
        )
    if n:
        stmt = stmt.where(
            Profile.full_name.isnot(None),
            Profile.full_name.ilike(f"%{n}%"),
        )

    stmt = stmt.order_by(Profile.full_name.asc().nulls_last()).limit(50)
    rows = (await session.scalars(stmt)).all()
    return list(rows)


@router.get("/{coach_id}/weekly-slots", response_model=list[CoachWeeklySlotOut])
async def coach_weekly_slots_public(
    coach_id: uuid.UUID,
    _: Profile = Depends(require_player),
    session: AsyncSession = Depends(get_session),
) -> list[CoachWeeklySlot]:
    coach = await session.scalar(select(Profile).where(Profile.id == coach_id, Profile.role == "coach"))
    if coach is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Coach not found")
    stmt = (
        select(CoachWeeklySlot)
        .where(CoachWeeklySlot.coach_id == coach_id)
        .order_by(CoachWeeklySlot.weekday.asc(), CoachWeeklySlot.start_time.asc())
    )
    rows = (await session.scalars(stmt)).all()
    return list(rows)


@router.get("/{coach_id}/free-slots", response_model=CoachFreeSlotsOut)
async def coach_free_slots_public(
    coach_id: uuid.UUID,
    start_date: date = Query(..., description="Inclusive range start (UTC calendar day)"),
    end_date: date = Query(..., description="Inclusive range end (UTC calendar day)"),
    _: Profile = Depends(require_player),
    session: AsyncSession = Depends(get_session),
) -> CoachFreeSlotsOut:
    coach = await session.scalar(select(Profile).where(Profile.id == coach_id, Profile.role == "coach"))
    if coach is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Coach not found")
    if end_date < start_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="end_date must be on or after start_date")
    if (end_date - start_date).days > 31:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Maximum range is 31 days")

    raw = await compute_coach_free_intervals(session, coach_id, start_date, end_date)
    slots = [FreeSlotIntervalOut(start=a, end=b) for a, b in raw]
    return CoachFreeSlotsOut(coach_id=coach_id, start_date=start_date, end_date=end_date, slots=slots)
