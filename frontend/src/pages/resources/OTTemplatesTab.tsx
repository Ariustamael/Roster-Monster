import { useEffect, useState, type DragEvent } from "react";
import { api } from "../../api";
import type { OTTemplate, Staff } from "../../types";
import { DAY_NAMES, CONS_GRADES } from "./constants";

export default function OTTemplatesTab() {
  const [templates, setTemplates] = useState<OTTemplate[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([api.getOTTemplates(), api.getStaff()]).then(([t, s]) => {
      setTemplates(t);
      setStaff(s);
      setLoading(false);
    });
  }, []);

  const consultants = staff.filter((s) => CONS_GRADES.includes(s.grade));

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
      is_la: tmpl.is_la,
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
  for (const day of DAY_NAMES) grid[day].sort((a, b) => a.room.localeCompare(b.room));

  const editTemplate = editId != null ? templates.find((t) => t.id === editId) : null;

  return (
    <>
      <div style={{ marginBottom: 12 }}>
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
                  {grid[day].map((t) => (
                    <div
                      key={t.id}
                      className="clinic-card"
                      style={{ backgroundColor: t.is_la ? "#fef7e0" : "#dbeafe", cursor: "grab" }}
                      draggable
                      onDragStart={(e) => { e.dataTransfer.setData("text/plain", String(t.id)); setDragId(t.id); }}
                      onDragEnd={() => setDragId(null)}
                      onClick={() => setEditId(t.id)}
                    >
                      <div className="clinic-card-type">{t.room}</div>
                      <div className="clinic-card-cons">{t.consultant_name}</div>
                      <div className="clinic-card-mo">
                        {t.assistants_needed} asst{t.is_la ? " · LA" : ""}
                      </div>
                    </div>
                  ))}
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
  const [consId, setConsId] = useState(initial?.consultant_id ?? consultants[0]?.id ?? 0);
  const [assists, setAssists] = useState(initial?.assistants_needed ?? 2);
  const [isLa, setIsLa] = useState(initial?.is_la ?? false);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <div className="form-group">
          <label>Day</label>
          <select value={dow} onChange={(e) => setDow(Number(e.target.value))}>
            {DAY_NAMES.map((n, i) => <option key={i} value={i}>{n}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Room</label>
          <input type="text" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="e.g. OT3" />
        </div>
        <div className="form-group">
          <label>Consultant</label>
          <select value={consId} onChange={(e) => setConsId(Number(e.target.value))}>
            {consultants.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Assistants Needed</label>
          <input type="number" value={assists} onChange={(e) => setAssists(Number(e.target.value))} min={1} max={4} />
        </div>
        <div className="form-group">
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={isLa} onChange={(e) => setIsLa(e.target.checked)} /> LA (Local Anaesthesia)
          </label>
        </div>
        <div className="modal-actions">
          {onDelete && (
            <button className="btn btn-danger" onClick={onDelete} style={{ marginRight: "auto" }}>Delete</button>
          )}
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => {
            if (room.trim()) onSave({ day_of_week: dow, room: room.trim(), consultant_id: consId, assistants_needed: assists, is_la: isLa });
          }}>Save</button>
        </div>
      </div>
    </div>
  );
}
