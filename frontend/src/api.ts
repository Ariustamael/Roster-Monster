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

  generateCallRoster: (configId: number) =>
    request<import("./types").RosterResponse>(`/roster/${configId}/generate`, {
      method: "POST",
    }),

  generateDutyRoster: (configId: number) =>
    request<import("./types").DutyRosterResponse>(
      `/roster/${configId}/generate-duties`,
      { method: "POST" }
    ),

  exportRoster: (configId: number, format: "original" | "clean") =>
    downloadFile(
      `/roster/${configId}/export?format=${format}`,
      `Roster_${format === "clean" ? "Clean" : "Original"}.xlsx`
    ),
};
