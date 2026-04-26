import { useEffect, useState, useCallback } from "react";
import { api } from "../../api";
import type { RegistrarDuty, Staff } from "../../types";
import { REG_RANKS } from "./constants";

const DUTY_TYPES = ["R1", "R2", "EOT"] as const;
const SHIFTS = ["day", "night", "combined"] as const;

interface DraftEntry {
  key: string;
  date: string;
  registrar_id: number | "";
  duty_type: string;
  shift: string;
}

let nextKey = 0;

export default function RegistrarRosterTab({ configId, year, month }: { configId: number; year: number; month: number }) {
  const [entries, setEntries] = useState<DraftEntry[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [rows, allStaff] = await Promise.all([
      api.getRegistrarDuties(configId),
      api.getStaff(),
    ]);
    setStaff(allStaff);
    setEntries(
      rows.map((r) => ({
        key: String(nextKey++),
        date: r.date,
        registrar_id: r.registrar_id,
        duty_type: r.duty_type,
        shift: r.shift,
      }))
    );
    setDirty(false);
    setLoading(false);
  }, [configId]);

  useEffect(() => { load(); }, [load]);

  const registrars = staff.filter((s) => REG_RANKS.includes(s.rank));

  function addEntry() {
    const firstDate = `${year}-${String(month).padStart(2, "0")}-01`;
    setEntries((prev) => [
      ...prev,
      { key: String(nextKey++), date: firstDate, registrar_id: registrars[0]?.id ?? "", duty_type: "R1", shift: "combined" },
    ]);
    setDirty(true);
  }

  function updateEntry(key: string, field: string, val: any) {
    setEntries((prev) => prev.map((e) => (e.key === key ? { ...e, [field]: val } : e)));
    setDirty(true);
  }

  function removeEntry(key: string) {
    setEntries((prev) => prev.filter((e) => e.key !== key));
    setDirty(true);
  }

  async function save() {
    const valid = entries.filter((e) => e.registrar_id !== "" && e.date);
    setSaving(true);
    try {
      await api.setRegistrarDuties(
        configId,
        valid.map((e) => ({
          date: e.date,
          registrar_id: e.registrar_id as number,
          duty_type: e.duty_type,
          shift: e.shift,
        }))
      );
      setDirty(false);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="loading"><span className="spinner" /> Loading...</div>;

  const numDays = new Date(year, month, 0).getDate();
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.duty_type.localeCompare(b.duty_type));

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
        <button className="btn btn-primary" onClick={save} disabled={saving || !dirty}>
          {saving ? <><span className="spinner" /> Saving...</> : "Save Changes"}
        </button>
        <button className="btn btn-secondary" onClick={addEntry}>+ Add Entry</button>
        {dirty && <span style={{ fontSize: 12, color: "var(--warning)" }}>Unsaved changes</span>}
      </div>
      <div className="card">
        <div className="table-wrap">
          <table className="config-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Registrar</th>
                <th>Duty Type</th>
                <th>Shift</th>
                <th style={{ width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((e) => (
                <tr key={e.key}>
                  <td>
                    <select
                      value={e.date}
                      onChange={(ev) => updateEntry(e.key, "date", ev.target.value)}
                      className="config-select"
                    >
                      {Array.from({ length: numDays }, (_, i) => {
                        const d = new Date(year, month - 1, i + 1);
                        const ds = `${year}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
                        const dn = d.toLocaleDateString("en", { weekday: "short" });
                        return <option key={ds} value={ds}>{ds.slice(5)} {dn}</option>;
                      })}
                    </select>
                  </td>
                  <td>
                    <select
                      value={e.registrar_id}
                      onChange={(ev) => updateEntry(e.key, "registrar_id", ev.target.value ? Number(ev.target.value) : "")}
                      className="config-select"
                    >
                      <option value="">-</option>
                      {registrars.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={e.duty_type} onChange={(ev) => updateEntry(e.key, "duty_type", ev.target.value)} className="config-select">
                      {DUTY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={e.shift} onChange={(ev) => updateEntry(e.key, "shift", ev.target.value)} className="config-select">
                      {SHIFTS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td>
                    <button className="btn btn-sm btn-danger" onClick={() => removeEntry(e.key)}>x</button>
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)" }}>No registrar duties. Click "+ Add Entry" to start.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
