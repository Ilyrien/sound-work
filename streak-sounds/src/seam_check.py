#!/usr/bin/env python3
"""Seam check for looping audio, measured on the DELIVERED file.

For every channel:

    seam ratio = |y[0] - y[-1]| / max(|diff(y)| over the interior)

The interior excludes 5 ms at each end, so the measurement is not polluted by
the very samples whose continuity it is testing. A ratio below 0.5 means the
wrap is smaller than the biggest step the signal already takes in normal
playback, so it cannot land as a click. Above ~1 it is the single largest
discontinuity in the file and will be heard on headphones.

Run it on the file you are shipping (ogg/opus/flac/wav), never on the source.
Lossy codecs do not preserve a loop point sample-exactly: the first and last
few samples of a decoded Opus stream can move by more than the whole interior
range of a tonal signal, even when the source is perfectly periodic.

    python3 seam_check.py brown.ogg night.ogg pad.flac
"""
import sys

import numpy as np
import soundfile as sf

EDGE_MS = 5.0


def seam_ratio(y, sr):
    d = np.abs(np.diff(y))
    edge = int(EDGE_MS / 1000 * sr)
    interior = d[edge:len(y) - edge]
    return abs(y[0] - y[-1]), interior.max()


def band_share(y, sr, lo, hi):
    f = np.fft.rfft(y)
    fr = np.fft.rfftfreq(len(y), 1 / sr)
    sel = (fr >= lo) & (fr < hi)
    return float(np.sum(np.abs(f[sel]) ** 2) / np.sum(np.abs(f[1:]) ** 2))


def main(paths):
    for path in paths:
        x, sr = sf.read(path, always_2d=True)
        n = len(x)
        ratios = [seam_ratio(x[:, ch], sr) for ch in range(x.shape[1])]
        worst = max(w / m for w, m in ratios)
        verdict = "PASS" if worst < 0.5 else "FAIL"
        parts = " ".join(
            f"ch{ch}:{w / m:.2f} (wrap {w:.5f}, max interior {m:.5f})"
            for ch, (w, m) in enumerate(ratios)
        )
        line = f"{path}  dur={n / sr:.3f}s  seam {parts}  {verdict}"
        if x.shape[1] == 2:
            left, right = x[:, 0], x[:, 1]
            corr = float(np.corrcoef(left, right)[0, 1])
            mid, side = (left + right) / 2, (left - right) / 2
            side_mid = 20 * np.log10(
                max(np.sqrt(np.mean(side ** 2)), 1e-12)
                / max(np.sqrt(np.mean(mid ** 2)), 1e-12)
            )
            line += (
                f"  L/R corr={corr:.3f} side/mid={side_mid:.1f}dB"
                f"  2-5k share={band_share((left + right) / 2, sr, 2000, 5000) * 100:.1f}%"
            )
        print(line)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1:])
