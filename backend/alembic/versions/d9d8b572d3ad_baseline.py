"""baseline

Revision ID: d9d8b572d3ad
Revises:
Create Date: 2026-04-26 01:51:35.065658

This is a no-op baseline revision. The schema is created by app.database.init_db()
(Base.metadata.create_all) on first boot. Alembic is used only for future
incremental migrations. Run `alembic stamp head` on existing databases to mark
them as up-to-date without re-running any DDL.
"""

from typing import Sequence, Union

revision: str = "d9d8b572d3ad"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass  # schema already created by init_db(); nothing to run


def downgrade() -> None:
    pass  # no-op baseline cannot be meaningfully reversed
