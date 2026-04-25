import { useEffect, useState } from "react";
import { api } from "../api";
import { useEscClose } from "../hooks/useEscClose";
import type { ResourceTemplate, Staff, RankConfig } from "../types";

const SESSIONS_OT = ["AM", "PM", "Full Day"] as const;
const SESSIONS_CLINIC = ["AM", "PM"] as const;

export default function DayResourcesModal({
  date,
  onClose,
  onSaved,
}: {
  date: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  useEscClose(onClose);
  const [items, setItems] = useState<ResourceTemplate[]>([]);
  const [consultants, setConsultants] = useState<Staff[]>([]);
  const [ranks, setRanks] = useState<RankConfig[]>([]);
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      let rows = await api.listDayResourceOverrides(date);
      if (rows.length === 0) {
        // Lazy initialize: clone weekly defaults so the user has something to edit.
        rows = await api.initializeDayResourceOverrides(date);
      }
      setItems(rows);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    api.getStaff().then(s => setConsultants(s.filter(x => x.active)));
    api.getRanks().then(setRanks);
  }, [date]);

  async function handleDelete(id: number) {
    if (!confirm("Remove this resource for this day?")) return;
    try {
      await api.deleteResourceTemplate(id);
      await load();
      onSaved();
    } catch (e: any) { setError(e.message); }
  }

  async function handleResetDay() {
    if (!confirm(`Reset ${date} to the default weekly schedule? All per-day edits for this date will be lost.`)) return;
    try {
      await api.resetDayResourceOverrides(date);
      onSaved();
      onClose();
    } catch (e: any) { setError(e.message); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <h3 style={{ marginTop: 0 }}>Edit Resources — {date}</h3>
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
          Per-day edits override the weekly template for this date only. Use ↻ Regenerate after editing
          to re-solve the day's duty assignments.
        </p>
        {error && <div className="error">{error}</div>}
        {loading && <p>Loading…</p>}

        {!loading && (
          <>
            <table className="rules-table" style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>Type</th><th>Session</th><th>Room</th><th>Label</th>
                  <th>Consultant</th><th>Staff</th><th>P</th><th></th>
                </tr>
              </thead>
              <tbody>
                {items.map(t => (
                  <tr key={t.id}>
                    <td>{t.resource_type === "ot" ? (t.is_emergency ? "⚡ EOT" : "OT") : "Clinic"}</td>
                    <td>{t.session}</td>
                    <td>{t.room}</td>
                    <td>{t.label}</td>
                    <td>{t.consultant_name ?? "-"}</td>
                    <td>{t.staff_required}</td>
                    <td>{t.priority ?? 5}</td>
                    <td style={{ textAlign: "right" }}>
                      <button className="btn-link" onClick={() => setEditingId(t.id)}>Edit</button>
                      <button className="btn-link" onClick={() => handleDelete(t.id)} style={{ color: "var(--danger)" }}>×</button>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr><td colSpan={8} style={{ color: "var(--text-muted)" }}>No resources for this day.</td></tr>
                )}
              </tbody>
            </table>

            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <button className="btn btn-primary" onClick={() => setEditingId("new")}>+ Add Resource</button>
              <button className="btn btn-secondary" onClick={handleResetDay}>↺ Reset Day to Default</button>
              <span style={{ flex: 1 }} />
              <button className="btn btn-secondary" onClick={onClose}>Close</button>
            </div>
          </>
        )}

        {editingId !== null && (
          <DayResourceForm
            initial={editingId === "new" ? null : items.find(t => t.id === editingId) ?? null}
            date={date}
            consultants={consultants}
            ranks={ranks}
            onClose={() => setEditingId(null)}
            onSaved={async () => { setEditingId(null); await load(); onSaved(); }}
          />
        )}
      </div>
    </div>
  );
}

function DayResourceForm({
  initial, date, consultants, ranks, onClose, onSaved,
}: {
  initial: ResourceTemplate | null;
  date: string;
  consultants: Staff[];
  ranks: RankConfig[];
  onClose: () => void;
  onSaved: () => void;
}) {
  useEscClose(onClose);
  const [resourceType, setResourceType] = useState<"clinic" | "ot">(initial?.resource_type ?? "clinic");
  const [session, setSession] = useState<string>(initial?.session ?? "AM");
  const [room, setRoom] = useState(initial?.room ?? "");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [consId, setConsId] = useState<number | null>(initial?.consultant_id ?? null);
  const [staffRequired, setStaffRequired] = useState(initial?.staff_required ?? 1);
  const [isEmergency, setIsEmergency] = useState(initial?.is_emergency ?? false);
  const [priority, setPriority] = useState(initial?.priority ?? 5);
  const [linkedManpower, setLinkedManpower] = useState(initial?.linked_manpower ?? "");
  const [eligibleRankIds, setEligibleRankIds] = useState<number[]>(
    initial?.eligible_rank_ids
      ? initial.eligible_rank_ids.split(",").map(s => parseInt(s.trim())).filter(n => !isNaN(n))
      : []
  );
  const [error, setError] = useState<string | null>(null);
  const isOT = resourceType === "ot";
  const dutyEligibleRanks = ranks.filter(r => r.is_active && r.is_duty_eligible)
    .sort((a, b) => a.display_order - b.display_order);

  async function save() {
    if (!room.trim()) { setError("Room is required"); return; }
    const dow = new Date(date + "T00:00:00").getDay();
    // JS Date getDay: 0=Sun. Backend day_of_week: 0=Mon..6=Sun (per existing code).
    // Convert: backend = (jsDay + 6) % 7
    const backendDow = (dow + 6) % 7;
    const payload = {
      resource_type: resourceType,
      day_of_week: backendDow,
      session,
      room: room.trim(),
      label: label.trim(),
      consultant_id: isEmergency ? null : consId,
      staff_required: staffRequired,
      is_emergency: isOT ? isEmergency : false,
      linked_manpower: linkedManpower.trim() || null,
      weeks: null,
      color: null,
      is_active: true,
      sort_order: initial?.sort_order ?? 0,
      priority,
      max_registrars: 1,
      eligible_rank_ids: eligibleRankIds.length > 0 ? eligibleRankIds.join(",") : null,
      effective_date: date,
    };
    try {
      if (initial) {
        await api.updateResourceTemplate(initial.id, payload as any);
      } else {
        await api.createResourceTemplate(payload as any);
      }
      onSaved();
    } catch (e: any) { setError(e.message); }
  }

  const sessionOptions = isOT ? SESSIONS_OT : SESSIONS_CLINIC;
  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 60 }}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
        <h3 style={{ marginTop: 0 }}>{initial ? "Edit Resource" : "Add Resource"}</h3>
        {error && <div className="error">{error}</div>}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Type</label>
            <select value={resourceType} onChange={(e) => {
              const v = e.target.value as "clinic" | "ot";
              setResourceType(v);
              if (v === "clinic" && session === "Full Day") setSession("AM");
            }}>
              <option value="clinic">Clinic</option>
              <option value="ot">OT</option>
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Session</label>
            <select value={session} onChange={(e) => setSession(e.target.value)}>
              {sessionOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <div className="form-group">
          <label>Room *</label>
          <input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="e.g. OT3, Rm 15, MOPD" />
        </div>
        <div className="form-group">
          <label>Label</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. SUP, NC, MOPD" />
        </div>

        {isOT && (
          <div className="form-group">
            <label>
              <input type="checkbox" checked={isEmergency} onChange={(e) => setIsEmergency(e.target.checked)} />
              {" "}Emergency OT (no fixed consultant)
            </label>
            {isEmergency && (
              <input
                style={{ marginTop: 6 }}
                value={linkedManpower}
                onChange={(e) => setLinkedManpower(e.target.value)}
                placeholder="Linked call types e.g. MO2,R1,R2"
              />
            )}
          </div>
        )}
        {!isEmergency && (
          <div className="form-group">
            <label>Consultant</label>
            <select value={consId ?? ""} onChange={(e) => setConsId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">— None —</option>
              {consultants.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Staff Required</label>
            <input type="number" min={0} max={10} value={staffRequired}
              onChange={(e) => setStaffRequired(Number(e.target.value))} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Priority (1–10)</label>
            <input type="number" min={1} max={10} value={priority}
              onChange={(e) => setPriority(Math.max(1, Math.min(10, Number(e.target.value))))} />
          </div>
        </div>

        <div className="form-group">
          <label>Eligible Ranks (empty = any duty-eligible)</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {dutyEligibleRanks.map(r => {
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
                    onChange={() => setEligibleRankIds(prev =>
                      prev.includes(r.id) ? prev.filter(x => x !== r.id) : [...prev, r.id]
                    )} />
                  {r.abbreviation || r.name}
                </label>
              );
            })}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={!room.trim()}>Save</button>
        </div>
      </div>
    </div>
  );
}
