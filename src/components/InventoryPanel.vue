<script setup>
import { computed, onMounted, ref } from 'vue'
import { useInventoryStore } from '../stores/inventory'

/**
 * Forte Protetor inventory modal.
 *
 * Shows the player's item stacks with a scrollable list and a type filter
 * (all / consumables / plants). Capacity is derived from the Forte Protetor's
 * level (30 slots + 2 per level). No items exist in the game yet, so the list
 * is usually empty — the empty state explains that.
 */
const props = defineProps({
  // The selected Forte Protetor structure (category 'inventory').
  structure: { type: Object, required: true },
})

const emit = defineEmits(['close'])

const inventory = useInventoryStore()

// Active type filter: 'all' | 'consumable' | 'plant'.
const filter = ref('all')

onMounted(() => {
  inventory.load()
})

const capacity = computed(() => inventory.capacity)
const used = computed(() => inventory.used)
const remaining = computed(() => inventory.remaining)

const filters = [
  { key: 'all', label: 'Todos' },
  { key: 'consumable', label: 'Consumíveis' },
  { key: 'plant', label: 'Plantas' },
]

const visibleItems = computed(() => {
  if (filter.value === 'all') return inventory.items
  return inventory.items.filter((i) => i.type === filter.value)
})

function typeLabel(type) {
  if (type === 'consumable') return 'Consumível'
  if (type === 'plant') return 'Planta'
  return type
}

// A short, human-friendly preview of an item's effects JSON.
function effectsSummary(effects) {
  if (!effects || typeof effects !== 'object') return ''
  const entries = Object.entries(effects)
  if (entries.length === 0) return ''
  return entries.map(([k, v]) => `${k}: ${v}`).join(' · ')
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
            Espaços: <strong>{{ used }} / {{ capacity }}</strong>
            · Livres: <strong>{{ remaining }}</strong>
          </p>
        </div>
        <button class="x" title="Fechar" @click="close">✕</button>
      </header>

      <!-- Type filter -->
      <div class="filters">
        <button
          v-for="f in filters"
          :key="f.key"
          class="filter"
          :class="{ active: filter === f.key }"
          @click="filter = f.key"
        >{{ f.label }}</button>
      </div>

      <div v-if="inventory.loading && !inventory.loaded" class="loading">Carregando inventário...</div>

      <template v-else>
        <p v-if="visibleItems.length === 0" class="empty">
          <template v-if="inventory.items.length === 0">
            Seu inventário está vazio. Itens (consumíveis e plantas) aparecerão aqui.
          </template>
          <template v-else>
            Nenhum item deste tipo.
          </template>
        </p>

        <!-- Scrollable item list -->
        <div v-else class="item-grid">
          <div v-for="it in visibleItems" :key="it.id" class="item-card">
            <div class="item-head">
              <span class="dot" :style="{ background: it.color || '#4caf7d' }"></span>
              <strong>{{ it.name }}</strong>
              <span class="qty">x{{ it.quantity }}</span>
            </div>
            <p class="item-type">
              {{ typeLabel(it.type) }}
              <span class="item-stack">· pilha máx. {{ it.max_stack }}</span>
            </p>
            <p v-if="it.description" class="item-desc">{{ it.description }}</p>
            <p v-if="effectsSummary(it.effects)" class="item-effects">{{ effectsSummary(it.effects) }}</p>
          </div>
        </div>
      </template>

      <transition name="fade"><p v-if="inventory.error" class="flash">{{ inventory.error }}</p></transition>
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
.filters {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
.filter {
  background: #131c30;
  border: 1px solid rgba(120, 160, 220, 0.25);
  color: #cfe0ff;
  border-radius: 999px;
  padding: 0.35rem 0.9rem;
  font-size: 0.82rem;
  cursor: pointer;
}
.filter:hover {
  border-color: #4caf7d;
}
.filter.active {
  background: rgba(76, 175, 125, 0.2);
  border-color: #4caf7d;
  color: #d8f5e6;
}
.loading,
.empty {
  color: #9fb2cf;
  font-size: 0.9rem;
  padding: 1rem 0;
}
.item-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 0.8rem;
}
.item-card {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.85rem;
  border-radius: 11px;
  border: 1px solid rgba(120, 160, 220, 0.25);
  background: #131c30;
}
.item-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #e6eefc;
}
.item-head strong {
  flex: 1;
  font-size: 0.95rem;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex: none;
}
.qty {
  font-size: 0.8rem;
  color: #9fe6c2;
  font-weight: 700;
}
.item-type {
  margin: 0;
  font-size: 0.78rem;
  color: #8fa6c6;
}
.item-stack {
  color: #6f89ab;
}
.item-desc {
  margin: 0.2rem 0 0;
  font-size: 0.8rem;
  color: #b9c8e2;
}
.item-effects {
  margin: 0.2rem 0 0;
  font-size: 0.76rem;
  color: #9fb2cf;
  font-style: italic;
}
.flash {
  margin: 0.9rem 0 0;
  font-size: 0.85rem;
  color: #ffd27f;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
