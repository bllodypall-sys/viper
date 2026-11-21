-- VIPER: perfil inicial de atleta. Migración aditiva; no modifica tablas existentes.
create table if not exists public.viper_onboarding_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  country text not null check (char_length(trim(country)) between 2 and 80),
  age smallint not null check (age between 13 and 100),
  goal text not null check (goal in ('muscle_gain','fat_loss','strength','endurance','general_fitness','boxing','other')),
  experience text not null check (experience in ('beginner','under_6_months','6_12_months','1_2_years','over_2_years')),
  training_days smallint not null check (training_days between 1 and 7),
  training_type text not null check (training_type in ('gym','home','boxing','mixed')),
  height_cm numeric(5,1) null check (height_cm is null or height_cm between 100 and 250),
  weight_kg numeric(5,1) null check (weight_kg is null or weight_kg between 25 and 350),
  priority_muscle text null check (priority_muscle is null or priority_muscle in ('chest','back','shoulders','arms','legs','glutes','abs','full_body')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists viper_onboarding_profiles_country_idx on public.viper_onboarding_profiles(country);
alter table public.viper_onboarding_profiles enable row level security;
grant select, insert, update on public.viper_onboarding_profiles to authenticated;
drop policy if exists "viper_onboarding_select_own" on public.viper_onboarding_profiles;
create policy "viper_onboarding_select_own" on public.viper_onboarding_profiles for select to authenticated using (auth.uid() = user_id);
drop policy if exists "viper_onboarding_insert_own" on public.viper_onboarding_profiles;
create policy "viper_onboarding_insert_own" on public.viper_onboarding_profiles for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "viper_onboarding_update_own" on public.viper_onboarding_profiles;
create policy "viper_onboarding_update_own" on public.viper_onboarding_profiles for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
