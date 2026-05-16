/**
 * Хранилище облачных конфигов для WebSocket сервера
 * Полный перенос логики из PHP cloudconfig_store.php
 */

const fs = require('fs');
const path = require('path');

// ============================================
// КОНФИГУРАЦИЯ
// ============================================

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const USERS_DIR = path.join(DATA_DIR, 'users');
const LIKES_FILE = path.join(DATA_DIR, 'likes.json');

// ============================================
// УТИЛИТЫ
// ============================================

/**
 * Нормализация имени пользователя Neverlose (без path traversal)
 */
function sanitizeUsername(raw) {
    if (typeof raw !== 'string') return '';
    const s = raw.trim();
    if (s === '' || s.length > 64) return '';
    if (!/^[a-zA-Z0-9_\-\.]+$/.test(s)) return '';
    return s;
}

/**
 * Генерация уникального ID (32 hex символа)
 */
function generateId() {
    const { randomBytes } = require('crypto');
    return randomBytes(16).toString('hex');
}

/**
 * Хэш имени пользователя для имени файла
 */
function userHash(username) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update('nl:' + username.toLowerCase()).digest('hex');
}

/**
 * Путь к файлу пользователя
 */
function userFile(username) {
    const hash = userHash(username);
    return path.join(USERS_DIR, `${hash}.json`);
}

/**
 * Проверка принадлежности конфига пользователю
 */
function entryOwnedByUser(config, requestUsername) {
    const stored = (config.nl_username || '').trim();
    if (stored === '') return true;
    return stored.toLowerCase() === requestUsername.toLowerCase();
}

// ============================================
// РАБОТА С ДИРЕКТОРИЯМИ
// ============================================

function ensureDirs() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o750 });
    }
    if (!fs.existsSync(USERS_DIR)) {
        fs.mkdirSync(USERS_DIR, { recursive: true, mode: 0o750 });
    }
}

// ============================================
// ЧТЕНИЕ/ЗАПИСЬ ПОЛЬЗОВАТЕЛЬСКИХ ДАННЫХ
// ============================================

/**
 * Чтение данных пользователя
 */
function readUserData(username) {
    ensureDirs();
    const filePath = userFile(username);
    
    if (!fs.existsSync(filePath)) {
        return { configs: [] };
    }
    
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        if (!raw || raw.trim() === '') {
            return { configs: [] };
        }
        const data = JSON.parse(raw);
        if (!data || !Array.isArray(data.configs)) {
            return { configs: [] };
        }
        return { configs: data.configs };
    } catch (e) {
        return { configs: [] };
    }
}

/**
 * Запись данных пользователя
 */
function writeUserData(username, data) {
    ensureDirs();
    const filePath = userFile(username);
    const tmpPath = filePath + '.tmp';
    
    const payload = JSON.stringify(data, null, 0);
    fs.writeFileSync(tmpPath, payload, { encoding: 'utf8', mode: 0o640 });
    fs.renameSync(tmpPath, filePath);
}

// ============================================
// РАБОТА С ЛАЙКАМИ
// ============================================

/**
 * Чтение файла лайков
 * @returns {Object.<string, string[]>} configId => [usernames]
 */
function readLikes() {
    ensureDirs();
    
    if (!fs.existsSync(LIKES_FILE)) {
        return {};
    }
    
    try {
        const raw = fs.readFileSync(LIKES_FILE, 'utf8');
        if (!raw || raw.trim() === '') {
            return {};
        }
        const data = JSON.parse(raw);
        if (typeof data !== 'object' || data === null) {
            return {};
        }
        
        const out = {};
        for (const [cid, users] of Object.entries(data)) {
            if (typeof cid !== 'string' || !/^[a-f0-9]{32}$/.test(cid)) continue;
            if (!Array.isArray(users)) continue;
            
            const norm = {};
            for (const u of users) {
                if (typeof u !== 'string') continue;
                const normalized = u.toLowerCase().trim();
                if (normalized !== '' && normalized.length <= 64) {
                    norm[normalized] = normalized;
                }
            }
            if (Object.keys(norm).length > 0) {
                out[cid] = Object.values(norm);
            }
        }
        
        return out;
    } catch (e) {
        return {};
    }
}

/**
 * Запись файла лайков
 */
function writeLikes(data) {
    ensureDirs();
    const tmpPath = LIKES_FILE + '.tmp';
    const payload = JSON.stringify(data);
    fs.writeFileSync(tmpPath, payload, { encoding: 'utf8', mode: 0o640 });
    fs.renameSync(tmpPath, LIKES_FILE);
}

/**
 * Статистика лайков для конфига
 */
function likesStats(configId, viewerUsername) {
    if (!configId || !/^[a-f0-9]{32}$/.test(configId)) {
        return { count: 0, liked: false };
    }
    
    const all = readLikes();
    const users = all[configId] || [];
    const viewer = viewerUsername.toLowerCase().trim();
    
    return {
        count: users.length,
        liked: viewer !== '' && users.includes(viewer)
    };
}

/**
 * Переключение лайка
 */
function likeToggle(configId, likerUsername) {
    if (!configId || !/^[a-f0-9]{32}$/.test(configId)) {
        return { ok: false, error: 'invalid_id' };
    }
    
    const liker = sanitizeUsername(likerUsername);
    if (!liker) {
        return { ok: false, error: 'invalid_username' };
    }
    
    const config = findPublicById(configId);
    if (!config) {
        return { ok: false, error: 'not_found' };
    }
    
    const owner = (config.nl_username || '').trim();
    if (owner !== '' && owner.toLowerCase() === liker.toLowerCase()) {
        return { ok: false, error: 'own_config' };
    }
    
    const all = readLikes();
    let list = all[configId] || [];
    
    // Фильтруем пустые значения
    list = list.filter(u => typeof u === 'string' && u !== '');
    
    const lk = liker.toLowerCase();
    const wasLiked = list.includes(lk);
    
    if (wasLiked) {
        list = list.filter(u => u !== lk);
    } else {
        list.push(lk);
    }
    
    if (list.length === 0) {
        delete all[configId];
    } else {
        all[configId] = list;
    }
    
    try {
        writeLikes(all);
    } catch (e) {
        return { ok: false, error: 'server_error' };
    }
    
    return {
        ok: true,
        likes: list.length,
        liked: !wasLiked
    };
}

// ============================================
// СПИСКИ КОНФИГОВ
// ============================================

/**
 * Публичные поля для списка (без payload_b64)
 */
function listEntry(config) {
    return {
        id: String(config.id || ''),
        name: String(config.name || ''),
        created_at: String(config.created_at || ''),
        updated_at: String(config.updated_at || ''),
        nl_username: String(config.nl_username || ''),
        is_pinned: Boolean(config.is_pinned),
        name_color: String(config.name_color || '')
    };
}

/**
 * Добавление данных о лайках в запись
 */
function enrichEntryLikes(entry, viewerUsername) {
    try {
        const id = entry.id || '';
        const stats = likesStats(id, viewerUsername);
        entry.likes = stats.count;
        entry.liked = stats.liked;
    } catch (e) {
        entry.likes = 0;
        entry.liked = false;
    }
    return entry;
}

/**
 * Список конфигов пользователя
 */
function listForUser(username) {
    const data = readUserData(username);
    const out = [];
    
    for (const c of data.configs) {
        if (!c || typeof c !== 'object') continue;
        if (!entryOwnedByUser(c, username)) continue;
        out.push(listEntry(c));
    }
    
    // Сортировка: pinned первыми, потом по updated_at DESC
    out.sort((a, b) => {
        const ap = Boolean(a.is_pinned);
        const bp = Boolean(b.is_pinned);
        if (ap !== bp) return ap ? -1 : 1;
        
        const at = a.updated_at || '';
        const bt = b.updated_at || '';
        if (at === bt) return (a.name || '').localeCompare(b.name || '');
        return bt.localeCompare(at);
    });
    
    return out;
}

/**
 * Публичный список всех конфигов
 */
function listPublic() {
    ensureDirs();
    const out = [];
    
    const files = fs.readdirSync(USERS_DIR).filter(f => f.endsWith('.json'));
    
    for (const file of files) {
        const filePath = path.join(USERS_DIR, file);
        try {
            const raw = fs.readFileSync(filePath, 'utf8');
            if (!raw || raw.trim() === '') continue;
            
            const data = JSON.parse(raw);
            if (!data || !Array.isArray(data.configs)) continue;
            
            for (const c of data.configs) {
                if (!c || typeof c !== 'object') continue;
                const entry = listEntry(c);
                if (!entry.id) continue;
                out.push(entry);
            }
        } catch (e) {
            continue;
        }
    }
    
    // Сортировка
    out.sort((a, b) => {
        const ap = Boolean(a.is_pinned);
        const bp = Boolean(b.is_pinned);
        if (ap !== bp) return ap ? -1 : 1;
        
        const at = a.updated_at || '';
        const bt = b.updated_at || '';
        if (at === bt) return (a.name || '').localeCompare(b.name || '');
        return bt.localeCompare(at);
    });
    
    return out;
}

// ============================================
// ПОИСК КОНФИГОВ
// ============================================

/**
 * Найти конфиг по ID для пользователя
 */
function findById(username, id) {
    const data = readUserData(username);
    
    for (const c of data.configs) {
        if (!c || typeof c !== 'object') continue;
        if ((c.id || '') === id) {
            if (!entryOwnedByUser(c, username)) return null;
            return c;
        }
    }
    
    return null;
}

/**
 * Найти конфиг по ID среди всех пользователей
 */
function findPublicById(id) {
    if (!id || !/^[a-f0-9]{32}$/.test(id)) return null;
    
    ensureDirs();
    const files = fs.readdirSync(USERS_DIR).filter(f => f.endsWith('.json'));
    
    for (const file of files) {
        const filePath = path.join(USERS_DIR, file);
        try {
            const raw = fs.readFileSync(filePath, 'utf8');
            if (!raw || raw.trim() === '') continue;
            
            const data = JSON.parse(raw);
            if (!data || !Array.isArray(data.configs)) continue;
            
            for (const c of data.configs) {
                if (!c || typeof c !== 'object') continue;
                if ((c.id || '') === id) {
                    return c;
                }
            }
        } catch (e) {
            continue;
        }
    }
    
    return null;
}

// ============================================
// СОХРАНЕНИЕ КОНФИГА
// ============================================

/**
 * Сохранение конфига (создание или обновление)
 */
function save(username, name, payloadB64, existingId = null, isPinned = null, nameColor = null) {
    const now = new Date().toISOString();
    const data = readUserData(username);
    let configs = data.configs;
    
    // Обновление существующего
    if (existingId && existingId !== '') {
        let found = false;
        
        for (let i = 0; i < configs.length; i++) {
            const c = configs[i];
            if (!c || typeof c !== 'object') continue;
            
            if ((c.id || '') === existingId) {
                if (!entryOwnedByUser(c, username)) {
                    throw new Error('forbidden');
                }
                
                configs[i] = {
                    ...c,
                    name: name,
                    payload_b64: payloadB64,
                    updated_at: now,
                    nl_username: username,
                    is_pinned: isPinned !== null ? isPinned : c.is_pinned,
                    name_color: nameColor !== null ? nameColor : c.name_color
                };
                found = true;
                break;
            }
        }
        
        if (!found) {
            throw new Error('config not found');
        }
        
        writeUserData(username, { configs: configs.filter(c => c && typeof c === 'object') });
        
        const updated = findById(username, existingId);
        return updated ? listEntry(updated) : {};
    }
    
    // Создание нового
    const entry = {
        id: generateId(),
        name: name,
        nl_username: username,
        created_at: now,
        updated_at: now,
        payload_b64: payloadB64,
        is_pinned: isPinned !== null ? isPinned : false,
        name_color: nameColor !== null ? nameColor : ''
    };
    
    configs.push(entry);
    writeUserData(username, { configs: configs.filter(c => c && typeof c === 'object') });
    
    return listEntry(entry);
}

// ============================================
// УДАЛЕНИЕ КОНФИГА
// ============================================

/**
 * Удаление конфига
 */
function deleteConfig(username, id) {
    const data = readUserData(username);
    const configs = data.configs;
    const newList = [];
    let removed = false;
    
    for (const c of configs) {
        if (!c || typeof c !== 'object') {
            newList.push(c);
            continue;
        }
        
        if ((c.id || '') === id) {
            if (!entryOwnedByUser(c, username)) {
                return { removed: false, error: 'forbidden' };
            }
            removed = true;
            continue;
        }
        
        newList.push(c);
    }
    
    if (removed) {
        writeUserData(username, { configs: newList.filter(c => c && typeof c === 'object') });
        return { removed: true };
    }
    
    return { removed: false, error: 'not_found' };
}

// ============================================
// МЕТАДАННЫЕ (АДМИН)
// ============================================

/**
 * Установка метаданных (только для Luvv1337)
 */
function setMeta(actorUsername, id, isPinned, nameColor) {
    if (actorUsername.toLowerCase() !== 'luvv1337') {
        throw new Error('forbidden');
    }
    
    if (!id || !/^[a-f0-9]{32}$/.test(id)) {
        throw new Error('invalid_id');
    }
    
    ensureDirs();
    const files = fs.readdirSync(USERS_DIR).filter(f => f.endsWith('.json'));
    
    for (const file of files) {
        const filePath = path.join(USERS_DIR, file);
        try {
            const raw = fs.readFileSync(filePath, 'utf8');
            if (!raw || raw.trim() === '') continue;
            
            const data = JSON.parse(raw);
            if (!data || !Array.isArray(data.configs)) continue;
            
            const configs = data.configs;
            let foundIdx = -1;
            
            for (let i = 0; i < configs.length; i++) {
                if ((configs[i].id || '') === id) {
                    foundIdx = i;
                    break;
                }
            }
            
            if (foundIdx < 0) continue;
            
            if (isPinned !== null) {
                configs[foundIdx].is_pinned = isPinned;
            }
            if (nameColor !== null) {
                configs[foundIdx].name_color = nameColor;
            }
            configs[foundIdx].updated_at = new Date().toISOString();
            
            data.configs = configs.filter(c => c && typeof c === 'object');
            writeUserDataRaw(filePath, data);
            
            return listEntry(configs[foundIdx]);
        } catch (e) {
            continue;
        }
    }
    
    return null;
}

/**
 * Прямая запись в файл (для setMeta)
 */
function writeUserDataRaw(filePath, data) {
    const tmpPath = filePath + '.tmp';
    const payload = JSON.stringify(data);
    fs.writeFileSync(tmpPath, payload, { encoding: 'utf8', mode: 0o640 });
    fs.renameSync(tmpPath, filePath);
}

// ============================================
// АДМИН: ДАМП ВСЕХ КОНФИГОВ
// ============================================

/**
 * Все конфиги, сгруппированные по создателю
 */
function allByCreator() {
    ensureDirs();
    const out = {};
    
    const files = fs.readdirSync(USERS_DIR).filter(f => f.endsWith('.json'));
    
    for (const file of files) {
        const base = file.replace('.json', '');
        const filePath = path.join(USERS_DIR, file);
        
        try {
            const raw = fs.readFileSync(filePath, 'utf8');
            if (!raw || raw.trim() === '') continue;
            
            const data = JSON.parse(raw);
            if (!data || !Array.isArray(data.configs)) continue;
            
            let nick = null;
            for (const c of data.configs) {
                if (c && c.nl_username && c.nl_username.trim() !== '') {
                    nick = c.nl_username;
                    break;
                }
            }
            
            if (!nick) {
                nick = '_unknown_' + base.substring(0, 12);
            }
            
            if (!out[nick]) {
                out[nick] = { configs: [] };
            }
            
            for (const c of data.configs) {
                if (c && typeof c === 'object') {
                    out[nick].configs.push(c);
                }
            }
        } catch (e) {
            continue;
        }
    }
    
    // Сортировка ключей
    const sorted = {};
    for (const key of Object.keys(out).sort()) {
        sorted[key] = out[key];
    }
    
    return sorted;
}

/**
 * Карта количества лайков
 */
function likesCountMap() {
    const all = readLikes();
    const out = {};
    
    for (const [cid, users] of Object.entries(all)) {
        if (!/^[a-f0-9]{32}$/.test(cid)) continue;
        if (!Array.isArray(users)) continue;
        out[cid] = users.length;
    }
    
    return out;
}

// ============================================
// ЭКСПОРТ
// ============================================

module.exports = {
    // Утилиты
    sanitizeUsername,
    generateId,
    
    // Списки
    listForUser,
    listPublic,
    listEntry,
    enrichEntryLikes,
    
    // Поиск
    findById,
    findPublicById,
    
    // CRUD
    save,
    deleteConfig,
    setMeta,
    
    // Лайки
    likesStats,
    likeToggle,
    likesCountMap,
    
    // Админ
    allByCreator,
    
    // Инициализация
    ensureDirs
};
