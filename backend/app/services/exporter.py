"""
Excel export service — generates roster spreadsheets in two formats:
  1. Original: matches the CGH Ortho duty roster layout
  2. Clean: optimized for readability with per-person summaries
"""

import calendar
from datetime import date
from io import BytesIO

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

from ..models import (
    CallAssignment,
    DutyAssignment,
    Staff,
    ConsultantOnCall,
    ACOnCall,
    DutyType,
    CallTypeConfig,
    RankConfig,
)


# ── Shared styles ────────────────────────────────────────────────────────

HEADER_FONT = Font(bold=True, size=11)
TITLE_FONT = Font(bold=True, size=14)
HEADER_FILL = PatternFill("solid", fgColor="D9E1F2")
WEEKEND_FILL = PatternFill("solid", fgColor="FFF2CC")
PH_FILL = PatternFill("solid", fgColor="FCE4EC")
CLINIC_FILL = PatternFill("solid", fgColor="D1FAE5")
THIN_BORDER = Border(
    left=Side(style="thin"),
    right=Side(style="thin"),
    top=Side(style="thin"),
    bottom=Side(style="thin"),
)
CENTER = Alignment(horizontal="center", vertical="center")
WRAP = Alignment(wrap_text=True, vertical="top")


def _style_header_row(ws, row, max_col):
    for col in range(1, max_col + 1):
        cell = ws.cell(row=row, column=col)
        cell.font = HEADER_FONT
        cell.fill = HEADER_FILL
        cell.alignment = CENTER
        cell.border = THIN_BORDER


def _style_data_cell(ws, row, col, is_weekend=False, is_ph=False):
    cell = ws.cell(row=row, column=col)
    cell.border = THIN_BORDER
    if is_ph:
        cell.fill = PH_FILL
    elif is_weekend:
        cell.fill = WEEKEND_FILL


def _get_call_type_columns(db) -> list[str]:
    configs = (
        db.query(CallTypeConfig)
        .filter(CallTypeConfig.is_active.is_(True))
        .order_by(CallTypeConfig.display_order)
        .all()
    )
    return [ct.name for ct in configs]


def _get_call_eligible_rank_names(db) -> set[str]:
    ranks = db.query(RankConfig).filter(RankConfig.is_call_eligible.is_(True)).all()
    return {r.name for r in ranks}


# ── Original Format ──────────────────────────────────────────────────────


def export_original(config, db) -> BytesIO:
    wb = Workbook()
    year, month = config.year, config.month
    month_name = calendar.month_name[month]
    num_days = calendar.monthrange(year, month)[1]

    _build_call_sheet(wb, config, db, year, month, num_days, month_name)
    _build_ot_sheet(wb, config, db, year, month, num_days, month_name)
    _build_clinic_sheet(wb, config, db, year, month, num_days, month_name)

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


def _build_call_sheet(wb, config, db, year, month, num_days, month_name):
    ws = wb.active
    ws.title = "Call Roster"

    ct_columns = _get_call_type_columns(db)
    total_cols = 4 + len(ct_columns)

    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=total_cols)
    ws["A1"] = f"Department of Orthopaedic Surgery - {month_name}'{str(year)[2:]}"
    ws["A1"].font = TITLE_FONT
    ws["A1"].alignment = CENTER

    headers = ["Date", "Day", "Consultant", "AC"] + ct_columns
    for col, h in enumerate(headers, 1):
        ws.cell(row=3, column=col, value=h)
    _style_header_row(ws, 3, len(headers))

    calls = db.query(CallAssignment).filter(CallAssignment.config_id == config.id).all()
    call_map: dict[str, dict[str, str]] = {}
    for c in calls:
        ds = c.date.isoformat()
        if ds not in call_map:
            call_map[ds] = {}
        call_map[ds][c.call_type] = c.staff.name

    cons_oncall = {
        r.date.isoformat(): r.consultant.name
        for r in db.query(ConsultantOnCall)
        .filter(ConsultantOnCall.config_id == config.id)
        .all()
    }
    ac_oncall = {
        r.date.isoformat(): r.ac.name
        for r in db.query(ACOnCall).filter(ACOnCall.config_id == config.id).all()
    }

    from ..models import PublicHoliday

    ph_dates = {
        r.date
        for r in db.query(PublicHoliday).all()
        if r.date.year == year and r.date.month == month
    }

    for day_num in range(1, num_days + 1):
        d = date(year, month, day_num)
        ds = d.isoformat()
        row = day_num + 3
        is_wknd = d.weekday() >= 5
        is_ph = d in ph_dates

        day_calls = call_map.get(ds, {})
        values = [
            day_num,
            d.strftime("%a"),
            cons_oncall.get(ds, ""),
            ac_oncall.get(ds, ""),
        ] + [day_calls.get(ct, "") for ct in ct_columns]
        for col, val in enumerate(values, 1):
            ws.cell(row=row, column=col, value=val)
            _style_data_cell(ws, row, col, is_wknd, is_ph)

    for col in range(1, total_cols + 1):
        ws.column_dimensions[get_column_letter(col)].width = 14


def _build_ot_sheet(wb, config, db, year, month, num_days, month_name):
    ws = wb.create_sheet("OT Schedule")

    ws.merge_cells("A1:G1")
    ws["A1"] = f"OT Schedule - {month_name}'{str(year)[2:]}"
    ws["A1"].font = TITLE_FONT
    ws["A1"].alignment = CENTER

    headers = ["Date", "Day", "Room", "Consultant", "Assistant 1", "Assistant 2"]
    for col, h in enumerate(headers, 1):
        ws.cell(row=3, column=col, value=h)
    _style_header_row(ws, 3, len(headers))

    duties = (
        db.query(DutyAssignment)
        .filter(
            DutyAssignment.config_id == config.id,
            DutyAssignment.duty_type.in_([DutyType.OT, DutyType.EOT]),
        )
        .order_by(DutyAssignment.date, DutyAssignment.location)
        .all()
    )

    from ..models import PublicHoliday

    ph_dates = {
        r.date
        for r in db.query(PublicHoliday).all()
        if r.date.year == year and r.date.month == month
    }

    cons_names = {s.id: s.name for s in db.query(Staff).all()}

    ot_by_day: dict[str, dict[str, list[str]]] = {}
    ot_cons: dict[str, dict[str, str]] = {}
    for d in duties:
        ds = d.date.isoformat()
        room = d.location or "?"
        if ds not in ot_by_day:
            ot_by_day[ds] = {}
            ot_cons[ds] = {}
        if room not in ot_by_day[ds]:
            ot_by_day[ds][room] = []
            ot_cons[ds][room] = cons_names.get(d.consultant_id, "")
        ot_by_day[ds][room].append(d.staff.name)

    row = 4
    for day_num in range(1, num_days + 1):
        d = date(year, month, day_num)
        ds = d.isoformat()
        is_wknd = d.weekday() >= 5
        is_ph = d in ph_dates

        if ds not in ot_by_day:
            continue

        for room in sorted(ot_by_day[ds].keys()):
            names = ot_by_day[ds][room]
            values = [
                day_num,
                d.strftime("%a"),
                room,
                ot_cons[ds].get(room, ""),
                names[0] if len(names) > 0 else "",
                names[1] if len(names) > 1 else "",
            ]
            for col, val in enumerate(values, 1):
                ws.cell(row=row, column=col, value=val)
                _style_data_cell(ws, row, col, is_wknd, is_ph)
            row += 1

    for col in range(1, 7):
        ws.column_dimensions[get_column_letter(col)].width = 16


def _build_clinic_sheet(wb, config, db, year, month, num_days, month_name):
    ws = wb.create_sheet("Clinic 4E")

    ws.merge_cells("A1:H1")
    ws["A1"] = f"Clinic 4E - {month_name}'{str(year)[2:]}"
    ws["A1"].font = TITLE_FONT
    ws["A1"].alignment = CENTER

    headers = ["Date", "Day", "Session", "Type", "Room", "MO", "Consultant"]
    for col, h in enumerate(headers, 1):
        ws.cell(row=3, column=col, value=h)
    _style_header_row(ws, 3, len(headers))

    duties = (
        db.query(DutyAssignment)
        .filter(
            DutyAssignment.config_id == config.id,
            DutyAssignment.duty_type == DutyType.CLINIC,
        )
        .order_by(DutyAssignment.date, DutyAssignment.session, DutyAssignment.duty_type)
        .all()
    )

    from ..models import PublicHoliday

    ph_dates = {
        r.date
        for r in db.query(PublicHoliday).all()
        if r.date.year == year and r.date.month == month
    }

    cons_names = {s.id: s.name for s in db.query(Staff).all()}

    row = 4
    for d in duties:
        is_wknd = d.date.weekday() >= 5
        is_ph = d.date in ph_dates
        values = [
            d.date.day,
            d.date.strftime("%a"),
            d.session.value,
            d.duty_type.value,
            d.location or "",
            d.staff.name,
            cons_names.get(d.consultant_id, "") if d.consultant_id else "",
        ]
        for col, val in enumerate(values, 1):
            ws.cell(row=row, column=col, value=val)
            _style_data_cell(ws, row, col, is_wknd, is_ph)
            if d.duty_type == DutyType.CLINIC:
                ws.cell(row=row, column=col).fill = CLINIC_FILL
        row += 1

    for col in range(1, 8):
        ws.column_dimensions[get_column_letter(col)].width = 15


# ── Clean Format ─────────────────────────────────────────────────────────


def export_clean(config, db) -> BytesIO:
    wb = Workbook()
    year, month = config.year, config.month
    month_name = calendar.month_name[month]
    num_days = calendar.monthrange(year, month)[1]

    _build_daily_overview(wb, config, db, year, month, num_days, month_name)
    _build_person_summary(wb, config, db, year, month, num_days, month_name)
    _build_fairness_sheet(wb, config, db, year, month, month_name)

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


def _build_daily_overview(wb, config, db, year, month, num_days, month_name):
    ws = wb.active
    ws.title = "Daily Overview"

    ct_columns = _get_call_type_columns(db)
    fixed_cols = ["Date", "Day", "Cons On-Call", "AC"]
    extra_cols = ["OT Staff", "Clinic"]
    all_headers = fixed_cols + ct_columns + extra_cols
    total_cols = len(all_headers)

    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=total_cols)
    ws["A1"] = f"Roster Overview - {month_name} {year}"
    ws["A1"].font = TITLE_FONT
    ws["A1"].alignment = CENTER

    for col, h in enumerate(all_headers, 1):
        ws.cell(row=3, column=col, value=h)
    _style_header_row(ws, 3, total_cols)

    calls = db.query(CallAssignment).filter(CallAssignment.config_id == config.id).all()
    call_map: dict[str, dict[str, str]] = {}
    for c in calls:
        ds = c.date.isoformat()
        if ds not in call_map:
            call_map[ds] = {}
        call_map[ds][c.call_type] = c.staff.name

    duties = (
        db.query(DutyAssignment).filter(DutyAssignment.config_id == config.id).all()
    )
    ot_map: dict[str, list[str]] = {}
    clinic_map: dict[str, list[str]] = {}
    for d in duties:
        ds = d.date.isoformat()
        if d.duty_type == DutyType.OT:
            ot_map.setdefault(ds, []).append(d.staff.name)
        elif d.duty_type == DutyType.CLINIC:
            clinic_map.setdefault(ds, []).append(d.staff.name)

    cons_oncall = {
        r.date.isoformat(): r.consultant.name
        for r in db.query(ConsultantOnCall)
        .filter(ConsultantOnCall.config_id == config.id)
        .all()
    }
    ac_oncall = {
        r.date.isoformat(): r.ac.name
        for r in db.query(ACOnCall).filter(ACOnCall.config_id == config.id).all()
    }

    from ..models import PublicHoliday

    ph_dates = {
        r.date
        for r in db.query(PublicHoliday).all()
        if r.date.year == year and r.date.month == month
    }

    for day_num in range(1, num_days + 1):
        d = date(year, month, day_num)
        ds = d.isoformat()
        row = day_num + 3
        is_wknd = d.weekday() >= 5
        is_ph = d in ph_dates
        day_calls = call_map.get(ds, {})

        values = (
            [
                day_num,
                d.strftime("%a") + (" (PH)" if is_ph else ""),
                cons_oncall.get(ds, ""),
                ac_oncall.get(ds, ""),
            ]
            + [day_calls.get(ct, "") for ct in ct_columns]
            + [
                ", ".join(ot_map.get(ds, [])),
                ", ".join(clinic_map.get(ds, [])),
            ]
        )
        for col, val in enumerate(values, 1):
            cell = ws.cell(row=row, column=col, value=val)
            _style_data_cell(ws, row, col, is_wknd, is_ph)
            if col > len(fixed_cols) + len(ct_columns):
                cell.alignment = WRAP

    for col in range(1, total_cols + 1):
        ws.column_dimensions[get_column_letter(col)].width = 14
    ws.column_dimensions["A"].width = 5
    ws.column_dimensions["B"].width = 8


def _build_person_summary(wb, config, db, year, month, num_days, month_name):
    ws = wb.create_sheet("Per-Person Summary")

    ws.merge_cells("A1:H1")
    ws["A1"] = f"Per-Person Summary - {month_name} {year}"
    ws["A1"].font = TITLE_FONT

    headers = [
        "Name",
        "Rank",
        "Team",
        "Call Dates",
        "OT Dates",
        "Clinic Dates",
        "Admin Dates",
    ]
    for col, h in enumerate(headers, 1):
        ws.cell(row=3, column=col, value=h)
    _style_header_row(ws, 3, len(headers))

    from ..models import TeamAssignment, Team

    call_eligible = _get_call_eligible_rank_names(db)
    mo_staff = (
        db.query(Staff)
        .filter(Staff.active.is_(True), Staff.rank.in_(list(call_eligible)))
        .order_by(Staff.name)
        .all()
    )

    calls = db.query(CallAssignment).filter(CallAssignment.config_id == config.id).all()
    call_dates: dict[int, list[str]] = {}
    for c in calls:
        call_dates.setdefault(c.staff_id, []).append(f"{c.date.day}({c.call_type})")

    duties = (
        db.query(DutyAssignment).filter(DutyAssignment.config_id == config.id).all()
    )
    # Group duty types into summary buckets so new types
    # (EOT, EOT MO, Ward MO, Special) aren't silently dropped.
    _BUCKET = {
        DutyType.OT: "OT",
        DutyType.EOT: "OT",
        DutyType.EOT_MO: "OT",
        DutyType.CLINIC: "Clinic",
        DutyType.ADMIN: "Admin",
        DutyType.WARD_MO: "Admin",
        DutyType.SPECIAL: "Admin",
    }
    duty_dates: dict[int, dict[str, list[int]]] = {}
    for d in duties:
        pid = d.staff_id
        if pid not in duty_dates:
            duty_dates[pid] = {"OT": [], "Clinic": [], "Admin": []}
        bucket = _BUCKET.get(d.duty_type)
        if bucket:
            duty_dates[pid][bucket].append(d.date.day)

    row = 4
    for s in mo_staff:
        ta = (
            db.query(TeamAssignment)
            .filter(
                TeamAssignment.staff_id == s.id,
            )
            .order_by(TeamAssignment.effective_from.desc())
            .first()
        )
        team_name = ""
        if ta:
            team = db.query(Team).get(ta.team_id)
            team_name = team.name if team else ""

        cd = sorted(call_dates.get(s.id, []), key=lambda x: int(x.split("(")[0]))
        dd = duty_dates.get(s.id, {"OT": [], "Clinic": [], "Admin": []})

        values = [
            s.name,
            s.rank,
            team_name,
            ", ".join(cd),
            ", ".join(str(d) for d in sorted(set(dd["OT"]))),
            ", ".join(str(d) for d in sorted(set(dd["Clinic"]))),
            ", ".join(str(d) for d in sorted(set(dd["Admin"]))),
        ]
        for col, val in enumerate(values, 1):
            cell = ws.cell(row=row, column=col, value=val)
            cell.border = THIN_BORDER
            cell.alignment = WRAP
        row += 1

    widths = [16, 18, 16, 30, 20, 20, 20]
    for col, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(col)].width = w


def _build_fairness_sheet(wb, config, db, year, month, month_name):
    ws = wb.create_sheet("Fairness")

    ct_columns = _get_call_type_columns(db)
    headers = (
        ["Name", "Total Calls"]
        + ct_columns
        + ["Weekend/PH", "OT Days", "Clinic", "Admin"]
    )
    total_cols = len(headers)

    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=total_cols)
    ws["A1"] = f"Fairness Statistics - {month_name} {year}"
    ws["A1"].font = TITLE_FONT

    for col, h in enumerate(headers, 1):
        ws.cell(row=3, column=col, value=h)
    _style_header_row(ws, 3, total_cols)

    from collections import defaultdict

    call_eligible = _get_call_eligible_rank_names(db)
    mo_staff = (
        db.query(Staff)
        .filter(Staff.active.is_(True), Staff.rank.in_(list(call_eligible)))
        .order_by(Staff.name)
        .all()
    )

    call_stats: dict[int, dict] = defaultdict(
        lambda: {
            "total": 0,
            "weekend": 0,
            **{ct: 0 for ct in ct_columns},
        }
    )
    for c in (
        db.query(CallAssignment).filter(CallAssignment.config_id == config.id).all()
    ):
        call_stats[c.staff_id]["total"] += 1
        if c.call_type in call_stats[c.staff_id]:
            call_stats[c.staff_id][c.call_type] += 1
        if c.date.weekday() >= 5:
            call_stats[c.staff_id]["weekend"] += 1

    duty_stats: dict[int, dict] = defaultdict(
        lambda: {
            "ot": 0,
            "clinic": 0,
            "admin": 0,
        }
    )
    # Bucket all DutyType variants so newer types (EOT, EOT MO, Ward MO,
    # Special) contribute to the fairness counters instead of being silently dropped.
    _STAT_BUCKET = {
        DutyType.OT: "ot",
        DutyType.EOT: "ot",
        DutyType.EOT_MO: "ot",
        DutyType.CLINIC: "clinic",
        DutyType.ADMIN: "admin",
        DutyType.WARD_MO: "admin",
        DutyType.SPECIAL: "admin",
    }
    for d in (
        db.query(DutyAssignment).filter(DutyAssignment.config_id == config.id).all()
    ):
        bucket = _STAT_BUCKET.get(d.duty_type)
        if bucket:
            duty_stats[d.staff_id][bucket] += 1

    row = 4
    for s in mo_staff:
        cs = call_stats[s.id]
        ds = duty_stats[s.id]
        if cs["total"] == 0 and ds["ot"] == 0:
            continue
        values = (
            [
                s.name,
                cs["total"],
            ]
            + [cs.get(ct, 0) for ct in ct_columns]
            + [
                cs["weekend"],
                ds["ot"],
                ds["clinic"],
                ds["admin"],
            ]
        )
        for col, val in enumerate(values, 1):
            ws.cell(row=row, column=col, value=val)
            ws.cell(row=row, column=col).border = THIN_BORDER
            ws.cell(row=row, column=col).alignment = CENTER
        row += 1

    for col in range(1, total_cols + 1):
        ws.column_dimensions[get_column_letter(col)].width = 12
    ws.column_dimensions["A"].width = 16
