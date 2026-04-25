import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useConfig } from "../context/ConfigContext";
import type { RosterResponse, Staff, CallAssignment, DayRoster, CallTypeConfig, RankConfig } from "../types";
import { monthName } from "../utils";

interface CallDragState {
  staffId: number;
  staffName: string;
  date: string;
  fromSlot: string; // call_type the staff is being dragged FROM
}

export default function CallRosterView() {
  const { active } = useConfig();
  const [roster, setRoster] = useState<RosterResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [allStaff, setAllStaff] = useState<Staff[]>([]);
  const [assignments, setAssignments] = useState<CallAssignment[]>([]);
  const [callTypes, setCallTypes] = useState<CallTypeConfig[]>([]);
  const [ranks, setRanks] = useState<RankConfig[]>([]);
  const [editCell, setEditCell] = useState<{ date: string; slot: string } | null>(null);
  const dragRef = useRef<CallDragState | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  useEffect(() => {
    api.getMOStaff().then(setAllStaff);
    api.getCallTypes().then(setCallTypes);
    api.getRanks().then(setRanks);
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

  function applyLocalSlotUpdate(date: string, slot: string, staffName: string | null) {
    if (!roster) return;
    const updatedDays = roster.days.map((day) => {
      if (day.date !== date) return day;
      const slots = { ...day.call_slots };
      if (staffName === null) delete slots[slot]; else slots[slot] = staffName;
      return { ...day, call_slots: slots };
    });
    setRoster({ ...roster, days: updatedDays });
  }

  async function refreshAssignments() {
    const a = await api.getAssignments(configId);
    setAssignments(a);
  }

  // Validates server-side; on violations, prompts user to confirm an override.
  async function performSwap(date: string, slot: string, toStaffId: number, fromStaffId: number | null): Promise<boolean> {
    try {
      const resp = await api.swapCallAssignment(configId, {
        date, call_type: slot,
        from_staff_id: fromStaffId,
        to_staff_id: toStaffId,
        force: false,
      });
      if (!resp.ok) {
        const msg = "This swap violates the following rule(s):\n\n  - " +
          resp.violations.join("\n  - ") +
          "\n\nOverride anyway?";
        if (!window.confirm(msg)) return false;
        const forced = await api.swapCallAssignment(configId, {
          date, call_type: slot,
          from_staff_id: fromStaffId,
          to_staff_id: toStaffId,
          force: true,
        });
        if (!forced.ok) {
          setError("Swap failed even with force=true.");
          return false;
        }
      }
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    }
  }

  async function handleOverride(staffId: number) {
    if (!editCell) return;
    const fromAssignment = assignments.find(
      (a) => a.date === editCell.date && a.call_type === editCell.slot
    );
    const ok = await performSwap(editCell.date, editCell.slot, staffId, fromAssignment?.staff_id ?? null);
    if (ok) {
      const staffName = allStaff.find((s) => s.id === staffId)?.name || "";
      applyLocalSlotUpdate(editCell.date, editCell.slot, staffName);
      await refreshAssignments();
    }
    setEditCell(null);
  }

  async function handleClear() {
    if (!editCell) return;
    try {
      await api.removeOverride(configId, editCell.date, editCell.slot);
      await refreshAssignments();
      applyLocalSlotUpdate(editCell.date, editCell.slot, null);
    } catch (e: any) {
      setError(e.message);
    }
    setEditCell(null);
  }

  async function handleCallDrop(targetDate: string, targetSlot: string) {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragOver(null);
    if (!drag) return;
    if (drag.date !== targetDate) {
      setError("Cross-day swaps are not supported — drag within the same row.");
      return;
    }
    if (drag.fromSlot === targetSlot) return;

    // Who currently sits in the target slot? (will be moved into source slot)
    const targetAssignment = assignments.find(
      (a) => a.date === targetDate && a.call_type === targetSlot
    );

    // 1. Validate & set dragged staff into target slot
    const ok1 = await performSwap(
      targetDate, targetSlot, drag.staffId,
      targetAssignment?.staff_id ?? null,
    );
    if (!ok1) return;

    // 2. Validate & move the displaced staff into the source slot (or clear it)
    if (targetAssignment) {
      const ok2 = await performSwap(
        targetDate, drag.fromSlot, targetAssignment.staff_id, drag.staffId,
      );
      if (!ok2) {
        // Refresh to reflect partial update
        await refreshAssignments();
        const data = await api.viewCallRoster(configId).catch(() => null);
        if (data) setRoster(data);
        return;
      }
    } else {
      try {
        await api.removeOverride(configId, targetDate, drag.fromSlot);
      } catch {
        /* ignore */
      }
    }

    await refreshAssignments();
    const data = await api.viewCallRoster(configId).catch(() => null);
    if (data) setRoster(data);
  }

  function filteredStaff(): Staff[] {
    if (!editCell) return allStaff;
    const ct = callTypes.find((c) => c.name === editCell.slot);
    if (!ct || ct.eligible_rank_ids.length === 0) return allStaff;
    const eligibleRankNames = new Set(
      ranks.filter((r) => ct.eligible_rank_ids.includes(r.id)).map((r) => r.name)
    );
    if (eligibleRankNames.size === 0) return allStaff;
    return allStaff.filter((s) => eligibleRankNames.has(s.rank));
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
            Drag a name onto another cell in the same row to swap. Click a cell to override or clear via menu. Constraint violations prompt for confirmation.
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
                        const ca = assignments.find((a) => a.date === day.date && a.call_type === slot);
                        const zoneKey = `${day.date}_${slot}`;
                        const isDragOver = dragOver === zoneKey;
                        return (
                          <td
                            key={slot}
                            className={`editable ${slot === callColumns[0] ? "mo1" : ""} ${over ? "override" : ""} ${!val ? "empty" : ""}`}
                            onClick={() => setEditCell({ date: day.date, slot })}
                            onDragOver={(e) => {
                              if (dragRef.current) {
                                e.preventDefault();
                                setDragOver(zoneKey);
                              }
                            }}
                            onDragLeave={() => setDragOver((cur) => (cur === zoneKey ? null : cur))}
                            onDrop={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleCallDrop(day.date, slot);
                            }}
                            style={{
                              outline: isDragOver ? "2px dashed #6366f1" : undefined,
                              outlineOffset: isDragOver ? -2 : undefined,
                            }}
                          >
                            {val ? (
                              <span
                                draggable={!!ca}
                                onClick={(e) => e.stopPropagation()}
                                onDragStart={(e) => {
                                  if (!ca) return;
                                  e.stopPropagation();
                                  dragRef.current = {
                                    staffId: ca.staff_id,
                                    staffName: ca.staff_name,
                                    date: day.date,
                                    fromSlot: slot,
                                  };
                                }}
                                onDragEnd={() => {
                                  dragRef.current = null;
                                  setDragOver(null);
                                }}
                                style={{
                                  cursor: ca ? "grab" : "default",
                                  userSelect: "none",
                                  display: "inline-block",
                                  width: "100%",
                                }}
                                title={ca ? "Drag to another cell in this row to swap" : undefined}
                              >
                                {val}
                              </span>
                            ) : (
                              "-"
                            )}
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
              <label>Select Staff</label>
              <select
                autoFocus
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) handleOverride(Number(e.target.value));
                }}
              >
                <option value="" disabled>Choose staff...</option>
                {filteredStaff()
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((s) => (
                    <option key={s.id} value={s.id}>{s.name} ({s.rank})</option>
                  ))}
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn btn-danger" onClick={handleClear}>Clear Slot</button>
              <button className="btn btn-secondary" onClick={() => setEditCell(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

