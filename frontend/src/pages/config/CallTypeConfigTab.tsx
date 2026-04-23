import { useEffect, useState } from "react";
import { api } from "../../api";
import type { CallTypeConfig, RankConfig } from "../../types";

const POST_CALL_OPTIONS = [
  { value: "8am", label: "Off from 8am (full day off)" },
  { value: "12pm", label: "Off from 12pm (AM duties, no PM)" },
  { value: "5pm", label: "Off from 5pm (AM+PM duties, no call)" },
  { value: "call_only", label: "Call only (next-day call, no duties)" },
  { value: "none", label: "None (fully available)" },
] as const;

const ALL_DAY_TOKENS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "PH", "Stepdown", "Evening OT"] as const;

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

const WEEKDAY_TOKENS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

function parseRunDays(str: string | null): Set<string> {
  if (!str) return new Set();
  return new Set(str.split(",").map((s) => s.trim()).filter(Boolean));
}

function toggleRunDay(current: string | null, day: string): string {
  const set = parseRunDays(current);
  if (set.has(day)) set.delete(day);
  else set.add(day);
  return WEEKDAY_TOKENS.filter((d) => set.has(d)).join(",");
}

interface DraftCallType {
  id: number | null;
  name: string;
  display_order: number;
  is_overnight: boolean;
  post_call_type: string;
  max_consecutive_days: number;
  min_gap_days: number;
  difficulty_points: number;
  counts_towards_fairness: boolean;
  applicable_days: string;
  is_night_float: boolean;
  night_float_run: string | null;
  is_active: boolean;
  eligible_rank_ids: number[];
}

export default function CallTypeConfigTab() {
  const [callTypes, setCallTypes] = useState<CallTypeConfig[]>([]);
  const [ranks, setRanks] = useState<RankConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<DraftCallType | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      min_gap_days: ct.min_gap_days,
      difficulty_points: ct.difficulty_points,
      counts_towards_fairness: ct.counts_towards_fairness,
      applicable_days: ct.applicable_days,
      is_night_float: ct.is_night_float,
      night_float_run: ct.night_float_run,
      is_active: ct.is_active,
      eligible_rank_ids: ct.eligible_rank_ids,
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
      min_gap_days: 2,
      difficulty_points: 3,
      counts_towards_fairness: true,
      applicable_days: "Mon,Tue,Wed,Thu,Fri,Sat,Sun,PH",
      is_night_float: false,
      night_float_run: null,
      is_active: true,
      eligible_rank_ids: ranks.filter((r) => r.is_call_eligible).map((r) => r.id),
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
        min_gap_days: draft.min_gap_days,
        difficulty_points: draft.difficulty_points,
        counts_towards_fairness: draft.counts_towards_fairness,
        applicable_days: draft.applicable_days,
        is_night_float: draft.is_night_float,
        night_float_run: draft.night_float_run || null,
        is_active: draft.is_active,
        eligible_rank_ids: draft.eligible_rank_ids,
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

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button className="btn btn-primary" onClick={startAdd}>+ Add Call Type</button>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="config-table">
            <thead>
              <tr>
                <th>Order</th>
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
                <th style={{ width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {callTypes.map((ct) => (
                <tr key={ct.id} style={{ opacity: ct.is_active ? 1 : 0.5 }}>
                  <td>{ct.display_order}</td>
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
                  <td>
                    <button className="btn btn-sm btn-secondary" onClick={() => startEdit(ct)}>Edit</button>
                  </td>
                </tr>
              ))}
              {callTypes.length === 0 && (
                <tr><td colSpan={12} style={{ textAlign: "center", color: "var(--text-muted)" }}>No call types configured.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editId != null && draft && (
        <div className="modal-backdrop" onClick={() => { setEditId(null); setDraft(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <h3>{draft.id != null ? "Edit Call Type" : "Add Call Type"}</h3>

            <div className="form-group">
              <label>Name</label>
              <input type="text" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. MO1" />
            </div>
            <div className="form-group">
              <label>Display Order</label>
              <input type="number" value={draft.display_order} onChange={(e) => setDraft({ ...draft, display_order: Number(e.target.value) })} />
            </div>

            <div className="form-group">
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={draft.is_overnight} onChange={(e) => setDraft({ ...draft, is_overnight: e.target.checked })} />
                Overnight (24h) call
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
                    {WEEKDAY_TOKENS.map((day) => (
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

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Min Gap (days)</label>
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

            <div className="form-group">
              <label>Applicable Days</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4, alignItems: "center" }}>
                {ALL_DAY_TOKENS.map((day, i) => (
                  <span key={day} style={{ display: "inline-flex", alignItems: "center", gap: 0 }}>
                    {i === 7 && <span style={{ margin: "0 6px", color: "#ccc" }}>|</span>}
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

            <div className="form-group">
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={draft.counts_towards_fairness} onChange={(e) => setDraft({ ...draft, counts_towards_fairness: e.target.checked })} />
                Counts towards fairness tracking
              </label>
            </div>

            <div className="form-group">
              <label>Eligible Ranks</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
                {ranks.filter((r) => r.is_active).map((r) => (
                  <label key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                    <input type="checkbox" checked={draft.eligible_rank_ids.includes(r.id)} onChange={() => toggleRank(r.id)} />
                    {r.name} ({r.abbreviation})
                  </label>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={draft.is_active} onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })} />
                Active
              </label>
            </div>

            <div className="modal-actions">
              {draft.id != null && (
                <button className="btn btn-danger" onClick={() => handleDelete(draft.id!)} style={{ marginRight: "auto" }}>Delete</button>
              )}
              <button className="btn btn-secondary" onClick={() => { setEditId(null); setDraft(null); }}>Cancel</button>
              <button className="btn btn-primary" onClick={save}>Save</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
