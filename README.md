# Across the Stars — Frontend

Cliente do jogo em Vue 3 + Vite. Dockerizado: só precisa de Docker.

## Stack
- Vue 3 + Vite
- Pinia (estado) e Vue Router
- Axios (chamadas à API)

## Como rodar

Suba o backend primeiro (ver o repositório `across_the_starts_backend`), depois:

```sh
docker compose up --build
```

- App: http://localhost:8202
- A API é consumida em `http://localhost:8201/api` (configurável via
  `VITE_API_URL` no `docker-compose.yml`).

Para parar:

```sh
docker compose down
```

## Fluxo

1. Abra http://localhost:8202 — você cai na tela de login.
2. Clique em "Registre-se" para criar um comandante (nome, e-mail, senha).
3. Após entrar, o terreno 1000x1000 aparece em projeção isométrica (gramado verde).
4. No painel lateral, selecione uma estrutura e clique no terreno para posicioná-la.
   - Um preview segue o mouse; posições fora dos limites ou sobrepostas são bloqueadas.
5. Use "Coletar recursos" para receber a produção acumulada (ouro/metal/energia).

## Estrutura

- `src/api.js` — instância Axios com o token Bearer (guardado em `localStorage`).
- `src/stores/auth.js` — login/registro/logout e sessão.
- `src/stores/game.js` — estado da base, estruturas e catálogo.
- `src/router.js` — rotas com guarda de autenticação.
- `src/views/LoginView.vue` — login/registro.
- `src/views/GameView.vue` — HUD de recursos, catálogo e área do jogo.
- `src/components/IsometricGrid.vue` — render isométrico (SVG) do terreno e estruturas.
