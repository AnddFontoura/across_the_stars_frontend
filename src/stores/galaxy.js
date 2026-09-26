import { defineStore } from 'pinia'
import api from '../api'

/**
 * Galaxy view state: the 30 quadrants (with planet counts), the planets inside
 * the currently-open quadrant, the player's own position, and the currently
 * inspected planet (attack target). Read-only for now; the attack launch will
 * build on `inspect()` / the /galaxy/planet endpoint.
 */
export const useGalaxyStore = defineStore('galaxy', {
  state: () => ({
    quadrants: [],          // [{ quadrant, planets, capacity }]
    totalQuadrants: 30,
    slotsPerQuadrant: 1000,
    self: null,             // { base_id, quadrant, slot }
    activeQuadrant: null,   // number currently being viewed
    planets: [],            // planets in the active quadrant [{ base_id, slot, owner_name, is_self }]
    target: null,           // inspected planet { planet, attack }
    loading: false,
    loadingQuadrant: false,
    error: null,
  }),

  getters: {
    // Fast lookup of the planet occupying a given slot in the active quadrant.
    planetBySlot: (state) => {
      const map = new Map()
      for (const p of state.planets) map.set(p.slot, p)
      return map
    },
    activeQuadrantMeta: (state) =>
      state.quadrants.find((q) => q.quadrant === state.activeQuadrant) || null,
  },

  actions: {
    /** Load the galaxy overview (quadrant counts + the player's position). */
    async loadOverview() {
      this.loading = true
      this.error = null
      try {
        const { data } = await api.get('/galaxy')
        this.quadrants = data.quadrants || []
        this.totalQuadrants = data.total_quadrants || 30
        this.slotsPerQuadrant = data.slots_per_quadrant || 1000
        this.self = data.self || null
        return true
      } catch (e) {
        this.error = e?.response?.data?.message || 'Falha ao carregar a galáxia.'
        return false
      } finally {
        this.loading = false
      }
    },

    /** Load the planets inside a quadrant and make it the active view. */
    async loadQuadrant(quadrant) {
      this.loadingQuadrant = true
      this.error = null
      try {
        const { data } = await api.get(`/galaxy/quadrant/${quadrant}`)
        this.activeQuadrant = data.quadrant
        this.slotsPerQuadrant = data.capacity || this.slotsPerQuadrant
        this.planets = data.planets || []
        return true
      } catch (e) {
        this.error = e?.response?.data?.message || 'Falha ao carregar o quadrante.'
        return false
      } finally {
        this.loadingQuadrant = false
      }
    },

    /** Inspect a single planet as a potential attack target. */
    async inspect(baseId) {
      this.error = null
      try {
        const { data } = await api.get(`/galaxy/planet/${baseId}`)
        this.target = data
        return true
      } catch (e) {
        this.error = e?.response?.data?.message || 'Falha ao inspecionar o planeta.'
        return false
      }
    },

    clearTarget() {
      this.target = null
    },
  },
})
