from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import get_current_profile
from app.models import Profile
from app.schemas import ProfileOut, ProfilePatch

router = APIRouter(prefix="/me", tags=["users"])


@router.get("", response_model=ProfileOut)
async def read_me(profile: Profile = Depends(get_current_profile)) -> Profile:
    return profile


@router.patch("", response_model=ProfileOut)
async def patch_me(
    body: ProfilePatch,
    profile: Profile = Depends(get_current_profile),
    session: AsyncSession = Depends(get_session),
) -> Profile:
    data = body.model_dump(exclude_unset=True)
    if data.get("profile_completed") is True:
        next_name = data.get("full_name", profile.full_name)
        next_place = data.get("primary_place", profile.primary_place)
        if not (next_name and str(next_name).strip()):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="full_name is required to complete your profile",
            )
        if not (next_place and str(next_place).strip()):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="primary_place is required to complete your profile",
            )
    for key, value in data.items():
        if isinstance(value, str):
            value = value.strip() or None
        setattr(profile, key, value)
    await session.commit()
    await session.refresh(profile)
    return profile
