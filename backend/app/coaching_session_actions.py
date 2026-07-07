import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CoachingSession, SessionExercise, TrainingProgram


async def persist_coaching_session_from_program(
    db: AsyncSession,
    program: TrainingProgram,
    coach_id: uuid.UUID,
    player_id: uuid.UUID,
    *,
    title: str | None,
    scheduled_at,
    ends_at,
    venue_place: str | None,
    status: str = "planned",
) -> CoachingSession:
    exercises_sorted = sorted(program.exercises, key=lambda e: e.sort_order)
    if not exercises_sorted:
        raise ValueError("Program has no exercises")

    coaching = CoachingSession(
        program_id=program.id,
        coach_id=coach_id,
        player_id=player_id,
        title=title,
        scheduled_at=scheduled_at,
        ends_at=ends_at,
        venue_place=venue_place,
        status=status,
    )
    db.add(coaching)
    await db.flush()

    for ex in exercises_sorted:
        db.add(
            SessionExercise(
                session_id=coaching.id,
                sort_order=ex.sort_order,
                title=ex.title,
                description=ex.description,
                target_duration_sec=ex.target_duration_sec,
                source_program_exercise_id=ex.id,
            )
        )
    await db.flush()
    return coaching
