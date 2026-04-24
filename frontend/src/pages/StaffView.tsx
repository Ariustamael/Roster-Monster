import { useEffect, useState } from "react";
import { api } from "../api";
import { useConfig } from "../context/ConfigContext";
import type { Staff, Leave, CallPreference } from "../types";

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

  const year = active?.year ?? 2026;
  const month = active?.month ?? 1;

  useEffect(() => {
    api.getStaff().then(setStaff).finally(() => setLoading(false));
    api.getTimestamps().then(ts => setStaffUpdatedAt(ts.staff));
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

  async function saveEdit(id: number, name: string, grade: string) {
    const updated = await api.updateStaff(id, name, grade, true);
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

                  if (isEditing) {
                    return (
                      <EditRow
                        key={s.id}
                        staff={s}
                        onSave={saveEdit}
                        onCancel={() => setEditing(null)}
                      />
                    );
                  }

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

function EditRow({
  staff,
  onSave,
  onCancel,
}: {
  staff: Staff;
  onSave: (id: number, name: string, grade: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(staff.name);
  const [rank, setRank] = useState(staff.rank);

  return (
    <tr>
      <td></td>
      <td>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)}
          style={{ width: "100%", padding: "4px 6px", border: "1px solid var(--border)", borderRadius: 4, fontSize: 13 }} />
      </td>
      <td>
        <select value={rank} onChange={(e) => setRank(e.target.value)}
          style={{ padding: "4px 6px", border: "1px solid var(--border)", borderRadius: 4, fontSize: 13 }}>
          {ALL_RANKS.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </td>
      <td>{staff.team_name || "-"}</td>
      <td style={{ color: "var(--text-muted)", fontSize: 12 }}>{staff.supervisor_name || "-"}</td>
      <td colSpan={2}></td>
      <td>
        <div className="btn-group">
          <button className="btn btn-sm btn-primary" onClick={() => onSave(staff.id, name, rank)}>Save</button>
          <button className="btn btn-sm btn-secondary" onClick={onCancel}>Cancel</button>
        </div>
      </td>
    </tr>
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
