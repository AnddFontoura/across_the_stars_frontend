<script setup>
import { computed, onMounted, ref } from 'vue'
import { useDesignStore } from '../stores/designs'
import Thumb from './Thumb.vue'

/**
 * Custom ship builder. Pick a base hull (aircraft type), fill its space with
 * modules (min 1, sum space <= storage), at most one weapon type. Name the
 * model and save it. Building actual aircraft from the design is a later step.
 */
const emit = defineEmits(['close'])

const store = useDesignStore()

const name = ref('')
const baseTypeId = ref(null)
// Map of moduleTypeId -> quantity (only entries with qty > 0 count).
const picked = ref({})
const flash = ref(null)

onMounted(async () => {
  if (!store.loaded) await store.load()
  if (store.baseTypes.length && baseTypeId.value === null) {
    baseTypeId.value = store.baseTypes[0].id
  }
})

const baseType = computed(() => store.baseTypes.find((b) => b.id === baseTypeId.value) || null)

const CLASS_LABELS = {
  cruiser: 'Cruzadores',
  battleship: 'Encouraçados',
  frigate: 'Fragatas',
  fighter: 'Caças',
}

// Base hulls grouped by class for the picker.
const baseTypesByClass = computed(() => {
  const order = ['cruiser', 'battleship', 'frigate', 'fighter']
  return order
    .map((key) => ({
      key,
      label: CLASS_LABELS[key] || key,
      ships: store.baseTypes.filter((b) => b.class === key),
    }))
    .filter((g) => g.ships.length > 0)
})

const resourceGlyph = { gold: '⦿', metal: '▣', energy: '⚡' }

// The currently selected weapon type (if any). Used to lock other weapon types.
const selectedWeaponType = computed(() => {
  for (const m of store.moduleTypes) {
    if (m.is_weapon && (picked.value[m.id] || 0) > 0) return m.attack_type
  }
  return null
})

// Live summary computed client-side (mirrors the backend formula).
const summary = computed(() => {
  const b = baseType.value
  if (!b) return null
  let movement = b.movement
  let shield = b.shield
  let hull = b.hull
  let usedSpace = 0
  let buildTime = b.build_time
  const cost = { gold: b.cost.gold, metal: b.cost.metal, energy: b.cost.energy }
  let attack = 0
  let weaponType = null
  let weaponRange = 0
  let moduleCount = 0

  for (const m of store.moduleTypes) {
    const q = picked.value[m.id] || 0
    if (q <= 0) continue
    moduleCount += q
    movement += m.movement * q
    shield += m.shield * q
    hull += m.hull * q
    usedSpace += m.space * q
    buildTime += m.build_time_add * q
    cost.gold += m.cost.gold * q
    cost.metal += m.cost.metal * q
    cost.energy += m.cost.energy * q
    if (m.is_weapon) {
      attack += m.attack * q
      weaponType = m.attack_type
      weaponRange = Math.max(weaponRange, m.range)
    }
  }

  return {
    movement, shield, hull, usedSpace,
    totalSpace: b.storage,
    freeSpace: Math.max(0, b.storage - usedSpace),
    attack, weaponType, weaponRange, buildTime, cost, moduleCount,
  }
})

// A module can be added if it fits in remaining space and doesn't introduce a
// second weapon type.
function canAdd(m) {
  const s = summary.value
  if (!s) return false
  if (s.freeSpace < m.space) return false
  if (m.is_weapon && selectedWeaponType.value && selectedWeaponType.value !== m.attack_type) {
    return false
  }
  return true
}

function inc(m) {
  if (!canAdd(m)) return
  picked.value[m.id] = (picked.value[m.id] || 0) + 1
}

function dec(m) {
  const q = picked.value[m.id] || 0
  if (q <= 0) return
  if (q === 1) delete picked.value[m.id]
  else picked.value[m.id] = q - 1
}

const valid = computed(() => {
  const s = summary.value
  return !!s && s.moduleCount >= 1 && s.usedSpace <= s.totalSpace && name.value.trim().length > 0
})

// When switching the base hull, clear picks that no longer fit is overkill;
// simplest is to reset the fit when the hull changes.
function onBaseChange() {
  picked.value = {}
}

async function save() {
  if (!valid.value) return
  const modules = Object.entries(picked.value)
    .filter(([, q]) => q > 0)
    .map(([id, q]) => ({ module_type_id: Number(id), quantity: q }))

  const ok = await store.save({
    name: name.value.trim(),
    aircraft_type_id: baseTypeId.value,
    modules,
  })
  if (ok) {
    flash.value = 'Modelo salvo!'
    name.value = ''
    picked.value = {}
    setTimeout(() => (flash.value = null), 2000)
  } else {
    flash.value = store.error
    setTimeout(() => (flash.value = null), 3000)
  }
}

async function removeDesign(id) {
  await store.remove(id)
}

function formatTime(totalSeconds) {
  const s = Math.max(0, totalSeconds || 0)
  const m = Math.floor(s / 60)
  const sec = s % 60
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
        <h2>Montar modelo de nave</h2>
        <button class="x" title="Fechar" @click="close">✕</button>
      </header>

      <div v-if="store.loading && !store.loaded" class="loading">Carregando catálogo...</div>

      <template v-else>
        <div class="builder">
          <!-- Left: base + modules -->
          <div class="col">
            <label>Nome do modelo</label>
            <input v-model="name" placeholder="Ex.: Interceptor MkI" maxlength="60" />

            <label style="margin-top:.7rem;">Casco base</label>
            <select v-model="baseTypeId" @change="onBaseChange">
              <optgroup v-for="cls in baseTypesByClass" :key="cls.key" :label="cls.label">
                <option v-for="b in cls.ships" :key="b.id" :value="b.id">
                  {{ b.name }} — espaço {{ b.storage }}
                </option>
              </optgroup>
            </select>

            <h3>Módulos</h3>
            <div class="mod-list">
              <div v-for="m in store.moduleTypes" :key="m.id" class="mod">
                <Thumb :src="m.image_url" :alt="m.name" :size="34" />
                <span class="mod-info">
                  <strong>{{ m.name }}</strong>
                  <small>
                    esp {{ m.space }}
                    <template v-if="m.is_weapon"> · atk {{ m.attack }} ({{ m.attack_type }}) · alc {{ m.range }}</template>
                    <template v-else-if="m.attack > 0"> · atk {{ m.attack }}</template>
                    <template v-if="m.hull > 0"> · estr {{ m.hull }}</template>
                    <template v-if="m.shield > 0"> · esc {{ m.shield }}</template>
                    <template v-if="m.movement > 0"> · mov {{ m.movement }}</template>
                  </small>
                </span>
                <span class="mod-qty">
                  <button class="qbtn" :disabled="(picked[m.id] || 0) <= 0" @click="dec(m)">−</button>
                  <span class="qval">{{ picked[m.id] || 0 }}</span>
                  <button class="qbtn" :disabled="!canAdd(m)" @click="inc(m)">+</button>
                </span>
              </div>
            </div>
          </div>

          <!-- Right: live summary -->
          <div class="col summary" v-if="summary">
            <h3>Resumo</h3>
            <div class="space-bar">
              <div class="space-fill" :style="{ width: (summary.totalSpace ? (summary.usedSpace / summary.totalSpace * 100) : 0) + '%' }"></div>
            </div>
            <p class="space-label">Espaço: {{ summary.usedSpace }} / {{ summary.totalSpace }}</p>

            <div class="stat"><span>Ataque</span><strong>{{ summary.attack }}<template v-if="summary.weaponType"> ({{ summary.weaponType }})</template></strong></div>
            <div class="stat" v-if="summary.weaponType"><span>Alcance</span><strong>{{ summary.weaponRange }}</strong></div>
            <div class="stat"><span>Estrutura</span><strong>{{ summary.hull }}</strong></div>
            <div class="stat"><span>Escudo</span><strong>{{ summary.shield }}</strong></div>
            <div class="stat"><span>Movimento</span><strong>{{ summary.movement }}</strong></div>
            <div class="stat"><span>Tempo</span><strong>{{ formatTime(summary.buildTime) }}</strong></div>
            <div class="stat"><span>Custo</span>
              <strong>
                <template v-for="(g, k) in resourceGlyph" :key="k">
                  <span v-if="summary.cost[k] > 0" class="cost">{{ summary.cost[k] }}{{ g }}</span>
                </template>
              </strong>
            </div>

            <button class="save" :disabled="!valid" @click="save">Salvar modelo</button>
            <p v-if="!valid && summary.moduleCount < 1" class="hint">Adicione pelo menos 1 módulo.</p>
            <p v-else-if="!valid && !name.trim()" class="hint">Dê um nome ao modelo.</p>
            <transition name="fade"><p v-if="flash" class="flash">{{ flash }}</p></transition>
          </div>
        </div>

        <!-- Saved designs -->
        <div class="saved">
          <h3>Meus modelos</h3>
          <p v-if="store.designs.length === 0" class="hint">Nenhum modelo salvo ainda.</p>
          <ul v-else class="design-list">
            <li v-for="d in store.designs" :key="d.id" class="design">
              <Thumb :src="d.base_type.image_url" :alt="d.base_type.name" :size="34" />
              <span class="design-info">
                <strong>{{ d.name }}</strong>
                <small>
                  {{ d.base_type.name }} · atk {{ d.summary.attack }}
                  <template v-if="d.summary.weapon_type"> ({{ d.summary.weapon_type }})</template>
                  · esp {{ d.summary.used_space }}/{{ d.summary.total_space }}
                  · {{ formatTime(d.summary.build_time) }}
                </small>
              </span>
              <button class="del" title="Remover" @click="removeDesign(d.id)">✕</button>
            </li>
          </ul>
        </div>
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
  z-index: 70;
}
.modal {
  width: min(880px, 95vw);
  max-height: 90vh;
  overflow-y: auto;
  background: #0e1524;
  border: 1px solid rgba(120, 160, 220, 0.25);
  border-radius: 14px;
  padding: 1.2rem 1.3rem;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.55);
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}
.modal-head h2 { margin: 0; font-size: 1.15rem; color: #eaf2ff; }
.x {
  background: transparent; border: 1px solid rgba(120, 160, 220, 0.3);
  color: #cfe0ff; border-radius: 7px; width: 30px; height: 30px; cursor: pointer;
}
.x:hover { border-color: #ff8080; color: #ff8080; }
.loading { color: #9fb2cf; padding: 1rem 0; }
.builder { display: grid; grid-template-columns: 1.4fr 1fr; gap: 1.2rem; }
@media (max-width: 680px) { .builder { grid-template-columns: 1fr; } }
.col label { display: block; font-size: 0.78rem; color: #9fb2cf; margin-bottom: 0.25rem; }
.col input, .col select {
  width: 100%; padding: 0.5rem 0.6rem; border-radius: 8px;
  border: 1px solid rgba(120, 160, 220, 0.25); background: #0e1420; color: #eaf2ff;
}
.col h3 { margin: 1rem 0 0.5rem; font-size: 0.95rem; }
.mod-list { display: flex; flex-direction: column; gap: 0.4rem; }
.mod {
  display: flex; align-items: center; gap: 0.6rem;
  padding: 0.5rem 0.6rem; border-radius: 9px;
  border: 1px solid rgba(120, 160, 220, 0.2); background: #131c30;
}
.mod-info { display: flex; flex-direction: column; flex: 1; }
.mod-info small { color: #8496b5; }
.swatch { width: 16px; height: 16px; border-radius: 4px; flex: none; }
.mod-qty { display: flex; align-items: center; gap: 0.4rem; }
.qbtn {
  width: 26px; height: 26px; border-radius: 6px; cursor: pointer;
  border: 1px solid rgba(120, 160, 220, 0.3); background: #0e1420; color: #cfe0ff;
  font-weight: 700; line-height: 1;
}
.qbtn:disabled { opacity: 0.35; cursor: not-allowed; }
.qval { min-width: 18px; text-align: center; font-weight: 700; }
.summary { border-left: 1px solid rgba(120, 160, 220, 0.15); padding-left: 1rem; }
.space-bar { height: 10px; border-radius: 6px; background: #0b1220; overflow: hidden; border: 1px solid rgba(120,160,220,.2); }
.space-fill { height: 100%; background: linear-gradient(90deg, #4fc3f7, #2a7fd8); }
.space-label { font-size: 0.8rem; color: #9fb2cf; margin: 0.3rem 0 0.7rem; }
.stat { display: flex; justify-content: space-between; font-size: 0.85rem; padding: 0.2rem 0; color: #9fb2cf; }
.stat strong { color: #e6eefc; }
.cost { margin-left: 0.4rem; }
.save {
  width: 100%; margin-top: 0.9rem; padding: 0.6rem; border: none; border-radius: 8px;
  background: linear-gradient(135deg, #4fc3f7, #2a7fd8); color: #04101f; font-weight: 700; cursor: pointer;
}
.save:disabled { opacity: 0.4; cursor: not-allowed; }
.hint { font-size: 0.78rem; color: #7f93b3; margin: 0.5rem 0 0; }
.flash { font-size: 0.82rem; color: #8fd39a; margin: 0.5rem 0 0; }
.saved { margin-top: 1.2rem; border-top: 1px solid rgba(120, 160, 220, 0.15); padding-top: 1rem; }
.saved h3 { margin: 0 0 0.6rem; font-size: 0.95rem; }
.design-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
.design {
  display: flex; align-items: center; gap: 0.6rem; padding: 0.5rem 0.6rem;
  border-radius: 9px; border: 1px solid rgba(120, 160, 220, 0.2); background: #131c30;
}
.design-info { display: flex; flex-direction: column; flex: 1; }
.design-info small { color: #8496b5; }
.del {
  background: transparent; border: 1px solid rgba(179, 69, 58, 0.5);
  color: #e08a80; border-radius: 6px; width: 26px; height: 26px; cursor: pointer;
}
.del:hover { background: rgba(179, 69, 58, 0.15); }
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
