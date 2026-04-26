import { Fragment, useEffect, useState, type DragEvent } from "react";
import { api } from "../../api";
import { useConfig } from "../../context/ConfigContext";
import type { ResourceTemplate, Staff, CallTypeConfig } from "../../types";
import { DAY_NAMES, CONS_RANKS, COLOR_PRESETS } from "./constants";
import { useEscClose } from "../../hooks/useEscClose";
import MultiSelectDropdown from "../../components/MultiSelectDropdown";

const SESSIONS = ["AM", "PM"] as const;
const OT_SESSION_OPTIONS = ["AM", "PM", "Full Day"] as const;

export default function ResourceTemplatesTab() {
  const { active } = useConfig();
  const [templates, setTemplates] = useState<ResourceTemplate[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [callTypes, setCallTypes] = useState<CallTypeConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [dragItem, setDragItem] = useState<{ id: number; type: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.getResourceTemplates(), api.getStaff(), api.getCallTypes()]).then(([t, s, ct]) => {
      setTemplates(t);
      setStaff(s);
      setCallTypes(ct);
      setLoading(false);
    });
    api.getTimestamps().then(ts => setLastUpdated(ts.resources));
  }, []);

  const consultants = staff.filter((s) => CONS_RANKS.includes(s.rank));

  async function handleAdd(data: any) {
    try {
      const t = await api.createResourceTemplate(data);
      setTemplates((prev) => [...prev, t]);
      setShowAdd(false);
    } catch (e: any) {
      setError(e?.message ?? "Failed to add resource.");
    }
  }

  async function handleUpdate(id: number, data: any) {
    try {
      const t = await api.updateResourceTemplate(id, data);
      setTemplates((prev) => prev.map((x) => (x.id === id ? t : x)));
      setEditId(null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to update resource.");
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this resource?")) return;
    try {
      await api.deleteResourceTemplate(id);
      setTemplates((prev) => prev.filter((x) => x.id !== id));
      setEditId(null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to delete resource.");
    }
  }

  async function handleDuplicate(id: number) {
    try {
      const t = await api.duplicateResourceTemplate(id);
      setTemplates((prev) => [...prev, t]);
    } catch (e: any) {
      setError(e?.message ?? "Failed to duplicate resource.");
    }
  }

  async function handleDrop(e: DragEvent, targetDow: number, targetSession: string, targetType: string) {
    e.preventDefault();
    const id = Number(e.dataTransfer.getData("text/plain"));
    if (!id) return;
    const tmpl = templates.find((t) => t.id === id);
    if (!tmpl) { setDragItem(null); return; }
    if (tmpl.resource_type !== targetType) { setDragItem(null); return; }
    if (tmpl.day_of_week === targetDow && tmpl.session === targetSession) {
      setDragItem(null);
      return; // intra-cell reorder handled by card-level drop
    }
    await handleUpdate(id, {
      ...tmpl,
      day_of_week: targetDow,
      session: targetSession,
    });
    setDragItem(null);
  }

  async function handleCardReorder(targetId: number) {
    if (!dragItem) return;
    const draggedId = dragItem.id;
    if (draggedId === targetId) return;
    const dragged = templates.find(t => t.id === draggedId);
    const target = templates.find(t => t.id === targetId);
    if (!dragged || !target) return;
    if (dragged.day_of_week !== target.day_of_week || dragged.session !== target.session || dragged.resource_type !== target.resource_type) return;

    const sorted = templates
      .filter(t => t.day_of_week === dragged.day_of_week && t.session === dragged.session && t.resource_type === dragged.resource_type)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const reordered = [...sorted];
    const fromIdx = reordered.findIndex(t => t.id === draggedId);
    const toIdx = reordered.findIndex(t => t.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;

    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    const cellItems = reordered;
    const updates = cellItems.map((t, i) => ({ id: t.id, sort_order: i }));

    try {
      await api.reorderResourceTemplates(updates);
      setTemplates(prev => {
        const next = [...prev];
        for (const u of updates) {
          const idx = next.findIndex(t => t.id === u.id);
          if (idx !== -1) next[idx] = { ...next[idx], sort_order: u.sort_order };
        }
        return next;
      });
    } catch (e: any) {
      setError(e?.message ?? "Failed to reorder.");
    }
    setDragItem(null);
  }

  if (loading) return <div className="loading"><span className="spinner" /> Loading...</div>;

  // Build grid: [day][session][type] -> sorted templates
  const grid: Record<string, Record<string, Record<string, ResourceTemplate[]>>> = {};
  for (const day of DAY_NAMES) {
    grid[day] = {};
    for (const sess of SESSIONS) {
      grid[day][sess] = { clinic: [], ot: [] };
    }
  }
  for (const t of templates) {
    if (t.day_of_week >= 0 && t.day_of_week < 7) {
      const dayKey = DAY_NAMES[t.day_of_week];
      // Full-day OTs appear in BOTH AM and PM cells (same underlying template,
      // rendered twice so users can see it in either session view).
      if (t.resource_type === "ot" && t.session === "Full Day") {
        grid[dayKey]["AM"][t.resource_type].push(t);
        grid[dayKey]["PM"][t.resource_type].push(t);
      } else {
        const sess = t.session === "PM" ? "PM" : "AM";
        grid[dayKey][sess][t.resource_type].push(t);
      }
    }
  }
  for (const day of DAY_NAMES) {
    for (const sess of SESSIONS) {
      for (const type of ["clinic", "ot"]) {
        grid[day][sess][type].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      }
    }
  }

  const editTemplate = editId != null ? templates.find((t) => t.id === editId) : null;

  return (
    <>
      {error && (
        <div style={{
          background: "#fee2e2", color: "#b91c1c", border: "1px solid #fca5a5",
          borderRadius: 6, padding: "8px 14px", marginBottom: 12, display: "flex",
          alignItems: "center", justifyContent: "space-between",
        }}>
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            style={{ background: "none", border: "none", cursor: "pointer", fontWeight: 700, color: "#b91c1c" }}
          >✕</button>
        </div>
      )}

      <div className="page-header" style={{ marginBottom: 12, alignItems: "flex-start" }}>
        <h2>Clinic / OT Resources{active ? ` - ${new Date(active.year, active.month - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}` : ""}</h2>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <div className="btn-group">
            <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add Resource</button>
          </div>
          {lastUpdated && (
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              Last updated: {new Date(lastUpdated).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
      </div>

      <div className="resource-grid-container">
        <table className="resource-grid">
          <thead>
            <tr>
              <th style={{ width: 50 }}></th>
              {DAY_NAMES.map((d) => {
                const collapsed = collapsedDays.has(d);
                return (
                  <th key={d} colSpan={collapsed ? 1 : 2} style={{ whiteSpace: "nowrap", padding: collapsed ? "4px 2px" : undefined, width: collapsed ? 20 : undefined }}>
                    {!collapsed && <span style={{ marginRight: 6 }}>{d}</span>}
                    <button
                      onClick={() => setCollapsedDays(prev => {
                        const next = new Set(prev);
                        if (next.has(d)) next.delete(d); else next.add(d);
                        return next;
                      })}
                      title={collapsed ? `Expand ${d}` : `Collapse ${d}`}
                      style={{ fontSize: 10, padding: "1px 4px", border: "1px solid var(--border)", borderRadius: 3, background: "var(--bg)", color: "var(--text-muted)", cursor: "pointer" }}
                    >{collapsed ? "+" : "−"}</button>
                  </th>
                );
              })}
            </tr>
            <tr>
              <th></th>
              {DAY_NAMES.map((d) => {
                const collapsed = collapsedDays.has(d);
                if (collapsed) return <th key={d} style={{ width: 20, padding: 0 }} />;
                return (
                  <Fragment key={d}>
                    <th className="sub-col-header">Clinic</th>
                    <th className="sub-col-header">OT</th>
                  </Fragment>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {SESSIONS.map((sess) => (
              <tr key={sess}>
                <td className="session-label">{sess}</td>
                {DAY_NAMES.map((day, dow) => {
                  const collapsed = collapsedDays.has(day);
                  if (collapsed) {
                    return (
                      <td key={`${day}-${sess}`} style={{ width: 20, padding: 0, background: "var(--bg-muted, #f8fafc)" }} />
                    );
                  }
                  return (
                    <Fragment key={`${day}-${sess}`}>
                      {(["clinic", "ot"] as const).map((type) => (
                        <td
                          key={`${day}-${sess}-${type}`}
                          className={`resource-cell ${dragItem && dragItem.type === type ? "drop-highlight" : ""}`}
                          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                          onDrop={(e) => handleDrop(e, dow, sess, type)}
                        >
                          {grid[day][sess][type].map((t) => (
                            <ResourceCard
                              key={`${sess}-${t.id}`}
                              template={t}
                              isDragging={dragItem?.id === t.id}
                              onDragStart={(e) => {
                                e.dataTransfer.setData("text/plain", String(t.id));
                                setDragItem({ id: t.id, type: t.resource_type });
                              }}
                              onDragEnd={() => setDragItem(null)}
                              onClick={() => setEditId(t.id)}
                              onDuplicate={() => handleDuplicate(t.id)}
                              onCardDrop={() => handleCardReorder(t.id)}
                            />
                          ))}
                        </td>
                      ))}
                    </Fragment>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <ResourceFormModal
          title="Add Resource"
          consultants={consultants}
          callSlotOptions={callTypes.filter((c) => c.is_active).map((c) => ({ id: c.id, name: c.name }))}
          onSave={handleAdd}
          onClose={() => setShowAdd(false)}
        />
      )}
      {editTemplate && (
        <ResourceFormModal
          title="Edit Resource"
          consultants={consultants}
          callSlotOptions={callTypes.filter((c) => c.is_active).map((c) => ({ id: c.id, name: c.name }))}
          initial={editTemplate}
          onSave={(data) => handleUpdate(editTemplate.id, data)}
          onClose={() => setEditId(null)}
          onDelete={() => handleDelete(editTemplate.id)}
        />
      )}
    </>
  );
}


function ResourceCard({
  template: t,
  isDragging,
  onDragStart,
  onDragEnd,
  onClick,
  onDuplicate,
  onCardDrop,
}: {
  template: ResourceTemplate;
  isDragging: boolean;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
  onClick: () => void;
  onDuplicate: () => void;
  onCardDrop: () => void;
}) {
  const defaultColor = t.resource_type === "ot"
    ? (t.is_emergency ? "#fef3c7" : "#dbeafe")
    : "#f8f9fa";
  const bg = t.color ?? defaultColor;

  return (
    <div
      className={`resource-card ${isDragging ? "dragging" : ""}`}
      style={{ backgroundColor: bg, opacity: t.is_active === false ? 0.45 : 1 }}
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onCardDrop(); }}
      onDragEnd={onDragEnd}
      onClick={onClick}
    >
      <div className="resource-card-header">
        <span className="resource-card-label">
          {t.is_emergency ? "⚡ " : ""}
          {t.label || t.room}
        </span>
        <span
          title={`Priority ${t.priority ?? 5} (1 = filled first, 10 = filled last)`}
          style={{
            fontSize: 10, fontWeight: 700, padding: "1px 5px", borderRadius: 3,
            background: "rgba(0,0,0,0.08)", color: "#374151", marginLeft: "auto", marginRight: 4,
          }}
        >P{t.priority ?? 5}</span>
        <button
          className="resource-card-dup"
          title="Duplicate"
          onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
        >⧉</button>
      </div>
      <div className="resource-card-room">{t.label ? t.room : ""}</div>
      <div className="resource-card-cons">
        {t.is_emergency
          ? (t.linked_manpower ? `→ ${t.linked_manpower}` : "Emergency")
          : (t.consultant_name ?? "")}
      </div>
      {t.staff_required > 0 && (
        <div className="resource-card-staff">{t.staff_required} staff</div>
      )}
      {t.weeks && (
        <span className="resource-card-weeks">
          Wk {t.weeks}
        </span>
      )}
    </div>
  );
}


function ResourceFormModal({
  title, consultants, callSlotOptions, initial, onSave, onClose, onDelete,
}: {
  title: string;
  consultants: Staff[];
  callSlotOptions: { id: number; name: string }[];
  initial?: ResourceTemplate;
  onSave: (data: any) => void;
  onClose: () => void;
  onDelete?: () => void;
}) {
  useEscClose(onClose);
  const [resourceType, setResourceType] = useState<"clinic" | "ot">(initial?.resource_type ?? "clinic");
  const [dow, setDow] = useState(initial?.day_of_week ?? 0);
  const [session, setSession] = useState(initial?.session ?? "AM");
  const [room, setRoom] = useState(initial?.room ?? "");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [consId, setConsId] = useState<number | null>(initial?.consultant_id ?? null);
  const [staffRequired, setStaffRequired] = useState(initial?.staff_required ?? 1);
  const [isEmergency, setIsEmergency] = useState(initial?.is_emergency ?? false);
  const [linkedSlots, setLinkedSlots] = useState<string[]>(
    initial?.linked_manpower ? initial.linked_manpower.split(",").map((s) => s.trim()).filter(Boolean) : []
  );
  const [selectedWeeks, setSelectedWeeks] = useState<number[]>(
    initial?.weeks ? initial.weeks.split(",").map((w) => parseInt(w.trim())).filter((n) => !isNaN(n)) : []
  );
  const [color, setColor] = useState<string | null>(initial?.color ?? null);
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [priority, setPriority] = useState(initial?.priority ?? 5);
  const [maxRegistrars, setMaxRegistrars] = useState(initial?.max_registrars ?? 1);
  const [eligibleRankIds, setEligibleRankIds] = useState<number[]>(
    initial?.eligible_rank_ids
      ? initial.eligible_rank_ids.split(",").map((s) => parseInt(s.trim())).filter((n) => !isNaN(n))
      : []
  );
  const [ranks, setRanks] = useState<import("../../types").RankConfig[]>([]);
  useEffect(() => { api.getRanks().then(setRanks); }, []);
  const dutyEligibleRanks = ranks.filter(r => r.is_active && r.is_duty_eligible)
    .sort((a, b) => a.display_order - b.display_order);

  const isOT = resourceType === "ot";
  const isClinic = resourceType === "clinic";

  // Coerce session to a valid value if user switches from OT (Full Day) to clinic.
  useEffect(() => {
    if (isClinic && session === "Full Day") {
      setSession("AM");
    }
  }, [isClinic, session]);

  function toggleWeek(w: number) {
    setSelectedWeeks((prev) =>
      prev.includes(w) ? prev.filter((x) => x !== w) : [...prev, w].sort()
    );
  }


  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>

        <div className="form-group">
          <label>Type</label>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              className={`btn ${isClinic ? "btn-primary" : "btn-secondary"}`}
              style={{ flex: 1 }}
              onClick={() => setResourceType("clinic")}
            >Clinic</button>
            <button
              className={`btn ${isOT ? "btn-primary" : "btn-secondary"}`}
              style={{ flex: 1 }}
              onClick={() => setResourceType("ot")}
            >OT</button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label htmlFor="r-day">Day</label>
            <select id="r-day" value={dow} onChange={(e) => setDow(Number(e.target.value))}>
              {DAY_NAMES.map((n, i) => <option key={i} value={i}>{n}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label htmlFor="r-session">Session</label>
            <select id="r-session" value={session} onChange={(e) => setSession(e.target.value)}>
              {(isOT ? OT_SESSION_OPTIONS : SESSIONS).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        {isOT && session === "Full Day" && (
          <div style={{ fontSize: 11, color: "var(--text-muted)", margin: "-8px 0 12px" }}>
            Same person covers AM + PM. Card will appear in both session rows.
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label htmlFor="r-priority" title="1 = highest priority (filled first), 10 = lowest.">
              Priority (1–10)
            </label>
            <input id="r-priority" type="number" min={1} max={10} value={priority}
              onChange={(e) => setPriority(Math.max(1, Math.min(10, Number(e.target.value))))} />
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
              1 = highest (filled first)
            </div>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label htmlFor="r-staff">Staff Required</label>
            <input id="r-staff" type="number" min={0} max={10} value={staffRequired}
              onChange={(e) => setStaffRequired(Number(e.target.value))} />
          </div>
        </div>

        <div className="form-group">
          <label title="Tick which ranks may be assigned here. Leave all unticked to allow any duty-eligible rank.">
            Eligible Ranks
          </label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {dutyEligibleRanks.map((r) => {
              const checked = eligibleRankIds.includes(r.id);
              return (
                <label key={r.id} style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "3px 8px", fontSize: 12, borderRadius: 4,
                  background: checked ? "#dbeafe" : "#f3f4f6",
                  border: `1px solid ${checked ? "#2563eb" : "var(--border)"}`,
                  cursor: "pointer", userSelect: "none",
                }}>
                  <input type="checkbox" checked={checked} style={{ margin: 0 }}
                    onChange={() => setEligibleRankIds((prev) =>
                      prev.includes(r.id) ? prev.filter((x) => x !== r.id) : [...prev, r.id]
                    )} />
                  {r.abbreviation || r.name}
                </label>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
            Empty = any duty-eligible rank.
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="r-label">Resource Label</label>
          <input id="r-label" type="text" value={label} onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. SUP, NC, MOPD, Hand VC, Trauma" />
        </div>

        <div className="form-group">
          <label htmlFor="r-room">Room <span style={{ color: "#dc2626" }}>*</span></label>
          <input id="r-room" type="text" value={room} onChange={(e) => setRoom(e.target.value)}
            placeholder={isOT ? "e.g. OT1, EOT" : "e.g. 4E-Rm3"} />
        </div>

        <div className="form-group" style={{ opacity: isEmergency ? 0.4 : 1 }}>
          <label htmlFor="r-consultant">Consultant</label>
          <select id="r-consultant" value={consId ?? ""} onChange={(e) => setConsId(e.target.value ? Number(e.target.value) : null)}
            disabled={isEmergency}>
            <option value="">— None —</option>
            {consultants.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {isOT && (
          <div className="form-group">
            <label title="Cap on SSR/SR count in this OT. Set to 0 to exclude registrars entirely.">
              Max Registrars
            </label>
            <input type="number" min={0} max={5} value={maxRegistrars}
              onChange={(e) => setMaxRegistrars(Math.max(0, Math.min(5, Number(e.target.value))))} />
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
              Typically 1 — prevents doubling up SSR/SR in the same OT.
            </div>
          </div>
        )}

        <div className="form-group" style={{ opacity: isClinic ? 0.4 : 1 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={isEmergency}
              disabled={isClinic}
              onChange={(e) => {
                setIsEmergency(e.target.checked);
                if (e.target.checked) setConsId(null);
              }} />
            Emergency (24h, no fixed consultant)
          </label>
        </div>

        <div className="form-group">
          <label>Weeks (none = every week)</label>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            {[1, 2, 3, 4, 5].map((w) => (
              <label key={w} style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                <input type="checkbox" checked={selectedWeeks.includes(w)} onChange={() => toggleWeek(w)} />
                Wk{w}
              </label>
            ))}
          </div>
        </div>

        <div className="form-group">
          <label>Linked Manpower <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>(pre-assign call holders of these types to this resource)</span></label>
          {callSlotOptions.length === 0 ? (
            <span style={{ color: "#999", fontSize: 12 }}>No call types configured</span>
          ) : (
            <MultiSelectDropdown
              options={callSlotOptions.map((c) => ({ id: c.id, label: c.name }))}
              selected={callSlotOptions.filter((c) => linkedSlots.includes(c.name)).map((c) => c.id)}
              onChange={(ids) => setLinkedSlots(
                callSlotOptions.filter((c) => ids.includes(c.id)).map((c) => c.name)
              )}
              placeholder="None"
            />
          )}
        </div>

        <div className="form-group">
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Active
          </label>
        </div>

        <div className="form-group">
          <label>Card Colour</label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(9, 28px)", gap: 4, marginTop: 4 }}>
            <div
              onClick={() => setColor(null)}
              title="Reset to default"
              style={{
                width: 28, height: 28, borderRadius: 4, cursor: "pointer",
                background: "linear-gradient(135deg, #fff 45%, #f00 45%, #f00 55%, #fff 55%)",
                border: color === null ? "2px solid var(--primary)" : "1px solid #ccc",
              }}
            />
            {COLOR_PRESETS.map((c) => (
              <div
                key={c}
                title={c}
                onClick={() => setColor(c)}
                style={{
                  width: 28, height: 28, borderRadius: 4, backgroundColor: c, cursor: "pointer",
                  border: color === c ? "2px solid var(--primary)" : "1px solid #ccc",
                }}
              />
            ))}
          </div>
        </div>

        <div className="modal-actions">
          {onDelete && (
            <button className="btn btn-danger" onClick={onDelete} style={{ marginRight: "auto" }}>Delete</button>
          )}
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={!room.trim()}
            onClick={() => {
              if (room.trim()) {
                onSave({
                  resource_type: resourceType,
                  day_of_week: dow,
                  session,
                  room: room.trim(),
                  label: label.trim(),
                  consultant_id: isEmergency ? null : consId,
                  staff_required: staffRequired,
                  is_emergency: isOT ? isEmergency : false,
                  linked_manpower: linkedSlots.length > 0 ? linkedSlots.join(",") : null,
                  weeks: selectedWeeks.length > 0 ? selectedWeeks.join(",") : null,
                  color,
                  is_active: isActive,
                  sort_order: initial?.sort_order ?? 0,
                  priority,
                  max_registrars: isOT ? maxRegistrars : 1,
                  eligible_rank_ids: eligibleRankIds.length > 0 ? eligibleRankIds.join(",") : null,
                });
              }
            }}
          >Save</button>
        </div>
      </div>
    </div>
  );
}
