-- VIPER: perfiles públicos y enlaces a redes sociales
-- Migración aditiva: no elimina ni modifica datos existentes.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS instagram_url text,
  ADD COLUMN IF NOT EXISTS tiktok_url text,
  ADD COLUMN IF NOT EXISTS facebook_url text,
  ADD COLUMN IF NOT EXISTS x_url text;

-- Permite que cada usuario guarde sus propios enlaces.
-- La política RLS existente de profiles debe seguir limitando UPDATE a la fila propia.
GRANT UPDATE (instagram_url, tiktok_url, facebook_url, x_url)
ON public.profiles TO authenticated;

-- Vista pública con una lista explícita de campos no sensibles.
-- No expone correo, fechas de check-in, fotos del gimnasio ni otros campos privados.
CREATE OR REPLACE VIEW public.viper_public_profiles
WITH (security_invoker = false)
AS
SELECT
  id,
  username,
  xp_total,
  racha,
  avatar_path,
  instagram_url,
  tiktok_url,
  facebook_url,
  x_url
FROM public.profiles;

GRANT SELECT ON public.viper_public_profiles TO authenticated;
