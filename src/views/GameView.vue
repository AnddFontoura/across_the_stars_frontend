<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useGameStore } from '../stores/game'
import IsometricGrid from '../components/IsometricGrid.vue'

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
})

onUnmounted(() => {
  if (ticker) clearInterval(ticker)
  if (poller) clearInterval(poller)
  window.removeEventListener('keydown', onKeydown)
})

const resources = computed(() => game.base?.resources || { gold: 0, metal: 0, energy: 0 })
const totalCollected = computed(() => game.base?.total_collected || { gold: 0, metal: 0, energy: 0 })
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

function selectType(type) {
  if (isTypeDisabled(type)) return
  selectedType.value = selectedType.value?.id === type.id ? null : type
  // Entering placement mode clears any selected structure.
  if (selectedType.value) selectedStructureId.value = null
}

const selectedStructure = computed(() =>
  game.structures.find((s) => s.id === selectedStructureId.value) || null
)

function onSelectStructure(id) {
  selectedStructureId.value = id
  confirmingDemolish.value = false
}

function deselect() {
  selectedStructureId.value = null
  confirmingDemolish.value = false
}

// Clicking empty ground clears the selection (when not placing).
function onGroundClick() {
  if (selectedType.value) return
  deselect()
}

// Esc cancels placement mode or clears the current selection.
function onKeydown(e) {
  if (e.key !== 'Escape') return
  if (selectedType.value) {
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

// --- Demolition (with confirmation) ---
const confirmingDemolish = ref(false)

function askDemolish() {
  confirmingDemolish.value = true
}

function cancelDemolish() {
  confirmingDemolish.value = false
}

async function confirmDemolish() {
  if (!selectedStructure.value) return
  const ok = await game.demolishStructure(selectedStructure.value.id)
  confirmingDemolish.value = false
  if (ok) {
    deselect()
    showFlash('Estrutura desconstruída.')
  } else {
    showFlash(game.error || 'Falha ao desconstruir.')
  }
}

// Sum of a refund object for quick "nothing to refund" checks.
function refundTotal(structure) {
  const r = structure?.demolition_refund
  if (!r) return 0
  return (r.gold || 0) + (r.metal || 0) + (r.energy || 0)
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
  confirmingDemolish.value = false
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
        Across the Stars
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
      <!-- Sidebar: structure catalog -->
      <aside class="sidebar">
        <h3>Estruturas</h3>
        <p class="hint">Selecione e clique no terreno para posicionar.</p>

        <button
          v-for="type in game.structureTypes"
          :key="type.id"
          class="struct-btn"
          :class="{ active: selectedType?.id === type.id }"
          :disabled="isTypeDisabled(type)"
          @click="selectType(type)"
        >
          <span class="swatch" :style="{ background: type.color }"></span>
          <span class="struct-info">
            <strong>{{ type.name }}</strong>
            <small>
              {{ type.width }}x{{ type.height }} · obra {{ formatTime(type.build_time) }}
              <template v-if="type.is_unique && existingTypeIds.includes(type.id)"> · já construído</template>
              <template v-else-if="isLimitReached(type)"> · limite atingido</template>
            </small>
          </span>
        </button>

        <button class="collect" @click="collect">Coletar recursos</button>

        <p v-if="selectedType" class="selected-note">
          Posicionando: <strong>{{ selectedType.name }}</strong><br>
          <small>Clique no terreno. (Selecionar de novo cancela.)</small>
        </p>

        <!-- Details / upgrade panel for a selected placed structure -->
        <div v-if="selectedStructure" class="detail">
          <div class="detail-head">
            <h3>{{ selectedStructure.type.name }}</h3>
            <button class="deselect" title="Desselecionar (Esc)" @click="deselect">✕</button>
          </div>
          <div class="detail-row">
            <span>Nível</span>
            <strong>{{ selectedStructure.level }} / {{ selectedStructure.max_level }}</strong>
          </div>

          <!-- Producer stats (terrestrial) -->
          <template v-if="selectedStructure.type.category === 'producer'">
            <div class="detail-row">
              <span>Produção/min</span>
              <strong>{{ selectedStructure.production_per_minute }}</strong>
            </div>
            <div class="detail-row">
              <span>Capacidade máx.</span>
              <strong>{{ selectedStructure.max_capacity }}</strong>
            </div>
            <div class="detail-row">
              <span>Acumulado</span>
              <strong>{{ livePending(selectedStructure) }}</strong>
            </div>
          </template>

          <!-- Storage stats (terrestrial) -->
          <template v-else-if="selectedStructure.type.category === 'storage'">
            <div class="detail-row">
              <span>Protege por recurso</span>
              <strong>{{ selectedStructure.protection }}</strong>
            </div>
          </template>

          <!-- Planetary structures: hit points (and damage for defenses). -->
          <template v-if="isPlanetary && selectedStructure.max_hp > 0">
            <div class="detail-row">
              <span>Pontos de vida</span>
              <strong>{{ selectedStructure.current_hp }} / {{ selectedStructure.max_hp }}</strong>
            </div>
            <div v-if="selectedStructure.damage > 0" class="detail-row">
              <span>Dano</span>
              <strong>{{ selectedStructure.damage }}</strong>
            </div>
          </template>

          <!-- In-progress build/upgrade -->
          <div v-if="selectedBusy" class="busy-note">
            {{ selectedStructure.busy_kind === 'build' ? 'Construindo' : 'Evoluindo' }}...
            <strong>{{ formatTime(remainingFor(selectedStructure)) }}</strong>
            <template v-if="selectedStructure.busy_kind === 'upgrade' && selectedStructure.pending_level">
              (→ nível {{ selectedStructure.pending_level }})
            </template>
          </div>

          <div v-else-if="selectedStructure.is_max_level" class="max-note">
            Nível máximo atingido.
          </div>

          <div v-else-if="selectedStructure.capped_by_command" class="capped-note">
            <template v-if="commandLevel <= 0">
              Construa um {{ isPlanetary ? 'Centro de Defesa Planetária' : 'Centro de Operações' }}
              para evoluir esta estrutura.
            </template>
            <template v-else>
              Nível limitado pelo {{ isPlanetary ? 'Centro de Defesa' : 'Centro de Operações' }}
              (nível {{ commandLevel }}). Evolua o Centro primeiro.
            </template>
          </div>

          <template v-else>
            <div class="cost-label">Custo do próximo nível:</div>
            <div class="cost-list">
              <span
                v-for="(meta, key) in resourceMeta"
                :key="key"
                v-show="selectedStructure.upgrade_cost[key] > 0"
                class="cost-item"
              >
                <span class="dot" :style="{ background: meta.color }"></span>
                {{ selectedStructure.upgrade_cost[key] }}
              </span>
            </div>
            <div v-if="selectedStructure.upgrade_time" class="cost-label">
              Tempo: {{ formatTime(selectedStructure.upgrade_time) }}
            </div>
            <p
              v-if="buildsFull && selectedStructure.upgrade_time > 0"
              class="builds-hint"
            >
              Máximo de {{ maxConcurrentBuilds }} obras simultâneas atingido.
              Aguarde alguma terminar.
            </p>
            <button
              class="upgrade"
              :disabled="buildsFull && selectedStructure.upgrade_time > 0"
              @click="upgradeSelected"
            >Evoluir</button>
          </template>

          <!-- Demolish -->
          <button
            v-if="!confirmingDemolish"
            class="demolish"
            @click="askDemolish"
          >Desconstruir</button>

          <div v-else class="demolish-confirm">
            <p class="demolish-q">Desconstruir esta estrutura?</p>
            <p class="demolish-refund">
              Reembolso (50% do investido):
              <template v-if="refundTotal(selectedStructure) > 0">
                <span
                  v-for="(meta, key) in resourceMeta"
                  :key="key"
                  v-show="selectedStructure.demolition_refund[key] > 0"
                  class="cost-item"
                >
                  <span class="dot" :style="{ background: meta.color }"></span>
                  {{ selectedStructure.demolition_refund[key] }}
                </span>
              </template>
              <template v-else><strong>nenhum</strong></template>
            </p>
            <div class="demolish-actions">
              <button class="demolish-yes" @click="confirmDemolish">Confirmar</button>
              <button class="demolish-no" @click="cancelDemolish">Cancelar</button>
            </div>
          </div>
        </div>
        <p v-else class="hint" style="margin-top: 1rem;">
          Clique numa estrutura para ver detalhes e evoluir.
          Passe o mouse para ver o acumulado e recolher.
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
          @place="onPlace"
          @select="onSelectStructure"
          @groundclick="onGroundClick"
          @hover="onGridHover"
          @hoverend="onGridHoverEnd"
          @toggle-base="toggleBase"
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

        <!-- HUD: lifetime totals collected -->
        <div class="hud-totals">
          <span class="hud-title">Total já coletado</span>
          <span v-for="(meta, key) in resourceMeta" :key="key" class="hud-item">
            <span class="dot" :style="{ background: meta.color }"></span>
            {{ meta.label }}: <strong>{{ totalCollected[key] }}</strong>
          </span>
        </div>

        <transition name="fade">
          <div v-if="flash" class="flash">{{ flash }}</div>
        </transition>
      </main>

      <!-- Right panel: queue of ongoing builds/upgrades with live countdowns -->
      <aside class="queue">
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
.struct-btn {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.6rem;
  margin-bottom: 0.5rem;
  border-radius: 9px;
  border: 1px solid rgba(120, 160, 220, 0.2);
  background: #131c30;
  color: #e6eefc;
  cursor: pointer;
  text-align: left;
}
.struct-btn.active {
  border-color: #4fc3f7;
  box-shadow: 0 0 0 1px #4fc3f7 inset;
}
.swatch {
  width: 22px;
  height: 22px;
  border-radius: 5px;
  flex: none;
}
.struct-info {
  display: flex;
  flex-direction: column;
}
.struct-info small {
  color: #8496b5;
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
.hud-totals {
  position: absolute;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 1rem;
  background: rgba(16, 24, 42, 0.9);
  border: 1px solid rgba(120, 160, 220, 0.2);
  padding: 0.5rem 1rem;
  border-radius: 10px;
  font-size: 0.82rem;
  color: #cbd8ef;
}
.hud-title {
  color: #7f93b3;
  font-weight: 700;
}
.hud-item {
  display: flex;
  align-items: center;
  gap: 0.35rem;
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
</style>
