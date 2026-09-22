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
})

const emit = defineEmits(['place', 'select', 'hover', 'hoverend', 'groundclick', 'toggle-base'])

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

function onMouseDown(e) {
  if (props.selectedType) return // placement mode uses clicks, not drag
  const w = screenToWorld(e.clientX, e.clientY)
  if (!w) return
  panStart = { clientX: e.clientX, clientY: e.clientY, center: center.value || defaultCenter() }
  panning.value = false // becomes true once the pointer actually moves
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
  // If the pointer leaves the map mid-drag, finish the pan gracefully.
  if (panStart) endPan()
}

// Click handler on the whole SVG. While placing, a click anywhere
// (even over the ghost preview or another structure) drops the structure at
// the previewed, in-bounds position. This prevents large structures like the
// Command Center from being impossible to place because the ghost/other
// structures sat under the cursor.
function onSvgClick() {
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
  // While placing, let the click bubble to the SVG so the new structure is
  // dropped even if the cursor is over an existing structure.
  if (props.selectedType) return
  // A pan drag that ends over a structure shouldn't select it.
  if (panning.value) return
  // When not placing, clicking a structure selects it (for upgrade/details).
  e?.stopPropagation()
  emit('select', structure.id)
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
    @mouseup="endPan"
    @click="onSvgClick"
    @wheel="onWheel"
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

    <!-- placed structures -->
    <g
      v-for="s in structures"
      :key="s.id"
      class="structure"
      :class="{ selectable: !selectedType, selected: s.id === selectedStructureId, busy: isBusy(s) }"
      @click="onStructureClick(s, $event)"
      @mousemove="onStructureHover(s, $event)"
      @mouseleave="onStructureLeave"
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

    <!-- placement preview (never intercepts pointer events, so the click
         always reaches the ground and places the structure) -->
    <g v-if="preview" opacity="0.6" style="pointer-events: none">
      <polygon :points="preview.left" :fill="shade(preview.color, 0.35)" />
      <polygon :points="preview.right" :fill="shade(preview.color, 0.2)" />
      <polygon :points="preview.top" :fill="preview.color" stroke="#ffffff" stroke-width="1.5" />
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
