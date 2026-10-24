/* Delivered-file check — pure measurement functions.
   No DOM. Runs in the browser page and under node (for tests).
   Everything here measures the file you hand it, not the file you meant to ship. */
(function (root) {
  'use strict';

  var DB = function (x) { return 20 * Math.log10(Math.max(x, 1e-12)); };

  function channelsOf(buffer) {
    var ch = [];
    for (var c = 0; c < buffer.numberOfChannels; c++) ch.push(buffer.getChannelData(c));
    return ch;
  }

  function peakDb(chans) {
    var m = 0;
    for (var c = 0; c < chans.length; c++) {
      var d = chans[c];
      for (var i = 0; i < d.length; i++) { var a = d[i] < 0 ? -d[i] : d[i]; if (a > m) m = a; }
    }
    return DB(m);
  }

  function rmsDb(chans) {
    var n = chans[0].length, sum = 0;
    for (var c = 0; c < chans.length; c++) {
      var d = chans[c];
      for (var i = 0; i < n; i++) sum += d[i] * d[i];
    }
    return DB(Math.sqrt(sum / (n * chans.length)));
  }

  function dcOffset(chans) {
    var n = chans[0].length, out = [];
    for (var c = 0; c < chans.length; c++) {
      var d = chans[c], sum = 0;
      for (var i = 0; i < n; i++) sum += d[i];
      out.push(sum / n);
    }
    return out;
  }

  /* Dead ends: leading and trailing runs where EVERY channel is at or below the
     gate. Reported separately for exact digital silence (zeros a codec added)
     and for quiet (a fade, or a performance that starts late). */
  function deadEnds(chans, sr, quietDb) {
    var q = Math.pow(10, (quietDb === undefined ? -60 : quietDb) / 20);
    var n = chans[0].length, c, i;
    function quietAt(i) {
      for (c = 0; c < chans.length; c++) { var a = chans[c][i]; if (a < 0) a = -a; if (a > q) return false; }
      return true;
    }
    function zeroAt(i) {
      for (c = 0; c < chans.length; c++) if (chans[c][i] !== 0) return false;
      return true;
    }
    var headQ = 0, tailQ = 0, headZ = 0, tailZ = 0;
    while (headQ < n && quietAt(headQ)) headQ++;
    while (tailQ < n && quietAt(n - 1 - tailQ)) tailQ++;
    while (headZ < n && zeroAt(headZ)) headZ++;
    while (tailZ < n && zeroAt(n - 1 - tailZ)) tailZ++;
    return {
      sampleRate: sr,
      headQuietFrames: headQ, tailQuietFrames: tailQ,
      headZeroFrames: headZ, tailZeroFrames: tailZ,
      headQuietMs: headQ * 1000 / sr, tailQuietMs: tailQ * 1000 / sr,
      headZeroMs: headZ * 1000 / sr, tailZeroMs: tailZ * 1000 / sr,
      quietThresholdDb: quietDb === undefined ? -60 : quietDb
    };
  }

  /* Sample-to-sample step statistics, per channel. This is the material's own
     habit: broadband noise steps hard everywhere, a drone barely steps at all,
     so the same absolute step is a fault in one and normal in the other. */
  function stepStats(d) {
    var n = d.length, i, s, sum2 = 0, count = 0, hist = null;
    var sorted = null;
    var steps = new Float32Array(Math.max(0, n - 1));
    for (i = 1; i < n; i++) { s = d[i] - d[i - 1]; steps[i - 1] = s < 0 ? -s : s; sum2 += s * s; count++; }
    var rms = count ? Math.sqrt(sum2 / count) : 0;
    // 99.9th percentile via sort of a strided subsample (cheap, honest: the gate is an order of magnitude)
    var sub = [];
    var stride = Math.max(1, Math.floor(count / 400000));
    for (i = 0; i < count; i += stride) sub.push(steps[i]);
    sub.sort(function (a, b) { return a - b; });
    var p999 = sub.length ? sub[Math.min(sub.length - 1, Math.floor(sub.length * 0.999))] : 0;
    var p50 = sub.length ? sub[Math.floor(sub.length * 0.5)] : 0;
    return { stepRms: rms, stepRmsDb: DB(rms), stepP999: p999, stepP999Db: DB(p999), stepP50: p50, stepP50Db: DB(p50) };
  }

  /* Steps in the material right at the two ends (default 100 ms). The wrap has to
     be judged against these, not against zero: a noise bed steps hard everywhere,
     a drone barely steps at all, and the same absolute step is a fault in one and
     normal in the other. */
  function boundarySteps(d, sr, ms) {
    var w = Math.max(64, Math.round((ms || 100) * sr / 1000));
    var n = d.length, head = Math.min(w, n), tail = Math.min(w, n);
    var sub = [], i, s;
    for (i = 1; i < head; i++) { s = d[i] - d[i - 1]; sub.push(s < 0 ? -s : s); }
    for (i = Math.max(1, n - tail); i < n; i++) { s = d[i] - d[i - 1]; sub.push(s < 0 ? -s : s); }
    sub.sort(function (a, b) { return a - b; });
    var q = function (p) { return sub.length ? sub[Math.min(sub.length - 1, Math.floor(sub.length * p))] : 0; };
    return { p999: q(0.999), max: sub.length ? sub[sub.length - 1] : 0, count: sub.length };
  }

  /* The wrap: what happens between the last sample and the first one if this
     file loops. Signed, never magnitude: the direction is the sound.
     Judged against the material's own steps, not against zero. */
  function wrap(chans, sr) {
    var p = peakDb(chans), out = [];
    for (var c = 0; c < chans.length; c++) {
      var d = chans[c], n = d.length;
      var step = d[0] - d[n - 1];
      var st = stepStats(d);
      var bs = boundarySteps(d, sr);
      out.push({
        channel: c,
        signedStep: step,
        stepDb: DB(Math.abs(step)),
        stepRelPeakDb: DB(Math.abs(step)) - p,
        stats: st,
        boundary: bs,
        // how the wrap step compares to the file's own steps, globally and at the ends
        vsP999Db: DB(Math.abs(step)) - st.stepP999Db,
        vsLocalDb: DB(Math.abs(step)) - DB(bs.p999)
      });
    }
    return {
      peakDb: p,
      channels: out,
      worstVsP999Db: Math.max.apply(null, out.map(function (x) { return x.vsP999Db; })),
      worstVsLocalDb: Math.max.apply(null, out.map(function (x) { return x.vsLocalDb; }))
    };
  }

  /* Loudest 20 ms window against the file's own RMS: how much the piece slams. */
  function crest(chans, sr) {
    var win = Math.max(1, Math.round(sr * 0.02)), n = chans[0].length;
    var best = 0, at = 0;
    for (var s = 0; s + win <= n; s += win) {
      var m = 0;
      for (var c = 0; c < chans.length; c++) {
        var d = chans[c];
        for (var i = s; i < s + win; i++) { var a = d[i] < 0 ? -d[i] : d[i]; if (a > m) m = a; }
      }
      if (m > best) { best = m; at = s / sr; }
    }
    var rms = rmsDb(chans);
    return { shortTermPeakDb: DB(best), atSec: at, crestDb: DB(best) - rms, rmsDb: rms };
  }

  /* --- Spectrum: octave-band energy, dBFS. --- */
  function fft(re, im) {
    var n = re.length, i, j, k, m, len, ang, wr, wi, tr, ti, ur, ui, vr, vi;
    for (i = 1, j = 0; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { tr = re[i]; re[i] = re[j]; re[j] = tr; ti = im[i]; im[i] = im[j]; im[j] = ti; }
    }
    for (len = 2; len <= n; len <<= 1) {
      ang = -2 * Math.PI / len;
      wr = Math.cos(ang); wi = Math.sin(ang);
      for (i = 0; i < n; i += len) {
        ur = 1; ui = 0;
        for (m = 0; m < len / 2; m++) {
          k = i + m + len / 2;
          vr = re[k] * ur - im[k] * ui;
          vi = re[k] * ui + im[k] * ur;
          re[k] = re[i + m] - vr; im[k] = im[i + m] - vi;
          re[i + m] += vr; im[i + m] += vi;
          var nw = ur * wr - ui * wi; ui = ur * wi + ui * wr; ur = nw;
        }
      }
    }
  }

  var BANDS = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

  function bandLevels(chans, sr, maxFrames) {
    var N = 2048;
    while (N * 2 <= sr * 0.09 && N < 16384) N *= 2;
    var hop = N / 2, n = chans[0].length;
    var frames = Math.max(1, Math.min(maxFrames || 200, Math.floor((n - N) / hop) + 1));
    var P = new Float64Array(N / 2), used = 0;
    var w = new Float64Array(N), i, wsum = 0;
    for (i = 0; i < N; i++) { w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)); wsum += w[i]; }
    var strideF = Math.max(1, Math.floor((n - N) / (hop * frames)));
    for (var f = 0; f < frames; f++) {
      var off = f * hop * strideF;
      if (off + N > n) break;
      var re = new Float64Array(N), im = new Float64Array(N);
      for (i = 0; i < N; i++) {
        var s = 0;
        for (var c = 0; c < chans.length; c++) s += chans[c][off + i];
        re[i] = (s / chans.length) * w[i] / wsum;
      }
      fft(re, im);
      for (i = 0; i < N / 2; i++) P[i] += (re[i] * re[i] + im[i] * im[i]);
      used++;
    }
    if (used) for (i = 0; i < N / 2; i++) P[i] /= used;
    var nyq = sr / 2, out = [];
    var edges = [BANDS[0] / Math.SQRT2].concat(BANDS.map(function (b) { return b * Math.SQRT2; }));
    for (var b = 0; b < BANDS.length; b++) {
      var lo = edges[b], hi = edges[b + 1];
      if (lo >= nyq) break;
      var k0 = Math.max(1, Math.round(lo * N / sr)), k1 = Math.min(N / 2 - 1, Math.round(hi * N / sr));
      var e = 0;
      for (i = k0; i <= k1; i++) e += P[i];
      out.push({ center: BANDS[b], lo: lo, hi: Math.min(hi, nyq), db: DB(Math.sqrt(e)) });
    }
    return { frameSize: N, frames: used, bands: out };
  }

  function analyze(chans, sr) {
    var ends = deadEnds(chans, sr);
    var w = wrap(chans, sr);
    var cr = crest(chans, sr);
    var bands = bandLevels(chans, sr);
    var res = {
      sampleRate: sr,
      channels: chans.length,
      frames: chans[0].length,
      durationSec: chans[0].length / sr,
      peakDb: peakDb(chans),
      rmsDb: rmsDb(chans),
      dc: dcOffset(chans),
      ends: ends,
      wrap: w,
      crest: cr,
      spectrum: bands
    };
    res.verdicts = verdicts(res);
    return res;
  }

  /* Plain-language findings. Every verdict names the number and the gate it came
     from, because a verdict without its gate is just an opinion. */
  function verdicts(r) {
    var v = [], e = r.ends, w = r.wrap, cr = r.crest;
    var ms = function (x) { return x.toFixed(1) + ' ms'; };

    if (e.headZeroMs >= 1) {
      v.push({
        level: e.headZeroMs >= 5 ? 'warn' : 'note',
        text: ms(e.headZeroMs) + ' of exact digital silence at the head (' + e.headZeroFrames +
          ' frames). Encoders add this: LAME puts about 25 ms (1105 samples at 44.1 kHz) at the head of an mp3. ' +
          'Harmless on a one-shot. In a loop the file opens in a hole.'
      });
    }
    if (e.tailZeroMs >= 1) {
      v.push({ level: e.tailZeroMs >= 5 ? 'warn' : 'note', text: ms(e.tailZeroMs) + ' of exact digital silence at the tail (' + e.tailZeroFrames + ' frames).' });
    }
    if (e.headQuietFrames > e.headZeroFrames && e.headQuietMs - e.headZeroMs >= 20) {
      v.push({ level: 'note', text: 'Below ' + e.quietThresholdDb + ' dBFS for the first ' + ms(e.headQuietMs) + ' counting the zeros. A fade reads here; so does a piece that starts later than you think.' });
    }
    if (e.tailQuietFrames > e.tailZeroFrames && e.tailQuietMs - e.tailZeroMs >= 20) {
      v.push({ level: 'note', text: 'Below ' + e.quietThresholdDb + ' dBFS for the last ' + ms(e.tailQuietMs) + ' counting the zeros.' });
    }

    var signed = w.channels.map(function (c) { return c.signedStep.toFixed(4); }).join(', ');
    if (e.headZeroMs + e.tailZeroMs >= 5) {
      v.push({
        level: 'warn',
        text: 'Looping this file places ' + ms(e.headZeroMs + e.tailZeroMs) + ' of silence at the wrap. ' +
          'Rotating the loop point cannot repair it: the two ends were never neighbours. Crossfade the wrap, ' +
          'or export from a source with no padding.'
      });
    } else if (w.worstVsLocalDb >= 6) {
      v.push({
        level: 'warn',
        text: 'The wrap step is ' + w.worstVsLocalDb.toFixed(1) + ' dB harder than the steps this material makes at its own ends ' +
          '(signed: ' + signed + '). That is a click in a loop, and it will be the same click every pass.'
      });
    } else if (w.worstVsLocalDb >= 0) {
      v.push({ level: 'note', text: 'The wrap step is ' + w.worstVsLocalDb.toFixed(1) + ' dB over the material\'s own end-of-file steps (signed: ' + signed + '). Borderline: measure it in the context it plays in.' });
    } else {
      v.push({ level: 'ok', text: 'The wrap step is no harder than the steps the material already makes at its ends (' + w.worstVsLocalDb.toFixed(1) + ' dB). No step on paper.' });
    }

    if (cr.crestDb > 24 && cr.shortTermPeakDb > -3) {
      v.push({
        level: 'note',
        text: 'The loudest 20 ms sits at ' + cr.shortTermPeakDb.toFixed(1) + ' dBFS (' + cr.atSec.toFixed(2) + ' s) while the file averages ' +
          cr.rmsDb.toFixed(1) + ' dBFS RMS. Something that short and that close to the ceiling is often being limited flat; check it still has its shape.'
      });
    }

    var dcMax = 0;
    for (var i = 0; i < r.dc.length; i++) dcMax = Math.max(dcMax, Math.abs(r.dc[i]));
    if (dcMax > 0.01) {
      v.push({ level: 'note', text: 'DC offset ' + DB(dcMax).toFixed(1) + ' dBFS. It eats headroom and can thump on start and stop.' });
    }

    var bands = r.spectrum.bands;
    if (bands.length) {
      var wide = bands[3] || bands[2];
      if (wide) {
        var top = bands[bands.length - 1], low = bands[0];
        if (top.db - wide.db > 0) {
          v.push({ level: 'note', text: 'The top octave (' + Math.round(top.center) + ' Hz) sits ' + (top.db - wide.db).toFixed(1) + ' dB above the ' + Math.round(wide.center) + ' Hz band. A bright top is a real sound, and it is also the thing a room and a codec will change most.' });
        }
      }
    }
    return v;
  }

  var api = {
    analyze: analyze, deadEnds: deadEnds, wrap: wrap, stepStats: stepStats,
    peakDb: peakDb, rmsDb: rmsDb, bandLevels: bandLevels, channelsOf: channelsOf, BANDS: BANDS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AudioCheck = api;
})(this);
