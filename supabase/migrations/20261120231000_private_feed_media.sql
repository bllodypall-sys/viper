-- VIPER: prepare authenticated signed access to feed media.
-- Keep the bucket public temporarily to avoid breaking the currently deployed UI.
-- Deploy the signed-URL frontend, then apply the follow-up migration that makes
-- the bucket private. Existing posts and files remain in place.

begin;

drop policy if exists "viper_feed_visible_media_read" on storage.objects;
create policy "viper_feed_visible_media_read" on storage.objects
for select to authenticated
using (
  bucket_id = 'viper-feed'
  and exists (
    select 1
    from public.viper_posts p
    where p.media_path = storage.objects.name
      and not public.is_blocked_between(auth.uid(), p.user_id)
  )
);

commit;
