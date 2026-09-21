# Measurements

Everything below is measured on the **delivered file after decoding**, not on
the source. That distinction is the whole point of this document: the first
version of `pad.ogg` was built from a perfectly periodic source and still
clicked, because the encoder moved the loop point.

Reproduce any row with `src/seam_check.py`.

## The seam test

For each channel:

```
seam ratio = |y[0] - y[-1]| / max(|diff(y)| over the interior)
```

The interior excludes 5 ms at each end. A ratio under 0.5 means the wrap is
smaller than the biggest step the signal already takes in normal playback, so
it cannot be heard as a click. Above ~1 it is the largest discontinuity in the
file.

## Delivered files

| file | codec | length | size | LUFS-I | true peak | seam ch0 / ch1 | L/R corr | side/mid |
|---|---|---|---|---|---|---|---|---|
| `brown.ogg` | Opus 64 kbps VBR | 60 s | 424 KB | −16.8 | −2.3 dBTP | 0.07 / 0.31 | −0.00 | 0.0 dB |
| `night.ogg` | Opus 64 kbps VBR | 48 s | 453 KB | −17.0 | −5.0 dBTP | 0.05 / 0.07 | 0.35 | −3.2 dB |
| `pad.flac` | FLAC (lossless) | 60 s | 3.16 MB | −17.0 | −6.5 dBTP | 0.18 / 0.13 | 0.96 | −17.4 dB |

All three pass. `brown.ogg` and `night.ogg` are noise-based, so the wrap sits
inside the step range the noise already has; `pad.flac` is tonal, where any
edge error stands out, and is shipped lossless so the loop point is exact.

## How each file was produced

Sources are synthesized from scratch by the scripts in `src/` (no recordings,
no samples). Then:

```
python3 src/make_brown_pad.py          # -> brown_raw.wav, pad_raw.wav
python3 src/make_night.py              # -> night3_raw.wav

ffmpeg -i brown_raw.wav -af volume=0.98  -c:a libopus -b:a 64k -vbr on brown.ogg
ffmpeg -i night3_raw.wav -af volume=1.148 -c:a libopus -b:a 64k -vbr on night.ogg
ffmpeg -i pad_raw.wav   -af volume=1.585 -c:a flac -compression_level 8 pad.flac
```

The `volume=` values set loudness to −17.0 LUFS-I, matching the existing
`rain.ogg`. The gain is applied *before* the encode and the loudness is
re-measured on the encoded output, because the codec moves it a little
(`brown.ogg` lands at −16.8; 0.2 dB off the others, inaudible next to the
existing asset).

## Why `pad.ogg` was replaced

The pad source is exact: seam ratio 0.18 / 0.13, identical in the raw wav and
in the FLAC. The same source encoded to Opus 56 kbps decodes to 2.24 / 1.85:
the wrap becomes the single largest step in the minute, roughly 2.2× the next
worst, and the last three samples jump by ~4× the interior maximum. Lossy Opus
does not preserve the loop point sample-exactly, and how badly it misses is not
monotonic in bitrate for this file:

| Opus bitrate | seam ch0 / ch1 |
|---|---|
| 56 kbps | 0.53 / 1.26 |
| 96 kbps | 1.64 / 1.09 |
| 128 kbps | 1.03 / 0.32 |
| 192 kbps | 1.05 / 0.31 |
| 224 kbps | 0.50 / 0.24 |
| 256 kbps | 0.17 / 0.20 |
| CBR 192 kbps | 1.53 / 0.90 |
| lowdelay 96 kbps | 0.08 / 0.79 |

The only bitrate that reliably passed was 256 kbps, which costs the same as
FLAC (2.9 MB), so lossless is strictly better here. If you would rather keep a
single container across all built-in sounds, `-b:a 256k` passes this file; it
is just not a guarantee, and the seam test has to be re-run on whatever comes
out.

The two noise loops do not have this problem: for broadband noise the codec's
edge error is the same size as the noise's own sample-to-sample steps, so it is
masked. That is why they stay Opus.

## What changed in `night.ogg`

Two things, both measured on the delivered file:

- **Stereo.** The first version was effectively mono: L/R correlation 0.984,
  side 20.8 dB under mid. The bed's two channels were the same noise scaled
  0.96 and 1.04. It is now independent noise per channel: correlation 0.35,
  side/mid −3.2 dB.
- **The floor between chirps.** The first version ran a band-limited texture
  continuously for the whole 48 s (0.20 of the pulse peak) under every
  cricket. Measured on a 20 ms RMS envelope of the 2–5 kHz band, the quiet
  tenth of the file sat 12.6 dB under the peaks; it now sits 15.2 dB under, a
  3.8 dB deeper floor, so the chirps read as events over the bed instead of
  tones riding on a constant hiss.
