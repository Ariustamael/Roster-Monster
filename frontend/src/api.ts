const API = "http://127.0.0.1:8000/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

async function downloadFile(path: string, filename: string): Promise<void> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const api = {
  getStaff: () => request<import("./types").Staff[]>("/staff"),
  getTeams: () => request<import("./types").Team[]>("/teams"),
  getConfigs: () => request<import("./types").MonthlyConfig[]>("/config"),

  createStaff: (name: string, rank: string, active = true) =>
    request<import("./types").Staff>("/staff", {
      method: "POST",
      body: JSON.stringify({ name, rank, active, has_admin_role: false }),
    }),
  updateStaff: (id: number, name: string, rank: string, active: boolean) =>
    request<import("./types").Staff>(`/staff/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name, rank, active, has_admin_role: false }),
    }),
  createConfig: (year: number, month: number) =>
    request<import("./types").MonthlyConfig>("/config", {
      method: "POST",
      body: JSON.stringify({ year, month }),
    }),
  deleteConfig: (id: number) =>
    request<{ ok: boolean }>(`/config/${id}`, { method: "DELETE" }),

  deleteStaff: (id: number) =>
    request<{ ok: boolean }>(`/staff/${id}`, { method: "DELETE" }),

  // Team CRUD
  createTeam: (name: string) =>
    request<import("./types").Team>("/teams", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  deleteTeam: (id: number) =>
    request<{ ok: boolean }>(`/teams/${id}`, { method: "DELETE" }),
  renameTeam: (id: number, name: string) =>
    request<import("./types").Team>(`/teams/${id}/rename`, { method: "PUT", body: JSON.stringify({ name }) }),
  reorderTeams: (order: number[]) =>
    request<{ ok: boolean }>("/teams/reorder", { method: "PUT", body: JSON.stringify(order) }),
  getAllTeamAssignments: () =>
    request<import("./types").TeamAssignment[]>("/teams/all-assignments"),
  reassignStaff: (staffId: number, teamId: number, supervisorId?: number) =>
    request<import("./types").TeamAssignment>(
      `/teams/reassign/${staffId}/${teamId}${supervisorId ? `?supervisor_id=${supervisorId}` : ""}`,
      { method: "PUT" }
    ),
  setSupervisor: (staffId: number, supervisorId: number) =>
    request<import("./types").TeamAssignment>(`/teams/set-supervisor/${staffId}/${supervisorId}`, {
      method: "PUT",
    }),

  // Resources
  getResources: (configId: number) =>
    request<import("./types").ResourcesResponse>(`/roster/${configId}/resources`),

  generateCallRoster: (configId: number) =>
    request<import("./types").RosterResponse>(`/roster/${configId}/generate`, {
      method: "POST",
    }),

  viewCallRoster: (configId: number) =>
    request<import("./types").RosterResponse>(`/roster/${configId}/view`),

  generateDutyRoster: (configId: number) =>
    request<import("./types").DutyRosterResponse>(
      `/roster/${configId}/generate-duties`,
      { method: "POST" }
    ),

  viewDutyRoster: (configId: number) =>
    request<import("./types").DutyRosterResponse>(
      `/roster/${configId}/duties/view`
    ),

  exportRoster: (configId: number, format: "original" | "clean") =>
    downloadFile(
      `/roster/${configId}/export?format=${format}`,
      `Roster_${format === "clean" ? "Clean" : "Original"}.xlsx`
    ),

  // Leave
  getLeavesForMonth: (year: number, month: number) =>
    request<import("./types").Leave[]>(`/staff/leave/month/${year}/${month}`),
  createLeave: (staffId: number, date: string, leaveType = "AL") =>
    request<import("./types").Leave>("/staff/leave", {
      method: "POST",
      body: JSON.stringify({ staff_id: staffId, date, leave_type: leaveType }),
    }),
  deleteLeave: (id: number) =>
    request<{ ok: boolean }>(`/staff/leave/${id}`, { method: "DELETE" }),

  // Preferences
  getPreferencesForMonth: (year: number, month: number) =>
    request<import("./types").CallPreference[]>(`/staff/preferences/month/${year}/${month}`),
  createPreference: (staffId: number, date: string, type: "request" | "block", reason?: string) =>
    request<import("./types").CallPreference>("/staff/preferences", {
      method: "POST",
      body: JSON.stringify({ staff_id: staffId, date, preference_type: type, reason }),
    }),
  deletePreference: (id: number) =>
    request<{ ok: boolean }>(`/staff/preferences/${id}`, { method: "DELETE" }),

  // Manual overrides
  setOverride: (configId: number, date: string, callType: string, staffId: number) =>
    request<import("./types").CallAssignment>(`/roster/${configId}/override`, {
      method: "PUT",
      body: JSON.stringify({ date, call_type: callType, staff_id: staffId }),
    }),
  removeOverride: (configId: number, date: string, callType: string) =>
    request<{ ok: boolean }>(
      `/roster/${configId}/override?date=${date}&call_type=${callType}`,
      { method: "DELETE" }
    ),
  getAssignments: (configId: number) =>
    request<import("./types").CallAssignment[]>(`/roster/${configId}/assignments`),

  // MO staff for dropdown
  getMOStaff: () =>
    request<import("./types").Staff[]>("/staff?active_only=true"),

  // Duty overrides (drag-and-drop)
  setDutyOverride: (
    configId: number,
    data: {
      date: string; staff_id: number; session: string; duty_type: string;
      location?: string | null; consultant_id?: number | null; old_assignment_id?: number | null;
    }
  ) =>
    request<import("./types").DutyAssignment>(`/roster/${configId}/duty-override`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  deleteDutyOverride: (configId: number, assignmentId: number) =>
    request<{ ok: boolean }>(`/roster/${configId}/duty-override/${assignmentId}`, { method: "DELETE" }),

  // Resource Templates
  getResourceTemplates: () =>
    request<import("./types").ResourceTemplate[]>("/templates/resources"),
  createResourceTemplate: (data: Omit<import("./types").ResourceTemplate, "id" | "consultant_name">) =>
    request<import("./types").ResourceTemplate>("/templates/resources", { method: "POST", body: JSON.stringify(data) }),
  updateResourceTemplate: (id: number, data: Omit<import("./types").ResourceTemplate, "id" | "consultant_name">) =>
    request<import("./types").ResourceTemplate>(`/templates/resources/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteResourceTemplate: (id: number) =>
    request<{ ok: boolean }>(`/templates/resources/${id}`, { method: "DELETE" }),
  duplicateResourceTemplate: (id: number) =>
    request<import("./types").ResourceTemplate>(`/templates/resources/${id}/duplicate`, { method: "POST" }),
  reorderResourceTemplates: (updates: { id: number; sort_order: number; day_of_week?: number; session?: string }[]) =>
    request<{ ok: boolean }>("/templates/resources/reorder", { method: "PUT", body: JSON.stringify(updates) }),

  // Consultant On-Call
  getConsultantOnCall: (configId: number) =>
    request<import("./types").ConsultantOnCall[]>(`/config/${configId}/consultant-oncall`),
  setConsultantOnCall: (configId: number, entries: { date: string; consultant_id: number; supervising_consultant_id?: number | null }[]) =>
    request<{ ok: boolean }>(`/config/${configId}/consultant-oncall`, { method: "POST", body: JSON.stringify(entries) }),

  // AC On-Call
  getACOnCall: (configId: number) =>
    request<import("./types").ACOnCall[]>(`/config/${configId}/ac-oncall`),
  setACOnCall: (configId: number, entries: { date: string; ac_id: number }[]) =>
    request<{ ok: boolean }>(`/config/${configId}/ac-oncall`, { method: "POST", body: JSON.stringify(entries) }),

  // Registrar Duties
  getRegistrarDuties: (configId: number) =>
    request<import("./types").RegistrarDuty[]>(`/config/${configId}/registrar-duties`),
  setRegistrarDuties: (configId: number, entries: { date: string; registrar_id: number; duty_type: string; shift: string }[]) =>
    request<{ ok: boolean }>(`/config/${configId}/registrar-duties`, { method: "POST", body: JSON.stringify(entries) }),

  // Public Holidays
  getPublicHolidays: () =>
    request<import("./types").PublicHoliday[]>("/config/public-holidays"),
  createPublicHoliday: (date: string, name: string) =>
    request<import("./types").PublicHoliday>("/config/public-holidays", { method: "POST", body: JSON.stringify({ date, name }) }),
  deletePublicHoliday: (id: number) =>
    request<{ ok: boolean }>(`/config/public-holidays/${id}`, { method: "DELETE" }),

  // Stepdown Days
  getStepdownDays: (configId: number) =>
    request<import("./types").StepdownDay[]>(`/config/${configId}/stepdown-days`),
  setStepdownDays: (configId: number, entries: { date: string }[]) =>
    request<{ ok: boolean }>(`/config/${configId}/stepdown-days`, { method: "POST", body: JSON.stringify(entries) }),

  // Evening OT Dates
  getEveningOTDates: (configId: number) =>
    request<import("./types").EveningOTDate[]>(`/config/${configId}/evening-ot-dates`),
  setEveningOTDates: (configId: number, entries: { date: string }[]) =>
    request<{ ok: boolean }>(`/config/${configId}/evening-ot-dates`, { method: "POST", body: JSON.stringify(entries) }),

  // Rank Config
  getRanks: () =>
    request<import("./types").RankConfig[]>("/config/ranks"),
  createRank: (data: Omit<import("./types").RankConfig, "id">) =>
    request<import("./types").RankConfig>("/config/ranks", { method: "POST", body: JSON.stringify(data) }),
  updateRank: (id: number, data: Omit<import("./types").RankConfig, "id">) =>
    request<import("./types").RankConfig>(`/config/ranks/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteRank: (id: number) =>
    request<{ ok: boolean }>(`/config/ranks/${id}`, { method: "DELETE" }),

  // Call Type Config
  getCallTypes: () =>
    request<import("./types").CallTypeConfig[]>("/config/call-types"),
  createCallType: (data: Omit<import("./types").CallTypeConfig, "id">) =>
    request<import("./types").CallTypeConfig>("/config/call-types", { method: "POST", body: JSON.stringify(data) }),
  updateCallType: (id: number, data: Omit<import("./types").CallTypeConfig, "id">) =>
    request<import("./types").CallTypeConfig>(`/config/call-types/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteCallType: (id: number) =>
    request<{ ok: boolean }>(`/config/call-types/${id}`, { method: "DELETE" }),
};
