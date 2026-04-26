import { useEffect, useState } from "react";
import { api } from "../api";
import type { RankConfig, CallTypeConfig, TeamAssignment } from "../types";

export default function RulesView() {
  const [ranks, setRanks] = useState<RankConfig[]>([]);
  const [callTypes, setCallTypes] = useState<CallTypeConfig[]>([]);
  const [teamAssignments, setTeamAssignments] = useState<TeamAssignment[]>([]);

  useEffect(() => {
    api.getRanks().then(r => setRanks(r.sort((a, b) => a.display_order - b.display_order)));
    api.getCallTypes().then(c => setCallTypes(c.sort((a, b) => a.display_order - b.display_order)));
    api.getAllTeamAssignments().then(setTeamAssignments);
  }, []);

  const activeCallTypes = callTypes.filter(ct => ct.is_active && !ct.is_duty_only);
  const dutyOnlyTypes = callTypes.filter(ct => ct.is_active && ct.is_duty_only);
  const affinityCallTypes = activeCallTypes.filter(ct => ct.uses_consultant_affinity);
  const rankById = new Map(ranks.map(r => [r.id, r]));

  // MOs with a supervisor linked (for consultant affinity display)
  const staffById = new Map<number, string>();
  teamAssignments.forEach(ta => {
    if (ta.staff_name) staffById.set(ta.staff_id, ta.staff_name);
  });
  const moAssignmentsWithSupervisor = teamAssignments.filter(
    ta => ta.role === "mo" && ta.supervisor_id && ta.supervisor_name
  );

  function overnightLabel(ct: CallTypeConfig): string {
    if (ct.is_night_float) return "Night Float";
    if (ct.is_overnight) return "Yes (24h)";
    return "No";
  }

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
                  <td>{overnightLabel(ct)}</td>
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
              {activeCallTypes.filter(ct => ct.is_overnight && !ct.is_night_float).length > 0 ? (
                <>
                  <strong>24h overnight call types:</strong>{" "}
                  {activeCallTypes.filter(ct => ct.is_overnight && !ct.is_night_float).map(ct => ct.name).join(", ")}
                  <br />
                  After a 24h overnight call the person receives post-call rest the following day (off from 8am, 12pm, or 5pm as configured). No assignment is made on that rest day.
                  <br /><br />
                  <strong>Night Float call types:</strong>{" "}
                  {activeCallTypes.filter(ct => ct.is_night_float).map(ct => ct.name).join(", ") || "None"}
                  <br />
                  Night float calls are overnight but carry <em>no post-call rest day</em> — the person returns to normal duties the next morning. The same person must cover the entire configured run (e.g. Tue–Fri) without splitting across staff.
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
            <div className="rule-title">Consultant affinity</div>
            <div className="rule-body">
              {affinityCallTypes.length > 0 ? (
                <>
                  Call types with consultant affinity pull staff towards their linked supervising consultant
                  when that consultant is the on-call consultant for the day.
                  <br />
                  <strong>Supervisor match (+5.0):</strong> Staff directly tagged to the on-call consultant.
                  <br />
                  <strong>Team match (+3.0):</strong> Staff in the same team as the on-call consultant.
                  <br /><br />
                  <strong>Affinity-enabled call types:</strong>{" "}
                  {affinityCallTypes.map(ct => ct.name).join(", ")}
                  <br /><br />
                  <strong>Staff currently linked to a supervisor:</strong>
                  {moAssignmentsWithSupervisor.length > 0 ? (
                    <table className="rules-table" style={{ marginTop: 8 }}>
                      <thead>
                        <tr><th>Staff</th><th>Supervisor</th></tr>
                      </thead>
                      <tbody>
                        {moAssignmentsWithSupervisor.map(ta => (
                          <tr key={ta.id}>
                            <td>{ta.staff_name}</td>
                            <td>{ta.supervisor_name}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <span style={{ color: "var(--text-muted)", marginLeft: 8 }}>
                      No supervisor links configured. Set them in the Staff / Teams page.
                    </span>
                  )}
                </>
              ) : (
                "No call types have consultant affinity configured."
              )}
            </div>
          </div>

          <div className="rule">
            <div className="rule-title">Call request preference (+20.0) and spacing bonus (up to +2.0)</div>
            <div className="rule-body">
              Call requests give a <strong>+20.0</strong> scoring bonus — strong enough to nearly guarantee the slot
              unless the person is ineligible. Staff who haven't had a recent call receive a spacing bonus
              proportional to days since their last call (up to +2.0).
            </div>
          </div>

          <div className="rule">
            <div className="rule-title">Fairness</div>
            <div className="rule-body">
              Fairness scoring applies to all call types with <strong>counts_towards_fairness</strong> enabled.
              The solver picks the person with the lowest accumulated workload, weighted as follows:
              <br /><br />
              <strong>Total 24h calls (+10.0):</strong> Primary metric — counts only true 24h overnight calls
              (overnight + post-call rest day). Night float calls do not count here.
              <br />
              <strong>Per-type balance (+3.0):</strong> Balances how many times each person has done this
              specific call type.
              <br />
              <strong>Difficulty-weighted balance (+2.0):</strong> Accounts for the cumulative difficulty
              points across all call types assigned so far.
              <br />
              <strong>Weekend / PH balance (+8.0):</strong> Applied only when assigning a weekend or public
              holiday slot — balances who has done the most weekend calls.
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
              <strong>OT:</strong> Fairness (up to +10.0), supervisor match (+5.0), team match (+3.0), registrar-tier bonus (+3.0), OT preference nudge (+2.0).
              <br /><strong>Clinic / general daytime:</strong> Fairness (up to +5.0), supervisor match (+5.0), team match (+3.0), staff <strong>duty_preference</strong> bonus (+2.0).
              <br />Eligibility per resource is governed by per-staff <strong>can_do_clinic / can_do_ot</strong> flags and rank-level eligibility.
            </div>
          </div>

          <div className="rule">
            <div className="rule-title">Staff duty preferences</div>
            <div className="rule-body">
              Individual staff can have a <strong>duty_preference</strong> of "OT" or "Clinic" set in their profile.
              Staff with <strong>extra_call_type_ids</strong> are eligible for additional call types beyond their rank default
              (e.g. an MO granted eligibility for registrar call slots).
            </div>
          </div>

          <div className="rule">
            <div className="rule-title">Per-day resource overrides</div>
            <div className="rule-body">
              Each day card has an <strong>Edit Resources</strong> button. Clicking it opens a modal where you can add,
              edit, or delete resources for that specific date only — overriding the weekly template without changing it.
              <br /><br />
              Days with active overrides show an amber <strong>✎ edited</strong> pill next to the date.
              Use <strong>↺ Reset Day to Default</strong> inside the modal to revert a day back to its weekly template.
              <br /><br />
              After editing resources, use <strong>↻ Regenerate</strong> on the day card to re-solve duty assignments
              against the updated resource list.
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
              <strong> EOT ← MO2 / R1 / R2</strong> (overnight call holders are pre-assigned to the Emergency OT).
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
