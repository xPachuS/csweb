/**
 * Clutch · Pick'em de los Majors de Counter-Strike — Cloudflare Worker + D1
 *
 * Variables del Worker (Settings → Variables and Secrets):
 *   SITE_URL   dirección de la web (GitHub Pages), p. ej. https://usuario.github.io/clutch
 *              — de ahí lee data/majors/*.json y es el único origen al que deja hablar (más localhost)
 *   ADMINS     apodos de los administradores separados por comas, p. ej. "Pachus"
 * Enlace D1 (Bindings): una base de datos D1 con el nombre DB (vale cualquier nombre).
 *
 * Tablas (se crean solas): cs_users, cs_leagues, cs_members, cs_log, cs_meta y, por Major (columna ev):
 * cs_picks, cs_combos, cs_stagepicks, cs_bracket, cs_champion, cs_fixes, cs_xmatches, cs_stageteams,
 * cs_adjust, cs_majorinfo. Cada Major del Pick'em tiene sus pronósticos y su clasificación.
 */
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60_000;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DEFAULT_SETTINGS = {
  picksOpen: true, registrationOpen: true, banner: '', maxPlayers: 60, maxGroups: 20, currentEvent: '',
  points: { win: 1, exact: 1, koMult: 2, finalMult: 3, champion: 5 },
  combo: { enabled: true, p2: 3, p3: 6, p4: 10, exact: 2, koMult: 2 },
  valve: { enabled: true, p30: 3, p03: 3, adv: 2 },
  bracket: { enabled: true, qf: 2, sf: 3, final: 5 },
};
// Pick'em de Valve en cada fase suiza: 2 equipos 3-0, 2 equipos 0-3 y 6 que pasan con 3-1 o 3-2
const VALVE = { w30: 2, l03: 2, adv: 6 };
const BRACKET_FEED = { R2M1: ['R1M1', 'R1M2'], R2M2: ['R1M3', 'R1M4'], R3M1: ['R2M1', 'R2M2'] };
const BRACKET_SLOTS = ['R1M1', 'R1M2', 'R1M3', 'R1M4', 'R2M1', 'R2M2', 'R3M1'];
const DEFAULT_EV = '2026-singapore';     // por si todavía no existe data/majors/index.json

export default {
  /** Tarea programada (Cloudflare → Worker → Settings → Triggers → Cron, p. ej. «0 4 * * 1»): copia semanal de la base. */
  async scheduled(event, env, ctx) {
    const db = env.DB || Object.values(env).find((v) => v && typeof v.prepare === 'function' && typeof v.batch === 'function');
    if (!db) return;
    await ensureSchema(db);
    ctx.waitUntil(saveBackup(db, 'semanal').then(() => logEvent(db, 'sistema', 'admin', 'Copia de seguridad semanal', '', 'backup')));
  },
  async fetch(request, env = {}) {
    const site = String(env.SITE_URL || '').replace(/\/$/, '');
    const origin = request.headers.get('Origin') || '';
    const allowed = [site ? new URL(site).origin : '', 'http://localhost:8000', 'http://127.0.0.1:8000', 'http://localhost:8770'].filter(Boolean);
    const cors = {
      'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0] || '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400', Vary: 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const send = (obj, status = 200) => new Response(JSON.stringify(obj), {
      status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
    try {
      if (!site) throw new HttpError(503, 'Falta la variable SITE_URL del Worker (la dirección de la web).');
      const db = env.DB || Object.values(env).find((v) => v && typeof v.prepare === 'function' && typeof v.batch === 'function');
      if (!db) throw new HttpError(503, 'El Worker no tiene ninguna base de datos D1 enlazada (Settings → Bindings → D1 database).');
      await ensureSchema(db);
      const url = new URL(request.url);
      const parts = url.pathname.split('/').filter(Boolean);
      const body = ['POST', 'PUT'].includes(request.method) ? await request.json().catch(() => ({})) : {};
      const cfg = await getSettings(db);
      const index = await loadIndex(site);
      const pickem = index.majors.filter((m) => m.pickem);
      const current = cfg.currentEvent && pickem.some((m) => m.id === cfg.currentEvent) ? cfg.currentEvent : index.current || DEFAULT_EV;
      const want = String(url.searchParams.get('ev') || body.ev || '');
      const canPick = parts[0] === 'admin' || request.method === 'GET';
      const ev = canPick && want && pickem.some((m) => m.id === want) ? want : current;
      const ctx = { db, env, request, url, parts, body, send, site, now: Date.now(), cfg, index, current, ev, _all: {} };
      if (parts[0] === 'admin') return await adminRoutes(ctx);
      return await userRoutes(ctx);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      return send({ ok: false, error: err instanceof HttpError ? err.message : `Error interno: ${err && err.message || err}` }, status);
    }
  },
};

// ================================================================ utilidades
const iso = () => new Date().toISOString();
const ms = (d) => (d ? Date.parse(d) || null : null);
const isTbd = (t) => !t || /^TBD$/i.test(t);
function cleanText(v, min, max, what) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (s.length < min || s.length > max) throw new HttpError(400, `${what} tiene que tener entre ${min} y ${max} caracteres.`);
  return s;
}
const randomCode = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((x) => CODE_CHARS[x % CODE_CHARS.length]).join('');
const randomHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((x) => x.toString(16).padStart(2, '0')).join('');
async function sha256(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const pinHash = (nick, pin) => sha256(`clutch:${String(nick).toLowerCase()}:${pin}`);
function checkNick(v) {
  const nick = cleanText(v, 2, 20, 'El apodo');
  if (!/^[\p{L}\p{N} ._-]+$/u.test(nick)) throw new HttpError(400, 'El apodo solo puede llevar letras, números, espacios, puntos y guiones.');
  return nick;
}
function checkPin(v) {
  const pin = String(v || '');
  if (!/^\d{4}$/.test(pin)) throw new HttpError(400, 'El PIN tiene que ser de 4 cifras.');
  return pin;
}
async function logEvent(db, actor, kind, action, detail = '', target = '') {
  try {
    await db.prepare('INSERT INTO cs_log (at, actor, kind, action, detail, target) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(iso(), String(actor || ''), kind, action, String(detail || '').slice(0, 500), target).run();
  } catch { /* el registro nunca debe impedir la acción */ }
}

// ================================================================ esquema y ajustes
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS cs_meta (k TEXT PRIMARY KEY, v TEXT)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS cs_users (id INTEGER PRIMARY KEY AUTOINCREMENT, nick TEXT NOT NULL UNIQUE COLLATE NOCASE, pin TEXT NOT NULL,
      token TEXT NOT NULL, created TEXT NOT NULL, fails INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0)`),
    db.prepare('CREATE TABLE IF NOT EXISTS cs_leagues (code TEXT PRIMARY KEY, name TEXT NOT NULL, owner INTEGER, created TEXT NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS cs_members (league TEXT NOT NULL, user INTEGER NOT NULL, joined TEXT NOT NULL, PRIMARY KEY (league, user))'),
    db.prepare(`CREATE TABLE IF NOT EXISTS cs_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT, kind TEXT NOT NULL, action TEXT NOT NULL,
      detail TEXT, target TEXT)`),
    db.prepare('CREATE TABLE IF NOT EXISTS cs_backups (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL, size INTEGER NOT NULL, data TEXT NOT NULL)'),
  ]);
  // v2: pronósticos y correcciones separados por Major (columna ev). Las tablas de la v1 se rehacen.
  const ver = await db.prepare("SELECT v FROM cs_meta WHERE k = 'schema'").first();
  if (!ver || ver.v !== '2') {
    const T = ['cs_picks', 'cs_combos', 'cs_stagepicks', 'cs_bracket', 'cs_champion', 'cs_fixes', 'cs_xmatches', 'cs_stageteams', 'cs_adjust', 'cs_majorinfo'];
    await db.batch([
      ...T.map((t) => db.prepare(`DROP TABLE IF EXISTS ${t}`)),
      db.prepare('CREATE TABLE cs_picks (ev TEXT NOT NULL, user INTEGER NOT NULL, mid TEXT NOT NULL, team TEXT NOT NULL, score TEXT, updated TEXT NOT NULL, PRIMARY KEY (ev, user, mid))'),
      db.prepare('CREATE TABLE cs_combos (ev TEXT NOT NULL, user INTEGER NOT NULL, rkey TEXT NOT NULL, legs TEXT NOT NULL, updated TEXT NOT NULL, PRIMARY KEY (ev, user, rkey))'),
      db.prepare('CREATE TABLE cs_stagepicks (ev TEXT NOT NULL, user INTEGER NOT NULL, stage TEXT NOT NULL, data TEXT NOT NULL, updated TEXT NOT NULL, PRIMARY KEY (ev, user, stage))'),
      db.prepare('CREATE TABLE cs_bracket (ev TEXT NOT NULL, user INTEGER NOT NULL, data TEXT NOT NULL, updated TEXT NOT NULL, PRIMARY KEY (ev, user))'),
      db.prepare('CREATE TABLE cs_champion (ev TEXT NOT NULL, user INTEGER NOT NULL, team TEXT NOT NULL, updated TEXT NOT NULL, PRIMARY KEY (ev, user))'),
      db.prepare(`CREATE TABLE cs_fixes (ev TEXT NOT NULL, mid TEXT NOT NULL, winner INTEGER, s1 INTEGER, s2 INTEGER, date TEXT, t1 TEXT, t2 TEXT,
        hidden INTEGER NOT NULL DEFAULT 0, updated TEXT NOT NULL, by TEXT, PRIMARY KEY (ev, mid))`),
      db.prepare(`CREATE TABLE cs_xmatches (id TEXT PRIMARY KEY, ev TEXT NOT NULL, stage TEXT NOT NULL, round TEXT NOT NULL, slot TEXT, kind TEXT, bo INTEGER NOT NULL,
        date TEXT, t1 TEXT NOT NULL, t2 TEXT NOT NULL, created TEXT NOT NULL)`),
      db.prepare('CREATE TABLE cs_stageteams (ev TEXT NOT NULL, stage TEXT NOT NULL, teams TEXT NOT NULL, updated TEXT NOT NULL, PRIMARY KEY (ev, stage))'),
      db.prepare(`CREATE TABLE cs_adjust (id INTEGER PRIMARY KEY AUTOINCREMENT, ev TEXT NOT NULL, league TEXT NOT NULL, user INTEGER NOT NULL, points INTEGER NOT NULL,
        reason TEXT NOT NULL, by TEXT, created TEXT NOT NULL)`),
      db.prepare('CREATE TABLE cs_majorinfo (ev TEXT PRIMARY KEY, data TEXT NOT NULL, updated TEXT NOT NULL, by TEXT)'),
      db.prepare("INSERT INTO cs_meta (k, v) VALUES ('schema', '2') ON CONFLICT (k) DO UPDATE SET v = '2'"),
    ]);
  }
  schemaReady = true;
}
async function getSettings(db) {
  const row = await db.prepare("SELECT v FROM cs_meta WHERE k = 'settings'").first();
  let s = {};
  try { s = row ? JSON.parse(row.v) : {}; } catch { s = {}; }
  return normalizeSettings(s);
}
function normalizeSettings(s) {
  const d = DEFAULT_SETTINGS;
  const int = (v, def, min, max) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) && v !== '' && v != null ? Math.min(max, Math.max(min, n)) : def; };
  const bool = (v, def) => (typeof v === 'boolean' ? v : def);
  const p = s.points || {}; const c = s.combo || {}; const v = s.valve || {}; const b = s.bracket || {};
  return {
    picksOpen: bool(s.picksOpen, d.picksOpen), registrationOpen: bool(s.registrationOpen, d.registrationOpen),
    banner: String(s.banner ?? d.banner).slice(0, 280).trim(),
    maxPlayers: int(s.maxPlayers, d.maxPlayers, 2, 500), maxGroups: int(s.maxGroups, d.maxGroups, 1, 100),
    currentEvent: String(s.currentEvent ?? '').replace(/[^a-z0-9-]/g, '').slice(0, 60),
    points: { win: int(p.win, d.points.win, 0, 50), exact: int(p.exact, d.points.exact, 0, 50), koMult: int(p.koMult, d.points.koMult, 1, 10),
      finalMult: int(p.finalMult, d.points.finalMult, 1, 10), champion: int(p.champion, d.points.champion, 0, 100) },
    combo: { enabled: bool(c.enabled, d.combo.enabled), p2: int(c.p2, d.combo.p2, 0, 100), p3: int(c.p3, d.combo.p3, 0, 100),
      p4: int(c.p4, d.combo.p4, 0, 100), exact: int(c.exact, d.combo.exact, 0, 50), koMult: int(c.koMult, d.combo.koMult, 1, 10) },
    valve: { enabled: bool(v.enabled, d.valve.enabled), p30: int(v.p30, d.valve.p30, 0, 50), p03: int(v.p03, d.valve.p03, 0, 50), adv: int(v.adv, d.valve.adv, 0, 50) },
    bracket: { enabled: bool(b.enabled, d.bracket.enabled), qf: int(b.qf, d.bracket.qf, 0, 50), sf: int(b.sf, d.bracket.sf, 0, 50), final: int(b.final, d.bracket.final, 0, 100) },
  };
}
function diffSettings(a, b, path = '') {
  const out = [];
  for (const k of Object.keys(b)) {
    if (b[k] && typeof b[k] === 'object') out.push(...diffSettings(a[k] || {}, b[k], `${path}${k}.`));
    else if (a[k] !== b[k]) out.push(`${path}${k}: ${JSON.stringify(a[k])} → ${JSON.stringify(b[k])}`);
  }
  return out;
}

// ================================================================ cuentas
async function auth(db, request) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new HttpError(401, 'Tienes que entrar con tu cuenta.');
  const u = await db.prepare('SELECT * FROM cs_users WHERE token = ?').bind(token).first();
  if (!u) throw new HttpError(401, 'Tu sesión ha caducado: vuelve a entrar con tu apodo y tu PIN.');
  return u;
}
const isAdmin = (env, u) => String(env.ADMINS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean).includes(u.nick.toLowerCase());
async function getLeague(db, code) {
  const c = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const lg = await db.prepare('SELECT * FROM cs_leagues WHERE code = ?').bind(c).first();
  if (!lg) throw new HttpError(404, `No existe ningún grupo con el código ${c || '(vacío)'}.`);
  return lg;
}

// ================================================================ partidos
const DEFAULT_STAGES = [{ id: 's1', name: 'Stage 1', type: 'swiss' }, { id: 's2', name: 'Stage 2', type: 'swiss' },
  { id: 's3', name: 'Stage 3', type: 'swiss' }, { id: 'po', name: 'Playoffs', type: 'bracket' }];
const fileCache = new Map();
/** Lee un JSON de la web (data/majors/…), con caché de 60 s; si falla, se usa lo último que se leyó. */
async function siteJson(site, path, fallback) {
  const c = fileCache.get(path);
  if (c && Date.now() - c.t < 60_000) return c.data;
  let data = c?.data;
  try {
    const res = await fetch(`${site}/${path}?v=${Math.floor(Date.now() / 60_000)}`, { headers: { Accept: 'application/json' } });
    if (res.ok) data = await res.json();
  } catch { /* sin red: lo último bueno */ }
  data = data || fallback;
  fileCache.set(path, { t: Date.now(), data });
  return data;
}
async function loadIndex(site) {
  const d = await siteJson(site, 'data/majors/index.json', null);
  return d && Array.isArray(d.majors) ? d : { current: null, majors: [] };
}
const loadData = (site, ev) => siteJson(site, `data/majors/${encodeURIComponent(ev)}.json`, { event: { id: ev }, stages: [], matches: [] });
/** Partidos definitivos: los de Liquipedia + los añadidos a mano, con las correcciones del administrador. */
async function loadAll(ctx, ev = ctx.ev) {
  const { db, site } = ctx;
  if (ctx._all[ev]) return ctx._all[ev];
  const data = await loadData(site, ev);
  const [fixes, extra, teamsOv] = await Promise.all([
    db.prepare('SELECT * FROM cs_fixes WHERE ev = ?').bind(ev).all().then((r) => r.results),
    db.prepare('SELECT * FROM cs_xmatches WHERE ev = ?').bind(ev).all().then((r) => r.results),
    db.prepare('SELECT * FROM cs_stageteams WHERE ev = ?').bind(ev).all().then((r) => r.results),
  ]);
  const fixBy = new Map(fixes.map((f) => [f.mid, f]));
  const raw = [...(data.matches || []).map((m) => ({ ...m })), ...extra.map((x) => ({
    id: x.id, stage: x.stage, round: x.round, slot: x.slot || '', kind: x.kind || '', bo: x.bo, date: x.date,
    t1: x.t1, t2: x.t2, s1: 0, s2: 0, winner: 0, done: false, maps: [], manual: true,
  }))];
  const matches = [];
  for (const m of raw) {
    const f = fixBy.get(m.id);
    if (f) {
      if (f.hidden) continue;
      if (f.t1) m.t1 = f.t1;
      if (f.t2) m.t2 = f.t2;
      if (f.date) m.date = f.date;
      if (f.winner === 1 || f.winner === 2) Object.assign(m, { winner: f.winner, s1: f.s1 ?? (f.winner === 1 ? 1 : 0), s2: f.s2 ?? (f.winner === 2 ? 1 : 0), done: true });
      if (f.winner === 0) Object.assign(m, { winner: 0, s1: 0, s2: 0, done: false });
      m.fixed = true;
    }
    m.t = ms(m.date);
    matches.push(m);
  }
  matches.sort((a, b) => (a.t || 9e15) - (b.t || 9e15) || a.id.localeCompare(b.id));
  const ov = new Map(teamsOv.map((x) => [x.stage, JSON.parse(x.teams)]));
  const stages = (data.stages?.length ? data.stages : ev === ctx.current ? DEFAULT_STAGES : []).map((s) => {
    const own = matches.filter((m) => m.stage === s.id);
    const auto = [...new Set([...own.flatMap((m) => [m.t1, m.t2]), ...(s.teams || [])].filter((t) => !isTbd(t)))].sort((a, b) => a.localeCompare(b));
    const ts = own.map((m) => m.t).filter(Boolean);
    return { id: s.id, name: s.name, type: s.type, teams: ov.get(s.id) || auto, teamsManual: ov.has(s.id), start: ts.length ? Math.min(...ts) : null };
  });
  const byId = new Map(matches.map((m) => [m.id, m]));
  const summary = ctx.index.majors.find((m) => m.id === ev) || {};
  const all = { ev, event: { ...summary, ...(data.event || {}), id: ev }, checked: data.checked, errors: data.errors || [], stages, matches, byId, fixes };
  ctx._all[ev] = all;
  return all;
}
const started = (m, now) => m.done || (m.t && now >= m.t);
const roundKey = (m) => `${m.stage}|${m.round}`;
const multOf = (m, cfg) => (m.stage !== 'po' ? 1 : m.kind === 'final' ? cfg.points.finalMult : cfg.points.koMult);
const realScore = (m) => `${Math.max(m.s1, m.s2)}-${Math.min(m.s1, m.s2)}`;
const winnerTeam = (m) => (m.winner === 1 ? m.t1 : m.winner === 2 ? m.t2 : null);
function eventStart(all) { const ts = all.matches.map((m) => m.t).filter(Boolean); return ts.length ? Math.min(...ts) : null; }
function champion(all) { const f = all.matches.find((m) => m.stage === 'po' && m.kind === 'final'); return f && f.done ? winnerTeam(f) : null; }
function allTeams(all) { return [...new Set(all.stages.flatMap((s) => s.teams))].sort((a, b) => a.localeCompare(b)); }
function scoresFor(bo) {
  const need = Math.floor(bo / 2) + 1;
  return bo > 1 ? Array.from({ length: need }, (_, l) => `${need}-${l}`) : [];
}
function checkScore(m, raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).replace(/\s/g, '');
  if (!scoresFor(m.bo).includes(s)) throw new HttpError(400, 'Resultado no válido para ese partido.');
  return s;
}

// ---------------------------------------------------------------- fases suizas
/** Récord de cada equipo en una fase suiza: { team: { w, l } } */
function records(all, stage) {
  const rec = {};
  for (const t of (all.stages.find((s) => s.id === stage)?.teams || [])) rec[t] = { w: 0, l: 0 };
  for (const m of all.matches) {
    if (m.stage !== stage || !m.done) continue;
    const win = winnerTeam(m); const lose = m.winner === 1 ? m.t2 : m.t1;
    (rec[win] = rec[win] || { w: 0, l: 0 }).w++;
    (rec[lose] = rec[lose] || { w: 0, l: 0 }).l++;
  }
  return rec;
}
/** Estado de una elección del Pick'em de fase: 'ok' | 'ko' | 'pending' */
function valveState(kind, r) {
  if (!r) return 'pending';
  if (kind === 'w30') return r.w === 3 && r.l === 0 ? 'ok' : r.l > 0 ? 'ko' : 'pending';
  if (kind === 'l03') return r.l === 3 && r.w === 0 ? 'ok' : r.w > 0 ? 'ko' : 'pending';
  return r.w === 3 && r.l > 0 ? 'ok' : r.l === 3 || (r.w === 3 && r.l === 0) ? 'ko' : 'pending';
}
function evalStagePick(data, rec, cfg) {
  const out = { picks: [], points: 0, hits: 0 };
  for (const kind of ['w30', 'l03', 'adv']) {
    for (const team of data[kind] || []) {
      const st = valveState(kind, rec[team]);
      const pts = st === 'ok' ? cfg.valve[kind === 'w30' ? 'p30' : kind === 'l03' ? 'p03' : 'adv'] : 0;
      out.picks.push({ kind, team, state: st, points: pts });
      out.points += pts; if (st === 'ok') out.hits++;
    }
  }
  return out;
}
function stageInfo(all, stage, now) {
  const s = all.stages.find((x) => x.id === stage);
  if (!s || s.type !== 'swiss') return null;
  return { ...s, lockAt: s.start, locked: !!(s.start && now >= s.start), ready: s.teams.length === 16 };
}

// ---------------------------------------------------------------- cuadro de playoffs
function bracketInfo(all, now) {
  const po = all.matches.filter((m) => m.stage === 'po');
  const bySlot = Object.fromEntries(po.filter((m) => m.slot).map((m) => [m.slot, m]));
  const ts = po.map((m) => m.t).filter(Boolean);
  const lockAt = ts.length ? Math.min(...ts) : null;
  const ready = ['R1M1', 'R1M2', 'R1M3', 'R1M4'].every((k) => bySlot[k] && !isTbd(bySlot[k].t1) && !isTbd(bySlot[k].t2));
  return { bySlot, lockAt, locked: !!(lockAt && now >= lockAt), ready };
}
function evalBracket(data, bi, cfg) {
  const out = { picks: [], points: 0, hits: 0 };
  for (const slot of BRACKET_SLOTS) {
    const team = data[slot];
    if (!team) continue;
    const m = bi.bySlot[slot];
    const pts = slot.startsWith('R1') ? cfg.bracket.qf : slot.startsWith('R2') ? cfg.bracket.sf : cfg.bracket.final;
    // si el equipo elegido ya cayó antes, la elección está perdida aunque aún no se haya jugado ese cruce
    const real = m && m.done ? winnerTeam(m) : null;
    const st = real ? (real === team ? 'ok' : 'ko') : eliminated(bi, team, slot) ? 'ko' : 'pending';
    out.picks.push({ slot, team, state: st, points: st === 'ok' ? pts : 0 });
    if (st === 'ok') { out.points += pts; out.hits++; }
  }
  return out;
}
function eliminated(bi, team, slot) {
  for (const k of BRACKET_SLOTS) {
    if (k === slot) break;
    const m = bi.bySlot[k];
    if (m && m.done && (m.t1 === team || m.t2 === team) && winnerTeam(m) !== team) return true;
  }
  return false;
}
function checkBracket(data, bi) {
  const out = {};
  for (const slot of BRACKET_SLOTS) {
    const team = data?.[slot];
    if (!team) continue;
    let options;
    if (slot.startsWith('R1')) { const m = bi.bySlot[slot]; options = m ? [m.t1, m.t2] : []; }
    else options = BRACKET_FEED[slot].map((k) => out[k]).filter(Boolean);
    if (!options.includes(team)) throw new HttpError(400, `Elección no válida en el cuadro (${slot}). Elige primero los cruces anteriores.`);
    out[slot] = String(team);
  }
  return out;
}

// ---------------------------------------------------------------- combinadas
function checkComboLegs(legsIn, all, now, strict) {
  if (!Array.isArray(legsIn) || legsIn.length < 2 || legsIn.length > 4) throw new HttpError(400, 'Una combinada lleva de 2 a 4 partidos.');
  const seen = new Set(); let rkey = null;
  const legs = legsIn.map((l) => {
    const m = all.byId.get(String(l.mid));
    if (!m) throw new HttpError(404, 'Uno de los partidos de la combinada ya no existe.');
    if (seen.has(m.id)) throw new HttpError(400, 'No puedes repetir un partido en la combinada.');
    seen.add(m.id);
    if (rkey && roundKey(m) !== rkey) throw new HttpError(400, 'Todos los partidos de una combinada tienen que ser de la misma ronda.');
    rkey = roundKey(m);
    if (strict && started(m, now)) throw new HttpError(403, 'Uno de los partidos ya ha empezado.');
    if (isTbd(m.t1) || isTbd(m.t2)) throw new HttpError(400, 'Todavía no se conocen los equipos de uno de los partidos.');
    if (l.team !== m.t1 && l.team !== m.t2) throw new HttpError(400, 'Equipo no válido en la combinada.');
    return { mid: m.id, team: l.team, score: checkScore(m, l.score) };
  });
  return { rkey, legs };
}
function evalCombo(legs, all, cfg) {
  let exact = 0; let ko = false; let pending = false; let lost = false;
  const out = legs.map((l) => {
    const m = all.byId.get(l.mid);
    if (!m) { lost = true; return { ...l, result: 'ko' }; }
    if (m.stage === 'po') ko = true;
    if (!m.done) { pending = true; return { ...l, result: 'pending' }; }
    const ok = winnerTeam(m) === l.team;
    if (!ok) lost = true;
    if (ok && l.score && l.score === realScore(m)) exact++;
    return { ...l, result: ok ? 'ok' : 'ko', exact: ok && !!l.score && l.score === realScore(m) };
  });
  const base = { 2: cfg.combo.p2, 3: cfg.combo.p3, 4: cfg.combo.p4 }[legs.length] || 0;
  const value = (base + exact * cfg.combo.exact) * (ko ? cfg.combo.koMult : 1);
  const status = lost ? 'lose' : pending ? 'live' : 'win';
  return { legs: out, status, points: status === 'win' ? value : 0, potential: (base + legs.filter((l) => l.score).length * cfg.combo.exact) * (ko ? cfg.combo.koMult : 1) };
}

// ---------------------------------------------------------------- clasificación
function pickPoints(p, m, cfg) {
  if (!m || !m.done) return null;
  const ok = winnerTeam(m) === p.team;
  const exact = ok && p.score && p.score === realScore(m) && m.bo > 1;
  const mult = multOf(m, cfg);
  return { ok, exact: !!exact, points: ok ? (cfg.points.win + (exact ? cfg.points.exact : 0)) * mult : 0 };
}
async function leagueBoard(ctx, code) {
  const { db, cfg, now, ev } = ctx;
  const all = await loadAll(ctx);
  const members = (await db.prepare('SELECT u.id, u.nick FROM cs_members m JOIN cs_users u ON u.id = m.user WHERE m.league = ? ORDER BY m.joined').bind(code).all()).results;
  const ids = members.map((u) => u.id);
  const q = async (sql) => (ids.length ? (await db.prepare(sql.replace('$IDS', ids.map(() => '?').join(','))).bind(ev, ...ids).all()).results : []);
  const [picks, combos, stagepicks, brackets, champs, adjust] = await Promise.all([
    q('SELECT * FROM cs_picks WHERE ev = ? AND user IN ($IDS)'), q('SELECT * FROM cs_combos WHERE ev = ? AND user IN ($IDS)'),
    q('SELECT * FROM cs_stagepicks WHERE ev = ? AND user IN ($IDS)'), q('SELECT * FROM cs_bracket WHERE ev = ? AND user IN ($IDS)'),
    q('SELECT * FROM cs_champion WHERE ev = ? AND user IN ($IDS)'),
    db.prepare('SELECT * FROM cs_adjust WHERE ev = ? AND league = ? ORDER BY id').bind(ev, code).all().then((r) => r.results),
  ]);
  const champ = champion(all);
  const bi = bracketInfo(all, now);
  const start = eventStart(all);
  const recs = Object.fromEntries(all.stages.filter((s) => s.type === 'swiss').map((s) => [s.id, records(all, s.id)]));
  const st = new Map(members.map((u) => [u.id, { id: u.id, nick: u.nick, points: 0, matches: 0, hits: 0, exact: 0, played: 0,
    combos: 0, stages: 0, bracket: 0, champion: 0, adjust: 0, adjustReason: [], byRound: {} }]));
  // rondas (fase · ronda) en orden, para el resumen de la última ronda y las flechas de la clasificación
  const roundsMap = new Map();
  for (const m of all.matches) {
    const k = `${m.stage}|${m.round}`;
    const r = roundsMap.get(k) || { key: k, stage: m.stage, round: m.round, first: Infinity, last: 0, total: 0, done: 0 };
    r.first = Math.min(r.first, m.t || Infinity); r.last = Math.max(r.last, m.t || 0); r.total++; if (m.done) r.done++;
    roundsMap.set(k, r);
  }
  const rounds = [...roundsMap.values()].filter((r) => r.first < Infinity).sort((a, b) => a.first - b.first);
  const revealed = {};
  for (const p of picks) {
    const s = st.get(p.user); const m = all.byId.get(p.mid);
    if (!s || !m) continue;
    if (started(m, now)) (revealed[m.id] = revealed[m.id] || []).push({ nick: s.nick, team: p.team, score: p.score });
    const r = pickPoints(p, m, cfg);
    if (!r) continue;
    s.played++; if (r.ok) s.hits++; if (r.exact) s.exact++;
    s.matches += r.points;
    const rk = `${m.stage}|${m.round}`;
    s.byRound[rk] = (s.byRound[rk] || 0) + r.points;
  }
  const combosOut = [];
  if (cfg.combo.enabled || combos.length) {
    for (const c of combos) {
      const s = st.get(c.user); if (!s) continue;
      const ev = evalCombo(JSON.parse(c.legs), all, cfg);
      s.combos += ev.points;
      const first = Math.min(...ev.legs.map((l) => all.byId.get(l.mid)?.t || 9e15));
      if (now >= first) combosOut.push({ nick: s.nick, rkey: c.rkey, ...ev });
    }
  }
  const stagesOut = {};
  for (const sp of stagepicks) {
    const s = st.get(sp.user); const info = stageInfo(all, sp.stage, now);
    if (!s || !info) continue;
    const ev = evalStagePick(JSON.parse(sp.data), recs[sp.stage] || {}, cfg);
    s.stages += ev.points;
    if (info.locked) (stagesOut[sp.stage] = stagesOut[sp.stage] || []).push({ nick: s.nick, ...ev });
  }
  const bracketOut = [];
  for (const b of brackets) {
    const s = st.get(b.user); if (!s) continue;
    const ev = evalBracket(JSON.parse(b.data), bi, cfg);
    s.bracket += ev.points;
    if (bi.locked) bracketOut.push({ nick: s.nick, ...ev });
  }
  const champsOut = [];
  for (const c of champs) {
    const s = st.get(c.user); if (!s) continue;
    if (champ && c.team === champ) s.champion += cfg.points.champion;
    if (start && now >= start) champsOut.push({ nick: s.nick, team: c.team, ok: champ ? c.team === champ : null });
  }
  for (const a of adjust) {
    const s = st.get(a.user); if (!s) continue;
    s.adjust += a.points; s.adjustReason.push(`${a.points > 0 ? '+' : ''}${a.points}: ${a.reason}`);
  }
  for (const s of st.values()) s.points = s.matches + s.combos + s.stages + s.bracket + s.champion + s.adjust;
  const board = [...st.values()].sort((a, b) => b.points - a.points || b.hits - a.hits || b.exact - a.exact || a.nick.localeCompare(b.nick));
  let pos = 0; let prev = null;
  board.forEach((r, i) => { if (!prev || prev.points !== r.points || prev.hits !== r.hits || prev.exact !== r.exact) pos = i + 1; r.pos = pos; r.adjustReason = r.adjustReason.join(' · '); prev = r; });
  // posición antes de la última ronda terminada (solo puntos de partidos de esa ronda): para las flechas ↑↓
  const lastDone = [...rounds].reverse().find((r) => r.total && r.done === r.total);
  if (lastDone) {
    const before = board.map((r) => ({ nick: r.nick, p: r.points - (r.byRound[lastDone.key] || 0), hits: r.hits }))
      .sort((a, b) => b.p - a.p || b.hits - a.hits || a.nick.localeCompare(b.nick));
    let bp = 0; let bprev = null;
    before.forEach((r, i) => { if (!bprev || bprev.p !== r.p) bp = i + 1; r.pos = bp; bprev = r; });
    for (const r of board) r.prevPos = before.find((x) => x.nick === r.nick).pos;
  }
  return { board, revealed, combos: combosOut, stages: stagesOut, brackets: bracketOut, champions: champsOut, championTeam: champ, adjust,
    rounds: rounds.map(({ key, stage, round, total, done }) => ({ key, stage, round, total, done })), lastRound: lastDone?.key || null };
}

// ================================================================ rutas de jugadores
async function userRoutes(ctx) {
  const { db, env, request, parts, body, send, now, cfg, ev } = ctx;
  const pickemList = () => ctx.index.majors.filter((m) => m.pickem).map((m) => ({ id: m.id, name: m.name, city: m.city, start: m.start, end: m.end, status: m.status }));
  switch (`${request.method} ${parts[0] || ''}`) {
    case 'GET matches': {                                         // partidos definitivos (con correcciones) y fases
      const all = await loadAll(ctx);
      const bi = bracketInfo(all, now);
      return send({ ok: true, now, ev, current: ctx.current, events: pickemList(), event: all.event, checked: all.checked, stages: all.stages.map((s) => ({ ...s, ...(stageInfo(all, s.id, now) || {}) })),
        matches: all.matches, records: Object.fromEntries(all.stages.filter((s) => s.type === 'swiss').map((s) => [s.id, records(all, s.id)])),
        bracket: { lockAt: bi.lockAt, locked: bi.locked, ready: bi.ready }, teams: allTeams(all), start: eventStart(all), champion: champion(all),
        settings: publicSettings(cfg) });
    }
    case 'POST register': {
      if (!cfg.registrationOpen) throw new HttpError(403, 'Ahora mismo no se pueden crear cuentas nuevas. Habla con el administrador.');
      const nick = checkNick(body.nick); const pin = checkPin(body.pin);
      if (await db.prepare('SELECT id FROM cs_users WHERE nick = ? COLLATE NOCASE').bind(nick).first()) {
        throw new HttpError(409, `Ya existe una cuenta con el apodo «${nick}». Si es tuya, entra con tu PIN; si no, elige otro apodo.`);
      }
      const token = randomHex(24);
      const r = await db.prepare('INSERT INTO cs_users (nick, pin, token, created) VALUES (?, ?, ?, ?)').bind(nick, await pinHash(nick, pin), token, iso()).run();
      await logEvent(db, nick, 'user', 'Cuenta creada', '', `u:${r.meta.last_row_id}`);
      return send({ ok: true, token, user: { nick } });
    }
    case 'POST login': {
      const nick = checkNick(body.nick); const pin = checkPin(body.pin);
      const u = await db.prepare('SELECT * FROM cs_users WHERE nick = ? COLLATE NOCASE').bind(nick).first();
      if (!u) throw new HttpError(404, `No existe ninguna cuenta con el apodo «${nick}». Revisa cómo lo has escrito o crea una cuenta.`);
      if (u.locked_until > now) throw new HttpError(429, `Demasiados intentos con un PIN incorrecto. Prueba dentro de ${Math.ceil((u.locked_until - now) / 60_000)} min.`);
      if (u.pin !== await pinHash(u.nick, pin)) {
        const fails = u.fails + 1;
        await db.prepare('UPDATE cs_users SET fails = ?, locked_until = ? WHERE id = ?').bind(fails >= MAX_FAILS ? 0 : fails, fails >= MAX_FAILS ? now + LOCK_MS : 0, u.id).run();
        if (fails >= MAX_FAILS) await logEvent(db, u.nick, 'user', 'Cuenta bloqueada por PIN incorrecto', '', `u:${u.id}`);
        throw new HttpError(401, fails >= MAX_FAILS ? 'PIN incorrecto. Por seguridad, esta cuenta queda bloqueada 15 minutos.'
          : `PIN incorrecto. Te quedan ${MAX_FAILS - fails} ${MAX_FAILS - fails === 1 ? 'intento' : 'intentos'}.`);
      }
      if (u.fails) await db.prepare('UPDATE cs_users SET fails = 0 WHERE id = ?').bind(u.id).run();
      return send({ ok: true, token: u.token, user: { nick: u.nick } });
    }
    case 'GET me': {
      const u = await auth(db, request);
      const all = await loadAll(ctx);
      const [leagues, picks, combos, stagepicks, br, ch] = await Promise.all([
        db.prepare(`SELECT l.code, l.name, (SELECT COUNT(*) FROM cs_members x WHERE x.league = l.code) AS players
          FROM cs_members m JOIN cs_leagues l ON l.code = m.league WHERE m.user = ? ORDER BY m.joined`).bind(u.id).all().then((r) => r.results),
        db.prepare('SELECT mid, team, score FROM cs_picks WHERE ev = ? AND user = ?').bind(ev, u.id).all().then((r) => r.results),
        db.prepare('SELECT rkey, legs FROM cs_combos WHERE ev = ? AND user = ?').bind(ev, u.id).all().then((r) => r.results),
        db.prepare('SELECT stage, data FROM cs_stagepicks WHERE ev = ? AND user = ?').bind(ev, u.id).all().then((r) => r.results),
        db.prepare('SELECT data FROM cs_bracket WHERE ev = ? AND user = ?').bind(ev, u.id).first(),
        db.prepare('SELECT team FROM cs_champion WHERE ev = ? AND user = ?').bind(ev, u.id).first(),
      ]);
      const bi = bracketInfo(all, now);
      return send({ ok: true, now, ev, user: { nick: u.nick }, admin: isAdmin(env, u), leagues,
        picks: picks.map((p) => ({ ...p, result: pickPoints(p, all.byId.get(p.mid), cfg) })),
        combos: combos.map((c) => ({ rkey: c.rkey, ...evalCombo(JSON.parse(c.legs), all, cfg) })),
        stagepicks: Object.fromEntries(stagepicks.map((s) => [s.stage, { data: JSON.parse(s.data), ...evalStagePick(JSON.parse(s.data), records(all, s.stage), cfg) }])),
        bracket: br ? { data: JSON.parse(br.data), ...evalBracket(JSON.parse(br.data), bi, cfg) } : null,
        champion: ch ? ch.team : null, settings: publicSettings(cfg) });
    }
    case 'POST league': {
      const u = await auth(db, request);
      const name = cleanText(body.name, 2, 40, 'El nombre del grupo');
      await checkGroupLimit(db, u, cfg);
      for (let i = 0; i < 5; i++) {
        const code = randomCode(6);
        const r = await db.prepare('INSERT OR IGNORE INTO cs_leagues (code, name, owner, created) VALUES (?, ?, ?, ?)').bind(code, name, u.id, iso()).run();
        if (r.meta.changes) {
          await db.prepare('INSERT OR IGNORE INTO cs_members (league, user, joined) VALUES (?, ?, ?)').bind(code, u.id, iso()).run();
          await logEvent(db, u.nick, 'user', 'Grupo creado', `${name} (${code})`, `l:${code}`);
          return send({ ok: true, league: { code, name, players: 1 } });
        }
      }
      throw new HttpError(500, 'No se pudo crear el grupo; inténtalo otra vez.');
    }
    case 'GET league': {
      const lg = await getLeague(db, parts[1]);
      const n = await db.prepare('SELECT COUNT(*) AS n FROM cs_members WHERE league = ?').bind(lg.code).first();
      return send({ ok: true, league: { code: lg.code, name: lg.name, players: n.n } });
    }
    case 'POST join': {
      const u = await auth(db, request);
      const lg = await getLeague(db, body.code);
      if (!await db.prepare('SELECT 1 FROM cs_members WHERE league = ? AND user = ?').bind(lg.code, u.id).first()) {
        const n = await db.prepare('SELECT COUNT(*) AS n FROM cs_members WHERE league = ?').bind(lg.code).first();
        if (n.n >= cfg.maxPlayers) throw new HttpError(403, `El grupo está completo (${cfg.maxPlayers} jugadores).`);
        await checkGroupLimit(db, u, cfg);
        await db.prepare('INSERT INTO cs_members (league, user, joined) VALUES (?, ?, ?)').bind(lg.code, u.id, iso()).run();
        await logEvent(db, u.nick, 'user', 'Se unió a un grupo', `${lg.name} (${lg.code})`, `l:${lg.code}`);
      }
      return send({ ok: true, league: { code: lg.code, name: lg.name } });
    }
    case 'POST leave': {
      const u = await auth(db, request);
      const lg = await getLeague(db, body.code);
      await db.prepare('DELETE FROM cs_members WHERE league = ? AND user = ?').bind(lg.code, u.id).run();
      await logEvent(db, u.nick, 'user', 'Salió de un grupo', `${lg.name} (${lg.code})`, `l:${lg.code}`);
      return send({ ok: true });
    }
    case 'GET board': {
      const lg = await getLeague(db, parts[1]);
      return send({ ok: true, now, ev, league: { code: lg.code, name: lg.name }, ...(await leagueBoard(ctx, lg.code)) });
    }
    case 'PUT pick': {                                            // ganador (y resultado) de un partido; se cambia hasta que empieza
      const u = await auth(db, request);
      notPast(ctx);
      if (!cfg.picksOpen) throw new HttpError(403, 'El administrador ha cerrado los pronósticos por ahora.');
      const all = await loadAll(ctx);
      const m = all.byId.get(String(body.mid || ''));
      if (!m) throw new HttpError(404, 'No existe ese partido.');
      if (started(m, now)) throw new HttpError(403, 'Ese partido ya ha empezado: no se puede cambiar el pronóstico.');
      if (isTbd(m.t1) || isTbd(m.t2)) throw new HttpError(400, 'Todavía no se conocen los dos equipos de ese partido.');
      if (body.team == null || body.team === '') {
        await db.prepare('DELETE FROM cs_picks WHERE ev = ? AND user = ? AND mid = ?').bind(ev, u.id, m.id).run();
        return send({ ok: true, mid: m.id, team: null });
      }
      if (body.team !== m.t1 && body.team !== m.t2) throw new HttpError(400, 'Ese equipo no juega este partido.');
      const score = checkScore(m, body.score);
      await db.prepare(`INSERT INTO cs_picks (ev, user, mid, team, score, updated) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (ev, user, mid) DO UPDATE SET team = excluded.team, score = excluded.score, updated = excluded.updated`).bind(ev, u.id, m.id, body.team, score, iso()).run();
      return send({ ok: true, mid: m.id, team: body.team, score });
    }
    case 'PUT combo': {                                           // combinada de una ronda (legs vacío = borrarla)
      const u = await auth(db, request);
      notPast(ctx);
      if (!cfg.picksOpen) throw new HttpError(403, 'El administrador ha cerrado los pronósticos por ahora.');
      if (!cfg.combo.enabled) throw new HttpError(403, 'Las combinadas están desactivadas.');
      const all = await loadAll(ctx);
      const rkeyIn = String(body.rkey || '');
      const ex = rkeyIn ? await db.prepare('SELECT legs FROM cs_combos WHERE ev = ? AND user = ? AND rkey = ?').bind(ev, u.id, rkeyIn).first() : null;
      if (ex && JSON.parse(ex.legs).some((l) => { const m = all.byId.get(l.mid); return m && started(m, now); })) {
        throw new HttpError(403, 'Tu combinada de esa ronda ya tiene partidos empezados: no se puede cambiar.');
      }
      if (!body.legs || !body.legs.length) {
        await db.prepare('DELETE FROM cs_combos WHERE ev = ? AND user = ? AND rkey = ?').bind(ev, u.id, rkeyIn).run();
        return send({ ok: true, deleted: true });
      }
      const { rkey, legs } = checkComboLegs(body.legs, all, now, true);
      if (rkeyIn && rkeyIn !== rkey) await db.prepare('DELETE FROM cs_combos WHERE ev = ? AND user = ? AND rkey = ?').bind(ev, u.id, rkeyIn).run();
      await db.prepare(`INSERT INTO cs_combos (ev, user, rkey, legs, updated) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (ev, user, rkey) DO UPDATE SET legs = excluded.legs, updated = excluded.updated`).bind(ev, u.id, rkey, JSON.stringify(legs), iso()).run();
      return send({ ok: true, combo: { rkey, ...evalCombo(legs, all, cfg) } });
    }
    case 'PUT stage': {                                           // Pick'em de Valve de una fase suiza
      const u = await auth(db, request);
      notPast(ctx);
      if (!cfg.picksOpen) throw new HttpError(403, 'El administrador ha cerrado los pronósticos por ahora.');
      if (!cfg.valve.enabled) throw new HttpError(403, 'El Pick\'em de fases está desactivado.');
      const all = await loadAll(ctx);
      const info = stageInfo(all, String(body.stage || ''), now);
      if (!info) throw new HttpError(404, 'Esa fase no existe.');
      if (!info.ready) throw new HttpError(409, `Todavía no se conocen los 16 equipos de ${info.name}.`);
      if (info.locked) throw new HttpError(403, `El Pick'em de ${info.name} se cerró al empezar su primer partido.`);
      const used = new Set();
      const data = {};
      for (const kind of ['w30', 'l03', 'adv']) {
        const list = Array.isArray(body[kind]) ? body[kind].map(String) : [];
        if (list.length > VALVE[kind]) throw new HttpError(400, `Demasiados equipos en ${kind === 'w30' ? '3-0' : kind === 'l03' ? '0-3' : 'clasificados'}.`);
        for (const t of list) {
          if (!info.teams.includes(t)) throw new HttpError(400, `${t} no juega ${info.name}.`);
          if (used.has(t)) throw new HttpError(400, `${t} solo puede estar en un grupo.`);
          used.add(t);
        }
        data[kind] = list;
      }
      await db.prepare(`INSERT INTO cs_stagepicks (ev, user, stage, data, updated) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (ev, user, stage) DO UPDATE SET data = excluded.data, updated = excluded.updated`).bind(ev, u.id, info.id, JSON.stringify(data), iso()).run();
      return send({ ok: true, stage: info.id, data });
    }
    case 'PUT bracket': {                                         // cuadro de playoffs
      const u = await auth(db, request);
      notPast(ctx);
      if (!cfg.picksOpen) throw new HttpError(403, 'El administrador ha cerrado los pronósticos por ahora.');
      if (!cfg.bracket.enabled) throw new HttpError(403, 'El cuadro de playoffs está desactivado.');
      const all = await loadAll(ctx);
      const bi = bracketInfo(all, now);
      if (!bi.ready) throw new HttpError(409, 'Todavía no se conocen los cruces de cuartos de final.');
      if (bi.locked) throw new HttpError(403, 'El cuadro se cerró al empezar los playoffs.');
      const data = checkBracket(body.picks || {}, bi);
      await db.prepare(`INSERT INTO cs_bracket (ev, user, data, updated) VALUES (?, ?, ?, ?)
        ON CONFLICT (ev, user) DO UPDATE SET data = excluded.data, updated = excluded.updated`).bind(ev, u.id, JSON.stringify(data), iso()).run();
      return send({ ok: true, data });
    }
    case 'PUT champion': {
      const u = await auth(db, request);
      notPast(ctx);
      if (!cfg.picksOpen) throw new HttpError(403, 'El administrador ha cerrado los pronósticos por ahora.');
      const all = await loadAll(ctx);
      const start = eventStart(all);
      if (start && now >= start) throw new HttpError(403, 'El pronóstico del campeón se cerró al empezar el Major.');
      const team = String(body.team || '');
      if (!team) { await db.prepare('DELETE FROM cs_champion WHERE ev = ? AND user = ?').bind(ev, u.id).run(); return send({ ok: true, team: null }); }
      if (!allTeams(all).includes(team)) throw new HttpError(400, 'Ese equipo no juega el Major.');
      await db.prepare(`INSERT INTO cs_champion (ev, user, team, updated) VALUES (?, ?, ?, ?)
        ON CONFLICT (ev, user) DO UPDATE SET team = excluded.team, updated = excluded.updated`).bind(ev, u.id, team, iso()).run();
      return send({ ok: true, team });
    }
    case 'GET majorinfo': {                                       // datos de los Majors puestos por el administrador (MVP, notas)
      const rows = (await db.prepare('SELECT ev, data FROM cs_majorinfo').all()).results;
      return send({ ok: true, info: Object.fromEntries(rows.map((r) => [r.ev, JSON.parse(r.data)])) });
    }
    default:
      throw new HttpError(404, 'Ruta desconocida.');
  }
}
const publicSettings = (cfg) => ({ picksOpen: cfg.picksOpen, registrationOpen: cfg.registrationOpen, banner: cfg.banner,
  points: cfg.points, combo: cfg.combo, valve: cfg.valve, bracket: cfg.bracket, valveCounts: VALVE });
/** Copia de todo lo que hay en la base (para descargar o para la copia semanal). */
async function exportAll(db, cfg) {
  const t = async (sql) => (await db.prepare(sql).all()).results;
  return { exported: iso(), settings: cfg,
    users: await t('SELECT id, nick, created FROM cs_users'), leagues: await t('SELECT * FROM cs_leagues'), members: await t('SELECT * FROM cs_members'),
    picks: await t('SELECT * FROM cs_picks'), combos: await t('SELECT * FROM cs_combos'), stagepicks: await t('SELECT * FROM cs_stagepicks'),
    brackets: await t('SELECT * FROM cs_bracket'), champions: await t('SELECT * FROM cs_champion'), fixes: await t('SELECT * FROM cs_fixes'),
    xmatches: await t('SELECT * FROM cs_xmatches'), stageteams: await t('SELECT * FROM cs_stageteams'), adjust: await t('SELECT * FROM cs_adjust'),
    majorinfo: await t('SELECT * FROM cs_majorinfo') };
}
/** Guarda una copia en la propia base y deja solo las 8 últimas. */
async function saveBackup(db, kind) {
  const data = JSON.stringify(await exportAll(db, await getSettings(db)));
  await db.prepare('INSERT INTO cs_backups (at, kind, size, data) VALUES (?, ?, ?, ?)').bind(iso(), kind, data.length, data).run();
  await db.prepare('DELETE FROM cs_backups WHERE id NOT IN (SELECT id FROM cs_backups ORDER BY id DESC LIMIT 8)').run();
}
function notPast(ctx) {
  if (ctx.ev !== ctx.current) throw new HttpError(403, 'Ese Major ya no está abierto para pronosticar.');
}
async function checkGroupLimit(db, u, cfg) {
  const n = await db.prepare('SELECT COUNT(*) AS n FROM cs_members WHERE user = ?').bind(u.id).first();
  if (n.n >= cfg.maxGroups) throw new HttpError(403, `Como mucho puedes estar en ${cfg.maxGroups} grupos.`);
}

// ================================================================ administración
async function adminRoutes(ctx) {
  const { db, env, request, parts, body, send, now, cfg, ev } = ctx;
  const me = await auth(db, request);
  if (!isAdmin(env, me)) throw new HttpError(403, 'Tu cuenta no es de administrador. Los administradores se configuran con la variable ADMINS del Worker.');
  const log = (action, detail = '', target = '') => logEvent(db, me.nick, 'admin', action, detail, target);
  const what = parts[1] || '';
  const all = await loadAll(ctx);
  const userById = async (id) => {
    const u = await db.prepare('SELECT * FROM cs_users WHERE id = ?').bind(Number(id)).first();
    if (!u) throw new HttpError(404, 'No existe esa cuenta.');
    return u;
  };
  if (request.method === 'GET') {
    switch (what) {
      case 'overview': {
        const one = async (sql, ...a) => (await db.prepare(sql).bind(...a).first())?.n || 0;
        const late = all.matches.filter((m) => !m.done && m.t && now > m.t + (m.bo * 70 + 30) * 60_000 && !isTbd(m.t1));
        const upcoming = all.matches.filter((m) => !m.done && m.t && m.t > now && m.t < now + 48 * 3600_000 && !isTbd(m.t1));
        const counts = Object.fromEntries((await db.prepare('SELECT mid, COUNT(*) AS n FROM cs_picks WHERE ev = ? GROUP BY mid').bind(ev).all()).results.map((r) => [r.mid, r.n]));
        return send({ ok: true, now, ev, current: ctx.current, event: all.event, majors: ctx.index.majors.length, majorsLoaded: ctx.index.majors.filter((m) => m.loaded).length,
          indexChecked: ctx.index.checked || null, indexErrors: ctx.index.errors || [], indexAlerts: ctx.index.alerts || [], admin: me.nick, settings: cfg, checked: all.checked, errors: all.errors,
          stats: { users: await one('SELECT COUNT(*) AS n FROM cs_users'), leagues: await one('SELECT COUNT(*) AS n FROM cs_leagues'),
            picks: await one('SELECT COUNT(*) AS n FROM cs_picks WHERE ev = ?', ev), combos: await one('SELECT COUNT(*) AS n FROM cs_combos WHERE ev = ?', ev),
            stagepicks: await one('SELECT COUNT(*) AS n FROM cs_stagepicks WHERE ev = ?', ev), brackets: await one('SELECT COUNT(*) AS n FROM cs_bracket WHERE ev = ?', ev),
            matches: all.matches.length, done: all.matches.filter((m) => m.done).length, fixes: all.fixes.length,
            locked: await one('SELECT COUNT(*) AS n FROM cs_users WHERE locked_until > ?', now) },
          late, upcoming: upcoming.map((m) => ({ ...m, picks: counts[m.id] || 0 })),
          recent: (await db.prepare('SELECT * FROM cs_log ORDER BY id DESC LIMIT 12').all()).results });
      }
      case 'matches': {
        const counts = Object.fromEntries((await db.prepare('SELECT mid, COUNT(*) AS n FROM cs_picks WHERE ev = ? GROUP BY mid').bind(ev).all()).results.map((r) => [r.mid, r.n]));
        const data = await loadData(ctx.site, ev);
        const hidden = all.fixes.filter((f) => f.hidden).map((f) => ({ ...(data.matches || []).find((m) => m.id === f.mid), id: f.mid, hidden: true }));
        return send({ ok: true, now, ev, stages: all.stages, matches: all.matches.map((m) => ({ ...m, picks: counts[m.id] || 0, fix: all.fixes.find((f) => f.mid === m.id) || null })),
          hidden, teams: allTeams(all), checked: all.checked, errors: all.errors });
      }
      case 'match': {
        const m = all.byId.get(String(ctx.url.searchParams.get('id') || ''));
        if (!m) throw new HttpError(404, 'No existe ese partido.');
        const picks = (await db.prepare('SELECT p.*, u.nick FROM cs_picks p JOIN cs_users u ON u.id = p.user WHERE p.ev = ? AND p.mid = ? ORDER BY u.nick').bind(ev, m.id).all()).results;
        const users = (await db.prepare('SELECT id, nick FROM cs_users ORDER BY nick').all()).results;
        return send({ ok: true, match: m, picks, users });
      }
      case 'users': {
        const users = (await db.prepare(`SELECT u.id, u.nick, u.created, u.locked_until,
          (SELECT COUNT(*) FROM cs_picks p WHERE p.ev = ?1 AND p.user = u.id) AS picks, (SELECT COUNT(*) FROM cs_members m WHERE m.user = u.id) AS groups,
          (SELECT COUNT(*) FROM cs_stagepicks s WHERE s.ev = ?1 AND s.user = u.id) AS stagepicks, (SELECT MAX(updated) FROM cs_picks p WHERE p.user = u.id) AS last
          FROM cs_users u ORDER BY u.nick COLLATE NOCASE`).bind(ev).all()).results;
        return send({ ok: true, now, users, admins: String(env.ADMINS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean) });
      }
      case 'user': {
        const u = await userById(parts[2]);
        const [groups, picks, stagepicks, br, ch, activity] = await Promise.all([
          db.prepare('SELECT l.code, l.name FROM cs_members m JOIN cs_leagues l ON l.code = m.league WHERE m.user = ?').bind(u.id).all().then((r) => r.results),
          db.prepare('SELECT * FROM cs_picks WHERE ev = ? AND user = ? ORDER BY updated DESC').bind(ev, u.id).all().then((r) => r.results),
          db.prepare('SELECT * FROM cs_stagepicks WHERE ev = ? AND user = ?').bind(ev, u.id).all().then((r) => r.results),
          db.prepare('SELECT * FROM cs_bracket WHERE ev = ? AND user = ?').bind(ev, u.id).first(),
          db.prepare('SELECT * FROM cs_champion WHERE ev = ? AND user = ?').bind(ev, u.id).first(),
          db.prepare("SELECT * FROM cs_log WHERE target = ? OR actor = ? ORDER BY id DESC LIMIT 40").bind(`u:${u.id}`, u.nick).all().then((r) => r.results),
        ]);
        return send({ ok: true, now, user: { id: u.id, nick: u.nick, created: u.created, locked_until: u.locked_until }, groups,
          picks: picks.map((p) => ({ ...p, match: all.byId.get(p.mid) || null })), stagepicks: stagepicks.map((s) => ({ stage: s.stage, data: JSON.parse(s.data) })),
          bracket: br ? JSON.parse(br.data) : null, champion: ch?.team || null, activity });
      }
      case 'leagues': {
        const leagues = (await db.prepare(`SELECT l.*, u.nick AS ownerNick, (SELECT COUNT(*) FROM cs_members m WHERE m.league = l.code) AS players
          FROM cs_leagues l LEFT JOIN cs_users u ON u.id = l.owner ORDER BY l.created DESC`).all()).results;
        return send({ ok: true, leagues });
      }
      case 'league': {
        const lg = await getLeague(db, parts[2]);
        const users = (await db.prepare('SELECT id, nick FROM cs_users ORDER BY nick').all()).results;
        return send({ ok: true, league: lg, users, ...(await leagueBoard(ctx, lg.code)) });
      }
      case 'log': {
        const before = Number(ctx.url.searchParams.get('before')) || 1e12;
        const kind = ctx.url.searchParams.get('kind') || '';
        const q = `%${ctx.url.searchParams.get('q') || ''}%`;
        const rows = (await db.prepare(`SELECT * FROM cs_log WHERE id < ? AND (? = '' OR kind = ?) AND (actor LIKE ? OR action LIKE ? OR detail LIKE ?)
          ORDER BY id DESC LIMIT 100`).bind(before, kind, kind, q, q, q).all()).results;
        return send({ ok: true, log: rows });
      }
      case 'settings':
        return send({ ok: true, settings: cfg, defaults: DEFAULT_SETTINGS, autoCurrent: ctx.index.current || DEFAULT_EV,
          events: ctx.index.majors.filter((m) => m.pickem).map((m) => ({ id: m.id, name: m.name, status: m.status })) });
      case 'majors': {
        const rows = (await db.prepare('SELECT * FROM cs_majorinfo').all()).results;
        const info = Object.fromEntries(rows.map((r) => [r.ev, { ...JSON.parse(r.data), updated: r.updated, by: r.by }]));
        return send({ ok: true, current: ctx.current, checked: ctx.index.checked || null, errors: ctx.index.errors || [],
          majors: ctx.index.majors.map((m) => ({ ...m, extra: info[m.id] || null })) });
      }
      case 'export':
        return send({ ok: true, ...(await exportAll(db, cfg)) });
      case 'backups': {
        const rows = (await db.prepare('SELECT id, at, kind, size FROM cs_backups ORDER BY id DESC').all()).results;
        return send({ ok: true, backups: rows });
      }
      case 'backup': {
        const row = await db.prepare('SELECT data FROM cs_backups WHERE id = ?').bind(Number(ctx.url.searchParams.get('id'))).first();
        if (!row) throw new HttpError(404, 'No existe esa copia.');
        return send({ ok: true, ...JSON.parse(row.data) });
      }
      default:
        throw new HttpError(404, 'Ruta desconocida.');
    }
  }
  // ---------------------------------------------------------------- acciones
  const teamOrNull = (v) => (v == null || v === '' ? null : cleanText(v, 1, 40, 'El equipo'));
  switch (what) {
    case 'fix': {                                                  // corregir resultado, equipos u hora de un partido
      const mid = String(body.mid || '');
      if (!all.byId.get(mid) && !body.hidden) throw new HttpError(404, 'No existe ese partido.');
      const old = await db.prepare('SELECT * FROM cs_fixes WHERE ev = ? AND mid = ?').bind(ev, mid).first() || {};
      const winner = body.winner === '' || body.winner == null ? (body.clearResult ? null : old.winner ?? null) : Number(body.winner);
      if (winner != null && ![0, 1, 2].includes(winner)) throw new HttpError(400, 'Ganador no válido.');
      const n = (v, o) => (v === '' || v == null ? o ?? null : Math.max(0, Math.min(9, Math.trunc(Number(v)))));
      const date = body.date === undefined ? old.date ?? null : body.date ? new Date(body.date).toISOString() : null;
      const row = { winner, s1: winner ? n(body.s1, old.s1) : null, s2: winner ? n(body.s2, old.s2) : null, date,
        t1: body.t1 === undefined ? old.t1 ?? null : teamOrNull(body.t1), t2: body.t2 === undefined ? old.t2 ?? null : teamOrNull(body.t2), hidden: body.hidden ? 1 : 0 };
      if (row.winner && row.s1 != null && row.s2 != null && (row.winner === 1 ? row.s1 <= row.s2 : row.s2 <= row.s1)) throw new HttpError(400, 'El marcador no cuadra con el ganador.');
      await db.prepare(`INSERT INTO cs_fixes (ev, mid, winner, s1, s2, date, t1, t2, hidden, updated, by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (ev, mid) DO UPDATE SET winner = excluded.winner, s1 = excluded.s1, s2 = excluded.s2, date = excluded.date, t1 = excluded.t1, t2 = excluded.t2,
        hidden = excluded.hidden, updated = excluded.updated, by = excluded.by`).bind(ev, mid, row.winner, row.s1, row.s2, row.date, row.t1, row.t2, row.hidden, iso(), me.nick).run();
      const m = all.byId.get(mid);
      await log(row.hidden ? 'Partido ocultado' : 'Partido corregido', m ? `${m.t1} vs ${m.t2}${row.winner ? ` · gana ${row.winner === 1 ? (row.t1 || m.t1) : (row.t2 || m.t2)} ${row.s1 ?? ''}-${row.s2 ?? ''}` : ''}` : mid, `m:${mid}`);
      return send({ ok: true });
    }
    case 'fix-clear': {
      await db.prepare('DELETE FROM cs_fixes WHERE ev = ? AND mid = ?').bind(ev, String(body.mid || '')).run();
      await log('Corrección quitada', String(body.mid || ''), `m:${body.mid}`);
      return send({ ok: true });
    }
    case 'match-add': {                                            // partido añadido a mano
      const stage = String(body.stage || '');
      const s = all.stages.find((x) => x.id === stage);
      if (!s) throw new HttpError(400, 'Fase no válida.');
      const bo = Number(body.bo);
      if (![1, 3, 5].includes(bo)) throw new HttpError(400, 'El partido tiene que ser al mejor de 1, 3 o 5.');
      const slot = s.type === 'bracket' ? String(body.slot || '') : '';
      if (slot && !BRACKET_SLOTS.concat('R3M2').includes(slot)) throw new HttpError(400, 'Posición del cuadro no válida.');
      const kind = slot ? (slot.startsWith('R1') ? 'qf' : slot.startsWith('R2') ? 'sf' : slot === 'R3M2' ? 'third' : 'final') : '';
      const id = `x-${stage}-${randomHex(4)}`;
      await db.prepare('INSERT INTO cs_xmatches (id, ev, stage, round, slot, kind, bo, date, t1, t2, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, ev, stage, cleanText(body.round, 1, 60, 'La ronda'), slot, kind, bo, body.date ? new Date(body.date).toISOString() : null,
          teamOrNull(body.t1) || 'TBD', teamOrNull(body.t2) || 'TBD', iso()).run();
      await log('Partido añadido a mano', `${s.name} · ${body.round}: ${body.t1 || 'TBD'} vs ${body.t2 || 'TBD'}`, `m:${id}`);
      return send({ ok: true, id });
    }
    case 'match-delete': {
      const id = String(body.mid || '');
      if (!id.startsWith('x-')) throw new HttpError(400, 'Solo se pueden borrar los partidos añadidos a mano (los de Liquipedia se ocultan).');
      await db.batch([db.prepare('DELETE FROM cs_xmatches WHERE id = ?').bind(id), db.prepare('DELETE FROM cs_fixes WHERE ev = ? AND mid = ?').bind(ev, id),
        db.prepare('DELETE FROM cs_picks WHERE ev = ? AND mid = ?').bind(ev, id)]);
      await log('Partido borrado', id, `m:${id}`);
      return send({ ok: true });
    }
    case 'stage-teams': {                                          // equipos de una fase (si Liquipedia aún no los tiene)
      const stage = String(body.stage || '');
      if (!all.stages.some((s) => s.id === stage)) throw new HttpError(400, 'Fase no válida.');
      if (!body.teams) {
        await db.prepare('DELETE FROM cs_stageteams WHERE ev = ? AND stage = ?').bind(ev, stage).run();
        await log('Equipos de fase: automáticos', stage);
        return send({ ok: true });
      }
      const teams = [...new Set((Array.isArray(body.teams) ? body.teams : String(body.teams).split(/\n|,/)).map((t) => String(t).trim()).filter(Boolean))];
      if (teams.length > 32) throw new HttpError(400, 'Demasiados equipos.');
      await db.prepare(`INSERT INTO cs_stageteams (ev, stage, teams, updated) VALUES (?, ?, ?, ?) ON CONFLICT (ev, stage) DO UPDATE SET teams = excluded.teams, updated = excluded.updated`)
        .bind(ev, stage, JSON.stringify(teams), iso()).run();
      await log('Equipos de fase puestos a mano', `${stage}: ${teams.join(', ')}`);
      return send({ ok: true });
    }
    case 'pick': {                                                 // poner o borrar el pronóstico de alguien (sin límites)
      const u = await userById(body.user);
      const m = all.byId.get(String(body.mid || ''));
      if (!m) throw new HttpError(404, 'No existe ese partido.');
      if (!body.team) {
        await db.prepare('DELETE FROM cs_picks WHERE ev = ? AND user = ? AND mid = ?').bind(ev, u.id, m.id).run();
        await log('Pronóstico borrado', `${u.nick} · ${m.t1} vs ${m.t2}`, `u:${u.id}`);
        return send({ ok: true });
      }
      if (body.team !== m.t1 && body.team !== m.t2) throw new HttpError(400, 'Ese equipo no juega este partido.');
      const score = checkScore(m, body.score);
      await db.prepare(`INSERT INTO cs_picks (ev, user, mid, team, score, updated) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (ev, user, mid) DO UPDATE SET team = excluded.team, score = excluded.score, updated = excluded.updated`).bind(ev, u.id, m.id, body.team, score, iso()).run();
      await log('Pronóstico puesto', `${u.nick} · ${m.t1} vs ${m.t2}: ${body.team}${score ? ' ' + score : ''}`, `u:${u.id}`);
      return send({ ok: true });
    }
    case 'user-pin': {
      const u = await userById(body.user);
      const pin = checkPin(body.pin);
      await db.prepare('UPDATE cs_users SET pin = ?, fails = 0, locked_until = 0 WHERE id = ?').bind(await pinHash(u.nick, pin), u.id).run();
      await log('PIN cambiado', u.nick, `u:${u.id}`);
      return send({ ok: true });
    }
    case 'user-unlock': {
      const u = await userById(body.user);
      await db.prepare('UPDATE cs_users SET fails = 0, locked_until = 0 WHERE id = ?').bind(u.id).run();
      await log('Cuenta desbloqueada', u.nick, `u:${u.id}`);
      return send({ ok: true });
    }
    case 'user-rename': {
      const u = await userById(body.user);
      const nick = checkNick(body.nick); const pin = checkPin(body.pin);
      const taken = await db.prepare('SELECT id FROM cs_users WHERE nick = ? COLLATE NOCASE AND id != ?').bind(nick, u.id).first();
      if (taken) throw new HttpError(409, `Ya existe otra cuenta con el apodo «${nick}».`);
      await db.prepare('UPDATE cs_users SET nick = ?, pin = ? WHERE id = ?').bind(nick, await pinHash(nick, pin), u.id).run();
      await log('Apodo cambiado', `${u.nick} → ${nick}`, `u:${u.id}`);
      return send({ ok: true });
    }
    case 'user-logout': {
      const u = await userById(body.user);
      await db.prepare('UPDATE cs_users SET token = ? WHERE id = ?').bind(randomHex(24), u.id).run();
      await log('Sesiones cerradas', u.nick, `u:${u.id}`);
      return send({ ok: true });
    }
    case 'user-delete': {
      const u = await userById(body.user);
      if (u.id === me.id) throw new HttpError(400, 'No puedes borrar tu propia cuenta desde aquí.');
      await db.batch(['cs_picks', 'cs_combos', 'cs_stagepicks', 'cs_bracket', 'cs_champion', 'cs_adjust'].map((t) => db.prepare(`DELETE FROM ${t} WHERE user = ?`).bind(u.id))
        .concat(db.prepare('DELETE FROM cs_members WHERE user = ?').bind(u.id), db.prepare('DELETE FROM cs_users WHERE id = ?').bind(u.id)));
      await log('Cuenta borrada', u.nick, `u:${u.id}`);
      return send({ ok: true });
    }
    case 'league-rename': {
      const lg = await getLeague(db, body.code);
      const name = cleanText(body.name, 2, 40, 'El nombre del grupo');
      await db.prepare('UPDATE cs_leagues SET name = ? WHERE code = ?').bind(name, lg.code).run();
      await log('Grupo renombrado', `${lg.name} → ${name}`, `l:${lg.code}`);
      return send({ ok: true });
    }
    case 'league-add': {
      const lg = await getLeague(db, body.code);
      const u = await db.prepare('SELECT * FROM cs_users WHERE nick = ? COLLATE NOCASE').bind(String(body.nick || '')).first();
      if (!u) throw new HttpError(404, 'No existe esa cuenta.');
      await db.prepare('INSERT OR IGNORE INTO cs_members (league, user, joined) VALUES (?, ?, ?)').bind(lg.code, u.id, iso()).run();
      await log('Jugador añadido a un grupo', `${u.nick} → ${lg.name}`, `l:${lg.code}`);
      return send({ ok: true });
    }
    case 'league-kick': {
      const lg = await getLeague(db, body.code); const u = await userById(body.user);
      await db.prepare('DELETE FROM cs_members WHERE league = ? AND user = ?').bind(lg.code, u.id).run();
      await log('Jugador quitado de un grupo', `${u.nick} ← ${lg.name}`, `l:${lg.code}`);
      return send({ ok: true });
    }
    case 'league-delete': {
      const lg = await getLeague(db, body.code);
      await db.batch([db.prepare('DELETE FROM cs_members WHERE league = ?').bind(lg.code), db.prepare('DELETE FROM cs_adjust WHERE league = ?').bind(lg.code),
        db.prepare('DELETE FROM cs_leagues WHERE code = ?').bind(lg.code)]);
      await log('Grupo borrado', `${lg.name} (${lg.code})`, `l:${lg.code}`);
      return send({ ok: true });
    }
    case 'adjust-add': {
      const lg = await getLeague(db, body.code); const u = await userById(body.user);
      const points = Math.trunc(Number(body.points));
      if (!points || Math.abs(points) > 1000) throw new HttpError(400, 'Pon un número de puntos distinto de 0.');
      const reason = cleanText(body.reason, 2, 120, 'El motivo');
      await db.prepare('INSERT INTO cs_adjust (ev, league, user, points, reason, by, created) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(ev, lg.code, u.id, points, reason, me.nick, iso()).run();
      await log('Puntos ajustados', `${u.nick} en ${lg.name}: ${points > 0 ? '+' : ''}${points} (${reason})`, `l:${lg.code}`);
      return send({ ok: true });
    }
    case 'adjust-delete': {
      const a = await db.prepare('SELECT * FROM cs_adjust WHERE id = ?').bind(Number(body.id)).first();
      if (!a) throw new HttpError(404, 'No existe ese ajuste.');
      await db.prepare('DELETE FROM cs_adjust WHERE id = ?').bind(a.id).run();
      await log('Ajuste de puntos quitado', `${a.points} (${a.reason})`, `l:${a.league}`);
      return send({ ok: true });
    }
    case 'settings': {
      const next = normalizeSettings(body.settings || {});
      await db.prepare("INSERT INTO cs_meta (k, v) VALUES ('settings', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v").bind(JSON.stringify(next)).run();
      const diff = diffSettings(cfg, next);
      if (diff.length) await log('Ajustes cambiados', diff.join(' · '));
      return send({ ok: true, settings: next });
    }
    case 'majorinfo': {                                            // MVP y nota de un Major (se muestran en el historial)
      const id = String(body.id || '');
      if (!ctx.index.majors.some((m) => m.id === id)) throw new HttpError(404, 'No existe ese Major.');
      const data = { mvp: String(body.mvp || '').trim().slice(0, 40), note: String(body.note || '').trim().slice(0, 400) };
      if (!data.mvp && !data.note) await db.prepare('DELETE FROM cs_majorinfo WHERE ev = ?').bind(id).run();
      else await db.prepare(`INSERT INTO cs_majorinfo (ev, data, updated, by) VALUES (?, ?, ?, ?) ON CONFLICT (ev) DO UPDATE SET data = excluded.data,
        updated = excluded.updated, by = excluded.by`).bind(id, JSON.stringify(data), iso(), me.nick).run();
      await log('Datos de un Major cambiados', `${id}: MVP ${data.mvp || '—'}${data.note ? ' · nota' : ''}`, `e:${id}`);
      return send({ ok: true });
    }
    case 'backup-now': {
      await saveBackup(db, 'manual');
      await log('Copia de seguridad hecha a mano', '', 'backup');
      return send({ ok: true });
    }
    case 'settings-reset': {
      await db.prepare("DELETE FROM cs_meta WHERE k = 'settings'").run();
      await log('Ajustes restablecidos');
      return send({ ok: true, settings: DEFAULT_SETTINGS });
    }
    default:
      throw new HttpError(404, 'Ruta desconocida.');
  }
}

export { records, valveState, evalStagePick, evalBracket, checkBracket, evalCombo, normalizeSettings };   // para las pruebas
