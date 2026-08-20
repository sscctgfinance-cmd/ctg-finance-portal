// Canned server answers, keyed by the {api:"..."} name the screens call.
//
// These stand in for the edge function. They are NOT captured from production — no customer data reaches
// this repo — but they are shaped from the renderer that consumes them plus the handler in
// supabase/functions/portal/ that produces it, and populated with plausible Malaysian company/payroll
// figures. A fixture that is merely `{ok:true, rows:[]}` renders an empty state and proves nothing, so
// every screen that can show rows is given rows.
//
// deno-lint-ignore-file no-explicit-any

export const CO1 = "11111111-1111-4111-8111-111111111111";
export const CO2 = "22222222-2222-4222-8222-222222222222";
export const COMPANIES = [
  { tenant_id: CO1, tenant_name: "SKINDAE SDN BHD" },
  { tenant_id: CO2, tenant_name: "I PROCARE MALAYSIA SDN BHD" },
];

/** Answers shared by both apps' screens. */
export const FIXTURES: Record<string, any> = {
  me: { ok: true, user: { id: "u1", email: "boss@ctg.test", name: "BOSS", role: "admin" }, companies: COMPANIES },
  // `showApp()` (app.html:1416) resolves this before it decides which of the 22 tabs exist. No GOLDEN
  // surface asks for it — render_surfaces.ts seeds `PERMS` directly — but the React Finance shell reads
  // it like the real app does, so without this entry tools/serve_both.ts cannot drive that half at all.
  // Deliberately the SAME permission set render_surfaces.ts seeds, so the two agree: note that
  // ALL_FEATURES does not contain "users", which is why the Users tab is hidden even for this admin
  // (app.html:1422 — see CLAUDE.md on that control flow).
  my_perms: { ok: true, role: "admin", label: "Administrator", manage_users: true,
    features: ["cfo", "overview", "approvals", "collections", "upload", "o2o", "qinv", "pnl", "close", "recon"] },

  // ── Overview ──────────────────────────────────────────────────────────────────────────────────
  overview: {
    ok: true, as_of: "2026-08-18T01:00:00.000Z",
    companies: [
      { tenant_id: CO1, tenant_name: "SKINDAE SDN BHD", income: 1482300.55, expenses: 1103944.20, net_profit: 378356.35, bank: 612880.11 },
      { tenant_id: CO2, tenant_name: "I PROCARE MALAYSIA SDN BHD", income: 806421.00, expenses: 874112.90, net_profit: -67691.90, bank: 91204.44 },
    ],
  },
  overview_trend: { ok: true, months: [
    { month: "2026-03", revenue: 210433.10, bills: 168220.00 }, { month: "2026-04", revenue: 233910.45, bills: 171004.20 },
    { month: "2026-05", revenue: 198220.00, bills: 180912.75 }, { month: "2026-06", revenue: 265440.90, bills: 191003.30 },
    { month: "2026-07", revenue: 288112.05, bills: 202117.60 }, { month: "2026-08", revenue: 120904.00, bills: 90887.10 },
  ] },

  // ── Approvals ─────────────────────────────────────────────────────────────────────────────────
  pending: { ok: true, bills: [
    { tenant_id: CO1, tenant_name: "SKINDAE SDN BHD", invoice_id: "inv-1", contact: "SHOPEE MOBILE MALAYSIA SDN BHD", number: "BILL-2026-0441", total: 18320.55, due: "2026-08-31", status: "SUBMITTED" },
    { tenant_id: CO1, tenant_name: "SKINDAE SDN BHD", invoice_id: "inv-2", contact: "TENAGA NASIONAL BERHAD", number: "BILL-2026-0442", total: 2044.00, due: "2026-08-25", status: "DRAFT" },
    { tenant_id: CO2, tenant_name: "I PROCARE MALAYSIA SDN BHD", invoice_id: "inv-3", contact: "GRAB HOLDINGS", number: "BILL-2026-0443", total: 640.30, due: "2026-09-04", status: "SUBMITTED" },
  ] },

  // ── Close ─────────────────────────────────────────────────────────────────────────────────────
  close_list: { ok: true, tasks: [
    { id: "c1", period: "2026-08", title: "Bank reconciliation — all accounts", category: "Bank", status: "done", assignee: "AZLINA" },
    { id: "c2", period: "2026-08", title: "Accruals & prepayments posted", category: "Journals", status: "in_progress", assignee: "AZLINA" },
    { id: "c3", period: "2026-08", title: "Payroll journal from HR OS", category: "Journals", status: "pending", assignee: "" },
    { id: "c4", period: "2026-08", title: "Inventory count reconciled to Xero", category: "Stock", status: "pending", assignee: "OPS" },
    { id: "c5", period: "2026-08", title: "Management accounts issued", category: "", status: "pending", assignee: "" },
  ] },

  // ── Users & roles ─────────────────────────────────────────────────────────────────────────────
  roles_list: { ok: true, roles: [
    { name: "admin", label: "Administrator", features: ["cfo", "overview", "approvals", "collections", "upload", "o2o", "qinv", "pnl", "close", "recon"], manage_users: true },
    { name: "finance", label: "Finance", features: ["overview", "approvals", "upload", "qinv", "pnl", "close", "recon"], manage_users: false },
    { name: "viewer", label: "Viewer", features: ["overview", "pnl"], manage_users: false },
  ] },
  companies_list: { ok: true, companies: COMPANIES },
  users_list: { ok: true,
    users: [
      { id: "u1", email: "boss@ctg.test", name: "BOSS", role: "admin", active: true, totp_enabled: true, last_login_at: "2026-08-18T09:11:00.000Z", last_login_ip: "203.0.113.7", login_count: 412 },
      { id: "u2", email: "acct@ctg.test", name: "AZLINA BINTI OTHMAN", role: "finance", active: true, totp_enabled: false, last_login_at: "2026-08-15T09:41:00.000Z", last_login_ip: "203.0.113.44", login_count: 88 },
      { id: "u3", email: "audit@ctg.test", name: "READ ONLY", role: "viewer", active: false, totp_enabled: false, last_login_at: null, last_login_ip: null, login_count: 0 },
    ],
    user_companies: [
      { user_id: "u2", tenant_id: CO1, role: "" }, { user_id: "u3", tenant_id: CO2, role: "viewer" },
    ] },

  // ── CTG Access ────────────────────────────────────────────────────────────────────────────────
  ctg_access_list: { ok: true, counts: { ctg_total: 4, linked: 2 },
    orphans: [{ name: "LEFT THE COMPANY", email: "leaver@ctg.test", role: "viewer" }],
    rows: [
      { sub: "ctg-1", name: "BOSS", email: "boss@ctg.test", employee_code: "CTG-001", ctg_active: true, linked: true, portal_active: true, role: "admin" },
      { sub: "ctg-2", name: "AZLINA BINTI OTHMAN", email: "acct@ctg.test", employee_code: "CTG-014", ctg_active: true, linked: true, portal_active: false, role: "finance" },
      { sub: "ctg-3", name: "INTERN", email: "intern@ctg.test", employee_code: "CTG-099", ctg_active: true, linked: false, portal_active: false, role: null },
      { sub: "ctg-4", name: "RESIGNED STAFF", email: "gone@ctg.test", employee_code: "CTG-052", ctg_active: false, linked: false, portal_active: false, role: null },
    ] },

  // ── Pharmacies ────────────────────────────────────────────────────────────────────────────────
  pharmacy_list: { ok: true, pharmacies: [
    { id: 1, code: "PH-001", name: "FARMASI SIHAT SDN BHD", state: "Selangor", city: "Shah Alam", address: "No. 3, Jalan Kristal 1/2", contact: "En. Rahim", phone: "03-5511 2233", email: "sihat@x.test", active: true },
    { id: 2, code: "PH-002", name: "PHARMACY ALPHA", state: "Pinang", city: "Georgetown", address: "12 Lebuh Campbell", contact: "Ms. Tan", phone: "04-226 7788", email: "alpha@x.test", active: true },
    { id: 3, code: "PH-003", name: "KLINIK & FARMASI DESA", state: "Johor", city: "Johor Bahru", address: "", contact: null, phone: null, email: null, active: false },
  ] },

  // ── Compliance calendar ───────────────────────────────────────────────────────────────────────
  compliance_calendar: { ok: true, deadlines: [
    { tenant_id: CO2, tenant_name: "I PROCARE MALAYSIA SDN BHD", label: "Annual Return (SSM)", detail: "lodge via MBRS", due_date: "2026-07-30", kind: "statutory", urgency: "overdue", days_until: -19 },
    { tenant_id: CO1, tenant_name: "SKINDAE SDN BHD", label: "Wholesale licence", detail: "KPDN — renew before expiry", due_date: "2026-08-27", kind: "licence", urgency: "critical", days_until: 9 },
    { tenant_id: CO1, tenant_name: "SKINDAE SDN BHD", label: "CP204 instalment", detail: "", due_date: "2026-09-10", kind: "statutory", urgency: "warning", days_until: 23 },
    { tenant_id: CO2, tenant_name: "I PROCARE MALAYSIA SDN BHD", label: "Office lease — Menara UOA", detail: "3-year term", due_date: "2026-10-31", kind: "lease", urgency: "upcoming", days_until: 74 },
    { tenant_id: CO1, tenant_name: "SKINDAE SDN BHD", label: "Public liability policy", detail: "Allianz General", due_date: "2027-03-31", kind: "insurance", urgency: "distant", days_until: 225 },
  ] },

  // ── CFO Cockpit / Overview trend (same RPC) ───────────────────────────────────────────────────
  group_dashboard: {
    ok: true, scoped_tenant: null, period_months: 12,
    group: { revenue: 2288721.55, expenses: 1978057.10, net_profit: 310664.45, ar_open: 412008.20, ap_open: 233190.75,
             working_capital: 178817.45, ar_overdue: 88420.00, rev_cur: 120904.00, rev_prev: 288112.05 },
    companies: [
      { tenant_id: CO1, tenant_name: "SKINDAE SDN BHD", revenue: 1482300.55, expenses: 1103944.20, net_profit: 378356.35, rev_cur: 82110.00, rev_prev: 190440.20, exp_cur: 61044.00, exp_prev: 142330.10, ar_open: 288400.10, ap_open: 141220.55, working_capital: 147179.55, health: "green" },
      { tenant_id: CO2, tenant_name: "I PROCARE MALAYSIA SDN BHD", revenue: 806421.00, expenses: 874112.90, net_profit: -67691.90, rev_cur: 38794.00, rev_prev: 97671.85, exp_cur: 29843.10, exp_prev: 59787.50, ar_open: 123608.10, ap_open: 91970.20, working_capital: 31637.90, health: "amber" },
    ],
    monthly: [
      { month: "2026-03", revenue: 210433.10, bills: 168220.00 }, { month: "2026-04", revenue: 233910.45, bills: 171004.20 },
      { month: "2026-05", revenue: 198220.00, bills: 180912.75 }, { month: "2026-06", revenue: 265440.90, bills: 191003.30 },
      { month: "2026-07", revenue: 288112.05, bills: 202117.60 }, { month: "2026-08", revenue: 120904.00, bills: 90887.10 },
    ],
    companies_monthly: [
      { tenant_id: CO1, tenant_name: "SKINDAE SDN BHD", series: [
        { month: "2026-03", revenue: 140100.00, bills: 110220.00 }, { month: "2026-04", revenue: 156210.45, bills: 112004.20 },
        { month: "2026-05", revenue: 131220.00, bills: 120912.75 }, { month: "2026-06", revenue: 178440.90, bills: 127003.30 },
        { month: "2026-07", revenue: 190440.20, bills: 142330.10 }, { month: "2026-08", revenue: 82110.00, bills: 61044.00 } ] },
      { tenant_id: CO2, tenant_name: "I PROCARE MALAYSIA SDN BHD", series: [
        { month: "2026-03", revenue: 70333.10, bills: 58000.00 }, { month: "2026-04", revenue: 77700.00, bills: 59000.00 },
        { month: "2026-05", revenue: 67000.00, bills: 60000.00 }, { month: "2026-06", revenue: 87000.00, bills: 64000.00 },
        { month: "2026-07", revenue: 97671.85, bills: 59787.50 }, { month: "2026-08", revenue: 38794.00, bills: 29843.10 } ] },
    ],
    ar_aging: { current: 214880.10, d30: 108708.10, d60: 52000.00, d90: 36420.00 },
    top_customers: [
      { name: "GUARDIAN HEALTH AND BEAUTY SDN BHD", amount: 188400.00 },
      { name: "WATSON'S PERSONAL CARE STORES", amount: 142330.10 },
      { name: "SHOPEE MOBILE MALAYSIA SDN BHD", amount: 81277.45 },
    ],
    alerts: [
      { severity: "high", text: "I PROCARE MALAYSIA SDN BHD is loss-making for a 3rd consecutive month." },
      { severity: "med", text: "RM 88,420.00 of receivables are past due — 21% of the open AR book." },
    ],
  },

  // ── CFO Cockpit · Financial Analytics strip ───────────────────────────────────────────────────
  fin_analytics: {
    ok: true, generated_at: "2026-08-18T09:00:00.000Z", scoped_tenant: null,
    dso_dpo: { group: { dso: 47, dpo: 31, cash_gap: 16 }, companies: [
      { tenant_name: "SKINDAE SDN BHD", dso: 41, dpo: 34 }, { tenant_name: "I PROCARE MALAYSIA SDN BHD", dso: 58, dpo: 26 } ] },
    customer_risk: { totals: { total_ar_open: 412008.20, total_overdue: 88420.00, est_bad_debt: 21105.00 }, customers: [
      { cust: "GUARDIAN HEALTH AND BEAUTY SDN BHD", tenant_name: "SKINDAE SDN BHD", ar_open: 188400.00, overdue: 44200.00, worst_days: 71, provision: 11050.00, risk: 6 },
      { cust: "WATSON'S PERSONAL CARE STORES", tenant_name: "SKINDAE SDN BHD", ar_open: 142330.10, overdue: 30220.00, worst_days: 44, provision: 7555.00, risk: 5 },
      { cust: "KLINIK DESA GROUP", tenant_name: "I PROCARE MALAYSIA SDN BHD", ar_open: 81278.10, overdue: 14000.00, worst_days: 96, provision: 2500.00, risk: 3 } ] },
    intercompany: { total_intercompany_open: 42000, pairs: [
      { creditor: "SKINDAE SDN BHD", debtor: "I PROCARE MALAYSIA SDN BHD", creditor_says_owed: 42000, debtor_says_payable: 41500, difference: 500 } ] },
    cashflow_13w: Array.from({ length: 13 }, (_, i) => ({ week: "2026-W" + String(34 + i).padStart(2, "0"), inflow: 30000 + i * 1500, outflow: 24000 + i * 900 })),
    vendor_spend: { total_spend365: 1978057.10, vendors: [
      { vendor: "SHOPEE MOBILE MALAYSIA SDN BHD", spend: 601330.10, ap_open: 88400.00 },
      { vendor: "TENAGA NASIONAL BERHAD", spend: 118440.10, ap_open: 2044.00 },
      { vendor: "UOA DEVELOPMENT BHD", spend: 72000.00, ap_open: 6000.00 } ] },
    revenue_forecast: { excluded: ["2026-08"],
      history: [ { month: "2026-02", revenue: 190220.00 }, { month: "2026-03", revenue: 210433.10 }, { month: "2026-04", revenue: 233910.45 },
                 { month: "2026-05", revenue: 198220.00 }, { month: "2026-06", revenue: 265440.90 }, { month: "2026-07", revenue: 288112.05 } ],
      forecast: [ { month: "2026-09", revenue: 281440.00 }, { month: "2026-10", revenue: 294110.00 }, { month: "2026-11", revenue: 306780.00 } ] },
  },

  // ── Overview lower charts (live Xero P&L) ─────────────────────────────────────────────────────
  pnl_report: { ok: true, from: "2025-09-01", to: "2026-08-31", companies: [
    { tenant_id: CO1, tenant_name: "SKINDAE SDN BHD", revenue_total: 1482300.55, expense_total: 1103944.20, net_profit: 378356.35,
      expenses: [ { name: "Purchases", amount: 601330.10 }, { name: "Staff costs", amount: 244880.00 }, { name: "Marketing", amount: 121004.55 },
                  { name: "Rental", amount: 72000.00 }, { name: "Professional fees", amount: 34220.00 }, { name: "Utilities", amount: 18440.10 },
                  { name: "Travel", amount: 7220.45 }, { name: "Bank charges", amount: 3110.00 }, { name: "Sundry", amount: 1739.00 } ] },
    { tenant_id: CO2, tenant_name: "I PROCARE MALAYSIA SDN BHD", revenue_total: 806421.00, expense_total: 874112.90, net_profit: -67691.90,
      expenses: [ { name: "Purchases", amount: 500112.90 }, { name: "Staff costs", amount: 240000.00 }, { name: "Rental", amount: 84000.00 },
                  { name: "Utilities", amount: 30000.00 }, { name: "Marketing", amount: 20000.00 } ] },
  ] },

  // ── P&L Analysis ──────────────────────────────────────────────────────────────────────────────
  pnl_analysis: {
    ok: true, scoped_tenant: null, months: ["2026-08", "2026-07", "2026-06", "2026-05", "2026-04", "2026-03"],
    totals: {
      "2026-08": { revenue: 120904.00 }, "2026-07": { revenue: 288112.05 }, "2026-06": { revenue: 265440.90 },
      "2026-05": { revenue: 198220.00 }, "2026-04": { revenue: 233910.45 }, "2026-03": { revenue: 210433.10 },
    },
    rows: [
      { section: "Trading Income", account: "Sales — Retail (O2O)", by_month: mo([70110, 168220, 150440, 110220, 130410, 120433]) },
      { section: "Trading Income", account: "Sales — WebStore (Shopify)", by_month: mo([50794, 119892.05, 115000.90, 88000, 103500.45, 90000.10]) },
      { section: "Cost of Sales", account: "Purchases", by_month: mo([48221.10, 110300, 96220, 70110, 82440, 78990]) },
      { section: "Other Income", account: "Foreign exchange gain", by_month: mo([220.55, 0, 1180.00, 0, 0, 340.20]) },
      { section: "Operating Expenses", block: "STAFF", account: "Salaries & wages", by_month: mo([24880, 24880, 24880, 23400, 23400, 23400]) },
      { section: "Operating Expenses", block: "STAFF", account: "EPF — employer", by_month: mo([3235.40, 3235.40, 3235.40, 3042.00, 3042.00, 3042.00]) },
      { section: "Operating Expenses", block: "BD&M", account: "Marketing — Meta", by_month: mo([9110.45, 18220.00, 16440.10, 12000, 14220, 11080]) },
      { section: "Operating Expenses", block: "G&A", account: "Rental of premises", by_month: mo([6000, 6000, 6000, 6000, 6000, 6000]) },
      { section: "Operating Expenses", block: "G&A", account: "Utilities", by_month: mo([1533.35, 1620.10, 1480.00, 1390.75, 1402.20, 1440.00]) },
      { section: "Operating Expenses", block: "FIN", account: "Bank charges", by_month: mo([311.00, 288.10, 302.80, 260.00, 274.00, 268.00]) },
      { section: "Operating Expenses", block: "OTHER", account: "Sundry expenses", by_month: mo([0, 0, 0, 0, 0, 0]) },
    ],
  },

  // ── AP Inbox ──────────────────────────────────────────────────────────────────────────────────
  ap_settings_get: { ok: true, settings: [
    { tenant_id: CO1, tenant_name: "SKINDAE SDN BHD", routing_slug: "skindae", max_auto_post_amount: 1000, auto_post_when_compliant: true,
      auto_reply_when_rejected: true, require_4item_reimbursement: true, require_known_vendor_for_autopost: true, ai_provider: "anthropic", duplicate_check_days: 90, enabled: true },
    { tenant_id: CO2, tenant_name: "I PROCARE MALAYSIA SDN BHD", routing_slug: "iprocare", max_auto_post_amount: 99999999, auto_post_when_compliant: false,
      auto_reply_when_rejected: true, require_4item_reimbursement: false, require_known_vendor_for_autopost: false, ai_provider: "openai", duplicate_check_days: 30, enabled: false },
  ] },
  ap_inbox_list: { ok: true, items: [
    { id: 101, tenant_id: CO1, tenant_name: "SKINDAE SDN BHD", status: "auto_posted", received_at: "2026-08-17T02:14:00.000Z",
      from_name: "TENAGA NASIONAL BERHAD", from_email: "ebill@tnb.com.my", subject: "Electricity bill for August 2026",
      attachments: [{ name: "tnb-aug.pdf" }], ai_verdict: { doc_type: "invoice", total: 2044.00 } },
    { id: 102, tenant_id: CO1, tenant_name: "SKINDAE SDN BHD", status: "needs_review", received_at: "2026-08-17T06:41:00.000Z",
      from_name: "SITI NURHALIZA", from_email: "siti@ctg.test", subject: "Reimbursement — client entertainment",
      attachments: [{ name: "form.pdf" }, { name: "receipt.jpg" }], ai_verdict: { doc_type: "reimbursement", total: 388.50 } },
    { id: 103, tenant_id: CO2, tenant_name: "I PROCARE MALAYSIA SDN BHD", status: "duplicate_rejected_replied", received_at: "2026-08-16T23:02:00.000Z",
      from_name: "GRAB HOLDINGS", from_email: "billing@grab.com", subject: "Your July statement", attachments: [], ai_verdict: { doc_type: "invoice", total: 640.30 } },
    { id: 104, tenant_id: CO2, tenant_name: "I PROCARE MALAYSIA SDN BHD", status: "compliance_rejected", received_at: "2026-08-16T10:00:00.000Z",
      from_name: null, from_email: "noreply@unknown.test", subject: "", attachments: [], ai_verdict: null },
  ] },

  // ── Withholding tax ───────────────────────────────────────────────────────────────────────────
  wht_config: { ok: true,
    entities: [ { tenant_id: CO1, name: "SKINDAE SDN BHD", tax_no: "C58427907080" }, { tenant_id: CO2, name: "I PROCARE MALAYSIA SDN BHD", tax_no: "C11223344550" } ],
    payees: [
      { id: 1, name: "OPENAI OPCO, LLC", tin: "C57831485010", country: "UNITED STATES", wht_rate: 0.10, statutory_rate: 0.10, wht_type: "royalty", treaty_relief: false, has_cor: false },
      { id: 2, name: "META PLATFORMS IRELAND LIMITED", tin: "C29806901060", country: "IRELAND", wht_rate: 0.08, statutory_rate: 0.10, wht_type: "royalty", treaty_relief: true, has_cor: false },
      { id: 3, name: "SINGAPORE DESIGN STUDIO PTE LTD", tin: "C90011223340", country: "SINGAPORE", wht_rate: 0.08, statutory_rate: 0.10, wht_type: "s4a_special", treaty_relief: true, has_cor: true },
    ] },
  wht_list: { ok: true, summaries: [
    { id: 1, tenant_id: CO1, doc_no: "WHT-202607-0001", payee_name: "OPENAI OPCO, LLC", payee_country: "UNITED STATES", wht_rate: 0.10, basis: "gross",
      period_label: "July 2026", fee_total: 3726.82, status: "filed", sst_rate: 0.08, penalty_pct: 0.10, penalty_on: false },
    { id: 2, tenant_id: CO1, doc_no: "WHT-202608-0002", payee_name: "META PLATFORMS IRELAND LIMITED", payee_country: "IRELAND", wht_rate: 0.08, basis: "net",
      period_label: "August 2026", fee_total: 920.00, status: "draft", sst_rate: 0.08, penalty_pct: 0.10, penalty_on: true },
  ] },

  // ── Personal (self-billed) invoices ───────────────────────────────────────────────────────────
  individuals_list: { ok: true, individuals: [
    { id: 1, name: "LIM WEI JIE", id_type: "ic", id_no: "900101-14-5501", tin: "IG12345678901", bank_name: "Maybank", bank_account: "162011223344", default_payment_type: "commission" },
    { id: 2, name: "NURUL AIN BINTI HASSAN", id_type: "ic", id_no: "950612-08-6622", tin: "IG98765432109", bank_name: "CIMB", bank_account: "8001234567", default_payment_type: "service" },
  ] },
  sbi_list: { ok: true, invoices: [
    { id: 11, tenant_id: CO1, invoice_no: "SBI-2026-0007", payee_name: "LIM WEI JIE", invoice_date: "2026-08-05", gross_amount: 5000, wht_amount: 100, net_payable: 4900, status: "approved", xero_bill_id: "xb-1" },
    { id: 12, tenant_id: CO2, invoice_no: "SBI-2026-0008", payee_name: "NURUL AIN BINTI HASSAN", invoice_date: "2026-08-12", gross_amount: 1800, wht_amount: 0, net_payable: 1800, status: "draft", xero_bill_id: null },
  ] },

  // ── Company Info — the 652-line screen, so it gets a full record ──────────────────────────────
  company_info_get: { ok: true, editable: true, companies: [
    { tenant_id: CO1, tenant_name: "SKINDAE SDN BHD",
      legal_name: "SKINDAE SDN BHD", trade_name: "Skindae", ssm_new: "201801012345", ssm_old: "1234567-X",
      incorporation_date: "2018-04-12", business_type: "Wholesale of cosmetics and toiletries", msic_code: "46494",
      reg_address: "Unit 12-3, Menara UOA Bangsar, 5 Jalan Bangsar Utama 1", reg_postcode: "59000", reg_city: "Kuala Lumpur", reg_state: "Kuala Lumpur",
      biz_address: "Lot 88, Jalan Perindustrian Bukit Serdang 5", biz_postcode: "43300", biz_city: "Seri Kembangan", biz_state: "Selangor",
      phone: "+603-2201 5566", email: "admin@skindae.test", website: "https://skindae.test",
      income_tax_no: "C 58427907080", sst_no: "B16-1808-31000123", myinvois_tin: "C58427907080",
      epf_no: "13579246", socso_no: "C58427907", eis_no: "C58427907", hrdc_no: "HRD-2019-00881",
      authorised_capital: 400000, paid_up_capital: 100000, financial_year_end: "12-31",
      company_secretary: "TAN MEI LING", secretary_firm: "MLT Corporate Services Sdn Bhd", auditor: "Wong & Partners PLT",
      annual_return_due: "2027-05-12", agm_date: "2026-06-28", audit_submission_due: "2026-09-30", tax_return_due: "2027-07-31", sst_return_period: "Bi-monthly",
      notes: "SST registered since Sep 2018. MyInvois phase 2 go-live 1 Jan 2026.",
      directors: [ { name: "CALLUM YEW", ic: "880202-10-5533", role: "Managing Director", appointed_on: "2018-04-12" },
                   { name: "TAN MEI LING", ic: "910714-14-6070", role: "Director", appointed_on: "2020-01-06" } ],
      shareholders: [ { name: "CALLUM YEW", ic_or_no: "880202-10-5533", shares: 70000, percent: 70 },
                      { name: "CTG HOLDINGS SDN BHD", ic_or_no: "201501099887", shares: 30000, percent: 30 } ],
      bank_accounts: [ { bank: "Malayan Banking Berhad", account_no: "512011223344", account_name: "SKINDAE SDN BHD", branch: "Bangsar", purpose: "Operating" },
                       { bank: "CIMB Bank Berhad", account_no: "8009876543", account_name: "SKINDAE SDN BHD", branch: "Seri Kembangan", purpose: "Payroll" } ],
      licences: [ { name: "Wholesale & Retail Trade licence", authority: "KPDN", license_no: "WRT-2018-004412", valid_from: "2018-05-01", valid_to: "2026-08-27" } ],
      key_contacts: [ { name: "AZLINA BINTI OTHMAN", position: "Finance Executive", phone: "+6012-333 4455", email: "acct@ctg.test" } ],
      group_structure: [ { relationship: "Holding company", name: "CTG HOLDINGS SDN BHD", shareholding_pct: 30, notes: "" } ],
      insurance_policies: [ { insurer: "Allianz General Insurance", policy_no: "PL-2025-778812", type: "Public liability", sum_insured: 1000000, expiry: "2027-03-31" } ],
      leases: [ { address: "Unit 12-3, Menara UOA Bangsar", landlord: "UOA Development Bhd", monthly_rent: 6000, contract_start: "2024-11-01", expiry: "2027-10-31" } ] },
    { tenant_id: CO2, tenant_name: "I PROCARE MALAYSIA SDN BHD",
      legal_name: "I PROCARE MALAYSIA SDN BHD", trade_name: "iProcare", ssm_new: "202001033445", ssm_old: "",
      incorporation_date: "2020-09-01", business_type: "Retail sale of pharmaceutical goods", msic_code: "47721",
      reg_address: "No. 7, Jalan Molek 1/5", reg_postcode: "81100", reg_city: "Johor Bahru", reg_state: "Johor",
      biz_address: "", biz_postcode: "", biz_city: "", biz_state: "",
      phone: "+607-351 7788", email: "admin@iprocare.test", website: "",
      income_tax_no: "C 11223344550", sst_no: "", myinvois_tin: "C11223344550",
      epf_no: "24681357", socso_no: "C11223344", eis_no: "", hrdc_no: "",
      authorised_capital: 100000, paid_up_capital: 50000, financial_year_end: "12-31",
      company_secretary: "TAN MEI LING", secretary_firm: "MLT Corporate Services Sdn Bhd", auditor: "",
      annual_return_due: "2027-03-01", agm_date: "", audit_submission_due: "", tax_return_due: "", sst_return_period: "",
      notes: "", directors: [ { name: "CALLUM YEW", ic: "880202-10-5533", role: "Director", appointed_on: "2020-09-01" } ],
      shareholders: [ { name: "CALLUM YEW", ic_or_no: "880202-10-5533", shares: 50000, percent: 100 } ],
      bank_accounts: [], licences: [], key_contacts: [], group_structure: [],
      insurance_policies: [], leases: [ { address: "No. 7, Jalan Molek 1/5", landlord: "Molek Properties", monthly_rent: 7000, contract_start: "2023-11-01", expiry: "2026-10-31" } ] },
  ] },
  company_doc_list: { ok: true, documents: [
    { id: "d1", tenant_id: CO1, folder_id: null, name: "SSM Superform 2018.pdf", category: "SSM / Registration", mime: "application/pdf", size: 284410, uploaded_at: "2025-02-03T04:00:00.000Z", uploaded_by: "BOSS" },
    { id: "d2", tenant_id: CO1, folder_id: "f1", name: "Form 24 — share allotment.pdf", category: "SSM / Registration", mime: "application/pdf", size: 90112, uploaded_at: "2025-02-03T04:05:00.000Z", uploaded_by: "BOSS" },
    { id: "d3", tenant_id: CO1, folder_id: "f2", name: "Tenancy agreement 2024-2027.pdf", category: "Lease", mime: "application/pdf", size: 1240880, uploaded_at: "2025-06-11T02:20:00.000Z", uploaded_by: "AZLINA BINTI OTHMAN" },
    { id: "d4", tenant_id: CO2, folder_id: null, name: "SST exemption letter.jpg", category: "Tax", mime: "image/jpeg", size: 402118, uploaded_at: "2026-01-19T08:30:00.000Z", uploaded_by: "BOSS" },
  ] },
  company_folder_list: { ok: true, folders: [
    { id: "f1", tenant_id: CO1, parent_id: null, name: "Statutory" },
    { id: "f2", tenant_id: CO1, parent_id: null, name: "Contracts" },
    { id: "f3", tenant_id: CO1, parent_id: "f2", name: "Leases" },
  ] },
};

/** by_month for a P&L row: six months of amounts, newest first, matched to `pnl_analysis.months`. */
function mo(amts: number[]): Record<string, { amount: number }> {
  const months = ["2026-08", "2026-07", "2026-06", "2026-05", "2026-04", "2026-03"];
  const out: Record<string, { amount: number }> = {};
  months.forEach((m, i) => { out[m] = { amount: amts[i] }; });
  return out;
}

// ═══ HR OS ══════════════════════════════════════════════════════════════════════════════════════

export const HR_TENANT = CO2;

const RATES = {
  eis: { eeRate: 0.002, erRate: 0.002, ceiling: 6000 },
  epf: { eeRate: 0.11, eeSenior: 0, erSenior: 0.04, erRateLow: 0.13, threshold: 5000, erRateHigh: 0.12 },
  socso: { eeRate: 0.005, erRate: 0.0175, ceiling: 6000, erRate2: 0.0125 },
};

const EMPLOYEES = [
  { id: "e1", tenant_id: CO2, emp_no: "E001", name: "AHMAD BIN ISMAIL", dept: "Operations", position: "Senior Executive",
    employment_type: "Full-time", pay_type: "monthly", basic_salary: 5200, fixed_allowance: 400, status: "active",
    date_of_birth: "1990-03-14", date_joined: "2021-02-01", citizen_status: "citizen", marital_status: "married", num_children: 2,
    resident: true, epf_eligible: true, socso_eligible: true, eis_eligible: true, lindung24: false,
    ic_no: "900314-10-5533", email: "ahmad@ctg.test", bank_code: "MAYBANK", bank_name: "Malayan Banking Berhad (Maybank)",
    bank_account: "162011223344", bank_holder: "AHMAD BIN ISMAIL", claim_role: "manager", manager_id: null, user_id: "u9" },
  { id: "e2", tenant_id: CO2, emp_no: "E002", name: "SITI NURHALIZA BINTI OMAR", dept: "Sales", position: "Sales Executive",
    employment_type: "Full-time", pay_type: "monthly", basic_salary: 3400, fixed_allowance: 250, status: "active",
    date_of_birth: "1996-07-22", date_joined: "2023-09-11", citizen_status: "citizen", marital_status: "single", num_children: 0,
    resident: true, epf_eligible: true, socso_eligible: true, eis_eligible: true, lindung24: true,
    ic_no: "960722-14-6622", email: "siti@ctg.test", bank_code: "CIMB", bank_name: "CIMB Bank Berhad",
    bank_account: "8001234567", bank_holder: "SITI NURHALIZA BINTI OMAR", claim_role: "staff", manager_id: "e1", user_id: null },
  { id: "e3", tenant_id: CO2, emp_no: "E003", name: "RAJESH A/L KUMAR", dept: "Warehouse", position: "Customer Service",
    employment_type: "Part-time", pay_type: "hourly", basic_salary: 0, hourly_rate: 12.5, fixed_allowance: 0, status: "active",
    date_of_birth: "2001-11-05", date_joined: "2025-06-02", citizen_status: "citizen", marital_status: "single", num_children: 0,
    resident: true, epf_eligible: true, socso_eligible: true, eis_eligible: true, lindung24: false,
    ic_no: "011105-08-5511", email: "rajesh@ctg.test", bank_code: "PUBLIC BANK", bank_name: "Public Bank Berhad",
    bank_account: "3199887766", bank_holder: "RAJESH A/L KUMAR", claim_role: "staff", manager_id: "e1", user_id: null,
    shift_start: "09:00", shift_end: "18:00" },
  { id: "e4", tenant_id: CO2, emp_no: "E004", name: "LEE MEI FONG", dept: "Sales", position: "Senior Sales Advisor",
    employment_type: "Full-time", pay_type: "monthly", basic_salary: 6800, fixed_allowance: 600, status: "resigned",
    date_of_birth: "1988-01-30", date_joined: "2019-04-15", date_resigned: "2026-07-31", citizen_status: "citizen",
    marital_status: "married", num_children: 1, resident: true, epf_eligible: true, socso_eligible: true, eis_eligible: true,
    lindung24: false, ic_no: "880130-07-5070", email: "meifong@ctg.test", bank_code: "RHB", bank_name: "RHB Bank Berhad",
    bank_account: "21440099887", bank_holder: "LEE MEI FONG", claim_role: "staff", manager_id: "e1", user_id: null },
];

const EMPLOYER = {
  tenant_id: CO2, name: "I PROCARE MALAYSIA SDN BHD", reg_no: "202001033445", employer_no: "E 1122334455",
  address: "No. 7, Jalan Molek 1/5, 81100 Johor Bahru, Johor", phone: "+607-351 7788", email: "hr@iprocare.test",
  epf_no: "24681357", socso_no: "C11223344", lhdn_no: "C11223344550", hrdf: true,
};

const trend6 = (vals: number[]) => vals.map((v, i) => ({ label: ["Mar", "Apr", "May", "Jun", "Jul", "Aug"][i], month: i + 3, value: v }));

Object.assign(FIXTURES, {
  hr_bootstrap: {
    ok: true, employees: EMPLOYEES, employer: EMPLOYER, rates: RATES,
    banks: [ { code: "MAYBANK", name: "Malayan Banking Berhad (Maybank)", active: true },
             { code: "CIMB", name: "CIMB Bank Berhad", active: true },
             { code: "PUBLIC BANK", name: "Public Bank Berhad", active: true },
             { code: "RHB", name: "RHB Bank Berhad", active: true } ],
    leaveTypes: [ { id: "lt1", code: "AL", name: "Annual leave", paid: true, default_days: 14 },
                  { id: "lt2", code: "MC", name: "Medical leave", paid: true, default_days: 14 },
                  { id: "lt3", code: "UP", name: "Unpaid leave", paid: false, default_days: 0 } ],
    leaves: [
      { id: "lv1", employee_id: "e2", leave_type_id: "lt1", date_from: "2026-08-24", date_to: "2026-08-26", days: 3, status: "Pending", reason: "Family trip", employee: { name: "SITI NURHALIZA BINTI OMAR", dept: "Sales" } },
      { id: "lv2", employee_id: "e1", leave_type_id: "lt2", date_from: "2026-08-04", date_to: "2026-08-04", days: 1, status: "Approved", reason: "Fever", employee: { name: "AHMAD BIN ISMAIL", dept: "Operations" } },
    ],
    claims: [
      { id: "cl1", employee_id: "e2", category: "Travel", amount: 128.40, claim_date: "2026-08-09", note: "Grab to client meeting", status: "Pending", employee: { name: "SITI NURHALIZA BINTI OMAR", dept: "Sales" } },
      { id: "cl2", employee_id: "e1", category: "Meals", amount: 88.00, claim_date: "2026-08-02", note: "", status: "Approved", employee: { name: "AHMAD BIN ISMAIL", dept: "Operations" } },
      { id: "cl3", employee_id: "e3", category: "Parking", amount: 12.00, claim_date: "2026-07-28", note: "Site visit", status: "Rejected", employee: { name: "RAJESH A/L KUMAR", dept: "Warehouse" } },
    ],
  },

  hr_banks_list: { ok: true, banks: [
    { code: "MAYBANK", name: "Malayan Banking Berhad (Maybank)", active: true },
    { code: "CIMB", name: "CIMB Bank Berhad", active: true },
    { code: "PUBLIC BANK", name: "Public Bank Berhad", active: true },
  ] },

  hr_payroll_data: {
    ok: true, rates: RATES, run: null, payslips: [], leaveBalances: {}, ytd: {},
    employees: EMPLOYEES.filter((e) => e.status === "active"),
    attendance: { e3: { hours: 96.5, days: 12 } },
    adjustments: [
      { id: "a1", employee_id: "e2", kind: "bonus", amount: 500, period_month: 8, period_year: 2026, note: "Q2 incentive" },
      { id: "a2", employee_id: "e1", kind: "deduction", amount: 150, period_month: 8, period_year: 2026, note: "Salary advance" },
    ],
  },

  hr_dashboard: { ok: true, month: 8, year: 2026, data: {
    period: { label: "August 2026", month: 8, year: 2026 },
    overview: { total_employees: 4, active_employees: 3, new_hires: 0, resigned: 1, gross: 16050, net: 13884.15,
                employer_statutory: 2249.10, total_hr_cost: 18299.10, attendance_rate: 94.2, late_rate: 8.1,
                absenteeism_rate: 3.4, ot_cost: 480 },
    headcount: { total: 4, active: 3, inactive: 1, new_hires: 0, resigned: 1,
      trend: trend6([4, 4, 4, 5, 5, 4]),
      by_dept: [ { label: "Sales", value: 2 }, { label: "Operations", value: 1 }, { label: "Warehouse", value: 1 } ],
      by_position: [ { label: "Sales Executive", value: 1 }, { label: "Senior Sales Advisor", value: 1 }, { label: "Senior Executive", value: 1 }, { label: "Customer Service", value: 1 } ],
      by_type: [ { label: "Full-time", value: 3 }, { label: "Part-time", value: 1 } ] },
    payroll: { gross: 16050, net: 13884.15, basic: 14806.25, allowance: 650, claim: 216.40, bonus: 500,
      epf_ee: 946, epf_er: 1117.30, socso_ee: 80.25, socso_er: 280.88, eis_ee: 32.10, eis_er: 32.10, pcb: 305.50,
      variance: { pct: -4.2, delta: -703.10 },
      trend: [ { label: "Mar", gross: 17200, net: 14620 }, { label: "Apr", gross: 17200, net: 14620 },
               { label: "May", gross: 17400, net: 14780 }, { label: "Jun", gross: 17400, net: 14780 },
               { label: "Jul", gross: 16753.10, net: 14310.20 }, { label: "Aug", gross: 16050, net: 13884.15 } ],
      by_dept: [ { label: "Sales", cost: 9420.55 }, { label: "Operations", cost: 6640.10 }, { label: "Warehouse", cost: 2238.45 } ],
      by_employee: [ { label: "AHMAD BIN ISMAIL", gross: 5600, net: 4820.10, cost: 6412.30 },
                     { label: "SITI NURHALIZA BINTI OMAR", gross: 4150, net: 3701.55, cost: 4740.20 },
                     { label: "RAJESH A/L KUMAR", gross: 1206.25, net: 1180.50, cost: 1274.40 } ] },
    attendance: { attendance_rate: 94.2, late_rate: 8.1, absenteeism_rate: 3.4, missing_clock: 2, ot_hours: 24, ot_cost: 480,
      trend: trend6([96.1, 95.4, 93.8, 94.9, 95.2, 94.2]),
      by_dept: [ { label: "Operations", value: 97.0 }, { label: "Sales", value: 94.4 }, { label: "Warehouse", value: 90.1 } ],
      late_rank: [ { label: "RAJESH A/L KUMAR", value: 4 }, { label: "SITI NURHALIZA BINTI OMAR", value: 1 } ],
      absence_rank: [ { label: "RAJESH A/L KUMAR", value: 2 } ] },
    cost: { total_hr_cost: 18299.10, salary_cost: 15456.25, epf_er: 1117.30, socso_er: 280.88, eis_er: 32.10,
      claim_cost: 216.40, ot_cost: 480, cost_per_employee: 6099.70, variance: { pct: -3.9, delta: -742.00 },
      trend: trend6([19420, 19420, 19640, 19640, 19041.10, 18299.10]),
      by_dept: [ { label: "Sales", value: 9420.55 }, { label: "Operations", value: 6640.10 }, { label: "Warehouse", value: 2238.45 } ],
      by_employee: [ { label: "AHMAD BIN ISMAIL", value: 6412.30 }, { label: "SITI NURHALIZA BINTI OMAR", value: 4740.20 },
                     { label: "RAJESH A/L KUMAR", value: 1274.40 } ] },
    insights: [
      { title: "Warehouse attendance below 91%", severity: "medium", description: "Warehouse ran at 90.1% against a 94.2% company average this month.",
        suggested_action: "Check the two missing clock records before finalising payroll." },
      { title: "Headcount down one", severity: "low", description: "LEE MEI FONG resigned on 31 July 2026 and has not been replaced.",
        suggested_action: "Confirm whether the Sales headcount is being backfilled." },
    ],
  } },

  attendance_list: { ok: true,
    summary: [
      { employee_id: "e3", name: "RAJESH A/L KUMAR", emp_no: "E003", pay_type: "hourly", hours: 96.5, days: 12, est_pay: 1206.25, open: 1 },
      { employee_id: "e2", name: "SITI NURHALIZA BINTI OMAR", emp_no: "E002", pay_type: "monthly", hours: 152, days: 19, est_pay: null, open: 0 },
    ],
    punches: [
      { id: "p1", employee_id: "e3", work_date: "2026-08-17", clock_in: "2026-08-17T01:02:00.000Z", clock_out: "2026-08-17T10:04:00.000Z", hours: 9.03, source: "web", hr_employees: { name: "RAJESH A/L KUMAR" } },
      { id: "p2", employee_id: "e3", work_date: "2026-08-18", clock_in: "2026-08-18T01:10:00.000Z", clock_out: null, hours: null, source: "mobile", hr_employees: { name: "RAJESH A/L KUMAR" } },
      { id: "p3", employee_id: "e2", work_date: "2026-08-17", clock_in: "2026-08-17T00:58:00.000Z", clock_out: "2026-08-17T10:01:00.000Z", hours: 9.05, source: "web", hr_employees: { name: "SITI NURHALIZA BINTI OMAR" } },
    ] },

  clock_status: { ok: true,
    employee: { id: "e3", name: "RAJESH A/L KUMAR", pay_type: "hourly", hourly_rate: 12.5, shift_start: "09:00:00", shift_end: "18:00:00", employment_type: "Part-time", work_days: [1, 2, 3, 4, 5] },
    open: { id: "p2", work_date: "2026-08-18", clock_in: "2026-08-18T01:10:00.000Z" }, stale_open: false,
    week_hours: 27.11,
    today: [ { id: "p2", clock_in: "2026-08-18T01:10:00.000Z", clock_out: null, hours: null } ],
    month: { hours: 96.5, days: 12, est_pay: 1206.25 } },

  hr_leave_admin: { ok: true,
    requests: [
      { id: "lv1", employee_id: "e2", leave_type_id: "lt1", date_from: "2026-08-24", date_to: "2026-08-26", days: 3, status: "pending",
        reason: "Family trip", hr_employees: { name: "SITI NURHALIZA BINTI OMAR", emp_no: "E002", dept: "Sales" },
        steps: [ { id: "s1", step_order: 1, name: "Manager", status: "pending", assignee_name: "AHMAD BIN ISMAIL", decided_by_name: null } ] },
      { id: "lv2", employee_id: "e1", leave_type_id: "lt2", date_from: "2026-08-04", date_to: "2026-08-04", days: 1, status: "approved",
        reason: "Fever", hr_employees: { name: "AHMAD BIN ISMAIL", emp_no: "E001", dept: "Operations" },
        steps: [ { id: "s2", step_order: 1, name: "HR", status: "approved", assignee_name: "BOSS", decided_by_name: "BOSS", decided_at: "2026-08-04T02:00:00.000Z" } ] },
    ],
    flow: [ { name: "Manager", approver_type: "manager", approver_role: null, approver_employee_id: null },
            { name: "HR", approver_type: "role", approver_role: "hr_admin", approver_employee_id: null } ],
    employees: EMPLOYEES.filter((e) => e.status === "active").map((e) => ({ id: e.id, name: e.name, emp_no: e.emp_no })),
    leave_types: [ { id: "lt1", code: "AL", name: "Annual leave", paid: true, default_days: 14 },
                   { id: "lt2", code: "MC", name: "Medical leave", paid: true, default_days: 14 },
                   { id: "lt3", code: "UP", name: "Unpaid leave", paid: false, default_days: 0 } ] },

  hr_rc_config: { ok: true,
    me: { isAdmin: true, roles: ["hr_admin"], is_manager: true, employee: EMPLOYEES[0] },
    claim_types: [ { id: "ct1", code: "TRAVEL", name: "Travel & transport", active: true, sort_order: 1, requires_receipt: true, cap_amount: 500 },
                   { id: "ct2", code: "MEAL", name: "Meals & entertainment", active: true, sort_order: 2, requires_receipt: true, cap_amount: 200 },
                   { id: "ct3", code: "MILEAGE", name: "Mileage", active: true, sort_order: 3, requires_receipt: false, cap_amount: null } ],
    mileage_rates: [ { id: "mr1", label: "Car ≤ 1600cc", rate: 0.60, active: true }, { id: "mr2", label: "Motorcycle", rate: 0.30, active: true } ],
    workflows: [ { id: "wf1", name: "Standard", priority: 10, min_amount: 0, max_amount: 1000, active: true },
                 { id: "wf2", name: "High value", priority: 20, min_amount: 1000.01, max_amount: null, active: true } ],
    workflow_steps: [ { id: "ws1", workflow_id: "wf1", step_order: 1, name: "Manager", approver_type: "manager" },
                      { id: "ws2", workflow_id: "wf2", step_order: 1, name: "Manager", approver_type: "manager" },
                      { id: "ws3", workflow_id: "wf2", step_order: 2, name: "Finance", approver_type: "role", approver_role: "finance" } ],
    policy_rules: [ { id: "pr1", claim_type_id: "ct2", rule: "per_claim_cap", value: 200, message: "Meals capped at RM200 per claim" } ],
    role_approvers: [ { id: "ra1", claim_role: "finance", employee_id: "e1" } ],
    employees: EMPLOYEES.filter((e) => e.status === "active").map((e) => ({ id: e.id, emp_no: e.emp_no, name: e.name, dept: e.dept, position: e.position, manager_id: e.manager_id, claim_role: e.claim_role, email: e.email, user_id: e.user_id })),
    cost_centers: [ { id: "cc1", code: "OPS", name: "Operations", active: true, sort_order: 1 }, { id: "cc2", code: "SLS", name: "Sales", active: true, sort_order: 2 } ] },

  hr_rc_list: { ok: true, claims: [
    { id: "rc1", claim_no: "RC-2026-0031", employee_id: "e2", employee_name: "SITI NURHALIZA BINTI OMAR", emp_no: "E002",
      claim_type_name: "Travel & transport", cost_center_code: "SLS", total_amount: 128.40, currency: "MYR",
      status: "pending_approval", submitted_at: "2026-08-09T03:20:00.000Z", claim_date: "2026-08-09",
      current_step_name: "Manager", attachments: 2, description: "Grab to client meeting" },
    { id: "rc2", claim_no: "RC-2026-0030", employee_id: "e1", employee_name: "AHMAD BIN ISMAIL", emp_no: "E001",
      claim_type_name: "Meals & entertainment", cost_center_code: "OPS", total_amount: 88.00, currency: "MYR",
      status: "approved", submitted_at: "2026-08-02T06:00:00.000Z", claim_date: "2026-08-02",
      current_step_name: null, attachments: 1, description: "Client lunch" },
    { id: "rc3", claim_no: "RC-2026-0029", employee_id: "e3", employee_name: "RAJESH A/L KUMAR", emp_no: "E003",
      claim_type_name: "Mileage", cost_center_code: "OPS", total_amount: 42.00, currency: "MYR",
      status: "paid", submitted_at: "2026-07-28T01:00:00.000Z", claim_date: "2026-07-28",
      current_step_name: null, attachments: 0, description: "Site visit — 70 km" },
  ] },

  hr_my_payslips: { ok: true, year: 2026, employer: EMPLOYER,
    payslips: [7, 6, 5].map((m) => ({
      month: m, year: 2026, run_date: "2026-0" + m + "-28",
      p: { gross: 5600, epfEe: 616, epfEr: 728, socsoEe: 28, socsoEr: 98, eisEe: 11.20, eisEr: 11.20, lindung: 0, pcb: 124.70, net: 4820.10, employerCost: 6437.20, _meta: {} },
      d: { bonus: 0, ot: 0, allowance: 400, unpaid: 0, deductions: m === 7 ? [{ label: "Salary advance", amount: 150 }] : [] },
    })),
    leaveBal: [ { type: "Annual leave", code: "AL", entitled: 16, taken: 6, remaining: 10 },
                { type: "Medical leave", code: "MC", entitled: 14, taken: 1, remaining: 13 } ] },

  hr_annual: { ok: true, employer: EMPLOYER, annual: {
    e1: { gross: 67200, epfEe: 7392, epfEr: 8736, socsoEe: 336, socsoEr: 1176, eisEe: 134.40, eisEr: 134.40, lindung: 0, pcb: 1496.40, net: 57841.20, months: 12 },
    e2: { gross: 43800, epfEe: 4818, epfEr: 5694, socsoEe: 219, socsoEr: 766.50, eisEe: 87.60, eisEr: 87.60, lindung: 120, pcb: 0, net: 38555.40, months: 12 },
    e4: { gross: 51800, epfEe: 5698, epfEr: 6734, socsoEe: 259, socsoEr: 906.50, eisEe: 103.60, eisEr: 103.60, lindung: 0, pcb: 890.20, net: 44849.20, months: 7 },
  } },

  hr_users_list: { ok: true, me_id: "u1", admin_count: 2, scoped_tenant: CO2,
    users: [
      { id: "u1", email: "boss@ctg.test", name: "BOSS", role: "admin", self: true, company_count: 2, can_edit: true },
      { id: "u9", email: "ahmad@ctg.test", name: "AHMAD BIN ISMAIL", role: "hr_admin", employee: "AHMAD BIN ISMAIL", company_count: 1, can_edit: true },
      { id: "u8", email: "readonly@ctg.test", name: "AUDIT VIEWER", role: "viewer", company_count: 1, can_edit: true },
    ],
    employee_candidates: [
      { id: "e2", name: "SITI NURHALIZA BINTI OMAR", emp_no: "E002", email: "siti@ctg.test" },
      { id: "e3", name: "RAJESH A/L KUMAR", emp_no: "E003", email: null },
    ] },
});
