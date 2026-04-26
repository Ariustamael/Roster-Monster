export interface Staff {
  id: number;
  name: string;
  rank: string;
  active: boolean;
  has_admin_role: boolean;
  extra_call_type_ids: string | null;
  duty_preference: string | null;
  can_do_call?: boolean;
  can_do_clinic?: boolean;
  can_do_ot?: boolean;
  team_name: string | null;
  supervisor_name: string | null;
}

export interface Team {
  id: number;
  name: string;
  display_order: number;
}

export interface DayRoster {
  date: string;
  day_name: string;
  is_weekend: boolean;
  is_ph: boolean;
  is_stepdown: boolean;
  consultant_oncall: string | null;
  ac_oncall: string | null;
  call_slots: Record<string, string | null>;
  ward_mo: string[];
  eot_mo: string[];
}

export interface RosterResponse {
  year: number;
  month: number;
  days: DayRoster[];
  violations: string[];
  fairness: Record<string, FairnessStats>;
  call_type_columns: string[];
  call_type_rank_groups: Record<string, string>;
}

export interface FairnessStats {
  total_24h: number;
  total_all: number;
  per_type: Record<string, number>;
  weekend_ph: number;
  difficulty_points: number;
}

export interface DutyAssignment {
  id: number;
  date: string;
  staff_id: number;
  staff_name: string;
  session: string;
  duty_type: string;
  location: string | null;
  consultant_id: number | null;
  consultant_name: string | null;
  clinic_type: string | null;
  is_manual_override: boolean;
}

export interface DayDutyRoster {
  date: string;
  day_name: string;
  is_weekend: boolean;
  is_ph: boolean;
  is_stepdown: boolean;
  is_ext_ot: boolean;
  consultant_oncall: string | null;
  ac_oncall: string | null;
  call_slots: Record<string, string | null>;
  post_call: string[];
  ot_assignments: DutyAssignment[];
  eot_assignments: DutyAssignment[];
  am_clinics: DutyAssignment[];
  pm_clinics: DutyAssignment[];
  am_admin: DutyAssignment[];
  pm_admin: DutyAssignment[];
  unavailable: { staff_id: number; staff_name: string; reason: string }[];
  expected_resources?: {
    resource_type: "clinic" | "ot";
    room: string;
    label: string;
    session: string;
    is_emergency: boolean;
    consultant_id: number | null;
    consultant_name: string | null;
    staff_required: number;
    priority: number;
  }[];
  warnings?: string[];
  shortfall?: number;
  has_day_override?: boolean;
}

export interface DutyRosterResponse {
  year: number;
  month: number;
  days: DayDutyRoster[];
  duty_stats: Record<string, DutyStats>;
  call_type_columns: string[];
  call_type_rank_groups: Record<string, string>;
}

export interface DutyStats {
  ot_days: number;
  eot_days: number;
  supervised_sessions: number;
  admin_sessions: number;
  ward_mo_sessions?: number;
  eot_mo_sessions?: number;
}

export interface MonthlyConfig {
  id: number;
  year: number;
  month: number;
  status: string;
}

export interface Leave {
  id: number;
  staff_id: number;
  staff_name: string;
  date: string;
  leave_type: string;
}

export interface CallPreference {
  id: number;
  staff_id: number;
  staff_name: string;
  date: string;
  preference_type: "request" | "block";
  reason: string | null;
}

export interface CallAssignment {
  id: number;
  date: string;
  staff_id: number;
  staff_name: string;
  call_type: string;
  is_manual_override: boolean;
}

export interface TeamAssignment {
  id: number;
  staff_id: number;
  staff_name: string;
  team_id: number;
  team_name: string;
  role: string;
  supervisor_id: number | null;
  supervisor_name: string | null;
  effective_from: string;
  effective_to: string | null;
}

export interface ResourceTemplate {
  id: number;
  resource_type: "clinic" | "ot";
  day_of_week: number;
  session: string;
  room: string;
  label: string;
  consultant_id: number | null;
  consultant_name: string | null;
  staff_required: number;
  is_emergency: boolean;
  linked_manpower: string | null;
  weeks: string | null;
  color: string | null;
  is_active: boolean;
  sort_order: number;
  priority?: number;
  max_registrars?: number;
  eligible_rank_ids?: string | null;
  effective_date?: string | null;
}

export interface ConsultantOnCall {
  id: number;
  date: string;
  consultant_id: number;
  consultant_name: string;
  supervising_consultant_id: number | null;
  supervising_consultant_name: string | null;
}

export interface ACOnCall {
  id: number;
  date: string;
  ac_id: number;
  ac_name: string;
}

export interface RegistrarDuty {
  id: number;
  date: string;
  registrar_id: number;
  registrar_name: string;
  duty_type: string;
  shift: string;
}

export interface PublicHoliday {
  id: number;
  date: string;
  name: string;
}

export interface StepdownDay {
  id: number;
  date: string;
}

export interface ExtOTDate {
  id: number;
  date: string;
}

export interface ResourceDay {
  date: string;
  day_name: string;
  is_weekend: boolean;
  is_ph: boolean;
  ot_rooms: number;
  ot_assistants_needed: number;
  clinic_slots: number;
  call_slots: number;
  total_mos: number;
  on_leave: number;
  on_call: number;
  post_call: number;
  available: number;
  duty_slots: number;
  capacity_slots: number;
  balance_slots: number | null;
}

export interface ResourcesResponse {
  year: number;
  month: number;
  days: ResourceDay[];
}

export interface RankConfig {
  id: number;
  name: string;
  abbreviation: string;
  display_order: number;
  is_call_eligible: boolean;
  is_duty_eligible: boolean;
  is_consultant_tier: boolean;
  is_registrar_tier: boolean;
  is_active: boolean;
}

export interface CallTypeConfig {
  id: number;
  name: string;
  display_order: number;
  is_overnight: boolean;
  post_call_type: string;
  max_consecutive_days: number;
  min_consecutive_days: number;
  min_gap_days: number;
  switch_window_days: number;
  difficulty_points: number;
  counts_towards_fairness: boolean;
  applicable_days: string;
  required_conditions: string | null;
  default_duty_type: string | null;
  is_night_float: boolean;
  night_float_run: string | null;
  uses_consultant_affinity: boolean;
  is_active: boolean;
  is_duty_only: boolean;
  linked_to: string | null;
  mutually_exclusive_with: string | null;
  eligible_rank_ids: number[];
}
