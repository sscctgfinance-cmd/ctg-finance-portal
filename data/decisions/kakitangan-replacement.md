# Replacing Kakitangan with HR OS — the gap, measured

**Decision (operator, 2026-09-05): option (a) — HR OS replaces Kakitangan.** DrSmile Whitening Sdn Bhd
runs its payroll on Kakitangan today; the goal is that HR OS produces the same figures AND is usable by
the same people without relearning the tool.

This file is the spec that came out of reading Kakitangan's own August 2026 payroll and its settings
pages, not from documentation. Everything below was observed.

## What already matches — do not rebuild it

The gazetted arithmetic is identical. Verified against Kakitangan's August 2026 DrSmile run, on the
five employees whose wage is unambiguous (no additional earnings, so nothing hidden in the "Additional"
column):

| employee | wage | EPF ee | SOCSO ee | EIS ee | SKBBK |
|---|---:|---:|---:|---:|---:|
| Elaine Lam | 13,000 | 1,430.00 | 29.75 | 11.90 | 44.65 |
| Loong Ming Haow | 15,000 | 1,650.00 | 29.75 | 11.90 | 44.65 |
| Song Huey Yu | 4,000 | 440.00 | 19.75 | 7.90 | 29.65 |
| Oon Sin Joh | 6,000 | 660.00 | 29.75 | 11.90 | 44.65 |
| (calculator) | 1,548.39 | 172.00 | 7.75 | 3.10 | 11.65 |

`hrCompute` reproduces every one of those to the sen, including the KWSP Third Schedule banding
(RM20 steps to 5,000, RM100 steps to 20,000, each side rounded UP), the Cat-1 SOCSO and EIS tables at
the RM6,000 ceiling, `myLindung24` (= Cat2 employer − Cat1 employee), and HRDF at 1%.

**So this is not a formula project.** It is a data-model project.

## What differs — the model

Kakitangan carries SEVEN independent statutory flags on EVERY earning line:

```
apply_tax   apply_epf   apply_socso   apply_eis   apply_skbbk   apply_ot   apply_hrdf
```

HR OS carries ONE (`hr_payroll_adjustments.epf_subject`), and it drives EPF **and** SOCSO **and** EIS
together, because all three derive from `statWage`. There is no way to express "in gross, in EPF, out
of SOCSO" — or any of the other 126 combinations.

Every discrepancy found in the August run is explained by that, and by the per-employee overrides
below. The cleanest evidence is Kong Lina: gross 5,555, but EPF, SOCSO, EIS and SKBBK **all four**
independently imply a statutory wage of 5,400–5,500. RM55 of her pay is in gross and out of all four.
HR OS cannot represent that row.

Two figures cannot be produced by any wage at all — Chong Zih Ying's SOCSO 13.95 and Ong Jia Yong's
17.55 are in neither table. Those are `custom_socso_amount` overrides, or pro-rata.

### Per-employee overrides Kakitangan has and HR OS does not

| Kakitangan field | HR OS equivalent |
|---|---|
| `epf_enabled` / `custom_epf_amount` | `epf_eligible` only — no custom amount |
| `socso_enabled` / `custom_socso_amount` | `socso_eligible` only |
| `eis_enabled` / `custom_eis_amount` | `eis_eligible` only |
| `skbbk_enabled` / `custom_skbbk_amount` | `lindung24` only |
| `tax_enabled` / `custom_tax_amount` / `use_tax_table` | `pcb_set` ✅ (the one that exists) |
| `epf_higher` | `epf_er_rate` override ✅ |
| `zakat` | ✅ (deduction labelled zakat) |
| `ptptn` | ✗ |
| ASNB | ✗ |

### Company settings HR OS does not have

- **EPF**: employer add-on %, "fixed rate for staff with salary RM5K+ on top of individual's extra",
  and EPF Voluntary Excess with TWO calculation modes (table minimum + excess RM, vs
  gross × (min% + voluntary%)).
- **Pro-rata**: enable/disable; working-days basis (every day / only work days / custom); whether
  weekends, off days and public holidays are unpaid; a **payroll cutoff day**; and a SEPARATE set of
  the same three settings for unpaid leave and for annual-leave encashment.
- **HRDF**: applicable Y/N and a configurable percentage. HR OS hardcodes `HR_HRDF_RATE = 0.01`.
- **Payroll cycles per month**: one or two. HR OS has one run per company per month
  (`hr_payroll_runs` is UNIQUE on tenant+month+year).

### Earning types

Kakitangan ships ~20 named types — General Allowance, Transport, Petrol, Parking, Phone, Commissions,
Bonus, Meals, Childcare, Reward, Claims, Director Fees, Incentive, prior-year Bonus, prior-year Salary,
Encashment Leave, Public Holiday, BIK/VOLA — plus SEVEN overtime categories (Normal, PH normal, PH
beyond, Off day, Rest day <4h, Rest day 4–8h, Rest day beyond), each with its own hour rate.

HR OS has four generic kinds: `allowance`, `allowance_var` (v229), `bonus`, `ot`.

## Staged plan

Each stage ships on its own and leaves the system working. The safety property from v229 applies
throughout: **a payload that uses none of the new fields must compute exactly as it does today**, so no
historical payslip is ever restated.

**S1 — the seven flags.** `hr_payroll_adjustments` gains `socso_subject`, `eis_subject`, `skbbk_subject`,
`pcb_subject`, `hrdf_subject` beside the existing `epf_subject`; both engines read them; default NULL
behaves exactly as today. Closes the Kong Lina class. *This is the one that makes the numbers match.*

**S2 — per-employee custom amounts.** `custom_socso`, `custom_eis`, `custom_skbbk`, `custom_epf_ee`,
`custom_epf_er` on `hr_employees`, mirroring the `pcb_set` mechanism that already works. Closes the
Chong / Ong class.

**S3 — earning-type catalogue.** A `hr_earning_types` table: name, the seven default flags, display
order, per-tenant. The grid's columns become this catalogue rather than six hardcoded ones. This is the
one that makes the tool feel like Kakitangan to the person using it.

**S4 — overtime categories.** Seven rates rather than one `ot` bucket.

**S5 — pro-rata.** Joiner/leaver and unpaid-leave proration on the settings above. Note HR OS already
prorates a joiner through `myServiceMonths` for PCB only — not for the salary itself.

**S6 — the rest.** HRDF %, PTPTN, ASNB, two cycles per month.

## Open questions before S1

1. **Which companies migrate?** DrSmile is on Kakitangan. Are the other five, or is DrSmile the only one?
   The answer changes whether `hr_earning_types` is per-tenant or global.
2. **Is the historical data migrating too**, or does HR OS start clean from a cutover month? EA forms and
   Form E need the whole year, so a mid-year cutover means importing Jan–cutover from Kakitangan.
3. **The 20 earning types' DEFAULT flags** were not readable from the calculator — only the fields were.
   They need to be read off Kakitangan's settings, or confirmed by the operator, before S3.
