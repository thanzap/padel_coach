import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Profile
from app.security import decode_supabase_jwt

bearer = HTTPBearer(auto_error=False)


async def get_current_user_id(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> uuid.UUID:
    if creds is None or creds.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    return decode_supabase_jwt(creds.credentials)


async def get_current_profile(
    user_id: uuid.UUID = Depends(get_current_user_id),
    session: AsyncSession = Depends(get_session),
) -> Profile:
    profile = await session.scalar(select(Profile).where(Profile.id == user_id))
    if profile is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Profile not found")
    return profile


async def require_coach(profile: Profile = Depends(get_current_profile)) -> Profile:
    if profile.role not in ("coach", "admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Coach role required")
    return profile


async def require_player(profile: Profile = Depends(get_current_profile)) -> Profile:
    if profile.role != "player":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Player role required")
    return profile
