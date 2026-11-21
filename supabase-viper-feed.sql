-- VIPER FEED: publicaciones de texto, fotos y videos de hasta 60 segundos.
-- Migracion aditiva. Ejecutar en Supabase SQL Editor.
-- El bucket es privado. El acceso al contenido del feed se concede mediante
-- enlaces temporales y una política SELECT que respeta los bloqueos.

create table if not exists public.viper_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  caption text not null default '' check (char_length(caption) <= 2000),
  media_path text,
  media_type text check (media_type in ('image','video')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint viper_posts_content_required check (
    char_length(trim(caption)) > 0 or media_path is not null
  ),
  constraint viper_posts_media_pair check (
    (media_path is null and media_type is null) or
    (media_path is not null and media_type is not null)
  )
);

create index if not exists viper_posts_created_idx
  on public.viper_posts(created_at desc);
create index if not exists viper_posts_user_created_idx
  on public.viper_posts(user_id, created_at desc);

create table if not exists public.viper_post_likes (
  post_id uuid not null references public.viper_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists viper_post_likes_user_idx
  on public.viper_post_likes(user_id, created_at desc);

create table if not exists public.viper_post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.viper_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists viper_post_comments_post_idx
  on public.viper_post_comments(post_id, created_at asc);

alter table public.viper_posts enable row level security;
alter table public.viper_post_likes enable row level security;
alter table public.viper_post_comments enable row level security;

-- Permisos SQL para que PostgREST pueda acceder a las tablas.
grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.viper_posts to authenticated;
grant select, insert, delete on table public.viper_post_likes to authenticated;
grant select, insert, delete on table public.viper_post_comments to authenticated;

drop policy if exists "viper_posts_public_read" on public.viper_posts;
create policy "viper_posts_public_read" on public.viper_posts
  for select to authenticated
  using (not public.is_blocked_between(auth.uid(), user_id));
drop policy if exists "viper_posts_owner_insert" on public.viper_posts;
create policy "viper_posts_owner_insert" on public.viper_posts
  for insert to authenticated with check (
    auth.uid() = user_id
    and (media_path is null or (storage.foldername(media_path))[1] = auth.uid()::text)
  );
drop policy if exists "viper_posts_owner_update" on public.viper_posts;
create policy "viper_posts_owner_update" on public.viper_posts
  for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (media_path is null or (storage.foldername(media_path))[1] = auth.uid()::text)
  );
drop policy if exists "viper_posts_owner_delete" on public.viper_posts;
create policy "viper_posts_owner_delete" on public.viper_posts
  for delete to authenticated using (auth.uid() = user_id);

drop policy if exists "viper_likes_read" on public.viper_post_likes;
create policy "viper_likes_read" on public.viper_post_likes
  for select to authenticated using (
    exists (
      select 1 from public.viper_posts p
      where p.id = post_id
        and not public.is_blocked_between(auth.uid(), p.user_id)
    )
  );
drop policy if exists "viper_likes_insert_own" on public.viper_post_likes;
create policy "viper_likes_insert_own" on public.viper_post_likes
  for insert to authenticated with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.viper_posts p
      where p.id = post_id
        and not public.is_blocked_between(auth.uid(), p.user_id)
    )
  );
drop policy if exists "viper_likes_delete_own" on public.viper_post_likes;
create policy "viper_likes_delete_own" on public.viper_post_likes
  for delete to authenticated using (auth.uid() = user_id);

drop policy if exists "viper_comments_read" on public.viper_post_comments;
create policy "viper_comments_read" on public.viper_post_comments
  for select to authenticated using (
    exists (
      select 1 from public.viper_posts p
      where p.id = post_id
        and not public.is_blocked_between(auth.uid(), p.user_id)
    )
  );
drop policy if exists "viper_comments_insert_own" on public.viper_post_comments;
create policy "viper_comments_insert_own" on public.viper_post_comments
  for insert to authenticated with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.viper_posts p
      where p.id = post_id
        and not public.is_blocked_between(auth.uid(), p.user_id)
    )
  );
drop policy if exists "viper_comments_delete_own" on public.viper_post_comments;
create policy "viper_comments_delete_own" on public.viper_post_comments
  for delete to authenticated using (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'viper-feed',
  'viper-feed',
  false,
  104857600,
  array['image/jpeg','image/png','image/webp','video/mp4','video/webm']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "viper_feed_owner_upload" on storage.objects;
create policy "viper_feed_owner_upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'viper-feed'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "viper_feed_visible_media_read" on storage.objects;
create policy "viper_feed_visible_media_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'viper-feed'
    and exists (
      select 1 from public.viper_posts p
      where p.media_path = storage.objects.name
        and not public.is_blocked_between(auth.uid(), p.user_id)
    )
  );

drop policy if exists "viper_feed_owner_update" on storage.objects;
create policy "viper_feed_owner_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'viper-feed'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'viper-feed'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "viper_feed_owner_delete" on storage.objects;
create policy "viper_feed_owner_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'viper-feed'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- El bucket privado no permite URLs públicas permanentes. La aplicación
-- genera enlaces firmados de corta duración tras comprobar esta política.
