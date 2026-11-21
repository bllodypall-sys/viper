-- VIPER security hardening: server-side AI quotas and synchronized check-in RPC.
-- Quotas are fixed-window per user and feature. Only service_role can consume them.

create table if not exists public.viper_ai_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  feature text not null check (feature in (
    'meal_hour', 'meal_day',
    'shake_hour', 'shake_day',
    'coach_hour', 'coach_day'
  )),
  window_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, feature)
);

alter table public.viper_ai_rate_limits enable row level security;
revoke all on public.viper_ai_rate_limits from public, anon, authenticated;
grant all on public.viper_ai_rate_limits to service_role;

create or replace function public.viper_consume_ai_quota(
  p_user_id uuid,
  p_feature text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_window_start timestamptz;
  v_count integer;
begin
  if p_user_id is null
     or p_feature is null
     or p_feature not in ('meal_hour','meal_day','shake_hour','shake_day','coach_hour','coach_day')
     or p_limit is null or p_limit < 1 or p_limit > 1000
     or p_window_seconds is null or p_window_seconds < 60 or p_window_seconds > 86400 then
    raise exception 'Parámetros de límite de IA no válidos';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.viper_ai_rate_limits as current_limit
    (user_id, feature, window_start, request_count, updated_at)
  values
    (p_user_id, p_feature, v_window_start, 1, clock_timestamp())
  on conflict (user_id, feature) do update
    set window_start = excluded.window_start,
        request_count = case
          when current_limit.window_start = excluded.window_start
            then current_limit.request_count + 1
          else 1
        end,
        updated_at = clock_timestamp()
  returning request_count into v_count;

  return v_count <= p_limit;
end;
$function$;

revoke all on function public.viper_consume_ai_quota(uuid,text,integer,integer)
  from public, anon, authenticated;
grant execute on function public.viper_consume_ai_quota(uuid,text,integer,integer)
  to service_role;

-- Keep the live database hardening in version control as a reproducible migration.
create or replace function public.registrar_dia(
  p_comidas integer,
  p_proteina boolean,
  p_foto text default null
)
returns public.checkins
language plpgsql
security definer
set search_path to 'public', 'storage', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_hoy date := (now() at time zone 'America/Lima')::date;
  v_fila public.checkins;
  v_foto text;
  v_gym boolean;
  v_racha int := 0;
  v_racha_ayer int;
  v_comidas int := 0;
  v_proteina_verificada boolean := false;
  v_xp int;
begin
  if v_uid is null then
    raise exception 'Inicia sesión primero';
  end if;

  -- Serialize check-in/XP recalculations for this user without blocking others.
  perform 1
  from public.profiles
  where id = v_uid
  for update;

  if not found then
    raise exception 'No se encontró tu perfil';
  end if;

  select * into v_fila
  from public.checkins
  where user_id = v_uid and dia = v_hoy;

  v_foto := coalesce(p_foto, v_fila.foto_path);

  if p_foto is not null then
    if split_part(p_foto, '/', 1) <> v_uid::text then
      raise exception 'Foto no válida';
    end if;
    if not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'fotos-gym'
        and o.name = p_foto
        and (o.created_at at time zone 'America/Lima')::date = v_hoy
    ) then
      raise exception 'La foto debe subirse hoy';
    end if;
  end if;

  select count(*)::integer into v_comidas
  from public.meal_entries
  where user_id = v_uid
    and meal_date = v_hoy
    and status = 'approved'
    and source = 'ai';

  select exists (
    select 1 from public.protein_shake_entries
    where user_id = v_uid
      and meal_date = v_hoy
      and status = 'approved'
  ) into v_proteina_verificada;

  v_gym := v_foto is not null;

  if v_gym then
    select gym_racha into v_racha_ayer
    from public.checkins
    where user_id = v_uid and dia = v_hoy - 1;
    v_racha := coalesce(v_racha_ayer, 0) + 1;
  end if;

  v_xp := (case when v_gym then 50 + least(v_racha, 10) * 5 else 0 end)
          + v_comidas * 10
          + (case when v_proteina_verificada then 15 else 0 end);

  insert into public.checkins (user_id, dia, foto_path, comidas, proteina, gym_racha, xp)
  values (v_uid, v_hoy, v_foto, v_comidas, v_proteina_verificada, v_racha, v_xp)
  on conflict (user_id, dia) do update set
    foto_path = excluded.foto_path,
    comidas = excluded.comidas,
    proteina = excluded.proteina,
    gym_racha = excluded.gym_racha,
    xp = excluded.xp
  returning * into v_fila;

  update public.profiles set
    xp_total = (select coalesce(sum(c.xp), 0) from public.checkins c where c.user_id = v_uid),
    racha = case when v_gym then v_racha else racha end,
    ultimo_gym = case when v_gym then v_hoy else ultimo_gym end
  where id = v_uid;

  return v_fila;
end;
$function$;

revoke all on function public.registrar_dia(integer,boolean,text) from public, anon;
grant execute on function public.registrar_dia(integer,boolean,text) to authenticated;
