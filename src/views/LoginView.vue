<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const auth = useAuthStore()

const mode = ref('login') // 'login' | 'register'
const name = ref('')
const email = ref('')
const password = ref('')
const passwordConfirmation = ref('')
const error = ref(null)
const loading = ref(false)

function toggleMode() {
  mode.value = mode.value === 'login' ? 'register' : 'login'
  error.value = null
}

async function submit() {
  error.value = null
  loading.value = true
  try {
    if (mode.value === 'login') {
      await auth.login({ email: email.value, password: password.value })
    } else {
      await auth.register({
        name: name.value,
        email: email.value,
        password: password.value,
        password_confirmation: passwordConfirmation.value,
      })
    }
    router.push({ name: 'game' })
  } catch (e) {
    const data = e?.response?.data
    if (data?.errors) {
      error.value = Object.values(data.errors).flat().join(' ')
    } else {
      error.value = data?.message || 'Algo deu errado. Tente novamente.'
    }
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="auth-wrap">
    <div class="auth-card">
      <h1 class="title">Across the Stars</h1>
      <p class="subtitle">{{ mode === 'login' ? 'Entrar na sua base' : 'Criar comandante' }}</p>

      <form @submit.prevent="submit" class="form">
        <label v-if="mode === 'register'">
          <span>Nome</span>
          <input v-model="name" type="text" required placeholder="Seu nome" />
        </label>

        <label>
          <span>E-mail</span>
          <input v-model="email" type="email" required placeholder="voce@exemplo.com" />
        </label>

        <label>
          <span>Senha</span>
          <input v-model="password" type="password" required placeholder="••••••••" />
        </label>

        <label v-if="mode === 'register'">
          <span>Confirmar senha</span>
          <input v-model="passwordConfirmation" type="password" required placeholder="••••••••" />
        </label>

        <p v-if="error" class="error">{{ error }}</p>

        <button type="submit" class="btn" :disabled="loading">
          {{ loading ? 'Aguarde...' : mode === 'login' ? 'Entrar' : 'Registrar' }}
        </button>
      </form>

      <button class="link" @click="toggleMode">
        {{ mode === 'login' ? 'Não tem conta? Registre-se' : 'Já tem conta? Entrar' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.auth-wrap {
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: radial-gradient(circle at 30% 20%, #1b2735, #090a0f 70%);
  padding: 1rem;
}
.auth-card {
  width: 100%;
  max-width: 380px;
  background: rgba(20, 26, 38, 0.9);
  border: 1px solid rgba(120, 160, 220, 0.2);
  border-radius: 14px;
  padding: 2rem;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}
.title {
  margin: 0;
  font-size: 1.6rem;
  color: #eaf2ff;
  text-align: center;
}
.subtitle {
  margin: 0.25rem 0 1.5rem;
  text-align: center;
  color: #8fa3c0;
}
.form {
  display: grid;
  gap: 0.9rem;
}
label {
  display: grid;
  gap: 0.35rem;
  font-size: 0.85rem;
  color: #9fb2cf;
}
input {
  padding: 0.65rem 0.8rem;
  border-radius: 8px;
  border: 1px solid rgba(120, 160, 220, 0.25);
  background: #0e1420;
  color: #eaf2ff;
  outline: none;
}
input:focus {
  border-color: #4fc3f7;
}
.btn {
  margin-top: 0.4rem;
  padding: 0.7rem;
  border: none;
  border-radius: 8px;
  background: linear-gradient(135deg, #4fc3f7, #2a7fd8);
  color: #04101f;
  font-weight: 700;
  cursor: pointer;
}
.btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.link {
  margin-top: 1rem;
  width: 100%;
  background: none;
  border: none;
  color: #7fb2ff;
  cursor: pointer;
}
.error {
  margin: 0;
  color: #ff8080;
  font-size: 0.85rem;
}
</style>
