from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
import os

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "roster.db")
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

engine = create_engine(f"sqlite:///{DB_PATH}", echo=False)
SessionLocal = sessionmaker(bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _migrate(engine):
    from sqlalchemy import inspect, text
    insp = inspect(engine)
    tables = insp.get_table_names()

    if "team" in tables:
        cols = {c["name"] for c in insp.get_columns("team")}
        if "display_order" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE team ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0"))

    if "clinic_template" in tables:
        cols = {c["name"] for c in insp.get_columns("clinic_template")}
        with engine.begin() as conn:
            if "clinic_type" not in cols:
                conn.execute(text("ALTER TABLE clinic_template ADD COLUMN clinic_type VARCHAR(20) DEFAULT 'Sup'"))
            if "mos_required" not in cols:
                conn.execute(text("ALTER TABLE clinic_template ADD COLUMN mos_required INTEGER DEFAULT 1"))

    if "ot_template" in tables:
        cols = {c["name"] for c in insp.get_columns("ot_template")}
        with engine.begin() as conn:
            if "is_emergency" not in cols:
                conn.execute(text("ALTER TABLE ot_template ADD COLUMN is_emergency BOOLEAN DEFAULT 0"))
            if "linked_call_slot" not in cols:
                conn.execute(text("ALTER TABLE ot_template ADD COLUMN linked_call_slot VARCHAR(10)"))


def init_db():
    Base.metadata.create_all(bind=engine)
    _migrate(engine)
