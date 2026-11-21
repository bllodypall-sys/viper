-- VIPER: award protein shake XP only after server-side AI validation.
-- A daily photo is required; the browser cannot grant this reward by toggling a checkbox.

create table if not exists public.protein_shake_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  meal_date date not null,
  photo_path text not null,
  image_sha256 text not null,
  status text not null check (status in ('approved','rejected')),
  protein_g numeric(8,2) not null default 0 check (protein_g between 0 and 500),
  ai_notes text,
  model text,
  created_at timestamptz not null default now(),
  analyzed_at timestamptz not null default now(),
  constraint protein_shake_one_per_day unique(user_id, meal_date),
  constraint protein_shake_unique_photo unique(user_id, image_sha256)
);

create index if not exists protein_shake_entries_user_day_idx
  on public.protein_shake_entries(user_id, meal_date, status);

alter table public.protein_shake_entries enable row level security;
drop policy if exists protein_shake_select_own on public.protein_shake_entries;
create policy protein_shake_select_own on public.protein_shake_entries
  for select to authenticated using (user_id = auth.uid());
revoke all on public.protein_shake_entries from anon, authenticated;
grant select on public.protein_shake_entries to authenticated;
grant all on public.protein_shake_entries to service_role;

-- Recalculate XP from verified records only. A self-reported boolean never awards points.
create or replace function public.refresh_viper_daily_meal_xp(
  p_user_id uuid,
  p_day date
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_meals integer;
  v_protein_verified boolean;
begin
  if p_user_id is null or p_day is null then
    raise exception 'Parámetros no válidos';
  end if;

  select count(*)::integer into v_meals
  from public.meal_entries
  where user_id = p_user_id
    and meal_date = p_day
    and status = 'approved'
    and source = 'ai';

  select exists (
    select 1 from public.protein_shake_entries
    where user_id = p_user_id
      and meal_date = p_day
      and status = 'approved'
  ) into v_protein_verified;

  update public.checkins
  set comidas = v_meals,
      proteina = v_protein_verified,
      xp = (case when foto_path is not null then 50 + least(gym_racha,10) * 5 else 0 end)
           + v_meals * 10
           + (case when v_protein_verified then 15 else 0 end)
  where user_id = p_user_id and dia = p_day;

  update public.profiles
  set xp_total = (
    select coalesce(sum(c.xp),0)
    from public.checkins c
    where c.user_id = p_user_id
  )
  where id = p_user_id;
end;
$function$;
revoke all on function public.refresh_viper_daily_meal_xp(uuid,date) from public, anon, authenticated;
grant execute on function public.refresh_viper_daily_meal_xp(uuid,date) to service_role;

create or replace function public.registrar_dia(
  p_comidas integer,
  p_proteina boolean,
  p_foto text default null
)
returns public.checkins
language plpgsql
security definer
set search_path to 'public', 'storage'
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
