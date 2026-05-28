/**
 * Leaderboard storage (per app namespace: default, dream, …)
 * DATA_DIR/apps/<app>/leaderboard/players.json
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sanitizeApp } = require('./store');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ONLINE_TTL_MS = Math.max(10000, Math.min(parseInt(process.env.SCRIPT_ONLINE_TTL_MS || '60000', 10), 600000));

function lbDir(app) {
    const a = sanitizeApp(app);
    if (a === 'default') {
        return path.join(DATA_DIR, 'leaderboard');
    }
    return path.join(DATA_DIR, 'apps', a, 'leaderboard');
}

function lbFile(app) {
    return path.join(lbDir(app), 'players.json');
}

function ensureDirs(app) {
    const dir = lbDir(app);
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o750 });
    }
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
    }
}

function sanitizeUsername(raw) {
    if (typeof raw !== 'string') return '';
    const s = raw.trim();
    if (s === '' || s.length > 64) return '';
    if (!/^[a-zA-Z0-9_\-\.]+$/.test(s)) return '';
    return s;
}

function userKey(username) {
    return crypto.createHash('sha256').update('lb:' + username.toLowerCase()).digest('hex');
}

function defaultPlayer(username) {
    const now = Date.now();
    return {
        username,
        points: 0,
        kills_head: 0,
        kills_body: 0,
        kills_zeus: 0,
        kills_knife: 0,
        time_spent_sec: 0,
        last_seen_ms: now,
        updated_at: new Date(now).toISOString(),
    };
}

function readAll(app) {
    ensureDirs(app);
    const file = lbFile(app);
    if (!fs.existsSync(file)) {
        return { players: {} };
    }
    try {
        const raw = fs.readFileSync(file, 'utf8');
        if (!raw || raw.trim() === '') return { players: {} };
        const data = JSON.parse(raw);
        if (!data || typeof data !== 'object') return { players: {} };
        if (!data.players || typeof data.players !== 'object') return { players: {} };
        return { players: data.players };
    } catch {
        return { players: {} };
    }
}

function writeAll(app, data) {
    ensureDirs(app);
    const file = lbFile(app);
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 0), { encoding: 'utf8', mode: 0o640 });
    fs.renameSync(tmp, file);
}

function clampInt(n, min, max) {
    n = Math.floor(Number(n) || 0);
    if (n < min) return min;
    if (n > max) return max;
    return n;
}

/**
 * Merge client delta (anti-abuse caps per sync).
 */
function applySync(app, username, delta, pingOnline) {
    const u = sanitizeUsername(username);
    if (!u) {
        return { ok: false, error: 'invalid_username' };
    }

    const d = delta && typeof delta === 'object' ? delta : {};
    const addPoints = clampInt(d.points, 0, 500);
    const addHead = clampInt(d.kills_head, 0, 100);
    const addBody = clampInt(d.kills_body, 0, 100);
    const addZeus = clampInt(d.kills_zeus, 0, 50);
    const addKnife = clampInt(d.kills_knife, 0, 50);
    const addTime = clampInt(d.time_spent_sec, 0, 4000);

    const data = readAll(app);
    const key = userKey(u);
    const row = data.players[key] ? { ...data.players[key] } : defaultPlayer(u);

    row.username = u;
    row.points = clampInt(row.points, 0, 999999999) + addPoints;
    row.kills_head = clampInt(row.kills_head, 0, 9999999) + addHead;
    row.kills_body = clampInt(row.kills_body, 0, 9999999) + addBody;
    row.kills_zeus = clampInt(row.kills_zeus, 0, 9999999) + addZeus;
    row.kills_knife = clampInt(row.kills_knife, 0, 9999999) + addKnife;
    row.time_spent_sec = clampInt(row.time_spent_sec, 0, 999999999) + addTime;

    const now = Date.now();
    if (pingOnline !== false) {
        row.last_seen_ms = now;
    }
    row.updated_at = new Date(now).toISOString();

    data.players[key] = row;
    writeAll(app, data);

    return { ok: true, player: publicRow(row, 0, now) };
}

function isOnline(lastSeenMs, nowMs) {
    const last = parseInt(lastSeenMs, 10) || 0;
    return nowMs - last <= ONLINE_TTL_MS;
}

function publicRow(row, rank, nowMs) {
    return {
        rank,
        username: String(row.username || ''),
        points: clampInt(row.points, 0, 999999999),
        kills_head: clampInt(row.kills_head, 0, 9999999),
        kills_body: clampInt(row.kills_body, 0, 9999999),
        kills_zeus: clampInt(row.kills_zeus, 0, 9999999),
        kills_knife: clampInt(row.kills_knife, 0, 9999999),
        time_spent_sec: clampInt(row.time_spent_sec, 0, 999999999),
        online: isOnline(row.last_seen_ms, nowMs),
        last_seen_ms: parseInt(row.last_seen_ms, 10) || 0,
        updated_at: String(row.updated_at || ''),
    };
}

function listTop(app, page, perPage) {
    const a = sanitizeApp(app);
    page = Math.max(1, parseInt(page, 10) || 1);
    perPage = Math.max(1, Math.min(50, parseInt(perPage, 10) || 20));

    const data = readAll(a);
    const now = Date.now();
    const rows = [];

    for (const row of Object.values(data.players)) {
        if (!row || typeof row !== 'object') continue;
        if (!row.username) continue;
        rows.push(row);
    }

    rows.sort((x, y) => {
        const px = clampInt(x.points, 0, 999999999);
        const py = clampInt(y.points, 0, 999999999);
        if (py !== px) return py - px;
        return String(x.username).localeCompare(String(y.username));
    });

    const total = rows.length;
    const pages = Math.max(1, Math.ceil(total / perPage));
    const safePage = Math.min(page, pages);
    const start = (safePage - 1) * perPage;
    const slice = rows.slice(start, start + perPage);

    const out = slice.map((row, i) => publicRow(row, start + i + 1, now));

    return {
        ok: true,
        app: a,
        total,
        page: safePage,
        per_page: perPage,
        pages,
        rows: out,
        ttl_ms: ONLINE_TTL_MS,
    };
}

function listTopForLua(app, limit) {
    const r = listTop(app, 1, Math.max(1, Math.min(30, limit || 15)));
    return {
        ok: true,
        app: r.app,
        rows: r.rows,
    };
}

/**
 * Полный сброс leaderboard для одного app (players.json).
 */
function resetApp(app) {
    const a = sanitizeApp(app);
    writeAll(a, { players: {} });
    return { ok: true, app: a, cleared: true };
}

/**
 * Сброс default + всех app в DATA_DIR/apps/
 */
function resetAll() {
    const cleared = [];
    resetApp('default');
    cleared.push('default');

    const appsRoot = path.join(DATA_DIR, 'apps');
    if (fs.existsSync(appsRoot)) {
        for (const name of fs.readdirSync(appsRoot)) {
            if (!name || name.startsWith('.')) continue;
            const lb = path.join(appsRoot, name, 'leaderboard');
            if (!fs.existsSync(lb)) continue;
            try {
                resetApp(name);
                cleared.push(name);
            } catch (e) {
                // skip broken dirs
            }
        }
    }

    return { ok: true, app: 'all', cleared_apps: cleared };
}

module.exports = {
    sanitizeUsername,
    applySync,
    listTop,
    listTopForLua,
    resetApp,
    resetAll,
    ONLINE_TTL_MS,
};
