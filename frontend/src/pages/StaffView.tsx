import { useEffect, useState } from "react";
import { api } from "../api";
import type { Staff, Leave, CallPreference } from "../types";

const GRADE_ORDER: Record<string, number> = {
  "Senior Consultant": 0,
  "Consultant": 1,
  "Associate Consultant": 2,
  "Registrar": 3,
  "Resident Physician": 4,
  "Clinical Associate": 5,
  "Medical Officer": 6,
};

const MO_GRADES = ["Resident Physician", "Clinical Associate", "Medical Officer"];

export default function StaffView() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [prefs, setPrefs] = useState<CallPreference[]>([]);

  const year = 2026;
  const month = 4;

  useEffect(() => {
    api.getStaff().then(setStaff).finally(() => setLoading(false));
    api.getLeavesForMonth(year, month).then(setLeaves);
    api.getPreferencesForMonth(year, month).then(setPrefs);
  }, []);

  const filtered = staff
    .filter(
      (s) =>
        s.name.toLowerCase().includes(filter.toLowerCase()) ||
        s.grade.toLowerCase().includes(filter.toLowerCase()) ||
        (s.team_name || "").toLowerCase().includes(filter.toLowerCase())
    )
    .sort((a, b) => (GRADE_ORDER[a.grade] ?? 9) - (GRADE_ORDER[b.grade] ?? 9) || a.name.localeCompare(b.name));

  const moCount = staff.filter((s) => MO_GRADES.includes(s.grade)).length;

  function toggleExpand(id: number) {
    setExpanded(expanded === id ? null : id);
  }

  async function addLeave(staffId: number) {
    const dateStr = prompt("Enter leave date (YYYY-MM-DD):");
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
        <h2>Staff ({staff.length} total, {moCount} MOs)</h2>
        <input
          type="text"
          placeholder="Filter by name, grade, or team..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            padding: "8px 12px",
            border: "1px solid var(--border)",
            borderRadius: 6,
            fontSize: 13,
            width: 260,
          }}
        />
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
                  <th>Grade</th>
                  <th>Team</th>
                  <th>Status</th>
                  <th>Leaves</th>
                  <th>Preferences</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => {
                  const staffLeaves = leaves.filter((l) => l.staff_id === s.id);
                  const staffPrefs = prefs.filter((p) => p.staff_id === s.id);
                  const isMO = MO_GRADES.includes(s.grade);
                  const isExpanded = expanded === s.id;

                  return (
                    <StaffRow
                      key={s.id}
                      staff={s}
                      isMO={isMO}
                      isExpanded={isExpanded}
                      leaves={staffLeaves}
                      prefs={staffPrefs}
                      onToggle={() => toggleExpand(s.id)}
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
    </>
  );
}

function StaffRow({
  staff: s,
  isMO,
  isExpanded,
  leaves,
  prefs,
  onToggle,
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
  onToggle: () => void;
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
        <td>{s.grade}</td>
        <td>{s.team_name || "-"}</td>
        <td>
          <span style={{
            color: s.active ? "var(--success)" : "var(--danger)",
            fontWeight: 500,
          }}>
            {s.active ? "Active" : "Inactive"}
          </span>
        </td>
        <td>{leaves.length || "-"}</td>
        <td>{prefs.length || "-"}</td>
      </tr>
      {isExpanded && (
        <tr className="staff-detail">
          <td colSpan={7}>
            <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
              <div>
                <strong style={{ fontSize: 12 }}>Leaves (Apr 2026)</strong>
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
                <strong style={{ fontSize: 12 }}>Preferences (Apr 2026)</strong>
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
