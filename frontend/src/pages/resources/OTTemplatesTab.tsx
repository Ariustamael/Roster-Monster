import { useEffect, useState, type DragEvent } from "react";
import { api } from "../../api";
import type { OTTemplate, Staff } from "../../types";
import { DAY_NAMES, CONS_GRADES, COLOR_PRESETS } from "./constants";

const CALL_SLOTS = ["MO1", "MO2", "MO3", "MO4", "MO5"];

const DEFAULT_OT_COLORS: Record<string, string> = {
  _regular: "#dbeafe",
  _emergency: "#fef3c7",
};

function loadOTColors(): Record<string, string> {
  try {
    const raw = localStorage.getItem("ot-colors");
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveOTColors(colors: Record<string, string>) {
  localStorage.setItem("ot-colors", JSON.stringify(colors));
}

export default function OTTemplatesTab() {
  const [templates, setTemplates] = useState<OTTemplate[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [customColors, setCustomColors] = useState<Record<string, string>>(loadOTColors);
  const [showColorEditor, setShowColorEditor] = useState(false);

  useEffect(() => {
    Promise.all([api.getOTTemplates(), api.getStaff()]).then(([t, s]) => {
      setTemplates(t);
      setStaff(s);
      setLoading(false);
    });
  }, []);

  const consultants = staff.filter((s) => CONS_GRADES.includes(s.grade));

  function otColor(room: string, isEmergency: boolean): string {
    if (customColors[room]) return customColors[room];
    return isEmergency
      ? (customColors._emergency || DEFAULT_OT_COLORS._emergency)
      : (customColors._regular || DEFAULT_OT_COLORS._regular);
  }

  function otBorder(room: string, isEmergency: boolean): string {
    const bg = otColor(room, isEmergency);
    return darken(bg);
  }

  const rooms = [...new Set(templates.map((t) => t.room))].sort();

  async function handleAdd(data: any) {
    const t = await api.createOTTemplate(data);
    setTemplates((prev) => [...prev, t]);
    setShowAdd(false);
  }

  async function handleUpdate(id: number, data: any) {
    const t = await api.updateOTTemplate(id, data);
    setTemplates((prev) => prev.map((x) => (x.id === id ? t : x)));
    setEditId(null);
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this OT template?")) return;
    await api.deleteOTTemplate(id);
    setTemplates((prev) => prev.filter((x) => x.id !== id));
    setEditId(null);
  }

  async function handleDrop(e: DragEvent, targetDow: number) {
    e.preventDefault();
    const id = Number(e.dataTransfer.getData("text/plain"));
    if (!id) return;
    const tmpl = templates.find((t) => t.id === id);
    if (!tmpl || tmpl.day_of_week === targetDow) { setDragId(null); return; }
    await handleUpdate(id, {
      day_of_week: targetDow,
      room: tmpl.room,
      consultant_id: tmpl.consultant_id,
      assistants_needed: tmpl.assistants_needed,
      is_emergency: tmpl.is_emergency,
      linked_call_slot: tmpl.linked_call_slot,
    });
    setDragId(null);
  }

  if (loading) return <div className="loading"><span className="spinner" /> Loading...</div>;

  const grid: Record<string, OTTemplate[]> = {};
  for (const day of DAY_NAMES) grid[day] = [];
  for (const t of templates) {
    if (t.day_of_week >= 0 && t.day_of_week < 7) {
      grid[DAY_NAMES[t.day_of_week]].push(t);
    }
  }
  for (const day of DAY_NAMES) grid[day].sort((a, b) => {
    if (a.is_emergency !== b.is_emergency) return a.is_emergency ? 1 : -1;
    return a.room.localeCompare(b.room);
  });

  const editTemplate = editId != null ? templates.find((t) => t.id === editId) : null;

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add OT</button>
        <button className="btn btn-secondary" onClick={() => setShowColorEditor(true)}>Colours</button>
      </div>

      <div className="clinic-grid-container">
        <table className="clinic-grid">
          <thead>
            <tr>
              {DAY_NAMES.map((d) => <th key={d}>{d}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr>
              {DAY_NAMES.map((day, dow) => (
                <td
                  key={day}
                  className={`clinic-cell ${dragId !== null ? "drop-highlight" : ""}`}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                  onDrop={(e) => handleDrop(e, dow)}
                >
                  {grid[day].map((t) => (
                    <div
                      key={t.id}
                      className="clinic-card"
                      style={{
                        backgroundColor: otColor(t.room, t.is_emergency),
                        borderColor: otBorder(t.room, t.is_emergency),
                        cursor: "grab",
                      }}
                      draggable
                      onDragStart={(e) => { e.dataTransfer.setData("text/plain", String(t.id)); setDragId(t.id); }}
                      onDragEnd={() => setDragId(null)}
                      onClick={() => setEditId(t.id)}
                    >
                      <div className="clinic-card-type">
                        {t.is_emergency ? "⚡ " : ""}{t.room}
                      </div>
                      <div className="clinic-card-cons">
                        {t.is_emergency
                          ? (t.linked_call_slot ? `→ ${t.linked_call_slot}` : "Emergency")
                          : (t.consultant_name ?? "No consultant")}
                      </div>
                      <div className="clinic-card-mo">
                        {t.assistants_needed} asst
                      </div>
                    </div>
                  ))}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {rooms.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h4 style={{ margin: "0 0 8px" }}>Legend</h4>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {rooms.map((room) => {
              const tmpl = templates.find((t) => t.room === room);
              return (
                <span key={room} style={{
                  padding: "2px 8px", borderRadius: 4, fontSize: 12,
                  backgroundColor: otColor(room, tmpl?.is_emergency ?? false),
                  border: `1px solid ${otBorder(room, tmpl?.is_emergency ?? false)}`,
                }}>{room}</span>
              );
            })}
          </div>
        </div>
      )}

      {showAdd && (
        <OTFormModal
          title="Add OT Template"
          consultants={consultants}
          onSave={handleAdd}
          onClose={() => setShowAdd(false)}
        />
      )}
      {editTemplate && (
        <OTFormModal
          title="Edit OT Template"
          consultants={consultants}
          initial={editTemplate}
          onSave={(data) => handleUpdate(editTemplate.id, data)}
          onClose={() => setEditId(null)}
          onDelete={() => handleDelete(editTemplate.id)}
        />
      )}
      {showColorEditor && (
        <OTColorEditorModal
          colors={customColors}
          rooms={rooms}
          templates={templates}
          onSave={(c) => { setCustomColors(c); saveOTColors(c); setShowColorEditor(false); }}
          onClose={() => setShowColorEditor(false)}
        />
      )}
    </>
  );
}

function OTFormModal({
  title, consultants, initial, onSave, onClose, onDelete,
}: {
  title: string;
  consultants: Staff[];
  initial?: OTTemplate;
  onSave: (data: any) => void;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const [dow, setDow] = useState(initial?.day_of_week ?? 0);
  const [room, setRoom] = useState(initial?.room ?? "");
  const [consId, setConsId] = useState<number | null>(initial?.consultant_id ?? null);
  const [assists, setAssists] = useState(initial?.assistants_needed ?? 2);
  const [isEmergency, setIsEmergency] = useState(initial?.is_emergency ?? false);
  const [linkedSlot, setLinkedSlot] = useState<string | null>(initial?.linked_call_slot ?? null);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <div className="form-group">
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={isEmergency} onChange={(e) => {
              setIsEmergency(e.target.checked);
              if (e.target.checked) setConsId(null);
            }} />
            Emergency OT (24h, no fixed consultant)
          </label>
        </div>
        <div className="form-group">
          <label>Day</label>
          <select value={dow} onChange={(e) => setDow(Number(e.target.value))}>
            {DAY_NAMES.map((n, i) => <option key={i} value={i}>{n}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Room</label>
          <input type="text" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="e.g. EOT, OT3" />
        </div>
        {!isEmergency && (
          <div className="form-group">
            <label>Consultant</label>
            <select value={consId ?? ""} onChange={(e) => setConsId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">— None —</option>
              {consultants.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
        <div className="form-group">
          <label>Assistants Needed</label>
          <input type="number" value={assists} onChange={(e) => setAssists(Number(e.target.value))} min={0} max={6} />
        </div>
        {isEmergency && (
          <div className="form-group">
            <label>Linked Call Slot (auto-assign from call roster)</label>
            <select value={linkedSlot ?? ""} onChange={(e) => setLinkedSlot(e.target.value || null)}>
              <option value="">— None —</option>
              {CALL_SLOTS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}
        <div className="modal-actions">
          {onDelete && (
            <button className="btn btn-danger" onClick={onDelete} style={{ marginRight: "auto" }}>Delete</button>
          )}
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => {
            if (room.trim()) onSave({
              day_of_week: dow,
              room: room.trim(),
              consultant_id: isEmergency ? null : consId,
              assistants_needed: assists,
              is_emergency: isEmergency,
              linked_call_slot: isEmergency ? linkedSlot : null,
            });
          }}>Save</button>
        </div>
      </div>
    </div>
  );
}

function OTColorEditorModal({
  colors, rooms, templates, onSave, onClose,
}: {
  colors: Record<string, string>;
  rooms: string[];
  templates: OTTemplate[];
  onSave: (colors: Record<string, string>) => void;
  onClose: () => void;
}) {
  const [local, setLocal] = useState<Record<string, string>>({ ...colors });
  const [editing, setEditing] = useState<string | null>(null);

  function getColor(key: string): string {
    return local[key] || DEFAULT_OT_COLORS[key] || "#dbeafe";
  }

  function setColor(key: string, color: string) {
    setLocal((prev) => ({ ...prev, [key]: color }));
  }

  function resetAll() {
    setLocal({});
  }

  const entries: { key: string; label: string }[] = [
    { key: "_regular", label: "Regular OT (default)" },
    { key: "_emergency", label: "Emergency OT (default)" },
    ...rooms.map((r) => ({ key: r, label: r })),
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: 400, maxWidth: 520 }}>
        <h3>Customise OT Colours</h3>
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
          Set a colour per room, or change the defaults for regular/emergency OT.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
          {entries.map(({ key, label }) => (
            <div key={key}>
              <div
                style={{
                  display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
                  padding: "6px 10px", borderRadius: 6, border: "1px solid #ddd",
                  backgroundColor: getColor(key),
                }}
                onClick={() => setEditing(editing === key ? null : key)}
              >
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{label}</span>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {editing === key ? "close" : "change"}
                </span>
              </div>
              {editing === key && (
                <div style={{
                  display: "grid", gridTemplateColumns: "repeat(9, 1fr)", gap: 4,
                  padding: "8px 4px", background: "#fafafa", borderRadius: "0 0 6px 6px",
                  border: "1px solid #ddd", borderTop: "none",
                }}>
                  {COLOR_PRESETS.map((c) => (
                    <div
                      key={c}
                      onClick={() => { setColor(key, c); setEditing(null); }}
                      style={{
                        width: 28, height: 28, borderRadius: 4, backgroundColor: c, cursor: "pointer",
                        border: getColor(key) === c ? "2px solid var(--primary)" : "1px solid #ccc",
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={resetAll} style={{ marginRight: "auto" }}>Reset Defaults</button>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(local)}>Save</button>
        </div>
      </div>
    </div>
  );
}

function darken(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const f = 0.7;
  return `rgb(${Math.round(r * f)}, ${Math.round(g * f)}, ${Math.round(b * f)})`;
}
