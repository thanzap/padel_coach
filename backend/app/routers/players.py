from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from fastapi import APIRouter, Depends, Query

from app.db import get_session
from app.deps import require_coach
from app.models import Profile
from app.schemas import PlayerSearchOut

router = APIRouter(prefix="/players", tags=["players"])


@router.get("/search", response_model=list[PlayerSearchOut])
async def search_players(
    q: str = Query(..., max_length=120, description="Substring match on name, email, or primary place"),
    _: Profile = Depends(require_coach),
    session: AsyncSession = Depends(get_session),
) -> list[Profile]:
    raw = q.strip()
    if len(raw) < 2:
        return []
    needle = f"%{raw}%"
    stmt = (
        select(Profile)
        .where(
            Profile.role == "player",
            or_(
                Profile.full_name.ilike(needle),
                Profile.email.ilike(needle),
                Profile.primary_place.ilike(needle),
            ),
        )
        .order_by(Profile.full_name.asc().nulls_last(), Profile.email.asc().nulls_last())
        .limit(30)
    )
    rows = (await session.scalars(stmt)).all()
    return list(rows)
