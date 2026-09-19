import { defineStore } from 'pinia'
import api from '../api'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null,
    token: localStorage.getItem('ats_token') || null,
  }),

  getters: {
    isAuthenticated: (state) => !!state.token,
  },

  actions: {
    setSession(user, token) {
      this.user = user
      this.token = token
      localStorage.setItem('ats_token', token)
    },

    async register(payload) {
      const { data } = await api.post('/register', payload)
      this.setSession(data.user, data.token)
    },

    async login(payload) {
      const { data } = await api.post('/login', payload)
      this.setSession(data.user, data.token)
    },

    async fetchMe() {
      const { data } = await api.get('/me')
      this.user = data.user
    },

    async logout() {
      try {
        await api.post('/logout')
      } catch (e) {
        // ignore network/401 on logout
      }
      this.user = null
      this.token = null
      localStorage.removeItem('ats_token')
    },
  },
})
