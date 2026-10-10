-- =====================================================================================
-- Digital Legacy Vault: complete Row Level Security review (Sprint 5)
--
-- HOW TO RUN: Supabase SQL Editor, AFTER `npx prisma migrate dev` has applied the
-- audit_logs change. Safe to run as many times as you like: it wipes every policy in
-- the public schema and rebuilds them from scratch.
--
-- THE MODEL
--   * The Express API connects as the `postgres` role (Prisma). That role bypasses RLS,
--     so nothing here can break the API. DO NOT add FORCE ROW LEVEL SECURITY.
--   * `anon` and `authenticated` are the roles Supabase's auto-generated REST/GraphQL API
--     uses with your public anon key. They are the only "direct to the database" path.
--   * For those roles this script enforces, in three layers:
--       1. RLS is enabled on EVERY table (no table is left open).
--       2. Table privileges are revoked, then granted back for SELECT only, and only on
--          the columns each role may see. Secrets (passwordHash, mfaSecret,
--          encryptedContent, storagePath) are never granted to anyone.
--       3. Row policies restrict SELECT to the rows that concern the signed-in user.
--     There are NO insert/update/delete policies: every write goes through the API, where
--     RBAC, the capsule state machine and the audit log live.
--   * auth.uid() must equal users.id for the policies to match. With your own JWT
--     (not Supabase Auth) they simply match nothing, which is the safe default.
-- =====================================================================================

-- 1. Enable RLS on every table ---------------------------------------------------------
alter table users                 enable row level security;
alter table refresh_tokens        enable row level security;
alter table capsules              enable row level security;
alter table capsule_files         enable row level security;
alter table capsule_guarantors    enable row level security;
alter table capsule_beneficiaries enable row level security;
alter table validations           enable row level security;
alter table audit_logs            enable row level security;
alter table notifications         enable row level security;
alter table role_permissions      enable row level security;
alter table capsule_key_shares    enable row level security;

do $$
begin
  if to_regclass('public._prisma_migrations') is not null then
    execute 'alter table public._prisma_migrations enable row level security';
  end if;
end $$;

-- 2. Clean slate: drop EVERY existing policy in the public schema ----------------------
do $$
declare p record;
begin
  for p in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

-- 3. Revoke everything from the API roles, and stop future tables being auto-exposed ----
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- 4. Helper functions --------------------------------------------------------------------
-- Policies on capsules/guarantors/beneficiaries would otherwise reference each other and
-- Postgres would abort with "infinite recursion detected in policy". These SECURITY DEFINER
-- helpers read the join tables without re-triggering RLS. They live in a schema that the
-- Supabase REST API does not expose.
create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.is_testator(cid text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from capsules c where c.id = cid and c."testatorId" = auth.uid()::text)
$$;

create or replace function private.is_guarantor(cid text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from capsule_guarantors g where g."capsuleId" = cid and g."userId" = auth.uid()::text)
$$;

create or replace function private.is_beneficiary(cid text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from capsule_beneficiaries b where b."capsuleId" = cid and b."userId" = auth.uid()::text)
$$;

create or replace function private.is_unlocked(cid text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from capsules c where c.id = cid and c.state::text in ('UNLOCKED', 'ARCHIVED'))
$$;

revoke all on function private.is_testator(text), private.is_guarantor(text),
                       private.is_beneficiary(text), private.is_unlocked(text) from public;
grant execute on function private.is_testator(text), private.is_guarantor(text),
                          private.is_beneficiary(text), private.is_unlocked(text) to authenticated;

-- 5. Read access, column by column ---------------------------------------------------------
-- users: only your own row; never passwordHash or mfaSecret.
grant select (id, email, "fullName", "mfaEnabled", role, "publicKey", "publicKeyUpdatedAt", "lastLoginAt", "lastSeenAt", "createdAt", "updatedAt")
  on users to authenticated;
create policy users_select_self on users for select to authenticated
  using (id = auth.uid()::text);

-- refresh_tokens and capsule_key_shares: no grants and no policy = unreachable from the REST API.
-- (capsule_key_shares only holds passphrases sealed to a recipient's device key; they are served by the API only.)

-- capsules: status fields only. encryptedContent is NEVER granted: the content is only
-- served by the API, which checks the state (UNLOCKED/ARCHIVED), the role and the permission
-- matrix, and writes an audit entry for every access.
grant select (id, "testatorId", title, type, state, "inactivityThresholdDays", "graceWindowDays",
              "validationThreshold", "validationsReceived", "lastActivityCheckAt", "alertSentAt",
              "graceWindowExpiresAt", "unlockedAt", "archivedAt", "revokedAt", "createdAt", "updatedAt")
  on capsules to authenticated;
create policy capsules_select_testator    on capsules for select to authenticated using ("testatorId" = auth.uid()::text);
create policy capsules_select_guarantor   on capsules for select to authenticated using (private.is_guarantor(id));
create policy capsules_select_beneficiary on capsules for select to authenticated using (private.is_beneficiary(id));

-- capsule_files: the owner always; a beneficiary only once the capsule is unlocked;
-- a guarantor never. storagePath is not granted.
grant select (id, "capsuleId", "fileName", "mimeType", "sizeBytes", "createdAt") on capsule_files to authenticated;
create policy files_select on capsule_files for select to authenticated
  using (private.is_testator("capsuleId") or (private.is_beneficiary("capsuleId") and private.is_unlocked("capsuleId")));

-- capsule_guarantors / capsule_beneficiaries: your own membership rows, or the whole list if you own the capsule.
grant select on capsule_guarantors, capsule_beneficiaries to authenticated;
create policy guarantors_select on capsule_guarantors for select to authenticated
  using ("userId" = auth.uid()::text or private.is_testator("capsuleId"));
create policy beneficiaries_select on capsule_beneficiaries for select to authenticated
  using ("userId" = auth.uid()::text or private.is_testator("capsuleId"));

-- validations (RM6: one vote per guarantor per capsule is the unique constraint, not a policy).
grant select on validations to authenticated;
create policy validations_select on validations for select to authenticated
  using ("guarantorId" = auth.uid()::text or private.is_testator("capsuleId"));

-- audit_logs: the actions you performed, plus the full trail of capsules you own.
grant select (id, seq, "userId", "capsuleId", action, metadata, "prevHash", hash, "createdAt")
  on audit_logs to authenticated;
create policy audit_select on audit_logs for select to authenticated
  using ("userId" = auth.uid()::text or ("capsuleId" is not null and private.is_testator("capsuleId")));

-- notifications: your own.
grant select on notifications to authenticated;
create policy notifications_select on notifications for select to authenticated
  using ("userId" = auth.uid()::text);

-- role_permissions: readable by signed-in users (it's configuration, not data). Writes: API only.
grant select on role_permissions to authenticated;
create policy permissions_select on role_permissions for select to authenticated using (true);

-- 6. Audit log is append-only (tamper evidence) ---------------------------------------------
-- Blocks UPDATE, DELETE and TRUNCATE for EVERY role, including the API's. Combined with the
-- hash chain, nothing can be changed or removed after the fact without it showing.
create or replace function public.audit_logs_block_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_logs is append-only: % is not allowed', tg_op using errcode = '42501';
end $$;

drop trigger if exists audit_logs_no_update_delete on audit_logs;
create trigger audit_logs_no_update_delete before update or delete on audit_logs
  for each row execute function public.audit_logs_block_mutation();

drop trigger if exists audit_logs_no_truncate on audit_logs;
create trigger audit_logs_no_truncate before truncate on audit_logs
  for each statement execute function public.audit_logs_block_mutation();

-- 7. Storage ------------------------------------------------------------------------------------
-- The `capsule-files` bucket is private and should have NO policies on storage.objects:
-- only the API (service role key) touches it, via short-lived signed URLs.
-- Check with:  select policyname, cmd from pg_policies where schemaname = 'storage';
-- and delete any policy that mentions capsule-files in Dashboard > Storage > Policies.
