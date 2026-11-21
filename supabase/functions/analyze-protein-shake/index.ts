// VIPER: validate one protein shake photo per Lima calendar day.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function limaDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${v.year}-${v.month}-${v.day}`;
}

function safeNumber(value: unknown, max: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey || !geminiKey) {
    return json({ error: "Falta configurar una clave del servidor" }, 500);
  }

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Inicia sesión" }, 401);
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return json({ error: "Sesión no válida" }, 401);
  const userId = authData.user.id;

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let insertedId: string | null = null;
  const day = limaDate();

  try {
    const body = await req.json();
    const photoPath = String(body.photoPath || "");
    if (!photoPath.startsWith(`${userId}/${day}/protein-`) || photoPath.includes("..")) {
      return json({ error: "La foto debe ser un batido nuevo de tu cuenta y de hoy" }, 400);
    }

    const { data: validPhoto, error: validError } = await admin.rpc("viper_validate_meal_photo", {
      p_user_id: userId, p_photo_path: photoPath, p_day: day,
    });
    if (validError) throw validError;
    if (!validPhoto) return json({ error: "La foto debe tomarse hoy desde VIPER" }, 400);

    const { data: existing, error: existingError } = await admin.from("protein_shake_entries")
      .select("id,status").eq("user_id", userId).eq("meal_date", day).maybeSingle();
    if (existingError) throw existingError;
    if (existing?.status === "approved") {
      return json({ error: "Ya tienes el batido validado hoy. Solo se permite uno por día." }, 409);
    }

    const { data: image, error: downloadError } = await admin.storage.from("meal-photos").download(photoPath);
    if (downloadError || !image) return json({ error: "No se pudo leer la foto subida" }, 400);
    if (image.size > 8 * 1024 * 1024) return json({ error: "La foto supera 8 MB" }, 413);
    const mime = image.type || "image/jpeg";
    if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) {
      return json({ error: "Formato de imagen no permitido" }, 400);
    }

    const bytes = new Uint8Array(await image.arrayBuffer());
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");

    const { data: usedMeal } = await admin.from("meal_entries")
      .select("id").eq("user_id", userId).eq("image_sha256", hash).maybeSingle();
    if (usedMeal) return json({ error: "Esta foto ya se utilizó para registrar una comida" }, 409);
    const { data: usedShake } = await admin.from("protein_shake_entries")
      .select("id").eq("user_id", userId).eq("image_sha256", hash).maybeSingle();
    if (usedShake) return json({ error: "Esta misma foto ya fue utilizada" }, 409);

    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    const base64 = btoa(binary);
    const prompt = `Analiza esta imagen para validar el consumo de un BATIDO DE PROTEÍNA ya preparado. Devuelve ÚNICAMENTE JSON válido:
{"contains_protein_shake":boolean,"confidence":number,"protein_g":number,"drink_name":string,"notes":string}
Aprueba solo si la foto muestra claramente un batido líquido preparado dentro de un vaso o shaker. Rechaza envases de proteína, bolsas, tarros, cucharas de polvo, polvo seco, vasos vacíos, agua sola, otras bebidas sin evidencia de batido proteico, comidas, personas, gimnasios, capturas de pantalla o imágenes no relacionadas. No asumas que una bebida es proteína solo porque aparece un envase cerca. Estima gramos de proteína de forma conservadora; si no se puede identificar razonablemente un batido de proteína o la estimación es inferior a 10 g, contains_protein_shake=false. confidence debe estar entre 0 y 1. notes debe explicar brevemente la decisión.`;

    const aiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${encodeURIComponent(geminiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: base64 } }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
        }),
      },
    );
    if (!aiResponse.ok) {
      const detail = await aiResponse.text();
      console.error("Gemini protein shake error", aiResponse.status, detail.slice(0, 500));
      return json({ error: aiResponse.status === 429 ? "La IA alcanzó su límite gratuito. Inténtalo más tarde." : "La IA no pudo analizar el batido. Inténtalo de nuevo." }, 503);
    }

    const aiData = await aiResponse.json();
    const answer = aiData?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") || "";
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(answer); } catch {
      return json({ error: "La IA no devolvió una validación válida. Inténtalo otra vez." }, 502);
    }

    const confidence = safeNumber(parsed.confidence, 1);
    const proteinG = safeNumber(parsed.protein_g, 500);
    const approved = parsed.contains_protein_shake === true && confidence >= 0.75 && proteinG >= 10;
    const values = {
      user_id: userId,
      meal_date: day,
      photo_path: photoPath,
      image_sha256: hash,
      status: approved ? "approved" : "rejected",
      protein_g: proteinG,
      ai_notes: String(parsed.notes || "Validación visual de batido").slice(0, 1000),
      model: "gemini-3.5-flash-lite",
      analyzed_at: new Date().toISOString(),
    };

    let entry;
    if (existing) {
      const { data, error } = await admin.from("protein_shake_entries").update(values)
        .eq("id", existing.id)
        .select("id,status,protein_g,ai_notes").single();
      if (error) {
        if (error.code === "23505") return json({ error: "Esta foto ya fue utilizada" }, 409);
        throw error;
      }
      entry = data;
    } else {
      const { data, error } = await admin.from("protein_shake_entries").insert(values)
        .select("id,status,protein_g,ai_notes").single();
      if (error) {
        if (error.code === "23505") return json({ error: "Ya existe un registro de batido para hoy" }, 409);
        throw error;
      }
      entry = data;
      insertedId = entry.id;
    }

    const { error: refreshError } = await admin.rpc("refresh_viper_daily_meal_xp", {
      p_user_id: userId, p_day: day,
    });
    if (refreshError) throw refreshError;

    return json({
      approved,
      shake: entry,
      message: approved ? "Batido de proteína validado. +15 XP." : "No se pudo confirmar un batido de proteína. Toma otra foto clara del batido preparado.",
    });
  } catch (error) {
    console.error("analyze-protein-shake error", error);
    if (insertedId) await admin.from("protein_shake_entries").delete().eq("id", insertedId);
    return json({ error: "No se pudo completar la validación. Inténtalo de nuevo." }, 500);
  }
});
