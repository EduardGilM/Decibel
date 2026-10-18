/**
 * Accent palettes (dark UI). Each one sets the primary/ring tokens on <html> as inline CSS
 * variables, so every accent user (active chips, play buttons, sliders, liked heart,
 * now-playing row, equalizer icon, focus ring) follows the selected theme.
 */
export { dynamicAccent } from "./cover-colors.ts"

export interface ThemePreset {
  id: string
  name: string
  primary: string
  foreground: string
}

const fg = (h: number) => `oklch(0.17 0.03 ${h})`

export const THEMES: ThemePreset[] = [
  { id: "verde", name: "Verde", primary: "oklch(0.76 0.17 152)", foreground: fg(152) },
  { id: "azul", name: "Azul", primary: "oklch(0.72 0.14 250)", foreground: fg(250) },
  { id: "violeta", name: "Violeta", primary: "oklch(0.72 0.16 295)", foreground: fg(295) },
  { id: "rosa", name: "Rosa", primary: "oklch(0.76 0.15 350)", foreground: fg(350) },
  { id: "rojo", name: "Rojo", primary: "oklch(0.70 0.19 25)", foreground: fg(25) },
  { id: "naranja", name: "Naranja", primary: "oklch(0.77 0.16 55)", foreground: fg(55) },
  { id: "ambar", name: "Ámbar", primary: "oklch(0.84 0.15 85)", foreground: fg(85) },
  { id: "turquesa", name: "Turquesa", primary: "oklch(0.79 0.12 195)", foreground: fg(195) },
]

export const DYNAMIC_ID = "dinamico"
export const DEFAULT_THEME = "verde"
export const THEME_STORAGE_KEY = "decibel-theme"
const LEGACY_THEME_KEY = "musica-theme"
export const THEME_EVENT = "decibel:theme"

const VARS = (primary: string, foreground: string): Record<string, string> => ({
  "--primary": primary,
  "--primary-foreground": foreground,
  "--ring": primary,
  "--sidebar-primary": primary,
  "--sidebar-primary-foreground": foreground,
  "--sidebar-ring": primary,
})

export function applyAccent(primary: string, foreground: string) {
  const s = document.documentElement.style
  for (const [k, v] of Object.entries(VARS(primary, foreground))) s.setProperty(k, v)
}

export function setTheme(id: string) {
  localStorage.setItem(THEME_STORAGE_KEY, id)
  localStorage.removeItem(LEGACY_THEME_KEY)
  document.documentElement.dataset.theme = id
  const t = THEMES.find((x) => x.id === id)
  if (t) applyAccent(t.primary, t.foreground)
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: id }))
}

export function getTheme() {
  if (typeof window === "undefined") return DEFAULT_THEME
  return localStorage.getItem(THEME_STORAGE_KEY) ?? localStorage.getItem(LEGACY_THEME_KEY) ?? DEFAULT_THEME
}

/** Inline <head> script: applies the saved theme before first paint (static-export safe). */
export const themeBootScript = `(function(){try{var T=${JSON.stringify(
  Object.fromEntries(THEMES.map((t) => [t.id, [t.primary, t.foreground]])),
)};var id=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})||localStorage.getItem(${JSON.stringify(LEGACY_THEME_KEY)})||${JSON.stringify(DEFAULT_THEME)};var d=document.documentElement;d.dataset.theme=id;var v=T[id];if(v){var s=d.style;["--primary","--ring","--sidebar-primary","--sidebar-ring"].forEach(function(k){s.setProperty(k,v[0])});["--primary-foreground","--sidebar-primary-foreground"].forEach(function(k){s.setProperty(k,v[1])})}}catch(e){}})()`
