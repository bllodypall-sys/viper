-- Applied to Supabase production as migration 20261126173457.
-- Additive indexes for VIPER social features; no row modification.
create index if not exists friendships_destinatario_idx on public.friendships(destinatario);
create index if not exists friendships_solicitante_idx on public.friendships(solicitante);
create index if not exists viper_chat_reads_peer_id_idx on public.viper_chat_reads(peer_id);
create index if not exists viper_notifications_actor_user_id_idx on public.viper_notifications(actor_user_id);
create index if not exists viper_post_comments_user_id_idx on public.viper_post_comments(user_id);

-- Optimize policy evaluation without changing the user_id ownership condition.
alter policy meal_entries_select_own on public.meal_entries
  using (user_id = (select auth.uid()));
