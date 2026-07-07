import uuid
from datetime import date, datetime, time
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class ProfileOut(BaseModel):
    id: uuid.UUID
    email: str | None
    full_name: str | None
    role: str
    primary_place: str | None = None
    training_club: str | None = None
    bio: str | None = None
    profile_completed: bool = False

    model_config = {"from_attributes": True}


class ProfilePatch(BaseModel):
    full_name: str | None = None
    primary_place: str | None = None
    training_club: str | None = None
    bio: str | None = None
    profile_completed: bool | None = None


class CoachPublicOut(BaseModel):
    id: uuid.UUID
    full_name: str | None
    primary_place: str | None
    training_club: str | None
    bio: str | None

    model_config = {"from_attributes": True}


class PlayerSearchOut(BaseModel):
    """Public fields coaches see when picking a player for a session."""

    id: uuid.UUID
    full_name: str | None
    email: str | None
    primary_place: str | None

    model_config = {"from_attributes": True}


class PastTrainingSessionOut(BaseModel):
    session_id: uuid.UUID
    coach_id: uuid.UUID
    player_id: uuid.UUID
    coach_name: str | None
    player_name: str | None
    session_date: datetime | None
    place: str | None
    status: str
    average_score: float | None

    @field_validator("average_score", mode="before")
    @classmethod
    def decimal_to_float(cls, v: object) -> object:
        if isinstance(v, Decimal):
            return float(v)
        return v


class ProgramExerciseIn(BaseModel):
    title: str
    description: str | None = None
    target_duration_sec: int | None = None


class ProgramExerciseOut(BaseModel):
    id: uuid.UUID
    sort_order: int
    title: str
    description: str | None
    target_duration_sec: int | None

    model_config = {"from_attributes": True}


class TrainingProgramCreate(BaseModel):
    title: str
    description: str | None = None
    exercises: list[ProgramExerciseIn] = Field(default_factory=list)

    @field_validator("exercises")
    @classmethod
    def at_least_one_exercise(cls, v: list[ProgramExerciseIn]) -> list[ProgramExerciseIn]:
        if len(v) < 1:
            raise ValueError("At least one exercise is required")
        return v


class TrainingProgramUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    exercises: list[ProgramExerciseIn] | None = None
    adhoc: bool | None = Field(default=None, description="Set to false to add a one-off routine to your saved library.")

    @field_validator("exercises")
    @classmethod
    def exercises_replace_non_empty(cls, v: list[ProgramExerciseIn] | None) -> list[ProgramExerciseIn] | None:
        if v is not None and len(v) < 1:
            raise ValueError("When replacing exercises, provide at least one exercise")
        return v


class TrainingProgramOut(BaseModel):
    id: uuid.UUID
    coach_id: uuid.UUID
    title: str
    description: str | None
    adhoc: bool = False
    created_at: datetime
    exercises: list[ProgramExerciseOut] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class CoachingSessionCreate(BaseModel):
    """Exactly one of program_id or inline_program must be set."""

    program_id: uuid.UUID | None = None
    inline_program: TrainingProgramCreate | None = None
    player_id: uuid.UUID
    title: str | None = None
    scheduled_at: datetime | None = None
    ends_at: datetime | None = None
    venue_place: str | None = None

    @model_validator(mode="after")
    def program_xor_inline(self) -> "CoachingSessionCreate":
        has_pid = self.program_id is not None
        has_inline = self.inline_program is not None
        if has_pid == has_inline:
            raise ValueError("Provide exactly one of program_id or inline_program")
        return self

    @model_validator(mode="after")
    def end_after_start(self) -> "CoachingSessionCreate":
        if self.scheduled_at is not None and self.ends_at is not None and self.ends_at <= self.scheduled_at:
            raise ValueError("ends_at must be after scheduled_at (session start)")
        return self


class CoachingSessionPatch(BaseModel):
    status: str | None = None
    venue_place: str | None = None
    scheduled_at: datetime | None = None
    ends_at: datetime | None = None

    @field_validator("status")
    @classmethod
    def allowed_status(cls, v: str | None) -> str | None:
        if v is None:
            return v
        allowed = {"planned", "in_progress", "completed", "cancelled"}
        if v not in allowed:
            raise ValueError(f"status must be one of {allowed}")
        return v


class SessionExerciseOut(BaseModel):
    id: uuid.UUID
    sort_order: int
    title: str
    description: str | None
    target_duration_sec: int | None
    source_program_exercise_id: uuid.UUID | None

    model_config = {"from_attributes": True}


class ExerciseRecordingOut(BaseModel):
    id: uuid.UUID
    storage_object_path: str
    duration_ms: int | None
    mime_type: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ExerciseScoreOut(BaseModel):
    id: uuid.UUID
    coach_id: uuid.UUID
    score: float
    notes: str | None
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_validator("score", mode="before")
    @classmethod
    def decimal_to_float(cls, v: object) -> object:
        if isinstance(v, Decimal):
            return float(v)
        return v


class SessionExerciseDetailOut(SessionExerciseOut):
    recordings: list[ExerciseRecordingOut] = Field(default_factory=list)
    scores: list[ExerciseScoreOut] = Field(default_factory=list)


class CoachingSessionOut(BaseModel):
    id: uuid.UUID
    program_id: uuid.UUID
    coach_id: uuid.UUID
    player_id: uuid.UUID
    title: str | None
    status: str
    scheduled_at: datetime | None
    ends_at: datetime | None = None
    venue_place: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class CoachingSessionDetailOut(CoachingSessionOut):
    exercises: list[SessionExerciseDetailOut] = Field(default_factory=list)
    program_adhoc: bool | None = Field(
        default=None,
        description="True when the linked program is a one-off (not shown in saved routines until promoted).",
    )


class SessionTrainingProgramExerciseOut(BaseModel):
    """Snapshot lines copied onto the session when it was scheduled."""

    sort_order: int
    title: str
    description: str | None
    target_duration_sec: int | None


class SessionTrainingProgramOut(BaseModel):
    """Read-only training plan for a session (coach or assigned player)."""

    session_id: uuid.UUID
    session_title: str | None
    program_id: uuid.UUID
    program_title: str
    program_description: str | None
    exercises: list[SessionTrainingProgramExerciseOut]


class RecordingRegister(BaseModel):
    storage_object_path: str
    duration_ms: int | None = None
    mime_type: str | None = None


class ScoreUpsert(BaseModel):
    score: float = Field(ge=0, le=10)
    notes: str | None = None


# --- Coach availability & session requests ---


class CoachWeeklySlotRuleIn(BaseModel):
    """Weekly rule using wall-clock times interpreted in UTC (same basis as session timestamps)."""

    weekday: int = Field(ge=0, le=6, description="0 = Monday … 6 = Sunday")
    start_local: str = Field(pattern=r"^\d{1,2}:\d{2}$", examples=["09:00"])
    end_local: str = Field(pattern=r"^\d{1,2}:\d{2}$", examples=["17:00"])

    def start_as_time(self) -> time:
        return datetime.strptime(self.start_local.strip(), "%H:%M").time()

    def end_as_time(self) -> time:
        return datetime.strptime(self.end_local.strip(), "%H:%M").time()


class WeeklyAvailabilityReplace(BaseModel):
    slots: list[CoachWeeklySlotRuleIn] = Field(default_factory=list)


class CoachWeeklySlotOut(BaseModel):
    id: uuid.UUID
    coach_id: uuid.UUID
    weekday: int
    start_time: time
    end_time: time
    created_at: datetime

    model_config = {"from_attributes": True}


class CoachAvailabilityBlockCreate(BaseModel):
    starts_at: datetime
    ends_at: datetime
    reason: str | None = None

    @model_validator(mode="after")
    def range_ok(self) -> "CoachAvailabilityBlockCreate":
        if self.ends_at <= self.starts_at:
            raise ValueError("ends_at must be after starts_at")
        return self


class CoachAvailabilityBlockOut(BaseModel):
    id: uuid.UUID
    coach_id: uuid.UUID
    starts_at: datetime
    ends_at: datetime
    reason: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class FreeSlotIntervalOut(BaseModel):
    start: datetime
    end: datetime


class CoachFreeSlotsOut(BaseModel):
    coach_id: uuid.UUID
    start_date: date
    end_date: date
    slots: list[FreeSlotIntervalOut]


class CalendarBusyIntervalOut(BaseModel):
    """Busy segments for coach availability calendar preview (UTC)."""

    start: datetime
    end: datetime
    kind: Literal["session", "pending_request"]


class SessionRequestCreate(BaseModel):
    coach_id: uuid.UUID
    requested_start: datetime
    requested_end: datetime
    note: str | None = None

    @model_validator(mode="after")
    def window_ok(self) -> "SessionRequestCreate":
        if self.requested_end <= self.requested_start:
            raise ValueError("requested_end must be after requested_start")
        return self


class SessionRequestOut(BaseModel):
    id: uuid.UUID
    coach_id: uuid.UUID
    player_id: uuid.UUID
    requested_start: datetime
    requested_end: datetime
    note: str | None
    status: str
    coaching_session_id: uuid.UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}


class SessionRequestRespond(BaseModel):
    accept: bool
    program_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def program_when_accept(self) -> "SessionRequestRespond":
        if self.accept and self.program_id is None:
            raise ValueError("program_id is required when accepting")
        if not self.accept and self.program_id is not None:
            raise ValueError("program_id must be omitted when declining")
        return self


class PlayerInvite(BaseModel):
    email: str
