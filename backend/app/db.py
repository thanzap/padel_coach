from collections.abc import AsyncGenerator
from uuid import uuid4

from sqlalchemy.engine.url import URL, make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings


class Base(DeclarativeBase):
    pass


def _async_pg_url(raw: str) -> URL:
    """Supabase snippets use postgresql:// (sync); async SQLAlchemy needs asyncpg."""
    url = make_url(raw)
    if url.drivername in ("postgresql", "postgres", "postgresql+psycopg2"):
        url = url.set(drivername="postgresql+asyncpg")
    return url


def _is_transaction_pooler(url: URL) -> bool:
    host = (url.host or "").lower()
    return url.port == 6543 or "pooler.supabase.com" in host


def _create_engine():
    url = _async_pg_url(settings.database_url)
    connect_args: dict = {}
    # PgBouncer transaction mode: backends are shared; fixed asyncpg stmt names collide.
    # See SQLAlchemy asyncpg docs ("Prepared Statement Name with PGBouncer").
    if _is_transaction_pooler(url):
        connect_args["statement_cache_size"] = 0
        connect_args["prepared_statement_cache_size"] = 0
        connect_args["prepared_statement_name_func"] = lambda: f"__asyncpg_{uuid4()}__"
    kwargs: dict = {"pool_pre_ping": True}
    if connect_args:
        kwargs["connect_args"] = connect_args
    return create_async_engine(url, **kwargs)


engine = _create_engine()
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session
