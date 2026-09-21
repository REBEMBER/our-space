/* Our Space notifications client */
(() => {
  const SUPABASE_URL = "https://ywflohxufmfydkpkkqly.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_qTMUO8KxerEQBDQ-A7Huyg_8N2Tqpmr";
  const VAPID_PUBLIC_KEY = "REPLACE_WITH_VAPID_PUBLIC_KEY";

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

  async function syncSubscription(subscription) {
    const client = await getClient();
    if (!client || !notificationUser || !subscription) return;

    await client.from("push_subscriptions").upsert({
      user_id: notificationUser.id,
      endpoint: subscription.endpoint,
      subscription: subscription.toJSON(),
      preview_enabled: true
    }, { onConflict: "endpoint" });
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

      const existing =
        await notificationRegistration.pushManager.getSubscription();

      if (existing) {
        await syncSubscription(existing);
      }

      return notificationRegistration;
    } catch (error) {
      console.warn("Our Space notifications unavailable:", error);
      return null;
    }
  }

  async function enableNotifications() {
    if (!notificationRegistration || !notificationUser) return false;
    if (Notification.permission === "denied") return false;

    const permission = await Notification.requestPermission();
    if (permission !== "granted") return false;

    if (VAPID_PUBLIC_KEY === "REPLACE_WITH_VAPID_PUBLIC_KEY") {
      console.warn("Our Space: VAPID public key has not been configured.");
      return false;
    }

    const existing =
      await notificationRegistration.pushManager.getSubscription();

    const subscription = existing || await notificationRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64ToUint8Array(VAPID_PUBLIC_KEY)
    });

    await syncSubscription(subscription);
    return true;
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
    get permission() {
      return "Notification" in window ? Notification.permission : "unsupported";
    }
  };
})();
