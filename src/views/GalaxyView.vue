<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useGalaxyStore } from '../stores/galaxy'

const router = useRouter()
const galaxy = useGalaxyStore()

// --- Grid geometry ---------------------------------------------------------
// The galaxy holds up to 1000 planets per quadrant. Laid out on a square grid,
// 1000 fits inside 32 x 32 = 1024 cells, so we use 32 columns/rows and leave
// the extra 24 cells as empty space (a quadrant never looks 100% packed).
// Each cell is CELL px; the planet occupies ~46% of it, so ~54% is empty space
// between planets — the "relative spacing" between worlds.
const COLS = 32
const ROWS = 32
const CELL = 120 // px per cell (grid is panned inside its frame, no scrollbars)

const boardWidth = computed(() => COLS * CELL)
const boardHeight = computed(() => ROWS * CELL)

// Scaled board size (what's actually painted after zoom).
const scaledWidth = computed(() => boardWidth.value * zoom.value)
const scaledHeight = computed(() => boardHeight.value * zoom.value)

// Convert a linear slot (0..999) into grid coordinates.
function slotToXY(slot) {
  const col = slot % COLS
  const row = Math.floor(slot / COLS)
  return { col, row }
}

// Absolute pixel position (top-left of the cell) for a slot.
function cellStyle(slot) {
  const { col, row } = slotToXY(slot)
  return {
    left: col * CELL + 'px',
    top: row * CELL + 'px',
    width: CELL + 'px',
    height: CELL + 'px',
  }
}

// A stable pseudo-random 0..1 from an integer, so each planet gets a consistent
// look (hue, size jitter) without storing anything server-side.
function hash01(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

// Planet visual: hue + a subtle size jitter derived from its slot, so the
// quadrant looks varied but renders identically on every load.
function planetVisual(planet) {
  const seed = planet.base_id || planet.slot
  const hue = Math.floor(hash01(seed) * 360)
  const sizePct = 42 + Math.round(hash01(seed + 7) * 10) // 42%..52% of the cell
  const ring = hash01(seed + 13) > 0.72 // ~28% of planets have a ring
  return { hue, sizePct, ring }
}

// --- Pan / navigation ------------------------------------------------------
// The board is bigger than the frame, but there are NO scrollbars: we pan it
// with a translate transform. `pan` is the top-left offset of the (scaled)
// board relative to the viewport. It's clamped so the board can never be
// dragged fully off screen. Navigation happens via the edge arrows (or the
// keyboard arrow keys), which slide the board while held.
const zoom = ref(0.5) // start zoomed out so the whole quadrant is visible
const pan = ref({ x: 0, y: 0 })
const viewport = ref(null)
const viewportSize = ref({ w: 0, h: 0 })

function measureViewport() {
  if (!viewport.value) return
  viewportSize.value = {
    w: viewport.value.clientWidth,
    h: viewport.value.clientHeight,
  }
  clampPan()
}

// Min pan (most negative) keeps the board's right/bottom edge from crossing
// past the viewport's right/bottom. Max pan is 0 (or centered when smaller).
function panBounds() {
  const vw = viewportSize.value.w
  const vh = viewportSize.value.h
  const overflowX = scaledWidth.value - vw
  const overflowY = scaledHeight.value - vh
  return {
    minX: overflowX > 0 ? -overflowX : (vw - scaledWidth.value) / 2,
    maxX: overflowX > 0 ? 0 : (vw - scaledWidth.value) / 2,
    minY: overflowY > 0 ? -overflowY : (vh - scaledHeight.value) / 2,
    maxY: overflowY > 0 ? 0 : (vh - scaledHeight.value) / 2,
  }
}

function clampPan() {
  const b = panBounds()
  pan.value = {
    x: Math.min(b.maxX, Math.max(b.minX, pan.value.x)),
    y: Math.min(b.maxY, Math.max(b.minY, pan.value.y)),
  }
}

// Whether the board can still move in a given direction (drives arrow display).
const canPan = computed(() => {
  const b = panBounds()
  return {
    left: pan.value.x < b.maxX - 0.5,   // room to reveal content on the left
    right: pan.value.x > b.minX + 0.5,  // room to reveal content on the right
    up: pan.value.y < b.maxY - 0.5,
    down: pan.value.y > b.minY + 0.5,
  }
})

// Center the board on a specific slot (used to focus the player's planet).
function centerOnSlot(slot) {
  if (slot == null) {
    // Center the whole board.
    const b = panBounds()
    pan.value = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }
    return
  }
  const { col, row } = slotToXY(slot)
  const targetX = (col + 0.5) * CELL * zoom.value
  const targetY = (row + 0.5) * CELL * zoom.value
  pan.value = {
    x: viewportSize.value.w / 2 - targetX,
    y: viewportSize.value.h / 2 - targetY,
  }
  clampPan()
}

// --- Edge-arrow panning (press and hold) -----------------------------------
const PAN_SPEED = 14 // px per frame while an arrow is held
let panRaf = null
const panDir = ref({ x: 0, y: 0 })

function stepPan() {
  if (panDir.value.x === 0 && panDir.value.y === 0) {
    panRaf = null
    return
  }
  pan.value = {
    x: pan.value.x + panDir.value.x * PAN_SPEED,
    y: pan.value.y + panDir.value.y * PAN_SPEED,
  }
  clampPan()
  panRaf = requestAnimationFrame(stepPan)
}

function startPan(dx, dy) {
  panDir.value = { x: dx, y: dy }
  if (!panRaf) panRaf = requestAnimationFrame(stepPan)
}

function stopPan() {
  panDir.value = { x: 0, y: 0 }
  if (panRaf) {
    cancelAnimationFrame(panRaf)
    panRaf = null
  }
}

function onKeydown(e) {
  const map = {
    ArrowLeft: [1, 0],
    ArrowRight: [-1, 0],
    ArrowUp: [0, 1],
    ArrowDown: [0, -1],
  }
  const d = map[e.key]
  if (!d) return
  e.preventDefault()
  // A single, snappy nudge per key press.
  pan.value = { x: pan.value.x + d[0] * CELL * 0.8, y: pan.value.y + d[1] * CELL * 0.8 }
  clampPan()
}

// --- Data loading ----------------------------------------------------------
onMounted(async () => {
  await galaxy.loadOverview()
  // Open the player's own quadrant by default; fall back to the first one.
  const start = galaxy.self?.quadrant || 1
  await galaxy.loadQuadrant(start)
  measureViewport()
  focusSelf()
  window.addEventListener('resize', measureViewport)
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  stopPan()
  window.removeEventListener('resize', measureViewport)
  window.removeEventListener('keydown', onKeydown)
})

// Focus the player's planet if it's in the active quadrant; else center board.
function focusSelf() {
  const selfInQuadrant =
    galaxy.self && galaxy.self.quadrant === galaxy.activeQuadrant
      ? galaxy.self.slot
      : null
  centerOnSlot(selfInQuadrant)
}

async function selectQuadrant(q) {
  if (q === galaxy.activeQuadrant) return
  galaxy.clearTarget()
  await galaxy.loadQuadrant(q)
  measureViewport()
  focusSelf()
}

function applyZoom(next) {
  // Zoom around the viewport center so the focus point stays put.
  const cx = viewportSize.value.w / 2
  const cy = viewportSize.value.h / 2
  const worldX = (cx - pan.value.x) / zoom.value
  const worldY = (cy - pan.value.y) / zoom.value
  zoom.value = next
  pan.value = { x: cx - worldX * zoom.value, y: cy - worldY * zoom.value }
  clampPan()
}

function zoomIn() {
  applyZoom(Math.min(1.4, +(zoom.value + 0.15).toFixed(2)))
}
function zoomOut() {
  applyZoom(Math.max(0.28, +(zoom.value - 0.15).toFixed(2)))
}

// --- Planet interaction ----------------------------------------------------
async function onPlanetClick(planet) {
  await galaxy.inspect(planet.base_id)
}

function closeTarget() {
  galaxy.clearTarget()
}

// Foundation for planet-vs-planet attacks. The battle launch will hook here.
const attacking = ref(false)
const attackMsg = ref(null)

async function launchAttack() {
  const t = galaxy.target
  if (!t || !t.attack?.attackable) return
  attacking.value = true
  attackMsg.value = null
  // The attack flow (fleet selection -> battle instance) will be wired here.
  // For now we surface the intent so the entry point is testable end-to-end.
  setTimeout(() => {
    attacking.value = false
    attackMsg.value = `Ataque a ${t.planet.owner_name} será iniciado em breve (seleção de frota em desenvolvimento).`
  }, 400)
}

function backToBase() {
  router.push({ name: 'game' })
}

const activeMeta = computed(() => galaxy.activeQuadrantMeta)
</script>

<template>
  <div class="galaxy">
    <!-- Fixed galaxy backdrop (CSS only; does not pan with the grid). -->
    <div class="galaxy-bg" aria-hidden="true">
      <div class="stars stars-far"></div>
      <div class="stars stars-mid"></div>
      <div class="stars stars-near"></div>
      <div class="nebula nebula-a"></div>
      <div class="nebula nebula-b"></div>
    </div>

    <!-- Top bar: quadrant selector + controls -->
    <header class="galaxy-top">
      <div class="left">
        <button class="ghost" @click="backToBase">← Base</button>
        <span class="title">Galáxia</span>
        <span v-if="galaxy.self" class="self-tag">
          Seu planeta: Q{{ galaxy.self.quadrant }} · slot {{ galaxy.self.slot }}
        </span>
      </div>
      <div class="right">
        <span v-if="activeMeta" class="quad-count">
          Q{{ activeMeta.quadrant }} · {{ activeMeta.planets }} / {{ activeMeta.capacity }} planetas
        </span>
        <div class="zoom">
          <button @click="zoomOut" title="Afastar">−</button>
          <span>{{ Math.round(zoom * 100) }}%</span>
          <button @click="zoomIn" title="Aproximar">+</button>
        </div>
      </div>
    </header>

    <!-- Quadrant strip: all 30 quadrants. -->
    <nav class="quad-strip">
      <button
        v-for="q in galaxy.quadrants"
        :key="q.quadrant"
        class="quad-chip"
        :class="{
          active: q.quadrant === galaxy.activeQuadrant,
          mine: galaxy.self && q.quadrant === galaxy.self.quadrant,
        }"
        @click="selectQuadrant(q.quadrant)"
      >
        <strong>Q{{ q.quadrant }}</strong>
        <small>{{ q.planets }}</small>
      </button>
    </nav>

    <!-- Pannable quadrant board (no scrollbars: moved via edge arrows/keys) -->
    <div ref="viewport" class="board-frame">
      <div v-if="galaxy.loadingQuadrant" class="loading">Carregando quadrante...</div>

      <div class="board-stage" :class="{ dim: galaxy.loadingQuadrant }">
        <div
          class="board"
          :style="{
            width: boardWidth + 'px',
            height: boardHeight + 'px',
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }"
        >
          <!-- Occupied slots become planets; empty slots stay as open space. -->
          <button
            v-for="p in galaxy.planets"
            :key="p.base_id"
            class="planet-cell"
            :class="{ self: p.is_self, selected: galaxy.target && galaxy.target.planet.base_id === p.base_id }"
            :style="cellStyle(p.slot)"
            @click="onPlanetClick(p)"
          >
            <span
              class="planet"
              :class="{ ring: planetVisual(p).ring }"
              :style="{
                width: planetVisual(p).sizePct + '%',
                height: planetVisual(p).sizePct + '%',
                '--hue': planetVisual(p).hue,
              }"
            ></span>
            <span class="planet-label">{{ p.owner_name }}</span>
          </button>
        </div>
      </div>

      <!-- Edge navigation arrows: only shown when there's room to move that
           way. Press and hold (mouse or touch) to slide the board. -->
      <button
        v-show="canPan.left"
        class="edge-arrow edge-left"
        title="Mover para a esquerda (←)"
        @mouseenter="startPan(1, 0)"
        @mouseleave="stopPan"
        @touchstart.prevent="startPan(1, 0)"
        @touchend="stopPan"
      ><i class="chev chev-left"></i></button>
      <button
        v-show="canPan.right"
        class="edge-arrow edge-right"
        title="Mover para a direita (→)"
        @mouseenter="startPan(-1, 0)"
        @mouseleave="stopPan"
        @touchstart.prevent="startPan(-1, 0)"
        @touchend="stopPan"
      ><i class="chev chev-right"></i></button>
      <button
        v-show="canPan.up"
        class="edge-arrow edge-up"
        title="Mover para cima (↑)"
        @mouseenter="startPan(0, 1)"
        @mouseleave="stopPan"
        @touchstart.prevent="startPan(0, 1)"
        @touchend="stopPan"
      ><i class="chev chev-up"></i></button>
      <button
        v-show="canPan.down"
        class="edge-arrow edge-down"
        title="Mover para baixo (↓)"
        @mouseenter="startPan(0, -1)"
        @mouseleave="stopPan"
        @touchstart.prevent="startPan(0, -1)"
        @touchend="stopPan"
      ><i class="chev chev-down"></i></button>
    </div>

    <!-- Target inspector / attack entry point -->
    <transition name="slide">
      <aside v-if="galaxy.target" class="target-panel">
        <button class="target-x" @click="closeTarget">✕</button>
        <div class="target-planet-preview">
          <span
            class="planet"
            :class="{ ring: planetVisual(galaxy.target.planet).ring }"
            :style="{ '--hue': planetVisual(galaxy.target.planet).hue }"
          ></span>
        </div>
        <h3>{{ galaxy.target.planet.owner_name }}</h3>
        <p class="coords">
          Quadrante {{ galaxy.target.planet.quadrant }} · slot {{ galaxy.target.planet.slot }}
        </p>

        <p v-if="galaxy.target.planet.is_self" class="own-note">
          Este é o seu planeta.
        </p>
        <template v-else>
          <p class="def-note">
            {{ galaxy.target.attack.has_defense_base
              ? 'Este planeta possui base de defesa orbital.'
              : 'Sem base de defesa orbital detectada.' }}
          </p>
          <button
            class="attack-btn"
            :disabled="!galaxy.target.attack.attackable || attacking"
            @click="launchAttack"
          >
            {{ attacking ? 'Preparando…' : '⚔ Atacar planeta' }}
          </button>
          <p v-if="!galaxy.target.attack.attackable" class="attack-reason">
            {{ galaxy.target.attack.reason }}
          </p>
        </template>

        <p v-if="attackMsg" class="attack-msg">{{ attackMsg }}</p>
      </aside>
    </transition>
  </div>
</template>

<style scoped>
.galaxy {
  position: relative;
  height: 100vh;
  display: flex;
  flex-direction: column;
  color: #e6eefc;
  overflow: hidden;
  background: #04060f;
}

/* ---- Fixed galaxy background (CSS only, does not move with the grid) ---- */
.galaxy-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background:
    radial-gradient(circle at 50% 45%, #0d1836 0%, #060a1c 45%, #03040c 100%);
}
/* Star layers: repeated radial gradients paint tiny dots at fixed positions. */
.stars {
  position: absolute;
  inset: 0;
}
.stars-far {
  background-image:
    radial-gradient(1px 1px at 20% 30%, #ffffff 50%, transparent),
    radial-gradient(1px 1px at 70% 60%, #cfe0ff 50%, transparent),
    radial-gradient(1px 1px at 40% 80%, #ffffff 50%, transparent),
    radial-gradient(1px 1px at 90% 20%, #bcd4ff 50%, transparent),
    radial-gradient(1px 1px at 10% 70%, #ffffff 50%, transparent);
  background-repeat: repeat;
  background-size: 220px 220px;
  opacity: 0.6;
}
.stars-mid {
  background-image:
    radial-gradient(1.6px 1.6px at 55% 25%, #ffffff 50%, transparent),
    radial-gradient(1.6px 1.6px at 15% 55%, #dbe8ff 50%, transparent),
    radial-gradient(1.6px 1.6px at 80% 85%, #ffffff 50%, transparent);
  background-repeat: repeat;
  background-size: 340px 340px;
  opacity: 0.75;
}
.stars-near {
  background-image:
    radial-gradient(2.4px 2.4px at 35% 15%, #ffffff 60%, transparent),
    radial-gradient(2.4px 2.4px at 85% 45%, #eaf2ff 60%, transparent);
  background-repeat: repeat;
  background-size: 520px 520px;
  opacity: 0.9;
}
/* Two soft nebula clouds for color depth. */
.nebula {
  position: absolute;
  border-radius: 50%;
  filter: blur(60px);
  opacity: 0.5;
}
.nebula-a {
  width: 60vw;
  height: 60vw;
  left: -10vw;
  top: -15vw;
  background: radial-gradient(circle, rgba(97, 61, 214, 0.5), transparent 65%);
}
.nebula-b {
  width: 55vw;
  height: 55vw;
  right: -12vw;
  bottom: -18vw;
  background: radial-gradient(circle, rgba(38, 132, 255, 0.4), transparent 65%);
}

/* ---- Top bar ---- */
.galaxy-top {
  position: relative;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.7rem 1.1rem;
  background: rgba(10, 16, 30, 0.72);
  border-bottom: 1px solid rgba(120, 160, 220, 0.2);
  backdrop-filter: blur(6px);
}
.galaxy-top .left,
.galaxy-top .right {
  display: flex;
  align-items: center;
  gap: 0.8rem;
}
.title {
  font-weight: 800;
  letter-spacing: 0.5px;
  color: #cfe0ff;
}
.self-tag,
.quad-count {
  font-size: 0.8rem;
  color: #9fb2cf;
  padding: 0.2rem 0.55rem;
  border: 1px solid rgba(120, 160, 220, 0.25);
  border-radius: 999px;
  background: rgba(20, 30, 52, 0.6);
}
.ghost {
  background: transparent;
  border: 1px solid rgba(120, 160, 220, 0.3);
  color: #cfe0ff;
  padding: 0.35rem 0.8rem;
  border-radius: 7px;
  cursor: pointer;
}
.ghost:hover {
  border-color: #4fc3f7;
}
.zoom {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.82rem;
  color: #cfe0ff;
}
.zoom button {
  width: 28px;
  height: 28px;
  border-radius: 7px;
  border: 1px solid rgba(120, 160, 220, 0.3);
  background: rgba(20, 30, 52, 0.7);
  color: #cfe0ff;
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
}
.zoom button:hover {
  border-color: #4fc3f7;
}

/* ---- Quadrant strip ---- */
.quad-strip {
  position: relative;
  z-index: 3;
  display: flex;
  gap: 0.4rem;
  padding: 0.55rem 1.1rem;
  overflow-x: auto;
  background: rgba(8, 13, 26, 0.6);
  border-bottom: 1px solid rgba(120, 160, 220, 0.14);
  scrollbar-width: thin;
}
.quad-chip {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  min-width: 46px;
  padding: 0.3rem 0.5rem;
  border-radius: 9px;
  border: 1px solid rgba(120, 160, 220, 0.22);
  background: rgba(19, 28, 48, 0.7);
  color: #cfe0ff;
  cursor: pointer;
}
.quad-chip small {
  color: #8496b5;
  font-size: 0.68rem;
}
.quad-chip:hover {
  border-color: rgba(120, 160, 220, 0.5);
}
.quad-chip.active {
  border-color: #4fc3f7;
  box-shadow: 0 0 0 1px #4fc3f7 inset;
  background: rgba(38, 132, 255, 0.2);
}
.quad-chip.mine strong {
  color: #8fd39a;
}

/* ---- Board ---- */
.board-frame {
  position: relative;
  z-index: 2;
  flex: 1;
  min-height: 0;
  overflow: hidden; /* no scrollbars — the board is panned via edge arrows */
}
.board-stage {
  position: absolute;
  inset: 0;
  overflow: hidden;
  transition: opacity 0.2s;
}
.board-stage.dim {
  opacity: 0.4;
}
.board {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: top left;
  will-change: transform;
}

/* ---- Edge navigation arrows ---- */
.edge-arrow {
  position: absolute;
  z-index: 5;
  display: grid;
  place-items: center;
  border: 1px solid rgba(120, 160, 220, 0.35);
  background: rgba(12, 19, 34, 0.72);
  color: #dbe8ff;
  cursor: pointer;
  backdrop-filter: blur(4px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
  user-select: none;
  transition: background 0.15s, border-color 0.15s, transform 0.1s;
  font-weight: 800;
  line-height: 1;
}
.edge-arrow:hover {
  background: rgba(38, 132, 255, 0.28);
  border-color: #4fc3f7;
}
.edge-arrow:active {
  transform: scale(0.92);
}
/* Squarish buttons; left/right centered vertically, up/down horizontally. */
.edge-left,
.edge-right,
.edge-up,
.edge-down {
  width: 54px;
  height: 54px;
  border-radius: 12px;
}
.edge-left,
.edge-right {
  top: 50%;
  transform: translateY(-50%);
}
.edge-left:active,
.edge-right:active {
  transform: translateY(-50%) scale(0.92);
}
.edge-left {
  left: 12px;
}
.edge-right {
  right: 12px;
}
.edge-up,
.edge-down {
  left: 50%;
  transform: translateX(-50%);
}
.edge-up:active,
.edge-down:active {
  transform: translateX(-50%) scale(0.92);
}
.edge-up {
  top: 12px;
}
.edge-down {
  bottom: 12px;
}

/* Chevron drawn with borders so it centers perfectly (no font metrics). The
   base points up; each direction rotates just the little arrow, not the box. */
.chev {
  display: block;
  width: 14px;
  height: 14px;
  border-top: 3px solid #dbe8ff;
  border-right: 3px solid #dbe8ff;
  border-radius: 2px;
}
.chev-up {
  transform: rotate(-45deg);
  margin-top: 4px; /* optical centering for the up-pointing chevron */
}
.chev-down {
  transform: rotate(135deg);
  margin-bottom: 4px;
}
.chev-left {
  transform: rotate(-135deg);
  margin-left: 4px;
}
.chev-right {
  transform: rotate(45deg);
  margin-right: 4px;
}
.loading {
  position: absolute;
  z-index: 4;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: #9fb2cf;
}

/* Each occupied slot: a transparent cell with the planet centered so the
   surrounding padding reads as empty space between worlds. */
.planet-cell {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
}
.planet {
  display: block;
  border-radius: 50%;
  background:
    radial-gradient(circle at 32% 30%,
      hsl(var(--hue, 210), 85%, 72%),
      hsl(var(--hue, 210), 70%, 42%) 55%,
      hsl(var(--hue, 210), 65%, 22%) 100%);
  box-shadow:
    inset -4px -5px 10px rgba(0, 0, 0, 0.45),
    0 0 14px hsla(var(--hue, 210), 80%, 60%, 0.5);
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}
/* Optional ring for some planets. */
.planet.ring::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 150%;
  height: 42%;
  transform: translate(-50%, -50%) rotate(-22deg);
  border-radius: 50%;
  border: 3px solid hsla(var(--hue, 210), 70%, 75%, 0.55);
  box-sizing: border-box;
  pointer-events: none;
}
.planet-cell .planet {
  position: relative;
}
.planet-label {
  font-size: 0.68rem;
  color: #b9c9e6;
  max-width: 96%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0;
  transition: opacity 0.12s;
  text-shadow: 0 1px 3px #000;
}
.planet-cell:hover .planet {
  transform: scale(1.12);
  box-shadow:
    inset -4px -5px 10px rgba(0, 0, 0, 0.45),
    0 0 22px hsla(var(--hue, 210), 90%, 65%, 0.85);
}
.planet-cell:hover .planet-label {
  opacity: 1;
}
.planet-cell.self .planet {
  box-shadow:
    inset -4px -5px 10px rgba(0, 0, 0, 0.45),
    0 0 0 3px rgba(143, 211, 154, 0.8),
    0 0 22px rgba(143, 211, 154, 0.7);
}
.planet-cell.self .planet-label {
  opacity: 1;
  color: #b6efc2;
}
.planet-cell.selected .planet {
  box-shadow:
    inset -4px -5px 10px rgba(0, 0, 0, 0.45),
    0 0 0 3px #4fc3f7,
    0 0 26px rgba(79, 195, 247, 0.9);
}

/* ---- Target panel ---- */
.target-panel {
  position: absolute;
  z-index: 6;
  right: 16px;
  top: 120px;
  width: 260px;
  padding: 1rem;
  border-radius: 14px;
  background: rgba(12, 19, 34, 0.96);
  border: 1px solid rgba(120, 160, 220, 0.35);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.6);
  text-align: center;
}
.target-x {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: 1px solid rgba(120, 160, 220, 0.3);
  background: transparent;
  color: #cfe0ff;
  cursor: pointer;
}
.target-x:hover {
  border-color: #ff8080;
  color: #ff8080;
}
.target-planet-preview {
  display: grid;
  place-items: center;
  margin: 0.4rem 0 0.7rem;
}
.target-planet-preview .planet {
  position: relative;
  width: 72px;
  height: 72px;
}
.target-panel h3 {
  margin: 0 0 0.2rem;
  font-size: 1.05rem;
}
.coords {
  margin: 0 0 0.8rem;
  font-size: 0.8rem;
  color: #8fa2c2;
}
.own-note {
  color: #8fd39a;
  font-size: 0.88rem;
}
.def-note {
  font-size: 0.8rem;
  color: #9fb2cf;
  margin: 0 0 0.8rem;
}
.attack-btn {
  width: 100%;
  padding: 0.65rem;
  border: none;
  border-radius: 9px;
  background: linear-gradient(135deg, #ff6b5a, #c9382b);
  color: #fff;
  font-weight: 800;
  cursor: pointer;
}
.attack-btn:disabled {
  background: #2a3550;
  color: #7f93b3;
  cursor: default;
}
.attack-reason {
  margin: 0.5rem 0 0;
  font-size: 0.76rem;
  color: #e08a80;
}
.attack-msg {
  margin: 0.7rem 0 0;
  font-size: 0.78rem;
  color: #cfe0ff;
  background: rgba(38, 132, 255, 0.14);
  border: 1px solid rgba(79, 195, 247, 0.35);
  border-radius: 8px;
  padding: 0.5rem;
}
.slide-enter-active,
.slide-leave-active {
  transition: transform 0.2s ease, opacity 0.2s ease;
}
.slide-enter-from,
.slide-leave-to {
  transform: translateX(20px);
  opacity: 0;
}

@media (max-width: 640px) {
  .target-panel {
    right: 8px;
    left: 8px;
    width: auto;
    top: auto;
    bottom: 12px;
  }
}
</style>
