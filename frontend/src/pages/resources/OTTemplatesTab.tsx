import { useEffect, useState, type DragEvent } from "react";
import { api } from "../../api";
import type { OTTemplate, Staff } from "../../types";
import { DAY_NAMES, CONS_GRADES, COLOR_PRESETS } from "./constants";

const CALL_SLOTS = ["MO1", "MO2", "MO3", "MO4", "MO5"];

export default function OTTemplatesTab() {
  const [templates, setTemplates] = useState<OTTemplate[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.getOTTemplates(), api.getStaff()]).then(([t, s]) => {
      setTemplates(t);
      setStaff(s);
      setLoading(false);
    });
  }, []);

  const consultants = staff.filter((s) => CONS_GRADES.includes(s.grade));

  async function handleAdd(data: any) {
    try {
      const t = await api.createOTTemplate(data);
      setTemplates((prev) => [...prev, t]);
      setShowAdd(false);
    } catch (err: any) {
      setError(err?.message ?? "Failed to create OT template.");
    }
  }

  async function handleUpdate(id: number, data: any) {
    try {
      const t = await api.updateOTTemplate(id, data);
      setTemplates((prev) => prev.map((x) => (x.id === id ? t : x)));
      setEditId(null);
    } catch (err: any) {
      setError(err?.message ?? "Failed to update OT template.");
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this OT template?")) return;
    try {
      await api.deleteOTTemplate(id);
      setTemplates((prev) => prev.filter((x) => x.id !== id));
      setEditId(null);
    } catch (err: any) {
      setError(err?.message ?? "Failed to delete OT template.");
    }
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
      color: tmpl.color,
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
      {error && (
        <div style={{
          background: "#fee2e2", border: "1px solid #fca5a5", color: "#b91c1c",
          borderRadius: 6, padding: "10px 14px", marginBottom: 12,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#b91c1c" }}
          >
            &times;
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add OT</button>
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
                  {grid[day].map((t) => {
                    const bg = t.color ?? (t.is_emergency ? "#fef3c7" : "#dbeafe");
                    return (
                      <div
                        key={t.id}
                        className="clinic-card"
                        style={{
                          backgroundColor: bg,
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
                    );
                  })}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

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
  const [linkedSlots, setLinkedSlots] = useState<string[]>(
    initial?.linked_call_slot ? initial.linked_call_slot.split(",").map((s) => s.trim()).filter(Boolean) : []
  );
  const [color, setColor] = useState<string | null>(initial?.color ?? null);

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
            <label>Linked Call Slots (auto-assign from call roster)</label>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 4 }}>
              {CALL_SLOTS.map((slot) => (
                <label key={slot} style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={linkedSlots.includes(slot)}
                    onChange={() => toggleSlot(slot)}
                  />
                  {slot}
                </label>
              ))}
            </div>
          </div>
        )}
        <div className="form-group">
          <label>Card Colour</label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(9, 28px)", gap: 4, marginTop: 4 }}>
            <div
              onClick={() => setColor(null)}
              title="Clear (use default)"
              style={{
                width: 28, height: 28, borderRadius: 4, cursor: "pointer",
                background: "repeating-linear-gradient(45deg, #ccc 0px, #ccc 4px, #fff 4px, #fff 8px)",
                border: color === null ? "2px solid var(--primary, #3b82f6)" : "1px solid #ccc",
              }}
            />
            {COLOR_PRESETS.map((c) => (
              <div
                key={c}
                onClick={() => setColor(c)}
                title={c}
                style={{
                  width: 28, height: 28, borderRadius: 4, backgroundColor: c, cursor: "pointer",
                  border: color === c ? "2px solid var(--primary, #3b82f6)" : "1px solid #ccc",
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
          <button className="btn btn-primary" onClick={() => {
            if (room.trim()) onSave({
              day_of_week: dow,
              room: room.trim(),
              consultant_id: isEmergency ? null : consId,
              assistants_needed: assists,
              is_emergency: isEmergency,
              linked_call_slot: isEmergency && linkedSlots.length > 0 ? linkedSlots.join(",") : null,
              color,
            });
          }}>Save</button>
        </div>
      </div>
    </div>
  );
}
