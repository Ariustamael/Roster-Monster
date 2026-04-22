import { useEffect, useState, useCallback } from "react";
import { api } from "../../api";
import type { ConsultantOnCall, ACOnCall, Staff } from "../../types";
import { CONS_GRADES, AC_GRADES } from "./constants";

interface DayRow {
  date: string;
  dayName: string;
  isWeekend: boolean;
  consultantId: number | "";
  supervisingId: number | "";
  acId: number | "";
}

export default function ConsultantRosterTab({ configId, year, month }: { configId: number; year: number; month: number }) {
  const [rows, setRows] = useState<DayRow[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const numDays = new Date(year, month, 0).getDate();

  const load = useCallback(async () => {
    setLoading(true);
    const [consRows, acRows, allStaff] = await Promise.all([
      api.getConsultantOnCall(configId),
      api.getACOnCall(configId),
      api.getStaff(),
    ]);
    setStaff(allStaff);

    const consMap = new Map<string, ConsultantOnCall>();
    for (const r of consRows) consMap.set(r.date, r);
    const acMap = new Map<string, ACOnCall>();
    for (const r of acRows) acMap.set(r.date, r);

    const dayRows: DayRow[] = [];
    for (let d = 1; d <= numDays; d++) {
      const dt = new Date(year, month - 1, d);
      const dateStr = dt.toISOString().slice(0, 10);
      const cons = consMap.get(dateStr);
      const ac = acMap.get(dateStr);
      dayRows.push({
        date: dateStr,
        dayName: dt.toLocaleDateString("en", { weekday: "short" }),
        isWeekend: dt.getDay() === 0 || dt.getDay() === 6,
        consultantId: cons?.consultant_id ?? "",
        supervisingId: cons?.supervising_consultant_id ?? "",
        acId: ac?.ac_id ?? "",
      });
    }
    setRows(dayRows);
    setDirty(false);
    setLoading(false);
  }, [configId, year, month, numDays]);

  useEffect(() => { load(); }, [load]);

  const consultants = staff.filter((s) => CONS_GRADES.includes(s.grade));
  const acs = staff.filter((s) => AC_GRADES.includes(s.grade));

  function updateRow(idx: number, field: keyof DayRow, val: number | "") {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: val } : r)));
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    try {
      const consEntries = rows
        .filter((r) => r.consultantId !== "")
        .map((r) => ({
          date: r.date,
          consultant_id: r.consultantId as number,
          supervising_consultant_id: r.supervisingId || null,
        }));
      const acEntries = rows
        .filter((r) => r.acId !== "")
        .map((r) => ({ date: r.date, ac_id: r.acId as number }));

      await Promise.all([
        api.setConsultantOnCall(configId, consEntries),
        api.setACOnCall(configId, acEntries),
      ]);
      setDirty(false);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="loading"><span className="spinner" /> Loading...</div>;

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
        <button className="btn btn-primary" onClick={save} disabled={saving || !dirty}>
          {saving ? <><span className="spinner" /> Saving...</> : "Save Changes"}
        </button>
        {dirty && <span style={{ fontSize: 12, color: "var(--warning)" }}>Unsaved changes</span>}
      </div>
      <div className="card">
        <div className="table-wrap">
          <table className="config-table">
            <thead>
              <tr>
                <th style={{ width: 70 }}>Date</th>
                <th style={{ width: 40 }}>Day</th>
                <th>On-Call Consultant</th>
                <th>Supervising (AC primary)</th>
                <th>AC (secondary)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={r.date} className={r.isWeekend ? "weekend" : ""}>
                  <td>{r.date.slice(5)}</td>
                  <td>{r.dayName}</td>
                  <td>
                    <select
                      value={r.consultantId}
                      onChange={(e) => updateRow(idx, "consultantId", e.target.value ? Number(e.target.value) : "")}
                      className="config-select"
                    >
                      <option value="">-</option>
                      {consultants.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </td>
                  <td>
                    <select
                      value={r.supervisingId}
                      onChange={(e) => updateRow(idx, "supervisingId", e.target.value ? Number(e.target.value) : "")}
                      className="config-select"
                    >
                      <option value="">-</option>
                      {consultants.filter((c) => c.id !== r.consultantId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </td>
                  <td>
                    <select
                      value={r.acId}
                      onChange={(e) => updateRow(idx, "acId", e.target.value ? Number(e.target.value) : "")}
                      className="config-select"
                    >
                      <option value="">-</option>
                      {acs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
