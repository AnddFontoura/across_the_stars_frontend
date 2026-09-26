import { defineStore } from 'pinia'
import api from '../api'

/**
 * Commanders (account pool) and fleets. Recruitment is unlocked by the
 * Aircraft Hangar and takes 1 hour. Fleets are led by a commander and composed
 * of ship-design stacks. Combat is a later step.
 */
export const useCommanderStore = defineStore('commanders', {
  state: () => ({
    // Commander pool
    commanders: [],
    recruitment: null, // { can_recruit, active, remaining_seconds, pool_used, pool_max }
    // Fleets
    fleets: [],
    availableShips: [], // { ship_design_id, name, class, owned, available }
    fleetCommanders: [], // lightweight commander list for the fleet builder
    limits: { max_slots: 12, max_per_slot: 5000 },
    loading: false,
    loaded: false,
    error: null,
  }),

  actions: {
    applyCommanders(data) {
      this.commanders = data.commanders || []
      this.recruitment = data.recruitment || null
      this.loaded = true
    },

    applyFleets(data) {
      this.fleets = data.fleets || []
      this.availableShips = data.available_ships || []
      this.fleetCommanders = data.commanders || []
      this.limits = data.limits || this.limits
    },

    async loadCommanders() {
      this.loading = true
      this.error = null
      try {
        const { data } = await api.get('/commanders')
        this.applyCommanders(data)
        return true
      } catch (e) {
        this.error = e?.response?.data?.message || 'Falha ao carregar comandantes.'
        return false
      } finally {
        this.loading = false
      }
    },

    async recruit() {
      this.error = null
      try {
        const { data } = await api.post('/commanders/recruit')
        this.applyCommanders(data)
        return true
      } catch (e) {
        const errors = e?.response?.data?.errors
        this.error =
          errors?.hangar?.[0] ||
          errors?.recruitment?.[0] ||
          errors?.pool?.[0] ||
          e?.response?.data?.message ||
          'Não foi possível recrutar.'
        return false
      }
    },

    async loadFleets() {
      this.error = null
      try {
        const { data } = await api.get('/fleets')
        this.applyFleets(data)
        return true
      } catch (e) {
        this.error = e?.response?.data?.message || 'Falha ao carregar frotas.'
        return false
      }
    },

    async saveFleet(payload, fleetId = null) {
      this.error = null
      try {
        const { data } = fleetId
          ? await api.put(`/fleets/${fleetId}`, payload)
          : await api.post('/fleets', payload)
        this.applyFleets(data)
        return true
      } catch (e) {
        const errors = e?.response?.data?.errors
        this.error =
          errors?.slots?.[0] ||
          errors?.name?.[0] ||
          e?.response?.data?.message ||
          'Não foi possível salvar a frota.'
        return false
      }
    },

    async deleteFleet(fleetId) {
      this.error = null
      try {
        const { data } = await api.delete(`/fleets/${fleetId}`)
        this.applyFleets(data)
        return true
      } catch (e) {
        this.error = e?.response?.data?.message || 'Não foi possível desfazer a frota.'
        return false
      }
    },

    /**
     * Set a fleet's energy to an absolute amount (0..capacity). The backend
     * reconciles the difference against the shared energy pool (filling debits
     * it, draining refunds it).
     */
    async refuelFleet(fleetId, energy) {
      this.error = null
      try {
        const { data } = await api.patch(`/fleets/${fleetId}/refuel`, { energy })
        this.applyFleets(data)
        return true
      } catch (e) {
        const errors = e?.response?.data?.errors
        this.error =
          errors?.energy?.[0] ||
          e?.response?.data?.message ||
          'Não foi possível reabastecer a frota.'
        return false
      }
    },
  },
})
