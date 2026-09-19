import { defineStore } from 'pinia'
import api from '../api'

export const useGameStore = defineStore('game', {
  state: () => ({
    base: null,            // { id, width, height, resources: {gold, metal, energy} }
    structures: [],        // placed structures
    structureTypes: [],    // catalog
    loading: false,
    error: null,
  }),

  actions: {
    applySnapshot(data) {
      this.base = data.base
      this.structures = data.structures
      this.structureTypes = data.structure_types
    },

    async loadBase() {
      this.loading = true
      this.error = null
      try {
        const { data } = await api.get('/base')
        this.applySnapshot(data)
      } catch (e) {
        this.error = e?.response?.data?.message || 'Falha ao carregar a base.'
      } finally {
        this.loading = false
      }
    },

    async placeStructure(structureTypeId, x, y) {
      this.error = null
      try {
        const { data } = await api.post('/structures', {
          structure_type_id: structureTypeId,
          x,
          y,
        })
        this.applySnapshot(data)
        return true
      } catch (e) {
        this.error =
          e?.response?.data?.errors?.position?.[0] ||
          e?.response?.data?.message ||
          'Não foi possível posicionar a estrutura.'
        return false
      }
    },

    async collectAll() {
      this.error = null
      try {
        const { data } = await api.post('/structures/collect')
        this.applySnapshot(data)
      } catch (e) {
        this.error = e?.response?.data?.message || 'Falha ao coletar recursos.'
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
          errors?.level?.[0] ||
          e?.response?.data?.message ||
          'Não foi possível evoluir a estrutura.'
        return false
      }
    },
  },
})
