from pydantic import BaseModel
from datetime import date
from typing import Optional
from .models import PreferenceType, RegistrarShift, RegistrarDutyType, DutyType, Session


# ── Staff ────────────────────────────────────────────────────────────────

class StaffCreate(BaseModel):
    name: str
    rank: str
    active: bool = True
    has_admin_role: bool = False


class StaffOut(BaseModel):
    id: int
    name: str
    rank: str
    active: bool
    has_admin_role: bool
    team_name: Optional[str] = None
    supervisor_name: Optional[str] = None

    model_config = {"from_attributes": True}


# ── Team ─────────────────────────────────────────────────────────────────

class TeamOut(BaseModel):
    id: int
    name: str
    display_order: int = 0

    model_config = {"from_attributes": True}


class TeamCreate(BaseModel):
    name: str


class TeamAssignmentCreate(BaseModel):
    staff_id: int
    team_id: int
    role: str
    supervisor_id: Optional[int] = None
    effective_from: date
    effective_to: Optional[date] = None


class TeamAssignmentOut(BaseModel):
    id: int
    staff_id: int
    staff_name: str
    team_id: int
    team_name: str
    role: str
    supervisor_id: Optional[int] = None
    supervisor_name: Optional[str] = None
    effective_from: date
    effective_to: Optional[date]

    model_config = {"from_attributes": True}


# ── Leave ────────────────────────────────────────────────────────────────

class LeaveCreate(BaseModel):
    staff_id: int
    date: date
    leave_type: str = "AL"


class LeaveOut(BaseModel):
    id: int
    staff_id: int
    staff_name: str
    date: date
    leave_type: str

    model_config = {"from_attributes": True}


# ── Call Preferences ─────────────────────────────────────────────────────

class CallPreferenceCreate(BaseModel):
    staff_id: int
    date: date
    preference_type: PreferenceType
    reason: Optional[str] = None


class CallPreferenceOut(BaseModel):
    id: int
    staff_id: int
    staff_name: str
    date: date
    preference_type: PreferenceType
    reason: Optional[str]

    model_config = {"from_attributes": True}


# ── Public Holidays ──────────────────────────────────────────────────────

class PublicHolidayCreate(BaseModel):
    date: date
    name: str


class PublicHolidayOut(BaseModel):
    id: int
    date: date
    name: str

    model_config = {"from_attributes": True}


# ── Monthly Config ───────────────────────────────────────────────────────

class MonthlyConfigCreate(BaseModel):
    year: int
    month: int


class MonthlyConfigOut(BaseModel):
    id: int
    year: int
    month: int
    status: str

    model_config = {"from_attributes": True}


class ConsultantOnCallCreate(BaseModel):
    date: date
    consultant_id: int
    supervising_consultant_id: Optional[int] = None


class ConsultantOnCallOut(BaseModel):
    id: int
    date: date
    consultant_id: int
    consultant_name: str
    supervising_consultant_id: Optional[int] = None
    supervising_consultant_name: Optional[str] = None

    model_config = {"from_attributes": True}


class ACOnCallCreate(BaseModel):
    date: date
    ac_id: int


class ACOnCallOut(BaseModel):
    id: int
    date: date
    ac_id: int
    ac_name: str

    model_config = {"from_attributes": True}


class RegistrarDutyOut(BaseModel):
    id: int
    date: date
    registrar_id: int
    registrar_name: str
    duty_type: RegistrarDutyType
    shift: RegistrarShift

    model_config = {"from_attributes": True}


class StepdownDayOut(BaseModel):
    id: int
    date: date

    model_config = {"from_attributes": True}


class EveningOTDateOut(BaseModel):
    id: int
    date: date

    model_config = {"from_attributes": True}


class RegistrarDutyCreate(BaseModel):
    date: date
    registrar_id: int
    duty_type: RegistrarDutyType
    shift: RegistrarShift


class StepdownDayCreate(BaseModel):
    date: date


class EveningOTDateCreate(BaseModel):
    date: date


# ── Call Assignment (output) ─────────────────────────────────────────────

class CallAssignmentOut(BaseModel):
    id: int
    date: date
    staff_id: int
    staff_name: str
    call_type: str
    is_manual_override: bool

    model_config = {"from_attributes": True}


class ManualOverrideCreate(BaseModel):
    date: date
    call_type: str
    staff_id: int


class DayRoster(BaseModel):
    date: date
    day_name: str
    is_weekend: bool
    is_ph: bool
    is_stepdown: bool
    consultant_oncall: Optional[str] = None
    ac_oncall: Optional[str] = None
    call_slots: dict[str, Optional[str]] = {}


class FairnessStats(BaseModel):
    total_24h: int = 0
    total_all: int = 0
    per_type: dict[str, int] = {}
    weekend_ph: int = 0
    difficulty_points: int = 0


class RosterResponse(BaseModel):
    year: int
    month: int
    days: list[DayRoster]
    violations: list[str]
    fairness: dict[str, dict]
    call_type_columns: list[str] = []


# ── Resource Template ────────────────────────────────────────────────────

class ResourceTemplateCreate(BaseModel):
    resource_type: str  # "clinic" or "ot"
    day_of_week: int
    session: Session
    room: str
    label: str = ""
    consultant_id: Optional[int] = None
    staff_required: int = 1
    is_emergency: bool = False
    linked_manpower: Optional[str] = None
    weeks: Optional[str] = None
    color: Optional[str] = None
    is_active: bool = True
    sort_order: int = 0


class ResourceTemplateOut(BaseModel):
    id: int
    resource_type: str
    day_of_week: int
    session: Session
    room: str
    label: str
    consultant_id: Optional[int]
    consultant_name: Optional[str] = None
    staff_required: int
    is_emergency: bool
    linked_manpower: Optional[str] = None
    weeks: Optional[str] = None
    color: Optional[str] = None
    is_active: bool = True
    sort_order: int = 0

    model_config = {"from_attributes": True}


# ── Duty Assignment (output) ─────────────────────────────────────────────

class DutyOverrideCreate(BaseModel):
    date: date
    staff_id: int
    session: Session
    duty_type: str
    location: Optional[str] = None
    consultant_id: Optional[int] = None
    old_assignment_id: Optional[int] = None


class DutyAssignmentOut(BaseModel):
    id: int
    date: date
    staff_id: int
    staff_name: str
    session: Session
    duty_type: DutyType
    location: Optional[str]
    consultant_id: Optional[int]
    consultant_name: Optional[str] = None
    clinic_type: Optional[str] = None
    is_manual_override: bool

    model_config = {"from_attributes": True}


class DayDutyRoster(BaseModel):
    date: date
    day_name: str
    is_weekend: bool
    is_ph: bool
    consultant_oncall: Optional[str] = None
    ac_oncall: Optional[str] = None
    call_slots: dict[str, Optional[str]] = {}
    post_call: list[str]
    ot_assignments: list[DutyAssignmentOut]
    eot_assignments: list[DutyAssignmentOut]
    am_clinics: list[DutyAssignmentOut]
    pm_clinics: list[DutyAssignmentOut]
    am_admin: list[str]
    pm_admin: list[str]


class DutyRosterResponse(BaseModel):
    year: int
    month: int
    days: list[DayDutyRoster]
    duty_stats: dict[str, dict]
    call_type_columns: list[str] = []


# ── Rank Config ──────────────────────────────────────────────────────────

class RankConfigCreate(BaseModel):
    name: str
    abbreviation: str
    display_order: int = 0
    is_call_eligible: bool = False
    is_duty_eligible: bool = False
    is_consultant_tier: bool = False
    is_registrar_tier: bool = False
    is_active: bool = True


class RankConfigOut(BaseModel):
    id: int
    name: str
    abbreviation: str
    display_order: int
    is_call_eligible: bool
    is_duty_eligible: bool
    is_consultant_tier: bool
    is_registrar_tier: bool
    is_active: bool

    model_config = {"from_attributes": True}


# ── Call Type Config ─────────────────────────────────────────────────────

class CallTypeConfigCreate(BaseModel):
    name: str
    display_order: int = 0
    is_overnight: bool = False
    post_call_type: str = "none"
    max_consecutive_days: int = 1
    min_gap_days: int = 2
    difficulty_points: int = 1
    counts_towards_fairness: bool = True
    applicable_days: str = "Mon,Tue,Wed,Thu,Fri,Sat,Sun,PH"
    required_conditions: Optional[str] = None
    default_duty_type: Optional[str] = None
    is_night_float: bool = False
    night_float_run: Optional[str] = None
    is_active: bool = True
    eligible_rank_ids: list[int] = []


class CallTypeConfigOut(BaseModel):
    id: int
    name: str
    display_order: int
    is_overnight: bool
    post_call_type: str
    max_consecutive_days: int
    min_gap_days: int
    difficulty_points: int
    counts_towards_fairness: bool
    applicable_days: str
    required_conditions: Optional[str] = None
    default_duty_type: Optional[str] = None
    is_night_float: bool = False
    night_float_run: Optional[str] = None
    is_active: bool
    eligible_rank_ids: list[int] = []

    model_config = {"from_attributes": True}
