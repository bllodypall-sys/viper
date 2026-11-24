-- VIPER TRAIN + NUTRI: private nutrition targets and manual foods.
-- Manual foods NEVER grant XP or modify validated meal_entries.
begin;
create table if not exists public.viper_nutrition_targets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  calories_target integer not null check (calories_target between 1200 and 6000),
  protein_target_g integer not null check (protein_target_g between 0 and 350),
  carbs_target_g integer not null check (carbs_target_g between 0 and 800),
  fat_target_g integer not null check (fat_target_g between 0 and 250),
  updated_at timestamptz not null default now()
);
alter table public.viper_nutrition_targets enable row level security;
revoke all on public.viper_nutrition_targets from public,anon;
grant select,insert,update,delete on public.viper_nutrition_targets to authenticated;
drop policy if exists viper_nutrition_targets_owner on public.viper_nutrition_targets;
create policy viper_nutrition_targets_owner on public.viper_nutrition_targets
  for all to authenticated
  using ((select auth.uid())=user_id)
  with check ((select auth.uid())=user_id);

create table if not exists public.viper_manual_foods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  meal_date date not null,
  food_name text not null check (char_length(btrim(food_name)) between 2 and 100),
  calories integer not null check (calories between 0 and 3000),
  protein_g numeric(7,1) not null check (protein_g between 0 and 350),
  carbs_g numeric(7,1) not null check (carbs_g between 0 and 800),
  fat_g numeric(7,1) not null check (fat_g between 0 and 250),
  created_at timestamptz not null default now()
);
create index if not exists viper_manual_foods_user_date_idx
  on public.viper_manual_foods(user_id,meal_date desc);
alter table public.viper_manual_foods enable row level security;
revoke all on public.viper_manual_foods from public,anon;
grant select,insert,update,delete on public.viper_manual_foods to authenticated;
drop policy if exists viper_manual_foods_owner on public.viper_manual_foods;
create policy viper_manual_foods_owner on public.viper_manual_foods
  for all to authenticated
  using ((select auth.uid())=user_id)
  with check ((select auth.uid())=user_id);
commit;
