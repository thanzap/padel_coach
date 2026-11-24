"""Padel technique analyser: pose estimation on a training video.

MediaPipe Pose tracks 33 body landmarks per frame. From them we derive knee
angles, stance width, trunk lean and balance (geometry.py), detect swings from
racket-hand speed peaks, classify each shot (forehand/backhand, contact height,
overheads), and write an annotated video plus CSV/JSON metrics and a plain-language
coaching report.

Usage:
    python -m pose_analytics.analyze --input clip.mp4 --output-dir out/
"""

import argparse
import json
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
import pandas as pd

from pose_analytics.geometry import (  # noqa: F401  (re-exported for callers of the old script)
    EPS,
    angle_deg,
    calc_stance_score,
    dist,
    get_lm,
    midpoint,
    score_range,
    trunk_lean_deg,
)

mp_pose = mp.solutions.pose
mp_draw = mp.solutions.drawing_utils


def classify_shot_mechanics(row, hand_col_y, elbow_col, baseline_feet_y):
    """
    Rough shot-type guess from body pose at the moment of fastest wrist motion.

    Pose can only see the skeleton (no ball, no racket face, no spin), so this
    reliably separates overhead shots from groundstrokes and takes a decent stab
    at smash-vs-controlled-overhead. It CANNOT tell a vibora from a bandeja
    (that difference is spin) nor detect a bajada (that needs the glass rebound).

    Returns (contact_zone, jump_detected, arm_extended).
    """
    wrist_y = row.get(hand_col_y, np.nan)
    nose_y = row.get("nose_y", np.nan)
    shoulder_y = row.get("mid_shoulder_y", np.nan)
    hip_y = row.get("mid_hip_y", np.nan)
    feet_y = row.get("feet_y", np.nan)
    elbow = row.get(elbow_col, np.nan)

    # Image y grows downward: smaller y = higher up in the frame.
    if not pd.isna(wrist_y) and not pd.isna(nose_y) and wrist_y < nose_y:
        contact_zone = "overhead"
    elif not pd.isna(wrist_y) and not pd.isna(shoulder_y) and wrist_y < shoulder_y:
        contact_zone = "shoulder"
    elif not pd.isna(wrist_y) and not pd.isna(hip_y) and wrist_y < hip_y:
        contact_zone = "waist"
    else:
        contact_zone = "low"

    # Jump: feet lifted noticeably above their usual ground line (normalized coords).
    jump_detected = (
        not pd.isna(feet_y)
        and not pd.isna(baseline_feet_y)
        and (baseline_feet_y - feet_y) > 0.04
    )

    # A smash tends to reach near-full arm extension; a bandeja stays more bent.
    arm_extended = not pd.isna(elbow) and elbow >= 155

    return contact_zone, bool(jump_detected), bool(arm_extended)


def detect_swing_events(
    df,
    fps,
    handedness,
    forehand_image_side,
    min_shot_gap_sec=1.0,
    swing_quantile=0.90,
):
    """
    Detects likely shot/swing events from racket-hand speed.

    This is NOT true ball-contact detection.

    Instead of counting every speed peak (which double-counts a single swing,
    because backswing / forward swing / follow-through each spike the wrist
    speed), we detect swing *episodes*: contiguous stretches where the wrist
    is moving fast. Each episode counts as one shot, timestamped at its
    fastest frame.

    Robustness tricks:
    - longer smoothing window so one swing is one hump, not several
    - hysteresis: enter an episode at a high speed, only leave it once speed
      drops well below that (avoids flicker splitting one swing in two)
    - merge episodes closer together than `min_shot_gap_sec`
    - drop ultra-short blips that are just tracking noise
    """
    if df.empty:
        return pd.DataFrame()

    hand_col_x = "right_wrist_x" if handedness == "right" else "left_wrist_x"
    hand_col_y = "right_wrist_y" if handedness == "right" else "left_wrist_y"

    work = df.copy()

    for col in [hand_col_x, hand_col_y, "mid_hip_x", "mid_hip_y"]:
        work[col] = work[col].interpolate(limit_direction="both")

    dx = work[hand_col_x].diff()
    dy = work[hand_col_y].diff()

    wrist_speed = np.sqrt(dx**2 + dy**2) * fps
    wrist_speed = wrist_speed.fillna(0)

    smooth_speed = wrist_speed.rolling(
        window=max(3, int(fps * 0.20)),
        center=True,
        min_periods=1,
    ).mean()

    work["racket_hand_speed"] = smooth_speed

    enter_thresh = max(
        float(smooth_speed.quantile(swing_quantile)),
        float(smooth_speed.mean() + 1.2 * smooth_speed.std()),
    )
    # Must fall back below this (hysteresis) before a new swing can start.
    exit_thresh = 0.5 * enter_thresh

    elbow_col = "right_elbow_angle_deg" if handedness == "right" else "left_elbow_angle_deg"
    # Player's usual ground line, so a jump reads as feet lifting above it.
    baseline_feet_y = float(work["feet_y"].median()) if "feet_y" in work else np.nan

    # Robust body-size scale (shoulder-to-hip length) to normalise swing size,
    # so "how big was the backswing" is expressed in torso-lengths, not pixels.
    if {"mid_shoulder_x", "mid_shoulder_y", "mid_hip_x", "mid_hip_y"} <= set(work.columns):
        torso_len = np.sqrt(
            (work["mid_shoulder_x"] - work["mid_hip_x"]) ** 2
            + (work["mid_shoulder_y"] - work["mid_hip_y"]) ** 2
        )
        torso_scale = float(torso_len.median())
    else:
        torso_scale = np.nan

    min_gap_frames = max(1, int(fps * min_shot_gap_sec))
    # Ignore high-speed flickers shorter than this; a real swing lasts longer.
    min_swing_frames = max(2, int(fps * 0.10))

    values = smooth_speed.to_numpy()
    n = len(values)

    # 1) Find raw episodes via hysteresis.
    episodes = []
    in_swing = False
    start = 0
    for i in range(n):
        if not in_swing and values[i] >= enter_thresh:
            in_swing = True
            start = i
        elif in_swing and values[i] < exit_thresh:
            episodes.append([start, i - 1])
            in_swing = False
    if in_swing:
        episodes.append([start, n - 1])

    # 2) Merge episodes whose gap is smaller than the min shot spacing.
    merged = []
    for ep in episodes:
        if merged and (ep[0] - merged[-1][1]) < min_gap_frames:
            merged[-1][1] = ep[1]
        else:
            merged.append(ep)

    # 3) One event per merged episode, at its fastest frame.
    events = []
    for s, e in merged:
        if (e - s + 1) < min_swing_frames:
            continue

        peak_idx = s + int(np.argmax(values[s : e + 1]))
        row = work.iloc[peak_idx]
        if pd.isna(row[hand_col_x]) or pd.isna(row["mid_hip_x"]):
            continue

        image_side = "right" if row[hand_col_x] > row["mid_hip_x"] else "left"
        shot_type = "forehand" if image_side == forehand_image_side else "backhand"

        contact_zone, jump_detected, arm_extended = classify_shot_mechanics(
            row, hand_col_y, elbow_col, baseline_feet_y
        )

        if contact_zone == "overhead":
            if jump_detected or arm_extended:
                shot_class = "overhead: likely smash"
            else:
                shot_class = "overhead: bandeja/vibora family"
        else:
            shot_class = f"{shot_type} ({contact_zone})"

        # Swing compactness: how far the racket hand travels from the start of
        # the swing to contact, in torso-lengths. Padel technique rewards a
        # short, compact backswing (especially at the net), so a big number
        # flags an over-long, tennis-style swing.
        backswing_size = np.nan
        if not pd.isna(torso_scale) and torso_scale > EPS:
            prep = work.iloc[s : peak_idx + 1]
            wx = prep[hand_col_x].to_numpy()
            wy = prep[hand_col_y].to_numpy()
            cx, cy = float(row[hand_col_x]), float(row[hand_col_y])
            dmax = float(np.nanmax(np.sqrt((wx - cx) ** 2 + (wy - cy) ** 2)))
            backswing_size = dmax / torso_scale

        knee_at = row.get("avg_knee_angle_deg", np.nan)
        elbow_at = row.get(elbow_col, np.nan)
        balance_at = row.get("lateral_balance", np.nan)

        # Per-shot coaching notes, aligned to researched ideals for each shot.
        notes = []
        if not pd.isna(knee_at) and knee_at > 168:
            notes.append("legs almost straight at contact — bend the knees to get under/behind the ball")
        if not pd.isna(balance_at) and abs(balance_at) > 0.45:
            notes.append("weight falling to one side at contact — try to stay balanced over your base")

        if contact_zone == "overhead":
            if shot_class.endswith("bandeja/vibora family"):
                if not pd.isna(elbow_at) and elbow_at > 160:
                    notes.append("arm very straight for a control overhead — bandeja/vibora keep a bent ~90-120 deg elbow for control and spin")
            else:  # likely smash
                if not pd.isna(elbow_at) and elbow_at < 150:
                    notes.append("arm quite bent for a smash — reach up and extend at contact for a higher, more powerful strike")
        else:
            # Groundstrokes/volleys: keep the swing short and compact.
            if not pd.isna(backswing_size) and backswing_size > 1.5:
                notes.append("large backswing — padel rewards a short, compact preparation and contact out in front")

        events.append(
            {
                "frame": int(row["frame"]),
                "time_sec": round(float(row["time_sec"]), 3),
                "event_type": "swing_proxy",
                "shot_type_guess": shot_type,
                "shot_class": shot_class,
                "contact_zone": contact_zone,
                "jump_detected": jump_detected,
                "racket_elbow_deg": round(float(elbow_at), 1)
                if not pd.isna(elbow_at)
                else np.nan,
                "backswing_size_torso": round(float(backswing_size), 2)
                if not pd.isna(backswing_size)
                else np.nan,
                "image_side": image_side,
                "racket_hand_speed": round(float(row["racket_hand_speed"]), 5),
                "swing_start_sec": round(float(work.iloc[s]["time_sec"]), 3),
                "swing_end_sec": round(float(work.iloc[e]["time_sec"]), 3),
                "stance_score_at_event": row.get("stance_score", np.nan),
                "avg_knee_angle_at_event": knee_at,
                "stance_width_ratio_at_event": row.get("stance_width_ratio", np.nan),
                "shot_notes": "; ".join(notes),
            }
        )

    return pd.DataFrame(events)


def add_overlay(frame, row):
    h, w = frame.shape[:2]

    lines = [
        f"Time: {row['time_sec']:.2f}s",
        f"Stance score: {row.get('stance_score', np.nan):.1f}/100",
        f"Knee angle: {row.get('avg_knee_angle_deg', np.nan):.1f} deg",
        f"Stance width: {row.get('stance_width_ratio', np.nan):.2f}x hips",
        f"Trunk lean: {row.get('trunk_lean_deg', np.nan):.1f} deg",
    ]

    x, y = 20, 35
    for line in lines:
        cv2.putText(
            frame,
            line,
            (x, y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (255, 255, 255),
            2,
            cv2.LINE_AA,
        )
        cv2.putText(
            frame,
            line,
            (x, y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (0, 0, 0),
            1,
            cv2.LINE_AA,
        )
        y += 28

    return frame


def _wrap_text(text, max_chars):
    words = text.split()
    lines = []
    cur = ""
    for w in words:
        if len(cur) + len(w) + 1 <= max_chars:
            cur = f"{cur} {w}".strip()
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def _ascii_safe(text):
    """OpenCV's Hershey fonts only draw ASCII, so map common glyphs down."""
    return (
        text.replace("—", "-")
        .replace("–", "-")
        .replace("’", "'")
        .replace("°", " deg")
        .encode("ascii", "ignore")
        .decode("ascii")
    )


def draw_shot_banner(frame, shot_class, notes):
    """Draw a bottom banner naming the detected shot and its coaching notes."""
    h, w = frame.shape[:2]

    note_lines = []
    if isinstance(notes, str) and notes.strip():
        for note in notes.split(";"):
            note = _ascii_safe(note.strip())
            if note:
                note_lines.extend(_wrap_text("- " + note, max_chars=max(30, w // 14)))

    title = _ascii_safe(f"SHOT: {shot_class}")
    n_lines = 1 + len(note_lines)
    line_h = 30
    pad = 16
    box_h = pad * 2 + n_lines * line_h
    y0 = h - box_h - 10

    overlay = frame.copy()
    cv2.rectangle(overlay, (10, y0), (w - 10, y0 + box_h), (0, 0, 0), -1)
    cv2.addWeighted(overlay, 0.55, frame, 0.45, 0, frame)
    cv2.rectangle(frame, (10, y0), (w - 10, y0 + box_h), (0, 220, 255), 2)

    y = y0 + pad + 22
    cv2.putText(frame, title, (24, y), cv2.FONT_HERSHEY_SIMPLEX, 0.85, (0, 220, 255), 2, cv2.LINE_AA)
    y += line_h
    for ln in note_lines:
        cv2.putText(frame, ln, (24, y), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1, cv2.LINE_AA)
        y += line_h

    return frame


def overlay_shot_labels(base_video_path, out_path, events, fps, hold_sec=1.4):
    """
    Second, cheap pass: re-read the already-annotated video and stamp each
    detected shot's class + coaching notes onto the frames around its contact,
    so you can eyeball whether the classification is right.
    """
    frame_labels = {}
    if events is not None and not events.empty:
        for _, ev in events.iterrows():
            start_f = int(float(ev.get("swing_start_sec", ev["time_sec"])) * fps)
            end_f = int(float(ev.get("swing_end_sec", ev["time_sec"])) * fps)
            end_f = int(end_f + hold_sec * fps)
            for f in range(start_f, end_f + 1):
                frame_labels[f] = (ev["shot_class"], ev.get("shot_notes", ""))

    cap = cv2.VideoCapture(str(base_video_path))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(out_path), fourcc, fps, (width, height))

    idx = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if idx in frame_labels:
            shot_class, notes = frame_labels[idx]
            frame = draw_shot_banner(frame, shot_class, notes)
        writer.write(frame)
        idx += 1

    cap.release()
    writer.release()


def build_coaching_report(m, events):
    """
    Turn the raw metrics into detailed, structured coaching feedback.

    Each item has: area, rating (good / work_on / priority), observation (with
    the actual numbers), why_it_matters, and how_to_fix (a concrete drill).
    Advice is grounded in standard padel coaching for the ready position,
    compact swing, and overhead technique.
    """
    report = []

    def add(area, rating, observation, why, fix):
        report.append(
            {
                "area": area,
                "rating": rating,
                "observation": observation,
                "why_it_matters": why,
                "how_to_fix": fix,
            }
        )

    # --- Knee bend / staying low ---------------------------------------------
    if m["too_upright_pct"] > 35 or m["avg_knee_angle"] > 162:
        add(
            "Knee bend / staying low",
            "priority" if m["too_upright_pct"] > 50 else "work_on",
            f"Your legs were near-straight in {m['too_upright_pct']:.0f}% of frames "
            f"(average knee angle {m['avg_knee_angle']:.0f} deg; athletic ready is ~120-160 deg).",
            "A low, flexed-knee stance with weight on the balls of the feet lets you "
            "push off in any direction and get under low balls off the glass.",
            "Wall-sit holds (30-45s x3) and shadow split-steps: land each split-step "
            "with knees bent ~130 deg and hold before moving to the next ball.",
        )
    elif m["avg_knee_angle"] <= 160:
        add(
            "Knee bend / staying low",
            "good",
            f"Good knee flexion (average {m['avg_knee_angle']:.0f} deg, and "
            f"{m['avg_knee_at_contact']:.0f} deg at contact).",
            "Staying low is the foundation of fast movement and clean contact in padel.",
            "Keep it up — add lateral bounds to hold this depth while moving sideways.",
        )

    # --- Stance width --------------------------------------------------------
    if m["narrow_stance_pct"] > 35:
        add(
            "Stance width / base of support",
            "work_on",
            f"Your feet were narrower than a stable base in {m['narrow_stance_pct']:.0f}% "
            f"of frames (average width {m['avg_stance_width_ratio']:.1f}x hip width).",
            "A base slightly wider than the shoulders gives side-to-side stability and "
            "a faster first step; a narrow base makes you reach and lose balance.",
            "Ladder / cone side-shuffles keeping feet ~shoulder-width, and freeze-frame "
            "your ready position on video to check the base before each shot.",
        )

    # --- Balance -------------------------------------------------------------
    if m["unstable_balance_pct"] > 25:
        add(
            "Balance over the base",
            "priority" if m["unstable_balance_pct"] > 40 else "work_on",
            f"Your hips drifted outside your feet in {m['unstable_balance_pct']:.0f}% of "
            f"frames (avg lateral balance {m['avg_lateral_balance']:+.2f}).",
            "If your centre of mass leaves your base you can't recover for the next ball "
            "and you lose control and power.",
            "Small adjustment steps to arrive balanced BEFORE hitting; single-leg balance "
            "holds and medicine-ball catches to train stability.",
        )

    # --- Trunk / posture -----------------------------------------------------
    if m["excessive_trunk_lean_pct"] > 25:
        add(
            "Posture / reaching with the torso",
            "work_on",
            f"Noticeable torso tilt in {m['excessive_trunk_lean_pct']:.0f}% of frames "
            f"(average lean {m['avg_trunk_lean']:.0f} deg from vertical).",
            "Bending the torso to reach means the legs stopped moving; it costs balance "
            "and consistency.",
            "Move to the ball with the feet and keep the chest up: cone drills where you "
            "must take an extra small step instead of leaning to reach.",
        )

    # --- Swing length / compactness -----------------------------------------
    big = m.get("big_backswing_count", 0)
    if m.get("avg_backswing") is not None and (m["avg_backswing"] > 1.3 or big >= 2):
        add(
            "Swing length (compactness)",
            "work_on",
            f"Average backswing was {m['avg_backswing']:.2f} torso-lengths"
            + (f", and {big}/{m['n_shots']} shots had an over-long take-back." if big else "."),
            "Padel rewards a short, compact preparation with contact out in front — a long "
            "tennis-style backswing arrives late and sprays control, especially at the net.",
            "Wall-volley drills focused on a punch (racket travels ~30-40cm), and prepare "
            "with the racket already up rather than swinging it back.",
        )
    elif m.get("avg_backswing") is not None:
        add(
            "Swing length (compactness)",
            "good",
            f"Compact preparation (average backswing {m['avg_backswing']:.2f} torso-lengths).",
            "Short swings mean earlier, more controlled contact.",
            "Maintain it under pressure — fast-feed volley drills to keep the swing short "
            "when rushed.",
        )

    # --- Tempo / shot mix ----------------------------------------------------
    if m.get("tempo") is not None:
        add(
            "Rally tempo & shot mix",
            "info",
            f"{m['n_shots']} shots detected, about one every {m['tempo']:.1f}s "
            f"({m['forehand']} forehand / {m['backhand']} backhand, "
            f"{m['overhead_count']} overhead).",
            "A steady, repeatable contact rhythm is a sign of good timing and preparation.",
            "For match realism, mix in overheads (bandeja/vibora/smash) and vary the "
            "tempo so the analysis covers your full shot range.",
        )

    # --- Recurring per-shot notes -------------------------------------------
    if events is not None and not events.empty:
        note_series = (
            events["shot_notes"].fillna("").str.split(";").explode().str.strip()
        )
        note_series = note_series[note_series != ""]
        for note, cnt in note_series.value_counts().items():
            if cnt >= max(2, int(0.34 * len(events))):
                add(
                    "Recurring in your shots",
                    "work_on",
                    f"On {cnt}/{len(events)} shots: {note}.",
                    "It shows up often enough to be a habit worth drilling.",
                    "Isolate it in slow, fed reps until the correct feel is automatic.",
                )

    # --- Positive reinforcement ---------------------------------------------
    if m["ready_pct"] > 65:
        add(
            "Ready-position consistency",
            "good",
            f"You held a solid athletic stance {m['ready_pct']:.0f}% of the time "
            f"(average stance score {m['avg_stance_score']:.0f}/100).",
            "Consistent ready position means less wasted movement and faster reactions.",
            "Keep reinforcing it; raise the bar by holding it while recovering between shots.",
        )

    if not report:
        add(
            "Overall",
            "good",
            "No major stance or swing issues stood out in this clip.",
            "Your fundamentals look sound for the shots analysed.",
            "Feed the tool a longer clip with overheads to stress-test more of your game.",
        )

    return report


def summarize(df, events, duration_sec):
    valid = df[df["pose_detected"] == True].copy()

    if valid.empty:
        return {
            "duration_sec": duration_sec,
            "frames_analyzed": int(len(df)),
            "pose_detected_frames": 0,
            "error": "No pose detected. Try a clearer full-body video.",
        }

    ready_pct = float((valid["stance_score"] >= 70).mean() * 100)

    too_upright_pct = float((valid["avg_knee_angle_deg"] > 165).mean() * 100)
    narrow_stance_pct = float((valid["stance_width_ratio"] < 1.15).mean() * 100)
    unstable_balance_pct = float((valid["lateral_balance"].abs() > 0.45).mean() * 100)
    excessive_trunk_lean_pct = float((valid["trunk_lean_deg"] > 35).mean() * 100)

    event_counts = {}
    zone_counts = {}
    class_counts = {}
    swing_metrics = {}
    big_backswing_count = 0
    if events is not None and not events.empty:
        event_counts = events["shot_type_guess"].value_counts().to_dict()
        zone_counts = events["contact_zone"].value_counts().to_dict()
        class_counts = events["shot_class"].value_counts().to_dict()

        # Tempo: average time between consecutive shots.
        if len(events) >= 2:
            gaps = events["time_sec"].sort_values().diff().dropna()
            swing_metrics["avg_seconds_between_shots"] = round(float(gaps.mean()), 2)

        swing_metrics["avg_knee_angle_at_contact_deg"] = round(
            float(events["avg_knee_angle_at_event"].mean()), 1
        )
        if "backswing_size_torso" in events:
            swing_metrics["avg_backswing_size_torso"] = round(
                float(events["backswing_size_torso"].mean()), 2
            )

        big_backswing_count = 0
        if "backswing_size_torso" in events:
            big_backswing_count = int((events["backswing_size_torso"] > 1.5).sum())

    # Court coverage proxy: how much the player moved (hip centre travel).
    movement = {}
    if "hip_center_speed_norm_per_sec" in df.columns:
        movement["avg_hip_speed_norm_per_sec"] = round(
            float(df["hip_center_speed_norm_per_sec"].fillna(0).mean()), 3
        )

    coaching_report = build_coaching_report(
        {
            "avg_stance_score": float(valid["stance_score"].mean()),
            "ready_pct": ready_pct,
            "avg_knee_angle": float(valid["avg_knee_angle_deg"].mean()),
            "avg_stance_width_ratio": float(valid["stance_width_ratio"].mean()),
            "avg_trunk_lean": float(valid["trunk_lean_deg"].mean()),
            "avg_lateral_balance": float(valid["lateral_balance"].mean()),
            "too_upright_pct": too_upright_pct,
            "narrow_stance_pct": narrow_stance_pct,
            "unstable_balance_pct": unstable_balance_pct,
            "excessive_trunk_lean_pct": excessive_trunk_lean_pct,
            "avg_knee_at_contact": swing_metrics.get("avg_knee_angle_at_contact_deg", float("nan")),
            "avg_backswing": swing_metrics.get("avg_backswing_size_torso"),
            "big_backswing_count": big_backswing_count if events is not None and not events.empty else 0,
            "tempo": swing_metrics.get("avg_seconds_between_shots"),
            "n_shots": int(len(events)) if events is not None else 0,
            "forehand": int(event_counts.get("forehand", 0)),
            "backhand": int(event_counts.get("backhand", 0)),
            "overhead_count": int(zone_counts.get("overhead", 0)),
        },
        events,
    )

    return {
        "duration_sec": round(float(duration_sec), 2),
        "frames_analyzed": int(len(df)),
        "pose_detected_frames": int(len(valid)),
        "pose_detection_rate_pct": round(float(len(valid) / max(len(df), 1) * 100), 2),

        "avg_stance_score": round(float(valid["stance_score"].mean()), 2),
        "ready_stance_pct": round(ready_pct, 2),

        "avg_knee_angle_deg": round(float(valid["avg_knee_angle_deg"].mean()), 2),
        "avg_stance_width_ratio": round(float(valid["stance_width_ratio"].mean()), 2),
        "avg_trunk_lean_deg": round(float(valid["trunk_lean_deg"].mean()), 2),
        "avg_lateral_balance": round(float(valid["lateral_balance"].mean()), 3),

        "too_upright_pct": round(too_upright_pct, 2),
        "narrow_stance_pct": round(narrow_stance_pct, 2),
        "unstable_balance_pct": round(unstable_balance_pct, 2),
        "excessive_trunk_lean_pct": round(excessive_trunk_lean_pct, 2),

        "swing_proxy_total": int(len(events)) if events is not None else 0,
        "forehand_proxy_count": int(event_counts.get("forehand", 0)),
        "backhand_proxy_count": int(event_counts.get("backhand", 0)),

        "overhead_count": int(zone_counts.get("overhead", 0)),
        "likely_smash_count": int(class_counts.get("overhead: likely smash", 0)),
        "bandeja_vibora_family_count": int(
            class_counts.get("overhead: bandeja/vibora family", 0)
        ),
        "shot_class_breakdown": {k: int(v) for k, v in class_counts.items()},

        **swing_metrics,
        **movement,

        "coaching_report": coaching_report,
    }


def process_video(
    input_path,
    output_dir,
    handedness,
    forehand_image_side,
    min_shot_gap_sec=1.0,
    swing_quantile=0.90,
):
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(str(input_path))
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video: {input_path}")

    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps <= 0:
        fps = 30.0

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration_sec = total_frames / fps if total_frames > 0 else 0

    annotated_path = output_dir / "annotated_stance_video.mp4"
    tmp_annotated_path = output_dir / "_annotated_tmp.mp4"
    csv_path = output_dir / "frame_metrics.csv"
    events_path = output_dir / "swing_events.csv"
    summary_path = output_dir / "summary.json"

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(tmp_annotated_path), fourcc, fps, (width, height))

    rows = []

    with mp_pose.Pose(
        static_image_mode=False,
        model_complexity=2,
        smooth_landmarks=True,
        enable_segmentation=False,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    ) as pose:
        frame_idx = 0

        while True:
            ok, frame = cap.read()
            if not ok:
                break

            time_sec = frame_idx / fps
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            result = pose.process(rgb)

            base_row = {
                "frame": frame_idx,
                "time_sec": time_sec,
                "pose_detected": False,
            }

            if result.pose_landmarks:
                lm = result.pose_landmarks

                L_SH = get_lm(lm, mp_pose.PoseLandmark.LEFT_SHOULDER)
                R_SH = get_lm(lm, mp_pose.PoseLandmark.RIGHT_SHOULDER)
                L_HIP = get_lm(lm, mp_pose.PoseLandmark.LEFT_HIP)
                R_HIP = get_lm(lm, mp_pose.PoseLandmark.RIGHT_HIP)
                L_KNEE = get_lm(lm, mp_pose.PoseLandmark.LEFT_KNEE)
                R_KNEE = get_lm(lm, mp_pose.PoseLandmark.RIGHT_KNEE)
                L_ANK = get_lm(lm, mp_pose.PoseLandmark.LEFT_ANKLE)
                R_ANK = get_lm(lm, mp_pose.PoseLandmark.RIGHT_ANKLE)
                L_WR = get_lm(lm, mp_pose.PoseLandmark.LEFT_WRIST)
                R_WR = get_lm(lm, mp_pose.PoseLandmark.RIGHT_WRIST)
                L_ELB = get_lm(lm, mp_pose.PoseLandmark.LEFT_ELBOW)
                R_ELB = get_lm(lm, mp_pose.PoseLandmark.RIGHT_ELBOW)
                NOSE = get_lm(lm, mp_pose.PoseLandmark.NOSE)

                mid_hip = midpoint(L_HIP, R_HIP)
                mid_shoulder = midpoint(L_SH, R_SH)
                feet_center = midpoint(L_ANK, R_ANK)

                hip_width = dist(L_HIP, R_HIP)
                ankle_width = dist(L_ANK, R_ANK)
                shoulder_width = dist(L_SH, R_SH)

                left_knee_angle = angle_deg(L_HIP, L_KNEE, L_ANK)
                right_knee_angle = angle_deg(R_HIP, R_KNEE, R_ANK)
                avg_knee_angle = np.nanmean([left_knee_angle, right_knee_angle])

                left_elbow_angle = angle_deg(L_SH, L_ELB, L_WR)
                right_elbow_angle = angle_deg(R_SH, R_ELB, R_WR)

                stance_width_ratio = ankle_width / max(hip_width, EPS)
                trunk_lean = trunk_lean_deg(mid_hip, mid_shoulder)

                lateral_balance = np.nan
                if feet_center is not None and mid_hip is not None and not pd.isna(ankle_width):
                    lateral_balance = (mid_hip[0] - feet_center[0]) / max(ankle_width, EPS)

                row = {
                    **base_row,
                    "pose_detected": True,

                    "left_shoulder_x": L_SH[0],
                    "left_shoulder_y": L_SH[1],
                    "right_shoulder_x": R_SH[0],
                    "right_shoulder_y": R_SH[1],

                    "left_hip_x": L_HIP[0],
                    "left_hip_y": L_HIP[1],
                    "right_hip_x": R_HIP[0],
                    "right_hip_y": R_HIP[1],

                    "left_wrist_x": L_WR[0],
                    "left_wrist_y": L_WR[1],
                    "right_wrist_x": R_WR[0],
                    "right_wrist_y": R_WR[1],

                    "mid_hip_x": mid_hip[0],
                    "mid_hip_y": mid_hip[1],
                    "mid_shoulder_x": mid_shoulder[0],
                    "mid_shoulder_y": mid_shoulder[1],

                    "hip_width": hip_width,
                    "shoulder_width": shoulder_width,
                    "ankle_width": ankle_width,
                    "stance_width_ratio": stance_width_ratio,

                    "left_knee_angle_deg": left_knee_angle,
                    "right_knee_angle_deg": right_knee_angle,
                    "avg_knee_angle_deg": avg_knee_angle,

                    "left_elbow_angle_deg": left_elbow_angle,
                    "right_elbow_angle_deg": right_elbow_angle,

                    "trunk_lean_deg": trunk_lean,
                    "lateral_balance": lateral_balance,

                    "nose_y": NOSE[1],
                    "feet_y": feet_center[1] if feet_center is not None else np.nan,
                }

                row["stance_score"] = calc_stance_score(row)

                mp_draw.draw_landmarks(
                    frame,
                    result.pose_landmarks,
                    mp_pose.POSE_CONNECTIONS,
                )

                frame = add_overlay(frame, row)
                rows.append(row)

            else:
                frame = add_overlay(
                    frame,
                    {
                        "time_sec": time_sec,
                        "stance_score": np.nan,
                        "avg_knee_angle_deg": np.nan,
                        "stance_width_ratio": np.nan,
                        "trunk_lean_deg": np.nan,
                    },
                )
                rows.append(base_row)

            writer.write(frame)
            frame_idx += 1

    cap.release()
    writer.release()

    df = pd.DataFrame(rows)

    # Movement speed from hip center
    if "mid_hip_x" in df.columns and "mid_hip_y" in df.columns:
        x = df["mid_hip_x"].interpolate(limit_direction="both")
        y = df["mid_hip_y"].interpolate(limit_direction="both")
        df["hip_center_speed_norm_per_sec"] = np.sqrt(x.diff() ** 2 + y.diff() ** 2).fillna(0) * fps

    events = detect_swing_events(
        df=df,
        fps=fps,
        handedness=handedness,
        forehand_image_side=forehand_image_side,
        min_shot_gap_sec=min_shot_gap_sec,
        swing_quantile=swing_quantile,
    )

    summary = summarize(df, events, duration_sec)

    # Second pass: stamp each detected shot's label + notes onto the video.
    overlay_shot_labels(tmp_annotated_path, annotated_path, events, fps)
    try:
        tmp_annotated_path.unlink()
    except OSError:
        pass

    df.to_csv(csv_path, index=False)
    events.to_csv(events_path, index=False)

    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)

    print("\nDone.")
    print(f"Annotated video: {annotated_path}")
    print(f"Frame metrics CSV: {csv_path}")
    print(f"Swing events CSV: {events_path}")
    print(f"Summary JSON: {summary_path}")

    print("\nSummary:")
    print(json.dumps(summary, indent=2, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="Path to input padel video")
    parser.add_argument("--output-dir", default="padel_output", help="Output folder")
    parser.add_argument(
        "--handedness",
        choices=["right", "left"],
        default="right",
        help="Racket hand",
    )
    parser.add_argument(
        "--forehand-image-side",
        choices=["right", "left"],
        default="right",
        help=(
            "From the camera view, which side of the player's body usually corresponds "
            "to forehand. If forehands/backhands are reversed, switch this."
        ),
    )
    parser.add_argument(
        "--min-shot-gap-sec",
        type=float,
        default=1.0,
        help=(
            "Minimum time between two counted shots. Raise it if shots are being "
            "double-counted; lower it for fast rallies. NOTE: this is in video time, "
            "so for a 0.5x slow-motion clip use roughly double (e.g. 2.0)."
        ),
    )
    parser.add_argument(
        "--swing-quantile",
        type=float,
        default=0.90,
        help=(
            "Speed percentile (0-1) used as the swing threshold. Higher = stricter "
            "(fewer shots). Try 0.92-0.95 if slow build-up motion is counted as swings."
        ),
    )

    args = parser.parse_args()

    process_video(
        input_path=args.input,
        output_dir=args.output_dir,
        handedness=args.handedness,
        forehand_image_side=args.forehand_image_side,
        min_shot_gap_sec=args.min_shot_gap_sec,
        swing_quantile=args.swing_quantile,
    )


if __name__ == "__main__":
    main()