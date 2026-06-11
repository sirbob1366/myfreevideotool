/* Timeline dock: multitrack lanes, drag/trim/restack, snapping, zoom,
   ruler + playhead, split/ripple/duplicate/copy-paste, transitions UI. */
(function (global) {
  'use strict';
  var S = global.EdState;
  var C = global.EdComp;

  var T = {
    pxPerSec: 60,
    scrollEl: null,
    innerEl: null,
    rulerCanvas: null,
    tracksEl: null,
    playheadEl: null,
    loopEl: null,
    guideEl: null,
    clipboard: null,
    _thumbCache: {}   // mediaId -> dataURL strip
  };

  T.init = function (root) {
    T.scrollEl = root.querySelector('.tl-scroll');
    T.innerEl = root.querySelector('.tl-inner');
    T.rulerCanvas = root.querySelector('.tl-ruler canvas');
    T.tracksEl = root.querySelector('.tl-tracks');
    T.playheadEl = root.querySelector('.tl-playhead');
    T.loopEl = root.querySelector('.tl-loop');
    T.guideEl = root.querySelector('.snap-guide');

    root.querySelector('.tl-ruler').addEventListener('pointerdown', onRulerDown);
    T.scrollEl.addEventListener('wheel', function (e) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      var before = (e.clientX - T.scrollEl.getBoundingClientRect().left + T.scrollEl.scrollLeft) / T.pxPerSec;
      T.setZoom(T.pxPerSec * (e.deltaY < 0 ? 1.2 : 1 / 1.2));
      T.scrollEl.scrollLeft = before * T.pxPerSec - (e.clientX - T.scrollEl.getBoundingClientRect().left);
    }, { passive: false });

    // ---- drop media from the bin directly onto a lane at a time ----
    function isMediaDrag(e) {
      return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'text/mfvt-media') >= 0;
    }
    function dropPos(e) {
      var ir = T.innerEl.getBoundingClientRect();
      var t = Math.max(0, (e.clientX - ir.left) / T.pxPerSec);
      var tr = T.tracksEl.getBoundingClientRect();
      var track = Math.max(0, Math.min(S.trackCount() - 1, Math.floor((e.clientY - tr.top) / 52)));
      return { t: applySnap(t, null, e.altKey).t, track: track };
    }
    function clearDropHints() {
      showGuide(null);
      Array.prototype.forEach.call(T.tracksEl.children, function (tr) { tr.classList.remove('droptarget'); });
    }
    T.scrollEl.addEventListener('dragover', function (e) {
      if (!isMediaDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      var pos = dropPos(e);
      showGuide(pos.t);
      Array.prototype.forEach.call(T.tracksEl.children, function (tr, i) {
        tr.classList.toggle('droptarget', i === pos.track);
      });
    });
    T.scrollEl.addEventListener('dragleave', function (e) {
      if (e.target === T.scrollEl) clearDropHints();
    });
    T.scrollEl.addEventListener('drop', function (e) {
      if (!isMediaDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      clearDropHints();
      var id = e.dataTransfer.getData('text/mfvt-media');
      var m = S.media[id];
      if (!m) return;
      var pos = dropPos(e);
      S.commit('drop media');
      var l = S.defaultLayer(m.kind);
      l.name = m.name;
      l.srcId = m.id;
      if (m.kind !== 'image') l.duration = m.duration || 5;
      if (m.kind === 'video') l.scale = Math.min(S.project.canvas.w / m.w, S.project.canvas.h / m.h);
      if (m.kind === 'image') l.scale = Math.min(S.project.canvas.w / m.w, S.project.canvas.h / m.h) * 0.5;
      l.start = pos.t;
      l.track = pos.track;
      S.project.layers.push(l);
      S.emit('layers');
      S.select(l.id);
      if (global.EdUI) global.EdUI.toast('Placed ' + m.name + ' at ' + pos.t.toFixed(1) + 's');
    });

    S.on('layers', T.rebuild);
    S.on('project', T.rebuild);
    S.on('select', T.refreshSelection);
    T.rebuild();
  };

  T.setZoom = function (pps) {
    T.pxPerSec = Math.min(400, Math.max(8, pps));
    T.rebuild();
  };

  function width() { return Math.max(T.scrollEl.clientWidth, (S.duration() + 4) * T.pxPerSec); }

  // ---------- ruler ----------
  function drawRuler() {
    var w = width();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    T.rulerCanvas.width = w * dpr;
    T.rulerCanvas.height = 24 * dpr;
    T.rulerCanvas.style.width = w + 'px';
    var g = T.rulerCanvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, 24);
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.font = '9px ui-monospace, monospace';
    var step = T.pxPerSec >= 100 ? 1 : T.pxPerSec >= 40 ? 5 : T.pxPerSec >= 16 ? 10 : 30;
    for (var s = 0; s * T.pxPerSec < w; s += step) {
      var x = s * T.pxPerSec + 0.5;
      g.beginPath(); g.moveTo(x, 14); g.lineTo(x, 24); g.stroke();
      var m = Math.floor(s / 60), sec = s % 60;
      g.fillText(m + ':' + (sec < 10 ? '0' : '') + sec, x + 3, 11);
    }
  }

  function onRulerDown(e) {
    var move = function (ev) {
      var rect = T.rulerCanvas.getBoundingClientRect();
      C.seek((ev.clientX - rect.left) / T.pxPerSec);
    };
    move(e);
    var up = function () {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // ---------- thumbnails / waveforms for clip backgrounds ----------
  function thumbStrip(m, cb) {
    if (T._thumbCache[m.id]) return cb(T._thumbCache[m.id]);
    if (m.kind === 'image') {
      var c = document.createElement('canvas');
      c.width = 80; c.height = 42;
      var g = c.getContext('2d');
      var sc = Math.max(80 / m.w, 42 / m.h);
      g.drawImage(m.imgEl, (80 - m.w * sc) / 2, (42 - m.h * sc) / 2, m.w * sc, m.h * sc);
      T._thumbCache[m.id] = c.toDataURL();
      return cb(T._thumbCache[m.id]);
    }
    if (m.kind === 'video') {
      var v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = m.url;
      var canvas = document.createElement('canvas');
      var COUNT = 8;
      canvas.width = 76 * COUNT; canvas.height = 42;
      var g2 = canvas.getContext('2d');
      var i = 0;
      v.addEventListener('loadeddata', function () { v.currentTime = 0.05; });
      v.addEventListener('seeked', function next() {
        try {
          var sc2 = Math.max(76 / v.videoWidth, 42 / v.videoHeight);
          g2.drawImage(v, i * 76 + (76 - v.videoWidth * sc2) / 2, (42 - v.videoHeight * sc2) / 2, v.videoWidth * sc2, v.videoHeight * sc2);
        } catch (e) {}
        i++;
        if (i < COUNT) v.currentTime = (i + 0.5) / COUNT * m.duration;
        else {
          T._thumbCache[m.id] = canvas.toDataURL('image/jpeg', 0.6);
          v.removeAttribute('src');
          cb(T._thumbCache[m.id]);
        }
      });
      return;
    }
    if (m.kind === 'audio') {
      m.blob.arrayBuffer().then(function (ab) {
        var actx = C.ensureAudio();
        return new Promise(function (res, rej) { actx.decodeAudioData(ab, res, rej); });
      }).then(function (buf) {
        var c2 = document.createElement('canvas');
        c2.width = 600; c2.height = 42;
        var g3 = c2.getContext('2d');
        g3.fillStyle = 'rgba(81,208,138,0.75)';
        var data = buf.getChannelData(0);
        var block = Math.max(1, Math.floor(data.length / 300));
        for (var x = 0; x < 300; x++) {
          var max = 0;
          for (var j = x * block; j < (x + 1) * block && j < data.length; j += Math.max(1, Math.floor(block / 16))) {
            var v2 = Math.abs(data[j]);
            if (v2 > max) max = v2;
          }
          var h = Math.max(1.5, max * 40);
          g3.fillRect(x * 2, (42 - h) / 2, 1.4, h);
        }
        T._thumbCache[m.id] = c2.toDataURL();
        cb(T._thumbCache[m.id]);
      }).catch(function () {});
    }
  }

  // ---------- build ----------
  T.rebuild = function () {
    if (!T.tracksEl || !S.project) return;
    drawRuler();
    T.innerEl.style.width = width() + 'px';
    T.tracksEl.innerHTML = '';
    var tracks = S.trackCount();
    var trackEls = [];
    for (var i = 0; i < tracks; i++) {
      var tr = document.createElement('div');
      tr.className = 'tl-track';
      tr.dataset.track = i;
      T.tracksEl.appendChild(tr);
      trackEls.push(tr);
    }

    S.project.layers.forEach(function (l) {
      var el = document.createElement('div');
      el.className = 'tl-clip c-' + l.type + (l.id === S.selectedId ? ' selected' : '');
      el.dataset.id = l.id;
      el.style.left = (l.start * T.pxPerSec) + 'px';
      el.style.width = Math.max(14, l.duration * T.pxPerSec) + 'px';
      el.innerHTML = '<div class="cbg"></div><span class="clabel"></span><div class="edge l"></div><div class="edge r"></div>';
      el.querySelector('.clabel').textContent = l.name;
      (trackEls[l.track] || trackEls[0]).appendChild(el);

      if (l.srcId && S.media[l.srcId]) {
        thumbStrip(S.media[l.srcId], function (url) {
          var bg = el.querySelector('.cbg');
          if (bg) bg.style.backgroundImage = 'url(' + url + ')';
        });
      }
      el.addEventListener('pointerdown', function (e) { onClipDown(e, l, el); });

      // junction (transition) button at clip start when an adjacent predecessor exists
      var prev = S.project.layers.find(function (o) {
        return o.id !== l.id && o.track === l.track && Math.abs(o.start + o.duration - l.start) < 0.08;
      });
      if (prev && (l.type === 'video' || l.type === 'image')) {
        var j = document.createElement('button');
        j.className = 'tl-junction' + (l.transIn ? ' has' : '');
        j.type = 'button';
        j.title = 'Transition: ' + (l.transIn ? l.transIn.type : 'cut') + ' — click to change';
        j.textContent = l.transIn ? '⧉' : '+';
        j.style.left = (l.start * T.pxPerSec) + 'px';
        j.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
        j.addEventListener('click', function (e) {
          e.stopPropagation();
          cycleTransition(l);
        });
        (trackEls[l.track] || trackEls[0]).appendChild(j);
      }
    });
    T.refreshPlayhead();
    T.refreshLoop();
  };

  function cycleTransition(l) {
    var order = [null, 'crossfade', 'fadeblack', 'slide'];
    var cur = l.transIn ? order.indexOf(l.transIn.type) : 0;
    var next = order[(cur + 1) % order.length];
    S.commit('transition');
    l.transIn = next ? { type: next, dur: 0.6 } : null;
    S.emit('layers');
    global.EdUI && global.EdUI.toast('Transition: ' + (next || 'cut'));
  }

  // ---------- clip interactions ----------
  var SNAP_PX = 7;
  function snapPoints(exceptId) {
    var pts = [0, S.time];
    S.project.layers.forEach(function (l) {
      if (l.id === exceptId) return;
      pts.push(l.start, l.start + l.duration);
    });
    // 1s grid
    return pts;
  }
  function applySnap(t, exceptId, disable) {
    if (disable) return { t: t, snapped: null };
    var tol = SNAP_PX / T.pxPerSec;
    var best = null, bestD = tol;
    snapPoints(exceptId).forEach(function (p) {
      var d = Math.abs(t - p);
      if (d < bestD) { bestD = d; best = p; }
    });
    var grid = Math.round(t);
    if (Math.abs(t - grid) < bestD && Math.abs(t - grid) < tol) best = grid;
    return best !== null ? { t: best, snapped: best } : { t: t, snapped: null };
  }
  function showGuide(t) {
    if (t === null) { T.guideEl.style.display = 'none'; return; }
    T.guideEl.style.display = 'block';
    T.guideEl.style.left = (t * T.pxPerSec) + 'px';
  }

  function onClipDown(e, l, el) {
    e.preventDefault();
    S.select(l.id);
    var edge = e.target.classList.contains('edge') ? (e.target.classList.contains('l') ? 'l' : 'r') : null;
    var startX = e.clientX, startY = e.clientY;
    var orig = { start: l.start, duration: l.duration, inPoint: l.inPoint, track: l.track };
    var moved = false;
    var committed = false;

    function move(ev) {
      var dx = (ev.clientX - startX) / T.pxPerSec;
      var dy = ev.clientY - startY;
      if (!moved && (Math.abs(ev.clientX - startX) > 3 || Math.abs(dy) > 3)) {
        moved = true;
        if (!committed) { S.commit('clip edit'); committed = true; }
      }
      if (!moved) return;
      var noSnap = ev.altKey;

      if (edge === 'l') {
        var ns = applySnap(orig.start + dx, l.id, noSnap);
        var newStart = Math.max(0, Math.min(ns.t, orig.start + orig.duration - 0.1));
        var delta = newStart - orig.start;
        // media-backed clips can't extend before inPoint 0
        if (l.srcId && orig.inPoint + delta * l.speed < 0) {
          delta = -orig.inPoint / l.speed;
          newStart = orig.start + delta;
        }
        l.start = newStart;
        l.duration = orig.duration - delta;
        if (l.srcId) l.inPoint = orig.inPoint + delta * l.speed;
        showGuide(ns.snapped);
      } else if (edge === 'r') {
        var ne = applySnap(orig.start + orig.duration + dx, l.id, noSnap);
        var newDur = Math.max(0.1, ne.t - orig.start);
        if (l.srcId) {
          var m = S.media[l.srcId];
          if (m && m.duration) newDur = Math.min(newDur, (m.duration - l.inPoint) / l.speed);
        }
        l.duration = newDur;
        showGuide(ne.snapped);
      } else {
        var nm = applySnap(orig.start + dx, l.id, noSnap);
        var nm2 = applySnap(orig.start + orig.duration + dx, l.id, noSnap);
        if (nm2.snapped !== null && nm.snapped === null) {
          l.start = Math.max(0, nm2.t - orig.duration);
          showGuide(nm2.snapped);
        } else {
          l.start = Math.max(0, nm.t);
          showGuide(nm.snapped);
        }
        var dTrack = Math.round(dy / 52);
        l.track = Math.max(0, Math.min(S.trackCount() - 1, orig.track + dTrack));
      }
      liveUpdate(el, l);
      C.render(S.time);
    }
    function up() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      showGuide(null);
      if (moved) { S.emit('layers'); S.scheduleSave(); }
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function liveUpdate(el, l) {
    el.style.left = (l.start * T.pxPerSec) + 'px';
    el.style.width = Math.max(14, l.duration * T.pxPerSec) + 'px';
    var tr = T.tracksEl.children[l.track];
    if (tr && el.parentElement !== tr) tr.appendChild(el);
  }

  // ---------- edit ops ----------
  T.split = function () {
    var l = S.selected();
    if (!l) return;
    var t = S.time;
    if (t <= l.start + 0.05 || t >= l.start + l.duration - 0.05) return;
    S.commit('split');
    var right = JSON.parse(JSON.stringify(l));
    right.id = S.id();
    var off = t - l.start;
    right.start = t;
    right.duration = l.duration - off;
    if (l.srcId) right.inPoint = l.inPoint + off * l.speed;
    right.transIn = null;
    l.duration = off;
    l.fadeOut = 0; right.fadeIn = 0;
    S.project.layers.push(right);
    S.emit('layers');
    S.select(right.id);
  };

  T.duplicate = function () {
    var l = S.selected();
    if (!l) return;
    S.commit('duplicate');
    var copy = JSON.parse(JSON.stringify(l));
    copy.id = S.id();
    copy.start = l.start + l.duration;
    copy.track = S.freeTrack(copy.start, copy.duration) === l.track ? l.track : l.track;
    S.project.layers.push(copy);
    S.emit('layers');
    S.select(copy.id);
  };

  T.copy = function () {
    var l = S.selected();
    if (l) T.clipboard = JSON.stringify(l);
  };
  T.paste = function () {
    if (!T.clipboard) return;
    S.commit('paste');
    var copy = JSON.parse(T.clipboard);
    copy.id = S.id();
    copy.start = S.time;
    copy.track = S.freeTrack(copy.start, copy.duration);
    S.project.layers.push(copy);
    S.emit('layers');
    S.select(copy.id);
  };

  // ---------- playhead / loop ----------
  T.refreshPlayhead = function () {
    if (T.playheadEl) T.playheadEl.style.left = (S.time * T.pxPerSec) + 'px';
  };
  T.refreshLoop = function () {
    if (!T.loopEl) return;
    if (S.loop) {
      T.loopEl.style.display = 'block';
      T.loopEl.style.left = (S.loop.start * T.pxPerSec) + 'px';
      T.loopEl.style.width = ((S.loop.end - S.loop.start) * T.pxPerSec) + 'px';
    } else T.loopEl.style.display = 'none';
  };
  T.refreshSelection = function () {
    if (!T.tracksEl) return;
    Array.prototype.forEach.call(T.tracksEl.querySelectorAll('.tl-clip'), function (el) {
      el.classList.toggle('selected', el.dataset.id === S.selectedId);
    });
  };

  global.EdTimeline = T;
})(window);
