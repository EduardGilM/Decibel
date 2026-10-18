/**
 * Revision of the playback defaults. 2 (0.1.5): normalisation and gapless on, crossfade off. Crossfade stays off
 * by default because it would overlap the songs that gapless joins seamlessly (live albums, DJ mixes, classical).
 */
export const SETTINGS_DEFAULTS = 2

type Saved = Partial<{ crossfade: number; gapless: boolean; normalize: boolean; defaults: number }>

/** Values saved before revision 2 move to the new defaults once (normalisation used to be off by default). */
export function migrateSettings<T extends Saved>(saved: T): T & { defaults: number } {
  if ((saved.defaults ?? 0) >= SETTINGS_DEFAULTS) return saved as T & { defaults: number }
  return { ...saved, normalize: true, gapless: true, defaults: SETTINGS_DEFAULTS }
}
