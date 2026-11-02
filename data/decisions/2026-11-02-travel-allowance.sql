-- 2026-11-02 — HR OS payroll: TRAVEL ALLOWANCE (branch feat/payroll-travel-allowance).
--
-- Three additive changes. Apply BEFORE deploying the code: hr_payroll_finalise writes hr_payslips.travel and
-- hr_emp_save writes hr_employees.travel_allowance, so with the code live and the columns missing every
-- finalise and every employee save fails. Nothing existing changes: both columns default to 0, which the
-- engines treat exactly as "no travel allowance", and the CHECK only gains one kind.
-- Migrations are applied directly, not by CI.

alter table public.hr_employees add column if not exists travel_allowance numeric not null default 0;
alter table public.hr_payslips  add column if not exists travel           numeric not null default 0;

-- `travel_set` = this month's figure when the grid differs from the profile (allow_set's twin). The CHECK
-- lists every kind, so a new kind needs this or the grid save is refused.
alter table public.hr_payroll_adjustments drop constraint hr_payroll_adjustments_kind_ck;
alter table public.hr_payroll_adjustments add constraint hr_payroll_adjustments_kind_ck
  check (kind = any (array['allowance','allowance_var','deduction','bonus','ot','unpaid_leave',
                           'basic_set','allow_set','pcb_set','lindung_set','travel_set','skip']::text[]));

-- Rollback (only once no row uses them):
--   alter table public.hr_payroll_adjustments drop constraint hr_payroll_adjustments_kind_ck;
--   alter table public.hr_payroll_adjustments add constraint hr_payroll_adjustments_kind_ck
--     check (kind = any (array['allowance','allowance_var','deduction','bonus','ot','unpaid_leave',
--                              'basic_set','allow_set','pcb_set','lindung_set','skip']::text[]));
--   alter table public.hr_payslips  drop column travel;
--   alter table public.hr_employees drop column travel_allowance;
