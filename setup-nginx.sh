#!/bin/bash

# setup-nginx.sh - Настройка Nginx как reverse proxy

echo "Setting up Nginx as reverse proxy..."

# Установка Nginx
sudo apt install -y nginx

# Создание конфига
sudo tee /etc/nginx/sites-available/curwe-cloudconfig > /dev/null <<EOF
server {
    listen 80;
    server_name _;  # Замените на ваш домен
    
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # Таймауты для WebSocket
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
        proxy_connect_timeout 60;
        
        # Буферизация
        proxy_buffering off;
        proxy_cache off;
    }
    
    # Health check endpoint
    location /health {
        proxy_pass http://127.0.0.1:3000/health;
        access_log off;
    }
    
    # Connection count endpoint
    location /connection_count {
        proxy_pass http://127.0.0.1:3000/connection_count;
        access_log off;
    }
}
EOF

# Активация сайта
sudo ln -sf /etc/nginx/sites-available/curwe-cloudconfig /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Проверка конфига
sudo nginx -t

# Перезапуск Nginx
sudo systemctl restart nginx

echo "✅ Nginx configured!"
echo "WebSocket available on port 80 (no port needed)"