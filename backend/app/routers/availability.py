import uuid
from datetime import date, datetime, timedelta
from datetime import time as dt_time
from datetime import timezone as tz

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.availability_slots import coaching_session_busy_interval, pending_request_busy_interval
from app.db import get_session
from app.deps import require_coach
from app.models import CoachAvailabilityBlock, CoachingSession, CoachWeeklySlot, Profile, SessionRequest
from app.schemas import (
    CalendarBusyIntervalOut,
    CoachAvailabilityBlockCreate,
    CoachAvailabilityBlockOut,
    CoachWeeklySlotOut,
    WeeklyAvailabilityReplace,
)

router = APIRouter(prefix="/availability", tags=["availability"])


def _interval_overlaps_range(a: datetime, b: datetime, range_start: datetime, range_end_excl: datetime) -> bool:
    return a < range_end_excl and b > range_start


@router.get("/calendar-busy", response_model=list[CalendarBusyIntervalOut])
async def calendar_busy_intervals(
    start_date: date = Query(..., description="Inclusive (UTC calendar day)"),
    end_date: date = Query(..., description="Inclusive (UTC calendar day)"),
    profile: Profile = Depends(require_coach),
    session: AsyncSession = Depends(get_session),
) -> list[CalendarBusyIntervalOut]:
    """Intervals that occupy the coach during this range — planned/in‑progress sessions and pending requests."""
    if end_date < start_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="end_date must be on or after start_date")
    if (end_date - start_date).days > 31:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Maximum range is 31 days")

    range_start = datetime.combine(start_date, dt_time.min, tzinfo=tz.utc)
    range_end_excl = datetime.combine(end_date + timedelta(days=1), dt_time.min, tzinfo=tz.utc)

    out: list[CalendarBusyIntervalOut] = []

    sess_rows = (
        (
            await session.execute(
                select(CoachingSession.scheduled_at, CoachingSession.ends_at, CoachingSession.status).where(
                    CoachingSession.coach_id == profile.id,
                    CoachingSession.scheduled_at.isnot(None),
                    CoachingSession.status.in_(["planned", "in_progress"]),
                )
            )
        )
        .all()
    )
    for sr in sess_rows:
        iv = coaching_session_busy_interval(sr.scheduled_at, sr.ends_at, sr.status)
        if iv is None:
            continue
        a, b = iv
        if not _interval_overlaps_range(a, b, range_start, range_end_excl):
            continue
        out.append(CalendarBusyIntervalOut(start=a, end=b, kind="session"))

    req_rows = (
        (
            await session.execute(
                select(SessionRequest.requested_start, SessionRequest.requested_end, SessionRequest.status).where(
                    SessionRequest.coach_id == profile.id,
                    SessionRequest.status == "pending",
                    SessionRequest.requested_end > range_start,
                    SessionRequest.requested_start < range_end_excl,
                )
            )
        )
        .all()
    )
    for rr in req_rows:
        iv = pending_request_busy_interval(rr.requested_start, rr.requested_end, rr.status)
        if iv is None:
            continue
        a, b = iv
        out.append(CalendarBusyIntervalOut(start=a, end=b, kind="pending_request"))

    return out


@router.get("/weekly", response_model=list[CoachWeeklySlotOut])
async def get_my_weekly_slots(
    profile: Profile = Depends(require_coach),
    session: AsyncSession = Depends(get_session),
) -> list[CoachWeeklySlot]:
    stmt = (
        select(CoachWeeklySlot)
        .where(CoachWeeklySlot.coach_id == profile.id)
        .order_by(CoachWeeklySlot.weekday.asc(), CoachWeeklySlot.start_time.asc())
    )
    rows = (await session.scalars(stmt)).all()
    return list(rows)


@router.put("/weekly", response_model=list[CoachWeeklySlotOut])
async def replace_my_weekly_slots(
    body: WeeklyAvailabilityReplace,
    profile: Profile = Depends(require_coach),
    session: AsyncSession = Depends(get_session),
) -> list[CoachWeeklySlot]:
    await session.execute(delete(CoachWeeklySlot).where(CoachWeeklySlot.coach_id == profile.id))
    for rule in body.slots:
        session.add(
            CoachWeeklySlot(
                coach_id=profile.id,
                weekday=rule.weekday,
                start_time=rule.start_as_time(),
                end_time=rule.end_as_time(),
            )
        )
    await session.commit()
    stmt = (
        select(CoachWeeklySlot)
        .where(CoachWeeklySlot.coach_id == profile.id)
        .order_by(CoachWeeklySlot.weekday.asc(), CoachWeeklySlot.start_time.asc())
    )
    rows = (await session.scalars(stmt)).all()
    return list(rows)


@router.get("/blocks", response_model=list[CoachAvailabilityBlockOut])
async def list_my_blocks(
    profile: Profile = Depends(require_coach),
    session: AsyncSession = Depends(get_session),
) -> list[CoachAvailabilityBlock]:
    stmt = (
        select(CoachAvailabilityBlock)
        .where(CoachAvailabilityBlock.coach_id == profile.id)
        .order_by(CoachAvailabilityBlock.starts_at.desc())
    )
    rows = (await session.scalars(stmt)).all()
    return list(rows)


@router.post("/blocks", response_model=CoachAvailabilityBlockOut, status_code=status.HTTP_201_CREATED)
async def add_block(
    body: CoachAvailabilityBlockCreate,
    profile: Profile = Depends(require_coach),
    session: AsyncSession = Depends(get_session),
) -> CoachAvailabilityBlock:
    block = CoachAvailabilityBlock(
        coach_id=profile.id,
        starts_at=body.starts_at,
        ends_at=body.ends_at,
        reason=(body.reason.strip() if body.reason else None),
    )
    session.add(block)
    await session.commit()
    await session.refresh(block)
    return block


@router.delete("/blocks/{block_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_block(
    block_id: uuid.UUID,
    profile: Profile = Depends(require_coach),
    session: AsyncSession = Depends(get_session),
) -> None:
    block = await session.scalar(select(CoachAvailabilityBlock).where(CoachAvailabilityBlock.id == block_id))
    if block is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Block not found")
    if block.coach_id != profile.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your block")
    await session.delete(block)
    await session.commit()
