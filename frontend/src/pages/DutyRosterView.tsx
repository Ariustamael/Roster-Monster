import React, { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useConfig } from "../context/ConfigContext";
import { useRosterSync } from "../context/RosterSyncContext";
import type { DutyRosterResponse, DayDutyRoster, DutyAssignment, CallAssignment, Staff, RankConfig } from "../types";
import { monthName } from "../utils";
import DayResourcesModal from "../components/DayResourcesModal";
import LegendModal from "../components/LegendModal";
import ExportButton from "../components/ExportButton";

interface DragState {
  kind: "duty" | "call";
  duplicate: boolean; // true = don't remove original
  // duty drag fields
  assignmentId?: number;
  // call drag fields
  callSlot?: string;
  // shared
  staffId: number;
  staffName: string;
  date: string;
}

export default function DutyRosterView() {
  const { active } = useConfig();
  const { syncVersion, bump } = useRosterSync();
  const [roster, setRoster] = useState<DutyRosterResponse | null>(null);
  const [callAssignments, setCallAssignments] = useState<CallAssignment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const dragRef = useRef<DragState | null>(null);
  // Operation history for undo. Each entry is one mutation:
  //   { date: "YYYY-MM-DD", days: [snapshotOfThatDay] }    — single-day op
  //   { date: "all",        days: [snapshotsOfAllDays]  }  — month-wide op (Reset All)
  type HistoryEntry = { date: string; days: DayDutyRoster[] };
  const historyRef = useRef<HistoryEntry[]>([]);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());
  const [editingDay, setEditingDay] = useState<string | null>(null);
  const [showLegend, setShowLegend] = useState(false);
  const [hoveredName, setHoveredName] = useState<string | null>(null);
  const [filterName, setFilterName] = useState("");
  const [showMyRoster, setShowMyRoster] = useState(false);
  const [myRosterName, setMyRosterName] = useState("");
  const [staffRankOrder, setStaffRankOrder] = useState<Map<number, number>>(new Map());

  function bumpHistoryVersion() { setHistoryVersion(v => v + 1); }

  function snapshotDayForUndo(date: string) {
    if (!roster) return;
    const day = roster.days.find(d => d.date === date);
    if (!day) return;
    historyRef.current.push({ date, days: [JSON.parse(JSON.stringify(day))] });
    if (historyRef.current.length > 50) historyRef.current.shift();
    bumpHistoryVersion();
  }

  function snapshotMonthForUndo() {
    if (!roster) return;
    historyRef.current.push({
      date: "all",
      days: JSON.parse(JSON.stringify(roster.days)),
    });
    if (historyRef.current.length > 50) historyRef.current.shift();
    bumpHistoryVersion();
  }

  // Flatten DayDutyRoster snapshots → restore payload.
  function flattenDays(days: DayDutyRoster[]) {
    const rows: Array<{
      date: string; staff_id: number; session: string; duty_type: string;
      location: string | null; consultant_id: number | null; is_manual_override: boolean;
    }> = [];
    for (const day of days) {
      const groups = [
        day.ot_assignments, day.eot_assignments,
        day.am_clinics, day.pm_clinics,
        day.am_admin, day.pm_admin,
      ];
      for (const g of groups) {
        for (const a of g) {
          if (!a.id || a.id <= 0) continue; // skip auto-derived rows (id=0)
          rows.push({
            date: a.date,
            staff_id: a.staff_id,
            session: a.session,
            duty_type: a.duty_type,
            location: a.location ?? null,
            consultant_id: a.consultant_id ?? null,
            is_manual_override: !!a.is_manual_override,
          });
        }
      }
    }
    return rows;
  }

  // How many undo steps available for a given date (used to enable/disable buttons).
  function undoCountForDate(date: string) {
    return historyRef.current.filter(h => h.date === date || h.date === "all").length;
  }
  // Per-day collapse state for Admin / Unavailable columns. Map<date, Set<col>>.
  // Persisted to localStorage as { date: ["admin", "unavailable"], ... }.
  const [dayCollapsedCols, setDayCollapsedCols] = useState<Map<string, Set<string>>>(() => {
    try {
      const raw = localStorage.getItem("duty-roster-collapsed-by-day");
      if (raw) {
        const obj = JSON.parse(raw) as Record<string, string[]>;
        return new Map(Object.entries(obj).map(([k, v]) => [k, new Set(v)]));
      }
    } catch { /* ignore */ }
    return new Map();
  });
  // Track which dates have had defaults applied so we don't override user edits.
  const initializedDatesRef = useRef<Set<string>>(new Set());

  function persistDayCollapsedCols(map: Map<string, Set<string>>) {
    try {
      const obj: Record<string, string[]> = {};
      map.forEach((v, k) => { if (v.size > 0) obj[k] = [...v]; });
      localStorage.setItem("duty-roster-collapsed-by-day", JSON.stringify(obj));
    } catch { /* ignore */ }
  }

  // Compute the collapse-state for a date. Falls back to weekend/PH defaults
  // when the user hasn't explicitly toggled this day.
  function getColsForDay(date: string, isOff: boolean): Set<string> {
    const stored = dayCollapsedCols.get(date);
    if (stored) return stored;
    return isOff ? new Set(["admin", "unavailable"]) : new Set();
  }

  function toggleColForDay(date: string, col: string) {
    setDayCollapsedCols((prev) => {
      const next = new Map(prev);
      const set = new Set(prev.get(date) ?? []);
      if (set.has(col)) set.delete(col); else set.add(col);
      next.set(date, set);
      persistDayCollapsedCols(next);
      return next;
    });
  }

  // Apply a column toggle to ALL days in the current roster (used by the page-
  // level Hide/Show buttons).
  function toggleColAllDays(col: string) {
    if (!roster) return;
    // If any day has this col collapsed, the action is "show all". Otherwise "hide all".
    const anyCollapsed = roster.days.some(d => (dayCollapsedCols.get(d.date) ?? new Set()).has(col));
    setDayCollapsedCols((prev) => {
      const next = new Map(prev);
      for (const d of roster.days) {
        const set = new Set(prev.get(d.date) ?? []);
        if (anyCollapsed) set.delete(col); else set.add(col);
        next.set(d.date, set);
      }
      persistDayCollapsedCols(next);
      return next;
    });
  }

  const configId = active?.id ?? 0;

  async function refreshCalls() {
    if (!configId) return;
    try {
      const ca = await api.getAssignments(configId);
      setCallAssignments(ca);
    } catch { /* ignore */ }
  }

  useEffect(() => {
    setRoster(null);
    setCallAssignments([]);
    if (!configId) return;
    api.viewDutyRoster(configId).catch(() => null).then((data) => {
      if (data) setRoster(data);
    });
    refreshCalls();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configId, syncVersion]);

  useEffect(() => {
    Promise.all([api.getStaff(), api.getRanks()]).then(([staff, ranks]: [Staff[], RankConfig[]]) => {
      const rankOrder = new Map(ranks.map(r => [r.name, r.display_order]));
      const map = new Map(staff.map(s => [s.id, rankOrder.get(s.rank) ?? 999]));
      setStaffRankOrder(map);
    }).catch(() => {});
  }, []);

  async function generate() {
    if (!configId) return;
    setLoading(true);
    setError("");
    try {
      await api.generateCallRoster(configId);
    } catch {
      // Call roster may fail — not fatal if duty-only mode
    }
    try {
      const data = await api.generateDutyRoster(configId);
      setRoster(data);
      await refreshCalls();
      bump();
    } catch (e: any) {
      setError(e.message);
    } finally {
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

  async function handleDrop(
    targetDutyType: string,
    targetSession: string,
    targetLocation: string | null,
    targetConsultantId: number | null,
    targetDate: string,
    targetClinicType: string | null,
  ) {
    const drag = dragRef.current;
    if (!drag || drag.date !== targetDate) return;

    // Call drags onto duty zones ALWAYS duplicate — the person keeps their call
    // role AND gets the duty too. Duty drags move by default; the ⧉ copy icon
    // sets drag.duplicate=true to make it a duplicate instead.
    const shouldDuplicate = drag.kind === "call" || drag.duplicate;

    snapshotDayForUndo(targetDate);
    try {
      // Always apply the drop; constraint violations surface inline as day-card comments,
      // computed server-side by /duties/view.
      await api.swapDutyAssignment(configId, {
        date: targetDate,
        duty_type: targetDutyType,
        session: targetSession,
        location: targetLocation,
        consultant_id: targetConsultantId,
        clinic_type: targetClinicType,
        to_staff_id: drag.staffId,
        old_assignment_id: shouldDuplicate ? null : (drag.assignmentId && drag.assignmentId > 0 ? drag.assignmentId : null),
        duplicate: shouldDuplicate,
        force: true,
      });
      const data = await api.viewDutyRoster(configId);
      setRoster(data);
      bump();
    } catch (e: any) {
      setError(e.message);
    }
    dragRef.current = null;
  }

  async function handleCallDrop(targetSlot: string, targetDate: string) {
    const drag = dragRef.current;
    if (!drag || drag.kind !== "call" || drag.date !== targetDate) return;
    if (drag.callSlot === targetSlot) {
      dragRef.current = null;
      return;
    }
    // Find the current holder of the target slot (if any) to swap into source slot
    const targetAssignment = callAssignments.find(
      (a) => a.date === targetDate && a.call_type === targetSlot,
    );
    snapshotDayForUndo(targetDate);
    try {
      // Dragged staff → target slot
      await api.setOverride(configId, targetDate, targetSlot, drag.staffId);
      // If target had someone AND we're moving from a real source slot, swap them in
      if (targetAssignment && drag.callSlot) {
        await api.setOverride(configId, targetDate, drag.callSlot, targetAssignment.staff_id);
      } else if (drag.callSlot) {
        // No one in target → source slot becomes empty
        await api.removeOverride(configId, targetDate, drag.callSlot);
      }
      await refreshCalls();
      // Duty roster derives from call assignments (Ward MO etc.), refresh it too
      const data = await api.viewDutyRoster(configId).catch(() => null);
      if (data) setRoster(data);
      bump();
    } catch (e: any) {
      setError(e.message);
    }
    dragRef.current = null;
  }

  async function handleRegenerateDay(targetDate: string) {
    if (!configId) return;
    if (!window.confirm(`Reset and re-solve ${targetDate}? ALL duty assignments for this date (including any manual drag-and-drop changes) will be wiped and re-solved from scratch.`)) {
      return;
    }
    snapshotDayForUndo(targetDate);
    try {
      const data = await api.regenerateDutyDay(configId, targetDate);
      setRoster(data);
      bump();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleResetAll() {
    if (!configId) return;
    if (!window.confirm("Reset and re-solve the WHOLE month? Every duty assignment (manual + solver) for this month will be wiped and re-solved from scratch.")) {
      return;
    }
    snapshotMonthForUndo();
    try {
      await api.resetAllDutyAssignments(configId);
      const data = await api.generateDutyRoster(configId);
      setRoster(data);
      bump();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleUndo() {
    // Pops the most recent op (any day or month-wide) and restores it.
    const stack = historyRef.current;
    if (stack.length === 0) return;
    const op = stack.pop()!;
    bumpHistoryVersion();
    try {
      const rows = flattenDays(op.days);
      const targetDate = op.date === "all" ? undefined : op.date;
      await api.restoreDutyAssignments(configId, rows, targetDate);
      const data = await api.viewDutyRoster(configId);
      setRoster(data);
      bump();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleUndoDay(date: string) {
    // Pops the most recent op affecting this date (per-day or month-wide).
    const stack = historyRef.current;
    for (let i = stack.length - 1; i >= 0; i--) {
      const op = stack[i];
      if (op.date === date || op.date === "all") {
        stack.splice(i, 1);
        bumpHistoryVersion();
        try {
          const dayDays = op.date === "all"
            ? op.days.filter(d => d.date === date)
            : op.days;
          await api.restoreDutyAssignments(configId, flattenDays(dayDays), date);
          const data = await api.viewDutyRoster(configId);
          setRoster(data);
          bump();
        } catch (e: any) {
          setError(e.message);
        }
        return;
      }
    }
  }

  async function handleRemoveToAdmin(assignmentId: number, _staffId: number, date: string, _currentSession: string) {
    // × clears the assignment. Free MOs are auto-derived back into the Admin column server-side.
    snapshotDayForUndo(date);
    try {
      if (assignmentId && assignmentId > 0) {
        await api.deleteDutyOverride(configId, assignmentId);
      }
      const data = await api.viewDutyRoster(configId);
      setRoster(data);
      bump();
    } catch (e: any) {
      setError(e.message);
    }
  }

  if (!active) return <p style={{ color: "var(--text-muted)" }}>Select a month in the sidebar.</p>;

  const filterTerm = filterName.trim().toLowerCase();
  const effectiveCollapsed = filterTerm
    ? new Set(
        roster?.days
          .filter((d) => !dayContainsName(d, filterTerm))
          .map((d) => d.date) ?? []
      )
    : collapsedDays;

  const callColumns = roster?.call_type_columns ?? [];
  const rankGroups = roster?.call_type_rank_groups ?? {};
  const _now = new Date();
  const today = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;

  return (
    <>
      <div className="page-header">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h2>Duty Roster {roster ? `- ${monthName(roster.month)} ${roster.year}` : ""}</h2>
        </div>
        <div className="btn-group">
          {roster && (
            <>
              <button
                className="btn btn-secondary"
                onClick={handleUndo}
                disabled={historyRef.current.length === 0}
                title={historyRef.current.length === 0 ? "No actions to undo" : `Undo last change (${historyRef.current.length} in history)`}
              >Undo</button>
              <button className="btn btn-danger" onClick={handleResetAll} title="Wipe ALL duty assignments for the month and re-solve from scratch">Reset All</button>
              <ExportButton onExport={exportFile} />
            </>
          )}
          <button className="btn btn-primary" onClick={generate} disabled={loading}>
            {loading ? <><span className="spinner" /> Generating...</> : "Generate Roster"}
          </button>
        </div>
      </div>

      {error && <div className="violations"><h4>Error</h4><p>{error}</p></div>}

      {roster && (
        <>
          {/* View controls — compact secondary toolbar */}
          {(() => {
            const allDaysCollapsed = roster.days.every(d => collapsedDays.has(d.date));
            const weekendDates = roster.days.filter(d => d.is_weekend || d.is_ph).map(d => d.date);
            const weekendsCollapsed = weekendDates.length > 0 && weekendDates.every(d => collapsedDays.has(d));
            const adminHidden = roster.days.every(d => getColsForDay(d.date, d.is_weekend || d.is_ph).has("admin"));
            const unavailHidden = roster.days.every(d => getColsForDay(d.date, d.is_weekend || d.is_ph).has("unavailable"));
            const pillActive = { background: "#dbeafe", color: "#1d4ed8", border: "1px solid #93c5fd" };
            const pillInactive = { background: "var(--surface)", color: "var(--text-muted)", border: "1px solid var(--border)" };
            const pillBase = { fontSize: 11, padding: "2px 8px", borderRadius: 4, cursor: "pointer", fontWeight: 500 } as const;
            const scrollToday = () => {
              const _now = new Date();
              const today = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;
              const target = roster.days.find(d => d.date === today)?.date ?? roster.days[0]?.date;
              if (!target) return;
              setCollapsedDays(prev => { const next = new Set(prev); next.delete(target); return next; });
              setTimeout(() => document.getElementById(`day-${target}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
            };
            const pillToday = { background: "#16a34a", color: "#fff", border: "1px solid #15803d" };
            return (
              <div style={{ display: "flex", gap: 6, alignItems: "center", margin: "6px 0" }}>
                {/* Left: search + My Roster + Today */}
                <input
                  type="text"
                  placeholder="Find person..."
                  value={filterName}
                  onChange={(e) => setFilterName(e.target.value)}
                  style={{
                    padding: "2px 8px", fontSize: 11,
                    border: "1px solid var(--border)", borderRadius: 4,
                    width: 130, background: "var(--surface)", color: "var(--text)",
                    outline: filterName ? "2px solid var(--primary)" : undefined,
                  }}
                />
                {filterName && (
                  <button style={{ ...pillBase, ...pillInactive, fontWeight: 700 }} onClick={() => setFilterName("")}>×</button>
                )}
                <button
                  style={{ ...pillBase, ...pillInactive }}
                  onClick={() => { setMyRosterName(filterName.trim()); setShowMyRoster(true); }}
                  title="Generate a personal roster summary for one staff member"
                >My Roster</button>
                <button style={{ ...pillBase, ...pillToday }} onClick={scrollToday} title="Scroll to today">Today</button>

                <span style={{ flex: 1 }} />

                {/* Right: view toggles */}
                <button style={{ ...pillBase, ...(adminHidden ? pillInactive : pillActive) }} onClick={() => toggleColAllDays("admin")} title="Show/hide Admin column">Admin</button>
                <button style={{ ...pillBase, ...(unavailHidden ? pillInactive : pillActive) }} onClick={() => toggleColAllDays("unavailable")} title="Show/hide Unavailable column">Unavail</button>
                <button style={{ ...pillBase, ...(weekendsCollapsed ? pillInactive : pillActive) }} onClick={() => {
                  setCollapsedDays(prev => {
                    const next = new Set(prev);
                    if (!weekendsCollapsed) weekendDates.forEach(d => next.add(d));
                    else weekendDates.forEach(d => next.delete(d));
                    return next;
                  });
                }} title="Collapse/expand weekends and public holidays">Weekends</button>
                <button style={{ ...pillBase, ...pillInactive }} onClick={() => allDaysCollapsed ? setCollapsedDays(new Set()) : setCollapsedDays(new Set(roster.days.map(d => d.date)))}>
                  {allDaysCollapsed ? "⊞ Expand All" : "⊟ Collapse All"}
                </button>
                <button style={{ ...pillBase, ...pillInactive, fontWeight: 700 }} onClick={() => setShowLegend(true)} title="Show colour legend">?</button>
              </div>
            );
          })()}


          {/* Sticky day navigator — click a chip to jump */}
          <div style={{
            position: "sticky", top: 0, zIndex: 5,
            background: "var(--surface)", padding: "6px 0", marginBottom: 8,
            borderBottom: "1px solid var(--border)",
            display: "flex", gap: 4, flexWrap: "wrap",
          }}>
            {roster.days.map((d) => {
              const dd = d.date.slice(-2);
              const isOff = d.is_weekend || d.is_ph;
              return (
                <a
                  key={d.date}
                  href={`#day-${d.date}`}
                  onClick={(e) => {
                    e.preventDefault();
                    const el = document.getElementById(`day-${d.date}`);
                    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                    setCollapsedDays((prev) => {
                      const next = new Set(prev);
                      next.delete(d.date);
                      return next;
                    });
                  }}
                  style={{
                    fontSize: 11, padding: "3px 8px", borderRadius: 4,
                    textDecoration: "none",
                    background: d.date === today ? "var(--surface)" : isOff ? "var(--sem-weekend)" : "var(--bg-muted, #f8fafc)",
                    color: d.date === today ? "var(--primary)" : isOff ? "var(--sem-weekend-text)" : "var(--text)",
                    border: d.date === today ? "2px solid var(--primary)" : "1px solid var(--border)",
                    fontWeight: d.date === today ? 700 : undefined,
                    display: "inline-flex", alignItems: "center", gap: 4,
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{dd}</span>
                  <span style={{ color: "var(--text-muted)", fontSize: 10 }}>{d.day_name}</span>
                </a>
              );
            })}
          </div>

          {roster.days
            .map((day) => (
              <DayCard
                key={day.date}
                day={day}
                callColumns={callColumns}
                callAssignments={callAssignments.filter(ca => ca.date === day.date)}
                dragRef={dragRef}
                onDrop={handleDrop}
                onCallDrop={handleCallDrop}
                onRemove={handleRemoveToAdmin}
                onRegenerateDay={handleRegenerateDay}
                onEditDayResources={(date) => setEditingDay(date)}
                onUndoDay={handleUndoDay}
                undoCount={undoCountForDate(day.date)}
                isToday={day.date === today}
                rankGroups={rankGroups}
                collapsed={effectiveCollapsed.has(day.date)}
                onToggleCollapse={() => setCollapsedDays(prev => {
                  const next = new Set(prev);
                  if (next.has(day.date)) next.delete(day.date); else next.add(day.date);
                  return next;
                })}
                collapsedCols={getColsForDay(day.date, day.is_weekend || day.is_ph)}
                onToggleCol={(col) => toggleColForDay(day.date, col)}
                hoveredName={hoveredName}
                onHoverName={setHoveredName}
                filterTerm={filterTerm}
                staffRankOrder={staffRankOrder}
              />
            ))}
        </>
      )}
      {showLegend && <LegendModal onClose={() => setShowLegend(false)} />}
      {showMyRoster && roster && (
        <MyRosterModal
          roster={roster}
          initialName={myRosterName}
          onClose={() => setShowMyRoster(false)}
        />
      )}
      {editingDay && (
        <DayResourcesModal
          date={editingDay}
          onClose={() => setEditingDay(null)}
          onSaved={async () => {
            const data = await api.viewDutyRoster(configId).catch(() => null);
            if (data) setRoster(data);
          }}
        />
      )}
    </>
  );
}

function dayContainsName(day: DayDutyRoster, term: string): boolean {
  const names: (string | null | undefined)[] = [
    day.consultant_oncall,
    day.ac_oncall,
    ...Object.values(day.call_slots),
    ...day.ot_assignments.map((a) => a.staff_name),
    ...day.eot_assignments.map((a) => a.staff_name),
    ...day.am_clinics.map((a) => a.staff_name),
    ...day.pm_clinics.map((a) => a.staff_name),
    ...day.am_admin.map((a) => a.staff_name),
    ...day.pm_admin.map((a) => a.staff_name),
    ...day.unavailable.map((u) => u.staff_name),
  ];
  return names.some((n) => n?.toLowerCase().includes(term));
}

function sortByRankAlpha(arr: DutyAssignment[], rankOrder: Map<number, number>): DutyAssignment[] {
  return [...arr].sort((a, b) => {
    const ra = rankOrder.get(a.staff_id) ?? 999;
    const rb = rankOrder.get(b.staff_id) ?? 999;
    if (ra !== rb) return ra - rb;
    return a.staff_name.localeCompare(b.staff_name);
  });
}

function DayCard({
  day, callColumns, callAssignments, dragRef, onDrop, onCallDrop, onRemove, onRegenerateDay, onEditDayResources, onUndoDay, undoCount, isToday, rankGroups, collapsed, onToggleCollapse,
  collapsedCols, onToggleCol, hoveredName, onHoverName, filterTerm, staffRankOrder,
}: {
  day: DayDutyRoster;
  callColumns: string[];
  callAssignments: CallAssignment[];
  dragRef: React.MutableRefObject<DragState | null>;
  onDrop: (dutyType: string, session: string, location: string | null, consultantId: number | null, date: string, clinicType: string | null) => void;
  onCallDrop: (targetSlot: string, date: string) => void;
  onRemove: (assignmentId: number, staffId: number, date: string, session: string) => void;
  onRegenerateDay: (date: string) => void;
  onEditDayResources: (date: string) => void;
  onUndoDay: (date: string) => void;
  undoCount: number;
  isToday: boolean;
  rankGroups: Record<string, string>;
  collapsed: boolean;
  onToggleCollapse: () => void;
  collapsedCols: Set<string>;
  onToggleCol: (col: string) => void;
  hoveredName: string | null;
  onHoverName: (name: string | null) => void;
  filterTerm: string;
  staffRankOrder: Map<number, number>;
}) {
  const [dragOver, setDragOver] = useState<string | null>(null);

  const otGroups: Record<string, { consultant: string | null; consultantId: number | null; staff: DutyAssignment[] }> = {};
  for (const a of day.ot_assignments) {
    const key = a.location || "OT";
    if (!otGroups[key]) otGroups[key] = { consultant: a.consultant_name, consultantId: a.consultant_id, staff: [] };
    otGroups[key].staff.push(a);
  }

  const eotGroups: Record<string, { consultantId: number | null; staff: DutyAssignment[] }> = {};
  for (const a of day.eot_assignments) {
    if (a.duty_type === "EOT MO" || a.duty_type === "Ward MO") continue;
    const key = a.location || "EOT";
    if (!eotGroups[key]) eotGroups[key] = { consultantId: a.consultant_id, staff: [] };
    eotGroups[key].staff.push(a);
  }

  const clinicAm = day.am_clinics;
  const wardMo = [...day.ot_assignments, ...day.eot_assignments].filter((a) => a.duty_type === "Ward MO");
  const eotMo = [...day.ot_assignments, ...day.eot_assignments].filter((a) => a.duty_type === "EOT MO");
  const clinicPm = day.pm_clinics;

  // Group clinics by (room + consultant + label) so distinct templates that share
  // the same room and have no consultant (e.g. MOPD vs Hand VC, both room="-") still
  // render as separate rows.
  type ClinicGroup = { room: string; consultantId: number | null; clinicType: string; staff: DutyAssignment[] };
  const clinicGroupKey = (room: string, cid: number | null, clinicType: string) =>
    `${room}|${cid ?? "null"}|${clinicType || ""}`;
  const buildGroups = (rows: DutyAssignment[]): ClinicGroup[] => {
    const map = new Map<string, ClinicGroup>();
    const order: ClinicGroup[] = [];
    for (const a of rows) {
      const room = a.location || "";
      const ct = a.clinic_type || "";
      const key = clinicGroupKey(room, a.consultant_id, ct);
      let g = map.get(key);
      if (!g) {
        g = { room, consultantId: a.consultant_id, clinicType: ct, staff: [] };
        map.set(key, g);
        order.push(g);
      }
      g.staff.push(a);
    }
    return order;
  };
  const clinicAmGroups = buildGroups(clinicAm);
  const clinicPmGroups = buildGroups(clinicPm);
  const amAssignedKeys = new Set(clinicAmGroups.map(g => clinicGroupKey(g.room, g.consultantId, g.clinicType)));
  const pmAssignedKeys = new Set(clinicPmGroups.map(g => clinicGroupKey(g.room, g.consultantId, g.clinicType)));

  const tierOrder = (group: string) =>
    group === "Consultant" ? 0 : group === "Registrar" ? 1 : 2;

  const moList = callColumns
    .map((col) => ({ label: col, name: day.call_slots[col] ?? "" }))
    .filter((m) => m.name)
    .sort((a, b) => tierOrder(rankGroups[a.label] ?? "") - tierOrder(rankGroups[b.label] ?? ""));

  // Pill counts for the day-header
  const otCount = day.ot_assignments.length + day.eot_assignments.length;
  const amClinicCount = day.am_clinics.length;
  const pmClinicCount = day.pm_clinics.length;
  const amAdminCount = day.am_admin.length;
  const pmAdminCount = day.pm_admin.length;
  const unavailCount = day.unavailable.length;

  // Count concurrent (overlapping) duty sessions per staff_id. AM and PM are
  // separate; Full Day / EOT / Ward MO / EOT MO count toward BOTH because they
  // span the working day. AM-clinic + PM-clinic is NOT multi-rostered (sequential).
  const amCounts = new Map<number, number>();
  const pmCounts = new Map<number, number>();
  const bumpSession = (id: number, session: string | undefined) => {
    const s = session ?? "Full Day";
    if (s === "AM") amCounts.set(id, (amCounts.get(id) || 0) + 1);
    else if (s === "PM") pmCounts.set(id, (pmCounts.get(id) || 0) + 1);
    else {
      amCounts.set(id, (amCounts.get(id) || 0) + 1);
      pmCounts.set(id, (pmCounts.get(id) || 0) + 1);
    }
  };
  for (const a of day.ot_assignments) {
    if (a.duty_type === "Ward MO" || a.duty_type === "EOT MO") continue; // anchor rows
    bumpSession(a.staff_id, a.session);
  }
  for (const a of day.eot_assignments) {
    if (a.duty_type === "Ward MO" || a.duty_type === "EOT MO") continue; // anchor rows
    bumpSession(a.staff_id, a.session);
  }
  for (const a of day.am_clinics) bumpSession(a.staff_id, a.session);
  for (const a of day.pm_clinics) bumpSession(a.staff_id, a.session);
  for (const a of day.am_admin) bumpSession(a.staff_id, a.session);
  for (const a of day.pm_admin) bumpSession(a.staff_id, a.session);
  const unavailableIds = new Set(day.unavailable.map((u) => u.staff_id));
  // Amber = real conflict (assigned while unavailable: leave/post-call)
  // Blue  = legitimate multi-roster (overlapping sessions, e.g. OT Full Day + Ward MO)
  const conflict = (id: number) => unavailableIds.has(id);
  const multiRostered = (id: number) =>
    ((amCounts.get(id) || 0) > 1 || (pmCounts.get(id) || 0) > 1) && !conflict(id);
  function tagHighlight(id: number): "conflict" | "multi" | undefined {
    if (conflict(id)) return "conflict";
    if (multiRostered(id)) return "multi";
    return undefined;
  }

  // Expected resources that have NO staff assigned right now — render as
  // placeholders so the user still has a drop target after removing everyone.
  const expected = day.expected_resources ?? [];
  const emptyOt = expected.filter(
    (r) => r.resource_type === "ot" && !r.is_emergency
      && !otGroups[r.room]
  );
  const emptyEot = expected.filter(
    (r) => r.resource_type === "ot" && r.is_emergency && !eotGroups[r.room]
  );
  const emptyAmClinics = expected.filter(
    (r) => r.resource_type === "clinic" && r.session === "AM"
      && !amAssignedKeys.has(clinicGroupKey(r.room || "", r.consultant_id, r.label || ""))
  );
  const emptyPmClinics = expected.filter(
    (r) => r.resource_type === "clinic" && r.session === "PM"
      && !pmAssignedKeys.has(clinicGroupKey(r.room || "", r.consultant_id, r.label || ""))
  );

  function dropProps(zoneKey: string, dutyType: string, session: string, location: string | null, consultantId: number | null, clinicType: string | null = null) {
    return {
      onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragOver(zoneKey); },
      onDragLeave: () => setDragOver(null),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(null);
        onDrop(dutyType, session, location, consultantId, day.date, clinicType);
      },
      style: {
        outline: dragOver === zoneKey ? "2px dashed var(--sem-drag-outline)" : undefined,
        borderRadius: 4,
        minHeight: 24,
      },
    };
  }

  return (
    <div id={`day-${day.date}`} className="card" style={{
      marginBottom: 12,
      scrollMarginTop: 48,
      borderLeft: isToday
        ? "4px solid #16a34a"
        : (day.warnings?.length ?? 0) > 0
        ? "3px solid var(--sem-conflict)"
        : (day.shortfall ?? 0) > 0
        ? "3px solid var(--sem-shortfall-text)"
        : undefined,
    }}>
      <div
        style={{
          display: "flex", alignItems: "center", gap: 12,
          marginBottom: collapsed ? 0 : 10,
          cursor: "pointer",
          position: "sticky",
          top: 44,
          zIndex: 3,
          background: "var(--surface)",
          marginLeft: -16,
          marginRight: -16,
          padding: "6px 16px",
          borderBottom: collapsed ? undefined : "1px solid var(--border)",
        }}
        onClick={onToggleCollapse}
      >
        <span style={{ fontSize: 12, color: "var(--text-muted)", width: 16, textAlign: "center" }}>{collapsed ? "▶" : "▼"}</span>
        <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
          {day.date.slice(5)} {day.day_name}
          {isToday && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 3, background: "#16a34a", color: "#fff" }}>TODAY</span>
          )}
          {(day.is_weekend || day.is_ph) && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 3, background: "var(--sem-weekend)", color: "var(--sem-weekend-text)" }}>
              {day.is_ph ? "PH" : "WEEKEND"}
            </span>
          )}
          {day.is_stepdown && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 3, background: "#ddd6fe", color: "#5b21b6" }}>SD</span>
          )}
          {day.is_ext_ot && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 3, background: "#fed7aa", color: "#9a3412" }}>ExtOT</span>
          )}
        </h3>
        <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
          {otCount > 0 && <HeaderPill label={`${otCount} OT`} bg="var(--cat-ot)" fg="var(--cat-ot-text)" />}
          {(amClinicCount + pmClinicCount) > 0 && (
            <HeaderPill
              label={`${amClinicCount}/${pmClinicCount} clinic`}
              bg="#d1fae5" fg="#065f46"
              title={`Clinics — ${amClinicCount} AM · ${pmClinicCount} PM`}
            />
          )}
          {(amAdminCount + pmAdminCount) > 0 && (
            <HeaderPill
              label={`${amAdminCount}/${pmAdminCount} admin`}
              bg="#e5e7eb" fg="#374151"
              title={`Admin — ${amAdminCount} AM · ${pmAdminCount} PM`}
            />
          )}
          {unavailCount > 0 && <HeaderPill label={`${unavailCount} unavail`} bg="var(--cat-unavail)" fg="var(--cat-unavail-text)" />}
          {(day.shortfall ?? 0) > 0 && (
            <HeaderPill label={`${day.shortfall} short`} bg="var(--sem-shortfall-bg)" fg="var(--sem-shortfall-text)" />
          )}
          {(day.warnings?.length ?? 0) > 0 && (
            <HeaderPill label={`⚠ ${day.warnings!.length}`} bg="var(--sem-warning-bg)" fg="var(--sem-weekend-text)" />
          )}
          {day.has_day_override && (
            <HeaderPill label="✎ edited" bg="#fef3c7" fg="#92400e" title="Resources have been edited for this day" />
          )}
        </span>
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}>
          <button
            onClick={(e) => { e.stopPropagation(); onUndoDay(day.date); }}
            disabled={undoCount === 0}
            title={undoCount === 0
              ? "No actions to undo for this day"
              : `Undo last change to this day (${undoCount} in history)`}
            style={{
              padding: "4px 10px", fontSize: 11, fontWeight: 600,
              border: "1px solid var(--border)", borderRadius: 4,
              background: undoCount === 0 ? "#f3f4f6" : "white",
              color: undoCount === 0 ? "#9ca3af" : "var(--text-muted)",
              cursor: undoCount === 0 ? "not-allowed" : "pointer",
            }}
          >⟲ Undo</button>
          <button
            onClick={(e) => { e.stopPropagation(); onEditDayResources(day.date); }}
            title="Add/remove/edit resources for this day only (does not change weekly schedule)"
            style={{
              padding: "4px 10px", fontSize: 11, fontWeight: 600,
              border: "1px solid var(--border)", borderRadius: 4, background: "white",
              color: "var(--text-muted)", cursor: "pointer",
            }}
          >✎ Edit Resources</button>
          <button
            onClick={(e) => { e.stopPropagation(); onRegenerateDay(day.date); }}
            title="Reset this day — wipes ALL duty assignments (including manual changes) and re-solves from scratch"
            style={{
              padding: "4px 10px", fontSize: 11, fontWeight: 600,
              border: "1px solid var(--border)", borderRadius: 4, background: "white",
              color: "var(--danger)", cursor: "pointer",
            }}
          >↺ Reset Day</button>
        </span>
      </div>

      {!collapsed && (day.warnings?.length ?? 0) > 0 && (
        <div style={{
          marginBottom: 10,
          padding: "8px 10px",
          background: "var(--sem-warning-bg)",
          border: "1px solid #fde68a",
          borderRadius: 4,
          fontSize: 12,
          color: "#78350f",
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#92400e", marginBottom: 4, letterSpacing: 0.4 }}>
            ⚠ COMMENTS
          </div>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {day.warnings!.map((w, i) => (
              <li key={i} style={{ marginBottom: 2 }}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {!collapsed && <div style={{
        display: "grid",
        gridTemplateColumns: `170px 1fr 1fr 1fr ${collapsedCols.has("admin") ? "32px" : "minmax(220px, 1.2fr)"} ${collapsedCols.has("unavailable") ? "32px" : "minmax(140px, 0.8fr)"}`,
        gap: 12,
      }}>
        {/* Column 1: Call Team */}
        <div>
          <SectionLabel label="Call Team" color="var(--cat-call)" />
          <div style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "2px 8px", marginBottom: 4, alignItems: "start" }}>
            {day.consultant_oncall && (
              <div style={{ display: "contents" }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", lineHeight: "20px" }}>Consultant</span>
                <span
                  className="duty-tag"
                  onMouseEnter={() => onHoverName(day.consultant_oncall!)}
                  onMouseLeave={() => onHoverName(null)}
                  style={{
                    background: "var(--cat-call)", color: "var(--cat-call-text)",
                    outline: (hoveredName === day.consultant_oncall || (filterTerm && day.consultant_oncall?.toLowerCase().includes(filterTerm))) ? "2px solid var(--primary)" : undefined,
                    outlineOffset: (hoveredName === day.consultant_oncall || (filterTerm && day.consultant_oncall?.toLowerCase().includes(filterTerm))) ? 1 : undefined,
                  }}
                >{day.consultant_oncall}</span>
              </div>
            )}
            {day.ac_oncall && (
              <div style={{ display: "contents" }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", lineHeight: "20px" }}>AC</span>
                <span
                  className="duty-tag"
                  onMouseEnter={() => onHoverName(day.ac_oncall!)}
                  onMouseLeave={() => onHoverName(null)}
                  style={{
                    background: "var(--cat-call)", color: "var(--cat-call-text)",
                    outline: (hoveredName === day.ac_oncall || (filterTerm && day.ac_oncall?.toLowerCase().includes(filterTerm))) ? "2px solid var(--primary)" : undefined,
                    outlineOffset: (hoveredName === day.ac_oncall || (filterTerm && day.ac_oncall?.toLowerCase().includes(filterTerm))) ? 1 : undefined,
                  }}
                >{day.ac_oncall}</span>
              </div>
            )}
            {moList.length > 0 && (day.consultant_oncall || day.ac_oncall) && (
              <div style={{ gridColumn: "1 / -1", borderTop: "1px solid var(--border)", margin: "3px 0" }} />
            )}
            {moList.map((m, i) => {
              const ca = callAssignments.find((c) => c.call_type === m.label);
              const zoneKey = `call_${m.label}`;
              const prevGroup = i > 0 ? rankGroups[moList[i - 1].label] : null;
              const thisGroup = rankGroups[m.label];
              const showDivider = i > 0 && thisGroup && prevGroup !== thisGroup;
              return (
                <div key={m.label} style={{ display: "contents" }}>
                  {showDivider && (
                    <div style={{ gridColumn: "1 / -1", borderTop: "1px solid var(--border)", margin: "3px 0" }} />
                  )}
                  <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", lineHeight: "20px" }}>{m.label}</span>
                  <div
                    style={{
                      outline: dragOver === zoneKey ? "2px dashed var(--sem-drag-outline)" : undefined,
                      borderRadius: 4,
                    }}
                    onDragOver={(e) => {
                      if (dragRef.current?.kind === "call") {
                        e.preventDefault();
                        setDragOver(zoneKey);
                      }
                    }}
                    onDragLeave={() => setDragOver(null)}
                    onDrop={(e) => {
                      if (dragRef.current?.kind === "call") {
                        e.preventDefault();
                        setDragOver(null);
                        onCallDrop(m.label, day.date);
                      }
                    }}
                  >
                    <span
                      className="duty-tag"
                      draggable={!!ca}
                      style={{
                        background: "var(--cat-call)",
                        color: "var(--cat-call-text)",
                        cursor: ca ? "grab" : "default",
                        userSelect: "none",
                        outline: (hoveredName === m.name || (filterTerm && m.name.toLowerCase().includes(filterTerm))) ? "2px solid var(--primary)" : undefined,
                        outlineOffset: (hoveredName === m.name || (filterTerm && m.name.toLowerCase().includes(filterTerm))) ? 1 : undefined,
                      }}
                      onMouseEnter={() => onHoverName(m.name)}
                      onMouseLeave={() => onHoverName(null)}
                      onDragStart={() => {
                        if (ca) {
                          dragRef.current = {
                            kind: "call",
                            duplicate: false,
                            callSlot: m.label,
                            staffId: ca.staff_id,
                            staffName: ca.staff_name,
                            date: day.date,
                          };
                        }
                      }}
                      title={ca ? "Drag to another call slot to swap" : undefined}
                    >
                      {m.name}
                      {ca?.is_manual_override && <sup style={{ fontSize: 8, color: "var(--sem-override)" }}>✎</sup>}
                    </span>
                  </div>
                </div>
              );
            })}
            {(wardMo.length > 0 || eotMo.length > 0) && (
              <div style={{ gridColumn: "1 / -1", borderTop: "1px dashed var(--border)", margin: "3px 0" }} />
            )}
            {wardMo.length > 0 && (
              <div style={{ display: "contents" }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", lineHeight: "20px" }}>Ward MO</span>
                <div {...dropProps("ward_mo", "Ward MO", "AM", null, null)} style={{ display: "flex", flexWrap: "wrap", gap: 4, minHeight: 20 }}>
                  {wardMo.map((a) => (
                    <DragTag key={`${a.id}-${a.staff_id}-${a.session}-${a.duty_type}`} a={a} date={day.date} dragRef={dragRef} onRemove={onRemove}
                      color={{ bg: "var(--cat-eot)", fg: "var(--cat-eot-text)" }} highlight={tagHighlight(a.staff_id)}
                      hoveredName={hoveredName} onHoverName={onHoverName} filterTerm={filterTerm} />
                  ))}
                </div>
              </div>
            )}
            {eotMo.length > 0 && (
              <div style={{ display: "contents" }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", lineHeight: "20px" }}>EOT MO</span>
                <div {...dropProps("eot_mo", "EOT MO", "Full Day", null, null)} style={{ display: "flex", flexWrap: "wrap", gap: 4, minHeight: 20 }}>
                  {eotMo.map((a) => (
                    <DragTag key={`${a.id}-${a.staff_id}-${a.session}-${a.duty_type}`} a={a} date={day.date} dragRef={dragRef} onRemove={onRemove}
                      color={{ bg: "var(--cat-eot)", fg: "var(--cat-eot-text)" }} highlight={tagHighlight(a.staff_id)}
                      hoveredName={hoveredName} onHoverName={onHoverName} filterTerm={filterTerm} />
                  ))}
                </div>
              </div>
            )}
          </div>
          {!day.consultant_oncall && !day.ac_oncall && moList.length === 0 && wardMo.length === 0 && eotMo.length === 0 && <EmptyNote />}
        </div>

        {/* Column 2: OT / EOT */}
        <div>
          <SectionLabel label="OT / EOT (Full Day)" color="var(--cat-ot)" />
          {Object.keys(otGroups).length === 0 && Object.keys(eotGroups).length === 0 && <EmptyNote />}
          {Object.entries(otGroups).map(([room, g]) => (
            <div key={room} style={{ marginBottom: 6 }}>
              <div
                style={{ fontSize: 11, fontWeight: 700, color: "var(--cat-ot-text)", cursor: "default" }}
                {...dropProps(`ot_${room}`, "OT", "Full Day", room, g.consultantId)}
              >
                {room} {g.consultant && <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>({g.consultant})</span>}
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {g.staff.map((a) => (
                  <DragTag key={`${a.id}-${a.staff_id}-${a.session}-${a.duty_type}`} a={a} date={day.date} dragRef={dragRef} onRemove={onRemove}
                    color={{ bg: undefined, fg: undefined }} className="duty-tag ot" highlight={tagHighlight(a.staff_id)}
                    hoveredName={hoveredName} onHoverName={onHoverName} filterTerm={filterTerm} />
                ))}
              </div>
            </div>
          ))}
          {Object.entries(eotGroups).map(([room, g]) => (
            <div key={room} style={{ marginBottom: 6 }}>
              <div
                style={{ fontSize: 11, fontWeight: 700, color: "var(--cat-eot-text)", cursor: "default" }}
                {...dropProps(`eot_${room}`, "EOT", "Full Day", room, g.consultantId)}
              >
                ⚡{room}
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {g.staff.map((a) => (
                  <DragTag key={`${a.id}-${a.staff_id}-${a.session}-${a.duty_type}`} a={a} date={day.date} dragRef={dragRef} onRemove={onRemove}
                    color={{ bg: "var(--cat-eot)", fg: "var(--cat-eot-text)" }} highlight={tagHighlight(a.staff_id)}
                    hoveredName={hoveredName} onHoverName={onHoverName} filterTerm={filterTerm} />
                ))}
              </div>
            </div>
          ))}
          {/* Empty-placeholder OTs and EOTs — still show header + drop zone */}
          {emptyOt.map((r) => (
            <EmptyResourceRow key={`empty-ot-${r.room}`} r={r} zoneKey={`ot_${r.room}`}
              dutyType="OT" session="Full Day" dropProps={dropProps} color="var(--cat-ot-text)" />
          ))}
          {emptyEot.map((r) => (
            <EmptyResourceRow key={`empty-eot-${r.room}`} r={r} zoneKey={`eot_${r.room}`}
              dutyType="EOT" session="Full Day" dropProps={dropProps} color="var(--cat-eot-text)" prefix="⚡" />
          ))}
        </div>

        {/* Column 3: AM */}
        <div>
          <SectionLabel label="AM Clinic" color="var(--cat-am)" />
          {(clinicAmGroups.length > 0 || emptyAmClinics.length > 0) && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", marginBottom: 4 }}>CLINICS</div>
              {clinicAmGroups.map((g) => (
                <div key={clinicGroupKey(g.room, g.consultantId, g.clinicType)} style={{ marginBottom: 4 }}>
                  <div
                    style={{ fontSize: 11, fontWeight: 600, color: "var(--cat-am-text)" }}
                    {...dropProps(`am_clinic_${g.room}_${g.consultantId ?? "null"}_${g.clinicType}`, g.staff[0]?.duty_type || "Clinic", "AM", g.room, g.consultantId, g.clinicType)}
                  >
                    {clinicRoomHeader(g.room, g.staff[0])}
                  </div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {sortByRankAlpha(g.staff, staffRankOrder).map((a) => (
                      <DragTag key={`${a.id}-${a.staff_id}-${a.session}-${a.duty_type}`} a={a} date={day.date} dragRef={dragRef} onRemove={onRemove}
                        color={{ bg: undefined, fg: undefined }} className="duty-tag clinic" highlight={tagHighlight(a.staff_id)}
                        hoveredName={hoveredName} onHoverName={onHoverName} filterTerm={filterTerm} />
                    ))}
                  </div>
                </div>
              ))}
              {emptyAmClinics.map((r, i) => (
                <EmptyResourceRow key={`empty-am-${r.room}-${r.consultant_id ?? "null"}-${r.label || ""}-${i}`} r={r} zoneKey={`am_clinic_${r.room}_${r.consultant_id ?? "null"}_${r.label || ""}`}
                  dutyType="Clinic" session="AM" dropProps={dropProps} color="var(--cat-am-text)" />
              ))}
            </div>
          )}
        </div>

        {/* Column 4: PM */}
        <div>
          <SectionLabel label="PM Clinic" color="var(--cat-pm)" />
          {(clinicPmGroups.length > 0 || emptyPmClinics.length > 0) && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", marginBottom: 4 }}>CLINICS</div>
              {clinicPmGroups.map((g) => (
                <div key={clinicGroupKey(g.room, g.consultantId, g.clinicType)} style={{ marginBottom: 4 }}>
                  <div
                    style={{ fontSize: 11, fontWeight: 600, color: "var(--cat-pm-text)" }}
                    {...dropProps(`pm_clinic_${g.room}_${g.consultantId ?? "null"}_${g.clinicType}`, g.staff[0]?.duty_type || "Clinic", "PM", g.room, g.consultantId, g.clinicType)}
                  >
                    {clinicRoomHeader(g.room, g.staff[0])}
                  </div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {sortByRankAlpha(g.staff, staffRankOrder).map((a) => (
                      <DragTag key={`${a.id}-${a.staff_id}-${a.session}-${a.duty_type}`} a={a} date={day.date} dragRef={dragRef} onRemove={onRemove}
                        color={{ bg: "var(--cat-pm)", fg: "var(--cat-pm-text)" }} className="duty-tag clinic" highlight={tagHighlight(a.staff_id)}
                        hoveredName={hoveredName} onHoverName={onHoverName} filterTerm={filterTerm} />
                    ))}
                  </div>
                </div>
              ))}
              {emptyPmClinics.map((r, i) => (
                <EmptyResourceRow key={`empty-pm-${r.room}-${r.consultant_id ?? "null"}-${r.label || ""}-${i}`} r={r} zoneKey={`pm_clinic_${r.room}_${r.consultant_id ?? "null"}_${r.label || ""}`}
                  dutyType="Clinic" session="PM" dropProps={dropProps} color="var(--cat-pm-text)" />
              ))}
            </div>
          )}
        </div>

        {/* Column 5: Admin (its own column — "available but unassigned" lands here, not in PM clinics) */}
        <div>
          <CollapsibleSectionLabel
            label="Admin"
            color="var(--cat-admin)"
            collapsed={collapsedCols.has("admin")}
            onToggle={() => onToggleCol("admin")}
          />
          {!collapsedCols.has("admin") && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <div
                  style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", marginBottom: 4 }}
                  {...dropProps("am_admin", "Admin", "AM", null, null)}
                >
                  AM
                </div>
                {day.am_admin.length === 0 && <EmptyNote />}
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {sortByRankAlpha(day.am_admin, staffRankOrder).map((a) => (
                    <DragTag key={`${a.id}-${a.staff_id}-${a.session}-${a.duty_type}`} a={a} date={day.date} dragRef={dragRef} onRemove={onRemove}
                      color={{ bg: undefined, fg: undefined }} className="duty-tag admin" highlight={tagHighlight(a.staff_id)}
                      hoveredName={hoveredName} onHoverName={onHoverName} filterTerm={filterTerm} />
                  ))}
                </div>
              </div>
              <div>
                <div
                  style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", marginBottom: 4 }}
                  {...dropProps("pm_admin", "Admin", "PM", null, null)}
                >
                  PM
                </div>
                {day.pm_admin.length === 0 && <EmptyNote />}
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {sortByRankAlpha(day.pm_admin, staffRankOrder).map((a) => (
                    <DragTag key={`${a.id}-${a.staff_id}-${a.session}-${a.duty_type}`} a={a} date={day.date} dragRef={dragRef} onRemove={onRemove}
                      color={{ bg: undefined, fg: undefined }} className="duty-tag admin" highlight={tagHighlight(a.staff_id)}
                      hoveredName={hoveredName} onHoverName={onHoverName} filterTerm={filterTerm} />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Column 6: Unavailable — also shows "ghost" tags for people who'd usually be on duty */}
        <div>
          <CollapsibleSectionLabel
            label="Unavailable"
            color="var(--cat-unavail)"
            collapsed={collapsedCols.has("unavailable")}
            onToggle={() => onToggleCol("unavailable")}
          />
          {!collapsedCols.has("unavailable") && (
            <>
              {day.unavailable.length === 0 && <EmptyNote />}
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {day.unavailable.map((u) => {
                  const isPC = u.reason === "Post-call";
                  return (
                    <span
                      key={`${u.staff_id}-${u.reason}`}
                      className="duty-tag"
                      draggable
                      style={{
                        background: "var(--cat-unavail)",
                        color: "var(--cat-unavail-text)",
                        cursor: "grab",
                        userSelect: "none",
                        // Ghost styling — dashed border + reduced opacity to read as "normally here, but absent"
                        opacity: 0.55,
                        border: "1px dashed var(--cat-unavail-text)",
                      }}
                      onDragStart={() => {
                        dragRef.current = {
                          kind: "duty",
                          duplicate: false,
                          assignmentId: 0,
                          staffId: u.staff_id,
                          staffName: u.staff_name,
                          date: day.date,
                        };
                      }}
                      title={`${u.staff_name} is ${u.reason} today (normally rostered)`}
                    >
                      {u.staff_name}
                      <span style={{
                        fontSize: 9,
                        fontWeight: 700,
                        padding: "1px 4px",
                        marginLeft: 4,
                        borderRadius: 3,
                        background: isPC ? "#94a3b8" : "#ef4444",
                        color: "white",
                      }}>
                        {isPC ? "PC" : u.reason.toUpperCase().slice(0, 2)}
                      </span>
                    </span>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>}
    </div>
  );
}

function DragTag({
  a, date, dragRef, onRemove, color, className, highlight, hoveredName, onHoverName, filterTerm,
}: {
  a: DutyAssignment;
  date: string;
  dragRef: React.MutableRefObject<DragState | null>;
  onRemove: (id: number, staffId: number, date: string, session: string) => void;
  color: { bg?: string; fg?: string };
  className?: string;
  highlight?: "conflict" | "multi" | boolean;
  hoveredName: string | null;
  onHoverName: (name: string | null) => void;
  filterTerm?: string;
}) {
  const hlColor = highlight === "conflict" ? "var(--sem-conflict)"
    : highlight === "multi" || highlight === true ? "var(--sem-multi)"
    : undefined;
  const hlTitle = highlight === "conflict"
    ? "Conflict: this person is unavailable today (leave / post-call) but still assigned"
    : highlight === "multi" || highlight === true
    ? "This person is rostered in multiple places today"
    : "Drag to move";
  const session = a.session ?? "AM";
  const baseDrag = {
    kind: "duty" as const,
    assignmentId: a.id,
    staffId: a.staff_id,
    staffName: a.staff_name,
    date,
  };
  const nameMatchesFilter = filterTerm ? a.staff_name.toLowerCase().includes(filterTerm) : false;
  return (
    <span
      draggable
      className={className || "duty-tag"}
      style={{
        background: color.bg,
        color: color.fg,
        cursor: "grab",
        userSelect: "none",
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        outline: hlColor ? `2px solid ${hlColor}` : (hoveredName === a.staff_name || nameMatchesFilter) ? "2px solid var(--primary)" : undefined,
        outlineOffset: (hlColor || hoveredName === a.staff_name || nameMatchesFilter) ? 1 : undefined,
      }}
      onMouseEnter={() => onHoverName(a.staff_name)}
      onMouseLeave={() => onHoverName(null)}
      onDragStart={() => { dragRef.current = { ...baseDrag, duplicate: false }; }}
      title={hlTitle}
    >
      <span>{a.staff_name}</span>
      {a.is_manual_override && <sup style={{ fontSize: 8, color: "var(--sem-override)" }}>✎</sup>}
      {/* Copy icon — drag THIS to duplicate instead of move */}
      <span
        draggable
        role="button"
        aria-label="Duplicate to another zone"
        className="duty-tag-handle"
        onDragStart={(e) => {
          e.stopPropagation();
          dragRef.current = { ...baseDrag, duplicate: true };
        }}
        style={{
          fontSize: 11,
          cursor: "copy",
          padding: "0 3px",
          lineHeight: 1,
        }}
        title="Drag this ⧉ icon to duplicate this person to another zone"
      >⧉</span>
      {/* Remove icon — sends to Admin (not delete) */}
      <span
        role="button"
        aria-label="Send to Admin"
        className="duty-tag-handle"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(a.id, a.staff_id, date, session);
        }}
        style={{
          fontSize: 13,
          cursor: "pointer",
          padding: "0 3px",
          lineHeight: 1,
        }}
        title="Clear this assignment. If the person has no other duty and is available, they'll auto-appear in the Admin column."
      >×</span>
    </span>
  );
}

function clinicRoomHeader(room: string, assignment: DutyAssignment): string {
  const parts: string[] = [];
  if (assignment.clinic_type) parts.push(assignment.clinic_type);
  if (room && room !== "Clinic" && room !== assignment.clinic_type) parts.push(room);
  const label = parts.join(": ");
  return assignment.consultant_name ? `${label} (${assignment.consultant_name})` : label;
}

function SectionLabel({ label, color }: { label: string; color: string }) {
  return (
    <div style={{
      fontSize: 12, fontWeight: 700, padding: "4px 8px",
      background: color, borderRadius: 4, marginBottom: 8,
      textTransform: "uppercase", letterSpacing: 0.5,
    }}>
      {label}
    </div>
  );
}

function CollapsibleSectionLabel({ label, color, collapsed, onToggle }: {
  label: string; color: string; collapsed: boolean; onToggle: () => void;
}) {
  return (
    <div
      onClick={onToggle}
      style={{
        fontSize: 12, fontWeight: 700, padding: "4px 8px",
        background: color, borderRadius: 4, marginBottom: 8,
        textTransform: "uppercase", letterSpacing: 0.5,
        cursor: "pointer", userSelect: "none",
        display: "flex", alignItems: "center", gap: 4,
        // when collapsed, render vertical so it stays compact in the 32px col
        writingMode: collapsed ? "vertical-rl" : undefined,
        transform: collapsed ? "rotate(180deg)" : undefined,
        textAlign: "center",
      }}
      title={collapsed ? `Expand ${label}` : `Collapse ${label}`}
    >
      <span>{collapsed ? "▶" : "▼"}</span>
      <span>{label}</span>
    </div>
  );
}

function HeaderPill({ label, bg, fg, title }: { label: string; bg: string; fg: string; title?: string }) {
  return (
    <span title={title} style={{
      fontSize: 10, fontWeight: 700,
      padding: "2px 6px", borderRadius: 8,
      background: bg, color: fg,
      whiteSpace: "nowrap",
      cursor: title ? "help" : "default",
    }}>{label}</span>
  );
}

function EmptyResourceRow({
  r, zoneKey, dutyType, session, dropProps, color, prefix = "",
}: {
  r: { room: string; label: string; consultant_id: number | null; consultant_name: string | null };
  zoneKey: string;
  dutyType: string;
  session: string;
  dropProps: (zoneKey: string, dutyType: string, session: string, location: string | null, consultantId: number | null, clinicType?: string | null) => any;
  color: string;
  prefix?: string;
}) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color, cursor: "default" }}
        {...dropProps(zoneKey, dutyType, session, r.room, r.consultant_id, r.label || null)}
      >
        {prefix}{r.label ? `${r.label}: ` : ""}{r.room}
        {r.consultant_name && <span style={{ fontWeight: 400, color: "var(--text-muted)" }}> ({r.consultant_name})</span>}
      </div>
      <div
        {...dropProps(zoneKey, dutyType, session, r.room, r.consultant_id, r.label || null)}
        style={{
          fontSize: 10, fontStyle: "italic", color: "var(--text-muted)",
          border: "1px dashed var(--border)", borderRadius: 4, padding: "2px 6px",
          display: "inline-block",
        }}
      >
        drop here
      </div>
    </div>
  );
}

function EmptyNote() {
  return <div style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic" }}>—</div>;
}

function getAllStaffNames(roster: DutyRosterResponse): string[] {
  const names = new Set<string>();
  for (const day of roster.days) {
    Object.values(day.call_slots).forEach((n) => n && names.add(n));
    [...day.ot_assignments, ...day.eot_assignments,
     ...day.am_clinics, ...day.pm_clinics,
     ...day.am_admin, ...day.pm_admin]
      .forEach((a) => names.add(a.staff_name));
    day.unavailable.forEach((u) => names.add(u.staff_name));
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

function generateMyRosterText(name: string, roster: DutyRosterResponse): string {
  const lines: string[] = [`=== MY ROSTER — ${monthName(roster.month)} ${roster.year} ===`, `=== ${name} ===`];

  for (const day of roster.days) {
    const dayLines: string[] = [];

    // Unavailable (post-call / leave)
    const unavail = day.unavailable.find((u) => u.staff_name === name);
    if (unavail) dayLines.push(`  ${unavail.reason}`);

    // On-call slot
    for (const [slot, staffName] of Object.entries(day.call_slots)) {
      if (staffName === name) dayLines.push(`  ${slot} (On Call)`);
    }

    // OT / EOT full-day assignments (excluding Ward MO / EOT MO anchor rows)
    const fullDay = [...day.ot_assignments, ...day.eot_assignments].filter(
      (a) => a.staff_name === name && a.duty_type !== "Ward MO" && a.duty_type !== "EOT MO"
    );
    for (const a of fullDay) {
      const loc = a.location || a.duty_type;
      const cons = a.consultant_name ? ` (${a.consultant_name})` : "";
      const session = !a.session || a.session === "Full Day" ? "Full Day" : a.session;
      dayLines.push(`  ${session}: ${loc}${cons}`);
    }

    // Ward MO / EOT MO
    const wardMo = [...day.ot_assignments, ...day.eot_assignments].find(
      (a) => a.staff_name === name && a.duty_type === "Ward MO"
    );
    if (wardMo) dayLines.push("  Ward MO");

    const eotMo = [...day.ot_assignments, ...day.eot_assignments].find(
      (a) => a.staff_name === name && a.duty_type === "EOT MO"
    );
    if (eotMo) dayLines.push("  EOT MO");

    // AM clinics
    for (const a of day.am_clinics.filter((a) => a.staff_name === name)) {
      const label = a.clinic_type || a.location || "Clinic";
      const cons = a.consultant_name ? ` (${a.consultant_name})` : "";
      dayLines.push(`  AM: ${label}${cons}`);
    }

    // PM clinics
    for (const a of day.pm_clinics.filter((a) => a.staff_name === name)) {
      const label = a.clinic_type || a.location || "Clinic";
      const cons = a.consultant_name ? ` (${a.consultant_name})` : "";
      dayLines.push(`  PM: ${label}${cons}`);
    }

    // Admin (skip on weekends/PH — off-day admin is implicit)
    if (!day.is_weekend && !day.is_ph) {
      if (day.am_admin.find((a) => a.staff_name === name)) dayLines.push("  AM: Admin");
      if (day.pm_admin.find((a) => a.staff_name === name)) dayLines.push("  PM: Admin");
    }

    lines.push("");
    lines.push(`${day.date.slice(5)} ${day.day_name}`);
    lines.push(dayLines.length === 0 ? "  —" : dayLines.join("\n"));
  }

  return lines.join("\n");
}

function MyRosterModal({
  roster, initialName, onClose,
}: {
  roster: DutyRosterResponse;
  initialName: string;
  onClose: () => void;
}) {
  const allNames = getAllStaffNames(roster);
  const [selectedName, setSelectedName] = useState(() => {
    if (!initialName) return "";
    const exact = allNames.find((n) => n.toLowerCase() === initialName.toLowerCase());
    if (exact) return exact;
    const partial = allNames.find((n) => n.toLowerCase().includes(initialName.toLowerCase()));
    return partial ?? "";
  });
  const [copied, setCopied] = useState(false);

  const text = selectedName ? generateMyRosterText(selectedName, roster) : "";

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 480, maxWidth: "95vw" }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>My Roster</h3>
        <div className="form-group" style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600 }}>Select staff member</label>
          <select
            autoFocus
            value={selectedName}
            onChange={(e) => { setSelectedName(e.target.value); setCopied(false); }}
            style={{ width: "100%", marginTop: 4 }}
          >
            <option value="" disabled>Choose name...</option>
            {allNames.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>

        {selectedName && (
          <>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
              <button
                className="btn btn-primary"
                style={{ fontSize: 12, padding: "4px 12px" }}
                onClick={handleCopy}
              >
                {copied ? "Copied!" : "Copy to Clipboard"}
              </button>
            </div>
            <pre style={{
              background: "var(--bg-muted, #f8fafc)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              padding: "10px 14px",
              fontSize: 12,
              lineHeight: 1.7,
              maxHeight: 420,
              overflowY: "auto",
              whiteSpace: "pre-wrap",
              fontFamily: "monospace",
              margin: 0,
            }}>
              {text}
            </pre>
          </>
        )}

        <div className="modal-actions" style={{ marginTop: 12 }}>
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

