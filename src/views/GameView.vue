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

  // Tick every second; when a structure's build/upgrade timer reaches zero,
  // reload the base so the server finalizes it (lazy settle).
  ticker = setInterval(() => {
    nowTs.value = Date.now()
    const hasDueWork = game.structures.some(
      (s) => s.busy_until && new Date(s.busy_until).getTime() <= nowTs.value
    )
    if (hasDueWork) {
      game.loadBase()
    }
  }, 1000)
})

onUnmounted(() => {
  if (ticker) clearInterval(ticker)
})

const resources = computed(() => game.base?.resources || { gold: 0, metal: 0, energy: 0 })
const totalCollected = computed(() => game.base?.total_collected || { gold: 0, metal: 0, energy: 0 })
const protection = computed(() => game.base?.protection || 0)
const structuresUsed = computed(() => game.base?.structures_used || 0)
const maxStructures = computed(() => game.base?.max_structures || 0)

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

function selectType(type) {
  selectedType.value = selectedType.value?.id === type.id ? null : type
  // Entering placement mode clears any selected structure.
  if (selectedType.value) selectedStructureId.value = null
}

const selectedStructure = computed(() =>
  game.structures.find((s) => s.id === selectedStructureId.value) || null
)

function onSelectStructure(id) {
  selectedStructureId.value = id
}

async function upgradeSelected() {
  if (!selectedStructure.value) return
  const ok = await game.upgradeStructure(selectedStructure.value.id)
  showFlash(ok ? 'Estrutura evoluída!' : game.error || 'Falha ao evoluir.')
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
</script>

<template>
  <div class="game">
    <!-- Top bar -->
    <header class="topbar">
      <div class="brand">Across the Stars</div>

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
          @click="selectType(type)"
        >
          <span class="swatch" :style="{ background: type.color }"></span>
          <span class="struct-info">
            <strong>{{ type.name }}</strong>
            <small>{{ type.width }}x{{ type.height }} · nível máx {{ type.max_level }} · obra {{ formatTime(type.build_time) }}</small>
          </span>
        </button>

        <button class="collect" @click="collect">Coletar recursos</button>

        <p v-if="selectedType" class="selected-note">
          Posicionando: <strong>{{ selectedType.name }}</strong><br>
          <small>Clique no terreno. (Selecionar de novo cancela.)</small>
        </p>

        <!-- Details / upgrade panel for a selected placed structure -->
        <div v-if="selectedStructure" class="detail">
          <h3>{{ selectedStructure.type.name }}</h3>
          <div class="detail-row">
            <span>Nível</span>
            <strong>{{ selectedStructure.level }} / {{ selectedStructure.max_level }}</strong>
          </div>

          <!-- Producer stats -->
          <template v-if="selectedStructure.type.category === 'producer'">
            <div class="detail-row">
              <span>Produção/hora</span>
              <strong>{{ selectedStructure.production_per_hour }}</strong>
            </div>
            <div class="detail-row">
              <span>Capacidade máx.</span>
              <strong>{{ selectedStructure.max_capacity }}</strong>
            </div>
            <div class="detail-row">
              <span>Acumulado</span>
              <strong>{{ selectedStructure.pending }}</strong>
            </div>
          </template>

          <!-- Storage stats -->
          <template v-else>
            <div class="detail-row">
              <span>Protege por recurso</span>
              <strong>{{ selectedStructure.protection }}</strong>
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
            <button class="upgrade" @click="upgradeSelected">Evoluir</button>
          </template>
        </div>
        <p v-else class="hint" style="margin-top: 1rem;">
          Clique numa estrutura no terreno para ver detalhes e evoluir.
        </p>
      </aside>

      <!-- Terrain -->
      <main class="stage">
        <div v-if="game.loading" class="loading">Carregando terreno...</div>
        <IsometricGrid
          v-else-if="game.base"
          :width="game.base.width"
          :height="game.base.height"
          :structures="game.structures"
          :selected-type="selectedType"
          :selected-structure-id="selectedStructureId"
          :now-ts="nowTs"
          @place="onPlace"
          @select="onSelectStructure"
        />
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
.detail h3 {
  margin: 0 0 0.6rem;
  font-size: 1rem;
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
.stage {
  flex: 1;
  position: relative;
  min-width: 0;
  display: grid;
  place-items: center;
  background:
    radial-gradient(circle at 50% 40%, #16233b, #0a0e17 75%);
  overflow: hidden;
}
.loading {
  color: #93a6c6;
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
