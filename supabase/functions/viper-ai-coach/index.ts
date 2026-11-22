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

async function takeQuota(admin: any, userId: string, feature: string, limit: number, windowSeconds: number) {
  const { data, error } = await admin.rpc("viper_consume_ai_quota", {
    p_user_id: userId,
    p_feature: feature,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) throw error;
  return data === true;
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
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Inicia sesión para usar tu entrenador" }, 401);

  const sb = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: auth, error: authError } = await sb.auth.getUser();
  if (authError || !auth.user) return json({ error: "Tu sesión no es válida. Vuelve a iniciar sesión." }, 401);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    let question = "";
    try {
      const body = await req.json();
      question = compact(body?.question || "", 500).trim();
    } catch {
      return json({ error: "Solicitud no válida" }, 400);
    }

    const withinHour = await takeQuota(admin, auth.user.id, "coach_hour", 10, 3600);
    const withinDay = await takeQuota(admin, auth.user.id, "coach_day", 30, 86400);
    if (!withinHour || !withinDay) {
      return json({ error: "Alcanzaste el límite de consultas de VIPER Coach. Inténtalo más tarde." }, 429);
    }

    // User data queries continue using the signed-in user's JWT and RLS.
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

    const [
      { data: athleteProfile, error: athleteError },
      { data: measurements, error: measurementsError },
      { data: goals, error: goalsError },
    ] = await Promise.all([
      sb.from("viper_onboarding_profiles")
        .select("country,age,goal,experience,training_days,training_type,height_cm,weight_kg,priority_muscle")
        .eq("user_id", auth.user.id)
        .maybeSingle(),
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
    if (athleteError) throw athleteError;
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

    // Summarize only recorded training data; never treat a goal baseline as a verified current PR.
    const muscleLoad = new Map<string, { sessions: Set<string>; sets: number; exercises: Set<string> }>();
    for (const session of workoutData) {
      for (const exercise of session.exercises) {
        const muscle = compact(exercise.muscle, 60) || "Sin grupo muscular";
        const current = muscleLoad.get(muscle) || {
          sessions: new Set<string>(),
          sets: 0,
          exercises: new Set<string>(),
        };
        current.sessions.add(String(session.date));
        current.sets += Array.isArray(exercise.sets) ? exercise.sets.length : 0;
        if (exercise.exercise) current.exercises.add(String(exercise.exercise));
        muscleLoad.set(muscle, current);
      }
    }
    const trainingSummary = Array.from(muscleLoad.entries()).map(([muscle, value]) => ({
      muscle,
      recorded_sessions: value.sessions.size,
      recorded_sets: value.sets,
      exercises: Array.from(value.exercises).slice(0, 12),
    }));
    const currentDateLima = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Lima",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    const context = {
      current_date_lima: currentDateLima,
      athlete_profile: athleteProfile || null,
      recent_workouts: workoutData,
      training_summary_by_muscle: trainingSummary,
      body_measurements: measurements || [],
      goals: goals || [],
      data_limits: "El historial incluido es parcial: hasta 45 entrenamientos recientes, 12 mediciones y 30 objetivos. Los objetivos describen metas declaradas; su start_value no demuestra por sí solo una marca actual verificada.",
    };

    const prompt = `Eres VIPER Coach, un entrenador virtual de fuerza, hipertrofia y acondicionamiento. Responde en español claro, respetuoso, motivador y preciso.

REGLAS DE DATOS Y HONESTIDAD
- Basa cada afirmación sobre el atleta únicamente en el JSON. No inventes edad, marcas, pesos, lesiones, disponibilidad, equipamiento, medidas ni entrenamientos.
- Distingue SIEMPRE entre una marca actual verificada en series registradas y una meta declarada. En viper_training_goals, start_value es el valor inicial declarado para esa meta, no una marca actual confirmada ni un récord personal; target_value es la meta. No digas que el atleta levanta actualmente ese peso salvo que los sets registrados lo demuestren.
- Si los entrenamientos no contienen ejercicios o series, dilo claramente. No describas como "recientes" o "vacíos" datos que no aparecen.
- Si el objetivo del perfil, los objetivos guardados y la petición actual se contradicen, explica la diferencia sin asumir que el usuario cambió su objetivo permanente. Pregunta cuál prioridad quiere seguir cuando esa diferencia cambie de forma importante el plan.
- Usa current_date_lima para interpretar fechas y plazos. Si una fecha ya pasó o es demasiado cercana para la meta, explícalo con prudencia; nunca inventes una progresión garantizada.

PERSONALIZACIÓN Y ANÁLISIS
- Considera objetivo principal, experiencia, días disponibles, tipo de entrenamiento, músculo prioritario, equipamiento conocido, boxeo/actividad adicional y datos corporales registrados.
- Usa training_summary_by_muscle y recent_workouts para describir frecuencia y volumen REGISTRADOS por grupo muscular. No confundas ejercicios registrados con series efectivas: si faltan series, indica que el volumen no se puede calcular.
- Evalúa la recuperación con las fechas y la distribución de sesiones disponibles, pero no afirmes que el atleta está recuperado o fatigado sin datos suficientes sobre esfuerzo, sueño, dolor y rendimiento.
- Identifica grupos musculares poco registrados como "poco registrados", no como músculos débiles.
- Si falta un dato importante, enuméralo y explica cómo registrarlo. No bloquees toda ayuda si puedes ofrecer una propuesta provisional claramente etiquetada.

CUANDO EL USUARIO PIDA UNA RUTINA
- Entrega una rutina realmente utilizable: días, ejercicios, series, rango de repeticiones, esfuerzo objetivo (RIR o RPE), descanso y una regla sencilla de progresión. Incluye calentamiento breve y una alternativa cuando el equipamiento sea desconocido o limitado.
- Ajusta el volumen a la experiencia y días disponibles. Distribuye el trabajo para permitir recuperación; no programes tres días de sentadilla pesada ni repitas sesiones duras del mismo grupo muscular en días consecutivos.
- Si hay 6 días disponibles, no significa que los 6 deban ser intensos. Alterna sesiones exigentes, moderadas y de menor carga; contempla boxeo y otras actividades para no acumular fatiga.
- No asignes pesos exactos sin marcas recientes verificadas, repeticiones, esfuerzo percibido y técnica suficiente. En ese caso prescribe RIR/RPE y pide los datos necesarios.
- No recomiendes probar máximos ni perseguir una marca límite sin preparación y supervisión adecuadas. Prioriza técnica estable, rango de movimiento tolerado y progresión gradual.
- Si el usuario no indicó equipo, pregunta qué tiene o presenta una versión provisional con opciones de gimnasio y casa claramente diferenciadas. No supongas máquinas.

SEGURIDAD
- Prioriza progresión gradual, técnica, recuperación y objetivos realistas. No recomiendes dopaje, esteroides, fármacos, dietas extremas ni entrenar con dolor.
- No diagnostiques ni sustituyas a un profesional sanitario. Ante dolor agudo, lesión, enfermedad o síntomas, recomienda detener el ejercicio que los provoca y consultar a un profesional cualificado.
- No afirmes que una rutina es segura para una persona concreta; explica que debe ajustarse según técnica, historial y respuesta individual.
- No cambies ni prometas cambiar registros, objetivos o XP: solo asesora.

FORMATO DE RESPUESTA
- Si el usuario pide análisis: 1) qué muestran los datos; 2) qué no se puede concluir; 3) hasta tres recomendaciones priorizadas; 4) el siguiente paso concreto.
- Si pide rutina: muestra primero la rutina en formato por días y termina con progresión, recuperación y datos que faltan. No sustituyas la rutina por consejos generales.
- Si pide una respuesta puntual, responde primero esa pregunta y evita una plantilla innecesariamente larga.
- Sé conciso, pero no omitas series, repeticiones, esfuerzo y descansos cuando diseñes una rutina.

Petición actual: ${question || "Analiza mi progreso y dime qué debería mejorar esta semana."}
Datos del usuario (JSON):
${JSON.stringify(context)}`;

    const aiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${encodeURIComponent(geminiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 1800 },
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
      athlete_profile: !!athleteProfile,
    } });
  } catch (error) {
    console.error("viper-ai-coach error", error);
    return json({ error: "No se pudo analizar tu progreso. Inténtalo de nuevo." }, 500);
  }
});
