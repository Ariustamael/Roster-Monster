const API = "http://localhost:8000/api";

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

export const api = {
  getStaff: () => request<import("./types").Staff[]>("/staff"),
  getTeams: () => request<import("./types").Team[]>("/teams"),
  getConfigs: () => request<import("./types").MonthlyConfig[]>("/config"),

  generateCallRoster: (configId: number) =>
    request<import("./types").RosterResponse>(`/roster/${configId}/generate`, {
      method: "POST",
    }),

  generateDutyRoster: (configId: number) =>
    request<import("./types").DutyRosterResponse>(
      `/roster/${configId}/generate-duties`,
      { method: "POST" }
    ),
};
