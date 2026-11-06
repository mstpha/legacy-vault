-- =====================================================================================
-- Legacy Vault HA: change capture, outbox, LWW apply, idempotency keys, sync audit.
--
-- Run on BOTH Supabase projects (A and B), AFTER the Prisma migrations, then run
--   select ha.set_node('A');   -- on project A
--   select ha.set_node('B');   -- on project B
-- and, on B only, 002_b_only.sql.
--
-- Everything lives in a separate `ha` schema: Prisma migrate only diffs `public`, so this never
-- shows up as drift, and the Supabase REST API does not expose it.
--
-- Idempotent: safe to re-run.
-- =====================================================================================

create schema if not exists ha;
revoke all on schema ha from public, anon, authenticated;

-- ---- Node identity -------------------------------------------------------------------
create table if not exists ha.settings (
  key   text primary key,
  value text not null
);

create or replace function ha.node_name() returns text
language sql stable as $$
  select coalesce((select value from ha.settings where key = 'node'), 'unknown')
$$;

create or replace function ha.set_node(p_name text) returns void
language sql as $$
  insert into ha.settings(key, value) values ('node', p_name)
  on conflict (key) do update set value = excluded.value
$$;

-- ---- Change log / outbox ----------------------------------------------------------------
-- On A this is the A -> B stream. On B it is the outbox journaled while the backup is B_ACTIVE.
-- `status` doubles as the checkpoint: the worker leases pending rows (FOR UPDATE SKIP LOCKED),
-- applies them to the other project, and only then marks them. A crash in between just means the
-- rows are applied again, which is harmless because apply is last-write-wins and idempotent.
create table if not exists ha.change_log (
  id          bigserial primary key,
  schema_name text        not null,
  table_name  text        not null,
  op          text        not null check (op in ('INSERT', 'UPDATE', 'DELETE')),
  row_id      text        not null,
  payload     jsonb       not null,           -- full NEW row; {id} only for DELETE
  changed_at  timestamptz not null,           -- LWW clock (clock_timestamp() at write time)
  origin      text        not null,           -- node that produced the change
  status      text        not null default 'pending'
              check (status in ('pending', 'applied', 'skipped', 'conflict')),
  attempts    int         not null default 0,
  last_error  text,
  applied_at  timestamptz
);
create index if not exists change_log_pending_idx on ha.change_log (id) where status = 'pending';
create index if not exists change_log_row_idx on ha.change_log (schema_name, table_name, row_id) where status = 'pending';
create index if not exists change_log_applied_idx on ha.change_log (applied_at) where status <> 'pending';

-- ---- Row versions (LWW clock + tombstones) -------------------------------------------------
-- Holds updated_at / deleted_at per row instead of adding columns to the app tables. That way the
-- Prisma schema and every existing query stay unchanged, and a delete leaves a tombstone that
-- outlives the row.
create table if not exists ha.row_versions (
  schema_name text        not null,
  table_name  text        not null,
  row_id      text        not null,
  updated_at  timestamptz not null,           -- time of the last change, deletes included
  deleted_at  timestamptz,                    -- set = tombstone
  origin      text        not null,
  primary key (schema_name, table_name, row_id)
);
create index if not exists row_versions_tombstones_idx on ha.row_versions (deleted_at) where deleted_at is not null;

-- ---- Idempotency keys (part of the sync set) -----------------------------------------------
create table if not exists ha.idempotency_keys (
  id               text        primary key,   -- sha256(scope ':' key)
  scope            text        not null,      -- user id, or 'anon'
  idem_key         text        not null,
  method           text        not null,
  path             text        not null,
  fingerprint      text        not null,      -- sha256(method path body)
  status           text        not null default 'in_progress' check (status in ('in_progress', 'completed')),
  response_status  int,
  response_body    jsonb,
  locked_until     timestamptz not null,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null
);
create index if not exists idempotency_keys_expires_idx on ha.idempotency_keys (expires_at);

-- ---- Sync audit (every fix made by sync-check, every conflict found by the worker) ---------
create table if not exists ha.sync_audit (
  id          bigserial   primary key,
  created_at  timestamptz not null default now(),
  source      text        not null,           -- 'worker' | 'sync-check' | 'router'
  run_id      text,
  schema_name text,
  table_name  text,
  row_id      text,
  action      text        not null,           -- e.g. 'copy_to_B', 'delete_on_A', 'conflict', 'storage_copy'
  detail      jsonb
);
create index if not exists sync_audit_created_idx on ha.sync_audit (created_at);

-- ---- Capture trigger ------------------------------------------------------------------------
-- Loop prevention: the worker / sync-check apply changes inside ha.apply_change(), which sets the
-- transaction-local GUC ha.applying = 'on'. Captured writes therefore never bounce back.
create or replace function ha.capture() returns trigger
language plpgsql as $$
declare
  v_row  jsonb;
  v_id   text;
  v_ts   timestamptz := clock_timestamp();
  v_node text := ha.node_name();
begin
  if coalesce(current_setting('ha.applying', true), '') = 'on' then
    return null;
  end if;

  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
  else
    v_row := to_jsonb(new);
    if tg_op = 'UPDATE' and v_row = to_jsonb(old) then
      return null; -- no-op update (e.g. Prisma rewriting identical values)
    end if;
  end if;
  v_id := v_row ->> 'id';

  insert into ha.change_log (schema_name, table_name, op, row_id, payload, changed_at, origin)
  values (tg_table_schema, tg_table_name, tg_op, v_id,
          case when tg_op = 'DELETE' then jsonb_build_object('id', v_id) else v_row end,
          v_ts, v_node);

  insert into ha.row_versions (schema_name, table_name, row_id, updated_at, deleted_at, origin)
  values (tg_table_schema, tg_table_name, v_id, v_ts, case when tg_op = 'DELETE' then v_ts end, v_node)
  on conflict (schema_name, table_name, row_id) do update
    set updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, origin = excluded.origin;

  return null;
end $$;

-- ---- LWW apply ------------------------------------------------------------------------------
-- Applies one change coming from the other project. Returns 'applied' or 'skipped_older'.
-- Raises on constraint violations (unique email, FK...) so the caller can record a conflict.
create or replace function ha.apply_change(
  p_schema text, p_table text, p_op text, p_row_id text,
  p_payload jsonb, p_changed_at timestamptz, p_origin text
) returns text
language plpgsql as $$
declare
  v_local_ts timestamptz;
  v_rel      regclass := format('%I.%I', p_schema, p_table)::regclass;
  v_cols     text;
  v_set      text;
begin
  perform set_config('ha.applying', 'on', true);

  select updated_at into v_local_ts
  from ha.row_versions
  where schema_name = p_schema and table_name = p_table and row_id = p_row_id;

  -- Last write wins. Equal timestamps re-apply (same change seen twice), which is idempotent.
  if v_local_ts is not null and v_local_ts > p_changed_at then
    return 'skipped_older';
  end if;

  if p_op = 'DELETE' then
    execute format('delete from %s where id = $1', v_rel) using p_row_id;
    insert into ha.row_versions (schema_name, table_name, row_id, updated_at, deleted_at, origin)
    values (p_schema, p_table, p_row_id, p_changed_at, p_changed_at, p_origin)
    on conflict (schema_name, table_name, row_id) do update
      set updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, origin = excluded.origin;
    return 'applied';
  end if;

  -- audit_logs.seq is unique. On B (mirror of A's chain) an outage-era row can hold a seq that A has
  -- since re-assigned to another entry: drop the stale row, A's version is authoritative.
  -- (On A, audit_logs stays strictly append-only and this DELETE would raise; the worker never sends
  -- audit_logs to A through this function, it re-chains them instead.)
  if p_schema = 'public' and p_table = 'audit_logs' and (p_payload ? 'seq') then
    delete from public.audit_logs where seq = (p_payload ->> 'seq')::int and id <> p_row_id;
  end if;

  select string_agg(format('%I', attname), ', ' order by attnum),
         string_agg(format('%I = excluded.%I', attname, attname), ', ' order by attnum)
    into v_cols, v_set
  from pg_attribute
  where attrelid = v_rel and attnum > 0 and not attisdropped;

  execute format(
    'insert into %s (%s) select %s from jsonb_populate_record(null::%s, $1) on conflict (id) do update set %s',
    v_rel, v_cols, v_cols, v_rel, v_set
  ) using p_payload;

  if p_schema = 'public' and p_table = 'audit_logs' then
    perform setval(pg_get_serial_sequence('public.audit_logs', 'seq'),
                   greatest((select max(seq) from public.audit_logs), 1));
  end if;

  insert into ha.row_versions (schema_name, table_name, row_id, updated_at, deleted_at, origin)
  values (p_schema, p_table, p_row_id, p_changed_at, null, p_origin)
  on conflict (schema_name, table_name, row_id) do update
    set updated_at = excluded.updated_at, deleted_at = null, origin = excluded.origin;

  return 'applied';
end $$;

-- Runs a statement without journaling it (housekeeping each project does for itself).
create or replace function ha.exec_unjournaled(p_sql text) returns bigint
language plpgsql as $$
declare v_count bigint;
begin
  perform set_config('ha.applying', 'on', true);
  execute p_sql;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Row checksum used by sync-check (jsonb text is key-sorted, so it is canonical).
create or replace function ha.row_hash(p_row jsonb) returns text
language sql immutable as $$ select md5(p_row::text) $$;

revoke all on all functions in schema ha from public, anon, authenticated;
revoke all on all tables    in schema ha from public, anon, authenticated;

-- ---- Install the capture trigger on every synced table --------------------------------------
-- The sync set. _prisma_migrations is deliberately excluded (schema is migrated on both sides).
do $$
declare
  t text;
  synced text[] := array[
    'public.users', 'public.refresh_tokens', 'public.role_permissions',
    'public.capsules', 'public.capsule_files', 'public.capsule_guarantors',
    'public.capsule_beneficiaries', 'public.capsule_key_shares', 'public.validations',
    'public.notifications', 'public.audit_logs', 'ha.idempotency_keys'
  ];
begin
  foreach t in array synced loop
    execute format('drop trigger if exists ha_capture on %s', t);
    execute format('create trigger ha_capture after insert or update or delete on %s
                    for each row execute function ha.capture()', t);
  end loop;
end $$;
