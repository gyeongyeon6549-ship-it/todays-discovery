-- TODI personal v1.0 database/auth setup
-- Run once in Supabase SQL Editor.

-- 1) Event ingestion: official-source records that pass the collector quality gate
-- are exposed automatically. The collector itself performs quality scoring/recheck.
create unique index if not exists events_unique_source_record
on public.events (title, start_date, venue_name);

create or replace function public.ingest_event(
  p_secret text,
  p_title text,
  p_event_type text,
  p_organizer_name text,
  p_summary text,
  p_start_date date,
  p_end_date date,
  p_venue_name text,
  p_sido text,
  p_sigungu text,
  p_opening_hours text,
  p_price_text text,
  p_interests text[],
  p_official_url text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_secret <> 'today-discovery-2026' then
    raise exception 'invalid collector secret';
  end if;

  insert into public.events (
    title, event_type, organizer_name, summary, start_date, end_date,
    venue_name, sido, sigungu, opening_hours, price_text, interests,
    official_url, status
  )
  values (
    p_title, p_event_type, p_organizer_name, p_summary, p_start_date, p_end_date,
    p_venue_name, coalesce(p_sido, '서울특별시'), p_sigungu, p_opening_hours,
    p_price_text, coalesce(p_interests, '{}'::text[]), p_official_url, 'approved'
  )
  on conflict (title, start_date, venue_name) do update
  set
    event_type = excluded.event_type,
    organizer_name = excluded.organizer_name,
    summary = excluded.summary,
    end_date = excluded.end_date,
    sido = excluded.sido,
    sigungu = excluded.sigungu,
    opening_hours = excluded.opening_hours,
    price_text = excluded.price_text,
    interests = excluded.interests,
    official_url = excluded.official_url,
    status = 'approved';
end;
$$;

revoke all on function public.ingest_event(text,text,text,text,text,date,date,text,text,text,text,text,text[],text) from public;
grant execute on function public.ingest_event(text,text,text,text,text,date,date,text,text,text,text,text,text[],text) to anon, authenticated;

-- 2) Account-level preferences and aggregated recommendation behavior
create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  interests text[] not null default '{}',
  preferred_gus text[] not null default '{}',
  behavior jsonb not null default '{"types":{},"gus":{},"tags":{}}'::jsonb,
  theme text not null default 'light' check (theme in ('light','dark')),
  updated_at timestamptz not null default now()
);

alter table public.user_profiles enable row level security;

drop policy if exists "profiles_select_own" on public.user_profiles;
create policy "profiles_select_own"
on public.user_profiles for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "profiles_insert_own" on public.user_profiles;
create policy "profiles_insert_own"
on public.user_profiles for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "profiles_update_own" on public.user_profiles;
create policy "profiles_update_own"
on public.user_profiles for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- 3) Cross-device favorites
create table if not exists public.favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id bigint not null,
  created_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

alter table public.favorites enable row level security;

drop policy if exists "favorites_select_own" on public.favorites;
create policy "favorites_select_own"
on public.favorites for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "favorites_insert_own" on public.favorites;
create policy "favorites_insert_own"
on public.favorites for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "favorites_delete_own" on public.favorites;
create policy "favorites_delete_own"
on public.favorites for delete
to authenticated
using (auth.uid() = user_id);

grant select, insert, update on public.user_profiles to authenticated;
grant select, insert, delete on public.favorites to authenticated;

-- Existing public event browsing remains approved-only.
alter table public.events enable row level security;
drop policy if exists "anon_read_approved_events" on public.events;
create policy "anon_read_approved_events"
on public.events for select
to anon, authenticated
using (status = 'approved');

grant select on public.events to anon, authenticated;
