"""SQLAlchemy 2.x engine/session setup.

SQLite for the hackathon build; swap DATABASE_URL to a Postgres DSN later —
no other code here needs to change. Alembic is intentionally not wired up
yet (see docs/DEPLOYMENT.md) — `Base.metadata.create_all()` is enough for a
schema that isn't shipping to production during the hackathon.
"""

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings

settings = get_settings()

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    # Import models so they're registered on Base.metadata before create_all.
    from . import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
