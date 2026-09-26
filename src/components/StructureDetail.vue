<script setup>
import { ref, computed, watch } from 'vue'

/**
 * Reusable detail + actions block for a selected structure. Renders the
 * structure's stats and every action it supports (collect, upgrade, open
 * hangar / inventory / builder / commanders / fleets, demolish).
 *
 * Used in two places: the left sidebar panel and the floating action card
 * anchored at the clicked structure. All game logic stays in the parent
 * (GameView): this component only displays data and emits action intents.
 */
const props = defineProps({
  structure: { type: Object, required: true },
  isPlanetary: { type: Boolean, default: false },
  commandLevel: { type: Number, default: 0 },
  buildsFull: { type: Boolean, default: false },
  maxConcurrentBuilds: { type: Number, default: 0 },
  // Live accumulated amount for producers (computed by the parent's clock).
  livePending: { type: Number, default: 0 },
  // Remaining seconds for an in-progress build/upgrade.
  remainingSeconds: { type: Number, default: 0 },
  resourceMeta: { type: Object, required: true },
  // Show the title/close header (used by the sidebar; the card has its own).
  showHeader: { type: Boolean, default: true },
})

const emit = defineEmits([
  'collect',
  'upgrade',
  'open-hangar',
  'open-builder',
  'open-commanders',
  'open-fleets',
  'open-inventory',
  'open-research',
  'demolish',
  'close',
])

const s = computed(() => props.structure)
const busy = computed(() => props.remainingSeconds > 0)

// Local demolish-confirmation state, reset whenever the structure changes.
const confirming = ref(false)
watch(() => s.value?.id, () => { confirming.value = false })

function refundTotal() {
  const r = s.value?.demolition_refund
  if (!r) return 0
  return (r.gold || 0) + (r.metal || 0) + (r.energy || 0)
}

function formatTime(totalSeconds) {
  const t = Math.max(0, totalSeconds || 0)
  const m = Math.floor(t / 60)
  const sec = t % 60
  if (m > 0) return `${m}m ${sec.toString().padStart(2, '0')}s`
  return `${sec}s`
}
</script>

<template>
  <div class="detail">
    <div v-if="showHeader" class="detail-head">
      <h3>{{ s.type.name }}</h3>
      <button class="deselect" title="Fechar (Esc)" @click="emit('close')">✕</button>
    </div>

    <div class="detail-row">
      <span>Nível</span>
      <strong>{{ s.level }} / {{ s.max_level }}</strong>
    </div>

    <!-- Producer stats (terrestrial) -->
    <template v-if="s.type.category === 'producer'">
      <div class="detail-row">
        <span>Produção/min</span>
        <strong>{{ s.production_per_minute }}</strong>
      </div>
      <div class="detail-row">
        <span>Capacidade máx.</span>
        <strong>{{ s.max_capacity }}</strong>
      </div>
      <div class="detail-row">
        <span>Acumulado</span>
        <strong>{{ livePending }} <span class="muted">/ {{ s.max_capacity }}</span></strong>
      </div>
      <button
        v-if="s.is_constructed"
        class="action collect-btn"
        :disabled="livePending <= 0"
        @click="emit('collect')"
      >{{ livePending > 0 ? 'Recolher' : 'Nada para recolher' }}</button>
    </template>

    <!-- Storage stats (terrestrial) -->
    <template v-else-if="s.type.category === 'storage'">
      <div class="detail-row">
        <span>Protege por recurso</span>
        <strong>{{ s.protection }}</strong>
      </div>
    </template>

    <!-- Support stats (e.g. Aircraft Hangar) -->
    <template v-else-if="s.type.category === 'support'">
      <div class="detail-row">
        <span>Redução tempo de aeronave</span>
        <strong>{{ s.build_time_reduction }}%</strong>
      </div>
      <button
        v-if="s.is_constructed"
        class="action"
        style="background: linear-gradient(135deg,#8e7cc3,#5a4b9c); color:#fff;"
        @click="emit('open-hangar')"
      >Gerenciar hangar</button>
      <button
        v-if="s.is_constructed"
        class="action"
        style="background: linear-gradient(135deg,#4fc3f7,#2a7fd8); color:#04101f;"
        @click="emit('open-builder')"
      >Montar modelo de nave</button>
      <button
        v-if="s.is_constructed"
        class="action"
        style="background: linear-gradient(135deg,#c9a24b,#9c7a2e); color:#1a1204;"
        @click="emit('open-commanders')"
      >Comandantes</button>
      <button
        v-if="s.is_constructed"
        class="action"
        style="background: linear-gradient(135deg,#6fb7ff,#2f6fd6); color:#04101f;"
        @click="emit('open-fleets')"
      >Frotas</button>
    </template>

    <!-- Inventory stats (e.g. Forte Protetor) -->
    <template v-else-if="s.type.category === 'inventory'">
      <div class="detail-row">
        <span>Espaços de itens</span>
        <strong>{{ s.inventory_slots }}</strong>
      </div>
      <button
        v-if="s.is_constructed"
        class="action"
        style="background: linear-gradient(135deg,#4caf7d,#2f8a5c); color:#04120b;"
        @click="emit('open-inventory')"
      >Abrir inventário</button>
    </template>

    <!-- Research stats (e.g. Centro de Pesquisa) -->
    <template v-else-if="s.type.category === 'research'">
      <div class="detail-row">
        <span>Redução do tempo de pesquisa</span>
        <strong>{{ s.research_time_reduction }}%</strong>
      </div>
      <button
        v-if="s.is_constructed"
        class="action"
        style="background: linear-gradient(135deg,#7ec8e3,#3f8fb0); color:#03141c;"
        @click="emit('open-research')"
      >Abrir pesquisas</button>
    </template>

    <!-- Planetary structures: hit points (and damage for defenses). -->
    <template v-if="isPlanetary && s.max_hp > 0">
      <div class="detail-row">
        <span>Pontos de vida</span>
        <strong>{{ s.current_hp }} / {{ s.max_hp }}</strong>
      </div>
      <div v-if="s.damage > 0" class="detail-row">
        <span>Dano</span>
        <strong>{{ s.damage }}</strong>
      </div>
      <div v-if="s.range > 0" class="detail-row">
        <span>Alcance</span>
        <strong>{{ s.range }} cél.</strong>
      </div>
    </template>

    <!-- In-progress build/upgrade -->
    <div v-if="busy" class="busy-note">
      {{ s.busy_kind === 'build' ? 'Construindo' : 'Evoluindo' }}...
      <strong>{{ formatTime(remainingSeconds) }}</strong>
      <template v-if="s.busy_kind === 'upgrade' && s.pending_level">
        (→ nível {{ s.pending_level }})
      </template>
    </div>

    <div v-else-if="s.is_max_level" class="max-note">
      Nível máximo atingido.
    </div>

    <div v-else-if="s.capped_by_command" class="capped-note">
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
          v-show="s.upgrade_cost[key] > 0"
          class="cost-item"
        >
          <span class="dot" :style="{ background: meta.color }"></span>
          {{ s.upgrade_cost[key] }}
        </span>
      </div>
      <div v-if="s.upgrade_time" class="cost-label">
        Tempo: {{ formatTime(s.upgrade_time) }}
      </div>
      <p v-if="buildsFull && s.upgrade_time > 0" class="builds-hint">
        Máximo de {{ maxConcurrentBuilds }} obras simultâneas atingido.
        Aguarde alguma terminar.
      </p>
      <button
        class="action upgrade"
        :disabled="buildsFull && s.upgrade_time > 0"
        @click="emit('upgrade')"
      >Evoluir</button>
    </template>

    <!-- Demolish -->
    <button v-if="!confirming" class="demolish" @click="confirming = true">Desconstruir</button>

    <div v-else class="demolish-confirm">
      <p class="demolish-q">Desconstruir esta estrutura?</p>
      <p class="demolish-refund">
        Reembolso (50% do investido):
        <template v-if="refundTotal() > 0">
          <span
            v-for="(meta, key) in resourceMeta"
            :key="key"
            v-show="s.demolition_refund[key] > 0"
            class="cost-item"
          >
            <span class="dot" :style="{ background: meta.color }"></span>
            {{ s.demolition_refund[key] }}
          </span>
        </template>
        <template v-else><strong>nenhum</strong></template>
      </p>
      <div class="demolish-actions">
        <button class="demolish-yes" @click="emit('demolish'); confirming = false">Confirmar</button>
        <button class="demolish-no" @click="confirming = false">Cancelar</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.detail {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}
.detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.detail-head h3 {
  margin: 0;
  font-size: 1.02rem;
  color: #eaf2ff;
}
.deselect {
  background: transparent;
  border: 1px solid rgba(120, 160, 220, 0.3);
  color: #cfe0ff;
  border-radius: 6px;
  width: 26px;
  height: 26px;
  cursor: pointer;
  font-size: 0.8rem;
}
.deselect:hover {
  border-color: #ff8080;
  color: #ff8080;
}
.detail-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.85rem;
  color: #9fb2cf;
}
.detail-row strong {
  color: #e6eefc;
}
.muted {
  color: #7f93b3;
  font-weight: 400;
}
.action {
  width: 100%;
  padding: 0.5rem;
  border: none;
  border-radius: 8px;
  font-weight: 700;
  cursor: pointer;
  font-size: 0.85rem;
  color: #04101f;
  background: linear-gradient(135deg, #4fc3f7, #2a7fd8);
}
.action:disabled {
  background: #2a3550;
  color: #7f93b3;
  cursor: default;
}
.collect-btn {
  background: linear-gradient(135deg, #4fc3f7, #2a7fd8);
}
.upgrade {
  background: linear-gradient(135deg, #5cd68a, #2f9e5a);
  color: #04120b;
}
.busy-note,
.max-note,
.capped-note {
  font-size: 0.82rem;
  color: #9fb2cf;
  background: rgba(120, 160, 220, 0.08);
  border-radius: 7px;
  padding: 0.5rem 0.6rem;
}
.busy-note strong {
  color: #f4c542;
}
.cost-label {
  font-size: 0.78rem;
  color: #7f93b3;
}
.cost-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}
.cost-item {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.85rem;
  color: #e6eefc;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.builds-hint {
  font-size: 0.76rem;
  color: #f0aa5a;
  margin: 0;
}
.demolish {
  width: 100%;
  padding: 0.45rem;
  border: 1px solid rgba(179, 69, 58, 0.5);
  border-radius: 8px;
  background: transparent;
  color: #e0857c;
  cursor: pointer;
  font-size: 0.82rem;
}
.demolish:hover {
  background: rgba(179, 69, 58, 0.15);
}
.demolish-confirm {
  border: 1px solid rgba(179, 69, 58, 0.4);
  border-radius: 8px;
  padding: 0.6rem;
}
.demolish-q {
  margin: 0 0 0.4rem;
  font-size: 0.85rem;
  color: #e6eefc;
}
.demolish-refund {
  margin: 0 0 0.5rem;
  font-size: 0.78rem;
  color: #9fb2cf;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.demolish-actions {
  display: flex;
  gap: 0.5rem;
}
.demolish-yes,
.demolish-no {
  flex: 1;
  padding: 0.4rem;
  border-radius: 7px;
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 700;
  border: none;
}
.demolish-yes {
  background: #b3453a;
  color: #fff;
}
.demolish-no {
  background: #2a3550;
  color: #cfe0ff;
}
</style>
