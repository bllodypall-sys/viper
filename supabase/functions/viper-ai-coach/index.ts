// VIPER AI Coach — Supabase Edge Function
// Requires the existing GEMINI_API_KEY secret. The key stays server-side.
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

function compact(value: unknown, max = 180) {
  return String(value ?? "").replace(/[<>]/g, "").slice(0, max);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (!supabaseUrl || !anonKey || !geminiKey) {
    return json({ error: "Falta configurar una clave del servidor" }, 500);
  }

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Inicia sesión para usar tu entrenador" }, 401);

  const sb = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: auth, error: authError } = await sb.auth.getUser();
  if (authError || !auth.user) return json({ error: "Tu sesión no es válida. Vuelve a iniciar sesión." }, 401);

  try {
    let question = "";
    try {
      const body = await req.json();
      question = compact(body?.question || "", 500).trim();
    } catch {
      return json({ error: "Solicitud no válida" }, 400);
    }

    // Every query uses the signed-in user's JWT and RLS. No service-role access.
    const { data: sessions, error: sessionsError } = await sb
      .from("viper_workout_sessions")
      .select("id,session_date,notes")
      .eq("user_id", auth.user.id)
      .order("session_date", { ascending: false })
      .limit(45);
    if (sessionsError) throw sessionsError;

    const sessionRows = sessions || [];
    const sessionIds = sessionRows.map((x) => x.id);
    let exercises: Array<Record<string, unknown>> = [];
    let sets: Array<Record<string, unknown>> = [];

    if (sessionIds.length) {
      const { data, error } = await sb
        .from("viper_workout_exercises")
        .select("id,session_id,muscle_group,exercise_name")
        .in("session_id", sessionIds)
        .limit(250);
      if (error) throw error;
      exercises = data || [];

      const exerciseIds = exercises.map((x) => x.id);
      if (exerciseIds.length) {
        const { data: setRows, error: setError } = await sb
          .from("viper_workout_sets")
          .select("exercise_id,set_number,reps,weight_kg")
          .in("exercise_id", exerciseIds)
          .limit(1000);
        if (setError) throw setError;
        sets = setRows || [];
      }
    }

    const [{ data: measurements, error: measurementsError }, { data: goals, error: goalsError }] = await Promise.all([
      sb.from("viper_body_measurements")
        .select("measured_on,weight_kg,chest_cm,waist_cm,hips_cm,left_arm_cm,right_arm_cm,left_thigh_cm,right_thigh_cm")
        .eq("user_id", auth.user.id)
        .order("measured_on", { ascending: false })
        .limit(12),
      sb.from("viper_training_goals")
        .select("title,metric_type,exercise_name,measurement_key,muscle_group,start_value,target_value,unit,target_date,status")
        .eq("user_id", auth.user.id)
        .order("created_at", { ascending: false })
        .limit(30),
    ]);
    if (measurementsError) throw measurementsError;
    if (goalsError) throw goalsError;

    const exerciseById = new Map(exercises.map((x) => [String(x.id), x]));
    const workoutData = sessionRows.map((s) => {
      const ex = exercises.filter((e) => e.session_id === s.id).map((e) => ({
        muscle: compact(e.muscle_group, 60),
        exercise: compact(e.exercise_name, 100),
        sets: sets.filter((set) => set.exercise_id === e.id).map((set) => ({
          reps: Number(set.reps) || 0,
          kg: Number(set.weight_kg) || 0,
        })).slice(0, 12),
      }));
      return { date: s.session_date, notes: compact(s.notes, 180), exercises: ex };
    });

    const context = {
      recent_workouts: workoutData,
      body_measurements: measurements || [],
      goals: goals || [],
      data_limits: "El historial incluido es parcial: hasta 45 entrenamientos recientes, 12 mediciones y 30 objetivos.",
    };

    const prompt = `Eres VIPER Coach, un entrenador virtual de fuerza e hipertrofia. Responde en español claro, motivador y conciso.
Usa únicamente los datos del usuario incluidos abajo. No inventes marcas, pesos, medidas, lesiones ni resultados. Si faltan datos, dilo y recomienda qué registrar.
Prioriza progresión gradual, técnica correcta, recuperación, constancia y objetivos realistas. No recomiendes dopaje, esteroides, fármacos, dietas extremas ni entrenar con dolor. No diagnostiques ni sustituyas a un profesional de salud. Si menciona dolor, lesión, enfermedad o síntomas, recomienda detener el ejercicio que lo provoca y consultar a un profesional cualificado.
No cambies ni prometas cambiar registros, objetivos o XP: solo asesora.
Entrega una respuesta práctica con: 1) diagnóstico breve del progreso basado en datos; 2) tres recomendaciones concretas; 3) un siguiente paso para la próxima semana. Si pregunta algo específico, responde primero eso y adapta el resto.
Pregunta del usuario: ${question || "Analiza mi progreso y dime qué debería mejorar esta semana."}
Datos del usuario (JSON):
${JSON.stringify(context)}`;

    const aiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${encodeURIComponent(geminiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.35, maxOutputTokens: 1200 },
        }),
      },
    );

    if (!aiResponse.ok) {
      const detail = await aiResponse.text();
      console.error("VIPER Coach Gemini error", aiResponse.status, detail.slice(0, 400));
      return json({
        error: aiResponse.status === 429
          ? "El entrenador alcanzó el límite temporal de consultas. Inténtalo más tarde."
          : "El entrenador no pudo responder ahora. Inténtalo de nuevo.",
      }, 503);
    }

    const aiData = await aiResponse.json();
    const answer = aiData?.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text || "")
      .join("")
      .trim();

    if (!answer) return json({ error: "El entrenador no generó una respuesta. Inténtalo otra vez." }, 502);
    return json({ answer, data_used: {
      workouts: sessionRows.length,
      measurements: measurements?.length || 0,
      goals: goals?.length || 0,
    } });
  } catch (error) {
    console.error("viper-ai-coach error", error);
    return json({ error: "No se pudo analizar tu progreso. Inténtalo de nuevo." }, 500);
  }
});
