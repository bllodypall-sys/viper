-- VIPER Notifications: base de notificaciones y preferencias.
-- Migracion aditiva. No modifica tablas existentes ni concede XP.
-- Ejecutar una sola vez en Supabase SQL Editor.

create table if not exists public.viper_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  notification_type text not null check (notification_type in (
    'meal_reminder',
    'workout_reminder',
    'friend_workout',
    'friend_xp',
    'friend_level',
    'meal_update',
    'system'
  )),
  title text not null check (char_length(trim(title)) between 1 and 120),
  body text not null check (char_length(trim(body)) between 1 and 500),
  action_url text,
  event_key text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint viper_notifications_event_key_unique unique (event_key)
);

create index if not exists viper_notifications_recipient_created_idx
  on public.viper_notifications(recipient_user_id, created_at desc);
create index if not exists viper_notifications_unread_idx
  on public.viper_notifications(recipient_user_id, created_at desc)
  where read_at is null;

alter table public.viper_notifications enable row level security;

drop policy if exists viper_notifications_read_own on public.viper_notifications;
create policy viper_notifications_read_own
  on public.viper_notifications for select to authenticated
  using (recipient_user_id = auth.uid());

drop policy if exists viper_notifications_mark_own on public.viper_notifications;
create policy viper_notifications_mark_own
  on public.viper_notifications for update to authenticated
  using (recipient_user_id = auth.uid())
  with check (recipient_user_id = auth.uid());

-- No se permite insertar notificaciones directamente desde el navegador.
-- Las siguientes fases las generaran mediante funciones/triggers seguros.
revoke all on public.viper_notifications from anon, authenticated;
grant select on public.viper_notifications to authenticated;
grant update (read_at) on public.viper_notifications to authenticated;

create table if not exists public.viper_notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  meal_reminders boolean not null default true,
  workout_reminders boolean not null default true,
  friend_workout_alerts boolean not null default true,
  friend_xp_alerts boolean not null default true,
  leaderboard_alerts boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.viper_notification_preferences enable row level security;

drop policy if exists viper_notification_preferences_owner on public.viper_notification_preferences;
create policy viper_notification_preferences_owner
  on public.viper_notification_preferences for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.viper_notification_preferences to authenticated;

-- Permite recibir nuevas notificaciones en tiempo real desde Supabase Realtime.
do $$
begin
  alter publication supabase_realtime add table public.viper_notifications;
exception
  when duplicate_object then null;
  when undefined_object then
    raise notice 'La publicacion supabase_realtime no existe; habilita Realtime para viper_notifications desde Supabase.';
end $$;
