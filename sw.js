self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/* Our Space push service worker */
self.addEventListener("message", (event) => {
  if (event.data?.type !== "CLEAR_OUR_SPACE_NOTIFICATIONS") return;

  event.waitUntil((async () => {
    const notifications = await self.registration.getNotifications();
    for (const notification of notifications) {
      if (String(notification.tag || "").startsWith("our-space-message-")) {
        notification.close();
      }
    }
  })());
});

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch (_) {}

    // Do not show a system notification while the actual chat conversation
    // is open and visible. Notifications should still work when the chat is
    // in another tab, backgrounded, minimized, or not open at all.
    const openClients = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true
    });

    const chatIsVisible = openClients.some((client) => {
      try {
        const url = new URL(client.url);
        return url.pathname.endsWith("/chat.html") && client.visibilityState === "visible";
      } catch (_) {
        return false;
      }
    });

    if (chatIsVisible) {
      return;
    }

    const previewEnabled = data.preview_enabled !== false;
    const title = previewEnabled
      ? (data.sender_name || "Salma")
      : "Calculator";

    const body = previewEnabled
      ? (data.content || "You have a new message.")
      : "";

    await self.registration.showNotification(title, {
      body,
      icon: "/favicon.svg",
      badge: "/favicon.svg",
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
