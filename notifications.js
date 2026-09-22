/* Our Space notifications client */
(() => {
  const SUPABASE_URL = "https://ywflohxufmfydkpkkqly.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_qTMUO8KxerEQBDQ-A7Huyg_8N2Tqpmr";
  let VAPID_PUBLIC_KEY = null;

  let notificationClient = null;
  let notificationUser = null;
  let notificationRegistration = null;

  function base64ToUint8Array(base64) {
    const padding = "=".repeat((4 - base64.length % 4) % 4);
    const base64String = (base64 + padding)
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const rawData = atob(base64String);
    return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
  }

  async function getClient() {
    if (!window.supabase) return null;
    if (!notificationClient) {
      notificationClient = supabase.createClient(
        SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY,
        { auth: { persistSession: true, autoRefreshToken: true } }
      );
    }
    return notificationClient;
  }

  async function syncSubscription(subscription, previewEnabled = true) {
    const client = await getClient();
    if (!client || !notificationUser || !subscription) return;

    const { error } = await client.from("push_subscriptions").upsert({
      user_id: notificationUser.id,
      endpoint: subscription.endpoint,
      subscription: subscription.toJSON(),
      preview_enabled: previewEnabled,
      updated_at: new Date().toISOString()
    }, { onConflict: "endpoint" });

    if (error) {
      throw error;
    }
  }

  async function registerNotifications(user) {
    notificationUser = user;

    if (!("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)) {
      return null;
    }

    try {
      notificationRegistration =
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });

      await notificationRegistration.update();

      const existing =
        await notificationRegistration.pushManager.getSubscription();

      if (existing) {
        const previewEnabled = await getPreviewEnabled();
        await syncSubscription(existing, previewEnabled);
      } else if (Notification.permission === "granted") {
        // Permission may already be granted from an earlier visit while the
        // subscription was lost or never synchronized. Restore it silently.
        const publicKey = await getVapidPublicKey();
        if (publicKey) {
          const subscription = await notificationRegistration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: base64ToUint8Array(publicKey)
          });
          await syncSubscription(subscription, true);
        }
      }

      // Make sure the worker is active before any later push operation.
      await navigator.serviceWorker.ready;

      return notificationRegistration;
    } catch (error) {
      console.warn("Our Space notifications unavailable:", error);
      return null;
    }
  }

  async function getVapidPublicKey() {
    if (VAPID_PUBLIC_KEY) return VAPID_PUBLIC_KEY;
    const client = await getClient();
    if (!client) return null;

    const { data: { session } } = await client.auth.getSession();
    if (!session?.access_token) return null;

    const response = await fetch(
      SUPABASE_URL + "/functions/v1/notify-message",
      {
        method: "GET",
        headers: {
          "Authorization": "Bearer " + session.access_token,
          "apikey": SUPABASE_PUBLISHABLE_KEY
        }
      }
    );

    if (!response.ok) throw new Error("Could not load push notification settings.");
    const data = await response.json();
    VAPID_PUBLIC_KEY = data.publicKey || null;
    return VAPID_PUBLIC_KEY;
  }

  async function enableNotifications() {
    if (!notificationRegistration || !notificationUser) return false;
    if (Notification.permission === "denied") return false;

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      throw new Error(
        permission === "denied"
          ? "Notifications are blocked for Our Space. Allow them in your browser site settings."
          : "Notification permission was not granted."
      );
    }

    const publicKey = await getVapidPublicKey();
    if (!publicKey) return false;

    const existing =
      await notificationRegistration.pushManager.getSubscription();

    let subscription = existing;

    if (!subscription) {
      subscription = await notificationRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64ToUint8Array(publicKey)
      });
    }

    await syncSubscription(subscription, await getPreviewEnabled());
    return true;
  }

  async function getPreviewEnabled() {
    const client = await getClient();
    if (!client || !notificationUser) return true;
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
    if (!client || !notificationUser) return false;
    const { error } = await client
      .from("push_subscriptions")
      .update({ preview_enabled: !!enabled, updated_at: new Date().toISOString() })
      .eq("user_id", notificationUser.id);
    return !error;
  }

  async function sendMessageNotification(message) {
    if (!notificationUser || !message) return;

    try {
      const client = await getClient();
      if (!client) return;

      const { error } = await client.functions.invoke("notify-message", {
        body: {
          message_id: message.id,
          space_id: message.space_id,
          sender_id: notificationUser.id,
          content: message.content
        }
      });

      if (error) {
        console.warn("Message notification request failed:", error);
      }
    } catch (error) {
      console.warn("Message notification request failed:", error);
    }
  }

  window.OurSpaceNotifications = {
    register: registerNotifications,
    enable: enableNotifications,
    sendMessage: sendMessageNotification,
    getPreviewEnabled,
    setPreviewEnabled,
    get permission() {
      return "Notification" in window ? Notification.permission : "unsupported";
    }
  };
})();
