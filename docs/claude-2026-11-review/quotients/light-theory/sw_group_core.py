import itertools, math, numpy as np
H = 0.996384497847316; PHI = 0.5 + 0.5*math.sqrt(5); T = math.tanh(H)
_d = [(0,1,PHI),(0,1,-PHI),(1,PHI,0),(1,-PHI,0),(PHI,0,1),(-PHI,0,1)]
_n = []
for d in _d:
    u = np.array(d, float); u /= np.linalg.norm(u); _n += [u, -u]
NORM = np.array(_n)
KR = math.tanh(1.9028473444057519)
