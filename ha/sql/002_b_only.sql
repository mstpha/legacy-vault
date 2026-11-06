-- =====================================================================================
-- Run on project B ONLY, after prisma/rls-policies.sql and 001_ha_schema.sql.
-- (Re-run it whenever you re-run rls-policies.sql on B: that script recreates the function.)
--
-- B is a mirror of A's tamper-evident audit chain. When B served writes during an outage, its
-- outage-era audit entries are re-chained onto A's chain on replay (new seq / prevHash / hash), and
-- the mirror must then be overwritten with A's authoritative version. That needs UPDATE/DELETE on
-- B.audit_logs, which the append-only trigger forbids. This relaxes it for the sync process only
-- (ha.applying = 'on', set inside ha.apply_change). Ordinary API writes on B stay append-only.
--
-- A keeps the strict version from rls-policies.sql: nothing in the HA tooling mutates A's audit log.
-- =====================================================================================

create or replace function public.audit_logs_block_mutation() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('ha.applying', true), '') = 'on' and tg_op in ('UPDATE', 'DELETE') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'audit_logs is append-only: % is not allowed', tg_op using errcode = '42501';
end $$;
