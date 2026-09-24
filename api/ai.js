const SUPABASE_AI_URL =
  "https://ywflohxufmfydkpkkqly.supabase.co/functions/v1/our-space-ai";

const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_qTMUO8KxerEQBDQ-A7Huyg_8N2Tqpmr";

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const authorization = String(req.headers.authorization || "").trim();

  if (!authorization.toLowerCase().startsWith("bearer ")) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  try {
    const response = await fetch(SUPABASE_AI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_PUBLISHABLE_KEY,
        Authorization: authorization,
      },
      body: JSON.stringify(req.body || {}),
    });

    res.status(response.status);
    res.setHeader(
      "Content-Type",
      response.headers.get("content-type") ||
        "application/json; charset=utf-8"
    );
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");

    if (!response.ok) {
      const body = await response.text();
      console.error(
        "Our Space AI upstream error:",
        response.status,
        body.slice(0, 1000)
      );
      res.end(body);
      return;
    }

    if (!response.body) {
      res.status(502).json({ error: "The AI service returned no response body." });
      return;
    }

    for await (const chunk of response.body) {
      res.write(Buffer.from(chunk));
    }

    res.end();
  } catch (error) {
    console.error("Our Space AI proxy error:", error);
    res.status(502).json({
      error: "The AI service is temporarily unavailable.",
    });
  }
};
