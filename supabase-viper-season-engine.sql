-- VIPER: motor de puntuación de temporadas
-- Migración aditiva. No modifica profiles.xp_total ni borra check-ins.
-- Ejecutar ahora en Supabase SQL Editor.
--
-- La temporada se crea y activa el día de publicación de la nueva versión.
-- Al final de este archivo se incluye el INSERT que se ejecutará EN ESE MOMENTO,
-- no ahora.

create or replace function public.recalculate_viper_season_score(
  p_season_id bigint,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_start date;
  v_end date;
  v_total bigint;
begin
  select (s.starts_at at time zone 'America/Lima')::date,
         (s.ends_at at time zone 'America/Lima')::date
    into v_start, v_end
  from public.seasons s
  where s.id = p_season_id;

  if not found or p_user_id is null then
    return;
  end if;

  select coalesce(sum(c.xp), 0)
    into v_total
  from public.checkins c
  where c.user_id = p_user_id
    and c.dia >= v_start
    and c.dia < v_end;

  if v_total > 0 then
    insert into public.season_scores(season_id, user_id, xp, updated_at)
    values (p_season_id, p_user_id, v_total::integer, now())
    on conflict (season_id, user_id)
    do update set xp = excluded.xp, updated_at = now();
  else
    delete from public.season_scores
    where season_id = p_season_id and user_id = p_user_id;
  end if;
end;
$function$;

revoke all on function public.recalculate_viper_season_score(bigint,uuid)
from public, anon, authenticated;


create or replace function public.sync_viper_season_score_from_checkins()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_season record;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    for v_season in
      select s.id
      from public.seasons s
      where old.dia >= (s.starts_at at time zone 'America/Lima')::date
        and old.dia <  (s.ends_at at time zone 'America/Lima')::date
    loop
      perform public.recalculate_viper_season_score(v_season.id, old.user_id);
    end loop;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    for v_season in
      select s.id
      from public.seasons s
      where new.dia >= (s.starts_at at time zone 'America/Lima')::date
        and new.dia <  (s.ends_at at time zone 'America/Lima')::date
    loop
      perform public.recalculate_viper_season_score(v_season.id, new.user_id);
    end loop;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

revoke all on function public.sync_viper_season_score_from_checkins()
from public, anon, authenticated;

drop trigger if exists checkins_sync_viper_season_score on public.checkins;
create trigger checkins_sync_viper_season_score
after insert or update or delete on public.checkins
for each row execute function public.sync_viper_season_score_from_checkins();


-- Cuando se inserta una temporada o se cambian sus fechas, reconstruye
-- su ranking desde los check-ins históricos que caen dentro del periodo.
create or replace function public.backfill_viper_season_scores()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user record;
begin
  delete from public.season_scores
  where season_id = new.id;

  for v_user in
    select distinct c.user_id
    from public.checkins c
    where c.dia >= (new.starts_at at time zone 'America/Lima')::date
      and c.dia <  (new.ends_at at time zone 'America/Lima')::date
  loop
    perform public.recalculate_viper_season_score(new.id, v_user.user_id);
  end loop;

  return new;
end;
$function$;

revoke all on function public.backfill_viper_season_scores()
from public, anon, authenticated;

drop trigger if exists seasons_backfill_viper_scores on public.seasons;
create trigger seasons_backfill_viper_scores
after insert or update of starts_at, ends_at on public.seasons
for each row execute function public.backfill_viper_season_scores();


-- ACTIVAR TEMPORADA 1 EN EL MOMENTO DE PUBLICAR LA NUEVA VERSIÓN:
-- Ejecutar esta sentencia una sola vez el día de lanzamiento.
-- El inicio será a las 00:00 de Lima de ese día y durará 30 días completos.
--
-- insert into public.seasons (name, starts_at, ends_at, status)
-- values (
--   'Temporada 1',
--   date_trunc('day', now() at time zone 'America/Lima') at time zone 'America/Lima',
--   (date_trunc('day', now() at time zone 'America/Lima') + interval '30 days')
--      at time zone 'America/Lima',
--   'active'
-- );
