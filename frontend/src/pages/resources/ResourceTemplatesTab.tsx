import { Fragment, useEffect, useState, type DragEvent } from "react";
import { api } from "../../api";
import type { ResourceTemplate, Staff, CallTypeConfig } from "../../types";
import { DAY_NAMES, CONS_RANKS, COLOR_PRESETS } from "./constants";

const SESSIONS = ["AM", "PM"] as const;

export default function ResourceTemplatesTab() {
  const [templates, setTemplates] = useState<ResourceTemplate[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [callTypes, setCallTypes] = useState<CallTypeConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [dragItem, setDragItem] = useState<{ id: number; type: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.getResourceTemplates(), api.getStaff(), api.getCallTypes()]).then(([t, s, ct]) => {
      setTemplates(t);
      setStaff(s);
      setCallTypes(ct);
      setLoading(false);
    });
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
      return;
    }
    await handleUpdate(id, {
      ...tmpl,
      day_of_week: targetDow,
      session: targetSession,
    });
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
      const sess = t.session === "PM" ? "PM" : "AM";
      grid[dayKey][sess][t.resource_type].push(t);
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

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add Resource</button>
      </div>

      <div className="resource-grid-container">
        <table className="resource-grid">
          <thead>
            <tr>
              <th style={{ width: 50 }}></th>
              {DAY_NAMES.map((d) => (
                <th key={d} colSpan={2}>{d}</th>
              ))}
            </tr>
            <tr>
              <th></th>
              {DAY_NAMES.map((d) => (
                <Fragment key={d}>
                  <th className="sub-col-header">Clinic</th>
                  <th className="sub-col-header">OT</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {SESSIONS.map((sess) => (
              <tr key={sess}>
                <td className="session-label">{sess}</td>
                {DAY_NAMES.map((day, dow) => (
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
                            key={t.id}
                            template={t}
                            isDragging={dragItem?.id === t.id}
                            onDragStart={(e) => {
                              e.dataTransfer.setData("text/plain", String(t.id));
                              setDragItem({ id: t.id, type: t.resource_type });
                            }}
                            onDragEnd={() => setDragItem(null)}
                            onClick={() => setEditId(t.id)}
                            onDuplicate={() => handleDuplicate(t.id)}
                          />
                        ))}
                      </td>
                    ))}
                  </Fragment>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <ResourceFormModal
          title="Add Resource"
          consultants={consultants}
          callSlotNames={callTypes.filter((c) => c.is_active).map((c) => c.name)}
          onSave={handleAdd}
          onClose={() => setShowAdd(false)}
        />
      )}
      {editTemplate && (
        <ResourceFormModal
          title="Edit Resource"
          consultants={consultants}
          callSlotNames={callTypes.filter((c) => c.is_active).map((c) => c.name)}
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
}: {
  template: ResourceTemplate;
  isDragging: boolean;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
  onClick: () => void;
  onDuplicate: () => void;
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
      onDragEnd={onDragEnd}
      onClick={onClick}
    >
      <div className="resource-card-header">
        <span className="resource-card-label">
          {t.is_emergency ? "⚡ " : ""}
          {t.label || t.room}
        </span>
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
  title, consultants, callSlotNames, initial, onSave, onClose, onDelete,
}: {
  title: string;
  consultants: Staff[];
  callSlotNames: string[];
  initial?: ResourceTemplate;
  onSave: (data: any) => void;
  onClose: () => void;
  onDelete?: () => void;
}) {
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

  const isOT = resourceType === "ot";
  const isClinic = resourceType === "clinic";

  function toggleWeek(w: number) {
    setSelectedWeeks((prev) =>
      prev.includes(w) ? prev.filter((x) => x !== w) : [...prev, w].sort()
    );
  }

  function toggleSlot(slot: string) {
    setLinkedSlots((prev) =>
      prev.includes(slot) ? prev.filter((s) => s !== slot) : [...prev, slot]
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

        <div className="form-group">
          <label>Day</label>
          <select value={dow} onChange={(e) => setDow(Number(e.target.value))}>
            {DAY_NAMES.map((n, i) => <option key={i} value={i}>{n}</option>)}
          </select>
        </div>

        <div className="form-group">
          <label>Session</label>
          <select value={session} onChange={(e) => setSession(e.target.value)}>
            {SESSIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div className="form-group">
          <label>Resource Label</label>
          <input type="text" value={label} onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. NC, Sup, MOPD, Trauma" />
        </div>

        <div className="form-group">
          <label>Room</label>
          <input type="text" value={room} onChange={(e) => setRoom(e.target.value)}
            placeholder={isOT ? "e.g. OT1, EOT" : "e.g. 4E-Rm3"} />
        </div>

        <div className="form-group" style={{ opacity: isEmergency ? 0.4 : 1 }}>
          <label>Consultant</label>
          <select value={consId ?? ""} onChange={(e) => setConsId(e.target.value ? Number(e.target.value) : null)}
            disabled={isEmergency}>
            <option value="">— None —</option>
            {consultants.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <div className="form-group">
          <label>Staff Required</label>
          <input type="number" min={0} max={10} value={staffRequired}
            onChange={(e) => setStaffRequired(Number(e.target.value))} />
        </div>

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
          <label>Linked Manpower</label>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 4 }}>
            {callSlotNames.length === 0 && <span style={{ color: "#999", fontSize: 12 }}>No call types configured</span>}
            {callSlotNames.map((slot) => (
              <label key={slot} style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                <input type="checkbox" checked={linkedSlots.includes(slot)} onChange={() => toggleSlot(slot)} />
                {slot}
              </label>
            ))}
          </div>
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
                });
              }
            }}
          >Save</button>
        </div>
      </div>
    </div>
  );
}
