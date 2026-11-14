import json,glob,re,collections,sys,os
sys.path.insert(0,'/home/claude/downtrackmedia/sql/tools')
from pdra_batch_check import check
def nk(s): return re.sub(r'[^a-z]','',(s or '').lower().replace('0','o').replace('1','l'))
def ed1(a,b):
    if a==b: return True
    if abs(len(a)-len(b))>1: return False
    if len(a)==len(b): return sum(x!=y for x,y in zip(a,b))==1
    if len(a)>len(b): a,b=b,a
    return any(a==b[:i]+b[i+1:] for i in range(len(b)))
def canon(rounds):
    rows=[x for rd in rounds for p in rd for x in p]
    byname=collections.defaultdict(collections.Counter)
    for x in rows:
        k=nk(x['driver'])
        if len(k)>=5: byname[k][x['car']]+=1
    # merge name keys within edit distance 1 (OCR noise in the name)
    keys=sorted(byname,key=lambda k:-sum(byname[k].values()));rep={}
    for k in keys:
        m=next((r for r in rep.values() if r!=k and ed1(r,k) and len(k)>=6),None)
        rep[k]=m or k
    grp=collections.defaultdict(collections.Counter)
    for k,c in byname.items(): grp[rep[k]].update(c)
    carmap={}
    for k,c in grp.items():
        best=c.most_common(1)[0][0]
        for car in c:
            if car!=best: carmap[(k,car)]=best
    n=0
    for x in rows:
        k=rep.get(nk(x['driver']))
        if k and (k,x['car']) in carmap: x['car_ocr']=x['car'];x['car']=carmap[(k,x['car'])];n+=1
    # rows with unreadable names: snap the car to a known car one character away (if only one candidate)
    known=collections.Counter(x['car'] for x in rows if len(nk(x['driver']))>=5)
    for x in rows:
        if len(nk(x['driver']))<5 and x['car'] not in known:
            c=[k for k in known if ed1(k,x['car'])]
            if len(c)==1: x['car_ocr']=x['car'];x['car']=c[0];n+=1
    return n
def resplit(rounds):
    """Flatten and split again: a new round starts where a car that already ran shows up AND the pairs that follow
    are mostly cars from the round in progress (a lone repeat is a double entry or a misread, not a new round)."""
    P=[p for rd in rounds for p in rd]
    out=[];seen=set()
    for i,p in enumerate(P):
        cars={x['car'] for x in p}
        if not out: out.append([])
        elif cars&seen:
            nxt=[x['car'] for q in P[i:i+4] for x in q]
            if sum(c in seen for c in nxt)>=0.6*len(nxt): out.append([]);seen=set()
        out[-1].append(p);seen|=cars
    return out
def lastname(s):
    t=re.sub(r'[^a-z ]','',(s or '').lower()).split();t=[x for x in t if x not in('jr','sr','ii','iii','iv')]
    return t[-1] if t else ''
def snap(rounds):
    """A car in round n+1 that did not win round n: if exactly one round-n winner is missing from n+1 and matches by
    name or by a one-character difference, it is the same car misread."""
    n=0
    for i in range(len(rounds)-1):
        win={p[0]['car']:p[0] for p in rounds[i]}
        nxt=[x for p in rounds[i+1] for x in p]
        have={x['car'] for x in nxt}
        missing={c:r for c,r in win.items() if c not in have}
        for x in nxt:
            if x['car'] in win: continue
            c=[m for m,r in missing.items() if (lastname(r['driver']) and lastname(r['driver'])==lastname(x['driver'])) or ed1(m,x['car'])]
            if len(c)==1:
                x.setdefault('car_ocr',x['car']);x['car']=c[0];missing.pop(c[0]);n+=1
    return n
if __name__=='__main__':
    src,dst=sys.argv[1],sys.argv[2];os.makedirs(dst,exist_ok=True);st=collections.Counter()
    for f in glob.glob(src+'/*.json'):
        r=json.load(open(f))
        if r.get('rows'):
            before=bool(r['check'])
            n=canon(r['rounds']);r['rounds']=resplit(r['rounds']);n+=snap(r['rounds']);r['rounds']=resplit(r['rounds']);r['shape']=[len(x) for x in r['rounds']];r['check']=check(r['rounds']);r['car_fixes']=n
            sh=r['shape'];r['partial']=bool(len(r['check'])==1 and r['check'][0].startswith('last round') and all(a>=b for a,b in zip(sh,sh[1:])))
            st[('fail' if before else 'ok')+'->'+('fail' if r['check'] else 'ok')]+=1
        json.dump(r,open(os.path.join(dst,os.path.basename(f)),'w'))
    print(dict(st))
