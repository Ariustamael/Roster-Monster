import { useEffect, useState, useCallback } from "react";
import { api } from "../../api";

export default function DayFlagsTab({ configId, year, month }: { configId: number; year: number; month: number }) {
  const [stepdownDates, setStepdownDates] = useState<Set<string>>(new Set());
  const [eveningOTDates, setEveningOTDates] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const numDays = new Date(year, month, 0).getDate();

  const load = useCallback(async () => {
    setLoading(true);
    const [sd, eot] = await Promise.all([
      api.getStepdownDays(configId),
      api.getEveningOTDates(configId),
    ]);
    setStepdownDates(new Set(sd.map((r) => r.date)));
    setEveningOTDates(new Set(eot.map((r) => r.date)));
    setDirty(false);
    setLoading(false);
  }, [configId]);

  useEffect(() => { load(); }, [load]);

  function toggleStepdown(dateStr: string) {
    setStepdownDates((prev) => {
      const next = new Set(prev);
      if (next.has(dateStr)) next.delete(dateStr); else next.add(dateStr);
      return next;
    });
    setDirty(true);
  }

  function toggleEveningOT(dateStr: string) {
    setEveningOTDates((prev) => {
      const next = new Set(prev);
      if (next.has(dateStr)) next.delete(dateStr); else next.add(dateStr);
      return next;
    });
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    try {
      await Promise.all([
        api.setStepdownDays(configId, [...stepdownDates].map((d) => ({ date: d }))),
        api.setEveningOTDates(configId, [...eveningOTDates].map((d) => ({ date: d }))),
      ]);
      setDirty(false);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="loading"><span className="spinner" /> Loading...</div>;

  const days = Array.from({ length: numDays }, (_, i) => {
    const dt = new Date(year, month - 1, i + 1);
    const dateStr = dt.toISOString().slice(0, 10);
    const dayName = dt.toLocaleDateString("en", { weekday: "short" });
    const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
    return { dateStr, dayName, isWeekend };
  });

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
        <button className="btn btn-primary" onClick={save} disabled={saving || !dirty}>
          {saving ? <><span className="spinner" /> Saving...</> : "Save Changes"}
        </button>
        {dirty && <span style={{ fontSize: 12, color: "var(--warning)" }}>Unsaved changes</span>}
      </div>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
        <strong>Stepdown:</strong> MO3 becomes 24h overnight on these days (weekends get MO3 only if stepdown).
        <strong> Evening OT:</strong> MO4 + MO5 are added on these weekdays.
      </p>
      <div className="card">
        <div className="table-wrap">
          <table className="config-table">
            <thead>
              <tr>
                <th style={{ width: 70 }}>Date</th>
                <th style={{ width: 40 }}>Day</th>
                <th style={{ width: 100 }}>Stepdown</th>
                <th style={{ width: 100 }}>Evening OT</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.dateStr} className={d.isWeekend ? "weekend" : ""}>
                  <td>{d.dateStr.slice(5)}</td>
                  <td>{d.dayName}</td>
                  <td style={{ textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={stepdownDates.has(d.dateStr)}
                      onChange={() => toggleStepdown(d.dateStr)}
                    />
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={eveningOTDates.has(d.dateStr)}
                      onChange={() => toggleEveningOT(d.dateStr)}
                      disabled={d.isWeekend}
                    />
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
