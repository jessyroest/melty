#!/usr/bin/env python3
"""
The promo video's soundtrack, synthesized from scratch (numpy only, no samples,
nothing downloaded): an icy ambient bed plus sound effects timed to the scenes
in web/promo/Promo.tsx. Writes a 48 kHz stereo WAV.

    python3 scripts/promo-audio.py out.wav
"""
import sys
import wave

import numpy as np

SR = 48_000
DUR = 29.0
N = int(SR * DUR)
rng = np.random.default_rng(7)

L = np.zeros(N)
R = np.zeros(N)


def t_axis(sec):
    return np.arange(int(SR * sec)) / SR


def place(sig, at, gain=1.0, pan=0.0):
    """mix a mono or (2, n) signal in at `at` seconds; pan -1..1"""
    i = int(at * SR)
    if i >= N:
        return
    if sig.ndim == 1:
        lg, rg = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        sig = np.stack([sig * lg * np.sqrt(2), sig * rg * np.sqrt(2)])
    n = min(sig.shape[1], N - i)
    L[i : i + n] += sig[0, :n] * gain
    R[i : i + n] += sig[1, :n] * gain


def env(n, attack, release, sus=None):
    """attack/release in seconds over n samples"""
    e = np.ones(n)
    a = max(1, int(attack * SR))
    r = max(1, int(release * SR))
    e[:a] = np.linspace(0, 1, a) if a < n else np.linspace(0, 1, n)[: len(e[:a])]
    if r < n:
        e[-r:] *= np.linspace(1, 0, r) ** 2
    return e


def decay(n, tau):
    return np.exp(-np.arange(n) / (tau * SR))


def spectral(sig, lo=None, hi=None):
    """brick-ish band filter in the frequency domain, with soft edges"""
    f = np.fft.rfftfreq(len(sig), 1 / SR)
    S = np.fft.rfft(sig)
    g = np.ones_like(f)
    if lo:
        g *= 1 / (1 + (lo / np.maximum(f, 1)) ** 4)
    if hi:
        g *= 1 / (1 + (f / hi) ** 4)
    return np.fft.irfft(S * g, len(sig))


def midi(m):
    return 440 * 2 ** ((m - 69) / 12)


# ---- instruments --------------------------------------------------------------


def pad(freqs, sec, gain=0.05):
    """slow, detuned, chorused chord"""
    t = t_axis(sec)
    l = np.zeros_like(t)
    r = np.zeros_like(t)
    for k, f in enumerate(freqs):
        for d, (gl, gr) in zip((-0.11, 0.0, 0.13), ((1, 0.4), (0.7, 0.7), (0.4, 1))):
            ph = rng.uniform(0, 2 * np.pi)
            vib = 1 + 0.0025 * np.sin(2 * np.pi * (0.2 + 0.05 * k) * t)
            w = np.sin(2 * np.pi * (f + d) * vib * t + ph) + 0.25 * np.sin(4 * np.pi * (f + d) * t + ph)
            l += w * gl
            r += w * gr
    e = env(len(t), 0.7, 2.0)
    return np.stack([l * e, r * e]) * gain / len(freqs)


def bell(f, sec=1.6, gain=0.2):
    """glassy mallet: a few inharmonic partials, fast decay on the high ones"""
    t = t_axis(sec)
    out = np.zeros_like(t)
    for ratio, amp, tau in ((1, 1, 0.9), (2.76, 0.45, 0.35), (5.4, 0.25, 0.15), (8.93, 0.12, 0.08)):
        out += amp * np.sin(2 * np.pi * f * ratio * t) * decay(len(t), tau)
    out *= env(len(t), 0.002, 0.05)
    return out * gain


def clink(f=2600, gain=0.25):
    """ice cubes touching"""
    t = t_axis(0.5)
    out = np.zeros_like(t)
    for ratio, amp in ((1, 1), (1.47, 0.7), (2.09, 0.5), (2.94, 0.35)):
        out += amp * np.sin(2 * np.pi * f * ratio * t + rng.uniform(0, 6)) * decay(len(t), 0.06 / ratio**0.3)
    return out * gain * env(len(t), 0.001, 0.02)


def thump(f=70, gain=0.6):
    t = t_axis(0.6)
    sweep = f * (1 + 1.5 * np.exp(-t * 30))
    return np.sin(2 * np.pi * np.cumsum(sweep) / SR) * decay(len(t), 0.12) * gain


def whoosh(sec=0.9, gain=0.18, lo=300, hi=6000, rising=True):
    n = int(sec * SR)
    noise = spectral(rng.standard_normal(n), lo, hi)
    noise /= np.abs(noise).max()
    shape = np.sin(np.linspace(0, np.pi, n)) ** (2.2 if rising else 1.2)
    if rising:
        shape *= np.linspace(0.3, 1, n)
    return noise * shape * gain


def tick(f=1800, gain=0.08):
    t = t_axis(0.03)
    return np.sin(2 * np.pi * f * t) * decay(len(t), 0.004) * gain


def pop(f, gain=0.18):
    """bubbly pill pop: quick upward sweep"""
    t = t_axis(0.16)
    sweep = f * (0.6 + 0.6 * (1 - np.exp(-t * 60)))
    return np.sin(2 * np.pi * np.cumsum(sweep) / SR) * decay(len(t), 0.04) * env(len(t), 0.002, 0.03) * gain


def drip(gain=0.22, f0=500, f1=1500):
    """a water drop: a fast rising sine 'bloop'"""
    t = t_axis(0.14)
    sweep = f0 + (f1 - f0) * (t / t[-1]) ** 1.5
    return np.sin(2 * np.pi * np.cumsum(sweep) / SR) * np.sin(np.pi * t / t[-1]) ** 0.7 * gain


def glitch(sec, gain=0.08):
    """the relay's view: bit-crushed digital noise, stepping"""
    n = int(sec * SR)
    hold = int(SR / 900)
    steps = rng.uniform(-1, 1, n // hold + 1)
    out = np.repeat(steps, hold)[:n]
    out = np.round(out * 3) / 3
    gate = (np.repeat(rng.uniform(0, 1, n // 2400 + 1), 2400)[:n] > 0.35).astype(float)
    return spectral(out * gate, 900, 7000) * env(n, 0.01, 0.04) * gain


def riser(sec, f0, f1, gain=0.06):
    t = t_axis(sec)
    f = f0 * (f1 / f0) ** (t / sec)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(len(t), sec * 0.6, 0.08) * gain


def fall(sec, f0, f1, gain=0.05):
    t = t_axis(sec)
    f = f0 * (f1 / f0) ** (t / sec)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(len(t), 0.05, sec * 0.5) * gain


# ---- the music bed --------------------------------------------------------------
# a slow progression in A major-ish: Fmaj7 · Am9 · Dm9 · Cmaj7 · Fmaj7 · E(sus) · Fmaj9 (end card)

chords = [
    (0.0, 4.0, [53, 57, 60, 64]),
    (3.6, 4.2, [57, 60, 64, 67, 71]),
    (7.4, 4.2, [50, 57, 60, 64, 65]),
    (11.4, 5.9, [48, 55, 59, 64, 67]),
    (17.0, 4.3, [53, 57, 60, 64, 69]),
    (21.0, 4.3, [52, 56, 59, 64, 69]),
    (25.0, 4.0, [53, 57, 60, 64, 67, 72]),
]
for at, sec, notes in chords:
    # each chord rings on under the next one, so there's never a gap
    place(pad([midi(m) for m in notes], sec + 1.8, gain=0.11), max(0, at - 0.3))
    # a soft sub under each chord (kept low: phones can't play it, it only eats headroom)
    sub = np.sin(2 * np.pi * midi(notes[0] - 12) * t_axis(sec + 0.6)) * env(int((sec + 0.6) * SR), 0.8, 1.0) * 0.02
    place(sub, max(0, at - 0.3))

# a sparse mallet line on the beat (~92 bpm), quieter under the busy scenes
beat = 60 / 92
melody = [76, 79, 81, 79, 76, 74, 76, 72, 74, 76, 79, 83, 81, 79, 76, 74]
k = 0
b = 3.6
while b < 24.6:
    m = melody[k % len(melody)]
    busy = 11.4 < b < 21.0
    place(bell(midi(m), 1.4, 0.05 if busy else 0.075), b, pan=0.35 * np.sin(k * 1.7))
    k += 1
    b += beat * (2 if k % 4 == 0 else 1)

# ---- sound effects, timed to Promo.tsx ---------------------------------------------

# 1. the cube falls and lands
place(fall(0.7, 1400, 380, 0.05), 0.05)
place(thump(68, 0.55), 0.75)
place(clink(2400, 0.32), 0.75, pan=-0.1)
place(clink(3100, 0.2), 0.79, pan=0.2)
for i in range(10):  # crystals scattering
    place(clink(3000 + rng.uniform(0, 3000), 0.06), 0.8 + rng.uniform(0, 0.7), pan=rng.uniform(-0.8, 0.8))
for i, m in enumerate([72, 74, 76, 79, 81]):  # the letters of "melty"
    place(pop(midi(m), 0.14), 1.15 + i * 0.08 + 0.12, pan=-0.4 + i * 0.2)
place(whoosh(1.2, 0.07, 3000, 12000, rising=False), 2.0)  # the tagline's shimmer
for i in range(6):
    place(bell(midi(88 + [0, 3, 7, 10, 12, 15][i]), 0.8, 0.03), 2.05 + i * 0.07, pan=rng.uniform(-0.6, 0.6))

# scene changes
for at in (3.45, 7.25, 11.25, 16.85, 20.85, 24.85):
    place(whoosh(0.8, 0.13), at - 0.25)

# 2. open a room: pills, the pick, the ring
for i in range(3):
    place(pop(midi(67 + i * 4), 0.1), 4.3 + i * 0.1 + 0.08)
place(tick(2200, 0.18), 4.6)
place(bell(midi(84), 0.9, 0.08), 4.6)
place(riser(0.8, 300, 1200, 0.05), 4.9)
for i in range(4):  # the clock ticking
    place(tick(1500, 0.05), 5.8 + i * 0.4, pan=0.5)

# 3. typing the link, then the 4 words
for i in range(26):
    place(tick(2600 + rng.uniform(-500, 500), 0.06), 8.0 + i * (1.0 / 26) + rng.uniform(-0.01, 0.01), pan=-0.3)
for i, m in enumerate([72, 76, 79, 84]):
    place(pop(midi(m), 0.2), 9.6 + i * 0.13 + 0.1, pan=-0.5 + i * 0.3)
    place(clink(2800 + i * 300, 0.06), 9.6 + i * 0.13 + 0.1)

# 4. the key exchange: the capsule flies, lands, safety words, the check
place(riser(1.4, 220, 880, 0.035), 12.7)
place(whoosh(1.4, 0.08, 800, 9000), 12.7)
for i in range(8):
    place(clink(4000 + rng.uniform(0, 2000), 0.03), 12.8 + i * 0.16, pan=-0.8 + i * 0.22)
place(bell(midi(79), 1.4, 0.14), 14.1, pan=0.5)
place(bell(midi(86), 1.2, 0.08), 14.12, pan=0.5)
place(clink(2700, 0.15), 14.1, pan=0.5)
for i in range(6):
    for side in (0, 1):
        place(tick(2000 + i * 120, 0.04), 14.45 + i * 0.12 + side * 0.06, pan=-0.6 if side == 0 else 0.6)
for i, m in enumerate([72, 76, 79, 84]):  # the check: a little major arpeggio
    place(bell(midi(m), 1.6, 0.11), 15.75 + i * 0.07)

# 5. the relay: each message glitches while it's sealed
for enter, leave in ((18.528, 18.973), (19.178, 19.623), (19.828, 20.273)):
    place(tick(900, 0.12), enter)
    place(glitch(leave - enter, 0.07), enter)
    place(pop(midi(79), 0.1), leave)
for at in (17.6, 18.25, 18.9):
    place(whoosh(0.6, 0.04, 1500, 8000), at + 0.1, pan=-0.6)

# 6. the countdown, the melt, the drips, the steam
for i in range(3):
    place(tick(1200, 0.16), 21.3 + i * 0.4)
    place(bell(midi(84 - i * 2), 0.6, 0.05), 21.3 + i * 0.4)
place(fall(1.6, 900, 160, 0.06), 22.5)  # the slump
for at in (22.75, 23.15, 23.5, 23.85, 24.1):
    place(drip(0.2, 450 + rng.uniform(0, 200), 1300 + rng.uniform(0, 400)), at, pan=rng.uniform(-0.5, 0.5))
place(whoosh(1.6, 0.06, 2500, 11000, rising=False), 23.6)  # steam

# 7. the end card
place(thump(55, 0.35), 25.12)
for i, m in enumerate([65, 69, 72, 76, 79]):
    place(bell(midi(m), 2.2, 0.08), 25.12 + i * 0.05, pan=-0.4 + i * 0.2)
for i in range(3):  # the chips
    place(pop(midi(76 + i * 3), 0.1), 26.2 + i * 0.15 + 0.1, pan=-0.4 + i * 0.4)
for i in range(5):
    place(clink(3500 + rng.uniform(0, 2500), 0.04), 25.2 + rng.uniform(0, 0.8), pan=rng.uniform(-0.7, 0.7))

# ---- room: a cold, wide reverb, then master -------------------------------------------

def reverb(x, sec=2.6, wet=0.28, seed=1):
    r = np.random.default_rng(seed)
    n = int(sec * SR)
    ir = r.standard_normal(n) * np.exp(-np.arange(n) / (0.55 * SR))
    ir = spectral(ir, 200, 7000)
    ir[: int(0.012 * SR)] = 0  # predelay
    ir /= np.sqrt(np.sum(ir**2))
    m = len(x) + n
    size = 1 << (m - 1).bit_length()
    y = np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[: len(x)]
    return x * (1 - wet) + y * wet


L = spectral(reverb(L, seed=1), lo=40)
R = spectral(reverb(R, seed=2), lo=40)

# fade out at the very end, gentle limiting, -1 dBFS peak
fade = int(1.4 * SR)
L[-fade:] *= np.linspace(1, 0, fade) ** 2
R[-fade:] *= np.linspace(1, 0, fade) ** 2
mix = np.stack([L, R])
mix = np.tanh(mix * 1.6) / np.tanh(1.6)
mix *= 10 ** (-1 / 20) / np.abs(mix).max()

out = sys.argv[1] if len(sys.argv) > 1 else "melty-promo.wav"
with wave.open(out, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mix.T * 32767).astype("<i2").tobytes())
print(f"wrote {out}")
