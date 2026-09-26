<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useBattleStore } from '../stores/battle'
import { useCommanderStore } from '../stores/commanders'
import BattleBoard from './BattleBoard.vue'

/**
 * "Investigação Interplanetária" hub. One modal with three screens:
 *   - list: available investigations (+ resume banner if a run is active);
 *   - dispatch: pick which player fleets to send;
 *   - battle: the live round-by-round viewer (BattleBoard).
 *
 * The battle is server-authoritative: the viewer advances one round at a time
 * (store.step) and plays the returned events back on a timer so the player
 * watches the fight unfold. Leaving and reopening resumes the same run.
 */
const emit = defineEmits(['close', 'changed'])

const battle = useBattleStore()
const commanders = useCommanderStore()

// list | dispatch | battle
const view = ref('list')
const selectedInvestigation = ref(null)
const pickedFleetIds = ref([])

const CLASS_LABELS = { cruiser: 'Cruzador', battleship: 'Encouraçado', frigate: 'Fragata', fighter: 'Caça' }

onMounted(async () => {
  await Promise.all([battle.load(), commanders.loadFleets()])
  // If there's an in-progress run, jump straight into it.
  if (battle.active && !battle.active.is_over) {
    await resume()
  } else if (battle.active && battle.active.status === 'won' && !battle.active.rewards_claimed) {
    await resume()
  }
})

const investigations = computed(() => battle.investigations)
const availableFleets = computed(() => commanders.fleets)

function chooseInvestigation(inv) {
  selectedInvestigation.value = inv
  pickedFleetIds.value = []
  view.value = 'dispatch'
}

function toggleFleet(id) {
  const i = pickedFleetIds.value.indexOf(id)
  if (i === -1) {
    if (pickedFleetIds.value.length >= selectedInvestigation.value.max_player_fleets) return
    pickedFleetIds.value.push(id)
  } else {
    pickedFleetIds.value.splice(i, 1)
  }
}

const dispatchValid = computed(() => {
  const inv = selectedInvestigation.value
  if (!inv) return false
  const n = pickedFleetIds.value.length
  return n >= inv.min_player_fleets && n <= inv.max_player_fleets
})

async function launch() {
  if (!dispatchValid.value) return
  const ok = await battle.start(selectedInvestigation.value.id, [...pickedFleetIds.value])
  if (ok) {
    view.value = 'battle'
    emit('changed')
  }
}

async function resume() {
  const id = battle.active?.id
  if (!id) return
  const ok = await battle.openById(id)
  if (ok) view.value = 'battle'
}

function backToList() {
  battle.close()
  view.value = 'list'
  battle.load()
  commanders.loadFleets()
  emit('changed')
}

function fleetShipCount(f) {
  return (f.slots || []).reduce((sum, s) => sum + (s.quantity || 0), 0)
}

// When the battle ends and rewards are claimed / abandoned, refresh the base
// so unlocked fleets reappear.
watch(
  () => battle.battle?.is_over,
  (over) => { if (over) emit('changed') }
)

onUnmounted(() => emit('changed'))
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
  <div class="investigation">
    <div class="head">
      <h3>
        <template v-if="view === 'list'">Investigação Interplanetária</template>
        <template v-else-if="view === 'dispatch'">Enviar frotas — {{ selectedInvestigation?.name }}</template>
        <template v-else>{{ battle.battle?.investigation?.name || 'Batalha' }}</template>
      </h3>
      <button class="x" @click="emit('close')">✕</button>
    </div>

    <p v-if="battle.error" class="error">{{ battle.error }}</p>

    <!-- LIST -->
    <div v-if="view === 'list'" class="body">
      <div v-if="battle.active" class="resume-banner">
        <span>
          Você tem uma investigação
          {{ battle.active.is_over ? 'concluída aguardando resgate' : 'em andamento' }}.
        </span>
        <button class="btn" @click="resume">Voltar à instância</button>
      </div>

      <p v-if="!investigations.length" class="muted">Nenhuma investigação disponível no momento.</p>

      <div class="inv-grid">
        <button
          v-for="inv in investigations"
          :key="inv.id"
          class="inv-card"
          :style="{ borderColor: inv.color || 'rgba(120,160,220,0.25)' }"
          @click="chooseInvestigation(inv)"
        >
          <div class="inv-name">{{ inv.name }}</div>
          <div class="inv-desc">{{ inv.description }}</div>
          <div class="inv-meta">
            <span>Frotas: {{ inv.min_player_fleets }}–{{ inv.max_player_fleets }}</span>
            <span>Rounds: {{ inv.max_rounds }}</span>
            <span>Exp: {{ inv.exp_reward }}</span>
          </div>
          <div class="inv-meta">
            <span>Inimigos: {{ inv.enemy_fleets.reduce((n, e) => n + e.ships, 0) }} naves</span>
            <span v-if="inv.prizes.length">Prêmios: {{ inv.prizes.length }}</span>
          </div>
        </button>
      </div>
    </div>

    <!-- DISPATCH -->
    <div v-else-if="view === 'dispatch'" class="body">
      <p class="muted">
        Selecione entre {{ selectedInvestigation.min_player_fleets }} e
        {{ selectedInvestigation.max_player_fleets }} frota(s). Frotas enviadas ficam
        indisponíveis na base até o fim da instância. Naves destruídas são perdidas para sempre.
      </p>

      <p v-if="!availableFleets.length" class="muted">
        Você não tem frotas disponíveis. Monte uma frota no Hangar primeiro.
      </p>

      <div class="fleet-list">
        <label
          v-for="f in availableFleets"
          :key="f.id"
          class="fleet-row"
          :class="{ picked: pickedFleetIds.includes(f.id) }"
        >
          <input
            type="checkbox"
            :checked="pickedFleetIds.includes(f.id)"
            @change="toggleFleet(f.id)"
          />
          <div class="fleet-info">
            <strong>{{ f.name }}</strong>
            <span class="muted">
              {{ f.commander_name || 'Sem comandante' }} ·
              {{ fleetShipCount(f) }} naves ·
              mov {{ f.summary?.movement ?? '—' }}
            </span>
          </div>
        </label>
      </div>

      <div class="actions">
        <button class="btn ghost" @click="view = 'list'">Voltar</button>
        <button class="btn" :disabled="!dispatchValid" @click="launch">Iniciar investigação</button>
      </div>
    </div>

    <!-- BATTLE -->
    <div v-else class="body">
      <BattleBoard @exit="backToList" />
    </div>
  </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(4, 8, 16, 0.72);
  display: grid;
  place-items: center;
  z-index: 200;
  padding: 1rem;
}
.investigation {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  min-width: 520px;
  max-width: 860px;
  max-height: 90vh;
  overflow-y: auto;
  background: #0b111c;
  border: 1px solid rgba(120, 160, 220, 0.25);
  border-radius: 14px;
  padding: 1.2rem;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.head h3 {
  margin: 0;
  color: #eaf2ff;
}
.x {
  background: transparent;
  border: 1px solid rgba(120, 160, 220, 0.3);
  color: #cfe0ff;
  border-radius: 6px;
  width: 28px;
  height: 28px;
  cursor: pointer;
}
.body {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}
.error {
  color: #ff9090;
  font-size: 0.85rem;
  margin: 0;
}
.muted {
  color: #7f93b3;
  font-size: 0.85rem;
}
.resume-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
  background: rgba(244, 197, 66, 0.12);
  border: 1px solid rgba(244, 197, 66, 0.4);
  border-radius: 8px;
  padding: 0.6rem 0.8rem;
  font-size: 0.85rem;
  color: #f4d98a;
}
.inv-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 0.7rem;
}
.inv-card {
  text-align: left;
  background: #0e1524;
  border: 1px solid rgba(120, 160, 220, 0.25);
  border-radius: 10px;
  padding: 0.8rem;
  cursor: pointer;
  color: #e6eefc;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.inv-card:hover {
  border-color: #4fc3f7;
}
.inv-name {
  font-weight: 700;
}
.inv-desc {
  font-size: 0.8rem;
  color: #9fb2cf;
  min-height: 2.2em;
}
.inv-meta {
  display: flex;
  gap: 0.7rem;
  flex-wrap: wrap;
  font-size: 0.76rem;
  color: #7fb2ff;
}
.fleet-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  max-height: 320px;
  overflow-y: auto;
}
.fleet-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem 0.7rem;
  border: 1px solid rgba(120, 160, 220, 0.2);
  border-radius: 8px;
  cursor: pointer;
}
.fleet-row.picked {
  border-color: #4fc3f7;
  background: rgba(79, 195, 247, 0.08);
}
.fleet-info {
  display: flex;
  flex-direction: column;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
}
.btn {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 8px;
  font-weight: 700;
  cursor: pointer;
  background: linear-gradient(135deg, #4fc3f7, #2a7fd8);
  color: #04101f;
}
.btn:disabled {
  background: #2a3550;
  color: #7f93b3;
  cursor: default;
}
.btn.ghost {
  background: transparent;
  border: 1px solid rgba(120, 160, 220, 0.3);
  color: #cfe0ff;
}
</style>
