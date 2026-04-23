export interface Staff {
  id: number;
  name: string;
  rank: string;
  active: boolean;
  has_admin_role: boolean;
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
}

export interface RosterResponse {
  year: number;
  month: number;
  days: DayRoster[];
  violations: string[];
  fairness: Record<string, FairnessStats>;
  call_type_columns: string[];
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
  consultant_oncall: string | null;
  ac_oncall: string | null;
  call_slots: Record<string, string | null>;
  post_call: string[];
  ot_assignments: DutyAssignment[];
  eot_assignments: DutyAssignment[];
  am_clinics: DutyAssignment[];
  pm_clinics: DutyAssignment[];
  am_admin: string[];
  pm_admin: string[];
}

export interface DutyRosterResponse {
  year: number;
  month: number;
  days: DayDutyRoster[];
  duty_stats: Record<string, DutyStats>;
  call_type_columns: string[];
}

export interface DutyStats {
  ot_days: number;
  eot_days: number;
  supervised_sessions: number;
  mopd_sessions: number;
  admin_sessions: number;
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

export interface OTTemplate {
  id: number;
  day_of_week: number;
  room: string;
  consultant_id: number | null;
  consultant_name: string | null;
  assistants_needed: number;
  registrar_needed: number;
  is_emergency: boolean;
  linked_call_slot: string | null;
  color: string | null;
  is_active: boolean;
  week_of_month: number | null;
}

export interface ClinicTemplate {
  id: number;
  day_of_week: number;
  session: string;
  room: string;
  clinic_type: string;
  mos_required: number;
  consultant_id: number | null;
  consultant_name: string | null;
  color: string | null;
  is_active: boolean;
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

export interface EveningOTDate {
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
  supervised_clinics: number;
  mopd_clinics: number;
  call_slots: number;
  total_mos: number;
  on_leave: number;
  on_call: number;
  post_call: number;
  available: number;
  needed_for_duties: number;
  surplus: number;
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
  is_active: boolean;
}

export interface CallTypeConfig {
  id: number;
  name: string;
  display_order: number;
  is_overnight: boolean;
  post_call_type: string;
  max_consecutive_days: number;
  min_gap_days: number;
  difficulty_points: number;
  counts_towards_fairness: boolean;
  applicable_days: string;
  required_conditions: string | null;
  default_duty_type: string | null;
  is_night_float: boolean;
  night_float_run: string | null;
  is_active: boolean;
  eligible_rank_ids: number[];
}
