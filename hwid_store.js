/**
 * Привязка Discord ↔ HWID (GameSense gethwid / get_hwid).
 * DATA_DIR/hwid_bindings/bindings.json
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const HWID_DIR = path.join(DATA_DIR, 'hwid_bindings');
const BINDINGS_FILE = path.join(HWID_DIR, 'bindings.json');
const LOCK_FILE = path.join(HWID_DIR, 'store.lock');

function ensureDirs() {
    if (!fs.existsSync(HWID_DIR)) {
        fs.mkdirSync(HWID_DIR, { recursive: true, mode: 0o750 });
    }
}

function hwidHash(normalizedHwid) {
    return crypto.createHash('sha256').update('curwe_hwid:' + normalizedHwid).digest('hex');
}

/**
 * Маска CRW-... или 24 hex (gethwid_raw).
 */
function sanitizeHwid(raw) {
    if (typeof raw !== 'string') return '';
    let s = raw.trim();
    if (/^HWID\s*:/i.test(s)) {
        s = s.replace(/^HWID\s*:\s*/i, '');
    }
    s = s.toUpperCase().replace(/\s+/g, '');
    if (s === '' || s.length > 256) return '';
    if (/^CRW-[A-Z0-9.]{6,240}$/.test(s)) return s;
    if (/^[A-F0-9]{24}$/.test(s)) return s;
    return '';
}

function sanitizeDiscordId(raw) {
    const s = String(raw || '').trim();
    if (!/^\d{17,20}$/.test(s)) return '';
    return s;
}

function sanitizeDiscordTag(raw) {
    const s = String(raw || '').trim();
    if (s === '' || s.length > 128) return '';
    return s.replace(/[\x00-\x1f]/g, '');
}

function withStoreLock(fn) {
    ensureDirs();
    const start = Date.now();
    let fd = null;
    while (Date.now() - start < 5000) {
        try {
            fd = fs.openSync(LOCK_FILE, 'wx');
            break;
        } catch {
            // wait
        }
    }
    if (!fd) {
        throw new Error('hwid lock timeout');
    }
    try {
        return fn();
    } finally {
        try {
            fs.closeSync(fd);
        } catch (_) {}
        try {
            fs.unlinkSync(LOCK_FILE);
        } catch (_) {}
    }
}

function loadBindings() {
    ensureDirs();
    if (!fs.existsSync(BINDINGS_FILE)) {
        return { by_discord: {}, by_hwid_hash: {} };
    }
    try {
        const raw = fs.readFileSync(BINDINGS_FILE, 'utf8');
        const j = JSON.parse(raw);
        if (!j || typeof j !== 'object') {
            return { by_discord: {}, by_hwid_hash: {} };
        }
        return {
            by_discord: j.by_discord && typeof j.by_discord === 'object' ? j.by_discord : {},
            by_hwid_hash: j.by_hwid_hash && typeof j.by_hwid_hash === 'object' ? j.by_hwid_hash : {},
        };
    } catch {
        return { by_discord: {}, by_hwid_hash: {} };
    }
}

function saveBindings(data) {
    ensureDirs();
    const tmp = BINDINGS_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
    fs.renameSync(tmp, BINDINGS_FILE);
}

/**
 * @returns {{ok:boolean, hwid?:string, discord_id?:string, discord_tag?:string, registered_at?:string, error?:string}}
 */
function register(discordIdRaw, discordTagRaw, hwidRaw) {
    const discordId = sanitizeDiscordId(discordIdRaw);
    const hwid = sanitizeHwid(hwidRaw);
    const discordTag = sanitizeDiscordTag(discordTagRaw);

    if (!discordId) {
        return { ok: false, error: 'invalid_discord_id' };
    }
    if (!hwid) {
        return { ok: false, error: 'invalid_hwid' };
    }

    const hash = hwidHash(hwid);
    const now = new Date().toISOString();

    return withStoreLock(() => {
        const data = loadBindings();
        const existingDiscord = data.by_discord[discordId];
        const existingHwidOwner = data.by_hwid_hash[hash];

        if (existingHwidOwner && existingHwidOwner !== discordId) {
            return { ok: false, error: 'hwid_taken' };
        }

        if (existingDiscord && existingDiscord.hwid && existingDiscord.hwid !== hwid) {
            const oldHash = hwidHash(existingDiscord.hwid);
            if (data.by_hwid_hash[oldHash] === discordId) {
                delete data.by_hwid_hash[oldHash];
            }
        }

        const row = {
            hwid,
            discord_id: discordId,
            discord_tag: discordTag,
            registered_at: existingDiscord && existingDiscord.registered_at ? existingDiscord.registered_at : now,
            updated_at: now,
        };

        data.by_discord[discordId] = row;
        data.by_hwid_hash[hash] = discordId;
        saveBindings(data);

        return {
            ok: true,
            hwid,
            discord_id: discordId,
            discord_tag: discordTag,
            registered_at: row.registered_at,
            updated: Boolean(existingDiscord),
        };
    });
}

/**
 * @returns {{ok:boolean, registered:boolean, discord_id?:string, error?:string}}
 */
function check(hwidRaw) {
    const hwid = sanitizeHwid(hwidRaw);
    if (!hwid) {
        return { ok: false, error: 'invalid_hwid' };
    }

    const hash = hwidHash(hwid);
    const data = loadBindings();
    const discordId = data.by_hwid_hash[hash];
    if (!discordId || !data.by_discord[discordId]) {
        return { ok: true, registered: false };
    }

    const row = data.by_discord[discordId];
    if (row.hwid !== hwid) {
        return { ok: true, registered: false };
    }

    return {
        ok: true,
        registered: true,
        discord_id: discordId,
        discord_tag: row.discord_tag || '',
        registered_at: row.registered_at || '',
    };
}

/**
 * @returns {{ok:boolean, bound?:boolean, hwid?:string, error?:string}}
 */
function statusByDiscord(discordIdRaw) {
    const discordId = sanitizeDiscordId(discordIdRaw);
    if (!discordId) {
        return { ok: false, error: 'invalid_discord_id' };
    }

    const data = loadBindings();
    const row = data.by_discord[discordId];
    if (!row || !row.hwid) {
        return { ok: true, bound: false };
    }

    return {
        ok: true,
        bound: true,
        hwid: row.hwid,
        registered_at: row.registered_at || '',
    };
}

function adminList() {
    const data = loadBindings();
    const rows = Object.values(data.by_discord)
        .filter((r) => r && r.hwid)
        .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
    return { ok: true, rows };
}

module.exports = {
    sanitizeHwid,
    sanitizeDiscordId,
    register,
    check,
    statusByDiscord,
    adminList,
    ensureDirs,
};
