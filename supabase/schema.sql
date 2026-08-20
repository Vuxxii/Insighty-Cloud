-- Insightyyy Cloud — Supabase schema
-- Run once in the Supabase SQL editor (Dashboard → SQL → New query → paste → Run).
-- Everything content-bearing is CIPHERTEXT: the server can never read insights,
-- source tags, or project names. Plaintext is limited to what sync/uniqueness needs:
-- uuids, ref_id numbers, prefixes, timestamps and flags.

-- ============ Account key material (E2E envelope) ============
create table if not exists public.user_keys (
  user_id uuid primary key references auth.users (id) on delete cascade,
  kdf_iterations integer not null,
  auth_salt text not null,
  enc_salt text not null,
  wrapped_mk jsonb not null,           -- {iv, data} AES-GCM under password-derived KEK
  recovery_salt text not null,
  wrapped_mk_recovery jsonb not null,  -- {iv, data} AES-GCM under recovery-key KEK
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_keys enable row level security;

create policy "own keys" on public.user_keys
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Login needs the salts BEFORE authentication (to derive the auth hash), so a
-- SECURITY DEFINER function exposes salts + kdf params by email — and nothing else.
-- (Emails are already usable as login identifiers; this leaks no new information
-- beyond account existence, equivalent to any login form.)
create or replace function public.get_login_params(p_email text)
returns table (kdf_iterations integer, auth_salt text)
language sql security definer set search_path = public
as $$
  select k.kdf_iterations, k.auth_salt
  from public.user_keys k
  join auth.users u on u.id = k.user_id
  where lower(u.email) = lower(p_email)
$$;

-- ============ Projects ============
create table if not exists public.projects (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  prefix text not null,
  name_enc jsonb not null,             -- {iv, data} encrypted project name
  next_seq integer not null default 1, -- next UNRESERVED ref number (block allocator)
  created_at timestamptz not null,
  updated_at timestamptz not null,
  archived_at timestamptz
);

alter table public.projects enable row level security;
create policy "own projects" on public.projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists projects_user on public.projects (user_id);

-- ============ Insights (opaque ciphertext rows) ============
create table if not exists public.insights (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  ref_id integer not null,
  content_enc jsonb not null,          -- {iv, data}: source_tag + direction + blocks (images inlined)
  timestamp timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  purged boolean not null default false,
  unique (project_id, ref_id)          -- D1: a number exists at most once, forever
);

alter table public.insights enable row level security;
create policy "own insights" on public.insights
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists insights_user_updated on public.insights (user_id, updated_at);
create index if not exists insights_project on public.insights (project_id);

-- ============ Reserved ID blocks ============
-- Atomic: two devices calling concurrently can never receive overlapping ranges,
-- so offline ref collisions are IMPOSSIBLE by construction (PRD D1: gaps are fine).
create table if not exists public.seq_blocks (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  device_id text not null,
  block_start integer not null,
  block_size integer not null,
  reserved_at timestamptz not null default now()
);

alter table public.seq_blocks enable row level security;
create policy "own blocks" on public.seq_blocks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.reserve_block(
  p_project_id uuid,
  p_device_id text,
  p_size integer default 100
) returns table (block_start integer, block_size integer)
language plpgsql security definer set search_path = public
as $$
declare
  v_start integer;
begin
  if p_size < 1 or p_size > 1000 then
    raise exception 'invalid block size';
  end if;
  -- Row lock makes the read-increment atomic under concurrency.
  update public.projects
     set next_seq = next_seq + p_size,
         updated_at = now()
   where id = p_project_id and user_id = auth.uid()
   returning next_seq - p_size into v_start;
  if v_start is null then
    raise exception 'project not found or not yours';
  end if;
  insert into public.seq_blocks (user_id, project_id, device_id, block_start, block_size)
  values (auth.uid(), p_project_id, p_device_id, v_start, p_size);
  return query select v_start, p_size;
end;
$$;

-- ============ updated_at hygiene ============
create or replace function public.touch_user_keys()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_keys_touch on public.user_keys;
create trigger user_keys_touch before update on public.user_keys
  for each row execute function public.touch_user_keys();
