export type ThemePreference = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "browser-agent-theme";

export const THEME_OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" }
] as const;

export function loadThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
    // Ignore storage access failures in extension pages.
  }
  return "system";
}

export function setThemePreference(preference: ThemePreference) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Ignore storage access failures in extension pages.
  }
  applyThemePreference(preference);
}

export function applyThemePreference(preference = loadThemePreference()) {
  const root = document.documentElement;
  root.classList.remove("light", "dark");

  if (preference === "light" || preference === "dark") {
    root.classList.add(preference);
    root.style.colorScheme = preference;
    return;
  }

  root.style.colorScheme = "light dark";
}
