import json,glob,sys
for f in sorted(glob.glob(sys.argv[1] if len(sys.argv)>1 else '*.json')):
    d=json.load(open(f));R=d['rounds'];c=[len(r) for r in R];bad=[]
    for i in range(len(R)-1):
        w={p[0][0] for p in R[i]};n={x[0] for p in R[i+1] for x in p}
        if n-w and not (i==0 and d.get('format')=='buyback'): bad.append(f'R{i+2} not from R{i+1} winners: {sorted(n-w)}')
    if c[-1]!=1: bad.append('final round has %d pairings'%c[-1])
    print(f"{d['event']} {d['class']:4} {'/'.join(map(str,c)):18} winner {R[-1][0][0][2]:22} {'OK' if not bad else 'CHECK: '+'; '.join(bad)}")
