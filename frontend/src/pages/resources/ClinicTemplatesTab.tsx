import { useEffect, useState, type DragEvent } from "react";
import { api } from "../../api";
import type { ClinicTemplate, Staff } from "../../types";
import { DAY_NAMES, CONS_RANKS, COLOR_PRESETS } from "./constants";

const SESSIONS = ["AM", "PM"] as const;
const CLINIC_TYPES = ["NC", "Sup", "MOPD", "Hand VC", "CAT-A", "Lump", "NES", "MSK", "3E", "WMC"] as const;

const DEFAULT_COLORS: Record<string, string> = {
  NC: "#e8f0fe",
  Sup: "#e6f4ea",
  MOPD: "#fef7e0",
  "Hand VC": "#fce8e6",
  "CAT-A": "#f3e8fd",
  WMC: "#e8eaed",
};

export default function ClinicTemplatesTab() {
  const [templates, setTemplates] = useState<ClinicTemplate[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.getClinicTemplates(), api.getStaff()]).then(([t, s]) => {
      setTemplates(t);
      setStaff(s);
      setLoading(false);
    });
  }, []);

  const consultants = staff.filter((s) => CONS_RANKS.includes(s.rank));

  async function handleAdd(data: any) {
    try {
      const t = await api.createClinicTemplate(data);
      setTemplates((prev) => [...prev, t]);
      setShowAdd(false);
    } catch (e: any) {
      setError(e?.message ?? "Failed to add clinic template.");
    }
  }

  async function handleUpdate(id: number, data: any) {
    try {
      const t = await api.updateClinicTemplate(id, data);
      setTemplates((prev) => prev.map((x) => (x.id === id ? t : x)));
      setEditId(null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to update clinic template.");
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this clinic template?")) return;
    try {
      await api.deleteClinicTemplate(id);
      setTemplates((prev) => prev.filter((x) => x.id !== id));
      setEditId(null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to delete clinic template.");
    }
  }

  async function handleDrop(e: DragEvent, targetDow: number, targetSession: string) {
    e.preventDefault();
    const id = Number(e.dataTransfer.getData("text/plain"));
    if (!id) return;
    const tmpl = templates.find((t) => t.id === id);
    if (!tmpl) { setDragId(null); return; }
    if (tmpl.day_of_week === targetDow && tmpl.session === targetSession) {
      setDragId(null);
      return;
    }
    await handleUpdate(id, {
      day_of_week: targetDow,
      session: targetSession,
      room: tmpl.room,
      clinic_type: tmpl.clinic_type,
      mos_required: tmpl.mos_required,
      consultant_id: tmpl.consultant_id,
      color: tmpl.color,
      is_active: tmpl.is_active,
    });
    setDragId(null);
  }

  if (loading) return <div className="loading"><span className="spinner" /> Loading...</div>;

  const grid: Record<string, Record<string, ClinicTemplate[]>> = {};
  for (const day of DAY_NAMES) grid[day] = { AM: [], PM: [] };
  for (const t of templates) {
    if (t.day_of_week >= 0 && t.day_of_week < 7) {
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
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add Clinic</button>
      </div>

      <div className="clinic-grid-container">
        <table className="clinic-grid">
          <thead>
            <tr>
              <th style={{ width: 60 }}></th>
              {DAY_NAMES.map((d) => <th key={d}>{d}</th>)}
            </tr>
          </thead>
          <tbody>
            {SESSIONS.map((sess) => (
              <tr key={sess}>
                <td className="session-label">{sess}</td>
                {DAY_NAMES.map((day, dow) => (
                  <td
                    key={`${day}-${sess}`}
                    className={`clinic-cell ${dragId !== null ? "drop-highlight" : ""}`}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                    onDrop={(e) => handleDrop(e, dow, sess)}
                  >
                    {grid[day][sess].map((t) => (
                      <div
                        key={t.id}
                        className={`clinic-card ${dragId === t.id ? "dragging" : ""}`}
                        style={{ backgroundColor: t.color ?? DEFAULT_COLORS[t.clinic_type] ?? "#f8f9fa", cursor: "grab", opacity: t.is_active === false ? 0.45 : 1 }}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", String(t.id));
                          setDragId(t.id);
                        }}
                        onDragEnd={() => setDragId(null)}
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
              backgroundColor: DEFAULT_COLORS[ct] ?? "#f8f9fa", border: "1px solid #ddd",
            }}>{ct}</span>
          ))}
        </div>
      </div>

      {showAdd && (
        <ClinicFormModal
          title="Add Clinic Template"
          consultants={consultants}
          onSave={handleAdd}
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
  const [color, setColor] = useState<string | null>(initial?.color ?? null);
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);

  const effectiveColor = color ?? DEFAULT_COLORS[clinicType] ?? "#f8f9fa";

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
          <select
            value={clinicType}
            onChange={(e) => setClinicType(e.target.value)}
            style={{ backgroundColor: effectiveColor }}
          >
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
        <div className="form-group">
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Active
          </label>
        </div>
        <div className="form-group">
          <label>Card Colour</label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(9, 1fr)", gap: 4, marginTop: 4 }}>
            {/* Clear / reset-to-default swatch */}
            <div
              title="Reset to default"
              onClick={() => setColor(null)}
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
                  day_of_week: dow, session, room: room.trim(),
                  clinic_type: clinicType, mos_required: mosRequired,
                  consultant_id: consId || null,
                  color,
                  is_active: isActive,
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
