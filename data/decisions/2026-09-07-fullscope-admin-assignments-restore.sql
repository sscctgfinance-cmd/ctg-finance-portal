-- ROLLBACK for the 2026-09-07 change that made the six full-scope admins immune to the company count.
--
-- WHY THE CHANGE. portal_allowed_tenants treats an admin as unrestricted on `v_mine = 0` OR
-- `v_mine >= v_all`. All six full-scope admins held exactly the six companies that existed, so adding
-- CTG4U WELLNESS SDN BHD as the SEVENTH would have made `6 >= 7` false and dropped every one of them
-- into the restricted branch — losing the new company AND the group-wide views (Dashboard,
-- consolidated P&L, CFO Cockpit). CLAUDE.md prescribes granting the new tenant in the same
-- transaction as the insert, but that is impossible on the Xero path: the row is written
-- asynchronously by the OAuth reconnect from Xero's own /connections, so there is always a window in
-- which every admin is demoted. Clearing the explicit assignments closes the window entirely and makes
-- them immune to every FUTURE company addition as well.
--
-- Verified before applying: isFullScopeAdmin() (lib.ts) derives from this same RPC, so zero
-- assignments still reads as full scope everywhere, not just in the tenant filter.
--
-- Snapshot taken 2026-09-07: 36 rows, six admins x six companies, every role NULL (no per-company
-- override was in use). Running this file restores exactly that state.
--
-- One consequence worth knowing before you run it: with zero rows these admins show NO companies
-- ticked on the Users screen. That is correct — ufTenants() sends only ticked rows and the server
-- replaces the whole set, so saving one of these admins from that screen with boxes ticked would
-- restrict them again.

begin;

-- benjaminpoh.wellness@gmail.com
insert into portal_user_companies(user_id,tenant_id,role) values ('53348982-ef98-42a1-bb0c-5070a9adcf74','e27b9c9d-b0ec-4880-b6de-1f6cf8587f24',null);
insert into portal_user_companies(user_id,tenant_id,role) values ('53348982-ef98-42a1-bb0c-5070a9adcf74','99911869-9e91-4572-b7dc-4db51b45b6a9',null);
insert into portal_user_companies(user_id,tenant_id,role) values ('53348982-ef98-42a1-bb0c-5070a9adcf74','8e50bb08-9ae4-4c3f-8d48-b916a2b9cbed',null);
insert into portal_user_companies(user_id,tenant_id,role) values ('53348982-ef98-42a1-bb0c-5070a9adcf74','2054b50c-a776-4d69-aecc-4cca21f34e9a',null);
insert into portal_user_companies(user_id,tenant_id,role) values ('53348982-ef98-42a1-bb0c-5070a9adcf74','6a4194ca-42f4-45ec-a44c-f9c8f01071a7',null);
insert into portal_user_companies(user_id,tenant_id,role) values ('53348982-ef98-42a1-bb0c-5070a9adcf74','ff68569e-8b02-4cca-9f20-602d6a127456',null);

-- bobowpe.ctg@gmail.com
insert into portal_user_companies(user_id,tenant_id,role) values ('fc14710a-db84-400e-92f2-50bb74cae163','e27b9c9d-b0ec-4880-b6de-1f6cf8587f24',null);
insert into portal_user_companies(user_id,tenant_id,role) values ('fc14710a-db84-400e-92f2-50bb74cae163','99911869-9e91-4572-b7dc-4db51b45b6a9',null);
insert into portal_user_companies(user_id,tenant_id,role) values ('fc14710a-db84-400e-92f2-50bb74cae163','8e50bb08-9ae4-4c3f-8d48-b916a2b9cbed',null);
insert into portal_user_companies(user_id,tenant_id,role) values ('fc14710a-db84-400e-92f2-50bb74cae163','2054b50c-a776-4d69-aecc-4cca21f34e9a',null);
insert into portal_user_companies(user_id,tenant_id,role) values ('fc14710a-db84-400e-92f2-50bb74cae163','6a4194ca-42f4-45ec-a44c-f9c8f01071a7',null);
insert into portal_user_companies(user_id,tenant_id,role) values ('fc14710a-db84-400e-92f2-50bb74cae163','ff68569e-8b02-4cca-9f20-602d6a127456',null);

-- darrenteh.wellness@gmail.com
insert into portal_user_companies(user_id,tenant_id,role) values ('31706d29-2072-4310-8f8c-c95c65ecb642','e27b9c9d-b0ec-4880-b6de-1f6cf8587f24',null);
insert into portal_user_companies(user_id,tenant_id,role) values ('31706d29-2072-4310-8f8c-c95c65ecb642','99911869-9e91-4572-b7dc-4db51b45b6a9',null);
insert into portal_user_companies(user_id,tenant_id,role) values ('31706d29-2072-4310-8f8c-c95c65ecb642','8e50bb08-9ae4-4c3f-8d48-b916a2b9cbed',null);
insert into portal_user_companies(user_id,tenant_id,role) values ('31706d29-2072-4310-8f8c-c95c65ecb642','2054b50c-a776-4d69-aecc-4cca21f34e9a',null);
insert into portal_user_companies(user_id,tenant_id,role) values ('31706d29-2072-4310-8f8c-c95c65ecb642','6a4194ca-42f4-45ec-a44c-f9c8f01071a7',null);
insert into portal_user_companies(user_id,tenant_id,role) values ('31706d29-2072-4310-8f8c-c95c65ecb642','ff68569e-8b02-4cca-9f20-602d6a127456',null);

-- leesiuchong85@gmail.com
insert into portal_user_companies(user_id,tenant_id,role) values ('fcd788c6-dea7-4805-9e61-bdc66eab608e','e27b9c9d-b0ec-4880-b6de-1f6cf8587f24',null);
insert into portal_user_companies(user_id,tenant_id,role) values ('fcd788c6-dea7-4805-9e61-bdc66eab608e','99911869-9e91-4572-b7dc-4db51b45b6a9',null);
insert into portal_user_companies(user_id,tenant_id,role) values ('fcd788c6-dea7-4805-9e61-bdc66eab608e','8e50bb08-9ae4-4c3f-8d48-b916a2b9cbed',null);
insert into portal_user_companies(user_id,tenant_id,role) values ('fcd788c6-dea7-4805-9e61-bdc66eab608e','2054b50c-a776-4d69-aecc-4cca21f34e9a',null);
insert into portal_user_companies(user_id,tenant_id,role) values ('fcd788c6-dea7-4805-9e61-bdc66eab608e','6a4194ca-42f4-45ec-a44c-f9c8f01071a7',null);
insert into portal_user_companies(user_id,tenant_id,role) values ('fcd788c6-dea7-4805-9e61-bdc66eab608e','ff68569e-8b02-4cca-9f20-602d6a127456',null);

-- ssc.ctgfinance@gmail.com
insert into portal_user_companies(user_id,tenant_id,role) values ('03e41802-4914-47ba-9aeb-1f2f9cab7a08','e27b9c9d-b0ec-4880-b6de-1f6cf8587f24',null);
insert into portal_user_companies(user_id,tenant_id,role) values ('03e41802-4914-47ba-9aeb-1f2f9cab7a08','99911869-9e91-4572-b7dc-4db51b45b6a9',null);
insert into portal_user_companies(user_id,tenant_id,role) values ('03e41802-4914-47ba-9aeb-1f2f9cab7a08','8e50bb08-9ae4-4c3f-8d48-b916a2b9cbed',null);
insert into portal_user_companies(user_id,tenant_id,role) values ('03e41802-4914-47ba-9aeb-1f2f9cab7a08','2054b50c-a776-4d69-aecc-4cca21f34e9a',null);
insert into portal_user_companies(user_id,tenant_id,role) values ('03e41802-4914-47ba-9aeb-1f2f9cab7a08','6a4194ca-42f4-45ec-a44c-f9c8f01071a7',null);
insert into portal_user_companies(user_id,tenant_id,role) values ('03e41802-4914-47ba-9aeb-1f2f9cab7a08','ff68569e-8b02-4cca-9f20-602d6a127456',null);

-- zhenghong.theadspert@gmail.com
insert into portal_user_companies(user_id,tenant_id,role) values ('89bea378-1ca3-47de-975c-2719e7f7df81','e27b9c9d-b0ec-4880-b6de-1f6cf8587f24',null);
insert into portal_user_companies(user_id,tenant_id,role) values ('89bea378-1ca3-47de-975c-2719e7f7df81','99911869-9e91-4572-b7dc-4db51b45b6a9',null);
insert into portal_user_companies(user_id,tenant_id,role) values ('89bea378-1ca3-47de-975c-2719e7f7df81','8e50bb08-9ae4-4c3f-8d48-b916a2b9cbed',null);
insert into portal_user_companies(user_id,tenant_id,role) values ('89bea378-1ca3-47de-975c-2719e7f7df81','2054b50c-a776-4d69-aecc-4cca21f34e9a',null);
insert into portal_user_companies(user_id,tenant_id,role) values ('89bea378-1ca3-47de-975c-2719e7f7df81','6a4194ca-42f4-45ec-a44c-f9c8f01071a7',null);
insert into portal_user_companies(user_id,tenant_id,role) values ('89bea378-1ca3-47de-975c-2719e7f7df81','ff68569e-8b02-4cca-9f20-602d6a127456',null);

commit;
