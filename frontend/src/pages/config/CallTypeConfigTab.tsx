import { useEffect, useState } from "react";
import { api } from "../../api";
import type { CallTypeConfig, RankConfig } from "../../types";
import MultiSelectDropdown from "../../components/MultiSelectDropdown";
import { useEscClose } from "../../hooks/useEscClose";

const POST_CALL_OPTIONS = [
  { value: "8am", label: "Off from 8am (full day off)" },
  { value: "12pm", label: "Off from 12pm (AM duties, no PM)" },
  { value: "5pm", label: "Off from 5pm (AM+PM duties, no call)" },
  { value: "call_only", label: "Call only (next-day call, no duties)" },
  { value: "none", label: "None (fully available)" },
] as const;

const ALL_DAY_TOKENS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "PH"] as const;
const CONDITION_TOKENS = ["Stepdown", "Extended OT", "PH", "Not PH"] as const;

function parseDays(str: string): Set<string> {
  return new Set(str.split(",").map((s) => s.trim()).filter(Boolean));
}

function toggleDay(current: string, day: string): string {
  const set = parseDays(current);
  if (set.has(day)) {
    set.delete(day);
  } else {
    set.add(day);
  }
  return ALL_DAY_TOKENS.filter((d) => set.has(d)).join(",");
}

function parseConditions(str: string | null): Set<string> {
  if (!str) return new Set();
  return new Set(str.split(",").map((s) => s.trim()).filter(Boolean));
}

function toggleCondition(current: string | null, cond: string): string {
  const set = parseConditions(current);
  if (set.has(cond)) set.delete(cond);
  else set.add(cond);
  return CONDITION_TOKENS.filter((c) => set.has(c)).join(",") || "";
}

const RUN_DAY_TOKENS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function parseRunDays(str: string | null): Set<string> {
  if (!str) return new Set();
  return new Set(str.split(",").map((s) => s.trim()).filter(Boolean));
}

function toggleRunDay(current: string | null, day: string): string {
  const set = parseRunDays(current);
  if (set.has(day)) set.delete(day);
  else set.add(day);
  return RUN_DAY_TOKENS.filter((d) => set.has(d)).join(",");
}

interface DraftCallType {
  id: number | null;
  name: string;
  display_order: number;
  is_overnight: boolean;
  post_call_type: string;
  max_consecutive_days: number;
  min_consecutive_days: number;
  min_gap_days: number;
  switch_window_days: number;
  difficulty_points: number;
  counts_towards_fairness: boolean;
  applicable_days: string;
  required_conditions: string;
  is_night_float: boolean;
  night_float_run: string | null;
  uses_consultant_affinity: boolean;
  is_active: boolean;
  eligible_rank_ids: number[];
  is_duty_only: boolean;
  linked_to: number[];
  mutually_exclusive_with: number[];
}

export default function CallTypeConfigTab() {
  const [callTypes, setCallTypes] = useState<CallTypeConfig[]>([]);
  const [ranks, setRanks] = useState<RankConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<DraftCallType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragCtId, setDragCtId] = useState<number | null>(null);
  const [dragOverCtId, setDragOverCtId] = useState<number | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEscClose(() => { setEditId(null); setDraft(null); }, editId != null);

  async function load() {
    setLoading(true);
    try {
      const [ct, rk] = await Promise.all([api.getCallTypes(), api.getRanks()]);
      setCallTypes(ct.sort((a, b) => a.display_order - b.display_order));
      setRanks(rk.sort((a, b) => a.display_order - b.display_order));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function startEdit(ct: CallTypeConfig) {
    setEditId(ct.id);
    setDraft({
      id: ct.id,
      name: ct.name,
      display_order: ct.display_order,
      is_overnight: ct.is_overnight,
      post_call_type: ct.post_call_type,
      max_consecutive_days: ct.max_consecutive_days,
      min_consecutive_days: ct.min_consecutive_days ?? 1,
      min_gap_days: ct.min_gap_days,
      switch_window_days: ct.switch_window_days ?? 5,
      difficulty_points: ct.difficulty_points,
      counts_towards_fairness: ct.counts_towards_fairness,
      applicable_days: ct.applicable_days,
      required_conditions: ct.required_conditions ?? "",
      is_night_float: ct.is_night_float,
      night_float_run: ct.night_float_run,
      uses_consultant_affinity: ct.uses_consultant_affinity ?? false,
      is_active: ct.is_active,
      eligible_rank_ids: ct.eligible_rank_ids,
      is_duty_only: ct.is_duty_only ?? false,
      linked_to: ct.linked_to ? ct.linked_to.split(",").map(s => parseInt(s.trim())).filter(n => !isNaN(n)) : [],
      mutually_exclusive_with: ct.mutually_exclusive_with ? ct.mutually_exclusive_with.split(",").map(s => parseInt(s.trim())).filter(n => !isNaN(n)) : [],
    });
  }

  function startAdd() {
    setEditId("new");
    setDraft({
      id: null,
      name: "",
      display_order: callTypes.length > 0 ? Math.max(...callTypes.map((c) => c.display_order)) + 1 : 0,
      is_overnight: true,
      post_call_type: "8am",
      max_consecutive_days: 1,
      min_consecutive_days: 1,
      min_gap_days: 2,
      switch_window_days: 5,
      difficulty_points: 3,
      counts_towards_fairness: true,
      applicable_days: "Mon,Tue,Wed,Thu,Fri,Sat,Sun,PH",
      required_conditions: "",
      is_night_float: false,
      night_float_run: null,
      uses_consultant_affinity: false,
      is_active: true,
      eligible_rank_ids: ranks.filter((r) => r.is_call_eligible).map((r) => r.id),
      is_duty_only: false,
      linked_to: [],
      mutually_exclusive_with: [],
    });
  }

  async function save() {
    if (!draft || !draft.name.trim()) return;
    setError(null);
    try {
      const payload = {
        name: draft.name.trim(),
        display_order: draft.display_order,
        is_overnight: draft.is_overnight,
        post_call_type: draft.post_call_type,
        max_consecutive_days: draft.max_consecutive_days,
        min_consecutive_days: draft.min_consecutive_days,
        min_gap_days: draft.min_gap_days,
        switch_window_days: draft.switch_window_days,
        difficulty_points: draft.difficulty_points,
        counts_towards_fairness: draft.counts_towards_fairness,
        applicable_days: draft.applicable_days,
        required_conditions: draft.required_conditions || null,
        is_night_float: draft.is_night_float,
        night_float_run: draft.night_float_run || null,
        uses_consultant_affinity: draft.uses_consultant_affinity,
        is_active: draft.is_active,
        eligible_rank_ids: draft.eligible_rank_ids,
        is_duty_only: draft.is_duty_only,
        linked_to: draft.linked_to.length > 0 ? draft.linked_to.join(",") : null,
        mutually_exclusive_with: draft.mutually_exclusive_with.length > 0 ? draft.mutually_exclusive_with.join(",") : null,
      };
      if (draft.id != null) {
        await api.updateCallType(draft.id, payload);
      } else {
        await api.createCallType(payload);
      }
      setEditId(null);
      setDraft(null);
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this call type? Existing assignments using it will be orphaned.")) return;
    try {
      await api.deleteCallType(id);
      setEditId(null);
      setDraft(null);
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  function toggleRank(rankId: number) {
    if (!draft) return;
    const ids = draft.eligible_rank_ids.includes(rankId)
      ? draft.eligible_rank_ids.filter((id) => id !== rankId)
      : [...draft.eligible_rank_ids, rankId];
    setDraft({ ...draft, eligible_rank_ids: ids });
  }

  if (loading) return <div className="loading"><span className="spinner" /> Loading...</div>;

  const rankById = new Map(ranks.map((r) => [r.id, r]));

  return (
    <>
      {error && (
        <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", color: "#b91c1c", borderRadius: 6, padding: "8px 14px", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#b91c1c", fontWeight: 700 }}>✕</button>
        </div>
      )}

      <div className="page-header" style={{ marginBottom: 12 }}>
        <h2>Call Types</h2>
        <div className="btn-group">
          <button className="btn btn-primary" onClick={startAdd}>+ Add Call Type</button>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="config-table">
            <thead>
              <tr>
                <th style={{ width: 30 }}></th>
                <th>Name</th>
                <th>Overnight</th>
                <th>Night Float</th>
                <th>Post-Call</th>
                <th>Gap</th>
                <th>Difficulty</th>
                <th>Fairness</th>
                <th>Days</th>
                <th>Eligible Ranks</th>
                <th>Active</th>
                <th>Duty Only</th>
                <th style={{ width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {callTypes.map((ct) => (
                <tr
                  key={ct.id}
                  draggable
                  onDragStart={() => setDragCtId(ct.id)}
                  onDragOver={(e) => { e.preventDefault(); setDragOverCtId(ct.id); }}
                  onDragLeave={() => setDragOverCtId(null)}
                  onDrop={async () => {
                    if (dragCtId === null || dragCtId === ct.id) { setDragCtId(null); setDragOverCtId(null); return; }
                    const ordered = [...callTypes];
                    const fromIdx = ordered.findIndex(c => c.id === dragCtId);
                    const toIdx = ordered.findIndex(c => c.id === ct.id);
                    const [moved] = ordered.splice(fromIdx, 1);
                    ordered.splice(toIdx, 0, moved);
                    for (let i = 0; i < ordered.length; i++) {
                      if (ordered[i].display_order !== i) {
                        await api.updateCallType(ordered[i].id, { ...ordered[i], display_order: i, eligible_rank_ids: ordered[i].eligible_rank_ids });
                      }
                    }
                    setDragCtId(null);
                    setDragOverCtId(null);
                    await load();
                  }}
                  style={{ opacity: ct.is_active ? 1 : 0.5, outline: dragOverCtId === ct.id ? "2px dashed var(--primary)" : undefined }}
                >
                  <td style={{ cursor: "grab", textAlign: "center" }}>☰</td>
                  <td style={{ fontWeight: 600 }}>{ct.name}</td>
                  <td>{ct.is_overnight ? "Yes" : "No"}</td>
                  <td>{ct.is_night_float ? <span style={{ color: "#6366f1", fontSize: 11, fontWeight: 600 }}>NF{ct.night_float_run ? ` (${ct.night_float_run})` : ""}</span> : "-"}</td>
                  <td>{ct.post_call_type}</td>
                  <td>{ct.min_gap_days}d</td>
                  <td>{ct.difficulty_points}</td>
                  <td>{ct.counts_towards_fairness ? "Yes" : "No"}</td>
                  <td>{ct.applicable_days}</td>
                  <td style={{ fontSize: 11 }}>
                    {ct.eligible_rank_ids.map((id) => rankById.get(id)?.abbreviation ?? `#${id}`).join(", ")}
                  </td>
                  <td>{ct.is_active ? "Yes" : "No"}</td>
                  <td>{ct.is_duty_only ? "Yes" : "-"}</td>
                  <td>
                    <button className="btn btn-sm btn-secondary" onClick={() => startEdit(ct)}>Edit</button>
                  </td>
                </tr>
              ))}
              {callTypes.length === 0 && (
                <tr><td colSpan={13} style={{ textAlign: "center", color: "var(--text-muted)" }}>No call types configured.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editId != null && draft && (
        <div className="modal-backdrop" onClick={() => { setEditId(null); setDraft(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{draft.id != null ? "Edit Call Type" : "Add Call Type"}</h3>

            {/* ── Identity ─────────────────────────── */}
            <SectionHeader label="Identity" />
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label htmlFor="ct-name">Name <span style={{ color: "#dc2626" }}>*</span></label>
                <input id="ct-name" type="text" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. MO1" />
              </div>
              <div className="form-group" style={{ margin: 0, display: "flex", alignItems: "flex-end", gap: 12, paddingBottom: 6 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
                  <input type="checkbox" checked={draft.is_active} onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })} />
                  Active
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }} title="Appears in Duty Roster only, not Call Roster">
                  <input type="checkbox" checked={draft.is_duty_only} onChange={(e) => setDraft({ ...draft, is_duty_only: e.target.checked })} />
                  Duty-only
                </label>
              </div>
            </div>

            {/* ── Behaviour ────────────────────────── */}
            <SectionHeader label="Behaviour" />
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 10 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={draft.is_overnight} onChange={(e) => setDraft({ ...draft, is_overnight: e.target.checked })} />
                Overnight (24h)
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }} title="Prefer MOs whose supervisor is today's on-call consultant, or whose team matches.">
                <input type="checkbox" checked={draft.uses_consultant_affinity} onChange={(e) => setDraft({ ...draft, uses_consultant_affinity: e.target.checked })} />
                Own Consultant Affinity
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={draft.counts_towards_fairness} onChange={(e) => setDraft({ ...draft, counts_towards_fairness: e.target.checked })} />
                Counts towards fairness
              </label>
            </div>
            <div className="form-group">
              <label>Post-Call Mode</label>
              <select value={draft.post_call_type} onChange={(e) => setDraft({ ...draft, post_call_type: e.target.value })}>
                {POST_CALL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            <div className="form-group" style={{ background: "var(--bg-muted, #f8fafc)", borderRadius: 6, padding: "10px 12px", border: "1px solid var(--border)" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
                <input type="checkbox" checked={draft.is_night_float} onChange={(e) => setDraft({ ...draft, is_night_float: e.target.checked, night_float_run: e.target.checked ? draft.night_float_run : null })} />
                Night Float (nights only — excluded from day duties)
              </label>
              {draft.is_night_float && (
                <div style={{ marginTop: 8 }}>
                  <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
                    Consecutive Run Days (same person covers all selected days in a week)
                  </label>
                  <div style={{ display: "flex", gap: 10 }}>
                    {RUN_DAY_TOKENS.map((day) => (
                      <label key={day} style={{ display: "flex", alignItems: "center", gap: 3, cursor: "pointer", fontSize: 13 }}>
                        <input
                          type="checkbox"
                          checked={parseRunDays(draft.night_float_run).has(day)}
                          onChange={() => setDraft({ ...draft, night_float_run: toggleRunDay(draft.night_float_run, day) })}
                        />
                        {day}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ── Scheduling ───────────────────────── */}
            <SectionHeader label="Scheduling" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label title="Min clear days before the same person does this call type again.">Min Gap (days)</label>
                <input type="number" value={draft.min_gap_days} onChange={(e) => setDraft({ ...draft, min_gap_days: Number(e.target.value) })} min={0} max={14} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Max Consecutive</label>
                <input type="number" value={draft.max_consecutive_days} onChange={(e) => setDraft({ ...draft, max_consecutive_days: Number(e.target.value) })} min={1} max={7} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Difficulty (1-5)</label>
                <input type="number" value={draft.difficulty_points} onChange={(e) => setDraft({ ...draft, difficulty_points: Number(e.target.value) })} min={1} max={5} />
              </div>
            </div>

            <div className="form-group" style={{ background: "var(--bg-muted, #f8fafc)", borderRadius: 6, padding: "10px 12px", border: "1px solid var(--border)" }}>
              <label style={{ fontWeight: 600, fontSize: 12, marginBottom: 6, display: "block" }}>Applicable Days</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                {ALL_DAY_TOKENS.map((day, i) => (
                  <span key={day} style={{ display: "inline-flex", alignItems: "center", gap: 0 }}>
                    {i === 7 && <span style={{ margin: "0 4px", color: "#ccc" }}>|</span>}
                    <label style={{ display: "flex", alignItems: "center", gap: 3, cursor: "pointer", fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={parseDays(draft.applicable_days).has(day)}
                        onChange={() => setDraft({ ...draft, applicable_days: toggleDay(draft.applicable_days, day) })}
                      />
                      {day}
                    </label>
                  </span>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              style={{
                background: "none", border: "none", color: "var(--primary, #6366f1)",
                cursor: "pointer", fontSize: 12, padding: "4px 0", marginBottom: 8,
              }}
            >
              {showAdvanced ? "▼ Hide advanced" : "▶ Show advanced"}
            </button>

            {showAdvanced && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label title="Days within which switching between different overnight call types is blocked (0 = no restriction)">Switch Window (days)</label>
                    <input type="number" value={draft.switch_window_days} onChange={(e) => setDraft({ ...draft, switch_window_days: Number(e.target.value) })} min={0} max={14} />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label title="Minimum consecutive days someone must commit to when starting a run (useful for night float)">Min Consecutive</label>
                    <input type="number" value={draft.min_consecutive_days} onChange={(e) => setDraft({ ...draft, min_consecutive_days: Number(e.target.value) })} min={1} max={7} />
                  </div>
                </div>

                <div className="form-group" style={{ background: "var(--bg-muted, #f8fafc)", borderRadius: 6, padding: "10px 12px", border: "1px solid var(--border)" }}>
                  <label style={{ fontWeight: 600, fontSize: 12, marginBottom: 6, display: "block" }}>
                    Required Events <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>(all must be true)</span>
                  </label>
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                    {CONDITION_TOKENS.map((cond) => (
                      <label key={cond} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13 }}>
                        <input
                          type="checkbox"
                          checked={parseConditions(draft.required_conditions).has(cond)}
                          onChange={() => setDraft({ ...draft, required_conditions: toggleCondition(draft.required_conditions, cond) })}
                        />
                        {cond}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="form-group">
                  <label>Mutually Exclusive With</label>
                  <MultiSelectDropdown
                    options={callTypes.filter(ct => ct.id !== draft.id).map(ct => ({ id: ct.id, label: ct.name }))}
                    selected={draft.mutually_exclusive_with}
                    onChange={(ids) => setDraft({ ...draft, mutually_exclusive_with: ids })}
                    placeholder="None"
                  />
                </div>
              </>
            )}

            {/* ── Eligibility & Links ──────────────── */}
            <SectionHeader label="Eligibility & Links" />
            <div className="form-group">
              <label>Eligible Ranks</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                {ranks.filter((r) => r.is_active).map((r) => {
                  const checked = draft.eligible_rank_ids.includes(r.id);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => toggleRank(r.id)}
                      style={{
                        border: `1px solid ${checked ? "var(--primary, #6366f1)" : "var(--border)"}`,
                        background: checked ? "var(--primary, #6366f1)" : "transparent",
                        color: checked ? "white" : "var(--text)",
                        borderRadius: 999,
                        padding: "4px 10px",
                        fontSize: 12,
                        cursor: "pointer",
                        userSelect: "none",
                      }}
                      title={r.name}
                    >
                      {r.abbreviation || r.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="form-group">
              <label>Linked To <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>(auto-fill from these call types)</span></label>
              <MultiSelectDropdown
                options={callTypes.filter(ct => ct.id !== draft.id).map(ct => ({ id: ct.id, label: ct.name }))}
                selected={draft.linked_to}
                onChange={(ids) => setDraft({ ...draft, linked_to: ids })}
                placeholder="None"
              />
            </div>

            <div className="modal-actions">
              {draft.id != null && (
                <button className="btn btn-danger" onClick={() => handleDelete(draft.id!)} style={{ marginRight: "auto" }}>Delete</button>
              )}
              <button className="btn btn-secondary" onClick={() => { setEditId(null); setDraft(null); }}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={!draft.name.trim()}>Save</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, color: "var(--text-muted)",
      textTransform: "uppercase", letterSpacing: 0.6,
      borderBottom: "1px solid var(--border)",
      paddingBottom: 4, marginBottom: 10, marginTop: 14,
    }}>
      {label}
    </div>
  );
}
