-- VIPER: endure XP integrity against direct PostgREST writes.
-- Deploy only after confirming registrar_dia / AI functions run as SECURITY DEFINER.
-- All checks are additive; no historical checkins, profile XP, or season scores are changed.
begin;

create or replace function public.viper_guard_checkin_writes()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  -- Authenticated clients must use registrar_dia; the trusted SECURITY DEFINER
  -- functions are executed as their function owner instead.
  if current_user = 'authenticated' then
    raise exception 'Los puntos de VIPER se calculan exclusivamente en el servidor'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists viper_guard_checkins on public.checkins;
create trigger viper_guard_checkins
before insert or update or delete on public.checkins
for each row execute function public.viper_guard_checkin_writes();

-- Protect XP and streaks while allowing normal profile editing.
create or replace function public.viper_guard_profile_score()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user = 'authenticated' and (
       new.xp_total is distinct from old.xp_total
    or new.racha is distinct from old.racha
    or new.ultimo_gym is distinct from old.ultimo_gym
  ) then
    raise exception 'El XP y las rachas solo pueden modificarse desde el servidor'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists viper_guard_profile_score on public.profiles;
create trigger viper_guard_profile_score
before update on public.profiles
for each row execute function public.viper_guard_profile_score();

-- Extra defense; server-side SECURITY DEFINER routines retain their privileges.
revoke insert, update, delete on public.checkins from authenticated;
commit;
