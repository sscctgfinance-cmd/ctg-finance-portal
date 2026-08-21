// HR OS · Approvals — the REIMBURSEMENT tab, against the legacy source it replaces.
//
// ── THERE IS NO GOLDEN FOR THIS TAB ───────────────────────────────────────────────────────────────
// `tests/golden/hr.approvals.html` was captured at `APV.tab === 'leave'`, the first-paint state
// (hros.html:3535). `hrApvRc()` (hros.html:3592) and `hrApvWfForm()` (hros.html:3659) are in no
// baseline. So every claim below is either a STRUCTURAL assertion about this port or a claim about the
// legacy READ OUT OF `hros.html` at run time.
//
// Nothing here regenerates or edits a golden, and nothing here touches tests/parity.ts,
// tests/handlers.ts or tests/render_surfaces.ts. `tests/hr-approvals.parity.test.tsx` — the LEAVE
// half's golden diff — is untouched and still passes: this half renders only at `tab === 'rc'`.
//
// ── WHAT IS WORTH GUARDING ────────────────────────────────────────────────────────────────────────
// Not one ringgit is approved on this screen, and every ringgit approved in Reimbursement is approved
// by whoever this screen names. Four ways to get that wrong, none of them visible on a claim:
//  · a control bound to the wrong ROW — an Edit that opens another workflow, an "off" that switches
//    off a different one, a ✕ that removes a different person's approver row;
//  · `approver_type` spelled `'employee'` (the LEAVE tab's word) instead of `'user'`, which drops the
//    named person and falls through to the role;
//  · a POST body that loses `tenant_id`, `max_amount` or `active`, which is a workflow that matches
//    nothing and a claim that falls to the single-approver fallback;
//  · the "no workflow is active" warning going quiet, which is that same fallback with the multi-level
//    chain still on screen looking configured.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import HrApprovalsRc, {
  RC_ROLES, rcChain, rcRange, rcStepFromValue, rcStepValue, rcStepsFor, rcWarning, rcWfEditFrom,
  rcWfNew, rcWfSaveBody,
  type ApvEmployee, type RcRoleApprover, type RcWorkflow, type RcWorkflowStep, type WfEdit, type WfStep,
} from '../src/hr-approvals-rc';
import { FIXTURES } from '../../tests/render_fixtures';
import { REPO } from './parity';

const HROS = readFileSync(join(REPO, 'hros.html'), 'utf8');
/** `hrApvRc()`'s own body, and the workflow form's. */
const RC = HROS.slice(HROS.indexOf('function hrApvRc(){'), HROS.indexOf('function hrApvWfNew(){'));
const FORM = HROS.slice(HROS.indexOf('function hrApvWfForm(){'), HROS.indexOf('async function hrApvWfSave(){'));
const SAVE = HROS.slice(HROS.indexOf('async function hrApvWfSave(){'), HROS.indexOf('async function hrApvWfDel('));

const CFG = FIXTURES.hr_rc_config as {
  workflows: RcWorkflow[]; workflow_steps: RcWorkflowStep[]; claim_types: { id: string; name: string }[];
  employees: ApvEmployee[];
};

/**
 * The `role_approvers` list is NOT taken from `tests/render_fixtures.ts`.
 *
 * That fixture writes `claim_role`, but `hr_rc_config` returns `hr_claim_role_approvers.*`
 * (hr.ts:1966) and the column is `role` — which is the key `hrApvRc()` groups by (hros.html:3616). The
 * fixture is another owner's file and is not edited here; the discrepancy is reported in the PR. Using
 * the SERVER's shape is what makes the grouping testable at all: with the fixture's spelling every
 * role reads as "none", which is the same output a broken grouping produces.
 */
const APPROVERS: RcRoleApprover[] = [
  { id: 'ra1', role: 'hr', employee_id: CFG.employees[0].id },
  { id: 'ra2', role: 'hr', employee_id: CFG.employees[1].id },
  { id: 'ra3', role: 'director', employee_id: CFG.employees[2].id },
];

const noop = () => {};
type Props = Parameters<typeof HrApprovalsRc>[0];

function screen(over: Partial<Props> = {}) {
  return (
    <HrApprovalsRc
      workflows={CFG.workflows} workflowSteps={CFG.workflow_steps} roleApprovers={APPROVERS}
      claimTypes={CFG.claim_types} employees={CFG.employees} wfEdit={null}
      onWfNew={noop} onWfEdit={noop} onWfOff={noop} onWfCancel={noop} onWfSave={noop}
      onStepSet={noop} onStepAdd={noop} onStepDel={noop} onApproverAdd={noop} onApproverDel={noop}
      {...over}
    />
  );
}
const html = (over: Partial<Props> = {}) => renderToStaticMarkup(screen(over));

describe('approver_type is `user` here and `employee` on the leave tab', () => {
  // The single most confusable thing on this screen, and the server resolves the two apart
  // (`stepEligibleApprovers`, hr.ts:258 onward). Both spellings are pinned out of hros.html so they
  // cannot converge by accident in either direction.
  it('is what hros.html writes, in both halves', () => {
    const leaveSet = HROS.slice(HROS.indexOf('function hrApvLeaveSet('), HROS.indexOf('function hrApvLeaveAdd('));
    const stepSet = HROS.slice(HROS.indexOf('function hrApvWfStepSet('), HROS.indexOf('function hrApvWfStepAdd('));
    expect(leaveSet).toContain("approver_type:'employee'");
    expect(leaveSet).not.toContain("approver_type:'user'");
    expect(stepSet).toContain("approver_type:'user'");
    expect(stepSet).not.toContain("approver_type:'employee'");
  });

  it('rcStepFromValue() writes `user` for a person, and round-trips through rcStepValue()', () => {
    const s = rcStepFromValue('emp:' + CFG.employees[1].id, CFG.employees);
    expect(s.approver_type).toBe('user');
    expect(s.approver_employee_id).toBe(CFG.employees[1].id);
    expect(s.name).toBe(CFG.employees[1].name);
    expect(rcStepValue(s)).toBe('emp:' + CFG.employees[1].id);
  });

  it('writes the manager and the role forms exactly as hros.html:3651 does', () => {
    expect(rcStepFromValue('manager', CFG.employees)).toEqual({ approver_type: 'manager', approver_role: 'manager', name: 'Direct Manager' });
    expect(rcStepFromValue('role:hr', CFG.employees)).toEqual({ approver_type: 'role', approver_role: 'hr', name: 'HR' });
    expect(rcStepFromValue('role:director', CFG.employees)).toEqual({ approver_type: 'role', approver_role: 'director', name: 'Director / Boss' });
    expect(rcStepFromValue('role:finance', CFG.employees)).toEqual({ approver_type: 'role', approver_role: 'finance', name: 'Finance' });
    // An unknown role keeps its own id as the label, rather than rendering blank.
    expect(rcStepFromValue('role:ops', CFG.employees).name).toBe('ops');
  });

  it('falls back to "Employee" for an id that is not on the list — never to a blank name', () => {
    // A blank name renders the chain as `→ →`, and `rcChain()` falls back to the ROLE, which a `user`
    // step does not have. The legacy's `(e && e.name) || 'Employee'` is what stops that.
    expect(rcStepFromValue('emp:ghost', CFG.employees).name).toBe('Employee');
  });
});

describe('the "no workflow is active" warning — the silent-downgrade trap', () => {
  it('warns, with the count, when workflows exist and every one is off', () => {
    const off = CFG.workflows.map((w) => ({ ...w, active: false }));
    expect(rcWarning(off)).toEqual({ kind: 'all-off', count: off.length });
    const out = html({ workflows: off });
    expect(out).toContain('⚠ No workflow is active.');
    expect(out).toContain('single-approver fallback');
    expect(out).toContain(String(off.length) + ' workflow(s) configured');
  });

  it('warns differently when there are none at all', () => {
    expect(rcWarning([])).toEqual({ kind: 'none' });
    const out = html({ workflows: [] });
    expect(out).toContain('⚠ No approval workflow.');
    expect(out).not.toContain('No workflow is active');
    expect(out).toContain('No workflows yet');
  });

  it('is silent while ONE is on — including when the rest are off', () => {
    expect(rcWarning(CFG.workflows)).toBeNull();
    expect(html()).not.toContain('⚠ No');
    const one = CFG.workflows.map((w, i) => ({ ...w, active: i === 0 }));
    expect(rcWarning(one)).toBeNull();
    expect(html({ workflows: one })).not.toContain('⚠ No');
  });

  it('reads `active` as the legacy does — a missing flag is OFF for the warning', () => {
    // hros.html:3608 filters on `w.active` truthiness, not on `!== false`. Mirrored: a workflow whose
    // column is null is not counted as protecting anything.
    expect(RC.replace(/\s+/g, ' ')).toContain('wfOn=wfAll.filter(function(w){return w.active;})');
    expect(rcWarning([{ id: 'x', active: null }])).toEqual({ kind: 'all-off', count: 1 });
  });
});

describe('the workflow table — every row showing and doing its OWN thing', () => {
  it('shows each workflow\'s own chain, sorted by step_order', () => {
    const out = html();
    // wf2 has two steps and they must appear in step_order, not in array order.
    expect(rcStepsFor('wf2', CFG.workflow_steps).map((s) => s.step_order)).toEqual([1, 2]);
    expect(out).toContain('Manager → Finance');
    // The sort is not decoration: reversed input must still print in order.
    const reversed = [...CFG.workflow_steps].reverse();
    expect(rcChain(rcStepsFor('wf2', reversed))).toBe('Manager → Finance');
  });

  it('never shows another workflow\'s steps', () => {
    expect(rcStepsFor('wf1', CFG.workflow_steps).map((s) => s.id)).toEqual(['ws1']);
    expect(rcChain(rcStepsFor('wf1', CFG.workflow_steps))).toBe('Manager');
  });

  it('shows an em-dash for a workflow with no steps at all — not a blank cell', () => {
    expect(rcChain([])).toBe('—');
    expect(html({ workflowSteps: [] })).toContain('>—<');
  });

  it('formats the amount band the way hros.html:3599 does, open-ended max included', () => {
    expect(RC).toContain("var rng='RM'+(w.min_amount||0)+(w.max_amount!=null?('–'+w.max_amount):'+');");
    expect(rcRange({ id: 'x', min_amount: 0, max_amount: 1000 })).toBe('RM0–1000');
    expect(rcRange({ id: 'x', min_amount: 1000.01, max_amount: null })).toBe('RM1000.01+');
    expect(rcRange({ id: 'x' })).toBe('RM0+');
    const out = html();
    expect(out).toContain('RM0–1000');
    expect(out).toContain('RM1000.01+');
  });

  it('says which companies a workflow governs, and at what priority', () => {
    expect(html({ workflows: [{ id: 'w', name: 'X', tenant_id: 't1', priority: 5, active: true }] })).toContain('this company · priority 5');
    expect(html({ workflows: [{ id: 'w', name: 'X', tenant_id: null, priority: 0, active: true }] })).toContain('all companies · priority 0');
  });

  it('offers "off" only for a workflow that is ON', () => {
    expect(html()).toContain('>off</button>');
    expect(html({ workflows: CFG.workflows.map((w) => ({ ...w, active: false })) })).not.toContain('>off</button>');
    expect(html({ workflows: CFG.workflows.map((w) => ({ ...w, active: false })) })).toContain('pill-draft');
  });

  it('binds Edit and off to their OWN workflow id, in row order', () => {
    const edits: string[] = [];
    const offs: string[] = [];
    invokeAll(screen({ onWfEdit: (id) => edits.push(id), onWfOff: (id) => offs.push(id) }), ['onClick']);
    expect(edits).toEqual(CFG.workflows.map((w) => w.id));
    expect(offs).toEqual(CFG.workflows.filter((w) => w.active).map((w) => w.id));
    expect(new Set(edits).size).toBe(edits.length);   // no two rows sharing an id
  });
});

describe('the role approvers — who actually holds each level', () => {
  it('offers the two roles hros.html:3617 offers, and no retired one', () => {
    // Manager and Finance were retired by the operator; the legacy line says so. Re-offering one hands
    // a level to a role with no holder, which falls through to "an admin approves this level".
    expect(RC).toContain("var roles=[['hr','HR'],['director','Director / Boss']];");
    expect(RC_ROLES).toEqual([['hr', 'HR'], ['director', 'Director / Boss']]);
    const out = html();
    expect(out).toContain('>HR</div>');
    expect(out).toContain('>Director / Boss</div>');
    expect(out).not.toContain('>Finance</div>');
  });

  it('groups each person under the role they hold, by the server\'s own column', () => {
    const out = html();
    // Scoped to the PILL list of each row. The picker beside it offers every employee, so a
    // document-wide `toContain` would pass with the grouping broken — the finance.cfo finding, that a
    // glyph/name assertion has to be scoped to its own cell.
    const pills = (role: string) => {
      const at = out.indexOf(`>${role}</div>`);
      return out.slice(at, out.indexOf('<select', at));
    };
    expect(pills('HR')).toContain(CFG.employees[0].name);
    expect(pills('HR')).toContain(CFG.employees[1].name);
    expect(pills('HR')).not.toContain(CFG.employees[2].name);
    expect(pills('Director / Boss')).toContain(CFG.employees[2].name);
    expect(pills('Director / Boss')).not.toContain(CFG.employees[0].name);
  });

  it('says a role has NO holder rather than showing it empty', () => {
    const out = html({ roleApprovers: [] });
    expect((out.match(/none — an admin approves this level until you assign someone/g) || []).length).toBe(2);
  });

  it('falls back to the raw id for a person no longer on the employee list', () => {
    // hros.html:3615's `return e?e.name:id`. Printing a blank there hides that a departed employee is
    // still an approver on a live chain.
    expect(html({ roleApprovers: [{ id: 'ra9', role: 'hr', employee_id: 'gone' }] })).toContain('gone');
  });

  it('binds each ✕ to the ROLE-APPROVER row id, not to the employee', () => {
    // hros.html:3620 posts `{kind:'role_approver_del', row:{id: a.id}}`. Binding it to `employee_id`
    // would remove that person from EVERY role at once — or delete nothing and look like it worked.
    const dels: string[] = [];
    invokeAll(screen({ onApproverDel: (id) => dels.push(id) }), ['onClick']);
    expect(dels).toEqual(['ra1', 'ra2', 'ra3']);
    for (const e of CFG.employees) expect(dels).not.toContain(e.id);
  });

  it('binds each "add" to its OWN role, and gives each picker its own legacy id', () => {
    const adds: string[] = [];
    invokeAll(screen({ onApproverAdd: (r) => adds.push(r) }), ['onClick']);
    expect(adds).toEqual(['hr', 'director']);
    const out = html();
    expect(out).toContain('id="apv_addapp_hr"');
    expect(out).toContain('id="apv_addapp_director"');
    // The id is the contract `hrApvApproverAdd()` reads the picker back by (hros.html:3697).
    expect(HROS).toContain("var sel=document.getElementById('apv_addapp_'+role);");
  });

  it('offers every active employee in every picker, with the blank prompt first', () => {
    const out = html();
    const picker = out.slice(out.indexOf('id="apv_addapp_hr"'), out.indexOf('</select>', out.indexOf('id="apv_addapp_hr"')));
    expect([...picker.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]))
      .toEqual(['', ...CFG.employees.map((e) => e.id)]);
    expect(picker).toContain('+ add person…');
  });
});

describe('the workflow form', () => {
  const W: WfEdit = rcWfEditFrom(CFG.workflows[1], CFG.workflow_steps);
  const form = (over: Partial<WfEdit> = {}) => html({ wfEdit: { ...W, ...over } });

  it('replaces both panels — the legacy returns the form INSTEAD of them (hros.html:3593)', () => {
    expect(RC).toContain('if(APV.wfEdit) return hrApvWfForm();');
    const out = form();
    expect(out).toContain('Edit workflow');
    expect(out).not.toContain('Role approvers');
    expect(out).not.toContain('Reimbursement approval workflows');
  });

  it('renders every apv_wf_* id hrApvWfSyncInputs() and hrApvWfSave() read it back by', () => {
    const sync = HROS.slice(HROS.indexOf('function hrApvWfSyncInputs(){'), HROS.indexOf('function hrApvWfStepSet('));
    const ids = [...new Set([...(sync + SAVE).matchAll(/'(apv_wf_[a-z]+)'/g)].map((m) => m[1]))];
    expect(ids.sort()).toEqual(['apv_wf_active', 'apv_wf_dept', 'apv_wf_max', 'apv_wf_min', 'apv_wf_name', 'apv_wf_prio', 'apv_wf_scope', 'apv_wf_type']);
    const out = form();
    for (const id of ids) expect(out, id).toContain(`id="${id}"`);
  });

  it('shows each header field\'s OWN value', () => {
    const out = form({ name: 'Claims above RM1,000', min_amount: '1000.01', max_amount: '', priority: 20, match_department: 'Sales', match_claim_type_id: 'ct2' });
    const at = (id: string) => out.match(new RegExp(`<[^>]*id="${id}"[^>]*>`))?.[0] || '';
    expect(at('apv_wf_name')).toContain('value="Claims above RM1,000"');
    expect(at('apv_wf_min')).toContain('value="1000.01"');
    expect(at('apv_wf_max')).toContain('value=""');
    expect(at('apv_wf_prio')).toContain('value="20"');
    expect(at('apv_wf_dept')).toContain('value="Sales"');
    expect(out).toContain('<option value="ct2" selected="">Meals &amp; entertainment</option>');
  });

  it('selects the SCOPE from tenant_id — a null tenant is "all companies"', () => {
    expect(form({ tenant_id: 't1' })).toContain('<option value="tenant" selected="">This company only</option>');
    expect(form({ tenant_id: null })).toContain('<option value="all" selected="">All companies</option>');
  });

  it('ticks Active from the record, not from a hardcode', () => {
    expect(form({ active: true })).toMatch(/id="apv_wf_active"[^>]*\schecked/);
    expect(form({ active: false })).not.toMatch(/id="apv_wf_active"[^>]*\schecked/);
  });

  it('titles itself Edit or New from the id', () => {
    expect(form()).toContain('Edit workflow');
    expect(form({ id: null })).toContain('New workflow');
  });

  it('offers "any type" plus every claim type, and nothing else', () => {
    const out = form();
    const sel = out.slice(out.indexOf('id="apv_wf_type"'), out.indexOf('</select>', out.indexOf('id="apv_wf_type"')));
    expect([...sel.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1])).toEqual(['', ...CFG.claim_types.map((t) => t.id)]);
  });

  it('shows the chain it would save, and each step on its own row', () => {
    const out = form();
    expect(out).toContain('Chain: <b>Manager → Finance</b>');
    expect(out).toContain('>1</span>');
    expect(out).toContain('>2</span>');
  });

  it('hides "remove" on the LAST step — a chain of zero saves as no approvers', () => {
    expect(FORM).toContain("(w.steps.length>1?'<a onclick=\"hrApvWfStepDel('+i+')\"");
    expect(form()).toContain('>remove</a>');
    expect(form({ steps: [W.steps[0]] })).not.toContain('>remove</a>');
  });

  it('binds each step\'s select and remove to its OWN index', () => {
    const sets: [number, string][] = [];
    const dels: number[] = [];
    const node = screen({ wfEdit: W, onStepSet: (i, v) => sets.push([i, v]), onStepDel: (i) => dels.push(i) });
    invokeAll(node, ['onClick', 'onChange']);
    expect(sets.map(([i]) => i)).toEqual([0, 1]);
    expect(dels).toEqual([0, 1]);
  });

  it('selects the option each step is actually on', () => {
    const out = form({ steps: [{ approver_type: 'user', approver_employee_id: CFG.employees[1].id, name: 'X' }] });
    expect(out).toContain(`<option value="emp:${CFG.employees[1].id}" selected="">${CFG.employees[1].name}</option>`);
  });

  it('opens a workflow with no steps on file at a single Finance step, as hros.html:3628 does', () => {
    expect(FORM.length + RC.length).toBeGreaterThan(0);
    expect(HROS).toContain("(st.length?st:[{approver_type:'role',approver_role:'finance',name:'Finance'}])");
    const bare = rcWfEditFrom({ id: 'wX', name: 'X' }, []);
    expect(bare.steps).toEqual([{ approver_type: 'role', approver_role: 'finance', name: 'Finance' }]);
  });

  it('rcWfNew() is hrApvWfNew()\'s record, field for field', () => {
    expect(rcWfNew('t1')).toEqual({
      id: null, name: '', tenant_id: 't1', min_amount: '', max_amount: '', priority: 10, active: true,
      match_department: '', match_claim_type_id: '',
      steps: [{ approver_type: 'role', approver_role: 'finance', name: 'Finance' }],
    });
    expect(HROS).toContain("APV.wfEdit={ id:null, name:'', tenant_id:HR.tenant, min_amount:'', max_amount:'', priority:10, active:true, match_department:'', match_claim_type_id:'', steps:[{approver_type:'role',approver_role:'finance',name:'Finance'}] }");
  });

  it('rcWfEditFrom() carries the record\'s own band, priority and filters', () => {
    const w = rcWfEditFrom({ id: 'w', name: 'X', tenant_id: 't1', min_amount: 0, max_amount: null, priority: 0, active: false, match_department: null, match_claim_type_id: null }, []);
    // A null max becomes '' ("no cap"), a null department becomes '' — both are the legacy's own
    // coercions, and both mean "unset" rather than "zero".
    expect(w.max_amount).toBe('');
    expect(w.min_amount).toBe(0);
    expect(w.match_department).toBe('');
    expect(w.active).toBe(false);
    // ...but `active: undefined` is ACTIVE, per `w.active !== false`.
    expect(rcWfEditFrom({ id: 'w', name: 'X' }, []).active).toBe(true);
  });
});

describe('rcWfSaveBody() — the POST that decides who approves', () => {
  const steps: WfStep[] = [{ approver_type: 'manager', approver_role: 'manager', name: 'Direct Manager' },
    { approver_type: 'user', approver_employee_id: 'e2', name: 'SITI' }];
  const f = { name: 'High value', scope: 'tenant', min: '1000.01', max: '', prio: '20', dept: ' Sales ', type: 'ct2', active: true };

  it('is what hrApvWfSave() posts, rule for rule', () => {
    const row = rcWfSaveBody(steps, f, 'tenant-1', 'wf2');
    expect(row).toEqual({
      id: 'wf2', name: 'High value', tenant_id: 'tenant-1',
      min_amount: 1000.01, max_amount: null, priority: 20, active: true,
      match_department: 'Sales', match_claim_type_id: 'ct2',
      steps: [
        { name: 'Direct Manager', approver_type: 'manager', approver_role: 'manager', approver_employee_id: null },
        { name: 'SITI', approver_type: 'user', approver_role: null, approver_employee_id: 'e2' },
      ],
    });
  });

  it('sends NULL, not undefined, for a step\'s unused id — undefined is dropped by JSON', () => {
    // `JSON.stringify` omits an undefined value, so the column would keep whatever it had: a step
    // switched from a person to a role would still carry the person.
    const row = rcWfSaveBody(steps, f, 't', null);
    expect(JSON.parse(JSON.stringify(row)).steps[0]).toHaveProperty('approver_employee_id', null);
    expect(JSON.parse(JSON.stringify(row)).steps[1]).toHaveProperty('approver_role', null);
    expect(SAVE).toContain('approver_role:s.approver_role||null,approver_employee_id:s.approver_employee_id||null');
  });

  it('scopes to ALL companies only when the picker says so', () => {
    expect(rcWfSaveBody(steps, { ...f, scope: 'all' }, 'tenant-1', null).tenant_id).toBeNull();
    expect(rcWfSaveBody(steps, { ...f, scope: 'tenant' }, 'tenant-1', null).tenant_id).toBe('tenant-1');
    expect(SAVE).toContain("tenant_id:(scope==='all'?null:HR.tenant)");
  });

  it('reads a blank min as 0 and a blank max as NO CAP — never as zero', () => {
    // A blank max coerced to 0 makes the workflow match nothing, and every claim it was written for
    // falls to the single-approver fallback.
    const row = rcWfSaveBody(steps, { ...f, min: '', max: '' }, 't', null);
    expect(row.min_amount).toBe(0);
    expect(row.max_amount).toBeNull();
    expect(rcWfSaveBody(steps, { ...f, max: '0' }, 't', null).max_amount).toBe(0);
    expect(SAVE).toContain("min_amount:(gv('apv_wf_min')===''?0:Number(gv('apv_wf_min')))");
    expect(SAVE).toContain("max_amount:(gv('apv_wf_max')===''?null:Number(gv('apv_wf_max')))");
  });

  it('defaults ACTIVE when the checkbox is missing — `!== false`, as the legacy does', () => {
    expect(rcWfSaveBody(steps, { ...f, active: undefined }, 't', null).active).toBe(true);
    expect(rcWfSaveBody(steps, { ...f, active: false }, 't', null).active).toBe(false);
    expect(SAVE).toContain("active:(document.getElementById('apv_wf_active')||{}).checked!==false");
  });

  it('sends an unset department and claim type as NULL, not as an empty string', () => {
    const row = rcWfSaveBody(steps, { ...f, dept: '   ', type: '' }, 't', null);
    expect(row.match_department).toBeNull();
    expect(row.match_claim_type_id).toBeNull();
  });

  it('sends no id for a NEW workflow — an id would overwrite an existing chain', () => {
    expect(rcWfSaveBody(steps, f, 't', null).id).toBeUndefined();
  });

  it('refuses a blank name and an empty chain', () => {
    expect(() => rcWfSaveBody(steps, { ...f, name: '   ' }, 't', null)).toThrow(/name/);
    expect(() => rcWfSaveBody([], f, 't', null)).toThrow(/approval step/);
  });

  it('coerces a non-numeric priority to 0 rather than to NaN', () => {
    expect(rcWfSaveBody(steps, { ...f, prio: '' }, 't', null).priority).toBe(0);
    expect(SAVE).toContain("priority:Number(gv('apv_wf_prio'))||0");
  });
});

describe('the wiring back to the leave screen', () => {
  it('the route no longer hands this tab off to hros.html', () => {
    const route = readFileSync(join(REPO, 'web', 'app', 'hr', 'approvals', 'page.tsx'), 'utf8');
    expect(route).toContain('HrApprovalsRc');
    expect(route).not.toContain('Reimbursement approval workflows are not migrated yet.');
  });

  it('renders only under tab === "rc", so the leave golden is untouched', () => {
    const shell = readFileSync(join(REPO, 'web', 'src', 'hr-approvals.tsx'), 'utf8');
    expect(shell).toContain("{tab === 'leave'");
    expect(shell).toContain(': rc}');
  });

  it('reads no clock — nothing on this screen is derived from a date', () => {
    const src = readFileSync(join(REPO, 'web', 'src', 'hr-approvals-rc.tsx'), 'utf8')
      .replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
    expect(src).not.toMatch(/new Date\b/);
    expect(src).not.toMatch(/toLocale/);
  });
});

/** Invoke every handler of the named kinds in a rendered element tree, in document order. */
function invokeAll(node: unknown, kinds: string[]): void {
  if (node == null || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) invokeAll(n, kinds); return; }
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (!el.props) return;
  if (typeof el.type === 'function') { invokeAll((el.type as (p: unknown) => unknown)(el.props), kinds); return; }
  for (const k of kinds) {
    const v = el.props[k];
    if (typeof v === 'function') (v as (e: unknown) => void)({ target: { value: 'role:hr', checked: true } });
  }
  invokeAll(el.props.children, kinds);
}
