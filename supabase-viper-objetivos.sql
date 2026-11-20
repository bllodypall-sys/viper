-- VIPER: objetivos personales
-- Migracion aditiva. No modifica tablas existentes ni concede XP.

create table if not exists public.viper_training_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 3 and 100),
  metric_type text not null check (metric_type in
    ('exercise_weight','body_weight','body_measurement','weekly_sessions')),
  exercise_name text,
  measurement_key text check (measurement_key is null or measurement_key in
    ('chest_cm','waist_cm','hips_cm','left_arm_cm','right_arm_cm',
     'left_thigh_cm','right_thigh_cm','left_calf_cm','right_calf_cm')),
  muscle_group text,
  start_value numeric(8,2) not null default 0,
  target_value numeric(8,2) not null,
  unit text not null default 'kg' check (char_length(unit) between 1 and 12),
  target_date date,
  status text not null default 'active' check (status in ('active','completed','paused')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (target_value > 0),
  check (metric_type <> 'exercise_weight' or nullif(trim(exercise_name),'') is not null),
  check (metric_type <> 'body_measurement' or measurement_key is not null),
  check (metric_type <> 'weekly_sessions' or target_value between 1 and 14)
);

create index if not exists viper_training_goals_user_status_idx
  on public.viper_training_goals(user_id, status, created_at desc);

alter table public.viper_training_goals enable row level security;

drop policy if exists viper_training_goals_owner on public.viper_training_goals;
create policy viper_training_goals_owner on public.viper_training_goals
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.viper_training_goals to authenticated;
