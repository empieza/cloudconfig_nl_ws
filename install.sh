#!/bin/bash

# install.sh - Автоматическая установка на FirstVDS.ru

set -e

echo "==================================="
echo "Curwe CloudConfig WS Installation"
echo "==================================="

# Проверка прав
if [ "$EUID" -eq 0 ]; then 
    echo "Please run as regular user, not root"
    exit 1
fi

# 1. Обновление системы
echo "[1/8] Updating system..."
sudo apt update && sudo apt upgrade -y

# 2. Установка Node.js 20 LTS
echo "[2/8] Installing Node.js 20 LTS..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 3. Установка PM2 глобально
echo "[3/8] Installing PM2..."
sudo npm install -g pm2

# 4. Создание директорий
echo "[4/8] Creating directories..."
sudo mkdir -p /var/data/curwe-cloudconfig
sudo mkdir -p /var/log/curwe-cloudconfig
sudo chown -R $USER:$USER /var/data/curwe-cloudconfig
sudo chown -R $USER:$USER /var/log/curwe-cloudconfig

# 5. Установка зависимостей
echo "[5/8] Installing dependencies..."
npm install

# 6. Настройка .env
echo "[6/8] Configuring .env..."
if [ ! -f .env ]; then
    cp .env.example .env
    echo "⚠️  Please edit .env file and set your secrets!"
    echo "   Generate new secret: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    echo ""
    read -p "Press enter to continue after editing .env..."
    nano .env
fi

# 7. Настройка автозапуска PM2
echo "[7/8] Setting up PM2 startup..."
pm2 startup systemd | grep -v "sudo" | sed 's/sudo //g' | bash
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp /home/$USER

# 8. Запуск приложения
echo "[8/8] Starting application..."
pm2 start ecosystem.config.js
pm2 save

echo ""
echo "==================================="
echo "✅ Installation complete!"
echo "==================================="
echo ""
echo "Useful commands:"
echo "  npm run status   - Check status"
echo "  npm run logs     - View logs"
echo "  npm run restart  - Restart app"
echo "  npm run monit    - Monitor resources"
echo ""
echo "Health check: http://YOUR_IP:3000/health"
echo "==================================="