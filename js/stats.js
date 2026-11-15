// Equipos, jugadores y partidos desglosados (#/equipos, #/jugadores, #/majors/<id>/p/<partido>).
// Datos: data/stats.json y data/majors/<id>.json (Liquipedia). Las estadísticas de cada jugador se enlazan a HLTV.
export function createStats(h) {
  const { esc, badge, fmtDate, fmtDayTime, $app, majors } = h;
  const X = { stats: null, t: 0, q: '', pq: '', sort: 'titles' };
  const minute = () => Math.floor(Date.now() / 60_000);
  async function getStats() {
    await mapsReady;
    if (X.stats && Date.now() - X.t < 120_000) return X.stats;
    const r = await fetch(`data/stats.json?v=${minute()}`);
    X.stats = r.ok ? await r.json() : { teams: {}, players: {} };
    X.t = Date.now();
    return X.stats;
  }
  const enc = (s) => encodeURIComponent(s);
  const teamLink = (t, cls = '') => (t && t !== 'TBD' ? `<a class="tlink ${cls}" href="#/equipos/${enc(t)}">${badge(t)}<span>${esc(t)}</span></a>` : `<span class="tlink">${badge('TBD')}<span>Por decidir</span></span>`);
  const flagOf = (cc) => majors.flag(cc);
  // Imágenes de los mapas (data/maps.json); si falta alguna, un degradado con el nombre
  let MAPS = {};
  const mapsReady = fetch(`data/maps.json?v=${Math.floor(Date.now() / 600_000)}`).then((r) => (r.ok ? r.json() : {})).then((d) => { MAPS = d.maps || {}; }).catch(() => {});
  const mhue = (s) => { let x = 7; for (const ch of String(s)) x = (x * 37 + ch.charCodeAt(0)) % 360; return x; };
  const mapBg = (name) => (MAPS[name]?.img ? `background-image:linear-gradient(180deg, rgba(11,14,19,.15), rgba(11,14,19,.92)), url('${esc(MAPS[name].img)}')` : `--mh:${mhue(name)}`);
  const mapThumb = (name) => `<span class="mthumb ${MAPS[name]?.img ? '' : 'is-fake'}" style="${MAPS[name]?.img ? `background-image:url('${esc(MAPS[name].img)}')` : `--mh:${mhue(name)}`}" aria-hidden="true"></span>`;
  const pLink = (p) => `<a class="plink" href="#/jugadores/${enc(p.n || p)}">${flagOf(p.flag)} ${esc(p.n || p)}</a>`;
  const pct = (a, b) => (a + b ? Math.round((a / (a + b)) * 100) : 0);
  const majorName = (idx, id) => { const m = idx.majors.find((x) => x.id === id); return m ? `${m.city} ${m.year}` : id; };
  const hltvMatch = (id) => `https://www.hltv.org/matches/${id}/clutch`;
  const hltvMap = (id) => `https://www.hltv.org/stats/matches/mapstatsid/${id}/clutch`;
  const placeTxt = (e) => (e.rank == null ? e.place : e.rank >= 10 ? `Fuera en ${e.place}` : e.place);
  const placeCls = (r) => (r === 1 ? 'is-gold' : r === 2 ? 'is-silver' : r != null && r <= 5 ? 'is-top' : '');
  const isOpen = () => !!$app.querySelector('.st');

  // ---------------------------------------------------------------- equipos
  async function teamsList() {
    const [st, idx] = await Promise.all([getStats(), majors.getIndex()]);
    const q = X.q.toLowerCase();
    const rows = Object.entries(st.teams).map(([t, v]) => ({ t, ...v, n: v.majors.length }))
      .filter((r) => !q || r.t.toLowerCase().includes(q));
    const sorts = { titles: (a, b) => b.titles - a.titles || b.finals - a.finals || b.n - a.n, majors: (a, b) => b.n - a.n || b.titles - a.titles, name: (a, b) => a.t.localeCompare(b.t) };
    rows.sort((a, b) => sorts[X.sort](a, b) || a.t.localeCompare(b.t));
    const best = (r) => Math.min(...r.majors.map((e) => e.rank ?? 99));
    return `<div class="st"><section class="mjhead"><p class="kicker">Historial</p><h1 class="ghead__title">Equipos</h1>
        <p class="lead">${Object.keys(st.teams).length} equipos han jugado al menos un Major desde ${idx.majors[0]?.year || 2013}. Toca uno para ver su trayectoria, sus mapas y sus plantillas.</p></section>
      <div class="sttools"><input class="input" type="search" placeholder="Buscar equipo…" value="${esc(X.q)}" data-stq="team">
        <div class="seg">${[['titles', 'Más títulos'], ['majors', 'Más Majors'], ['name', 'A–Z']].map(([v, l]) => `<button type="button" class="${X.sort === v ? 'is-on' : ''}" data-sts="${v}">${l}</button>`).join('')}</div></div>
      <div class="tgrid">${rows.slice(0, 200).map((r) => `<a class="tcard" href="#/equipos/${enc(r.t)}">${badge(r.t, 'tb--lg')}<span><b>${esc(r.t)}</b>
          <small>${r.n} Major${r.n === 1 ? '' : 's'}${r.titles ? ` · ${'🏆'.repeat(Math.min(r.titles, 5))}` : r.finals ? ' · finalista' : best(r) <= 5 ? ` · mejor: ${best(r) === 3 ? 'semis' : 'cuartos'}` : ''}</small></span></a>`).join('') || '<div class="empty">Ningún equipo con ese nombre.</div>'}</div>
    </div>`;
  }
  async function team(name) {
    const [st, idx] = await Promise.all([getStats(), majors.getIndex()]);
    const T = st.teams[name];
    if (!T) return `<div class="state state--error"><p><b>No hay datos de ${esc(name)}.</b></p><a class="btn" href="#/equipos">Ver equipos</a></div>`;
    const ms = T.majors.slice().sort((a, b) => b.id.localeCompare(a.id));
    const W = T.majors.reduce((s, e) => s + e.w, 0); const L = T.majors.reduce((s, e) => s + e.l, 0);
    const maps = Object.entries(T.maps).map(([m, [w, l, p]]) => ({ m, w, l, p, n: w + l })).filter((x) => x.n).sort((a, b) => b.n - a.n);
    const lastRoster = ms.find((e) => e.roster?.length);
    const fact = (l, v) => `<div class="fact"><small>${l}</small><b>${v}</b></div>`;
    const bar = (label, a, b, cls) => `<div class="sbar ${cls}"><span>${label}</span><div><i style="width:${pct(a, b)}%"></i></div><b>${pct(a, b)}%</b><small>${a}–${b} rondas</small></div>`;
    return `<div class="st"><nav class="mjnav"><a href="#/equipos">← Todos los equipos</a></nav>
      <header class="sthead">${badge(name, 'tb--xl')}<div><p class="kicker">Equipo</p><h1 class="ghead__title">${esc(name)}</h1>
        <div class="facts">${fact('Majors', T.majors.length)}${fact('Títulos', T.titles ? `🏆 ${T.titles}` : '0')}${fact('Finales', T.finals)}${fact('Series', `${W}–${L}`)}
          ${maps.length ? fact('Mapas', `${maps.reduce((s, x) => s + x.w, 0)}–${maps.reduce((s, x) => s + x.l, 0)}`) : ''}</div></div></header>
      <div class="stcols">
        <section class="card"><h3>Trayectoria en Majors</h3><ol class="tl">${ms.map((e) => `<li class="${placeCls(e.rank)}"><a href="#/majors/${esc(e.id)}"><b>${esc(majorName(idx, e.id))}</b><span>${esc(placeTxt(e))}</span></a>
            <small>${e.w || e.l ? `${e.w}–${e.l} en series` : ''}${e.roster?.length ? ` · ${e.roster.map((p) => `<a href="#/jugadores/${enc(p)}">${esc(p)}</a>`).join(', ')}` : ''}${e.coach ? ` · entrenador <a href="#/jugadores/${enc(e.coach)}">${esc(e.coach)}</a>` : ''}</small></li>`).join('')}</ol></section>
        <div class="stside">
          ${lastRoster ? `<section class="card"><h3>Última plantilla <small>${esc(majorName(idx, lastRoster.id))}</small></h3><div class="roster">${lastRoster.roster.map((p) => pLink({ n: p, flag: st.players[p]?.flag })).join('')}${lastRoster.coach ? `<span class="roster__coach">Entrenador: ${pLink({ n: lastRoster.coach, flag: st.players[lastRoster.coach]?.flag })}</span>` : ''}</div></section>` : ''}
          ${T.rt[0] + T.rt[1] ? `<section class="card"><h3>Por lado</h3>${bar('Terrorista', T.rt[0], T.rt[1], 'is-t')}${bar('Antiterrorista', T.rct[0], T.rct[1], 'is-ct')}<p class="hint">Rondas ganadas sin contar prórrogas.</p></section>` : ''}
          ${maps.length ? `<section class="card"><h3>Mapas</h3><table class="mtab"><thead><tr><th>Mapa</th><th>Jug.</th><th>Vict.</th><th></th><th>Elegido</th></tr></thead><tbody>
            ${maps.map((x) => `<tr><td>${mapThumb(x.m)}${esc(x.m)}</td><td>${x.n}</td><td>${x.w}–${x.l}</td><td><span class="wbar"><i style="width:${pct(x.w, x.l)}%"></i></span>${pct(x.w, x.l)}%</td><td>${x.p || '—'}</td></tr>`).join('')}</tbody></table>
            <p class="hint">«Elegido»: veces que lo eligió en la selección de mapas, cuando Liquipedia la tiene.</p></section>` : ''}
        </div></div></div>`;
  }

  // ---------------------------------------------------------------- jugadores
  async function playersList() {
    const [st, idx] = await Promise.all([getStats(), majors.getIndex()]);
    const q = X.pq.toLowerCase();
    const rows = Object.entries(st.players).map(([n, v]) => ({ n, ...v, titles: v.majors.filter((e) => e.rank === 1 && e.role === 'player').length, pl: v.majors.filter((e) => e.role === 'player').length }))
      .filter((r) => !q || r.n.toLowerCase().includes(q) || r.majors.some((e) => e.team.toLowerCase().includes(q)))
      .sort((a, b) => b.titles - a.titles || b.pl - a.pl || a.n.localeCompare(b.n));
    return `<div class="st"><section class="mjhead"><p class="kicker">Historial</p><h1 class="ghead__title">Jugadores</h1>
        <p class="lead">${Object.keys(st.players).length} jugadores y entrenadores en las plantillas de los Majors. Busca por nombre o por equipo.</p></section>
      <div class="sttools"><input class="input" type="search" placeholder="Buscar jugador o equipo…" value="${esc(X.pq)}" data-stq="player"></div>
      ${rows.length ? `<div class="table-wrap"><table class="table ptable"><thead><tr><th>Jugador</th><th>Majors</th><th>Títulos</th><th>Último equipo</th></tr></thead><tbody>
        ${rows.slice(0, 150).map((r) => { const last = r.majors[r.majors.length - 1]; return `<tr><td><a class="plink" href="#/jugadores/${enc(r.n)}">${flagOf(r.flag)} <b>${esc(r.n)}</b></a></td><td>${r.pl}${r.pl < r.majors.length ? ` <small>+${r.majors.length - r.pl} entr.</small>` : ''}</td>
          <td>${r.titles ? '🏆'.repeat(Math.min(r.titles, 5)) : '—'}</td><td>${last ? `${teamLink(last.team)} <small>${esc(majorName(idx, last.id))}</small>` : ''}</td></tr>`; }).join('')}</tbody></table></div>
        ${rows.length > 150 ? `<p class="hint">Se muestran 150 de ${rows.length}. Afina la búsqueda para ver el resto.</p>` : ''}` : '<div class="empty">Ningún jugador con ese nombre.</div>'}
    </div>`;
  }
  async function player(name) {
    const [st, idx] = await Promise.all([getStats(), majors.getIndex()]);
    const P = st.players[name];
    if (!P) return `<div class="state state--error"><p><b>No hay datos de ${esc(name)}.</b></p><a class="btn" href="#/jugadores">Ver jugadores</a></div>`;
    const ms = P.majors.slice().sort((a, b) => b.id.localeCompare(a.id));
    const asPlayer = P.majors.filter((e) => e.role === 'player');
    const titles = asPlayer.filter((e) => e.rank === 1).length;
    const finals = asPlayer.filter((e) => e.rank != null && e.rank <= 2).length;
    const teams = [...new Set(P.majors.map((e) => e.team))];
    const fact = (l, v) => `<div class="fact"><small>${l}</small><b>${v}</b></div>`;
    return `<div class="st"><nav class="mjnav"><a href="#/jugadores">← Todos los jugadores</a></nav>
      <header class="sthead"><span class="pflag" aria-hidden="true">${flagOf(P.flag) || '🎮'}</span><div><p class="kicker">${asPlayer.length ? 'Jugador' : 'Entrenador'}</p><h1 class="ghead__title">${esc(name)}</h1>
        <div class="facts">${fact('Majors', asPlayer.length || P.majors.length)}${fact('Títulos', titles ? `🏆 ${titles}` : '0')}${fact('Finales', finals)}${fact('Equipos', teams.length)}</div></div></header>
      <section class="card"><h3>Majors</h3><ol class="tl">${ms.map((e) => `<li class="${placeCls(e.rank)}"><a href="#/majors/${esc(e.id)}"><b>${esc(majorName(idx, e.id))}</b><span>${e.place ? esc(placeTxt(e)) : ''}</span></a>
          <small>${teamLink(e.team)}${e.role === 'coach' ? ' · como entrenador' : ''}</small></li>`).join('')}</ol></section>
      <p class="hint st__hltv">Kills, muertes y asistencias de cada partido: en HLTV, desde el botón de cada partido.</p></div>`;
  }

  // ---------------------------------------------------------------- partido desglosado
  async function match(id, mid) {
    const [idx, d, st] = await Promise.all([majors.getIndex(), majors.getDetail(id), getStats()]);
    const M = idx.majors.find((x) => x.id === id);
    const m = d?.matches.find((x) => x.id === mid);
    if (!M || !m) return `<div class="state state--error"><p><b>No encuentro ese partido.</b></p><a class="btn" href="#/majors/${esc(id)}">Volver al Major</a></div>`;
    const stage = d.stages.find((s) => s.id === m.stage);
    const w = m.winner === 1 ? m.t1 : m.winner === 2 ? m.t2 : null;
    const side = (n, team) => `<div class="mxteam ${w === team ? 'is-won' : w ? 'is-lost' : ''} ${n === 2 ? 'mxteam--r' : ''}">${team !== 'TBD' ? `<a href="#/equipos/${enc(team)}">${badge(team, 'tb--xl')}</a>` : badge('TBD', 'tb--xl')}<b>${esc(team === 'TBD' ? 'Por decidir' : team)}</b></div>`;
    const veto = (m.veto || []).map(([t, a, mp]) => `<li class="vt vt--${a}">${mapThumb(mp)}<span>${a === 'decider' ? 'Decisivo' : a === 'pick' ? 'Elige' : 'Veta'}</span><b>${esc(mp)}</b><small>${t ? esc(t === 1 ? m.t1 : m.t2) : 'el que queda'}</small></li>`).join('');
    const pickOf = (mp) => (m.veto || []).find(([, a, x]) => (a === 'pick' || a === 'decider') && x === mp);
    const mapCard = (x, i) => {
      const pk = pickOf(x.map);
      const h = x.h;
      // mitades: el equipo 1 empezó en x.first (t o ct); la 1.ª mitad son sus rondas de ese lado
      let halves = '';
      if (h) {
        const f = x.first || 't';
        const h1 = f === 't' ? [h[0], h[3]] : [h[1], h[2]];
        const h2 = f === 't' ? [h[1], h[2]] : [h[0], h[3]];
        const lab = (team, t1side) => `<i class="side side--${t1side}">${t1side === 't' ? 'T' : 'CT'}</i>`;
        halves = `<table class="halves"><thead><tr><th></th><th>1.ª mitad</th><th>2.ª mitad</th>${x.ot ? '<th>Prórroga</th>' : ''}<th>Total</th></tr></thead><tbody>
          <tr><td>${esc(m.t1)}</td><td>${h1[0]} ${lab(m.t1, f)}</td><td>${h2[0]} ${lab(m.t1, f === 't' ? 'ct' : 't')}</td>${x.ot ? `<td>${x.ot[0]}</td>` : ''}<td><b>${x.s1 ?? ''}</b></td></tr>
          <tr><td>${esc(m.t2)}</td><td>${h1[1]} ${lab(m.t2, f === 't' ? 'ct' : 't')}</td><td>${h2[1]} ${lab(m.t2, f)}</td>${x.ot ? `<td>${x.ot[1]}</td>` : ''}<td><b>${x.s2 ?? ''}</b></td></tr></tbody></table>`;
      }
      return `<section class="mxmap ${x.winner ? '' : 'is-pending'}"><header class="mxmap__img ${MAPS[x.map]?.img ? '' : 'is-fake'}" style="${mapBg(x.map)}"><span class="mxmap__n">Mapa ${i + 1}${x.winner ? ` · gana ${esc(x.winner === 1 ? m.t1 : m.t2)}` : ''}</span><h3>${esc(x.map || 'Por decidir')}</h3>
          ${pk ? `<span class="pill ${pk[1] === 'decider' ? 'pill--soft' : ''}">${pk[1] === 'decider' ? 'Decisivo' : `Elige ${esc(pk[0] === 1 ? m.t1 : m.t2)}`}</span>` : ''}
          <span class="mxmap__score"><b class="${x.winner === 1 ? 'w' : ''}">${x.s1 ?? '–'}</b>–<b class="${x.winner === 2 ? 'w' : ''}">${x.s2 ?? '–'}</b></span></header>
        ${halves}
        ${x.hltv ? `<a class="btn btn--sm btn--ghost" href="${hltvMap(x.hltv)}" target="_blank" rel="noopener">Kills, muertes y asistencias del mapa en HLTV ↗</a>` : ''}</section>`;
    };
    const roster = (team) => {
      const r = d.rosters?.[team];
      if (!r) return '';
      return `<section class="card"><h3>${badge(team)} ${esc(team)}</h3><div class="roster">${r.players.map(pLink).join('')}${r.coach ? `<span class="roster__coach">Entrenador: ${pLink(r.coach)}</span>` : ''}</div></section>`;
    };
    return `<div class="st"><nav class="mjnav"><a href="#/majors/${esc(id)}">← ${esc(M.name)}</a></nav>
      <section class="mx"><p class="kicker">${esc(stage?.name || '')} · ${esc(m.round || '')} · Bo${m.bo}${m.date ? ` · ${fmtDayTime(new Date(m.date))}` : ''}</p>
        <div class="mxhead">${side(1, m.t1)}<div class="mxscore">${m.done ? `<b class="${m.winner === 1 ? 'w' : ''}">${m.s1}</b><i>–</i><b class="${m.winner === 2 ? 'w' : ''}">${m.s2}</b>` : '<i>vs</i>'}</div>${side(2, m.t2)}</div>
        ${m.hltv ? `<p class="mxlinks"><a class="btn btn--primary btn--sm" href="${hltvMatch(m.hltv)}" target="_blank" rel="noopener">Estadísticas completas en HLTV ↗</a></p>` : ''}</section>
      ${veto ? `<section class="card"><h3>Selección de mapas</h3><ol class="veto">${veto}</ol></section>` : ''}
      ${m.maps.length ? `<div class="mxmaps">${m.maps.map(mapCard).join('')}</div>` : '<div class="empty">Todavía no hay mapas jugados.</div>'}
      ${d.rosters?.[m.t1] || d.rosters?.[m.t2] ? `<h2 class="h2">Plantillas</h2><div class="duo duo--wide">${roster(m.t1)}${roster(m.t2)}</div>` : ''}
      <p class="hint mj__src">Datos de Liquipedia (CC-BY-SA 3.0). Las estadísticas de los jugadores están en HLTV.</p></div>`;
  }

  // ---------------------------------------------------------------- eventos
  $app.addEventListener('click', async (e) => {
    if (!isOpen()) return;
    const b = e.target.closest('[data-sts]');
    if (!b) return;
    X.sort = b.dataset.sts; $app.innerHTML = await teamsList();
  });
  $app.addEventListener('input', (e) => {
    if (!isOpen() || !e.target.dataset.stq) return;
    const t = e.target; const kind = t.dataset.stq;
    clearTimeout(X.qt);
    X.qt = setTimeout(async () => {
      if (kind === 'team') X.q = t.value; else X.pq = t.value;
      $app.innerHTML = kind === 'team' ? await teamsList() : await playersList();
      const el = document.querySelector(`[data-stq="${kind}"]`); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    }, 250);
  });
  return { teamsList, team, playersList, player, match, isOpen, teamLink };
}
