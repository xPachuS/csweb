// Buscador global, récords, cara a cara, «Acerca de», avisos, compartir como imagen y tema claro/oscuro.
export function createExtras(h) {
  const { esc, badge, fmtDate, fmtDayTime, $app, majors, stats } = h;
  const E = { records: null, series: null, q: '' };
  const minute = () => Math.floor(Date.now() / 600_000);
  const enc = encodeURIComponent;
  const getJson = async (key, path, fallback) => {
    if (E[key]) return E[key];
    try { const r = await fetch(`${path}?v=${minute()}`); E[key] = r.ok ? await r.json() : fallback; } catch { E[key] = fallback; }
    return E[key];
  };
  const getRecords = () => getJson('records', 'data/records.json', null);
  const getSeries = () => getJson('series', 'data/series.json', { series: [] });
  const isOpen = () => !!$app.querySelector('.xx');
  const mName = (idx, id) => { const m = idx.majors.find((x) => x.id === id); return m ? `${m.city} ${m.year}` : id; };

  // ---------------------------------------------------------------- buscador global
  let dialog = null;
  async function openSearch() {
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.className = 'srch';
      dialog.innerHTML = `<div class="srch__box"><div class="srch__bar"><span aria-hidden="true">🔍</span>
          <input class="srch__in" type="search" placeholder="Busca un Major, un equipo o un jugador…" aria-label="Buscar" autocomplete="off">
          <button class="adm-x" type="button" data-srch-close aria-label="Cerrar">×</button></div>
        <div class="srch__res" role="listbox"></div><p class="srch__hint">Pulsa <kbd>/</kbd> desde cualquier página para buscar · <kbd>Esc</kbd> para cerrar</p></div>`;
      document.body.appendChild(dialog);
      const input = dialog.querySelector('input');
      input.addEventListener('input', () => renderResults(input.value));
      input.addEventListener('keydown', (e) => {
        const items = [...dialog.querySelectorAll('.srch__item')];
        const cur = items.indexOf(dialog.querySelector('.srch__item.is-on'));
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const next = items[Math.max(0, Math.min(items.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1)))];
          items.forEach((x) => x.classList.toggle('is-on', x === next)); next?.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter') {
          const el = dialog.querySelector('.srch__item.is-on') || items[0];
          if (el) { location.hash = el.getAttribute('href'); dialog.close(); }
        }
      });
      dialog.addEventListener('click', (e) => {
        if (e.target === dialog || e.target.closest('[data-srch-close]')) dialog.close();
        if (e.target.closest('.srch__item')) dialog.close();
      });
    }
    dialog.showModal();
    const input = dialog.querySelector('input');
    input.value = E.q; input.select();
    renderResults(E.q);
  }
  async function renderResults(q) {
    E.q = q;
    const box = dialog.querySelector('.srch__res');
    const [idx, st] = await Promise.all([majors.getIndex(), stats.getStats()]);
    const n = norm(q);
    if (!n) {
      box.innerHTML = `<p class="srch__empty">Prueba con «s1mple», «Vitality», «Colonia» o «2019».</p>`;
      return;
    }
    const score = (text) => { const t = norm(text); return t === n ? 3 : t.startsWith(n) ? 2 : t.includes(n) ? 1 : 0; };
    const mj = idx.majors.map((m) => ({ m, s: Math.max(score(m.name), score(m.city), score(String(m.year)), score(`${m.city} ${m.year}`)) })).filter((x) => x.s).sort((a, b) => b.s - a.s || b.m.year - a.m.year).slice(0, 5);
    const tm = Object.entries(st.teams).map(([t, v]) => ({ t, v, s: score(t) })).filter((x) => x.s).sort((a, b) => b.s - a.s || b.v.majors.length - a.v.majors.length).slice(0, 6);
    const pl = Object.entries(st.players).map(([p, v]) => ({ p, v, s: score(p) })).filter((x) => x.s).sort((a, b) => b.s - a.s || b.v.majors.length - a.v.majors.length).slice(0, 8);
    const sec = (title, items) => (items.length ? `<h4>${title}</h4>${items.join('')}` : '');
    const html = sec('Majors', mj.map(({ m }) => `<a class="srch__item" href="#/majors/${esc(m.id)}">${majors.flag(m.country)}<span><b>${esc(m.name)}</b><small>${m.champion ? `Campeón: ${esc(m.champion)}` : esc(m.city)}</small></span></a>`))
      + sec('Equipos', tm.map(({ t, v }) => `<a class="srch__item" href="#/equipos/${enc(t)}">${badge(t)}<span><b>${esc(t)}</b><small>${v.majors.length} Majors${v.titles ? ` · ${v.titles} título${v.titles > 1 ? 's' : ''}` : ''}</small></span></a>`))
      + sec('Jugadores', pl.map(({ p, v }) => { const last = v.majors[v.majors.length - 1]; return `<a class="srch__item" href="#/jugadores/${enc(p)}">${majors.flag(v.flag) || '<span class="srch__dot">👤</span>'}<span><b>${esc(p)}</b><small>${last ? `${esc(last.team)} · ${esc(mName(idx, last.id))}` : ''}</small></span></a>`; }));
    box.innerHTML = html || `<p class="srch__empty">No hay nada con «${esc(q)}».</p>`;
    box.querySelector('.srch__item')?.classList.add('is-on');
  }
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.target.matches('input, textarea, select') && !document.querySelector('dialog[open]')) { e.preventDefault(); openSearch(); }
  });
  document.addEventListener('click', (e) => { if (e.target.closest('[data-search]')) openSearch(); });

  // ---------------------------------------------------------------- récords
  async function recordsPage() {
    const [r, idx, st] = await Promise.all([getRecords(), majors.getIndex(), stats.getStats()]);
    if (!r) return `<div class="empty">Los récords se calculan con la próxima actualización de datos.</div>`;
    const flagP = (p) => majors.flag(st.players[p]?.flag);
    const team = (t) => `<a class="tlink" href="#/equipos/${enc(t)}">${badge(t)}<span>${esc(t)}</span></a>`;
    const player = (p) => `<a class="plink" href="#/jugadores/${enc(p)}">${flagP(p)} ${esc(p)}</a>`;
    // lista con barra proporcional al primero
    const list = (rows, fmt, n = 10) => { const max = Math.max(1, ...rows.map((x) => x[0]));
      return `<ol class="rk rk--bars">${rows.slice(0, n).map((x, i) => `<li style="--w:${Math.round((x[0] / max) * 100)}%"><i>${i + 1}</i>${fmt(x)}<b>${x[0]}</b></li>`).join('')}</ol>`; };
    const box = (title, body, note = '', cls = '') => `<section class="card rbox ${cls}"><h3>${title}</h3>${body}${note ? `<p class="hint">${note}</p>` : ''}</section>`;
    const podium = (rows, item, unit) => rows.length < 3 ? '' : `<div class="rpod">${[rows[1], rows[0], rows[2]].map((x, i) => `<div class="rpod__it rpod__it--${[2, 1, 3][i]}">${item(x[1])}<b>${x[0]}</b><small>${unit}</small><div class="rpod__step">${[2, 1, 3][i]}</div></div>`).join('')}</div>`;
    const teamBig = (t) => `<a href="#/equipos/${enc(t)}" class="rpod__who">${badge(t, 'tb--xl')}<span>${esc(t)}</span></a>`;
    const playerBig = (p) => `<a href="#/jugadores/${enc(p)}" class="rpod__who"><span class="rpod__flag">${flagP(p) || '🎮'}</span><span>${esc(p)}</span></a>`;
    const matchCard = (x, label) => `<a class="rmatch" href="#/majors/${esc(x[1])}/p/${esc(x[2])}">
        <span class="rmatch__map">${stats.mapThumb(x[5])}</span>
        <span class="rmatch__body"><small>${esc(x[5])} · ${esc(mName(idx, x[1]))}</small><span class="rmatch__teams">${badge(x[3])}<b>${esc(x[3])}</b><em>${x[6]}–${x[7]}</em><b>${esc(x[4])}</b>${badge(x[4])}</span></span>
        <span class="rmatch__n"><b>${x[0]}</b><small>${label}</small></span></a>`;
    const eras = Object.entries(r.mapsByEra || {});
    const done = idx.majors.filter((m) => m.status === 'done').length;
    const nTeams = Object.keys(st.teams).length;
    const nPlayers = Object.values(st.players).filter((p) => p.majors.some((e) => e.role === 'player')).length;
    const finals = (r.finals || []).slice().reverse();
    const num = (n, l) => `<div class="rnum"><b>${Number(n).toLocaleString('es-ES')}</b><small>${l}</small></div>`;
    const sec = (t, id) => `<h2 class="rsec" id="r-${id}">${t}</h2>`;
    return `<div class="xx rec"><section class="rhero"><div><p class="kicker">Historial</p><h1 class="ghead__title">Récords de los Majors</h1>
        <p class="lead">Todo lo que ha pasado en los Majors de Counter-Strike desde 2013, con los datos de Liquipedia.</p>
        <nav class="rjump">${[['equipos', 'Equipos'], ['jugadores', 'Jugadores'], ['partidos', 'Partidos'], ['finales', 'Finales'], ['mapas', 'Mapas']].map(([id, l]) => `<a href="#r-${id}" data-rjump="${id}">${l}</a>`).join('')}</nav></div>
        <div class="rnums">${num(done, 'Majors')}${num(r.series, 'series')}${num(r.maps, 'mapas')}${num(nTeams, 'equipos')}${num(nPlayers, 'jugadores')}</div></section>

      ${sec('Equipos', 'equipos')}
      <div class="rfeat">${box('🏆 Más títulos', podium(r.teamTitles, teamBig, 'títulos') + list(r.teamTitles.slice(3), (x) => team(x[1]), 7).replace(/<i>(\d+)<\/i>/g, (m, n) => `<i>${+n + 3}</i>`), '', 'rbox--wide')}</div>
      <div class="rgrid2">
        ${box('🥈 Más finales', list(r.teamFinals, (x) => team(x[1])))}
        ${box('🗓 Más Majors jugados', list(r.teamMajors, (x) => team(x[1])))}
        ${box('🔁 Más Majors seguidos', list(r.teamStreak, (x) => team(x[1])))}
        ${box('🧹 Más 3-0 en fases suizas', list(r.teamSweeps, (x) => team(x[1])), 'Fases suizas terminadas sin perder ninguna serie.')}
      </div>

      ${sec('Jugadores', 'jugadores')}
      <div class="rgrid2 rgrid2--2">
        ${box('👑 Más títulos', podium(r.playerTitles, playerBig, 'títulos') + list(r.playerTitles.slice(3), (x) => player(x[1]), 7).replace(/<i>(\d+)<\/i>/g, (m, n) => `<i>${+n + 3}</i>`))}
        ${box('🎮 Más Majors jugados', podium(r.playerMajors, playerBig, 'Majors') + list(r.playerMajors.slice(3), (x) => player(x[1]), 7).replace(/<i>(\d+)<\/i>/g, (m, n) => `<i>${+n + 3}</i>`))}
      </div>

      ${sec('Partidos', 'partidos')}
      <div class="rgrid2 rgrid2--2">
        ${box('⏱ Mapas más largos', `<div class="rmatches">${r.longestMaps.slice(0, 6).map((x) => matchCard(x, 'rondas')).join('')}</div>`, 'Rondas totales del mapa, prórrogas incluidas.')}
        ${r.overtimes?.length ? box('🔥 Más rondas de prórroga', `<div class="rmatches">${r.overtimes.slice(0, 6).map((x) => matchCard(x, 'en prórroga')).join('')}</div>`) : ''}
      </div>

      ${finals.length ? `${sec('Finales', 'finales')}
      <section class="card rfinals">${finals.map((f) => { const w = f[5] === 1 ? f[1] : f[2]; const l = f[5] === 1 ? f[2] : f[1]; const m = idx.majors.find((x) => x.id === f[0]);
        return `<a class="rfin" href="#/majors/${esc(f[0])}"><span class="rfin__y">${m?.year || ''}<small>${esc(m?.city || '')}</small></span>
          <span class="rfin__w">${badge(w, 'tb--lg')}<b>${esc(w)}</b></span><span class="rfin__s">${Math.max(f[3], f[4])}–${Math.min(f[3], f[4])}</span><span class="rfin__l">${badge(l)}<span>${esc(l)}</span></span></a>`; }).join('')}
        ${r.finalPairs?.length ? `<p class="hint">Finales repetidas: ${r.finalPairs.map((x) => `${esc(x[1])} (${x[0]}×)`).join(' · ')}.</p>` : ''}</section>` : ''}

      ${sec('Mapas', 'mapas')}
      <div class="rgrid2 rgrid2--2">${eras.map(([era, rows]) => { const max = Math.max(...rows.map((x) => x[0]));
        return box(`🗺 Más jugados · ${esc(era)}`, `<div class="rmaps">${rows.slice(0, 8).map((x, i) => `<div class="rmap" style="--w:${Math.round((x[0] / max) * 100)}%">${stats.mapThumb(x[1])}<span><b>${esc(x[1])}</b><i class="rmap__bar"></i></span><em>${x[0]}</em></div>`).join('')}</div>`); }).join('')}</div>
    </div>`;
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-rjump]');
    if (!a) return;
    e.preventDefault();
    document.getElementById(`r-${a.dataset.rjump}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // ---------------------------------------------------------------- cara a cara
  async function h2h(a, b) {
    const [sr, idx, st] = await Promise.all([getSeries(), majors.getIndex(), stats.getStats()]);
    const teams = Object.keys(st.teams).sort((x, y) => x.localeCompare(y));
    const rows = sr.series.filter((s) => (s[2] === a && s[3] === b) || (s[2] === b && s[3] === a)).sort((x, y) => y[0].localeCompare(x[0]));
    const winsA = rows.filter((s) => (s[6] === 1 ? s[2] : s[3]) === a).length;
    const maps = {};
    let mapsA = 0; let mapsB = 0;
    for (const s of rows) {
      for (const [mp, w] of s[8]) {
        const winner = w === 1 ? s[2] : s[3];
        const x = maps[mp] = maps[mp] || [0, 0];
        if (winner === a) { x[0]++; mapsA++; } else { x[1]++; mapsB++; }
      }
    }
    const opts = (cur) => teams.map((t) => `<option ${t === cur ? 'selected' : ''}>${esc(t)}</option>`).join('');
    const pct = (x, y) => (x + y ? Math.round((x / (x + y)) * 100) : 50);
    return `<div class="xx"><nav class="mjnav"><a href="#/equipos/${enc(a)}">← ${esc(a)}</a></nav>
      <section class="mjhead"><p class="kicker">Cara a cara en Majors</p>
        <div class="h2hsel"><select class="input" data-h2h="a">${opts(a)}</select><span>vs</span><select class="input" data-h2h="b">${opts(b)}</select></div></section>
      <section class="h2hhead">${badge(a, 'tb--xl')}<div class="h2hscore"><b>${winsA}</b><i>–</i><b>${rows.length - winsA}</b><small>${rows.length} serie${rows.length === 1 ? '' : 's'}</small></div>${badge(b, 'tb--xl')}</section>
      ${rows.length ? `<div class="h2hbar"><i style="width:${pct(winsA, rows.length - winsA)}%"></i></div>
        <div class="stcols"><section class="card"><h3>Series</h3><ul class="mrs">${rows.map((s) => {
          const aFirst = s[2] === a; const sa = aFirst ? s[4] : s[5]; const sb = aFirst ? s[5] : s[4];
          const won = (s[6] === 1 ? s[2] : s[3]) === a;
          return `<li class="mr h2hrow"><a class="mr__link" href="#/majors/${esc(s[0])}/p/${esc(s[1])}" aria-label="Ver partido"></a><span class="mr__when">${esc(mName(idx, s[0]))}<small>${esc(s[7] === 'final' ? 'Gran final' : s[7] === 'sf' ? 'Semifinal' : s[7] === 'qf' ? 'Cuartos' : 'Fase')}</small></span>
            <span class="mr__t ${won ? 'is-won' : 'is-lost'}">${badge(a)}<b>${esc(a)}</b></span><span class="mr__score"><b class="${won ? 'w' : ''}">${sa}</b>–<b class="${won ? '' : 'w'}">${sb}</b></span><span class="mr__t mr__t--r ${won ? 'is-lost' : 'is-won'}">${badge(b)}<b>${esc(b)}</b></span>
            ${s[8].length ? `<span class="mr__maps">${s[8].map(([mp, w]) => `${esc(mp)} → ${esc(w === 1 ? s[2] : s[3])}`).join(' · ')}</span>` : ''}</li>`;
        }).join('')}</ul></section>
        <section class="card"><h3>Por mapa</h3>${Object.keys(maps).length ? `<p class="hint">Mapas ganados: ${esc(a)} ${mapsA} – ${mapsB} ${esc(b)}</p>
          <div class="h2hmaps">${Object.entries(maps).sort((x, y) => (y[1][0] + y[1][1]) - (x[1][0] + x[1][1])).map(([mp, [x, y]]) => `<div class="h2hmap">${stats.mapThumb(mp)}<b>${esc(mp)}</b><span>${x}–${y}</span><div class="h2hbar h2hbar--sm"><i style="width:${pct(x, y)}%"></i></div></div>`).join('')}</div>`
          : '<p class="hint">Liquipedia no tiene el detalle de mapas de estas series.</p>'}</section></div>`
        : `<div class="empty">${esc(a)} y ${esc(b)} no se han enfrentado nunca en un Major.</div>`}
    </div>`;
  }
  $app.addEventListener('change', (e) => {
    const t = e.target.closest('[data-h2h]');
    if (!t) return;
    const a = document.querySelector('[data-h2h="a"]').value; const b = document.querySelector('[data-h2h="b"]').value;
    location.hash = `#/equipos/${enc(a)}/vs/${enc(b)}`;
  });

  // ---------------------------------------------------------------- acerca de
  function about() {
    return `<div class="xx about"><section class="mjhead"><p class="kicker">Clutch</p><h1 class="ghead__title">Acerca de</h1>
        <p class="lead">Una web de aficionados para seguir los Majors de Counter-Strike y jugar al Pick'em con amigos. Sin publicidad, sin apuestas y sin dinero: solo puntos.</p></section>
      <div class="rgrid2">
        <section class="card"><h3>📚 De dónde salen los datos</h3><p>Partidos, resultados, mapas, plantillas, logos e imágenes de mapas: <a href="https://liquipedia.net/counterstrike/" target="_blank" rel="noopener">Liquipedia</a>, con licencia <a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener">CC-BY-SA 3.0</a>. Se actualizan solos cada pocos minutos.</p>
          <p>Las estadísticas de cada jugador (kills, muertes, asistencias) no están en Liquipedia: cada partido enlaza a <a href="https://www.hltv.org" target="_blank" rel="noopener">HLTV</a>, donde están completas.</p></section>
        <section class="card"><h3>⚖ Marcas</h3><p>Clutch no tiene relación con Valve, PGL, ESL, BLAST, StarLadder, Perfect World ni ningún organizador. Counter-Strike es una marca de Valve Corporation y los logos son marcas de sus equipos; aquí solo se usan para identificarlos.</p></section>
        <section class="card"><h3>🔐 Tus datos</h3><p>Para el Pick'em solo se guarda tu apodo, tu PIN (protegido, nunca tal cual), tus grupos y tus pronósticos. No hay correos, ni anuncios, ni rastreadores. Los avisos funcionan en tu navegador y no salen de él.</p></section>
        <section class="card"><h3>⌨ Atajos</h3><p><kbd>/</kbd> abre el buscador desde cualquier página. En el móvil puedes instalar la web como una app desde el menú del navegador («Añadir a pantalla de inicio»).</p></section>
      </div></div>`;
  }

  // ---------------------------------------------------------------- avisos (notificaciones del navegador)
  const NKEY = 'clutch:avisos';
  const notifOn = () => { try { return localStorage.getItem(NKEY) === '1' && 'Notification' in window && Notification.permission === 'granted'; } catch { return false; } };
  async function toggleNotifications() {
    if (!('Notification' in window)) { alert('Este navegador no permite avisos.'); return false; }
    if (notifOn()) { try { localStorage.setItem(NKEY, '0'); } catch { /* */ } return false; }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { alert('Sin permiso no se pueden enviar avisos. Puedes activarlo en los ajustes del navegador.'); return false; }
    try { localStorage.setItem(NKEY, '1'); } catch { /* */ }
    notify('Avisos activados', 'Te avisaremos 30 minutos antes de que se cierren tus pronósticos pendientes.');
    return true;
  }
  async function notify(title, body, tag) {
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) await reg.showNotification(title, { body, tag, icon: 'img/icon-192.png', badge: 'img/icon-192.png', data: { url: location.href } });
      else new Notification(title, { body, tag, icon: 'img/icon-192.png' });
    } catch { /* */ }
  }
  /** Programa avisos 30 min antes de cada cierre pendiente (mientras la web esté abierta, aunque sea en segundo plano). */
  let timers = [];
  function scheduleReminders(items) {
    timers.forEach(clearTimeout); timers = [];
    if (!notifOn()) return;
    const sent = (() => { try { return JSON.parse(localStorage.getItem('clutch:avisados') || '{}'); } catch { return {}; } })();
    for (const it of items) {
      const at = it.closes - 30 * 60_000;
      const wait = at - Date.now();
      if (sent[it.key] || it.closes < Date.now()) continue;
      const fire = () => {
        notify(it.title, it.body, it.key);
        sent[it.key] = 1; try { localStorage.setItem('clutch:avisados', JSON.stringify(sent)); } catch { /* */ }
      };
      if (wait <= 0) fire(); else if (wait < 2 ** 31 - 1) timers.push(setTimeout(fire, wait));
    }
  }

  // ---------------------------------------------------------------- compartir como imagen
  async function shareImage({ title, subtitle, sections, file }) {
    const W = 1080; const pad = 56;
    const rowsH = sections.reduce((s, sec) => s + 64 + Math.ceil(sec.items.length / 2) * 64, 0);
    const H = Math.max(1080, 260 + rowsH + 120);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#141a24'); bg.addColorStop(1, '#0b0e13');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(240,163,54,.18)'; g.beginPath(); g.arc(W - 120, 120, 260, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f0a336'; g.font = '700 30px "Chakra Petch", Inter, sans-serif'; g.fillText('CLUTCH · PICK\'EM', pad, 92);
    g.fillStyle = '#e9edf3'; g.font = '700 58px "Chakra Petch", Inter, sans-serif'; g.fillText(title, pad, 168);
    g.fillStyle = '#93a0b2'; g.font = '500 30px Inter, sans-serif'; g.fillText(subtitle, pad, 214);
    let y = 270;
    const colors = { ct: '#5ea8ff', ok: '#43c97f', t: '#f0a336', gold: '#ffbe5c' };
    for (const sec of sections) {
      g.fillStyle = colors[sec.color] || '#e9edf3'; g.font = '700 30px "Chakra Petch", Inter, sans-serif'; g.fillText(sec.label, pad, y + 30);
      y += 52;
      sec.items.forEach((it, i) => {
        const x = pad + (i % 2) * ((W - pad * 2) / 2 + 8); const yy = y + Math.floor(i / 2) * 64;
        g.fillStyle = 'rgba(255,255,255,.05)'; roundRect(g, x, yy, (W - pad * 2) / 2 - 8, 52, 12); g.fill();
        g.fillStyle = colors[sec.color] || '#e9edf3'; g.fillRect(x, yy, 6, 52);
        g.fillStyle = '#e9edf3'; g.font = '600 26px Inter, sans-serif'; g.fillText(fit(g, it, (W - pad * 2) / 2 - 50), x + 22, yy + 35);
      });
      y += Math.ceil(sec.items.length / 2) * 64 + 12;
    }
    g.fillStyle = '#66738a'; g.font = '500 24px Inter, sans-serif'; g.fillText(location.host + location.pathname.replace(/\/$/, ''), pad, H - 48);
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    const f = new File([blob], file, { type: 'image/png' });
    if (navigator.canShare?.({ files: [f] })) {
      try { await navigator.share({ files: [f], title }); return; } catch (err) { if (err.name === 'AbortError') return; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  function roundRect(g, x, y, w, h2, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h2, r); g.arcTo(x + w, y + h2, x, y + h2, r); g.arcTo(x, y + h2, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function fit(g, text, max) { let t = String(text); while (g.measureText(t).width > max && t.length > 3) t = t.slice(0, -2); return t === String(text) ? t : t + '…'; }

  // ---------------------------------------------------------------- tema claro / oscuro
  const TKEY = 'clutch:tema';
  function applyTheme(t) {
    const theme = t || (() => { try { return localStorage.getItem(TKEY); } catch { return null; } })() || 'dark';
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f4f6f9' : '#0b0e13');
    const b = document.querySelector('[data-theme-toggle]');
    if (b) { b.textContent = theme === 'light' ? '☾' : '☀'; b.setAttribute('aria-label', theme === 'light' ? 'Tema oscuro' : 'Tema claro'); }
  }
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-theme-toggle]')) return;
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(TKEY, next); } catch { /* */ }
    applyTheme(next);
  });
  applyTheme();

  return { openSearch, recordsPage, h2h, about, isOpen, toggleNotifications, notifOn, scheduleReminders, shareImage };
}
