"""
Migration: add new columns + seed OT templates from Apr 2026 screenshots.
Run from: backend/  →  python migrate_and_seed.py
"""
import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "data", "roster.db")


def migrate(conn: sqlite3.Connection):
    cur = conn.cursor()

    # Add new columns (ignore if already exist)
    migrations = [
        "ALTER TABLE call_type_config ADD COLUMN required_conditions TEXT",
        "ALTER TABLE call_type_config ADD COLUMN default_duty_type TEXT",
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


def seed_ot_templates(conn: sqlite3.Connection):
    cur = conn.cursor()

    # Check if templates already exist (skip if seeded)
    cur.execute("SELECT COUNT(*) FROM ot_template")
    count = cur.fetchone()[0]
    if count > 0:
        print(f"  OT templates already seeded ({count} rows). Skipping.")
        return

    # day_of_week: 0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri
    templates = [
        # Monday (0)
        {"dow": 0, "room": "OT10",  "consultant": "Andy Yeo",    "asst": 2, "week": None},
        {"dow": 0, "room": "OT3",   "consultant": "Kinjal Mehta", "asst": 2, "week": None},
        {"dow": 0, "room": "OT4",   "consultant": "Ing How",      "asst": 2, "week": None},
        {"dow": 0, "room": "OT6",   "consultant": "Raghu",        "asst": 2, "week": 1,   "emergency": False},
        {"dow": 0, "room": "OT6",   "consultant": "Junren",       "asst": 2, "week": 2},
        {"dow": 0, "room": "OT6",   "consultant": "Raghu",        "asst": 2, "week": 3},
        {"dow": 0, "room": "OT6",   "consultant": "Charles Kon",  "asst": 2, "week": 4},
        {"dow": 0, "room": "EOT",   "consultant": None,           "asst": 1, "week": None, "emergency": True,  "linked": "MO2"},

        # Tuesday (1)
        {"dow": 1, "room": "OT10",  "consultant": "Zhihong",      "asst": 2, "week": None},
        {"dow": 1, "room": "OT3",   "consultant": "Kuo CL",       "asst": 2, "week": None},
        {"dow": 1, "room": "OT4",   "consultant": "James Loh",    "asst": 2, "week": None},
        {"dow": 1, "room": "EOT",   "consultant": None,           "asst": 1, "week": None, "emergency": True,  "linked": "MO2"},

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
        {"dow": 2, "room": "EOT",   "consultant": None,           "asst": 1, "week": None, "emergency": True,  "linked": "MO2"},

        # Thursday (3)
        {"dow": 3, "room": "DSOT3", "consultant": "Junren",       "asst": 2, "week": 1},
        {"dow": 3, "room": "DSOT3", "consultant": None,           "asst": 2, "week": 2},   # David Tan (external)
        {"dow": 3, "room": "DSOT3", "consultant": "Junren",       "asst": 2, "week": 3},
        {"dow": 3, "room": "DSOT3", "consultant": None,           "asst": 2, "week": 4},   # David Tan (external)
        {"dow": 3, "room": "DSOT3", "consultant": "James Loh",    "asst": 2, "week": 5},   # JL/Dinesh
        {"dow": 3, "room": "OT3",   "consultant": "Charles Kon",  "asst": 2, "week": None},
        {"dow": 3, "room": "OT4",   "consultant": "Wei Sheng",    "asst": 2, "week": None},
        {"dow": 3, "room": "EOT",   "consultant": None,           "asst": 1, "week": None, "emergency": True,  "linked": "MO2"},

        # Friday (4)
        {"dow": 4, "room": "DSOT3", "consultant": "Kuo CL",       "asst": 2, "week": 2},
        {"dow": 4, "room": "DSOT3", "consultant": "Kinjal Mehta", "asst": 2, "week": 3},
        {"dow": 4, "room": "DSOT3", "consultant": "Andy Yeo",     "asst": 2, "week": 4},
        {"dow": 4, "room": "OT10",  "consultant": "Justine Lee",  "asst": 2, "week": None},
        {"dow": 4, "room": "OT3",   "consultant": "Jonathan Gan", "asst": 2, "week": None},
        {"dow": 4, "room": "OT4",   "consultant": "Ho Chin",      "asst": 2, "week": None},
        {"dow": 4, "room": "EOT",   "consultant": None,           "asst": 1, "week": None, "emergency": True,  "linked": "MO2"},
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
    """Set default_duty_type on MO1 → Ward MO and MO2 → EOT MO."""
    cur = conn.cursor()
    updates = [
        ("MO1", "Ward MO"),
        ("MO2", "EOT MO"),
    ]
    for name, duty in updates:
        cur.execute(
            "UPDATE call_type_config SET default_duty_type = ? WHERE name = ?",
            (duty, name),
        )
        if cur.rowcount:
            print(f"  Set default_duty_type '{duty}' on call type '{name}'")
        else:
            print(f"  WARN: Call type '{name}' not found — skipping default_duty_type")
    conn.commit()


if __name__ == "__main__":
    print(f"Connecting to: {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)
    print("Running migrations...")
    migrate(conn)
    print("Seeding OT templates...")
    seed_ot_templates(conn)
    print("Setting default duty types...")
    seed_default_duty_types(conn)
    conn.close()
    print("Done.")
