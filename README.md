# Curwe CloudConfig WebSocket Server

WebSocket сервер для облачных конфигов Neverlose.

## Развертывание на Render.com

### 1. Создание сервиса

1. Зайдите на [Render.com](https://render.com)
2. Нажмите **New** → **Web Service**
3. Подключите ваш Git репозиторий или используйте **Public Git repository**

### 2. Настройка

| Параметр | Значение |
|----------|----------|
| **Name** | `curwe-cloudconfig-ws` |
| **Region** | Frankfurt (или ближайший) |
| **Branch** | main |
| **Root Directory** | `api/cloudconfig_ws` |
| **Runtime** | Node |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Instance Type** | Free (или Starter) |

### 3. Переменные окружения

В разделе **Environment Variables** добавьте:

```
CLOUD_API_SECRET=IuMR2uiNClsz4oDC9tjgWT10BPbXb6pzKAGpNyXQWo
CLOUD_ADMIN_SECRET=your_admin_secret_here_minimum_16_characters
DATA_DIR=/opt/render/project/data
```

> **Важно:** Используйте тот же `CLOUD_API_SECRET`, что и в Lua скрипте!

### 4. Развертывание

Нажмите **Create Web Service** и дождитесь завершения деплоя.

После успешного деплоя вы получите URL вида:
```
wss://curwe-cloudconfig-ws.onrender.com
```

## Локальная разработка

```bash
# Установка зависимостей
npm install

# Запуск
CLOUD_API_SECRET=your_secret_here npm start
```

## API

Все сообщения — JSON.

### Аутентификация

Каждый запрос должен содержать:
```json
{
  "request_id": 1,
  "action": "list",
  "token": "CLOUD_API_SECRET",
  "username": "NeverloseUsername"
}
```

### Действия

#### `list` — Получить список конфигов

```json
{
  "action": "list",
  "token": "...",
  "username": "PlayerName",
  "mine_only": false
}
```

Ответ:
```json
{
  "request_id": 1,
  "ok": true,
  "configs": [
    {
      "id": "abc123...",
      "name": "My Config",
      "nl_username": "PlayerName",
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z",
      "is_pinned": false,
      "name_color": "",
      "likes": 5,
      "liked": false
    }
  ]
}
```

#### `load` — Загрузить конфиг

```json
{
  "action": "load",
  "token": "...",
  "username": "PlayerName",
  "id": "abc123..."
}
```

#### `save` — Сохранить конфиг

```json
{
  "action": "save",
  "token": "...",
  "username": "PlayerName",
  "name": "My Config",
  "payload_b64": "base64_encoded_json...",
  "id": "optional_existing_id"
}
```

#### `delete` — Удалить конфиг

```json
{
  "action": "delete",
  "token": "...",
  "username": "PlayerName",
  "id": "abc123..."
}
```

#### `like` — Лайк/анлайк

```json
{
  "action": "like",
  "token": "...",
  "username": "PlayerName",
  "id": "abc123..."
}
```

## Хранение данных

Данные хранятся в JSON файлах:

```
data/
├── users/
│   ├── <hash>.json     # Конфиги пользователя
│   └── ...
└── likes.json          # Лайки
```

## Миграция с PHP

Этот сервер полностью повторяет функционал:
- `api/cloudconfig/list.php` → `action: list`
- `api/cloudconfig/load.php` → `action: load`
- `api/cloudconfig/save.php` → `action: save`
- `api/cloudconfig/delete.php` → `action: delete`
- `api/cloudconfig/like.php` → `action: like`
- `api/cloudconfig/meta.php` → `action: meta`
- `api/cloudconfig/admin_list.php` → `action: admin_list`
- `api/cloudconfig/admin_dump.php` → `action: admin_dump`

## Лицензия

MIT
