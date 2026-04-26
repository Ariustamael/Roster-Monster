import calendar
from collections import defaultdict
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..models import (
    MonthlyConfig,
    Staff,
    TeamAssignment,
    Leave,
    CallPreference,
    CallAssignment,
    DutyAssignment,
    DutyType,
    PublicHoliday,
    PreferenceType,
    ResourceTemplate,
    CallTypeConfig,
    RankConfig,
)
from ..schemas import (
    RosterResponse,
    DayRoster,
    CallAssignmentOut,
    ManualOverrideCreate,
    CallSwapRequest,
    CallSwapResponse,
    CallAssignmentRestore,
)
from ..services.solver import (
    SolverInput,
    DayConfig,
    PersonInfo,
    CallTypeInfo,
    solve,
    compute_fairness_stats,
)
from ..services.exporter import export_full, export_clean
from ..services.validators import get_post_call_type

router = APIRouter(prefix="/api/roster", tags=["roster"])


async def _build_call_rank_groups(db: AsyncSession) -> dict[str, str]:
    """Return a map of call-type name â†’ tier label (Consultant / Registrar / rank name)."""
    from sqlalchemy.orm import selectinload as _si
    from ..models import CallTypeEligibleRank as _CTER

    configs = (
        (
            await db.execute(
                select(CallTypeConfig)
                .filter(CallTypeConfig.is_active.is_(True))
                .options(_si(CallTypeConfig.eligible_ranks).selectinload(_CTER.rank))
            )
        )
        .scalars()
        .all()
    )
    groups: dict[str, str] = {}
    for ct in configs:
        ranks = [j.rank for j in ct.eligible_ranks if j.rank]
        if not ranks:
            groups[ct.name] = ""
        elif any(r.is_consultant_tier for r in ranks):
            groups[ct.name] = "Consultant"
        elif any(r.is_registrar_tier for r in ranks):
            groups[ct.name] = "Registrar"
        else:
            top = min(ranks, key=lambda r: r.display_order)
            groups[ct.name] = top.name
    return groups


def _tier_order(group: str) -> int:
    return 0 if group == "Consultant" else 1 if group == "Registrar" else 2


def _sorted_ct_columns(call_type_configs, rank_groups: dict[str, str]) -> list[str]:
    return [
        ct.name
        for ct in sorted(
            call_type_configs,
            key=lambda c: (_tier_order(rank_groups.get(c.name, "")), c.display_order),
        )
    ]


async def _load_call_type_infos(db: AsyncSession) -> list[CallTypeInfo]:
    configs = (
        (
            await db.execute(
                select(CallTypeConfig)
                .filter(CallTypeConfig.is_active.is_(True))
                .options(selectinload(CallTypeConfig.eligible_ranks))
                .order_by(CallTypeConfig.display_order)
            )
        )
        .scalars()
        .all()
    )
    # Build id â†’ name map for resolving mutually_exclusive_with (stored as CSV of ids)
    all_cts = (await db.execute(select(CallTypeConfig))).scalars().all()
    name_by_id = {c.id: c.name for c in all_cts}
    result = []
    for ct in configs:
        rank_ids = [er.rank_id for er in ct.eligible_ranks]
        rank_names = set()
        if rank_ids:
            ranks = (
                (
                    await db.execute(
                        select(RankConfig).filter(RankConfig.id.in_(rank_ids))
                    )
                )
                .scalars()
                .all()
            )
            rank_names = {r.name for r in ranks}
        mutex_names: set[str] = set()
        if ct.mutually_exclusive_with:
            for tok in ct.mutually_exclusive_with.split(","):
                tok = tok.strip()
                if tok.isdigit():
                    n = name_by_id.get(int(tok))
                    if n:
                        mutex_names.add(n)
        result.append(
            CallTypeInfo(
                name=ct.name,
                display_order=ct.display_order,
                is_overnight=ct.is_overnight,
                post_call_type=ct.post_call_type,
                max_consecutive_days=ct.max_consecutive_days,
                min_consecutive_days=ct.min_consecutive_days
                if ct.min_consecutive_days is not None
                else 1,
                min_gap_days=ct.min_gap_days,
                switch_window_days=ct.switch_window_days
                if ct.switch_window_days is not None
                else 5,
                difficulty_points=ct.difficulty_points,
                counts_towards_fairness=ct.counts_towards_fairness,
                applicable_days=ct.applicable_days,
                eligible_rank_names=rank_names,
                required_conditions=ct.required_conditions or "",
                is_night_float=ct.is_night_float or False,
                night_float_run=ct.night_float_run or "",
                uses_consultant_affinity=ct.uses_consultant_affinity or False,
                is_duty_only=ct.is_duty_only or False,
                mutually_exclusive_names=mutex_names,
            )
        )
    # Symmetrize: if A lists B but B doesn't list A, propagate the constraint
    info_by_name = {info.name: info for info in result}
    for info in result:
        for other_name in list(info.mutually_exclusive_names):
            other = info_by_name.get(other_name)
            if other and info.name not in other.mutually_exclusive_names:
                other.mutually_exclusive_names.add(info.name)
    return result


async def _get_call_eligible_ranks(db: AsyncSession) -> set[str]:
    ranks = (
        (
            await db.execute(
                select(RankConfig).filter(RankConfig.is_call_eligible.is_(True))
            )
        )
        .scalars()
        .all()
    )
    return {r.name for r in ranks}


async def _get_duty_eligible_ranks(db: AsyncSession) -> set[str]:
    ranks = (
        (
            await db.execute(
                select(RankConfig).filter(RankConfig.is_duty_eligible.is_(True))
            )
        )
        .scalars()
        .all()
    )
    return {r.name for r in ranks}


async def _build_solver_input(config: MonthlyConfig, db: AsyncSession) -> SolverInput:
    year, month = config.year, config.month
    num_days = calendar.monthrange(year, month)[1]

    ph_dates = {
        r.date
        for r in (await db.execute(select(PublicHoliday))).scalars().all()
        if r.date.year == year and r.date.month == month
    }

    stepdown = {r.date for r in config.stepdown_days}
    ext_ot = {r.date for r in config.ext_ot_dates}

    consultant_oncall_map: dict[date, int] = {}
    for r in config.consultant_oncalls:
        consultant_oncall_map[r.date] = r.consultant_id

    consultant_team_map: dict[int, int] = {}
    for ta in (
        (
            await db.execute(
                select(TeamAssignment).filter(TeamAssignment.role == "consultant")
            )
        )
        .scalars()
        .all()
    ):
        consultant_team_map[ta.staff_id] = ta.team_id

    ac_oncall_map: dict[date, int] = {}
    for r in config.ac_oncalls:
        ac_oncall_map[r.date] = r.ac_id

    days: list[DayConfig] = []
    for day_num in range(1, num_days + 1):
        d = date(year, month, day_num)
        is_wknd = d.weekday() >= 5
        is_ph = d in ph_dates
        cons_id = consultant_oncall_map.get(d)
        days.append(
            DayConfig(
                d=d,
                is_weekend=is_wknd,
                is_ph=is_ph,
                is_stepdown=d in stepdown,
                has_ext_ot=d in ext_ot,
                consultant_oncall_id=cons_id,
                consultant_oncall_team_id=consultant_team_map.get(cons_id)
                if cons_id
                else None,
                ac_oncall_id=ac_oncall_map.get(d),
            )
        )

    call_eligible_ranks = await _get_call_eligible_ranks(db)
    mo_staff = (
        (
            await db.execute(
                select(Staff).filter(
                    Staff.active.is_(True),
                    Staff.rank.in_(list(call_eligible_ranks)),
                    # Exclude staff flagged as unable to take call
                    (Staff.can_do_call.is_(True)) | (Staff.can_do_call.is_(None)),
                )
            )
        )
        .scalars()
        .all()
    )

    mo_pool: list[PersonInfo] = []
    for s in mo_staff:
        ta = (
            (
                await db.execute(
                    select(TeamAssignment)
                    .filter(
                        TeamAssignment.staff_id == s.id,
                        TeamAssignment.role == "mo",
                        TeamAssignment.effective_from <= date(year, month, num_days),
                    )
                    .order_by(TeamAssignment.effective_from.desc())
                )
            )
            .scalars()
            .first()
        )
        mo_pool.append(
            PersonInfo(
                id=s.id,
                name=s.name,
                rank=s.rank,
                team_id=ta.team_id if ta else None,
                supervisor_id=ta.supervisor_id if ta else None,
            )
        )

    leave_dates: dict[int, set[date]] = defaultdict(set)
    for lv in (
        (
            await db.execute(
                select(Leave).filter(
                    Leave.date >= date(year, month, 1),
                    Leave.date <= date(year, month, num_days),
                )
            )
        )
        .scalars()
        .all()
    ):
        leave_dates[lv.staff_id].add(lv.date)

    block_dates: dict[int, set[date]] = defaultdict(set)
    request_dates: dict[int, set[date]] = defaultdict(set)
    for cp in (
        (
            await db.execute(
                select(CallPreference).filter(
                    CallPreference.date >= date(year, month, 1),
                    CallPreference.date <= date(year, month, num_days),
                )
            )
        )
        .scalars()
        .all()
    ):
        if cp.preference_type == PreferenceType.BLOCK:
            block_dates[cp.staff_id].add(cp.date)
        else:
            request_dates[cp.staff_id].add(cp.date)

    prior_assignments: dict[date, dict[int, str]] = {}
    prev_month = month - 1
    prev_year = year
    if prev_month == 0:
        prev_month = 12
        prev_year = year - 1
    prev_config = (
        await db.execute(
            select(MonthlyConfig).filter(
                MonthlyConfig.year == prev_year, MonthlyConfig.month == prev_month
            )
        )
    ).scalar_one_or_none()
    if prev_config:
        prev_num_days = calendar.monthrange(prev_year, prev_month)[1]
        lookback_start = date(prev_year, prev_month, max(1, prev_num_days - 6))
        prev_calls = (
            (
                await db.execute(
                    select(CallAssignment).filter(
                        CallAssignment.config_id == prev_config.id,
                        CallAssignment.date >= lookback_start,
                    )
                )
            )
            .scalars()
            .all()
        )
        for c in prev_calls:
            if c.date not in prior_assignments:
                prior_assignments[c.date] = {}
            prior_assignments[c.date][c.staff_id] = c.call_type

    call_type_configs = await _load_call_type_infos(db)

    manual_overrides: dict[date, dict[str, int]] = {}
    manual_rows = (
        (
            await db.execute(
                select(CallAssignment).filter(
                    CallAssignment.config_id == config.id,
                    CallAssignment.is_manual_override.is_(True),
                )
            )
        )
        .scalars()
        .all()
    )
    for r in manual_rows:
        manual_overrides.setdefault(r.date, {})[r.call_type] = r.staff_id

    return SolverInput(
        year=year,
        month=month,
        days=days,
        mo_pool=mo_pool,
        leave_dates=dict(leave_dates),
        block_dates=dict(block_dates),
        request_dates=dict(request_dates),
        prior_assignments=prior_assignments,
        call_type_configs=call_type_configs,
        manual_overrides=manual_overrides,
    )


@router.post("/{config_id}/generate", response_model=RosterResponse)
async def generate_roster(config_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(MonthlyConfig)
        .filter(MonthlyConfig.id == config_id)
        .options(
            selectinload(MonthlyConfig.consultant_oncalls),
            selectinload(MonthlyConfig.ac_oncalls),
            selectinload(MonthlyConfig.stepdown_days),
            selectinload(MonthlyConfig.ext_ot_dates),
            selectinload(MonthlyConfig.call_assignments),
        )
    )
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(404, "Config not found")

    inp = await _build_solver_input(config, db)
    assignments, violations = solve(inp)

    try:
        await db.execute(
            delete(CallAssignment).where(
                CallAssignment.config_id == config_id,
                CallAssignment.is_manual_override.is_(False),
            )
        )

        manual_overrides = {
            (r.date, r.call_type)
            for r in (
                await db.execute(
                    select(CallAssignment).filter(
                        CallAssignment.config_id == config_id,
                        CallAssignment.is_manual_override.is_(True),
                    )
                )
            )
            .scalars()
            .all()
        }

        pid_to_name = {p.id: p.name for p in inp.mo_pool}

        for d in sorted(assignments.keys()):
            for pid, ctype in assignments[d].items():
                if pid == -1:
                    continue
                if (d, ctype) in manual_overrides:
                    continue
                db.add(
                    CallAssignment(
                        config_id=config_id,
                        date=d,
                        staff_id=pid,
                        call_type=ctype,
                        is_manual_override=False,
                    )
                )
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(
            status_code=500, detail="Roster generation failed; no changes were saved."
        )

    ph_dates = {
        r.date
        for r in (await db.execute(select(PublicHoliday))).scalars().all()
        if r.date.year == config.year and r.date.month == config.month
    }

    all_staff_names = {
        s.id: s.name for s in (await db.execute(select(Staff))).scalars().all()
    }
    cons_oncall_rows = {r.date: r for r in config.consultant_oncalls}

    stepdown_dates = {r.date for r in config.stepdown_days}
    rank_groups = await _build_call_rank_groups(db)
    ct_columns = _sorted_ct_columns(inp.call_type_configs, rank_groups)

    manual_rows = (
        (
            await db.execute(
                select(CallAssignment).filter(
                    CallAssignment.config_id == config_id,
                    CallAssignment.is_manual_override.is_(True),
                )
            )
        )
        .scalars()
        .all()
    )
    manual_slots: dict[date, dict[str, str]] = defaultdict(dict)
    for r in manual_rows:
        manual_slots[r.date][r.call_type] = all_staff_names.get(
            r.staff_id, f"ID:{r.staff_id}"
        )

    day_rosters: list[DayRoster] = []
    for day_cfg in inp.days:
        d = day_cfg.d
        day_map = assignments.get(d, {})

        call_slots: dict[str, str | None] = {}
        for pid, ctype in day_map.items():
            if pid != -1:
                call_slots[ctype] = pid_to_name.get(pid, f"ID:{pid}")
        for ctype, name in manual_slots.get(d, {}).items():
            call_slots[ctype] = name

        cons_id = day_cfg.consultant_oncall_id
        ac_id = day_cfg.ac_oncall_id

        cons_row = cons_oncall_rows.get(d)
        if cons_row and cons_row.supervising_consultant_id:
            cons_display = f"{all_staff_names.get(cons_id, '')} / {all_staff_names.get(cons_row.supervising_consultant_id, '')}"
            ac_display = None
        else:
            cons_display = all_staff_names.get(cons_id) if cons_id else None
            ac_display = all_staff_names.get(ac_id) if ac_id else None

        day_rosters.append(
            DayRoster(
                date=d,
                day_name=d.strftime("%a"),
                is_weekend=day_cfg.is_weekend,
                is_ph=d in ph_dates,
                is_stepdown=day_cfg.is_stepdown,
                consultant_oncall=cons_display,
                ac_oncall=ac_display,
                call_slots=call_slots,
            )
        )

    fairness = compute_fairness_stats(
        assignments, inp.mo_pool, stepdown_dates, inp.call_type_configs
    )

    return RosterResponse(
        year=config.year,
        month=config.month,
        days=day_rosters,
        violations=violations,
        fairness=fairness,
        call_type_columns=ct_columns,
        call_type_rank_groups=rank_groups,
    )


@router.get("/{config_id}/view", response_model=RosterResponse)
async def view_roster(config_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(MonthlyConfig)
        .filter(MonthlyConfig.id == config_id)
        .options(
            selectinload(MonthlyConfig.consultant_oncalls),
            selectinload(MonthlyConfig.ac_oncalls),
            selectinload(MonthlyConfig.stepdown_days),
            selectinload(MonthlyConfig.ext_ot_dates),
            selectinload(MonthlyConfig.call_assignments),
        )
    )
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(404, "Config not found")

    call_rows = (
        (
            await db.execute(
                select(CallAssignment).filter(CallAssignment.config_id == config_id)
            )
        )
        .scalars()
        .all()
    )
    if not call_rows:
        raise HTTPException(404, "No roster generated yet")

    year, month = config.year, config.month
    num_days = calendar.monthrange(year, month)[1]

    all_staff_names = {
        s.id: s.name for s in (await db.execute(select(Staff))).scalars().all()
    }
    ph_dates = {
        r.date
        for r in (await db.execute(select(PublicHoliday))).scalars().all()
        if r.date.year == year and r.date.month == month
    }
    cons_oncall_rows = {r.date: r for r in config.consultant_oncalls}
    stepdown_dates = {r.date for r in config.stepdown_days}

    consultant_oncall_map: dict[date, int] = {}
    for r in config.consultant_oncalls:
        consultant_oncall_map[r.date] = r.consultant_id
    ac_oncall_map: dict[date, int] = {}
    for r in config.ac_oncalls:
        ac_oncall_map[r.date] = r.ac_id

    assignments_by_date: dict[date, dict[str, str]] = defaultdict(dict)
    for r in call_rows:
        assignments_by_date[r.date][r.call_type] = all_staff_names.get(
            r.staff_id, f"ID:{r.staff_id}"
        )

    call_type_configs = await _load_call_type_infos(db)
    rank_groups = await _build_call_rank_groups(db)
    ct_columns = _sorted_ct_columns(call_type_configs, rank_groups)

    day_rosters: list[DayRoster] = []
    for day_num in range(1, num_days + 1):
        d = date(year, month, day_num)
        is_wknd = d.weekday() >= 5
        is_ph = d in ph_dates

        call_slots = dict(assignments_by_date.get(d, {}))
        cons_id = consultant_oncall_map.get(d)
        ac_id = ac_oncall_map.get(d)

        cons_row = cons_oncall_rows.get(d)
        if cons_row and cons_row.supervising_consultant_id:
            cons_display = f"{all_staff_names.get(cons_id, '')} / {all_staff_names.get(cons_row.supervising_consultant_id, '')}"
            ac_display = None
        else:
            cons_display = all_staff_names.get(cons_id) if cons_id else None
            ac_display = all_staff_names.get(ac_id) if ac_id else None

        day_rosters.append(
            DayRoster(
                date=d,
                day_name=d.strftime("%a"),
                is_weekend=is_wknd,
                is_ph=is_ph,
                is_stepdown=d in stepdown_dates,
                consultant_oncall=cons_display,
                ac_oncall=ac_display,
                call_slots=call_slots,
            )
        )

    # Backfill Ward MO / EOT MO from duty assignments (if duties have been generated)
    duty_rows = (
        (
            await db.execute(
                select(DutyAssignment).filter(
                    DutyAssignment.config_id == config_id,
                    DutyAssignment.duty_type.in_([DutyType.WARD_MO, DutyType.EOT_MO]),
                )
            )
        )
        .scalars()
        .all()
    )
    ward_by_date: dict[date, list[str]] = defaultdict(list)
    eot_by_date: dict[date, list[str]] = defaultdict(list)
    for r in duty_rows:
        name = all_staff_names.get(r.staff_id, f"ID:{r.staff_id}")
        if r.duty_type == DutyType.WARD_MO:
            ward_by_date[r.date].append(name)
        else:
            eot_by_date[r.date].append(name)
    for dr in day_rosters:
        dr.ward_mo = ward_by_date.get(dr.date, [])
        dr.eot_mo = eot_by_date.get(dr.date, [])

    call_eligible_ranks = await _get_call_eligible_ranks(db)
    mo_pool_staff = (
        (
            await db.execute(
                select(Staff).filter(
                    Staff.active.is_(True),
                    Staff.rank.in_(list(call_eligible_ranks)),
                    # Exclude staff flagged as unable to take call
                    (Staff.can_do_call.is_(True)) | (Staff.can_do_call.is_(None)),
                )
            )
        )
        .scalars()
        .all()
    )
    mo_pool_persons = [
        PersonInfo(id=s.id, name=s.name, rank=s.rank) for s in mo_pool_staff
    ]

    call_map: dict[date, dict[int, str]] = defaultdict(dict)
    for r in call_rows:
        call_map[r.date][r.staff_id] = r.call_type

    fairness = compute_fairness_stats(
        dict(call_map), mo_pool_persons, stepdown_dates, call_type_configs
    )

    return RosterResponse(
        year=year,
        month=month,
        days=day_rosters,
        violations=[],
        fairness=fairness,
        call_type_columns=ct_columns,
        call_type_rank_groups=rank_groups,
    )


@router.get("/{config_id}/export")
async def export_roster(
    config_id: int,
    format: str = Query("full", pattern="^(full|clean)$"),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(MonthlyConfig)
        .filter(MonthlyConfig.id == config_id)
        .options(
            selectinload(MonthlyConfig.consultant_oncalls),
            selectinload(MonthlyConfig.ac_oncalls),
            selectinload(MonthlyConfig.stepdown_days),
            selectinload(MonthlyConfig.ext_ot_dates),
            selectinload(MonthlyConfig.call_assignments),
        )
    )
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(404, "Config not found")

    month_name = calendar.month_name[config.month]
    if format == "clean":
        buf = await export_clean(config, db)
        filename = f"Roster_Clean_{month_name}_{config.year}.xlsx"
    else:
        buf = await export_full(config, db)
        filename = f"Roster_Full_{month_name}_{config.year}.xlsx"

    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{config_id}/resources")
async def get_resources(config_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(MonthlyConfig)
        .filter(MonthlyConfig.id == config_id)
        .options(
            selectinload(MonthlyConfig.consultant_oncalls),
            selectinload(MonthlyConfig.ac_oncalls),
            selectinload(MonthlyConfig.stepdown_days),
            selectinload(MonthlyConfig.ext_ot_dates),
            selectinload(MonthlyConfig.call_assignments),
        )
    )
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(404, "Config not found")

    year, month = config.year, config.month
    num_days = calendar.monthrange(year, month)[1]

    all_templates = (await db.execute(select(ResourceTemplate))).scalars().all()
    ot_templates = [t for t in all_templates if t.resource_type == "ot"]
    clinic_templates = [t for t in all_templates if t.resource_type == "clinic"]

    ph_dates = {
        r.date
        for r in (await db.execute(select(PublicHoliday))).scalars().all()
        if r.date.year == year and r.date.month == month
    }
    duty_eligible_ranks = await _get_duty_eligible_ranks(db)
    duty_staff = (
        (
            await db.execute(
                select(Staff).filter(
                    Staff.active.is_(True), Staff.rank.in_(list(duty_eligible_ranks))
                )
            )
        )
        .scalars()
        .all()
    )
    total_mos = len(duty_staff)
    duty_staff_ids = {s.id for s in duty_staff}

    call_type_configs = await _load_call_type_infos(db)

    leave_counts: dict[str, int] = defaultdict(int)
    for lv in (
        (
            await db.execute(
                select(Leave).filter(
                    Leave.date >= date(year, month, 1),
                    Leave.date <= date(year, month, num_days),
                )
            )
        )
        .scalars()
        .all()
    ):
        if lv.staff_id in duty_staff_ids:
            leave_counts[lv.date.isoformat()] += 1

    call_assignments = (
        (
            await db.execute(
                select(CallAssignment).filter(CallAssignment.config_id == config_id)
            )
        )
        .scalars()
        .all()
    )
    oncall_counts: dict[str, int] = defaultdict(int)
    postcall_dates: set[str] = set()

    ct_config_dict = {
        ct.name: {"is_overnight": ct.is_overnight, "post_call_type": ct.post_call_type}
        for ct in call_type_configs
    }

    for ca in call_assignments:
        oncall_counts[ca.date.isoformat()] += 1
        pct = get_post_call_type(ca.call_type, ct_config_dict)
        if pct in ("8am", "12pm", "5pm"):
            next_day = ca.date + timedelta(days=1)
            postcall_dates.add(next_day.isoformat())

    days = []
    for day_num in range(1, num_days + 1):
        d = date(year, month, day_num)
        ds = d.isoformat()
        dow = d.weekday()
        is_wknd = dow >= 5
        is_ph = d in ph_dates

        ot_rooms = 0
        ot_assistants = 0
        clinic_slots = 0
        if not is_wknd and not is_ph:
            for ot in ot_templates:
                if ot.day_of_week == dow:
                    ot_rooms += 1
                    ot_assistants += ot.staff_required
            for cl in clinic_templates:
                if cl.day_of_week == dow:
                    clinic_slots += cl.staff_required or 0

        # Count required call slots from config
        day_label = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][dow]
        call_slots = 0
        for ct in call_type_configs:
            applicable = [ad.strip() for ad in ct.applicable_days.split(",")]
            if day_label in applicable:
                call_slots += 1
            elif "PH" in applicable and is_ph:
                call_slots += 1

        on_leave = leave_counts.get(ds, 0)
        on_call = oncall_counts.get(ds, 0)
        post_call = 1 if ds in postcall_dates else 0
        available = max(total_mos - on_leave - on_call - post_call, 0)
        duty_slots = ot_assistants + clinic_slots if not is_wknd and not is_ph else 0
        # Each available MO covers 2 session-slots (AM + PM), so capacity is in slots.
        capacity_slots = available * 2 if not is_wknd and not is_ph else 0
        balance_slots = (
            capacity_slots - duty_slots if not is_wknd and not is_ph else None
        )

        days.append(
            {
                "date": ds,
                "day_name": d.strftime("%a"),
                "is_weekend": is_wknd,
                "is_ph": is_ph,
                "ot_rooms": ot_rooms,
                "ot_assistants_needed": ot_assistants,
                "clinic_slots": clinic_slots,
                "call_slots": call_slots,
                "total_mos": total_mos,
                "on_leave": on_leave,
                "on_call": on_call,
                "post_call": post_call,
                "available": available,
                "duty_slots": duty_slots,
                "capacity_slots": capacity_slots,
                "balance_slots": balance_slots,
            }
        )

    return {"year": year, "month": month, "days": days}


@router.put("/{config_id}/override", response_model=CallAssignmentOut)
async def set_override(
    config_id: int, payload: ManualOverrideCreate, db: AsyncSession = Depends(get_db)
):
    config = await db.get(MonthlyConfig, config_id)
    if not config:
        raise HTTPException(404, "Config not found")
    staff = await db.get(Staff, payload.staff_id)
    if not staff:
        raise HTTPException(404, "Staff not found")

    existing = (
        await db.execute(
            select(CallAssignment).filter(
                CallAssignment.config_id == config_id,
                CallAssignment.date == payload.date,
                CallAssignment.call_type == payload.call_type,
            )
        )
    ).scalar_one_or_none()
    if existing:
        existing.staff_id = payload.staff_id
        existing.is_manual_override = True
    else:
        existing = CallAssignment(
            config_id=config_id,
            date=payload.date,
            staff_id=payload.staff_id,
            call_type=payload.call_type,
            is_manual_override=True,
        )
        db.add(existing)
    await db.commit()
    await db.refresh(existing)
    return CallAssignmentOut(
        id=existing.id,
        date=existing.date,
        staff_id=existing.staff_id,
        staff_name=staff.name,
        call_type=existing.call_type,
        is_manual_override=True,
    )


@router.delete("/{config_id}/override")
async def remove_override(
    config_id: int,
    date_str: str = Query(..., alias="date"),
    call_type: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    d = datetime.strptime(date_str, "%Y-%m-%d").date()
    existing = (
        await db.execute(
            select(CallAssignment).filter(
                CallAssignment.config_id == config_id,
                CallAssignment.date == d,
                CallAssignment.call_type == call_type,
            )
        )
    ).scalar_one_or_none()
    if not existing:
        raise HTTPException(404, "Assignment not found")
    await db.delete(existing)
    await db.commit()
    return {"ok": True}


async def _validate_call_swap(
    config_id: int,
    target_date: date,
    call_type_name: str,
    to_staff: Staff,
    db: AsyncSession,
) -> list[str]:
    """Run server-side constraint checks for placing `to_staff` in `call_type_name`
    on `target_date`. Returns a list of human-readable violation strings (empty on
    success). Reuses helpers from validators.py and the canonical eligibility
    logic in solver._is_eligible (we duplicate only the framing â€” the underlying
    helpers are reused).
    """
    from ..services.validators import (
        check_post_call,
        check_call_gap,
        check_max_consecutive,
        check_no_consecutive_different_types,
        is_overnight,
    )

    violations: list[str] = []
    DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

    ct_infos = await _load_call_type_infos(db)
    ct = next((c for c in ct_infos if c.name == call_type_name), None)
    if ct is None:
        violations.append(f"Unknown call type: {call_type_name}")
        return violations

    # 0. Applicable day check (PH, SD, weekday)
    result = await db.execute(
        select(MonthlyConfig)
        .filter(MonthlyConfig.id == config_id)
        .options(
            selectinload(MonthlyConfig.consultant_oncalls),
            selectinload(MonthlyConfig.ac_oncalls),
            selectinload(MonthlyConfig.stepdown_days),
            selectinload(MonthlyConfig.ext_ot_dates),
            selectinload(MonthlyConfig.call_assignments),
        )
    )
    config_for_day = result.scalar_one_or_none()
    ph_dates_all = {
        r.date
        for r in (await db.execute(select(PublicHoliday))).scalars().all()
        if r.date.year == target_date.year and r.date.month == target_date.month
    }
    sd_dates_all = (
        {r.date for r in config_for_day.stepdown_days} if config_for_day else set()
    )
    is_ph_day = target_date in ph_dates_all
    is_sd_day = target_date in sd_dates_all
    day_label = DAY_LABELS[target_date.weekday()]
    if ct.applicable_days:
        applicable = [a.strip() for a in ct.applicable_days.split(",")]
        day_ok = (
            day_label in applicable
            or (is_ph_day and "PH" in applicable)
            or (is_sd_day and "SD" in applicable)
        )
        if not day_ok:
            violations.append(
                f"{call_type_name} is not applicable on {target_date} "
                f"({day_label}{', PH' if is_ph_day else ''}{', SD' if is_sd_day else ''})"
            )

    # 1. Eligibility by rank
    if ct.eligible_rank_names and to_staff.rank not in ct.eligible_rank_names:
        violations.append(
            f"{to_staff.name} ({to_staff.rank}) is not eligible for {call_type_name}"
        )

    # 2. Leave dates
    leave_hit = (
        await db.execute(
            select(Leave).filter(
                Leave.staff_id == to_staff.id, Leave.date == target_date
            )
        )
    ).scalar_one_or_none()
    if leave_hit:
        violations.append(f"{to_staff.name} is on leave on {target_date}")

    # Build assignments map (ALL staff, ALL dates) for context-sensitive checks.
    # Exclude any existing entry for THIS slot so we don't compare to ourselves.
    rows = (
        (
            await db.execute(
                select(CallAssignment).filter(CallAssignment.config_id == config_id)
            )
        )
        .scalars()
        .all()
    )
    assignments: dict[date, dict[int, str]] = defaultdict(dict)
    for r in rows:
        if r.date == target_date and r.call_type == call_type_name:
            continue
        assignments[r.date][r.staff_id] = r.call_type

    ct_config_dict = {
        c.name: {
            "is_overnight": c.is_overnight,
            "post_call_type": c.post_call_type,
            "min_gap_days": c.min_gap_days,
            "switch_window_days": c.switch_window_days,
            "max_consecutive_days": c.max_consecutive_days,
            "is_night_float": c.is_night_float,
            "night_float_run": c.night_float_run,
        }
        for c in ct_infos
    }

    stepdown_dates = sd_dates_all

    # 3. Post-call (no call assignment the day after a 24h call)
    if not check_post_call(
        to_staff.id, target_date, dict(assignments), stepdown_dates, ct_config_dict
    ):
        violations.append(
            f"{to_staff.name} is post-call on {target_date} (had a 24h call the previous day)"
        )

    # 4. Already assigned today (in another slot)
    today_map = assignments.get(target_date, {})
    if to_staff.id in today_map:
        violations.append(
            f"{to_staff.name} is already assigned {today_map[to_staff.id]} on {target_date}"
        )

    # Determine if today is inside this call type's night-float run
    in_nf_run = False
    if ct.is_night_float and ct.night_float_run:
        run_days = {t.strip() for t in ct.night_float_run.split(",") if t.strip()}
        in_nf_run = DAY_LABELS[target_date.weekday()] in run_days

    # 5. Min consecutive days (night-float run continuity for run-start days)
    if ct.min_consecutive_days > 1:
        prev = target_date - timedelta(days=1)
        is_continuation = (
            prev in assignments and assignments[prev].get(to_staff.id) == ct.name
        )
        if not is_continuation:
            run_days_set: set[str] = set()
            if ct.night_float_run:
                run_days_set = {
                    t.strip() for t in ct.night_float_run.split(",") if t.strip()
                }
            needed = ct.min_consecutive_days - 1
            for offset in range(1, needed + 1):
                future = target_date + timedelta(days=offset)
                if run_days_set and DAY_LABELS[future.weekday()] not in run_days_set:
                    break
                future_leave = (
                    await db.execute(
                        select(Leave).filter(
                            Leave.staff_id == to_staff.id, Leave.date == future
                        )
                    )
                ).scalar_one_or_none()
                if future_leave:
                    violations.append(
                        f"{to_staff.name} is on leave on {future} â€” cannot complete {ct.min_consecutive_days}-day {call_type_name} run"
                    )
                    break

    # 6. Max consecutive (skip inside an NF run for the same call type)
    if not in_nf_run and ct.max_consecutive_days:
        if not check_max_consecutive(
            to_staff.id,
            target_date,
            ct.name,
            dict(assignments),
            ct.max_consecutive_days,
        ):
            violations.append(
                f"{to_staff.name} would exceed max consecutive {ct.max_consecutive_days} days of {call_type_name}"
            )

    # 7. Same-type minimum gap (skip inside NF run)
    if not in_nf_run and not check_call_gap(
        to_staff.id,
        target_date,
        ct.name,
        dict(assignments),
        stepdown_dates,
        ct_config_dict,
        ct.min_gap_days,
    ):
        violations.append(
            f"{to_staff.name} has insufficient gap since last {call_type_name} (min {ct.min_gap_days} days)"
        )

    # 8. Cross-type switching window for overnight calls
    if is_overnight(ct.name, target_date, stepdown_dates, ct_config_dict):
        if not check_no_consecutive_different_types(
            to_staff.id,
            target_date,
            ct.name,
            dict(assignments),
            stepdown_dates,
            ct_config_dict,
        ):
            violations.append(
                f"{to_staff.name} had a different overnight call type within the switch window"
            )

    # 9. Mutually exclusive call types â€” check the look-back/look-ahead window
    if ct.mutually_exclusive_names:
        window = max(ct.min_gap_days or 0, 1)
        for offset in range(-window, window + 1):
            if offset == 0:
                continue
            other_day = target_date + timedelta(days=offset)
            other = assignments.get(other_day, {}).get(to_staff.id)
            if other and other in ct.mutually_exclusive_names:
                violations.append(
                    f"{to_staff.name} has {other} on {other_day} which is mutually exclusive with {call_type_name}"
                )
                break

    return violations


@router.post("/{config_id}/swap", response_model=CallSwapResponse)
async def swap_call_assignment(
    config_id: int, payload: CallSwapRequest, db: AsyncSession = Depends(get_db)
):
    """Validate then apply a single-cell call assignment change.

    On constraint violations, returns `{ok: false, violations: [...]}` WITHOUT
    applying the change. Caller may re-submit with `force=true` to override.
    """
    config = await db.get(MonthlyConfig, config_id)
    if not config:
        raise HTTPException(404, "Config not found")
    to_staff = await db.get(Staff, payload.to_staff_id)
    if not to_staff:
        raise HTTPException(404, "Target staff not found")

    violations = await _validate_call_swap(
        config_id, payload.date, payload.call_type, to_staff, db
    )

    if violations and not payload.force:
        return CallSwapResponse(ok=False, violations=violations, assignment=None)

    # Apply (same logic as set_override)
    existing = (
        await db.execute(
            select(CallAssignment).filter(
                CallAssignment.config_id == config_id,
                CallAssignment.date == payload.date,
                CallAssignment.call_type == payload.call_type,
            )
        )
    ).scalar_one_or_none()
    if existing:
        existing.staff_id = payload.to_staff_id
        existing.is_manual_override = True
    else:
        existing = CallAssignment(
            config_id=config_id,
            date=payload.date,
            staff_id=payload.to_staff_id,
            call_type=payload.call_type,
            is_manual_override=True,
        )
        db.add(existing)
    await db.commit()
    await db.refresh(existing)

    return CallSwapResponse(
        ok=True,
        violations=violations,  # may be non-empty if force=true
        assignment=CallAssignmentOut(
            id=existing.id,
            date=existing.date,
            staff_id=existing.staff_id,
            staff_name=to_staff.name,
            call_type=existing.call_type,
            is_manual_override=True,
        ),
    )


@router.get("/{config_id}/assignments", response_model=list[CallAssignmentOut])
async def get_assignments(config_id: int, db: AsyncSession = Depends(get_db)):
    rows = (
        (
            await db.execute(
                select(CallAssignment)
                .filter(CallAssignment.config_id == config_id)
                .order_by(CallAssignment.date, CallAssignment.call_type)
                .options(selectinload(CallAssignment.staff))
            )
        )
        .scalars()
        .all()
    )
    return [
        CallAssignmentOut(
            id=r.id,
            date=r.date,
            staff_id=r.staff_id,
            staff_name=r.staff.name,
            call_type=r.call_type,
            is_manual_override=r.is_manual_override,
        )
        for r in rows
    ]


@router.delete("/{config_id}/call-assignments")
async def delete_all_call_assignments(
    config_id: int, db: AsyncSession = Depends(get_db)
):
    """Delete all call assignments for a config (for full reset before regeneration)."""
    count = (
        await db.execute(
            select(func.count())
            .select_from(CallAssignment)
            .filter(CallAssignment.config_id == config_id)
        )
    ).scalar()
    await db.execute(
        delete(CallAssignment).where(CallAssignment.config_id == config_id)
    )
    await db.commit()
    return {"ok": True, "deleted": count}


@router.post("/{config_id}/call-assignments/restore")
async def restore_call_assignments(
    config_id: int,
    rows: list[CallAssignmentRestore],
    target_date: str = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Bulk-replace call assignments (used for undo). If target_date given, only clears that date first."""
    try:
        if target_date:
            d = date.fromisoformat(target_date)
            await db.execute(
                delete(CallAssignment).where(
                    CallAssignment.config_id == config_id,
                    CallAssignment.date == d,
                )
            )
        else:
            await db.execute(
                delete(CallAssignment).where(CallAssignment.config_id == config_id)
            )
        for r in rows:
            db.add(
                CallAssignment(
                    config_id=config_id,
                    date=r.date,
                    staff_id=r.staff_id,
                    call_type=r.call_type,
                    is_manual_override=r.is_manual_override,
                )
            )
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(
            status_code=500, detail="Restore failed; no changes were saved."
        )
    return {"ok": True, "count": len(rows)}


@router.get("/timestamps")
async def get_timestamps(db: AsyncSession = Depends(get_db)):
    resource_ts = (
        await db.execute(select(func.max(ResourceTemplate.updated_at)))
    ).scalar()
    staff_ts = (await db.execute(select(func.max(Staff.updated_at)))).scalar()
    return {
        "resources": resource_ts.isoformat() if resource_ts else None,
        "staff": staff_ts.isoformat() if staff_ts else None,
    }


@router.get("/timestamps/{config_id}")
async def get_config_timestamp(config_id: int, db: AsyncSession = Depends(get_db)):
    config = await db.get(MonthlyConfig, config_id)
    if not config:
        raise HTTPException(404)
    return {
        "roster": config.updated_at.isoformat() if config.updated_at else None,
    }
