<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useBattleStore } from '../stores/battle'

/**
 * The live battle viewer. Renders the isolated map with fleet markers and plays
 * the server's round events back on a timer so the fight animates round by
 * round. "Auto" keeps stepping until the battle ends; the player can also step
 * one round at a time, pause, claim rewards, abandon, or return to base.
 */
const emit = defineEmits(['exit'])

const battle = useBattleStore()

const auto = ref(false)
const playing = ref(false) // an event playback is in progress
const lastLog = ref([])    // human-readable log lines for the current round
let playTimer = null

const EVENT_MS = 650 // pace of one event during playback

const b = computed(() => battle.battle)
const map = computed(() => b.value?.map || { width: 200, height: 200 })

// Marker size relative to the board (fleets occupy a 10-unit footprint).
const board = { px: 460 }
function pctX(x) {
  return (x / Math.max(1, map.value.width)) * 100
}
function pctY(y) {
  return (y / Math.max(1, map.value.height)) * 100
}

const statusLabel = computed(() => {
  switch (b.value?.status) {
    case 'won': return 'Vitória!'
    case 'lost': return 'Derrota'
    case 'expired': return 'Expirou (sem vencedor)'
    case 'abandoned': return 'Abandonada'
    default: return 'Em andamento'
  }
})

function fleetById(id) {
  return (b.value?.fleets || []).find((f) => f.id === id)
}

/**
 * Play a batch of events (from one /step) sequentially, updating the log. Fleet
 * positions/ship counts come from the refreshed battle snapshot in the store;
 * this just narrates the events with a delay so it feels live.
 */
function playEvents(events) {
  return new Promise((resolve) => {
    if (!events || !events.length) return resolve()
    playing.value = true
    let i = 0
    const tick = () => {
      if (i >= events.length) {
        playing.value = false
        return resolve()
      }
      const ev = events[i++]
      const line = describe(ev)
      if (line) lastLog.value.unshift(line)
      lastLog.value = lastLog.value.slice(0, 12)
      playTimer = setTimeout(tick, EVENT_MS)
    }
    tick()
  })
}

function describe(ev) {
  const actor = fleetById(ev.actor_fleet_id)?.name
  const target = fleetById(ev.target_fleet_id)?.name
  switch (ev.type) {
    case 'round_start': return `— Round ${ev.round} —`
    case 'move': return `${actor} avança.`
    case 'attack': {
      const kills = ev.payload?.kills || 0
      return kills > 0
        ? `${actor} ataca ${target}: ${kills} nave(s) destruída(s).`
        : `${actor} ataca ${target}.`
    }
    case 'battle_end': return `Fim da batalha: ${ev.payload?.status}.`
    default: return null
  }
}

async function stepOnce() {
  if (battle.stepping || playing.value || b.value?.is_over) return
  const events = await battle.step()
  if (events) await playEvents(events)
}

async function toggleAuto() {
  auto.value = !auto.value
  if (auto.value) await runAuto()
}

async function runAuto() {
  while (auto.value && !b.value?.is_over) {
    await stepOnce()
    // small breather between rounds
    await new Promise((r) => setTimeout(r, 250))
  }
  auto.value = false
}

async function claim() {
  await battle.claim()
}

async function abandon() {
  if (!confirm('Abandonar a investigação? Isso conta como derrota e as frotas voltam à base.')) return
  auto.value = false
  await battle.abandon()
}

onUnmounted(() => {
  auto.value = false
  if (playTimer) clearTimeout(playTimer)
})

const playerShips = computed(() =>
  (b.value?.fleets || []).filter((f) => f.side === 'player').reduce((n, f) => n + (f.ships_remaining || 0), 0)
)
const enemyShips = computed(() =>
  (b.value?.fleets || []).filter((f) => f.side === 'enemy').reduce((n, f) => n + (f.ships_remaining || 0), 0)
)
</script>

<template>
  <div v-if="b" class="battle">
    <div class="topline">
      <div class="pill">Round {{ b.current_round }} / {{ b.max_rounds }}</div>
      <div class="pill" :class="b.status">{{ statusLabel }}</div>
      <div class="pill player">Você: {{ playerShips }} naves</div>
      <div class="pill enemy">Inimigo: {{ enemyShips }} naves</div>
    </div>

    <div class="stage" :style="{ width: board.px + 'px', height: board.px + 'px' }">
      <div class="grid-bg"></div>
      <div
        v-for="f in b.fleets"
        :key="f.id"
        class="marker"
        :class="[f.side, { dead: !f.alive }]"
        :style="{ left: pctX(f.x) + '%', top: pctY(f.y) + '%' }"
        :title="`${f.name} — ${f.ships_remaining} naves`"
      >
        <span class="marker-dot"></span>
        <span class="marker-label">{{ f.name }}<br />{{ f.ships_remaining }}</span>
      </div>
    </div>

    <div class="controls">
      <template v-if="!b.is_over">
        <button class="btn" :disabled="battle.stepping || playing || auto" @click="stepOnce">
          Avançar round
        </button>
        <button class="btn ghost" @click="toggleAuto">
          {{ auto ? 'Pausar' : 'Auto' }}
        </button>
        <button class="btn danger" @click="abandon">Abandonar</button>
      </template>

      <template v-else>
        <button
          v-if="b.status === 'won' && !b.rewards_claimed"
          class="btn reward"
          @click="claim"
        >Resgatar recompensas</button>
        <button class="btn" @click="emit('exit')">Voltar à base</button>
      </template>
    </div>

    <!-- Rewards summary -->
    <div v-if="battle.rewards" class="rewards">
      <strong>Recompensas:</strong>
      <span v-if="battle.rewards.exp">+{{ battle.rewards.exp }} exp por comandante.</span>
      <span v-if="battle.rewards.items?.length">
        Itens: {{ battle.rewards.items.map((i) => `${i.quantity}x ${i.name}`).join(', ') }}.
      </span>
      <span v-else class="muted">Nenhum item (verifique se há espaço no Forte Protetor).</span>
      <div v-if="battle.rewards.commanders?.length" class="muted">
        <span v-for="c in battle.rewards.commanders" :key="c.id">
          {{ c.name }}{{ c.levels ? ` subiu ${c.levels} nível(is)` : '' }}.
        </span>
      </div>
    </div>

    <!-- Combat log -->
    <div class="log">
      <div v-for="(line, i) in lastLog" :key="i" class="log-line">{{ line }}</div>
      <div v-if="!lastLog.length" class="muted">Avance os rounds para ver a batalha acontecer.</div>
    </div>
  </div>
</template>

<style scoped>
.battle {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  align-items: center;
}
.topline {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  justify-content: center;
}
.pill {
  font-size: 0.78rem;
  padding: 0.3rem 0.7rem;
  border-radius: 999px;
  background: rgba(120, 160, 220, 0.12);
  color: #cfe0ff;
  border: 1px solid rgba(120, 160, 220, 0.25);
}
.pill.player { color: #7fd0ff; border-color: rgba(127, 208, 255, 0.5); }
.pill.enemy { color: #ff9c8a; border-color: rgba(255, 156, 138, 0.5); }
.pill.won { color: #9df5c0; border-color: #2f7d4e; }
.pill.lost, .pill.abandoned { color: #ff9090; border-color: #7d2f2f; }
.stage {
  position: relative;
  border: 1px solid rgba(120, 160, 220, 0.3);
  border-radius: 10px;
  overflow: hidden;
  background: radial-gradient(circle at 50% 40%, #0f1a2c, #070b12);
}
.grid-bg {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(120, 160, 220, 0.08) 1px, transparent 1px),
    linear-gradient(90deg, rgba(120, 160, 220, 0.08) 1px, transparent 1px);
  background-size: 10% 10%;
}
.marker {
  position: absolute;
  transform: translate(-50%, -50%);
  transition: left 0.5s ease, top 0.5s ease;
  display: flex;
  flex-direction: column;
  align-items: center;
  z-index: 2;
}
.marker-dot {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  box-shadow: 0 0 10px currentColor;
}
.marker.player .marker-dot { background: #4fc3f7; color: #4fc3f7; }
.marker.enemy .marker-dot { background: #ff6b6b; color: #ff6b6b; }
.marker.dead { opacity: 0.25; filter: grayscale(1); }
.marker-label {
  font-size: 0.62rem;
  color: #cfe0ff;
  text-align: center;
  margin-top: 2px;
  white-space: nowrap;
}
.controls {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  justify-content: center;
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
.btn:disabled { background: #2a3550; color: #7f93b3; cursor: default; }
.btn.ghost { background: transparent; border: 1px solid rgba(120, 160, 220, 0.3); color: #cfe0ff; }
.btn.danger { background: transparent; border: 1px solid rgba(179, 69, 58, 0.5); color: #e0857c; }
.btn.reward { background: linear-gradient(135deg, #f4c542, #d69a2e); color: #1a1204; }
.rewards {
  font-size: 0.82rem;
  color: #e6eefc;
  background: rgba(93, 214, 138, 0.1);
  border: 1px solid rgba(93, 214, 138, 0.3);
  border-radius: 8px;
  padding: 0.5rem 0.7rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  width: 100%;
}
.log {
  width: 100%;
  max-height: 160px;
  overflow-y: auto;
  background: #0b111c;
  border: 1px solid rgba(120, 160, 220, 0.18);
  border-radius: 8px;
  padding: 0.5rem 0.7rem;
  font-size: 0.8rem;
  color: #b9c8e6;
}
.log-line { padding: 0.1rem 0; }
.muted { color: #7f93b3; }
</style>
