-- VIPER AI + Community MVP: private AI plans and voluntary weekly challenges.
-- Avoid awarding additional XP for challenges: source of truth remains registrar_dia.
begin;

create table if not exists public.viper_ai_training_plans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  goal text not null default '',
  training_days integer not null default 3 check (training_days between 1 and 7),
  plan_text text not null check (char_length(plan_text) between 20 and 12000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.viper_ai_training_plans enable row level security;
revoke all on public.viper_ai_training_plans from public, anon;
grant select, insert, update, delete on public.viper_ai_training_plans to authenticated;
create policy viper_ai_plan_owner_select on public.viper_ai_training_plans
  for select to authenticated using ((select auth.uid()) = user_id);
create policy viper_ai_plan_owner_insert on public.viper_ai_training_plans
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy viper_ai_plan_owner_update on public.viper_ai_training_plans
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy viper_ai_plan_owner_delete on public.viper_ai_training_plans
  for delete to authenticated using ((select auth.uid()) = user_id);

create table if not exists public.viper_weekly_challenge_entries (
  user_id uuid not null references auth.users(id) on delete cascade,
  challenge_key text not null check (challenge_key in ('gym_3','xp_150','meals_5')),
  week_start date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, challenge_key, week_start)
);
alter table public.viper_weekly_challenge_entries enable row level security;
revoke all on public.viper_weekly_challenge_entries from public, anon;
grant select, insert, delete on public.viper_weekly_challenge_entries to authenticated;
create policy viper_weekly_own_select on public.viper_weekly_challenge_entries
  for select to authenticated using ((select auth.uid()) = user_id);
create policy viper_weekly_own_insert on public.viper_weekly_challenge_entries
  for insert to authenticated with check ((select auth.uid()) = user_id
     and week_start >= ((now() at time zone 'America/Lima')::date - 7)
     and week_start <= ((now() at time zone 'America/Lima')::date + 7)
     and extract(isodow from week_start) = 1);
create policy viper_weekly_own_delete on public.viper_weekly_challenge_entries
  for delete to authenticated using ((select auth.uid()) = user_id);

-- The view must respect the caller's existing profiles SELECT policy.
alter view public.viper_public_profiles set (security_invoker = true);

-- Trigger/event-trigger functions are not public-facing RPC methods.
revoke execute on function public.crear_perfil() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
revoke execute on function public.viper_notify_friend_workout_trigger() from public, anon, authenticated;
revoke execute on function public.viper_notify_friend_xp_trigger() from public, anon, authenticated;
revoke execute on function public.viper_notify_meal_result_trigger() from public, anon, authenticated;

commit;
