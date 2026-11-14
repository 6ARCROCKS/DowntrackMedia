"""Run the PDRA sheet reader over every class page in the manifest. One JSON per class page in out/."""
import json, os, re, sys, traceback
from multiprocessing import Pool
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pdra_ocr as P

IMG = sys.argv[1]; OUT = sys.argv[2]
QUAL = re.compile(r'final|qualif|-Q\d|P\d-|-P\d', re.I)

def check(rounds):
    bad = []
    for i in range(len(rounds) - 1):
        w = {p[0]['car'] for p in rounds[i]}; n = {x['car'] for p in rounds[i + 1] for x in p}
        lose = {p[1]['car'] for p in rounds[i] if len(p) > 1}
        if n - w:
            buyback = i == 0 and (n - w) <= lose
            if not buyback: bad.append(f'R{i+2} has cars that did not win R{i+1}: {sorted(n - w)}')
    if rounds and len(rounds[-1]) != 1: bad.append(f'last round has {len(rounds[-1])} pairs')
    if not rounds: bad.append('no rounds read')
    return bad

KINDS = json.load(open(os.environ['KINDS'])) if os.environ.get('KINDS') else {}

def ladder_check(rounds):
    bad = []
    for i in range(len(rounds) - 1):
        cur = {x['car'] for p in rounds[i] for x in p}; n = {x['car'] for p in rounds[i + 1] for x in p}
        if n - cur: bad.append(f'R{i+2} has cars not in R{i+1}: {sorted(n - cur)}')
        if len(rounds[i + 1]) * 2 != len(rounds[i]) and len(rounds[i]) > 1: bad.append(f'R{i+1} has {len(rounds[i])} boxes, R{i+2} has {len(rounds[i+1])}')
    if rounds and len(rounds[-1]) != 1: bad.append(f'last column has {len(rounds[-1])} boxes')
    return bad

def work(post):
    out = os.path.join(OUT, f"{post['id']}.json")
    if os.path.exists(out): return
    files = [u.replace('/', '_') for u in post['imgs']]
    elim = [f for f in files if not (QUAL.search(f) and not re.search('ladder', f, re.I))]
    lad = []
    if KINDS:
        elim = [f for f in files if KINDS.get(f, ['unknown'])[0] == 'list' or (KINDS.get(f, ['unknown'])[0] == 'unknown' and not QUAL.search(f))]
        lad = [f for f in files if KINDS.get(f, [''])[0] == 'ladder']
    res = dict(id=post['id'], title=post['title'], date=post['date'], files=files, elim=elim)
    try:
        paths = [os.path.join(IMG, f) for f in elim if os.path.exists(os.path.join(IMG, f))]
        r = P.parse_class(paths) if paths else dict(rounds=[], errors=[('', 'no elimination sheet')], title='', has_dial=False)
        rows = [x for rd in r['rounds'] for p in rd for x in p]
        if not rows and lad:
            best = None
            for f in lad:
                q = P.parse_ladder2(os.path.join(IMG, f))
                n = sum(1 for rd in q.get('rounds', []) for p in rd for x in p if x['et'])
                if 'error' not in q and (best is None or n > best[0]): best = (n, f, q)
            if best:
                q = best[2]; rows = [x for rd in q['rounds'] for p in rd for x in p]
                res.update(sheet_title=q['title'], has_dial=False, rounds=q['rounds'], errors=[], ladder=best[1],
                           shape=[len(rd) for rd in q['rounds']], check=ladder_check(q['rounds']),
                           flags=sum(1 for x in rows if x.get('flag')), rows=len(rows), timed=best[0])
                json.dump(res, open(out, 'w')); return
        for x in rows:
            for k in ('y', 'kx', 'mx', 'hdr'): x.pop(k, None)
        res.update(sheet_title=r['title'], has_dial=r['has_dial'], rounds=r['rounds'], errors=r['errors'],
                   shape=[len(rd) for rd in r['rounds']], check=check(r['rounds']),
                   flags=sum(1 for x in rows if x.get('flag')), rows=len(rows))
    except Exception as e:
        res.update(crash=traceback.format_exc()[-600:])
    json.dump(res, open(out, 'w'))

if __name__ == '__main__':
    posts = json.load(open(os.path.join(IMG, 'manifest.json')))
    os.makedirs(OUT, exist_ok=True)
    with Pool(int(sys.argv[3]) if len(sys.argv) > 3 else 4) as pool:
        for _ in pool.imap_unordered(work, posts, chunksize=2): pass
    print('done')
