import { useEffect, useState } from "react";
import { api } from "../api";
import type { Staff } from "../types";

const GRADE_ORDER: Record<string, number> = {
  "Senior Consultant": 0,
  "Consultant": 1,
  "Associate Consultant": 2,
  "Registrar": 3,
  "Resident Physician": 4,
  "Clinical Associate": 5,
  "Medical Officer": 6,
};

export default function StaffView() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    api.getStaff().then(setStaff).finally(() => setLoading(false));
  }, []);

  const filtered = staff
    .filter(
      (s) =>
        s.name.toLowerCase().includes(filter.toLowerCase()) ||
        s.grade.toLowerCase().includes(filter.toLowerCase()) ||
        (s.team_name || "").toLowerCase().includes(filter.toLowerCase())
    )
    .sort((a, b) => (GRADE_ORDER[a.grade] ?? 9) - (GRADE_ORDER[b.grade] ?? 9) || a.name.localeCompare(b.name));

  const moCount = staff.filter((s) =>
    ["Resident Physician", "Clinical Associate", "Medical Officer"].includes(s.grade)
  ).length;

  return (
    <>
      <div className="page-header">
        <h2>Staff ({staff.length} total, {moCount} MOs)</h2>
        <input
          type="text"
          placeholder="Filter by name, grade, or team..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            padding: "8px 12px",
            border: "1px solid var(--border)",
            borderRadius: 6,
            fontSize: 13,
            width: 260,
          }}
        />
      </div>

      {loading ? (
        <div className="loading"><span className="spinner" /> Loading staff...</div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Grade</th>
                  <th>Team</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 500 }}>{s.name}</td>
                    <td>{s.grade}</td>
                    <td>{s.team_name || "-"}</td>
                    <td>
                      <span style={{
                        color: s.active ? "var(--success)" : "var(--danger)",
                        fontWeight: 500,
                      }}>
                        {s.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
