-- =====================================================================================
-- Digital Legacy Vault: automated checks of the Row Level Security policies (Sprint 6)
--
-- HOW TO RUN: Supabase SQL Editor (or psql as the `postgres` role), AFTER rls-policies.sql.
-- Safe to run on any database: everything happens inside one transaction that is ROLLED BACK
-- at the end, and it only touches rows it creates itself (ids 'rlstest-*').
--
-- Output: one row per check in the "Results" tab: PASS or FAIL. The final statement raises an
-- exception if any check failed, so it also works as a CI gate.
--
-- How it impersonates users: Supabase's auth.uid() reads the JWT claims from the session
-- setting `request.jwt.claims`; `set local role authenticated` then makes Postgres apply RLS
-- exactly as it does for a REST API call made with that user's token.
-- =====================================================================================
begin;

create temp table rls_results(check_name text, passed boolean, detail text) on commit drop;
grant all on rls_results to public;

-- ---- fixtures (inserted as the owner role, which bypasses RLS) --------------------------
insert into users (id, email, "passwordHash", "fullName", "emailVerified", "updatedAt") values
  ('rlstest-alice', 'rlstest-alice@x.test', 'SECRET-HASH-A', 'Alice (testator)',  true, now()),
  ('rlstest-bob',   'rlstest-bob@x.test',   'SECRET-HASH-B', 'Bob (guarantor)',   true, now()),
  ('rlstest-carol', 'rlstest-carol@x.test', 'SECRET-HASH-C', 'Carol (beneficiary)', true, now()),
  ('rlstest-eve',   'rlstest-eve@x.test',   'SECRET-HASH-E', 'Eve (stranger)',    true, now());

insert into capsules (id, "testatorId", title, type, state, "encryptedContent", "updatedAt") values
  ('rlstest-c-locked',   'rlstest-alice', 'locked capsule',   'MESSAGE', 'ACTIVE',   '\xdeadbeef', now()),
  ('rlstest-c-unlocked', 'rlstest-alice', 'unlocked capsule', 'MESSAGE', 'UNLOCKED', '\xdeadbeef', now());

insert into capsule_guarantors (id, "capsuleId", "userId") values
  ('rlstest-g1', 'rlstest-c-locked', 'rlstest-bob'), ('rlstest-g2', 'rlstest-c-unlocked', 'rlstest-bob');
insert into capsule_beneficiaries (id, "capsuleId", "userId") values
  ('rlstest-b1', 'rlstest-c-locked', 'rlstest-carol'), ('rlstest-b2', 'rlstest-c-unlocked', 'rlstest-carol');
insert into capsule_files (id, "capsuleId", "storagePath", "fileName", "mimeType", "sizeBytes") values
  ('rlstest-f-locked',   'rlstest-c-locked',   'secret/path-1', 'a.enc', 'application/pdf', 10),
  ('rlstest-f-unlocked', 'rlstest-c-unlocked', 'secret/path-2', 'b.enc', 'application/pdf', 10);
insert into notifications (id, "userId", type) values
  ('rlstest-n-alice', 'rlstest-alice', 'INACTIVITY_ALERT'), ('rlstest-n-eve', 'rlstest-eve', 'INACTIVITY_ALERT');
insert into audit_logs (id, "userId", "capsuleId", action) values
  ('rlstest-a-alice', 'rlstest-alice', 'rlstest-c-locked', 'CAPSULE_CREATED'),
  ('rlstest-a-eve',   'rlstest-eve',   null,               'USER_LOGGED_IN');

-- ---- helper: run a query as a given user and record whether it behaved as expected -------
-- expected_rows: how many rows the user should see (NULL = expect a permission error instead)
create or replace function pg_temp.as_user(uid text, role_name text, check_name text, q text, expected_rows int)
returns void language plpgsql as $$
declare n int; ok boolean; msg text;
begin
  perform set_config('request.jwt.claims', case when uid is null then '' else json_build_object('sub', uid, 'role', role_name)::text end, true);
  execute format('set local role %I', role_name);
  begin
    execute 'select count(*) from (' || q || ') s' into n;
    ok := expected_rows is not null and n = expected_rows;
    msg := 'rows=' || n || ', expected=' || coalesce(expected_rows::text, 'permission error');
  exception when insufficient_privilege or others then
    ok := expected_rows is null;
    msg := 'error: ' || sqlerrm;
  end;
  execute 'reset role';
  insert into rls_results values (check_name, ok, msg);
end $$;

-- ---- 1. secrets are never readable by API roles (column grants) --------------------------
select pg_temp.as_user('rlstest-alice','authenticated','users.passwordHash is not selectable (own row)',   $q$select "passwordHash" from users$q$, null);
select pg_temp.as_user('rlstest-alice','authenticated','users.mfaSecret is not selectable (own row)',      $q$select "mfaSecret" from users$q$, null);
select pg_temp.as_user('rlstest-alice','authenticated','capsules.encryptedContent is not selectable (owner)', $q$select "encryptedContent" from capsules$q$, null);
select pg_temp.as_user('rlstest-alice','authenticated','capsule_files.storagePath is not selectable (owner)', $q$select "storagePath" from capsule_files$q$, null);
select pg_temp.as_user('rlstest-alice','authenticated','refresh_tokens unreachable',      $q$select * from refresh_tokens$q$, null);
select pg_temp.as_user('rlstest-alice','authenticated','capsule_key_shares unreachable',  $q$select * from capsule_key_shares$q$, null);

-- ---- 2. anonymous callers see nothing --------------------------------------------------------
select pg_temp.as_user(null,'anon','anon cannot read users',    $q$select id from users$q$, null);
select pg_temp.as_user(null,'anon','anon cannot read capsules', $q$select id from capsules$q$, null);
select pg_temp.as_user(null,'anon','anon cannot read audit_logs', $q$select id from audit_logs$q$, null);

-- ---- 3. row visibility per role ------------------------------------------------------------------
select pg_temp.as_user('rlstest-alice','authenticated','testator sees only her own user row', $q$select id from users where id like 'rlstest-%'$q$, 1);
select pg_temp.as_user('rlstest-alice','authenticated','testator sees both of her capsules',  $q$select id from capsules where id like 'rlstest-%'$q$, 2);
select pg_temp.as_user('rlstest-bob','authenticated','guarantor sees the capsules he guarantees (status only)', $q$select id from capsules where id like 'rlstest-%'$q$, 2);
select pg_temp.as_user('rlstest-carol','authenticated','beneficiary sees the capsules she is named on', $q$select id from capsules where id like 'rlstest-%'$q$, 2);
select pg_temp.as_user('rlstest-eve','authenticated','stranger sees NO capsule', $q$select id from capsules where id like 'rlstest-%'$q$, 0);
select pg_temp.as_user('rlstest-eve','authenticated','stranger sees no guarantor rows',  $q$select id from capsule_guarantors where id like 'rlstest-%'$q$, 0);
select pg_temp.as_user('rlstest-eve','authenticated','stranger sees no beneficiary rows',$q$select id from capsule_beneficiaries where id like 'rlstest-%'$q$, 0);
select pg_temp.as_user('rlstest-eve','authenticated','stranger sees only her own user row', $q$select id from users where id like 'rlstest-%'$q$, 1);

-- ---- 4. files: owner always, beneficiary only after unlock, guarantor never ---------------------
select pg_temp.as_user('rlstest-alice','authenticated','owner sees both files', $q$select id from capsule_files where id like 'rlstest-%'$q$, 2);
select pg_temp.as_user('rlstest-carol','authenticated','beneficiary sees ONLY the unlocked capsule''s file', $q$select id from capsule_files where id like 'rlstest-%'$q$, 1);
select pg_temp.as_user('rlstest-bob','authenticated','guarantor never sees files', $q$select id from capsule_files where id like 'rlstest-%'$q$, 0);
select pg_temp.as_user('rlstest-eve','authenticated','stranger never sees files',  $q$select id from capsule_files where id like 'rlstest-%'$q$, 0);

-- ---- 5. notifications and audit are personal ------------------------------------------------------
select pg_temp.as_user('rlstest-alice','authenticated','user sees only her notifications', $q$select id from notifications where id like 'rlstest-%'$q$, 1);
select pg_temp.as_user('rlstest-alice','authenticated','testator sees her actions + the trail of her capsules', $q$select id from audit_logs where id like 'rlstest-%'$q$, 1);
select pg_temp.as_user('rlstest-eve','authenticated','stranger sees only her own audit entry', $q$select id from audit_logs where id like 'rlstest-%'$q$, 1);

-- ---- 6. NO writes through the API roles (every write goes through the Express API) ---------------
select pg_temp.as_user('rlstest-alice','authenticated','cannot UPDATE capsules directly',
  $q$with u as (update capsules set state = 'UNLOCKED' where id = 'rlstest-c-locked' returning 1) select * from u$q$, null);
select pg_temp.as_user('rlstest-eve','authenticated','cannot INSERT a capsule directly',
  $q$with i as (insert into capsules (id,"testatorId",title,type,"updatedAt") values ('rlstest-hack','rlstest-eve','x','MESSAGE',now()) returning 1) select * from i$q$, null);
select pg_temp.as_user('rlstest-bob','authenticated','cannot INSERT a validation (vote) directly',
  $q$with i as (insert into validations (id,"capsuleId","guarantorId") values ('rlstest-v','rlstest-c-locked','rlstest-bob') returning 1) select * from i$q$, null);
select pg_temp.as_user('rlstest-alice','authenticated','cannot grant herself ADMIN',
  $q$with u as (update users set role = 'ADMIN' where id = 'rlstest-alice' returning 1) select * from u$q$, null);

-- ---- 7. audit log is append-only for EVERY role, including the one the API uses -------------------
do $$
declare blocked boolean;
begin
  begin update audit_logs set action = 'TAMPERED' where id = 'rlstest-a-alice'; blocked := false;
  exception when others then blocked := true; end;
  insert into rls_results values ('audit_logs UPDATE is blocked by trigger (owner role)', blocked, '');

  begin delete from audit_logs where id = 'rlstest-a-alice'; blocked := false;
  exception when others then blocked := true; end;
  insert into rls_results values ('audit_logs DELETE is blocked by trigger (owner role)', blocked, '');

  begin truncate audit_logs; blocked := false;
  exception when others then blocked := true; end;
  insert into rls_results values ('audit_logs TRUNCATE is blocked by trigger (owner role)', blocked, '');
end $$;

-- ---- 8. structure: RLS enabled on every table, no leftover permissive grants ------------------------
insert into rls_results
select 'RLS enabled on table ' || c.relname, c.relrowsecurity, ''
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r';

insert into rls_results
select 'no write privilege for API roles on ' || table_name, false, grantee || ' has ' || privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon','authenticated')
  and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');

-- ---- report ---------------------------------------------------------------------------------------------
select case when passed then 'PASS' else 'FAIL' end as result, check_name, detail from rls_results order by passed, check_name;

