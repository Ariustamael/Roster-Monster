import { useEffect, useState } from "react";
import { api } from "../../api";
import type { ClinicTemplate, Staff } from "../../types";
import { DAY_NAMES, CONS_GRADES } from "./constants";

const SESSIONS = ["AM", "PM"];

export default function ClinicTemplatesTab() {
  const [templates, setTemplates] = useState<ClinicTemplate[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([api.getClinicTemplates(), api.getStaff()]).then(([t, s]) => {
      setTemplates(t);
      setStaff(s);
      setLoading(false);
    });
  }, []);

  const consultants = staff.filter((s) => CONS_GRADES.includes(s.grade));

  async function handleAdd(data: any) {
    const t = await api.createClinicTemplate(data);
    setTemplates((prev) => [...prev, t]);
    setShowAdd(false);
  }

  async function handleUpdate(id: number, data: any) {
    const t = await api.updateClinicTemplate(id, data);
    setTemplates((prev) => prev.map((x) => (x.id === id ? t : x)));
    setEditing(null);
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this clinic template?")) return;
    await api.deleteClinicTemplate(id);
    setTemplates((prev) => prev.filter((x) => x.id !== id));
  }

  if (loading) return <div className="loading"><span className="spinner" /> Loading...</div>;

  const sorted = [...templates].sort((a, b) => a.day_of_week - b.day_of_week || a.session.localeCompare(b.session) || a.room.localeCompare(b.room));

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add Clinic Template</button>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th>Session</th>
                <th>Room</th>
                <th>Supervised</th>
                <th>Consultant</th>
                <th style={{ width: 120 }}></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) =>
                editing === t.id ? (
                  <ClinicEditRow key={t.id} template={t} consultants={consultants} onSave={handleUpdate} onCancel={() => setEditing(null)} />
                ) : (
                  <tr key={t.id}>
                    <td>{DAY_NAMES[t.day_of_week]}</td>
                    <td>{t.session}</td>
                    <td>{t.room}</td>
                    <td>{t.is_supervised ? "Yes" : "No"}</td>
                    <td>{t.consultant_name || "-"}</td>
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
                <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--text-muted)" }}>No clinic templates</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && <ClinicAddModal consultants={consultants} onAdd={handleAdd} onClose={() => setShowAdd(false)} />}
    </>
  );
}

function ClinicEditRow({
  template: t, consultants, onSave, onCancel,
}: {
  template: ClinicTemplate; consultants: Staff[];
  onSave: (id: number, data: any) => void; onCancel: () => void;
}) {
  const [dow, setDow] = useState(t.day_of_week);
  const [session, setSession] = useState(t.session);
  const [room, setRoom] = useState(t.room);
  const [supervised, setSupervised] = useState(t.is_supervised);
  const [consId, setConsId] = useState<number | "">(t.consultant_id ?? "");

  return (
    <tr>
      <td>
        <select value={dow} onChange={(e) => setDow(Number(e.target.value))} className="config-select">
          {DAY_NAMES.map((n, i) => <option key={i} value={i}>{n}</option>)}
        </select>
      </td>
      <td>
        <select value={session} onChange={(e) => setSession(e.target.value)} className="config-select">
          {SESSIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </td>
      <td><input type="text" value={room} onChange={(e) => setRoom(e.target.value)} className="config-input" /></td>
      <td><input type="checkbox" checked={supervised} onChange={(e) => setSupervised(e.target.checked)} /></td>
      <td>
        <select value={consId} onChange={(e) => setConsId(e.target.value ? Number(e.target.value) : "")} className="config-select">
          <option value="">None</option>
          {consultants.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </td>
      <td>
        <div className="btn-group">
          <button className="btn btn-sm btn-primary" onClick={() => onSave(t.id, { day_of_week: dow, session, room, is_supervised: supervised, consultant_id: consId || null })}>Save</button>
          <button className="btn btn-sm btn-secondary" onClick={onCancel}>Cancel</button>
        </div>
      </td>
    </tr>
  );
}

function ClinicAddModal({
  consultants, onAdd, onClose,
}: {
  consultants: Staff[]; onAdd: (data: any) => void; onClose: () => void;
}) {
  const [dow, setDow] = useState(0);
  const [session, setSession] = useState("AM");
  const [room, setRoom] = useState("");
  const [supervised, setSupervised] = useState(true);
  const [consId, setConsId] = useState<number | "">(consultants[0]?.id ?? "");

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Add Clinic Template</h3>
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
          <label>Room</label>
          <input type="text" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="e.g. 4E-Sup" />
        </div>
        <div className="form-group">
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={supervised} onChange={(e) => setSupervised(e.target.checked)} /> Supervised
          </label>
        </div>
        <div className="form-group">
          <label>Consultant</label>
          <select value={consId} onChange={(e) => setConsId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">None</option>
            {consultants.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => { if (room.trim()) onAdd({ day_of_week: dow, session, room: room.trim(), is_supervised: supervised, consultant_id: consId || null }); }}>Add</button>
        </div>
      </div>
    </div>
  );
}
