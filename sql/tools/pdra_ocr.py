"""Read a PDRA CompuLink StarTrak elimination sheet (list format) into rounds/pairs.

Uses Tesseract word boxes: words are assigned to columns by x position (taken from the header row),
rows are grouped by y, and rows are paired by the vertical gap between them (winner is printed first).
Numbers are repaired with the known shapes (.xxx reaction, x.xxx ET, xxx.xx MPH).
Output matches sql/data/pdra/*.json: rows [car, q, driver, hometown, rt, (dial,) et, mph, (note)].
"""
import re, sys, json, statistics
import pytesseract
from PIL import Image

HDR = ['DRIVER', 'HOMETOWN', 'CAR', 'MOTOR', 'REACTION', 'MPH']

SCALE = 1.0
def words(img):
    S = SCALE
    big = img.resize((int(img.size[0] * S), int(img.size[1] * S)), Image.LANCZOS) if S != 1 else img
    d = pytesseract.image_to_data(big, config='--psm 6', output_type=pytesseract.Output.DICT)
    out = []
    for i, t in enumerate(d['text']):
        t = t.strip()
        if not t: continue
        out.append(dict(t=t, x=d['left'][i] / S, y=d['top'][i] / S, w=d['width'][i] / S, h=d['height'][i] / S,
                        line=(d['block_num'][i], d['par_num'][i], d['line_num'][i])))
    return out

def lines(ws):
    by = {}
    for w in ws: by.setdefault(w['line'], []).append(w)
    ls = []
    for k, v in by.items():
        v.sort(key=lambda w: w['x'])
        ys = sorted(w['y'] + w['h'] / 2 for w in v)
        ls.append(dict(y=ys[len(ys) // 2], ws=v, text=' '.join(w['t'] for w in v)))
    ls.sort(key=lambda l: l['y'])
    return ls

def fixnum(s):
    return (s.replace('O', '0').replace('o', '0').replace('l', '1').replace('I', '1').replace('S', '5')
             .replace('B', '8').replace(',', '.').replace('«', '').replace('»', '').replace('—', '-').replace('_', ''))

def num(s, kind):
    """kind: rt (.xxx), et (x.xxx / xx.xxx), dial (x.xx / xx.xx), mph (xx.xx / xxx.xx)"""
    s = fixnum(s).strip('|:;\'"`~= ')
    neg = s.startswith('-')
    s = s.lstrip('-+')
    dig = re.sub(r'\D', '', s)
    if not dig: return None
    try:
        if kind == 'rt':
            if re.fullmatch(r'\d\.\d{3}', s): v = float(s)          # e.g. 2.540 (asleep at the tree)
            else: v = int(dig[-3:]) / 1000 if len(dig) >= 3 else None
        elif kind == 'et':
            if re.fullmatch(r'\d{1,2}\.\d{3}', s): v = float(s)
            elif len(dig) in (4, 5): v = int(dig) / 1000
            else: v = None
        elif kind == 'dial':
            if re.fullmatch(r'\d{1,2}\.\d{2}', s): v = float(s)
            elif len(dig) in (3, 4): v = int(dig) / 100
            else: v = None
        else:
            if re.fullmatch(r'\d{2,3}\.\d{2}', s): v = float(s)
            elif len(dig) in (4, 5): v = int(dig) / 100
            else: v = None
    except ValueError:
        return None
    if v is None: return None
    return -v if neg else v

def split_rounds(pairs):
    """New round at a printed round header, or when a car that already ran this round shows up again."""
    key = lambda c: c.replace('O', '0')
    out = []; seen = set()
    for p in pairs:
        cars = {key(x['car']) for x in p}
        if not out or p[0]['hdr'] or (cars & seen):
            out.append([]); seen = set()
        out[-1].append(p); seen |= cars
    return out

def ok_row(r, has_dial):
    if 'broke' in r.get('note', ''): return r['et'] is None or 3.3 <= r['et'] <= 30
    if r['rt'] is None or r['et'] is None or r['mph'] is None: return False
    if has_dial and r['dial'] is None: return False
    if not (3.3 <= r['et'] <= 30 and 20 <= r['mph'] <= 265 and abs(r['rt']) < 10): return False
    if has_dial and not (3.3 <= r['dial'] <= 20): return False
    # ET x MPH sits in a narrow band for a full eighth-mile pass (600-820 on verified sheets); above it means a wrong digit
    if r['et'] * r['mph'] > 835: return False
    return True

def parse(path, col_hint=None):
    img = Image.open(path)
    W = img.size[0]
    ls = lines(words(img))
    # header row -> column x positions
    col = None; has_dial = False; hy = None
    for l in ls:
        up = l['text'].upper()
        if 'DRIVER' in up and 'HOMETOWN' in up:
            pos = {}
            for w in l['ws']:
                t = w['t'].upper().strip('|.')
                if t in HDR: pos[t] = w['x']
                if t == 'CLASS': pos['CLASS'] = w['x']
                if t in ('D/I', 'D/L', 'DA', 'D/1', 'D/'): pos['DIAL'] = w['x']
                if t.replace('.', '') in ('ET', 'ET_'): pos['ET'] = w['x']
            if {'DRIVER', 'HOMETOWN', 'CAR', 'REACTION', 'MPH'} <= set(pos):
                col = pos; hy = l['y']
                has_dial = 'DIAL' in pos or bool(re.search(r'D/[IL1]', up))
            break
    title = next((l['text'] for l in ls if 'Elimination' in l['text'] or 'limination' in l['text']), '')
    if not col and col_hint:
        # Continued page: no column header. Map the first page's columns onto this scan using two anchors
        # that every result row has: the class code (left) and the right edge of the MPH value.
        cls = col_hint['cls']; ks = []; ms = []; ys = []
        for l in ls:
            if not re.search(r'\d[.,]?\d{3}\s+\d{2,3}[.,]?\d{2}\s*\W*$', l['text']) and 'BROKE' not in l['text']: continue
            k = next((w for w in l['ws'][:5] if w['t'].upper().strip('~#=|') in cls), None)
            if not k: continue
            ks.append(k['x']); ys.append(l['y'])
            if 'BROKE' not in l['text']: ms.append(l['ws'][-1]['x'] + l['ws'][-1]['w'])
        if len(ks) >= 2 and len(ms) >= 2:
            aK, aM = statistics.median(ks), statistics.median(ms)
            b = (aM - aK) / (col_hint['aM'] - col_hint['aK']); a0 = aK - b * col_hint['aK']
            col = {n: a0 + b * x for n, x in col_hint['col'].items()}; has_dial = col_hint['has_dial']
            hy = 0
    if not col: return dict(error='no header', title=title)
    xD, xH, xC, xR = col['DRIVER'], col['HOMETOWN'], col['CAR'], col['REACTION']
    xK = col.get('CLASS', xD - (xH - xD) * 0.52)
    flat = []; hdr_pending = False; first_hdr = None
    for l in ls:
        if l['y'] <= hy: continue
        up = l['text'].upper()
        if 'WINNERS' in up or 'APPEAR' in up: continue
        left = [w for w in l['ws'] if w['x'] < xD - 5]
        right = [w for w in l['ws'] if w['x'] >= xR - 40]
        is_hdr = bool(re.search(r'R[O0]UND|FINAL', up)) and not re.search(r'\d\.\d{3}\s+\d{2,3}\.\d{2}\s*\W*$', l['text'])
        if is_hdr:
            if first_hdr is None: first_hdr = not flat
            hdr_pending = True; continue
        if re.search(r'S\s*i\s*n\s*g\s*l\s*e', l['text'], re.I) and len(l['ws']) <= 4:
            if flat: flat[-1]['note'] = (flat[-1].get('note', '') + ' single').strip()
            continue
        if not left or not right: continue
        # the car number is the last token left of the Class column (frame-line specks come before it)
        ki = next((i for i, w in enumerate(left) if w['x'] >= xK - 25), None)
        cand = [w for w in (left[:ki] if ki is not None else left) if re.search(r'[A-Za-z0-9]', w['t'])]
        if not cand or ki is None: continue
        car = re.sub(r'[^A-Za-z0-9]', '', cand[-1]['t'])
        if not car or len(car) > 6: continue
        left = [cand[-1]] + left[ki:]
        name = ' '.join(w['t'] for w in l['ws'] if xD - 5 <= w['x'] < xH - 8).strip(' _—-~=|:;.,«»‘’\'"')
        name = re.sub(r'^[\W_\d]+\s*', '', name)
        extra = [re.sub(r'[^A-Za-z\'.-]', '', w['t']) for w in left[2:]]
        extra = [e for e in extra if len(e) >= 2 and e.isalpha()]
        if extra: name = (' '.join(extra) + ' ' + name).strip()
        home = ' '.join(w['t'] for w in l['ws'] if xH - 8 <= w['x'] < xC - 8).strip(' _—-~=|:;.,«»‘’\'"')
        home = re.sub(r'\s*[^A-Za-z\s]*\d{2,3}$', '', home).strip(' .,|*+-')
        rt_toks = [w['t'] for w in right]
        rtxt = ' '.join(rt_toks)
        note = []
        if re.search(r'foul', rtxt, re.I): note.append('foul')
        if re.search(r'B\s*R\s*O\s*K\s*E', rtxt): note.append('broke')
        toks = []
        for t in rt_toks:
            if re.search(r'foul|B\s*R|O\s*K\s*E|ingle', t, re.I): continue
            c = re.sub(r'[^-.\d]', '', fixnum(t))
            if len(re.sub(r'\D', '', c)) >= 2 and len(c) >= len(t) - 2: toks.append(c)
        row = dict(car=car, driver=name, home=home, y=l['y'], rt=None, dial=None, et=None, mph=None, raw=rtxt,
                   cls=left[1]['t'].upper().strip('~#=|'), kx=left[1]['x'], mx=l['ws'][-1]['x'] + l['ws'][-1]['w'])
        if 'broke' in note and len(toks) <= 1:
            if toks: row['rt'] = num(toks[0], 'rt')
        else:
            want = ['mph', 'et'] + (['dial'] if has_dial else []) + ['rt']
            tk = toks[:]
            for k in want:
                if not tk: break
                row[k] = num(tk.pop(), k)
            if 'foul' in note and row['rt'] is not None and row['rt'] > 0: row['rt'] = -row['rt']
            if 'foul' not in note and row['rt'] is not None and row['rt'] < 0:
                row['rt'] = -row['rt']; row['flag'] = 'rt sign unclear'   # a leading "." often reads as "-"; negative without "foul" is rare
        if note: row['note'] = ' '.join(note)
        row['car'] = row['car'].upper()
        slow = row['et'] is not None and row['mph'] is not None and row['et'] * row['mph'] < 560   # lifted run, or a misread digit
        if not ok_row(row, has_dial) or slow:
            # second look: just this row's number strip, enlarged, digits only
            y0 = int(min(w['y'] for w in l['ws'] if w['h'] > 8) - 6); y1 = int(max(w['y'] + w['h'] for w in l['ws'] if w['h'] < 60) + 6)
            strip = img.crop((int(xR - 70), max(0, y0), W - 8, y1)).resize((int((W - 8 - xR + 70) * 3), max(1, (y1 - y0) * 3)))
            t2 = pytesseract.image_to_string(strip, config='--psm 7 -c tessedit_char_whitelist=0123456789.-').split()
            t2 = [t for t in t2 if len(re.sub(r'\D', '', t)) >= 2]
            alt = dict(row)
            want = ['mph', 'et'] + (['dial'] if has_dial else []) + ['rt']
            if 'broke' in note and len(t2) <= 1: want = ['rt']
            for k in want: alt[k] = num(t2.pop(), k) if t2 else None
            if 'foul' in note and alt['rt'] is not None and alt['rt'] > 0: alt['rt'] = -alt['rt']
            if 'foul' not in note and alt['rt'] is not None and alt['rt'] < 0: alt['rt'] = -alt['rt']
            same = all(alt[k] == row[k] for k in ('rt', 'dial', 'et', 'mph'))
            if ok_row(row, has_dial) and (same or not ok_row(alt, has_dial)): pass             # slow run read the same twice: keep
            elif ok_row(alt, has_dial) and not ok_row(row, has_dial): row.update({k: alt[k] for k in ('rt', 'dial', 'et', 'mph')}); row['flag'] = 'second read'
            elif ok_row(alt, has_dial): row['flag'] = 'two reads differ'; row['alt'] = [alt[k] for k in ('rt', 'dial', 'et', 'mph')]
            else: row['flag'] = 'unreadable numbers'
        if not re.search(r'\d', row['car']) and row['et'] is None and 'broke' not in note: continue   # speck, not a result row
        row['hdr'] = hdr_pending; hdr_pending = False
        flat.append(row)
    # 1) pair rows by the vertical gap (winner printed first, partner on the next line)
    gaps = [b['y'] - a['y'] for a, b in zip(flat, flat[1:]) if not b['hdr']]
    # line pitch inside a pair = the lower quartile of the gaps (robust to one stray speck row)
    gs = sorted(g for g in gaps if g > 8)
    small = gs[len(gs) // 4] if gs else 0
    pairs = []; i = 0
    while i < len(flat):
        if 'single' in flat[i].get('note', ''):
            pairs.append([flat[i]]); i += 1
        elif i + 1 < len(flat) and not flat[i + 1]['hdr'] and 0.6 * small <= (flat[i + 1]['y'] - flat[i]['y']) <= small * 1.35:
            pairs.append([flat[i], flat[i + 1]]); i += 2
        else:
            pairs.append([flat[i]]); i += 1
    out = split_rounds(pairs)
    pre_rows = bool(flat) and not flat[0]['hdr']
    allrows = [x for rd in out for p in rd for x in p]
    hint = col_hint
    if not hint and len(allrows) >= 2:
        from collections import Counter
        cc = Counter(x['cls'] for x in allrows)
        hint = dict(W=W, col=col, has_dial=has_dial, cls={c for c, n in cc.items() if n >= 2 or len(cc) == 1} | {cc.most_common(1)[0][0]},
                    aK=statistics.median(x['kx'] for x in allrows),
                    aM=statistics.median([x['mx'] for x in allrows if x['mph'] is not None] or [col['MPH'] + 60]))
    return dict(title=title, has_dial=has_dial, rounds=out, starts_with_header=not pre_rows, hint=hint, pairs=pairs)

if __name__ == '__main__':
    r = parse(sys.argv[1])
    for i, rd in enumerate(r.get('rounds', [])):
        print('ROUND', i + 1, len(rd), 'pairs')
        for p in rd:
            for x in p: print('  ', x['car'], '|', x['driver'], '|', x['home'], '|', x['rt'], x['dial'], x['et'], x['mph'], x.get('note', ''))
            print()
    if 'error' in r: print(r)


def parse_class(paths):
    """Several pages of one class. Pages can overlap (the same pairs printed again) and a pair can straddle a page break."""
    allp = []; sigs = set(); title = ''; has_dial = False; errs = []; hint = None
    sig = lambda p: tuple((x['car'], x['et'], x['rt']) for x in p)
    for n, path in enumerate(paths):
        r = parse(path, hint)
        hint = hint or r.get('hint')
        if 'error' in r: errs.append((path, r['error'])); continue
        title = title or r['title']; has_dial = has_dial or r['has_dial']
        ps = [p for p in r['pairs'] if sig(p) not in sigs]
        if allp and ps and len(allp[-1]) == 1 and len(ps[0]) == 1 and not ps[0][0]['hdr'] \
           and 'single' not in allp[-1][0].get('note', '') and ps[0][0]['car'] != allp[-1][0]['car']:
            allp[-1].append(ps[0][0]); ps = ps[1:]                      # pair split across the page break
        for p in ps: sigs.add(sig(p))
        allp.extend(ps)
    return dict(title=title, has_dial=has_dial, rounds=split_rounds(allp), errors=errs)


# ---------------- Qualifying sheets ("Qualified Positions for ....") ----------------
def parse_qual(path):
    """Rows: pos, car, driver, hometown, et, mph. Columns are found from where words line up across rows."""
    img = Image.open(path)
    ls = lines(words(img))
    title = next((l['text'] for l in ls if 'Positions' in l['text'] or 'ositions for' in l['text']), '')
    rows = []
    for l in ls:
        ws = l['ws']
        m = re.match(r'^\W*(\d{1,3})\s*[.,:]?\s', l['text'])
        tail = [w for w in ws if re.fullmatch(r'[-.,\d=_|]+', fixnum(w['t'])) and len(re.sub(r'\D', '', fixnum(w['t']))) >= 4]
        if not m or len(tail) < 2: continue
        # numeric tail: ET, MPH, top MPH (the last three number-like words)
        nums = tail[-3:] if len(tail) >= 3 else tail[-2:]
        et = num(nums[0]['t'], 'et'); mph = num(nums[1]['t'], 'mph')
        if et is None or not (3.3 <= et <= 30): continue
        body = [w for w in ws if w['x'] < nums[0]['x'] - 5]
        # drop the position token(s), then car #, then class
        i = 0
        while i < len(body) and not re.search(r'[A-Za-z0-9]', body[i]['t']): i += 1
        i += 1                                   # position
        while i < len(body) and not re.search(r'[A-Za-z0-9]', body[i]['t']): i += 1
        if i + 1 >= len(body): continue
        car = re.sub(r'[^A-Za-z0-9]', '', body[i]['t']).upper(); cls = body[i + 1]['t']
        rows.append(dict(pos=int(m.group(1)), car=car, cls=cls, ws=body[i + 2:], et=et, mph=mph, y=l['y']))
    if not rows: return dict(title=title, rows=[], error='no rows')
    # hometown column start: the x (after the first name word) where the most rows start a word after a wide gap
    from collections import Counter
    c = Counter()
    for r in rows:
        for a, b in zip(r['ws'], r['ws'][1:]):
            if b['x'] - (a['x'] + a['w']) > 22: c[round(b['x'] / 12)] += 1
    name_x = statistics.median(r['ws'][0]['x'] for r in rows if r['ws'])
    cands = [(k * 12, n) for k, n in c.items() if k * 12 > name_x + 90 and n >= max(2, len(rows) * 0.3)]
    xH = min(cands)[0] - 8 if cands else None
    xC = None
    if xH is not None:
        c2 = [(x, n) for x, n in cands if x > xH + 150]
        xC = min(c2)[0] - 8 if c2 else None
    out = []
    for r in rows:
        clean = lambda ws: ' '.join(w['t'] for w in ws).strip(' _—-~=|:;.,«»‘’\'"*+')
        if xH is None: name, home = clean(r['ws']), None
        else:
            name = clean([w for w in r['ws'] if w['x'] < xH])
            home = clean([w for w in r['ws'] if xH <= w['x'] < (xC or 1e9)])
        out.append(dict(pos=r['pos'], car=r['car'], driver=name, home=home, et=r['et'], mph=r['mph']))
    return dict(title=title, rows=out)


# ---------------- Ladder (bracket diagram) sheets ----------------
def parse_ladder(path):
    """Bracket diagram: each box holds two entries (car, class, initial + last name / [qual] RT ET MPH).
    Columns are rounds. The winner of a box is whoever shows up in the next column."""
    img = Image.open(path)
    d = pytesseract.image_to_data(img, config='--psm 11', output_type=pytesseract.Output.DICT)
    ws = [dict(t=d['text'][i].strip(), x=d['left'][i], y=d['top'][i], w=d['width'][i], h=d['height'][i])
          for i in range(len(d['text'])) if d['text'][i].strip()]
    if not ws: return dict(error='blank')
    H = statistics.median(w['h'] for w in ws if re.search(r'\d', w['t'])) or 24
    head = ' '.join(w['t'] for w in sorted(ws, key=lambda w: (round(w['y'] / H), w['x'])) if w['y'] < img.size[1] * 0.12)
    isnum = lambda t, pat: re.fullmatch(pat, fixnum(t).strip('|:;\'"`~=_'))
    ets = [w for w in ws if isnum(w['t'], r'\d{1,2}[.,]\d{3}') and w['y'] > img.size[1] * 0.08]
    entries = []; used = set()
    for e in ets:
        same = [w for w in ws if abs(w['y'] - e['y']) < H * 0.6 and w is not e]
        m = min((w for w in same if 0 < w['x'] - (e['x'] + e['w']) < H * 9 and isnum(w['t'], r'-?\d{2,3}[.,]?\d{2}')), key=lambda w: w['x'], default=None)
        r = max((w for w in same if 0 < e['x'] - (w['x'] + w['w']) < H * 7 and re.search(r'\d{2}', fixnum(w['t']))), key=lambda w: w['x'], default=None)
        if not m: continue                       # the "Low E.T." line and stray numbers have no MPH beside them
        x0 = (r['x'] if r else e['x'] - H * 5) - H * 4.2; x1 = m['x'] + m['w'] + H * 0.8
        hd = sorted((w for w in ws if H * 1.3 < e['y'] - w['y'] < H * 2.9 and x0 <= w['x'] <= x1 and w['h'] > H * 0.6 and re.search(r'[A-Za-z0-9]', w['t'])), key=lambda w: w['x'])
        if not hd: continue
        for w in hd: used.add(id(w))
        note = []
        rt = num(r['t'], 'rt') if r else None
        if r and fixnum(r['t']).lstrip('|').startswith('-') and rt is not None: rt = -abs(rt); note.append('foul')
        entries.append(dict(hd=hd, x=hd[0]['x'], y=hd[0]['y'], rt=rt, et=num(e['t'], 'et'), mph=num(m['t'], 'mph'), note=' '.join(note)))
    if not entries: return dict(error='no ladder entries', head=head)
    # entries with no numbers yet (a round not run when the sheet was printed): car-like token + name, right of everything read
    maxx = max(en['x'] for en in entries)
    rows = {}
    for w in ws:
        if id(w) in used or w['y'] < img.size[1] * 0.12: continue
        rows.setdefault(round(w['y'] / (H * 0.9)), []).append(w)
    for k, r in rows.items():
        r.sort(key=lambda w: w['x'])
        if len(r) >= 2 and r[0]['x'] > maxx + H * 3 and re.search(r'\d', r[0]['t']) and re.fullmatch(r'[A-Za-z]{2,}\W?', r[-1]['t']) \
           and not re.search(r'E\.?T|Speed|Champ', ' '.join(w['t'] for w in r)):
            entries.append(dict(hd=r, x=r[0]['x'], y=r[0]['y'], rt=None, et=None, mph=None, note='not run'))
    # header -> car, class, name. The class code (the most common short capital token) anchors each header:
    # the car number is the token before it, the name is what follows.
    from collections import Counter
    cc = Counter(re.sub(r'[^A-Z0-9/]', '', w['t']) for en in entries for w in en['hd'][1:] if re.fullmatch(r'\W*[A-Z][A-Z0-9/]{1,4}\W*', w['t']) and not re.search(r'\d{3}', w['t']))
    klass = cc.most_common(1)[0][0] if cc else None
    for en in entries:
        t = [re.sub(r'^[|\[\]]+|[|\[\]]+$', '', w['t']) for w in en['hd']]
        t = [x for x in t if x]
        k = next((i for i, x in enumerate(t) if i > 0 and re.sub(r'[^A-Z0-9/]', '', x) == klass), None)
        if k is not None:
            car = re.sub(r'[^A-Za-z0-9]', '', t[k - 1]).upper(); rest = t[k + 1:]
        else:
            ci = next((i for i, x in enumerate(t) if re.search(r'\d', x) and len(re.sub(r'[^A-Za-z0-9]', '', x)) >= 1 and not (i == 0 and len(t) > 3 and re.fullmatch(r'\d{1,2}', x))), 0)
            car = re.sub(r'[^A-Za-z0-9]', '', t[ci]).upper() if t else ''; rest = [x for x in t[ci + 1:] if re.search(r'[A-Za-z]', x)]
        rest = [x for x in rest if re.search(r"[A-Za-z]", x)]
        en['cls'] = klass; en['car_raw'] = car
        if klass and car.startswith(klass) and len(car) > len(klass): car = car[len(klass):]
        en['car'] = car.replace('O', '0').replace('S', '5') if re.search(r'\d', car) and re.fullmatch(r'[0-9OS]+', car) else car
        en['driver'] = ' '.join(rest).strip(' .,|')
    # columns = rounds (cluster by x of the box), pairs = two entries stacked in one box
    xs = sorted(en['x'] for en in entries); cols = [[xs[0]]]
    for x in xs[1:]:
        if x - cols[-1][-1] > H * 6: cols.append([x])
        else: cols[-1].append(x)
    cut = [c[0] - H * 3 for c in cols]
    rounds = []
    for i, c in enumerate(cols):
        lo = cut[i]; hi = cut[i + 1] if i + 1 < len(cut) else 1e9
        es = sorted((en for en in entries if lo <= en['x'] < hi), key=lambda en: en['y'])
        gaps = sorted(b['y'] - a['y'] for a, b in zip(es, es[1:]))
        small = gaps[len(gaps) // 4] if gaps else H * 4
        small = min(small, H * 5)
        pairs = []; j = 0
        while j < len(es):
            if j + 1 < len(es) and es[j + 1]['y'] - es[j]['y'] <= small * 1.4: pairs.append([es[j], es[j + 1]]); j += 2
            else: pairs.append([es[j]]); j += 1
        rounds.append(pairs)
    # winner first, using the next column
    for i, rd in enumerate(rounds):
        nxt = {en['car'] for p in rounds[i + 1] for en in p} if i + 1 < len(rounds) else None
        for p in rd:
            if len(p) == 2 and nxt is not None:
                a, b = p
                if b['car'] in nxt and a['car'] not in nxt: p[0], p[1] = b, a
                elif not (a['car'] in nxt) and not (b['car'] in nxt): p[0]['flag'] = 'winner not found in next round'
            elif len(p) == 2 and nxt is None and p[0]['et'] is not None:
                p[0]['flag'] = 'final: winner to be set from the times / published result'
    out = [[[dict(car=x['car'], driver=x['driver'], home=None, rt=x['rt'], dial=None, et=x['et'], mph=x['mph'],
                  **({'note': x['note']} if x['note'] else {}), **({'flag': x['flag']} if x.get('flag') else {})) for x in p] for p in rd] for rd in rounds]
    return dict(title=head[:120], rounds=out, ladder=True)
