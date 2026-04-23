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
                conn.execute(text("ALTER TABLE ot_template ADD COLUMN linked_call_slot VARCHAR(50)"))
            if "color" not in cols:
                conn.execute(text("ALTER TABLE ot_template ADD COLUMN color VARCHAR(10)"))

    if "clinic_template" in tables:
        cols2 = {c["name"] for c in insp.get_columns("clinic_template")}
        if "color" not in cols2:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE clinic_template ADD COLUMN color VARCHAR(10)"))

    # Remove unique constraint on (day_of_week, room) from ot_template
    if "ot_template" in tables:
        indexes = insp.get_unique_constraints("ot_template")
        has_legacy = any(
            set(idx.get("column_names", [])) == {"day_of_week", "room"}
            for idx in indexes
        )
        if has_legacy:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE ot_template RENAME TO _ot_template_old"))
                conn.execute(text("""
                    CREATE TABLE ot_template (
                        id INTEGER PRIMARY KEY,
                        day_of_week INTEGER NOT NULL,
                        room VARCHAR(20) NOT NULL,
                        consultant_id INTEGER REFERENCES staff(id),
                        assistants_needed INTEGER DEFAULT 2,
                        is_emergency BOOLEAN DEFAULT 0,
                        linked_call_slot VARCHAR(50),
                        color VARCHAR(10)
                    )
                """))
                conn.execute(text("""
                    INSERT INTO ot_template (id, day_of_week, room, consultant_id,
                        assistants_needed, is_emergency, linked_call_slot, color)
                    SELECT id, day_of_week, room, consultant_id,
                        assistants_needed, is_emergency, linked_call_slot, color
                    FROM _ot_template_old
                """))
                conn.execute(text("DROP TABLE _ot_template_old"))


def init_db():
    Base.metadata.create_all(bind=engine)
    _migrate(engine)
