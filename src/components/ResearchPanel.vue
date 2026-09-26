<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useResearchStore } from '../stores/research'

/**
 * Centro de Pesquisa research modal.
 *
 * Shows the two research trees (technology / plants) as a tabbed list. Each
 * entry shows its gold cost, wait time (already reduced by the Research
 * Center's level), dependencies and required inventory items, plus a
 * "Pesquisar" button. Only one research can run at a time; while one is in
 * progress a banner with a live countdown is shown and every button is
 * disabled.
 */
const props = defineProps({
  // The selected Centro de Pesquisa structure (category 'research').
  structure: { type: Object, required: true },
})

const emit = defineEmits(['close'])

const research = useResearchStore()

// Active tab: 'technology' | 'plant'.
const tab = ref('technology')

// Active technology area sub-filter ('all' shows every area).
const area = ref('all')

const areaFilters = [
  { key: 'all', label: 'Todas' },
  { key: 'terrestrial', label: 'Base Terrestre' },
  { key: 'aerial', label: 'Aérea' },
  { key: 'weapons', label: 'Armamentos' },
]

// Local 1s ticker so the active-research countdown updates live.
const nowTs = ref(Date.now())
let timer = null

onMounted(() => {
  research.load()
  timer = setInterval(() => {
    nowTs.value = Date.now()
    // When any in-progress research is due, refresh to pick up completed levels.
    const due = research.active.some(
      (a) => a.finish_at && new Date(a.finish_at).getTime() <= nowTs.value
    )
    if (due) research.load()
  }, 1000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

const tabs = [
  { key: 'technology', label: 'Tecnologia' },
  { key: 'plant', label: 'Plantas' },
]

const visible = computed(() => {
  if (tab.value !== 'technology') return research.plants
  const techs = research.technologies
  if (area.value === 'all') return techs
  return techs.filter((d) => d.area === area.value)
})

// In-progress research for the active tab (a technology lane holds 1, the
// plant lane holds up to 3).
const activeForTab = computed(() =>
  research.active.filter((a) => a.type === tab.value)
)

// Per-lane slot usage shown in the header (e.g. "Plantas 2/3").
const slots = computed(() =>
  tab.value === 'technology' ? research.technologySlots : research.plantSlots
)

// Remaining seconds for a given active-research entry, from the local ticker.
function remainingFor(a) {
  if (!a || !a.finish_at) return 0
  return Math.max(0, Math.round((new Date(a.finish_at).getTime() - nowTs.value) / 1000))
}

// Golden overlay intensity for a technology, scaling with its researched
// level. Ranges from a faint glow at level 1 up to a strong sheen at max.
function goldOpacity(d) {
  const max = d.max_level > 1 ? d.max_level : 1
  const ratio = Math.min(1, (d.current_level || 0) / max)
  // 0.15 floor once researched, up to ~0.7 at max level.
  return (0.15 + ratio * 0.55).toFixed(3)
}

function formatTime(totalSeconds) {
  const t = Math.max(0, totalSeconds || 0)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const sec = t % 60
  if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m`
  if (m > 0) return `${m}m ${sec.toString().padStart(2, '0')}s`
  return `${sec}s`
}

async function startResearch(def) {
  if (!def.can_start) return
  await research.start(def.id)
}

function close() {
  emit('close')
}
</script>

<template>
  <div class="modal-backdrop" @click.self="close">
    <div class="modal">
      <header class="modal-head">
        <div>
          <h2>{{ structure.type.name }} · Nv {{ structure.level }}</h2>
          <p class="sub">
            Redução de tempo: <strong>{{ research.timeReduction }}%</strong>
            · Ouro: <strong>{{ research.gold }}</strong>
          </p>
        </div>
        <button class="x" title="Fechar" @click="close">✕</button>
      </header>

      <!-- Tabs -->
      <div class="filters">
        <button
          v-for="t in tabs"
          :key="t.key"
          class="filter"
          :class="{ active: tab === t.key }"
          @click="tab = t.key"
        >{{ t.label }}</button>
        <span class="slots">Em andamento: {{ slots.used }} / {{ slots.max }}</span>
      </div>

      <!-- Area sub-filter (technologies only) -->
      <div v-if="tab === 'technology'" class="area-filters">
        <button
          v-for="a in areaFilters"
          :key="a.key"
          class="area-filter"
          :class="{ active: area === a.key }"
          @click="area = a.key"
        >{{ a.label }}</button>
      </div>

      <!-- Active research for this lane (1 technology / up to 3 plants) -->
      <div v-if="activeForTab.length" class="active-list">
        <div
          v-for="a in activeForTab"
          :key="a.research_definition_id"
          class="active-banner"
        >
          <div class="active-info">
            <strong>Pesquisando: {{ a.name }}</strong>
            <span v-if="a.target_level" class="muted"> (→ nível {{ a.target_level }})</span>
          </div>
          <div class="active-time">{{ formatTime(remainingFor(a)) }}</div>
        </div>
      </div>

      <div v-if="research.loading && !research.loaded" class="loading">Carregando pesquisas...</div>

      <template v-else>
        <p v-if="visible.length === 0" class="empty">
          Nenhuma pesquisa deste tipo disponível.
        </p>

        <div v-else class="item-grid">
          <div v-for="d in visible" :key="d.id" class="item-card">
            <!-- Artwork: one image per research, shared across all levels.
                 Technologies get a golden glow that intensifies per level. -->
            <div class="thumb" :class="{ researched: d.current_level > 0 }">
              <img v-if="d.image_url" :src="d.image_url" :alt="d.name" class="thumb-img" />
              <div v-else class="thumb-ph">🖼️</div>
              <div
                v-if="d.type === 'technology' && d.current_level > 0"
                class="thumb-gold"
                :style="{ opacity: goldOpacity(d) }"
              ></div>
              <span v-if="d.current_level > 0" class="thumb-lvl">Nv {{ d.current_level }}</span>
            </div>

            <div class="item-head">
              <span class="dot" :style="{ background: d.color || '#7ec8e3' }"></span>
              <strong>{{ d.name }}</strong>
              <span class="lvl">
                Nv {{ d.current_level }}<template v-if="d.max_level > 1"> / {{ d.max_level }}</template>
              </span>
            </div>

            <p v-if="d.type === 'technology' && d.area_label" class="area-tag">{{ d.area_label }}</p>

            <p v-if="d.description" class="item-desc">{{ d.description }}</p>

            <!-- Cost + time -->
            <div class="stats">
              <span class="stat" :class="{ bad: !d.can_afford }">
                Ouro: {{ d.gold_cost }}
              </span>
              <span class="stat">Tempo: {{ formatTime(d.research_time) }}</span>
            </div>

            <!-- Dependencies (technologies) -->
            <div v-if="d.dependencies.length" class="reqs">
              <span class="reqs-label">Requer:</span>
              <span
                v-for="dep in d.dependencies"
                :key="dep.id"
                class="req"
                :class="{ met: dep.met, unmet: !dep.met }"
              >{{ dep.name }} Nv {{ dep.min_level }} ({{ dep.current_level }})</span>
            </div>

            <!-- Item requirements (plants / consumed items) -->
            <div v-if="d.requirements.length" class="reqs">
              <span class="reqs-label">Itens:</span>
              <span
                v-for="r in d.requirements"
                :key="r.item_key"
                class="req"
                :class="{ met: r.met, unmet: !r.met }"
              >
                {{ r.name }}
                <template v-if="r.consumed">(x{{ r.quantity }})</template>
                <template v-else>(necessário)</template>
                · {{ r.owned }}
              </span>
            </div>

            <!-- Action -->
            <p v-if="d.is_max_level" class="max-note">Nível máximo atingido.</p>
            <button
              v-else
              class="action"
              :disabled="!d.can_start"
              @click="startResearch(d)"
            >
              <template v-if="d.in_progress">Em andamento</template>
              <template v-else-if="!d.dependencies_met">Requisitos pendentes</template>
              <template v-else-if="!d.requirements_met">Itens faltando</template>
              <template v-else-if="!d.can_afford">Ouro insuficiente</template>
              <template v-else-if="d.lane_full">Limite em andamento</template>
              <template v-else>Pesquisar</template>
            </button>
          </div>
        </div>
      </template>

      <transition name="fade"><p v-if="research.error" class="flash">{{ research.error }}</p></transition>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(4, 8, 16, 0.66);
  display: grid;
  place-items: center;
  z-index: 60;
}
.modal {
  width: min(820px, 94vw);
  max-height: 88vh;
  overflow-y: auto;
  background: #0e1524;
  border: 1px solid rgba(120, 160, 220, 0.25);
  border-radius: 14px;
  padding: 1.2rem 1.3rem;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.55);
}
.modal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}
.modal-head h2 {
  margin: 0;
  font-size: 1.15rem;
  color: #eaf2ff;
}
.sub {
  margin: 0.3rem 0 0;
  font-size: 0.85rem;
  color: #9fb2cf;
}
.x {
  background: transparent;
  border: 1px solid rgba(120, 160, 220, 0.3);
  color: #cfe0ff;
  border-radius: 7px;
  width: 30px;
  height: 30px;
  cursor: pointer;
  flex: none;
}
.x:hover {
  border-color: #ff8080;
  color: #ff8080;
}
.active-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  background: linear-gradient(135deg, rgba(126, 200, 227, 0.16), rgba(63, 143, 176, 0.12));
  border: 1px solid rgba(126, 200, 227, 0.4);
  border-radius: 10px;
  padding: 0.6rem 0.9rem;
  margin-bottom: 1rem;
  color: #d6f0fa;
}
.active-time {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  color: #eaf2ff;
}
.filters {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
.filter {
  background: #131c30;
  border: 1px solid rgba(120, 160, 220, 0.25);
  color: #cfe0ff;
  border-radius: 8px;
  padding: 0.4rem 0.9rem;
  cursor: pointer;
  font-size: 0.85rem;
}
.filter.active {
  background: #1e63d6;
  border-color: #3d8bff;
  color: #fff;
}
.slots {
  margin-left: auto;
  align-self: center;
  font-size: 0.8rem;
  color: #9fb2cf;
}
.area-filters {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}
.area-filter {
  background: transparent;
  border: 1px solid rgba(120, 160, 220, 0.2);
  color: #9fb2cf;
  border-radius: 999px;
  padding: 0.25rem 0.75rem;
  cursor: pointer;
  font-size: 0.78rem;
}
.area-filter.active {
  background: rgba(126, 200, 227, 0.16);
  border-color: #7ec8e3;
  color: #d6f0fa;
}
.area-tag {
  margin: 0;
  align-self: flex-start;
  font-size: 0.72rem;
  color: #9fb2cf;
  background: rgba(120, 160, 220, 0.12);
  border-radius: 6px;
  padding: 0.1rem 0.5rem;
}
.active-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
.active-list .active-banner {
  margin-bottom: 0;
}
.loading,
.empty {
  color: #9fb2cf;
  font-size: 0.9rem;
  padding: 1rem 0;
}
.item-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 0.8rem;
}
.item-card {
  background: #131c30;
  border: 1px solid rgba(120, 160, 220, 0.18);
  border-radius: 10px;
  padding: 0.8rem 0.9rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.thumb {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 8px;
  overflow: hidden;
  background: #0e1420;
  border: 1px solid rgba(120, 160, 220, 0.18);
  display: grid;
  place-items: center;
}
.thumb.researched {
  border-color: rgba(255, 199, 89, 0.5);
}
.thumb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.thumb-ph {
  font-size: 2rem;
  opacity: 0.6;
}
/* Golden sheen laid over a researched technology's artwork. Opacity is
   bound inline and grows with the researched level. */
.thumb-gold {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(circle at 50% 40%, rgba(255, 215, 120, 0.9), rgba(255, 190, 60, 0.25) 55%, transparent 75%),
    linear-gradient(135deg, rgba(255, 208, 92, 0.35), rgba(212, 160, 40, 0.15));
  mix-blend-mode: screen;
  transition: opacity 0.4s ease;
}
.thumb-lvl {
  position: absolute;
  right: 6px;
  bottom: 6px;
  font-size: 0.72rem;
  font-weight: 700;
  color: #1c1405;
  background: linear-gradient(135deg, #ffd76a, #e6a927);
  border-radius: 999px;
  padding: 0.05rem 0.5rem;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
}
.item-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.item-head strong {
  color: #eaf2ff;
  font-size: 0.95rem;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex: none;
}
.lvl {
  margin-left: auto;
  font-size: 0.78rem;
  color: #9fb2cf;
}
.item-desc {
  margin: 0;
  font-size: 0.8rem;
  color: #9fb2cf;
  line-height: 1.35;
}
.stats {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
}
.stat {
  font-size: 0.8rem;
  color: #cfe0ff;
  background: rgba(120, 160, 220, 0.12);
  border-radius: 6px;
  padding: 0.15rem 0.5rem;
}
.stat.bad {
  color: #ff9d9d;
  background: rgba(255, 120, 120, 0.12);
}
.reqs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.75rem;
}
.reqs-label {
  color: #7f92ad;
}
.req {
  border-radius: 6px;
  padding: 0.1rem 0.45rem;
}
.req.met {
  color: #9be7b8;
  background: rgba(76, 175, 125, 0.15);
}
.req.unmet {
  color: #ffc178;
  background: rgba(255, 170, 80, 0.12);
}
.max-note {
  margin: 0;
  font-size: 0.82rem;
  color: #9be7b8;
}
.action {
  margin-top: auto;
  background: linear-gradient(135deg, #7ec8e3, #3f8fb0);
  color: #03141c;
  border: none;
  border-radius: 8px;
  padding: 0.5rem 0.8rem;
  cursor: pointer;
  font-weight: 600;
  font-size: 0.85rem;
}
.action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.flash {
  margin-top: 1rem;
  color: #ff9d9d;
  font-size: 0.85rem;
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
