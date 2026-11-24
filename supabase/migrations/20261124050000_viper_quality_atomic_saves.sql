-- VIPER QUALITY: idempotent, all-or-nothing workout saves and private error monitoring.
-- Existing workout rows and XP rules are untouched.
begin;

alter table public.viper_workout_sessions
  add column if not exists client_request_id uuid;
create unique index if not exists viper_workout_sessions_user_request_unique
  on public.viper_workout_sessions(user_id,client_request_id)
  where client_request_id is not null;

create or replace function public.viper_save_workout_v2(
  p_client_request_id uuid,
  p_session_date date,
  p_notes text,
  p_exercises jsonb
) returns uuid
language plpgsql volatile security invoker
set search_path = pg_catalog, public
as $fn$
declare
  v_user uuid := (select auth.uid());
  v_session uuid;
  v_exercise uuid;
  v_item jsonb;
  v_set jsonb;
  v_name text;
  v_muscle text;
  v_reps numeric;
  v_weight numeric;
  v_count integer := 0;
  v_number integer;
begin
  if v_user is null then
    raise exception 'Debes iniciar sesión.' using errcode='28000';
  end if;
  if p_client_request_id is null or p_session_date is null then
    raise exception 'Identificador y fecha de sesión obligatorios.' using errcode='22023';
  end if;
  if char_length(coalesce(p_notes,''))>300 then
    raise exception 'Las notas son demasiado largas.' using errcode='22023';
  end if;
  if jsonb_typeof(p_exercises) is distinct from 'array'
     or jsonb_array_length(p_exercises) not between 1 and 12 then
    raise exception 'La sesión debe incluir entre 1 y 12 ejercicios.' using errcode='22023';
  end if;
  if pg_column_size(p_exercises)>65536 then
    raise exception 'La sesión supera el tamaño permitido.' using errcode='22023';
  end if;

  -- All inserts share one database transaction. Any failure rolls it back.
  -- Conflict handling makes retries after lost network responses idempotent.
  insert into public.viper_workout_sessions
    (user_id,session_date,notes,client_request_id)
  values (v_user,p_session_date,nullif(btrim(p_notes),''),p_client_request_id)
  on conflict (user_id,client_request_id)
    where client_request_id is not null
  do nothing
  returning id into v_session;

  if v_session is null then
    select s.id into v_session
    from public.viper_workout_sessions s
    where s.user_id=v_user and s.client_request_id=p_client_request_id;
    if v_session is null then
      raise exception 'No se pudo verificar la sesión anterior.' using errcode='40001';
    end if;
    return v_session;
  end if;

  for v_item in select value from jsonb_array_elements(p_exercises) loop
    if jsonb_typeof(v_item) is distinct from 'object' then
      raise exception 'Formato de ejercicio no válido.' using errcode='22023';
    end if;
    v_name=btrim(coalesce(v_item->>'name',''));
    v_muscle=v_item->>'muscle';
    if char_length(v_name) not between 1 and 100 or
       v_muscle not in ('pecho','espalda','hombros','biceps','triceps',
         'antebrazos','abdomen','cuadriceps','isquiotibiales','gluteos','pantorrillas')
    then
      raise exception 'Nombre o grupo muscular no válido.' using errcode='22023';
    end if;
    if jsonb_typeof(v_item->'sets') is distinct from 'array' or
       jsonb_array_length(v_item->'sets') not between 1 and 30 then
      raise exception 'Un ejercicio requiere entre 1 y 30 series.' using errcode='22023';
    end if;

    insert into public.viper_workout_exercises
      (session_id,muscle_group,exercise_name)
    values (v_session,v_muscle,v_name)
    returning id into v_exercise;

    v_number=0;
    for v_set in select value from jsonb_array_elements(v_item->'sets') loop
      if jsonb_typeof(v_set) is distinct from 'object' or
         jsonb_typeof(v_set->'reps') is distinct from 'number' or
         jsonb_typeof(v_set->'weight_kg') is distinct from 'number' then
        raise exception 'La serie debe tener repeticiones y peso numéricos.' using errcode='22023';
      end if;
      v_reps=(v_set->>'reps')::numeric;
      v_weight=(v_set->>'weight_kg')::numeric;
      if v_reps<1 or v_reps>300 or v_reps<>trunc(v_reps) or
         v_weight<0 or v_weight>1500 then
        raise exception 'Revisa repeticiones y peso de cada serie.' using errcode='22023';
      end if;
      v_number=v_number+1;
      insert into public.viper_workout_sets
        (exercise_id,set_number,reps,weight_kg)
      values (v_exercise,v_number,v_reps::smallint,v_weight);
    end loop;
    v_count=v_count+1;
  end loop;
  return v_session;
end;
$fn$;

revoke all on function public.viper_save_workout_v2(uuid,date,text,jsonb) from public,anon;
grant execute on function public.viper_save_workout_v2(uuid,date,text,jsonb) to authenticated;

create table if not exists public.viper_client_errors(
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('runtime','promise','workout','nutrition','report')),
  error_type text not null check (error_type ~ '^[A-Za-z]{1,40}$'),
  release_tag text not null check (char_length(release_tag) between 1 and 40),
  created_at timestamptz not null default now()
);
create index if not exists viper_client_errors_created_at_idx
  on public.viper_client_errors(created_at desc);
alter table public.viper_client_errors enable row level security;
revoke all on public.viper_client_errors from public,anon,authenticated;
grant insert on public.viper_client_errors to authenticated;
-- INSERT only: authenticated users cannot list other people's errors.
drop policy if exists viper_client_errors_insert_own on public.viper_client_errors;
create policy viper_client_errors_insert_own on public.viper_client_errors
  for insert to authenticated
  with check ((select auth.uid())=user_id);

commit;