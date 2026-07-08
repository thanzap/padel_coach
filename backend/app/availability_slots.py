"""Pure helpers to expand weekly rules and subtract busy intervals.

Weekly availability TIME values are interpreted as wall-clock in APP_TZ (Europe/Athens)
and converted to UTC per calendar day, so daylight-saving shifts are handled correctly.
"""

from collections import defaultdict
from collections.abc import Iterable
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

DEFAULT_SESSION_BLOCK = timedelta(hours=1)

# Single display/scheduling timezone for the whole app (mirrors web/src/lib/timezone.ts).
APP_TZ = ZoneInfo("Europe/Athens")


def combine_day_time_utc(d: date, t: time) -> datetime:
    """Combine a calendar day + wall-clock time in APP_TZ, returned as a UTC datetime."""
    local = datetime(d.year, d.month, d.day, t.hour, t.minute, t.second, tzinfo=APP_TZ)
    return local.astimezone(timezone.utc)


def merge_intervals(intervals: list[tuple[datetime, datetime]]) -> list[tuple[datetime, datetime]]:
    if not intervals:
        return []
    intervals = sorted(intervals, key=lambda x: x[0])
    merged: list[list[datetime]] = [[intervals[0][0], intervals[0][1]]]
    for a, b in intervals[1:]:
        if a <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    return [(x[0], x[1]) for x in merged]


def subtract_intervals(free: list[tuple[datetime, datetime]], busy: Iterable[tuple[datetime, datetime]]) -> list[tuple[datetime, datetime]]:
    busy_m = merge_intervals(list(busy))
    result = list(free)
    for bs, be in busy_m:
        next_result: list[tuple[datetime, datetime]] = []
        for fs, fe in result:
            if be <= fs or bs >= fe:
                next_result.append((fs, fe))
            else:
                if bs > fs:
                    next_result.append((fs, min(bs, fe)))
                if be < fe:
                    next_result.append((max(be, fs), fe))
        result = [(a, b) for a, b in next_result if a < b]
    return merge_intervals(result)


def expand_weekly_slots(
    slots_by_weekday: dict[int, list[tuple[time, time]]],
    day_start: date,
    day_end: date,
) -> list[tuple[datetime, datetime]]:
    """Expand recurring weekly TIME ranges onto concrete UTC datetimes for each calendar day."""
    chunks: list[tuple[datetime, datetime]] = []
    d = day_start
    one = timedelta(days=1)
    while d <= day_end:
        wd = d.weekday()
        for st, et in slots_by_weekday.get(wd, []):
            chunks.append((combine_day_time_utc(d, st), combine_day_time_utc(d, et)))
        d += one
    return merge_intervals(chunks)


def coaching_session_busy_interval(scheduled_at: datetime | None, ends_at: datetime | None, status: str) -> tuple[datetime, datetime] | None:
    if scheduled_at is None or status not in ("planned", "in_progress"):
        return None
    start = scheduled_at
    if ends_at is not None and ends_at > start:
        end = ends_at
    else:
        end = start + DEFAULT_SESSION_BLOCK
    return (start, end)


def pending_request_busy_interval(req_start: datetime, req_end: datetime, status: str) -> tuple[datetime, datetime] | None:
    if status != "pending":
        return None
    return (req_start, req_end)


def group_weekly_slots(rows: list[tuple[int, time, time]]) -> dict[int, list[tuple[time, time]]]:
    g: dict[int, list[tuple[time, time]]] = defaultdict(list)
    for wd, st, et in rows:
        g[int(wd)].append((st, et))
    return dict(g)
