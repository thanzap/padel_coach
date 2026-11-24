from datetime import date, datetime, time, timedelta, timezone

from app.availability_service import interval_covers
from app.availability_slots import (
    coaching_session_busy_interval,
    combine_day_time_utc,
    expand_weekly_slots,
    group_weekly_slots,
    merge_intervals,
    pending_request_busy_interval,
    subtract_intervals,
)

UTC = timezone.utc


def at(h, m=0, day=10):
    return datetime(2026, 11, day, h, m, tzinfo=UTC)


def test_wall_clock_converted_with_daylight_saving():
    # Athens is UTC+3 in summer and UTC+2 in winter: 18:00 local differs in UTC
    assert combine_day_time_utc(date(2026, 7, 1), time(18)).hour == 15
    assert combine_day_time_utc(date(2026, 12, 1), time(18)).hour == 16


def test_merge_overlapping_and_touching_intervals():
    merged = merge_intervals([(at(12), at(13)), (at(9), at(10)), (at(10), at(11)), (at(12, 30), at(14))])
    assert merged == [(at(9), at(11)), (at(12), at(14))]


def test_subtract_busy_splits_free_window():
    free = [(at(9), at(13))]
    busy = [(at(10), at(11)), (at(12, 30), at(14))]
    assert subtract_intervals(free, busy) == [(at(9), at(10)), (at(11), at(12, 30))]


def test_subtract_with_no_overlap_keeps_free_window():
    assert subtract_intervals([(at(9), at(10))], [(at(11), at(12))]) == [(at(9), at(10))]


def test_expand_weekly_rules_only_on_matching_weekdays():
    # 2026-11-09 is a Monday (weekday 0)
    slots = group_weekly_slots([(0, time(18), time(20)), (2, time(9), time(10))])
    out = expand_weekly_slots(slots, date(2026, 11, 9), date(2026, 11, 15))
    assert len(out) == 2
    assert out[0][0] == datetime(2026, 11, 9, 16, tzinfo=UTC)  # 18:00 Athens (UTC+2)
    assert out[1][1] - out[1][0] == timedelta(hours=1)


def test_only_active_sessions_and_pending_requests_block_time():
    assert coaching_session_busy_interval(at(10), None, "planned") == (at(10), at(11))  # default 1h block
    assert coaching_session_busy_interval(at(10), at(11, 30), "in_progress") == (at(10), at(11, 30))
    assert coaching_session_busy_interval(at(10), None, "cancelled") is None
    assert pending_request_busy_interval(at(10), at(11), "pending") == (at(10), at(11))
    assert pending_request_busy_interval(at(10), at(11), "declined") is None


def test_interval_covers():
    assert interval_covers((at(9), at(12)), (at(10), at(11)))
    assert not interval_covers((at(9), at(12)), (at(11), at(13)))
