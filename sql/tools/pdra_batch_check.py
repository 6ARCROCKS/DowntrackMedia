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

