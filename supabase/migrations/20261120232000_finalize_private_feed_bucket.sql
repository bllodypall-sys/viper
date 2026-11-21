-- VIPER: finalize private feed media after the signed-URL frontend is deployed.
-- Apply only after the frontend change using createSignedUrl is live.
-- No post rows or media objects are deleted.

begin;

update storage.buckets
set public = false
where id = 'viper-feed';

commit;
