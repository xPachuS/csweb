#!/usr/bin/env python3
"""Descarga de Liquipedia los partidos del Major y los guarda en data/major.json.

Se ejecuta desde GitHub Actions cada 10 minutos (.github/workflows/update.yml).
Hace UNA sola consulta a la API de Liquipedia por ejecución (las cuatro páginas de
fases a la vez), con un User-Agent que identifica el proyecto, como piden sus normas:
https://liquipedia.net/api-terms-of-use

Si Liquipedia no responde o cambia el formato, se conserva el último fichero bueno y
los partidos se pueden poner o corregir a mano desde el panel de administración.
"""
from __future__ import annotations

import gzip
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'major.json'

API = 'https://liquipedia.net/counterstrike/api.php'
EVENT = {'name': 'PGL Major Singapore 2026', 'page': 'PGL/2026/Singapore', 'city': 'Singapur'}
STAGES = [
    {'id': 's1', 'name': 'Stage 1', 'page': 'PGL/2026/Singapore/Stage_1', 'type': 'swiss'},
    {'id': 's2', 'name': 'Stage 2', 'page': 'PGL/2026/Singapore/Stage_2', 'type': 'swiss'},
    {'id': 's3', 'name': 'Stage 3', 'page': 'PGL/2026/Singapore/Stage_3', 'type': 'swiss'},
    {'id': 'po', 'name': 'Playoffs', 'page': 'PGL/2026/Singapore/Playoffs', 'type': 'bracket'},
]
REPO = os.environ.get('GITHUB_REPOSITORY', 'cs-pickem')
USER_AGENT = f'ClutchPickem/1.0 (fan site; https://github.com/{REPO})'

# Nombres «bonitos» de las plantillas de equipo de Liquipedia ({{TeamOpponent|vitality}})
TEAM_NAMES = {
    'vitality': 'Vitality', 'team vitality': 'Vitality', 'spirit': 'Team Spirit', 'team spirit': 'Team Spirit',
    'mouz': 'MOUZ', 'mousesports': 'MOUZ', 'falcons': 'Team Falcons', 'team falcons': 'Team Falcons',
    'the mongolz': 'The MongolZ', 'mongolz': 'The MongolZ', 'furia': 'FURIA', 'furia esports': 'FURIA',
    'natus vincere': 'Natus Vincere', 'navi': 'Natus Vincere', 'faze': 'FaZe Clan', 'faze clan': 'FaZe Clan',
    'g2': 'G2 Esports', 'g2 esports': 'G2 Esports', 'aurora': 'Aurora', 'aurora gaming': 'Aurora',
    '3dmax': '3DMAX', 'pain': 'paiN Gaming', 'pain gaming': 'paiN Gaming', 'legacy': 'Legacy',
    'astralis': 'Astralis', 'liquid': 'Team Liquid', 'team liquid': 'Team Liquid', 'mibr': 'MIBR',
    'heroic': 'HEROIC', 'nrg': 'NRG', 'nrg esports': 'NRG', 'virtus.pro': 'Virtus.pro', 'vp': 'Virtus.pro',
    'gamerlegion': 'GamerLegion', 'b8': 'B8', 'lynn vision': 'Lynn Vision', 'lynn vision gaming': 'Lynn Vision',
    'tyloo': 'TYLOO', 'betboom': 'BetBoom Team', 'betboom team': 'BetBoom Team', 'parivision': 'PARIVISION',
    'fnatic': 'Fnatic', 'complexity': 'Complexity', 'complexity gaming': 'Complexity', 'big': 'BIG',
    'ence': 'ENCE', 'eternal fire': 'Eternal Fire', 'cloud9': 'Cloud9', 'imperial': 'Imperial',
    'imperial esports': 'Imperial', 'wildcard': 'Wildcard', 'm80': 'M80', 'flyquest': 'FlyQuest',
    'rare atom': 'Rare Atom', 'ninjas in pyjamas': 'Ninjas in Pyjamas', 'nip': 'Ninjas in Pyjamas',
    'sangal': 'Sangal', 'monte': 'Monte', 'saw': 'SAW', 'red canids': 'RED Canids', 'fluxo': 'Fluxo',
    'og': 'OG', 'apeks': 'Apeks', 'nemiga': 'Nemiga', 'passion ua': 'Passion UA', 'bc.game': 'BC.Game',
    'gentle mates': 'Gentle Mates', 'nemesis': 'Nemesis', 'tsm': 'TSM',
}
TBD = {'', 'tbd', 'tba', 'bye', 'definitions'}
TZ = {'UTC': 0, 'GMT': 0, 'CET': 1, 'CEST': 2, 'EET': 2, 'EEST': 3, 'MSK': 3, 'SGT': 8, 'CST': 8, 'KST': 9,
      'JST': 9, 'EST': -5, 'EDT': -4, 'PST': -8, 'PDT': -7, 'BRT': -3, 'AEST': 10, 'AEDT': 11, 'WET': 0, 'WEST': 1}


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
            return {'team': team_name(team), 'score': p.get('score', '').strip()}
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


def parse_match(inner: str, stage: dict, mid: str, round_name: str, slot: str = ''):
    p = params(inner)
    o1, o2 = opponent(p.get('opponent1', '')), opponent(p.get('opponent2', ''))
    bo = to_int(p.get('bestof')) or (1 if stage['type'] == 'swiss' else 3)
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
        'id': mid, 'stage': stage['id'], 'round': round_name, 'slot': slot, 'bo': bo,
        'date': parse_date(p.get('date', '')), 't1': o1['team'], 't2': o2['team'],
        's1': s1, 's2': s2, 'winner': w if w in (1, 2) else 0, 'done': bool(w in (1, 2)),
        'maps': [m for m in maps if m['map'] or m['winner']],
    }


def round_label(title: str, fallback: str) -> str:
    t = strip_markup(title or '')
    t = re.sub(r'\s*Matches?\s*$', '', t, flags=re.I).strip()
    return t or fallback


BRACKET_ROUNDS = {1: 'Cuartos de final', 2: 'Semifinales', 3: 'Gran final'}


def parse_stage(wikitext: str, stage: dict) -> list[dict]:
    matches = []
    def walk(text: str, depth: int = 0):
        for name, inner in templates(text):
            low = name.lower()
            if low.startswith('matchlist') or low.startswith('singlematch'):
                p = params(inner)
                lid = re.sub(r'\W+', '', p.get('id', '')) or f'l{len(matches)}'
                rnd = round_label(p.get('title') or p.get('matchsection') or '', f'Ronda {len(matches) // 8 + 1}')
                for k in sorted((k for k in p if re.fullmatch(r'M\d+', k)), key=lambda k: int(k[1:])):
                    for n2, i2 in templates(p[k]):
                        if n2.lower() == 'match':
                            matches.append(parse_match(i2, stage, f'{stage["id"]}-{lid}-{k}', rnd))
            elif low.startswith('bracket'):
                p = params(inner)
                bid = re.sub(r'\W+', '', p.get('id', '')) or 'b'
                for k in (k for k in p if re.fullmatch(r'R\d+M\d+', k)):
                    r_ = int(re.match(r'R(\d+)', k).group(1))
                    header = strip_markup(p.get(f'{k}header', ''))
                    for n2, i2 in templates(p[k]):
                        if n2.lower() == 'match':
                            matches.append(parse_match(i2, stage, f'{stage["id"]}-{bid}-{k}', header or BRACKET_ROUNDS.get(r_, f'Ronda {r_}'), k))
            elif depth < 3 and low not in ('match', 'map'):
                walk(inner, depth + 1)       # plantillas que envuelven otras (tabs, cajas…)
    walk(wikitext)
    # Cuadro: la última ronda con dos partidos = final + tercer puesto (el de cabecera «3rd/Third» o el M2)
    if stage['type'] == 'bracket' and matches:
        last = max(int(re.match(r'R(\d+)', m['slot']).group(1)) for m in matches if m['slot'])
        lasts = [m for m in matches if m['slot'].startswith(f'R{last}M')]
        for m in lasts:
            third = re.search(r'3rd|third|tercer', m['round'], re.I) or (len(lasts) > 1 and m['slot'].endswith('M2'))
            m['round'] = 'Tercer puesto' if third else 'Gran final'
            m['kind'] = 'third' if third else 'final'
        rounds_ = sorted({int(re.match(r'R(\d+)', m['slot']).group(1)) for m in matches if m['slot']})
        names = {r: n for r, n in zip(rounds_, ['Cuartos de final', 'Semifinales', 'Gran final'][-len(rounds_):])}
        for m in matches:
            if m['slot'] and not m.get('kind'):
                r_ = int(re.match(r'R(\d+)', m['slot']).group(1))
                m['round'] = names.get(r_, m['round'])
                m['kind'] = {'Cuartos de final': 'qf', 'Semifinales': 'sf'}.get(m['round'], 'ko')
    return matches


# ---------------------------------------------------------------- descarga
def fetch_pages(titles: list[str]) -> dict[str, str]:
    q = urllib.parse.urlencode({
        'action': 'query', 'prop': 'revisions', 'rvprop': 'content', 'rvslots': 'main',
        'format': 'json', 'formatversion': '2', 'redirects': '1', 'titles': '|'.join(titles),
    })
    req = urllib.request.Request(f'{API}?{q}', headers={'User-Agent': USER_AGENT, 'Accept-Encoding': 'gzip'})
    with urllib.request.urlopen(req, timeout=40) as r:
        raw = r.read()
        if r.headers.get('Content-Encoding') == 'gzip':
            raw = gzip.decompress(raw)
    data = json.loads(raw)
    redirects = {x['to']: x['from'] for x in data.get('query', {}).get('redirects', [])}
    normalized = {x['to']: x['from'] for x in data.get('query', {}).get('normalized', [])}
    out = {}
    for page in data.get('query', {}).get('pages', []):
        if page.get('missing'):
            continue
        title = page['title']
        title = redirects.get(title, title)
        title = normalized.get(title, title)
        rev = (page.get('revisions') or [{}])[0]
        out[title.replace(' ', '_')] = rev.get('slots', {}).get('main', {}).get('content') or rev.get('content') or ''
    return out


def participants(wikitext: str) -> set[str]:
    """Equipos de la lista de participantes de la página (antes de que haya cruces)."""
    out = set()
    for m in re.finditer(r'\{\{\s*TeamCard\s*\|[^{}]*?\bteam\s*=\s*([^|}\n]+)', wikitext, re.I):
        out.add(m.group(1))
    for m in re.finditer(r'\{\{\s*(?:Opponent|TeamOpponent)\s*\|\s*(?:type\s*=\s*team\s*\|\s*)?([^|}=\n]+)', wikitext, re.I):
        out.add(m.group(1))
    names = {team_name(x.strip()) for x in out}
    return {t for t in names if t and t != 'TBD'}


def build(pages: dict[str, str], previous: dict) -> dict:
    stages_out, matches, errors = [], [], []
    old_by_stage = {}
    for m in previous.get('matches', []):
        old_by_stage.setdefault(m['stage'], []).append(m)
    for st in STAGES:
        text = pages.get(st['page'].replace(' ', '_'))
        found = []
        if text is None:
            errors.append(f"{st['name']}: la página {st['page']} todavía no existe en Liquipedia")
        else:
            try:
                found = parse_stage(text, st)
            except Exception as e:  # noqa: BLE001
                errors.append(f"{st['name']}: no se pudo leer ({e})")
        if not found and old_by_stage.get(st['id']):
            found = old_by_stage[st['id']]            # se conserva lo último bueno
        teams = {t for m in found for t in (m['t1'], m['t2']) if t != 'TBD'}
        if text and st['type'] == 'swiss' and len(teams) < 16:
            extra = participants(text)
            if len(teams | extra) <= 16:
                teams |= extra
        teams = sorted(teams)
        stages_out.append({**st, 'teams': teams, 'matches': len(found)})
        matches += found
    matches.sort(key=lambda m: (m['date'] or '9999', m['id']))
    return {
        'event': EVENT, 'source': 'Liquipedia (CC-BY-SA 3.0)', 'stages': stages_out, 'matches': matches,
        'checked': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'errors': errors,
    }


def main(argv: list[str]) -> int:
    previous = json.loads(OUT.read_text('utf-8')) if OUT.exists() else {}
    if len(argv) > 1:                                  # pruebas: python update_major.py fichero.wiki …
        pages = {}
        for path, st in zip(argv[1:], STAGES):
            pages[st['page']] = Path(path).read_text('utf-8')
    else:
        try:
            pages = fetch_pages([s['page'] for s in STAGES])
        except Exception as e:  # noqa: BLE001
            log(f'Liquipedia no responde: {e}. Se mantiene el fichero anterior.')
            return 0
    data = build(pages, previous)
    old = {k: v for k, v in previous.items() if k != 'checked'}
    new = {k: v for k, v in data.items() if k != 'checked'}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    if old != new or not OUT.exists():
        OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n', 'utf-8')
        log(f"Guardado: {len(data['matches'])} partidos · {sum(1 for m in data['matches'] if m['done'])} jugados")
    else:
        log('Sin cambios')
    for e in data['errors']:
        log('  -', e)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
