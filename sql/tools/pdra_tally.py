import json,glob,collections,sys
K=json.load(open('kinds.json'))
R=[json.load(open(f)) for f in glob.glob(sys.argv[1]+'/*.json')]
def status(r):
    kinds=collections.Counter(K.get(f,['?'])[0] for f in r['files'])
    if r.get('crash'): return 'crash'
    if r.get('ladder'):
        if not r.get('timed'): return 'diagram with no times (pre-race ladder only)'
        return 'diagram: bracket consistent' if not r['check'] else 'diagram: bracket inconsistent'
    if not r.get('rows'):
        if not r['files']: return 'page has no sheets'
        if set(kinds)<= {'qual'}: return 'qualifying sheet only'
        return 'unread'
    if len(r['shape'])==1 and r['shape'][0]>1 and not any(K.get(f,[''])[0]=='list' for f in r['elim']): return 'unread'
    if r.get('partial'): return 'list: verified, stops before the final'
    return 'list: bracket check fails' if r['check'] else 'list: verified'
c=collections.Counter();by=collections.defaultdict(collections.Counter);rows=collections.Counter()
for r in R:
    s=status(r);r['status']=s;c[s]+=1;by[r['date'][:4]][s]+=1;rows[s]+=r.get('rows') or 0
print(len(R))
for k,v in c.most_common(): print(f'  {v:4d}  {k}  ({rows[k]} runs)')
order=[k for k,_ in c.most_common()]
print('year '+' | '.join(o[:22] for o in order))
for y in sorted(by): print(y,' | '.join(str(by[y][o]).rjust(4) for o in order))
json.dump({r['id']:r['status'] for r in R},open('status.json','w'))
