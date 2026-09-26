import { defineStore } from 'pinia'
import api from '../api'

/**
 * Account-level fleet: aircraft catalog, the player's owned aircraft, the
 * counter matrix, in-progress build orders and hangar-derived limits
 * (build slots, capacity, build-time reduction).
 *
 * Building aircraft is the next step; for now this store only loads the
 * snapshot so the hangar UI can show slots and (empty) per-class build spots.
 */
export const useFleetStore = defineStore('fleet', {
  state: () => ({
    designs: [],       // player's ship designs with owned/in_progress + summary
    aircraftTypes: [], // base hull catalog (reference)
    matchups: [],      // counter matrix rows
    buildOrders: [],   // aircraft under construction (by design)
    fleet: null,       // { has_hangar, build_slots, capacity, used, remaining, ... }
    loading: false,
    loaded: false,
    error: null,
  }),

  actions: {
    applySnapshot(data) {
      this.designs = data.designs || []
      this.aircraftTypes = data.aircraft_types || []
      this.matchups = data.matchups || []
      this.buildOrders = data.build_orders || []
      this.fleet = data.fleet || null
      this.loaded = true
    },

    async load() {
      this.loading = true
      this.error = null
      try {
        const { data } = await api.get('/aircraft')
        this.applySnapshot(data)
        return true
      } catch (e) {
        this.error = e?.response?.data?.message || 'Falha ao carregar a frota.'
        return false
      } finally {
        this.loading = false
      }
    },

    /** Enqueue building `quantity` aircraft of a saved design. */
    async build(shipDesignId, quantity) {
      this.error = null
      try {
        const { data } = await api.post('/aircraft/build', {
          ship_design_id: shipDesignId,
          quantity,
        })
        this.applySnapshot(data)
        return true
      } catch (e) {
        const errors = e?.response?.data?.errors
        this.error =
          errors?.hangar?.[0] ||
          errors?.capacity?.[0] ||
          errors?.cost?.[0] ||
          e?.response?.data?.message ||
          'Não foi possível construir.'
        return false
      }
    },

    /** Collect ("recolher") all finished builds into the fleet. */
    async collect() {
      this.error = null
      try {
        const { data } = await api.post('/aircraft/collect')
        this.applySnapshot(data)
        return data.collected ?? 0
      } catch (e) {
        this.error = e?.response?.data?.message || 'Não foi possível recolher as naves.'
        return false
      }
    },
  },
})
