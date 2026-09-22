(() => {
  const THEMES = ["warm","dark","ocean","forest","blush","sunset"];
  const DEFAULT_THEME = "warm";
  const COOKIE = "our_space_theme";
  const MAX_AGE = 31536000;
  const THEME_META_COLORS = {
    warm: "#F8F0EC",
    dark: "#0B121B",
    ocean: "#ECF7FC",
    forest: "#EEF6F1",
    blush: "#FFF1F5",
    sunset: "#FFF4EC"
  };
  const validTheme = (theme) => THEMES.includes(theme);

  function syncMetaThemeColor(theme) {
    const safe = validTheme(theme) ? theme : DEFAULT_THEME;
    const color = THEME_META_COLORS[safe];
    let meta = document.querySelector('meta[name="theme-color"]');

    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }

    meta.setAttribute("content", color);
  }

  function getCookie() {
    const prefix = COOKIE + "=";
    const item = document.cookie.split("; ").find((value) => value.startsWith(prefix));
    const value = item ? decodeURIComponent(item.slice(prefix.length)) : "";
    return validTheme(value) ? value : null;
  }

  function setCookie(theme) {
    const safe = validTheme(theme) ? theme : DEFAULT_THEME;
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = COOKIE + "=" + encodeURIComponent(safe) +
      "; Max-Age=" + MAX_AGE + "; Path=/; SameSite=Lax" + secure;
  }

  function clearCookie() {
    document.cookie = COOKIE + "=; Max-Age=0; Path=/; SameSite=Lax";
  }

  function apply(theme) {
    const safe = validTheme(theme) ? theme : DEFAULT_THEME;
    document.documentElement.dataset.theme = safe;
    syncMetaThemeColor(safe);
    return safe;
  }

  function choose(theme) {
    const safe = apply(theme);
    setCookie(safe);
    return safe;
  }

  function syncFromUser(user) {
    const accountTheme = user?.user_metadata?.our_space_theme;
    if (validTheme(accountTheme)) return choose(accountTheme);
    clearCookie();
    return apply(DEFAULT_THEME);
  }

  apply(getCookie() || DEFAULT_THEME);

  window.OurSpaceTheme = {
    THEMES: new Set(THEMES),
    DEFAULT_THEME,
    getCookie,
    setCookie,
    clearCookie,
    apply,
    choose,
    syncFromUser
  };
})();