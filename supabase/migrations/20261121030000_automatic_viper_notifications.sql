-- VIPER: automatic server-side notifications.
-- Additive migration: does not modify XP, check-ins, meals, friendships or profiles.
-- Notifications are generated only by trusted database triggers; browser clients
-- retain read-only/mark-as-read access to viper_notifications.

create or replace function public.viper_notify_accepted_friends(
  p_actor_user_id uuid,
  p_notification_type text,
  p_title text,
  p_body text,
  p_action_url text,
  p_event_key text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_username text;
begin
  if p_actor_user_id is null
     or p_notification_type not in ('friend_workout','friend_xp','friend_level')
     or p_event_key is null then
    return;
  end if;

  select coalesce(nullif(trim(username),''), 'Un amigo')
    into v_username
  from public.profiles
  where id = p_actor_user_id;

  insert into public.viper_notifications (
    recipient_user_id, actor_user_id, notification_type,
    title, body, action_url, event_key
  )
  select
    case
      when f.solicitante = p_actor_user_id then f.destinatario
      else f.solicitante
    end,
    p_actor_user_id,
    p_notification_type,
    left(replace(p_title, '{username}', coalesce(v_username,'Un amigo')), 120),
    left(replace(p_body, '{username}', coalesce(v_username,'Un amigo')), 500),
    p_action_url,
    p_event_key || ':' || case
      when f.solicitante = p_actor_user_id then f.destinatario::text
      else f.solicitante::text
    end
  from public.friendships f
  left join public.viper_notification_preferences pref
    on pref.user_id = case
      when f.solicitante = p_actor_user_id then f.destinatario
      else f.solicitante
    end
  where f.estado = 'aceptada'
    and (f.solicitante = p_actor_user_id or f.destinatario = p_actor_user_id)
    and case p_notification_type
      when 'friend_workout' then coalesce(pref.friend_workout_alerts, true)
      when 'friend_xp' then coalesce(pref.friend_xp_alerts, true)
      when 'friend_level' then coalesce(pref.leaderboard_alerts, true)
      else false
    end
    and not public.is_blocked_between(
      p_actor_user_id,
      case
        when f.solicitante = p_actor_user_id then f.destinatario
        else f.solicitante
      end
    )
  on conflict (event_key) do nothing;
end;
$function$;

revoke all on function public.viper_notify_accepted_friends(uuid,text,text,text,text,text)
  from public, anon, authenticated;

-- A verified gym check-in (photo saved for the current check-in) alerts accepted friends.
create or replace function public.viper_notify_friend_workout_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if new.foto_path is not null
     and (
       tg_op = 'INSERT'
       or new.foto_path is distinct from old.foto_path
     ) then
    perform public.viper_notify_accepted_friends(
      new.user_id,
      'friend_workout',
      '{username} entrenó hoy',
      'Tu amigo registró su entrenamiento. ¡Anímalo!',
      '/?section=amigos',
      'friend_workout:' || new.user_id::text || ':' || new.dia::text
    );
  end if;
  return new;
end;
$function$;

drop trigger if exists viper_notify_friend_workout on public.checkins;
create trigger viper_notify_friend_workout
after insert or update of foto_path on public.checkins
for each row execute function public.viper_notify_friend_workout_trigger();

-- XP changes are announced at most once per friend and actor per Lima day.
-- The trigger observes XP but never changes or awards it.
create or replace function public.viper_notify_friend_xp_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if new.xp_total > coalesce(old.xp_total, 0) then
    perform public.viper_notify_accepted_friends(
      new.id,
      'friend_xp',
      '{username} ganó XP',
      'Tu amigo ha sumado puntos hoy. ¡Sigue su progreso!',
      '/?section=ranking',
      'friend_xp:' || new.id::text || ':' ||
        (now() at time zone 'America/Lima')::date::text
    );
  end if;
  return new;
end;
$function$;

drop trigger if exists viper_notify_friend_xp on public.profiles;
create trigger viper_notify_friend_xp
after update of xp_total on public.profiles
for each row execute function public.viper_notify_friend_xp_trigger();

-- Notify the owner when the server-side AI analysis approves or rejects a meal.
create or replace function public.viper_notify_meal_result_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if new.status in ('approved','rejected')
     and (
       tg_op = 'INSERT'
       or new.status is distinct from old.status
     ) then
    insert into public.viper_notifications (
      recipient_user_id, actor_user_id, notification_type,
      title, body, action_url, event_key
    ) values (
      new.user_id,
      null,
      'meal_update',
      case when new.status = 'approved'
        then '¡Comida aprobada!'
        else 'Comida no aprobada'
      end,
      case when new.status = 'approved'
        then 'La IA validó tu comida y se actualizaron tus puntos.'
        else 'La IA no pudo validar esta foto. Puedes intentarlo con otra foto.'
      end,
      '/?section=comidas',
      'meal_result:' || new.id::text || ':' || new.status
    )
    on conflict (event_key) do nothing;
  end if;
  return new;
end;
$function$;

drop trigger if exists viper_notify_meal_result on public.meal_entries;
create trigger viper_notify_meal_result
after insert or update of status on public.meal_entries
for each row execute function public.viper_notify_meal_result_trigger();
