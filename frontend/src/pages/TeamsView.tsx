import { useEffect, useState, type DragEvent } from "react";
import { api } from "../api";
import type { Staff, Team, TeamAssignment } from "../types";

const MO_GRADES = ["Resident Physician", "Clinical Associate", "Medical Officer"];

export default function TeamsView() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [assignments, setAssignments] = useState<TeamAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragId, setDragId] = useState<number | null>(null);

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

  const moStaff = staff.filter((s) => MO_GRADES.includes(s.grade) && s.active);

  function getTeamConsultant(teamId: number): string {
    const a = assignments.find((a) => a.team_id === teamId && a.role === "consultant");
    return a?.staff_name ?? "—";
  }

  function getTeamMOs(teamId: number): Staff[] {
    const moIds = assignments
      .filter((a) => a.team_id === teamId && a.role === "mo")
      .map((a) => a.staff_id);
    return moStaff.filter((s) => moIds.includes(s.id)).sort((a, b) => a.name.localeCompare(b.name));
  }

  function getUnassignedMOs(): Staff[] {
    const assignedIds = new Set(assignments.filter((a) => a.role === "mo").map((a) => a.staff_id));
    return moStaff.filter((s) => !assignedIds.has(s.id)).sort((a, b) => a.name.localeCompare(b.name));
  }

  function onDragStart(e: DragEvent, staffId: number) {
    e.dataTransfer.setData("text/plain", String(staffId));
    setDragId(staffId);
  }

  function onDragEnd() {
    setDragId(null);
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  async function onDrop(e: DragEvent, teamId: number) {
    e.preventDefault();
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

  if (loading) return <div className="loading"><span className="spinner" /> Loading teams...</div>;

  const unassigned = getUnassignedMOs();

  return (
    <>
      <div className="page-header">
        <h2>Team Assignments</h2>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          Drag MOs between teams to reassign them.
        </p>
      </div>

      <div className="team-board">
        {teams.map((team) => {
          const mos = getTeamMOs(team.id);
          return (
            <div
              key={team.id}
              className={`team-column ${dragId !== null ? "drop-ready" : ""}`}
              onDragOver={onDragOver}
              onDrop={(e) => onDrop(e, team.id)}
            >
              <div className="team-header">
                <strong>{team.name}</strong>
                <span className="team-consultant">{getTeamConsultant(team.id)}</span>
              </div>
              <div className="team-members">
                {mos.map((mo) => (
                  <div
                    key={mo.id}
                    className={`team-card ${dragId === mo.id ? "dragging" : ""}`}
                    draggable
                    onDragStart={(e) => onDragStart(e, mo.id)}
                    onDragEnd={onDragEnd}
                  >
                    <span className="card-name">{mo.name}</span>
                    <span className="card-grade">{mo.grade}</span>
                  </div>
                ))}
                {mos.length === 0 && (
                  <div className="team-empty">No MOs assigned</div>
                )}
              </div>
              <div className="team-count">{mos.length} MO{mos.length !== 1 ? "s" : ""}</div>
            </div>
          );
        })}

        {unassigned.length > 0 && (
          <div className="team-column unassigned">
            <div className="team-header">
              <strong>Unassigned</strong>
            </div>
            <div className="team-members">
              {unassigned.map((mo) => (
                <div
                  key={mo.id}
                  className={`team-card ${dragId === mo.id ? "dragging" : ""}`}
                  draggable
                  onDragStart={(e) => onDragStart(e, mo.id)}
                  onDragEnd={onDragEnd}
                >
                  <span className="card-name">{mo.name}</span>
                  <span className="card-grade">{mo.grade}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
