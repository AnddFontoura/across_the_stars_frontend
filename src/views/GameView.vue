<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useGameStore } from '../stores/game'
import IsometricGrid from '../components/IsometricGrid.vue'
import HangarPanel from '../components/HangarPanel.vue'
import InventoryPanel from '../components/InventoryPanel.vue'
import ResearchPanel from '../components/ResearchPanel.vue'
import BuildCatalog from '../components/BuildCatalog.vue'
import StructureDetail from '../components/StructureDetail.vue'
import ShipBuilder from '../components/ShipBuilder.vue'
import CommandersPanel from '../components/CommandersPanel.vue'
import FleetBuilder from '../components/FleetBuilder.vue'

const router = useRouter()
const auth = useAuthStore()
const game = useGameStore()

const selectedType = ref(null)
const selectedStructureId = ref(null)
const flash = ref(null) // transient message

// Local clock used to drive the countdowns without hammering the API.
const nowTs = ref(Date.now())
let ticker = null
let poller = null

onMounted(async () => {
  await game.loadBase()
  if (auth.user === null) {
    try {
      await auth.fetchMe()
    } catch (e) {
      // token invalid -> back to login
      await auth.logout()
      router.push({ name: 'login' })
    }
  }

  // Tick every second to drive countdowns. When a structure's build/upgrade
  // timer reaches zero, silently refresh so the server finalizes it (lazy
  // settle) without any visible reload.
  ticker = setInterval(() => {
    nowTs.value = Date.now()
    const hasDueWork = game.structures.some(
      (s) => s.busy_until && new Date(s.busy_until).getTime() <= nowTs.value
    )
    if (hasDueWork) {
      game.refreshBase()
    }
  }, 1000)

  // Silent poll (every 10s) to keep resources/accumulation in sync with the
  // server even when nothing is under construction. Merges in place (no flash,
  // no reset). The accumulated value also updates locally each second via the
  // ticker above (see livePending), so the UI feels live between polls.
  poller = setInterval(() => {
    game.refreshBase()
  }, 10000)

  window.addEventListener('keydown', onKeydown)
  updateIsMobile()
  window.addEventListener('resize', updateIsMobile)
})

onUnmounted(() => {
  if (ticker) clearInterval(ticker)
  if (poller) clearInterval(poller)
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', updateIsMobile)
})

const resources = computed(() => game.base?.resources || { gold: 0, metal: 0, energy: 0 })
const protection = computed(() => game.base?.protection || 0)
const structuresUsed = computed(() => game.base?.structures_used || 0)
const maxStructures = computed(() => game.base?.max_structures || 0)
const commandLevel = computed(() => game.base?.command_level || 0)
const existingTypeIds = computed(() => game.base?.existing_type_ids || [])
const categoryLimits = computed(() => game.base?.category_limits || {})
const typeLimits = computed(() => game.base?.type_limits || {})
const maxConcurrentBuilds = computed(() => game.base?.max_concurrent_builds || 0)

// Structures currently under construction/upgrade, sorted by soonest to finish.
// Derived from busy_until against the local clock so the list ticks live.
const buildQueue = computed(() =>
  game.structures
    .filter((s) => s.busy_until && new Date(s.busy_until).getTime() > nowTs.value)
    .map((s) => ({ ...s, remaining: remainingFor(s) }))
    .sort((a, b) => a.remaining - b.remaining)
)

const buildsInProgress = computed(() => buildQueue.value.length)

// Whether the base has hit the simultaneous builds cap.
const buildsFull = computed(
  () => maxConcurrentBuilds.value > 0 && buildsInProgress.value >= maxConcurrentBuilds.value
)

// Whether the limit that applies to this type has been reached.
// Command/storage are limited per category; producers are limited per type.
function isLimitReached(type) {
  // Producers: each type has its own limit (e.g. up to 10 of each mine).
  const typeLimit = typeLimits.value[type.id]
  if (typeLimit && typeLimit.max !== null && typeLimit.max !== undefined) {
    return typeLimit.used >= typeLimit.max
  }
  // Command/storage: limited across the whole category.
  const catLimit = categoryLimits.value[type.category]
  if (catLimit && catLimit.max !== null && catLimit.max !== undefined) {
    return catLimit.used >= catLimit.max
  }
  return false
}

// A type can't be built if it's a placed unique, its limit is reached, or the
// base already has the maximum number of simultaneous builds (for timed builds).
function isTypeDisabled(type) {
  if (type.is_unique && existingTypeIds.value.includes(type.id)) return true
  if (isLimitReached(type)) return true
  if (buildsFull.value && type.build_time > 0) return true
  return false
}

// Live remaining seconds for a structure, derived from busy_until and the clock.
function remainingFor(structure) {
  if (!structure?.busy_until) return 0
  const diff = Math.ceil((new Date(structure.busy_until).getTime() - nowTs.value) / 1000)
  return Math.max(0, diff)
}

function formatTime(totalSeconds) {
  const s = Math.max(0, totalSeconds)
  const m = Math.floor(s / 60)
  const sec = s % 60
  if (m > 0) return `${m}m ${sec.toString().padStart(2, '0')}s`
  return `${sec}s`
}

const selectedBusy = computed(() => remainingFor(selectedStructure.value) > 0)

// Live "accumulated / ready to collect" amount for a producer, computed from
// the local clock so it updates without waiting for a server refresh. Mirrors
// the backend: whole minutes since last collection * production/min, capped at
// the structure's max capacity. Uses nowTs so it re-evaluates as time passes.
function livePending(structure) {
  if (!structure || structure.type?.category !== 'producer' || !structure.is_constructed) {
    return structure?.pending ?? 0
  }
  const perMin = structure.production_per_minute || 0
  const since = structure.last_collected_at
    ? new Date(structure.last_collected_at).getTime()
    : null
  if (!since || perMin <= 0) return structure.pending ?? 0

  const minutes = Math.max(0, Math.floor((nowTs.value - since) / 60000))
  const produced = minutes * perMin
  const cap = structure.max_capacity ?? produced
  const live = Math.min(produced, cap)
  // Never show less than the server's last known value (avoids flicker right
  // after a refresh when clocks differ slightly).
  return Math.max(live, structure.pending ?? 0)
}

// --- Hover tooltip (accumulated resources + collect) ---
const hoverId = ref(null)
const hoverPos = ref({ x: 0, y: 0 })
let hoverCloseTimer = null

const hoverStructure = computed(() =>
  game.structures.find((s) => s.id === hoverId.value) || null
)

// Only producers that are built (not under construction) show the tooltip.
const showHoverTooltip = computed(() => {
  const s = hoverStructure.value
  return (
    s &&
    s.type.category === 'producer' &&
    s.is_constructed &&
    !selectedType.value
  )
})

function onGridHover({ id, x, y }) {
  if (hoverCloseTimer) {
    clearTimeout(hoverCloseTimer)
    hoverCloseTimer = null
  }
  hoverId.value = id
  hoverPos.value = { x, y }
}

function onGridHoverEnd() {
  // Small delay so the pointer can travel into the tooltip to click "Recolher".
  hoverCloseTimer = setTimeout(() => {
    hoverId.value = null
  }, 180)
}

function keepTooltip() {
  if (hoverCloseTimer) {
    clearTimeout(hoverCloseTimer)
    hoverCloseTimer = null
  }
}

function closeTooltip() {
  hoverId.value = null
}

async function collectHovered() {
  const s = hoverStructure.value
  if (!s) return
  const ok = await game.collectStructure(s.id)
  showFlash(ok ? 'Recursos recolhidos!' : game.error || 'Falha ao recolher.')
  closeTooltip()
}

// --- Mobile layout state ---
// On narrow screens the two side panels become slide-in drawers toggled by
// floating buttons, and the selected-structure detail becomes a bottom sheet.
const isMobile = ref(false)
const showLeftDrawer = ref(false) // "Estruturas" / detail panel
const showRightDrawer = ref(false) // "Obras em andamento" queue

function updateIsMobile() {
  isMobile.value = window.matchMedia('(max-width: 900px)').matches
  // Leaving mobile closes any open drawer so the desktop layout is clean.
  if (!isMobile.value) {
    showLeftDrawer.value = false
    showRightDrawer.value = false
  }
}

function toggleLeftDrawer() {
  showLeftDrawer.value = !showLeftDrawer.value
  if (showLeftDrawer.value) showRightDrawer.value = false
}

function toggleRightDrawer() {
  showRightDrawer.value = !showRightDrawer.value
  if (showRightDrawer.value) showLeftDrawer.value = false
}

function closeDrawers() {
  showLeftDrawer.value = false
  showRightDrawer.value = false
}

// Build catalog modal: a single button opens a centered modal with the
// buildable structures as image cards (hover shows a description).
const showCatalog = ref(false)

function openCatalog() {
  showCatalog.value = true
}

function closeCatalog() {
  showCatalog.value = false
}

function selectType(type) {
  if (isTypeDisabled(type)) return
  selectedType.value = type
  // Entering placement mode clears any selected structure.
  selectedStructureId.value = null
  // Close the catalog modal and any drawer so the terrain is clear to tap.
  showCatalog.value = false
  closeDrawers()
}

const selectedStructure = computed(() =>
  game.structures.find((s) => s.id === selectedStructureId.value) || null
)

// Aircraft Hangar management modal (opens from the detail panel).
const showHangar = ref(false)

function openHangar() {
  showHangar.value = true
}

function closeHangar() {
  showHangar.value = false
}

// Forte Protetor inventory modal (opens from the detail panel).
const showInventory = ref(false)

function openInventory() {
  showInventory.value = true
}

function closeInventory() {
  showInventory.value = false
}

// Centro de Pesquisa research modal (opens from the detail panel).
const showResearch = ref(false)

function openResearch() {
  showResearch.value = true
}

function closeResearch() {
  showResearch.value = false
}

// Ship builder modal (custom models from modules).
const showBuilder = ref(false)

function openBuilder() {
  showBuilder.value = true
}

function closeBuilder() {
  showBuilder.value = false
}

// Commanders + fleet modals.
const showCommanders = ref(false)
const showFleets = ref(false)

function openCommanders() {
  showCommanders.value = true
}

function openFleets() {
  showFleets.value = true
}

function closeFleets() {
  showFleets.value = false
  // Fleet markers live on the planetary base; refresh so new/removed fleets
  // appear on the map after composing in the builder.
  if (isPlanetary.value) game.refreshBase()
}

function onSelectStructure(payload) {
  // The grid emits { id, x, y } (click position); the queue list passes a
  // bare id. Support both.
  const id = typeof payload === 'object' ? payload.id : payload
  selectedStructureId.value = id
  // Selecting a different structure closes any open hangar modal.
  showHangar.value = false
  showInventory.value = false
  showResearch.value = false

  // On mobile, show the detail as a bottom sheet instead of a floating card.
  if (isMobile.value) {
    showCard.value = false
    showRightDrawer.value = false
    return
  }

  // Anchor the floating action card at the click position when we have one;
  // otherwise (selected from the queue) center it on screen.
  if (typeof payload === 'object' && payload.x != null) {
    cardPos.value = { x: payload.x, y: payload.y }
  } else {
    cardPos.value = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
  }
  showCard.value = true
}

// --- Floating action card (anchored at the clicked structure) ---
const showCard = ref(false)
const cardPos = ref({ x: 0, y: 0 })

// Position the card near the click, clamped so it stays on screen.
const cardStyle = computed(() => {
  const CARD_W = 260
  const CARD_H = 360
  const margin = 12
  let left = cardPos.value.x + 16
  let top = cardPos.value.y - 20
  if (left + CARD_W + margin > window.innerWidth) {
    left = cardPos.value.x - CARD_W - 16
  }
  left = Math.max(margin, left)
  top = Math.max(margin, Math.min(top, window.innerHeight - CARD_H - margin))
  return { left: left + 'px', top: top + 'px' }
})

function closeCard() {
  showCard.value = false
}

function deselect() {
  selectedStructureId.value = null
  showCard.value = false
  showHangar.value = false
  showInventory.value = false
  showResearch.value = false
  showBuilder.value = false
  showCommanders.value = false
  showFleets.value = false
}

// Clicking empty ground clears the selection (when not placing).
function onGroundClick() {
  if (selectedType.value) return
  deselect()
}

// Esc cancels placement mode or clears the current selection.
function onKeydown(e) {
  if (e.key !== 'Escape') return
  if (showCatalog.value) {
    showCatalog.value = false
  } else if (selectedType.value) {
    selectedType.value = null
  } else if (selectedStructureId.value !== null) {
    deselect()
  }
}

async function upgradeSelected() {
  if (!selectedStructure.value) return
  const ok = await game.upgradeStructure(selectedStructure.value.id)
  showFlash(ok ? 'Estrutura evoluída!' : game.error || 'Falha ao evoluir.')
}

// Collect a single selected producer (from the detail panel / action card).
async function collectSelected() {
  if (!selectedStructure.value) return
  const ok = await game.collectStructure(selectedStructure.value.id)
  showFlash(ok ? 'Recursos recolhidos!' : game.error || 'Falha ao recolher.')
}

// Demolish the selected structure. Confirmation is handled inside
// StructureDetail, so this fires only after the user confirms.
async function demolishSelected() {
  if (!selectedStructure.value) return
  const ok = await game.demolishStructure(selectedStructure.value.id)
  if (ok) {
    deselect()
    showFlash('Estrutura desconstruída.')
  } else {
    showFlash(game.error || 'Falha ao desconstruir.')
  }
}

async function onPlace({ x, y }) {
  if (!selectedType.value) return
  const ok = await game.placeStructure(selectedType.value.id, x, y)
  if (ok) {
    showFlash('Estrutura posicionada!')
  } else {
    showFlash(game.error || 'Não foi possível posicionar.')
  }
}

// Drag-to-move: the grid emits the structure id and its new snapped position.
async function onMoveStructure({ id, x, y }) {
  const ok = await game.moveStructure(id, x, y)
  showFlash(ok ? 'Estrutura movida!' : game.error || 'Não foi possível mover.')
}

// Drag-to-move a fleet marker on the planetary base (free move, no collision).
async function onMoveFleet({ id, x, y }) {
  await game.moveFleet(id, x, y)
}

async function collect() {
  await game.collectAll()
  showFlash('Recursos coletados!')
}

function showFlash(msg) {
  flash.value = msg
  setTimeout(() => {
    if (flash.value === msg) flash.value = null
  }, 2500)
}

async function logout() {
  await auth.logout()
  router.push({ name: 'login' })
}

const resourceMeta = {
  gold: { label: 'Ouro', color: '#f4c542' },
  metal: { label: 'Metal', color: '#9aa5b1' },
  energy: { label: 'Energia', color: '#4fc3f7' },
}

// --- Base switching (terrestrial <-> planetary) ---
const isPlanetary = computed(() => game.base?.kind === 'planetary')

// Defense Center level considered for the quantity rules (capped at 15).
const quantityCommandLevel = computed(() => game.base?.quantity_command_level || 0)

// Label of the active base's command structure, used in the top bar.
const commandLabel = computed(() => (isPlanetary.value ? 'Centro de Defesa' : 'Centro'))

async function toggleBase() {
  // Switching bases clears any in-flight placement/selection.
  selectedType.value = null
  selectedStructureId.value = null
  showCard.value = false
  showHangar.value = false
  showInventory.value = false
  showResearch.value = false
  const target = isPlanetary.value ? 'terrestrial' : 'planetary'
  await game.setBaseKind(target)
  showFlash(target === 'planetary' ? 'Base planetária' : 'Base terrestre')
}

// Whether the currently selected structure is a defense structure (has combat
// stats to show in the detail panel).
const selectedIsDefense = computed(
  () => selectedStructure.value?.type?.category === 'defense'
)
</script>

<template>
  <div class="game">
    <!-- Top bar -->
    <header class="topbar">
      <div class="brand">
        <span class="brand-name">Across the Stars</span>
        <span class="base-badge" :class="{ planetary: isPlanetary }">
          {{ isPlanetary ? '🛰️ Base planetária' : '🌍 Base terrestre' }}
        </span>
      </div>

      <div class="resources">
        <div v-for="(meta, key) in resourceMeta" :key="key" class="res">
          <span class="dot" :style="{ background: meta.color }"></span>
          <span class="res-label">{{ meta.label }}</span>
          <span class="res-value">{{ resources[key] }}</span>
        </div>
        <div class="res protection" title="Recursos protegidos por depósitos">
          <span class="res-label">Protegido</span>
          <span class="res-value">{{ protection }}</span>
        </div>
        <div class="res" title="Construções usadas / máximo permitido">
          <span class="res-label">Construções</span>
          <span class="res-value">{{ structuresUsed }} / {{ maxStructures }}</span>
        </div>
        <div class="res" title="Nível do centro de comando (teto das demais estruturas)">
          <span class="res-label">{{ commandLabel }}</span>
          <span class="res-value">{{ commandLevel > 0 ? 'Nv ' + commandLevel : '—' }}</span>
        </div>
      </div>

      <div class="account">
        <span v-if="auth.user" class="who">{{ auth.user.name }}</span>
        <button class="ghost" @click="logout">Sair</button>
      </div>
    </header>

    <div class="layout">
      <!-- Mobile drawer backdrop -->
      <div
        v-if="isMobile && (showLeftDrawer || showRightDrawer)"
        class="drawer-backdrop"
        @click="closeDrawers"
      ></div>

      <!-- Sidebar: structure catalog -->
      <aside class="sidebar" :class="{ 'drawer-open': showLeftDrawer }">
        <h3>Estruturas</h3>
        <p class="hint">Abra o catálogo, escolha e clique no terreno para posicionar.</p>

        <!-- Opens the build catalog modal (image grid + hover descriptions). -->
        <button class="build-open" @click="openCatalog">
          <span>🏗️ Construir</span>
          <small>{{ game.structureTypes.length }} disponíveis</small>
        </button>

        <button class="collect" @click="collect">Coletar recursos</button>

        <p v-if="selectedType" class="selected-note">
          Posicionando: <strong>{{ selectedType.name }}</strong><br>
          <small>Clique no terreno. (Selecionar de novo cancela.)</small>
        </p>

        <!-- Details / upgrade panel for a selected placed structure -->
        <StructureDetail
          v-if="selectedStructure"
          :structure="selectedStructure"
          :is-planetary="isPlanetary"
          :command-level="commandLevel"
          :builds-full="buildsFull"
          :max-concurrent-builds="maxConcurrentBuilds"
          :live-pending="livePending(selectedStructure)"
          :remaining-seconds="remainingFor(selectedStructure)"
          :resource-meta="resourceMeta"
          @collect="collectSelected"
          @upgrade="upgradeSelected"
          @open-hangar="openHangar"
          @open-builder="openBuilder"
          @open-commanders="openCommanders"
          @open-fleets="openFleets"
          @open-inventory="openInventory"
          @open-research="openResearch"
          @demolish="demolishSelected"
          @close="deselect"
        />
        <p v-else class="hint" style="margin-top: 1rem;">
          Clique numa estrutura para ver detalhes e evoluir.
          Passe o mouse para ver o acumulado e recolher.
          Arraste uma estrutura para movê-la (não pode sobrepor outras).
        </p>
      </aside>

      <!-- Terrain -->
      <main class="stage" :class="{ 'stage-planetary': isPlanetary }">
        <div v-if="game.loading" class="loading">Carregando terreno...</div>
        <IsometricGrid
          v-else-if="game.base"
          :width="game.base.width"
          :height="game.base.height"
          :structures="game.structures"
          :selected-type="selectedType"
          :selected-structure-id="selectedStructureId"
          :now-ts="nowTs"
          :planetary="isPlanetary"
          :cell-size="game.base.cell_size || 10"
          :fleets="game.fleets"
          @place="onPlace"
          @select="onSelectStructure"
          @groundclick="onGroundClick"
          @hover="onGridHover"
          @hoverend="onGridHoverEnd"
          @toggle-base="toggleBase"
          @move="onMoveStructure"
          @move-fleet="onMoveFleet"
        />
        <!-- Hover tooltip: accumulated resources + collect button -->
        <div
          v-if="showHoverTooltip"
          class="hover-tip"
          :style="{ left: hoverPos.x + 14 + 'px', top: hoverPos.y + 14 + 'px' }"
          @mouseenter="keepTooltip"
          @mouseleave="closeTooltip"
        >
          <div class="hover-tip-title">{{ hoverStructure.type.name }} · Nv {{ hoverStructure.level }}</div>
          <div class="hover-tip-row">
            <span class="dot" :style="{ background: hoverStructure.type.color }"></span>
            Acumulado:
            <strong>{{ livePending(hoverStructure) }}</strong>
            <span class="muted">/ {{ hoverStructure.max_capacity }}</span>
          </div>
          <button
            class="hover-tip-btn"
            :disabled="livePending(hoverStructure) <= 0"
            @click="collectHovered"
          >
            {{ livePending(hoverStructure) > 0 ? 'Recolher' : 'Nada para recolher' }}
          </button>
        </div>

        <!-- Floating action card (desktop): anchored at the clicked structure.
             Holds all of the structure's options (collect, upgrade, items). -->
        <div
          v-if="!isMobile && showCard && selectedStructure"
          class="action-card"
          :style="cardStyle"
        >
          <div class="action-card-head">
            <strong>{{ selectedStructure.type.name }} · Nv {{ selectedStructure.level }}</strong>
            <button class="action-card-x" title="Fechar" @click="deselect">✕</button>
          </div>
          <StructureDetail
            :structure="selectedStructure"
            :is-planetary="isPlanetary"
            :command-level="commandLevel"
            :builds-full="buildsFull"
            :max-concurrent-builds="maxConcurrentBuilds"
            :live-pending="livePending(selectedStructure)"
            :remaining-seconds="remainingFor(selectedStructure)"
            :resource-meta="resourceMeta"
            :show-header="false"
            @collect="collectSelected"
            @upgrade="upgradeSelected"
            @open-hangar="openHangar"
            @open-builder="openBuilder"
            @open-commanders="openCommanders"
            @open-fleets="openFleets"
            @open-inventory="openInventory"
            @open-research="openResearch"
            @demolish="demolishSelected"
          />
        </div>

        <transition name="fade">
          <div v-if="flash" class="flash">{{ flash }}</div>
        </transition>

        <!-- Mobile floating toggles for the two side panels (drawers). -->
        <div v-if="isMobile" class="mobile-fabs">
          <button class="fab" :class="{ active: showLeftDrawer }" @click="toggleLeftDrawer">
            🏗️<span class="fab-label">Painel</span>
          </button>
          <button class="fab" :class="{ active: showRightDrawer }" @click="toggleRightDrawer">
            ⏳<span class="fab-label">Obras</span>
            <span v-if="buildsInProgress > 0" class="fab-badge">{{ buildsInProgress }}</span>
          </button>
        </div>

        <!-- Mobile bottom sheet: selected-structure detail + actions. -->
        <transition name="sheet">
          <div
            v-if="isMobile && selectedStructure"
            class="bottom-sheet"
          >
            <div class="sheet-grip" @click="deselect"></div>
            <div class="sheet-head">
              <strong>{{ selectedStructure.type.name }} · Nv {{ selectedStructure.level }}</strong>
              <button class="action-card-x" title="Fechar" @click="deselect">✕</button>
            </div>
            <StructureDetail
              :structure="selectedStructure"
              :is-planetary="isPlanetary"
              :command-level="commandLevel"
              :builds-full="buildsFull"
              :max-concurrent-builds="maxConcurrentBuilds"
              :live-pending="livePending(selectedStructure)"
              :remaining-seconds="remainingFor(selectedStructure)"
              :resource-meta="resourceMeta"
              :show-header="false"
              @collect="collectSelected"
              @upgrade="upgradeSelected"
              @open-hangar="openHangar"
              @open-builder="openBuilder"
              @open-commanders="openCommanders"
              @open-fleets="openFleets"
              @open-inventory="openInventory"
              @open-research="openResearch"
              @demolish="demolishSelected"
            />
          </div>
        </transition>
      </main>

      <!-- Right panel: queue of ongoing builds/upgrades with live countdowns -->
      <aside class="queue" :class="{ 'drawer-open': showRightDrawer }">
        <div class="queue-head">
          <h3>Obras em andamento</h3>
          <span class="queue-count" :class="{ full: buildsFull }">
            {{ buildsInProgress }} / {{ maxConcurrentBuilds }}
          </span>
        </div>

        <p v-if="buildQueue.length === 0" class="hint">
          Nenhuma construção ou evolução em andamento.
        </p>

        <ul v-else class="queue-list">
          <li
            v-for="s in buildQueue"
            :key="s.id"
            class="queue-item"
            :class="{ selected: s.id === selectedStructureId }"
            @click="onSelectStructure(s.id)"
          >
            <span class="queue-swatch" :style="{ background: s.type.color }"></span>
            <span class="queue-info">
              <strong>{{ s.type.name }}</strong>
              <small>
                {{ s.busy_kind === 'build' ? 'Construindo' : 'Evoluindo' }}
                <template v-if="s.busy_kind === 'upgrade' && s.pending_level">
                  → Nv {{ s.pending_level }}
                </template>
              </small>
            </span>
            <span class="queue-time">{{ formatTime(s.remaining) }}</span>
          </li>
        </ul>

        <p v-if="buildsFull" class="builds-hint">
          Limite de {{ maxConcurrentBuilds }} obras simultâneas atingido.
        </p>
      </aside>
    </div>

    <!-- Aircraft Hangar management modal -->
    <HangarPanel
      v-if="showHangar && selectedStructure"
      :structure="selectedStructure"
      @close="closeHangar"
    />

    <!-- Forte Protetor inventory modal -->
    <InventoryPanel
      v-if="showInventory && selectedStructure"
      :structure="selectedStructure"
      @close="closeInventory"
    />

    <!-- Centro de Pesquisa research modal -->
    <ResearchPanel
      v-if="showResearch && selectedStructure"
      :structure="selectedStructure"
      @close="closeResearch"
    />

    <!-- Build catalog modal (image grid + hover descriptions) -->
    <BuildCatalog
      v-if="showCatalog"
      :types="game.structureTypes"
      :is-disabled="isTypeDisabled"
      :is-limit-reached="isLimitReached"
      :existing-type-ids="existingTypeIds"
      :is-planetary="isPlanetary"
      :format-time="formatTime"
      @select="selectType"
      @close="closeCatalog"
    />

    <!-- Ship builder modal (custom models) -->
    <ShipBuilder v-if="showBuilder" @close="closeBuilder" />

    <!-- Commanders + fleets modals -->
    <CommandersPanel v-if="showCommanders" @close="showCommanders = false" />
    <FleetBuilder v-if="showFleets" @close="closeFleets" />
  </div>
</template>

<style scoped>
.game {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #0b0f18;
  color: #e6eefc;
}
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.7rem 1.2rem;
  background: #10182a;
  border-bottom: 1px solid rgba(120, 160, 220, 0.18);
}
.brand {
  font-weight: 800;
  letter-spacing: 0.5px;
  color: #cfe0ff;
  display: flex;
  align-items: center;
  gap: 0.7rem;
}
.base-badge {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.3px;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid rgba(92, 184, 92, 0.5);
  background: rgba(60, 138, 60, 0.18);
  color: #bfe6bf;
}
.base-badge.planetary {
  border-color: rgba(125, 208, 255, 0.55);
  background: rgba(61, 139, 255, 0.18);
  color: #cfe6ff;
}
.resources {
  display: flex;
  gap: 1.2rem;
}
.res {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.9rem;
}
.dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  display: inline-block;
}
.res-label {
  color: #93a6c6;
}
.res-value {
  font-weight: 700;
}
.account {
  display: flex;
  align-items: center;
  gap: 0.8rem;
}
.who {
  color: #93a6c6;
  font-size: 0.9rem;
}
.ghost {
  background: transparent;
  border: 1px solid rgba(120, 160, 220, 0.3);
  color: #cfe0ff;
  padding: 0.35rem 0.8rem;
  border-radius: 7px;
  cursor: pointer;
}
.layout {
  flex: 1;
  display: flex;
  min-height: 0;
}
.sidebar {
  width: 260px;
  padding: 1rem;
  background: #0e1524;
  border-right: 1px solid rgba(120, 160, 220, 0.15);
  overflow-y: auto;
}
.sidebar h3 {
  margin: 0 0 0.3rem;
}
.hint {
  margin: 0 0 1rem;
  font-size: 0.8rem;
  color: #7f93b3;
}
.build-open {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
  padding: 0.65rem 0.8rem;
  margin-bottom: 0.5rem;
  border-radius: 9px;
  border: 1px solid rgba(120, 160, 220, 0.25);
  background: #131c30;
  color: #e6eefc;
  cursor: pointer;
  font-weight: 700;
}
.build-open:hover {
  border-color: #4fc3f7;
  box-shadow: 0 0 0 1px #4fc3f7 inset;
}
.build-open small {
  color: #8496b5;
  font-weight: 600;
}
.swatch {
  width: 22px;
  height: 22px;
  border-radius: 5px;
  flex: none;
}

.collect {
  width: 100%;
  margin-top: 0.5rem;
  padding: 0.65rem;
  border: none;
  border-radius: 9px;
  background: linear-gradient(135deg, #4fc3f7, #2a7fd8);
  color: #04101f;
  font-weight: 700;
  cursor: pointer;
}
.selected-note {
  margin-top: 0.9rem;
  font-size: 0.85rem;
  color: #9fb2cf;
}
.detail {
  margin-top: 1.2rem;
  padding: 0.9rem;
  border-radius: 10px;
  border: 1px solid rgba(120, 160, 220, 0.2);
  background: #131c30;
}
.detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.6rem;
}
.detail-head h3 {
  margin: 0;
  font-size: 1rem;
}
.deselect {
  background: transparent;
  border: 1px solid rgba(120, 160, 220, 0.3);
  color: #cfe0ff;
  border-radius: 6px;
  width: 24px;
  height: 24px;
  line-height: 1;
  cursor: pointer;
  font-size: 0.8rem;
}
.deselect:hover {
  border-color: #ff8080;
  color: #ff8080;
}
.detail-row {
  display: flex;
  justify-content: space-between;
  font-size: 0.85rem;
  padding: 0.2rem 0;
  color: #9fb2cf;
}
.detail-row strong {
  color: #e6eefc;
}
.protection .res-value {
  color: #b07d4f;
}
.cost-label {
  margin-top: 0.8rem;
  font-size: 0.8rem;
  color: #9fb2cf;
}
.cost-list {
  display: flex;
  gap: 0.8rem;
  margin-top: 0.35rem;
  flex-wrap: wrap;
}
.cost-item {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.85rem;
  font-weight: 700;
}
.upgrade {
  width: 100%;
  margin-top: 0.8rem;
  padding: 0.6rem;
  border: none;
  border-radius: 8px;
  background: linear-gradient(135deg, #f4c542, #d89a2a);
  color: #04101f;
  font-weight: 700;
  cursor: pointer;
  font-size: 0.85rem;
}
.max-note {
  margin-top: 0.8rem;
  font-size: 0.85rem;
  color: #8fd39a;
  text-align: center;
}
.demolish {
  width: 100%;
  margin-top: 0.8rem;
  padding: 0.5rem;
  border: 1px solid rgba(179, 69, 58, 0.6);
  border-radius: 8px;
  background: transparent;
  color: #e08a80;
  font-weight: 600;
  cursor: pointer;
  font-size: 0.82rem;
}
.demolish:hover {
  background: rgba(179, 69, 58, 0.15);
}
.demolish-confirm {
  margin-top: 0.8rem;
  padding: 0.6rem;
  border-radius: 8px;
  border: 1px solid rgba(179, 69, 58, 0.5);
  background: rgba(179, 69, 58, 0.1);
}
.demolish-q {
  margin: 0 0 0.4rem;
  font-size: 0.85rem;
  color: #e6eefc;
}
.demolish-refund {
  margin: 0 0 0.6rem;
  font-size: 0.8rem;
  color: #9fb2cf;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: center;
}
.demolish-actions {
  display: flex;
  gap: 0.5rem;
}
.demolish-yes,
.demolish-no {
  flex: 1;
  padding: 0.45rem;
  border: none;
  border-radius: 7px;
  font-weight: 700;
  cursor: pointer;
  font-size: 0.82rem;
}
.demolish-yes {
  background: #b3453a;
  color: #fff;
}
.demolish-no {
  background: #2a3550;
  color: #cfe0ff;
}
.capped-note {
  margin-top: 0.8rem;
  padding: 0.5rem;
  border-radius: 8px;
  background: rgba(201, 176, 55, 0.12);
  border: 1px solid rgba(201, 176, 55, 0.4);
  color: #c9b037;
  font-size: 0.82rem;
  text-align: center;
}
.busy-note {
  margin-top: 0.8rem;
  padding: 0.5rem;
  border-radius: 8px;
  background: rgba(244, 197, 66, 0.12);
  border: 1px solid rgba(244, 197, 66, 0.35);
  color: #f4c542;
  font-size: 0.85rem;
  text-align: center;
}
.builds-hint {
  margin: 0.6rem 0 0;
  padding: 0.5rem;
  border-radius: 8px;
  background: rgba(244, 197, 66, 0.12);
  border: 1px solid rgba(244, 197, 66, 0.35);
  color: #f4c542;
  font-size: 0.8rem;
  text-align: center;
}
.queue {
  width: 260px;
  padding: 1rem;
  background: #0e1524;
  border-left: 1px solid rgba(120, 160, 220, 0.15);
  overflow-y: auto;
}
.queue-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.8rem;
}
.queue-head h3 {
  margin: 0;
  font-size: 1rem;
}
.queue-count {
  font-size: 0.85rem;
  font-weight: 700;
  color: #8fd39a;
  background: rgba(143, 211, 154, 0.12);
  border: 1px solid rgba(143, 211, 154, 0.3);
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
}
.queue-count.full {
  color: #f4c542;
  background: rgba(244, 197, 66, 0.12);
  border-color: rgba(244, 197, 66, 0.35);
}
.queue-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.queue-item {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.55rem 0.6rem;
  border-radius: 9px;
  border: 1px solid rgba(120, 160, 220, 0.2);
  background: #131c30;
  cursor: pointer;
}
.queue-item:hover {
  border-color: rgba(120, 160, 220, 0.45);
}
.queue-item.selected {
  border-color: #4fc3f7;
  box-shadow: 0 0 0 1px #4fc3f7 inset;
}
.queue-swatch {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  flex: none;
}
.queue-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.queue-info strong {
  font-size: 0.85rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.queue-info small {
  color: #8496b5;
  font-size: 0.75rem;
}
.queue-time {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  font-size: 0.82rem;
  color: #f4c542;
  flex: none;
}
.stage {
  flex: 1;
  position: relative;
  min-width: 0;
  display: grid;
  place-items: center;
  background:
    radial-gradient(circle at 50% 40%, #16233b, #0a0e17 75%);
  overflow: hidden;
  transition: background 0.4s ease;
}
/* Deeper, bluer "outer space" backdrop for the orbital defense base. */
.stage-planetary {
  background:
    radial-gradient(circle at 50% 40%, rgba(61, 139, 255, 0.22), transparent 60%),
    radial-gradient(circle at 50% 38%, #122246, #050a1a 78%);
  background-color: #050a1a;
}
.loading {
  color: #93a6c6;
}
.action-card {
  position: fixed;
  z-index: 55;
  width: 260px;
  max-height: 80vh;
  overflow-y: auto;
  background: rgba(14, 21, 36, 0.98);
  border: 1px solid rgba(120, 160, 220, 0.35);
  border-radius: 12px;
  padding: 0.8rem 0.9rem;
  box-shadow: 0 16px 44px rgba(0, 0, 0, 0.6);
}
.action-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  margin-bottom: 0.6rem;
}
.action-card-head strong {
  color: #eaf2ff;
  font-size: 0.95rem;
}
.action-card-x {
  background: transparent;
  border: 1px solid rgba(120, 160, 220, 0.3);
  color: #cfe0ff;
  border-radius: 6px;
  width: 26px;
  height: 26px;
  cursor: pointer;
  flex: none;
  font-size: 0.8rem;
}
.action-card-x:hover {
  border-color: #ff8080;
  color: #ff8080;
}
.hover-tip {
  position: fixed;
  z-index: 50;
  min-width: 180px;
  background: rgba(16, 24, 42, 0.97);
  border: 1px solid rgba(120, 160, 220, 0.35);
  border-radius: 10px;
  padding: 0.6rem 0.7rem;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  font-size: 0.82rem;
  pointer-events: auto;
}
.hover-tip-title {
  font-weight: 700;
  color: #cfe0ff;
  margin-bottom: 0.4rem;
}
.hover-tip-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  color: #9fb2cf;
  margin-bottom: 0.5rem;
}
.hover-tip-row .muted {
  color: #7f93b3;
}
.hover-tip-btn {
  width: 100%;
  padding: 0.45rem;
  border: none;
  border-radius: 7px;
  background: linear-gradient(135deg, #4fc3f7, #2a7fd8);
  color: #04101f;
  font-weight: 700;
  cursor: pointer;
  font-size: 0.82rem;
}
.hover-tip-btn:disabled {
  background: #2a3550;
  color: #7f93b3;
  cursor: default;
}
.flash {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(20, 30, 50, 0.95);
  border: 1px solid rgba(120, 160, 220, 0.3);
  padding: 0.6rem 1rem;
  border-radius: 9px;
  font-size: 0.9rem;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* Hidden on desktop; only used on mobile. */
.drawer-backdrop,
.mobile-fabs,
.bottom-sheet {
  display: none;
}

/* ============================ MOBILE ============================ */
@media (max-width: 900px) {
  /* Compact top bar that wraps instead of overflowing. */
  .topbar {
    padding: 0.5rem 0.7rem;
    flex-wrap: wrap;
    gap: 0.4rem 0.6rem;
  }
  .brand {
    font-size: 0.9rem;
    gap: 0.4rem;
  }
  .brand-name {
    /* Keep the badge; drop the long product name on tiny screens. */
    display: none;
  }
  .base-badge {
    font-size: 0.68rem;
  }
  .account {
    margin-left: auto;
    gap: 0.5rem;
  }
  .who {
    display: none;
  }
  /* Resources become a horizontally scrollable strip spanning the full row. */
  .resources {
    order: 3;
    width: 100%;
    gap: 0.7rem;
    overflow-x: auto;
    padding-bottom: 0.15rem;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .resources::-webkit-scrollbar {
    display: none;
  }
  .res {
    flex: none;
    font-size: 0.82rem;
    gap: 0.3rem;
  }
  .res-label {
    font-size: 0.72rem;
  }

  /* The stage takes the whole width; sidebars slide in as drawers over it. */
  .layout {
    position: relative;
  }
  .sidebar,
  .queue {
    position: absolute;
    top: 0;
    bottom: 0;
    z-index: 45;
    width: min(300px, 86vw);
    transition: transform 0.28s ease;
    box-shadow: 0 0 40px rgba(0, 0, 0, 0.6);
  }
  .sidebar {
    left: 0;
    transform: translateX(-102%);
    border-right: 1px solid rgba(120, 160, 220, 0.25);
  }
  .queue {
    right: 0;
    transform: translateX(102%);
    border-left: 1px solid rgba(120, 160, 220, 0.25);
  }
  .sidebar.drawer-open,
  .queue.drawer-open {
    transform: translateX(0);
  }
  .drawer-backdrop {
    display: block;
    position: absolute;
    inset: 0;
    z-index: 40;
    background: rgba(4, 8, 16, 0.5);
  }

  /* Floating toggles overlaid on the map. */
  .mobile-fabs {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    position: absolute;
    left: 12px;
    top: 12px;
    z-index: 30;
  }
  .fab {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    width: 52px;
    height: 52px;
    border-radius: 14px;
    border: 1px solid rgba(120, 160, 220, 0.3);
    background: rgba(16, 24, 42, 0.92);
    color: #cfe0ff;
    font-size: 1.2rem;
    cursor: pointer;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
  }
  .fab.active {
    border-color: #4fc3f7;
    box-shadow: 0 0 0 1px #4fc3f7 inset, 0 6px 18px rgba(0, 0, 0, 0.45);
  }
  .fab-label {
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.2px;
  }
  .fab-badge {
    position: absolute;
    top: -4px;
    right: -4px;
    min-width: 18px;
    height: 18px;
    padding: 0 4px;
    border-radius: 999px;
    background: #f4c542;
    color: #04101f;
    font-size: 0.68rem;
    font-weight: 800;
    display: grid;
    place-items: center;
  }

  /* Selected-structure detail as a bottom sheet. */
  .bottom-sheet {
    display: block;
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 46;
    max-height: 72vh;
    overflow-y: auto;
    background: #0e1524;
    border-top: 1px solid rgba(120, 160, 220, 0.3);
    border-radius: 16px 16px 0 0;
    padding: 0.4rem 1rem 1.1rem;
    box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.55);
  }
  .sheet-grip {
    width: 42px;
    height: 4px;
    border-radius: 999px;
    background: rgba(120, 160, 220, 0.5);
    margin: 0.4rem auto 0.6rem;
    cursor: pointer;
  }
  .sheet-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    margin-bottom: 0.5rem;
  }
  .sheet-head strong {
    color: #eaf2ff;
    font-size: 0.95rem;
  }
  .sheet-enter-active,
  .sheet-leave-active {
    transition: transform 0.28s ease, opacity 0.28s ease;
  }
  .sheet-enter-from,
  .sheet-leave-to {
    transform: translateY(100%);
    opacity: 0.4;
  }
}

/* Extra squeeze for very small phones. */
@media (max-width: 480px) {
  .base-badge .b-long {
    display: none;
  }
  .topbar {
    padding: 0.45rem 0.55rem;
  }
}
</style>
