<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useFleetStore } from '../stores/fleet'
import Thumb from './Thumb.vue'

/**
 * Aircraft Hangar management modal.
 *
 * Level 1: a grid of the hangar's build slots (how many parallel build queues
 * the current hangar level grants).
 * Level 2: clicking a slot opens a view split by aircraft class (Cruzador,
 * Encouraçado, Fragata, Caça) with empty build spots. Actually queuing a build
 * is the next step, so the spots are placeholders for now.
 */
const props = defineProps({
  // The selected hangar structure (category 'support').
  structure: { type: Object, required: true },
})

const emit = defineEmits(['close'])

const fleet = useFleetStore()

// Which slot is open (null = slot list view).
const openSlot = ref(null)
// Per-design quantity inputs in the build view.
const qty = ref({})
const flash = ref(null)
const collecting = ref(false)

// A client-side clock so the countdown ticks without re-fetching.
const now = ref(Date.now())
let clock = null

onMounted(() => {
  // Refresh the fleet snapshot so slot count / capacity are current.
  fleet.load()
  clock = setInterval(() => {
    now.value = Date.now()
  }, 1000)
})

onBeforeUnmount(() => {
  if (clock) clearInterval(clock)
})

const slotCount = computed(() => fleet.fleet?.build_slots ?? 0)
const capacity = computed(() => fleet.fleet?.capacity ?? 0)
const used = computed(() => fleet.fleet?.used ?? 0)
const remaining = computed(() => fleet.fleet?.remaining ?? 0)
const reduction = computed(() => fleet.fleet?.build_time_reduction ?? 0)

// A slot is a simple index; the build view lists the player's ship designs.
const slots = computed(() => Array.from({ length: slotCount.value }, (_, i) => i))

const designs = computed(() => fleet.designs)

// Orders currently building in a given slot.
function ordersInSlot(slotIndex) {
  return fleet.buildOrders.filter((o) => o.slot === slotIndex)
}

// Seconds remaining for an order, computed against the live clock so it ticks
// down without re-fetching. Falls back to the server's remaining_seconds.
function orderRemaining(order) {
  if (order.finishes_at) {
    const finish = new Date(order.finishes_at).getTime()
    return Math.max(0, Math.ceil((finish - now.value) / 1000))
  }
  return Math.max(0, order.remaining_seconds || 0)
}

// Aggregated summary for a slot: total ships and the final finish time (the
// max remaining across the slot's orders). `ready` flips true once time passes.
function slotSummary(slotIndex) {
  const orders = ordersInSlot(slotIndex)
  const count = orders.length
  const finalRemaining = orders.reduce((max, o) => Math.max(max, orderRemaining(o)), 0)
  return {
    count,
    finalRemaining,
    ready: count > 0 && finalRemaining === 0,
  }
}

function openSlotView(i) {
  openSlot.value = i
}

function backToSlots() {
  openSlot.value = null
}

function qtyFor(designId) {
  return qty.value[designId] || 1
}

function setQty(designId, value) {
  const n = Math.max(1, Math.min(1000, parseInt(value, 10) || 1))
  qty.value[designId] = n
}

async function build(design) {
  const n = qtyFor(design.id)
  const ok = await fleet.build(design.id, n)
  flash.value = ok ? `Construção de ${n}x ${design.name} iniciada.` : fleet.error
  setTimeout(() => (flash.value = null), 2500)
}

async function collect() {
  collecting.value = true
  const collected = await fleet.collect()
  collecting.value = false
  if (collected === false) {
    flash.value = fleet.error
  } else {
    flash.value = collected > 0 ? `${collected} nave(s) recolhida(s).` : 'Nenhuma nave pronta.'
  }
  setTimeout(() => (flash.value = null), 2500)
}

function close() {
  emit('close')
}

function formatTime(totalSeconds) {
  const s = Math.max(0, totalSeconds || 0)
  const m = Math.floor(s / 60)
  const sec = s % 60
  if (m > 0) return `${m}m ${sec.toString().padStart(2, '0')}s`
  return `${sec}s`
}
</script>

<template>
  <div class="modal-backdrop" @click.self="close">
    <div class="modal">
      <header class="modal-head">
        <div>
          <h2>{{ structure.type.name }} · Nv {{ structure.level }}</h2>
          <p class="sub">
            Slots de construção: <strong>{{ slotCount }}</strong>
            · Capacidade da frota: <strong>{{ used }} / {{ capacity }}</strong>
            <template v-if="reduction > 0"> · Redução de tempo: <strong>{{ reduction }}%</strong></template>
          </p>
        </div>
        <button class="x" title="Fechar" @click="close">✕</button>
      </header>

      <div v-if="fleet.loading && !fleet.loaded" class="loading">Carregando hangar...</div>

      <!-- Slot list -->
      <template v-else-if="openSlot === null">
        <p v-if="slotCount === 0" class="empty">
          Este hangar ainda não possui slots de construção. Evolua o hangar para liberar slots.
        </p>
        <div v-else class="slot-grid">
          <button
            v-for="i in slots"
            :key="i"
            class="slot"
            @click="openSlotView(i)"
          >
            <span class="slot-num">Slot {{ i + 1 }}</span>
            <span class="slot-state">
              <template v-if="slotSummary(i).count > 0">
                <template v-if="slotSummary(i).ready">
                  {{ slotSummary(i).count }} pronta(s) · recolher
                </template>
                <template v-else>
                  {{ slotSummary(i).count }} em construção · {{ formatTime(slotSummary(i).finalRemaining) }}
                </template>
              </template>
              <template v-else>Vazio</template>
            </span>
          </button>
        </div>
      </template>

      <!-- Per-slot build view: build from the player's saved ship designs -->
      <template v-else>
        <p class="crumb"><button class="link" @click="backToSlots">&larr; Slots</button> / Slot {{ openSlot + 1 }}</p>

        <!-- Aggregated summary for this slot: one card with total ships and the
             final finish time; a "Recolher naves" button enables once ready. -->
        <div v-if="slotSummary(openSlot).count" class="queue-card">
          <div class="queue-info">
            <span class="queue-count">{{ slotSummary(openSlot).count }} nave(s) em construção</span>
            <span v-if="!slotSummary(openSlot).ready" class="queue-time">
              Tempo restante: <strong>{{ formatTime(slotSummary(openSlot).finalRemaining) }}</strong>
            </span>
            <span v-else class="queue-ready">Pronto para recolher</span>
          </div>
          <button
            class="collect-btn"
            :disabled="!slotSummary(openSlot).ready || collecting"
            @click="collect"
          >
            {{ collecting ? 'Recolhendo...' : 'Recolher naves' }}
          </button>
        </div>

        <p class="cap-note">Capacidade livre: <strong>{{ remaining }}</strong> / {{ capacity }}</p>

        <p v-if="designs.length === 0" class="empty">
          Nenhum modelo de nave salvo. Use "Montar modelo de nave" para criar um.
        </p>

        <div v-else class="design-grid">
          <div v-for="d in designs" :key="d.id" class="design-col">
            <div class="design-head">
              <Thumb :src="d.base_type.image_url" :alt="d.base_type.name" :size="34" />
              <strong>{{ d.name }}</strong>
            </div>
            <p class="design-meta">
              {{ d.base_type.name }} · atk {{ d.summary.attack }}
              <template v-if="d.summary.weapon_type"> ({{ d.summary.weapon_type }})</template>
            </p>
            <p class="design-meta">
              Custo:
              <span v-if="d.summary.cost.gold">{{ d.summary.cost.gold }}⦿</span>
              <span v-if="d.summary.cost.metal">{{ d.summary.cost.metal }}▣</span>
              <span v-if="d.summary.cost.energy">{{ d.summary.cost.energy }}⚡</span>
              · {{ formatTime(d.effective_build_time) }}
            </p>
            <div class="build-row">
              <input
                type="number"
                min="1"
                max="1000"
                :value="qtyFor(d.id)"
                @input="setQty(d.id, $event.target.value)"
              />
              <button class="build-btn" :disabled="remaining < 1" @click="build(d)">Construir</button>
            </div>
            <p class="owned">
              Na frota: <strong>{{ d.owned }}</strong>
              <template v-if="d.in_progress"> · {{ d.in_progress }} em construção</template>
            </p>
          </div>
        </div>

        <transition name="fade"><p v-if="flash" class="flash">{{ flash }}</p></transition>
      </template>
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
  width: min(760px, 94vw);
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
.loading,
.empty {
  color: #9fb2cf;
  font-size: 0.9rem;
  padding: 1rem 0;
}
.slot-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 0.8rem;
}
.slot {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 1rem;
  border-radius: 11px;
  border: 1px solid rgba(120, 160, 220, 0.25);
  background: #131c30;
  color: #e6eefc;
  cursor: pointer;
  text-align: left;
}
.slot:hover {
  border-color: #4fc3f7;
}
.slot-num {
  font-weight: 700;
}
.slot-state {
  font-size: 0.8rem;
  color: #8fa6c6;
}
.crumb {
  font-size: 0.85rem;
  color: #9fb2cf;
  margin: 0 0 0.9rem;
}
.link {
  background: none;
  border: none;
  color: #7fb2ff;
  cursor: pointer;
  padding: 0;
  font-size: 0.85rem;
}
.queue-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.9rem;
  padding: 0.9rem 1rem;
  border-radius: 11px;
  border: 1px solid rgba(120, 160, 220, 0.25);
  background: #131c30;
}
.queue-info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.queue-count { font-weight: 700; color: #e6eefc; font-size: 0.92rem; }
.queue-time { font-size: 0.82rem; color: #9fb2cf; }
.queue-time strong { color: #f4c542; }
.queue-ready { font-size: 0.82rem; color: #8fd39a; font-weight: 700; }
.collect-btn {
  flex: none;
  padding: 0.5rem 0.9rem;
  border: none;
  border-radius: 8px;
  background: linear-gradient(135deg, #6fe08a, #2ea866);
  color: #04101f;
  font-weight: 700;
  cursor: pointer;
}
.collect-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.cap-note { font-size: 0.82rem; color: #9fb2cf; margin: 0 0 0.8rem; }
.cap-note strong { color: #e6eefc; }
.design-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.9rem;
}
.design-col {
  border: 1px solid rgba(120, 160, 220, 0.2);
  border-radius: 11px;
  padding: 0.8rem;
  background: #131c30;
}
.design-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.4rem;
}
.design-meta {
  margin: 0 0 0.4rem;
  font-size: 0.78rem;
  color: #9fb2cf;
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}
.swatch {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  display: inline-block;
}
.build-row {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
.build-row input {
  width: 64px;
  padding: 0.4rem 0.5rem;
  border-radius: 8px;
  border: 1px solid rgba(120, 160, 220, 0.25);
  background: #0e1420;
  color: #eaf2ff;
}
.build-btn {
  flex: 1;
  padding: 0.4rem 0.6rem;
  border: none;
  border-radius: 8px;
  background: linear-gradient(135deg, #4fc3f7, #2a7fd8);
  color: #04101f;
  font-weight: 700;
  cursor: pointer;
}
.build-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.owned {
  margin: 0.6rem 0 0;
  font-size: 0.8rem;
  color: #9fb2cf;
  text-align: center;
}
.owned strong {
  color: #e6eefc;
}
.flash { font-size: 0.82rem; color: #8fd39a; margin: 0.8rem 0 0; text-align: center; }
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
@media (max-width: 520px) {
  .slot-grid { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); }
  .design-grid { grid-template-columns: 1fr; }
}
</style>
