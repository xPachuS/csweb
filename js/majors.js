// Historial de Majors (#/majors y #/majors/<id>). Lee los JSON de data/majors/ de la propia web.
export function createMajors(h) {
  const { esc, badge, fmtDate, fmtDayTime, call, $app } = h;
  const M = { index: null, t: 0, extra: {}, details: new Map(), filter: '', stage: null, id: null };
  const minute = () => Math.floor(Date.now() / 60_000);

  async function getIndex() {
    if (M.index && Date.now() - M.t < 60_000) return M.index;
    const [idx, info] = await Promise.all([
      fetch(`data/majors/index.json?v=${minute()}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Error ${r.status}`)))),
      call('GET', '/majorinfo').then((d) => d.info).catch(() => ({})),   // si el Worker no responde, el historial se ve igual
    ]);
    M.index = idx; M.extra = info || {}; M.t = Date.now();
    return idx;
  }
  async function getDetail(id) {
    const c = M.details.get(id);
    if (c && Date.now() - c.t < 60_000) return c.data;
    const r = await fetch(`data/majors/${encodeURIComponent(id)}.json?v=${minute()}`);
    if (!r.ok) return null;
    const data = await r.json();
    for (const m of data.matches || []) m.time = m.date ? new Date(m.date) : null;
    M.details.set(id, { t: Date.now(), data });
    return data;
  }
  // Banderas como imágenes (flag-icons): los emojis de bandera no se ven en Windows.
  const FLAG_ALIAS = { uk: 'gb', en: 'gb-eng', sc: 'gb-sct', wa: 'gb-wls', ni: 'gb-nir' };
  const flag = (cc) => {
    const c = String(cc || '').toLowerCase().trim();
    const k = FLAG_ALIAS[c] || c;
    return /^[a-z]{2}(-[a-z]{3})?$/.test(k) ? `<span class="fi fi-${k} flag" aria-hidden="true"></span>` : '';
  };
  const hue = (s) => { let x = 0; for (const ch of String(s)) x = (x * 31 + ch.charCodeAt(0)) % 360; return x; };
  const COUNTRY = { SE: 'Suecia', PL: 'Polonia', DE: 'Alemania', RO: 'Rumanía', US: 'Estados Unidos', GB: 'Reino Unido', BE: 'Bélgica', BR: 'Brasil',
    FR: 'Francia', DK: 'Dinamarca', CN: 'China', HU: 'Hungría', SG: 'Singapur', AR: 'Argentina', ES: 'España' };
  const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const dRange = (a, b) => {
    const [y1, m1, d1] = a.split('-').map(Number); const [y2, m2, d2] = b.split('-').map(Number);
    return m1 === m2 && y1 === y2 ? `${d1}–${d2} ${MONTHS[m2 - 1]} ${y2}` : `${d1} ${MONTHS[m1 - 1]}${y1 !== y2 ? ' ' + y1 : ''} – ${d2} ${MONTHS[m2 - 1]} ${y2}`;
  };
  const money = (n) => (n ? `${Number(n).toLocaleString('es-ES')} $` : '');
  const mvpOf = (m) => M.extra[m.id]?.mvp || m.mvp || '';
  const winnerTeam = (m) => (m.winner === 1 ? m.t1 : m.winner === 2 ? m.t2 : null);
  const isOpen = () => !!$app.querySelector('.mj');
  const lpUrl = (page) => `https://liquipedia.net/counterstrike/${encodeURI(page)}`;

  // ---------------------------------------------------------------- lista
  async function list() {
    const idx = await getIndex();
    const all = idx.majors.slice().reverse();
    const done = all.filter((m) => m.status === 'done' && m.champion);
    const titles = {};
    for (const m of done) titles[m.champion] = (titles[m.champion] || 0) + 1;
    const top = Object.entries(titles).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8);
    const max = top[0]?.[1] || 1;
    const games = [['', 'Todos'], ['CS2', 'Counter-Strike 2'], ['CS:GO', 'CS:GO']];
    const shown = all.filter((m) => !M.filter || m.game === M.filter);
    const card = (m) => {
      const cur = m.id === idx.current;
      const pill = cur ? '<span class="pill">Pick\'em abierto</span>' : m.status === 'live' ? '<span class="pill pill--live">En juego</span>' : m.status === 'upcoming' ? '<span class="pill pill--soft">Próximo</span>' : '';
      const final = m.champion
        ? `<div class="mjc__final"><span class="mjc__team is-win">${badge(m.champion)}<b>${esc(m.champion)}</b></span>
             <span class="mjc__score">${m.final ? esc(m.final.replace('-', '–')) : 'vs'}</span>
             <span class="mjc__team">${badge(m.runnerup)}<b>${esc(m.runnerup)}</b></span></div>`
        : `<p class="mjc__soon">${m.status === 'upcoming' ? `Empieza el ${esc(dRange(m.start, m.end).split(' – ')[0])}` : m.status === 'live' ? 'Se está jugando ahora' : 'Datos pendientes'}</p>`;
      const chips = [m.game, money(m.prize), m.teams ? `${m.teams} equipos` : ''].filter(Boolean);
      return `<a class="mjc ${cur ? 'is-cur' : ''} ${m.champion ? '' : 'is-empty'}" href="#/majors/${esc(m.id)}" style="--h:${hue(m.champion || m.city)}">
          <div class="mjc__top"><span class="mjc__year">${m.year}</span>${pill}
            ${m.champion ? `<span class="mjc__cup">${badge(m.champion, 'tb--xl')}<small>🏆 Campeón</small></span>` : `<span class="mjc__cup mjc__cup--tbd">🏆</span>`}</div>
          <div class="mjc__body"><p class="mjc__where">${flag(m.country)}<span>${esc(m.city)} · ${esc(dRange(m.start, m.end))}</span></p>
            <h3 class="mjc__name">${esc(m.name)}</h3>${final}</div>
          <footer class="mjc__foot">${chips.map((c) => `<span>${esc(c)}</span>`).join('')}<span class="mjc__org">${esc(m.organizer)}</span></footer></a>`;
    };
    const cs2 = idx.majors.filter((m) => m.game === 'CS2' && m.status === 'done').length;
    return `<div class="mj">
      <section class="mjhero">
        <div><p class="kicker">Historial</p><h1 class="hero__title">Todos los <span>Majors</span></h1>
          <p class="lead">${done.length} Majors jugados desde DreamHack Winter 2013${cs2 ? `, ${cs2} ya con Counter-Strike 2` : ''}. Toca uno para ver sus fases, el cuadro y todos los partidos. Los nuevos se añaden solos.</p></div>
        ${top.length ? `<aside class="card palm"><h3>Más títulos</h3><ol class="palm__list">${top.map(([t, n]) => `<li>${badge(t)}<span>${esc(t)}</span><i style="--w:${Math.round((n / max) * 100)}%"></i><b>${n}</b></li>`).join('')}</ol></aside>` : ''}
      </section>
      <div class="seg">${games.map(([v, l]) => `<button type="button" class="${M.filter === v ? 'is-on' : ''}" data-mjf="${v}">${l}</button>`).join('')}</div>
      <div class="mjgrid">${shown.map(card).join('')}</div>
      <p class="hint mj__src">Datos de <a href="https://liquipedia.net/counterstrike/Majors" target="_blank" rel="noopener">Liquipedia</a> (CC-BY-SA 3.0)${idx.checked ? ` · actualizado ${fmtDayTime(new Date(idx.checked))}` : ''}.</p>
    </div>`;
  }

  // ---------------------------------------------------------------- ficha
  async function detail(id) {
    const idx = await getIndex();
    const m = idx.majors.find((x) => x.id === id);
    if (!m) return `<div class="state state--error"><p><b>No existe ese Major.</b></p><a class="btn" href="#/majors">Ver todos</a></div>`;
    const d = m.loaded || m.id === idx.current ? await getDetail(id) : null;
    const pos = idx.majors.indexOf(m);
    const prev = idx.majors[pos - 1]; const next = idx.majors[pos + 1];
    const extra = M.extra[id] || {};
    if (M.id !== id) { M.id = id; M.stage = null; }
    const stages = (d?.stages || []).filter((s) => s.matches || (d.matches || []).some((x) => x.stage === s.id));
    if (!M.stage || (M.stage !== '__teams' && !stages.some((s) => s.id === M.stage))) M.stage = (stages.find((s) => s.id === 'po' && d.matches.some((x) => x.stage === 'po' && x.done)) || stages[stages.length - 1] || {}).id;
    const fact = (l, v) => (v ? `<div class="fact"><small>${l}</small><b>${v}</b></div>` : '');
    const champ = m.champion
      ? `<section class="mjchamp"><div class="mjchamp__cup" aria-hidden="true">🏆</div>${badge(m.champion, 'tb--xl')}<div><small>Campeón</small><h2><a href="#/equipos/${encodeURIComponent(m.champion)}">${esc(m.champion)}</a></h2>
          <p>${m.final ? `Ganó la final <b>${esc(m.final.replace('-', '–'))}</b> a ` : 'Ganó la final a '}${badge(m.runnerup)} <b>${esc(m.runnerup)}</b></p></div></section>`
      : `<section class="mjchamp mjchamp--tbd"><div class="mjchamp__cup" aria-hidden="true">🏆</div><div><small>Campeón</small><h2>${m.status === 'upcoming' ? 'Por jugar' : 'Por decidir'}</h2>
          <p>${m.id === idx.current ? 'Es el Major del Pick\'em: <a href="#/">haz tus pronósticos</a>.' : 'Todavía no hay campeón.'}</p></div></section>`;
    return `<div class="mj mj--detail">
      <nav class="mjnav"><a href="#/majors">← Todos los Majors</a><span>${prev ? `<a href="#/majors/${esc(prev.id)}">‹ ${esc(prev.city)} ${prev.year}</a>` : ''}${next ? `<a href="#/majors/${esc(next.id)}">${esc(next.city)} ${next.year} ›</a>` : ''}</span></nav>
      <header class="mjhead"><p class="kicker">${m.game} · ${esc(m.organizer)}${m.id === idx.current ? ' · Pick\'em abierto' : ''}</p><h1 class="ghead__title">${esc(m.name)}</h1>
        <div class="facts">${fact('Dónde', `${flag(m.country)} ${esc(m.city)}${COUNTRY[m.country] && COUNTRY[m.country] !== m.city ? `, ${COUNTRY[m.country]}` : ''}`)}${fact('Fechas', esc(dRange(m.start, m.end)))}
          ${fact('Premios', esc(money(m.prize)))}${fact('Equipos', m.teams ? String(m.teams) : '')}${fact('MVP', esc(mvpOf(m)))}</div></header>
      ${champ}
      ${extra.note ? `<div class="notice"><span aria-hidden="true">📝</span><p>${esc(extra.note)}</p></div>` : ''}
      ${stages.length ? `<div class="seg">${stages.map((s) => `<button type="button" class="${s.id === M.stage ? 'is-on' : ''}" data-mjs="${esc(s.id)}">${esc(stageLabel(s))}</button>`).join('')}${Object.keys(d.rosters || {}).length ? `<button type="button" class="${M.stage === '__teams' ? 'is-on' : ''}" data-mjs="__teams">Equipos y plantillas</button>` : ''}</div>
        <div id="mjStage">${stageHtml(d, M.stage === '__teams' ? { id: '__teams' } : stages.find((s) => s.id === M.stage))}</div>`
        : `<div class="empty">${m.status === 'upcoming' ? 'Este Major todavía no ha empezado: sus fases aparecerán aquí cuando Liquipedia publique los cruces.' : 'Los partidos de este Major todavía no se han descargado de Liquipedia. Se añaden poco a poco: vuelve en un rato.'}</div>`}
      <p class="hint mj__src">Datos de ${m.page ? `<a href="${lpUrl(m.page)}" target="_blank" rel="noopener">Liquipedia</a>` : 'Liquipedia'} (CC-BY-SA 3.0).</p>
    </div>`;
  }
  const stageLabel = (s) => (s.name === 'Principal' ? 'Fase de grupos' : s.name);
  function rostersHtml(d) {
    const r = Object.entries(d.rosters || {}).sort((a, b) => a[0].localeCompare(b[0]));
    if (!r.length) return '<div class="empty">Liquipedia todavía no tiene las plantillas de este Major.</div>';
    const fl = flag;
    const pl = (x) => `<a class="plink" href="#/jugadores/${encodeURIComponent(x.n)}">${fl(x.flag)} ${esc(x.n)}</a>`;
    return `<div class="rgrid">${r.map(([t, v]) => `<section class="card"><h3><a class="tlink" href="#/equipos/${encodeURIComponent(t)}">${badge(t)}<span>${esc(t)}</span></a></h3>
        <div class="roster">${v.players.map(pl).join('')}${v.coach ? `<span class="roster__coach">Entrenador: ${pl(v.coach)}</span>` : ''}</div></section>`).join('')}</div>`;
  }
  function stageHtml(d, s) {
    if (s?.id === '__teams') return rostersHtml(d);
    if (!d || !s) return '';
    const ms = d.matches.filter((x) => x.stage === s.id);
    if (s.type === 'bracket') return bracketHtml(ms);
    if (s.type === 'swiss') return swissHtml(ms, s);
    return groupsHtml(ms);
  }
  const row = (m) => {
    const w = winnerTeam(m);
    const side = (t, sc, right) => `<span class="mr__t ${w === t ? 'is-won' : w ? 'is-lost' : ''} ${right ? 'mr__t--r' : ''}">${badge(t)}<b>${esc(t)}</b></span>`;
    const maps = (m.maps || []).filter((x) => x.winner || x.s1 != null);
    return `<li class="mr"><a class="mr__link" href="#/majors/${esc(M.id)}/p/${esc(m.id)}" aria-label="Ver el partido ${esc(m.t1)} contra ${esc(m.t2)}"></a>
        <span class="mr__when">${m.time ? fmtDate(m.time) : ''}<small>Bo${m.bo}</small></span>
        ${side(m.t1, m.s1)}<span class="mr__score">${m.done ? `<b class="${m.winner === 1 ? 'w' : ''}">${m.s1}</b>–<b class="${m.winner === 2 ? 'w' : ''}">${m.s2}</b>` : '<i>vs</i>'}</span>${side(m.t2, m.s2, true)}
        ${maps.length > 1 || (maps.length === 1 && m.bo === 1) ? `<span class="mr__maps">${maps.map((x) => `${esc(x.map || 'Mapa')} ${x.s1 ?? ''}–${x.s2 ?? ''}`).join(' · ')}</span>` : ''}</li>`;
  };
  function records(ms) {
    const rec = {};
    for (const m of ms) {
      for (const t of [m.t1, m.t2]) if (t && t !== 'TBD') rec[t] = rec[t] || { w: 0, l: 0, rw: 0, rl: 0 };
      if (!m.done) continue;
      const w = winnerTeam(m); const l = m.winner === 1 ? m.t2 : m.t1;
      rec[w].w++; rec[l].l++;
      for (const x of m.maps || []) { if (x.s1 == null) continue; rec[m.t1].rw += x.s1; rec[m.t1].rl += x.s2; rec[m.t2].rw += x.s2; rec[m.t2].rl += x.s1; }
    }
    return Object.entries(rec).sort((a, b) => b[1].w - a[1].w || a[1].l - b[1].l || (b[1].rw - b[1].rl) - (a[1].rw - a[1].rl) || a[0].localeCompare(b[0]));
  }
  function swissHtml(ms, s) {
    const rec = records(ms);
    const rounds = [...new Map(ms.map((m) => [m.round, true])).keys()];
    const st = (r) => (r.w === 3 ? 'is-up' : r.l === 3 ? 'is-out' : '');
    return `<div class="mjsw">
        <section class="card"><h3>Clasificación</h3><ol class="records">${rec.map(([t, r]) => `<li class="${st(r)}">${badge(t)}<span>${esc(t)}</span><b>${r.w}-${r.l}</b></li>`).join('')}</ol>
          <p class="hint">Verde: se clasifica (3 victorias) · Rojo: eliminado (3 derrotas).</p></section>
        <div>${rounds.map((r) => `<h3 class="day">${esc(roundEs(r))}</h3><ul class="mrs">${ms.filter((m) => m.round === r).map(row).join('')}</ul>`).join('')}</div>
      </div>`;
  }
  function groupsHtml(ms) {
    const groups = [...new Map(ms.map((m) => [m.round.split(' · ')[0], true])).keys()];
    return `<div class="mjgroups">${groups.map((g) => {
      const own = ms.filter((m) => m.round.split(' · ')[0] === g);
      const rec = records(own);
      return `<section class="card mjgroup"><h3>${esc(g.replace(/^Group\b/i, 'Grupo'))}</h3>
          <ol class="records records--sm">${rec.map(([t, r]) => `<li class="${r.w >= 2 ? 'is-up' : r.l >= 2 ? 'is-out' : ''}">${badge(t)}<span>${esc(t)}</span><b>${r.w}-${r.l}</b></li>`).join('')}</ol>
          <ul class="mrs mrs--sm">${own.map(row).join('')}</ul></section>`;
    }).join('')}</div>`;
  }
  function bracketHtml(ms) {
    const withSlot = ms.filter((m) => /^R\d+M\d+$/.test(m.slot || ''));
    if (!withSlot.length) {
      const rounds = [...new Map(ms.map((m) => [m.round, true])).keys()];
      return rounds.map((r) => `<h3 class="day">${esc(r)}</h3><ul class="mrs">${ms.filter((m) => m.round === r).map(row).join('')}</ul>`).join('');
    }
    const third = withSlot.filter((m) => m.kind === 'third');
    const main = withSlot.filter((m) => m.kind !== 'third');
    const cols = [...new Set(main.map((m) => Number(m.slot.match(/^R(\d+)/)[1])))].sort((a, b) => a - b);
    const box = (m) => {
      const w = winnerTeam(m);
      const t = (team, sc) => `<div class="bx__t ${w === team ? 'is-won' : w ? 'is-lost' : ''}">${team && team !== 'TBD' ? badge(team) : '<span class="tb tb--tbd">?</span>'}<span>${esc(team && team !== 'TBD' ? team : 'Por decidir')}</span><b>${m.done ? sc : ''}</b></div>`;
      return `<a class="bx ${m.kind === 'final' ? 'bx--final' : ''}" href="#/majors/${esc(M.id)}/p/${esc(m.id)}"><small>${m.time ? fmtDate(m.time) : ''} · Bo${m.bo}</small>${t(m.t1, m.s1)}${t(m.t2, m.s2)}</a>`;
    };
    return `<div class="mjbr" style="--cols:${cols.length}">${cols.map((c) => {
      const own = main.filter((m) => Number(m.slot.match(/^R(\d+)/)[1]) === c).sort((a, b) => Number(a.slot.split('M')[1]) - Number(b.slot.split('M')[1]));
      return `<div class="mjbr__col ${c === cols[cols.length - 1] ? 'is-last' : ''}"><h4>${esc(own[0]?.round || '')}</h4><div class="mjbr__slots">${own.map((m) => `<div class="mjbr__slot">${box(m)}</div>`).join('')}</div></div>`;
    }).join('')}</div>
    ${third.length ? `<h3 class="day">Tercer puesto</h3><div class="mjbr__third">${third.map(box).join('')}</div>` : ''}`;
  }
  function roundEs(r) {
    return String(r || '').replace(/Round\s*(\d+)/i, 'Ronda $1').replace(/\s*Matches?\b/gi, '').replace(/:\s*/, ' · ').trim();
  }

  // ---------------------------------------------------------------- eventos
  $app.addEventListener('click', async (e) => {
    if (!isOpen()) return;
    const b = e.target.closest('[data-mjf],[data-mjs]');
    if (!b) return;
    if (b.dataset.mjf !== undefined) { M.filter = b.dataset.mjf; $app.innerHTML = await list(); return; }
    M.stage = b.dataset.mjs;
    document.querySelectorAll('[data-mjs]').forEach((x) => x.classList.toggle('is-on', x === b));
    const d = await getDetail(M.id);
    document.getElementById('mjStage').innerHTML = stageHtml(d, M.stage === '__teams' ? { id: '__teams' } : d.stages.find((s) => s.id === M.stage));
  });
  return { list, detail, isOpen, getIndex, getDetail, flag };
}
