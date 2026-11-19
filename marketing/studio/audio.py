"""HONTO?! 15s spot — synthesized score + sound design, cut-synced. Pure stdlib."""
import math, random, struct, wave, sys

SR = 48000
DUR = 20.0
N = int(SR * DUR)
L = [0.0] * N
R = [0.0] * N
rnd = random.Random(20260926)

BAR = 2.00          # first downbeat (= the first hard cut)
BEAT = 0.5          # 120 bpm
E = BEAT / 2
CUTS = [2.00, 4.25, 8.25, 11.00, 13.50, 16.00]


def add(t0, dur, gen, gain=1.0, pan=0.0):
    i0 = int(t0 * SR)
    n = int(dur * SR)
    lg, rg = min(1.0, 1.0 - pan), min(1.0, 1.0 + pan)
    for i in range(n):
        j = i0 + i
        if j < 0 or j >= N:
            continue
        v = gen(i / SR, i) * gain
        L[j] += v * lg
        R[j] += v * rg


def svf(f0, width=2.6):
    """unconditionally stable one-pole band-pass (lo = f/width, hi = f*width)."""
    st = [0.0, 0.0]

    def step(x, f=f0):
        ah = min(0.92, 6.2832 * min(f * width, SR * 0.45) / SR)
        al = min(0.92, 6.2832 * max(40.0, f / width) / SR)
        st[0] += ah * (x - st[0])
        st[1] += al * (st[0] - st[1])
        return (st[0] - st[1]) * 1.9
    return step


def nz():
    return rnd.random() * 2 - 1


# ---------- instruments ----------
def kick(t0, g=1.0):
    def gen(t, i):
        f = 44 + 128 * math.exp(-t * 34)
        body = math.sin(2 * math.pi * f * t) * math.exp(-t * 7.0)
        click = math.exp(-t * 260) * nz() * 0.35
        return body * 1.05 + click
    add(t0, 0.55, gen, g)


def sub(t0, g=1.0, f0=58, f1=32, dec=5.0, dur=1.3):
    def gen(t, i):
        f = f1 + (f0 - f1) * math.exp(-t * 4.0)
        return math.sin(2 * math.pi * f * t) * math.exp(-t * dec)
    add(t0, dur, gen, g)


def clap(t0, g=1.0):
    bp = svf(1500, 2.2)

    def gen(t, i):
        e = 0.0
        for k, off in enumerate((0.0, 0.011, 0.023)):
            if t >= off:
                e += math.exp(-(t - off) * 120) * (0.65 if k < 2 else 1.0)
        e += math.exp(-t * 22) * 0.42
        return bp(nz(), 1700) * e
    add(t0, 0.3, gen, g * 1.35)


def hat(t0, g=1.0, dec=90.0, pan=0.0):
    bp = svf(9000, 1.7)

    def gen(t, i):
        return bp(nz(), 9500) * math.exp(-t * dec)
    add(t0, 0.16, gen, g * 1.5, pan)


def crash(t0, g=1.0, dur=1.6):
    bp = svf(7000, 2.4)

    def gen(t, i):
        return bp(nz(), 6500 + 1500 * math.exp(-t * 3)) * math.exp(-t * 2.6) * (1 - math.exp(-t * 400))
    add(t0, dur, gen, g * 1.15)


def bass(t0, dur, freq, g=1.0):
    def gen(t, i):
        env = math.exp(-t * 4.0) * (1 - math.exp(-t * 900))
        cut = math.exp(-t * 6)
        v = math.sin(2 * math.pi * freq * t)
        v += 0.45 * cut * math.sin(4 * math.pi * freq * t)
        v += 0.22 * cut * math.sin(6 * math.pi * freq * t)
        return v * env
    add(t0, min(dur + 0.1, 1.0), gen, g)


def pluck(t0, freq, g=1.0, dec=9.0, pan=0.0):
    def gen(t, i):
        env = math.exp(-t * dec) * (1 - math.exp(-t * 1200))
        p = freq * (1 + 0.012 * math.exp(-t * 40))
        v = math.sin(2 * math.pi * p * t)
        v += 0.42 * math.sin(4 * math.pi * p * t) * math.exp(-t * 16)
        v += 0.16 * math.sin(6 * math.pi * p * t) * math.exp(-t * 26)
        return v * env
    add(t0, 0.7, gen, g, pan)


def stab(t0, freqs, g=1.0, dec=6.0):
    for k, f in enumerate(freqs):
        pluck(t0, f, g * (0.9 ** k), dec, pan=(-0.35 + 0.35 * k))


def whoosh(t0, dur=0.34, g=1.0, up=True, pan=0.0):
    bp = svf(800, 2.8)

    def gen(t, i):
        x = t / dur
        f = (350 + 5200 * x) if up else (5200 - 4600 * x)
        env = math.sin(math.pi * min(1.0, x)) ** 1.6
        return bp(nz(), f) * env
    add(t0, dur, gen, g * 1.35, pan)


def impact(t0, g=1.0):
    sub(t0, 0.95 * g, 92, 36, 5.5, 1.1)
    bp = svf(1800, 2.4)

    def gen(t, i):
        return bp(nz(), 2200 - 1400 * min(1, t * 6)) * math.exp(-t * 26)
    add(t0, 0.35, gen, 1.25 * g)


def riser(t0, dur, g=1.0):
    bp = svf(600, 2.0)

    def gen(t, i):
        x = t / dur
        f = 500 + 6000 * (x ** 2.2)
        n = bp(nz(), f) * (0.25 + 0.75 * x ** 2)
        s = math.sin(2 * math.pi * (220 + 700 * x ** 2.4) * t) * 0.35 * x ** 3
        return (n * 1.6 + s) * (0.2 + 0.8 * x)
    add(t0, dur, gen, g)


def pad(t0, dur, freqs, g=1.0):
    def gen(t, i):
        env = min(1.0, t / 0.35) * math.exp(-t * 0.55)
        v = 0.0
        for k, f in enumerate(freqs):
            v += math.sin(2 * math.pi * f * t + k) * (0.8 ** k)
            v += 0.3 * math.sin(2 * math.pi * f * 1.005 * t + k * 2) * (0.8 ** k)
        return v * env * 0.25
    add(t0, dur, gen, g)


# ================= arrangement =================
# --- intro: the kanji hit ---
sub(0.0, 1.0, 110, 34, 3.0, 1.9)
crash(0.0, 0.5, 1.7)
riser(0.42, 0.79, 0.30)
impact(1.21, 1.0)          # the "!" slam
crash(1.21, 0.55)
stab(1.21, [220.0, 261.63, 329.63], 0.30, 7.0)
whoosh(1.68, 0.34, 0.75)

# --- groove: bars 1..6 (1.62 -> 13.62) ---
A2, F2, C3, G2 = 110.0, 87.31, 130.81, 98.0
ROOTS = [A2, A2, F2, C3, G2, A2, F2, C3]
for b in range(8):
    b0 = BAR + b * 2.0
    for k in range(4):                                  # kick on every beat
        kick(b0 + k * BEAT, 0.95 if k == 0 else 0.8)
    kick(b0 + 3 * BEAT + E, 0.5)                        # pickup
    clap(b0 + BEAT, 0.55)
    clap(b0 + 3 * BEAT, 0.55)
    for k in range(8):                                  # hats on 8ths
        t = b0 + k * E
        hat(t, 0.30 if k % 2 == 0 else 0.17, 120 if k % 2 else 95, -0.18 + 0.36 * (k % 3) / 2)
    hat(b0 + 7 * E, 0.26, 26, 0.1)                      # open hat into the next bar
    r = ROOTS[b]
    for k, o in enumerate((0, 1.5, 3, 3.5, 5, 6.5)):    # bass pattern
        bass(b0 + o * E, 0.45, r * (2.0 if k == 3 else 1.0), 0.42)

# --- melody: A minor pentatonic hook, bars 2..6 ---
A3, C4, D4, E4, G4, A4 = 220.0, 261.63, 293.66, 329.63, 392.0, 440.0
RIFF = [(0, A4), (1, E4), (3, G4), (4, A4), (6, E4), (7, D4)]
RIFF2 = [(0, C4), (1, E4), (2, D4), (4, C4), (5, A3), (7, E4)]
for b in range(1, 7):
    b0 = BAR + b * 2.0
    for half in (0, 1):
        pat = RIFF if (b + half) % 2 == 0 else RIFF2
        for o, f in pat:
            pluck(b0 + half * 4 * E + o * E, f, 0.26 if o == 0 else 0.19, 11.0, -0.2 + 0.4 * ((o % 3) / 2))

# --- cut accents ---
for c in CUTS:
    whoosh(c - 0.24, 0.32, 0.7, up=(c not in (5.70, 11.58)))
    impact(c, 0.55)
crash(8.25, 0.30, 1.0)
crash(11.00, 0.34, 1.1)

# --- the "2 SIPS" payoff ---
impact(12.50, 0.9)
crash(12.50, 0.5, 1.3)
stab(12.50, [329.63, 392.0, 523.25], 0.26, 8.0)

# --- push into the CTA ---
riser(15.00, 1.00, 0.55)
impact(16.00, 1.0)
crash(16.00, 0.62, 1.8)
stab(16.00, [220.0, 261.63, 329.63, 440.0], 0.34, 5.0)
pad(16.00, 4.0, [110.0, 164.81, 220.0, 261.63], 0.5)

# --- button lands ---
stab(17.02, [440.0, 523.25, 659.25], 0.30, 5.5)
crash(17.02, 0.26, 1.2)
hat(17.02, 0.3, 40)

# --- outro ---
crash(18.00, 0.40, 1.9)
kick(18.00, 0.9)
sub(18.00, 0.7, 90, 34, 2.4, 1.4)
stab(19.00, [440.0, 523.25, 659.25], 0.22, 4.0)
stab(18.00, [220.0, 329.63, 440.0], 0.24, 3.4)

# ---------- master ----------
rms = math.sqrt(sum(v * v for v in L) / N) or 1e-9
norm = 0.138 / rms
peak = max(max(abs(v) for v in L), max(abs(v) for v in R)) or 1.0
norm = min(norm, 1.35 / peak)
fade_in = int(0.01 * SR)
fade_from = int(19.30 * SR)
# soft-limit, then bring the true peak to about -1 dBFS
lim = [math.tanh(L[i] * norm) for i in range(N)]
rim = [math.tanh(R[i] * norm) for i in range(N)]
post = max(max(abs(v) for v in lim), max(abs(v) for v in rim)) or 1.0
trim = 0.84 / post
frames = bytearray()
for i in range(N):
    a, b = lim[i] * trim, rim[i] * trim
    if i < fade_in:
        k = i / fade_in
        a *= k
        b *= k
    if i >= fade_from:
        k = max(0.0, 1 - (i - fade_from) / (N - fade_from))
        k = k * k
        a *= k
        b *= k
    frames += struct.pack('<hh', int(max(-1, min(1, a)) * 32000), int(max(-1, min(1, b)) * 32000))

out = sys.argv[1] if len(sys.argv) > 1 else 'honto-score.wav'
with wave.open(out, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(bytes(frames))
print('wrote', out, N, 'frames')
