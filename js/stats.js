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
  const hue = (t) => { let x = 0; for (const ch of String(t)) x = (x * 31 + ch.charCodeAt(0)) % 360; return x; };
  const lvlOf = (r) => (r == null ? 6 : r === 1 ? 0 : r === 2 ? 1 : r <= 3 ? 2 : r <= 5 ? 3 : r <= 9 ? 4 : 5);
  // mini gráfico: una barra por Major jugado (más alta cuanto mejor quedó)
  function spark(T, idx) {
    const played = idx.majors.filter((m) => m.status !== 'upcoming');
    const byId = Object.fromEntries(T.majors.map((e) => [e.id, e]));
    return `<span class="spark" aria-hidden="true">${played.map((m) => { const e = byId[m.id]; const l = e ? lvlOf(e.rank) : null;
      return `<i class="${l == null ? 'is-no' : l === 0 ? 'is-gold' : l === 1 ? 'is-silver' : l <= 3 ? 'is-top' : ''}" style="height:${l == null ? 2 : 100 - Math.min(l, 5) * 15}%"></i>`; }).join('')}</span>`;
  }
  const bestTxt = (r) => (r === 1 ? 'Campeón' : r === 2 ? 'Final' : r <= 3 ? 'Semis' : r <= 5 ? 'Cuartos' : r <= 9 ? 'Octavos' : 'Fase');
  async function teamsList() {
    const [st, idx] = await Promise.all([getStats(), majors.getIndex()]);
    const q = X.q.toLowerCase();
    const recent = idx.majors.filter((m) => m.status !== 'upcoming').slice(-2).map((m) => m.id);
    const all = Object.entries(st.teams).map(([t, v]) => ({ t, ...v, n: v.majors.length, best: Math.min(...v.majors.map((e) => e.rank ?? 99)),
      last: v.majors.map((e) => e.id).sort().pop(), active: v.majors.some((e) => recent.includes(e.id)), cs2: v.majors.some((e) => idx.majors.find((m) => m.id === e.id)?.game === 'CS2') }));
    const filters = { '': () => true, champ: (r) => r.titles > 0, active: (r) => r.active, cs2: (r) => r.cs2 };
    const rows = all.filter((r) => (!q || r.t.toLowerCase().includes(q)) && filters[X.tf || ''](r));
    const sorts = { titles: (a, b) => b.titles - a.titles || b.finals - a.finals || b.n - a.n, majors: (a, b) => b.n - a.n || b.titles - a.titles, name: (a, b) => a.t.localeCompare(b.t) };
    rows.sort((a, b) => sorts[X.sort](a, b) || a.t.localeCompare(b.t));
    const podium = all.filter((r) => r.titles).sort(sorts.titles).slice(0, 3);
    const yearOf = (id) => idx.majors.find((m) => m.id === id)?.year || '';
    const pod = podium.length === 3 ? `<div class="podium">${[podium[1], podium[0], podium[2]].map((r, i) => `<a class="podium__it podium__it--${[2, 1, 3][i]}" href="#/equipos/${enc(r.t)}" style="--h:${hue(r.t)}">
        ${badge(r.t, 'tb--xl')}<b>${esc(r.t)}</b><span>${'🏆'.repeat(Math.min(r.titles, 5))}</span><div class="podium__step">${[2, 1, 3][i]}</div></a>`).join('')}</div>` : '';
    return `<div class="st"><section class="sthero"><div><p class="kicker">Historial</p><h1 class="ghead__title">Equipos</h1>
          <p class="lead">${all.length} equipos han jugado al menos un Major desde ${idx.majors[0]?.year || 2013}. ${all.filter((r) => r.titles).length} lo han ganado alguna vez.</p>
          <div class="stnums"><span><b>${all.length}</b>equipos</span><span><b>${all.filter((r) => r.titles).length}</b>campeones</span><span><b>${all.filter((r) => r.active).length}</b>en activo</span></div></div>${pod}</section>
      <div class="sttools"><input class="input" type="search" placeholder="Buscar equipo…" value="${esc(X.q)}" data-stq="team">
        <div class="seg">${[['', 'Todos'], ['champ', '🏆 Campeones'], ['active', 'En activo'], ['cs2', 'Era CS2']].map(([v, l]) => `<button type="button" class="${(X.tf || '') === v ? 'is-on' : ''}" data-stf="${v}">${l}</button>`).join('')}</div>
        <div class="seg seg--sort">${[['titles', 'Más títulos'], ['majors', 'Más Majors'], ['name', 'A–Z']].map(([v, l]) => `<button type="button" class="${X.sort === v ? 'is-on' : ''}" data-sts="${v}">${l}</button>`).join('')}</div></div>
      <p class="hint stcount">${rows.length} equipo${rows.length === 1 ? '' : 's'}</p>
      <div class="tgrid">${rows.slice(0, 240).map((r) => `<a class="tcard2 ${r.titles ? 'is-champ' : ''}" href="#/equipos/${enc(r.t)}" style="--h:${hue(r.t)}">
          <div class="tcard2__top">${badge(r.t, 'tb--lg')}<span class="tcard2__name"><b>${esc(r.t)}</b><small>${r.active ? '<i class="dotlive"></i>En activo' : `Último Major: ${yearOf(r.last)}`}</small></span>
            ${r.titles ? `<span class="tcard2__cup" title="${r.titles} título${r.titles > 1 ? 's' : ''}">🏆<b>${r.titles}</b></span>` : ''}</div>
          ${spark(r, idx)}
          <div class="tcard2__stats"><span><b>${r.n}</b>Majors</span><span><b>${r.finals}</b>finales</span><span><b>${esc(bestTxt(r.best))}</b>mejor</span></div></a>`).join('') || '<div class="empty">Ningún equipo con esos filtros.</div>'}</div>
    </div>`;
  }
  async function getSeries() {
    if (X.series) return X.series;
    try { const r = await fetch(`data/series.json?v=${Math.floor(Date.now() / 600_000)}`); X.series = r.ok ? (await r.json()).series : []; } catch { X.series = []; }
    return X.series;
  }
  // línea de tiempo: un punto por Major (más arriba cuanto mejor quedó)
  function timeline(T, idx) {
    const played = idx.majors.filter((m) => m.status !== 'upcoming');
    if (!played.length) return '';
    const byId = Object.fromEntries(T.majors.map((e) => [e.id, e]));
    const W = 1000; const H = 150; const step = W / Math.max(1, played.length - 1);
    const lvl = (r) => (r == null ? null : r === 1 ? 0 : r === 2 ? 1 : r <= 3 ? 2 : r <= 5 ? 3 : r <= 9 ? 4 : 5);
    const y = (l) => 18 + l * 22;
    const pts = played.map((m, i) => ({ m, i, e: byId[m.id], l: byId[m.id] ? lvl(byId[m.id].rank) ?? 4 : null }));
    const path = pts.filter((p) => p.l != null).map((p, k) => `${k ? 'L' : 'M'}${(p.i * step).toFixed(1)},${y(p.l)}`).join(' ');
    const labels = ['Campeón', 'Final', 'Semis', 'Cuartos', 'Octavos', 'Fase'];
    return `<section class="card tline"><h3>Trayectoria</h3><div class="tline__wrap"><svg viewBox="-30 0 ${W + 60} ${H}" preserveAspectRatio="none" role="img" aria-label="Resultados en cada Major">
        ${labels.map((l, k) => `<line x1="0" x2="${W}" y1="${y(k)}" y2="${y(k)}" class="tline__grid"/>`).join('')}
        <path d="${path}" class="tline__path" vector-effect="non-scaling-stroke"/>
        ${pts.map((p) => (p.l == null ? `<circle cx="${p.i * step}" cy="${H - 8}" r="2.5" class="tline__miss"><title>${esc(p.m.city)} ${p.m.year}: no jugó</title></circle>`
        : `<circle cx="${p.i * step}" cy="${y(p.l)}" r="${p.l === 0 ? 8 : 6}" class="tline__dot tline__dot--${p.l}"><title>${esc(p.m.city)} ${p.m.year}: ${esc(placeTxt(p.e))}</title></circle>`)).join('')}
      </svg><div class="tline__y">${labels.map((l) => `<span>${l}</span>`).join('')}</div></div>
      <div class="tline__x"><span>${played[0].year}</span><span>${played[played.length - 1].year}</span></div></section>`;
  }
  async function team(name) {
    const [st, idx, series] = await Promise.all([getStats(), majors.getIndex(), getSeries()]);
    const opp = {};
    for (const s of series) {
      if (s[2] !== name && s[3] !== name) continue;
      const o = s[2] === name ? s[3] : s[2];
      const won = (s[6] === 1 ? s[2] : s[3]) === name;
      const x = opp[o] = opp[o] || [0, 0]; x[0]++; if (won) x[1]++;
    }
    const rivals = Object.entries(opp).map(([t, [n, w]]) => [t, n, w]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
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
      ${timeline(T, idx)}
      <div class="h2hpick"><label>Comparar con <select class="input" data-h2h-from="${esc(name)}"><option value="">Elige un equipo…</option>${rivals.map(([t, n]) => `<option value="${esc(t)}">${esc(t)} · ${n} serie${n === 1 ? '' : 's'}</option>`).join('')}</select></label></div>
      <div class="stcols">
        <section class="card"><h3>Trayectoria en Majors</h3><ol class="tl">${ms.map((e) => `<li class="${placeCls(e.rank)}"><a href="#/majors/${esc(e.id)}"><b>${esc(majorName(idx, e.id))}</b><span>${esc(placeTxt(e))}</span></a>
            <small>${[e.w || e.l ? `${e.w}–${e.l} en series` : '', e.roster?.length ? e.roster.map((p) => `<a href="#/jugadores/${enc(p)}">${esc(p)}</a>`).join(', ') : '', e.coach ? `entrenador <a href="#/jugadores/${enc(e.coach)}">${esc(e.coach)}</a>` : ''].filter(Boolean).join(' · ')}</small></li>`).join('')}</ol></section>
        <div class="stside">
          ${lastRoster ? `<section class="card"><h3>Última plantilla <small>${esc(majorName(idx, lastRoster.id))}</small></h3><div class="roster">${lastRoster.roster.map((p) => pLink({ n: p, flag: st.players[p]?.flag })).join('')}${lastRoster.coach ? `<span class="roster__coach">Entrenador: ${pLink({ n: lastRoster.coach, flag: st.players[lastRoster.coach]?.flag })}</span>` : ''}</div></section>` : ''}
          ${T.rt[0] + T.rt[1] ? `<section class="card"><h3>Por lado</h3>${bar('Terrorista', T.rt[0], T.rt[1], 'is-t')}${bar('Antiterrorista', T.rct[0], T.rct[1], 'is-ct')}<p class="hint">Rondas ganadas sin contar prórrogas.</p></section>` : ''}
          ${maps.length ? `<section class="card"><h3>Mapas</h3><div class="mcards">${maps.map((x) => `<div class="mcard ${MAPS[x.m]?.img ? '' : 'is-fake'}" style="${mapBg(x.m)}">
              <b>${esc(x.m)}</b><span class="mcard__pct">${pct(x.w, x.l)}%</span><small>${x.w}–${x.l} en ${x.n} mapa${x.n === 1 ? '' : 's'}${x.p ? ` · elegido ${x.p}×` : ''}</small>
              <span class="mcard__bar"><i style="width:${pct(x.w, x.l)}%"></i></span></div>`).join('')}</div>
            <p class="hint">«Elegido»: veces que lo eligió en la selección de mapas, cuando Liquipedia la tiene.</p></section>` : ''}
          ${rivals.length ? `<section class="card"><h3>Rivales más frecuentes</h3><ol class="rk">${rivals.slice(0, 6).map(([t, n, w], i) => `<li><i>${i + 1}</i><a class="tlink" href="#/equipos/${enc(name)}/vs/${enc(t)}">${badge(t)}<span>${esc(t)}</span></a><b>${w}–${n - w}</b></li>`).join('')}</ol></section>` : ''}
        </div></div></div>`;
  }

  // ---------------------------------------------------------------- jugadores
  async function playersList() {
    const [st, idx] = await Promise.all([getStats(), majors.getIndex()]);
    const q = X.pq.toLowerCase();
    const recent = idx.majors.filter((m) => m.status !== 'upcoming').slice(-2).map((m) => m.id);
    const all = Object.entries(st.players).map(([n, v]) => {
      const pl = v.majors.filter((e) => e.role === 'player');
      const last = v.majors.slice().sort((a, b) => a.id.localeCompare(b.id)).pop();
      return { n, ...v, pl: pl.length, titles: pl.filter((e) => e.rank === 1).length, finals: pl.filter((e) => e.rank != null && e.rank <= 2).length,
        coach: !pl.length, last, active: v.majors.some((e) => recent.includes(e.id)), teams: [...new Set(v.majors.map((e) => e.team))] };
    });
    const filters = { '': (r) => !r.coach, champ: (r) => r.titles > 0, active: (r) => r.active && !r.coach, coach: (r) => r.coach || r.majors.some((e) => e.role === 'coach') };
    const sorts = { titles: (a, b) => b.titles - a.titles || b.pl - a.pl, majors: (a, b) => b.pl - a.pl || b.titles - a.titles, name: (a, b) => a.n.localeCompare(b.n) };
    const rows = all.filter((r) => filters[X.pf || ''](r) && (!q || r.n.toLowerCase().includes(q) || r.teams.some((t) => t.toLowerCase().includes(q))))
      .sort((a, b) => sorts[X.psort || 'titles'](a, b) || a.n.localeCompare(b.n));
    const top = all.filter((r) => r.titles).sort(sorts.titles).slice(0, 3);
    const yearOf = (id) => idx.majors.find((m) => m.id === id);
    const card = (r) => {
      const lm = yearOf(r.last?.id);
      return `<a class="pcard ${r.titles ? 'is-champ' : ''}" href="#/jugadores/${enc(r.n)}" style="--h:${hue(r.last?.team || r.n)}">
        <span class="pcard__flag">${flagOf(r.flag) || '<span class="pcard__noflag">🎮</span>'}</span>
        <span class="pcard__main"><b>${esc(r.n)}</b><small>${r.last ? `${badge(r.last.team)}<span>${esc(r.last.team)}${lm ? ` · ${lm.year}` : ''}</span>` : ''}</small></span>
        <span class="pcard__nums">${r.titles ? `<span class="pcard__cup">🏆 ${r.titles}</span>` : ''}<span><b>${r.coach ? r.majors.length : r.pl}</b>${r.coach ? 'como entr.' : 'Majors'}</span></span></a>`;
    };
    return `<div class="st"><section class="sthero"><div><p class="kicker">Historial</p><h1 class="ghead__title">Jugadores</h1>
          <p class="lead">${all.length} jugadores y entrenadores han pasado por las plantillas de los Majors. Busca por nombre o por equipo.</p>
          <div class="stnums"><span><b>${all.filter((r) => !r.coach).length}</b>jugadores</span><span><b>${all.filter((r) => r.titles).length}</b>campeones</span><span><b>${all.filter((r) => r.active && !r.coach).length}</b>en activo</span></div></div>
        ${top.length === 3 ? `<div class="podium">${[top[1], top[0], top[2]].map((r, i) => `<a class="podium__it podium__it--${[2, 1, 3][i]}" href="#/jugadores/${enc(r.n)}" style="--h:${hue(r.last?.team || r.n)}">
          <span class="podium__flag">${flagOf(r.flag) || '🎮'}</span><b>${esc(r.n)}</b><span>${'🏆'.repeat(Math.min(r.titles, 5))}</span><div class="podium__step">${[2, 1, 3][i]}</div></a>`).join('')}</div>` : ''}</section>
      <div class="sttools"><input class="input" type="search" placeholder="Buscar jugador o equipo…" value="${esc(X.pq)}" data-stq="player">
        <div class="seg">${[['', 'Jugadores'], ['champ', '🏆 Campeones'], ['active', 'En activo'], ['coach', 'Entrenadores']].map(([v, l]) => `<button type="button" class="${(X.pf || '') === v ? 'is-on' : ''}" data-spf="${v}">${l}</button>`).join('')}</div>
        <div class="seg seg--sort">${[['titles', 'Más títulos'], ['majors', 'Más Majors'], ['name', 'A–Z']].map(([v, l]) => `<button type="button" class="${(X.psort || 'titles') === v ? 'is-on' : ''}" data-sps="${v}">${l}</button>`).join('')}</div></div>
      <p class="hint stcount">${rows.length} resultado${rows.length === 1 ? '' : 's'}${rows.length > 180 ? ' · se muestran 180, afina la búsqueda para ver el resto' : ''}</p>
      ${rows.length ? `<div class="pgrid">${rows.slice(0, 180).map(card).join('')}</div>` : '<div class="empty">Ningún jugador con esos filtros.</div>'}
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
    const best = Math.min(...P.majors.map((e) => e.rank ?? 99));
    // equipos en orden, con cuántos Majors jugó en cada uno
    const stints = [];
    for (const e of P.majors.slice().sort((a, b) => a.id.localeCompare(b.id))) {
      const last = stints[stints.length - 1];
      if (last && last.team === e.team) { last.n++; last.to = e.id; last.titles += e.rank === 1 ? 1 : 0; } else stints.push({ team: e.team, n: 1, from: e.id, to: e.id, titles: e.rank === 1 ? 1 : 0 });
    }
    const y = (id) => idx.majors.find((m) => m.id === id)?.year || '';
    const mates = {};
    for (const e of asPlayer) for (const t of (st.teams[e.team]?.majors.find((x) => x.id === e.id)?.roster || [])) if (t !== name) mates[t] = (mates[t] || 0) + 1;
    const topMates = Object.entries(mates).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8);
    const fact = (l, v) => `<div class="fact"><small>${l}</small><b>${v}</b></div>`;
    const lastTeam = ms[0]?.team;
    return `<div class="st"><nav class="mjnav"><a href="#/jugadores">← Todos los jugadores</a></nav>
      <header class="phead" style="--h:${hue(lastTeam || name)}"><span class="phead__flag" aria-hidden="true">${flagOf(P.flag) || '🎮'}</span>
        <div><p class="kicker">${asPlayer.length ? 'Jugador' : 'Entrenador'}${lastTeam ? ` · ${esc(lastTeam)}` : ''}</p><h1 class="ghead__title">${esc(name)}</h1>
        <div class="facts">${fact('Majors', asPlayer.length || P.majors.length)}${fact('Títulos', titles ? `🏆 ${titles}` : '0')}${fact('Finales', finals)}${fact('Mejor', esc(bestTxt(best)))}${fact('Equipos', stints.length ? new Set(stints.map((x) => x.team)).size : 0)}</div></div>
        ${lastTeam ? `<a class="phead__team" href="#/equipos/${enc(lastTeam)}">${badge(lastTeam, 'tb--xl')}</a>` : ''}</header>
      <section class="card"><h3>Carrera por equipos</h3><div class="stints">${stints.map((x) => `<a class="stint ${x.titles ? 'is-champ' : ''}" href="#/equipos/${enc(x.team)}" style="--h:${hue(x.team)}; flex:${x.n} 0 175px">
          ${badge(x.team)}<span><b>${esc(x.team)}</b><small>${y(x.from)}${y(x.to) !== y(x.from) ? `–${y(x.to)}` : ''} · ${x.n} Major${x.n === 1 ? '' : 's'}${x.titles ? ` · 🏆${x.titles > 1 ? x.titles : ''}` : ''}</small></span></a>`).join('')}</div></section>
      <div class="stcols">
        <section class="card"><h3>Majors</h3><ol class="tl">${ms.map((e) => `<li class="${placeCls(e.rank)}"><a href="#/majors/${esc(e.id)}"><b>${esc(majorName(idx, e.id))}</b><span>${e.place ? esc(placeTxt(e)) : ''}</span></a>
            <small>${teamLink(e.team)}${e.role === 'coach' ? ' · como entrenador' : ''}</small></li>`).join('')}</ol></section>
        <div class="stside">
          ${topMates.length ? `<section class="card"><h3>Compañeros más habituales</h3><ol class="rk">${topMates.map(([n, c], i) => `<li><i>${i + 1}</i><span>${pLink({ n, flag: st.players[n]?.flag })}</span><b>${c}</b></li>`).join('')}</ol>
            <p class="hint">Majors jugados en la misma plantilla.</p></section>` : ''}
          <section class="card"><h3>Estadísticas individuales</h3><p class="hint">Liquipedia no guarda kills, muertes ni asistencias. Cada partido tiene un botón que las abre en HLTV.</p></section>
        </div></div></div>`;
  }

  // ---------------------------------------------------------------- partido desglosado
  async function match(id, mid) {
    const [idx, d, st] = await Promise.all([majors.getIndex(), majors.getDetail(id), getStats()]);
    const M = idx.majors.find((x) => x.id === id);
    const m = d?.matches.find((x) => x.id === mid);
    if (!M || !m) return `<div class="state state--error"><p><b>No encuentro ese partido.</b></p><a class="btn" href="#/majors/${esc(id)}">Volver al Major</a></div>`;
    const stage = d.stages.find((s) => s.id === m.stage);
    // solo los mapas jugados (o en juego): fuera el 3.º de un 2-0, el 4.º y 5.º de un 3-0…
    const played = (m.maps || []).filter((x) => x.winner || x.s1 != null || x.s2 != null);
    const live = !m.done && m.date && Date.parse(m.date) <= Date.now() && Date.now() - Date.parse(m.date) < 8 * 3600_000;
    X.live = live ? `${id}/${mid}` : null;
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
      const rb = (x.s1 ?? 0) + (x.s2 ?? 0) ? `<div class="rbar" title="Rondas: ${esc(m.t1)} ${x.s1 ?? 0} – ${x.s2 ?? 0} ${esc(m.t2)}"><i style="flex:${x.s1 ?? 0}"></i><i style="flex:${x.s2 ?? 0}"></i></div>` : '';
      return `<section class="mxmap ${x.winner ? '' : 'is-live'}"><header class="mxmap__img ${MAPS[x.map]?.img ? '' : 'is-fake'}" style="${mapBg(x.map)}"><span class="mxmap__n">Mapa ${i + 1}${x.winner ? ` · gana ${esc(x.winner === 1 ? m.t1 : m.t2)}` : ''}</span><h3>${esc(x.map || 'Por decidir')}</h3>
          ${pk ? `<span class="pill ${pk[1] === 'decider' ? 'pill--soft' : ''}">${pk[1] === 'decider' ? 'Decisivo' : `Elige ${esc(pk[0] === 1 ? m.t1 : m.t2)}`}</span>` : ''}${x.winner ? '' : '<span class="pill pill--live">En juego</span>'}
          <span class="mxmap__score"><b class="${x.winner === 1 ? 'w' : ''}">${x.s1 ?? '–'}</b>–<b class="${x.winner === 2 ? 'w' : ''}">${x.s2 ?? '–'}</b></span></header>
        ${rb}${halves}
        ${x.hltv ? `<a class="btn btn--sm btn--ghost" href="${hltvMap(x.hltv)}" target="_blank" rel="noopener">Kills, muertes y asistencias del mapa en HLTV ↗</a>` : ''}</section>`;
    };
    const roster = (team) => {
      const r = d.rosters?.[team];
      if (!r) return '';
      return `<section class="card"><h3>${badge(team)} ${esc(team)}</h3><div class="roster">${r.players.map(pLink).join('')}${r.coach ? `<span class="roster__coach">Entrenador: ${pLink(r.coach)}</span>` : ''}</div></section>`;
    };
    return `<div class="st"><nav class="mjnav"><a href="#/majors/${esc(id)}">← ${esc(M.name)}</a></nav>
      ${live ? '<div class="notice notice--live"><span class="pill pill--live">En directo</span><p>Este partido se está jugando. La página se actualiza sola cada minuto con lo último de Liquipedia (que suele ir unos minutos por detrás).</p></div>' : ''}
      <section class="mx"><p class="kicker">${esc(stage?.name || '')} · ${esc(m.round || '')} · Bo${m.bo}${m.date ? ` · ${fmtDayTime(new Date(m.date))}` : ''}</p>
        <div class="mxhead">${side(1, m.t1)}<div class="mxscore">${m.done ? `<b class="${m.winner === 1 ? 'w' : ''}">${m.s1}</b><i>–</i><b class="${m.winner === 2 ? 'w' : ''}">${m.s2}</b>` : '<i>vs</i>'}</div>${side(2, m.t2)}</div>
        ${m.hltv ? `<p class="mxlinks"><a class="btn btn--primary btn--sm" href="${hltvMatch(m.hltv)}" target="_blank" rel="noopener">Estadísticas completas en HLTV ↗</a></p>` : ''}</section>
      ${veto ? `<section class="card"><h3>Selección de mapas</h3><ol class="veto">${veto}</ol></section>` : ''}
      ${played.length ? `<div class="mxmaps">${played.map(mapCard).join('')}</div>` : '<div class="empty">Todavía no hay mapas jugados.</div>'}
      ${d.rosters?.[m.t1] || d.rosters?.[m.t2] ? `<h2 class="h2">Plantillas</h2><div class="duo duo--wide">${roster(m.t1)}${roster(m.t2)}</div>` : ''}
      <p class="hint mj__src">Datos de Liquipedia (CC-BY-SA 3.0). Las estadísticas de los jugadores están en HLTV.</p></div>`;
  }

  // ---------------------------------------------------------------- eventos
  $app.addEventListener('click', async (e) => {
    if (!isOpen()) return;
    const b = e.target.closest('[data-sts],[data-stf],[data-spf],[data-sps]');
    if (!b) return;
    const d = b.dataset;
    if (d.sts !== undefined) X.sort = d.sts;
    if (d.stf !== undefined) X.tf = d.stf;
    if (d.spf !== undefined) X.pf = d.spf;
    if (d.sps !== undefined) X.psort = d.sps;
    $app.innerHTML = d.sts !== undefined || d.stf !== undefined ? await teamsList() : await playersList();
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
  // refresco del partido en directo
  setInterval(async () => {
    if (!X.live || document.hidden || !location.hash.endsWith(X.live.split('/')[1])) return;
    const [id, mid] = X.live.split('/');
    majors.forget?.(id);
    const y = window.scrollY;
    $app.innerHTML = await match(id, mid);
    window.scrollTo(0, y);
  }, 60_000);
  $app.addEventListener('change', (e) => {
    const t = e.target.closest('[data-h2h-from]');
    if (t && t.value) location.hash = `#/equipos/${enc(t.dataset.h2hFrom)}/vs/${enc(t.value)}`;
  });
  return { teamsList, team, playersList, player, match, isOpen, teamLink, getStats, mapThumb };
}
