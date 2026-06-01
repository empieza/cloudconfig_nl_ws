# Curwe CloudConfig WebSocket Server

## HWID (GameSense + Discord `/register`)

- HTTP: `POST /hwid/register` — бот (body: `token`, `discord_id`, `discord_tag`, `hwid`)
- HTTP: `POST /hwid/check` — опционально (PHP proxy)
- WS: `action: hwid_check` — **GameSense Lua** (body: `token`, `hwid`, `username` опционально)
- WS: `action: hwid_register`
- Данные: `DATA_DIR/hwid_bindings/bindings.json`
- Сайт: `POST /api/hwid/check` (прокси PHP, тот же `VERIFY_API_SECRET`)

После обновления: `pm2 restart curwe-cloudconfig-ws` и `php curwe-code-bot/register_commands.php` (команда `/register`).

## Leaderboard

После обновления перезапусти PM2: `pm2 restart curwe-cloudconfig-ws`

- WS: `leaderboard_sync`, `leaderboard_list`
- HTTP: `GET /leaderboard?app=dream&page=1&per_page=20`
- HTTP admin: `POST /leaderboard/reset` body `{ "admin_token": "<CLOUD_ADMIN_SECRET>", "app": "dream"|"default"|"all" }`
- Данные: `DATA_DIR/apps/dream/leaderboard/players.json`

WebSocket сервер для облачных конфигов Neverlose, адаптированный для FirstVDS.ru

## Быстрая установка

```bash
# 1. Скопируйте файлы на сервер
scp -r ./* username@your-server-ip:~/curwe-cloudconfig/

# 2. Подключитесь по SSH
ssh username@your-server-ip

# 3. Запустите установку
cd ~/curwe-cloudconfig
npm run setup