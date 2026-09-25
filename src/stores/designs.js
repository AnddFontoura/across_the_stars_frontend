import { defineStore } from 'pinia'
import api from '../api'

/**
 * Ship designs (custom models): the module catalog, base aircraft types, and
 * the player's saved designs. Building actual aircraft from a design is a
 * later step; this store handles composing and persisting the blueprints.
 */
export const useDesignStore = defineStore('designs', {
  state: () => ({
    baseTypes: [],    // aircraft types usable as a hull
    moduleTypes: [],  // installable modules
    designs: [],      // saved designs (with summaries)
    loading: false,
    loaded: false,
    error: null,
  }),

  actions: {
    async load() {
      this.loading = true
      this.error = null
      try {
        const { data } = await api.get('/ship-designs')
        this.baseTypes = data.base_types || []
        this.moduleTypes = data.module_types || []
        this.designs = data.designs || []
        this.loaded = true
        return true
      } catch (e) {
        this.error = e?.response?.data?.message || 'Falha ao carregar modelos.'
        return false
      } finally {
        this.loading = false
      }
    },

    /** Ask the server to compute stats/cost/time for a work-in-progress design. */
    async preview(aircraftTypeId, modules) {
      try {
        const { data } = await api.post('/ship-designs/preview', {
          aircraft_type_id: aircraftTypeId,
          modules,
        })
        return data.summary
      } catch (e) {
        return null
      }
    },

    async save(payload) {
      this.error = null
      try {
        const { data } = await api.post('/ship-designs', payload)
        this.designs.push(data.design)
        return true
      } catch (e) {
        const errors = e?.response?.data?.errors
        this.error =
          errors?.modules?.[0] ||
          errors?.space?.[0] ||
          errors?.weapon?.[0] ||
          errors?.name?.[0] ||
          e?.response?.data?.message ||
          'Não foi possível salvar o modelo.'
        return false
      }
    },

    async remove(designId) {
      this.error = null
      try {
        await api.delete(`/ship-designs/${designId}`)
        this.designs = this.designs.filter((d) => d.id !== designId)
        return true
      } catch (e) {
        this.error = e?.response?.data?.message || 'Não foi possível remover o modelo.'
        return false
      }
    },
  },
})
