/**
 * WebSocket сервер для облачных конфигов Neverlose
 * Полный перенос логики из PHP api/cloudconfig/*
 * 
 * Развертывание на Render.com:
 * 1. Создать новый Web Service
 * 2. Указать путь к этой папке
 * 3. Build command: npm install
 * 4. Start command: npm start
 */

const WebSocket = require('ws');
const http = require('http');
const crypto = require('crypto');
const store = require('./store');

// ============================================
// КОНФИГУРАЦИЯ
// ============================================

const PORT = parseInt(process.env.PORT || '3000', 10);
const API_SECRET = process.env.CLOUD_API_SECRET || '';
const ADMIN_SECRET = process.env.CLOUD_ADMIN_SECRET || '';

if (!API_SECRET || API_SECRET.length < 16) {
    console.error('[ERROR] CLOUD_API_SECRET not configured or too short');
    process.exit(1);
}

// ============================================
// HTTP СЕРВЕР (для health check на Render)
// ============================================

const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            status: 'ok', 
            service: 'curwe-cloudconfig-ws',
            timestamp: new Date().toISOString()
        }));
        return;
    }
    
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
});

// ============================================
// WEBSOCKET СЕРВЕР
// ============================================

const wss = new WebSocket.Server({ server });

// Хранилище активных соединений
const clients = new Map(); // ws => { username, authenticated }

// ============================================
// УТИЛИТЫ
// ============================================

function sendJson(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

function sendError(ws, requestId, error, code = 400) {
    sendJson(ws, {
        request_id: requestId,
        ok: false,
        error: error
    });
}

function sendSuccess(ws, requestId, data = {}) {
    sendJson(ws, {
        request_id: requestId,
        ok: true,
        ...data
    });
}

/**
 * Безопасное сравнение токенов (timing-safe)
 */
function verifyToken(provided) {
    if (!provided) return false;
    try {
        return crypto.timingSafeEqual(
            Buffer.from(API_SECRET, 'utf8'),
            Buffer.from(provided, 'utf8')
        );
    } catch (e) {
        return false;
    }
}

function verifyAdminToken(provided) {
    if (!ADMIN_SECRET || ADMIN_SECRET.length < 16) return false;
    if (!provided) return false;
    try {
        return crypto.timingSafeEqual(
            Buffer.from(ADMIN_SECRET, 'utf8'),
            Buffer.from(provided, 'utf8')
        );
    } catch (e) {
        return false;
    }
}

// ============================================
// ОБРАБОТКА ДЕЙСТВИЙ
// ============================================

const handlers = {
    /**
     * Список конфигов
     */
    list: (ws, data) => {
        const username = data.username || '';
        const sanitized = store.sanitizeUsername(username);
        
        if (!sanitized) {
            return { ok: false, error: 'invalid_username' };
        }
        
        const mineOnly = data.mine_only === true || data.mine_only === 1 || 
                        data.mine_only === '1' || data.mine_only === 'true';
        
        let list;
        if (mineOnly) {
            list = store.listForUser(sanitized);
        } else {
            list = store.listPublic();
        }
        
        // Добавляем данные о лайках
        list = list.map(entry => store.enrichEntryLikes(entry, sanitized));
        
        return { ok: true, configs: list };
    },
    
    /**
     * Загрузка конфига
     */
    load: (ws, data) => {
        const id = data.id || '';
        
        if (!id || !/^[a-f0-9]{32}$/.test(id)) {
            return { ok: false, error: 'invalid_id' };
        }
        
        const config = store.findPublicById(id);
        
        if (!config) {
            return { ok: false, error: 'not_found' };
        }
        
        return {
            ok: true,
            id: String(config.id || ''),
            name: String(config.name || ''),
            created_at: String(config.created_at || ''),
            updated_at: String(config.updated_at || ''),
            nl_username: String(config.nl_username || ''),
            is_pinned: Boolean(config.is_pinned),
            name_color: String(config.name_color || ''),
            payload_b64: String(config.payload_b64 || '')
        };
    },
    
    /**
     * Сохранение конфига
     */
    save: (ws, data) => {
        const username = store.sanitizeUsername(data.username || '');
        
        if (!username) {
            return { ok: false, error: 'invalid_username' };
        }
        
        const name = (data.name || '').trim();
        if (!name || name.length > 128) {
            return { ok: false, error: 'invalid_name' };
        }
        
        const payloadB64 = data.payload_b64 || '';
        if (!payloadB64 || typeof payloadB64 !== 'string') {
            return { ok: false, error: 'invalid_payload_b64' };
        }
        
        // Проверка base64
        if (!/^[A-Za-z0-9+/=]+$/.test(payloadB64.replace(/\s/g, ''))) {
            return { ok: false, error: 'invalid_payload_b64' };
        }
        
        const existingId = data.id || null;
        if (existingId && !/^[a-f0-9]{32}$/.test(existingId)) {
            return { ok: false, error: 'invalid_id' };
        }
        
        try {
            const meta = store.save(username, name, payloadB64, existingId);
            return { ok: true, config: meta };
        } catch (e) {
            if (e.message === 'forbidden') {
                return { ok: false, error: 'forbidden' };
            }
            if (e.message === 'config not found') {
                return { ok: false, error: 'not_found' };
            }
            return { ok: false, error: 'server_error' };
        }
    },
    
    /**
     * Удаление конфига
     */
    delete: (ws, data) => {
        const username = store.sanitizeUsername(data.username || '');
        
        if (!username) {
            return { ok: false, error: 'invalid_username' };
        }
        
        const id = data.id || '';
        if (!id || !/^[a-f0-9]{32}$/.test(id)) {
            return { ok: false, error: 'invalid_id' };
        }
        
        const result = store.deleteConfig(username, id);
        
        if (result.removed) {
            return { ok: true };
        }
        
        return { ok: false, error: result.error || 'not_found' };
    },
    
    /**
     * Лайк/анлайк
     */
    like: (ws, data) => {
        const username = store.sanitizeUsername(data.username || '');
        
        if (!username) {
            return { ok: false, error: 'invalid_username' };
        }
        
        const id = data.id || '';
        if (!id || !/^[a-f0-9]{32}$/.test(id)) {
            return { ok: false, error: 'invalid_id' };
        }
        
        const result = store.likeToggle(id, username);
        return result;
    },
    
    /**
     * Установка метаданных (только админ)
     */
    meta: (ws, data) => {
        const username = store.sanitizeUsername(data.username || '');
        
        if (!username) {
            return { ok: false, error: 'invalid_username' };
        }
        
        const id = data.id || '';
        if (!id || !/^[a-f0-9]{32}$/.test(id)) {
            return { ok: false, error: 'invalid_id' };
        }
        
        let isPinned = null;
        if (data.is_pinned !== undefined) {
            const v = String(data.is_pinned).toLowerCase().trim();
            isPinned = ['1', 'true', 'yes', 'on'].includes(v);
        }
        
        let nameColor = null;
        if (data.name_color !== undefined) {
            let v = String(data.name_color).toUpperCase().trim();
            if (v === '') {
                nameColor = '';
            } else {
                v = v.replace(/^#/, '');
                if (!/^[A-F0-9]{8}$/.test(v)) {
                    return { ok: false, error: 'invalid_name_color' };
                }
                nameColor = '#' + v;
            }
        }
        
        try {
            const meta = store.setMeta(username, id, isPinned, nameColor);
            if (!meta) {
                return { ok: false, error: 'not_found' };
            }
            return { ok: true, config: meta };
        } catch (e) {
            if (e.message === 'forbidden') {
                return { ok: false, error: 'forbidden' };
            }
            return { ok: false, error: 'server_error' };
        }
    },
    
    /**
     * Админ: список всех конфигов
     */
    admin_list: (ws, data) => {
        const all = store.allByCreator();
        const likesMap = store.likesCountMap();
        
        return { ok: true, configs_by_creator: all, likes: likesMap };
    },
    
    /**
     * Админ: дамп конфигов
     */
    admin_dump: (ws, data) => {
        const all = store.allByCreator();
        return { ok: true, dump: all };
    }
};

// ============================================
// ОБРАБОТКА СООБЩЕНИЙ
// ============================================

wss.on('connection', (ws, req) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    console.log(`[WS] New connection from ${clientIp}`);
    
    let authenticated = false;
    let username = null;
    
    ws.on('message', (message) => {
        let data;
        
        try {
            data = JSON.parse(message.toString());
        } catch (e) {
            sendJson(ws, { type: 'error', error: 'invalid_json' });
            return;
        }
        
        // Приветственное сообщение игнорируем
        if (data.type === 'welcome' || data.type === 'ping') {
            sendJson(ws, { type: 'pong' });
            return;
        }
        
        const requestId = data.request_id || 0;
        const action = data.action || '';
        const token = data.token || '';
        
        // Проверка токена для всех действий кроме ping
        if (!verifyToken(token)) {
            sendError(ws, requestId, 'unauthorized');
            return;
        }
        
        authenticated = true;
        username = store.sanitizeUsername(data.username || '');
        
        if (!username) {
            sendError(ws, requestId, 'invalid_username');
            return;
        }
        
        // Админские действия требуют отдельного токена
        if (action.startsWith('admin_')) {
            const adminToken = data.admin_token || '';
            if (!verifyAdminToken(adminToken)) {
                sendError(ws, requestId, 'admin_unauthorized');
                return;
            }
        }
        
        // Обработка действия
        const handler = handlers[action];
        if (!handler) {
            sendError(ws, requestId, 'unknown_action');
            return;
        }
        
        try {
            const result = handler(ws, data);
            sendJson(ws, {
                request_id: requestId,
                ...result
            });
        } catch (e) {
            console.error(`[WS] Handler error for action ${action}:`, e);
            sendError(ws, requestId, 'server_error');
        }
    });
    
    ws.on('close', () => {
        console.log(`[WS] Connection closed (user: ${username || 'not authed'})`);
    });
    
    ws.on('error', (error) => {
        console.error(`[WS] Error:`, error.message);
    });
    
    // Отправляем приветствие
    sendJson(ws, { 
        type: 'welcome', 
        message: 'Connected to Curwe CloudConfig WebSocket',
        timestamp: new Date().toISOString()
    });
});

// ============================================
// ЗАПУСК СЕРВЕРА
// ============================================

store.ensureDirs();

server.listen(PORT, () => {
    console.log(`[SERVER] Curwe CloudConfig WebSocket server started`);
    console.log(`[SERVER] Listening on port ${PORT}`);
    console.log(`[SERVER] Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('[SERVER] SIGTERM received, shutting down gracefully');
    wss.clients.forEach(client => client.close());
    server.close(() => {
        console.log('[SERVER] Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('[SERVER] SIGINT received, shutting down gracefully');
    wss.clients.forEach(client => client.close());
    server.close(() => {
        console.log('[SERVER] Server closed');
        process.exit(0);
    });
});
