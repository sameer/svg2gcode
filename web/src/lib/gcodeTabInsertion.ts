/**
 * Post-processes raw GCode to insert holding tabs on cut paths.
 *
 * Two-phase geometry-based approach:
 *
 * Phase 1 – Place tab anchors: walk the deepest (through-cut) contours and
 *   drop tab anchor points every `tabSpacing` mm.  These are fixed XY
 *   positions that define circular "no-go" zones of radius `tabWidth / 2`.
 *
 * Phase 2 – Enforce tabs with a state machine: track whether the tool is
 *   currently inside a tab zone.  Rise to tabZ on entry, stay raised for
 *   all segments inside the zone, plunge back on exit.  This avoids the
 *   "fence post" problem of per-segment rise/plunge cycles.
 */

export interface TabInsertionOptions {
  materialThickness: number // mm
  tabWidth: number          // mm – diameter of the tab zone
  tabHeight: number         // mm – how far below the surface the tab bridge sits
  tabSpacing: number        // mm – distance between tab centres along the contour
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface Vec2 { x: number; y: number }
interface TabAnchor { x: number; y: number }

function parseWords(line: string): Map<string, number> {
  const words = new Map<string, number>()
  const re = /([A-Z])(-?\d+\.?\d*)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    words.set(m[1].toUpperCase(), parseFloat(m[2]))
  }
  return words
}

function fmt(v: number): string {
  return Number.isInteger(v) ? v.toFixed(1) : parseFloat(v.toFixed(4)).toString()
}

function dist2d(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return Math.sqrt(dx * dx + dy * dy)
}

function lerp2d(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

function pointInAnyZone(x: number, y: number, anchors: TabAnchor[], r: number): boolean {
  const r2 = r * r
  for (const a of anchors) {
    const dx = x - a.x
    const dy = y - a.y
    if (dx * dx + dy * dy <= r2) return true
  }
  return false
}

/**
 * Find the earliest parametric t ∈ (0, 1] where the segment A→B enters
 * any tab zone.  Returns the t value, or null if no entry occurs.
 */
function findFirstEntry(
  ax: number, ay: number, bx: number, by: number,
  anchors: TabAnchor[], r: number,
): number | null {
  let best: number | null = null
  const dx = bx - ax, dy = by - ay
  const a = dx * dx + dy * dy
  if (a < 1e-12) return null

  for (const anchor of anchors) {
    const fx = ax - anchor.x, fy = ay - anchor.y
    const b = 2 * (fx * dx + fy * dy)
    const c = fx * fx + fy * fy - r * r
    const disc = b * b - 4 * a * c
    if (disc < 0) continue
    const sqrtDisc = Math.sqrt(disc)
    const t1 = (-b - sqrtDisc) / (2 * a) // entry
    const tEntry = Math.max(0, t1)
    const t2 = (-b + sqrtDisc) / (2 * a) // exit
    if (tEntry >= Math.min(1, t2)) continue // no valid range
    if (tEntry > 0 && (best === null || tEntry < best)) best = tEntry
  }
  return best
}

/**
 * Find the earliest parametric t ∈ (0, 1] where the segment A→B exits
 * ALL tab zones (i.e. the first point after which no zone contains the tool).
 */
function findFirstExit(
  ax: number, ay: number, bx: number, by: number,
  anchors: TabAnchor[], r: number,
): number | null {
  // Collect all exit t values for zones that contain any part of this segment
  let latestExitBeforeEnd: number | null = null
  const dx = bx - ax, dy = by - ay
  const a = dx * dx + dy * dy
  if (a < 1e-12) return null

  for (const anchor of anchors) {
    const fx = ax - anchor.x, fy = ay - anchor.y
    const b = 2 * (fx * dx + fy * dy)
    const c = fx * fx + fy * fy - r * r
    const disc = b * b - 4 * a * c
    if (disc < 0) continue
    const sqrtDisc = Math.sqrt(disc)
    const t1 = (-b - sqrtDisc) / (2 * a)
    const t2 = (-b + sqrtDisc) / (2 * a)
    const tEntry = Math.max(0, t1)
    const tExit = Math.min(1, t2)
    if (tEntry >= tExit) continue
    // This zone overlaps the segment — we need to be past its exit
    // We want the FIRST exit point, but need to account for overlapping zones
    // The actual exit is the LAST zone exit we encounter
    if (tExit > 0 && tExit <= 1) {
      if (latestExitBeforeEnd === null || tExit > latestExitBeforeEnd) {
        latestExitBeforeEnd = tExit
      }
    }
  }

  // The exit point is where we leave all zones. But overlapping zones might
  // extend further. Check that the point at the candidate exit is actually
  // outside all zones.
  if (latestExitBeforeEnd !== null && latestExitBeforeEnd < 1 - 1e-9) {
    const pt = lerp2d({ x: ax, y: ay }, { x: bx, y: by }, Math.min(1, latestExitBeforeEnd + 1e-6))
    if (!pointInAnyZone(pt.x, pt.y, anchors, r)) {
      return latestExitBeforeEnd
    }
    // Still inside another zone — no real exit on this segment
  }

  return null
}

// ── Phase 1: place tab anchors along through-cut contours ────────────────────

/** Angle (radians) between two direction vectors. Returns 0–π. */
function angleBetween(ax: number, ay: number, bx: number, by: number): number {
  const la = Math.sqrt(ax * ax + ay * ay)
  const lb = Math.sqrt(bx * bx + by * by)
  if (la < 1e-9 || lb < 1e-9) return 0
  const dot = (ax * bx + ay * by) / (la * lb)
  return Math.acos(Math.max(-1, Math.min(1, dot)))
}

// Angle threshold: corners sharper than this suppress tab placement.
// 60° means we skip tabs at any turn > 60°.
const CORNER_ANGLE_THRESHOLD = (60 / 180) * Math.PI

function collectTabAnchors(
  gcode: string,
  tabZ: number,
  tabSpacing: number,
  tabWidth: number,
): TabAnchor[] {
  const lines = gcode.split('\n')
  const anchors: TabAnchor[] = []

  // Minimum straight-path distance after a sharp corner before we allow a tab
  const cornerClearance = tabWidth * 2

  let modalCmd: 'G0' | 'G1' = 'G0'
  let curX = 0, curY = 0, curZ = 0
  let accumDist = 0
  // Direction tracking for corner detection
  let prevDirX = 0, prevDirY = 0, hasPrevDir = false
  // Distance since last sharp corner — must exceed cornerClearance before placing a tab
  let distSinceCorner = cornerClearance // start high so we can place tabs immediately

  for (const rawLine of lines) {
    const stripped = rawLine.split(';')[0].split('(')[0].trim()
    if (!stripped) continue

    const words = parseWords(stripped)
    if (words.has('G')) {
      const g = words.get('G')!
      if (g === 0) modalCmd = 'G0'
      else if (g === 1) modalCmd = 'G1'
    }

    const hasX = words.has('X'), hasY = words.has('Y'), hasZ = words.has('Z')
    const newX = hasX ? words.get('X')! : curX
    const newY = hasY ? words.get('Y')! : curY
    const newZ = hasZ ? words.get('Z')! : curZ

    const isCut = modalCmd === 'G1' && (hasX || hasY)
    const isDeep = curZ <= tabZ && newZ <= tabZ

    if (!isCut || !isDeep) {
      if (modalCmd === 'G0' || (hasZ && !hasX && !hasY)) {
        accumDist = 0
        hasPrevDir = false
        distSinceCorner = cornerClearance
      }
      curX = newX; curY = newY; curZ = newZ
      continue
    }

    const dx = newX - curX, dy = newY - curY
    const segLen = Math.sqrt(dx * dx + dy * dy)
    if (segLen < 0.001) { curX = newX; curY = newY; continue }

    // Corner detection: check angle between this segment and the previous one
    if (hasPrevDir) {
      const angle = angleBetween(prevDirX, prevDirY, dx, dy)
      if (angle > CORNER_ANGLE_THRESHOLD) {
        distSinceCorner = 0 // just hit a corner — start cooldown
      }
    }
    prevDirX = dx; prevDirY = dy; hasPrevDir = true

    let walked = 0
    while (walked < segLen) {
      const toNext = tabSpacing - accumDist
      if (toNext > segLen - walked) {
        accumDist += segLen - walked
        distSinceCorner += segLen - walked
        walked = segLen
      } else {
        walked += toNext
        distSinceCorner += toNext

        if (distSinceCorner >= cornerClearance) {
          // Safe to place a tab here — far enough from any sharp corner
          const t = walked / segLen
          anchors.push(lerp2d({ x: curX, y: curY }, { x: newX, y: newY }, t))
          accumDist = 0
        } else {
          // Too close to a corner — defer tab placement, keep accumulating
          // Don't reset accumDist so we try again shortly
          accumDist = tabSpacing  // will trigger placement check on next segment
        }
      }
    }

    curX = newX; curY = newY; curZ = newZ
  }

  return anchors
}

// ── Phase 2: state-machine enforcement of tab zones ──────────────────────────

export function insertTabs(gcode: string, opts: TabInsertionOptions): string {
  const { materialThickness, tabWidth, tabHeight, tabSpacing } = opts
  const tabZ = -(materialThickness - tabHeight)
  const tabRadius = tabWidth / 2

  const anchors = collectTabAnchors(gcode, tabZ, tabSpacing, tabWidth)
  if (anchors.length === 0) return gcode

  const lines = gcode.split('\n')
  const out: string[] = []

  let modalCmd: 'G0' | 'G1' = 'G0'
  let curX = 0, curY = 0, curZ = 0
  let curF: number | null = null
  let plungeF: number | null = null

  // State machine: are we currently raised inside a tab zone?
  let inTab = false
  let cuttingZ = 0 // the Z depth we were cutting at before entering the tab

  for (const rawLine of lines) {
    const stripped = rawLine.split(';')[0].split('(')[0].trim()
    if (!stripped) { out.push(rawLine); continue }

    const words = parseWords(stripped)

    if (words.has('G')) {
      const g = words.get('G')!
      if (g === 0) modalCmd = 'G0'
      else if (g === 1) modalCmd = 'G1'
    }
    if (words.has('F')) curF = words.get('F')!

    const hasX = words.has('X'), hasY = words.has('Y'), hasZ = words.has('Z')
    const newX = hasX ? words.get('X')! : curX
    const newY = hasY ? words.get('Y')! : curY
    const newZ = hasZ ? words.get('Z')! : curZ

    if (modalCmd === 'G1' && hasZ && !hasX && !hasY && curF !== null) {
      plungeF = curF
    }

    const pf = plungeF ?? curF
    const plungeFeedStr = pf !== null ? ` F${fmt(pf)}` : ''
    const feedStr = curF !== null ? ` F${fmt(curF)}` : ''

    const isCut = modalCmd === 'G1' && (hasX || hasY)
    const isDeepEnough = curZ < tabZ && newZ <= curZ

    // ── Non-cut or shallow moves: exit tab state if needed ──
    if (!isCut || !isDeepEnough) {
      if (inTab) {
        // Plunge back before leaving cut mode or changing depth
        out.push(`G1 Z${fmt(cuttingZ)}${plungeFeedStr}`)
        inTab = false
      }
      // If this is a Z-only plunge to a new depth while cutting, update cuttingZ tracking
      if (modalCmd === 'G1' && hasZ && !hasX && !hasY && newZ < tabZ) {
        cuttingZ = newZ
      }
      curX = newX; curY = newY; curZ = newZ
      out.push(rawLine)
      continue
    }

    // ── G1 cut move below tabZ — enforce tab zones ──
    const startIn = pointInAnyZone(curX, curY, anchors, tabRadius)
    const endIn = pointInAnyZone(newX, newY, anchors, tabRadius)

    if (inTab) {
      // We're already raised at tabZ
      if (endIn) {
        // Still inside a tab zone — stay raised, emit XY only
        out.push(`G1 X${fmt(newX)} Y${fmt(newY)}${feedStr}`)
      } else {
        // Exiting the tab zone on this segment
        const tExit = findFirstExit(curX, curY, newX, newY, anchors, tabRadius)
        if (tExit !== null && tExit < 1 - 1e-6) {
          const exitPt = lerp2d({ x: curX, y: curY }, { x: newX, y: newY }, tExit)
          // Move to exit point at tab height
          out.push(`G1 X${fmt(exitPt.x)} Y${fmt(exitPt.y)}${feedStr}`)
          // Plunge back to cutting depth
          out.push(`G1 Z${fmt(cuttingZ)}${plungeFeedStr}`)
          // Continue to segment end at cutting depth
          out.push(`G1 X${fmt(newX)} Y${fmt(newY)}${feedStr}`)
        } else {
          // Couldn't find exit precisely — plunge and emit full move
          out.push(`G1 Z${fmt(cuttingZ)}${plungeFeedStr}`)
          out.push(`G1 X${fmt(newX)} Y${fmt(newY)}${feedStr}`)
        }
        inTab = false
      }
    } else {
      // We're cutting at full depth
      if (startIn) {
        // Start is already inside a zone (edge case — rise immediately)
        cuttingZ = curZ
        out.push(`G1 Z${fmt(tabZ)}${plungeFeedStr}`)
        inTab = true
        if (endIn) {
          // Entire segment in zone
          out.push(`G1 X${fmt(newX)} Y${fmt(newY)}${feedStr}`)
        } else {
          // Exits zone during this segment
          const tExit = findFirstExit(curX, curY, newX, newY, anchors, tabRadius)
          if (tExit !== null && tExit < 1 - 1e-6) {
            const exitPt = lerp2d({ x: curX, y: curY }, { x: newX, y: newY }, tExit)
            out.push(`G1 X${fmt(exitPt.x)} Y${fmt(exitPt.y)}${feedStr}`)
            out.push(`G1 Z${fmt(cuttingZ)}${plungeFeedStr}`)
            out.push(`G1 X${fmt(newX)} Y${fmt(newY)}${feedStr}`)
          } else {
            out.push(`G1 X${fmt(newX)} Y${fmt(newY)}${feedStr}`)
          }
          inTab = false
        }
      } else if (endIn) {
        // Enters a zone during this segment
        const tEntry = findFirstEntry(curX, curY, newX, newY, anchors, tabRadius)
        if (tEntry !== null && tEntry > 1e-6) {
          const entryPt = lerp2d({ x: curX, y: curY }, { x: newX, y: newY }, tEntry)
          // Cut to entry point at full depth
          out.push(`G1 X${fmt(entryPt.x)} Y${fmt(entryPt.y)}${feedStr}`)
          // Rise to tab height
          cuttingZ = curZ
          out.push(`G1 Z${fmt(tabZ)}${plungeFeedStr}`)
          // Continue to end at tab height
          out.push(`G1 X${fmt(newX)} Y${fmt(newY)}${feedStr}`)
        } else {
          // Entry at very start
          cuttingZ = curZ
          out.push(`G1 Z${fmt(tabZ)}${plungeFeedStr}`)
          out.push(`G1 X${fmt(newX)} Y${fmt(newY)}${feedStr}`)
        }
        inTab = true
      } else {
        // Both endpoints outside — check if segment passes through a zone
        const tEntry = findFirstEntry(curX, curY, newX, newY, anchors, tabRadius)
        if (tEntry !== null) {
          const entryPt = lerp2d({ x: curX, y: curY }, { x: newX, y: newY }, tEntry)
          // Cut to entry
          out.push(`G1 X${fmt(entryPt.x)} Y${fmt(entryPt.y)}${feedStr}`)
          // Rise
          cuttingZ = curZ
          out.push(`G1 Z${fmt(tabZ)}${plungeFeedStr}`)
          // Find exit
          const tExit = findFirstExit(curX, curY, newX, newY, anchors, tabRadius)
          if (tExit !== null && tExit < 1 - 1e-6) {
            const exitPt = lerp2d({ x: curX, y: curY }, { x: newX, y: newY }, tExit)
            out.push(`G1 X${fmt(exitPt.x)} Y${fmt(exitPt.y)}${feedStr}`)
            out.push(`G1 Z${fmt(cuttingZ)}${plungeFeedStr}`)
            out.push(`G1 X${fmt(newX)} Y${fmt(newY)}${feedStr}`)
            inTab = false
          } else {
            // Entered but didn't exit — stay raised
            out.push(`G1 X${fmt(newX)} Y${fmt(newY)}${feedStr}`)
            inTab = true
          }
        } else {
          // No intersection at all — emit original line
          out.push(rawLine)
        }
      }
    }

    curX = newX; curY = newY; curZ = newZ
  }

  // If we end while still in a tab, plunge back
  if (inTab) {
    const pf2 = plungeF ?? curF
    out.push(`G1 Z${fmt(cuttingZ)}${pf2 !== null ? ` F${fmt(pf2)}` : ''}`)
  }

  return out.join('\n')
}
