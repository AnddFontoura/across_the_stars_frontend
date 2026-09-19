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
})

const emit = defineEmits(['place', 'select'])

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

// Bounding box so we can size + offset the SVG viewport.
const bounds = computed(() => {
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

// Convert a screen point (within the SVG) back to generic grid coords.
function screenToGrid(clientX, clientY) {
  const svg = svgRef.value
  if (!svg) return null
  const rect = svg.getBoundingClientRect()
  // account for viewBox scaling
  const scaleX = bounds.value.w / rect.width
  const scaleY = bounds.value.h / rect.height
  const px = bounds.value.minX + (clientX - rect.left) * scaleX
  const py = bounds.value.minY + (clientY - rect.top) * scaleY

  // invert iso: px = (gx-gy)*TILE_W ; py = (gx+gy)*TILE_H
  const a = px / TILE_W.value // gx - gy
  const b = py / TILE_H.value // gx + gy
  let gx = (a + b) / 2
  let gy = (b - a) / 2
  return { gx, gy }
}

function onMove(e) {
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
}

function onGroundClick() {
  // Ground clicks only matter when placing a structure.
  if (!props.selectedType || !hover.value) return
  emit('place', { x: hover.value.gx, y: hover.value.gy })
}

function onStructureClick(structure) {
  // When not placing, clicking a structure selects it (for upgrade/details).
  if (props.selectedType) return
  emit('select', structure.id)
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
  <svg
    ref="svgRef"
    class="grid-svg"
    :class="{ placing: !!selectedType }"
    :viewBox="`${bounds.minX} ${bounds.minY} ${bounds.w} ${bounds.h}`"
    preserveAspectRatio="xMidYMid meet"
    @mousemove="onMove"
    @mouseleave="onLeave"
  >
    <!-- ground (grass) -->
    <polygon :points="groundPoints" fill="#3c8a3c" stroke="#2b6b2b" stroke-width="2" @click="onGroundClick" />
    <polygon :points="groundPoints" fill="url(#grassShade)" opacity="0.35" style="pointer-events:none" />

    <defs>
      <linearGradient id="grassShade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#5cb85c" />
        <stop offset="100%" stop-color="#2f6f2f" />
      </linearGradient>
    </defs>

    <!-- placed structures -->
    <g
      v-for="s in structures"
      :key="s.id"
      class="structure"
      :class="{ selectable: !selectedType, selected: s.id === selectedStructureId, busy: isBusy(s) }"
      @click.stop="onStructureClick(s)"
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

    <!-- placement preview -->
    <g v-if="preview" opacity="0.6">
      <polygon :points="preview.left" :fill="shade(preview.color, 0.35)" />
      <polygon :points="preview.right" :fill="shade(preview.color, 0.2)" />
      <polygon :points="preview.top" :fill="preview.color" stroke="#ffffff" stroke-width="1.5" />
    </g>
  </svg>
</template>

<style scoped>
.grid-svg {
  width: 100%;
  height: 100%;
  display: block;
  user-select: none;
}
.grid-svg.placing {
  cursor: crosshair;
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
