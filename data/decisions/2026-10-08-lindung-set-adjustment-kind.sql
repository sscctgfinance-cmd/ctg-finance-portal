-- 2026-10-08 — allow the `lindung_set` payroll adjustment (HR OS → Payroll: the LINDUNG 24 column is editable).
--
-- The grid saves a typed LINDUNG 24 figure as a per-period adjustment of kind `lindung_set`, exactly as it
-- saves a typed PCB as `pcb_set` (v195). hr_payroll_adjustments_kind_ck lists every allowed kind, so without
-- this a save carrying the override is refused by the database. Widening only: no existing row changes.
--
-- Apply BEFORE (or together with) deploying the code that writes it. Migrations are applied directly, not by CI.

alter table public.hr_payroll_adjustments drop constraint hr_payroll_adjustments_kind_ck;
alter table public.hr_payroll_adjustments add constraint hr_payroll_adjustments_kind_ck
  check (kind = any (array['allowance','allowance_var','deduction','bonus','ot','unpaid_leave',
                           'basic_set','allow_set','pcb_set','lindung_set','skip']::text[]));

-- Rollback (only once no row uses it):
--   alter table public.hr_payroll_adjustments drop constraint hr_payroll_adjustments_kind_ck;
--   alter table public.hr_payroll_adjustments add constraint hr_payroll_adjustments_kind_ck
--     check (kind = any (array['allowance','allowance_var','deduction','bonus','ot','unpaid_leave',
--                              'basic_set','allow_set','pcb_set','skip']::text[]));
