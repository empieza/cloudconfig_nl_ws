# Curwe CloudConfig WebSocket Server

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