"""Pure pose geometry and scoring used by the padel video analyser.

No OpenCV / MediaPipe dependency, so it is unit-tested in isolation.
Landmarks are tuples (x, y, z, visibility) in normalised image coordinates,
where y grows downwards.

Scoring bands are calibrated to standard padel coaching guidance for the
athletic ready position: a base slightly wider than the shoulders, knees bent
(~120-160°), torso nearly upright, hips centred over the feet.
"""

import numpy as np
import pandas as pd

EPS = 1e-9


def dist(a, b):
    if a is None or b is None:
        return np.nan
    return float(np.linalg.norm(np.array(a[:2]) - np.array(b[:2])))


def angle_deg(a, b, c):
    """
    Angle ABC in degrees.
    Example: hip-knee-ankle gives knee angle.
    """
    if a is None or b is None or c is None:
        return np.nan

    a = np.array(a[:2], dtype=float)
    b = np.array(b[:2], dtype=float)
    c = np.array(c[:2], dtype=float)

    ba = a - b
    bc = c - b

    denom = np.linalg.norm(ba) * np.linalg.norm(bc)
    if denom < EPS:
        return np.nan

    cosang = np.dot(ba, bc) / denom
    cosang = np.clip(cosang, -1.0, 1.0)
    return float(np.degrees(np.arccos(cosang)))


def trunk_lean_deg(mid_hip, mid_shoulder):
    """
    0 degrees = upright vertical torso.
    Higher = more lean.
    Image y-axis goes downward, so vertical up is (0, -1).
    """
    if mid_hip is None or mid_shoulder is None:
        return np.nan

    v = np.array(
        [mid_shoulder[0] - mid_hip[0], mid_shoulder[1] - mid_hip[1]],
        dtype=float,
    )
    vertical_up = np.array([0.0, -1.0])
    denom = np.linalg.norm(v) * np.linalg.norm(vertical_up)
    if denom < EPS:
        return np.nan

    cosang = np.dot(v, vertical_up) / denom
    cosang = np.clip(cosang, -1.0, 1.0)
    return float(np.degrees(np.arccos(cosang)))


def score_range(value, low_good, high_good, low_bad, high_bad):
    """
    Returns 0..1.
    1 inside good range.
    Falls linearly toward bad limits.
    """
    if pd.isna(value):
        return 0.0

    if low_good <= value <= high_good:
        return 1.0

    if value < low_good:
        if value <= low_bad:
            return 0.0
        return (value - low_bad) / max(low_good - low_bad, EPS)

    if value > high_good:
        if value >= high_bad:
            return 0.0
        return (high_bad - value) / max(high_bad - high_good, EPS)

    return 0.0


def get_lm(landmarks, landmark_enum):
    lm = landmarks.landmark[landmark_enum.value]
    return (float(lm.x), float(lm.y), float(lm.z), float(lm.visibility))


def midpoint(a, b):
    if a is None or b is None:
        return None
    return (
        float((a[0] + b[0]) / 2.0),
        float((a[1] + b[1]) / 2.0),
        float((a[2] + b[2]) / 2.0),
        float((a[3] + b[3]) / 2.0),
    )


def calc_stance_score(row):
    """
    Padel ready-position heuristic, calibrated to coaching guidance:
    the athletic ready stance is a broad base "slightly wider than shoulder
    width", knees bent with weight on the balls of the feet, torso upright with
    only a slight forward lean, and hips centred over the base of support.

    stance_width_ratio here is ankle-width / hip-width. Feet at shoulder width
    land near ~1.4x hip width, and "slightly wider than shoulders" near ~1.6-2.2x,
    so that is treated as the good band.
    """
    width_score = score_range(
        row["stance_width_ratio"],
        low_good=1.4,
        high_good=2.3,
        low_bad=0.8,
        high_bad=3.5,
    )

    # Knees bent but not collapsed. ~120-160 deg = athletic flex; >170 = locked.
    knee_score = score_range(
        row["avg_knee_angle_deg"],
        low_good=120,
        high_good=160,
        low_bad=90,
        high_bad=178,
    )

    # A slight forward lean is good; this angle mostly catches lateral collapse
    # in a frontal/diagonal view, so a small band is rewarded.
    trunk_score = score_range(
        row["trunk_lean_deg"],
        low_good=0,
        high_good=25,
        low_bad=0,
        high_bad=45,
    )

    balance_score = score_range(
        abs(row["lateral_balance"]),
        low_good=0,
        high_good=0.25,
        low_bad=0,
        high_bad=0.65,
    )

    score = (
        0.30 * width_score
        + 0.35 * knee_score
        + 0.20 * trunk_score
        + 0.15 * balance_score
    )

    return round(100.0 * score, 2)
