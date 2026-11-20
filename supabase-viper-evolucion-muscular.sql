-- VIPER Evolucion muscular: migracion aditiva.
-- No modifica tablas existentes ni concede XP. Ejecutar en Supabase SQL Editor.
-- Los registros de evolucion son privados: cada usuario solo puede ver y editar los suyos.

create table if not exists public.viper_workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_date date not null default (now() at time zone 'America/Lima')::date,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists viper_workout_sessions_user_date_idx
  on public.viper_workout_sessions(user_id, session_date desc);

create table if not exists public.viper_workout_exercises (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.viper_workout_sessions(id) on delete cascade,
  muscle_group text not null check (muscle_group in
    ('pecho','espalda','hombros','biceps','triceps','antebrazos','abdomen','cuadriceps','isquiotibiales','gluteos','pantorrillas')),
  exercise_name text not null check (char_length(trim(exercise_name)) between 1 and 100),
  created_at timestamptz not null default now()
);
create index if not exists viper_workout_exercises_session_idx
  on public.viper_workout_exercises(session_id, muscle_group);

create table if not exists public.viper_workout_sets (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid not null references public.viper_workout_exercises(id) on delete cascade,
  set_number smallint not null check (set_number between 1 and 30),
  reps smallint not null check (reps between 1 and 300),
  weight_kg numeric(7,2) not null default 0 check (weight_kg between 0 and 1500),
  created_at timestamptz not null default now(),
  unique(exercise_id, set_number)
);
create index if not exists viper_workout_sets_exercise_idx
  on public.viper_workout_sets(exercise_id);

create table if not exists public.viper_body_measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  measured_on date not null default (now() at time zone 'America/Lima')::date,
  weight_kg numeric(6,2) check (weight_kg between 20 and 500),
  chest_cm numeric(6,2) check (chest_cm between 20 and 250),
  waist_cm numeric(6,2) check (waist_cm between 20 and 250),
  hips_cm numeric(6,2) check (hips_cm between 20 and 250),
  neck_cm numeric(6,2) check (neck_cm between 10 and 100),
  left_arm_cm numeric(6,2) check (left_arm_cm between 10 and 100),
  right_arm_cm numeric(6,2) check (right_arm_cm between 10 and 100),
  left_forearm_cm numeric(6,2) check (left_forearm_cm between 10 and 80),
  right_forearm_cm numeric(6,2) check (right_forearm_cm between 10 and 80),
  left_thigh_cm numeric(6,2) check (left_thigh_cm between 20 and 150),
  right_thigh_cm numeric(6,2) check (right_thigh_cm between 20 and 150),
  left_calf_cm numeric(6,2) check (left_calf_cm between 15 and 100),
  right_calf_cm numeric(6,2) check (right_calf_cm between 15 and 100),
  notes text,
  created_at timestamptz not null default now(),
  unique(user_id, measured_on)
);
create index if not exists viper_body_measurements_user_date_idx
  on public.viper_body_measurements(user_id, measured_on desc);

create table if not exists public.viper_progress_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  photo_date date not null default (now() at time zone 'America/Lima')::date,
  pose text not null check (pose in ('frente','lado','espalda')),
  storage_path text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists viper_progress_photos_user_date_idx
  on public.viper_progress_photos(user_id, photo_date desc);

alter table public.viper_workout_sessions enable row level security;
alter table public.viper_workout_exercises enable row level security;
alter table public.viper_workout_sets enable row level security;
alter table public.viper_body_measurements enable row level security;
alter table public.viper_progress_photos enable row level security;

drop policy if exists viper_workout_sessions_owner on public.viper_workout_sessions;
create policy viper_workout_sessions_owner on public.viper_workout_sessions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists viper_workout_exercises_owner on public.viper_workout_exercises;
create policy viper_workout_exercises_owner on public.viper_workout_exercises
  for all to authenticated using (
    exists (select 1 from public.viper_workout_sessions s
      where s.id = session_id and s.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.viper_workout_sessions s
      where s.id = session_id and s.user_id = auth.uid())
  );

drop policy if exists viper_workout_sets_owner on public.viper_workout_sets;
create policy viper_workout_sets_owner on public.viper_workout_sets
  for all to authenticated using (
    exists (
      select 1 from public.viper_workout_exercises e
      join public.viper_workout_sessions s on s.id = e.session_id
      where e.id = exercise_id and s.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.viper_workout_exercises e
      join public.viper_workout_sessions s on s.id = e.session_id
      where e.id = exercise_id and s.user_id = auth.uid()
    )
  );

drop policy if exists viper_body_measurements_owner on public.viper_body_measurements;
create policy viper_body_measurements_owner on public.viper_body_measurements
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists viper_progress_photos_owner on public.viper_progress_photos;
create policy viper_progress_photos_owner on public.viper_progress_photos
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('viper-progress','viper-progress',false,10485760,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists viper_progress_photos_insert_owner on storage.objects;
create policy viper_progress_photos_insert_owner on storage.objects
  for insert to authenticated with check (
    bucket_id = 'viper-progress' and (storage.foldername(name))[1] = auth.uid()::text
  );
drop policy if exists viper_progress_photos_select_owner on storage.objects;
create policy viper_progress_photos_select_owner on storage.objects
  for select to authenticated using (
    bucket_id = 'viper-progress' and (storage.foldername(name))[1] = auth.uid()::text
  );
drop policy if exists viper_progress_photos_update_owner on storage.objects;
create policy viper_progress_photos_update_owner on storage.objects
  for update to authenticated using (
    bucket_id = 'viper-progress' and (storage.foldername(name))[1] = auth.uid()::text
  ) with check (
    bucket_id = 'viper-progress' and (storage.foldername(name))[1] = auth.uid()::text
  );
drop policy if exists viper_progress_photos_delete_owner on storage.objects;
create policy viper_progress_photos_delete_owner on storage.objects
  for delete to authenticated using (
    bucket_id = 'viper-progress' and (storage.foldername(name))[1] = auth.uid()::text
  );

grant select, insert, update, delete on public.viper_workout_sessions to authenticated;
grant select, insert, update, delete on public.viper_workout_exercises to authenticated;
grant select, insert, update, delete on public.viper_workout_sets to authenticated;
grant select, insert, update, delete on public.viper_body_measurements to authenticated;
grant select, insert, update, delete on public.viper_progress_photos to authenticated;
