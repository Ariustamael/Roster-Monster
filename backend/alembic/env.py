import os
import sys
from logging.config import fileConfig

from sqlalchemy import create_engine, pool
from alembic import context

# Make app importable
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app.config import settings
import app.models  # noqa: F401 — registers all ORM models with Base.metadata

# Import Base WITHOUT triggering the async engine (app.database creates async
# engine at module level, which requires aiosqlite at import time).  We grab
# Base directly from the models package instead.
from app.models import Base  # noqa: E402

alembic_config = context.config

if alembic_config.config_file_name is not None:
    fileConfig(alembic_config.config_file_name)

# Derive synchronous URL from the async one so Alembic can use it.
_sync_url = (
    settings.DATABASE_URL
    .replace("sqlite+aiosqlite://", "sqlite://")
    .replace("postgresql+asyncpg://", "postgresql+psycopg2://")
)
alembic_config.set_main_option("sqlalchemy.url", _sync_url)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = alembic_config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,  # required for SQLite ALTER TABLE support
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = create_engine(_sync_url, poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,  # required for SQLite ALTER TABLE support
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
