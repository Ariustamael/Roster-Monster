"""
Migration: add new columns + seed correct OT templates + add R1/R2 call types.
Run from: backend/  →  python migrate_and_seed.py
Add --force to clear and re-seed OT templates.
"""
import sqlite3
import os
import sys

DB_PATH = os.path.join(os.path.dirname(__file__), "data", "roster.db")


def migrate(conn: sqlite3.Connection):
    cur = conn.cursor()
    migrations = [
        "ALTER TABLE call_type_config ADD COLUMN required_conditions TEXT",
        "ALTER TABLE call_type_config ADD COLUMN default_duty_type TEXT",
        "ALTER TABLE call_type_config ADD COLUMN is_night_float INTEGER DEFAULT 0",
        "ALTER TABLE call_type_config ADD COLUMN night_float_run TEXT",
        "ALTER TABLE ot_template ADD COLUMN registrar_needed INTEGER DEFAULT 0",
    ]
    for sql in migrations:
        try:
            cur.execute(sql)
            print(f"  OK: {sql}")
        except sqlite3.OperationalError as e:
            print(f"  SKIP ({e}): {sql}")
    conn.commit()


def get_staff_id(conn: sqlite3.Connection, name: str) -> int | None:
    cur = conn.cursor()
    cur.execute("SELECT id FROM staff WHERE name = ?", (name,))
    row = cur.fetchone()
    return row[0] if row else None


def seed_ot_templates(conn: sqlite3.Connection, force: bool = False):
    cur = conn.cursor()

    cur.execute("SELECT COUNT(*) FROM ot_template")
    count = cur.fetchone()[0]
    if count > 0 and not force:
        print(f"  OT templates already seeded ({count} rows). Use --force to re-seed.")
        return

    if force and count > 0:
        cur.execute("DELETE FROM ot_template")
        print(f"  Cleared {count} existing OT template rows.")

    # day_of_week: 0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri
    templates = [
        # Monday (0)
        {"dow": 0, "room": "OT10",  "consultant": "Andy Yeo",    "asst": 2, "week": None},
        {"dow": 0, "room": "OT3",   "consultant": "Kinjal Mehta", "asst": 2, "week": None},
        {"dow": 0, "room": "OT4",   "consultant": "Ing How",      "asst": 2, "week": None},
        {"dow": 0, "room": "OT6",   "consultant": "Raghu",        "asst": 2, "week": 1},
        {"dow": 0, "room": "OT6",   "consultant": "Junren",       "asst": 2, "week": 2},
        {"dow": 0, "room": "OT6",   "consultant": "Raghu",        "asst": 2, "week": 3},
        {"dow": 0, "room": "OT6",   "consultant": "Charles Kon",  "asst": 2, "week": 4},
        {"dow": 0, "room": "EOT",   "consultant": None,           "asst": 1, "week": None, "emergency": True, "linked": "MO2"},

        # Tuesday (1)
        {"dow": 1, "room": "OT10",  "consultant": "Zhihong",      "asst": 2, "week": None},
        {"dow": 1, "room": "OT3",   "consultant": "Kuo CL",       "asst": 2, "week": None},
        {"dow": 1, "room": "OT4",   "consultant": "James Loh",    "asst": 2, "week": None},
        {"dow": 1, "room": "EOT",   "consultant": None,           "asst": 1, "week": None, "emergency": True, "linked": "MO2"},

        # Wednesday (2)
        {"dow": 2, "room": "OT10",  "consultant": "Shree Dinesh", "asst": 2, "week": None},
        {"dow": 2, "room": "OT3",   "consultant": "Raghu",        "asst": 2, "week": None},
        {"dow": 2, "room": "OT4",   "consultant": "David Chua",   "asst": 2, "week": 1},
        {"dow": 2, "room": "OT4",   "consultant": "Dalun",        "asst": 2, "week": 2},
        {"dow": 2, "room": "OT4",   "consultant": "David Chua",   "asst": 2, "week": 3},
        {"dow": 2, "room": "OT4",   "consultant": "Dalun",        "asst": 2, "week": 4},
        {"dow": 2, "room": "OT6",   "consultant": "Ing How",      "asst": 2, "week": None},
        {"dow": 2, "room": "OT6",   "consultant": "Ho Chin",      "asst": 2, "week": 2},
        {"dow": 2, "room": "OT6",   "consultant": "Justine Lee",  "asst": 2, "week": 3},
        {"dow": 2, "room": "OT6",   "consultant": "Ing How",      "asst": 2, "week": 4},
        {"dow": 2, "room": "OT6",   "consultant": "Zhihong",      "asst": 2, "week": 5},
        {"dow": 2, "room": "EOT",   "consultant": None,           "asst": 1, "week": None, "emergency": True, "linked": "MO2"},

        # Thursday (3)
        {"dow": 3, "room": "DSOT3", "consultant": "Junren",       "asst": 2, "week": 1},
        {"dow": 3, "room": "DSOT3", "consultant": None,           "asst": 2, "week": 2},
        {"dow": 3, "room": "DSOT3", "consultant": "Junren",       "asst": 2, "week": 3},
        {"dow": 3, "room": "DSOT3", "consultant": None,           "asst": 2, "week": 4},
        {"dow": 3, "room": "DSOT3", "consultant": "James Loh",    "asst": 2, "week": 5},
        {"dow": 3, "room": "OT3",   "consultant": "Charles Kon",  "asst": 2, "week": None},
        {"dow": 3, "room": "OT4",   "consultant": "Wei Sheng",    "asst": 2, "week": None},
        {"dow": 3, "room": "EOT",   "consultant": None,           "asst": 1, "week": None, "emergency": True, "linked": "MO2"},

        # Friday (4)
        {"dow": 4, "room": "DSOT3", "consultant": "Kuo CL",       "asst": 2, "week": 2},
        {"dow": 4, "room": "DSOT3", "consultant": "Kinjal Mehta", "asst": 2, "week": 3},
        {"dow": 4, "room": "DSOT3", "consultant": "Andy Yeo",     "asst": 2, "week": 4},
        {"dow": 4, "room": "OT10",  "consultant": "Justine Lee",  "asst": 2, "week": None},
        {"dow": 4, "room": "OT3",   "consultant": "Jonathan Gan", "asst": 2, "week": None},
        {"dow": 4, "room": "OT4",   "consultant": "Ho Chin",      "asst": 2, "week": None},
        {"dow": 4, "room": "EOT",   "consultant": None,           "asst": 1, "week": None, "emergency": True, "linked": "MO2"},
    ]

    inserted = 0
    for t in templates:
        cons_id = None
        if t.get("consultant"):
            cons_id = get_staff_id(conn, t["consultant"])
            if cons_id is None:
                print(f"  WARN: Staff not found: {t['consultant']}")

        cur.execute(
            """
            INSERT INTO ot_template
              (day_of_week, room, consultant_id, assistants_needed, registrar_needed,
               is_emergency, linked_call_slot, color, is_active, week_of_month)
            VALUES (?, ?, ?, ?, 0, ?, ?, NULL, 1, ?)
            """,
            (
                t["dow"], t["room"], cons_id, t["asst"],
                1 if t.get("emergency") else 0,
                t.get("linked"),
                t.get("week"),
            ),
        )
        inserted += 1

    conn.commit()
    print(f"  Inserted {inserted} OT templates.")


def seed_default_duty_types(conn: sqlite3.Connection):
    cur = conn.cursor()
    updates = [("MO1", "Ward MO"), ("MO2", "EOT MO")]
    for name, duty in updates:
        cur.execute(
            "UPDATE call_type_config SET default_duty_type = ? WHERE name = ?",
            (duty, name),
        )
        if cur.rowcount:
            print(f"  Set default_duty_type '{duty}' on call type '{name}'")
        else:
            print(f"  WARN: Call type '{name}' not found")
    conn.commit()


def seed_r1_r2(conn: sqlite3.Connection):
    """Add R1 and R2 night-float call types for SSR/SR if not already present."""
    cur = conn.cursor()

    for name in ("R1", "R2"):
        cur.execute("SELECT id FROM call_type_config WHERE name = ?", (name,))
        if cur.fetchone():
            print(f"  SKIP: Call type '{name}' already exists.")
            continue

        # R1: standard night call, all weekdays
        # R2: night float Tue-Fri, back-to-back allowed (min_gap=0, post_call=none)
        if name == "R1":
            applicable = "Mon,Tue,Wed,Thu,Fri"
            post_call = "8am"
            min_gap = 2
            max_consec = 1
            order = 7
        else:
            applicable = "Tue,Wed,Thu,Fri"
            post_call = "none"
            min_gap = 0
            max_consec = 4
            order = 8

        cur.execute(
            """
            INSERT INTO call_type_config
              (name, display_order, is_overnight, post_call_type, max_consecutive_days,
               min_gap_days, difficulty_points, counts_towards_fairness,
               applicable_days, is_active)
            VALUES (?, ?, 1, ?, ?, ?, 3, 1, ?, 1)
            """,
            (name, order, post_call, max_consec, min_gap, applicable),
        )
        ct_id = cur.lastrowid
        print(f"  Inserted call type '{name}' (id={ct_id})")

        # Link to SSR and SR ranks
        for rank_name in ("Senior Staff Registrar", "Senior Resident"):
            cur.execute("SELECT id FROM rank_config WHERE name = ?", (rank_name,))
            row = cur.fetchone()
            if row:
                rank_id = row[0]
                cur.execute(
                    "INSERT OR IGNORE INTO call_type_eligible_rank (call_type_id, rank_id) VALUES (?, ?)",
                    (ct_id, rank_id),
                )
                print(f"    Linked '{name}' → '{rank_name}'")

    # Mark SSR and SR as call-eligible
    for rank_name in ("Senior Staff Registrar", "Senior Resident"):
        cur.execute(
            "UPDATE rank_config SET is_call_eligible = 1 WHERE name = ?",
            (rank_name,),
        )
        if cur.rowcount:
            print(f"  Set is_call_eligible=True for '{rank_name}'")

    # Set night float flags on R1 and R2
    cur.execute("UPDATE call_type_config SET is_night_float = 1 WHERE name = 'R1'")
    if cur.rowcount:
        print("  Set is_night_float=1 for R1")
    cur.execute(
        "UPDATE call_type_config SET is_night_float = 1, night_float_run = 'Tue,Wed,Thu,Fri' WHERE name = 'R2'"
    )
    if cur.rowcount:
        print("  Set is_night_float=1, night_float_run='Tue,Wed,Thu,Fri' for R2")

    conn.commit()


if __name__ == "__main__":
    force = "--force" in sys.argv
    print(f"Connecting to: {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)
    print("Running migrations...")
    migrate(conn)
    print(f"Seeding OT templates (force={force})...")
    seed_ot_templates(conn, force=force)
    print("Setting default duty types...")
    seed_default_duty_types(conn)
    print("Seeding R1/R2 call types...")
    seed_r1_r2(conn)
    conn.close()
    print("Done.")
