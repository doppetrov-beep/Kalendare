-- D&D scheduler schema for Supabase (PostgreSQL).
-- Run the full file once in Supabase SQL Editor.
-- Only the project URL and PUBLISHABLE/anon key go into the public website.
-- NEVER expose a service_role key, database password, or API secret.

create schema if not exists dnd_private;
revoke all on schema dnd_private from public;
grant usage on schema dnd_private to authenticated;

create table if not exists public.dnd_rooms (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 70),
  invite_code text not null check (invite_code ~ '^[a-f0-9]{32}$'),
  meeting_minutes integer not null default 180 check (meeting_minutes in (120,180,240)),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.dnd_members (
  room_id uuid not null references public.dnd_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  nickname text not null check (char_length(btrim(nickname)) between 1 and 32),
  timezone text not null check (char_length(timezone) between 1 and 100),
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists public.dnd_windows (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.dnd_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint dnd_window_time_check check (
    end_at > start_at and end_at <= start_at + interval '24 hours'
  ),
  constraint dnd_window_member_fk foreign key (room_id,user_id)
    references public.dnd_members (room_id,user_id) on delete cascade
);

create index if not exists dnd_windows_room_user_idx on public.dnd_windows (room_id,user_id,start_at);
create index if not exists dnd_members_room_idx on public.dnd_members (room_id);

-- SECURITY DEFINER avoids circular RLS checks on membership.
create or replace function dnd_private.is_member(p_room_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.dnd_members
    where room_id = p_room_id and user_id = (select auth.uid())
  );
$$;
revoke all on function dnd_private.is_member(uuid) from public;
grant execute on function dnd_private.is_member(uuid) to authenticated;

alter table public.dnd_rooms enable row level security;
alter table public.dnd_members enable row level security;
alter table public.dnd_windows enable row level security;

-- Members see their own rooms only. Creators can read their newly created
-- rooms before they join them.
drop policy if exists "dnd_rooms_select" on public.dnd_rooms;
create policy "dnd_rooms_select" on public.dnd_rooms for select to authenticated
using (created_by = (select auth.uid()) or dnd_private.is_member(id));

drop policy if exists "dnd_rooms_insert" on public.dnd_rooms;
create policy "dnd_rooms_insert" on public.dnd_rooms for insert to authenticated
with check (created_by = (select auth.uid()));

drop policy if exists "dnd_rooms_update" on public.dnd_rooms;
create policy "dnd_rooms_update" on public.dnd_rooms for update to authenticated
using (created_by = (select auth.uid()))
with check (created_by = (select auth.uid()));

drop policy if exists "dnd_members_select" on public.dnd_members;
create policy "dnd_members_select" on public.dnd_members for select to authenticated
using (dnd_private.is_member(room_id));

drop policy if exists "dnd_members_update" on public.dnd_members;
create policy "dnd_members_update" on public.dnd_members for update to authenticated
using (user_id = (select auth.uid()) and dnd_private.is_member(room_id))
with check (user_id = (select auth.uid()) and dnd_private.is_member(room_id));

drop policy if exists "dnd_windows_select" on public.dnd_windows;
create policy "dnd_windows_select" on public.dnd_windows for select to authenticated
using (dnd_private.is_member(room_id));

drop policy if exists "dnd_windows_insert" on public.dnd_windows;
create policy "dnd_windows_insert" on public.dnd_windows for insert to authenticated
with check (
  user_id = (select auth.uid())
  and dnd_private.is_member(room_id)
  and start_at > now() - interval '30 minutes'
  and start_at < now() + interval '1 year'
);

drop policy if exists "dnd_windows_delete" on public.dnd_windows;
create policy "dnd_windows_delete" on public.dnd_windows for delete to authenticated
using (user_id = (select auth.uid()) and dnd_private.is_member(room_id));

-- Do not grant insert on dnd_members. Joining always validates the secret link.
revoke all on public.dnd_rooms, public.dnd_members, public.dnd_windows from public, anon, authenticated;
grant select, insert on public.dnd_rooms to authenticated;
grant update (title,meeting_minutes) on public.dnd_rooms to authenticated;
grant select on public.dnd_members to authenticated;
grant update (nickname,timezone,updated_at) on public.dnd_members to authenticated;
grant select, insert, delete on public.dnd_windows to authenticated;

-- Room invitation: requires a 128-bit random invite secret, and caps
-- participants at 12. The function runs on the server and never discloses
-- the code in a publicly readable list of rooms.
create or replace function public.join_room(
  p_room_id uuid,
  p_invite_code text,
  p_nickname text,
  p_timezone text
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  current_uid uuid;
begin
  current_uid := (select auth.uid());
  if current_uid is null then
    raise exception 'Войди в комнату как гость.';
  end if;
  if char_length(btrim(coalesce(p_nickname,''))) not between 1 and 32 then
    raise exception 'Ник должен содержать от 1 до 32 символов.';
  end if;
  if char_length(coalesce(p_timezone,'')) not between 1 and 100 then
    raise exception 'Некорректный часовой пояс.';
  end if;
  -- Serialise joins so concurrent visitors cannot bypass the 12-person limit.
  perform 1 from public.dnd_rooms
    where id = p_room_id and invite_code = p_invite_code for update;
  if not found then
    raise exception 'Неправильное приглашение или комната не найдена.';
  end if;
  if not exists (
    select 1 from public.dnd_members where room_id=p_room_id and user_id=current_uid
  ) and (
    select count(*) from public.dnd_members where room_id=p_room_id
  ) >= 12 then
    raise exception 'В комнате уже 12 игроков.';
  end if;
  insert into public.dnd_members(room_id,user_id,nickname,timezone)
  values(p_room_id,current_uid,btrim(p_nickname),p_timezone)
  on conflict(room_id,user_id) do update set
    nickname=excluded.nickname,
    timezone=excluded.timezone,
    updated_at=now();
end;
$$;
revoke all on function public.join_room(uuid,text,text,text) from public, anon;
grant execute on function public.join_room(uuid,text,text,text) to authenticated;

-- Server-side limit per member, so a modified browser cannot fill the DB
-- with unbounded intervals.
create or replace function dnd_private.check_window_limit()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if (select count(*) from public.dnd_windows
      where room_id = new.room_id and user_id = new.user_id) >= 100 then
    raise exception 'Можно сохранить не более 100 интервалов на игрока.';
  end if;
  return new;
end;
$$;
drop trigger if exists dnd_limit_windows on public.dnd_windows;
create trigger dnd_limit_windows before insert on public.dnd_windows
for each row execute function dnd_private.check_window_limit();

-- Extra hardening: remove broad default EXECUTE on private helper.
revoke all on function dnd_private.check_window_limit() from public;
