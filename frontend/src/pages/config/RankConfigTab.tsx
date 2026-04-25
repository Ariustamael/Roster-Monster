import { useEffect, useState } from "react";
import { api } from "../../api";
import type { RankConfig } from "../../types";
import { useEscClose } from "../../hooks/useEscClose";

interface DraftRank {
  id: number | null;
  name: string;
  abbreviation: string;
  display_order: number;
  is_call_eligible: boolean;
  is_duty_eligible: boolean;
  is_consultant_tier: boolean;
  is_registrar_tier: boolean;
  is_active: boolean;
}

export default function RankConfigTab() {
  const [ranks, setRanks] = useState<RankConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<DraftRank | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEscClose(() => { setEditId(null); setDraft(null); }, editId != null);

  async function load() {
    setLoading(true);
    try {
      const data = await api.getRanks();
      setRanks(data.sort((a, b) => a.display_order - b.display_order));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function startEdit(r: RankConfig) {
    setEditId(r.id);
    setDraft({
      id: r.id,
      name: r.name,
      abbreviation: r.abbreviation,
      display_order: r.display_order,
      is_call_eligible: r.is_call_eligible,
      is_duty_eligible: r.is_duty_eligible,
      is_consultant_tier: r.is_consultant_tier,
      is_registrar_tier: r.is_registrar_tier,
      is_active: r.is_active,
    });
  }

  function startAdd() {
    setEditId("new");
    setDraft({
      id: null,
      name: "",
      abbreviation: "",
      display_order: ranks.length > 0 ? Math.max(...ranks.map((r) => r.display_order)) + 1 : 0,
      is_call_eligible: false,
      is_duty_eligible: true,
      is_consultant_tier: false,
      is_registrar_tier: false,
      is_active: true,
    });
  }

  async function save() {
    if (!draft || !draft.name.trim()) return;
    setError(null);
    try {
      const payload = {
        name: draft.name.trim(),
        abbreviation: draft.abbreviation.trim(),
        display_order: draft.display_order,
        is_call_eligible: draft.is_call_eligible,
        is_duty_eligible: draft.is_duty_eligible,
        is_consultant_tier: draft.is_consultant_tier,
        is_registrar_tier: draft.is_registrar_tier,
        is_active: draft.is_active,
      };
      if (draft.id != null) {
        await api.updateRank(draft.id, payload);
      } else {
        await api.createRank(payload);
      }
      setEditId(null);
      setDraft(null);
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this rank? Staff using it may become invalid.")) return;
    try {
      await api.deleteRank(id);
      setEditId(null);
      setDraft(null);
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  if (loading) return <div className="loading"><span className="spinner" /> Loading...</div>;

  return (
    <>
      {error && (
        <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", color: "#b91c1c", borderRadius: 6, padding: "8px 14px", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#b91c1c", fontWeight: 700 }}>✕</button>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button className="btn btn-primary" onClick={startAdd}>+ Add Rank</button>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="config-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Name</th>
                <th>Abbr</th>
                <th>Call Eligible</th>
                <th>Duty Eligible</th>
                <th>Consultant Tier</th>
                <th>Registrar Tier</th>
                <th>Active</th>
                <th style={{ width: 100 }}></th>
              </tr>
            </thead>
            <tbody>
              {ranks.map((r) => (
                <tr key={r.id} style={{ opacity: r.is_active ? 1 : 0.5 }}>
                  <td>{r.display_order}</td>
                  <td>{r.name}</td>
                  <td>{r.abbreviation}</td>
                  <td>{r.is_call_eligible ? "Yes" : "No"}</td>
                  <td>{r.is_duty_eligible ? "Yes" : "No"}</td>
                  <td>{r.is_consultant_tier ? "Yes" : "No"}</td>
                  <td>{r.is_registrar_tier ? "Yes" : "No"}</td>
                  <td>{r.is_active ? "Yes" : "No"}</td>
                  <td>
                    <button className="btn btn-sm btn-secondary" onClick={() => startEdit(r)}>Edit</button>
                  </td>
                </tr>
              ))}
              {ranks.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--text-muted)" }}>No ranks configured.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editId != null && draft && (
        <div className="modal-backdrop" onClick={() => { setEditId(null); setDraft(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{draft.id != null ? "Edit Rank" : "Add Rank"}</h3>
            <div className="form-group">
              <label htmlFor="rank-name">Name <span style={{ color: "#dc2626" }}>*</span></label>
              <input id="rank-name" type="text" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Medical Officer" />
            </div>
            <div className="form-group">
              <label htmlFor="rank-abbr">Abbreviation</label>
              <input id="rank-abbr" type="text" value={draft.abbreviation} onChange={(e) => setDraft({ ...draft, abbreviation: e.target.value })} placeholder="e.g. MO" />
            </div>
            <div className="form-group">
              <label>Display Order</label>
              <input type="number" value={draft.display_order} onChange={(e) => setDraft({ ...draft, display_order: Number(e.target.value) })} />
            </div>
            <div className="form-group">
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={draft.is_call_eligible} onChange={(e) => setDraft({ ...draft, is_call_eligible: e.target.checked })} />
                Eligible for MO call roster
              </label>
            </div>
            <div className="form-group">
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={draft.is_duty_eligible} onChange={(e) => setDraft({ ...draft, is_duty_eligible: e.target.checked })} />
                Eligible for daytime duty roster
              </label>
            </div>
            <div className="form-group">
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={draft.is_consultant_tier} onChange={(e) => setDraft({ ...draft, is_consultant_tier: e.target.checked })} />
                Consultant tier (not allocatable)
              </label>
            </div>
            <div className="form-group">
              <label style={{ display: "flex", alignItems: "center", gap: 8 }} title="Counts as a registrar for OT max-registrars cap and R-type call eligibility.">
                <input type="checkbox" checked={draft.is_registrar_tier} onChange={(e) => setDraft({ ...draft, is_registrar_tier: e.target.checked })} />
                Registrar tier
              </label>
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
              <button className="btn btn-primary" onClick={save} disabled={!draft.name.trim()}>Save</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
