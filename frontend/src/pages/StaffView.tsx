import { useEffect, useState } from "react";
import { api } from "../api";
import { useConfig } from "../context/ConfigContext";
import type { Staff, Leave, CallPreference, CallTypeConfig, Team } from "../types";

const RANK_ORDER: Record<string, number> = {
  "Senior Consultant": 0,
  "Consultant": 1,
  "Associate Consultant": 2,
  "Senior Staff Registrar": 3,
  "Senior Resident": 4,
  "Senior Medical Officer": 5,
  "Medical Officer": 6,
};

const ALL_RANKS = [
  "Senior Consultant", "Consultant", "Associate Consultant",
  "Senior Staff Registrar", "Senior Resident", "Senior Medical Officer", "Medical Officer",
];

const ALLOCATABLE_RANKS = ["Senior Staff Registrar", "Senior Resident", "Senior Medical Officer", "Medical Officer"];

const MONTH_NAMES = [
  "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export default function StaffView() {
  const { active } = useConfig();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [prefs, setPrefs] = useState<CallPreference[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [staffUpdatedAt, setStaffUpdatedAt] = useState<string | null>(null);
  const [callTypes, setCallTypes] = useState<CallTypeConfig[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);

  const year = active?.year ?? 2026;
  const month = active?.month ?? 1;

  useEffect(() => {
    api.getStaff().then(setStaff).finally(() => setLoading(false));
    api.getTimestamps().then(ts => setStaffUpdatedAt(ts.staff));
    api.getCallTypes().then(setCallTypes);
    api.getTeams().then(setTeams);
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
    .sort((a, b) => (RANK_ORDER[a.rank] ?? 9) - (RANK_ORDER[b.rank] ?? 9) || a.name.localeCompare(b.name));

  const moCount = staff.filter((s) => ALLOCATABLE_RANKS.includes(s.rank)).length;

  async function addStaff(name: string, grade: string) {
    const s = await api.createStaff(name, grade);
    setStaff((prev) => [...prev, s]);
    setShowAdd(false);
  }

  async function saveEdit(id: number, data: { name: string; rank: string; active: boolean; has_admin_role: boolean; extra_call_type_ids: string | null; duty_preference: string | null }) {
    const updated = await api.updateStaff(id, data);
    setStaff((prev) => prev.map((s) => (s.id === id ? updated : s)));
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

  async function addLeave(staffId: number) {
    const dateStr = prompt(`Enter leave date (YYYY-MM-DD):`);
    if (!dateStr) return;
    try {
      const lv = await api.createLeave(staffId, dateStr);
      setLeaves((prev) => [...prev, lv]);
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function removeLeave(id: number) {
    await api.deleteLeave(id);
    setLeaves((prev) => prev.filter((l) => l.id !== id));
  }

  async function addPreference(staffId: number, type: "request" | "block") {
    const dateStr = prompt(`Enter ${type} date (YYYY-MM-DD):`);
    if (!dateStr) return;
    const reason = type === "block" ? prompt("Reason (optional):") || undefined : undefined;
    try {
      const p = await api.createPreference(staffId, dateStr, type, reason);
      setPrefs((prev) => [...prev, p]);
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function removePref(id: number) {
    await api.deletePreference(id);
    setPrefs((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <>
      <div className="page-header">
        <h2>Staff ({staff.length} total, {moCount} MOs)
          {staffUpdatedAt && (
            <span style={{ fontSize: 11, fontWeight: 400, color: "var(--text-muted)", marginLeft: 12 }}>
              Last updated: {new Date(staffUpdatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </h2>
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
      </div>

      {loading ? (
        <div className="loading"><span className="spinner" /> Loading staff...</div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 20 }}></th>
                  <th>Name</th>
                  <th>Rank</th>
                  <th>Team</th>
                  <th>Supervisor</th>
                  <th>Leaves</th>
                  <th>Prefs</th>
                  <th style={{ width: 120 }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => {
                  const staffLeaves = leaves.filter((l) => l.staff_id === s.id);
                  const staffPrefs = prefs.filter((p) => p.staff_id === s.id);
                  const isMO = ALLOCATABLE_RANKS.includes(s.rank);
                  const isExpanded = expanded === s.id;
                  const isEditing = editing === s.id;

                  if (false) { /* EditRow replaced by modal below */ }

                  return (
                    <StaffRow
                      key={s.id}
                      staff={s}
                      isMO={isMO}
                      isExpanded={isExpanded}
                      leaves={staffLeaves}
                      prefs={staffPrefs}
                      monthLabel={`${MONTH_NAMES[month]} ${year}`}
                      onToggle={() => setExpanded(isExpanded ? null : s.id)}
                      onEdit={() => setEditing(s.id)}
                      onDelete={() => deleteStaffMember(s.id, s.name)}
                      onAddLeave={() => addLeave(s.id)}
                      onRemoveLeave={removeLeave}
                      onAddPref={(type) => addPreference(s.id, type)}
                      onRemovePref={removePref}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showAdd && (
        <AddStaffModal onAdd={addStaff} onClose={() => setShowAdd(false)} />
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

function StaffRow({
  staff: s,
  isMO,
  isExpanded,
  leaves,
  prefs,
  monthLabel,
  onToggle,
  onEdit,
  onDelete,
  onAddLeave,
  onRemoveLeave,
  onAddPref,
  onRemovePref,
}: {
  staff: Staff;
  isMO: boolean;
  isExpanded: boolean;
  leaves: Leave[];
  prefs: CallPreference[];
  monthLabel: string;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddLeave: () => void;
  onRemoveLeave: (id: number) => void;
  onAddPref: (type: "request" | "block") => void;
  onRemovePref: (id: number) => void;
}) {
  return (
    <>
      <tr className={isMO ? "expand-toggle" : ""} onClick={isMO ? onToggle : undefined}>
        <td style={{ textAlign: "center", fontSize: 11 }}>
          {isMO ? (isExpanded ? "▼" : "▶") : ""}
        </td>
        <td style={{ fontWeight: 500 }}>{s.name}</td>
        <td>{s.rank}</td>
        <td>{s.team_name || "-"}</td>
        <td style={{ color: "var(--text-muted)", fontSize: 12 }}>{s.supervisor_name || "-"}</td>
        <td>{leaves.length || "-"}</td>
        <td>{prefs.length || "-"}</td>
        <td>
          <div className="btn-group" onClick={(e) => e.stopPropagation()}>
            <button className="btn btn-sm btn-secondary" onClick={onEdit}>Edit</button>
            <button className="btn btn-sm btn-danger" onClick={onDelete}>Delete</button>
          </div>
        </td>
      </tr>
      {isExpanded && (
        <tr className="staff-detail">
          <td colSpan={8}>
            <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
              <div>
                <strong style={{ fontSize: 12 }}>Leaves ({monthLabel})</strong>
                <div className="detail-section" style={{ marginTop: 6 }}>
                  {leaves.map((l) => (
                    <span key={l.id} className="chip leave">
                      {l.date.slice(5)} ({l.leave_type})
                      <span className="remove" onClick={(e) => { e.stopPropagation(); onRemoveLeave(l.id); }}>&times;</span>
                    </span>
                  ))}
                  <button className="btn btn-sm btn-secondary" onClick={(e) => { e.stopPropagation(); onAddLeave(); }}>
                    + Leave
                  </button>
                </div>
              </div>
              <div>
                <strong style={{ fontSize: 12 }}>Preferences ({monthLabel})</strong>
                <div className="detail-section" style={{ marginTop: 6 }}>
                  {prefs.map((p) => (
                    <span key={p.id} className={`chip ${p.preference_type}`}>
                      {p.date.slice(5)} {p.preference_type}
                      {p.reason ? ` - ${p.reason}` : ""}
                      <span className="remove" onClick={(e) => { e.stopPropagation(); onRemovePref(p.id); }}>&times;</span>
                    </span>
                  ))}
                  <button className="btn btn-sm btn-secondary" onClick={(e) => { e.stopPropagation(); onAddPref("request"); }}>
                    + Request
                  </button>
                  <button className="btn btn-sm btn-secondary" onClick={(e) => { e.stopPropagation(); onAddPref("block"); }}>
                    + Block
                  </button>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function EditStaffModal({
  staff, callTypes, teams, allStaff, leaves, prefs, year, month,
  onSave, onClose, onAddLeave, onRemoveLeave, onAddPref, onRemovePref, onReassign,
}: {
  staff: Staff;
  callTypes: CallTypeConfig[];
  teams: Team[];
  allStaff: Staff[];
  leaves: Leave[];
  prefs: CallPreference[];
  year: number;
  month: number;
  onSave: (data: { name: string; rank: string; active: boolean; has_admin_role: boolean; extra_call_type_ids: string | null; duty_preference: string | null }) => void;
  onClose: () => void;
  onAddLeave: (date: string) => Promise<void>;
  onRemoveLeave: (id: number) => Promise<void>;
  onAddPref: (date: string, type: string, reason?: string) => Promise<void>;
  onRemovePref: (id: number) => Promise<void>;
  onReassign: (teamId: number, supervisorId?: number) => Promise<void>;
}) {
  const [name, setName] = useState(staff.name);
  const [rank, setRank] = useState(staff.rank);
  const [active, setActive] = useState(staff.active);
  const [hasAdmin, setHasAdmin] = useState(staff.has_admin_role);
  const [extraCallIds, setExtraCallIds] = useState<number[]>(
    staff.extra_call_type_ids ? staff.extra_call_type_ids.split(",").map(s => parseInt(s.trim())).filter(n => !isNaN(n)) : []
  );
  const [dutyPref, setDutyPref] = useState(staff.duty_preference ?? "");
  const [teamId, setTeamId] = useState<number | "">(teams.find(t => t.name === staff.team_name)?.id ?? "");
  const [supervisorId, setSupervisorId] = useState<number | "">(
    allStaff.find(s => s.name === staff.supervisor_name)?.id ?? ""
  );
  const [newLeaveDate, setNewLeaveDate] = useState("");
  const [newPrefDate, setNewPrefDate] = useState("");
  const [newPrefType, setNewPrefType] = useState<"request" | "block">("request");

  const consultants = allStaff.filter(s => ["Senior Consultant", "Consultant"].includes(s.rank) && s.active);
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
            <label>Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Rank</label>
            <select value={rank} onChange={(e) => setRank(e.target.value)}>
              {ALL_RANKS.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Team</label>
            <select value={teamId} onChange={(e) => setTeamId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">— None —</option>
              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Supervisor</label>
            <select value={supervisorId} onChange={(e) => setSupervisorId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">— None —</option>
              {consultants.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        <div className="form-group">
          <label>Duty Preference</label>
          <select value={dutyPref} onChange={(e) => setDutyPref(e.target.value)}>
            <option value="">No preference</option>
            <option value="OT">Prefer OT</option>
            <option value="Clinic">Prefer Clinic</option>
          </select>
        </div>

        <div className="form-group">
          <label>Extra Eligible Call Types</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
            {callTypes.filter(ct => ct.is_active).map(ct => (
              <label key={ct.id} style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", fontSize: 12 }}>
                <input type="checkbox" checked={extraCallIds.includes(ct.id)} onChange={() => toggleCallType(ct.id)} />
                {ct.name}
              </label>
            ))}
          </div>
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
          <div style={{ display: "flex", gap: 4, marginTop: 6, alignItems: "center" }}>
            <input type="date" value={newLeaveDate} onChange={(e) => setNewLeaveDate(e.target.value)}
              style={{ fontSize: 12, padding: "3px 6px", border: "1px solid var(--border)", borderRadius: 4 }} />
            <button className="btn btn-sm btn-secondary" onClick={async () => {
              if (newLeaveDate) { await onAddLeave(newLeaveDate); setNewLeaveDate(""); }
            }}>+ Leave</button>
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
          <button className="btn btn-primary" onClick={async () => {
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
}: {
  onAdd: (name: string, grade: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [rank, setRank] = useState("Medical Officer");

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Add Staff</h3>
        <div className="form-group">
          <label>Name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="form-group">
          <label>Rank</label>
          <select value={rank} onChange={(e) => setRank(e.target.value)}>
            {ALL_RANKS.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => { if (name.trim()) onAdd(name.trim(), rank); }}>
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
