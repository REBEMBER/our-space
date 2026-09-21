/* Our Space push service worker */
self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch (_) {}

    const clientsList = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true
    });

    const chatOpen = clientsList.some((client) => {
      try {
        const url = new URL(client.url);
        return url.pathname.endsWith("/chat.html") &&
               client.visibilityState === "visible";
      } catch (_) {
        return false;
      }
    });

    if (chatOpen) return;

    const previewEnabled = data.preview_enabled !== false;
    const title = previewEnabled
      ? (data.sender_name || "Our Space")
      : "Calculation time";

    const body = previewEnabled
      ? (data.content || "You have a new message.")
      : "";

    await self.registration.showNotification(title, {
      body,
      icon: "/calculator.png",
      badge: "/calculator.png",
      tag: "our-space-message-" + (data.message_id || Date.now()),
      renotify: true,
      data: {
        url: "/chat.html",
        message_id: data.message_id || null
      }
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  event.waitUntil((async () => {
    const targetUrl = new URL(
      event.notification.data?.url || "/chat.html",
      self.location.origin
    ).href;

    const clientsList = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true
    });

    for (const client of clientsList) {
      if ("focus" in client) {
        try {
          await client.navigate(targetUrl);
        } catch (_) {}
        await client.focus();
        return;
      }
    }

    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});
