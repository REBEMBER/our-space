module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const r = await fetch(
      "https://ywflohxufmfydkpkkqly.supabase.co/functions/v1/our-space-ai-config-check",
      { cache: "no-store" }
    );
    const body = await r.text();
    res.status(r.status);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(body);
  } catch (error) {
    console.error("AI config check failed:", error);
    res.status(502).json({ error: "Config check unavailable." });
  }
};
