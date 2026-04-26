import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useConfig } from "../context/ConfigContext";
import type { Staff, Leave, CallPreference, CallTypeConfig, Team, RankConfig } from "../types";
import MultiSelectDropdown from "../components/MultiSelectDropdown";
import { useEscClose } from "../hooks/useEscClose";

function toDDMM(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  return `${d}/${m}`;
}

function consolidateDates(dates: string[]): string {
  if (dates.length === 0) return "";
  const sorted = [...dates].sort();
  const ranges: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const prevDate = new Date(prev);
    const currDate = new Date(sorted[i]);
    const diffDays = (currDate.getTime() - prevDate.getTime()) / 86400000;
    if (diffDays === 1) {
      prev = sorted[i];
    } else {
      ranges.push(start === prev ? toDDMM(start) : `${toDDMM(start)}-${toDDMM(prev)}`);
      start = sorted[i];
      prev = sorted[i];
    }
  }
  ranges.push(start === prev ? toDDMM(start) : `${toDDMM(start)}-${toDDMM(prev)}`);
  return ranges.join(", ");
}

const MONTH_NAMES = [
  "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

type StaffSortKey = "name" | "rank" | "team" | "supervisor";
type StaffSortDir = "asc" | "desc";

export default function StaffView() {
  const { active } = useConfig();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<StaffSortKey>("rank");
  const [sortDir, setSortDir] = useState<StaffSortDir>("asc");

  function toggleSort(k: StaffSortKey) {
    if (k === sortKey) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("asc"); }
  }

  function sortHeader(label: string, k: StaffSortKey) {
    const active = sortKey === k;
    const arrow = !active ? "⇅" : sortDir === "asc" ? "↑" : "↓";
    return (
      <th
        onClick={() => toggleSort(k)}
        style={{ cursor: "pointer", userSelect: "none" }}
        title={`Sort by ${label}`}
      >
        {label} <span style={{ opacity: active ? 1 : 0.4, fontSize: 10 }}>{arrow}</span>
      </th>
    );
  }
  // expanded state removed — editing is via modal
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [prefs, setPrefs] = useState<CallPreference[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [staffUpdatedAt, setStaffUpdatedAt] = useState<string | null>(null);
  const [callTypes, setCallTypes] = useState<CallTypeConfig[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [ranks, setRanks] = useState<RankConfig[]>([]);

  const sortedRanks = useMemo(
    () => [...ranks].filter(r => r.is_active).sort((a, b) => a.display_order - b.display_order),
    [ranks]
  );
  const rankOrder = useMemo(() => {
    const m: Record<string, number> = {};
    sortedRanks.forEach((r, i) => { m[r.name] = i; });
    return m;
  }, [sortedRanks]);
  const allRanks = useMemo(() => sortedRanks.map(r => r.name), [sortedRanks]);
  const allocatableRanks = useMemo(
    () => sortedRanks.filter(r => !r.is_consultant_tier).map(r => r.name),
    [sortedRanks]
  );
  const consultantRanks = useMemo(
    () => sortedRanks.filter(r => r.is_consultant_tier).map(r => r.name),
    [sortedRanks]
  );

  const year = active?.year ?? 2026;
  const month = active?.month ?? 1;

  useEffect(() => {
    api.getStaff().then(setStaff).finally(() => setLoading(false));
    api.getTimestamps().then(ts => setStaffUpdatedAt(ts.staff));
    api.getCallTypes().then(setCallTypes);
    api.getTeams().then(setTeams);
    api.getRanks().then(setRanks);
  }, []);

  useEffect(() => {
    if (active) {
      api.getLeavesForMonth(year, month).then(setLeaves);
      api.getPreferencesForMonth(year, month).then(setPrefs);
    }
  }, [active?.id]);

  const filtered = staff
    .filter(
      (s) =>
        s.name.toLowerCase().includes(filter.toLowerCase()) ||
        s.rank.toLowerCase().includes(filter.toLowerCase()) ||
        (s.team_name || "").toLowerCase().includes(filter.toLowerCase()) ||
        (s.supervisor_name || "").toLowerCase().includes(filter.toLowerCase())
    )
    .sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name": cmp = a.name.localeCompare(b.name); break;
        case "rank": cmp = (rankOrder[a.rank] ?? 9999) - (rankOrder[b.rank] ?? 9999); break;
        case "team": cmp = (a.team_name || "").localeCompare(b.team_name || ""); break;
        case "supervisor": cmp = (a.supervisor_name || "").localeCompare(b.supervisor_name || ""); break;
      }
      if (cmp === 0) cmp = a.name.localeCompare(b.name);
      return sortDir === "asc" ? cmp : -cmp;
    });

  const moCount = staff.filter((s) => allocatableRanks.includes(s.rank)).length;

  async function addStaff(name: string, grade: string) {
    const s = await api.createStaff(name, grade);
    setStaff((prev) => [...prev, s]);
    setShowAdd(false);
  }

  async function saveEdit(id: number, data: { name: string; rank: string; active: boolean; has_admin_role: boolean; extra_call_type_ids: string | null; duty_preference: string | null; can_do_call: boolean; can_do_clinic: boolean; can_do_ot: boolean }) {
    await api.updateStaff(id, data);
    const refreshed = await api.getStaff();
    setStaff(refreshed);
    setEditing(null);
  }

  async function deleteStaffMember(id: number, name: string) {
    if (!confirm(`Delete ${name}? This removes all their assignments, leaves, and preferences.`)) return;
    try {
      await api.deleteStaff(id);
      setStaff((prev) => prev.filter((s) => s.id !== id));
      setLeaves((prev) => prev.filter((l) => l.staff_id !== id));
      setPrefs((prev) => prev.filter((p) => p.staff_id !== id));
    } catch (e: any) {
      alert(e.message);
    }
  }

  // Leave and preference management moved to EditStaffModal

  async function removePref(id: number) {
    await api.deletePreference(id);
    setPrefs((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <>
      <div className="page-header" style={{ alignItems: "flex-start" }}>
        <div>
          <h2>Staff{active ? ` - ${new Date(active.year, active.month - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}` : ""}</h2>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
            {(() => {
              const consCount = staff.filter(s => consultantRanks.includes(s.rank)).length;
              const regCount = staff.filter(s => ranks.find(r => r.name === s.rank)?.is_registrar_tier).length;
              return `${staff.length} Total | ${consCount} Cons, ${regCount} Regs, ${moCount} MOs`;
            })()}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <div className="btn-group">
            <input
              type="text"
              placeholder="Filter by name, rank, or team..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{
                padding: "8px 12px",
                border: "1px solid var(--border)",
                borderRadius: 6,
                fontSize: 13,
                width: 220,
              }}
            />
            <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add Staff</button>
          </div>
          {staffUpdatedAt && (
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              Last updated: {new Date(staffUpdatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <div className="loading"><span className="spinner" /> Loading staff...</div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table style={{ width: "100%", minWidth: 900 }}>
              <thead>
                <tr>
                  {sortHeader("Name", "name")}
                  {sortHeader("Rank", "rank")}
                  {sortHeader("Team", "team")}
                  {sortHeader("Supervisor", "supervisor")}
                  <th style={{ width: 130 }}>Leaves</th>
                  <th style={{ width: 130 }}>Preferences</th>
                  <th style={{ width: 100 }}>Extra Call Types</th>
                  <th style={{ width: 100 }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => {
                  const staffLeaves = leaves.filter(l => l.staff_id === s.id);
                  const staffPrefs = prefs.filter(p => p.staff_id === s.id);
                  return (
                  <tr key={s.id} style={{ opacity: s.active ? 1 : 0.5 }}>
                    <td style={{ fontWeight: 500, whiteSpace: "nowrap" }}>{s.name}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{s.rank}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{s.team_name || "-"}</td>
                    <td style={{ color: "var(--text-muted)", fontSize: 12, whiteSpace: "nowrap" }}>{s.supervisor_name || "-"}</td>
                    <td style={{ fontSize: 10, color: "#b45309", wordWrap: "break-word", overflowWrap: "break-word" }}>
                      {staffLeaves.length > 0
                        ? consolidateDates(staffLeaves.map(l => l.date))
                        : <span style={{ color: "var(--text-muted)" }}>-</span>}
                    </td>
                    <td style={{ fontSize: 10, wordWrap: "break-word", overflowWrap: "break-word" }}>
                      {staffPrefs.length > 0
                        ? (() => {
                            const blocks = staffPrefs.filter(p => p.preference_type === "block");
                            const requests = staffPrefs.filter(p => p.preference_type === "request");
                            return (
                              <>
                                {blocks.length > 0 && <span style={{ color: "#991b1b", marginRight: 6 }}>B: {blocks.map(p => toDDMM(p.date)).join(", ")}</span>}
                                {requests.length > 0 && <span style={{ color: "#065f46" }}>R: {requests.map(p => toDDMM(p.date)).join(", ")}</span>}
                              </>
                            );
                          })()
                        : <span style={{ color: "var(--text-muted)" }}>-</span>}
                    </td>
                    <td style={{ fontSize: 10, color: "var(--text-muted)", wordWrap: "break-word", overflowWrap: "break-word" }}>
                      {s.extra_call_type_ids
                        ? s.extra_call_type_ids.split(",").map(id => callTypes.find(ct => ct.id === parseInt(id))?.name).filter(Boolean).join(", ")
                        : "-"}
                    </td>
                    <td>
                      <div className="btn-group">
                        <button className="btn btn-sm btn-secondary" onClick={() => setEditing(s.id)}>Edit</button>
                        <button className="btn btn-sm btn-danger" onClick={() => deleteStaffMember(s.id, s.name)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showAdd && (
        <AddStaffModal onAdd={addStaff} onClose={() => setShowAdd(false)} allRanks={allRanks} />
      )}

      {editing != null && (() => {
        const editStaff = staff.find(s => s.id === editing);
        if (!editStaff) return null;
        return (
          <EditStaffModal
            staff={editStaff}
            callTypes={callTypes}
            teams={teams}
            allStaff={staff}
            allRanks={allRanks}
            allocatableRanks={allocatableRanks}
            consultantRanks={consultantRanks}
            leaves={leaves.filter(l => l.staff_id === editing)}
            prefs={prefs.filter(p => p.staff_id === editing)}
            year={year}
            month={month}
            onSave={(data) => saveEdit(editing, data)}
            onClose={() => setEditing(null)}
            onAddLeave={async (date) => {
              const lv = await api.createLeave(editing, date);
              setLeaves(prev => [...prev, lv]);
            }}
            onRemoveLeave={async (id) => {
              await api.deleteLeave(id);
              setLeaves(prev => prev.filter(l => l.id !== id));
            }}
            onAddPref={async (date, type, reason) => {
              const p = await api.createPreference(editing, date, type, reason);
              setPrefs(prev => [...prev, p]);
            }}
            onRemovePref={async (id) => {
              await api.deletePreference(id);
              setPrefs(prev => prev.filter(p => p.id !== id));
            }}
            onReassign={async (teamId, supervisorId) => {
              await api.reassignStaff(editing, teamId, supervisorId);
              const updated = await api.getStaff();
              setStaff(updated);
            }}
          />
        );
      })()}
    </>
  );
}

// StaffRow removed — table rows are now inline, editing is via modal

function EditStaffModal({
  staff, callTypes, teams, allStaff, allRanks, allocatableRanks, consultantRanks, leaves, prefs, year, month,
  onSave, onClose, onAddLeave, onRemoveLeave, onAddPref, onRemovePref, onReassign,
}: {
  staff: Staff;
  callTypes: CallTypeConfig[];
  teams: Team[];
  allStaff: Staff[];
  allRanks: string[];
  allocatableRanks: string[];
  consultantRanks: string[];
  leaves: Leave[];
  prefs: CallPreference[];
  year: number;
  month: number;
  onSave: (data: { name: string; rank: string; active: boolean; has_admin_role: boolean; extra_call_type_ids: string | null; duty_preference: string | null; can_do_call: boolean; can_do_clinic: boolean; can_do_ot: boolean }) => void;
  onClose: () => void;
  onAddLeave: (date: string) => Promise<void>;
  onRemoveLeave: (id: number) => Promise<void>;
  onAddPref: (date: string, type: string, reason?: string) => Promise<void>;
  onRemovePref: (id: number) => Promise<void>;
  onReassign: (teamId: number, supervisorId?: number) => Promise<void>;
}) {
  useEscClose(onClose);
  const [name, setName] = useState(staff.name);
  const [rank, setRank] = useState(staff.rank);
  const [active, setActive] = useState(staff.active);
  const [hasAdmin, setHasAdmin] = useState(staff.has_admin_role);
  const [canCall, setCanCall] = useState(staff.can_do_call ?? true);
  const [canClinic, setCanClinic] = useState(staff.can_do_clinic ?? true);
  const [canOt, setCanOt] = useState(staff.can_do_ot ?? true);
  const [extraCallIds, setExtraCallIds] = useState<number[]>(
    staff.extra_call_type_ids ? staff.extra_call_type_ids.split(",").map(s => parseInt(s.trim())).filter(n => !isNaN(n)) : []
  );
  const [dutyPref, setDutyPref] = useState(staff.duty_preference ?? "");
  const [teamId, setTeamId] = useState<number | "">(teams.find(t => t.name === staff.team_name)?.id ?? "");
  const [supervisorId, setSupervisorId] = useState<number | "">(
    allStaff.find(s => s.name === staff.supervisor_name)?.id ?? ""
  );
  const [leaveStart, setLeaveStart] = useState("");
  const [leaveEnd, setLeaveEnd] = useState("");
  const [newPrefDate, setNewPrefDate] = useState("");
  const [newPrefType, setNewPrefType] = useState<"request" | "block">("request");

  const consultants = allStaff.filter(s => consultantRanks.includes(s.rank) && s.active);
  const monthName = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month];

  function toggleCallType(ctId: number) {
    setExtraCallIds(prev => prev.includes(ctId) ? prev.filter(id => id !== ctId) : [...prev, ctId]);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560, maxHeight: "90vh", overflowY: "auto" }}>
        <h3>Edit Staff — {staff.name}</h3>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label htmlFor="edit-staff-name">Name <span style={{ color: "#dc2626" }}>*</span></label>
            <input id="edit-staff-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label htmlFor="edit-staff-rank">Rank</label>
            <select id="edit-staff-rank" value={rank} onChange={(e) => setRank(e.target.value)}>
              {allRanks.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label htmlFor="edit-staff-team">Team</label>
            <select id="edit-staff-team" value={teamId} onChange={(e) => setTeamId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">— None —</option>
              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label htmlFor="edit-staff-supervisor">Supervisor</label>
            <select id="edit-staff-supervisor" value={supervisorId} onChange={(e) => setSupervisorId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">— None —</option>
              {consultants.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="edit-staff-dutypref">Duty Preference</label>
          <select id="edit-staff-dutypref" value={dutyPref} onChange={(e) => setDutyPref(e.target.value)}>
            <option value="">No preference</option>
            <option value="OT">Prefer OT</option>
            <option value="Clinic">Prefer Clinic</option>
          </select>
        </div>

        <div className="form-group">
          <label>Extra Eligible Call Types</label>
          <MultiSelectDropdown
            options={callTypes.filter(ct => ct.is_active).map(ct => ({ id: ct.id, label: ct.name }))}
            selected={extraCallIds}
            onChange={setExtraCallIds}
            placeholder="None selected"
          />
        </div>

        <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13 }}>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13 }}>
            <input type="checkbox" checked={hasAdmin} onChange={(e) => setHasAdmin(e.target.checked)} />
            Admin Role
          </label>
        </div>

        {allocatableRanks.includes(rank) && (
          <div className="form-group" style={{ background: "var(--bg-muted, #f8fafc)", borderRadius: 6, padding: "10px 12px", border: "1px solid var(--border)" }}>
            <label style={{ fontWeight: 600, fontSize: 12, marginBottom: 6, display: "block" }}>
              Allocation Eligibility
            </label>
            <div style={{ display: "flex", gap: 16, fontSize: 13 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input type="checkbox" checked={canCall} onChange={(e) => setCanCall(e.target.checked)} />
                Can take call
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input type="checkbox" checked={canClinic} onChange={(e) => setCanClinic(e.target.checked)} />
                Can do clinic
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input type="checkbox" checked={canOt} onChange={(e) => setCanOt(e.target.checked)} />
                Can do OT
              </label>
            </div>
          </div>
        )}

        {/* Leave management */}
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginBottom: 10 }}>
          <strong style={{ fontSize: 12 }}>Leaves — {monthName} {year}</strong>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
            {leaves.map(l => (
              <span key={l.id} className="chip leave" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, padding: "2px 6px", background: "#fef3c7", borderRadius: 4 }}>
                {l.date.slice(5)} ({l.leave_type})
                <span style={{ cursor: "pointer", color: "#b91c1c", fontWeight: 700 }} onClick={() => onRemoveLeave(l.id)}>&times;</span>
              </span>
            ))}
            {leaves.length === 0 && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>No leaves</span>}
          </div>
          <div style={{ display: "flex", gap: 4, marginTop: 6, alignItems: "center", flexWrap: "wrap" }}>
            <input type="date" value={leaveStart} onChange={(e) => { setLeaveStart(e.target.value); if (!leaveEnd) setLeaveEnd(e.target.value); }}
              style={{ fontSize: 12, padding: "3px 6px", border: "1px solid var(--border)", borderRadius: 4 }} />
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>to</span>
            <input type="date" value={leaveEnd} onChange={(e) => setLeaveEnd(e.target.value)}
              style={{ fontSize: 12, padding: "3px 6px", border: "1px solid var(--border)", borderRadius: 4 }} />
            <button className="btn btn-sm btn-secondary" onClick={async () => {
              if (!leaveStart) return;
              const end = leaveEnd || leaveStart;
              const start = new Date(leaveStart);
              const finish = new Date(end);
              for (let d = new Date(start); d <= finish; d.setDate(d.getDate() + 1)) {
                await onAddLeave(d.toISOString().slice(0, 10));
              }
              setLeaveStart(""); setLeaveEnd("");
            }}>+ Add</button>
          </div>
        </div>

        {/* Preference management */}
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginBottom: 10 }}>
          <strong style={{ fontSize: 12 }}>Call Preferences — {monthName} {year}</strong>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
            {prefs.map(p => (
              <span key={p.id} style={{
                display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, padding: "2px 6px", borderRadius: 4,
                background: p.preference_type === "request" ? "#d1fae5" : "#fee2e2",
                color: p.preference_type === "request" ? "#065f46" : "#991b1b",
              }}>
                {p.date.slice(5)} {p.preference_type}{p.reason ? ` - ${p.reason}` : ""}
                <span style={{ cursor: "pointer", fontWeight: 700 }} onClick={() => onRemovePref(p.id)}>&times;</span>
              </span>
            ))}
            {prefs.length === 0 && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>No preferences</span>}
          </div>
          <div style={{ display: "flex", gap: 4, marginTop: 6, alignItems: "center" }}>
            <input type="date" value={newPrefDate} onChange={(e) => setNewPrefDate(e.target.value)}
              style={{ fontSize: 12, padding: "3px 6px", border: "1px solid var(--border)", borderRadius: 4 }} />
            <select value={newPrefType} onChange={(e) => setNewPrefType(e.target.value as "request" | "block")}
              style={{ fontSize: 12, padding: "3px 6px", border: "1px solid var(--border)", borderRadius: 4 }}>
              <option value="request">Request</option>
              <option value="block">Block</option>
            </select>
            <button className="btn btn-sm btn-secondary" onClick={async () => {
              if (newPrefDate) { await onAddPref(newPrefDate, newPrefType); setNewPrefDate(""); }
            }}>+ Pref</button>
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!name.trim()} onClick={async () => {
            if (name.trim()) {
              if (teamId && teamId !== (teams.find(t => t.name === staff.team_name)?.id ?? "")) {
                await onReassign(teamId as number, supervisorId ? supervisorId as number : undefined);
              } else if (supervisorId && supervisorId !== (allStaff.find(s => s.name === staff.supervisor_name)?.id ?? "")) {
                await onReassign(
                  teams.find(t => t.name === staff.team_name)?.id ?? (teamId as number),
                  supervisorId as number
                );
              }
              onSave({
                name: name.trim(),
                rank,
                active,
                has_admin_role: hasAdmin,
                extra_call_type_ids: extraCallIds.length > 0 ? extraCallIds.join(",") : null,
                duty_preference: dutyPref || null,
                can_do_call: canCall,
                can_do_clinic: canClinic,
                can_do_ot: canOt,
              });
            }
          }}>Save</button>
        </div>
      </div>
    </div>
  );
}

function AddStaffModal({
  onAdd,
  onClose,
  allRanks,
}: {
  onAdd: (name: string, grade: string) => void;
  onClose: () => void;
  allRanks: string[];
}) {
  useEscClose(onClose);
  const [name, setName] = useState("");
  const [rank, setRank] = useState(allRanks.includes("Medical Officer") ? "Medical Officer" : (allRanks[allRanks.length - 1] ?? ""));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Add Staff</h3>
        <div className="form-group">
          <label htmlFor="add-staff-name">Name <span style={{ color: "#dc2626" }}>*</span></label>
          <input id="add-staff-name" type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="form-group">
          <label htmlFor="add-staff-rank">Rank</label>
          <select id="add-staff-rank" value={rank} onChange={(e) => setRank(e.target.value)}>
            {allRanks.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!name.trim()} onClick={() => { if (name.trim()) onAdd(name.trim(), rank); }}>
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
