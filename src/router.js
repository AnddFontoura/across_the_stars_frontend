import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from './stores/auth'
import LoginView from './views/LoginView.vue'
import GameView from './views/GameView.vue'
import GalaxyView from './views/GalaxyView.vue'

const routes = [
  { path: '/', redirect: '/game' },
  { path: '/login', name: 'login', component: LoginView, meta: { guest: true } },
  { path: '/game', name: 'game', component: GameView, meta: { requiresAuth: true } },
  { path: '/galaxy', name: 'galaxy', component: GalaxyView, meta: { requiresAuth: true } },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach((to) => {
  const auth = useAuthStore()

  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: 'login' }
  }

  if (to.meta.guest && auth.isAuthenticated) {
    return { name: 'game' }
  }

  return true
})

export default router
