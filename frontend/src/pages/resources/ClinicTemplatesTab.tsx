import { useEffect, useState, type DragEvent } from "react";
import { api } from "../../api";
import type { ClinicTemplate, Staff } from "../../types";
import { DAY_NAMES, CONS_GRADES, COLOR_PRESETS } from "./constants";

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

function loadCustomColors(): Record<string, string> {
  try {
    const raw = localStorage.getItem("clinic-colors");
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveCustomColors(colors: Record<string, string>) {
  localStorage.setItem("clinic-colors", JSON.stringify(colors));
}

export default function ClinicTemplatesTab() {
  const [templates, setTemplates] = useState<ClinicTemplate[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [customColors, setCustomColors] = useState<Record<string, string>>(loadCustomColors);
  const [showColorEditor, setShowColorEditor] = useState(false);

  useEffect(() => {
    Promise.all([api.getClinicTemplates(), api.getStaff()]).then(([t, s]) => {
      setTemplates(t);
      setStaff(s);
      setLoading(false);
    });
  }, []);

  function clinicColor(type: string): string {
    return customColors[type] || DEFAULT_COLORS[type] || "#f8f9fa";
  }

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
    setEditId(null);
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
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add Clinic</button>
        <button className="btn btn-secondary" onClick={() => setShowColorEditor(true)}>Colours</button>
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
                        style={{ backgroundColor: clinicColor(t.clinic_type), cursor: "grab" }}
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
              backgroundColor: clinicColor(ct), border: "1px solid #ddd",
            }}>{ct}</span>
          ))}
        </div>
      </div>

      {showAdd && (
        <ClinicFormModal
          title="Add Clinic Template"
          consultants={consultants}
          clinicColor={clinicColor}
          onSave={handleAdd}
          onClose={() => setShowAdd(false)}
        />
      )}
      {editTemplate && (
        <ClinicFormModal
          title="Edit Clinic Template"
          consultants={consultants}
          clinicColor={clinicColor}
          initial={editTemplate}
          onSave={(data) => handleUpdate(editTemplate.id, data)}
          onClose={() => setEditId(null)}
          onDelete={() => handleDelete(editTemplate.id)}
        />
      )}
      {showColorEditor && (
        <ColorEditorModal
          colors={customColors}
          defaults={DEFAULT_COLORS}
          onSave={(c) => { setCustomColors(c); saveCustomColors(c); setShowColorEditor(false); }}
          onClose={() => setShowColorEditor(false)}
        />
      )}
    </>
  );
}

function ClinicFormModal({
  title, consultants, clinicColor, initial, onSave, onClose, onDelete,
}: {
  title: string;
  consultants: Staff[];
  clinicColor: (type: string) => string;
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
          <select
            value={clinicType}
            onChange={(e) => setClinicType(e.target.value)}
            style={{ backgroundColor: clinicColor(clinicType) }}
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

function ColorEditorModal({
  colors, defaults, onSave, onClose,
}: {
  colors: Record<string, string>;
  defaults: Record<string, string>;
  onSave: (colors: Record<string, string>) => void;
  onClose: () => void;
}) {
  const [local, setLocal] = useState<Record<string, string>>({ ...colors });
  const [editing, setEditing] = useState<string | null>(null);

  function getColor(type: string): string {
    return local[type] || defaults[type] || "#f8f9fa";
  }

  function setColor(type: string, color: string) {
    setLocal((prev) => ({ ...prev, [type]: color }));
  }

  function resetAll() {
    setLocal({});
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ minWidth: 400, maxWidth: 520 }}>
        <h3>Customise Clinic Colours</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
          {CLINIC_TYPES.map((ct) => (
            <div key={ct}>
              <div
                style={{
                  display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
                  padding: "6px 10px", borderRadius: 6, border: "1px solid #ddd",
                  backgroundColor: getColor(ct),
                }}
                onClick={() => setEditing(editing === ct ? null : ct)}
              >
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{ct}</span>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {editing === ct ? "close" : "change"}
                </span>
              </div>
              {editing === ct && (
                <div style={{
                  display: "grid", gridTemplateColumns: "repeat(9, 1fr)", gap: 4,
                  padding: "8px 4px", background: "#fafafa", borderRadius: "0 0 6px 6px",
                  border: "1px solid #ddd", borderTop: "none",
                }}>
                  {COLOR_PRESETS.map((c) => (
                    <div
                      key={c}
                      onClick={() => { setColor(ct, c); setEditing(null); }}
                      style={{
                        width: 28, height: 28, borderRadius: 4, backgroundColor: c, cursor: "pointer",
                        border: getColor(ct) === c ? "2px solid var(--primary)" : "1px solid #ccc",
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
