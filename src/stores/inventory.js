import { defineStore } from 'pinia'
import api from '../api'

/**
 * Account-level inventory: the player's item stacks plus the Forte Protetor's
 * slot capacity/usage. Items belong to the account (not a single structure);
 * the Forte Protetor's level defines how many slots are available.
 *
 * No items exist in the game yet, so the list is typically empty; the store
 * still exposes add/remove actions and a type filter for the UI.
 */
export const useInventoryStore = defineStore('inventory', {
  state: () => ({
    items: [],        // owned stacks: { id, item_id, quantity, name, type, effects, max_stack, ... }
    inventory: null,  // { has_fort, capacity, used, remaining }
    loading: false,
    loaded: false,
    error: null,
  }),

  getters: {
    capacity: (state) => state.inventory?.capacity ?? 0,
    used: (state) => state.inventory?.used ?? 0,
    remaining: (state) => state.inventory?.remaining ?? 0,
    hasFort: (state) => state.inventory?.has_fort ?? false,
    consumables: (state) => state.items.filter((i) => i.type === 'consumable'),
    plants: (state) => state.items.filter((i) => i.type === 'plant'),
  },

  actions: {
    applySnapshot(data) {
      this.items = data.items || []
      this.inventory = data.inventory || null
      this.loaded = true
    },

    async load() {
      this.loading = true
      this.error = null
      try {
        const { data } = await api.get('/inventory')
        this.applySnapshot(data)
        return true
      } catch (e) {
        this.error = e?.response?.data?.message || 'Falha ao carregar o inventário.'
        return false
      } finally {
        this.loading = false
      }
    },

    /** Add `quantity` of a catalog item to the inventory. */
    async addItem(itemId, quantity = 1) {
      this.error = null
      try {
        const { data } = await api.post('/inventory/items', { item_id: itemId, quantity })
        this.applySnapshot(data)
        return true
      } catch (e) {
        const errors = e?.response?.data?.errors
        this.error =
          errors?.inventory?.[0] ||
          errors?.slots?.[0] ||
          errors?.stack?.[0] ||
          e?.response?.data?.message ||
          'Não foi possível adicionar o item.'
        return false
      }
    },

    /** Remove `quantity` of an owned item. */
    async removeItem(itemId, quantity = 1) {
      this.error = null
      try {
        const { data } = await api.delete('/inventory/items', {
          data: { item_id: itemId, quantity },
        })
        this.applySnapshot(data)
        return true
      } catch (e) {
        const errors = e?.response?.data?.errors
        this.error =
          errors?.quantity?.[0] ||
          e?.response?.data?.message ||
          'Não foi possível remover o item.'
        return false
      }
    },
  },
})
