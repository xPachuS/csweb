#!/usr/bin/env python3
"""Descarga de Liquipedia los Majors de Counter-Strike y los guarda en data/majors/.

  data/majors/index.json    lista de todos los Majors (ficha resumida, campeón, estado…)
  data/majors/<id>.json     fases y partidos de cada Major (el del Pick'em se refresca siempre)

Se ejecuta desde GitHub Actions cada 10 minutos (.github/workflows/update.yml):
  · El Major del Pick'em (el actual) se vuelve a leer en cada ejecución: 1 o 2 consultas.
  · Los Majors antiguos se leen una sola vez y se congelan. Para no cargar a Liquipedia,
    cada ejecución rellena como mucho BACKFILL Majors pendientes (en ~1 hora están todos).
Cada consulta lleva un User-Agent que identifica el proyecto y se espera entre consultas,
como piden las normas de su API: https://liquipedia.net/api-terms-of-use

Para añadir un Major nuevo basta con añadir una línea a MAJORS (abajo). La página de
Liquipedia se busca sola; si la encuentra mal, ponla a mano en «page».

Pruebas sin conexión:  python scripts/update_majors.py --offline CARPETA
  (CARPETA con ficheros <titulo de la página con / cambiado por __>.wiki y opcional search.json)

Volver a descargar a mano (también desde GitHub: Actions → «Actualizar Majors» → Run workflow):
  --force 2024-copenhagen,2025-austin   relee esos Majors aunque ya estén guardados
  --force todos                         relee todos los Majors ya jugados (tarda unos minutos)
  --logos faltan                        reintenta los logos que no se encontraron
  --logos todos                         vuelve a bajar todos los logos (en tandas de 40)
"""
from __future__ import annotations

import gzip
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'majors'
API = 'https://liquipedia.net/counterstrike/api.php'
REPO = os.environ.get('GITHUB_REPOSITORY', 'clutch-pickem')
USER_AGENT = f'ClutchPickem/1.1 (fan site; https://github.com/{REPO})'
WAIT = 2.5            # segundos entre consultas a Liquipedia
BACKFILL = 5          # Majors antiguos que se rellenan como mucho en cada ejecución
PICKEM_FROM = '2026-singapore'   # desde este Major (incluido) hay Pick'em en la web

# ---------------------------------------------------------------- lista de Majors
# id, nombre, ciudad (en castellano), país (código ISO), organizador, fechas, juego, búsqueda en
# Liquipedia y datos de respaldo (campeón, subcampeón, resultado de la final, MVP) por si la
# página no se puede leer. «page» fija la página de Liquipedia si la búsqueda falla.
def M(id, name, city, cc, org, start, end, game, search, champ='', runner='', final='', mvp='', page=''):
    return dict(id=id, name=name, city=city, country=cc, organizer=org, start=start, end=end, game=game,
                search=search, champion=champ, runnerup=runner, final=final, mvp=mvp, page=page)


MAJORS = [
    M('2013-jonkoping', 'DreamHack Winter 2013', 'Jönköping', 'SE', 'DreamHack', '2013-11-28', '2013-11-30', 'CS:GO', 'DreamHack Winter 2013', 'Fnatic', 'Ninjas in Pyjamas', '2-1'),
    M('2014-katowice', 'EMS One Katowice 2014', 'Katowice', 'PL', 'ESL', '2014-03-13', '2014-03-16', 'CS:GO', 'EMS One Katowice 2014', 'Virtus.pro', 'Ninjas in Pyjamas', '2-0'),
    M('2014-cologne', 'ESL One Cologne 2014', 'Colonia', 'DE', 'ESL', '2014-08-14', '2014-08-17', 'CS:GO', 'ESL One Cologne 2014', 'Ninjas in Pyjamas', 'Fnatic', '2-1'),
    M('2014-jonkoping', 'DreamHack Winter 2014', 'Jönköping', 'SE', 'DreamHack', '2014-11-27', '2014-11-29', 'CS:GO', 'DreamHack Winter 2014', 'Team LDLC.com', 'Ninjas in Pyjamas', '2-1'),
    M('2015-katowice', 'ESL One Katowice 2015', 'Katowice', 'PL', 'ESL', '2015-03-12', '2015-03-15', 'CS:GO', 'ESL One Katowice 2015', 'Fnatic', 'Ninjas in Pyjamas', '2-1'),
    M('2015-cologne', 'ESL One Cologne 2015', 'Colonia', 'DE', 'ESL', '2015-08-20', '2015-08-23', 'CS:GO', 'ESL One Cologne 2015', 'Fnatic', 'Team EnVyUs', '2-0'),
    M('2015-cluj', 'DreamHack Open Cluj-Napoca 2015', 'Cluj-Napoca', 'RO', 'DreamHack', '2015-10-28', '2015-11-01', 'CS:GO', 'DreamHack Open Cluj-Napoca 2015', 'Team EnVyUs', 'Natus Vincere', '2-0'),
    M('2016-columbus', 'MLG Major Championship: Columbus 2016', 'Columbus', 'US', 'MLG', '2016-03-29', '2016-04-03', 'CS:GO', 'MLG Major Championship Columbus 2016', 'Luminosity Gaming', 'Natus Vincere', '2-0'),
    M('2016-cologne', 'ESL One Cologne 2016', 'Colonia', 'DE', 'ESL', '2016-07-05', '2016-07-10', 'CS:GO', 'ESL One Cologne 2016', 'SK Gaming', 'Team Liquid', '2-0'),
    M('2017-atlanta', 'ELEAGUE Major 2017', 'Atlanta', 'US', 'ELEAGUE', '2017-01-22', '2017-01-29', 'CS:GO', 'ELEAGUE Major 2017', 'Astralis', 'Virtus.pro', '2-1'),
    M('2017-krakow', 'PGL Major Kraków 2017', 'Cracovia', 'PL', 'PGL', '2017-07-16', '2017-07-23', 'CS:GO', 'PGL Major Krakow 2017', 'Gambit Esports', 'Immortals', '2-1'),
    M('2018-boston', 'ELEAGUE Major: Boston 2018', 'Boston', 'US', 'ELEAGUE', '2018-01-12', '2018-01-28', 'CS:GO', 'ELEAGUE Major Boston 2018', 'Cloud9', 'FaZe Clan', '2-1'),
    M('2018-london', 'FACEIT Major: London 2018', 'Londres', 'GB', 'FACEIT', '2018-09-05', '2018-09-23', 'CS:GO', 'FACEIT Major London 2018', 'Astralis', 'Natus Vincere', '2-0'),
    M('2019-katowice', 'IEM Katowice Major 2019', 'Katowice', 'PL', 'ESL', '2019-02-13', '2019-03-03', 'CS:GO', 'IEM Katowice Major 2019', 'Astralis', 'ENCE', '2-0'),
    M('2019-berlin', 'StarLadder Major: Berlin 2019', 'Berlín', 'DE', 'StarLadder', '2019-08-23', '2019-09-08', 'CS:GO', 'StarLadder Major Berlin 2019', 'Astralis', 'AVANGAR', '2-0'),
    M('2021-stockholm', 'PGL Major Stockholm 2021', 'Estocolmo', 'SE', 'PGL', '2021-10-26', '2021-11-07', 'CS:GO', 'PGL Major Stockholm 2021', 'Natus Vincere', 'G2 Esports', '2-0'),
    M('2022-antwerp', 'PGL Major Antwerp 2022', 'Amberes', 'BE', 'PGL', '2022-05-09', '2022-05-22', 'CS:GO', 'PGL Major Antwerp 2022', 'FaZe Clan', 'Natus Vincere', '2-0'),
    M('2022-rio', 'IEM Rio Major 2022', 'Río de Janeiro', 'BR', 'ESL', '2022-10-31', '2022-11-13', 'CS:GO', 'IEM Rio Major 2022', 'Outsiders', 'HEROIC', '2-0'),
    M('2023-paris', 'BLAST.tv Paris Major 2023', 'París', 'FR', 'BLAST', '2023-05-08', '2023-05-21', 'CS:GO', 'BLAST.tv Paris Major 2023', 'Vitality', 'GamerLegion', '2-0'),
    M('2024-copenhagen', 'PGL Major Copenhagen 2024', 'Copenhague', 'DK', 'PGL', '2024-03-17', '2024-03-31', 'CS2', 'PGL Major Copenhagen 2024', 'Natus Vincere', 'FaZe Clan', '2-1'),
    M('2024-shanghai', 'Perfect World Shanghai Major 2024', 'Shanghái', 'CN', 'Perfect World', '2024-11-30', '2024-12-15', 'CS2', 'Perfect World Shanghai Major 2024', 'Team Spirit', 'FaZe Clan', '2-1', 'donk'),
    M('2025-austin', 'BLAST.tv Austin Major 2025', 'Austin', 'US', 'BLAST', '2025-06-03', '2025-06-22', 'CS2', 'BLAST.tv Austin Major 2025', 'Vitality', 'The MongolZ', '2-1'),
    M('2025-budapest', 'StarLadder Budapest Major 2025', 'Budapest', 'HU', 'StarLadder', '2025-11-24', '2025-12-14', 'CS2', 'StarLadder Budapest Major 2025', 'Vitality', 'FaZe Clan', '3-1'),
    M('2026-cologne', 'IEM Cologne Major 2026', 'Colonia', 'DE', 'ESL', '2026-06-02', '2026-06-21', 'CS2', 'IEM Cologne Major 2026', 'Team Falcons', 'FURIA', '3-0'),
    M('2026-singapore', 'PGL Major Singapore 2026', 'Singapur', 'SG', 'PGL', '2026-11-25', '2026-12-13', 'CS2', 'PGL Major Singapore 2026', page='PGL/2026/Singapore'),
    M('2027-buenos-aires', 'Major de Buenos Aires 2027', 'Buenos Aires', 'AR', 'FiReSPORTS', '2027-05-31', '2027-06-20', 'CS2', 'Buenos Aires Major 2027'),
    M('2027-shanghai', 'Perfect World Shanghai Major 2027', 'Shanghái', 'CN', 'Perfect World', '2027-11-22', '2027-12-12', 'CS2', 'Shanghai Major 2027'),
]

# Nombres «bonitos» de las plantillas de equipo de Liquipedia ({{TeamOpponent|vitality}})
TEAM_NAMES = {
    'vitality': 'Vitality', 'team vitality': 'Vitality', 'spirit': 'Team Spirit', 'team spirit': 'Team Spirit',
    'mouz': 'MOUZ', 'mousesports': 'MOUZ', 'falcons': 'Team Falcons', 'team falcons': 'Team Falcons',
    'the mongolz': 'The MongolZ', 'mongolz': 'The MongolZ', 'furia': 'FURIA', 'furia esports': 'FURIA',
    'natus vincere': 'Natus Vincere', 'navi': 'Natus Vincere', 'na\'vi': 'Natus Vincere', 'faze': 'FaZe Clan', 'faze clan': 'FaZe Clan',
    'g2': 'G2 Esports', 'g2 esports': 'G2 Esports', 'aurora': 'Aurora', 'aurora gaming': 'Aurora',
    '3dmax': '3DMAX', 'pain': 'paiN Gaming', 'pain gaming': 'paiN Gaming', 'legacy': 'Legacy',
    'astralis': 'Astralis', 'liquid': 'Team Liquid', 'team liquid': 'Team Liquid', 'mibr': 'MIBR',
    'heroic': 'HEROIC', 'nrg': 'NRG', 'nrg esports': 'NRG', 'virtus.pro': 'Virtus.pro', 'vp': 'Virtus.pro',
    'gamerlegion': 'GamerLegion', 'b8': 'B8', 'lynn vision': 'Lynn Vision', 'lynn vision gaming': 'Lynn Vision',
    'tyloo': 'TYLOO', 'betboom': 'BetBoom Team', 'betboom team': 'BetBoom Team', 'parivision': 'PARIVISION',
    'fnatic': 'Fnatic', 'complexity': 'Complexity', 'complexity gaming': 'Complexity', 'big': 'BIG',
    'ence': 'ENCE', 'eternal fire': 'Eternal Fire', 'cloud9': 'Cloud9', 'c9': 'Cloud9', 'imperial': 'Imperial',
    'imperial esports': 'Imperial', 'wildcard': 'Wildcard', 'm80': 'M80', 'flyquest': 'FlyQuest',
    'rare atom': 'Rare Atom', 'ninjas in pyjamas': 'Ninjas in Pyjamas', 'nip': 'Ninjas in Pyjamas',
    'sangal': 'Sangal', 'monte': 'Monte', 'saw': 'SAW', 'red canids': 'RED Canids', 'fluxo': 'Fluxo',
    'og': 'OG', 'apeks': 'Apeks', 'nemiga': 'Nemiga', 'passion ua': 'Passion UA', 'bc.game': 'BC.Game',
    'gentle mates': 'Gentle Mates', 'nemesis': 'Nemesis', 'tsm': 'TSM',
    'ldlc': 'Team LDLC.com', 'team ldlc': 'Team LDLC.com', 'team ldlc.com': 'Team LDLC.com', 'envyus': 'Team EnVyUs',
    'team envyus': 'Team EnVyUs', 'nv': 'Team EnVyUs', 'luminosity': 'Luminosity Gaming', 'luminosity gaming': 'Luminosity Gaming',
    'sk': 'SK Gaming', 'sk gaming': 'SK Gaming', 'gambit': 'Gambit Esports', 'gambit esports': 'Gambit Esports',
    'immortals': 'Immortals', 'avangar': 'AVANGAR', 'outsiders': 'Outsiders', 'titan': 'Titan', 'dignitas': 'Team Dignitas',
    'team dignitas': 'Team Dignitas', 'north': 'North', 'optic': 'OpTic Gaming', 'optic gaming': 'OpTic Gaming',
    'renegades': 'Renegades', 'clg': 'Counter Logic Gaming', 'flipsid3': 'FlipSid3 Tactics', 'hellraisers': 'HellRaisers',
    'godsent': 'GODSENT', 'mibr (2018)': 'MIBR', 'evil geniuses': 'Evil Geniuses', 'eg': 'Evil Geniuses',
}
TBD = {'', 'tbd', 'tba', 'bye', 'definitions'}
TEAM_TPL: dict[str, str] = {}          # nombre bonito -> plantilla de Liquipedia (se rellena al leer partidos)
LOGOS = ROOT / 'img' / 'teams'
TEAMS_JSON = ROOT / 'data' / 'teams.json'
LOGO_BATCH = 50       # equipos por consulta a Liquipedia
LOGO_DOWNLOADS = 40   # imágenes descargadas como mucho por ejecución
RETRY_LOGOS = ''      # '' | 'faltan' | 'todos' (se cambia con --logos)
TZ = {'UTC': 0, 'GMT': 0, 'CET': 1, 'CEST': 2, 'EET': 2, 'EEST': 3, 'MSK': 3, 'SGT': 8, 'CST': 8, 'KST': 9,
      'JST': 9, 'EST': -5, 'EDT': -4, 'PST': -8, 'PDT': -7, 'BRT': -3, 'ART': -3, 'AEST': 10, 'AEDT': 11,
      'WET': 0, 'WEST': 1, 'BST': 1, 'CDT': -5, 'MDT': -6}
STAGE_PAGE_SKIP = re.compile(r'statistic|stats|qualif|showmatch|broadcast|media|news|pick|ticket|group_?stage_?draw|rules', re.I)


def log(*a):
    print(*a, flush=True)


# ---------------------------------------------------------------- wikitext
def split_top(text: str, sep: str = '|') -> list[str]:
    """Parte por `sep` sin entrar en {{plantillas}} ni [[enlaces]]."""
    out, depth, buf, i = [], 0, [], 0
    while i < len(text):
        two = text[i:i + 2]
        if two in ('{{', '[['):
            depth += 1; buf.append(two); i += 2; continue
        if two in ('}}', ']]') and depth:
            depth -= 1; buf.append(two); i += 2; continue
        if text[i] == sep and depth == 0:
            out.append(''.join(buf)); buf = []; i += 1; continue
        buf.append(text[i]); i += 1
    out.append(''.join(buf))
    return out


def templates(text: str):
    """Plantillas de primer nivel: [(nombre, cuerpo)]."""
    out, i = [], 0
    while True:
        start = text.find('{{', i)
        if start < 0:
            return out
        depth, j = 0, start
        while j < len(text):
            if text.startswith('{{', j):
                depth += 1; j += 2
            elif text.startswith('}}', j):
                depth -= 1; j += 2
                if depth == 0:
                    break
            else:
                j += 1
        inner = text[start + 2:j - 2]
        name = split_top(inner)[0].strip()
        out.append((name, inner))
        i = j


def params(inner: str):
    """{{Nombre|a|b=c}} -> ({'1': 'a', 'b': 'c'})"""
    parts = split_top(inner)[1:]
    out, n = {}, 0
    for p in parts:
        k, eq, v = p.partition('=')
        if eq and re.fullmatch(r'\s*[\w ]+\s*', k):
            out[k.strip()] = v.strip()
        else:
            n += 1
            out[str(n)] = p.strip()
    return out


def strip_markup(s: str) -> str:
    s = re.sub(r'<!--.*?-->', '', s or '', flags=re.S)
    s = re.sub(r'\[\[(?:[^|\]]*\|)?([^\]]*)\]\]', r'\1', s)
    s = re.sub(r"'{2,}", '', s)
    return re.sub(r'<[^>]+>', '', s).strip()


def team_name(raw: str) -> str:
    s = strip_markup(raw)
    key = s.lower().strip()
    if key in TBD:
        return 'TBD'
    if key in TEAM_NAMES:
        return TEAM_NAMES[key]
    return s if any(c.isupper() for c in s) else s.title()


def opponent(raw: str) -> dict:
    """{{TeamOpponent|vitality|score=2}} -> {'team': 'Vitality', 'score': '2'}"""
    for name, inner in templates(raw or ''):
        if 'opponent' in name.lower():
            p = params(inner)
            team = p.get('1') or p.get('template') or p.get('name') or ''
            name_ = team_name(team)
            key = strip_markup(team).lower().strip()
            if name_ != 'TBD' and key and name_ not in TEAM_TPL:
                TEAM_TPL[name_] = key                 # plantilla de Liquipedia del equipo (para su logo)
            return {'team': name_, 'score': p.get('score', '').strip()}
    return {'team': team_name(raw or ''), 'score': ''}


def to_int(v):
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return None


def parse_date(raw: str):
    """'November 24, 2026 - 10:00 {{Abbr/CET}}' -> ISO UTC (o None)."""
    if not raw:
        return None
    tz = 0
    m = re.search(r'\{\{\s*Abbr/(\w+)\s*\}\}', raw)
    if m:
        tz = TZ.get(m.group(1).upper(), 0)
    s = re.sub(r'\{\{.*?\}\}', '', raw).replace('-', ' ').replace(',', ' ')
    s = re.sub(r'\s+', ' ', s).strip()
    for fmt in ('%B %d %Y %H:%M', '%b %d %Y %H:%M', '%Y %m %d %H:%M', '%B %d %Y', '%Y %m %d'):
        try:
            d = datetime.strptime(s, fmt)
            return (d - timedelta(hours=tz)).replace(tzinfo=timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
        except ValueError:
            continue
    return None


def parse_map(raw: str):
    for name, inner in templates(raw or ''):
        if name.lower() != 'map':
            continue
        p = params(inner)
        s1, s2 = to_int(p.get('score1')), to_int(p.get('score2'))
        if s1 is None or s2 is None:      # solo marcadores por mitades: se suman
            h1 = [to_int(v) for k, v in p.items() if re.fullmatch(r'(o\d+)?t1(t|ct)', k)]
            h2 = [to_int(v) for k, v in p.items() if re.fullmatch(r'(o\d+)?t2(t|ct)', k)]
            if any(x is not None for x in h1 + h2):
                s1, s2 = sum(x or 0 for x in h1), sum(x or 0 for x in h2)
        w = to_int(p.get('winner'))
        finished = str(p.get('finished', '')).lower() in ('true', '1', 'yes', 'skip') or w in (1, 2)
        if w not in (1, 2) and finished and s1 is not None and s2 is not None and s1 != s2:
            w = 1 if s1 > s2 else 2
        name_ = strip_markup(p.get('map', ''))
        if not name_ and s1 is None and w is None:
            return None
        return {'map': name_, 's1': s1, 's2': s2, 'winner': w if w in (1, 2) else 0}
    return None


def parse_match(inner: str, sid: str, stype: str, mid: str, round_name: str, slot: str = ''):
    p = params(inner)
    o1, o2 = opponent(p.get('opponent1', '')), opponent(p.get('opponent2', ''))
    bo = to_int(p.get('bestof')) or (1 if stype == 'swiss' else 3)
    maps = [m for m in (parse_map(p.get(f'map{i}', '')) for i in range(1, 8)) if m]
    s1 = sum(1 for m in maps if m['winner'] == 1)
    s2 = sum(1 for m in maps if m['winner'] == 2)
    if o1['score'] or o2['score']:              # marcador puesto en el oponente (W/FF o directo)
        a, b = o1['score'].upper(), o2['score'].upper()
        if a in ('W', 'FF') or b in ('W', 'FF'):
            s1, s2 = (1, 0) if a == 'W' or b == 'FF' else (0, 1)
        elif to_int(a) is not None and to_int(b) is not None:
            s1, s2 = to_int(a), to_int(b)
    w = to_int(p.get('winner'))
    need = bo // 2 + 1
    if w not in (1, 2):
        w = 1 if s1 >= need else 2 if s2 >= need else 0
    finished = str(p.get('finished', '')).lower() in ('true', '1', 'yes') or w in (1, 2)
    if w not in (1, 2) and finished and s1 != s2:
        w = 1 if s1 > s2 else 2
    return {
        'id': mid, 'stage': sid, 'round': round_name, 'slot': slot, 'kind': '', 'bo': bo,
        'date': parse_date(p.get('date', '')), 't1': o1['team'], 't2': o2['team'],
        's1': s1, 's2': s2, 'winner': w if w in (1, 2) else 0, 'done': bool(w in (1, 2)),
        'maps': [m for m in maps if m['map'] or m['winner']],
    }


def round_label(title: str, fallback: str) -> str:
    t = strip_markup(title or '')
    t = re.sub(r'\s*Matches?\s*$', '', t, flags=re.I).strip()
    return t or fallback


def scan_page(wikitext: str):
    """Plantillas de partidos de una página: ([(id, título, [(clave, cabecera, cuerpo)])], [(id, {RxMy: (cabecera, cuerpo)})])."""
    lists, brackets = [], []
    def walk(text: str, depth: int = 0):
        for name, inner in templates(text):
            low = name.lower()
            if low.startswith('matchlist') or low.startswith('singlematch'):
                p = params(inner)
                items, header = [], ''
                for k in sorted((k for k in p if re.fullmatch(r'M\d+', k)), key=lambda k: int(k[1:])):
                    header = strip_markup(p.get(f'{k}header', '')) or header
                    for n2, i2 in templates(p[k]):
                        if n2.lower() == 'match':
                            items.append((k, header, i2))
                if items:
                    lists.append((re.sub(r'\W+', '', p.get('id', '')) or f'l{len(lists)}', p.get('title') or p.get('matchsection') or '', items))
            elif low.startswith('bracket'):
                p = params(inner)
                slots = {}
                for k in (k for k in p if re.fullmatch(r'R\d+M\d+', k)):
                    for n2, i2 in templates(p[k]):
                        if n2.lower() == 'match':
                            slots[k] = (strip_markup(p.get(f'{k}header', '')), i2)
                if slots:
                    brackets.append((re.sub(r'\W+', '', p.get('id', '')) or f'b{len(brackets)}', slots))
            elif depth < 4 and low not in ('match', 'map'):
                walk(inner, depth + 1)       # plantillas que envuelven otras (tabs, cajas…)
    walk(wikitext)
    return lists, brackets


def list_matches(lists, sid: str, stype: str) -> list[dict]:
    out = []
    for n, (lid, title, items) in enumerate(lists):
        base = round_label(title, f'Ronda {n + 1}' if stype == 'swiss' else f'Grupo {chr(65 + n)}')
        for k, header, inner in items:
            rnd = base
            if header and stype != 'swiss':
                rnd = f'{base} · {round_label(header, header)}'
            elif header and stype == 'swiss' and not title:
                rnd = round_label(header, base)
            out.append(parse_match(inner, sid, stype, f'{sid}-{lid}-{k}', rnd))
    return out


def bracket_matches(brackets, sid: str) -> list[dict]:
    out = []
    for bid, slots in brackets:
        for k, (header, inner) in slots.items():
            out.append(parse_match(inner, sid, 'bracket', f'{sid}-{bid}-{k}', header, k if len(brackets) == 1 else ''))
            out[-1]['_r'] = int(re.match(r'R(\d+)', k).group(1))
            out[-1]['_k'] = k
    if not out:
        return out
    # nombres de ronda: la última ronda = Gran final (+ tercer puesto), las anteriores Semis, Cuartos, Octavos…
    last = max(m['_r'] for m in out)
    lasts = [m for m in out if m['_r'] == last]
    for m in lasts:
        third = re.search(r'3rd|third|tercer', m['round'], re.I) or (len(lasts) > 1 and m['_k'].endswith('M2'))
        m['round'], m['kind'] = ('Tercer puesto', 'third') if third else ('Gran final', 'final')
    names = {last - 1: ('Semifinales', 'sf'), last - 2: ('Cuartos de final', 'qf'), last - 3: ('Octavos de final', 'r16')}
    for m in out:
        if not m['kind']:
            nm, kd = names.get(m['_r'], (m['round'] or f"Ronda {m['_r']}", 'ko'))
            m['round'], m['kind'] = nm, kd
        del m['_r'], m['_k']
    return out


def infobox(wikitext: str) -> dict:
    for name, inner in templates(wikitext or ''):
        if name.lower().startswith('infobox league') or name.lower().startswith('infobox tournament'):
            p = params(inner)
            g = lambda *ks: next((strip_markup(p[k]) for k in ks if p.get(k)), '')
            prize = g('prizepoolusd', 'prizepool')
            prize = re.sub(r'[^\d]', '', prize)
            return {'name': g('name'), 'start': g('sdate', 'date'), 'end': g('edate', 'date'), 'city': g('city', 'location'),
                    'venue': g('venue'), 'prize': int(prize) if prize else None, 'teams': to_int(g('team_number'))}
    return {}


def stage_links(wikitext: str, main: str) -> list[tuple[str, str]]:
    """Subpáginas en orden, según las pestañas {{Tabs static|name1=…|link1=…}} de la página principal."""
    for name, inner in templates(wikitext or ''):
        if name.lower().startswith('tabs'):
            p = params(inner)
            out = []
            for i in range(1, 20):
                link, nm = p.get(f'link{i}', '').strip(), strip_markup(p.get(f'name{i}', ''))
                if not link:
                    continue
                link = link.replace(' ', '_')
                if link.startswith(main + '/') and not STAGE_PAGE_SKIP.search(link):
                    out.append((link, nm or link.rsplit('/', 1)[-1].replace('_', ' ')))
            if out:
                return out
    return []


def participants(wikitext: str) -> set[str]:
    """Equipos de la lista de participantes de la página (antes de que haya cruces)."""
    out = set()
    for m in re.finditer(r'\{\{\s*TeamCard\s*\|[^{}]*?\bteam\s*=\s*([^|}\n]+)', wikitext, re.I):
        out.add(m.group(1))
    for m in re.finditer(r'\{\{\s*(?:Opponent|TeamOpponent)\s*\|\s*(?:type\s*=\s*team\s*\|\s*)?([^|}=\n]+)', wikitext, re.I):
        out.add(m.group(1))
    names = {team_name(x.strip()) for x in out}
    return {t for t in names if t and t != 'TBD'}


SWISS_HINT = re.compile(r'swiss|stage|opening|elimination|challengers|legends|champions stage', re.I)


def build_major(cfg: dict, main_text: str, pages: dict[str, str], links: list[tuple[str, str]]) -> dict:
    """Fases y partidos de un Major a partir de su página principal y sus subpáginas."""
    stages, matches = [], []
    sources = [(cfg['page'], 'Principal', main_text)] + [(lk, nm, pages.get(lk)) for lk, nm in links]
    n_list = 0
    for page, name, text in sources:
        if not text and page == cfg['page']:
            continue
        lists, brackets = scan_page(text or '')
        if lists:
            swiss = bool(re.search(r'swiss', text, re.I)) or (bool(SWISS_HINT.search(name)) and not re.search(r'group', name, re.I))
            n_list += 1
            sid = f's{n_list}'
            nm = name if name != 'Principal' else ('Fase de grupos' if not swiss else 'Fase suiza')
            ms = list_matches(lists, sid, 'swiss' if swiss else 'groups')
            stages.append({'id': sid, 'name': nm, 'page': page, 'type': 'swiss' if swiss else 'groups', 'text': text})
            matches += ms
        if brackets:
            sid = f'b{len([s for s in stages if s["type"] == "bracket"]) + 1}'
            nm = name if (name != 'Principal' and not lists) else 'Playoffs'
            stages.append({'id': sid, 'name': nm, 'page': page, 'type': 'bracket', 'text': text})
            matches += bracket_matches(brackets, sid)
        if not lists and not brackets and page != cfg['page'] and SWISS_HINT.search(name):
            n_list += 1                                   # fase anunciada sin partidos todavía
            stages.append({'id': f's{n_list}', 'name': name, 'page': page, 'type': 'swiss' if not re.search(r'group', name, re.I) else 'groups', 'text': text})
        if not lists and not brackets and page != cfg['page'] and re.search(r'playoff', name, re.I):
            stages.append({'id': f'b{len([s for s in stages if s["type"] == "bracket"]) + 1}', 'name': name, 'page': page, 'type': 'bracket', 'text': text})
    # el último cuadro es «po» (lo que usa el Pick'em); se renombran los ids de los partidos
    brk = [s for s in stages if s['type'] == 'bracket']
    if brk:
        old = brk[-1]['id']; brk[-1]['id'] = 'po'
        for m in matches:
            if m['stage'] == old:
                m['stage'] = 'po'; m['id'] = 'po' + m['id'][len(old):]
    out_st = []
    for s in stages:
        own = [m for m in matches if m['stage'] == s['id']]
        teams = {t for m in own for t in (m['t1'], m['t2']) if t != 'TBD'}
        if s['type'] == 'swiss' and len(teams) < 16 and s['text']:
            extra = participants(s['text'])
            if len(teams | extra) <= 16:
                teams |= extra
        out_st.append({'id': s['id'], 'name': s['name'], 'page': s['page'], 'type': s['type'], 'teams': sorted(teams), 'matches': len(own)})
    matches.sort(key=lambda m: (m['date'] or '9999', m['id']))
    return {'stages': out_st, 'matches': matches}


def final_of(data: dict):
    fin = [m for m in data.get('matches', []) if m['stage'] == 'po' and m.get('kind') == 'final']
    return fin[0] if fin else None


# ---------------------------------------------------------------- Liquipedia
class Live:
    def __init__(self):
        self.calls = 0

    def _get(self, q: dict):
        if self.calls:
            time.sleep(WAIT)
        self.calls += 1
        url = f'{API}?{urllib.parse.urlencode({**q, "format": "json", "formatversion": "2"})}'
        req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, 'Accept-Encoding': 'gzip'})
        with urllib.request.urlopen(req, timeout=40) as r:
            raw = r.read()
            if r.headers.get('Content-Encoding') == 'gzip':
                raw = gzip.decompress(raw)
        return json.loads(raw)

    def pages(self, titles: list[str]) -> dict[str, str]:
        out = {}
        for i in range(0, len(titles), 40):
            data = self._get({'action': 'query', 'prop': 'revisions', 'rvprop': 'content', 'rvslots': 'main', 'redirects': '1', 'titles': '|'.join(titles[i:i + 40])})
            q = data.get('query', {})
            back = {}
            for x in q.get('normalized', []) + q.get('redirects', []):
                back[x['to']] = back.get(x['from'], x['from'])
            for page in q.get('pages', []):
                if page.get('missing'):
                    continue
                t = page['title']
                rev = (page.get('revisions') or [{}])[0]
                text = rev.get('slots', {}).get('main', {}).get('content') or rev.get('content') or ''
                out[t.replace(' ', '_')] = text
                if t in back:
                    out[back[t].replace(' ', '_')] = text
        return out

    def search(self, text: str) -> list[str]:
        data = self._get({'action': 'query', 'list': 'search', 'srsearch': text, 'srnamespace': '0', 'srlimit': '8'})
        return [x['title'].replace(' ', '_') for x in data.get('query', {}).get('search', [])]

    def subpages(self, main: str) -> list[str]:
        data = self._get({'action': 'query', 'list': 'allpages', 'apprefix': main.replace('_', ' ') + '/', 'aplimit': '50'})
        return [x['title'].replace(' ', '_') for x in data.get('query', {}).get('allpages', [])]

    def parse(self, text: str) -> str:
        """HTML de un trozo de wikitext (una sola consulta; Liquipedia pide no más de una cada 30 s)."""
        if self.calls:
            time.sleep(max(WAIT, 30 - (time.time() - self.last_parse)) if getattr(self, 'last_parse', 0) else WAIT)
        self.calls += 1
        body = urllib.parse.urlencode({'action': 'parse', 'text': text, 'contentmodel': 'wikitext', 'prop': 'text',
                                       'disablelimitreport': '1', 'format': 'json', 'formatversion': '2'}).encode()
        req = urllib.request.Request(API, data=body, headers={'User-Agent': USER_AGENT, 'Accept-Encoding': 'gzip',
                                                               'Content-Type': 'application/x-www-form-urlencoded'})
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            if r.headers.get('Content-Encoding') == 'gzip':
                raw = gzip.decompress(raw)
        self.last_parse = time.time()
        return json.loads(raw).get('parse', {}).get('text', '')

    def download(self, url: str) -> bytes:
        time.sleep(1.5)
        req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
        with urllib.request.urlopen(req, timeout=40) as r:
            return r.read()


class Offline:
    """Lee páginas de una carpeta (para probar sin conexión)."""
    def __init__(self, folder: str):
        self.dir = Path(folder); self.calls = 0
        sj = self.dir / 'search.json'
        self.searches = json.loads(sj.read_text('utf-8')) if sj.exists() else {}

    def _file(self, t):
        return self.dir / (t.replace('/', '__') + '.wiki')

    def pages(self, titles):
        self.calls += 1
        return {t: self._file(t).read_text('utf-8') for t in titles if self._file(t).exists()}

    def search(self, text):
        self.calls += 1
        return self.searches.get(text, [])

    def subpages(self, main):
        self.calls += 1
        pre = main.replace('/', '__') + '__'
        return sorted(f.stem.replace('__', '/') for f in self.dir.glob(pre + '*.wiki'))

    def parse(self, text):
        """Imita la respuesta de Liquipedia para {{TeamIcon|x}}: un logo claro y otro oscuro por equipo conocido."""
        self.calls += 1
        def one(m):
            k = m.group(1)
            if k.startswith('zz'):
                return '<span class="team-template-team-icon"><a href="/counterstrike/Template:TeamIcon/' + k + '" class="new">Template:TeamIcon/' + k + '</a></span>'
            f = k.replace(' ', '_').title()
            return (f'<span class="team-template-team-icon team-template-lightmode"><span class="team-template-image-icon"><a href="/counterstrike/{f}">'
                    f'<img alt="" src="/commons/images/thumb/a/ab/{f}_lightmode.png/50px-{f}_lightmode.png" srcset="/commons/images/thumb/a/ab/{f}_lightmode.png/100px-{f}_lightmode.png 2x" width="50" height="50"></a></span></span>'
                    f'<span class="team-template-team-icon team-template-darkmode"><span class="team-template-image-icon"><a href="/counterstrike/{f}">'
                    f'<img alt="" src="/commons/images/thumb/c/cd/{f}_darkmode.png/50px-{f}_darkmode.png" width="50" height="50"></a></span></span>')
        return re.sub(r'\{\{TeamIcon\|([^}]+)\}\}', one, text)

    def download(self, url):
        return b'\x89PNG\r\n\x1a\n' + url.encode()


# ---------------------------------------------------------------- proceso
PICKEM_IDS = {c['id'] for c in MAJORS[[c['id'] for c in MAJORS].index(PICKEM_FROM):]} if PICKEM_FROM in [c['id'] for c in MAJORS] else set()


def today() -> date:
    return datetime.now(timezone.utc).date()


def status_of(cfg: dict) -> str:
    t = today()
    if date.fromisoformat(cfg['end']) < t:
        return 'done'
    return 'live' if date.fromisoformat(cfg['start']) <= t else 'upcoming'


def current_id() -> str:
    """El Major del Pick'em: el primero (desde PICKEM_FROM) que no terminó hace más de 7 días."""
    ids = [c['id'] for c in MAJORS]
    pool = MAJORS[ids.index(PICKEM_FROM):] if PICKEM_FROM in ids else MAJORS
    for c in pool:
        if date.fromisoformat(c['end']) + timedelta(days=7) >= today():
            return c['id']
    return pool[-1]['id']


def resolve_page(src, cfg: dict, known: str) -> tuple[str, str]:
    """Busca la página principal del Major. Devuelve (página, texto)."""
    tries = [x for x in (cfg.get('page'), known) if x]
    for t in tries:
        got = src.pages([t])
        if got.get(t) and 'nfobox' in got[t]:
            return t, got[t]
    found = src.search(cfg['search'])
    cands = []
    for t in found:
        parts = t.split('/')
        for i in range(len(parts), 0, -1):               # la página y sus «padres»
            c = '/'.join(parts[:i])
            if c not in cands:
                cands.append(c)
    if cands:
        got = src.pages(cands[:30])
        year = cfg['start'][:4]
        ok = [c for c in cands[:30] if 'nfobox league' in got.get(c, '') and year in got[c]
              and re.search(r'tier\s*=\s*1\b|major', got[c], re.I)]
        if ok:
            best = ok[0]
            while best.rsplit('/', 1)[0] in ok and '/' in best:   # mejor la página principal que una fase
                best = best.rsplit('/', 1)[0]
            return best, got[best]
    return '', ''


def process(src, cfg: dict, prev: dict, prev_index: dict) -> dict | None:
    """Lee un Major de Liquipedia. Devuelve el detalle (o None si no se pudo)."""
    known = prev_index.get('page', '')
    page, text = resolve_page(src, cfg, known)
    if not page:
        raise RuntimeError(f"no encuentro su página en Liquipedia (busqué «{cfg['search']}»)")
    cfg = {**cfg, 'page': page}
    links = stage_links(text, page)
    if not links:
        subs = [s for s in src.subpages(page) if s.count('/') == page.count('/') + 1 and not STAGE_PAGE_SKIP.search(s)]
        links = [(s, s.rsplit('/', 1)[-1].replace('_', ' ')) for s in subs]
    pages = src.pages([lk for lk, _ in links]) if links else {}
    data = build_major(cfg, text, pages, links)
    data['info'] = infobox(text)
    data['page'] = page
    data['links'] = links
    return data


def summary(cfg: dict, data: dict | None, prev: dict) -> dict:
    info = (data or {}).get('info') or prev.get('info') or {}
    fin = final_of(data) if data else None
    champ, runner, score = cfg['champion'], cfg['runnerup'], cfg['final']
    if not data and prev.get('loaded') and prev.get('champion'):
        champ, runner, score = prev['champion'], prev['runnerup'], prev['final']
    if fin and fin['done']:
        w = fin['t1'] if fin['winner'] == 1 else fin['t2']
        l = fin['t2'] if fin['winner'] == 1 else fin['t1']
        champ, runner, score = w, l, f"{max(fin['s1'], fin['s2'])}-{min(fin['s1'], fin['s2'])}"
    teams = sorted({t for s in (data or {}).get('stages', []) for t in s['teams']})
    st = status_of(cfg)
    return {
        'id': cfg['id'], 'name': cfg['name'], 'city': cfg['city'], 'country': cfg['country'], 'organizer': cfg['organizer'],
        'start': cfg['start'], 'end': cfg['end'], 'year': int(cfg['start'][:4]), 'game': cfg['game'],
        'status': st, 'champion': champ if st == 'done' or (fin and fin['done']) else '', 'runnerup': runner if st == 'done' or (fin and fin['done']) else '',
        'final': score if st == 'done' or (fin and fin['done']) else '', 'mvp': cfg['mvp'],
        'prize': info.get('prize') or prev.get('prize'), 'venue': info.get('venue') or prev.get('venue') or '',
        'teams': info.get('teams') or len(teams) or prev.get('teams') or None,
        'page': (data or {}).get('page') or prev.get('page') or cfg.get('page') or '',
        'pickem': cfg['id'] in PICKEM_IDS,
        'loaded': bool(data and data.get('matches')) or prev.get('loaded', False),
        'frozen': prev.get('frozen', False),
        'checked': prev.get('checked'),
    }


def slug(name: str) -> str:
    s = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
    return s or 'equipo'


def team_logos(html: str, keys: list[str]) -> dict[int, dict]:
    """Del HTML de <span data-k="i">{{TeamIcon|plantilla}}</span>… saca los logos claro y oscuro de cada equipo."""
    out = {}
    parts = re.split(r'<span[^>]*\bdata-k="(\d+)"[^>]*>', html)
    for i in range(1, len(parts) - 1, 2):
        k, chunk = int(parts[i]), parts[i + 1]
        found = {}
        for m in re.finditer(r'<span[^>]*class="([^"]*)"[^>]*>(?:(?!</span>).)*?<img([^>]*)>', chunk, re.S):
            cls, img = m.group(1), m.group(2)
            src = re.search(r'\bsrc="([^"]+)"', img)
            if not src:
                continue
            best = src.group(1)
            ss = re.search(r'\bsrcset="([^"]+)"', img)
            if ss:
                cands = [c.strip().split(' ')[0] for c in ss.group(1).split(',') if c.strip()]
                if cands:
                    best = cands[-1]
            if re.search(r'filler|logo_?tbd|/tbd|default', best, re.I):
                continue
            mode = 'dark' if 'darkmode' in cls else 'light'
            found.setdefault(mode, best if best.startswith('http') else 'https://liquipedia.net' + best)
        if found:
            out[k] = found
    return out


def update_logos(src, teams_seen: set[str], log_only: bool = False):
    """Descarga los logos de los equipos que aún no tienen (en tandas, sin pasarse con Liquipedia)."""
    db = json.loads(TEAMS_JSON.read_text('utf-8')) if TEAMS_JSON.exists() else {}
    teams = db.get('teams', {})
    for t, tpl in TEAM_TPL.items():
        teams.setdefault(t, {})['tpl'] = tpl
    for t in teams_seen:
        teams.setdefault(t, {})
    if RETRY_LOGOS:                                  # reintentar los que fallaron (y volver a bajar todos si se pide)
        for v in teams.values():
            v['tries'] = 0
            if RETRY_LOGOS == 'todos':
                v.pop('logo', None); v.pop('dark', None)
    todo = [t for t, v in teams.items() if not v.get('logo') and v.get('tries', 0) < 3 and t and t != 'TBD']
    found = {}
    for i in range(0, min(len(todo), LOGO_BATCH * 2), LOGO_BATCH):
        batch = todo[i:i + LOGO_BATCH]
        keys = [teams[t].get('tpl') or t.lower() for t in batch]
        text = ''.join(f'<span class="clutch-t" data-k="{n}">{{{{TeamIcon|{k}}}}}</span>' for n, k in enumerate(keys))
        try:
            html = src.parse(text)
        except Exception as e:  # noqa: BLE001
            log(f'  ! logos: Liquipedia no responde ({e})')
            break
        res = team_logos(html, keys)
        for n, t in enumerate(batch):
            if n in res:
                found[t] = res[n]
            else:
                teams[t]['tries'] = teams[t].get('tries', 0) + 1
    downloads = 0
    LOGOS.mkdir(parents=True, exist_ok=True)
    for t, urls in found.items():
        if downloads >= LOGO_DOWNLOADS:
            break
        for mode in ('light', 'dark'):
            url = urls.get(mode)
            if not url:
                continue
            m_ext = re.search(r'\.(png|svg|jpe?g|webp|gif)$', url.split('?')[0].rsplit('/', 1)[-1], re.I)
            ext = m_ext.group(1).lower().replace('jpeg', 'jpg') if m_ext else 'png'
            path = LOGOS / f"{slug(t)}{'-dark' if mode == 'dark' else ''}.{ext}"
            try:
                path.write_bytes(src.download(url))
                downloads += 1
                teams[t]['logo' if mode == 'light' else 'dark'] = f'img/teams/{path.name}'
            except Exception as e:  # noqa: BLE001
                log(f'  ! logo de {t}: {e}')
    db = {'source': 'Liquipedia · los logos son marcas de sus equipos', 'teams': dict(sorted(teams.items()))}
    write_json(TEAMS_JSON, db)
    have = sum(1 for v in teams.values() if v.get('logo'))
    log(f'Logos: {have}/{len(teams)} equipos con logo ({downloads} imágenes nuevas)')


def write_json(path: Path, obj) -> bool:
    text = json.dumps(obj, ensure_ascii=False, indent=1) + '\n'
    if path.exists():
        old = json.loads(path.read_text('utf-8'))
        strip = lambda o: {k: v for k, v in o.items() if k != 'checked'} if isinstance(o, dict) else o
        if strip(old) == strip(obj):
            return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, 'utf-8')
    return True


def main(argv: list[str]) -> int:
    offline = argv[argv.index('--offline') + 1] if '--offline' in argv else None
    force = {x.strip() for x in argv[argv.index('--force') + 1].split(',') if x.strip()} if '--force' in argv else set()
    if force & {'todos', 'all'}:
        force = {c['id'] for c in MAJORS if status_of(c) != 'upcoming'}
    src = Offline(offline) if offline else Live()
    OUT.mkdir(parents=True, exist_ok=True)
    idx_path = OUT / 'index.json'
    old_index = json.loads(idx_path.read_text('utf-8')) if idx_path.exists() else {}
    old_by = {m['id']: m for m in old_index.get('majors', [])}
    cur = current_id()
    now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    backfill = 0
    out, errors = [], []
    # orden: primero el actual, después los pendientes del más reciente al más antiguo
    # (los que menos intentos fallidos llevan antes, para que uno roto no frene a los demás)
    rest = [c for c in reversed(MAJORS) if c['id'] != cur]
    order = [c for c in MAJORS if c['id'] == cur] + sorted(rest, key=lambda c: old_by.get(c['id'], {}).get('tries', 0))
    results = {}
    for cfg in order:
        prev = old_by.get(cfg['id'], {})
        dpath = OUT / f"{cfg['id']}.json"
        detail_prev = json.loads(dpath.read_text('utf-8')) if dpath.exists() else {}
        st = status_of(cfg)
        is_cur = cfg['id'] == cur
        if is_cur or cfg['id'] in force:
            need = True
        elif st == 'upcoming' or prev.get('frozen') or prev.get('tries', 0) >= 3:
            need = False                                  # congelado, futuro o sin página tras 3 intentos
        elif backfill < BACKFILL:
            need = True; backfill += 1
        else:
            need = False
        data, err = None, ''
        if need:
            try:
                data = process(src, cfg, detail_prev, prev)
            except Exception as e:  # noqa: BLE001
                err = f"{cfg['name']}: {e}"
                errors.append(err)
                log('  !', err)
        if data:
            fin = final_of(data)
            frozen = st == 'done' and bool(fin and fin['done']) and date.fromisoformat(cfg['end']) + timedelta(days=3) < today()
            if not data['matches'] and detail_prev.get('matches'):
                data = {**data, 'stages': detail_prev['stages'], 'matches': detail_prev['matches']}   # se conserva lo último bueno
            detail = {
                'event': {'id': cfg['id'], 'name': cfg['name'], 'page': data['page'], 'city': cfg['city'], 'country': cfg['country']},
                'source': 'Liquipedia (CC-BY-SA 3.0)', 'stages': data['stages'], 'matches': data['matches'],
                'checked': now, 'errors': [],
            }
            write_json(dpath, detail)
            s = summary(cfg, data, prev)
            s['frozen'] = frozen
            s['checked'] = now
            s['loaded'] = bool(data['matches'])
            log(f"{cfg['id']}: {len(data['matches'])} partidos · {data['page']}{' · congelado' if frozen else ''}")
        else:
            if is_cur and not dpath.exists():          # el Major del Pick'em siempre tiene fichero
                write_json(dpath, {'event': {'id': cfg['id'], 'name': cfg['name'], 'page': cfg.get('page', ''), 'city': cfg['city'], 'country': cfg['country']},
                                   'source': 'Liquipedia (CC-BY-SA 3.0)', 'stages': [], 'matches': [], 'checked': now,
                                   'errors': [err or 'Todavía no se ha descargado nada de Liquipedia.']})
            elif is_cur and err:
                d = json.loads(dpath.read_text('utf-8')); d['errors'] = [err]; d['checked'] = now; write_json(dpath, d)
            s = summary(cfg, None, prev)
            s['error'] = (err or prev.get('error', '')) if not s['loaded'] else ''
            s['tries'] = prev.get('tries', 0) + (1 if err and not s['loaded'] else 0)
        results[cfg['id']] = s
    index = {'current': cur, 'source': 'Liquipedia (CC-BY-SA 3.0)', 'checked': now, 'calls': src.calls,
             'majors': [results[c['id']] for c in MAJORS], 'errors': errors}
    write_json(idx_path, index)
    seen = set()
    for f in OUT.glob('*.json'):
        if f.name == 'index.json':
            continue
        for st in json.loads(f.read_text('utf-8')).get('stages', []):
            seen.update(st.get('teams', []))
    seen.update(m['champion'] for m in index['majors'] if m['champion'])
    seen.update(m['runnerup'] for m in index['majors'] if m['runnerup'])
    global RETRY_LOGOS
    if '--logos' in argv:
        RETRY_LOGOS = argv[argv.index('--logos') + 1].strip().lower()
        if RETRY_LOGOS not in ('faltan', 'todos'):
            RETRY_LOGOS = ''
    if '--no-logos' not in argv:
        update_logos(src, seen)
    log(f'Hecho: {src.calls} consultas a Liquipedia · Pick\'em: {cur} · {sum(1 for m in index["majors"] if m["loaded"])}/{len(MAJORS)} Majors con datos')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
