import uuid

import jwt
from fastapi import HTTPException, status
from jwt import PyJWKClient

from app.config import settings

_jwks_clients: dict[str, PyJWKClient] = {}


def _jwks_client_for_project() -> PyJWKClient:
    base = settings.supabase_url.rstrip("/")
    if base not in _jwks_clients:
        _jwks_clients[base] = PyJWKClient(f"{base}/auth/v1/.well-known/jwks.json")
    return _jwks_clients[base]


def decode_supabase_jwt(token: str) -> uuid.UUID:
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token header") from exc

    alg = (header.get("alg") or "").upper()

    decode_kwargs = {
        "audience": "authenticated",
        "options": {"require": ["exp", "sub"]},
    }

    try:
        if alg in ("RS256", "ES256"):
            jwks = _jwks_client_for_project()
            signing_key = jwks.get_signing_key_from_jwt(token)
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=[alg],
                **decode_kwargs,
            )
        elif alg == "HS256":
            secret = settings.supabase_jwt_secret
            if not secret:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Server missing SUPABASE_JWT_SECRET (needed for HS256 tokens).",
                )
            payload = jwt.decode(
                token,
                secret,
                algorithms=["HS256"],
                **decode_kwargs,
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Unsupported JWT alg: {alg or 'missing'}",
            )
    except HTTPException:
        raise
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=(
                "Invalid or expired token. For HS256 set SUPABASE_JWT_SECRET to Dashboard → API → JWT Secret. "
                "For RS256/ES256 set SUPABASE_URL to your project URL."
            ),
        ) from exc

    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token subject")

    try:
        return uuid.UUID(sub)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid user id") from exc
