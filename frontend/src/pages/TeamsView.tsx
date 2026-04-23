import { useEffect, useState, type DragEvent } from "react";
import { api } from "../api";
import type { Staff, Team, TeamAssignment } from "../types";

const TRAINEE_GRADES = ["Senior Staff Registrar", "Senior Resident", "Senior Medical Officer", "Medical Officer"];
const CONS_GRADES = ["Senior Consultant", "Consultant", "Associate Consultant"];

export default function TeamsView() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [assignments, setAssignments] = useState<TeamAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragId, setDragId] = useState<number | null>(null);
  const [dragGrade, setDragGrade] = useState<string>("");
  const [editingTeamId, setEditingTeamId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");

  async function reload() {
    const [s, t, a] = await Promise.all([
      api.getStaff(),
      api.getTeams(),
      api.getAllTeamAssignments(),
    ]);
    setStaff(s);
    setTeams(t);
    setAssignments(a);
    setLoading(false);
  }

  useEffect(() => { reload(); }, []);

  const moStaff = staff.filter((s) => TRAINEE_GRADES.includes(s.grade));
  const consStaff = staff.filter((s) => CONS_GRADES.includes(s.grade));

  function getTeamConsultants(teamId: number): Staff[] {
    const consIds = assignments
      .filter((a) => a.team_id === teamId && a.role === "consultant")
      .map((a) => a.staff_id);
    return consStaff.filter((s) => consIds.includes(s.id));
  }

  function getMOsForSupervisor(supervisorId: number): Staff[] {
    const moIds = assignments
      .filter((a) => a.role === "mo" && a.supervisor_id === supervisorId)
      .map((a) => a.staff_id);
    return moStaff.filter((s) => moIds.includes(s.id)).sort((a, b) => a.name.localeCompare(b.name));
  }

  function getTeamUntaggedMOs(teamId: number): Staff[] {
    const moIds = assignments
      .filter((a) => a.team_id === teamId && a.role === "mo" && !a.supervisor_id)
      .map((a) => a.staff_id);
    return moStaff.filter((s) => moIds.includes(s.id)).sort((a, b) => a.name.localeCompare(b.name));
  }

  function getUnassigned(): Staff[] {
    const assignedIds = new Set(assignments.map((a) => a.staff_id));
    return [...moStaff, ...consStaff]
      .filter((s) => !assignedIds.has(s.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function onDragStart(e: DragEvent, staffId: number, grade: string) {
    e.dataTransfer.setData("text/plain", String(staffId));
    setDragId(staffId);
    setDragGrade(grade);
  }

  function onDragEnd() {
    setDragId(null);
    setDragGrade("");
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  async function onDropTeam(e: DragEvent, teamId: number) {
    e.preventDefault();
    e.stopPropagation();
    const staffId = Number(e.dataTransfer.getData("text/plain"));
    if (!staffId) return;
    setDragId(null);
    try {
      await api.reassignStaff(staffId, teamId);
      await reload();
    } catch (err: any) {
      alert(err.message);
    }
  }

  async function onDropConsultant(e: DragEvent, consultantId: number, teamId: number) {
    e.preventDefault();
    e.stopPropagation();
    const staffId = Number(e.dataTransfer.getData("text/plain"));
    if (!staffId) return;
    const droppedStaff = staff.find((s) => s.id === staffId);
    if (!droppedStaff || !TRAINEE_GRADES.includes(droppedStaff.grade)) return;
    setDragId(null);
    try {
      await api.reassignStaff(staffId, teamId, consultantId);
      await reload();
    } catch (err: any) {
      alert(err.message);
    }
  }

  async function createTeam() {
    const name = prompt("Team name:");
    if (!name?.trim()) return;
    try {
      await api.createTeam(name.trim());
      await reload();
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function deleteTeam(id: number, name: string) {
    if (!confirm(`Delete team "${name}"? Members will become unassigned.`)) return;
    try {
      await api.deleteTeam(id);
      await reload();
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function moveTeam(teamId: number, direction: -1 | 1) {
    const idx = teams.findIndex((t) => t.id === teamId);
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= teams.length) return;
    const reordered = [...teams];
    [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];
    setTeams(reordered);
    try {
      await api.reorderTeams(reordered.map((t) => t.id));
    } catch (e: any) {
      alert(e.message);
      await reload();
    }
  }

  async function saveTeamName(teamId: number) {
    if (!editName.trim()) {
      setEditingTeamId(null);
      return;
    }
    try {
      await api.renameTeam(teamId, editName.trim());
      await reload();
    } catch (e: any) {
      alert(e.message);
    }
    setEditingTeamId(null);
  }

  if (loading) return <div className="loading"><span className="spinner" /> Loading teams...</div>;

  const unassigned = getUnassigned();

  return (
    <>
      <div className="page-header">
        <h2>Team Assignments</h2>
        <div className="btn-group">
          <button className="btn btn-primary" onClick={createTeam}>+ Create Team</button>
        </div>
      </div>
      <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
        Drag staff between teams. Drop an MO onto a consultant to tag them. Use arrows to reorder teams.
      </p>

      <div className="team-board">
        {teams.map((team, teamIdx) => {
          const consultants = getTeamConsultants(team.id);
          const untagged = getTeamUntaggedMOs(team.id);

          return (
            <div
              key={team.id}
              className={`team-column ${dragId !== null ? "drop-ready" : ""}`}
              onDragOver={onDragOver}
              onDrop={(e) => onDropTeam(e, team.id)}
            >
              <div className="team-header">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
                  {editingTeamId === team.id ? (
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={() => saveTeamName(team.id)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveTeamName(team.id); if (e.key === "Escape") setEditingTeamId(null); }}
                      autoFocus
                      style={{ fontWeight: 600, fontSize: 14, border: "1px solid var(--primary)", borderRadius: 4, padding: "2px 6px", width: "100%" }}
                    />
                  ) : (
                    <strong
                      style={{ cursor: "pointer" }}
                      onDoubleClick={() => { setEditingTeamId(team.id); setEditName(team.name); }}
                      title="Double-click to rename"
                    >
                      {team.name}
                    </strong>
                  )}
                  <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                    <button
                      onClick={() => moveTeam(team.id, -1)}
                      disabled={teamIdx === 0}
                      title="Move left"
                      style={{ width: 22, height: 22, fontSize: 12, border: "1px solid var(--border)", borderRadius: 4, background: "var(--bg)", color: "var(--text)", cursor: "pointer", opacity: teamIdx === 0 ? 0.3 : 1 }}
                    >
                      &#9664;
                    </button>
                    <button
                      onClick={() => moveTeam(team.id, 1)}
                      disabled={teamIdx === teams.length - 1}
                      title="Move right"
                      style={{ width: 22, height: 22, fontSize: 12, border: "1px solid var(--border)", borderRadius: 4, background: "var(--bg)", color: "var(--text)", cursor: "pointer", opacity: teamIdx === teams.length - 1 ? 0.3 : 1 }}
                    >
                      &#9654;
                    </button>
                    <button
                      onClick={() => deleteTeam(team.id, team.name)}
                      title="Delete team"
                      style={{ width: 22, height: 22, fontSize: 12, border: "1px solid #fecaca", borderRadius: 4, background: "#fef2f2", color: "var(--danger)", cursor: "pointer" }}
                    >
                      x
                    </button>
                  </div>
                </div>
              </div>
              <div className="team-members">
                {consultants.map((cons) => {
                  const taggedMOs = getMOsForSupervisor(cons.id);
                  return (
                    <div key={cons.id} className="consultant-section">
                      <div
                        className={`team-card consultant-card ${dragId !== null && dragGrade !== "" && TRAINEE_GRADES.includes(dragGrade) ? "drop-target" : ""}`}
                        draggable
                        onDragStart={(e) => onDragStart(e, cons.id, cons.grade)}
                        onDragEnd={onDragEnd}
                        onDragOver={onDragOver}
                        onDrop={(e) => onDropConsultant(e, cons.id, team.id)}
                      >
                        <span className="card-name">{cons.name}</span>
                        <span className="card-grade">{cons.grade}</span>
                      </div>
                      {taggedMOs.map((mo) => (
                        <div
                          key={mo.id}
                          className={`team-card tagged-mo ${dragId === mo.id ? "dragging" : ""}`}
                          draggable
                          onDragStart={(e) => onDragStart(e, mo.id, mo.grade)}
                          onDragEnd={onDragEnd}
                        >
                          <span className="card-name">{mo.name}</span>
                          <span className="card-grade">{mo.grade}</span>
                        </div>
                      ))}
                    </div>
                  );
                })}

                {untagged.length > 0 && (
                  <div className="untagged-section">
                    {consultants.length > 0 && (
                      <div style={{ fontSize: 11, color: "var(--text-muted)", padding: "4px 0", borderTop: "1px dashed var(--border)", marginTop: 4 }}>
                        Untagged
                      </div>
                    )}
                    {untagged.map((mo) => (
                      <div
                        key={mo.id}
                        className={`team-card ${dragId === mo.id ? "dragging" : ""}`}
                        draggable
                        onDragStart={(e) => onDragStart(e, mo.id, mo.grade)}
                        onDragEnd={onDragEnd}
                      >
                        <span className="card-name">{mo.name}</span>
                        <span className="card-grade">{mo.grade}</span>
                      </div>
                    ))}
                  </div>
                )}

                {consultants.length === 0 && untagged.length === 0 && (
                  <div className="team-empty">Drop staff here</div>
                )}
              </div>
              <div className="team-count">
                {consultants.length} cons, {getMOCount(team.id, assignments, moStaff)} MOs
              </div>
            </div>
          );
        })}

        {unassigned.length > 0 && (
          <div className="team-column unassigned">
            <div className="team-header">
              <strong>Unassigned</strong>
            </div>
            <div className="team-members">
              {unassigned.map((s) => (
                <div
                  key={s.id}
                  className={`team-card ${dragId === s.id ? "dragging" : ""}`}
                  draggable
                  onDragStart={(e) => onDragStart(e, s.id, s.grade)}
                  onDragEnd={onDragEnd}
                >
                  <span className="card-name">{s.name}</span>
                  <span className="card-grade">{s.grade}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function getMOCount(teamId: number, assignments: TeamAssignment[], moStaff: Staff[]): number {
  const moIds = new Set(moStaff.map((s) => s.id));
  return assignments.filter((a) => a.team_id === teamId && a.role === "mo" && moIds.has(a.staff_id)).length;
}
