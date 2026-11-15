// Panel de administración (#/admin/<sección>). Solo para los apodos de la variable ADMINS del Worker.
export function createAdmin(h) {
  const { call, esc, $app, badge, fmtDate, fmtTime, fmtDayTime, roundEs, clearMatches, route, isTbd } = h;
  const A = { section: 'resumen', cache: {}, ev: '', st: null };
  const evq = (p) => (A.ev ? `${p}${p.includes('?') ? '&' : '?'}ev=${encodeURIComponent(A.ev)}` : p);
  const get = (p) => call('GET', evq(`/admin/${p}`));
  const post = (p, body = {}) => call('POST', `/admin/${p}`, A.ev ? { ev: A.ev, ...body } : body);
  const stageName = (id) => A.st?.names[id] || { s1: 'Stage 1', s2: 'Stage 2', s3: 'Stage 3', po: 'Playoffs' }[id] || id;
  async function loadEvent() {                                   // fases y lista de Majors del Pick'em (para nombres y selector)
    if (A.st && A.st.ev === A.ev && Date.now() - A.st.t < 30_000) return A.st;
    const d = await call('GET', evq('/matches'));
    A.st = { ev: A.ev, t: Date.now(), names: Object.fromEntries(d.stages.map((x) => [x.id, x.name])), events: d.events || [], current: d.current, cur: d.ev, event: d.event, stages: d.stages };
    return A.st;
  }
  const pill = (t, k = '') => `<span class="adm-badge ${k ? 'adm-badge--' + k : ''}">${esc(t)}</span>`;
  const empty = (t) => `<div class="adm-empty">${t}</div>`;
  const ago = (s) => { const d = (Date.now() - Date.parse(s)) / 60000; return !s ? '—' : d < 1 ? 'ahora' : d < 60 ? `hace ${Math.round(d)} min` : d < 1440 ? `hace ${Math.round(d / 60)} h` : fmtDate(new Date(s)); };
  const SECTIONS = [
    ['resumen', 'Resumen', 'El Major de un vistazo: lo que necesita atención y los últimos movimientos.'],
    ['partidos', 'Partidos', 'Corrige resultados, equipos u horas, oculta partidos de Liquipedia o añade partidos a mano.'],
    ['fases', 'Fases', 'Equipos de cada fase para el Pick\'em de Valve (si Liquipedia aún no los tiene) y estado de cada fase.'],
    ['jugadores', 'Jugadores', 'Cuentas: PIN, apodo, bloqueos, sesiones y sus pronósticos.'],
    ['grupos', 'Grupos', 'Grupos de amigos, sus jugadores, su clasificación y los ajustes de puntos.'],
    ['registro', 'Registro', 'Todo lo que pasa: cuentas, grupos y cada cambio hecho desde este panel.'],
    ['majors', 'Majors', 'Historial de Majors: qué se ha descargado de Liquipedia, MVP y notas de cada uno, y qué Major usa el Pick\'em.'],
    ['ajustes', 'Ajustes', 'Reglas y puntos del juego, Major del Pick\'em, avisos y copia de seguridad.'],
  ];
  const isOpen = () => !!$app.querySelector('.adm');

  // ---------------------------------------------------------------- estructura
  async function view(section) {
    A.section = SECTIONS.some((s) => s[0] === section) ? section : 'resumen';
    let body;
    try { await loadEvent(); body = await RENDER[A.section](); } catch (err) {
      if (err.status === 401 || err.status === 403) {
        return `<div class="state state--error"><p><b>${esc(err.message)}</b></p><a class="btn" href="#/">Volver</a></div>`;
      }
      body = `<div class="state state--error"><p><b>${esc(err.message)}</b></p><button class="btn" data-adm="reload">Reintentar</button></div>`;
    }
    if (A.section === 'ajustes') setTimeout(loadBackups, 0);
    const sec = SECTIONS.find((s) => s[0] === A.section);
    return `<div class="adm">
      <aside class="adm-side"><div class="adm-side__brand"><b>Admin</b><small>Clutch · Pick'em</small></div>
        <nav class="adm-nav">${SECTIONS.map(([id, l]) => `<a class="adm-nav__item ${id === A.section ? 'is-on' : ''}" href="#/admin/${id}">${l}</a>`).join('')}</nav>
        <a class="adm-side__back" href="#/">← Volver a la web</a></aside>
      <section class="adm-main">
        <header class="adm-head"><div><p class="adm-head__crumb">Administración${A.st ? ` · ${esc(A.st.event?.name || A.st.cur)}${A.st.cur === A.st.current ? '' : ' (cerrado)'}` : ''}</p><h1 class="adm-head__title">${sec[1]}</h1><p class="adm-head__desc">${sec[2]}</p></div>
          <div class="adm-head__act">${evPicker()}<button class="btn btn--sm" type="button" data-adm="reload">Actualizar</button></div></header>
        <div class="adm-body" id="admBody">${body}</div>
      </section>
      <dialog class="adm-dialog" id="admDialog"><div class="adm-dialog__box" id="admBox"></div></dialog>
      <div class="adm-toast" id="admToast" role="status"></div>
    </div>`;
  }
  function evPicker() {
    const evs = (A.st?.events || []).filter((e) => e.status !== 'upcoming' || e.id === A.st.current);
    if (!['resumen', 'partidos', 'fases', 'jugadores', 'grupos'].includes(A.section) || evs.length < 2) return '';
    return `<label class="adm-evpick"><span>Major</span><select class="input" data-adm-ev>${evs.map((e) => `<option value="${e.id === A.st.current ? '' : esc(e.id)}" ${e.id === A.st.cur ? 'selected' : ''}>${esc(e.name)}${e.id === A.st.current ? ' (actual)' : ''}</option>`).join('')}</select></label>`;
  }
  async function reloadBody() { const el = document.getElementById('admBody'); if (el) el.innerHTML = await RENDER[A.section](); if (A.section === 'ajustes') loadBackups(); }
  function toast(t, kind = 'ok') {
    const el = document.getElementById('admToast'); if (!el) return;
    el.textContent = t; el.className = `adm-toast is-on is-${kind}`;
    clearTimeout(toast.t); toast.t = setTimeout(() => { el.className = 'adm-toast'; }, 2600);
  }
  function openDialog(title, html, wide = false) {
    const d = document.getElementById('admDialog');
    document.getElementById('admBox').innerHTML = `<header class="adm-dialog__head"><h2>${title}</h2><button class="adm-x" type="button" data-adm="close" aria-label="Cerrar">×</button></header><div class="adm-dialog__body">${html}</div>`;
    d.classList.toggle('is-wide', wide);
    if (!d.open) d.showModal();
  }
  const closeDialog = () => { const d = document.getElementById('admDialog'); if (d?.open) d.close(); };
  async function act(fn, ok) {
    try { await fn(); if (ok) toast(ok); return true; } catch (err) { toast(err.message, 'error'); return false; }
  }
  const matchName = (m) => `${m.t1} vs ${m.t2}`;
  const res = (m) => (m.done ? `${m.s1}–${m.s2}` : '—');
  const toLocal = (iso) => { if (!iso) return ''; const d = new Date(iso); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

  // ---------------------------------------------------------------- RESUMEN
  async function renderResumen() {
    const d = await get('overview');
    A.cache.settings = d.settings;
    const s = d.stats;
    const tile = (n, l, href) => `<a class="adm-tile" href="#/admin/${href}"><b>${n}</b>${l}</a>`;
    const alerts = d.indexAlerts?.length ? `<section class="adm-card adm-alert"><h3 class="adm-card__title">⚠ La descarga de datos lleva un rato fallando</h3>
        <ul class="adm-list">${d.indexAlerts.map((a) => `<li><span>${esc(a)}</span></li>`).join('')}</ul>
        <p class="adm-hint">GitHub te habrá mandado un correo con la ejecución fallida. Revisa Actions → «Actualizar Majors».</p></section>` : '';
    return `${alerts}<div class="adm-tiles">${tile(s.users, 'cuentas', 'jugadores')}${tile(s.leagues, 'grupos', 'grupos')}${tile(s.picks, 'pronósticos', 'partidos')}${tile(`${s.done}/${s.matches}`, 'partidos jugados', 'partidos')}</div>
      <section class="adm-card"><h3 class="adm-card__title">Datos de Liquipedia</h3>
        <p class="adm-sub">Última comprobación: ${d.checked ? `${fmtDayTime(new Date(d.checked))}` : 'nunca'} · ${s.fixes} correcciones manuales.</p>
        ${d.errors?.length ? `<ul class="adm-list">${d.errors.map((e) => `<li>${pill('aviso', 'warn')} ${esc(e)}</li>`).join('')}</ul>` : '<p class="adm-sub">Sin avisos.</p>'}</section>
      <section class="adm-card"><h3 class="adm-card__title">Estado del juego</h3>
        <div class="adm-switches">
          ${sw('picksOpen', d.settings.picksOpen, 'Pronósticos abiertos', 'Si lo apagas, nadie puede pronosticar.')}
          ${sw('registrationOpen', d.settings.registrationOpen, 'Se pueden crear cuentas', 'Si lo apagas, solo entran las cuentas que ya existen.')}
        </div>
        <form class="adm-form adm-form--inline" data-adm-form="banner"><label>Aviso para todos<input class="input" name="banner" maxlength="280" value="${esc(d.settings.banner)}" placeholder="Ej.: Hoy empieza el Stage 2"></label><button class="btn btn--primary" type="submit">Guardar aviso</button></form>
      </section>
      <div class="adm-grid2">
        <section class="adm-card"><h3 class="adm-card__title">Necesita atención</h3>
          ${d.late.length || s.locked ? `<ul class="adm-list">${d.late.map((m) => `<li><span><b>${esc(matchName(m))}</b><small>${esc(stageName(m.stage))} · empezó ${fmtDayTime(new Date(m.date))} · sin resultado</small></span><button class="btn btn--sm btn--primary" type="button" data-adm="fix" data-id="${esc(m.id)}">Poner resultado</button></li>`).join('')}${s.locked ? `<li><span><b>${s.locked} cuenta(s) bloqueada(s)</b><small>por fallar el PIN</small></span><a class="btn btn--sm" href="#/admin/jugadores">Ver</a></li>` : ''}</ul>` : empty('Todo en orden.')}</section>
        <section class="adm-card"><h3 class="adm-card__title">Próximas 48 horas</h3>
          ${d.upcoming.length ? `<ul class="adm-list">${d.upcoming.map((m) => `<li><span><b>${esc(matchName(m))}</b><small>${esc(stageName(m.stage))} · ${fmtDayTime(new Date(m.date))}</small></span>${pill(`${m.picks} pron.`, m.picks ? 'gold' : '')}</li>`).join('')}</ul>` : empty('No hay partidos en las próximas 48 horas.')}</section>
      </div>
      <section class="adm-card"><h3 class="adm-card__title">Actividad reciente <a class="adm-card__more" href="#/admin/registro">Ver todo →</a></h3>${logList(d.recent)}</section>`;
  }
  const sw = (field, on, title, hint) => `<label class="adm-setrow"><span><b>${title}</b><small>${hint}</small></span><span class="adm-switch"><input type="checkbox" data-adm="toggle" data-field="${field}" ${on ? 'checked' : ''}><span></span></span></label>`;

  // ---------------------------------------------------------------- PARTIDOS
  async function renderPartidos() {
    const d = await get('matches');
    A.cache.matches = d;
    const f = A.cache.mf || { stage: '', state: '' };
    const now = Date.now();
    const stateOf = (m) => (m.done ? 'done' : m.date && Date.parse(m.date) < now ? 'live' : 'upcoming');
    const list = d.matches.filter((m) => (!f.stage || m.stage === f.stage) && (!f.state || (f.state === 'fixed' ? m.fix : f.state === 'manual' ? m.manual : stateOf(m) === f.state)));
    const seg = (key, cur, opts) => `<div class="adm-seg">${opts.map(([v, l]) => `<button type="button" class="${cur === v ? 'is-on' : ''}" data-adm="mf" data-k="${key}" data-v="${v}">${l}</button>`).join('')}</div>`;
    return `<div class="adm-toolbar">${seg('stage', f.stage, [['', 'Todas'], ...d.stages.map((s) => [s.id, s.name])])}
        ${seg('state', f.state, [['', 'Todos'], ['upcoming', 'Por jugar'], ['live', 'En juego'], ['done', 'Jugados'], ['fixed', 'Corregidos'], ['manual', 'A mano']])}
        <button class="btn btn--primary btn--sm" type="button" data-adm="add">＋ Añadir partido</button></div>
      ${list.length ? `<div class="adm-table adm-table--m"><div class="adm-tr adm-tr--head"><span>Partido</span><span>Fecha</span><span>Resultado</span><span>Pron.</span><span></span></div>
        ${list.map((m) => `<div class="adm-tr ${m.fix ? 'is-fixed' : ''}"><span class="adm-td-main"><b>${badge(m.t1)} ${esc(m.t1)} <i>vs</i> ${badge(m.t2)} ${esc(m.t2)}</b><small>${esc(stageName(m.stage))} · ${esc(roundEs(m.round))} · Bo${m.bo}${m.slot ? ' · ' + m.slot : ''}${m.done ? `<b class="adm-res"> · ${res(m)}</b>` : ''}${m.manual ? ' · ' + pill('a mano', 'soft') : ''}${m.fix ? ' · ' + pill('corregido', 'gold') : ''}</small></span>
          <span>${m.date ? fmtDayTime(new Date(m.date)) : '—'}</span><span><b>${res(m)}</b></span><span>${m.picks}</span>
          <span class="adm-td-act"><button class="btn btn--sm" type="button" data-adm="fix" data-id="${esc(m.id)}">Editar</button></span></div>`).join('')}</div>` : empty('Ningún partido con esos filtros.')}
      ${d.hidden.length ? `<h3 class="adm-h3">Partidos ocultos</h3><ul class="adm-list">${d.hidden.map((m) => `<li><span><b>${esc(m.t1 || '?')} vs ${esc(m.t2 || '?')}</b><small>${esc(m.id)}</small></span><button class="btn btn--sm" data-adm="unhide" data-id="${esc(m.id)}">Volver a mostrar</button></li>`).join('')}</ul>` : ''}`;
  }
  async function openFix(id) {
    const d = await get(`match?id=${encodeURIComponent(id)}`);
    const m = d.match;
    const teams = A.cache.matches?.teams || [];
    const dl = `<datalist id="admTeams">${teams.map((t) => `<option value="${esc(t)}">`).join('')}</datalist>`;
    openDialog(esc(matchName(m)), `<form class="adm-form" data-adm-form="fix" data-id="${esc(m.id)}">${dl}
        <fieldset class="adm-fieldset"><legend>Resultado</legend>
          <div class="adm-row3"><label>Ganador<select class="input" name="winner"><option value="">— sin cambiar —</option><option value="1" ${m.winner === 1 && m.fixed ? 'selected' : ''}>${esc(m.t1)}</option><option value="2" ${m.winner === 2 && m.fixed ? 'selected' : ''}>${esc(m.t2)}</option><option value="0">Sin resultado (por jugar)</option></select></label>
            <label>${esc(m.t1)}<input class="input" name="s1" type="number" min="0" max="9" value="${m.done ? m.s1 : ''}"></label>
            <label>${esc(m.t2)}<input class="input" name="s2" type="number" min="0" max="9" value="${m.done ? m.s2 : ''}"></label></div>
          <p class="adm-hint">Marcador en mapas (Bo1: 1–0). Lo que pongas aquí manda sobre Liquipedia hasta que quites la corrección.</p></fieldset>
        <fieldset class="adm-fieldset"><legend>Equipos y hora</legend>
          <div class="adm-row3"><label>Equipo 1<input class="input" name="t1" list="admTeams" value="${esc(m.t1)}"></label><label>Equipo 2<input class="input" name="t2" list="admTeams" value="${esc(m.t2)}"></label>
            <label>Empieza (tu hora)<input class="input" name="date" type="datetime-local" value="${toLocal(m.date)}"></label></div></fieldset>
        <div class="adm-actions adm-actions--end">
          ${m.manual ? `<button class="btn adm-danger" type="button" data-adm="mdel" data-id="${esc(m.id)}">Borrar partido</button>` : `<button class="btn adm-danger" type="button" data-adm="hide" data-id="${esc(m.id)}">Ocultar partido</button>`}
          ${m.fixed ? `<button class="btn" type="button" data-adm="unfix" data-id="${esc(m.id)}">Quitar corrección</button>` : ''}
          <button class="btn btn--primary" type="submit">Guardar</button></div>
      </form>
      <h3 class="adm-h3">Pronósticos (${d.picks.length})</h3>
      ${d.picks.length ? `<ul class="adm-list">${d.picks.map((p) => `<li><span><b>${esc(p.nick)}</b><small>${esc(p.team)}${p.score ? ' ' + p.score : ''} · ${ago(p.updated)}</small></span><button class="btn btn--sm adm-danger" data-adm="pdel" data-user="${p.user}" data-id="${esc(m.id)}">Borrar</button></li>`).join('')}</ul>` : empty('Nadie lo ha pronosticado.')}
      <form class="adm-form adm-form--inline" data-adm-form="pick" data-id="${esc(m.id)}"><label>Poner pronóstico a<select class="input" name="user">${d.users.map((u) => `<option value="${u.id}">${esc(u.nick)}</option>`).join('')}</select></label>
        <label>Equipo<select class="input" name="team"><option>${esc(m.t1)}</option><option>${esc(m.t2)}</option></select></label>
        <label>Resultado<input class="input" name="score" placeholder="${m.bo > 1 ? '2-1' : '—'}" ${m.bo > 1 ? '' : 'disabled'}></label><button class="btn" type="submit">Poner</button></form>`, true);
  }
  function openAdd() {
    const st = A.cache.matches?.stages || [];
    const teams = A.cache.matches?.teams || [];
    openDialog('Añadir partido a mano', `<form class="adm-form" data-adm-form="add"><datalist id="admTeams2">${teams.map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
        <div class="adm-row3"><label>Fase<select class="input" name="stage">${st.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
          <label>Ronda<input class="input" name="round" placeholder="Round 1" required></label>
          <label>Al mejor de<select class="input" name="bo"><option>1</option><option selected>3</option><option>5</option></select></label></div>
        <div class="adm-row3"><label>Equipo 1<input class="input" name="t1" list="admTeams2" placeholder="TBD"></label><label>Equipo 2<input class="input" name="t2" list="admTeams2" placeholder="TBD"></label>
          <label>Empieza (tu hora)<input class="input" name="date" type="datetime-local"></label></div>
        <label>Posición en el cuadro (solo playoffs)<select class="input" name="slot"><option value="">—</option>${['R1M1', 'R1M2', 'R1M3', 'R1M4', 'R2M1', 'R2M2', 'R3M1', 'R3M2'].map((s) => `<option>${s}</option>`).join('')}</select></label>
        <p class="adm-hint">Cuadro: R1M1–R1M4 cuartos, R2M1–R2M2 semifinales, R3M1 Gran final, R3M2 tercer puesto. Úsalo solo si Liquipedia no tiene el partido.</p>
        <div class="adm-actions adm-actions--end"><button class="btn btn--primary" type="submit">Añadir</button></div></form>`);
  }

  // ---------------------------------------------------------------- FASES
  async function renderFases() {
    const d = await call('GET', evq('/matches'));
    A.cache.stages = d.stages;
    return d.stages.map((s) => `<section class="adm-card"><h3 class="adm-card__title">${esc(s.name)} ${s.type === 'swiss' ? (s.locked ? pill('Pick\'em cerrado') : s.ready ? pill('Pick\'em abierto', 'ok') : pill('esperando equipos', 'warn')) : ''} ${s.teamsManual ? pill('equipos a mano', 'gold') : ''}</h3>
        <p class="adm-sub">${s.teams.length} equipos${s.start ? ` · empieza ${fmtDayTime(new Date(s.start))}` : ''}${s.type === 'swiss' ? ' · el Pick\'em de Valve necesita los 16' : ''}</p>
        <div class="adm-teams">${s.teams.map((t) => `<span>${badge(t)} ${esc(t)}</span>`).join('') || '<span class="adm-hint">Ninguno todavía</span>'}</div>
        <form class="adm-form" data-adm-form="teams" data-stage="${s.id}"><label>Equipos a mano (uno por línea)<textarea class="input" name="teams" rows="4" placeholder="Vitality&#10;MOUZ&#10;…">${s.teamsManual ? esc(s.teams.join('\n')) : ''}</textarea></label>
          <div class="adm-actions">${s.teamsManual ? `<button class="btn" type="button" data-adm="teams-auto" data-stage="${s.id}">Volver a automático</button>` : ''}<button class="btn btn--primary" type="submit">Guardar equipos</button></div></form>
      </section>`).join('');
  }

  // ---------------------------------------------------------------- JUGADORES
  async function renderJugadores() {
    const d = await get('users');
    const now = Date.now();
    const q = (A.cache.uq || '').toLowerCase();
    const list = d.users.filter((u) => !q || u.nick.toLowerCase().includes(q));
    return `<div class="adm-toolbar"><input class="input" type="search" data-adm-q="uq" placeholder="Buscar apodo…" value="${esc(A.cache.uq || '')}"><span class="adm-hint">${list.length} de ${d.users.length} cuentas</span></div>
      ${list.length ? `<div class="adm-table adm-table--u"><div class="adm-tr adm-tr--head"><span>Jugador</span><span>Grupos</span><span>Pron.</span><span>Fases</span><span>Último</span><span></span></div>
      ${list.map((u) => `<div class="adm-tr"><span class="adm-td-main"><b>${badge(u.nick)} ${esc(u.nick)}</b><small>${d.admins.includes(u.nick.toLowerCase()) ? pill('admin', 'gold') : ''}${u.locked_until > now ? pill('bloqueada', 'warn') : ''} alta ${ago(u.created)}</small></span>
        <span>${u.groups}</span><span>${u.picks}</span><span>${u.stagepicks}</span><span>${u.last ? ago(u.last) : '—'}</span><span class="adm-td-act"><button class="btn btn--sm" data-adm="user" data-id="${u.id}">Ficha</button></span></div>`).join('')}</div>` : empty('Ninguna cuenta.')}`;
  }
  async function openUser(id) {
    const d = await get(`user/${id}`);
    const u = d.user;
    openDialog(`${badge(u.nick)} ${esc(u.nick)}`, `
      <div class="adm-grid2">
        <form class="adm-form" data-adm-form="upin" data-id="${u.id}"><label>Nuevo PIN<input class="input" name="pin" inputmode="numeric" maxlength="4" pattern="\\d{4}" required></label><button class="btn" type="submit">Cambiar PIN</button></form>
        <form class="adm-form" data-adm-form="urename" data-id="${u.id}"><div class="adm-grid2"><label>Nuevo apodo<input class="input" name="nick" value="${esc(u.nick)}" required></label><label>PIN (nuevo o el mismo)<input class="input" name="pin" inputmode="numeric" maxlength="4" pattern="\\d{4}" required></label></div><button class="btn" type="submit">Cambiar apodo</button></form>
      </div>
      <div class="adm-actions"><button class="btn" data-adm="uunlock" data-id="${u.id}">Desbloquear</button><button class="btn" data-adm="ulogout" data-id="${u.id}">Cerrar sus sesiones</button><button class="btn adm-danger" data-adm="udel" data-id="${u.id}" data-nick="${esc(u.nick)}">Borrar cuenta</button></div>
      <h3 class="adm-h3">Grupos</h3><p class="adm-sub">${d.groups.map((g) => `${esc(g.name)} (${esc(g.code)})`).join(' · ') || 'Ninguno'}</p>
      <h3 class="adm-h3">Campeón</h3><p class="adm-sub">${d.champion ? esc(d.champion) : '—'}</p>
      <h3 class="adm-h3">Pick'em de fases</h3>${d.stagepicks.length ? d.stagepicks.map((s) => `<p class="adm-sub"><b>${esc(stageName(s.stage))}:</b> 3-0 ${esc((s.data.w30 || []).join(', ') || '—')} · pasan ${esc((s.data.adv || []).join(', ') || '—')} · 0-3 ${esc((s.data.l03 || []).join(', ') || '—')}</p>`).join('') : '<p class="adm-sub">—</p>'}
      <h3 class="adm-h3">Cuadro</h3><p class="adm-sub">${d.bracket ? Object.entries(d.bracket).map(([k, v]) => `${k}: ${esc(v)}`).join(' · ') : '—'}</p>
      <h3 class="adm-h3">Pronósticos (${d.picks.length})</h3>${d.picks.length ? `<ul class="adm-list">${d.picks.slice(0, 60).map((p) => `<li><span><b>${p.match ? esc(matchName(p.match)) : esc(p.mid)}</b><small>${esc(p.team)}${p.score ? ' ' + p.score : ''} · ${ago(p.updated)}</small></span>${p.match ? `<button class="btn btn--sm adm-danger" data-adm="pdel" data-user="${u.id}" data-id="${esc(p.mid)}" data-back="${u.id}">Borrar</button>` : ''}</li>`).join('')}</ul>` : empty('Sin pronósticos.')}
      <h3 class="adm-h3">Actividad</h3>${logList(d.activity)}`, true);
  }

  // ---------------------------------------------------------------- GRUPOS
  async function renderGrupos() {
    const d = await get('leagues');
    return d.leagues.length ? `<div class="adm-table adm-table--g"><div class="adm-tr adm-tr--head"><span>Grupo</span><span>Jugadores</span><span>Creado por</span><span></span></div>
      ${d.leagues.map((l) => `<div class="adm-tr"><span class="adm-td-main"><b>${esc(l.name)}</b><small>código ${esc(l.code)} · ${ago(l.created)}</small></span><span>${l.players}</span><span>${esc(l.ownerNick || '—')}</span>
        <span class="adm-td-act"><button class="btn btn--sm" data-adm="league" data-code="${esc(l.code)}">Abrir</button></span></div>`).join('')}</div>` : empty('Todavía no hay grupos.');
  }
  async function openLeague(code) {
    const d = await get(`league/${code}`);
    const lg = d.league;
    openDialog(esc(lg.name), `
      <div class="adm-grid2">
        <form class="adm-form adm-form--inline" data-adm-form="lrename" data-code="${esc(lg.code)}"><label>Nombre<input class="input" name="name" value="${esc(lg.name)}" required></label><button class="btn" type="submit">Renombrar</button></form>
        <form class="adm-form adm-form--inline" data-adm-form="ladd" data-code="${esc(lg.code)}"><label>Añadir jugador<input class="input" name="nick" list="admUsers" required></label><datalist id="admUsers">${d.users.map((u) => `<option value="${esc(u.nick)}">`).join('')}</datalist><button class="btn" type="submit">Añadir</button></form>
      </div>
      <h3 class="adm-h3">Clasificación</h3>
      <div class="adm-table adm-table--b"><div class="adm-tr adm-tr--head"><span>#</span><span>Jugador</span><span>Total</span><span>Part.</span><span>Comb.</span><span>Fases</span><span>Cuadro</span><span>Camp.</span><span>Ajuste</span><span></span></div>
        ${d.board.map((r) => `<div class="adm-tr"><span>${r.pos}</span><span class="adm-td-main"><b>${esc(r.nick)}</b></span><span><b>${r.points}</b></span><span>${r.matches}</span><span>${r.combos}</span><span>${r.stages}</span><span>${r.bracket}</span><span>${r.champion}</span><span>${r.adjust}</span>
          <span class="adm-td-act"><button class="btn btn--sm adm-danger" data-adm="kick" data-code="${esc(lg.code)}" data-user="${r.id}">Quitar</button></span></div>`).join('')}</div>
      <h3 class="adm-h3">Ajustes de puntos</h3>
      <form class="adm-form adm-form--inline" data-adm-form="adjust" data-code="${esc(lg.code)}"><label>Jugador<select class="input" name="user">${d.board.map((r) => `<option value="${r.id}">${esc(r.nick)}</option>`).join('')}</select></label>
        <label>Puntos<input class="input" name="points" type="number" placeholder="+3 o -2" required></label><label>Motivo<input class="input" name="reason" maxlength="120" required></label><button class="btn btn--primary" type="submit">Añadir</button></form>
      ${d.adjust.length ? `<ul class="adm-list">${d.adjust.map((a) => `<li><span><b>${a.points > 0 ? '+' : ''}${a.points} · ${esc(d.board.find((r) => r.id === a.user)?.nick || '?')}</b><small>${esc(a.reason)} · ${esc(a.by || '')} · ${ago(a.created)}</small></span><button class="btn btn--sm adm-danger" data-adm="adjdel" data-id="${a.id}" data-code="${esc(lg.code)}">Quitar</button></li>`).join('')}</ul>` : ''}
      <div class="adm-actions adm-actions--end"><button class="btn adm-danger" data-adm="ldel" data-code="${esc(lg.code)}" data-name="${esc(lg.name)}">Borrar grupo</button></div>`, true);
  }

  // ---------------------------------------------------------------- REGISTRO
  function logList(items) {
    return items.length ? `<ul class="adm-log">${items.map((l) => `<li class="adm-log__item ${l.kind === 'admin' ? 'is-admin' : ''}"><span><b>${esc(l.action)}</b>${l.detail ? `<small>${esc(l.detail)}</small>` : ''}</span><span class="adm-log__meta"><b>${esc(l.actor || '')}</b><small>${fmtDayTime(new Date(l.at))}</small></span></li>`).join('')}</ul>` : empty('Sin actividad.');
  }
  async function renderRegistro() {
    const f = A.cache.lf || { kind: '', q: '' };
    const d = await get(`log?kind=${f.kind}&q=${encodeURIComponent(f.q)}`);
    return `<div class="adm-toolbar"><div class="adm-seg">${[['', 'Todo'], ['admin', 'Administración'], ['user', 'Jugadores']].map(([v, l]) => `<button type="button" class="${f.kind === v ? 'is-on' : ''}" data-adm="lf" data-v="${v}">${l}</button>`).join('')}</div>
      <input class="input" type="search" data-adm-q="lq" placeholder="Buscar…" value="${esc(f.q)}"></div><section class="adm-card">${logList(d.log)}</section>`;
  }

  // ---------------------------------------------------------------- MAJORS
  async function renderMajors() {
    const d = await get('majors');
    A.cache.majors = d.majors;
    const loaded = d.majors.filter((m) => m.loaded).length;
    const stat = (m) => (m.id === d.current ? pill('Pick\'em', 'gold') : '') + (m.status === 'upcoming' ? pill('próximo', 'soft') : m.status === 'live' ? pill('en juego', 'ok') : '')
      + (m.loaded ? (m.frozen ? pill('completo') : pill('con datos', 'ok')) : m.status === 'upcoming' ? '' : pill(m.error ? 'error' : 'pendiente', m.error ? 'warn' : ''));
    return `<section class="adm-card"><h3 class="adm-card__title">Descarga desde Liquipedia</h3>
        <p class="adm-sub">${loaded} de ${d.majors.length} Majors con partidos · última comprobación ${d.checked ? fmtDayTime(new Date(d.checked)) : 'nunca'}.</p>
        <p class="adm-hint">Los Majors antiguos se descargan poco a poco (unos 5 cada 10 minutos) y luego se quedan guardados. El del Pick'em se actualiza siempre.
          Para añadir un Major nuevo, añade una línea a la lista MAJORS de <code>scripts/update_majors.py</code>.</p>
        ${d.errors.length ? `<ul class="adm-list">${d.errors.map((e) => `<li><span>${pill('aviso', 'warn')} ${esc(e)}</span></li>`).join('')}</ul>` : ''}</section>
      <div class="adm-table adm-table--mj"><div class="adm-tr adm-tr--head"><span>Major</span><span>Campeón</span><span>MVP</span><span>Estado</span><span></span></div>
        ${d.majors.slice().reverse().map((m) => `<div class="adm-tr"><span class="adm-td-main"><b>${esc(m.name)}</b><small>${esc(m.city)} · ${esc(m.start)}${m.page ? ` · <a href="https://liquipedia.net/counterstrike/${encodeURI(m.page)}" target="_blank" rel="noopener">${esc(m.page)}</a>` : ''}${m.error ? ` · <span class="adm-err">${esc(m.error)}</span>` : ''}</small></span>
          <span>${m.champion ? `${badge(m.champion)} ${esc(m.champion)}` : '—'}</span><span>${esc(m.extra?.mvp || m.mvp || '—')}</span><span class="adm-badges">${stat(m)}</span>
          <span class="adm-td-act"><button class="btn btn--sm" type="button" data-adm="mjedit" data-id="${esc(m.id)}">Editar</button></span></div>`).join('')}</div>`;
  }
  function openMajor(id) {
    const m = A.cache.majors.find((x) => x.id === id);
    openDialog(esc(m.name), `<form class="adm-form" data-adm-form="majorinfo" data-id="${esc(m.id)}">
        <label>MVP<input class="input" name="mvp" maxlength="40" value="${esc(m.extra?.mvp || '')}" placeholder="${esc(m.mvp || 'Ej.: ZywOo')}"></label>
        <label>Nota (se muestra en la ficha del Major)<textarea class="input" name="note" rows="3" maxlength="400">${esc(m.extra?.note || '')}</textarea></label>
        <p class="adm-hint">Campeón, final, fechas y partidos salen de Liquipedia. Si dejas los dos campos vacíos se borra lo que pusiste.</p>
        <div class="adm-actions adm-actions--end"><a class="btn" href="#/majors/${esc(m.id)}">Ver la ficha</a><button class="btn btn--primary" type="submit">Guardar</button></div></form>`);
  }

  // ---------------------------------------------------------------- AJUSTES
  async function renderAjustes() {
    const d = await get('settings');
    const s = d.settings; const df = d.defaults;
    A.cache.settings = s;
    const g = (o, p) => p.split('.').reduce((x, k) => x?.[k], o);
    const num = (name, label, min, max) => `<label class="adm-setrow"><span><b>${label}</b><small>por defecto ${g(df, name)}</small></span><input class="input adm-num" type="number" name="${name}" min="${min}" max="${max}" value="${g(s, name)}" required></label>`;
    const chk = (name, label, hint) => `<label class="adm-setrow"><span><b>${label}</b><small>${hint}</small></span><span class="adm-switch"><input type="checkbox" name="${name}" ${g(s, name) ? 'checked' : ''}><span></span></span></label>`;
    const evOpts = [['', `Automático (ahora: ${(d.events.find((e) => e.id === d.autoCurrent) || {}).name || d.autoCurrent})`], ...d.events.map((e) => [e.id, e.name])];
    return `<form class="adm-settings" data-adm-form="settings"><div class="adm-grid2">
        <section class="adm-card"><h3 class="adm-card__title">Major del Pick'em</h3>
          <label class="adm-setrow adm-setrow--col"><span><b>¿Qué Major se pronostica?</b><small>En automático, el Pick'em pasa solo al siguiente Major una semana después de que termine el anterior. Los grupos y las cuentas se mantienen y cada Major guarda su clasificación.</small></span>
            <select class="input" name="currentEvent">${evOpts.map(([v, l]) => `<option value="${esc(v)}" ${s.currentEvent === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label></section>
        <section class="adm-card"><h3 class="adm-card__title">General</h3>
          ${chk('picksOpen', 'Pronósticos abiertos', 'Si lo apagas, nadie puede pronosticar.')}${chk('registrationOpen', 'Se pueden crear cuentas', 'Si lo apagas, solo entran las que ya existen.')}
          ${num('maxPlayers', 'Jugadores por grupo (máx.)', 2, 500)}${num('maxGroups', 'Grupos por cuenta (máx.)', 1, 100)}
          <label class="adm-setrow adm-setrow--col"><span><b>Aviso para todos</b></span><textarea class="input" name="banner" rows="2" maxlength="280">${esc(s.banner)}</textarea></label></section>
        <section class="adm-card"><h3 class="adm-card__title">Partido a partido</h3>
          ${num('points.win', 'Ganador acertado', 0, 50)}${num('points.exact', 'Resultado exacto (extra)', 0, 50)}${num('points.koMult', 'Multiplicador cuartos/semis/3.º', 1, 10)}${num('points.finalMult', 'Multiplicador Gran Final', 1, 10)}${num('points.champion', 'Campeón elegido al empezar', 0, 100)}</section>
        <section class="adm-card"><h3 class="adm-card__title">Pick'em de fases</h3>
          ${chk('valve.enabled', 'Activado', 'Pick\'em estilo Valve en cada fase suiza.')}${num('valve.p30', 'Cada 3-0 acertado', 0, 50)}${num('valve.p03', 'Cada 0-3 acertado', 0, 50)}${num('valve.adv', 'Cada equipo que pasa (3-1/3-2)', 0, 50)}</section>
        <section class="adm-card"><h3 class="adm-card__title">Cuadro y combinadas</h3>
          ${chk('bracket.enabled', 'Cuadro activado', 'Elegir ganadores de cuartos, semis y final.')}${num('bracket.qf', 'Cada cuarto acertado', 0, 50)}${num('bracket.sf', 'Cada semifinal acertada', 0, 50)}${num('bracket.final', 'Campeón del cuadro', 0, 100)}
          ${chk('combo.enabled', 'Combinadas activadas', '2 a 4 partidos de una misma ronda.')}${num('combo.p2', 'Combinada de 2', 0, 100)}${num('combo.p3', 'Combinada de 3', 0, 100)}${num('combo.p4', 'Combinada de 4', 0, 100)}${num('combo.exact', 'Extra por exacto', 0, 50)}${num('combo.koMult', 'Multiplicador en playoffs', 1, 10)}</section>
      </div>
      <section class="adm-card"><h3 class="adm-card__title">Copias de seguridad</h3>
        <p class="adm-sub">Se guarda una copia automática cada semana (si activaste la tarea programada en Cloudflare) y se conservan las 8 últimas.</p>
        <div id="admBackups" class="adm-sub">Cargando…</div>
        <div class="adm-actions"><button class="btn" type="button" data-adm="backup-now">Hacer una copia ahora</button></div></section>
      <div class="adm-actions adm-actions--end"><button class="btn" type="button" data-adm="export">Descargar copia (JSON)</button><button class="btn adm-danger" type="button" data-adm="sreset">Valores por defecto</button><button class="btn btn--primary" type="submit">Guardar ajustes</button></div></form>`;
  }

  async function loadBackups() {
    const el = document.getElementById('admBackups'); if (!el) return;
    try {
      const d = await get('backups');
      el.innerHTML = d.backups.length ? `<ul class="adm-list">${d.backups.map((b) => `<li><span><b>${fmtDayTime(new Date(b.at))}</b><small>${b.kind === 'semanal' ? 'automática semanal' : 'hecha a mano'} · ${Math.round(b.size / 1024)} KB</small></span>
          <button class="btn btn--sm" type="button" data-adm="backup-dl" data-id="${b.id}">Descargar</button></li>`).join('')}</ul>` : 'Todavía no hay copias guardadas.';
    } catch (err) { el.textContent = err.message; }
  }
  const RENDER = { resumen: renderResumen, partidos: renderPartidos, fases: renderFases, jugadores: renderJugadores, grupos: renderGrupos, registro: renderRegistro, majors: renderMajors, ajustes: renderAjustes };

  // ---------------------------------------------------------------- eventos
  const changed = async () => { clearMatches(); await reloadBody(); };
  $app.addEventListener('click', async (e) => {
    if (!isOpen()) return;
    const b = e.target.closest('[data-adm]');
    if (!b || b.matches('input')) return;
    const ds = b.dataset; const k = ds.adm;
    if (k === 'reload') { clearMatches(); A.st = null; $app.innerHTML = await view(A.section); return; }
    if (k === 'close') { closeDialog(); return; }
    if (k === 'mf') { A.cache.mf = { ...(A.cache.mf || { stage: '', state: '' }), [ds.k]: ds.v }; reloadBody(); return; }
    if (k === 'lf') { A.cache.lf = { ...(A.cache.lf || { q: '' }), kind: ds.v }; reloadBody(); return; }
    if (k === 'fix') { await act(() => openFix(ds.id)); return; }
    if (k === 'add') { openAdd(); return; }
    if (k === 'mjedit') { openMajor(ds.id); return; }
    if (k === 'backup-now') { if (await act(() => post('backup-now'), 'Copia guardada')) loadBackups(); return; }
    if (k === 'backup-dl') {
      await act(async () => {
        const d = await get(`backup?id=${ds.id}`);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 1)], { type: 'application/json' }));
        a.download = `clutch-copia-${(d.exported || '').slice(0, 10)}.json`; a.click();
      }, 'Copia descargada');
      return;
    }
    if (k === 'user') { await act(() => openUser(ds.id)); return; }
    if (k === 'league') { await act(() => openLeague(ds.code)); return; }
    if (k === 'hide') { if (confirm('¿Ocultar este partido? Desaparece de la web y no cuenta (se puede volver a mostrar).') && await act(() => post('fix', { mid: ds.id, hidden: true }), 'Partido ocultado')) { closeDialog(); changed(); } return; }
    if (k === 'unhide' || k === 'unfix') { if (await act(() => post('fix-clear', { mid: ds.id }), 'Corrección quitada')) { closeDialog(); changed(); } return; }
    if (k === 'mdel') { if (confirm('¿Borrar este partido y sus pronósticos?') && await act(() => post('match-delete', { mid: ds.id }), 'Partido borrado')) { closeDialog(); changed(); } return; }
    if (k === 'pdel') { if (await act(() => post('pick', { user: Number(ds.user), mid: ds.id, team: null }), 'Pronóstico borrado')) { if (ds.back) openUser(ds.back); else openFix(ds.id); } return; }
    if (k === 'teams-auto') { if (await act(() => post('stage-teams', { stage: ds.stage, teams: null }), 'Equipos automáticos')) changed(); return; }
    if (k === 'uunlock') { await act(() => post('user-unlock', { user: Number(ds.id) }), 'Cuenta desbloqueada'); return; }
    if (k === 'ulogout') { await act(() => post('user-logout', { user: Number(ds.id) }), 'Sesiones cerradas'); return; }
    if (k === 'udel') { if (prompt(`Para borrar la cuenta escribe su apodo (${ds.nick}):`) === ds.nick && await act(() => post('user-delete', { user: Number(ds.id) }), 'Cuenta borrada')) { closeDialog(); reloadBody(); } return; }
    if (k === 'kick') { if (confirm('¿Quitar a este jugador del grupo?') && await act(() => post('league-kick', { code: ds.code, user: Number(ds.user) }), 'Jugador quitado')) openLeague(ds.code); return; }
    if (k === 'adjdel') { if (await act(() => post('adjust-delete', { id: Number(ds.id) }), 'Ajuste quitado')) openLeague(ds.code); return; }
    if (k === 'ldel') { if (prompt(`Para borrar el grupo escribe su nombre (${ds.name}):`) === ds.name && await act(() => post('league-delete', { code: ds.code }), 'Grupo borrado')) { closeDialog(); reloadBody(); } return; }
    if (k === 'sreset') { if (confirm('¿Volver a los valores por defecto?') && await act(() => post('settings-reset'), 'Ajustes restablecidos')) changed(); return; }
    if (k === 'export') {
      await act(async () => {
        const d = await get('export');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 1)], { type: 'application/json' }));
        a.download = `clutch-copia-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      }, 'Copia descargada');
    }
  });
  $app.addEventListener('change', async (e) => {
    if (!isOpen()) return;
    const t = e.target;
    if (t.matches('[data-adm-ev]')) { A.ev = t.value; A.st = null; A.cache.mf = null; $app.innerHTML = await view(A.section); return; }
    if (t.dataset.adm === 'toggle') {
      const s = structuredClone(A.cache.settings); s[t.dataset.field] = t.checked;
      if (!await act(async () => { A.cache.settings = (await post('settings', { settings: s })).settings; }, 'Guardado')) t.checked = !t.checked;
      clearMatches();
    }
  });
  $app.addEventListener('input', (e) => {
    if (!isOpen()) return;
    const t = e.target;
    if (!t.dataset.admQ) return;
    clearTimeout(A.qt);
    A.qt = setTimeout(async () => {
      if (t.dataset.admQ === 'uq') A.cache.uq = t.value; else A.cache.lf = { ...(A.cache.lf || { kind: '' }), q: t.value };
      await reloadBody();
      const el = document.querySelector(`[data-adm-q="${t.dataset.admQ}"]`); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    }, 300);
  });
  $app.addEventListener('submit', async (e) => {
    if (!isOpen()) return;
    const f = e.target.closest('[data-adm-form]');
    if (!f) return;
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(f)); const ds = f.dataset;
    const k = ds.admForm;
    if (k === 'banner') { const s = { ...A.cache.settings, banner: fd.banner }; if (await act(async () => { A.cache.settings = (await post('settings', { settings: s })).settings; }, 'Aviso guardado')) clearMatches(); return; }
    if (k === 'fix') {
      const body = { mid: ds.id, t1: fd.t1, t2: fd.t2, date: fd.date ? new Date(fd.date).toISOString() : null };
      if (fd.winner !== '') Object.assign(body, { winner: Number(fd.winner), s1: fd.s1, s2: fd.s2 });
      if (await act(() => post('fix', body), 'Partido guardado')) { closeDialog(); changed(); }
      return;
    }
    if (k === 'pick') { if (await act(() => post('pick', { user: Number(fd.user), mid: ds.id, team: fd.team, score: fd.score || null }), 'Pronóstico puesto')) openFix(ds.id); return; }
    if (k === 'add') {
      if (await act(() => post('match-add', { ...fd, bo: Number(fd.bo), date: fd.date ? new Date(fd.date).toISOString() : null }), 'Partido añadido')) { closeDialog(); changed(); }
      return;
    }
    if (k === 'teams') { if (await act(() => post('stage-teams', { stage: ds.stage, teams: fd.teams }), 'Equipos guardados')) changed(); return; }
    if (k === 'upin') { await act(() => post('user-pin', { user: Number(ds.id), pin: fd.pin }), 'PIN cambiado'); return; }
    if (k === 'urename') { if (await act(() => post('user-rename', { user: Number(ds.id), nick: fd.nick, pin: fd.pin }), 'Apodo cambiado')) { closeDialog(); reloadBody(); } return; }
    if (k === 'lrename') { if (await act(() => post('league-rename', { code: ds.code, name: fd.name }), 'Grupo renombrado')) reloadBody(); return; }
    if (k === 'ladd') { if (await act(() => post('league-add', { code: ds.code, nick: fd.nick }), 'Jugador añadido')) openLeague(ds.code); return; }
    if (k === 'adjust') { if (await act(() => post('adjust-add', { code: ds.code, user: Number(fd.user), points: Number(fd.points), reason: fd.reason }), 'Ajuste añadido')) openLeague(ds.code); return; }
    if (k === 'settings') {
      const s = structuredClone(A.cache.settings);
      for (const el of f.querySelectorAll('input[name], textarea[name], select[name]')) {
        const path = el.name.split('.'); let o = s;
        while (path.length > 1) o = o[path.shift()];
        o[path[0]] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
      }
      if (await act(async () => { A.cache.settings = (await post('settings', { settings: s })).settings; }, 'Ajustes guardados')) { A.st = null; A.ev = ''; changed(); }
      return;
    }
    if (k === 'majorinfo') { if (await act(() => post('majorinfo', { id: ds.id, mvp: fd.mvp, note: fd.note }), 'Major guardado')) { closeDialog(); reloadBody(); } }
  });
  return { view, isOpen };
}
