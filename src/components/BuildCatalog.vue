<script setup>
import { ref, computed } from 'vue'

/**
 * Build catalog modal. Shows the buildable structures as image cards in a grid;
 * hovering a card reveals a description panel of what the structure does.
 * Emits `select` with the chosen type and `close` to dismiss.
 *
 * All gameplay rules (limits, uniqueness, build cap) stay in the parent
 * (GameView) and are passed in as predicates so this component only presents
 * data and forwards intents.
 */
const props = defineProps({
  // Catalog of buildable structure types (already scope-filtered by the store).
  types: { type: Array, required: true },
  // Predicate: is this type currently un-buildable?
  isDisabled: { type: Function, required: true },
  // Predicate: is this type's build limit reached?
  isLimitReached: { type: Function, required: true },
  // Ids already placed on the base (for the "já construído" note on uniques).
  existingTypeIds: { type: Array, default: () => [] },
  // Whether the current base is planetary (only affects the title wording).
  isPlanetary: { type: Boolean, default: false },
  // Formats build_time seconds -> "1m 30s".
  formatTime: { type: Function, required: true },
})

const emit = defineEmits(['select', 'close'])

// The card currently hovered/focused, whose description is shown in the aside.
const hovered = ref(null)

// Default the description panel to the first type so it's never empty.
const focused = computed(() => hovered.value || props.types[0] || null)

function reason(type) {
  if (type.is_unique && props.existingTypeIds.includes(type.id)) return 'Já construído'
  if (props.isLimitReached(type)) return 'Limite atingido'
  return null
}

function choose(type) {
  if (props.isDisabled(type)) return
  emit('select', type)
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
          <h2>Construir</h2>
          <p class="sub">
            {{ isPlanetary ? 'Base planetária' : 'Base terrestre' }} ·
            passe o mouse para ver o que cada construção faz.
          </p>
        </div>
        <button class="x" title="Fechar (Esc)" @click="close">✕</button>
      </header>

      <div class="body">
        <!-- Image grid -->
        <div class="grid">
          <button
            v-for="type in types"
            :key="type.id"
            class="card"
            :class="{ disabled: isDisabled(type) }"
            :disabled="isDisabled(type)"
            @click="choose(type)"
            @mouseenter="hovered = type"
            @mouseleave="hovered = null"
            @focus="hovered = type"
          >
            <span class="thumb" :style="{ background: type.color }">
              <img v-if="type.image_url" :src="type.image_url" :alt="type.name" class="thumb-img" />
              <span v-else class="thumb-ph">🏗️</span>
            </span>
            <span class="name">{{ type.name }}</span>
            <span class="meta">{{ type.width }}x{{ type.height }} · {{ formatTime(type.build_time) }}</span>
            <span v-if="reason(type)" class="badge">{{ reason(type) }}</span>
          </button>
        </div>

        <!-- Description panel for the hovered/focused card -->
        <aside class="info" v-if="focused">
          <div class="info-thumb" :style="{ background: focused.color }">
            <img v-if="focused.image_url" :src="focused.image_url" :alt="focused.name" class="thumb-img" />
            <span v-else class="thumb-ph big">🏗️</span>
          </div>
          <h3>{{ focused.name }}</h3>
          <div class="info-meta">
            <span>Tamanho: <strong>{{ focused.width }}x{{ focused.height }}</strong></span>
            <span>Obra: <strong>{{ formatTime(focused.build_time) }}</strong></span>
            <span>Nível máx.: <strong>{{ focused.max_level }}</strong></span>
          </div>
          <p class="info-desc">
            {{ focused.description || 'Sem descrição.' }}
          </p>
          <p v-if="reason(focused)" class="info-reason">{{ reason(focused) }}</p>
          <button
            class="build-btn"
            :disabled="isDisabled(focused)"
            @click="choose(focused)"
          >Selecionar para posicionar</button>
        </aside>
      </div>
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
  width: min(920px, 94vw);
  max-height: 88vh;
  display: flex;
  flex-direction: column;
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
.body {
  display: grid;
  grid-template-columns: 1fr 260px;
  gap: 1rem;
  min-height: 0;
  overflow: hidden;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 0.7rem;
  overflow-y: auto;
  padding-right: 0.3rem;
  align-content: start;
}
.card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  padding: 0.7rem 0.5rem 0.6rem;
  border-radius: 10px;
  border: 1px solid rgba(120, 160, 220, 0.2);
  background: #131c30;
  color: #e6eefc;
  cursor: pointer;
  text-align: center;
}
.card:hover:not(.disabled),
.card:focus-visible:not(.disabled) {
  border-color: #4fc3f7;
  box-shadow: 0 0 0 1px #4fc3f7 inset;
}
.card.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.thumb {
  width: 100%;
  aspect-ratio: 1 / 1;
  border-radius: 8px;
  overflow: hidden;
  display: grid;
  place-items: center;
}
.thumb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.thumb-ph {
  font-size: 1.6rem;
  opacity: 0.7;
}
.thumb-ph.big {
  font-size: 2.6rem;
}
.name {
  font-size: 0.82rem;
  font-weight: 700;
  line-height: 1.2;
}
.meta {
  font-size: 0.72rem;
  color: #8496b5;
}
.badge {
  position: absolute;
  top: 6px;
  right: 6px;
  font-size: 0.64rem;
  font-weight: 700;
  color: #ffc178;
  background: rgba(255, 170, 80, 0.16);
  border-radius: 999px;
  padding: 0.08rem 0.4rem;
}
.info {
  border-left: 1px solid rgba(120, 160, 220, 0.15);
  padding-left: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  overflow-y: auto;
}
.info-thumb {
  width: 100%;
  aspect-ratio: 16 / 10;
  border-radius: 10px;
  overflow: hidden;
  display: grid;
  place-items: center;
}
.info h3 {
  margin: 0;
  font-size: 1.05rem;
  color: #eaf2ff;
}
.info-meta {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.8rem;
  color: #9fb2cf;
}
.info-meta strong {
  color: #e6eefc;
}
.info-desc {
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.4;
  color: #c7d5ee;
}
.info-reason {
  margin: 0;
  font-size: 0.8rem;
  color: #ffc178;
}
.build-btn {
  margin-top: auto;
  padding: 0.6rem;
  border: none;
  border-radius: 8px;
  background: linear-gradient(135deg, #4fc3f7, #2a7fd8);
  color: #04101f;
  font-weight: 700;
  cursor: pointer;
  font-size: 0.85rem;
}
.build-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
@media (max-width: 640px) {
  .body {
    grid-template-columns: 1fr;
  }
  .info {
    border-left: none;
    border-top: 1px solid rgba(120, 160, 220, 0.15);
    padding-left: 0;
    padding-top: 0.8rem;
  }
}
</style>
