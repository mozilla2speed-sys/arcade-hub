# Arcade Hub

Мультиплеерный аркадный хаб: гонки и другие игры.

## Стек

- **Сервер:** Node.js + TypeScript + Fastify + WebSocket (`@fastify/websocket`)
- **Клиент:** Vite + TypeScript + Three.js
- **Общее:** папка `shared` — типы сообщений и физика (одинаковая на клиенте и сервере)

Сервер авторитетный: считает физику 20 раз в секунду и рассылает состояние. Клиент отправляет только нажатия клавиш.

## Структура

```
arcade-hub/
├── server/          # Node-сервер (комнаты, тики, игры)
├── client/          # Vite + Three.js
├── shared/          # Общие типы и физика
└── package.json
```

## Локальный запуск

```bash
npm install
npm run dev          # сервер :3000 + клиент :5173
```

Открой http://localhost:5173

## Production (Render)

- **Build:** `npm install --include=dev && npm run build`
- **Start:** `npm start`
- Сервер отдаёт собранный клиент из `dist/client` и слушает WebSocket на `/ws`
- Health-check: `GET /health` (для cron-job.org, чтобы бесплатный инстанс не засыпал)

## Игры

- **Гонки (car)** — уже есть, серверная физика + комнаты по коду / быстрая игра
- **Hole.io** — следующий модуль (папка `games/hole`)

Новая игра = новая папка в `server/src/games/` + `client/src/games/` + при необходимости `shared/src/games/`.

## Комнаты

- **Код комнаты** — для друзей (поле «Код комнаты»)
- **Быстрая игра** — подбор в открытую комнату или создание новой
