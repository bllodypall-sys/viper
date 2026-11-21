-- VIPER: make feed media private while preserving authenticated feed access.
-- Existing posts and files remain in place. The UI now requests expiring signed URLs.

begin;

update storage.buckets
set public = false
where id = 'viper-feed';

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
