import { useEffect, useState } from "react";
import { api } from "../../api";
import type { ClinicTemplate, Staff } from "../../types";
import { DAY_NAMES, CONS_GRADES } from "./constants";

const SESSIONS = ["AM", "PM"] as const;
const CLINIC_TYPES = ["NC", "Sup", "MOPD", "Hand VC", "CAT-A", "Lump", "NES", "MSK", "3E", "WMC"] as const;

function clinicLabel(t: ClinicTemplate): string {
  const parts = [t.clinic_type || "Sup"];
  if (t.room) parts.push(t.room);
  if (t.mos_required > 0) parts.push(`(${t.mos_required} MO)`);
  return parts.join(" · ");
}

function clinicColor(type: string): string {
  switch (type) {
    case "NC": return "#e8f0fe";
    case "Sup": return "#e6f4ea";
    case "MOPD": return "#fef7e0";
    case "Hand VC": return "#fce8e6";
    case "CAT-A": return "#f3e8fd";
    case "WMC": return "#e8eaed";
    default: return "#f8f9fa";
  }
}

export default function ClinicTemplatesTab() {
  const [templates, setTemplates] = useState<ClinicTemplate[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);

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
    setEditId(null);
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this clinic template?")) return;
    await api.deleteClinicTemplate(id);
    setTemplates((prev) => prev.filter((x) => x.id !== id));
  }

  if (loading) return <div className="loading"><span className="spinner" /> Loading...</div>;

  const grid: Record<string, Record<string, ClinicTemplate[]>> = {};
  for (const day of DAY_NAMES) {
    grid[day] = { AM: [], PM: [] };
  }
  for (const t of templates) {
    if (t.day_of_week >= 0 && t.day_of_week < 5) {
      const dayKey = DAY_NAMES[t.day_of_week];
      const sess = t.session === "PM" ? "PM" : "AM";
      grid[dayKey][sess].push(t);
    }
  }

  for (const day of DAY_NAMES) {
    for (const sess of SESSIONS) {
      grid[day][sess].sort((a, b) => a.room.localeCompare(b.room));
    }
  }

  const editTemplate = editId != null ? templates.find((t) => t.id === editId) : null;

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add Clinic</button>
      </div>

      <div className="clinic-grid-container">
        <table className="clinic-grid">
          <thead>
            <tr>
              <th style={{ width: 60 }}></th>
              {DAY_NAMES.map((d) => (
                <th key={d}>{d}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SESSIONS.map((sess) => (
              <tr key={sess}>
                <td className="session-label">{sess}</td>
                {DAY_NAMES.map((day) => (
                  <td key={`${day}-${sess}`} className="clinic-cell">
                    {grid[day][sess].map((t) => (
                      <div
                        key={t.id}
                        className="clinic-card"
                        style={{ backgroundColor: clinicColor(t.clinic_type) }}
                        onClick={() => setEditId(t.id)}
                      >
                        <div className="clinic-card-type">{t.clinic_type || "Sup"}</div>
                        <div className="clinic-card-room">{t.room}</div>
                        {t.consultant_name && (
                          <div className="clinic-card-cons">{t.consultant_name}</div>
                        )}
                        {t.mos_required > 0 && (
                          <div className="clinic-card-mo">{t.mos_required} MO</div>
                        )}
                      </div>
                    ))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 16 }}>
        <h4 style={{ margin: "0 0 8px" }}>Legend</h4>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {CLINIC_TYPES.map((ct) => (
            <span key={ct} style={{
              padding: "2px 8px", borderRadius: 4, fontSize: 12,
              backgroundColor: clinicColor(ct), border: "1px solid #ddd",
            }}>{ct}</span>
          ))}
        </div>
      </div>

      {showAdd && (
        <ClinicFormModal
          title="Add Clinic Template"
          consultants={consultants}
          onSave={(data) => handleAdd(data)}
          onClose={() => setShowAdd(false)}
        />
      )}
      {editTemplate && (
        <ClinicFormModal
          title="Edit Clinic Template"
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

function ClinicFormModal({
  title, consultants, initial, onSave, onClose, onDelete,
}: {
  title: string;
  consultants: Staff[];
  initial?: ClinicTemplate;
  onSave: (data: any) => void;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const [dow, setDow] = useState(initial?.day_of_week ?? 0);
  const [session, setSession] = useState(initial?.session ?? "AM");
  const [room, setRoom] = useState(initial?.room ?? "");
  const [clinicType, setClinicType] = useState(initial?.clinic_type ?? "Sup");
  const [mosRequired, setMosRequired] = useState(initial?.mos_required ?? 1);
  const [consId, setConsId] = useState<number | "">(initial?.consultant_id ?? "");

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
          <label>Session</label>
          <select value={session} onChange={(e) => setSession(e.target.value)}>
            {SESSIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Room</label>
          <input type="text" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="e.g. 4E-Rm3" />
        </div>
        <div className="form-group">
          <label>Clinic Type</label>
          <select value={clinicType} onChange={(e) => setClinicType(e.target.value)}>
            {CLINIC_TYPES.map((ct) => <option key={ct} value={ct}>{ct}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>MOs Required</label>
          <input
            type="number" min={0} max={10} value={mosRequired}
            onChange={(e) => setMosRequired(Number(e.target.value))}
          />
        </div>
        <div className="form-group">
          <label>Consultant</label>
          <select value={consId} onChange={(e) => setConsId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">None</option>
            {consultants.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
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
                  day_of_week: dow, session, room: room.trim(),
                  clinic_type: clinicType, mos_required: mosRequired,
                  consultant_id: consId || null,
                });
              }
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
