export type ThemePreference = "system" | "light" | "dark";
export type AccentThemePreference = "royal" | "bondi" | "lime" | "strawberry" | "tangerine" | "grape" | "graphite";

export const THEME_STORAGE_KEY = "browser-agent-theme";
export const ACCENT_THEME_STORAGE_KEY = "browser-agent-accent-theme";

export const THEME_OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" }
] as const;

export const ACCENT_THEME_OPTIONS = [
  { value: "royal", label: "Royal" },
  { value: "bondi", label: "Bondi" },
  { value: "lime", label: "Lime" },
  { value: "strawberry", label: "Strawberry" },
  { value: "tangerine", label: "Tangerine" },
  { value: "grape", label: "Grape" },
  { value: "graphite", label: "Graphite" }
] as const;

const ACCENT_THEME_VALUES = new Set(ACCENT_THEME_OPTIONS.map((option) => option.value));

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

export function loadAccentThemePreference(): AccentThemePreference {
  try {
    const stored = localStorage.getItem(ACCENT_THEME_STORAGE_KEY);
    if (ACCENT_THEME_VALUES.has(stored as AccentThemePreference)) {
      return stored as AccentThemePreference;
    }
  } catch {
    // Ignore storage access failures in extension pages.
  }
  return "royal";
}

export function setThemePreference(preference: ThemePreference) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Ignore storage access failures in extension pages.
  }
  applyThemePreference(preference);
}

export function setAccentThemePreference(preference: AccentThemePreference) {
  try {
    localStorage.setItem(ACCENT_THEME_STORAGE_KEY, preference);
  } catch {
    // Ignore storage access failures in extension pages.
  }
  applyAccentThemePreference(preference);
}

export function applyThemePreference(preference = loadThemePreference()) {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  applyAccentThemePreference();

  if (preference === "light" || preference === "dark") {
    root.classList.add(preference);
    root.style.colorScheme = preference;
    return;
  }

  root.style.colorScheme = "light dark";
}

export function applyAccentThemePreference(preference = loadAccentThemePreference()) {
  document.documentElement.dataset.accentTheme = preference;
}
