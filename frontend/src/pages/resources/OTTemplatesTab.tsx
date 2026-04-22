import { useEffect, useState } from "react";
import { api } from "../../api";
import type { OTTemplate, Staff } from "../../types";
import { DAY_NAMES, CONS_GRADES } from "./constants";

export default function OTTemplatesTab() {
  const [templates, setTemplates] = useState<OTTemplate[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([api.getOTTemplates(), api.getStaff()]).then(([t, s]) => {
      setTemplates(t);
      setStaff(s);
      setLoading(false);
    });
  }, []);

  const consultants = staff.filter((s) => CONS_GRADES.includes(s.grade));

  async function handleAdd(data: { day_of_week: number; room: string; consultant_id: number; assistants_needed: number; is_la: boolean }) {
    const t = await api.createOTTemplate(data);
    setTemplates((prev) => [...prev, t]);
    setShowAdd(false);
  }

  async function handleUpdate(id: number, data: { day_of_week: number; room: string; consultant_id: number; assistants_needed: number; is_la: boolean }) {
    const t = await api.updateOTTemplate(id, data);
    setTemplates((prev) => prev.map((x) => (x.id === id ? t : x)));
    setEditing(null);
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this OT template?")) return;
    await api.deleteOTTemplate(id);
    setTemplates((prev) => prev.filter((x) => x.id !== id));
  }

  if (loading) return <div className="loading"><span className="spinner" /> Loading...</div>;

  const sorted = [...templates].sort((a, b) => a.day_of_week - b.day_of_week || a.room.localeCompare(b.room));

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add OT Template</button>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th>Room</th>
                <th>Consultant</th>
                <th>Assistants</th>
                <th>LA?</th>
                <th style={{ width: 120 }}></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) =>
                editing === t.id ? (
                  <OTEditRow key={t.id} template={t} consultants={consultants} onSave={handleUpdate} onCancel={() => setEditing(null)} />
                ) : (
                  <tr key={t.id}>
                    <td>{DAY_NAMES[t.day_of_week]}</td>
                    <td>{t.room}</td>
                    <td>{t.consultant_name}</td>
                    <td>{t.assistants_needed}</td>
                    <td>{t.is_la ? "Yes" : "No"}</td>
                    <td>
                      <div className="btn-group">
                        <button className="btn btn-sm btn-secondary" onClick={() => setEditing(t.id)}>Edit</button>
                        <button className="btn btn-sm btn-danger" onClick={() => handleDelete(t.id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                )
              )}
              {sorted.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--text-muted)" }}>No OT templates</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && <OTAddModal consultants={consultants} onAdd={handleAdd} onClose={() => setShowAdd(false)} />}
    </>
  );
}

function OTEditRow({
  template: t, consultants, onSave, onCancel,
}: {
  template: OTTemplate; consultants: Staff[];
  onSave: (id: number, data: any) => void; onCancel: () => void;
}) {
  const [dow, setDow] = useState(t.day_of_week);
  const [room, setRoom] = useState(t.room);
  const [consId, setConsId] = useState(t.consultant_id);
  const [assists, setAssists] = useState(t.assistants_needed);
  const [isLa, setIsLa] = useState(t.is_la);

  return (
    <tr>
      <td>
        <select value={dow} onChange={(e) => setDow(Number(e.target.value))} className="config-select">
          {DAY_NAMES.map((n, i) => <option key={i} value={i}>{n}</option>)}
        </select>
      </td>
      <td><input type="text" value={room} onChange={(e) => setRoom(e.target.value)} className="config-input" /></td>
      <td>
        <select value={consId} onChange={(e) => setConsId(Number(e.target.value))} className="config-select">
          {consultants.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </td>
      <td><input type="number" value={assists} onChange={(e) => setAssists(Number(e.target.value))} min={1} max={4} className="config-input" style={{ width: 60 }} /></td>
      <td><input type="checkbox" checked={isLa} onChange={(e) => setIsLa(e.target.checked)} /></td>
      <td>
        <div className="btn-group">
          <button className="btn btn-sm btn-primary" onClick={() => onSave(t.id, { day_of_week: dow, room, consultant_id: consId, assistants_needed: assists, is_la: isLa })}>Save</button>
          <button className="btn btn-sm btn-secondary" onClick={onCancel}>Cancel</button>
        </div>
      </td>
    </tr>
  );
}

function OTAddModal({
  consultants, onAdd, onClose,
}: {
  consultants: Staff[];
  onAdd: (data: any) => void; onClose: () => void;
}) {
  const [dow, setDow] = useState(0);
  const [room, setRoom] = useState("");
  const [consId, setConsId] = useState(consultants[0]?.id ?? 0);
  const [assists, setAssists] = useState(2);
  const [isLa, setIsLa] = useState(false);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Add OT Template</h3>
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
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => { if (room.trim()) onAdd({ day_of_week: dow, room: room.trim(), consultant_id: consId, assistants_needed: assists, is_la: isLa }); }}>Add</button>
        </div>
      </div>
    </div>
  );
}
