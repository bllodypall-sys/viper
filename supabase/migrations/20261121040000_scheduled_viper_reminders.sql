-- VIPER: recordatorios diarios programados (hora de Lima).
-- Usa pg_cron para generar notificaciones en la base de datos aunque la app esté cerrada.
-- No envía push del sistema operativo ni modifica XP.

create extension if not exists pg_cron with schema pg_catalog;

alter table public.viper_notification_preferences
  add column if not exists breakfast_reminder_time time not null default '08:00',
  add column if not exists lunch_reminder_time time not null default '13:00',
  add column if not exists dinner_reminder_time time not null default '20:00',
  add column if not exists workout_reminder_time time not null default '18:00';

-- Asegura preferencias predeterminadas para usuarios actuales y futuros.
insert into public.viper_notification_preferences (user_id)
select id from auth.users
on conflict (user_id) do nothing;

create or replace function public.viper_create_notification_preferences()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  insert into public.viper_notification_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$function$;

revoke all on function public.viper_create_notification_preferences() from public, anon, authenticated;

drop trigger if exists viper_create_notification_preferences on auth.users;
create trigger viper_create_notification_preferences
after insert on auth.users
for each row execute function public.viper_create_notification_preferences();

create or replace function public.viper_emit_scheduled_reminders()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_pref record;
  v_lima_now timestamp without time zone;
  v_today date;
  v_clock time without time zone;
begin
  v_lima_now := now() at time zone 'America/Lima';
  v_today := v_lima_now::date;
  v_clock := date_trunc('minute', v_lima_now)::time;

  for v_pref in
    select user_id, meal_reminders, workout_reminders,
           breakfast_reminder_time, lunch_reminder_time,
           dinner_reminder_time, workout_reminder_time
    from public.viper_notification_preferences
    where meal_reminders or workout_reminders
  loop
    if v_pref.meal_reminders then
      if v_pref.breakfast_reminder_time = v_clock then
        insert into public.viper_notifications
          (recipient_user_id, notification_type, title, body, event_key)
        values
          (v_pref.user_id, 'meal_reminder', 'Hora del desayuno',
           'Registra tu desayuno y mantén tu alimentación al día.',
           'meal_reminder:' || v_pref.user_id::text || ':' || v_today::text || ':breakfast')
        on conflict (event_key) do nothing;
      end if;

      if v_pref.lunch_reminder_time = v_clock then
        insert into public.viper_notifications
          (recipient_user_id, notification_type, title, body, event_key)
        values
          (v_pref.user_id, 'meal_reminder', 'Hora del almuerzo',
           'No olvides registrar tu almuerzo en VIPER.',
           'meal_reminder:' || v_pref.user_id::text || ':' || v_today::text || ':lunch')
        on conflict (event_key) do nothing;
      end if;

      if v_pref.dinner_reminder_time = v_clock then
        insert into public.viper_notifications
          (recipient_user_id, notification_type, title, body, event_key)
        values
          (v_pref.user_id, 'meal_reminder', 'Hora de la cena',
           'Registra tu cena para completar el seguimiento de hoy.',
           'meal_reminder:' || v_pref.user_id::text || ':' || v_today::text || ':dinner')
        on conflict (event_key) do nothing;
      end if;
    end if;

    if v_pref.workout_reminders and v_pref.workout_reminder_time = v_clock then
      insert into public.viper_notifications
        (recipient_user_id, notification_type, title, body, event_key)
      values
        (v_pref.user_id, 'workout_reminder', 'Hora de entrenar',
         'Tu entrenamiento te espera. ¡Vamos a sumar progreso!',
         'workout_reminder:' || v_pref.user_id::text || ':' || v_today::text)
      on conflict (event_key) do nothing;
    end if;
  end loop;
end;
$function$;

revoke all on function public.viper_emit_scheduled_reminders() from public, anon, authenticated;

-- Reemplaza de forma segura el job VIPER si la migración se vuelve a ejecutar.
do $schedule$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job where jobname = 'viper-scheduled-reminders'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'viper-scheduled-reminders',
    '* * * * *',
    'select public.viper_emit_scheduled_reminders();'
  );
end;
$schedule$;
