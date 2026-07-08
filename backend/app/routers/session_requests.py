import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload

from app.availability_service import assert_interval_available_for_request
from app.coaching_session_actions import persist_coaching_session_from_program
from app.db import get_session
from app.deps import get_current_profile, require_coach, require_player
from app.models import Profile, SessionRequest, TrainingProgram
from app.schemas import SessionRequestCreate, SessionRequestOut, SessionRequestRespond

router = APIRouter(prefix="/session-requests", tags=["session-requests"])


@router.post("", response_model=SessionRequestOut, status_code=status.HTTP_201_CREATED)
async def create_session_request(
    body: SessionRequestCreate,
    profile: Profile = Depends(require_player),
    session: AsyncSession = Depends(get_session),
) -> SessionRequest:
    coach = await session.scalar(select(Profile).where(Profile.id == body.coach_id, Profile.role == "coach"))
    if coach is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Coach not found")

    await assert_interval_available_for_request(session, body.coach_id, body.requested_start, body.requested_end)

    req = SessionRequest(
        coach_id=body.coach_id,
        player_id=profile.id,
        requested_start=body.requested_start,
        requested_end=body.requested_end,
        note=(body.note.strip() if body.note else None),
        status="pending",
    )
    session.add(req)
    await session.commit()
    await session.refresh(req)
    return req


@router.get("", response_model=list[SessionRequestOut])
async def list_session_requests(
    profile: Profile = Depends(get_current_profile),
    session: AsyncSession = Depends(get_session),
) -> list[SessionRequestOut]:
    Player = aliased(Profile)
    Coach = aliased(Profile)
    stmt = (
        select(SessionRequest, Player.full_name.label("player_name"), Coach.full_name.label("coach_name"))
        .join(Player, Player.id == SessionRequest.player_id)
        .join(Coach, Coach.id == SessionRequest.coach_id)
    )
    if profile.role == "player":
        stmt = stmt.where(SessionRequest.player_id == profile.id)
    elif profile.role == "coach" or profile.role == "admin":
        stmt = stmt.where(SessionRequest.coach_id == profile.id)
    else:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Unsupported role")

    stmt = stmt.order_by(SessionRequest.created_at.desc())
    rows = (await session.execute(stmt)).all()
    return [
        SessionRequestOut.model_validate(req).model_copy(
            update={"player_name": player_name, "coach_name": coach_name}
        )
        for req, player_name, coach_name in rows
    ]


@router.post("/{request_id}/respond", response_model=SessionRequestOut)
async def respond_session_request(
    request_id: uuid.UUID,
    body: SessionRequestRespond,
    profile: Profile = Depends(require_coach),
    session: AsyncSession = Depends(get_session),
) -> SessionRequest:
    req = await session.scalar(select(SessionRequest).where(SessionRequest.id == request_id))
    if req is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found")
    if req.coach_id != profile.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your request")
    if req.status != "pending":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Request is no longer pending")

    if not body.accept:
        req.status = "declined"
        await session.commit()
        await session.refresh(req)
        return req

    assert body.program_id is not None
    program = await session.scalar(
        select(TrainingProgram)
        .where(TrainingProgram.id == body.program_id)
        .options(selectinload(TrainingProgram.exercises))
    )
    if program is None or program.coach_id != profile.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid program for this coach")

    player = await session.scalar(select(Profile).where(Profile.id == req.player_id))
    if player is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Player profile missing")

    await assert_interval_available_for_request(
        session, profile.id, req.requested_start, req.requested_end, ignore_request_id=req.id
    )

    try:
        coaching = await persist_coaching_session_from_program(
            session,
            program,
            profile.id,
            req.player_id,
            title=None,
            scheduled_at=req.requested_start,
            ends_at=req.requested_end,
            venue_place=None,
            status="planned",
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    req.status = "accepted"
    req.coaching_session_id = coaching.id
    await session.commit()
    await session.refresh(req)
    return req


@router.post("/{request_id}/cancel", response_model=SessionRequestOut)
async def cancel_session_request(
    request_id: uuid.UUID,
    profile: Profile = Depends(require_player),
    session: AsyncSession = Depends(get_session),
) -> SessionRequest:
    req = await session.scalar(select(SessionRequest).where(SessionRequest.id == request_id))
    if req is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found")
    if req.player_id != profile.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your request")
    if req.status != "pending":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only pending requests can be cancelled")

    req.status = "cancelled"
    await session.commit()
    await session.refresh(req)
    return req
