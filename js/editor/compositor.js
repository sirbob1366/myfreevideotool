/* Compositor: real-time rAF composite of all layers to the preview canvas,
   live audio mix via Web Audio, transport (play/pause/shuttle), transitions.
   Preview renders at ≤720p internally; export drives it at full res. */
(function (global) {
  'use strict';
  var S = global.EdState;
  var L = global.EdLayers;

  var C = {
    canvas: null,
    ctx: null,
    scale: 1,            // internal px per project px
    raf: 0,
    lastTick: 0,
    audioCtx: null,
    master: null,
    exportDest: null,    // MediaStreamAudioDestinationNode during export
    gains: {},           // layerId -> GainNode
    sources: {},         // mediaId -> MediaElementAudioSourceNode
    exporting: false,
    onFrame: null        // hook(t) for UI updates
  };

  C.init = function (canvas) {
    C.canvas = canvas;
    C.ctx = canvas.getContext('2d');
    C.resize();
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && S.playing && !C.exporting) C.pause();
    });
  };

  C.resize = function () {
    var p = S.project;
    // internal resolution: cap the short side at 720 for preview
    var shortSide = Math.min(p.canvas.w, p.canvas.h);
    C.scale = Math.min(1, 720 / shortSide);
    C.canvas.width = Math.round(p.canvas.w * C.scale);
    C.canvas.height = Math.round(p.canvas.h * C.scale);
    // display size: fit inside the preview area, preserving aspect — without
    // this a 9:16 canvas renders at raw pixel size and bleeds behind the UI
    var wrap = C.canvas.closest('.ed-preview-wrap');
    if (wrap) {
      var availW = Math.max(120, wrap.clientWidth - 36);
      var availH = Math.max(120, wrap.clientHeight - 36);
      var fit = Math.min(availW / p.canvas.w, availH / p.canvas.h);
      C.canvas.style.width = Math.floor(p.canvas.w * fit) + 'px';
      C.canvas.style.height = Math.floor(p.canvas.h * fit) + 'px';
    }
    C.render(S.time);
  };

  // ---------- audio graph ----------
  C.ensureAudio = function () {
    if (!C.audioCtx) {
      C.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      C.master = C.audioCtx.createGain();
      C.master.connect(C.audioCtx.destination);
    }
    if (C.audioCtx.state === 'suspended') C.audioCtx.resume();
    return C.audioCtx;
  };

  // 2s decaying-noise impulse for the per-layer convolution reverb
  var _impulse = null;
  function impulse(ctx) {
    if (_impulse) return _impulse;
    var len = ctx.sampleRate * 2;
    _impulse = ctx.createBuffer(2, len, ctx.sampleRate);
    for (var c = 0; c < 2; c++) {
      var d = _impulse.getChannelData(c);
      for (var i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4);
      }
    }
    return _impulse;
  }

  // Per-layer audio chain: source ─ EQ(low/mid/high) ─ pan ─┬─ dry ──┬─ volume ─ master
  //                                                          └─ verb ─┘
  // Exports tap the same graph, so EQ/pan/reverb are baked into the output.
  C.chains = {};
  C.refreshAudio = function (l) {
    var ch = C.chains[l.id];
    if (!ch) return;
    var eq = l.eq || { low: 0, mid: 0, high: 0 };
    ch.low.gain.value = eq.low;
    ch.mid.gain.value = eq.mid;
    ch.high.gain.value = eq.high;
    if (ch.panner) ch.panner.pan.value = l.pan || 0;
    var r = l.reverb || 0;
    ch.wet.gain.value = r * 0.9;
    ch.dry.gain.value = 1 - r * 0.35;
  };

  function gainFor(l, m) {
    var ctx = C.ensureAudio();
    var el = m.kind === 'video' ? m.videoEl : m.audioEl;
    if (!el) return null;
    if (!C.sources[m.id]) {
      try {
        C.sources[m.id] = ctx.createMediaElementSource(el);
      } catch (e) { return null; }
    }
    if (!C.gains[l.id]) {
      // A media element can back several layers (e.g. after a split): the source
      // fans out to one chain per layer — never disconnect previous connections,
      // inactive layers simply have their volume driven to 0.
      var low = ctx.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 200;
      var mid = ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 1000; mid.Q.value = 0.9;
      var high = ctx.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 4200;
      var panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      var dry = ctx.createGain();
      var wet = ctx.createGain(); wet.gain.value = 0;
      var conv = ctx.createConvolver(); conv.buffer = impulse(ctx);
      var out = ctx.createGain();

      C.sources[m.id].connect(low);
      low.connect(mid);
      mid.connect(high);
      var tail = high;
      if (panner) { high.connect(panner); tail = panner; }
      tail.connect(dry); dry.connect(out);
      tail.connect(conv); conv.connect(wet); wet.connect(out);
      out.connect(C.master);
      if (C.exportDest) out.connect(C.exportDest);

      C.chains[l.id] = { low: low, mid: mid, high: high, panner: panner, dry: dry, wet: wet, out: out };
      C.gains[l.id] = out; // export-dest wiring iterates C.gains
      C.refreshAudio(l);
    }
    return C.gains[l.id];
  }

  C.connectExportDest = function (dest) {
    C.exportDest = dest;
    Object.keys(C.gains).forEach(function (id) {
      try { C.gains[id].connect(dest); } catch (e) {}
    });
  };
  C.disconnectExportDest = function () {
    if (!C.exportDest) return;
    Object.keys(C.gains).forEach(function (id) {
      try { C.gains[id].disconnect(C.exportDest); } catch (e) {}
    });
    C.exportDest = null;
  };

  // ---------- media element sync ----------
  function mediaTime(l, t) {
    return (t - l.start) * l.speed + l.inPoint;
  }

  function syncMedia(t, playing) {
    var active = {};
    S.activeAt(t).forEach(function (l) {
      if ((l.type !== 'video' && l.type !== 'audio') || !l.srcId) return;
      var m = S.media[l.srcId];
      if (!m) return;
      var el = m.kind === 'video' ? m.videoEl : m.audioEl;
      if (!el) return;
      active[l.id] = true;

      var want = mediaTime(l, t);
      if (want > (m.duration || Infinity)) return;

      var g = gainFor(l, m);
      if (g) {
        var env = L.envelope(l, t, S.project.canvas.w);
        var vol = l.muted ? 0 : l.volume * env.alpha;
        g.gain.setTargetAtTime(vol, C.audioCtx.currentTime, 0.03);
      }
      if (S.rate > 0 && el.playbackRate !== l.speed * S.rate) {
        try { el.playbackRate = Math.min(4, Math.max(0.25, l.speed * S.rate)); } catch (e) {}
      }
      try { el.preservesPitch = l.pitchCorrect; } catch (e) {}

      if (playing && S.rate > 0) {
        // never re-seek an element that is still completing a seek — issuing a
        // new seek every frame starves the decoder and playback appears frozen
        if (!el.seeking && Math.abs(el.currentTime - want) > 0.3) el.currentTime = want;
        if (el.paused) el.play().catch(function () {});
      } else {
        if (!el.paused) el.pause();
        if (!el.seeking && Math.abs(el.currentTime - want) > 0.04) { try { el.currentTime = want; } catch (e) {} }
      }
    });
    // pause inactive media
    Object.keys(S.media).forEach(function (mid) {
      var m = S.media[mid];
      var el = m.videoEl || m.audioEl;
      if (!el || el.paused) return;
      var used = S.activeAt(t).some(function (l) { return l.srcId === mid && active[l.id]; });
      if (!used) el.pause();
    });
    // mute gains of inactive layers
    Object.keys(C.gains).forEach(function (lid) {
      if (!active[lid] && C.audioCtx) C.gains[lid].gain.setTargetAtTime(0, C.audioCtx.currentTime, 0.02);
    });
  }

  // ---------- transitions ----------
  function prevClipOnTrack(l) {
    var best = null;
    S.project.layers.forEach(function (o) {
      if (o.id === l.id || o.track !== l.track) return;
      var end = o.start + o.duration;
      if (Math.abs(end - l.start) < 0.08 && (!best || end > best.start + best.duration)) best = o;
    });
    return best;
  }

  // ---------- render ----------
  C.render = function (t, targetCtx, targetScale) {
    var ctx = targetCtx || C.ctx;
    var sc = targetScale || C.scale;
    var p = S.project;
    if (!p) return;

    ctx.setTransform(sc, 0, 0, sc, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, p.canvas.w, p.canvas.h);

    var order = S.renderOrder();
    order.forEach(function (l) {
      if (!l.visible || l.type === 'audio') return;
      var inWindow = t >= l.start && t < l.start + l.duration;

      // transition handling: during l's transIn window also draw predecessor
      if (inWindow && l.transIn && l.transIn.dur > 0) {
        var local = t - l.start;
        if (local < l.transIn.dur) {
          var prog = local / l.transIn.dur;
          var prev = prevClipOnTrack(l);
          var type = l.transIn.type;
          if (type === 'crossfade') {
            if (prev) drawHeld(ctx, prev, t, 1 - prog);
            drawWithAlpha(ctx, l, t, prog);
            return;
          }
          if (type === 'fadeblack') {
            if (prog < 0.5) {
              if (prev) drawHeld(ctx, prev, t, 1);
              veil(ctx, p, prog * 2);
            } else {
              drawWithAlpha(ctx, l, t, 1);
              veil(ctx, p, (1 - prog) * 2);
            }
            return;
          }
          if (type === 'slide') {
            if (prev) drawHeld(ctx, prev, t, 1, -prog * p.canvas.w);
            drawWithAlpha(ctx, l, t, 1, (1 - prog) * p.canvas.w);
            return;
          }
        }
      }
      if (inWindow) L.draw(ctx, l, t, p);
    });

    L.drawSubtitles(ctx, t, p);
  };

  function drawWithAlpha(ctx, l, t, alpha, shiftX) {
    ctx.save();
    ctx.globalAlpha = alpha;
    if (shiftX) ctx.translate(shiftX, 0);
    L.draw(ctx, l, t, S.project);
    ctx.restore();
  }
  // draw an ended clip holding its last frame (for transitions)
  function drawHeld(ctx, l, t, alpha, shiftX) {
    ctx.save();
    ctx.globalAlpha = alpha;
    if (shiftX) ctx.translate(shiftX, 0);
    L.draw(ctx, l, Math.min(t, l.start + l.duration - 0.001), S.project);
    ctx.restore();
  }
  function veil(ctx, p, a) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, Math.max(0, a));
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, p.canvas.w, p.canvas.h);
    ctx.restore();
  }

  // ---------- transport ----------
  // While playing forward, slave the project clock to the first active video
  // layer's media clock — wall-clock time drifts from the decoder under load,
  // and chasing that drift with seeks is what made playback stutter.
  function masterClockTime(t) {
    var best = null;
    S.activeAt(t).forEach(function (l) {
      if (best || l.type !== 'video' || !l.srcId) return;
      var m = S.media[l.srcId];
      if (m && m.videoEl && !m.videoEl.paused && !m.videoEl.seeking) best = { l: l, el: m.videoEl };
    });
    if (!best) return null;
    return best.l.start + (best.el.currentTime - best.l.inPoint) / best.l.speed;
  }

  function tick(now) {
    if (!S.playing) return;
    var dt = (now - C.lastTick) / 1000;
    C.lastTick = now;
    S.time += dt * S.rate;

    if (S.rate > 0) {
      var mt = masterClockTime(S.time);
      if (mt !== null && Math.abs(mt - S.time) > 0.06) S.time = mt;
    }

    var dur = S.duration();
    if (S.loop && S.time > S.loop.end) S.time = S.loop.start;
    if (S.time >= dur) { S.time = dur; C.pause(); }
    if (S.time < 0) { S.time = 0; C.pause(); }

    syncMedia(S.time, S.rate > 0);
    C.render(S.time);
    if (C.onFrame) C.onFrame(S.time);
    C.raf = requestAnimationFrame(tick);
  }

  C.play = function (rate) {
    C.ensureAudio();
    S.rate = rate || 1;
    if (S.playing) { C.lastTick = performance.now(); return; }
    if (S.time >= S.duration() - 0.02) S.time = S.loop ? S.loop.start : 0;
    S.playing = true;
    C.lastTick = performance.now();
    S.emit('transport');
    C.raf = requestAnimationFrame(tick);
  };

  C.pause = function () {
    S.playing = false;
    S.rate = 1;
    cancelAnimationFrame(C.raf);
    syncMedia(S.time, false);
    S.emit('transport');
    if (C.onFrame) C.onFrame(S.time);
  };

  C.toggle = function () { S.playing ? C.pause() : C.play(1); };

  C.seek = function (t) {
    S.time = Math.max(0, Math.min(S.duration(), t));
    syncMedia(S.time, S.playing && S.rate > 0);
    C.render(S.time);
    if (C.onFrame) C.onFrame(S.time);
  };

  C.step = function (frames) {
    C.pause();
    C.seek(S.time + frames / 30);
  };

  // J/K/L shuttle
  C.shuttle = function (dir) {
    if (dir === 0) { C.pause(); return; }
    if (dir > 0) {
      var next = S.playing && S.rate >= 1 ? Math.min(4, S.rate * 2) : 1;
      C.play(next);
    } else {
      // reverse scrub: negative rate, media paused & seeked per frame (no audio)
      C.ensureAudio();
      var nextR = S.playing && S.rate <= -1 ? Math.max(-4, S.rate * 2) : -1;
      S.rate = nextR;
      if (!S.playing) {
        S.playing = true;
        C.lastTick = performance.now();
        S.emit('transport');
        C.raf = requestAnimationFrame(tick);
      }
    }
  };

  global.EdComp = C;
})(window);
