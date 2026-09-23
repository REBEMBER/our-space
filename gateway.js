/* Our Space calculator gateway
 * The calculator is the front door to the private app.
 * Unlock is intentionally tab-scoped (sessionStorage), never localStorage.
 */
(() => {
  const SUPABASE_URL = "https://ywflohxufmfydkpkkqly.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_qTMUO8KxerEQBDQ-A7Huyg_8N2Tqpmr";
  const KEY_PREFIX = "our_space_calculator_unlocked:";
  const CALCULATOR_PATH = "/calculator.html";

  window.OurSpaceGateway = {
    keyFor(userId) { return KEY_PREFIX + String(userId); },
    unlock(userId) {
      if (!userId) return;
      sessionStorage.setItem(this.keyFor(userId), "1");
    },
    clearAll() {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith(KEY_PREFIX)) sessionStorage.removeItem(key);
      }
    },
    isUnlocked(userId) {
      return !!userId && sessionStorage.getItem(this.keyFor(userId)) === "1";
    },
    async requireUnlock(client) {
      try {
        const { data: { user }, error } = await client.auth.getUser();
        if (error || !user) {
          window.location.replace("/login.html");
          return null;
        }
        if (!this.isUnlocked(user.id)) {
          window.location.replace(CALCULATOR_PATH);
          return null;
        }
        document.documentElement.classList.remove("gateway-pending");
        return user;
      } catch (error) {
        console.error("Gateway check failed:", error);
        window.location.replace(CALCULATOR_PATH);
        return null;
      }
    }
  };
})();
