import { call, getMatches, clearMatches, session, saveSession, ApiError } from './api.js';
import { createAdmin } from './admin.js';
import { createMajors } from './majors.js';
import { createStats } from './stats.js';

const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isTbd = (t) => !t || /^TBD$/i.test(t);
const DAY = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
const TIME = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });
const fmtDate = (d) => (d ? DAY.format(d).replace('.', '') : 'Fecha por confirmar');
const fmtTime = (d) => (d ? TIME.format(d) : '');
const fmtDayTime = (d) => (d ? `${fmtDate(d)} · ${fmtTime(d)}` : 'Hora por confirmar');

// ---------------------------------------------------------------- equipos
const SHORT = {
  Vitality: 'VIT', 'Team Spirit': 'SPI', MOUZ: 'MOUZ', 'Team Falcons': 'FAL', 'The MongolZ': 'MGLZ', FURIA: 'FUR', 'Natus Vincere': 'NAVI',
  'FaZe Clan': 'FAZE', 'G2 Esports': 'G2', Aurora: 'AUR', '3DMAX': '3DM', 'paiN Gaming': 'PAIN', Legacy: 'LGC', Astralis: 'AST',
  'Team Liquid': 'TL', MIBR: 'MIBR', HEROIC: 'HER', NRG: 'NRG', 'Virtus.pro': 'VP', GamerLegion: 'GL', B8: 'B8', 'Lynn Vision': 'LVG',
  TYLOO: 'TYL', 'BetBoom Team': 'BB', PARIVISION: 'PARI', Fnatic: 'FNC', Complexity: 'COL', BIG: 'BIG', ENCE: 'ENCE', 'Eternal Fire': 'EF',
  Cloud9: 'C9', Imperial: 'IMP', Wildcard: 'WC', M80: 'M80', FlyQuest: 'FLY', 'Rare Atom': 'RA', 'Ninjas in Pyjamas': 'NIP',
};
const shortOf = (t) => (isTbd(t) ? 'TBD' : SHORT[t] || t.replace(/^(Team|The)\s+/i, '').replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase());
const hue = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
// Logos descargados de Liquipedia (data/teams.json). Si un equipo no tiene, se ven sus iniciales.
const LOGOS = {};
const logosReady = fetch(`data/teams.json?v=${Math.floor(Date.now() / 600_000)}`).then((r) => (r.ok ? r.json() : {})).then((d) => {
  for (const [name, v] of Object.entries(d.teams || {})) if (v.logo || v.dark) LOGOS[name] = v;
}).catch(() => {});
const badge = (t, cls = '') => {
  if (isTbd(t)) return `<span class="tb tb--tbd ${cls}" aria-hidden="true">?</span>`;
  const lg = !cls.includes('tb--me') && LOGOS[t];
  if (lg) return `<span class="tb tb--logo ${lg.dark ? '' : 'tb--light'} ${cls}" aria-hidden="true"><img src="${esc(lg.dark || lg.logo)}" alt="" loading="lazy" decoding="async" onerror="this.parentNode.classList.remove('tb--logo','tb--light');this.parentNode.style.setProperty('--h',${hue(t)});this.replaceWith(${JSON.stringify(shortOf(t)).replace(/"/g, '&quot;')})"></span>`;
  return `<span class="tb ${cls}" style="--h:${hue(t)}" aria-hidden="true">${esc(shortOf(t))}</span>`;
};
/** «Round 2: High Matches» → «Ronda 2 · alta» */
function roundEs(r) {
  return String(r || '')
    .replace(/Round\s*(\d+)/i, 'Ronda $1').replace(/\s*Matches?\b/gi, '').replace(/\bHigh\b/i, 'alta').replace(/\bLow\b/i, 'baja')
    .replace(/\bMid\b/i, 'media').replace(/Advancement/i, 'clasificación').replace(/Elimination/i, 'eliminación').replace(/:\s*/, ' · ').trim();
}
const stageName = (id) => S.data?.stages?.find((s) => s.id === id)?.name || { s1: 'Stage 1', s2: 'Stage 2', s3: 'Stage 3', po: 'Playoffs' }[id] || id;
const scoresFor = (bo) => { const need = Math.floor(bo / 2) + 1; return bo > 1 ? Array.from({ length: need }, (_, l) => `${need}-${l}`) : []; };
const started = (m, now = S.now()) => m.done || (m.time && now >= m.time.getTime());
const winnerTeam = (m) => (m.winner === 1 ? m.t1 : m.winner === 2 ? m.t2 : null);
const realScore = (m) => `${Math.max(m.s1, m.s2)}-${Math.min(m.s1, m.s2)}`;
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;

// ---------------------------------------------------------------- estado
const S = {
  data: null, me: null, board: null, code: null, ev: '', tab: 'partidos', stage: null, stageDraft: {}, bracketDraft: null, combo: null, skew: 0,
  now: () => Date.now() + S.skew,
};
let admin = null;
const majors = createMajors({ esc, badge, fmtDate, fmtDayTime, call, $app });
const stats = createStats({ esc, badge, fmtDate, fmtDayTime, $app, majors });
const past = () => !!S.data && S.data.ev !== S.data.current;          // Major ya cerrado: solo lectura
const adminView = () => (admin = admin || createAdmin({ call, esc, $app, badge, fmtDate, fmtTime, fmtDayTime, roundEs, getMatches, clearMatches, route, isTbd }));

// ---------------------------------------------------------------- router
async function route() {
  await logosReady;
  const hash = location.hash.replace(/^#\/?/, '');
  let [page, arg, arg2, arg3] = hash.split('/');
  if (!page) page = 'majors';                         // la portada es el historial de Majors; el Pick'em está en #/pickem
  document.body.dataset.page = page;
  const nav = ['majors', 'equipos', 'jugadores'].includes(page) ? page : page === 'admin' ? '' : 'pickem';
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('is-on', a.dataset.nav === nav));
  if (page === 'admin') { renderTop(); $app.innerHTML = await adminView().view(arg || 'resumen'); return; }
  if (!admin?.isOpen?.() && !majors.isOpen() && !stats.isOpen()) $app.innerHTML = `<div class="loading" role="status"><span></span>Cargando…</div>`;
  if (['majors', 'equipos', 'jugadores'].includes(page)) {
    const a = arg ? decodeURIComponent(arg) : '';
    try {
      $app.innerHTML = page === 'equipos' ? (a ? await stats.team(a) : await stats.teamsList())
        : page === 'jugadores' ? (a ? await stats.player(a) : await stats.playersList())
          : a && arg2 === 'p' && arg3 ? await stats.match(a, decodeURIComponent(arg3))
            : a ? await majors.detail(a) : await majors.list();
      if (!(page === 'majors' && a && !arg2 && S.lastMajor === a)) window.scrollTo(0, 0);
      S.lastMajor = page === 'majors' && !arg2 ? a : S.lastMajor;
    } catch (err) {
      $app.innerHTML = `<div class="state state--error"><p><b>No se pudo cargar el historial (${esc(err.message)}).</b></p><button class="btn" type="button" onclick="location.reload()">Reintentar</button></div>`;
    }
    if (!S.me && session().token) call('GET', '/me').then((me) => { S.me = me; renderTop(); }).catch(() => {});
    return;
  }
  try {
    S.ev = page === 'g' && arg2 ? decodeURIComponent(arg2) : '';
    S.data = await getMatches(S.ev);
    S.skew = S.data.now - Date.now();
    const s = session();
    S.me = null;
    if (s.token) {
      try { S.me = await call('GET', `/me${S.ev ? `?ev=${encodeURIComponent(S.ev)}` : ''}`); S.skew = S.me.now - Date.now(); } catch (err) { if (err.status === 401) saveSession({}); else throw err; }
    }
    renderTop();
    if (page === 'g' && arg) {
      const code = arg.toUpperCase();
      if (S.me && S.me.leagues.some((l) => l.code === code)) { S.code = code; $app.innerHTML = await viewGroup(code); }
      else $app.innerHTML = await viewInvite(code);
    } else {
      const idx = await majors.getIndex().catch(() => null);
      $app.innerHTML = S.me ? viewHub(idx) : viewLanding(idx);
    }
  } catch (err) {
    $app.innerHTML = `<div class="state state--error"><p><b>${esc(err.message)}</b></p><button class="btn" type="button" onclick="location.reload()">Reintentar</button></div>`;
  }
}
window.addEventListener('hashchange', () => { S.board = null; S.stageDraft = {}; S.bracketDraft = null; S.combo = null; route(); });

function renderTop() {
  const me = S.me;
  document.getElementById('topUser').innerHTML = me
    ? `${me.admin ? '<a class="btn btn--ghost btn--sm top__admin" href="#/admin" aria-label="Administración">⚙<span>Admin</span></a>' : ''}<span class="top__nick" title="Tu cuenta">${badge(me.user.nick, 'tb--me')}<b>${esc(me.user.nick)}</b></span>`
    : '';
}

// ---------------------------------------------------------------- portada
function countdown() {
  const st = S.data.start;
  if (!st) return 'Fechas por confirmar';
  const left = st - S.now();
  if (left <= 0) return S.data.champion ? `Campeón: ${S.data.champion}` : 'En juego';
  const d = Math.floor(left / 864e5); const h = Math.floor((left % 864e5) / 36e5);
  return d > 0 ? `Empieza en ${d} d ${h} h` : `Empieza en ${h} h ${Math.floor((left % 36e5) / 6e4)} min`;
}
function stagesStrip() {
  const range = (id) => {
    const ts = S.data.matches.filter((m) => m.stage === id && m.time).map((m) => m.time.getTime());
    return ts.length ? `${fmtDate(new Date(Math.min(...ts)))} – ${fmtDate(new Date(Math.max(...ts)))}` : 'por confirmar';
  };
  return `<ol class="strip">${S.data.stages.map((s) => {
    const done = S.data.matches.filter((m) => m.stage === s.id); const fin = done.length && done.every((m) => m.done);
    return `<li class="strip__item ${fin ? 'is-done' : ''}"><b>${esc(s.name)}</b><span>${s.type === 'swiss' ? 'Suizo · 16 equipos' : 'Eliminatorias · 8 equipos'}</span><small>${range(s.id)}</small></li>`;
  }).join('')}</ol>`;
}
function authBox(intro = '') {
  return `<section class="authbox" id="auth">
      <div class="authbox__tabs" role="tablist">
        <button type="button" role="tab" class="is-on" data-auth="register">Crear cuenta</button>
        <button type="button" role="tab" data-auth="login">Ya tengo cuenta</button>
      </div>
      <form class="form" data-form="register" autocomplete="off">
        ${intro ? `<p class="hint">${intro}</p>` : ''}
        <label>Elige un apodo<input class="input" name="nick" maxlength="20" placeholder="Como te verán tus amigos" required></label>
        <div class="form__pair">
          <label>PIN de 4 cifras<input class="input pin" name="pin" type="password" inputmode="numeric" pattern="\\d{4}" maxlength="4" placeholder="••••" required></label>
          <label>Repite el PIN<input class="input pin" name="pin2" type="password" inputmode="numeric" pattern="\\d{4}" maxlength="4" placeholder="••••" required></label>
        </div>
        <p class="hint">Con tu apodo y tu PIN entrarás desde cualquier móvil u ordenador. Apúntalo: no se puede recuperar.</p>
        <button class="btn btn--primary" type="submit">Crear mi cuenta</button>
        <p class="form__msg" role="alert"></p>
      </form>
      <form class="form" data-form="login" autocomplete="off" hidden>
        <div class="form__pair">
          <label>Tu apodo<input class="input" name="nick" maxlength="20" required></label>
          <label>PIN<input class="input pin" name="pin" type="password" inputmode="numeric" pattern="\\d{4}" maxlength="4" placeholder="••••" required></label>
        </div>
        <button class="btn btn--primary" type="submit">Entrar</button>
        <p class="form__msg" role="alert"></p>
      </form>
    </section>`;
}
function pointsHtml(title = 'Así se puntúa') {
  const p = S.data.settings;
  const tok = (n, t) => `<div class="tok"><b>${n}</b><span>${t}</span></div>`;
  return `<section class="points">
      <h2 class="h2">${title}</h2>
      <div class="points__grid">
        <article class="card"><h3>Partido a partido</h3><div class="toks">${tok(p.points.win, 'por acertar el ganador')}${tok('+' + p.points.exact, 'si clavas el resultado (Bo3/Bo5)')}${tok('×' + p.points.koMult, 'en cuartos, semis y 3.º puesto')}${tok('×' + p.points.finalMult, 'en la Gran Final')}</div></article>
        ${p.valve.enabled ? `<article class="card"><h3>Pick'em de cada fase</h3><div class="toks">${tok(p.valve.p30, 'por cada 3-0 acertado (eliges 2)')}${tok(p.valve.p03, 'por cada 0-3 acertado (eliges 2)')}${tok(p.valve.adv, 'por cada equipo que pasa con 3-1 o 3-2 (eliges 6)')}</div></article>` : ''}
        ${p.bracket.enabled ? `<article class="card"><h3>Cuadro de playoffs</h3><div class="toks">${tok(p.bracket.qf, 'por cada ganador de cuartos')}${tok(p.bracket.sf, 'por cada ganador de semis')}${tok(p.bracket.final, 'si aciertas al campeón del cuadro')}</div></article>` : ''}
        <article class="card"><h3>Extras</h3><div class="toks">${tok(p.points.champion, 'por el campeón elegido antes de empezar')}${p.combo.enabled ? tok(`${p.combo.p2}/${p.combo.p3}/${p.combo.p4}`, 'combinada de 2, 3 o 4 partidos de una ronda (todos acertados)') : ''}</div></article>
      </div>
    </section>`;
}
function bannerHtml() {
  const s = S.data.settings;
  return (s.banner ? `<div class="notice"><span aria-hidden="true">📣</span><p>${esc(s.banner)}</p></div>` : '')
    + (s.picksOpen === false ? '<div class="notice notice--warn"><span aria-hidden="true">⏸</span><p>Los pronósticos están cerrados temporalmente por el administrador.</p></div>' : '');
}
function historyTeaser(idx) {
  if (!idx) return '';
  const done = idx.majors.filter((m) => m.status === 'done' && m.champion).slice(-4).reverse();
  if (!done.length) return '';
  return `<section class="teaser"><div class="teaser__head"><h2 class="h2">Historial de Majors</h2><a class="btn btn--sm" href="#/majors">Ver los ${idx.majors.filter((m) => m.status === 'done').length} Majors</a></div>
      <div class="teaser__grid">${done.map((m) => `<a class="tz" href="#/majors/${esc(m.id)}"><small>${m.year} · ${majors.flag(m.country)} ${esc(m.city)}</small>${badge(m.champion)}<b>${esc(m.champion)}</b><span>${esc(m.final ? m.final.replace('-', '–') : '')} a ${esc(m.runnerup)}</span></a>`).join('')}</div></section>`;
}
function viewLanding(idx) {
  const ev = S.data.event || {};
  const teams = S.data.teams;
  return `${bannerHtml()}<section class="hero">
      <div class="hero__text">
        <p class="kicker">${esc(countdown())}</p>
        <h1 class="hero__title">Pick'em del <span>${esc(ev.name || 'Major')}</span></h1>
        <p class="lead">Pronostica cada partido del Major con tus amigos, rellena el Pick'em de cada fase como en el juego y arma tu cuadro de playoffs. Los resultados se apuntan solos.</p>
        <div class="hero__cta"><a class="btn btn--primary" href="#auth" data-auth-go="register">Crear mi cuenta</a><a class="btn" href="#auth" data-auth-go="login">Ya tengo cuenta</a></div>
      </div>
      <div class="hero__art" aria-hidden="true">${heroArt()}</div>
    </section>
    ${stagesStrip()}
    <ol class="steps">
      <li><b>Crea tu cuenta</b><span>Un apodo y un PIN de 4 cifras. Sin correos.</span></li>
      <li><b>Crea o únete a un grupo</b><span>Pasa el enlace o el código de 6 letras a tus amigos.</span></li>
      <li><b>Pronostica</b><span>Partidos, Pick'em de fases y cuadro. La web suma los puntos sola.</span></li>
    </ol>
    <div class="duo">${authBox()}${pointsHtml()}</div>
    ${historyTeaser(idx)}
    ${teams.length ? `<section><h2 class="h2">${plural(teams.length, 'equipo', 'equipos')}</h2><div class="teams">${teams.map((t) => `<span class="teams__item">${badge(t)}<span>${esc(t)}</span></span>`).join('')}</div></section>` : ''}`;
}
function heroArt() {
  return `<svg viewBox="0 0 320 320" class="crosshair">
      <defs><radialGradient id="glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="var(--t)" stop-opacity=".35"/><stop offset="1" stop-color="var(--t)" stop-opacity="0"/></radialGradient></defs>
      <circle cx="160" cy="160" r="150" fill="url(#glow)"/>
      <circle cx="160" cy="160" r="104" fill="none" stroke="var(--line-2)" stroke-width="2"/>
      <circle cx="160" cy="160" r="70" fill="none" stroke="var(--t)" stroke-width="3" stroke-dasharray="6 10"/>
      <path d="M160 30v70M160 220v70M30 160h70M220 160h70" stroke="var(--t)" stroke-width="4" stroke-linecap="round"/>
      <circle cx="160" cy="160" r="6" fill="var(--t)"/>
      <path d="M110 110l18 18M210 110l-18 18M110 210l18-18M210 210l-18-18" stroke="var(--ct)" stroke-width="3" stroke-linecap="round"/>
    </svg>`;
}

// ---------------------------------------------------------------- inicio con cuenta
function viewHub(idx) {
  const me = S.me;
  const groups = me.leagues.map((l) => `<a class="group" href="#/g/${esc(l.code)}"><b>${esc(l.name)}</b><small>${plural(l.players, 'jugador', 'jugadores')} · código ${esc(l.code)}</small><span aria-hidden="true">›</span></a>`).join('');
  return `${bannerHtml()}<section class="hero hero--hub">
      <div class="hero__text">
        <p class="kicker">${esc(S.data.event?.name || '')} · ${esc(countdown())}</p>
        <h1 class="hero__title">Hola, <span>${esc(me.user.nick)}</span></h1>
        <p class="lead">${me.leagues.length ? 'Entra en un grupo para pronosticar y ver la clasificación. Tus pronósticos valen para todos tus grupos.' : 'Todavía no estás en ningún grupo. Crea uno y pasa el enlace, o únete con el código que te hayan dado.'}</p>
        <div class="hero__cta"><button class="btn btn--sm" type="button" data-act="logout">Cerrar sesión</button></div>
      </div>
      <div class="hero__art" aria-hidden="true">${heroArt()}</div>
    </section>
    ${stagesStrip()}
    ${groups ? `<h2 class="h2">Tus grupos</h2><div class="groups">${groups}</div>` : ''}
    <div class="duo">
      <form class="card form" data-form="create" autocomplete="off"><h3>Crear un grupo</h3>
        <label>Nombre del grupo<input class="input" name="name" maxlength="40" placeholder="Los del insti" required></label>
        <button class="btn btn--primary" type="submit">Crear el grupo</button><p class="form__msg" role="alert"></p></form>
      <form class="card form" data-form="join" autocomplete="off"><h3>Unirme con un código</h3>
        <label>Código del grupo<input class="input code" name="code" maxlength="6" placeholder="ABC123" autocapitalize="characters" required></label>
        <button class="btn" type="submit">Unirme</button><p class="form__msg" role="alert"></p></form>
    </div>
    ${historyTeaser(idx)}
    ${pointsHtml()}`;
}
async function viewInvite(code) {
  let lg;
  try { lg = (await call('GET', `/league/${code}`)).league; } catch (err) {
    return `<div class="state state--error"><p><b>${esc(err.message)}</b></p><a class="btn" href="#/pickem">Volver al Pick'em</a></div>`;
  }
  return `<section class="hero">
      <div class="hero__text">
        <p class="kicker">Invitación · código ${esc(lg.code)}</p>
        <h1 class="hero__title"><span>${esc(lg.name)}</span></h1>
        <p class="lead">Te han invitado a su Pick'em del ${esc(S.data.event?.name || 'Major')}. ${lg.players === 1 ? 'Ya hay 1 jugador' : `Ya hay ${lg.players} jugadores`}.</p>
        ${S.me ? `<div class="card joincard"><p>Entras como <b>${esc(S.me.user.nick)}</b>.</p><button class="btn btn--primary" type="button" data-join="${esc(lg.code)}">Unirme a «${esc(lg.name)}»</button><p class="form__msg" role="alert"></p></div>` : ''}
      </div>
      <div class="hero__art" aria-hidden="true">${heroArt()}</div>
    </section>
    ${S.me ? '' : `<div class="duo">${authBox('Crea tu cuenta o entra con la tuya y después te unes con un clic.')}${pointsHtml()}</div>`}`;
}

// ---------------------------------------------------------------- grupo
const TABS = [['partidos', 'Partidos'], ['fases', "Pick'em de fases"], ['cuadro', 'Cuadro'], ['combinadas', 'Combinadas'], ['clasificacion', 'Clasificación'], ['jugados', 'Jugados'], ['reglas', 'Reglas']];
async function viewGroup(code) {
  S.board = await call('GET', `/board/${code}${S.ev ? `?ev=${encodeURIComponent(S.ev)}` : ''}`);
  const lg = S.me.leagues.find((l) => l.code === code);
  const mine = S.board.board.find((r) => r.nick === S.me.user.nick);
  const set = S.data.settings;
  const tabs = TABS.filter(([k]) => (k !== 'combinadas' || set.combo.enabled) && (k !== 'fases' || set.valve.enabled) && (k !== 'cuadro' || set.bracket.enabled));
  if (!tabs.some(([k]) => k === S.tab)) S.tab = 'partidos';
  if (past() && S.tab === 'partidos') S.tab = 'clasificacion';
  const evs = (S.data.events || []).filter((e) => e.status !== 'upcoming' || e.id === S.data.current);
  const evNav = evs.length > 1 ? `<div class="seg seg--ev">${evs.map((e) => `<a class="${e.id === S.data.ev ? 'is-on' : ''}" href="#/g/${esc(code)}${e.id === S.data.current ? '' : '/' + esc(e.id)}">${esc(e.city)} ${e.start.slice(0, 4)}${e.id === S.data.current ? '<small>actual</small>' : ''}</a>`).join('')}</div>` : '';
  const pend = past() ? 0 : openMatches().filter((m) => !pickOf(m.id)).length;
  return `${bannerHtml()}<section class="ghead">
      <div class="ghead__main">
        <p class="kicker">${esc(S.data.event?.name || '')} · código <b class="code">${esc(code)}</b></p>
        ${evNav}
        <h1 class="ghead__title">${esc(lg.name)}</h1>
        <p class="lead">Juegas como <b>${esc(S.me.user.nick)}</b>${mine ? ` · vas <b>${mine.pos}.º</b> con <b>${mine.points}</b> ${mine.points === 1 ? 'punto' : 'puntos'}` : ''}</p>
      </div>
      <div class="ghead__act">
        <button class="btn btn--primary btn--sm" type="button" data-invite="${esc(code)}" data-name="${esc(lg.name)}">Invitar amigos</button>
        <a class="btn btn--sm" href="#/pickem">Mis grupos</a>
        <button class="btn btn--ghost btn--sm" type="button" data-leave="${esc(code)}">Salir del grupo</button>
      </div>
    </section>
    ${past() ? `<div class="notice"><span aria-hidden="true">🗂</span><p>Estás viendo el Pick'em del <b>${esc(S.data.event?.name || '')}</b>, que ya está cerrado. <a href="#/g/${esc(code)}">Volver al Major actual</a> · <a href="#/majors/${esc(S.data.ev)}">Ver el Major</a></p></div>` : ''}
    <nav class="tabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" class="tabs__btn ${k === S.tab ? 'is-on' : ''}" data-tab="${k}" aria-selected="${k === S.tab}">${l}${k === 'partidos' && pend ? `<span class="dot">${pend}</span>` : ''}</button>`).join('')}</nav>
    <div id="tabBody">${tabBody()}</div>`;
}
function tabBody() {
  switch (S.tab) {
    case 'fases': return tabStages();
    case 'cuadro': return tabBracket();
    case 'combinadas': return tabCombos();
    case 'clasificacion': return tabBoard();
    case 'jugados': return tabPlayed();
    case 'reglas': return pointsHtml('Reglas');
    default: return tabMatches();
  }
}
const rerender = () => { const el = document.getElementById('tabBody'); if (el) el.innerHTML = tabBody(); };
const pickOf = (mid) => S.me.picks.find((p) => p.mid === mid);
const openMatches = () => (past() ? [] : S.data.matches.filter((m) => !started(m) && !isTbd(m.t1) && !isTbd(m.t2)));

// ---- partidos
function championPanel() {
  const start = S.data.start;
  const locked = past() || (start && S.now() >= start);
  const mine = S.me.champion;
  const champ = S.data.champion;
  const pts = S.data.settings.points.champion;
  if (locked) {
    return `<section class="card champ"><h3>🏆 Campeón del Major <span class="pill">${pts} puntos</span></h3>
      <p>${mine ? `Elegiste ${badge(mine)} <b>${esc(mine)}</b>${champ ? (champ === mine ? ' · <span class="ok">¡Acertado!</span>' : ` · <span class="ko">Ganó ${esc(champ)}</span>`) : ''}` : 'No elegiste campeón antes de que empezara el Major.'}</p></section>`;
  }
  return `<section class="card champ"><h3>🏆 ¿Quién ganará el Major? <span class="pill">${pts} puntos</span></h3>
      <div class="champ__row"><select class="input" data-champion><option value="">Elige un equipo…</option>${S.data.teams.map((t) => `<option ${t === mine ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
      <span class="hint">${mine ? 'Guardado. ' : ''}Se puede cambiar hasta que empiece el primer partido${start ? ` (${fmtDayTime(new Date(start))})` : ''}.</span></div></section>`;
}
function matchCard(m) {
  const p = pickOf(m.id);
  const scores = scoresFor(m.bo);
  const left = m.time ? m.time.getTime() - S.now() : null;
  const closes = left == null ? '' : left < 3600_000 ? `cierra en ${Math.max(1, Math.round(left / 60_000))} min` : fmtTime(m.time);
  const team = (t) => `<button type="button" class="pk__team ${p?.team === t ? 'is-on' : ''}" data-pick="${esc(m.id)}" data-team="${esc(t)}" aria-pressed="${p?.team === t}">${badge(t, 'tb--lg')}<span>${esc(t)}</span></button>`;
  return `<article class="pk ${p ? 'is-picked' : ''}" data-mid="${esc(m.id)}">
      <header class="pk__meta"><span>${esc(stageName(m.stage))} · ${esc(roundEs(m.round))} · Bo${m.bo}</span><span class="pk__time">${esc(closes)}</span></header>
      <div class="pk__teams">${team(m.t1)}<span class="pk__vs">vs</span>${team(m.t2)}</div>
      <footer class="pk__foot">${scores.length ? `<div class="pk__scores" role="group" aria-label="Resultado">${scores.map((s) => `<button type="button" class="chip ${p?.score === s ? 'is-on' : ''}" data-score="${esc(m.id)}" data-val="${s}" ${p ? '' : 'disabled'}>${s.replace('-', '–')}</button>`).join('')}</div>` : '<span class="hint">Al mejor de 1: solo el ganador</span>'}
        ${p ? '<button type="button" class="pk__clear" data-unpick="' + esc(m.id) + '" title="Quitar pronóstico">Quitar</button>' : ''}</footer>
    </article>`;
}
function tabMatches() {
  const open = openMatches();
  const filter = S.mfilter || '';
  const list = open.filter((m) => !filter || m.stage === filter);
  const days = new Map();
  for (const m of list) { const k = m.time ? m.time.toDateString() : 'tbd'; if (!days.has(k)) days.set(k, []); days.get(k).push(m); }
  const stagesWith = [...new Set(open.map((m) => m.stage))];
  return `${championPanel()}
    ${stagesWith.length > 1 ? `<div class="seg">${[['', 'Todas'], ...stagesWith.map((s) => [s, stageName(s)])].map(([v, l]) => `<button type="button" class="${filter === v ? 'is-on' : ''}" data-mfilter="${v}">${l}</button>`).join('')}</div>` : ''}
    ${list.length ? [...days.values()].map((ms) => `<h3 class="day">${esc(ms[0].time ? fmtDate(ms[0].time) : 'Fecha por confirmar')}</h3><div class="pkgrid">${ms.map(matchCard).join('')}</div>`).join('')
      : `<div class="empty">${S.data.matches.length ? 'Ahora mismo no hay partidos abiertos con los dos equipos confirmados. Los siguientes aparecerán en cuanto se conozcan los cruces.' : 'Todavía no se ha publicado el calendario del Major.'}</div>`}`;
}

// ---- Pick'em de fases
const KINDS = [['w30', '3-0', 'ct'], ['adv', 'Pasa', 'ok'], ['l03', '0-3', 't']];
function tabStages() {
  const swiss = S.data.stages.filter((s) => s.type === 'swiss');
  if (!S.stage || !swiss.some((s) => s.id === S.stage)) S.stage = (swiss.find((s) => s.ready && !s.locked) || [...swiss].reverse().find((s) => s.locked) || swiss[0] || {}).id;
  const st = swiss.find((s) => s.id === S.stage);
  const seg = `<div class="seg">${swiss.map((s) => `<button type="button" class="${s.id === S.stage ? 'is-on' : ''}" data-stage-tab="${s.id}">${esc(s.name)}<small>${s.locked ? 'cerrado' : s.ready ? 'abierto' : 'pronto'}</small></button>`).join('')}</div>`;
  if (!st) return seg;
  const counts = S.data.settings.valveCounts;
  const saved = S.me.stagepicks[st.id];
  const rec = S.data.records[st.id] || {};
  if (!st.ready && !st.locked && !past()) {
    return seg + `<div class="empty">El Pick'em de <b>${esc(st.name)}</b> se abre cuando se conozcan sus 16 equipos${st.id !== 's1' ? ' (al terminar la fase anterior)' : ''}.</div>`;
  }
  if (st.locked || past()) {
    const ev = saved || { picks: [], points: 0 };
    const group = (S.board.stages?.[st.id] || []).filter((x) => x.nick !== S.me.user.nick);
    const rows = Object.entries(rec).sort((a, b) => b[1].w - a[1].w || a[1].l - b[1].l || a[0].localeCompare(b[0]));
    return seg + `<div class="duo duo--wide">
        <section class="card"><h3>Tu Pick'em de ${esc(st.name)} <span class="pill">${ev.points} pts</span></h3>
          ${ev.picks.length ? `<ul class="vpicks">${ev.picks.map((p) => `<li class="is-${p.state}">${badge(p.team)}<span><b>${esc(p.team)}</b><small>${KINDS.find((k) => k[0] === p.kind)[1]}${rec[p.team] ? ` · va ${rec[p.team].w}-${rec[p.team].l}` : ''}</small></span><i>${p.state === 'ok' ? `+${p.points}` : p.state === 'ko' ? '✗' : '…'}</i></li>`).join('')}</ul>` : '<p class="hint">No hiciste el Pick\'em de esta fase.</p>'}
        </section>
        <section class="card"><h3>Clasificación de ${esc(st.name)}</h3>
          <ol class="records">${rows.map(([t, r]) => `<li class="${r.w === 3 ? 'is-up' : r.l === 3 ? 'is-out' : ''}">${badge(t)}<span>${esc(t)}</span><b>${r.w}-${r.l}</b></li>`).join('')}</ol>
        </section>
      </div>
      ${group.length ? `<h3 class="day">El resto del grupo</h3><div class="others">${group.map((g) => `<article class="card other"><h4>${esc(g.nick)} <span class="pill">${g.points} pts</span></h4><p>${g.picks.map((p) => `<span class="mini is-${p.state}" title="${KINDS.find((k) => k[0] === p.kind)[1]}">${badge(p.team)}${KINDS.find((k) => k[0] === p.kind)[1]}</span>`).join('')}</p></article>`).join('')}</div>` : ''}`;
  }
  const d = S.stageDraft[st.id] || (S.stageDraft[st.id] = { w30: [...(saved?.data.w30 || [])], l03: [...(saved?.data.l03 || [])], adv: [...(saved?.data.adv || [])] });
  const kindOf = (t) => KINDS.find(([k]) => d[k].includes(t))?.[0];
  const dirty = JSON.stringify(d) !== JSON.stringify(saved ? { w30: saved.data.w30 || [], l03: saved.data.l03 || [], adv: saved.data.adv || [] } : { w30: [], l03: [], adv: [] });
  const full = KINDS.every(([k]) => d[k].length === counts[k]);
  return seg + `<div class="vhead">
      <p>Elige <b>2</b> equipos que acabarán <b>3-0</b>, <b>6</b> que pasarán con <b>3-1 o 3-2</b> y <b>2</b> que caerán <b>0-3</b>. Se cierra cuando empiece el primer partido de ${esc(st.name)}${st.lockAt ? ` (${fmtDayTime(new Date(st.lockAt))})` : ''}.</p>
      <div class="vcount">${KINDS.map(([k, l, c]) => `<span class="vcount__item vcount__item--${c} ${d[k].length === counts[k] ? 'is-full' : ''}"><b>${d[k].length}/${counts[k]}</b>${l}</span>`).join('')}</div>
    </div>
    <div class="vgrid">${st.teams.map((t) => {
      const k = kindOf(t);
      return `<article class="vteam ${k ? `is-${k}` : ''}">${badge(t, 'tb--lg')}<b>${esc(t)}</b>
        <div class="vteam__btns">${KINDS.map(([kk, l, c]) => `<button type="button" class="vbtn vbtn--${c} ${k === kk ? 'is-on' : ''}" data-v="${kk}" data-vteam="${esc(t)}" ${k !== kk && d[kk].length >= counts[kk] ? 'disabled' : ''}>${l}</button>`).join('')}</div></article>`;
    }).join('')}</div>
    <div class="savebar ${dirty ? 'is-dirty' : ''}"><span>${dirty ? '<b>Cambios sin guardar</b>' : saved ? '<b>Guardado</b>' : '<b>Aún no has hecho este Pick\'em</b>'}<small>${full ? 'Lo tienes completo.' : 'Puedes guardarlo aunque no esté completo.'}</small></span>
      <button class="btn btn--primary" type="button" data-save-stage="${st.id}" ${dirty ? '' : 'disabled'}>Guardar Pick'em</button></div>
    <p class="form__msg" id="stageMsg" role="alert"></p>`;
}

// ---- cuadro
const QF = ['R1M1', 'R1M2', 'R1M3', 'R1M4']; const FEED = { R2M1: ['R1M1', 'R1M2'], R2M2: ['R1M3', 'R1M4'], R3M1: ['R2M1', 'R2M2'] };
function tabBracket() {
  const b = past() ? { ...S.data.bracket, locked: true } : S.data.bracket;
  const po = S.data.matches.filter((m) => m.stage === 'po');
  const bySlot = Object.fromEntries(po.filter((m) => m.slot).map((m) => [m.slot, m]));
  const saved = S.me.bracket;
  if (!b.ready && !b.locked && !past()) return `<div class="empty">El cuadro se abre cuando se conozcan los cruces de cuartos de final (al terminar el Stage 3).</div>`;
  const d = b.locked ? { ...(saved?.data || {}) } : (S.bracketDraft = S.bracketDraft || { ...(saved?.data || {}) });
  const stateOf = (slot) => saved?.picks?.find((p) => p.slot === slot);
  const opts = (slot) => (slot.startsWith('R1') ? [bySlot[slot]?.t1, bySlot[slot]?.t2] : FEED[slot].map((k) => d[k] || null));
  const box = (slot, label) => {
    const real = bySlot[slot];
    const st = b.locked ? stateOf(slot) : null;
    return `<div class="bm ${st ? `is-${st.state}` : ''}"><span class="bm__label">${label}${real?.time ? ` · ${fmtDate(real.time)}` : ''}</span>
      ${opts(slot).map((t, i) => {
        const won = real?.done && winnerTeam(real) === t;
        return `<button type="button" class="bm__team ${d[slot] && d[slot] === t ? 'is-on' : ''} ${won ? 'is-won' : ''}" ${!t || b.locked ? 'disabled' : ''} data-bslot="${slot}" data-bteam="${esc(t || '')}">${t ? badge(t) : '<span class="tb tb--tbd">?</span>'}<span>${t ? esc(t) : 'Elige antes el cruce anterior'}</span>${real?.done && slot.startsWith('R1') ? `<b>${i === 0 ? real.s1 : real.s2}</b>` : ''}</button>`;
      }).join('')}
      ${st ? `<span class="bm__res">${st.state === 'ok' ? `+${st.points}` : st.state === 'ko' ? '✗' : '…'}</span>` : ''}</div>`;
  };
  const dirty = !b.locked && JSON.stringify(d) !== JSON.stringify(saved?.data || {});
  const others = b.locked ? (S.board.brackets || []).filter((x) => x.nick !== S.me.user.nick) : [];
  return `<p class="vhead">${b.locked ? `Cuadro cerrado${saved ? ` · llevas <b>${saved.points}</b> puntos` : ' · no hiciste el cuadro'}.` : `Elige quién gana cada cruce hasta la final. Se cierra cuando empiecen los playoffs${b.lockAt ? ` (${fmtDayTime(new Date(b.lockAt))})` : ''}.`}</p>
    <div class="bracket">
      <div class="bracket__col"><h4>Cuartos <small>${S.data.settings.bracket.qf} pts</small></h4><div class="bracket__slots">${QF.map((s, i) => `<div class="bracket__slot">${box(s, `Cuartos ${i + 1}`)}</div>`).join('')}</div></div>
      <div class="bracket__col"><h4>Semifinales <small>${S.data.settings.bracket.sf} pts</small></h4><div class="bracket__slots"><div class="bracket__slot">${box('R2M1', 'Semifinal 1')}</div><div class="bracket__slot">${box('R2M2', 'Semifinal 2')}</div></div></div>
      <div class="bracket__col bracket__col--final"><h4>Gran final <small>${S.data.settings.bracket.final} pts</small></h4><div class="bracket__slots"><div class="bracket__slot">${box('R3M1', 'Campeón')}</div></div></div>
    </div>
    ${b.locked ? '' : `<div class="savebar ${dirty ? 'is-dirty' : ''}"><span><b>${dirty ? 'Cambios sin guardar' : saved ? 'Guardado' : 'Aún no has hecho el cuadro'}</b><small>Si cambias un cruce, los siguientes que dependan de él se vacían.</small></span>
      <button class="btn btn--primary" type="button" data-save-bracket ${dirty ? '' : 'disabled'}>Guardar cuadro</button></div><p class="form__msg" id="bracketMsg" role="alert"></p>`}
    ${others.length ? `<h3 class="day">El resto del grupo</h3><div class="others">${others.map((g) => `<article class="card other"><h4>${esc(g.nick)} <span class="pill">${g.points} pts</span></h4><p>${g.picks.filter((p) => p.slot !== 'R3M1').length ? '' : ''}Campeón: ${g.picks.find((p) => p.slot === 'R3M1') ? `${badge(g.picks.find((p) => p.slot === 'R3M1').team)} ${esc(g.picks.find((p) => p.slot === 'R3M1').team)}` : '—'}</p></article>`).join('')}</div>` : ''}`;
}

// ---- combinadas
function tabCombos() {
  const set = S.data.settings.combo;
  const open = openMatches();
  const rounds = [...new Map(open.map((m) => [`${m.stage}|${m.round}`, m])).entries()];
  const mine = S.me.combos;
  if (!S.combo || !rounds.some(([k]) => k === S.combo.rkey)) {
    const k = rounds[0]?.[0] || null;
    const ex = mine.find((c) => c.rkey === k);
    S.combo = { rkey: k, legs: ex ? ex.legs.map((l) => ({ mid: l.mid, team: l.team, score: l.score })) : [] };
  }
  const roundSel = rounds.length ? `<div class="seg">${rounds.map(([k, m]) => `<button type="button" class="${k === S.combo.rkey ? 'is-on' : ''}" data-crk="${esc(k)}">${esc(stageName(m.stage))} · ${esc(roundEs(m.round))}</button>`).join('')}</div>` : '';
  const ms = open.filter((m) => `${m.stage}|${m.round}` === S.combo.rkey);
  const leg = (mid) => S.combo.legs.find((l) => l.mid === mid);
  const n = S.combo.legs.length;
  const base = { 2: set.p2, 3: set.p3, 4: set.p4 }[n] || 0;
  const ko = ms.some((m) => m.stage === 'po');
  const value = (base + S.combo.legs.filter((l) => l.score).length * set.exact) * (ko ? set.koMult : 1);
  const saved = mine.find((c) => c.rkey === S.combo.rkey);
  const dirty = JSON.stringify(S.combo.legs) !== JSON.stringify(saved ? saved.legs.map((l) => ({ mid: l.mid, team: l.team, score: l.score })) : []);
  const builder = past() ? '' : rounds.length ? `<div class="combo">
      <div class="combo__list">${ms.map((m) => {
        const l = leg(m.id);
        return `<article class="cleg ${l ? 'is-on' : ''}"><span class="cleg__meta">${fmtDayTime(m.time)} · Bo${m.bo}</span>
          <div class="cleg__teams">${[m.t1, m.t2].map((t) => `<button type="button" class="${l?.team === t ? 'is-on' : ''}" data-cleg="${esc(m.id)}" data-cteam="${esc(t)}" ${!l && n >= 4 ? 'disabled' : ''}>${badge(t)}<span>${esc(t)}</span></button>`).join('')}</div>
          ${l && scoresFor(m.bo).length ? `<div class="pk__scores">${scoresFor(m.bo).map((s) => `<button type="button" class="chip ${l.score === s ? 'is-on' : ''}" data-cscore="${esc(m.id)}" data-val="${s}">${s.replace('-', '–')}</button>`).join('')}</div>` : ''}</article>`;
      }).join('')}</div>
      <aside class="card combo__slip"><h3>Tu combinada</h3><p class="hint">${esc(stageName(ms[0]?.stage))} · ${esc(roundEs(ms[0]?.round))}</p>
        <p class="combo__n"><b>${n}</b> de 2–4 partidos</p>
        <p class="combo__val">${n >= 2 ? `Si aciertas todos: <b>${value} puntos</b>` : 'Elige al menos 2 partidos'}</p>
        <p class="hint">Hay que acertar todos. +${set.exact} por cada resultado exacto${ko ? ` · ×${set.koMult} en playoffs` : ''}. Se puede cambiar hasta que empiece uno de sus partidos.</p>
        <div class="combo__btns">${saved ? '<button class="btn btn--ghost btn--sm" type="button" data-cdel>Borrar</button>' : ''}<button class="btn btn--primary" type="button" data-csave ${dirty && (n >= 2) ? '' : 'disabled'}>Guardar combinada</button></div>
        <p class="form__msg" id="comboMsg" role="alert"></p></aside>
    </div>` : '<div class="empty">No hay rondas con partidos abiertos ahora mismo.</div>';
  const list = mine.length ? `<h3 class="day">Tus combinadas</h3><div class="others">${mine.map((c) => `<article class="card other is-${c.status}"><h4>${esc(roundEs(c.rkey.split('|')[1]))} <span class="pill">${c.status === 'win' ? `+${c.points}` : c.status === 'lose' ? '0' : `${c.potential} en juego`}</span></h4>
      <ul class="clist">${c.legs.map((l) => `<li class="is-${l.result}">${badge(l.team)}<span>${esc(l.team)}${l.score ? ' ' + l.score.replace('-', '–') : ''}</span><i>${l.result === 'ok' ? '✓' : l.result === 'ko' ? '✗' : '…'}</i></li>`).join('')}</ul></article>`).join('')}</div>` : '';
  return (past() ? '' : roundSel) + builder + (list || (past() ? '<div class="empty">No hiciste combinadas en este Major.</div>' : ''));
}

// ---- clasificación
function tabBoard() {
  const rows = S.board.board;
  return `<div class="table-wrap"><table class="table">
      <thead><tr><th>#</th><th>Jugador</th><th>Puntos</th><th title="Partidos acertados / jugados">Partidos</th><th>Combin.</th><th>Fases</th><th>Cuadro</th><th>Campeón</th></tr></thead>
      <tbody>${rows.map((r) => `<tr class="${r.nick === S.me.user.nick ? 'is-me' : ''}"><td class="pos">${r.pos}</td><td class="who">${badge(r.nick, 'tb--me')}<b>${esc(r.nick)}</b>${r.adjust ? `<span class="adj" title="${esc(r.adjustReason)}">${r.adjust > 0 ? '+' : ''}${r.adjust} ajuste</span>` : ''}</td>
        <td class="pts">${r.points}</td><td>${r.hits}/${r.played}<small>+${r.matches}</small></td><td>+${r.combos}</td><td>+${r.stages}</td><td>+${r.bracket}</td><td>+${r.champion}</td></tr>`).join('')}</tbody>
    </table></div>`;
}

// ---- jugados
function tabPlayed() {
  const all = S.data.matches.filter((m) => started(m) && !isTbd(m.t1)).slice().reverse();
  if (!all.length) return '<div class="empty">Todavía no se ha jugado ningún partido.</div>';
  const stages = [...new Set(all.map((m) => m.stage))];
  if (!stages.includes(S.pfilter)) S.pfilter = stages[0];
  const list = all.filter((m) => m.stage === S.pfilter);
  return `${stages.length > 1 ? `<div class="seg">${stages.map((v) => `<button type="button" class="${S.pfilter === v ? 'is-on' : ''}" data-pfilter="${v}">${esc(stageName(v))}</button>`).join('')}</div>` : ''}
    <div class="played">${list.map((m) => {
    const p = pickOf(m.id); const r = p?.result;
    const others = (S.board.revealed[m.id] || []).filter((x) => x.nick !== S.me.user.nick);
    const side = (t, s) => `<span class="pl__team ${m.done && winnerTeam(m) === t ? 'is-won' : ''}">${badge(t)}<b>${esc(t)}</b>${m.done ? `<i>${s}</i>` : ''}</span>`;
    return `<article class="pl">
      <header><span>${esc(stageName(m.stage))} · ${esc(roundEs(m.round))} · ${fmtDayTime(m.time)}</span>${m.done ? (m.fixed ? '<span class="pill pill--warn">corregido</span>' : '') : '<span class="pill pill--live">en juego</span>'}</header>
      <div class="pl__teams">${side(m.t1, m.s1)}<span class="pk__vs">vs</span>${side(m.t2, m.s2)}</div>
      ${m.maps?.some((x) => x.winner || x.s1 != null) ? `<p class="pl__maps">${m.maps.filter((x) => x.winner || x.s1 != null).map((x) => `${esc(x.map)} ${x.s1 ?? ''}–${x.s2 ?? ''}`).join(' · ')}</p>` : ''}
      ${String(m.id).startsWith('x-') ? '' : `<a class="pl__more" href="#/majors/${esc(S.data.ev)}/p/${esc(m.id)}">Mapas, rondas y plantillas →</a>`}
      <footer>${p ? `Tu pronóstico: <b>${esc(p.team)}${p.score ? ' ' + p.score.replace('-', '–') : ''}</b>${r ? (r.ok ? ` <span class="ok">+${r.points}${r.exact ? ' exacto' : ''}</span>` : ' <span class="ko">0</span>') : ''}` : '<span class="hint">No lo pronosticaste</span>'}
        ${others.length ? `<span class="pl__others">${others.map((o) => `<span class="mini ${m.done ? (o.team === winnerTeam(m) ? 'is-ok' : 'is-ko') : ''}" title="${esc(o.team)}">${esc(o.nick)}: ${esc(shortOf(o.team))}${o.score ? ' ' + o.score.replace('-', '–') : ''}</span>`).join('')}</span>` : ''}</footer>
    </article>`;
  }).join('')}</div>`;
}

// ---------------------------------------------------------------- acciones
const msgOf = (el) => el.closest('form, .card, .joincard')?.querySelector('.form__msg') || document.querySelector('.form__msg');
const flash = (el, text, ok = false) => { if (el) { el.textContent = text; el.classList.toggle('is-ok', ok); } };

$app.addEventListener('click', async (e) => {
  const t = e.target.closest('button, a');
  if (!t || admin?.isOpen?.()) return;
  const ds = t.dataset;
  if (ds.auth || ds.authGo) {
    const which = ds.auth || ds.authGo;
    document.querySelectorAll('[data-auth]').forEach((b) => b.classList.toggle('is-on', b.dataset.auth === which));
    document.querySelectorAll('[data-form="register"],[data-form="login"]').forEach((f) => { f.hidden = f.dataset.form !== which; });
    if (ds.authGo) { e.preventDefault(); document.getElementById('auth')?.scrollIntoView({ behavior: 'smooth' }); }
    return;
  }
  if (ds.act === 'logout') { saveSession({}); location.hash = '#/pickem'; route(); return; }
  if (ds.tab) { S.tab = ds.tab; document.querySelectorAll('[data-tab]').forEach((b) => { b.classList.toggle('is-on', b.dataset.tab === S.tab); b.setAttribute('aria-selected', b.dataset.tab === S.tab); }); rerender(); return; }
  if (ds.mfilter !== undefined) { S.mfilter = ds.mfilter; rerender(); return; }
  if (ds.pfilter) { S.pfilter = ds.pfilter; rerender(); return; }
  if (ds.join) {
    try { await call('POST', '/join', { code: ds.join }); location.hash = `#/g/${ds.join}`; } catch (err) { flash(msgOf(t), err.message); }
    return;
  }
  if (ds.leave) {
    if (!confirm('¿Salir de este grupo? Tus pronósticos no se borran.')) return;
    try { await call('POST', '/leave', { code: ds.leave }); location.hash = '#/pickem'; } catch (err) { alert(err.message); }
    return;
  }
  if (ds.invite) {
    const url = `${location.origin}${location.pathname}#/g/${ds.invite}`;
    const text = `Únete a mi Pick'em del ${S.data.event?.name || 'Major'} «${ds.name}»:`;
    if (navigator.share) { navigator.share({ title: 'Pick\'em del Major', text, url }).catch(() => {}); return; }
    try { await navigator.clipboard.writeText(`${text} ${url}`); t.textContent = '¡Enlace copiado!'; setTimeout(() => { t.textContent = 'Invitar amigos'; }, 2000); } catch { prompt('Copia el enlace:', url); }
    return;
  }
  // pronósticos de partidos
  if (ds.pick || ds.score || ds.unpick) {
    const mid = ds.pick || ds.score || ds.unpick;
    const m = S.data.matches.find((x) => x.id === mid);
    const cur = pickOf(mid);
    let body;
    if (ds.unpick) body = { mid, team: null };
    else if (ds.pick) body = { mid, team: ds.team, score: cur?.team === ds.team ? cur.score : null };
    else body = { mid, team: cur.team, score: cur.score === ds.val ? null : ds.val };
    try {
      await call('PUT', '/pick', body);
      S.me.picks = S.me.picks.filter((p) => p.mid !== mid);
      if (body.team) S.me.picks.push({ mid, team: body.team, score: body.score || null });
      const card = t.closest('.pk'); if (card) card.outerHTML = matchCard(m);
      const dot = document.querySelector('[data-tab="partidos"] .dot'); const n = openMatches().filter((x) => !pickOf(x.id)).length;
      if (dot) { if (n) dot.textContent = n; else dot.remove(); }
    } catch (err) { alert(err.message); }
    return;
  }
  // Pick'em de fases
  if (ds.stageTab) { S.stage = ds.stageTab; rerender(); return; }
  if (ds.v) {
    const d = S.stageDraft[S.stage];
    const team = ds.vteam;
    const had = d[ds.v].includes(team);
    for (const k of ['w30', 'l03', 'adv']) d[k] = d[k].filter((x) => x !== team);
    if (!had) d[ds.v].push(team);
    rerender(); return;
  }
  if (ds.saveStage) {
    const d = S.stageDraft[ds.saveStage];
    try {
      await call('PUT', '/stage', { stage: ds.saveStage, ...d });
      S.me = await call('GET', '/me');
      delete S.stageDraft[ds.saveStage];
      rerender(); flash(document.getElementById('stageMsg'), 'Pick\'em guardado.', true);
    } catch (err) { flash(document.getElementById('stageMsg'), err.message); }
    return;
  }
  // cuadro
  if (ds.bslot) {
    const d = S.bracketDraft;
    d[ds.bslot] = ds.bteam;
    // vaciar los cruces siguientes que ya no cuadran
    for (const [slot, feed] of Object.entries(FEED)) if (d[slot] && !feed.map((k) => d[k]).includes(d[slot])) delete d[slot];
    rerender(); return;
  }
  if (ds.saveBracket !== undefined) {
    try {
      await call('PUT', '/bracket', { picks: S.bracketDraft });
      S.me = await call('GET', '/me'); S.bracketDraft = null;
      rerender(); flash(document.getElementById('bracketMsg'), 'Cuadro guardado.', true);
    } catch (err) { flash(document.getElementById('bracketMsg'), err.message); }
    return;
  }
  // combinadas
  if (ds.crk) { const ex = S.me.combos.find((c) => c.rkey === ds.crk); S.combo = { rkey: ds.crk, legs: ex ? ex.legs.map((l) => ({ mid: l.mid, team: l.team, score: l.score })) : [] }; rerender(); return; }
  if (ds.cleg) {
    const l = S.combo.legs.find((x) => x.mid === ds.cleg);
    if (l && l.team === ds.cteam) S.combo.legs = S.combo.legs.filter((x) => x !== l);
    else if (l) { l.team = ds.cteam; l.score = null; }
    else S.combo.legs.push({ mid: ds.cleg, team: ds.cteam, score: null });
    rerender(); return;
  }
  if (ds.cscore) { const l = S.combo.legs.find((x) => x.mid === ds.cscore); l.score = l.score === ds.val ? null : ds.val; rerender(); return; }
  if (ds.csave !== undefined || ds.cdel !== undefined) {
    try {
      await call('PUT', '/combo', { rkey: S.combo.rkey, legs: ds.cdel !== undefined ? [] : S.combo.legs });
      S.me = await call('GET', '/me');
      rerender(); flash(document.getElementById('comboMsg'), ds.cdel !== undefined ? 'Combinada borrada.' : 'Combinada guardada.', true);
    } catch (err) { flash(document.getElementById('comboMsg'), err.message); }
  }
});
$app.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.matches('[data-champion]')) {
    try { await call('PUT', '/champion', { team: t.value }); S.me.champion = t.value || null; rerender(); } catch (err) { alert(err.message); }
  }
});
$app.addEventListener('submit', async (e) => {
  const f = e.target.closest('form[data-form]');
  if (!f || admin?.isOpen?.()) return;
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(f));
  const msg = f.querySelector('.form__msg');
  const btn = f.querySelector('[type=submit]'); btn.disabled = true;
  try {
    if (f.dataset.form === 'register') {
      if (fd.pin !== fd.pin2) throw new ApiError(400, 'Los dos PIN no coinciden.');
      const r = await call('POST', '/register', { nick: fd.nick, pin: fd.pin });
      saveSession({ token: r.token, nick: r.user.nick });
      await route();
    } else if (f.dataset.form === 'login') {
      const r = await call('POST', '/login', { nick: fd.nick, pin: fd.pin });
      saveSession({ token: r.token, nick: r.user.nick });
      await route();
    } else if (f.dataset.form === 'create') {
      const r = await call('POST', '/league', { name: fd.name });
      location.hash = `#/g/${r.league.code}`;
    } else if (f.dataset.form === 'join') {
      const r = await call('POST', '/join', { code: fd.code });
      location.hash = `#/g/${r.league.code}`;
    }
  } catch (err) { flash(msg, err.message); } finally { btn.disabled = false; }
});

// Refresco suave cada 2 minutos (si no se está editando nada)
setInterval(() => {
  if (document.hidden || admin?.isOpen?.() || majors.isOpen() || stats.isOpen() || document.querySelector('.is-dirty') || document.activeElement?.matches('input, select, textarea')) return;
  clearMatches(); route();
}, 120_000);

route();
