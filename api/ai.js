module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const host = req.headers.host;
    const proto = String(req.headers["x-forwarded-proto"] || "https");
    const indexResponse = await fetch(proto + "://" + host + "/index.html", { cache: "no-store" });
    const indexHtml = await indexResponse.text();
    const match = indexHtml.match(/const\s+SUPABASE_URL\s*=\s*"([^"]+)"/);

    if (!match) {
      res.status(503).json({ error: "AI service endpoint is unavailable." });
      return;
    }

    const response = await fetch(match[1] + "/functions/v1/our-space-ai", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {})
      },
      body: JSON.stringify(req.body || {})
    });

    const body = await response.text();
    res.status(response.status);
    res.setHeader("Content-Type", response.headers.get("content-type") || "application/json");
    res.end(body);
  } catch (error) {
    console.error("Our Space AI proxy error:", error);
    res.status(502).json({ error: "The AI service is temporarily unavailable." });
  }
};
