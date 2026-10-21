/**
 * Pure decisions for the mobile profile drawer swipe. With Android gesture navigation the screen edge belongs to
 * the system back gesture, so the drawer opens from a rightward swipe that starts anywhere in the left half.
 */
export const DRAWER_START_FRACTION = 0.5
/** Below this travel (px) on both axes nothing is decided yet. */
export const DRAWER_SLOP = 12
/** Horizontal travel (px) needed to claim the gesture. */
export const DRAWER_CLAIM = 50
/** |dx| must exceed this many times |dy|. */
export const DRAWER_RATIO = 1.5
/** px/ms: a faster release decides by direction. */
export const DRAWER_FLING = 0.5

export type DrawerGestureKind = "open" | "close"

export function drawerStartAllowed(x: number, viewportWidth: number) {
  return x >= 0 && x <= viewportWidth * DRAWER_START_FRACTION
}

/** "wait" until intent is clear, "claim" a clear horizontal swipe in the right direction, otherwise "reject". */
export function drawerGestureIntent({ dx, dy, kind }: { dx: number; dy: number; kind: DrawerGestureKind }): "wait" | "claim" | "reject" {
  const ax = Math.abs(dx), ay = Math.abs(dy)
  if (ax < DRAWER_SLOP && ay < DRAWER_SLOP) return "wait"
  if (ax <= ay * DRAWER_RATIO) return ay >= DRAWER_SLOP ? "reject" : "wait"
  if (kind === "open" ? dx < 0 : dx > 0) return "reject"
  return ax > DRAWER_CLAIM ? "claim" : "wait"
}

/** Panel offset (px pushed left of fully open) while dragging; travel counts from the claim point. */
export function drawerDragOffset({ dx, kind, width }: { dx: number; kind: DrawerGestureKind; width: number }) {
  const travel = Math.abs(dx) - DRAWER_CLAIM
  return Math.min(width, Math.max(0, kind === "open" ? width - travel : travel))
}

/** On release: true = snap open. A fling decides by direction, otherwise by how much of the panel is shown. */
export function drawerSettleOpen({ kind, shown, width, velocity }: { kind: DrawerGestureKind; shown: number; width: number; velocity: number }) {
  if (Math.abs(velocity) > DRAWER_FLING) return velocity > 0
  return shown > width * (kind === "open" ? 0.35 : 0.65)
}

/** Zones that keep their own horizontal gestures. */
export const DRAWER_IGNORE = "input, textarea, select, [role=slider], [data-swipe-ignore], [data-swipe-row], [data-mini-player], [data-drawer-ignore], [data-vaul-drawer]"
