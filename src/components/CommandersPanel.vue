<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useCommanderStore } from '../stores/commanders'
import Thumb from './Thumb.vue'

/**
 * Commanders screen: the account pool + recruitment. Recruiting adds a generic
 * "Comandante" instantly, then a 1-hour cooldown must pass before recruiting
 * another (pool cap 30).
 */
const emit = defineEmits(['close'])

const store = useCommanderStore()
const nowTs = ref(Date.now())
let ticker = null

const ROMAN = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V' }
const CLASS_LABELS = { cruiser: 'Cruzador', battleship: 'Encouraçado', frigate: 'Fragata', fighter: 'Caça' }
const WEAPON_LABELS = { machinegun: 'Metralhadora', laser: 'Laser', missile: 'Míssil' }

onMounted(() => {
  store.loadCommanders()
  ticker = setInterval(() => {
    nowTs.value = Date.now()
    // Reload when the recruitment timer likely finished.
    if (store.recruitment?.active && store.recruitment.remaining_seconds <= 1) {
      store.loadCommanders()
    }
  }, 1000)
})
onUnmounted(() => ticker && clearInterval(ticker))

const rec = computed(() => store.recruitment)
const poolFull = computed(() => rec.value && rec.value.pool_used >= rec.value.pool_max)

// Live countdown derived from the last loaded remaining + local clock.
const loadedAt = ref(Date.now())
const remaining = computed(() => {
  if (!rec.value?.active) return 0
  const base = rec.value.remaining_seconds
  const elapsed = Math.floor((nowTs.value - loadedAt.value) / 1000)
  return Math.max(0, base - elapsed)
})

async function recruit() {
  const ok = await store.recruit()
  if (ok) loadedAt.value = Date.now()
}

function formatTime(totalSeconds) {
  const s = Math.max(0, totalSeconds || 0)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m`
  if (m > 0) return `${m}m ${sec.toString().padStart(2, '0')}s`
  return `${sec}s`
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
          <h2>Comandantes</h2>
          <p class="sub" v-if="rec">
            Pool: <strong>{{ rec.pool_used }} / {{ rec.pool_max }}</strong>
          </p>
        </div>
        <button class="x" title="Fechar" @click="close">✕</button>
      </header>

      <div v-if="store.loading && !store.loaded" class="loading">Carregando comandantes...</div>

      <template v-else>
        <!-- Recruitment -->
        <div class="recruit">
          <template v-if="!rec?.can_recruit">
            <p class="empty">Construa um Hangar de Aeronaves para recrutar comandantes.</p>
          </template>
          <template v-else-if="rec.active">
            <p>Próximo recrutamento disponível em <strong>{{ formatTime(remaining) }}</strong></p>
          </template>
          <template v-else>
            <button class="recruit-btn" :disabled="poolFull" @click="recruit">
              Recrutar comandante
            </button>
            <span v-if="poolFull" class="muted">Pool cheio ({{ rec.pool_max }}).</span>
          </template>
          <p v-if="store.error" class="err">{{ store.error }}</p>
        </div>

        <!-- Pool -->
        <p v-if="store.commanders.length === 0" class="empty">Nenhum comandante recrutado ainda.</p>
        <div v-else class="cmd-grid">
          <div v-for="c in store.commanders" :key="c.id" class="cmd">
            <div class="cmd-head">
              <Thumb :src="c.image_url" :alt="c.name" :size="34" />
              <div>
                <strong>{{ c.name }}</strong>
                <span class="rank">Ranking {{ c.rank_label }}</span>
              </div>
            </div>
            <div class="prof-block">
              <div class="prof-title">Naves</div>
              <div class="prof-row" v-for="k in ['cruiser','battleship','frigate','fighter']" :key="k">
                <span>{{ CLASS_LABELS[k] }}</span>
                <span class="prof-lvl">{{ ROMAN[c.proficiencies[k]] }}</span>
              </div>
              <div class="prof-title">Armas</div>
              <div class="prof-row" v-for="k in ['machinegun','laser','missile']" :key="k">
                <span>{{ WEAPON_LABELS[k] }}</span>
                <span class="prof-lvl">{{ ROMAN[c.proficiencies[k]] }}</span>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop { position: fixed; inset: 0; background: rgba(4,8,16,.66); display: grid; place-items: center; z-index: 65; }
.modal { width: min(820px, 95vw); max-height: 90vh; overflow-y: auto; background: #0e1524; border: 1px solid rgba(120,160,220,.25); border-radius: 14px; padding: 1.2rem 1.3rem; box-shadow: 0 20px 60px rgba(0,0,0,.55); }
.modal-head { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 1rem; }
.modal-head h2 { margin: 0; font-size: 1.15rem; color: #eaf2ff; }
.sub { margin: .3rem 0 0; font-size: .85rem; color: #9fb2cf; }
.x { background: transparent; border: 1px solid rgba(120,160,220,.3); color: #cfe0ff; border-radius: 7px; width: 30px; height: 30px; cursor: pointer; }
.x:hover { border-color: #ff8080; color: #ff8080; }
.loading, .empty { color: #9fb2cf; padding: .8rem 0; font-size: .9rem; }
.recruit { margin-bottom: 1rem; padding-bottom: .8rem; border-bottom: 1px solid rgba(120,160,220,.15); display: flex; align-items: center; gap: .8rem; flex-wrap: wrap; }
.recruit-btn { padding: .55rem 1rem; border: none; border-radius: 8px; background: linear-gradient(135deg,#c9a24b,#9c7a2e); color: #1a1204; font-weight: 700; cursor: pointer; }
.recruit-btn:disabled { opacity: .4; cursor: not-allowed; }
.err { color: #ff9090; font-size: .82rem; margin: 0; }
.muted { color: #7f93b3; font-size: .82rem; }
.cmd-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: .9rem; }
.cmd { border: 1px solid rgba(120,160,220,.2); border-radius: 11px; padding: .8rem; background: #131c30; }
.cmd-head { display: flex; align-items: center; gap: .6rem; margin-bottom: .6rem; }
.cmd-head strong { display: block; }
.rank { font-size: .78rem; color: #c9a24b; }
.prof-title { font-size: .72rem; color: #7f93b3; text-transform: uppercase; margin: .4rem 0 .2rem; letter-spacing: .04em; }
.prof-row { display: flex; justify-content: space-between; font-size: .82rem; color: #9fb2cf; padding: .1rem 0; }
.prof-lvl { font-weight: 700; color: #eaf2ff; }
</style>
