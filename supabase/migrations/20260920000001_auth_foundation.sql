create type public.user_role   as enum ('user', 'admin');
create type public.user_status as enum ('active', 'suspended');

create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) <= 40),
  role         public.user_role   not null default 'user',
  status       public.user_status not null default 'active',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.consents (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  version    text not null,
  marketing  boolean not null default false,
  granted_at timestamptz not null default now()
);
create index consents_user_id_idx on public.consents (user_id);

-- Profile row for every new auth user (anonymous included)
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Admin check, used by RLS now and admin RPCs in P3. Security definer avoids RLS recursion.
create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

alter table public.profiles enable row level security;
alter table public.consents enable row level security;

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Column-level lock: users may only ever write display_name
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (display_name) on public.profiles to authenticated;

create policy consents_select_own on public.consents for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy consents_insert_own on public.consents for insert to authenticated
  with check (user_id = auth.uid());
revoke update, delete on public.consents from anon, authenticated;

-- Under-18 purge: anonymous users only
create function public.purge_self() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from auth.users where id = auth.uid() and is_anonymous = true;
  if not found then
    raise exception 'purge_self is only allowed for anonymous users' using errcode = '42501';
  end if;
end $$;
revoke execute on function public.purge_self() from public, anon;
grant  execute on function public.purge_self() to authenticated;

-- Keep-alive target for the GitHub Action
create function public.ping() returns integer language sql stable as $$ select 1 $$;
grant execute on function public.ping() to anon, authenticated;

-- Nightly 03:00 IST: reap anonymous users idle for 30 days
select cron.schedule(
  'purge-stale-anonymous-users',
  '30 21 * * *',
  $$ delete from auth.users
     where is_anonymous = true
       and coalesce(last_sign_in_at, created_at) < now() - interval '30 days' $$
);
