import { useEffect, useState } from "react";
import { api } from "../api";
import { useConfig } from "../context/ConfigContext";
import type { RosterResponse, Staff, CallAssignment, DayRoster } from "../types";

export default function CallRosterView() {
  const { active } = useConfig();
  const [roster, setRoster] = useState<RosterResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [moStaff, setMoStaff] = useState<Staff[]>([]);
  const [assignments, setAssignments] = useState<CallAssignment[]>([]);
  const [editCell, setEditCell] = useState<{ date: string; slot: string } | null>(null);

  useEffect(() => {
    api.getMOStaff().then(setMoStaff);
  }, []);

  const configId = active?.id ?? 0;

  useEffect(() => {
    setRoster(null);
    setAssignments([]);
    if (!configId) return;
    api.viewCallRoster(configId)
      .then(async (data) => {
        setRoster(data);
        const a = await api.getAssignments(configId);
        setAssignments(a);
      })
      .catch(() => {});
  }, [configId]);

  async function generate() {
    if (!configId) return;
    setLoading(true);
    setError("");
    try {
      const data = await api.generateCallRoster(configId);
      setRoster(data);
      const a = await api.getAssignments(configId);
      setAssignments(a);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function exportFile(format: "original" | "clean") {
    try {
      await api.exportRoster(configId, format);
    } catch (e: any) {
      setError(e.message);
    }
  }

  function isOverride(date: string, slot: string): boolean {
    return assignments.some(
      (a) => a.date === date && a.call_type === slot && a.is_manual_override
    );
  }

  function getSlotValue(day: DayRoster, slot: string): string | null {
    return day.call_slots[slot] ?? null;
  }

  async function handleOverride(staffId: number) {
    if (!editCell) return;
    try {
      await api.setOverride(configId, editCell.date, editCell.slot, staffId);
      const a = await api.getAssignments(configId);
      setAssignments(a);
      if (roster) {
        const staffName = moStaff.find((s) => s.id === staffId)?.name || "";
        const updatedDays = roster.days.map((day) => {
          if (day.date !== editCell.date) return day;
          return { ...day, call_slots: { ...day.call_slots, [editCell.slot]: staffName } };
        });
        setRoster({ ...roster, days: updatedDays });
      }
    } catch (e: any) {
      setError(e.message);
    }
    setEditCell(null);
  }

  if (!active) return <p style={{ color: "var(--text-muted)" }}>Select a month in the sidebar.</p>;

  const callColumns = roster?.call_type_columns ?? [];

  return (
    <>
      <div className="page-header">
        <h2>Call Roster {roster ? `- ${monthName(roster.month)} ${roster.year}` : ""}</h2>
        <div className="btn-group">
          <button className="btn btn-primary" onClick={generate} disabled={loading}>
            {loading ? <><span className="spinner" /> Generating...</> : "Generate Call Roster"}
          </button>
          {roster && (
            <>
              <button className="btn btn-secondary" onClick={() => exportFile("original")}>
                Export Original
              </button>
              <button className="btn btn-secondary" onClick={() => exportFile("clean")}>
                Export Clean
              </button>
            </>
          )}
        </div>
      </div>

      {error && <div className="violations"><h4>Error</h4><p>{error}</p></div>}

      {roster && (
        <>
          {roster.violations.length === 0 ? (
            <span className="success-badge">0 violations</span>
          ) : (
            <div className="violations">
              <h4>{roster.violations.length} Violations</h4>
              <ul>{roster.violations.map((v, i) => <li key={i}>{v}</li>)}</ul>
            </div>
          )}

          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "8px 0" }}>
            Click any MO cell to manually override the assignment.
          </p>

          <div className="card" style={{ marginTop: 4 }}>
            <div className="table-wrap">
              <table className="roster-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Day</th>
                    <th>Consultant</th>
                    <th>AC</th>
                    {callColumns.map((col) => (
                      <th key={col}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {roster.days.map((day) => (
                    <tr
                      key={day.date}
                      className={`${day.is_weekend ? "weekend" : ""} ${day.is_ph ? "ph" : ""}`}
                    >
                      <td>{day.date.slice(5)}</td>
                      <td>{day.day_name}</td>
                      <td>{day.consultant_oncall || "-"}</td>
                      <td>{day.ac_oncall || "-"}</td>
                      {callColumns.map((slot) => {
                        const val = getSlotValue(day, slot);
                        const over = isOverride(day.date, slot);
                        return (
                          <td
                            key={slot}
                            className={`editable ${slot === callColumns[0] ? "mo1" : ""} ${over ? "override" : ""} ${!val ? "empty" : ""}`}
                            onClick={() => setEditCell({ date: day.date, slot })}
                          >
                            {val || "-"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {editCell && (
        <div className="modal-backdrop" onClick={() => setEditCell(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Override {editCell.slot} on {editCell.date}</h3>
            <div className="form-group">
              <label>Select MO</label>
              <select
                autoFocus
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) handleOverride(Number(e.target.value));
                }}
              >
                <option value="" disabled>Choose staff...</option>
                {moStaff
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((s) => (
                    <option key={s.id} value={s.id}>{s.name} ({s.rank})</option>
                  ))}
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setEditCell(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function monthName(m: number) {
  return ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m];
}
