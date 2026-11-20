-- VIPER AI Nutrition: migración aditiva.
-- No elimina check-ins ni modifica los XP históricos existentes.
-- Ejecutar en Supabase SQL Editor antes de desplegar la función Edge.

create table if not exists public.meal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  meal_date date not null,
  meal_slot smallint not null check (meal_slot between 1 and 4),
  photo_path text,
  source text not null default 'ai' check (source in ('ai','legacy')),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  food_name text,
  calories numeric(8,2),
  protein_g numeric(8,2),
  carbs_g numeric(8,2),
  fat_g numeric(8,2),
  confidence numeric(4,3),
  ai_notes text,
  image_sha256 text,
  model text,
  created_at timestamptz not null default now(),
  analyzed_at timestamptz,
  constraint meal_entries_unique_slot unique(user_id, meal_date, meal_slot),
  constraint meal_entries_photo_required check (source = 'legacy' or photo_path is not null)
);

create index if not exists meal_entries_user_day_idx
  on public.meal_entries(user_id, meal_date, status);

create unique index if not exists meal_entries_user_hash_unique
  on public.meal_entries(user_id, image_sha256)
  where image_sha256 is not null;

alter table public.meal_entries enable row level security;
drop policy if exists meal_entries_select_own on public.meal_entries;
create policy meal_entries_select_own on public.meal_entries
  for select to authenticated using (user_id = auth.uid());

revoke all on public.meal_entries from anon, authenticated;
grant select on public.meal_entries to authenticated;
grant all on public.meal_entries to service_role;

-- Conserva las comidas que ya habían sido registradas antes de activar la IA.
insert into public.meal_entries(user_id, meal_date, meal_slot, source, status, food_name, ai_notes)
select c.user_id, c.dia, g.slot, 'legacy', 'approved',
       'Comida registrada anteriormente',
       'Registro anterior a la validación con IA; se conserva su XP histórico.'
from public.checkins c
cross join lateral generate_series(1, least(greatest(coalesce(c.comidas,0),0),4)) as g(slot)
where coalesce(c.comidas,0) > 0
on conflict (user_id, meal_date, meal_slot) do nothing;

-- Bucket privado para fotos individuales de las comidas.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('meal-photos','meal-photos',false,8388608,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public=false,
  file_size_limit=8388608,
  allowed_mime_types=array['image/jpeg','image/png','image/webp'];

drop policy if exists meal_photos_insert_own on storage.objects;
create policy meal_photos_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'meal-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists meal_photos_select_own on storage.objects;
create policy meal_photos_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'meal-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Validación del día de subida: solo la Edge Function (service_role) puede ejecutarla.
create or replace function public.viper_validate_meal_photo(
  p_user_id uuid,
  p_photo_path text,
  p_day date
)
returns boolean
language sql
security definer
set search_path = public, storage, pg_temp
as $function$
  select exists (
    select 1
    from storage.objects o
    where o.bucket_id = 'meal-photos'
      and o.name = p_photo_path
      and split_part(o.name, '/', 1) = p_user_id::text
      and (o.created_at at time zone 'America/Lima')::date = p_day
  );
$function$;
revoke all on function public.viper_validate_meal_photo(uuid,text,date) from public, anon, authenticated;
grant execute on function public.viper_validate_meal_photo(uuid,text,date) to service_role;

-- Recalcula los XP del día tras una aprobación/rechazo de la IA.
create or replace function public.refresh_viper_daily_meal_xp(
  p_user_id uuid,
  p_day date
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_meals integer;
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

  update public.checkins
  set comidas = v_meals,
      xp = (case when foto_path is not null then 50 + least(gym_racha,10) * 5 else 0 end)
           + v_meals * 10
           + (case when coalesce(proteina,false) then 15 else 0 end)
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

-- Se conserva la firma para que la versión actual de VIPER siga funcionando.
-- p_comidas se ignora: ahora la cantidad se obtiene de meal_entries aprobadas.
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

  v_gym := v_foto is not null;

  if v_gym then
    select gym_racha into v_racha_ayer
    from public.checkins
    where user_id = v_uid and dia = v_hoy - 1;
    v_racha := coalesce(v_racha_ayer, 0) + 1;
  end if;

  v_xp := (case when v_gym then 50 + least(v_racha, 10) * 5 else 0 end)
          + v_comidas * 10
          + (case when coalesce(p_proteina, false) then 15 else 0 end);

  insert into public.checkins (user_id, dia, foto_path, comidas, proteina, gym_racha, xp)
  values (v_uid, v_hoy, v_foto, v_comidas, coalesce(p_proteina, false), v_racha, v_xp)
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
