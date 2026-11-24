-- VIPER Direct 2.0: per-user read cursor and secure chat inbox.
-- Existing conversations are baselined once, avoiding false unread backlogs.
-- Future messages are counted from their sequence id; no XP changes.
begin;

create table if not exists public.viper_chat_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  peer_id uuid not null references auth.users(id) on delete cascade,
  last_read_id bigint not null default 0 check (last_read_id >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, peer_id),
  constraint viper_chat_reads_not_self check (user_id <> peer_id)
);
alter table public.viper_chat_reads enable row level security;
revoke all on public.viper_chat_reads from public, anon;
grant select, insert, update on public.viper_chat_reads to authenticated;

drop policy if exists viper_chat_reads_select_own on public.viper_chat_reads;
create policy viper_chat_reads_select_own
 on public.viper_chat_reads for select to authenticated
 using ((select auth.uid())=user_id);
drop policy if exists viper_chat_reads_insert_own on public.viper_chat_reads;
create policy viper_chat_reads_insert_own
 on public.viper_chat_reads for insert to authenticated
 with check ((select auth.uid())=user_id);
drop policy if exists viper_chat_reads_update_own on public.viper_chat_reads;
create policy viper_chat_reads_update_own
 on public.viper_chat_reads for update to authenticated
 using ((select auth.uid())=user_id)
 with check ((select auth.uid())=user_id);

-- Baselining runs only for friendships existing at deploy time.
insert into public.viper_chat_reads (user_id,peer_id,last_read_id)
select f.solicitante,f.destinatario,
  coalesce((select max(m.id) from public.messages m
    where m.sender_id=f.destinatario and m.recipient_id=f.solicitante),0)
from public.friendships f where f.estado='aceptada'
union all
select f.destinatario,f.solicitante,
  coalesce((select max(m.id) from public.messages m
    where m.sender_id=f.solicitante and m.recipient_id=f.destinatario),0)
from public.friendships f where f.estado='aceptada'
on conflict (user_id,peer_id) do nothing;

create or replace function public.viper_chat_inbox()
returns table (
  peer_id uuid,
  last_message_at timestamptz,
  last_sender_id uuid,
  last_kind text,
  last_preview text,
  unread_count bigint
)
language plpgsql volatile security invoker
set search_path = pg_catalog,public
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then return; end if;

  -- New friendships begin with a zero cursor: their first incoming
  -- messages are not silently treated as read.
  insert into public.viper_chat_reads (user_id,peer_id,last_read_id)
  select v_me,
         case when f.solicitante=v_me then f.destinatario else f.solicitante end, 0
  from public.friendships f
  where f.estado='aceptada'
    and (f.solicitante=v_me or f.destinatario=v_me)
    and not public.is_blocked_between(
      v_me,case when f.solicitante=v_me then f.destinatario else f.solicitante end
    )
  on conflict (user_id,peer_id) do nothing;

  return query
    with peers as (
      select case when f.solicitante=v_me then f.destinatario else f.solicitante end as id
      from public.friendships f
      where f.estado='aceptada'
        and (f.solicitante=v_me or f.destinatario=v_me)
    )
    select p.id,
      last_m.created_at,
      last_m.sender_id,
      last_m.kind,
      case
        when last_m.id is null then ''::text
        when last_m.kind='image' then '📷 Foto'::text
        when last_m.kind='progress' then '🏆 Progreso compartido'::text
        else left(coalesce(last_m.content,''),160)
      end,
      (select count(*)::bigint from public.messages incoming
       where incoming.sender_id=p.id and incoming.recipient_id=v_me
         and incoming.id>coalesce(state.last_read_id,0))
    from peers p
    left join public.viper_chat_reads state
      on state.user_id=v_me and state.peer_id=p.id
    left join lateral (
      select m.id,m.created_at,m.sender_id,m.kind,m.content
      from public.messages m
      where (m.sender_id=v_me and m.recipient_id=p.id)
         or (m.recipient_id=v_me and m.sender_id=p.id)
      order by m.created_at desc,m.id desc
      limit 1
    ) last_m on true
    where not public.is_blocked_between(v_me,p.id)
    order by last_m.created_at desc nulls last,p.id;
end;
$$;

create or replace function public.viper_mark_chat_read(p_peer uuid)
returns void
language plpgsql volatile security invoker
set search_path = pg_catalog,public
as $$
declare
  v_me uuid := auth.uid();
  v_max bigint;
begin
  if v_me is null or p_peer is null or p_peer=v_me then
    raise exception 'Acceso no autorizado al chat';
  end if;
  if not exists (
    select 1 from public.friendships f
    where f.estado='aceptada'
      and ((f.solicitante=v_me and f.destinatario=p_peer)
       or (f.destinatario=v_me and f.solicitante=p_peer))
  ) or public.is_blocked_between(v_me,p_peer) then
    raise exception 'La conversación no está disponible';
  end if;

  select coalesce(max(m.id),0) into v_max
  from public.messages m
  where m.sender_id=p_peer and m.recipient_id=v_me;

  insert into public.viper_chat_reads(user_id,peer_id,last_read_id,updated_at)
  values(v_me,p_peer,v_max,now())
  on conflict(user_id,peer_id) do update
    set last_read_id=greatest(viper_chat_reads.last_read_id,excluded.last_read_id),
        updated_at=now();
end;
$$;

revoke all on function public.viper_chat_inbox() from public, anon;
revoke all on function public.viper_mark_chat_read(uuid) from public, anon;
grant execute on function public.viper_chat_inbox() to authenticated;
grant execute on function public.viper_mark_chat_read(uuid) to authenticated;

commit;
