/**
 * Хранилище облачных конфигов для WebSocket сервера
 * Полный перенос логики из PHP cloudconfig_store.php
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');

// ============================================
// КОНФИГУРАЦИЯ
// ============================================

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const APPS_DIR = path.join(DATA_DIR, 'apps');

/**
 * Legacy layout (до разделения по app):
 *   DATA_DIR/users/*.json
 *   DATA_DIR/likes.json
 *
 * New layout:
 *   DATA_DIR/apps/<app>/users/*.json
 *   DATA_DIR/apps/<app>/likes.json
 */

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
 * Нормализация имени приложения/версии (namespace).
 * Примеры: "default", "dream"
 */
function sanitizeApp(raw) {
    if (typeof raw !== 'string') return 'default';
    const s = raw.trim().toLowerCase();
    if (s === '') return 'default';
    if (s.length > 32) return 'default';
    if (!/^[a-z0-9_\-]+$/.test(s)) return 'default';
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

function appPaths(app) {
    const a = sanitizeApp(app);

    if (a === 'default') {
        return {
            app: a,
            dataDir: DATA_DIR,
            usersDir: path.join(DATA_DIR, 'users'),
            likesFile: path.join(DATA_DIR, 'likes.json'),
            isLegacy: true
        };
    }

    const dir = path.join(APPS_DIR, a);
    return {
        app: a,
        dataDir: dir,
        usersDir: path.join(dir, 'users'),
        likesFile: path.join(dir, 'likes.json'),
        isLegacy: false
    };
}

/**
 * Путь к файлу пользователя
 */
function userFile(app, username) {
    const hash = userHash(username);
    return path.join(appPaths(app).usersDir, `${hash}.json`);
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

function ensureDirs(app = 'default') {
    const p = appPaths(app);

    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o750 });
    }
    if (!p.isLegacy && !fs.existsSync(APPS_DIR)) {
        fs.mkdirSync(APPS_DIR, { recursive: true, mode: 0o750 });
    }
    if (!fs.existsSync(p.dataDir)) {
        fs.mkdirSync(p.dataDir, { recursive: true, mode: 0o750 });
    }
    if (!fs.existsSync(p.usersDir)) {
        fs.mkdirSync(p.usersDir, { recursive: true, mode: 0o750 });
    }
}

// ============================================
// ЧТЕНИЕ/ЗАПИСЬ ПОЛЬЗОВАТЕЛЬСКИХ ДАННЫХ
// ============================================

/**
 * Чтение данных пользователя
 */
function readUserData(app, username) {
    ensureDirs(app);
    const filePath = userFile(app, username);
    
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
function writeUserData(app, username, data) {
    ensureDirs(app);
    const filePath = userFile(app, username);
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
    return readLikesForApp('default');
}

function readLikesForApp(app) {
    const p = appPaths(app);
    ensureDirs(p.app);

    if (!fs.existsSync(p.likesFile)) {
        return {};
    }
    
    try {
        const raw = fs.readFileSync(p.likesFile, 'utf8');
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
    writeLikesForApp('default', data);
}

function writeLikesForApp(app, data) {
    const p = appPaths(app);
    ensureDirs(p.app);
    const tmpPath = p.likesFile + '.tmp';
    const payload = JSON.stringify(data);
    fs.writeFileSync(tmpPath, payload, { encoding: 'utf8', mode: 0o640 });
    fs.renameSync(tmpPath, p.likesFile);
}

/**
 * Статистика лайков для конфига
 */
function likesStats(configId, viewerUsername) {
    return likesStatsForApp('default', configId, viewerUsername);
}

function likesStatsForApp(app, configId, viewerUsername) {
    if (!configId || !/^[a-f0-9]{32}$/.test(configId)) {
        return { count: 0, liked: false };
    }
    
    const all = readLikesForApp(app);
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
    return likeToggleForApp('default', configId, likerUsername);
}

function likeToggleForApp(app, configId, likerUsername) {
    if (!configId || !/^[a-f0-9]{32}$/.test(configId)) {
        return { ok: false, error: 'invalid_id' };
    }
    
    const liker = sanitizeUsername(likerUsername);
    if (!liker) {
        return { ok: false, error: 'invalid_username' };
    }
    
    const config = findPublicById(app, configId);
    if (!config) {
        return { ok: false, error: 'not_found' };
    }
    
    const owner = (config.nl_username || '').trim();
    if (owner !== '' && owner.toLowerCase() === liker.toLowerCase()) {
        return { ok: false, error: 'own_config' };
    }
    
    const all = readLikesForApp(app);
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
        writeLikesForApp(app, all);
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
    return enrichEntryLikesForApp('default', entry, viewerUsername);
}

function enrichEntryLikesForApp(app, entry, viewerUsername) {
    try {
        const id = entry.id || '';
        const stats = likesStatsForApp(app, id, viewerUsername);
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
    return listForUserApp('default', username);
}

function listForUserApp(app, username) {
    const data = readUserData(app, username);
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
    return listPublicApp('default');
}

function listPublicApp(app) {
    const p = appPaths(app);
    ensureDirs(p.app);
    const out = [];
    
    const files = fs.readdirSync(p.usersDir).filter(f => f.endsWith('.json'));
    
    for (const file of files) {
        const filePath = path.join(p.usersDir, file);
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
    return findByIdApp('default', username, id);
}

function findByIdApp(app, username, id) {
    const data = readUserData(app, username);
    
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
    return findPublicByIdApp('default', id);
}

function findPublicByIdApp(app, id) {
    if (!id || !/^[a-f0-9]{32}$/.test(id)) return null;
    
    const p = appPaths(app);
    ensureDirs(p.app);
    const files = fs.readdirSync(p.usersDir).filter(f => f.endsWith('.json'));
    
    for (const file of files) {
        const filePath = path.join(p.usersDir, file);
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
    return saveApp('default', username, name, payloadB64, existingId, isPinned, nameColor);
}

function saveApp(app, username, name, payloadB64, existingId = null, isPinned = null, nameColor = null) {
    const now = new Date().toISOString();
    const data = readUserData(app, username);
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
        
        writeUserData(app, username, { configs: configs.filter(c => c && typeof c === 'object') });
        
        const updated = findByIdApp(app, username, existingId);
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
    writeUserData(app, username, { configs: configs.filter(c => c && typeof c === 'object') });
    
    return listEntry(entry);
}

// ============================================
// УДАЛЕНИЕ КОНФИГА
// ============================================

/**
 * Удаление конфига
 */
function deleteConfig(username, id) {
    return deleteConfigApp('default', username, id);
}

function deleteConfigApp(app, username, id) {
    const data = readUserData(app, username);
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
        writeUserData(app, username, { configs: newList.filter(c => c && typeof c === 'object') });
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
    return setMetaApp('default', actorUsername, id, isPinned, nameColor);
}

function setMetaApp(app, actorUsername, id, isPinned, nameColor) {
    if (actorUsername.toLowerCase() !== 'luvv1337') {
        throw new Error('forbidden');
    }
    
    if (!id || !/^[a-f0-9]{32}$/.test(id)) {
        throw new Error('invalid_id');
    }
    
    const p = appPaths(app);
    ensureDirs(p.app);
    const files = fs.readdirSync(p.usersDir).filter(f => f.endsWith('.json'));
    
    for (const file of files) {
        const filePath = path.join(p.usersDir, file);
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
    return allByCreatorApp('default');
}

function allByCreatorApp(app) {
    const p = appPaths(app);
    ensureDirs(p.app);
    const out = {};
    
    const files = fs.readdirSync(p.usersDir).filter(f => f.endsWith('.json'));
    
    for (const file of files) {
        const base = file.replace('.json', '');
        const filePath = path.join(p.usersDir, file);
        
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
    return likesCountMapForApp('default');
}

function likesCountMapForApp(app) {
    const all = readLikesForApp(app);
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
    sanitizeApp,
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
    ensureDirs,

    // Multi-app API
    appPaths,
    listForUserApp,
    listPublicApp,
    enrichEntryLikesForApp,
    findByIdApp,
    findPublicByIdApp,
    saveApp,
    deleteConfigApp,
    setMetaApp,
    likesStatsForApp,
    likeToggleForApp,
    likesCountMapForApp,
    allByCreatorApp
};