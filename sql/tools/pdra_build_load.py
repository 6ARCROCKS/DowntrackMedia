"""Build the PDRA load file (events, racers, races, entries, runs) from the verified sheet readings.
Usage: pdra_build_load.py <work dir with out6/ qual/ kinds.json status.json all/> <out json>"""
import json, glob, re, os, sys, collections, datetime
W, OUT = sys.argv[1], sys.argv[2]
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
K = json.load(open(f'{W}/kinds.json')); S = json.load(open(f'{W}/status.json'))
LOAD = {'list: verified': 'final', 'list: verified, stops before the final': 'partial'}

CLASS = {  # post label -> (slug, code, name, kind, uses_dial, index_et)
 'PN': 'pn', 'PRO NITROUS': 'pn', 'PB': 'pb', 'PRO BOOST': 'pb', 'PS': 'ps', 'PRO STREET': 'ps',
 'PRO 632': 'p632', '632': 'p632', 'OUTLAW 632': 'p632', 'PRO OUTLAW 632': 'p632', 'SS': 'ss',
 'XPS': 'xps', 'PNM': 'pnm', 'PXM': 'pnm', 'PN MOTORCYCLE': 'pnm', 'OUTLAW 10.5': 'ol105',
 'ELITE TS': 'ets', 'T/S ELITE': 'ets', 'ELITE T/S': 'ets', 'E/TS': 'ets', 'ELITE TOP SPORTSMAN': 'ets',
 'TS': 'ts', 'T/S REGULAR': 'ts', 'T/S': 'ts', 'TOP SPORTSMAN': 'ts',
 'ELITE TD': 'etd', 'T/D ELITE': 'etd', 'ELITE T/D': 'etd', 'E/TD': 'etd', 'ELITE TOP DRAGSTER': 'etd',
 'TD': 'td', 'T/D REGULAR': 'td', 'T/D': 'td', 'TOP DRAGSTER': 'td',
 'PJD': 'pjd', 'PRO JR DRAGSTER': 'pjd', 'TJD': 'tjd', 'TOP JR DRAGSTER': 'tjd', 'BB': 'bb', 'BRACKET BASH': 'bb'}
CATS = {  # code: (id, slug, short code, name, kind, uses_dial, index_et)
 'pn': (101, 'pdra-pro-nitrous', 'PN', 'Pro Nitrous', 'pro', False, None),
 'pb': (102, 'pdra-pro-boost', 'PB', 'Pro Boost', 'pro', False, None),
 'ps': (103, 'pdra-pro-street', 'PS', 'Pro Street', 'pro', False, None),
 'p632': (104, 'pdra-pro-632', 'P632', 'Pro 632', 'pro', False, None),
 'xps': (105, 'pdra-extreme-pro-stock', 'XPS', 'Extreme Pro Stock', 'pro', False, None),
 'pnm': (106, 'pdra-pro-nitrous-motorcycle', 'PNM', 'Pro Nitrous Motorcycle', 'pro', False, None),
 'ss': (107, 'pdra-super-street', 'SS', 'Super Street', 'pro', False, None),
 'ol105': (108, 'pdra-outlaw-10-5', 'OL105', 'Outlaw 10.5', 'pro', False, None),
 'ets': (111, 'pdra-elite-top-sportsman', 'ETS', 'Elite Top Sportsman', 'sportsman', True, None),
 'ts': (112, 'pdra-top-sportsman', 'TS', 'Top Sportsman', 'sportsman', True, None),
 'etd': (113, 'pdra-elite-top-dragster', 'ETD', 'Elite Top Dragster', 'sportsman', True, None),
 'td': (114, 'pdra-top-dragster', 'TD', 'Top Dragster', 'sportsman', True, None),
 'pjd': (115, 'pdra-pro-jr-dragster', 'PJD', 'Pro Jr. Dragster', 'sportsman', True, 7.90),
 'tjd': (116, 'pdra-top-jr-dragster', 'TJD', 'Top Jr. Dragster', 'sportsman', True, None),
 'bb': (120, 'pdra-bracket-bash', 'BB', 'Bracket Bash', 'bracket', True, None)}
VENUE = [(r'GALOT|BENSON', 'GALOT Motorsports Park', 'Benson', 'NC'), (r'VMP', 'Virginia Motorsports Park', 'Dinwiddie', 'VA'),
         (r'MDIR|MIR', 'Maryland International Raceway', 'Mechanicsville', 'MD'), (r'DARL', 'Darlington Dragway', 'Hartsville', 'SC'),
         (r'SGMP', 'South Georgia Motorsports Park', 'Adel', 'GA'), (r'NORWALK', 'Summit Racing Equipment Motorsports Park', 'Norwalk', 'OH'),
         (r'\bKY\b', 'Beech Bend Raceway Park', 'Bowling Green', 'KY'), (r'Maple Grove|\bMG\b', 'Maple Grove Raceway', 'Mohnton', 'PA'),
         (r'\bMI\b', 'US 131 Motorsports Park', 'Martin', 'MI'), (r'BRISTOL|\bBD\b', 'Bristol Dragway', 'Bristol', 'TN')]
MON = {m: i + 1 for i, m in enumerate('JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split())}

def nk(s): return re.sub(r'[^a-z]', '', (s or '').lower())
JUNK = {'PN', 'PB', 'PS', 'XPS', 'PNM', 'PXM', 'SS', 'TS', 'TD', 'ETS', 'ETD', 'PJD', 'TJD', 'BB', 'OL', 'P', 'PID', 'TID'}
def clean_name(s):
    s = re.sub(r'\s+', ' ', re.sub(r"[^A-Za-z'’.\- ]", ' ', s or '')).strip(" .-'’")
    t = s.split(' ')
    while len(t) > 2 and (t[0].upper() in JUNK or (t[0].islower() and len(t[0]) <= 3) or len(t[0]) == 1 and not t[0].isupper()): t = t[1:]
    while len(t) > 2 and len(t[-1]) == 1 and t[-1].islower(): t = t[:-1]
    if t and re.fullmatch(r'[Il1]{3}', t[-1]): t[-1] = 'III'
    elif t and re.fullmatch(r'[Il1]{2}', t[-1]): t[-1] = 'II'
    s = ' '.join(t)
    return s if len(t) >= 2 else ''        # a lone word is a fragment, not a name; the car number ties the entry to its racer

def ed(a, b, cap=2):
    if abs(len(a) - len(b)) > cap: return cap + 1
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1): cur.append(min(prev[j] + 1, cur[-1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]

pages = []
for f in glob.glob(f'{W}/out6/*.json'):
    r = json.load(open(f)); st = S.get(str(r['id']))
    if st not in LOAD: continue
    parts = [p.strip() for p in re.split(r'\s[–-]\s', r['title'])]
    if len(parts) < 2 or parts[-1].upper() not in CLASS: continue
    r['cls'] = CLASS[parts[-1].upper()]; r['ev'] = ' – '.join(parts[:-1]); r['race_status'] = LOAD[st]
    pages.append(r)

# ---- events: name and elimination date from the top of a list sheet
import pytesseract
from PIL import Image
cache_f = f'{W}/event_tops.json'; tops = json.load(open(cache_f)) if os.path.exists(cache_f) else {}
events = {}
for r in pages: events.setdefault(r['ev'], []).append(r)
for ev, rs in events.items():
    if ev in tops: continue
    got = []
    for r in rs[:4]:
        f = next((x for x in r['elim'] if os.path.exists(f'{W}/all/{x}')), None)
        if not f: continue
        im = Image.open(f'{W}/all/{f}').convert('L'); w, h = im.size
        if w < 1300: im = im.resize((int(w * 1900 / w), int(h * 1900 / w)))
        t = pytesseract.image_to_string(im.crop((0, 0, im.size[0], int(im.size[1] * 0.13))), config='--psm 6')
        got.append(t)
    tops[ev] = got; json.dump(tops, open(cache_f, 'w'))
NAMES = [  # event names as printed on the sheets (label pattern -> name); venue override where the label has no track code
 (r'World Finals|VMP.*FINALS|Finals VMP|VMP Finals', 'PDRA World Finals', 'VMP'), (r'PRO\s*STARS', 'PDRA ProStars', 'VMP'),
 (r'ECN|GALOT1|Race 1 – GALOT', 'PDRA East Coast Nationals', None), (r'DRAG\s*WARS|GALOT – OCT|Race 7 – GALOT', 'PDRA DragWars', None),
 (r'N-vs-S|MIR|MDIR', 'PDRA North vs. South Shootout', None), (r'M-AS|MAS', 'PDRA Mid-Atlantic Showdown', None),
 (r'NORWALK|Ohio|– OH$', 'PDRA American Doorslammer Challenge', 'NORWALK'), (r'\bKY\b', 'PDRA Doorslammer Derby', None),
 (r'BRISTOL|\bBD\b', 'PDRA Thunder Valley Throwdown', None), (r'Maple Grove|\bMG\b', 'PDRA Northern Nationals', None),
 (r'2025 – MI', 'PDRA Northern Nationals', None), (r'2024 MI', 'PDRA at US 131 Motorsports Park', None),
 (r'2023 DARL', 'PDRA Carolina Nationals', None), (r'2020 – DARLINGTON', 'PDRA Carolina Showdown', None), (r'2019 – DARLINGTON', 'PDRA Fall Nationals', None),
 (r'2019 SGMP', 'PDRA Summer Nationals', None), (r'2022 – Race 5 – VMP', 'PDRA Summer Shootout', None),
 (r'2021 – Race 5 – VMP', 'PDRA at Virginia Motorsports Park (July)', None), (r'2020 – VMP AUG', 'PDRA at Virginia Motorsports Park (August)', None)]
EV = []
for ev, rs in sorted(events.items(), key=lambda x: min(r['date'] for r in x[1])):
    dates = collections.Counter(); names = collections.Counter()
    for t in tops.get(ev, []):
        for d, m, y in re.findall(r'(\d{1,2})\s*/\s*([A-Z]{3})\s*/\s*(\d{4})', t.upper()):
            if m in MON:
                try: dates[datetime.date(int(y), MON[m], int(d)).isoformat()] += 1
                except ValueError: pass
        for line in t.split('\n'):
            line = line.strip(' |_—-:;.,')
            if len(line) > 8 and not re.search(r'limination|CompuLink|StarTrak|DRIVER|\d{4}$', line) and re.search(r'[A-Za-z]{4}', line):
                names[re.sub(r'\s+', ' ', line)] += 1; break
    post = min(r['date'] for r in rs); season = int(post[:4])
    d = next((x for x, _ in dates.most_common() if x[:4] == str(season)), None)
    nm = names.most_common(1)[0][0] if names else None
    if not nm or len(nm) > 70: nm = 'PDRA ' + re.sub(r'^\d{4}\s*[–-]?\s*', '', ev)
    if not re.search(r'PDRA', nm, re.I): nm = 'PDRA ' + nm
    ov = next((x for x in NAMES if re.search(x[0], ev, re.I)), None)
    vkey = ev + (' ' + ov[2] if ov and ov[2] else '')
    if ov: nm = ov[1]
    v = next((x[1:] for x in VENUE if re.search(x[0], vkey)), None)
    slug = re.sub(r'[^a-z0-9]+', '-', ev.lower()).strip('-')
    EV.append(dict(key=slug, label=ev, season=season, name=nm, date=d or post, date_from_sheet=bool(d), venue=v,
                   url='https://racepdra.com/results/'))
evkey = {e['label']: e['key'] for e in EV}

# ---- racers: cluster names (OCR noise) using shared car numbers / hometowns
occ = collections.defaultdict(lambda: dict(names=collections.Counter(), homes=collections.Counter(), cars=set(), n=0))
for r in pages:
    for rd in r['rounds']:
        for p in rd:
            for x in p:
                x['nm'] = clean_name(x.get('driver')); k = nk(x['nm'])
                if len(k) < 5: x['dk'] = None; continue
                o = occ[k]; o['names'][x['nm']] += 1; o['n'] += 1; o['cars'].add((r['cls'][-2:], x['car']))
                if x.get('home'): o['homes'][re.sub(r'\s+', ' ', x['home']).strip()] += 1
                x['dk'] = k
keys = sorted(occ, key=lambda k: -occ[k]['n']); rep = {}
bylen = collections.defaultdict(list)
for k in keys:
    best = None
    for L in range(len(k) - 2, len(k) + 3):
        for c in bylen[L]:
            lim = 1 if len(k) < 9 else 2
            if c[0] != k[0] and c[-1] != k[-1]: continue
            if ed(c, k, lim) <= lim and (occ[c]['cars'] & occ[k]['cars'] or (set(nk(h) for h in occ[c]['homes']) & set(nk(h) for h in occ[k]['homes']))):
                best = c; break
        if best: break
    rep[k] = rep.get(best, best) if best else k
    if not best: bylen[len(k)].append(k)
DR = {}
for k in keys:
    c = rep[k]; d = DR.setdefault(c, dict(names=collections.Counter(), homes=collections.Counter()))
    d['names'].update(occ[k]['names']); d['homes'].update(occ[k]['homes'])
drivers = []
for c, d in DR.items():
    nm = d['names'].most_common(1)[0][0]; hm = d['homes'].most_common(1)[0][0] if d['homes'] else None
    if hm: hm = re.sub(r'\s+([A-Z]{2,3})$', r', \1', hm)
    drivers.append([c, nm, hm])

# ---- races, entries, runs
def qual_map(r, cars):
    m = {}
    for f in r['files']:
        if K.get(f, [''])[0] != 'qual': continue
        p = f'{W}/qual/{f}.json'
        if os.path.exists(p):
            for row in json.load(open(p)).get('rows', []): m.setdefault(row['car'], row['pos'])
    hit = sum(1 for c in cars if c in m)
    return m if cars and hit >= 0.6 * len(cars) else {}
def rng(v, lo, hi): return v if v is not None and lo <= abs(v) <= hi else None
races = []; entries = []; runs = []
for r in sorted(pages, key=lambda r: (r['date'], r['id'])):
    cat = CATS[r['cls']]; dial_cls = cat[5]; ri = len(races)
    cars = collections.OrderedDict()
    for n, rd in enumerate(r['rounds'], 1):
        for p in rd:
            for x in p:
                e = cars.setdefault(x['car'], dict(car=x['car'], dk=collections.Counter(), last=n, won_last=False))
                if x['dk']: e['dk'][rep[x['dk']]] += 1
                e['last'] = n
    qm = qual_map(r, list(cars))
    final = r['rounds'][-1][0] if r['race_status'] == 'final' and len(r['rounds'][-1]) == 1 else None
    eidx = {}
    for c, e in cars.items():
        eidx[c] = len(entries)
        dk = e['dk'].most_common(1)[0][0] if e['dk'] else None
        entries.append([ri, dk, c, qm.get(c), bool(final and final[0]['car'] == c), bool(final and len(final) > 1 and final[1]['car'] == c), 'E%d' % e['last']])
    for n, rd in enumerate(r['rounds'], 1):
        for pn, p in enumerate(rd, 1):
            for slot, x in enumerate(p, 1):
                note = x.get('note', ''); bad = x.get('flag') == 'unreadable numbers'
                rt = None if bad else rng(x.get('rt'), 0, 9.999); et = None if bad else rng(x.get('et'), 3.3, 25)
                mph = None if bad else rng(x.get('mph'), 20, 265); dial = None if bad or not dial_cls else rng(x.get('dial'), 3.3, 20)
                if dial_cls and dial is None and cat[6]: dial = cat[6]
                red = True if ('foul' in note or (rt is not None and rt < 0)) else (False if rt is not None else None)
                brk = bool(dial_cls and et is not None and dial is not None and et < dial and not red) if (dial_cls and et is not None and dial is not None) else None
                runs.append([ri, n, pn, slot if len(p) > 1 else 0, eidx[x['car']], rt, dial, et, mph, slot == 1, red, brk,
                             ' '.join(filter(None, [note, x.get('flag') or ''])) or None])
    races.append([evkey[r['ev']], cat[1], r['race_status'], len(r['rounds'][0]) * 2 - sum(1 for p in r['rounds'][0] if len(p) == 1),
                  'https://racepdra.com/results/?p=%d' % r['id']])
out = dict(cats=[list(v) for v in CATS.values()], events=EV, drivers=drivers, races=races, entries=entries, runs=runs)
json.dump(out, open(OUT, 'w'), separators=(',', ':'))
print('events', len(EV), 'with sheet date', sum(e['date_from_sheet'] for e in EV), 'racers', len(drivers), 'name variants merged', len(keys) - len(DR),
      'races', len(races), 'entries', len(entries), 'runs', len(runs), 'bytes', os.path.getsize(OUT))
for e in EV[:60]: print(' ', e['date'], '*' if e['date_from_sheet'] else '?', e['name'][:55].ljust(56), (e['venue'] or ['-'])[0][:28], '|', e['label'])
