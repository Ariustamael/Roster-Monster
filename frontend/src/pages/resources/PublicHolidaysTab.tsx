import { useEffect, useState } from "react";
import { api } from "../../api";
import type { PublicHoliday } from "../../types";

export default function PublicHolidaysTab() {
  const [holidays, setHolidays] = useState<PublicHoliday[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    api.getPublicHolidays().then((h) => {
      setHolidays(h);
      setLoading(false);
    });
  }, []);

  async function handleAdd(date: string, name: string) {
    try {
      const h = await api.createPublicHoliday(date, name);
      setHolidays((prev) => [...prev, h].sort((a, b) => a.date.localeCompare(b.date)));
      setShowAdd(false);
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Remove this public holiday?")) return;
    await api.deletePublicHoliday(id);
    setHolidays((prev) => prev.filter((h) => h.id !== id));
  }

  if (loading) return <div className="loading"><span className="spinner" /> Loading...</div>;

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add Holiday</button>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Day</th>
                <th>Name</th>
                <th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {holidays.map((h) => {
                const dt = new Date(h.date + "T00:00:00");
                const dayName = dt.toLocaleDateString("en", { weekday: "short" });
                return (
                  <tr key={h.id}>
                    <td>{h.date}</td>
                    <td>{dayName}</td>
                    <td>{h.name}</td>
                    <td>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(h.id)}>Delete</button>
                    </td>
                  </tr>
                );
              })}
              {holidays.length === 0 && (
                <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--text-muted)" }}>No public holidays</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && <HolidayAddModal onAdd={handleAdd} onClose={() => setShowAdd(false)} />}
    </>
  );
}

function HolidayAddModal({ onAdd, onClose }: { onAdd: (date: string, name: string) => void; onClose: () => void }) {
  const [date, setDate] = useState("");
  const [name, setName] = useState("");

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Add Public Holiday</h3>
        <div className="form-group">
          <label>Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Good Friday" />
        </div>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => { if (date && name.trim()) onAdd(date, name.trim()); }}>Add</button>
        </div>
      </div>
    </div>
  );
}
