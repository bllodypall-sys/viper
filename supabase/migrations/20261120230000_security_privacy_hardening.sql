-- VIPER security hardening (additive, non-destructive)
-- Apply in Supabase SQL Editor only after reviewing the migration.
-- Restricts block checks to the signed-in user and enforces blocks in chat
-- and chat-image access. Existing messages and user data are preserved.

begin;

-- A signed-in user may only ask whether THEY are blocked with another user.
-- This prevents probing block relationships between arbitrary third parties.
create or replace function public.is_blocked_between(user_a uuid, user_b uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
begin
  if auth.uid() is null
     or user_a is distinct from auth.uid()
     or user_b is null then
    return false;
  end if;

  return exists (
    select 1
    from public.user_blocks
    where (blocker_id = auth.uid() and blocked_id = user_b)
       or (blocker_id = user_b and blocked_id = auth.uid())
  );
end;
$function$;

revoke all on function public.is_blocked_between(uuid, uuid) from public, anon;
grant execute on function public.is_blocked_between(uuid, uuid) to authenticated;

-- A friendship is no longer sufficient to read/send messages after either
-- person blocks the other. Both directions are checked.
drop policy if exists "messages_read_friends" on public.messages;
create policy "messages_read_friends" on public.messages
for select to authenticated
using (
  (sender_id = auth.uid() or recipient_id = auth.uid())
  and exists (
    select 1
    from public.friendships f
    where f.estado = 'aceptada'
      and (
        (f.solicitante = messages.sender_id and f.destinatario = messages.recipient_id)
        or
        (f.solicitante = messages.recipient_id and f.destinatario = messages.sender_id)
      )
  )
  and not public.is_blocked_between(
    auth.uid(),
    case when sender_id = auth.uid() then recipient_id else sender_id end
  )
);

drop policy if exists "messages_send_friends" on public.messages;
create policy "messages_send_friends" on public.messages
for insert to authenticated
with check (
  sender_id = auth.uid()
  and recipient_id <> auth.uid()
  and exists (
    select 1
    from public.friendships f
    where f.estado = 'aceptada'
      and (
        (f.solicitante = auth.uid() and f.destinatario = messages.recipient_id)
        or
        (f.destinatario = auth.uid() and f.solicitante = messages.recipient_id)
      )
  )
  and not public.is_blocked_between(auth.uid(), recipient_id)
);

-- Chat images must belong to a conversation that is still readable and
-- must not be accessible after a block. Existing private bucket is retained.
drop policy if exists "chat_images_friends_read" on storage.objects;
create policy "chat_images_friends_read" on storage.objects
for select to authenticated
using (
  bucket_id = 'chat-images'
  and exists (
    select 1
    from public.messages m
    where m.media_path = storage.objects.name
      and (m.sender_id = auth.uid() or m.recipient_id = auth.uid())
      and exists (
        select 1
        from public.friendships f
        where f.estado = 'aceptada'
          and (
            (f.solicitante = m.sender_id and f.destinatario = m.recipient_id)
            or
            (f.solicitante = m.recipient_id and f.destinatario = m.sender_id)
          )
      )
      and not public.is_blocked_between(
        auth.uid(),
        case when m.sender_id = auth.uid() then m.recipient_id else m.sender_id end
      )
  )
);

-- Reports submitted by users must start open; users cannot create pre-closed
-- or pre-reviewed reports. No existing reports are changed.
drop policy if exists content_reports_insert_own on public.content_reports;
create policy content_reports_insert_own on public.content_reports
for insert to authenticated
with check (reporter_id = auth.uid() and status = 'open');

commit;
