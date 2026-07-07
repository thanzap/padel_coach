from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import availability, coaches, dashboard, players, programs, session_requests, sessions, users

app = FastAPI(title="Padel Coaching API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(users.router)
app.include_router(programs.router)
app.include_router(sessions.router)
app.include_router(dashboard.router)
app.include_router(coaches.router)
app.include_router(availability.router)
app.include_router(session_requests.router)
app.include_router(players.router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
