// VIPER AI Nutrition — Supabase Edge Function
// Secret required: GEMINI_API_KEY. Never put this key in the browser.
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
  let day = limaDate();

  try {
    const body = await req.json();
    const slot = Number(body.slot);
    const photoPath = String(body.photoPath || "");
    if (!Number.isInteger(slot) || slot < 1 || slot > 4) {
      return json({ error: "Comida no válida" }, 400);
    }
    if (!photoPath.startsWith(`${userId}/${day}/`) || photoPath.includes("..")) {
      return json({ error: "La foto debe pertenecer a tu cuenta y al día de hoy" }, 400);
    }

    const { data: validPhoto, error: validError } = await admin.rpc("viper_validate_meal_photo", {
      p_user_id: userId, p_photo_path: photoPath, p_day: day,
    });
    if (validError) throw validError;
    if (!validPhoto) return json({ error: "La foto no se subió hoy. Toma una foto nueva." }, 400);

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

    const { data: duplicate } = await admin.from("meal_entries")
      .select("id").eq("user_id", userId).eq("image_sha256", hash).maybeSingle();
    if (duplicate) return json({ error: "Esta misma foto ya fue utilizada" }, 409);

    const { count, error: countError } = await admin.from("meal_entries")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("meal_date", day)
      .in("status", ["approved", "pending"]);
    if (countError) throw countError;
    if ((count || 0) >= 4) return json({ error: "Ya alcanzaste el máximo de 4 comidas de hoy" }, 429);

    const { data: occupied } = await admin.from("meal_entries")
      .select("id,status").eq("user_id", userId).eq("meal_date", day).eq("meal_slot", slot).maybeSingle();
    if (occupied && occupied.status !== "rejected") {
      return json({ error: "Esta comida ya fue registrada hoy" }, 409);
    }

    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    const base64 = btoa(binary);
    const prompt = `Analiza esta fotografía de una comida. Devuelve ÚNICAMENTE JSON válido con esta forma:
{"contains_food":boolean,"confidence":number,"food_name":string,"calories":number,"protein_g":number,"carbs_g":number,"fat_g":number,"notes":string}
Determina si se ve comida real y reconocible. No aceptes fotos de personas, gimnasios, envases vacíos, capturas de pantalla ni imágenes sin alimentos visibles. Estima macros y calorías solo a partir de lo visible; si no puedes reconocer comida, contains_food=false. confidence entre 0 y 1. No inventes precisión: notes debe indicar que son estimaciones visuales. `;

    const aiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${encodeURIComponent(geminiKey)}`,
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
      console.error("Gemini error", aiResponse.status, detail.slice(0, 500));
      return json({ error: aiResponse.status === 429 ? "La IA alcanzó su límite gratuito. Inténtalo más tarde." : "La IA no pudo analizar la foto. Inténtalo de nuevo." }, 503);
    }

    const aiData = await aiResponse.json();
    const answer = aiData?.candidates?.[0]?.content?.parts?.map((p: {text?: string}) => p.text || "").join("") || "";
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(answer); } catch { return json({ error: "La IA no devolvió un análisis válido. Inténtalo otra vez." }, 502); }

    const confidence = safeNumber(parsed.confidence, 1);
    const approved = parsed.contains_food === true && confidence >= 0.65;
    const values = {
      user_id: userId,
      meal_date: day,
      meal_slot: slot,
      photo_path: photoPath,
      source: "ai",
      status: approved ? "approved" : "rejected",
      food_name: String(parsed.food_name || (approved ? "Comida identificada" : "No se identificó comida")).slice(0, 250),
      calories: safeNumber(parsed.calories, 5000),
      protein_g: safeNumber(parsed.protein_g, 500),
      carbs_g: safeNumber(parsed.carbs_g, 1000),
      fat_g: safeNumber(parsed.fat_g, 500),
      confidence,
      ai_notes: String(parsed.notes || "Valores nutricionales estimados visualmente").slice(0, 1000),
      image_sha256: hash,
      model: "gemini-2.5-flash-lite",
      analyzed_at: new Date().toISOString(),
    };

    let entry;
    if (occupied && occupied.status === "rejected") {
      const { data, error: updateError } = await admin.from("meal_entries")
        .update(values).eq("id", occupied.id)
        .select("id,status,food_name,calories,protein_g,carbs_g,fat_g,confidence,ai_notes").single();
      if (updateError) {
        if (updateError.code === "23505") return json({ error: "Esta foto ya fue utilizada" }, 409);
        throw updateError;
      }
      entry = data;
    } else {
      const { data, error: insertError } = await admin.from("meal_entries")
        .insert(values).select("id,status,food_name,calories,protein_g,carbs_g,fat_g,confidence,ai_notes").single();
      if (insertError) {
        if (insertError.code === "23505") return json({ error: "Esta comida o foto ya fue registrada" }, 409);
        throw insertError;
      }
      entry = data;
      insertedId = entry.id;
    }

    if (approved) {
      const { error: refreshError } = await admin.rpc("refresh_viper_daily_meal_xp", {
        p_user_id: userId, p_day: day,
      });
      if (refreshError) throw refreshError;
    }

    return json({
      approved,
      meal: entry,
      message: approved ? "Comida validada. Recibirás 10 XP al guardar tu día." : "La foto no pudo validarse. Prueba con una foto clara de la comida.",
    });
  } catch (error) {
    console.error("analyze-meal error", error);
    if (insertedId) {
      await admin.from("meal_entries").delete().eq("id", insertedId);
    }
    return json({ error: "No se pudo completar el análisis. Inténtalo de nuevo." }, 500);
  }
});
