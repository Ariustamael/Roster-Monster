import { useEffect, useState } from "react";
import { api } from "../api";
import type { RankConfig, CallTypeConfig } from "../types";

export default function RulesView() {
  const [ranks, setRanks] = useState<RankConfig[]>([]);
  const [callTypes, setCallTypes] = useState<CallTypeConfig[]>([]);

  useEffect(() => {
    api.getRanks().then(r => setRanks(r.sort((a, b) => a.display_order - b.display_order)));
    api.getCallTypes().then(c => setCallTypes(c.sort((a, b) => a.display_order - b.display_order)));
  }, []);

  const activeCallTypes = callTypes.filter(ct => ct.is_active && !ct.is_duty_only);
  const dutyOnlyTypes = callTypes.filter(ct => ct.is_active && ct.is_duty_only);
  const overnightTypes = activeCallTypes.filter(ct => ct.is_overnight);
  const rankById = new Map(ranks.map(r => [r.id, r]));

  return (
    <>
      <div className="page-header">
        <h2>Roster Rules</h2>
      </div>

      <div className="rules-page">
        <section className="rules-section">
          <h3>Staff Ranks</h3>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>Generated from rank configuration.</p>
          <table className="rules-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Abbr</th>
                <th>Call Eligible</th>
                <th>Duty Eligible</th>
                <th>Tier</th>
              </tr>
            </thead>
            <tbody>
              {ranks.filter(r => r.is_active).map(r => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.abbreviation}</td>
                  <td>{r.is_call_eligible ? "Yes" : "-"}</td>
                  <td>{r.is_duty_eligible ? "Yes" : "-"}</td>
                  <td>{r.is_consultant_tier ? "Consultant" : r.is_registrar_tier ? "Registrar" : "MO Pool"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="rules-section">
          <h3>Call Types</h3>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>Generated from call type configuration.</p>
          <table className="rules-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Overnight</th>
                <th>Post-Call</th>
                <th>Applicable Days</th>
                <th>Conditions</th>
                <th>Eligible Ranks</th>
                <th>Fairness</th>
              </tr>
            </thead>
            <tbody>
              {activeCallTypes.map(ct => (
                <tr key={ct.id}>
                  <td style={{ fontWeight: 600 }}>{ct.name}</td>
                  <td>{ct.is_overnight ? "Yes (24h)" : "No"}</td>
                  <td>{ct.post_call_type === "none" ? "-" : ct.post_call_type}</td>
                  <td style={{ fontSize: 11 }}>{ct.applicable_days}</td>
                  <td style={{ fontSize: 11 }}>{ct.required_conditions || "-"}</td>
                  <td style={{ fontSize: 11 }}>{ct.eligible_rank_ids.map(id => rankById.get(id)?.abbreviation ?? `#${id}`).join(", ")}</td>
                  <td>{ct.counts_towards_fairness ? "Yes" : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {dutyOnlyTypes.length > 0 && (
            <>
              <h4 style={{ marginTop: 16 }}>Duty-Only Types</h4>
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>These appear in the Duty Roster only, not the Call Roster.</p>
              <table className="rules-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Linked To</th>
                    <th>Applicable Days</th>
                    <th>Eligible Ranks</th>
                  </tr>
                </thead>
                <tbody>
                  {dutyOnlyTypes.map(ct => (
                    <tr key={ct.id}>
                      <td style={{ fontWeight: 600 }}>{ct.name}</td>
                      <td>{ct.linked_to ? ct.linked_to.split(",").map(id => callTypes.find(c => c.id === parseInt(id))?.name ?? `#${id}`).join(", ") : "-"}</td>
                      <td style={{ fontSize: 11 }}>{ct.applicable_days}</td>
                      <td style={{ fontSize: 11 }}>{ct.eligible_rank_ids.map(id => rankById.get(id)?.abbreviation ?? `#${id}`).join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>

        <section className="rules-section">
          <h3>Call Roster Rules</h3>

          <div className="rule">
            <div className="rule-title">Overnight calls and post-call rest</div>
            <div className="rule-body">
              {overnightTypes.length > 0 ? (
                <>
                  <strong>Overnight call types:</strong> {overnightTypes.map(ct => ct.name).join(", ")}
                  <br />
                  After an overnight call, the person receives post-call rest as configured (8am off, 12pm off, etc.).
                  There must be a minimum gap between consecutive overnight calls (configured per call type).
                </>
              ) : "No overnight call types configured."}
            </div>
          </div>

          <div className="rule">
            <div className="rule-title">One call slot per person per day</div>
            <div className="rule-body">
              Each person can hold at most one call slot on any given day.
              A person cannot be assigned to call on a day they have leave or a call block preference.
            </div>
          </div>

          <div className="rule">
            <div className="rule-title">MO1 team matching</div>
            <div className="rule-body">
              The MO1 slot is preferentially filled by someone from the same team as the on-call consultant.
              <br />
              <strong>Supervisor match (+5.0):</strong> If the MO is directly tagged to the on-call consultant.
              <br />
              <strong>Team match (+3.0):</strong> If the MO is in the same team as the on-call consultant.
            </div>
          </div>

          <div className="rule">
            <div className="rule-title">Call request preference (+4.0) and spacing bonus (up to +2.0)</div>
            <div className="rule-body">
              Call requests give a +4.0 scoring bonus. People who haven't had a recent call receive a spacing bonus proportional to days since their last call.
            </div>
          </div>

          <div className="rule">
            <div className="rule-title">Fairness</div>
            <div className="rule-body">
              Only overnight/24h calls count towards fairness tracking.
              <br />
              <strong>Total 24h calls (+10.0):</strong> Primary fairness metric.
              <strong> Per-type balance (+3.0).</strong>
              <strong> Weekend/PH balance (+8.0).</strong>
            </div>
          </div>
        </section>

        <section className="rules-section">
          <h3>Consultant / Registrar Roster</h3>

          <div className="rule">
            <div className="rule-title">Consultant In Charge (CIC)</div>
            <div className="rule-body">
              Each day has a CIC slot for the on-call consultant. When an AC is primary, a supervising SC/C must also be assigned.
              When a SC/C is primary, an AC can be assigned as secondary support.
            </div>
          </div>

          <div className="rule">
            <div className="rule-title">Registrar call slots</div>
            <div className="rule-body">
              Registrar-tier call types appear as slots on the Con/Reg Roster calendar.
              Slot visibility is config-driven: each call type's <strong>applicable_days</strong> and <strong>required_conditions</strong> determine which days it appears.
              <br /><br />
              <strong>Mutual exclusivity:</strong> Call types with <strong>mutually_exclusive_with</strong> configured will hide when the exclusive partner is filled.
              For example, if R1+2 is mutually exclusive with R1 and R2, filling R1+2 hides the R1 and R2 slots (and vice versa when both R1 and R2 are filled).
              <br /><br />
              <strong>Stepdown:</strong> Call types with "Not Stepdown" condition are hidden on stepdown days.
            </div>
          </div>

          <div className="rule">
            <div className="rule-title">Day flags</div>
            <div className="rule-body">
              Each calendar day has three toggleable flags:
              <br />- <strong>PH</strong> — Public Holiday
              <br />- <strong>Stepdown</strong> — Stepdown day (affects call type visibility and MO3 behaviour)
              <br />- <strong>ExtOT</strong> — Extended OT day (activates MO4/MO5 call slots)
            </div>
          </div>
        </section>

        <section className="rules-section">
          <h3>Daytime Duty Roster</h3>

          <div className="rule">
            <div className="rule-title">Eligible ranks</div>
            <div className="rule-body">
              Staff with <strong>is_duty_eligible</strong> in their rank config are in the daytime duty pool:
              {" "}{ranks.filter(r => r.is_duty_eligible && r.is_active).map(r => r.name).join(", ") || "None configured"}.
              <br />
              Consultants and ACs are not allocated daytime duties (they run OT lists and clinics as supervisors).
            </div>
          </div>

          <div className="rule">
            <div className="rule-title">Resource priority</div>
            <div className="rule-body">
              Resources (OT lists, clinics, sessions) are not split into fixed type buckets — the dedicated MOPD and CAT-A duty types have been retired.
              Each resource carries a <strong>priority 1–10</strong> (set in the Resources page).
              The solver fills them in priority order — <strong>P1 first, P10 last</strong> — and stops when staff run out.
              <br /><br />
              Anyone left unfilled lands in <strong>Admin</strong>, which is auto-derived from "free duty-eligible MOs not assigned anywhere else and not unavailable".
            </div>
          </div>

          <div className="rule">
            <div className="rule-title">Excluded from daytime duties</div>
            <div className="rule-body">
              On call, post-call, on leave, or assigned to a daytime-only call type.
              <br />
              Weekends and public holidays are now <em>editable</em> on the duty roster — the solver still skips them, but you can manually drop assignments onto weekend cards (e.g. emergency OT).
            </div>
          </div>

          <div className="rule">
            <div className="rule-title">Duty scoring</div>
            <div className="rule-body">
              <strong>OT:</strong> Fairness (up to +10.0), supervisor match (+5.0), team match (+3.0), registrar-tier bonus (+3.0).
              <br /><strong>Clinic / general daytime:</strong> Fairness (up to +5.0), supervisor match (+5.0), team match (+3.0), staff <strong>duty_preference</strong> bonus (+2.0).
              <br />Eligibility per resource is governed by per-staff <strong>can_do_clinic / can_do_ot</strong> flags and rank-level eligibility.
            </div>
          </div>

          <div className="rule">
            <div className="rule-title">Staff duty preferences</div>
            <div className="rule-body">
              Individual staff can have a <strong>duty_preference</strong> of "OT" or "Clinic" set in their profile.
              Staff with <strong>extra_call_type_ids</strong> are eligible for additional call types beyond their rank default.
            </div>
          </div>
        </section>

        <section className="rules-section">
          <h3>Anchor Duties (Ward MO / EOT MO)</h3>

          <div className="rule">
            <div className="rule-title">Linked manpower</div>
            <div className="rule-body">
              Each resource template can declare <strong>linked_manpower</strong> — a list of call types whose holders
              are pre-assigned to that resource.
              <br />
              Common examples: <strong>Ward MO ← MO1</strong> (MO1 holder also mans the ward),
              <strong> EOT ← MO2 / R1 / R2</strong> (overnight call holders also staff the evening OT).
              <br />
              Linked assignments are not flagged as conflicts on the duty roster, even though the staff are also on call.
            </div>
          </div>

          <div className="rule">
            <div className="rule-title">Consultant affinity pull</div>
            <div className="rule-body">
              If an on-call MO's supervisor is operating in OT, the solver pulls that MO into OT. The vacated anchor duty is backfilled by the next available MO.
            </div>
          </div>
        </section>

        <section className="rules-section">
          <h3>Manual Overrides</h3>

          <div className="rule">
            <div className="rule-title">Call roster</div>
            <div className="rule-body">
              Click any MO cell to override. Staff picker filters by eligible ranks for that call type.
              Overrides are preserved when regenerating. Override cells show a blue outline.
            </div>
          </div>

          <div className="rule">
            <div className="rule-title">Duty roster</div>
            <div className="rule-body">
              Drag name tags to reassign within the same day. Drops always apply — constraint violations
              (post-call, leave, eligibility, double-booking) appear as inline <strong>⚠ COMMENTS</strong> on the day card,
              not as a popup.
              <br />
              Click <strong>×</strong> to clear an assignment. Free duty-eligible MOs are auto-derived back into the Admin column.
              Drag the <strong>⧉</strong> handle to duplicate (multi-roster).
              Overridden assignments show a ✎ marker.
              Unavailable staff (post-call, leave) appear in the Unavailable column.
              <br />
              Linked-manpower assignments (Ward MO ↔ MO1, EOT ↔ MO2/R1/R2, etc., set per resource template) are silent —
              warnings only fire when someone is doing a linked role they aren't on call for.
            </div>
          </div>
        </section>

        <section className="rules-section">
          <h3>Month-to-Month Carryover</h3>
          <div className="rule">
            <div className="rule-body">
              When generating a new month, the solver looks back at the last 7 days of the previous month's call assignments.
              This ensures post-call rest, call gap, and call type consistency rules are respected across the month boundary.
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
