// VIPER account deletion. Deploy as a Supabase Edge Function with JWT verification.
// Requires SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in Supabase.
// Never expose the service-role key to the web client.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
});
const buckets = ["avatars", "fotos-gym", "meal-photos", "viper-feed", "chat-images", "viper-progress"];

// Storage files are kept in owner UUID folders. List recursively, including
// dated subfolders, then remove in batches using the service-role client.
async function removeOwnedFiles(admin: ReturnType<typeof createClient>, userId: string) {
  for (const bucket of buckets) {
    const pending = [userId];
    const paths: string[] = [];
    while (pending.length) {
      const prefix = pending.pop()!;
      let offset = 0;
      while (true) {
        const { data, error } = await admin.storage.from(bucket).list(prefix, {
          limit: 100, offset, sortBy: { column: "name", order: "asc" },
        });
        if (error) throw new Error("No se pudo consultar el almacenamiento asociado a tu cuenta");
        const entries = data || [];
        for (const item of entries) {
          if (!item.name || item.name === "." || item.name === "..") continue;
          const path = prefix + "/" + item.name;
          if (item.id) paths.push(path);
          else pending.push(path);
        }
        if (entries.length < 100) break;
        offset += 100;
      }
    }
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await admin.storage.from(bucket).remove(paths.slice(i, i + 100));
      if (error) throw new Error("No se pudieron eliminar todos tus archivos de " + bucket);
    }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return json({ error: "Sesión requerida" }, 401);
  let body: { confirmation?: string };
  try { body = await req.json(); } catch { return json({ error: "Solicitud no válida" }, 400); }
  if (body?.confirmation !== "ELIMINAR") return json({ error: "Confirmación incorrecta" }, 400);
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return json({ error: "Servicio no configurado" }, 503);
  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return json({ error: "Sesión no válida" }, 401);
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    await removeOwnedFiles(admin, data.user.id);
    // Requires cascade rules on child tables; fail closed and do not report
    // success if the database refuses to remove the account.
    const result = await admin.auth.admin.deleteUser(data.user.id);
    if (result.error) throw result.error;
    return json({ deleted: true });
  } catch (e) {
    console.error("VIPER account deletion failed", e);
    return json({
      deleted: false,
      error: "No se pudo completar la eliminación. Contacta con soporte para finalizarla.",
    }, 500);
  }
});
