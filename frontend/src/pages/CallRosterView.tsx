import React, { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useConfig } from "../context/ConfigContext";
import { useRosterSync } from "../context/RosterSyncContext";
import type { RosterResponse, Staff, CallAssignment, DayRoster, CallTypeConfig, RankConfig } from "../types";
import { monthName } from "../utils";
import ExportButton from "../components/ExportButton";

interface CallDragState {
  staffId: number;
  staffName: string;
  date: string;
  fromSlot: string; // call_type the staff is being dragged FROM
}

export default function CallRosterView() {
  const { active } = useConfig();
  const { syncVersion, bump } = useRosterSync();
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
  const [undoStack, setUndoStack] = useState<CallAssignment[][]>([]);
  const [warningsCollapsed, setWarningsCollapsed] = useState(false);
  const [swapViolations, setSwapViolationsRaw] = useState<{ date: string; messages: string[] }[]>(() => {
    try { return JSON.parse(localStorage.getItem(`call-warnings-${active?.id ?? 0}`) ?? "[]"); } catch { return []; }
  });

  const configId = active?.id ?? 0;
  const warningsKey = `call-warnings-${configId}`;

  function setSwapViolations(val: { date: string; messages: string[] }[] | ((prev: { date: string; messages: string[] }[]) => { date: string; messages: string[] }[])) {
    setSwapViolationsRaw((prev) => {
      const next = typeof val === "function" ? val(prev) : val;
      try { localStorage.setItem(warningsKey, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  useEffect(() => {
    api.getMOStaff().then(setAllStaff);
    api.getCallTypes().then(setCallTypes);
    api.getRanks().then(setRanks);
  }, []);

  async function loadRoster() {
    if (!configId) return;
    const data = await api.viewCallRoster(configId).catch(() => null);
    if (data) setRoster(data);
    const a = await api.getAssignments(configId).catch(() => []);
    setAssignments(a);
  }

  useEffect(() => {
    setRoster(null);
    setAssignments([]);
    if (!configId) return;
    loadRoster();
    try {
      const saved = JSON.parse(localStorage.getItem(`call-warnings-${configId}`) ?? "[]");
      setSwapViolationsRaw(saved);
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configId, syncVersion]);

  async function generate() {
    if (!configId) return;
    setLoading(true);
    setError("");
    setSwapViolations([]);
    try {
      await api.generateCallRoster(configId);
      await api.generateDutyRoster(configId);
    } catch (e: any) {
      // Duty generation may fail if no templates — not fatal for call roster
    }
    try {
      const data = await api.viewCallRoster(configId);
      setRoster(data);
      const a = await api.getAssignments(configId);
      setAssignments(a);
      bump();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSwapViolations([]);
      setLoading(false);
    }
  }

  async function exportFile(format: "full" | "clean") {
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

  function snapshotAssignments() {
    setUndoStack((prev) => [...prev.slice(-19), [...assignments]]);
  }

  async function handleUndo() {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    try {
      await api.restoreCallAssignments(
        configId,
        prev.map((a) => ({
          date: a.date,
          staff_id: a.staff_id,
          call_type: a.call_type,
          is_manual_override: a.is_manual_override,
        })),
      );
      await loadRoster();
      bump();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleResetAll() {
    if (!window.confirm("Reset all call roster assignments and regenerate from scratch?")) return;
    setLoading(true);
    setError("");
    try {
      await api.deleteAllCallAssignments(configId);
      await api.generateCallRoster(configId);
      await api.generateDutyRoster(configId).catch(() => {/* ignore */});
      await loadRoster();
      setUndoStack([]);
      setSwapViolations([]);
      bump();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // Applies the swap with force=true and surfaces any violations inline, grouped by date.
  async function performSwap(date: string, slot: string, toStaffId: number, fromStaffId: number | null): Promise<boolean> {
    try {
      const resp = await api.swapCallAssignment(configId, {
        date, call_type: slot,
        from_staff_id: fromStaffId,
        to_staff_id: toStaffId,
        force: true,
      });
      if (resp.violations.length > 0) {
        setSwapViolations((prev) => {
          const existing = prev.find((v) => v.date === date);
          if (existing) {
            return prev.map((v) =>
              v.date === date ? { ...v, messages: [...v.messages, ...resp.violations] } : v
            );
          }
          return [...prev, { date, messages: resp.violations }];
        });
      }
      return resp.ok;
    } catch (e: any) {
      setError(e.message);
      return false;
    }
  }

  async function handleOverride(staffId: number) {
    if (!editCell) return;
    snapshotAssignments();
    const fromAssignment = assignments.find(
      (a) => a.date === editCell.date && a.call_type === editCell.slot
    );
    const ok = await performSwap(editCell.date, editCell.slot, staffId, fromAssignment?.staff_id ?? null);
    if (ok) {
      const staffName = allStaff.find((s) => s.id === staffId)?.name || "";
      applyLocalSlotUpdate(editCell.date, editCell.slot, staffName);
      await refreshAssignments();
      bump();
    }
    setEditCell(null);
  }

  async function handleClear() {
    if (!editCell) return;
    snapshotAssignments();
    try {
      await api.removeOverride(configId, editCell.date, editCell.slot);
      await refreshAssignments();
      applyLocalSlotUpdate(editCell.date, editCell.slot, null);
      bump();
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
    if (drag.date === targetDate && drag.fromSlot === targetSlot) return;
    snapshotAssignments();

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

    // 2. Move displaced staff into source slot (or clear source if target was empty)
    if (targetAssignment) {
      const ok2 = await performSwap(
        drag.date, drag.fromSlot, targetAssignment.staff_id, drag.staffId,
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
        await api.removeOverride(configId, drag.date, drag.fromSlot);
      } catch {
        /* ignore */
      }
    }

    await refreshAssignments();
    const data = await api.viewCallRoster(configId).catch(() => null);
    if (data) setRoster(data);
    bump();
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

  const callColumns = (roster?.call_type_columns ?? []).filter(
    (c) => c !== "Ward MO" && c !== "EOT MO"
  );
  const rankGroups = roster?.call_type_rank_groups ?? {};
  const tierOrder = (g: string) => g === "Consultant" ? 0 : g === "Registrar" ? 1 : 2;
  const isTierBoundary = (col: string, i: number) =>
    i > 0 && tierOrder(rankGroups[col] ?? "") !== tierOrder(rankGroups[callColumns[i - 1]] ?? "");

  return (
    <>
      <div className="page-header">
        <h2>Call Roster {roster ? `- ${monthName(roster.month)} ${roster.year}` : ""}</h2>
        <div className="btn-group">
          {roster && (
            <>
              <button className="btn btn-secondary" onClick={handleUndo} disabled={undoStack.length === 0} title="Undo last change">
                Undo
              </button>
              <button className="btn btn-danger" onClick={handleResetAll} disabled={loading}>
                Reset All
              </button>
              <ExportButton onExport={exportFile} />
            </>
          )}
          <button className="btn btn-primary" onClick={generate} disabled={loading}>
            {loading ? <><span className="spinner" /> Generating...</> : "Generate Roster"}
          </button>
        </div>
      </div>

      {error && <div className="violations"><h4>Error</h4><p>{error}</p></div>}

      {(() => {
        const swapCount = swapViolations.reduce((n, v) => n + v.messages.length, 0);
        const solverViolations = roster?.violations ?? [];
        const total = swapCount + solverViolations.length;
        if (total === 0) return null;
        return (
          <div className="violations" style={{ background: "#fef3c7", borderColor: "#fcd34d", color: "#92400e" }}>
            <button
              onClick={() => setWarningsCollapsed((c) => !c)}
              style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", fontWeight: 700, fontSize: 14, padding: 0, display: "flex", alignItems: "center", gap: 6, marginBottom: warningsCollapsed ? 0 : 6 }}
            >
              {warningsCollapsed ? "▶" : "▼"} Warnings ({total})
            </button>
            {!warningsCollapsed && (
              <>
                {solverViolations.length > 0 && solverViolations.map((v, i) => (
                  <div key={i} style={{ marginBottom: 4 }}>
                    <strong style={{ fontSize: 12 }}>Solver</strong>
                    <ul style={{ margin: "2px 0 0", paddingLeft: 18 }}><li style={{ fontSize: 12 }}>{v}</li></ul>
                  </div>
                ))}
                {swapViolations.sort((a, b) => a.date.localeCompare(b.date)).map(({ date, messages }) => (
                  <div key={date} style={{ marginBottom: 6 }}>
                    <strong style={{ fontSize: 12 }}>{date}</strong>
                    <div style={{ marginTop: 3 }}>
                      {messages.map((m, i) => {
                        const tag = m.includes("already assigned") ? "Already assigned"
                          : m.includes("on leave") ? "On leave"
                          : m.includes("post-call") ? "Post-call"
                          : m.includes("not eligible") ? "Ineligible rank"
                          : m.includes("not applicable") ? "Applicable day"
                          : m.includes("max consecutive") ? "Max consecutive"
                          : m.includes("insufficient gap") ? "Min gap"
                          : m.includes("switch window") || m.includes("different overnight") ? "Switch window"
                          : m.includes("mutually exclusive") ? "Mutual exclusion"
                          : m.includes("cannot complete") ? "Min consecutive"
                          : "Violation";
                        return (
                          <div key={i} style={{ display: "flex", gap: 12, marginBottom: 2 }}>
                            <span style={{ fontSize: 11, fontWeight: 600, minWidth: 120, flexShrink: 0, opacity: 0.65, paddingTop: 1 }}>{tag}</span>
                            <span style={{ fontSize: 12 }}>{m}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        );
      })()}

      {roster && (
        <>
          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "8px 0" }}>
            Drag a name onto any cell to swap (within a row or across days). Click a cell to override or clear via menu. Constraint violations are logged in Warnings above.
          </p>

          <div className="card" style={{ marginTop: 4 }}>
            <div className="table-wrap">
              <table className="roster-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Day</th>
                    <th style={{ borderLeft: "2px solid var(--border)" }}>Consultant</th>
                    <th>AC</th>
                    {callColumns.map((col, i) => (
                      <th key={col} style={(i === 0 || isTierBoundary(col, i)) ? { borderLeft: "2px solid var(--border)" } : undefined}>{col}</th>
                    ))}
                    <th style={{ borderLeft: "2px solid var(--border)" }}>Ward MO</th>
                    <th>EOT MO</th>
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
                      <td style={{ borderLeft: "2px solid var(--border)" }}>{day.consultant_oncall || "-"}</td>
                      <td>{day.ac_oncall || "-"}</td>
                      {callColumns.map((slot, si) => {
                        const val = getSlotValue(day, slot);
                        const over = isOverride(day.date, slot);
                        const ca = assignments.find((a) => a.date === day.date && a.call_type === slot);
                        const zoneKey = `${day.date}_${slot}`;
                        const isDragOver = dragOver === zoneKey;
                        const cellStyle: React.CSSProperties = {
                          ...((si === 0 || isTierBoundary(slot, si)) ? { borderLeft: "2px solid var(--border)" } : {}),
                          ...(isDragOver ? { outline: "2px dashed #6366f1", outlineOffset: -2 } : {}),
                        };
                        return (
                          <td
                            key={slot}
                            className={`editable ${slot === callColumns[0] ? "mo1" : ""} ${over ? "override" : ""} ${!val ? "empty" : ""}`}
                            style={cellStyle}
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
                                title={ca ? "Drag to any cell to swap" : undefined}
                              >
                                {val}
                              </span>
                            ) : (
                              "-"
                            )}
                          </td>
                        );
                      })}
                      <td style={{ borderLeft: "2px solid var(--border)", fontSize: 11, color: "var(--text-muted)" }}>
                        {day.ward_mo.length > 0 ? day.ward_mo.join(", ") : "-"}
                      </td>
                      <td style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {day.eot_mo.length > 0 ? day.eot_mo.join(", ") : "-"}
                      </td>
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

