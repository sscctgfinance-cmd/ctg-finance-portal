// HR OS · Payroll — the two WRITE paths: 💾 Save entries and Finalise (F1 in the cutover-gap audit).
//
// Neither is in any golden (both are actions, not markup), and the Payroll screen is the one place in
// this repo where a control looked live and posted to an action the server does not implement
// (`hr_payroll_save_entries` → 400 unknown action). So "it renders" is not enough: the SHAPE of each
// POST is the whole point, and the captain's decision is that Save sends the legacy's DELTA — only the
// cells that differ — because that is what `hr_payroll_finalise`'s server recompute reads back.
//
// Two kinds of evidence, the same split the editors test uses:
//
//  1. THE PURE BUILDERS, driven directly. `gridSaveAdjustments()` is `hrGridSave()`'s diff and
//     `finaliseRows()` is `hrFinalise()`'s row map (hros.html:4305-4317, :4365). Every branch is asserted,
//     including the ones invisible in markup: an unchanged basic emits NOTHING, a null PCB is OMITTED while
//     a 0 PCB is a real override that is SENT, a deduction carries its label, and `skip` is its own row.
//     The legacy source is read at run time so the kind set cannot drift from the function it mirrors.
//  2. THE ROUTE SHAPE, pinned by source with comments blanked. This is the regression guard for AC #5: it
//     fails if either action reverts to the wrong shape — Save back to `hr_payroll_save_entries`/`entries:`
//     or Finalise back to `entries:` with no `rows`. It also pins the double-submit guard as a SYNCHRONOUS
//     ref (not `useState`, which two rapid clicks both read as false — PR #112) and the pre-finalise
//     "save first" guard.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  finaliseRows, gridSaveAdjustments,
  type GridRow, type PayData, type PayRow,
} from '../src/hr-payroll';
import { REPO } from './parity';

const HROS = readFileSync(join(REPO, 'hros.html'), 'utf8');

/** Comments blanked, so the source pins match code and not the prose that quotes the tokens they look for. */
const ROUTE = readFileSync(join(REPO, 'web/app/hr/payroll/page.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

/** A named slice of hros.html, so every claim about the legacy is read rather than remembered. */
function legacy(from: string, to: string): string {
  const a = HROS.indexOf(from);
  expect(a).toBeGreaterThan(-1);
  const b = HROS.indexOf(to, a + from.length);
  expect(b).toBeGreaterThan(a);
  return HROS.slice(a, b);
}

const row = (over: Partial<GridRow>): GridRow => ({
  basic: 0, allow: 0, bonus: 0, ot: 0, allowance: 0, allowanceNs: 0, deductions: [], unpaid: 0,
  pcbSet: null, skip: false, _att: {}, _autoBasic: null, _payType: 'monthly', ...over,
});

/** Two monthly employees with known base records, so the delta is exact rather than fixture-dependent. */
const DATA: PayData = {
  rates: {}, run: null, adjustments: [], employees: [
    { id: 'e1', name: 'A', pay_type: 'monthly', basic_salary: 5200, fixed_allowance: 400 },
    { id: 'e2', name: 'B', pay_type: 'monthly', basic_salary: 3400, fixed_allowance: 250 },
  ],
};

describe('gridSaveAdjustments — hrGridSave()\'s delta (hros.html:4305)', () => {
  it('emits NOTHING for an employee whose cells all match the base record', () => {
    const grid = { e1: row({ basic: 5200, allow: 400 }), e2: row({ basic: 3400, allow: 250 }) };
    expect(gridSaveAdjustments(DATA, grid)).toEqual([]);
  });

  it('emits basic_set / allow_set ONLY when they differ from the base', () => {
    const grid = { e1: row({ basic: 6000, allow: 400 }), e2: row({ basic: 3400, allow: 300 }) };
    expect(gridSaveAdjustments(DATA, grid)).toEqual([
      { employee_id: 'e1', kind: 'basic_set', amount: 6000, epf_subject: true },
      { employee_id: 'e2', kind: 'allow_set', amount: 300, epf_subject: true },
    ]);
  });

  it('sends bonus, ot, allowance, unpaid_leave and labelled deductions', () => {
    const grid = {
      e1: row({ basic: 5200, allow: 400, bonus: 500, ot: 120, allowance: 50, unpaid: 80,
        deductions: [{ label: 'Advance', amount: 150 }, { label: '', amount: 30 }] }),
      e2: row({ basic: 3400, allow: 250 }),
    };
    expect(gridSaveAdjustments(DATA, grid)).toEqual([
      { employee_id: 'e1', kind: 'bonus', amount: 500, epf_subject: true },
      { employee_id: 'e1', kind: 'ot', amount: 120, epf_subject: true },
      { employee_id: 'e1', kind: 'allowance', amount: 50, epf_subject: true },
      { employee_id: 'e1', kind: 'deduction', label: 'Advance', amount: 150, epf_subject: false },
      { employee_id: 'e1', kind: 'deduction', label: 'Other deduction', amount: 30, epf_subject: false },
      { employee_id: 'e1', kind: 'unpaid_leave', amount: 80, epf_subject: false },
    ]);
  });

  it('OMITS a null PCB but SENDS a 0 PCB — 0 is a real override, not "let the engine compute"', () => {
    const auto = gridSaveAdjustments(DATA, { e1: row({ basic: 5200, allow: 400, pcbSet: null }), e2: row({ basic: 3400, allow: 250 }) });
    expect(auto.some((a) => a.kind === 'pcb_set')).toBe(false);
    const override = gridSaveAdjustments(DATA, { e1: row({ basic: 5200, allow: 400, pcbSet: 0 }), e2: row({ basic: 3400, allow: 250 }) });
    expect(override).toContainEqual({ employee_id: 'e1', kind: 'pcb_set', amount: 0, epf_subject: false });
  });

  it('sends a skip row so the server leaves the employee out of the run', () => {
    const grid = { e1: row({ basic: 5200, allow: 400, skip: true }), e2: row({ basic: 3400, allow: 250 }) };
    expect(gridSaveAdjustments(DATA, grid)).toEqual([{ employee_id: 'e1', kind: 'skip', amount: 0, epf_subject: false }]);
  });

  it('uses only the kinds the legacy hrGridSave() emits', () => {
    const slice = legacy('async function hrGridSave', 'hr_payroll_grid_save');
    const legacyKinds = new Set([...slice.matchAll(/kind:'([a-z_]+)'/g)].map((m) => m[1]));
    // Exercise every branch so the output covers the full kind set.
    const grid = {
      e1: row({ basic: 6000, allow: 500, bonus: 1, ot: 1, allowance: 1, unpaid: 1, pcbSet: 5, deductions: [{ label: 'x', amount: 1 }] }),
      e2: row({ basic: 3400, allow: 250, skip: true }),
    };
    const kinds = new Set(gridSaveAdjustments(DATA, grid).map((a) => a.kind));
    expect(kinds).toEqual(legacyKinds);
  });
});

describe('finaliseRows — hrFinalise()\'s rows (hros.html:4365)', () => {
  const rows: PayRow[] = [
    { e: { id: 'e1' }, d: {}, p: { gross: 5600, epfEe: 616, epfEr: 728, socsoEe: 24.75, socsoEr: 86.65, eisEe: 9.9, eisEr: 9.9, lindung: 0, pcb: 220, net: 4729.35, employerCost: 6434.55 } },
    { e: { id: 'e2' }, d: {}, p: { gross: 3400, epfEe: 374, epfEr: 442, socsoEe: 15.25, socsoEr: 53.15, eisEe: 6.1, eisEr: 6.1, lindung: 24, pcb: 0, net: 2980.65, employerCost: 3901.25 } },
  ];

  it('maps every skip-filtered grid row to one entry keyed by employeeId', () => {
    expect(finaliseRows(rows)).toEqual([
      { employeeId: 'e1', gross: 5600, epfEe: 616, epfEr: 728, socsoEe: 24.75, socsoEr: 86.65, eisEe: 9.9, eisEr: 9.9, lindung: 0, pcb: 220, net: 4729.35, employerCost: 6434.55 },
      { employeeId: 'e2', gross: 3400, epfEe: 374, epfEr: 442, socsoEe: 15.25, socsoEr: 53.15, eisEe: 6.1, eisEr: 6.1, lindung: 24, pcb: 0, net: 2980.65, employerCost: 3901.25 },
    ]);
  });

  it('carries exactly the fields the legacy finalise row does', () => {
    const slice = legacy('var rows=(HR.pay._rows', 'hr_payroll_finalise');
    const legacyFields = new Set([...slice.matchAll(/([a-zA-Z]+):q\.[a-zA-Z]+/g)].map((m) => m[1]).concat('employeeId'));
    expect(new Set(Object.keys(finaliseRows(rows)[0]))).toEqual(legacyFields);
  });
});

describe('the route posts the right shape and guards both writes', () => {
  it('Save posts the DELTA to hr_payroll_grid_save, never the dead full-row action', () => {
    expect(ROUTE).toContain("api: 'hr_payroll_grid_save'");
    expect(ROUTE).toContain('adjustments: gridSaveAdjustments(');
    expect(ROUTE).not.toContain('hr_payroll_save_entries');
    expect(ROUTE).not.toContain('entries:');
  });

  it('Finalise posts the rows shape to hr_payroll_finalise', () => {
    expect(ROUTE).toContain("api: 'hr_payroll_finalise'");
    expect(ROUTE).toContain('finaliseRows(');
    expect(ROUTE).toMatch(/rows,\s*tenant:/);
  });

  it('refuses to finalise while there are unsaved entries (hros.html:4370)', () => {
    expect(ROUTE).toContain('Save your entries first');
    expect(ROUTE).toMatch(/if \(dirty\)/);
  });

  it('guards each write with a SYNCHRONOUS ref, set before the await and released in finally', () => {
    // useState would let two rapid clicks both read the same stale false and both POST — PR #112's finding.
    expect(ROUTE).toContain('useRef(false)');
    for (const g of ['savingGrid', 'finalising']) {
      expect(ROUTE).toContain(`if (${g}.current) return;`);
      expect(ROUTE).toContain(`${g}.current = true;`);
      expect(ROUTE).toContain(`${g}.current = false;`);
    }
  });
});
