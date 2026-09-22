/* Our Space notifications client */
(() => {
  const SUPABASE_URL = "https://ywflohxufmfydkpkkqly.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_qTMUO8KxerEQBDQ-A7Huyg_8N2Tqpmr";
  let VAPID_PUBLIC_KEY = null;
  let notificationClient = null;
  let notificationUser = null;
  let notificationRegistration = null;
  let lastError = null;

  function base64ToUint8Array(base64) {
    const normalized = String(base64 || "").trim();
    const padding = "=".repeat((4 - normalized.length % 4) % 4);
    const base64String = (normalized + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = atob(base64String);
    return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
  }

  async function getClient() {
    if (!window.supabase) throw new Error("Supabase client library is not loaded.");
    if (!notificationClient) {
      notificationClient = window.supabase.createClient(
        SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY,
        { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } }
      );
    }
    return notificationClient;
  }

  async function getAuthenticatedSession() {
    const client = await getClient();
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (!data.session?.access_token) {
      throw new Error("Your Our Space session is not available. Please log in again.");
    }
    return data.session;
  }

  async function syncSubscription(subscription, previewEnabled = true) {
    const client = await getClient();
    if (!notificationUser?.id) throw new Error("No signed-in Our Space account.");
    if (!subscription) throw new Error("The browser did not create a push subscription.");

    const payload = subscription.toJSON();
    if (!payload?.endpoint || !payload?.keys?.p256dh || !payload?.keys?.auth) {
      throw new Error("The browser returned an incomplete push subscription.");
    }

    const { error } = await client.from("push_subscriptions").upsert(
      {
        user_id: notificationUser.id,
        endpoint: payload.endpoint,
        subscription: payload,
        preview_enabled: previewEnabled !== false,
        updated_at: new Date().toISOString()
      },
      { onConflict: "endpoint" }
    );

    if (error) {
      throw new Error("Could not save this device's notification subscription: " + error.message);
    }

    return true;
  }

  async function registerNotifications(user) {
    notificationUser = user;
    lastError = null;

    if (!("serviceWorker" in navigator)) {
      lastError = new Error("This browser does not support service workers.");
      return null;
    }
    if (!("PushManager" in window)) {
      lastError = new Error("This browser does not support web push.");
      return null;
    }
    if (!("Notification" in window)) {
      lastError = new Error("This browser does not support notifications.");
      return null;
    }

    try {
      notificationRegistration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none"
      });
      await notificationRegistration.update();
      await navigator.serviceWorker.ready;

      // Startup only restores an already-existing subscription.
      // New subscriptions are created only from the explicit Enable button.
      const existing = await notificationRegistration.pushManager.getSubscription();
      if (existing) {
        await syncSubscription(existing, await getPreviewEnabled());
      }

      return notificationRegistration;
    } catch (error) {
      lastError = error;
      console.error("Our Space notification registration failed:", error);
      return null;
    }
  }

  async function getVapidPublicKey() {
    if (VAPID_PUBLIC_KEY) return VAPID_PUBLIC_KEY;

    const session = await getAuthenticatedSession();
    const response = await fetch(SUPABASE_URL + "/functions/v1/notify-message", {
      method: "GET",
      headers: {
        Authorization: "Bearer " + session.access_token,
        apikey: SUPABASE_PUBLISHABLE_KEY
      },
      cache: "no-store"
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error("Notification server rejected the key request (" + response.status + "): " + text.slice(0, 180));
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Notification server returned invalid JSON.");
    }

    if (!data.publicKey) throw new Error("Notification server did not provide a VAPID public key.");
    VAPID_PUBLIC_KEY = data.publicKey;
    return VAPID_PUBLIC_KEY;
  }

  async function ensureRegistration() {
    if (!notificationUser) throw new Error("No signed-in Our Space account.");
    if (!notificationRegistration) {
      await registerNotifications(notificationUser);
    }
    if (!notificationRegistration) {
      throw lastError || new Error("Could not register the notification service worker.");
    }
    await navigator.serviceWorker.ready;
    return notificationRegistration;
  }

  async function enableNotifications() {
    lastError = null;

    if (!("Notification" in window) || !("PushManager" in window) || !("serviceWorker" in navigator)) {
      throw new Error("This browser does not support Our Space push notifications.");
    }

    // This function is called directly by the user's Enable button.
    const registration = await ensureRegistration();

    if (Notification.permission === "denied") {
      throw new Error("Notifications are blocked for Our Space. Allow notifications in your browser site settings, then press Enable again.");
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      throw new Error(permission === "denied"
        ? "Notifications are blocked for Our Space."
        : "Notification permission was not granted.");
    }

    const publicKey = await getVapidPublicKey();
    const existing = await registration.pushManager.getSubscription();

    let subscription = existing;
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64ToUint8Array(publicKey)
      });
    }

    await syncSubscription(subscription, await getPreviewEnabled());
    return true;
  }

  async function getPreviewEnabled() {
    const client = await getClient();
    if (!notificationUser?.id) return true;

    const { data, error } = await client
      .from("push_subscriptions")
      .select("preview_enabled")
      .eq("user_id", notificationUser.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return true;
    return data.preview_enabled !== false;
  }

  async function setPreviewEnabled(enabled) {
    const client = await getClient();
    if (!notificationUser?.id) return false;

    const { error } = await client
      .from("push_subscriptions")
      .update({
        preview_enabled: !!enabled,
        updated_at: new Date().toISOString()
      })
      .eq("user_id", notificationUser.id);

    if (error) {
      console.error("Notification preference sync failed:", error);
      return false;
    }
    return true;
  }

  async function sendMessageNotification(message) {
    if (!notificationUser || !message) return;

    try {
      const client = await getClient();
      const { data, error } = await client.functions.invoke("notify-message", {
        body: {
          message_id: message.id,
          space_id: message.space_id,
          sender_id: notificationUser.id,
          content: message.content
        }
      });

      if (error) {
        console.warn("Message notification request failed:", error);
        return;
      }

      console.log("Our Space push send result:", data);
    } catch (error) {
      console.warn("Message notification request failed:", error);
    }
  }

  async function sendTestNotification() {
    await enableNotifications();

    const client = await getClient();
    const { data, error } = await client.functions.invoke("notify-message", {
      body: { test: true }
    });
    if (error) throw new Error(error.message || "The notification test failed.");
    if (!data?.sent) {
      throw new Error("The server still has no active subscription for this account after enabling notifications.");
    }
    return data;
  }

  window.OurSpaceNotifications = {
    register: registerNotifications,
    enable: enableNotifications,
    sendMessage: sendMessageNotification,
    sendTest: sendTestNotification,
    getPreviewEnabled,
    setPreviewEnabled,
    get permission() {
      return "Notification" in window ? Notification.permission : "unsupported";
    },
    get lastError() {
      return lastError;
    }
  };
})();
