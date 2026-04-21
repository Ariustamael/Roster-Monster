"""
Seed the database with April 2026 data from CGH Orthopaedic Surgery.
Includes staff, teams, consultant/AC on-call, leaves, and evening OT dates.
"""

import sys
import os
from datetime import date

sys.path.insert(0, os.path.dirname(__file__))

from app.database import init_db, SessionLocal
from app.models import (
    Staff, Team, TeamAssignment, Leave, CallPreference,
    PublicHoliday, MonthlyConfig, ConsultantOnCall, ACOnCall,
    StepdownDay, EveningOTDate, Grade, PreferenceType,
)

def seed():
    init_db()
    db = SessionLocal()

    # Clear existing data
    for table in [
        EveningOTDate, StepdownDay, ACOnCall, ConsultantOnCall,
        CallPreference, Leave, TeamAssignment, PublicHoliday,
        MonthlyConfig, Staff, Team,
    ]:
        db.query(table).delete()
    db.commit()

    # ── Teams ────────────────────────────────────────────────────────
    teams = {}
    for name in ["Trauma", "Shoulder & Elbow", "Hip & Knee", "Foot & Ankle", "Spine"]:
        t = Team(name=name)
        db.add(t)
        db.flush()
        teams[name] = t

    # ── Consultants ──────────────────────────────────────────────────
    consultants_data = [
        ("David Chua",   Grade.CONSULTANT,        "Trauma"),
        ("Andy Yeo",     Grade.SENIOR_CONSULTANT,  "Trauma"),
        ("Justine Lee",  Grade.CONSULTANT,         "Trauma"),
        ("Ho Chin",      Grade.CONSULTANT,         "Trauma"),
        ("Kuo CL",       Grade.CONSULTANT,         "Shoulder & Elbow"),
        ("Wei Sheng",    Grade.CONSULTANT,         "Shoulder & Elbow"),
        ("James Loh",    Grade.CONSULTANT,         "Hip & Knee"),
        ("Raghu",        Grade.CONSULTANT,         "Hip & Knee"),
        ("Ing How",      Grade.CONSULTANT,         "Hip & Knee"),
        ("Siti Mastura", Grade.CONSULTANT,         "Hip & Knee"),
        ("Kinjal Mehta", Grade.CONSULTANT,         "Foot & Ankle"),
        ("Charles Kon",  Grade.CONSULTANT,         "Foot & Ankle"),
        ("Jonathan Gan", Grade.CONSULTANT,         "Foot & Ankle"),
        ("Shree Dinesh", Grade.SENIOR_CONSULTANT,  "Spine"),
        ("Zhihong",      Grade.CONSULTANT,         "Spine"),
    ]

    staff = {}
    for name, grade, team_name in consultants_data:
        s = Staff(name=name, grade=grade)
        db.add(s)
        db.flush()
        staff[name] = s
        db.add(TeamAssignment(
            staff_id=s.id, team_id=teams[team_name].id,
            role="consultant", effective_from=date(2025, 1, 1),
        ))

    # ── Associate Consultants ────────────────────────────────────────
    ac_data = [
        ("Junren",  Grade.ASSOCIATE_CONSULTANT, "Trauma"),
        ("Dalun",   Grade.ASSOCIATE_CONSULTANT, "Spine"),
    ]
    for name, grade, team_name in ac_data:
        s = Staff(name=name, grade=grade)
        db.add(s)
        db.flush()
        staff[name] = s
        db.add(TeamAssignment(
            staff_id=s.id, team_id=teams[team_name].id,
            role="consultant", effective_from=date(2025, 1, 1),
        ))

    # ── Registrars ───────────────────────────────────────────────────
    for name in ["Grace Tan", "Sagar", "Omar", "Raj", "Jia Ying"]:
        s = Staff(name=name, grade=Grade.REGISTRAR)
        db.add(s)
        db.flush()
        staff[name] = s

    # ── MOs (eff 6 Apr pool) ─────────────────────────────────────────
    mo_data = [
        # Trauma
        ("Nalaka",       Grade.MEDICAL_OFFICER,      "Trauma"),
        ("Chester Tan",  Grade.RESIDENT_PHYSICIAN,   "Trauma"),
        ("Samuel Ong",   Grade.RESIDENT_PHYSICIAN,   "Trauma"),
        ("Nazir",        Grade.RESIDENT_PHYSICIAN,   "Trauma"),
        ("Asif",         Grade.MEDICAL_OFFICER,       "Trauma"),
        ("Shilin",       Grade.RESIDENT_PHYSICIAN,   "Trauma"),
        ("Joshua Wong",  Grade.RESIDENT_PHYSICIAN,   "Trauma"),
        # Shoulder & Elbow
        ("Qing Hang",    Grade.RESIDENT_PHYSICIAN,   "Shoulder & Elbow"),
        ("Feng Yi",      Grade.RESIDENT_PHYSICIAN,   "Shoulder & Elbow"),
        ("Amirzeb",      Grade.MEDICAL_OFFICER,       "Shoulder & Elbow"),
        ("Chee Sian",    Grade.RESIDENT_PHYSICIAN,   "Shoulder & Elbow"),
        ("Sandip",       Grade.RESIDENT_PHYSICIAN,   "Shoulder & Elbow"),
        # Hip & Knee
        ("Raihan",       Grade.MEDICAL_OFFICER,       "Hip & Knee"),
        ("Kevan Toh",    Grade.RESIDENT_PHYSICIAN,   "Hip & Knee"),
        ("Jamie Lim",    Grade.RESIDENT_PHYSICIAN,   "Hip & Knee"),
        ("Teddy Cheong", Grade.RESIDENT_PHYSICIAN,   "Hip & Knee"),
        ("Kumara",       Grade.MEDICAL_OFFICER,       "Hip & Knee"),
        ("Nuwan",        Grade.MEDICAL_OFFICER,       "Hip & Knee"),
        # Foot & Ankle
        ("Angela Lim",   Grade.RESIDENT_PHYSICIAN,   "Foot & Ankle"),
        ("Brandon Lim",  Grade.RESIDENT_PHYSICIAN,   "Foot & Ankle"),
        ("Gennie Lim",   Grade.RESIDENT_PHYSICIAN,   "Foot & Ankle"),
        ("Wei Xiang",    Grade.RESIDENT_PHYSICIAN,   "Foot & Ankle"),
        ("Khoi Man",     Grade.MEDICAL_OFFICER,       "Foot & Ankle"),
        # Spine
        ("Jon Yeo",      Grade.CLINICAL_ASSOCIATE,   "Spine"),
        ("Wei Jie",      Grade.RESIDENT_PHYSICIAN,   "Spine"),
        ("Thaya",        Grade.MEDICAL_OFFICER,       "Spine"),
        ("Tharindu",     Grade.MEDICAL_OFFICER,       "Spine"),
    ]

    for name, grade, team_name in mo_data:
        s = Staff(name=name, grade=grade)
        db.add(s)
        db.flush()
        staff[name] = s
        db.add(TeamAssignment(
            staff_id=s.id, team_id=teams[team_name].id,
            role="mo", effective_from=date(2026, 4, 6),
        ))

    db.flush()

    # ── Public Holidays ──────────────────────────────────────────────
    db.add(PublicHoliday(date=date(2026, 4, 3), name="Good Friday"))

    # ── Monthly Config for April 2026 ────────────────────────────────
    config = MonthlyConfig(year=2026, month=4)
    db.add(config)
    db.flush()

    # ── Consultant On-Call Schedule (from roster) ────────────────────
    # Format: day → consultant name
    # Entries with "/" indicate AC tagged to consultant (e.g., Dalun/JL = Dalun tagged to James Loh)
    consultant_oncall = {
        1: "Kuo CL",
        2: "James Loh",       # Dalun/JL
        3: "Kuo CL",         # PH — estimated based on pattern
        4: "Kuo CL",
        5: "Andy Yeo",
        6: "Kinjal Mehta",
        7: "Wei Sheng",
        8: "Kuo CL",
        9: "David Chua",      # Dalun/DC
        10: "Ing How",
        11: "Ho Chin",
        12: "David Chua",     # Junren/DC
        13: "Justine Lee",
        14: "Kinjal Mehta",
        15: "Raghu",
        16: "Ing How",
        17: "Charles Kon",
        18: "James Loh",      # Junren/JL
        19: "Justine Lee",
        20: "David Chua",     # Dalun/DC
        21: "Ho Chin",
        22: "Jonathan Gan",
        23: "Kinjal Mehta",
        24: "Raghu",
        25: "Charles Kon",
        26: "Justine Lee",
        27: "Jonathan Gan",
        28: "Wei Sheng",
        29: "Raghu",
        30: "Charles Kon",
    }

    for day, name in consultant_oncall.items():
        db.add(ConsultantOnCall(
            config_id=config.id,
            date=date(2026, 4, day),
            consultant_id=staff[name].id,
        ))

    # ── AC On-Call Schedule ──────────────────────────────────────────
    ac_oncall = {
        2: "Dalun",
        5: "Dalun",
        8: "Junren",
        9: "Dalun",
        12: "Junren",
        18: "Junren",
        20: "Dalun",
        23: "Junren",
        26: "Dalun",
        29: "Junren",
    }

    for day, name in ac_oncall.items():
        db.add(ACOnCall(
            config_id=config.id,
            date=date(2026, 4, day),
            ac_id=staff[name].id,
        ))

    # ── Stepdown Days (from roster annotations) ──────────────────────
    for day in [9, 14, 28]:
        db.add(StepdownDay(config_id=config.id, date=date(2026, 4, day)))

    # ── Evening OT Dates (days with MO4/MO5 assigned) ────────────────
    for day in [2, 6, 9, 13, 16, 17, 20, 23, 27, 30]:
        db.add(EveningOTDate(config_id=config.id, date=date(2026, 4, day)))

    # ── Sample Leave (from roster leave list) ────────────────────────
    # Add a few known leaves to test constraints
    sample_leaves = [
        ("Sandip", date(2026, 4, 1), "AL"),
        ("Sandip", date(2026, 4, 2), "AL"),
        ("Sandip", date(2026, 4, 3), "AL"),
        ("Tharindu", date(2026, 4, 14), "Course"),
        ("Tharindu", date(2026, 4, 15), "Course"),
    ]
    for name, d, ltype in sample_leaves:
        if name in staff:
            db.add(Leave(staff_id=staff[name].id, date=d, leave_type=ltype))

    # ── Sample Call Preferences (demo data) ──────────────────────────
    db.add(CallPreference(
        staff_id=staff["Raihan"].id,
        date=date(2026, 4, 18),
        preference_type=PreferenceType.BLOCK,
        reason="Family event",
    ))
    db.add(CallPreference(
        staff_id=staff["Angela Lim"].id,
        date=date(2026, 4, 10),
        preference_type=PreferenceType.REQUEST,
        reason="Prefer this date",
    ))

    db.commit()
    db.close()

    print("Seeded successfully!")
    print(f"  Staff: {len(staff)}")
    print(f"  Teams: {len(teams)}")
    print(f"  Consultant on-call days: {len(consultant_oncall)}")
    print(f"  AC on-call days: {len(ac_oncall)}")
    print(f"  Evening OT dates: 10")
    print(f"  Stepdown days: 3")
    print(f"  Sample leaves: {len(sample_leaves)}")
    print(f"  Sample preferences: 2")


if __name__ == "__main__":
    seed()
