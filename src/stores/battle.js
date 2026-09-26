import { defineStore } from 'pinia'
import api from '../api'

/**
 * "Investigação Interplanetária" state: the catalog of available investigations,
 * the currently active/replayable battle instance, and the round-by-round event
 * log. The battle is server-authoritative and advanced one round at a time via
 * `step()`; the viewer plays the returned events back to animate the fight.
 */
export const useBattleStore = defineStore('battle', {
  state: () => ({
    investigations: [], // available investigation definitions
    active: null,       // the player's in-progress (or unclaimed-win) instance
    battle: null,       // the instance currently open in the viewer
    events: [],         // accumulated event log for the open battle
    rewards: null,      // last claim result
    stepping: false,    // a /step request is in flight
    loading: false,
    error: null,
  }),

  getters: {
    hasActive: (state) => !!state.active,
    isOver: (state) => !!state.battle?.is_over,
    playerFleets: (state) => (state.battle?.fleets || []).filter((f) => f.side === 'player'),
    enemyFleets: (state) => (state.battle?.fleets || []).filter((f) => f.side === 'enemy'),
  },

  actions: {
    /** Load available investigations + any active run. */
    async load() {
      this.loading = true
      this.error = null
      try {
        const { data } = await api.get('/investigations')
        this.investigations = data.investigations || []
        this.active = data.active || null
        return true
      } catch (e) {
        this.error = e?.response?.data?.message || 'Falha ao carregar investigações.'
        return false
      } finally {
        this.loading = false
      }
    },

    /** Refresh just the active-run marker (used to show "voltar à instância"). */
    async refreshActive() {
      try {
        const { data } = await api.get('/battles/active')
        this.active = data.active || null
        return true
      } catch (e) {
        return false
      }
    },

    /** Start an investigation with the chosen player fleet ids. */
    async start(investigationId, fleetIds) {
      this.error = null
      try {
        const { data } = await api.post('/investigations/start', {
          investigation_id: investigationId,
          fleet_ids: fleetIds,
        })
        this.openBattle(data.battle)
        this.active = data.battle
        return true
      } catch (e) {
        const errors = e?.response?.data?.errors
        this.error =
          errors?.fleets?.[0] ||
          errors?.investigation?.[0] ||
          e?.response?.data?.message ||
          'Não foi possível iniciar a investigação.'
        return false
      }
    },

    /** Load a specific battle into the viewer (fresh event log). */
    async openById(id) {
      this.error = null
      try {
        const { data } = await api.get(`/battles/${id}`)
        this.openBattle(data.battle)
        return true
      } catch (e) {
        this.error = e?.response?.data?.message || 'Falha ao abrir a batalha.'
        return false
      }
    },

    openBattle(battle) {
      this.battle = battle
      this.events = []
      this.rewards = null
    },

    /** Advance one round and append the new events for the viewer to play. */
    async step() {
      if (!this.battle || this.battle.is_over || this.stepping) return false
      this.stepping = true
      this.error = null
      try {
        const { data } = await api.post(`/battles/${this.battle.id}/step`)
        this.battle = data.battle
        this.active = data.battle.is_over ? (data.battle.status === 'won' && !data.battle.rewards_claimed ? data.battle : null) : data.battle
        this.events.push(...(data.events || []))
        return data.events || []
      } catch (e) {
        this.error = e?.response?.data?.message || 'Não foi possível avançar o round.'
        return false
      } finally {
        this.stepping = false
      }
    },

    /** Claim win rewards (item prizes + commander exp). */
    async claim() {
      if (!this.battle) return false
      this.error = null
      try {
        const { data } = await api.post(`/battles/${this.battle.id}/claim`)
        this.rewards = data.rewards
        this.battle = data.battle
        this.active = null
        return true
      } catch (e) {
        this.error = e?.response?.data?.message || 'Não foi possível resgatar as recompensas.'
        return false
      }
    },

    /** Abandon the current run (counts as a loss; fleets unlock). */
    async abandon() {
      if (!this.battle) return false
      this.error = null
      try {
        const { data } = await api.post(`/battles/${this.battle.id}/abandon`)
        this.battle = data.battle
        this.active = null
        return true
      } catch (e) {
        this.error = e?.response?.data?.message || 'Não foi possível abandonar a investigação.'
        return false
      }
    },

    close() {
      this.battle = null
      this.events = []
      this.rewards = null
    },
  },
})
