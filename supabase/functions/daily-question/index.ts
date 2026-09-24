import { withSupabase } from "npm:@supabase/server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-2.5-flash"
];

const FALLBACK_QUESTIONS = [
  { category: "appreciation", question: "What is one small thing your partner did recently that made you feel especially appreciated?" },
  { category: "memories", question: "What is a simple memory of the two of you that still makes you smile when you think about it?" },
  { category: "future", question: "What is one experience you would genuinely love for the two of you to share in the next year?" },
  { category: "playful", question: "If you had to plan a completely spontaneous date for tonight, what would you choose?" },
  { category: "connection", question: "What kind of ordinary moment makes you feel closest to your partner?" },
  { category: "communication", question: "What is something your partner does that makes you feel truly listened to?" },
  { category: "everyday", question: "What is one little thing you enjoy doing together more than you probably admit?" },
  { category: "discovery", question: "What is something about your partner that you feel you understand better now than you did at first?" },
  { category: "gratitude", question: "What is something about your relationship that you feel grateful for today?" },
  { category: "growth", question: "What is one way you think the two of you have grown together?" },
  { category: "dates", question: "What would your ideal low-budget date with your partner look like?" },
  { category: "little-things", question: "What tiny gesture from your partner can change the mood of your whole day?" },
  { category: "appreciation", question: "What quality in your partner do you hope they never underestimate?" },
  { category: "memories", question: "Which early moment in your relationship do you wish you could watch again?" },
  { category: "future", question: "What is one place you would love to wake up with your partner someday?" },
  { category: "playful", question: "What silly activity would the two of you probably have way too much fun doing together?" },
  { category: "connection", question: "When do you feel most comfortable being completely yourself with your partner?" },
  { category: "communication", question: "What is one thing you wish people understood about how the two of you communicate?" },
  { category: "everyday", question: "What part of an ordinary day is better simply because your partner is in it?" },
  { category: "discovery", question: "What is something your partner has taught you without necessarily trying to teach you?" },
  { category: "gratitude", question: "What is one part of your partner's personality that you feel lucky to experience up close?" },
  { category: "growth", question: "What is one habit you would love for the two of you to build together?" },
  { category: "dates", question: "What kind of date would feel completely new for the two of you?" },
  { category: "little-things", question: "What is one tiny shared routine you would miss if it disappeared?" }
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

function todayInMorocco() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Casablanca",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function cleanQuestion(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim().replace(/^["“]|["”]$/g, "");
}

function validQuestion(question: string) {
  return question.length >= 18 && question.length <= 240 && !/[\r\n]/.test(question);
}

async function generateQuestion(apiKey: string, history: Array<{question: string; category: string}>) {
  const recent = history.slice(-120);
  const used = recent.map((x) => "- " + x.question).join("\n");
  const categories = ["appreciation", "memories", "future", "connection", "communication", "playful", "everyday", "discovery", "gratitude", "growth", "dates", "little-things"];

  const system = [
    "You create the single daily relationship question for a private couples app.",
    "The couple is two adults. Questions must be warm, natural, concise, and genuinely useful for conversation.",
    "Never make the question sound like therapy homework, an interview, a personality test, or a generic social-media prompt.",
    "Prefer questions that can be answered differently by each partner and lead to a good conversation after the reveal.",
    "Mix light, playful, affectionate, reflective, practical, memory, future, and communication prompts across days.",
    "Do not ask for sexual content, explicit sexual details, private passwords, financial secrets, or identifying information.",
    "Do not create questions about breaking up, testing loyalty, jealousy traps, manipulation, or comparing the partner to other people.",
    "Do not repeat or lightly rephrase any previous question.",
    "Return ONLY valid JSON with exactly these fields: question, category.",
    "category must be one of: " + categories.join(", ") + ".",
    "question must be one sentence, 18-240 characters, and end with a question mark.",
    "Here are previous questions from this couple; treat them as a strict no-repeat list:",
    used || "- none"
  ].join("\n");

  for (const model of MODELS) {
    try {
      const response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ text: "Create today's question now." }] }],
            generationConfig: {
              temperature: 0.9,
              maxOutputTokens: 180,
              candidateCount: 1,
              responseMimeType: "application/json"
            }
          }),
          signal: AbortSignal.timeout(8000)
        }
      );

      const data = await response.json().catch(() => ({}));
      if (!response.ok) continue;

      const raw = (data?.candidates?.[0]?.content?.parts || [])
        .map((part: any) => String(part?.text || ""))
        .join("")
        .trim();

      const parsed = JSON.parse(raw);
      const question = cleanQuestion(parsed?.question);
      const category = String(parsed?.category || "connection").toLowerCase();

      if (validQuestion(question) && categories.includes(category)) {
        const duplicate = recent.some((item) =>
          item.question.trim().toLowerCase() === question.toLowerCase()
        );
        if (!duplicate) return { question, category, model };
      }
    } catch (_) {
      // Try the next model; the deterministic fallback below guarantees a daily question.
    }
  }

  const unused = FALLBACK_QUESTIONS.filter((item) =>
    !recent.some((old) => old.question.trim().toLowerCase() === item.question.toLowerCase())
  );
  const pool = unused.length ? unused : FALLBACK_QUESTIONS;
  const dayNumber = Math.floor(Date.parse(todayInMorocco() + "T00:00:00") / 86400000);
  const picked = pool[Math.abs(dayNumber) % pool.length];
  return { ...picked, model: "fallback" };
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

    try {
      const body = await req.json().catch(() => ({}));
      const spaceId = String(body?.space_id || "");

      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(spaceId)) {
        return json({ error: "A valid space is required." }, 400);
      }

      const userId = String(ctx.userClaims?.sub || "");
      const { data: member, error: memberError } = await ctx.supabaseAdmin
        .from("space_members")
        .select("space_id")
        .eq("space_id", spaceId)
        .eq("user_id", userId)
        .maybeSingle();

      if (memberError) {
        console.error("daily-question membership check:", memberError);
        return json({ error: "Could not verify your couple space." }, 500);
      }

      if (!member) return json({ error: "You are not a member of this space." }, 403);

      const questionDate = todayInMorocco();

      const { data: existing, error: existingError } = await ctx.supabaseAdmin
        .from("daily_questions")
        .select("id,space_id,question_date,question,category,difficulty,ai_model,created_at")
        .eq("space_id", spaceId)
        .eq("question_date", questionDate)
        .maybeSingle();

      if (existingError) return json({ error: "Could not load today's question." }, 500);
      if (existing) return json({ question: existing, reused: true });

      const { data: historyRows, error: historyError } = await ctx.supabaseAdmin
        .from("daily_questions")
        .select("question,category,question_date")
        .eq("space_id", spaceId)
        .order("question_date", { ascending: false })
        .limit(80);

      if (historyError) return json({ error: "Could not load question history." }, 500);

      const apiKey = Deno.env.get("GEMINI_API_KEY");
      const generated = apiKey
        ? await generateQuestion(apiKey, (historyRows || []).reverse())
        : (() => {
            const picked = FALLBACK_QUESTIONS[Math.floor(Math.random() * FALLBACK_QUESTIONS.length)];
            return { ...picked, model: "fallback" };
          })();

      const { data: inserted, error: insertError } = await ctx.supabaseAdmin
        .from("daily_questions")
        .insert({
          space_id: spaceId,
          question_date: questionDate,
          question: generated.question,
          category: generated.category,
          difficulty: "medium",
          ai_model: generated.model
        })
        .select("id,space_id,question_date,question,category,difficulty,ai_model,created_at")
        .single();

      if (insertError) {
        const { data: raced } = await ctx.supabaseAdmin
          .from("daily_questions")
          .select("id,space_id,question_date,question,category,difficulty,ai_model,created_at")
          .eq("space_id", spaceId)
          .eq("question_date", questionDate)
          .maybeSingle();

        if (raced) return json({ question: raced, reused: true });
        return json({ error: "Could not save today's question." }, 500);
      }

      return json({ question: inserted, reused: false });
    } catch (error) {
      console.error("daily-question:", error);
      return json({ error: "The daily question service is temporarily unavailable." }, 500);
    }
  })
};