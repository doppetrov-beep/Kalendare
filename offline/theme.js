(() => {
  const key = "kalendare-theme";
  const system = matchMedia("(prefers-color-scheme: dark)");
  const modes = ["system", "light", "dark"];
  let mode = "system";
  try {
    const stored = localStorage.getItem(key);
    if (modes.includes(stored)) mode = stored;
  } catch {}

  function apply() {
    const dark = mode === "dark" || (mode === "system" && system.matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#111723" : "#f5f6fa");
  }

  apply();
  system.addEventListener("change", apply);
  document.addEventListener("DOMContentLoaded", () => {
    const select = document.querySelector("#themeMode");
    if (!select) return;
    select.value = mode;
    select.addEventListener("change", () => {
      if (!modes.includes(select.value)) return;
      mode = select.value;
      try { localStorage.setItem(key, mode); } catch {}
      apply();
    });
  });
})();
