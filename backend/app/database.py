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

    if "ot_template" in tables:
        ot_cols = {c["name"] for c in insp.get_columns("ot_template")}
        if "is_active" not in ot_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE ot_template ADD COLUMN is_active BOOLEAN DEFAULT 1"))

    if "clinic_template" in tables:
        ct_cols = {c["name"] for c in insp.get_columns("clinic_template")}
        if "is_active" not in ct_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE clinic_template ADD COLUMN is_active BOOLEAN DEFAULT 1"))

    if "ot_template" in tables:
        ot_cols2 = {c["name"] for c in insp.get_columns("ot_template")}
        if "week_of_month" not in ot_cols2:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE ot_template ADD COLUMN week_of_month INTEGER"))

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

    # ── Phase 2: Rename grade → rank in staff table ─────────────────────
    if "staff" in tables:
        cols = {c["name"] for c in insp.get_columns("staff")}
        if "grade" in cols and "rank" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE staff RENAME COLUMN grade TO rank"))

    # ── Phase 2: Convert enum rank names to display names ──────────────
    if "staff" in tables:
        rank_map = {
            "SENIOR_CONSULTANT": "Senior Consultant",
            "CONSULTANT": "Consultant",
            "ASSOCIATE_CONSULTANT": "Associate Consultant",
            "SENIOR_STAFF_REGISTRAR": "Senior Staff Registrar",
            "SENIOR_RESIDENT": "Senior Resident",
            "SENIOR_MEDICAL_OFFICER": "Senior Medical Officer",
            "MEDICAL_OFFICER": "Medical Officer",
        }
        with engine.begin() as conn:
            for old, new in rank_map.items():
                conn.execute(text(
                    "UPDATE staff SET rank = :new WHERE rank = :old"
                ), {"old": old, "new": new})

    # ── Phase 2: Convert call_assignment.call_type from enum to varchar ──
    if "call_assignment" in tables:
        col_info = insp.get_columns("call_assignment")
        ct_col = next((c for c in col_info if c["name"] == "call_type"), None)
        if ct_col and str(ct_col.get("type", "")).upper().startswith("VARCHAR"):
            pass  # already migrated
        elif ct_col:
            # SQLite stores enum as VARCHAR anyway, so this is a no-op in practice
            pass

    # ── Phase 2: Seed rank_config if table is new/empty ─────────────────
    if "rank_config" in tables:
        with engine.begin() as conn:
            count = conn.execute(text("SELECT COUNT(*) FROM rank_config")).scalar()
            if count == 0:
                ranks = [
                    ("Senior Consultant", "SC", 0, 0, 0, 1, 1),
                    ("Consultant", "C", 1, 0, 0, 1, 1),
                    ("Associate Consultant", "AC", 2, 0, 0, 1, 1),
                    ("Senior Staff Registrar", "SSR", 3, 0, 1, 0, 1),
                    ("Senior Resident", "SR", 4, 0, 1, 0, 1),
                    ("Senior Medical Officer", "SMO", 5, 1, 1, 0, 1),
                    ("Medical Officer", "MO", 6, 1, 1, 0, 1),
                ]
                for name, abbr, order, call_elig, duty_elig, cons_tier, active in ranks:
                    conn.execute(text(
                        "INSERT INTO rank_config (name, abbreviation, display_order, "
                        "is_call_eligible, is_duty_eligible, is_consultant_tier, is_active) "
                        "VALUES (:name, :abbr, :order, :call, :duty, :cons, :active)"
                    ), {"name": name, "abbr": abbr, "order": order,
                        "call": call_elig, "duty": duty_elig, "cons": cons_tier, "active": active})

    # ── Phase 2: Seed call_type_config if table is new/empty ────────────
    if "call_type_config" in tables:
        with engine.begin() as conn:
            count = conn.execute(text("SELECT COUNT(*) FROM call_type_config")).scalar()
            if count == 0:
                call_types = [
                    ("MO1", 0, 1, "8am", 1, 2, 5, 1, "Mon,Tue,Wed,Thu,Fri,Sat,Sun,PH"),
                    ("MO2", 1, 1, "8am", 1, 2, 5, 1, "Mon,Tue,Wed,Thu,Fri,Sat,Sun,PH"),
                    ("MO3 (WD)", 2, 0, "none", 1, 0, 3, 0, "Mon,Tue,Wed,Thu,Fri"),
                    ("MO3 (WE)", 3, 1, "8am", 1, 2, 5, 1, "Stepdown"),
                    ("MO4", 4, 0, "none", 1, 0, 1, 0, "Extended OT"),
                    ("MO5", 5, 0, "none", 1, 0, 1, 0, "Extended OT"),
                    ("R1", 6, 1, "8am", 1, 2, 4, 1, "Mon,Tue,Wed,Thu,Fri"),
                    ("R2", 7, 1, "8am", 3, 2, 4, 1, "Mon,Tue,Wed,Thu,Fri"),
                    ("R1+2", 8, 1, "8am", 1, 2, 5, 1, "Sat,Sun,PH"),
                ]
                for name, order, overnight, pct, max_c, gap, diff, fairness, days in call_types:
                    conn.execute(text(
                        "INSERT INTO call_type_config (name, display_order, is_overnight, "
                        "post_call_type, max_consecutive_days, min_gap_days, difficulty_points, "
                        "counts_towards_fairness, applicable_days, is_active) "
                        "VALUES (:name, :order, :overnight, :pct, :max_c, :gap, :diff, :fairness, :days, 1)"
                    ), {"name": name, "order": order, "overnight": overnight, "pct": pct,
                        "max_c": max_c, "gap": gap, "diff": diff, "fairness": fairness, "days": days})

                # Seed eligible ranks for each call type
                # MO1, MO2: SMO + MO
                # MO3: SMO only (weekday referral)
                # MO4, MO5: SMO + MO
                smo_id = conn.execute(text(
                    "SELECT id FROM rank_config WHERE abbreviation = 'SMO'"
                )).scalar()
                mo_id = conn.execute(text(
                    "SELECT id FROM rank_config WHERE abbreviation = 'MO'"
                )).scalar()
                if smo_id and mo_id:
                    for ct_name in ["MO1", "MO2", "MO3 (WE)", "MO4", "MO5"]:
                        ct_id = conn.execute(text(
                            "SELECT id FROM call_type_config WHERE name = :n"
                        ), {"n": ct_name}).scalar()
                        if ct_id:
                            conn.execute(text(
                                "INSERT INTO call_type_eligible_rank (call_type_id, rank_id) VALUES (:ct, :r)"
                            ), {"ct": ct_id, "r": smo_id})
                            conn.execute(text(
                                "INSERT INTO call_type_eligible_rank (call_type_id, rank_id) VALUES (:ct, :r)"
                            ), {"ct": ct_id, "r": mo_id})
                    # MO3 (WD): SMO only
                    mo3wd_id = conn.execute(text(
                        "SELECT id FROM call_type_config WHERE name = 'MO3 (WD)'"
                    )).scalar()
                    if mo3wd_id:
                        conn.execute(text(
                            "INSERT INTO call_type_eligible_rank (call_type_id, rank_id) VALUES (:ct, :r)"
                        ), {"ct": mo3wd_id, "r": smo_id})

                    # R1, R2, R1+2: SSR + SR only
                    ssr_id = conn.execute(text(
                        "SELECT id FROM rank_config WHERE abbreviation = 'SSR'"
                    )).scalar()
                    sr_id = conn.execute(text(
                        "SELECT id FROM rank_config WHERE abbreviation = 'SR'"
                    )).scalar()
                    if ssr_id and sr_id:
                        for ct_name in ["R1", "R2", "R1+2"]:
                            ct_id = conn.execute(text(
                                "SELECT id FROM call_type_config WHERE name = :n"
                            ), {"n": ct_name}).scalar()
                            if ct_id:
                                conn.execute(text(
                                    "INSERT INTO call_type_eligible_rank (call_type_id, rank_id) VALUES (:ct, :r)"
                                ), {"ct": ct_id, "r": ssr_id})
                                conn.execute(text(
                                    "INSERT INTO call_type_eligible_rank (call_type_id, rank_id) VALUES (:ct, :r)"
                                ), {"ct": ct_id, "r": sr_id})

    # ── Merge clinic_template + ot_template → resource_template ──────────
    # Guard: run when resource_template is empty but source tables have data
    # (create_all already created the table; we only need to backfill once)
    insp = inspect(engine)
    if "resource_template" in insp.get_table_names():
        with engine.connect() as _chk:
            _rt_count = _chk.execute(text("SELECT COUNT(*) FROM resource_template")).scalar()
            _ct_count = _chk.execute(text("SELECT COUNT(*) FROM clinic_template")).scalar() if "clinic_template" in insp.get_table_names() else 0
            _ot_count = _chk.execute(text("SELECT COUNT(*) FROM ot_template")).scalar() if "ot_template" in insp.get_table_names() else 0
        _needs_migration = _rt_count == 0 and (_ct_count > 0 or _ot_count > 0)
    else:
        _needs_migration = True

    if _needs_migration:
        if "resource_template" not in insp.get_table_names():
            from .models import ResourceTemplate
            ResourceTemplate.__table__.create(bind=engine)

        with SessionLocal() as s:
            # Migrate clinic templates
            for row in s.execute(text("SELECT * FROM clinic_template")).mappings():
                s.execute(text("""
                    INSERT INTO resource_template
                    (resource_type, day_of_week, session, room, label,
                     consultant_id, staff_required, is_emergency,
                     linked_manpower, weeks, color, is_active, sort_order)
                    VALUES ('clinic', :dow, :session, :room, :label,
                            :cons_id, :staff_req, 0,
                            NULL, NULL, :color, :is_active, 0)
                """), {
                    "dow": row["day_of_week"],
                    "session": row["session"],
                    "room": row["room"],
                    "label": row.get("clinic_type", "Sup") or "Sup",
                    "cons_id": row.get("consultant_id"),
                    "staff_req": row.get("mos_required", 1) or 1,
                    "color": row.get("color"),
                    "is_active": row.get("is_active", True),
                })

            # Migrate OT templates
            for row in s.execute(text("SELECT * FROM ot_template")).mappings():
                week_val = row.get("week_of_month")
                s.execute(text("""
                    INSERT INTO resource_template
                    (resource_type, day_of_week, session, room, label,
                     consultant_id, staff_required, is_emergency,
                     linked_manpower, weeks, color, is_active, sort_order)
                    VALUES ('ot', :dow, 'AM', :room, '',
                            :cons_id, :staff_req, :is_emerg,
                            :linked, :weeks, :color, :is_active, 0)
                """), {
                    "dow": row["day_of_week"],
                    "room": row["room"],
                    "cons_id": row.get("consultant_id"),
                    "staff_req": row.get("assistants_needed", 2) or 2,
                    "is_emerg": row.get("is_emergency", False),
                    "linked": row.get("linked_call_slot"),
                    "weeks": str(week_val) if week_val is not None else None,
                    "color": row.get("color"),
                    "is_active": row.get("is_active", True),
                })
            s.commit()

    # ── Add is_registrar_tier to rank_config ──────────────────────────────
    if "rank_config" in insp.get_table_names():
        cols = [c["name"] for c in insp.get_columns("rank_config")]
        if "is_registrar_tier" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE rank_config ADD COLUMN is_registrar_tier BOOLEAN DEFAULT 0"))
                conn.execute(text("UPDATE rank_config SET is_registrar_tier = 1 WHERE name IN ('Senior Staff Registrar', 'Senior Resident')"))

    # ── Add is_duty_only, linked_to, mutually_exclusive_with to call_type_config ──
    if "call_type_config" in insp.get_table_names():
        cols = [c["name"] for c in insp.get_columns("call_type_config")]
        for col_name, col_def in [
            ("is_duty_only", "BOOLEAN DEFAULT 0"),
            ("linked_to", "TEXT"),
            ("mutually_exclusive_with", "TEXT"),
        ]:
            if col_name not in cols:
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TABLE call_type_config ADD COLUMN {col_name} {col_def}"))

    # ── Seed Ward MO, EOT MO as is_duty_only call types; set R1+2 mutual exclusivity ──
    if "call_type_config" in insp.get_table_names():
        with SessionLocal() as s:
            existing = {r[0] for r in s.execute(text("SELECT name FROM call_type_config")).fetchall()}

            if "Ward MO" not in existing:
                mo1_id = s.execute(text("SELECT id FROM call_type_config WHERE name = 'MO1'")).scalar()
                s.execute(text("""
                    INSERT INTO call_type_config
                    (name, display_order, is_overnight, post_call_type, max_consecutive_days,
                     min_gap_days, difficulty_points, counts_towards_fairness,
                     applicable_days, is_active, is_duty_only, linked_to)
                    VALUES ('Ward MO', 10, 0, 'none', 1, 0, 0, 0,
                            'Mon,Tue,Wed,Thu,Fri', 1, 1, :linked)
                """), {"linked": str(mo1_id) if mo1_id else None})

            if "EOT MO" not in existing:
                mo2_id = s.execute(text("SELECT id FROM call_type_config WHERE name = 'MO2'")).scalar()
                s.execute(text("""
                    INSERT INTO call_type_config
                    (name, display_order, is_overnight, post_call_type, max_consecutive_days,
                     min_gap_days, difficulty_points, counts_towards_fairness,
                     applicable_days, is_active, is_duty_only, linked_to)
                    VALUES ('EOT MO', 11, 0, 'none', 1, 0, 0, 0,
                            'Mon,Tue,Wed,Thu,Fri', 1, 1, :linked)
                """), {"linked": str(mo2_id) if mo2_id else None})

            # Set R1+2 mutually exclusive with R1 and R2
            r1_id = s.execute(text("SELECT id FROM call_type_config WHERE name = 'R1'")).scalar()
            r2_id = s.execute(text("SELECT id FROM call_type_config WHERE name = 'R2'")).scalar()
            r12_id = s.execute(text("SELECT id FROM call_type_config WHERE name = 'R1+2'")).scalar()
            if r12_id and r1_id and r2_id:
                current_val = s.execute(text("SELECT mutually_exclusive_with FROM call_type_config WHERE id = :id"), {"id": r12_id}).scalar()
                if not current_val:
                    s.execute(text(
                        "UPDATE call_type_config SET mutually_exclusive_with = :val WHERE id = :id"
                    ), {"val": f"{r1_id},{r2_id}", "id": r12_id})

            # Set eligible ranks for Ward MO and EOT MO (SMO + MO)
            smo_id = s.execute(text("SELECT id FROM rank_config WHERE abbreviation = 'SMO'")).scalar()
            mo_rank_id = s.execute(text("SELECT id FROM rank_config WHERE abbreviation = 'MO'")).scalar()
            for ct_name in ["Ward MO", "EOT MO"]:
                ct_id = s.execute(text("SELECT id FROM call_type_config WHERE name = :n"), {"n": ct_name}).scalar()
                if ct_id:
                    existing_ranks = {r[0] for r in s.execute(text("SELECT rank_id FROM call_type_eligible_rank WHERE call_type_id = :ct"), {"ct": ct_id}).fetchall()}
                    if smo_id and smo_id not in existing_ranks:
                        s.execute(text("INSERT INTO call_type_eligible_rank (call_type_id, rank_id) VALUES (:ct, :r)"), {"ct": ct_id, "r": smo_id})
                    if mo_rank_id and mo_rank_id not in existing_ranks:
                        s.execute(text("INSERT INTO call_type_eligible_rank (call_type_id, rank_id) VALUES (:ct, :r)"), {"ct": ct_id, "r": mo_rank_id})

            s.commit()

    # ── Add extra_call_type_ids and duty_preference to staff ────────────
    if "staff" in insp.get_table_names():
        cols = [c["name"] for c in insp.get_columns("staff")]
        if "extra_call_type_ids" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE staff ADD COLUMN extra_call_type_ids TEXT"))
        if "duty_preference" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE staff ADD COLUMN duty_preference VARCHAR(20)"))

    # ── Add updated_at timestamps ────────────────────────────────────────
    insp = inspect(engine)
    for tbl in ["resource_template", "staff", "monthly_config"]:
        if tbl in insp.get_table_names():
            cols = [c["name"] for c in insp.get_columns(tbl)]
            if "updated_at" not in cols:
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TABLE {tbl} ADD COLUMN updated_at TIMESTAMP"))
                    conn.execute(text(f"UPDATE {tbl} SET updated_at = datetime('now')"))


def init_db():
    from . import models  # noqa: F401 — ensure all models registered with Base
    Base.metadata.create_all(bind=engine)
    _migrate(engine)
