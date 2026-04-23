"""
Seed the database with April 2026 data from CGH Orthopaedic Surgery.
Includes staff, teams, consultant/AC on-call, leaves, evening OT dates,
OT templates, and clinic templates.
"""

import sys
import os
from datetime import date

sys.path.insert(0, os.path.dirname(__file__))

from app.database import init_db, SessionLocal
from app.models import (
    Staff, Team, TeamAssignment, Leave, CallPreference,
    PublicHoliday, MonthlyConfig, ConsultantOnCall, ACOnCall,
    StepdownDay, EveningOTDate, OTTemplate, ClinicTemplate,
    Grade, PreferenceType, Session,
)

def seed():
    init_db()
    db = SessionLocal()

    # Clear existing data
    for table in [
        EveningOTDate, StepdownDay, ACOnCall, ConsultantOnCall,
        CallPreference, Leave, TeamAssignment, PublicHoliday,
        MonthlyConfig, ClinicTemplate, OTTemplate, Staff, Team,
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

    # ── Senior Consultants ───────────────────────────────────────────
    consultants_data = [
        ("Andy Yeo",     Grade.SENIOR_CONSULTANT,  "Trauma"),
        ("David Chua",   Grade.SENIOR_CONSULTANT,  "Trauma"),
        ("Charles Kon",  Grade.SENIOR_CONSULTANT,  "Foot & Ankle"),
        ("James Loh",    Grade.SENIOR_CONSULTANT,  "Hip & Knee"),
        ("Kinjal Mehta", Grade.SENIOR_CONSULTANT,  "Foot & Ankle"),
        ("Kuo CL",       Grade.SENIOR_CONSULTANT,  "Shoulder & Elbow"),
        ("Raghu",        Grade.SENIOR_CONSULTANT,  "Hip & Knee"),
        ("Shree Dinesh", Grade.SENIOR_CONSULTANT,  "Spine"),
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

    # ── Consultants ──────────────────────────────────────────────────
    cons_data = [
        ("Ho Chin",      Grade.CONSULTANT,  "Trauma"),
        ("Ing How",      Grade.CONSULTANT,  "Hip & Knee"),
        ("Jonathan Gan", Grade.CONSULTANT,  "Foot & Ankle"),
        ("Justine Lee",  Grade.CONSULTANT,  "Trauma"),
        ("Siti Mastura", Grade.CONSULTANT,  "Hip & Knee"),
        ("Wei Sheng",    Grade.CONSULTANT,  "Shoulder & Elbow"),
        ("Zhihong",      Grade.CONSULTANT,  "Spine"),
    ]

    for name, grade, team_name in cons_data:
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

    # ── Registrars (SSRs — no team assignment, no clinic) ────────────
    for name in ["Grace Tan", "Omar", "Raj", "Sagar"]:
        s = Staff(name=name, grade=Grade.SENIOR_STAFF_REGISTRAR)
        db.add(s)
        db.flush()
        staff[name] = s

    # ── Senior Residents (prioritised for OT, tagged to supervisors) ──
    sr_data = [
        ("Jia Ying",  "Shoulder & Elbow", "Kuo CL"),
        ("David Mao", "Spine",            "Zhihong"),
    ]
    for name, team_name, supervisor_name in sr_data:
        s = Staff(name=name, grade=Grade.SENIOR_RESIDENT)
        db.add(s)
        db.flush()
        staff[name] = s
        db.add(TeamAssignment(
            staff_id=s.id, team_id=teams[team_name].id,
            role="mo", effective_from=date(2026, 4, 6),
            supervisor_id=staff[supervisor_name].id,
        ))

    # ── Medical Officers ─────────────────────────────────────────────
    # (team, consultant_tag) — consultant_tag links MO to supervisor
    SMO = Grade.SENIOR_MEDICAL_OFFICER
    MO = Grade.MEDICAL_OFFICER
    mo_data = [
        # Trauma
        ("Chester Tan",  SMO, "Trauma",          "Andy Yeo"),
        ("Nalaka",       SMO, "Trauma",          "David Chua"),
        ("Asif",         MO,  "Trauma",          "Ho Chin"),
        ("Joshua Wong",  MO,  "Trauma",          "Ho Chin"),
        ("Shilin",       MO,  "Trauma",          "Junren"),
        ("Nazir",        MO,  "Trauma",          "Justine Lee"),
        ("Samuel Ong",   MO,  "Trauma",          "Justine Lee"),
        # Shoulder & Elbow
        ("Feng Yi",      SMO, "Shoulder & Elbow", "Kuo CL"),
        ("Qing Hang",    MO,  "Shoulder & Elbow", "Kuo CL"),
        ("Amirzeb",      MO,  "Shoulder & Elbow", "Wei Sheng"),
        ("Chee Sian",    MO,  "Shoulder & Elbow", None),
        # Hip & Knee
        ("Kumara",       SMO, "Hip & Knee",      "Ing How"),
        ("Kevan Toh",    MO,  "Hip & Knee",      "James Loh"),
        ("Raihan",       MO,  "Hip & Knee",      "James Loh"),
        ("Sandip",       MO,  "Hip & Knee",      "James Loh"),
        ("Jamie Lim",    MO,  "Hip & Knee",      "Raghu"),
        ("Teddy Cheong", MO,  "Hip & Knee",      "Raghu"),
        ("Nuwan",        MO,  "Hip & Knee",      None),
        # Foot & Ankle
        ("Gennie Lim",   SMO, "Foot & Ankle",    "Charles Kon"),
        ("Wei Xiang",    MO,  "Foot & Ankle",    "Charles Kon"),
        ("Khoi Man",     MO,  "Foot & Ankle",    "Jonathan Gan"),
        ("Angela Lim",   MO,  "Foot & Ankle",    "Kinjal Mehta"),
        ("Brandon Lim",  MO,  "Foot & Ankle",    "Kinjal Mehta"),
        # Spine
        ("Tharindu",     SMO, "Spine",           "Dalun"),
        ("Jon Yeo",      MO,  "Spine",           "Shree Dinesh"),
        ("Thaya",        MO,  "Spine",           "Zhihong"),
        ("Wei Jie",      MO,  "Spine",           "Zhihong"),
    ]

    for name, grade, team_name, supervisor_name in mo_data:
        s = Staff(name=name, grade=grade)
        db.add(s)
        db.flush()
        staff[name] = s
        supervisor_id = staff[supervisor_name].id if supervisor_name else None
        db.add(TeamAssignment(
            staff_id=s.id, team_id=teams[team_name].id,
            role="mo", effective_from=date(2026, 4, 6),
            supervisor_id=supervisor_id,
        ))

    db.flush()

    # ── Public Holidays ──────────────────────────────────────────────
    db.add(PublicHoliday(date=date(2026, 4, 3), name="Good Friday"))

    # ── Monthly Config for April 2026 ────────────────────────────────
    config = MonthlyConfig(year=2026, month=4)
    db.add(config)
    db.flush()

    # ── Consultant On-Call Schedule ──────────────────────────────────
    # When AC is primary call holder (e.g., "Dalun/JL"), store AC as
    # consultant_id with supervising_consultant_id set.
    # When AC is secondary (in AC column only), use normal consultant_oncall.
    consultant_oncall = [
        # (day, primary, supervising_or_None)
        (1,  "Kuo CL",       None),
        (2,  "Dalun",         "James Loh"),       # AC primary: Dalun / James Loh
        (3,  "Zhihong",       None),               # Fixed: was Kuo CL
        (4,  "Kuo CL",       None),
        (5,  "Andy Yeo",     None),
        (6,  "Kinjal Mehta", None),
        (7,  "Wei Sheng",    None),
        (8,  "Kuo CL",       None),
        (9,  "Dalun",         "David Chua"),       # AC primary: Dalun / David Chua
        (10, "Ing How",      None),
        (11, "Ho Chin",      None),
        (12, "Junren",       "David Chua"),        # AC primary: Junren / David Chua
        (13, "Justine Lee",  None),
        (14, "Kinjal Mehta", None),
        (15, "Raghu",        None),
        (16, "Ing How",      None),
        (17, "Charles Kon",  None),
        (18, "Junren",       "James Loh"),         # AC primary: Junren / James Loh
        (19, "Justine Lee",  None),
        (20, "Dalun",        "David Chua"),         # AC primary: Dalun / David Chua
        (21, "Ho Chin",      None),
        (22, "Jonathan Gan", None),
        (23, "Kinjal Mehta", None),
        (24, "Raghu",        None),
        (25, "Charles Kon",  None),
        (26, "Justine Lee",  None),
        (27, "Jonathan Gan", None),
        (28, "Wei Sheng",    None),
        (29, "Raghu",        None),
        (30, "Charles Kon",  None),
    ]

    for day, primary_name, supervising_name in consultant_oncall:
        supervising_id = staff[supervising_name].id if supervising_name else None
        db.add(ConsultantOnCall(
            config_id=config.id,
            date=date(2026, 4, day),
            consultant_id=staff[primary_name].id,
            supervising_consultant_id=supervising_id,
        ))

    # ── AC On-Call Schedule (secondary role only) ────────────────────
    # Only days where AC is in the AC column (supporting the consultant).
    # Days where AC is primary (above with supervising_consultant_id) are NOT listed here.
    ac_oncall = {
        5:  "Dalun",     # Andy Yeo primary, Dalun secondary
        8:  "Junren",    # Kuo CL primary, Junren secondary
        23: "Junren",    # Kinjal Mehta primary, Junren secondary
        26: "Dalun",     # Justine Lee primary, Dalun secondary
        29: "Junren",    # Raghu primary, Junren secondary
    }

    for day, name in ac_oncall.items():
        db.add(ACOnCall(
            config_id=config.id,
            date=date(2026, 4, day),
            ac_id=staff[name].id,
        ))

    # ── Stepdown Days ────────────────────────────────────────────────
    for day in [9, 14, 28]:
        db.add(StepdownDay(config_id=config.id, date=date(2026, 4, day)))

    # ── Evening OT Dates (days with MO4/MO5) ────────────────────────
    for day in [2, 6, 9, 13, 16, 17, 20, 23, 27, 30]:
        db.add(EveningOTDate(config_id=config.id, date=date(2026, 4, day)))

    # ── Sample Leave ─────────────────────────────────────────────────
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

    # ── Omar: Monday leaves (works Tue-Fri only) ─────────────────────
    # Add as leaves so the solver naturally excludes him on Mondays
    import calendar
    for day_num in range(1, calendar.monthrange(2026, 4)[1] + 1):
        d = date(2026, 4, day_num)
        if d.weekday() == 0:  # Monday
            db.add(Leave(staff_id=staff["Omar"].id, date=d, leave_type="Off"))

    # ── Sample Call Preferences ──────────────────────────────────────
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

    # ── OT Templates (weekly recurring schedule) ───────────────────────
    ot_template_data = [
        (0, "OT3",  "Kinjal Mehta",  2, False),
        (0, "OT4",  "Ing How",       2, False),
        (0, "OT10", "Andy Yeo",      2, False),
        (1, "OT3",  "Kuo CL",        2, False),
        (1, "OT4",  "James Loh",     2, False),
        (1, "OT10", "Zhihong",       2, False),
        (2, "OT3",  "Raghu",         2, False),
        (2, "OT4",  "David Chua",    2, False),
        (2, "OT10", "Shree Dinesh",  2, False),
        (3, "OT3",  "Charles Kon",   2, False),
        (3, "OT4",  "Wei Sheng",     2, False),
        (4, "OT3",  "Jonathan Gan",  2, False),
        (4, "OT4",  "Ho Chin",       2, False),
        (4, "OT10", "Justine Lee",   2, False),
    ]

    for dow, room, cons_name, assists, is_la in ot_template_data:
        db.add(OTTemplate(
            day_of_week=dow, room=room,
            consultant_id=staff[cons_name].id,
            assistants_needed=assists, is_la=is_la,
        ))

    # ── Clinic Templates ─────────────────────────────────────────────
    # (day_of_week, session, room, clinic_type, mos_required, consultant_name_or_None)
    clinic_data = [
        # ── MONDAY ──
        (0, Session.AM, "Rm 10-13", "NC",     3, "James Loh"),
        (0, Session.PM, "Rm 10-13", "Sup",    1, "Kuo CL"),
        (0, Session.AM, "Rm 3",     "Sup",    1, "Ho Chin"),
        (0, Session.PM, "Rm 3",     "Sup",    1, None),       # Low BY (not in staff)
        (0, Session.AM, "Rm 4",     "Sup",    1, "Siti Mastura"),
        (0, Session.PM, "Rm 5",     "Sup",    1, "David Chua"),
        (0, Session.AM, "Rm 6",     "NC",     3, "Dalun"),
        (0, Session.PM, "Rm 6",     "Sup",    1, "Dalun"),
        (0, Session.AM, "Rm 8",     "Sup",    1, "Kuo CL"),
        # Monday MOPD
        (0, Session.AM, "Rm 15",    "MOPD",   1, None),
        (0, Session.AM, "Rm 16",    "MOPD",   1, None),
        (0, Session.AM, "Rm 17",    "MOPD",   1, None),
        (0, Session.AM, "Rm 18",    "MOPD",   1, None),
        (0, Session.AM, "Rm 19",    "MOPD",   1, None),
        (0, Session.PM, "Rm 15",    "MOPD",   1, None),
        (0, Session.PM, "Rm 16",    "MOPD",   1, None),
        (0, Session.PM, "Rm 17",    "MOPD",   1, None),
        (0, Session.PM, "Rm 18",    "MOPD",   1, None),
        (0, Session.PM, "Rm 19",    "MOPD",   1, None),
        # Monday CAT-A
        (0, Session.AM, "CAT-A",    "CAT-A",  1, None),

        # ── TUESDAY ──
        (1, Session.AM, "Rm 10-13", "NC",     3, "Justine Lee"),
        (1, Session.AM, "Rm 10-13b","NC",     3, "Ing How"),
        (1, Session.PM, "Rm 10-13", "Sup",    1, "Ho Chin"),
        (1, Session.AM, "Rm 3",     "NC",     3, "Junren"),
        (1, Session.AM, "Rm 6",     "NC",     3, "Jonathan Gan"),
        (1, Session.PM, "Rm 5",     "Sup",    1, "Ing How"),
        # Tuesday MOPD
        (1, Session.AM, "Rm 15",    "MOPD",   1, None),
        (1, Session.AM, "Rm 16",    "MOPD",   1, None),
        (1, Session.AM, "Rm 17",    "MOPD",   1, None),
        (1, Session.AM, "Rm 18",    "MOPD",   1, None),
        (1, Session.AM, "Rm 19",    "MOPD",   1, None),
        (1, Session.PM, "Rm 15",    "MOPD",   1, None),
        (1, Session.PM, "Rm 16",    "MOPD",   1, None),
        (1, Session.PM, "Rm 17",    "MOPD",   1, None),
        (1, Session.PM, "Rm 18",    "MOPD",   1, None),
        (1, Session.PM, "Rm 19",    "MOPD",   1, None),
        # Tuesday CAT-A
        (1, Session.AM, "CAT-A",    "CAT-A",  1, None),

        # ── WEDNESDAY ──
        (2, Session.AM, "Rm 10-13", "NC",     3, "Kinjal Mehta"),
        (2, Session.PM, "Rm 10-13", "Sup",    1, "Andy Yeo"),
        (2, Session.AM, "Rm 3",     "NC",     3, "Junren"),
        (2, Session.AM, "Rm 5",     "Sup",    1, "Wei Sheng"),
        (2, Session.PM, "Rm 5",     "Sup",    1, "Ing How"),
        (2, Session.PM, "Rm 6",     "Sup",    1, "James Loh"),
        (2, Session.PM, "Rm 8",     "Sup",    1, "Charles Kon"),
        # Wednesday MOPD
        (2, Session.AM, "Rm 15",    "MOPD",   1, None),
        (2, Session.AM, "Rm 16",    "MOPD",   1, None),
        (2, Session.AM, "Rm 17",    "MOPD",   1, None),
        (2, Session.AM, "Rm 18",    "MOPD",   1, None),
        (2, Session.AM, "Rm 19",    "MOPD",   1, None),
        (2, Session.PM, "Rm 15",    "MOPD",   1, None),
        (2, Session.PM, "Rm 16",    "MOPD",   1, None),
        (2, Session.PM, "Rm 17",    "MOPD",   1, None),
        (2, Session.PM, "Rm 18",    "MOPD",   1, None),
        (2, Session.PM, "Rm 19",    "MOPD",   1, None),
        # Wednesday CAT-A
        (2, Session.AM, "CAT-A",    "CAT-A",  1, None),

        # ── THURSDAY ──
        (3, Session.AM, "Rm 10-13", "NC",     3, "Raghu"),
        (3, Session.AM, "Rm 10-13b","NC",     3, "Jonathan Gan"),
        (3, Session.PM, "Rm 10-13", "Sup",    1, "Zhihong"),
        (3, Session.PM, "Rm 3",     "Sup",    1, "Raghu"),
        (3, Session.AM, "Rm 5",     "Sup",    1, "Shree Dinesh"),
        (3, Session.PM, "Rm 5",     "Sup",    1, "Zhihong"),
        (3, Session.AM, "Rm 8",     "NC",     3, "Charles Kon"),
        # Thursday MOPD
        (3, Session.AM, "Rm 15",    "MOPD",   1, None),
        (3, Session.AM, "Rm 16",    "MOPD",   1, None),
        (3, Session.AM, "Rm 17",    "MOPD",   1, None),
        (3, Session.AM, "Rm 18",    "MOPD",   1, None),
        (3, Session.AM, "Rm 19",    "MOPD",   1, None),
        (3, Session.PM, "Rm 15",    "MOPD",   1, None),
        (3, Session.PM, "Rm 16",    "MOPD",   1, None),
        (3, Session.PM, "Rm 17",    "MOPD",   1, None),
        (3, Session.PM, "Rm 18",    "MOPD",   1, None),
        (3, Session.PM, "Rm 19",    "MOPD",   1, None),
        # Thursday CAT-A
        (3, Session.AM, "CAT-A",    "CAT-A",  1, None),

        # ── FRIDAY ──
        (4, Session.AM, "Rm 10-13", "NC",     3, "Wei Sheng"),
        (4, Session.PM, "Rm 10-13", "NC",     3, "Charles Kon"),
        (4, Session.AM, "Rm 3",     "Hand VC",1, None),       # David Tan (visiting)
        (4, Session.PM, "Rm 3",     "Sup",    1, None),       # Low BY
        (4, Session.AM, "Rm 5",     "Sup",    1, "Zhihong"),
        (4, Session.PM, "Rm 5",     "Sup",    1, "Kinjal Mehta"),
        (4, Session.AM, "Rm 6",     "Sup",    1, "James Loh"),
        (4, Session.PM, "Rm 6",     "Sup",    1, "James Loh"),
        (4, Session.AM, "Rm 8",     "Sup",    1, "Andy Yeo"),
        (4, Session.PM, "Rm 8",     "Sup",    1, "Ing How"),
        # Friday MOPD
        (4, Session.AM, "Rm 15",    "MOPD",   1, None),
        (4, Session.AM, "Rm 16",    "MOPD",   1, None),
        (4, Session.AM, "Rm 17",    "MOPD",   1, None),
        (4, Session.AM, "Rm 18",    "MOPD",   1, None),
        (4, Session.AM, "Rm 19",    "MOPD",   1, None),
        (4, Session.PM, "Rm 15",    "MOPD",   1, None),
        (4, Session.PM, "Rm 16",    "MOPD",   1, None),
        (4, Session.PM, "Rm 17",    "MOPD",   1, None),
        (4, Session.PM, "Rm 18",    "MOPD",   1, None),
        (4, Session.PM, "Rm 19",    "MOPD",   1, None),
        # Friday CAT-A
        (4, Session.AM, "CAT-A",    "CAT-A",  1, None),
    ]

    for dow, session, room, ctype, mos, cons_name in clinic_data:
        db.add(ClinicTemplate(
            day_of_week=dow, session=session, room=room,
            clinic_type=ctype, mos_required=mos,
            consultant_id=staff[cons_name].id if cons_name else None,
        ))

    db.commit()
    db.close()

    smo_count = sum(1 for _, g, _, _ in mo_data if g == SMO)
    mo_count = sum(1 for _, g, _, _ in mo_data if g == MO)
    reg_count = 4  # Grace Tan, Omar, Raj, Sagar
    sr_count = 2   # Jia Ying, David Mao

    print("Seeded successfully!")
    print(f"  Staff: {len(staff)}")
    print(f"  Teams: {len(teams)}")
    print(f"  SMOs: {smo_count}, MOs: {mo_count}, Registrars: {reg_count}, Senior Residents: {sr_count}")
    print(f"  Consultant on-call days: {len(consultant_oncall)}")
    print(f"  AC on-call days (secondary): {len(ac_oncall)}")
    print(f"  Evening OT dates: 10")
    print(f"  Stepdown days: 3")
    print(f"  OT templates: {len(ot_template_data)}")
    print(f"  Clinic templates: {len(clinic_data)}")


if __name__ == "__main__":
    seed()
