<script setup>
import { computed, ref } from 'vue'

/**
 * Renders the player's terrain in an isometric ("2.5D") projection.
 *
 * The terrain is a width x height field in generic units. We draw it as a
 * diamond and place structures as raised isometric boxes. Clicking a cell
 * while a structure type is selected asks the parent to place it.
 */
const props = defineProps({
  width: { type: Number, required: true },      // generic units
  height: { type: Number, required: true },
  structures: { type: Array, default: () => [] },
  // The structure type currently selected for placement (or null).
  selectedType: { type: Object, default: null },
  // The id of a placed structure currently selected (or null).
  selectedStructureId: { type: Number, default: null },
  // Current time (ms) driven by the parent's clock, for countdowns.
  nowTs: { type: Number, default: () => Date.now() },
  // Size of one generic unit in screen pixels (zoom).
  unitPx: { type: Number, default: 0.7 },
  // When true, render the orbital defense base (blue, in space) instead of
  // the terrestrial (green grass) base.
  planetary: { type: Boolean, default: false },
  // Size of one grid cell in generic units (1 cell = cellSize x cellSize).
  cellSize: { type: Number, default: 10 },
  // Fleet markers (planetary base only): [{ id, name, x, y, size, ... }].
  fleets: { type: Array, default: () => [] },
})

const emit = defineEmits([
  'place',
  'select',
  'hover',
  'hoverend',
  'groundclick',
  'toggle-base',
  'move',
  'move-fleet',
])

// Isometric transform: a tile (gx, gy) in generic units maps to screen (sx, sy).
// Classic 2:1 isometric projection.
const TILE_W = computed(() => props.unitPx * 2) // horizontal span per unit
const TILE_H = computed(() => props.unitPx)     // vertical span per unit

function iso(gx, gy) {
  return {
    x: (gx - gy) * TILE_W.value,
    y: (gx + gy) * TILE_H.value,
  }
}

// Four corners of the terrain diamond.
const corners = computed(() => {
  const c = [iso(0, 0), iso(props.width, 0), iso(props.width, props.height), iso(0, props.height)]
  return c
})

// Natural bounding box of the whole terrain (fully zoomed out, no panning).
// This is the diamond plus some padding; it's what we frame the map to by
// default and the reference we clamp panning against.
const baseBounds = computed(() => {
  const xs = corners.value.map((p) => p.x)
  const ys = corners.value.map((p) => p.y)
  const pad = 40
  const minX = Math.min(...xs) - pad
  const maxX = Math.max(...xs) + pad
  // structures are raised, leave headroom at the top
  const minY = Math.min(...ys) - pad - 30
  const maxY = Math.max(...ys) + pad
  return { minX, minY, w: maxX - minX, h: maxY - minY }
})

// --- Zoom & pan state ---
// zoom is a multiplier on top of the base framing: 1 = fit the whole map,
// >1 = zoomed in (smaller viewBox), <1 = zoomed out.
const MIN_ZOOM = 0.6
const MAX_ZOOM = 4
const ZOOM_STEP = 1.2 // multiplicative step per wheel notch / button press

const zoom = ref(1)
// Center of the viewport in world coordinates. Starts at the map center.
const center = ref(null)

function defaultCenter() {
  const b = baseBounds.value
  return { x: b.minX + b.w / 2, y: b.minY + b.h / 2 }
}

// The visible viewBox derived from zoom + center, clamped so we never scroll
// too far away from the terrain.
const bounds = computed(() => {
  const b = baseBounds.value
  const w = b.w / zoom.value
  const h = b.h / zoom.value
  const c = center.value || defaultCenter()

  // Allow panning up to half the base size beyond each edge so the map can be
  // recentered comfortably without flying off into empty space.
  const slack = 0.5
  const minCx = b.minX - b.w * slack + w / 2
  const maxCx = b.minX + b.w + b.w * slack - w / 2
  const minCy = b.minY - b.h * slack + h / 2
  const maxCy = b.minY + b.h + b.h * slack - h / 2

  const cx = clamp(c.x, Math.min(minCx, maxCx), Math.max(minCx, maxCx))
  const cy = clamp(c.y, Math.min(minCy, maxCy), Math.max(minCy, maxCy))

  return { minX: cx - w / 2, minY: cy - h / 2, w, h }
})

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}

const groundPoints = computed(() =>
  corners.value.map((p) => `${p.x},${p.y}`).join(' ')
)

// Soft cell grid: two families of iso-projected lines, one per grid axis.
// Each cell is `cellSize` x `cellSize` generic units (a 10x10 area = 1 cell).
// Lines run edge-to-edge across the terrain diamond. We cap the number of
// lines so very large maps don't produce thousands of segments.
const MAX_GRID_LINES = 220
const gridLines = computed(() => {
  const step = props.cellSize
  if (!step || step <= 0) return []

  // If the map has too many cells for a given axis, thin the lines out by
  // drawing every Nth line so the total stays readable and performant.
  const cellsX = Math.ceil(props.width / step)
  const cellsY = Math.ceil(props.height / step)
  const strideX = Math.max(1, Math.ceil(cellsX / MAX_GRID_LINES))
  const strideY = Math.max(1, Math.ceil(cellsY / MAX_GRID_LINES))

  const lines = []
  // Lines of constant gx (vary gy from 0..height).
  for (let gx = 0; gx <= props.width + 0.001; gx += step * strideX) {
    const a = iso(gx, 0)
    const b = iso(gx, props.height)
    lines.push(`${a.x},${a.y} ${b.x},${b.y}`)
  }
  // Lines of constant gy (vary gx from 0..width).
  for (let gy = 0; gy <= props.height + 0.001; gy += step * strideY) {
    const a = iso(0, gy)
    const b = iso(props.width, gy)
    lines.push(`${a.x},${a.y} ${b.x},${b.y}`)
  }
  return lines
})

// Height of the raised block for structures (visual only).
const BLOCK_H = 14

/**
 * Build the SVG polygons for one structure rendered as an isometric box:
 * a top face plus left and right side faces for a 3D look.
 */
function structurePolys(s) {
  const w = s.type.width
  const h = s.type.height
  const x = s.x
  const y = s.y

  // top face corners (in generic units) -> iso
  const t1 = iso(x, y)
  const t2 = iso(x + w, y)
  const t3 = iso(x + w, y + h)
  const t4 = iso(x, y + h)

  const top = `${t1.x},${t1.y - BLOCK_H} ${t2.x},${t2.y - BLOCK_H} ${t3.x},${t3.y - BLOCK_H} ${t4.x},${t4.y - BLOCK_H}`
  // left face (from t4 down)
  const left = `${t4.x},${t4.y - BLOCK_H} ${t3.x},${t3.y - BLOCK_H} ${t3.x},${t3.y} ${t4.x},${t4.y}`
  // right face (from t2 down)
  const right = `${t2.x},${t2.y - BLOCK_H} ${t3.x},${t3.y - BLOCK_H} ${t3.x},${t3.y} ${t2.x},${t2.y}`

  // center of the top face for the level label
  const cx = (t1.x + t3.x) / 2
  const cy = (t1.y + t3.y) / 2 - BLOCK_H

  return { top, left, right, cx, cy }
}

/**
 * Build an iso-projected polygon approximating the attack range of a defense
 * structure. Range is given in cells; we convert to generic units, then sample
 * a circle (in grid space) around the structure's footprint center and project
 * each sample through iso(). A circle in grid space becomes a diamond-ish
 * ellipse on screen, which reads naturally on the isometric map.
 */
function rangePolygon(s) {
  const rangeCells = s.range ?? s.type?.range ?? 0
  if (!rangeCells || rangeCells <= 0) return null

  const cx = s.x + s.type.width / 2
  const cy = s.y + s.type.height / 2
  // Range radius in grid units. The footprint half-size is added so the ring
  // starts from the edge of the structure rather than its center.
  const radius = rangeCells * props.cellSize + Math.max(s.type.width, s.type.height) / 2

  const pts = []
  const SEGMENTS = 48
  for (let i = 0; i < SEGMENTS; i++) {
    const ang = (i / SEGMENTS) * Math.PI * 2
    const gx = cx + Math.cos(ang) * radius
    const gy = cy + Math.sin(ang) * radius
    const p = iso(gx, gy)
    pts.push(`${p.x},${p.y - BLOCK_H}`)
  }
  return pts.join(' ')
}

// Raised height of a fleet marker (visual only, taller than structures).
const FLEET_H = 22

/**
 * Build the iso polygons + label anchor for a fleet marker (a small floating
 * 10x10 platform). Uses the fleet's current x/y (or a live drag position).
 */
function fleetPolys(f, ox = null, oy = null) {
  const size = f.size || 10
  const x = ox ?? f.x
  const y = oy ?? f.y

  const t1 = iso(x, y)
  const t2 = iso(x + size, y)
  const t3 = iso(x + size, y + size)
  const t4 = iso(x, y + size)

  const top = `${t1.x},${t1.y - FLEET_H} ${t2.x},${t2.y - FLEET_H} ${t3.x},${t3.y - FLEET_H} ${t4.x},${t4.y - FLEET_H}`
  const left = `${t4.x},${t4.y - FLEET_H} ${t3.x},${t3.y - FLEET_H} ${t3.x},${t3.y} ${t4.x},${t4.y}`
  const right = `${t2.x},${t2.y - FLEET_H} ${t3.x},${t3.y - FLEET_H} ${t3.x},${t3.y} ${t2.x},${t2.y}`
  const cx = (t1.x + t3.x) / 2
  const cy = (t1.y + t3.y) / 2 - FLEET_H

  return { top, left, right, cx, cy }
}

function shade(hex, amount) {
  // darken a hex color by amount (0..1)
  const h = hex.replace('#', '')
  const r = Math.max(0, Math.round(parseInt(h.slice(0, 2), 16) * (1 - amount)))
  const g = Math.max(0, Math.round(parseInt(h.slice(2, 4), 16) * (1 - amount)))
  const b = Math.max(0, Math.round(parseInt(h.slice(4, 6), 16) * (1 - amount)))
  return `rgb(${r},${g},${b})`
}

// --- Placement preview / click handling ---
const hover = ref(null) // { gx, gy } snapped generic coords

const svgRef = ref(null)

// Convert a screen point (within the SVG) to world (viewBox) coordinates.
// preserveAspectRatio="xMidYMid meet" letterboxes the viewBox inside the
// element, so we must account for the meet scale and the centering offset.
function screenToWorld(clientX, clientY) {
  const svg = svgRef.value
  if (!svg) return null
  const rect = svg.getBoundingClientRect()
  const b = bounds.value
  // "meet" uses the smaller scale so the whole viewBox fits.
  const scale = Math.min(rect.width / b.w, rect.height / b.h)
  // Centering offset introduced by xMidYMid.
  const offX = (rect.width - b.w * scale) / 2
  const offY = (rect.height - b.h * scale) / 2
  const px = b.minX + (clientX - rect.left - offX) / scale
  const py = b.minY + (clientY - rect.top - offY) / scale
  return { px, py }
}

// Convert a screen point (within the SVG) back to generic grid coords.
function screenToGrid(clientX, clientY) {
  const w = screenToWorld(clientX, clientY)
  if (!w) return null
  // invert iso: px = (gx-gy)*TILE_W ; py = (gx+gy)*TILE_H
  const a = w.px / TILE_W.value // gx - gy
  const b = w.py / TILE_H.value // gx + gy
  let gx = (a + b) / 2
  let gy = (b - a) / 2
  return { gx, gy }
}

// --- Zoom & pan interaction ---
function setZoom(nextZoom, anchor) {
  const z = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM)
  if (z === zoom.value) return

  // Keep the world point under `anchor` (screen coords) fixed while zooming.
  // If no anchor, zoom around the current center.
  const world = anchor ? screenToWorld(anchor.x, anchor.y) : null
  const before = world ? { x: world.px, y: world.py } : null

  const c = center.value || defaultCenter()
  if (before) {
    // new_center = anchorWorld - (anchorWorld - oldCenter) * (oldZoom / newZoom)
    const k = zoom.value / z
    center.value = {
      x: before.x - (before.x - c.x) * k,
      y: before.y - (before.y - c.y) * k,
    }
  } else if (!center.value) {
    center.value = c
  }
  zoom.value = z
}

function zoomIn() {
  setZoom(zoom.value * ZOOM_STEP, null)
}

function zoomOut() {
  setZoom(zoom.value / ZOOM_STEP, null)
}

function resetView() {
  zoom.value = 1
  center.value = defaultCenter()
}

function onWheel(e) {
  e.preventDefault()
  const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP
  setZoom(zoom.value * factor, { x: e.clientX, y: e.clientY })
}

// Dragging with the mouse pans the view (only when not placing a structure).
const panning = ref(false)
let panStart = null // { world: {px,py}, clientX, clientY }

// --- Move (drag an existing structure) state ---
// While dragging a structure, `moveDrag` holds the structure being moved and
// the current snapped target position + whether that target is valid (in
// bounds and not overlapping another structure).
const moveDrag = ref(null) // { structure, gx, gy, valid, moved }
let moveStart = null // { structure, clientX, clientY }

// --- Fleet drag state (planetary markers; free move, no collision) ---
const fleetDrag = ref(null) // { fleet, gx, gy, moved }
let fleetStart = null // { fleet, clientX, clientY }

function onFleetMouseDown(fleet, e) {
  if (!e._touch && touchJustHappened()) return // ignore emulated mouse
  if (props.selectedType) return
  if (e.button !== undefined && e.button !== 0) return
  e.stopPropagation()
  fleetStart = { fleet, clientX: e.clientX, clientY: e.clientY }
}

function onFleetDrag(e) {
  if (!fleetStart) return
  const dist = Math.hypot(e.clientX - fleetStart.clientX, e.clientY - fleetStart.clientY)
  if (!fleetDrag.value && dist < 5) return

  const g = screenToGrid(e.clientX, e.clientY)
  if (!g) return
  const f = fleetStart.fleet
  const size = f.size || 10
  let gx = Math.round(g.gx - size / 2)
  let gy = Math.round(g.gy - size / 2)
  gx = Math.max(0, Math.min(gx, props.width - size))
  gy = Math.max(0, Math.min(gy, props.height - size))
  fleetDrag.value = { fleet: f, gx, gy, moved: true }
}

function endFleetMove() {
  if (fleetDrag.value && fleetDrag.value.moved) {
    const { fleet, gx, gy } = fleetDrag.value
    if (gx !== fleet.x || gy !== fleet.y) {
      emit('move-fleet', { id: fleet.id, x: gx, y: gy })
    }
    panning.value = true
    requestAnimationFrame(() => {
      panning.value = false
    })
  }
  fleetStart = null
  fleetDrag.value = null
}

// Rectangle overlap test mirroring the backend, excluding a given id.
function overlapsOther(gx, gy, w, h, ignoreId) {
  for (const s of props.structures) {
    if (s.id === ignoreId) continue
    const ex = s.x
    const ey = s.y
    const ew = s.type.width
    const eh = s.type.height
    const separated =
      gx + w <= ex || ex + ew <= gx || gy + h <= ey || ey + eh <= gy
    if (!separated) return true
  }
  return false
}

function onMouseDown(e) {
  if (!e._touch && touchJustHappened()) return // ignore emulated mouse
  if (props.selectedType) return // placement mode uses clicks, not drag
  // If a structure or fleet move is starting, don't also start a pan.
  if (moveStart || moveDrag.value || fleetStart || fleetDrag.value) return
  const w = screenToWorld(e.clientX, e.clientY)
  if (!w) return
  panStart = { clientX: e.clientX, clientY: e.clientY, center: center.value || defaultCenter() }
  panning.value = false // becomes true once the pointer actually moves
}

// Mousedown directly on a structure: begin a potential move drag (only when
// not in placement mode and the structure isn't under construction/upgrade).
function onStructureMouseDown(structure, e) {
  if (!e._touch && touchJustHappened()) return // ignore emulated mouse
  if (props.selectedType) return
  if (isBusy(structure)) return
  // Left button only.
  if (e.button !== undefined && e.button !== 0) return
  e.stopPropagation() // don't let the SVG start panning
  moveStart = { structure, clientX: e.clientX, clientY: e.clientY }
}

// Track a structure move; snaps to the grid and validates against overlaps.
function onMoveDrag(e) {
  if (!moveStart) return
  const dist = Math.hypot(e.clientX - moveStart.clientX, e.clientY - moveStart.clientY)
  // Small threshold so a click isn't treated as a drag.
  if (!moveDrag.value && dist < 5) return

  const g = screenToGrid(e.clientX, e.clientY)
  if (!g) return
  const s = moveStart.structure
  const tw = s.type.width
  const th = s.type.height
  // Center the footprint on the cursor, then snap and clamp to bounds.
  let gx = Math.round(g.gx - tw / 2)
  let gy = Math.round(g.gy - th / 2)
  gx = Math.max(0, Math.min(gx, props.width - tw))
  gy = Math.max(0, Math.min(gy, props.height - th))

  const valid = !overlapsOther(gx, gy, tw, th, s.id)
  moveDrag.value = { structure: s, gx, gy, valid, moved: true }
}

// Finish a structure move: emit the new position if valid, else cancel.
function endMove() {
  if (moveDrag.value && moveDrag.value.moved) {
    const { structure, gx, gy, valid } = moveDrag.value
    if (valid && (gx !== structure.x || gy !== structure.y)) {
      emit('move', { id: structure.id, x: gx, y: gy })
    }
    // Suppress the click-to-select that follows a drag.
    panning.value = true
    requestAnimationFrame(() => {
      panning.value = false
    })
  }
  moveStart = null
  moveDrag.value = null
}

function onPanMove(e) {
  if (!panStart) return
  const svg = svgRef.value
  if (!svg) return
  const rect = svg.getBoundingClientRect()
  const b = bounds.value
  const scale = Math.min(rect.width / b.w, rect.height / b.h)
  const dxWorld = (e.clientX - panStart.clientX) / scale
  const dyWorld = (e.clientY - panStart.clientY) / scale
  // small threshold so a click isn't treated as a drag
  if (!panning.value && Math.hypot(dxWorld, dyWorld) * scale < 4) return
  panning.value = true
  center.value = {
    x: panStart.center.x - dxWorld,
    y: panStart.center.y - dyWorld,
  }
}

function endPan() {
  panStart = null
  // Defer clearing so the click handler can see we were panning and skip.
  requestAnimationFrame(() => {
    panning.value = false
  })
}

function onMove(e) {
  // Moving a fleet marker takes priority.
  if (fleetStart) {
    onFleetDrag(e)
    return
  }
  // Moving a structure takes priority over panning/placement.
  if (moveStart) {
    onMoveDrag(e)
    return
  }
  // Panning takes over while dragging on the map (not in placement mode).
  if (panStart) {
    onPanMove(e)
    return
  }
  if (!props.selectedType) {
    hover.value = null
    return
  }
  const g = screenToGrid(e.clientX, e.clientY)
  if (!g) return
  const tw = props.selectedType.width
  const th = props.selectedType.height
  // snap top-left so the footprint stays in bounds
  let gx = Math.round(g.gx - tw / 2)
  let gy = Math.round(g.gy - th / 2)
  gx = Math.max(0, Math.min(gx, props.width - tw))
  gy = Math.max(0, Math.min(gy, props.height - th))
  hover.value = { gx, gy }
}

function onLeave() {
  hover.value = null
  // If the pointer leaves the map mid-drag, finish gracefully.
  if (fleetStart || fleetDrag.value) endFleetMove()
  if (moveStart || moveDrag.value) endMove()
  if (panStart) endPan()
}

// Combined mouseup: end a fleet move, then a structure move, otherwise a pan.
function onMouseUp() {
  if (fleetStart || fleetDrag.value) {
    endFleetMove()
    return
  }
  if (moveStart || moveDrag.value) {
    endMove()
    return
  }
  endPan()
}

// -------------------------------------------------------------------------
// Touch support (phones/tablets). One finger pans / drags / taps; two fingers
// pinch-zoom. Touch points are fed into the exact same coordinate + gesture
// functions used by the mouse, via a small event shim.
// -------------------------------------------------------------------------

// After a touch interaction, browsers synthesize mouse events (mousedown/up/
// click). This timestamp lets the mouse handlers ignore that emulated burst so
// a tap doesn't fire its intent twice.
let lastTouchAt = 0
function touchJustHappened() {
  return Date.now() - lastTouchAt < 600
}

// Pinch state: distance + midpoint between the two active fingers.
let pinch = null // { dist, mid: {x, y} }
// Which single-finger gesture is active this touch: 'pan' | 'move' | 'fleet'
// | 'place' | 'tap'. Set on touchstart, resolved on touchend.
let touchGesture = null
// Remembered start point + a moved flag so we can tell a tap from a drag.
let touchStart = null // { x, y, moved }
// A structure/fleet the touch started on (for tap-select / drag-move).
let touchTarget = null // { kind: 'structure'|'fleet', item }

function touchDistance(t) {
  const dx = t[0].clientX - t[1].clientX
  const dy = t[0].clientY - t[1].clientY
  return Math.hypot(dx, dy)
}

function touchMid(t) {
  return {
    x: (t[0].clientX + t[1].clientX) / 2,
    y: (t[0].clientY + t[1].clientY) / 2,
  }
}

// Build a minimal mouse-like event for the existing handlers. Tagged with
// `_touch` so the mouse guards can tell a shim apart from a real mouse event.
function shim(touch) {
  return {
    clientX: touch.clientX,
    clientY: touch.clientY,
    button: 0,
    _touch: true,
    stopPropagation() {},
    preventDefault() {},
  }
}

// touchstart on a structure: remember it as a potential tap/move target.
function onStructureTouchStart(structure, e) {
  if (props.selectedType) return
  touchTarget = { kind: 'structure', item: structure }
}

// touchstart on a fleet marker: remember it as a potential tap/move target.
function onFleetTouchStart(fleet, e) {
  if (props.selectedType) return
  touchTarget = { kind: 'fleet', item: fleet }
}

function onTouchStart(e) {
  lastTouchAt = Date.now()
  const t = e.touches
  if (t.length === 2) {
    // Begin a pinch: cancel any in-flight single-finger gesture.
    pinch = { dist: touchDistance(t), mid: touchMid(t) }
    touchGesture = null
    if (panStart) endPan()
    if (moveStart || moveDrag.value) endMove()
    if (fleetStart || fleetDrag.value) endFleetMove()
    return
  }
  if (t.length !== 1) return

  const pt = t[0]
  touchStart = { x: pt.clientX, y: pt.clientY, moved: false }

  if (props.selectedType) {
    // Placement mode: track a preview point; a tap drops the structure.
    touchGesture = 'place'
    onMove(shim(pt))
    return
  }

  // Dragging a structure/fleet the finger landed on, else pan the map.
  if (touchTarget?.kind === 'structure' && !isBusy(touchTarget.item)) {
    touchGesture = 'move'
    onStructureMouseDown(touchTarget.item, shim(pt))
  } else if (touchTarget?.kind === 'fleet') {
    touchGesture = 'fleet'
    onFleetMouseDown(touchTarget.item, shim(pt))
  } else {
    touchGesture = 'pan'
    onMouseDown(shim(pt))
  }
}

function onTouchMove(e) {
  lastTouchAt = Date.now()
  const t = e.touches
  // Pinch-zoom around the midpoint of the two fingers.
  if (pinch && t.length === 2) {
    e.preventDefault()
    const dist = touchDistance(t)
    const mid = touchMid(t)
    if (pinch.dist > 0) {
      setZoom(zoom.value * (dist / pinch.dist), mid)
    }
    pinch = { dist, mid }
    return
  }
  if (t.length !== 1 || !touchStart) return

  const pt = t[0]
  const moved = Math.hypot(pt.clientX - touchStart.x, pt.clientY - touchStart.y)
  if (moved > 6) touchStart.moved = true
  e.preventDefault()
  onMove(shim(pt))
}

function onTouchEnd(e) {
  lastTouchAt = Date.now()
  // End a pinch once fewer than two fingers remain.
  if (pinch && e.touches.length < 2) {
    pinch = null
    // A remaining finger shouldn't resurrect a stale single-finger gesture.
    touchGesture = null
    touchTarget = null
    touchStart = null
    return
  }
  if (e.touches.length > 0) return // still multi-touch; wait

  const wasTap = touchStart && !touchStart.moved
  const startPt = touchStart ? { clientX: touchStart.x, clientY: touchStart.y } : null

  // Finish whichever gesture was active.
  if (touchGesture === 'fleet') {
    endFleetMove()
  } else if (touchGesture === 'move') {
    endMove()
  } else if (touchGesture === 'pan') {
    endPan()
  }

  // Resolve a tap into the same intent a click would produce.
  if (wasTap && startPt) {
    if (touchGesture === 'place') {
      if (hover.value) emit('place', { x: hover.value.gx, y: hover.value.gy })
    } else if (touchTarget?.kind === 'structure') {
      emit('select', { id: touchTarget.item.id, x: startPt.clientX, y: startPt.clientY })
    } else if (!touchTarget) {
      emit('groundclick')
    }
  }

  touchGesture = null
  touchTarget = null
  touchStart = null
}

// Click handler on the whole SVG. While placing, a click anywhere
// (even over the ghost preview or another structure) drops the structure at
// the previewed, in-bounds position. This prevents large structures like the
// Command Center from being impossible to place because the ghost/other
// structures sat under the cursor.
function onSvgClick() {
  // Ignore the emulated click that follows a touch (handled in onTouchEnd).
  if (touchJustHappened()) return
  // A click that was really a pan drag shouldn't place or deselect.
  if (panning.value) return
  if (props.selectedType) {
    if (hover.value) emit('place', { x: hover.value.gx, y: hover.value.gy })
    return
  }
  // Not placing: a click that reaches the SVG (empty ground) clears selection.
  emit('groundclick')
}

function onStructureClick(structure, e) {
  // Ignore the emulated click that follows a touch (handled in onTouchEnd).
  if (touchJustHappened()) return
  // While placing, let the click bubble to the SVG so the new structure is
  // dropped even if the cursor is over an existing structure.
  if (props.selectedType) return
  // A pan drag that ends over a structure shouldn't select it.
  if (panning.value) return
  // When not placing, clicking a structure selects it (for upgrade/details).
  // Emit the click position too, so the parent can anchor a floating card.
  e?.stopPropagation()
  emit('select', { id: structure.id, x: e?.clientX ?? 0, y: e?.clientY ?? 0 })
}

function onStructureHover(structure, e) {
  // Don't show the collect tooltip while in placement mode.
  if (props.selectedType) return
  emit('hover', { id: structure.id, x: e.clientX, y: e.clientY })
}

function onStructureLeave() {
  emit('hoverend')
}

// --- Build/upgrade state helpers ---
function remainingSeconds(s) {
  if (!s.busy_until) return 0
  const diff = Math.ceil((new Date(s.busy_until).getTime() - props.nowTs) / 1000)
  return Math.max(0, diff)
}

function isBusy(s) {
  return remainingSeconds(s) > 0
}

function busyLabel(s) {
  const secs = remainingSeconds(s)
  const m = Math.floor(secs / 60)
  const sec = secs % 60
  const t = m > 0 ? `${m}m${sec.toString().padStart(2, '0')}` : `${sec}s`
  return (s.busy_kind === 'build' ? '🔨 ' : '⬆ ') + t
}

// preview polygons for the ghost structure
const preview = computed(() => {
  if (!props.selectedType || !hover.value) return null
  const fake = {
    x: hover.value.gx,
    y: hover.value.gy,
    type: props.selectedType,
  }
  return { ...structurePolys(fake), color: props.selectedType.color }
})

// Ghost polygons for the structure currently being dragged to a new spot.
// Colored green when the drop is valid, red when it would overlap.
const movePreview = computed(() => {
  const md = moveDrag.value
  if (!md || !md.moved) return null
  const fake = { x: md.gx, y: md.gy, type: md.structure.type }
  const color = md.valid ? '#4caf50' : '#e05252'
  return { ...structurePolys(fake), color, valid: md.valid }
})

// The structure whose range ring should be shown: the selected one (if it's a
// defense), or the one being dragged.
const rangeRing = computed(() => {
  const s = moveDrag.value?.structure
    ? { ...moveDrag.value.structure, x: moveDrag.value.gx, y: moveDrag.value.gy }
    : props.structures.find((s) => s.id === props.selectedStructureId)
  if (!s) return null
  const poly = rangePolygon(s)
  if (!poly) return null
  return { points: poly, color: s.type.color }
})
</script>

<template>
  <div class="grid-wrap">
  <svg
    ref="svgRef"
    class="grid-svg"
    :class="{ placing: !!selectedType, panning: panning }"
    :viewBox="`${bounds.minX} ${bounds.minY} ${bounds.w} ${bounds.h}`"
    preserveAspectRatio="xMidYMid meet"
    @mousemove="onMove"
    @mouseleave="onLeave"
    @mousedown="onMouseDown"
    @mouseup="onMouseUp"
    @click="onSvgClick"
    @wheel="onWheel"
    @touchstart="onTouchStart"
    @touchmove="onTouchMove"
    @touchend="onTouchEnd"
    @touchcancel="onTouchEnd"
  >
    <defs>
      <linearGradient id="grassShade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#5cb85c" />
        <stop offset="100%" stop-color="#2f6f2f" />
      </linearGradient>
      <linearGradient id="orbitShade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#6fb7ff" />
        <stop offset="100%" stop-color="#123a8a" />
      </linearGradient>
      <!-- Soft glow used to suggest the platform floats in orbit. -->
      <radialGradient id="orbitGlow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#7fd0ff" stop-opacity="0.55" />
        <stop offset="60%" stop-color="#3d8bff" stop-opacity="0.18" />
        <stop offset="100%" stop-color="#3d8bff" stop-opacity="0" />
      </radialGradient>
    </defs>

    <!-- ground: green grass (terrestrial) or a blue orbital platform (planetary) -->
    <template v-if="!planetary">
      <polygon :points="groundPoints" fill="#3c8a3c" stroke="#2b6b2b" stroke-width="2" />
      <polygon :points="groundPoints" fill="url(#grassShade)" opacity="0.35" style="pointer-events:none" />
    </template>
    <template v-else>
      <!-- Halo glow behind the platform to sell the "in space" feel. -->
      <ellipse
        :cx="(bounds.minX + bounds.w / 2)"
        :cy="(bounds.minY + bounds.h / 2)"
        :rx="bounds.w * 0.62"
        :ry="bounds.h * 0.62"
        fill="url(#orbitGlow)"
        style="pointer-events:none"
      />
      <polygon :points="groundPoints" fill="#1b3f86" stroke="#7fd0ff" stroke-width="2.5" />
      <polygon :points="groundPoints" fill="url(#orbitShade)" opacity="0.45" style="pointer-events:none" />
    </template>

    <!-- soft cell grid (1 cell = cellSize x cellSize units). Purely visual;
         never intercepts pointer events. -->
    <g class="cell-grid" style="pointer-events:none">
      <polyline
        v-for="(pts, i) in gridLines"
        :key="i"
        :points="pts"
        fill="none"
        :stroke="planetary ? '#bfe0ff' : '#ffffff'"
        stroke-width="0.6"
        :opacity="planetary ? 0.16 : 0.12"
      />
    </g>

    <!-- attack range ring for the selected/dragged defense structure -->
    <polygon
      v-if="rangeRing"
      :points="rangeRing.points"
      :fill="rangeRing.color"
      fill-opacity="0.10"
      :stroke="rangeRing.color"
      stroke-opacity="0.55"
      stroke-width="1.2"
      stroke-dasharray="4 3"
      style="pointer-events:none"
    />

    <!-- placed structures -->
    <g
      v-for="s in structures"
      :key="s.id"
      class="structure"
      :class="{ selectable: !selectedType, selected: s.id === selectedStructureId, busy: isBusy(s), movable: !selectedType && !isBusy(s) }"
      @mousedown="onStructureMouseDown(s, $event)"
      @click="onStructureClick(s, $event)"
      @mousemove="onStructureHover(s, $event)"
      @mouseleave="onStructureLeave"
      @touchstart="onStructureTouchStart(s, $event)"
    >
      <polygon :points="structurePolys(s).left" :fill="shade(s.type.color, 0.35)" />
      <polygon :points="structurePolys(s).right" :fill="shade(s.type.color, 0.2)" />
      <polygon
        :points="structurePolys(s).top"
        :fill="s.type.color"
        :stroke="s.id === selectedStructureId ? '#ffffff' : (isBusy(s) ? '#f4c542' : '#00000055')"
        :stroke-width="s.id === selectedStructureId ? 2 : (isBusy(s) ? 2 : 1)"
        :stroke-dasharray="isBusy(s) ? '3 2' : null"
      />
      <text
        :x="structurePolys(s).cx"
        :y="structurePolys(s).cy"
        text-anchor="middle"
        dominant-baseline="middle"
        class="lvl-label"
      >{{ isBusy(s) ? busyLabel(s) : 'Nv ' + s.level }}</text>
    </g>

    <!-- fleet markers (planetary only): small floating platforms, draggable -->
    <g
      v-for="f in (planetary ? fleets : [])"
      :key="'fleet-' + f.id"
      class="fleet"
      @mousedown="onFleetMouseDown(f, $event)"
      @touchstart="onFleetTouchStart(f, $event)"
    >
      <polygon :points="fleetPolys(f).left" fill="#1f3b6b" />
      <polygon :points="fleetPolys(f).right" fill="#152a4f" />
      <polygon :points="fleetPolys(f).top" fill="#3d6fc0" stroke="#9fd0ff" stroke-width="1.2" />
      <text
        :x="fleetPolys(f).cx"
        :y="fleetPolys(f).cy"
        text-anchor="middle"
        dominant-baseline="middle"
        class="fleet-label"
      >🛰</text>
    </g>

    <!-- fleet drag ghost -->
    <g v-if="fleetDrag && fleetDrag.moved" opacity="0.6" style="pointer-events:none">
      <polygon :points="fleetPolys(fleetDrag.fleet, fleetDrag.gx, fleetDrag.gy).left" fill="#1f3b6b" />
      <polygon :points="fleetPolys(fleetDrag.fleet, fleetDrag.gx, fleetDrag.gy).right" fill="#152a4f" />
      <polygon :points="fleetPolys(fleetDrag.fleet, fleetDrag.gx, fleetDrag.gy).top" fill="#4caf50" stroke="#ffffff" stroke-width="1.4" />
    </g>

    <!-- placement preview (never intercepts pointer events, so the click
         always reaches the ground and places the structure) -->
    <g v-if="preview" opacity="0.6" style="pointer-events: none">
      <polygon :points="preview.left" :fill="shade(preview.color, 0.35)" />
      <polygon :points="preview.right" :fill="shade(preview.color, 0.2)" />
      <polygon :points="preview.top" :fill="preview.color" stroke="#ffffff" stroke-width="1.5" />
    </g>

    <!-- move ghost: shows where a dragged structure would land. Green = valid
         drop, red = would overlap another structure. -->
    <g v-if="movePreview" opacity="0.65" style="pointer-events: none">
      <polygon :points="movePreview.left" :fill="shade(movePreview.color, 0.35)" />
      <polygon :points="movePreview.right" :fill="shade(movePreview.color, 0.2)" />
      <polygon
        :points="movePreview.top"
        :fill="movePreview.color"
        stroke="#ffffff"
        stroke-width="1.5"
        :stroke-dasharray="movePreview.valid ? null : '3 2'"
      />
    </g>
  </svg>

    <!-- Zoom controls -->
    <div class="zoom-controls">
      <button class="zoom-btn" title="Aproximar" @click="zoomIn">+</button>
      <button class="zoom-btn zoom-reset" title="Reenquadrar mapa" @click="resetView">⤢</button>
      <button class="zoom-btn" title="Afastar" @click="zoomOut">−</button>
    </div>

    <!-- Base switch: toggles between the terrestrial and planetary bases. -->
    <button
      class="base-toggle"
      :class="{ planetary: planetary }"
      :title="planetary ? 'Ir para a base terrestre' : 'Ir para a base planetária'"
      @click="emit('toggle-base')"
    >
      <span class="base-toggle-icon">{{ planetary ? '🌍' : '🛰️' }}</span>
      <span class="base-toggle-label">
        {{ planetary ? 'Base terrestre' : 'Base planetária' }}
      </span>
    </button>
  </div>
</template>

<style scoped>
.grid-wrap {
  position: relative;
  width: 100%;
  height: 100%;
}
.grid-svg {
  width: 100%;
  height: 100%;
  display: block;
  user-select: none;
  cursor: grab;
  touch-action: none;
}
.grid-svg.placing {
  cursor: crosshair;
}
.grid-svg.panning {
  cursor: grabbing;
}
.zoom-controls {
  position: absolute;
  right: 14px;
  bottom: 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  z-index: 20;
}
.zoom-btn {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  border: 1px solid rgba(120, 160, 220, 0.3);
  background: rgba(16, 24, 42, 0.9);
  color: #cfe0ff;
  font-size: 1.1rem;
  font-weight: 700;
  cursor: pointer;
  line-height: 1;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
}
.zoom-btn:hover {
  border-color: #4fc3f7;
  color: #4fc3f7;
}
.zoom-reset {
  font-size: 0.95rem;
}
.base-toggle {
  position: absolute;
  right: 14px;
  bottom: 128px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 14px;
  border-radius: 10px;
  border: 1px solid rgba(120, 160, 220, 0.35);
  background: rgba(16, 24, 42, 0.92);
  color: #cfe0ff;
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
  z-index: 20;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
  transition: border-color 0.15s, color 0.15s, box-shadow 0.15s;
}
.base-toggle:hover {
  border-color: #4fc3f7;
  color: #eaf4ff;
}
.base-toggle.planetary {
  border-color: rgba(125, 208, 255, 0.6);
  box-shadow: 0 0 18px rgba(61, 139, 255, 0.5);
}
.base-toggle-icon {
  font-size: 1.15rem;
  line-height: 1;
}
.base-toggle-label {
  white-space: nowrap;
}
.structure.selectable {
  cursor: pointer;
}
.structure.movable {
  cursor: move;
}
.fleet {
  cursor: move;
}
.fleet-label {
  font-size: 8px;
  pointer-events: none;
}
.structure.busy {
  opacity: 0.7;
}
.lvl-label {
  font-size: 7px;
  font-weight: 700;
  fill: #04101f;
  pointer-events: none;
}
</style>
