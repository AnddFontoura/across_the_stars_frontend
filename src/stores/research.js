import { defineStore } from 'pinia'
import api from '../api'

/**
 * Account-level research: the catalog of technologies and plants, the player's
 * progress on each, and the currently in-progress research (only one at a
 * time). Research is unlocked by the "Centro de Pesquisa", whose level reduces
 * research wait time (up to 60%).
 */
export const useResearchStore = defineStore('research', {
  state: () => ({
    // Per-definition state with cost/time/deps/requirements (see backend snapshot).
    definitions: [],
    // { has_center, center_level, time_reduction, gold, active }
    research: null,
    loading: false,
    loaded: false,
    error: null,
  }),

  getters: {
    hasCenter: (state) => state.research?.has_center ?? false,
    centerLevel: (state) => state.research?.center_level ?? 0,
    timeReduction: (state) => state.research?.time_reduction ?? 0,
    gold: (state) => state.research?.gold ?? 0,
    // All research currently in progress (a technology plus up to 3 plants).
    active: (state) => state.research?.active ?? [],
    // Per-type concurrency (1 technology, 3 plants).
    technologySlots: (state) => state.research?.technology ?? { used: 0, max: 1 },
    plantSlots: (state) => state.research?.plants ?? { used: 0, max: 3 },
    technologies: (state) => state.definitions.filter((d) => d.type === 'technology'),
    plants: (state) => state.definitions.filter((d) => d.type === 'plant'),
  },

  actions: {
    applySnapshot(data) {
      this.definitions = data.definitions || []
      this.research = data.research || null
      this.loaded = true
    },

    async load() {
      this.loading = true
      this.error = null
      try {
        const { data } = await api.get('/research')
        this.applySnapshot(data)
        return true
      } catch (e) {
        this.error = e?.response?.data?.message || 'Falha ao carregar as pesquisas.'
        return false
      } finally {
        this.loading = false
      }
    },

    /** Start researching the next level of a definition. */
    async start(definitionId) {
      this.error = null
      try {
        const { data } = await api.post('/research/start', {
          research_definition_id: definitionId,
        })
        this.applySnapshot(data)
        return true
      } catch (e) {
        const errors = e?.response?.data?.errors
        this.error =
          errors?.research?.[0] ||
          errors?.busy?.[0] ||
          errors?.level?.[0] ||
          errors?.dependencies?.[0] ||
          errors?.cost?.[0] ||
          errors?.items?.[0] ||
          e?.response?.data?.message ||
          'Não foi possível iniciar a pesquisa.'
        return false
      }
    },
  },
})
