import { defineStore } from 'pinia'
import api from '../api'

export const useGameStore = defineStore('game', {
  state: () => ({
    base: null,            // { id, kind, scope, width, height, resources: {gold, metal, energy} }
    structures: [],        // placed structures
    structureTypes: [],    // catalog
    // Which base is currently active: 'terrestrial' (resources) or
    // 'planetary' (orbital defense). Drives which base the API operates on.
    activeBaseKind: 'terrestrial',
    loading: false,
    error: null,
  }),

  getters: {
    isPlanetary: (state) => state.activeBaseKind === 'planetary',
  },

  actions: {
    applySnapshot(data) {
      this.base = data.base
      this.structures = data.structures
      this.structureTypes = data.structure_types
      // Keep the active kind in sync with what the server returned.
      if (data.base?.kind) this.activeBaseKind = data.base.kind
    },

    /**
     * Switch between the terrestrial and planetary bases and reload the state.
     */
    async setBaseKind(kind) {
      if (kind !== 'terrestrial' && kind !== 'planetary') return
      if (kind === this.activeBaseKind && this.base) return
      this.activeBaseKind = kind
      await this.loadBase()
    },

    async loadBase() {
      this.loading = true
      this.error = null
      try {
        const { data } = await api.get('/base', { params: { kind: this.activeBaseKind } })
        this.applySnapshot(data)
      } catch (e) {
        this.error = e?.response?.data?.message || 'Falha ao carregar a base.'
      } finally {
        this.loading = false
      }
    },

    /**
     * Silent refresh: fetches the latest state and merges it into the current
     * one without toggling the loading flag or recreating the structures array.
     * This avoids any visible "flash" or reset of hover/selection in the UI.
     */
    async refreshBase() {
      try {
        const { data } = await api.get('/base', { params: { kind: this.activeBaseKind } })
        this.mergeSnapshot(data)
        return true
      } catch (e) {
        // Stay silent on background refresh errors; keep showing current data.
        return false
      }
    },

    mergeSnapshot(data) {
      // Base scalar fields: assign in place.
      if (this.base) {
        Object.assign(this.base, data.base)
      } else {
        this.base = data.base
      }

      // Catalog rarely changes; replace directly.
      this.structureTypes = data.structure_types

      // Structures: update existing entries in place, add new, remove gone.
      const incoming = data.structures
      const incomingById = new Map(incoming.map((s) => [s.id, s]))

      // Update or remove current entries.
      for (let i = this.structures.length - 1; i >= 0; i--) {
        const current = this.structures[i]
        const fresh = incomingById.get(current.id)
        if (fresh) {
          Object.assign(current, fresh)
          incomingById.delete(current.id)
        } else {
          this.structures.splice(i, 1)
        }
      }

      // Append any brand-new structures.
      for (const fresh of incomingById.values()) {
        this.structures.push(fresh)
      }
    },

    async placeStructure(structureTypeId, x, y) {
      this.error = null
      try {
        const { data } = await api.post('/structures', {
          structure_type_id: structureTypeId,
          x,
          y,
          kind: this.activeBaseKind,
        })
        this.applySnapshot(data)
        return true
      } catch (e) {
        const errors = e?.response?.data?.errors
        this.error =
          errors?.position?.[0] ||
          errors?.unique?.[0] ||
          errors?.scope?.[0] ||
          errors?.category?.[0] ||
          errors?.builds?.[0] ||
          errors?.limit?.[0] ||
          e?.response?.data?.message ||
          'Não foi possível posicionar a estrutura.'
        return false
      }
    },

    async collectAll() {
      this.error = null
      try {
        const { data } = await api.post('/structures/collect', { kind: this.activeBaseKind })
        this.applySnapshot(data)
      } catch (e) {
        this.error = e?.response?.data?.message || 'Falha ao coletar recursos.'
      }
    },

    async collectStructure(structureId) {
      this.error = null
      try {
        const { data } = await api.post(`/structures/${structureId}/collect`)
        this.applySnapshot(data)
        return true
      } catch (e) {
        this.error = e?.response?.data?.message || 'Falha ao recolher recursos.'
        return false
      }
    },

    async demolishStructure(structureId) {
      this.error = null
      try {
        const { data } = await api.delete(`/structures/${structureId}`)
        this.applySnapshot(data)
        return true
      } catch (e) {
        this.error = e?.response?.data?.message || 'Não foi possível desconstruir.'
        return false
      }
    },

    async upgradeStructure(structureId) {
      this.error = null
      try {
        const { data } = await api.post(`/structures/${structureId}/upgrade`)
        this.applySnapshot(data)
        return true
      } catch (e) {
        const errors = e?.response?.data?.errors
        this.error =
          errors?.cost?.[0] ||
          errors?.command?.[0] ||
          errors?.busy?.[0] ||
          errors?.builds?.[0] ||
          errors?.level?.[0] ||
          e?.response?.data?.message ||
          'Não foi possível evoluir a estrutura.'
        return false
      }
    },
  },
})
