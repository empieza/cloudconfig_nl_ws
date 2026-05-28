/**
 * Neverlose → Discord verification codes (per script app: default/old, dream).
 * DATA_DIR/verify_keys/permanent_codes.json
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sanitizeApp } = require('./store');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const VERIFY_DIR = path.join(DATA_DIR, 'verify_keys');
const PERMANENT_FILE = path.join(VERIFY_DIR, 'permanent_codes.json');
const RATELIMIT_FILE = path.join(VERIFY_DIR, 'ratelimit.json');
const LOCK_FILE = path.join(VERIFY_DIR, 'store.lock');

const CODE_LENGTH = Math.max(8, Math.min(32, parseInt(process.env.VERIFY_CODE_LENGTH || '16', 10)));
const MAX_GEN_PER_WINDOW = Math.max(1, Math.min(20, parseInt(process.env.VERIFY_GENERATE_PER_15M || '5', 10)));
const RATE_WINDOW_SEC = 900;

function ensureDirs() {
    if (!fs.existsSync(VERIFY_DIR)) {
        fs.mkdirSync(VERIFY_DIR, { recursive: true, mode: 0o750 });
    }
}

/**
 * "old" → default (legacy cloud namespace), "dream" → dream
 */
function sanitizeVerifyApp(raw) {
    if (typeof raw !== 'string') return 'default';
    const s = raw.trim().toLowerCase();
    if (s === 'old' || s === '' || s === 'default') return 'default';
    if (s === 'dream') return 'dream';
    return sanitizeApp(s);
}

function sanitizeUsername(raw) {
    if (typeof raw !== 'string') return '';
    const s = raw.trim();
    if (s === '' || s.length > 64) return '';
    if (!/^[\p{L}\p{N}._-]+$/u.test(s)) return '';
    return s;
}

function nlStorageKey(sanitizedNl) {
    return sanitizedNl.toLowerCase();
}

function entryKey(sanitizedNl, app) {
    return `${nlStorageKey(sanitizedNl)}:${sanitizeVerifyApp(app)}`;
}

function normalizeCode(raw) {
    const s = String(raw || '').replace(/[^a-zA-Z0-9]/g, '');
    return s.toUpperCase();
}

function randomCode(len) {
    const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const bytes = crypto.randomBytes(len);
    let out = '';
    for (let i = 0; i < len; i++) {
        out += alphabet[bytes[i] % alphabet.length];
    }
    return out;
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
            // busy wait
        }
    }
    if (!fd) {
        throw new Error('verify lock timeout');
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

function loadPermanent() {
    ensureDirs();
    if (!fs.existsSync(PERMANENT_FILE)) {
        return { by_nl: {} };
    }
    try {
        const raw = fs.readFileSync(PERMANENT_FILE, 'utf8');
        if (!raw || raw.trim() === '') return { by_nl: {} };
        const j = JSON.parse(raw);
        if (!j || typeof j !== 'object' || !j.by_nl || typeof j.by_nl !== 'object') {
            return { by_nl: {} };
        }
        const out = {};
        for (const [k, v] of Object.entries(j.by_nl)) {
            if (typeof k !== 'string') continue;
            if (k.includes(':')) {
                const row = normalizeRow(v, k.split(':').pop());
                if (row) out[k] = row;
                continue;
            }
            // legacy PHP: ключ = nl без app → default
            const row = normalizeRow(v, 'default');
            if (row) {
                out[entryKey(k, 'default')] = row;
            }
        }
        return { by_nl: out };
    } catch {
        return { by_nl: {} };
    }
}

function normalizeRow(v, appHint) {
    if (typeof v === 'string') {
        return { code: v, label: '', app: sanitizeVerifyApp(appHint) };
    }
    if (!v || typeof v !== 'object' || typeof v.code !== 'string') {
        return null;
    }
    return {
        code: String(v.code),
        label: typeof v.label === 'string' && v.label !== '' ? v.label : '',
        app: sanitizeVerifyApp(v.app || appHint || 'default'),
    };
}

function savePermanent(data) {
    ensureDirs();
    const tmp = PERMANENT_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
    fs.renameSync(tmp, PERMANENT_FILE);
}

function loadRatelimit() {
    ensureDirs();
    if (!fs.existsSync(RATELIMIT_FILE)) return {};
    try {
        const raw = fs.readFileSync(RATELIMIT_FILE, 'utf8');
        const j = JSON.parse(raw);
        return j && typeof j === 'object' ? j : {};
    } catch {
        return {};
    }
}

function saveRatelimit(data) {
    ensureDirs();
    fs.writeFileSync(RATELIMIT_FILE, JSON.stringify(data), 'utf8');
}

function checkRatelimit(nlUsername) {
    const key = crypto.createHash('sha256').update('rl:' + nlUsername.toLowerCase()).digest('hex');
    const now = Math.floor(Date.now() / 1000);
    const data = loadRatelimit();
    if (!data[key] || !Array.isArray(data[key])) {
        data[key] = [];
    }
    const ts = data[key].filter((t) => typeof t === 'number' && t > now - RATE_WINDOW_SEC);
    if (ts.length >= MAX_GEN_PER_WINDOW) {
        return { ok: false };
    }
    return { ok: true };
}

function bumpRatelimit(nlUsername) {
    const key = crypto.createHash('sha256').update('rl:' + nlUsername.toLowerCase()).digest('hex');
    const now = Math.floor(Date.now() / 1000);
    const data = loadRatelimit();
    if (!data[key] || !Array.isArray(data[key])) {
        data[key] = [];
    }
    data[key].push(now);
    const cut = now - 86400;
    data[key] = data[key].filter((t) => t > cut).slice(-50);
    saveRatelimit(data);
}

/**
 * @returns {{ok:boolean, code?:string, permanent?:boolean, app?:string, expires_in?:number, error?:string}}
 */
function generateForUser(nlUsername, appRaw) {
    const nl = sanitizeUsername(nlUsername);
    if (!nl) {
        return { ok: false, error: 'bad_username' };
    }
    const app = sanitizeVerifyApp(appRaw);
    const len = CODE_LENGTH;
    const key = entryKey(nl, app);

    return withStoreLock(() => {
        const data = loadPermanent();
        if (data.by_nl[key]) {
            const row = data.by_nl[key];
            const existing = String(row.code || '');
            if (existing.length === len) {
                return {
                    ok: true,
                    code: existing,
                    permanent: true,
                    app,
                    expires_in: 0,
                    expires_at: null,
                };
            }
        }

        const rl = checkRatelimit(nl);
        if (!rl.ok) {
            return { ok: false, error: 'rate_limited' };
        }

        const used = new Set();
        for (const row of Object.values(data.by_nl)) {
            if (row && row.code) {
                used.add(String(row.code).toUpperCase());
            }
        }

        let code = '';
        for (let attempt = 0; attempt < 20; attempt++) {
            const candidate = randomCode(len);
            if (!used.has(candidate)) {
                code = candidate;
                break;
            }
        }
        if (!code) {
            return { ok: false, error: 'server_error' };
        }

        if (Object.keys(data.by_nl).length >= 50000) {
            return { ok: false, error: 'server_error' };
        }

        data.by_nl[key] = { code, label: nl, app };
        savePermanent(data);
        bumpRatelimit(nl);

        return {
            ok: true,
            code,
            permanent: true,
            app,
            expires_in: 0,
            expires_at: null,
        };
    });
}

/**
 * @returns {{ok:boolean, nl?:string, app?:string, exp?:number, error?:string}}
 */
function consumeCode(plainCode) {
    const code = normalizeCode(plainCode);
    const len = CODE_LENGTH;
    if (code.length !== len) {
        return { ok: false, error: 'invalid_code' };
    }

    return withStoreLock(() => {
        const data = loadPermanent();
        for (const row of Object.values(data.by_nl)) {
            if (!row || !row.code) continue;
            const stored = String(row.code);
            if (stored.length !== len) continue;
            if (crypto.timingSafeEqual(Buffer.from(stored.toUpperCase()), Buffer.from(code))) {
                return {
                    ok: true,
                    nl: row.label || '',
                    app: sanitizeVerifyApp(row.app || 'default'),
                    exp: 2147483647,
                };
            }
        }
        return { ok: false, error: 'not_found' };
    });
}

function codeLength() {
    return CODE_LENGTH;
}

module.exports = {
    sanitizeVerifyApp,
    sanitizeUsername,
    generateForUser,
    consumeCode,
    codeLength,
    ensureDirs,
};
