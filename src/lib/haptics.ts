/** Light haptic tick (Android WebView / browsers with the Vibration API); silently does nothing elsewhere. */
export const haptic = (ms = 12) => { try { navigator.vibrate?.(ms) } catch { /* no vibration API */ } }
