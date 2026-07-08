import uuid
from datetime import date, datetime, time as dt_time, timedelta, timezone as tz

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.availability_slots import (
    coaching_session_busy_interval,
    expand_weekly_slots,
    group_weekly_slots,
    pending_request_busy_interval,
    subtract_intervals,
)
from app.models import CoachAvailabilityBlock, CoachWeeklySlot, CoachingSession, SessionRequest


async def compute_coach_free_intervals(
    db: AsyncSession,
    coach_id: uuid.UUID,
    day_start: date,
    day_end: date,
    ignore_request_id: uuid.UUID | None = None,
) -> list[tuple[datetime, datetime]]:
    """Return merged UTC intervals where the coach is free within [day_start, day_end] inclusive.

    ``ignore_request_id`` excludes one pending request from the busy set — used when
    accepting that request so it does not block its own time slot.
    """
    range_start = datetime.combine(day_start, dt_time.min, tzinfo=tz.utc)
    range_end_excl = datetime.combine(day_end + timedelta(days=1), dt_time.min, tzinfo=tz.utc)

    rows = (
        (
            await db.execute(
                select(CoachWeeklySlot.weekday, CoachWeeklySlot.start_time, CoachWeeklySlot.end_time).where(
                    CoachWeeklySlot.coach_id == coach_id
                )
            )
        )
        .all()
    )
    if not rows:
        return []

    slots_map = group_weekly_slots([(int(r.weekday), r.start_time, r.end_time) for r in rows])
    free = expand_weekly_slots(slots_map, day_start, day_end)

    busy: list[tuple[datetime, datetime]] = []

    b_rows = (
        (
            await db.execute(
                select(CoachAvailabilityBlock.starts_at, CoachAvailabilityBlock.ends_at).where(
                    CoachAvailabilityBlock.coach_id == coach_id,
                    CoachAvailabilityBlock.ends_at > range_start,
                    CoachAvailabilityBlock.starts_at < range_end_excl,
                )
            )
        )
        .all()
    )
    for br in b_rows:
        busy.append((br.starts_at, br.ends_at))

    sess_rows = (
        (
            await db.execute(
                select(CoachingSession.scheduled_at, CoachingSession.ends_at, CoachingSession.status).where(
                    CoachingSession.coach_id == coach_id,
                    CoachingSession.scheduled_at.isnot(None),
                )
            )
        )
        .all()
    )
    for sr in sess_rows:
        iv = coaching_session_busy_interval(sr.scheduled_at, sr.ends_at, sr.status)
        if iv:
            busy.append(iv)

    req_stmt = select(
        SessionRequest.requested_start, SessionRequest.requested_end, SessionRequest.status
    ).where(SessionRequest.coach_id == coach_id)
    if ignore_request_id is not None:
        req_stmt = req_stmt.where(SessionRequest.id != ignore_request_id)
    req_rows = (await db.execute(req_stmt)).all()
    for rr in req_rows:
        iv = pending_request_busy_interval(rr.requested_start, rr.requested_end, rr.status)
        if iv:
            busy.append(iv)

    return subtract_intervals(free, busy)


def interval_covers(outer: tuple[datetime, datetime], inner: tuple[datetime, datetime]) -> bool:
    os_t, oe_t = outer
    a, b = inner
    return os_t <= a and oe_t >= b


async def assert_interval_available_for_request(
    db: AsyncSession,
    coach_id: uuid.UUID,
    req_start: datetime,
    req_end: datetime,
    ignore_request_id: uuid.UUID | None = None,
) -> None:
    from fastapi import HTTPException, status

    if req_end <= req_start:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="requested_end must be after requested_start")

    d0 = req_start.astimezone(tz.utc).date()
    d1 = req_end.astimezone(tz.utc).date()
    free = await compute_coach_free_intervals(db, coach_id, d0, d1, ignore_request_id=ignore_request_id)
    want = (req_start.astimezone(tz.utc), req_end.astimezone(tz.utc))
    for chunk in free:
        if interval_covers(chunk, want):
            return
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="That time is not available for this coach (check weekly hours, blocks, and existing sessions).",
    )
