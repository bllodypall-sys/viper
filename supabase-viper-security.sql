-- VIPER: Centro de seguridad, historial de cuenta y reportes de errores.
-- Migración aditiva: no modifica tablas ni funciones existentes.
create table if not exists public.viper_account_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('login','password_changed','global_signout')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists viper_account_activity_user_created_idx
  on public.viper_account_activity(user_id, created_at desc);
alter table public.viper_account_activity enable row level security;
grant select, insert on public.viper_account_activity to authenticated;
drop policy if exists "viper_account_activity_read_own" on public.viper_account_activity;
create policy "viper_account_activity_read_own" on public.viper_account_activity
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "viper_account_activity_insert_own" on public.viper_account_activity;
create policy "viper_account_activity_insert_own" on public.viper_account_activity
  for insert to authenticated with check (auth.uid() = user_id);

create table if not exists public.viper_error_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('login','checkin','training','feed','chat','notifications','other')),
  description text not null check (char_length(trim(description)) between 10 and 1500),
  page text not null default '',
  user_agent text not null default '',
  status text not null default 'new' check (status in ('new','reviewing','resolved','closed')),
  created_at timestamptz not null default now()
);
create index if not exists viper_error_reports_user_created_idx
  on public.viper_error_reports(user_id, created_at desc);
alter table public.viper_error_reports enable row level security;
grant select, insert on public.viper_error_reports to authenticated;
drop policy if exists "viper_error_reports_read_own" on public.viper_error_reports;
create policy "viper_error_reports_read_own" on public.viper_error_reports
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "viper_error_reports_insert_own" on public.viper_error_reports;
create policy "viper_error_reports_insert_own" on public.viper_error_reports
  for insert to authenticated with check (auth.uid() = user_id);
