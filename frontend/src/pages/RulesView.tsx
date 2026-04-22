export default function RulesView() {
  return (
    <>
      <div className="page-header">
        <h2>Roster Rules</h2>
      </div>

      <div className="rules-page">
        <section className="rules-section">
          <h3>Staff Grades</h3>
          <table className="rules-table">
            <thead>
              <tr>
                <th>Grade</th>
                <th>Abbreviation</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>Senior Consultant</td><td>SC</td><td>Senior attending surgeon. Not in the allocatable pool. Assigned as on-call consultant and supervises OT/clinics.</td></tr>
              <tr><td>Consultant</td><td>C</td><td>Attending surgeon. Same role as SC for scheduling purposes.</td></tr>
              <tr><td>Associate Consultant</td><td>AC</td><td>Junior attending. Can be the primary on-call holder (paired with a supervising SC/C) or take a secondary supporting role.</td></tr>
              <tr><td>Senior Staff Registrar</td><td>SSR</td><td>Advanced trainee. Allocated to OT and Admin duties. Can take R1/R2/EOT registrar duties. Not assigned to clinics or MOPD.</td></tr>
              <tr><td>Senior Resident</td><td>SR</td><td>Intermediate trainee. Prioritised for OT (tagged to supervisor first). Can also do supervised clinics, admin, and R1/R2/EOT registrar duties. Not assigned to MOPD or MO call.</td></tr>
              <tr><td>Senior Medical Officer</td><td>SMO</td><td>Senior junior doctor. Eligible for MO1-MO5 call and weekday MO3 (referral duty). Can do OT, supervised clinics, MOPD, and admin.</td></tr>
              <tr><td>Medical Officer</td><td>MO</td><td>Junior doctor. Eligible for MO1-MO5 call (except weekday MO3). Can do OT, supervised clinics, MOPD, and admin.</td></tr>
            </tbody>
          </table>
        </section>

        <section className="rules-section">
          <h3>Call Roster (MO1 - MO5)</h3>

          <div className="rule">
            <div className="rule-title">Call slots per day</div>
            <div className="rule-body">
              <strong>Weekdays:</strong> MO1, MO2, MO3 are always assigned. MO4 and MO5 are added on days with evening OT.
              <br/>
              <strong>Weekends / Public Holidays:</strong> MO1 and MO2 only. MO3 is added only on stepdown days. No MO4/MO5.
            </div>
          </div>

          <div className="rule">
            <div className="rule-title">Eligible grades for MO call</div>
            <div className="rule-body">
              Only Senior Medical Officers and Medical Officers are eligible for MO1-MO5 call assignments.
              Senior Residents, SSRs, and consultants are not in the MO call pool.
            </div>
          </div>

          <div className="rule">
            <div className="rule-title">Weekday MO3 (referral duty) restricted to Senior MOs</div>
            <div className="rule-body">
              On weekdays (non-stepdown), the MO3 slot is a daytime referral duty that can only be filled by Senior Medical Officers.
              Regular Medical Officers are not eligible for weekday MO3.
              On stepdown days, MO3 becomes a 24h overnight call and both SMOs and MOs are eligible.
            </div>
          </div>

          <div className="rule">
            <div className="rule-title">Overnight (24-hour) calls</div>
            <div className="rule-body">
              MO1 and MO2 are always overnight (24h) calls.
              MO3 is overnight only on stepdown days; otherwise it is a daytime-only referral duty.
              MO4 and MO5 are evening OT duties only (not overnight).
            </div>
          </div>

          <div className="rule">
            <div className="rule-title">Not on leave or blocked</div>
            <div className="rule-body">
              A person cannot be assigned to call on a day they have leave or a call block preference.
            </div>
          </div>

          <div className="rule">
            <div className="rule-title">Post-call rest</div>
            <div className="rule-body">
              After an overnight call (MO1, MO2, or overnight MO3), the person is off the next day.
              They receive no call assignment and are excluded from the daytime duty pool.
            </div>
          </div>

          <div className="rule">
            <div className="rule-title">Minimum 2-day gap between overnight calls</div>
            <div className="rule-body">
              There must be at least 2 clear days between consecutive overnight call assignments for the same person.
              For example, if someone does MO1 on Monday, the earliest they can do another overnight call is Thursday.
            </div>
          </div>

          <div className="rule">
            <div className="rule-title">No switching overnight call types within 5 days</div>
            <div className="rule-body">
              If a person's last overnight call was MO1, their next overnight call within a 5-day window must also be MO1 (not MO2, and vice versa).
              This prevents rapid switching between different overnight roles.
            </div>
          </div>

          <div className="rule">
            <div className="rule-title">One call slot per person per day</div>
            <div className="rule-body">
              Each person can hold at most one call slot on any given day.
            </div>
          </div>

          <div className="rule">
            <div className="rule-title">MO1 team matching</div>
            <div className="rule-body">
              The MO1 slot is preferentially filled by someone from the same team as the on-call consultant.
              <br/>
              <strong>Supervisor match (+5.0 bonus):</strong> If the MO is directly tagged to the on-call consultant, they get the strongest preference.
              <br/>
              <strong>Team match (+3.0 bonus):</strong> If the MO is in the same team as the on-call consultant but tagged to a different supervisor.
            </div>
          </div>

          <div className="rule">
            <div className="rule-title">Call request preference</div>
            <div className="rule-body">
              If a person has a "request" preference for a specific date, they receive a +4.0 scoring bonus for that day, making them more likely to be assigned.
            </div>
          </div>

          <div className="rule">
            <div className="rule-title">Spacing bonus</div>
            <div className="rule-body">
              People who haven't had a recent call receive a small bonus (up to +2.0) proportional to the number of days since their last call.
              This helps spread calls more evenly across the month.
            </div>
          </div>
        </section>

        <section className="rules-section">
          <h3>Call Fairness</h3>

          <div className="rule">
            <div className="rule-title">Only 24-hour calls count towards fairness</div>
            <div className="rule-body">
              The fairness tracker only considers overnight/24h duties: MO1, MO2, and MO3 on stepdown days.
              MO3 on regular weekdays, MO4, and MO5 do not count towards the fairness score.
              This is because 24h calls are significantly more burdensome than daytime or evening-only duties.
            </div>
          </div>

          <div className="rule">
            <div className="rule-title">Fairness scoring weights</div>
            <div className="rule-body">
              <strong>Total 24h calls (+10.0):</strong> Primary fairness metric. People with fewer 24h calls are strongly preferred.
              <br/>
              <strong>Per-type balance (+3.0):</strong> Spreads each specific call type (MO1, MO2, etc.) evenly.
              <br/>
              <strong>Weekend/PH balance (+8.0):</strong> On weekends and public holidays, people with fewer weekend calls are strongly preferred.
            </div>
          </div>
        </section>

        <section className="rules-section">
          <h3>AC On-Call Convention</h3>

          <div className="rule">
            <div className="rule-title">AC as primary call holder</div>
            <div className="rule-body">
              When an Associate Consultant's name appears paired with a senior (e.g., "Junren/DC" in the original roster), the AC is the primary on-call holder.
              The display shows both names (e.g., "Junren / David Chua") in the Consultant column.
              The AC does not appear in the AC column on these days.
              MO1 team matching uses the AC's team.
            </div>
          </div>

          <div className="rule">
            <div className="rule-title">AC as secondary support</div>
            <div className="rule-body">
              When the AC appears only in the AC column, the call belongs to the consultant.
              The AC supports the consultant by taking some patients but is not the primary decision-maker.
              MO1 team matching uses the consultant's team.
            </div>
          </div>
        </section>

        <section className="rules-section">
          <h3>Daytime Duty Roster</h3>

          <div className="rule">
            <div className="rule-title">Eligible grades</div>
            <div className="rule-body">
              Senior Staff Registrars, Senior Residents, and Medical Officers are in the daytime duty pool.
              Consultants, Senior Consultants, and Associate Consultants are not allocated daytime duties (they run OT lists and clinics as supervisors).
            </div>
          </div>

          <div className="rule">
            <div className="rule-title">Duty assignment priority (in order)</div>
            <div className="rule-body">
              Each weekday, the solver assigns duties in this sequence:
              <br/>
              <strong>1. OT (full day):</strong> Fills OT assistant slots first. Each OT room needs 2 assistants. The person is busy for both AM and PM.
              <br/>
              <strong>2. Supervised Clinics (AM then PM):</strong> One MO per supervised clinic session, matched to the clinic's consultant.
              <br/>
              <strong>3. MOPD (AM then PM):</strong> Minor Orthopaedic Procedures and Dressings clinic. Fills remaining clinic room capacity (6 rooms minus supervised clinics), with a minimum of 3 per session.
              <br/>
              <strong>4. Admin (AM then PM):</strong> Anyone not assigned to the above gets admin duty for that session.
            </div>
          </div>

          <div className="rule">
            <div className="rule-title">Weekends and Public Holidays</div>
            <div className="rule-body">
              No daytime duties are assigned on weekends or public holidays. Only the call team works.
            </div>
          </div>

          <div className="rule">
            <div className="rule-title">Excluded from daytime duties</div>
            <div className="rule-body">
              The following people are removed from the daytime pool each day:
              <br/>- On call (any MO1-MO5 slot that day)
              <br/>- Post-call (day after an overnight call)
              <br/>- On leave
              <br/>- MO3 on weekdays (they handle referrals all day, separate from OT/clinic duties)
            </div>
          </div>
        </section>

        <section className="rules-section">
          <h3>Grade-Specific Duty Constraints</h3>

          <div className="rule">
            <div className="rule-title">Senior Staff Registrar (SSR)</div>
            <div className="rule-body">
              <strong>Can do:</strong> OT, Admin
              <br/>
              <strong>Cannot do:</strong> Supervised Clinics, MOPD
              <br/>
              <strong>Also eligible for:</strong> R1, R2, and EOT registrar duties (managed separately)
              <br/>
              SSRs are excluded from the clinic and MOPD candidate pools entirely.
            </div>
          </div>

          <div className="rule">
            <div className="rule-title">Senior Resident (SR)</div>
            <div className="rule-body">
              <strong>Can do:</strong> OT, Supervised Clinics, Admin
              <br/>
              <strong>Cannot do:</strong> MOPD, MO call (MO1-MO5)
              <br/>
              <strong>OT prioritised:</strong> Senior Residents receive a +3.0 scoring bonus for OT, making them preferred for OT over MOs. They are tagged to their supervisor as first priority (+5.0 supervisor match).
              <br/>
              <strong>Also eligible for:</strong> R1, R2, and EOT registrar duties
            </div>
          </div>

          <div className="rule">
            <div className="rule-title">Senior Medical Officer (SMO)</div>
            <div className="rule-body">
              <strong>Can do:</strong> OT, Supervised Clinics, MOPD, Admin, MO1-MO5 call
              <br/>
              <strong>Exclusive:</strong> Only SMOs can fill weekday MO3 (referral duty)
              <br/>
              SMOs are the senior tier of the MO call pool. They share call duties with regular MOs.
            </div>
          </div>

          <div className="rule">
            <div className="rule-title">Medical Officer (MO)</div>
            <div className="rule-body">
              <strong>Can do:</strong> OT, Supervised Clinics, MOPD, Admin, MO1/MO2/MO4/MO5 call
              <br/>
              <strong>Cannot do:</strong> Weekday MO3 (referral duty, SMO only)
              <br/>
              MOs are the general-purpose pool and fill all remaining duty slots.
            </div>
          </div>
        </section>

        <section className="rules-section">
          <h3>Duty Scoring &amp; Matching</h3>

          <div className="rule">
            <div className="rule-title">OT assignment scoring</div>
            <div className="rule-body">
              <strong>Fairness (up to +10.0):</strong> People with fewer OT days are preferred.
              <br/>
              <strong>Supervisor match (+5.0):</strong> If the person is tagged to the OT list's consultant.
              <br/>
              <strong>Team match (+3.0):</strong> If the person is in the same team as the OT list's consultant.
              <br/>
              <strong>SR bonus (+3.0):</strong> Senior Residents are prioritised for OT assignments.
            </div>
          </div>

          <div className="rule">
            <div className="rule-title">Supervised Clinic assignment scoring</div>
            <div className="rule-body">
              <strong>Fairness (up to +5.0):</strong> People with fewer clinic sessions are preferred.
              <br/>
              <strong>Supervisor match (+5.0):</strong> If the person is tagged to the clinic's consultant.
              <br/>
              <strong>Team match (+3.0):</strong> If the person is in the same team as the clinic's consultant.
              <br/>
              SSRs are excluded. SRs, SMOs, and MOs are all eligible with no grade-specific bonus.
            </div>
          </div>

          <div className="rule">
            <div className="rule-title">MOPD assignment scoring</div>
            <div className="rule-body">
              <strong>Fairness (up to +3.0):</strong> People with fewer MOPD sessions are preferred.
              <br/>
              Only Senior Medical Officers and Medical Officers are eligible for MOPD. SSRs and SRs are excluded.
            </div>
          </div>
        </section>

        <section className="rules-section">
          <h3>Team &amp; Consultant Tagging</h3>

          <div className="rule">
            <div className="rule-title">Team assignment</div>
            <div className="rule-body">
              Each MO/SR is assigned to one of the five teams: Trauma, Shoulder &amp; Elbow, Hip &amp; Knee, Foot &amp; Ankle, Spine.
              Team assignment determines team-level matching (+3.0 bonus) for OT, clinic, and MO1 call assignments.
            </div>
          </div>

          <div className="rule">
            <div className="rule-title">Consultant tagging (supervisor)</div>
            <div className="rule-body">
              Within a team, each MO/SR can be tagged to a specific consultant as their supervisor.
              This provides a stronger match (+5.0 bonus) than team-level matching alone.
              An MO tagged to a consultant will be preferentially assigned to that consultant's OT list, clinic, and MO1 call.
            </div>
          </div>
        </section>

        <section className="rules-section">
          <h3>Registrar Duties (R1 / R2 / EOT)</h3>

          <div className="rule">
            <div className="rule-title">Eligible grades</div>
            <div className="rule-body">
              Both Senior Staff Registrars and Senior Residents can be assigned to R1, R2, and EOT registrar duties.
              These are managed separately from the MO call roster and daytime duty roster.
            </div>
          </div>

          <div className="rule">
            <div className="rule-title">Duty types</div>
            <div className="rule-body">
              <strong>R1:</strong> First on-call registrar. Handles admissions and primary surgical assessment.
              <br/>
              <strong>R2:</strong> Second on-call registrar. Supports R1 with surgical coverage.
              <br/>
              <strong>EOT:</strong> Emergency OT registrar. Covers emergency operating theatre cases.
            </div>
          </div>

          <div className="rule">
            <div className="rule-title">Shift types</div>
            <div className="rule-body">
              Each registrar duty can be designated as Day, Night, or Combined (full 24h) shift.
            </div>
          </div>
        </section>

        <section className="rules-section">
          <h3>Month-to-Month Carryover</h3>

          <div className="rule">
            <div className="rule-title">Prior month lookback</div>
            <div className="rule-body">
              When generating a new month's roster, the solver looks back at the last 7 days of the previous month's call assignments.
              This ensures post-call rest, call gap, and call type consistency rules are respected across the month boundary.
            </div>
          </div>
        </section>

        <section className="rules-section">
          <h3>Manual Overrides</h3>

          <div className="rule">
            <div className="rule-title">Call roster overrides</div>
            <div className="rule-body">
              Any MO call slot can be manually overridden by clicking the cell in the Call Roster view.
              Overrides are preserved when the roster is regenerated (auto-generated assignments are cleared, manual overrides are kept).
              Override cells are highlighted with a blue outline.
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
