import math

import pytest

from pose_analytics.geometry import angle_deg, calc_stance_score, dist, midpoint, score_range, trunk_lean_deg


def test_right_angle_and_straight_leg():
    assert angle_deg((0, 1), (0, 0), (1, 0)) == pytest.approx(90)
    # hip above knee above ankle → a locked knee is ~180°
    assert angle_deg((0.5, 0.2), (0.5, 0.5), (0.5, 0.8)) == pytest.approx(180)


def test_degenerate_points_give_nan_not_crash():
    assert math.isnan(angle_deg((0, 0), (0, 0), (1, 1)))
    assert math.isnan(angle_deg(None, (0, 0), (1, 1)))
    assert math.isnan(dist(None, (1, 1)))


def test_trunk_lean_uses_image_coordinates():
    # y grows downwards: shoulder straight above hip is upright
    assert trunk_lean_deg((0.5, 0.6), (0.5, 0.3)) == pytest.approx(0)
    assert trunk_lean_deg((0.5, 0.6), (0.8, 0.3)) == pytest.approx(45)


def test_midpoint_averages_all_four_components():
    assert midpoint((0, 0, 0, 1), (1, 2, 4, 0)) == (0.5, 1.0, 2.0, 0.5)


@pytest.mark.parametrize("value,expected", [
    (140, 1.0),          # inside the good band
    (105, 0.5),          # halfway between bad (90) and good (120)
    (90, 0.0),
    (169, 0.5),          # halfway between good (160) and bad (178)
    (float("nan"), 0.0),
])
def test_score_range_is_piecewise_linear(value, expected):
    assert score_range(value, 120, 160, 90, 178) == pytest.approx(expected)


def test_textbook_ready_stance_scores_100_and_locked_knees_score_lower():
    ready = {"stance_width_ratio": 1.8, "avg_knee_angle_deg": 140, "trunk_lean_deg": 10, "lateral_balance": 0.05}
    assert calc_stance_score(ready) == 100.0
    upright = {**ready, "avg_knee_angle_deg": 178, "stance_width_ratio": 0.9}
    assert calc_stance_score(upright) < 50
