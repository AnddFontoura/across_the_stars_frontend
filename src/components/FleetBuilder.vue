<script setup>
import { computed, onMounted, ref } from 'vue'
import { useCommanderStore } from '../stores/commanders'

/**
 * Fleet builder: name a fleet, assign a commander, and compose it from ship
 * designs (up to 12 slots x 5000 each). Ships come from available inventory
 * (owned minus reserved by other fleets). Shows live aggregated stats after
 * saving (server-computed). Combat is a later step.
 */
const emit = defineEmits(['close'])

const store = useCommanderStore()

const name = ref('')
const commanderId = ref(null)
// designId -> quantity
const picked = ref({})
const editingId = ref(null)
const flash = ref(null)

const CLASS_LABELS = { cruiser: 'Cruzador', battleship: 'Encouraçado', frigate: 'Fragata', fighter: 'Caça' }

onMounted(() => store.loadFleets())

const maxSlots = computed(() => store.limits.max_slots)
const maxPerSlot = computed(() => store.limits.max_per_slot)

const usedSlots = computed(() => Object.values(picked.value).filter((q) => q > 0).length)

// Available quantity for a design, adding back what THIS fleet already reserves
// when editing so the player can keep/raise its own allocation.
function availableFor(designId) {
  const ship = store.availableShips.find((s) => s.ship_design_id === designId)
  const base = ship ? ship.available : 0
  if (!editingId.value) return base
  const fleet = store.fleets.find((f) => f.id === editingId.value)
  const own = fleet?.slots.find((s) => s.ship_design_id === designId)?.quantity || 0
  return base + own
}

function qtyFor(id) {
  return picked.value[id] || 0
}

function setQty(designId, value) {
  const max = Math.min(maxPerSlot.value, availableFor(designId))
  let n = parseInt(value, 10) || 0
  n = Math.max(0, Math.min(max, n))
  // Enforce the 12-slot cap: can't add a NEW design beyond the limit.
  if (n > 0 && !(picked.value[designId] > 0) && usedSlots.value >= maxSlots.value) {
    return
  }
  if (n === 0) delete picked.value[designId]
  else picked.value[designId] = n
}

const valid = computed(() => usedSlots.value >= 1 && usedSlots.value <= maxSlots.value && name.value.trim().length > 0)

function startNew() {
  editingId.value = null
  name.value = ''
  commanderId.value = null
  picked.value = {}
}

function editFleet(f) {
  editingId.value = f.id
  name.value = f.name
  commanderId.value = f.commander_id
  const p = {}
  for (const s of f.slots) p[s.ship_design_id] = s.quantity
  picked.value = p
}

async function save() {
  if (!valid.value) return
  const slots = Object.entries(picked.value)
    .filter(([, q]) => q > 0)
    .map(([id, q]) => ({ ship_design_id: Number(id), quantity: q }))

  const payload = { name: name.value.trim(), commander_id: commanderId.value, slots }
  const ok = await store.saveFleet(payload, editingId.value)
  if (ok) {
    flash.value = 'Frota salva!'
    startNew()
    setTimeout(() => (flash.value = null), 2000)
  } else {
    flash.value = store.error
    setTimeout(() => (flash.value = null), 3000)
  }
}

async function remove(f) {
  await store.deleteFleet(f.id)
  if (editingId.value === f.id) startNew()
}

function close() {
  emit('close')
}
</script>

<template>
  <div class="modal-backdrop" @click.self="close">
    <div class="modal">
      <header class="modal-head">
        <h2>{{ editingId ? 'Editar frota' : 'Montar frota' }}</h2>
        <button class="x" title="Fechar" @click="close">✕</button>
      </header>

      <div class="builder">
        <!-- Composition -->
        <div class="col">
          <label>Nome da frota</label>
          <input v-model="name" maxlength="60" placeholder="Ex.: 1ª Esquadra" />

          <label style="margin-top:.6rem;">Comandante</label>
          <select v-model="commanderId">
            <option :value="null">— sem comandante —</option>
            <option v-for="c in store.fleetCommanders" :key="c.id" :value="c.id">
              {{ c.name }} (Ranking {{ c.rank_label }})
            </option>
          </select>

          <h3>Naves disponíveis <small class="muted">({{ usedSlots }}/{{ maxSlots }} slots)</small></h3>
          <p v-if="store.availableShips.length === 0" class="muted">Nenhuma nave construída. Produza naves no hangar.</p>
          <div v-else class="ship-list">
            <div v-for="s in store.availableShips" :key="s.ship_design_id" class="ship">
              <span class="ship-info">
                <strong>{{ s.name }}</strong>
                <small>{{ CLASS_LABELS[s.class] || s.class }} · disp. {{ availableFor(s.ship_design_id) }}</small>
              </span>
              <input
                type="number" min="0" :max="Math.min(maxPerSlot, availableFor(s.ship_design_id))"
                :value="qtyFor(s.ship_design_id)"
                @input="setQty(s.ship_design_id, $event.target.value)"
              />
            </div>
          </div>

          <button class="save" :disabled="!valid" @click="save">
            {{ editingId ? 'Salvar alterações' : 'Criar frota' }}
          </button>
          <button v-if="editingId" class="cancel" @click="startNew">Cancelar edição</button>
          <transition name="fade"><p v-if="flash" class="flash">{{ flash }}</p></transition>
        </div>

        <!-- Existing fleets -->
        <div class="col fleets">
          <h3>Minhas frotas</h3>
          <p v-if="store.fleets.length === 0" class="muted">Nenhuma frota ainda.</p>
          <div v-for="f in store.fleets" :key="f.id" class="fleet" :class="{ active: f.id === editingId }">
            <div class="fleet-head">
              <strong>{{ f.name }}</strong>
              <span class="fleet-actions">
                <button class="mini" @click="editFleet(f)">Editar</button>
                <button class="mini danger" @click="remove(f)">✕</button>
              </span>
            </div>
            <p class="fleet-meta">
              Comandante: {{ f.commander_name || '—' }} · {{ f.summary.ships }} naves
            </p>
            <p class="fleet-stats">
              ⚔ {{ f.summary.attack }} · 🛡 {{ f.summary.shield }} · 🧱 {{ f.summary.hull }} · 🚀 {{ f.summary.movement }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop { position: fixed; inset: 0; background: rgba(4,8,16,.66); display: grid; place-items: center; z-index: 65; }
.modal { width: min(880px, 95vw); max-height: 90vh; overflow-y: auto; background: #0e1524; border: 1px solid rgba(120,160,220,.25); border-radius: 14px; padding: 1.2rem 1.3rem; box-shadow: 0 20px 60px rgba(0,0,0,.55); }
.modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; }
.modal-head h2 { margin: 0; font-size: 1.15rem; color: #eaf2ff; }
.x { background: transparent; border: 1px solid rgba(120,160,220,.3); color: #cfe0ff; border-radius: 7px; width: 30px; height: 30px; cursor: pointer; }
.x:hover { border-color: #ff8080; color: #ff8080; }
.builder { display: grid; grid-template-columns: 1.3fr 1fr; gap: 1.2rem; }
@media (max-width: 680px) { .builder { grid-template-columns: 1fr; } }
.col label { display: block; font-size: .78rem; color: #9fb2cf; margin-bottom: .25rem; }
.col input, .col select { width: 100%; padding: .5rem .6rem; border-radius: 8px; border: 1px solid rgba(120,160,220,.25); background: #0e1420; color: #eaf2ff; }
.col h3 { margin: 1rem 0 .5rem; font-size: .95rem; }
.muted { color: #7f93b3; font-size: .82rem; }
.ship-list { display: flex; flex-direction: column; gap: .4rem; }
.ship { display: flex; align-items: center; justify-content: space-between; gap: .6rem; padding: .5rem .6rem; border-radius: 9px; border: 1px solid rgba(120,160,220,.2); background: #131c30; }
.ship-info { display: flex; flex-direction: column; }
.ship-info small { color: #8496b5; }
.ship input { width: 84px; }
.save { width: 100%; margin-top: .8rem; padding: .6rem; border: none; border-radius: 8px; background: linear-gradient(135deg,#4fc3f7,#2a7fd8); color: #04101f; font-weight: 700; cursor: pointer; }
.save:disabled { opacity: .4; cursor: not-allowed; }
.cancel { width: 100%; margin-top: .4rem; padding: .45rem; border: 1px solid rgba(120,160,220,.3); border-radius: 8px; background: transparent; color: #cfe0ff; cursor: pointer; }
.flash { font-size: .82rem; color: #8fd39a; margin: .6rem 0 0; text-align: center; }
.fleets .fleet { border: 1px solid rgba(120,160,220,.2); border-radius: 10px; padding: .7rem; background: #131c30; margin-bottom: .6rem; }
.fleets .fleet.active { border-color: #4fc3f7; }
.fleet-head { display: flex; align-items: center; justify-content: space-between; }
.fleet-actions { display: flex; gap: .3rem; }
.mini { padding: .25rem .5rem; border-radius: 6px; border: 1px solid rgba(120,160,220,.3); background: #0e1420; color: #cfe0ff; cursor: pointer; font-size: .75rem; }
.mini.danger { border-color: rgba(179,69,58,.5); color: #e08a80; }
.fleet-meta { margin: .4rem 0 .2rem; font-size: .8rem; color: #9fb2cf; }
.fleet-stats { margin: 0; font-size: .82rem; color: #cfe0ff; }
.fade-enter-active, .fade-leave-active { transition: opacity .3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
