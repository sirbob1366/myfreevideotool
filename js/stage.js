/* MyFreeVideoTool — the Stage: shared editor component.
   Video preview + glass transport bar + filmstrip timeline with waveform,
   draggable playhead, trim handles, snapping, keyboard control, undo. */
(function (global) {
  'use strict';
  var E = global.VideoEngine;

  var SVG = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.54.84l10-6.5a1 1 0 0 0 0-1.68l-10-6.5A1 1 0 0 0 8 5.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 18l-6-6 6-6"/><path d="M19 18l-6-6 6-6"/></svg>',
    fwd: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 18l6-6-6-6"/><path d="M5 18l6-6-6-6"/></svg>',
    vol: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>'
  };

  function create(container, opts) {
    opts = opts || {};
    var meta = opts.meta;
    var fps = (meta && meta.fps) || 30;
    var duration = meta ? meta.duration : 0;

    container.innerHTML =
      '<div class="stage-wrap">' +
        '<div class="stage' + (opts.mini ? ' stage--mini' : '') + '">' +
          '<video playsinline ' + (opts.mini ? 'muted loop ' : '') + '></video>' +
          '<div class="stage__overlay-host" style="position:absolute;pointer-events:none;"></div>' +
          '<div class="glassbar">' +
            '<button class="tbtn" data-act="back" title="Previous frame (←)" type="button">' + SVG.back + '</button>' +
            '<button class="tbtn tbtn--play" data-act="play" title="Play/pause (space)" type="button">' + SVG.play + '</button>' +
            '<button class="tbtn" data-act="fwd" title="Next frame (→)" type="button">' + SVG.fwd + '</button>' +
            '<span class="ttime"><b class="t-cur">0:00.0</b> / <span class="t-dur">0:00.0</span></span>' +
            '<span class="tbtn" style="cursor:default" title="Volume">' + SVG.vol + '</span>' +
            '<input type="range" class="tvol" min="0" max="100" value="100" aria-label="Volume">' +
          '</div>' +
        '</div>' +
        '<div class="timeline">' +
          '<div class="timeline__strip">' +
            '<canvas class="timeline__thumbs"></canvas>' +
            '<canvas class="timeline__wave"></canvas>' +
            '<div class="timeline__shade timeline__shade--l" style="left:0;width:0"></div>' +
            '<div class="timeline__shade timeline__shade--r" style="right:0;width:0"></div>' +
            '<div class="timeline__regions"></div>' +
            '<div class="timeline__playhead" style="left:0"></div>' +
            (opts.selection ? '<div class="timeline__handle timeline__handle--start" style="left:0"></div><div class="timeline__handle timeline__handle--end" style="left:100%"></div>' : '') +
          '</div>' +
          (opts.selection ?
            '<div class="timeline__times">' +
              '<label>Start <input class="time-input t-in" type="text" spellcheck="false"></label>' +
              '<label>End <input class="time-input t-out" type="text" spellcheck="false"></label>' +
              '<span class="timeline__hint">space play · ←/→ frame · shift+←/→ 1s · I/O set in/out · ctrl+Z undo</span>' +
            '</div>' :
            '<div class="timeline__times"><span class="timeline__hint">space play · ←/→ frame · shift+←/→ 1s</span></div>') +
        '</div>' +
      '</div>';

    var video = container.querySelector('video');
    var overlayHost = container.querySelector('.stage__overlay-host');
    var stageEl = container.querySelector('.stage');
    var strip = container.querySelector('.timeline__strip');
    var thumbsCanvas = container.querySelector('.timeline__thumbs');
    var waveCanvas = container.querySelector('.timeline__wave');
    var playhead = container.querySelector('.timeline__playhead');
    var shadeL = container.querySelector('.timeline__shade--l');
    var shadeR = container.querySelector('.timeline__shade--r');
    var regionsHost = container.querySelector('.timeline__regions');
    var hStart = container.querySelector('.timeline__handle--start');
    var hEnd = container.querySelector('.timeline__handle--end');
    var tCur = container.querySelector('.t-cur');
    var tDur = container.querySelector('.t-dur');
    var inField = container.querySelector('.t-in');
    var outField = container.querySelector('.t-out');
    var playBtn = container.querySelector('[data-act="play"]');

    video.src = opts.url;
    if (opts.mini) video.muted = true;

    var sel = { start: 0, end: duration };
    var undoStack = [];
    var raf = 0;
    var selChanged = opts.onSelectionChange || function () {};

    function pushUndo() {
      undoStack.push({ start: sel.start, end: sel.end });
      if (undoStack.length > 10) undoStack.shift();
    }

    function clamp(t) { return Math.min(duration, Math.max(0, t)); }

    function frac(t) { return duration ? (t / duration) : 0; }

    function renderSelection() {
      if (!hStart) return;
      hStart.style.left = (frac(sel.start) * 100) + '%';
      hEnd.style.left = (frac(sel.end) * 100) + '%';
      shadeL.style.width = (frac(sel.start) * 100) + '%';
      shadeR.style.width = ((1 - frac(sel.end)) * 100) + '%';
      if (inField && document.activeElement !== inField) inField.value = E.toTimeInput(sel.start);
      if (outField && document.activeElement !== outField) outField.value = E.toTimeInput(sel.end);
    }

    function setSelection(start, end, fromUndo) {
      if (!fromUndo) pushUndo();
      sel.start = clamp(Math.min(start, end - 0.01));
      sel.end = clamp(Math.max(end, sel.start + 0.01));
      renderSelection();
      selChanged({ start: sel.start, end: sel.end });
    }

    function renderTime() {
      playhead.style.left = (frac(video.currentTime) * 100) + '%';
      tCur.textContent = E.formatTime(video.currentTime);
    }

    function loopRender() {
      renderTime();
      if (!video.paused && !video.ended) raf = requestAnimationFrame(loopRender);
    }

    video.addEventListener('loadedmetadata', function () {
      if (!duration) { duration = video.duration; sel.end = duration; }
      tDur.textContent = E.formatTime(duration);
      renderSelection();
      syncOverlay();
    });
    video.addEventListener('play', function () {
      playBtn.innerHTML = SVG.pause;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loopRender);
    });
    video.addEventListener('pause', function () {
      playBtn.innerHTML = SVG.play;
      cancelAnimationFrame(raf);
      renderTime();
    });
    video.addEventListener('timeupdate', renderTime);

    // overlay host tracks the displayed video rect
    function syncOverlay() {
      var vr = video.getBoundingClientRect();
      var sr = stageEl.getBoundingClientRect();
      overlayHost.style.left = (vr.left - sr.left) + 'px';
      overlayHost.style.top = (vr.top - sr.top) + 'px';
      overlayHost.style.width = vr.width + 'px';
      overlayHost.style.height = vr.height + 'px';
    }
    window.addEventListener('resize', syncOverlay);

    // ---------- transport ----------
    function frameStep(dir, big) {
      video.pause();
      var step = big ? 1 : 1 / fps;
      video.currentTime = clamp(video.currentTime + dir * step);
    }
    container.querySelector('[data-act="back"]').addEventListener('click', function () { frameStep(-1); });
    container.querySelector('[data-act="fwd"]').addEventListener('click', function () { frameStep(1); });
    playBtn.addEventListener('click', function () {
      if (video.paused) video.play(); else video.pause();
    });
    container.querySelector('.tvol').addEventListener('input', function () {
      video.volume = this.value / 100;
      video.muted = this.value === '0';
    });

    // ---------- timeline interactions ----------
    var dragging = null; // 'start' | 'end' | 'seek'
    function stripFrac(e) {
      var r = strip.getBoundingClientRect();
      var x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
      return Math.min(1, Math.max(0, x / r.width));
    }
    function snap(t) {
      var r = strip.getBoundingClientRect();
      var pxPerSec = r.width / duration;
      var tol = 6 / pxPerSec; // 6px magnetic radius
      var nearest = Math.round(t);            // 1s gridlines
      if (Math.abs(t - nearest) < tol) t = nearest;
      if (Math.abs(t - video.currentTime) < tol) t = video.currentTime; // playhead
      return clamp(t);
    }
    function onDown(e) {
      var f = stripFrac(e);
      var t = f * duration;
      if (hStart) {
        var r = strip.getBoundingClientRect();
        var px = f * r.width;
        var sPx = frac(sel.start) * r.width;
        var ePx = frac(sel.end) * r.width;
        if (Math.abs(px - sPx) < 12) { dragging = 'start'; pushUndo(); }
        else if (Math.abs(px - ePx) < 12) { dragging = 'end'; pushUndo(); }
        else dragging = 'seek';
      } else dragging = 'seek';
      onMove(e);
      e.preventDefault();
    }
    function onMove(e) {
      if (!dragging) return;
      var t = stripFrac(e) * duration;
      if (dragging === 'seek') {
        video.currentTime = clamp(t);
        renderTime();
      } else {
        t = snap(t);
        if (dragging === 'start') sel.start = Math.min(t, sel.end - 0.05);
        else sel.end = Math.max(t, sel.start + 0.05);
        renderSelection();
        selChanged({ start: sel.start, end: sel.end });
      }
      e.preventDefault();
    }
    function onUp() { dragging = null; }
    strip.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    strip.addEventListener('touchstart', onDown, { passive: false });
    strip.addEventListener('touchmove', onMove, { passive: false });
    strip.addEventListener('touchend', onUp);

    // ---------- precise time fields ----------
    function bindField(field, which) {
      if (!field) return;
      field.addEventListener('change', function () {
        var t = E.parseTimeInput(field.value);
        if (isNaN(t)) { renderSelection(); return; }
        if (which === 'start') setSelection(clamp(t), sel.end);
        else setSelection(sel.start, clamp(t));
      });
      field.addEventListener('keydown', function (e) { e.stopPropagation(); });
    }
    bindField(inField, 'start');
    bindField(outField, 'end');

    // ---------- keyboard ----------
    function onKey(e) {
      if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      if (e.code === 'Space') { e.preventDefault(); video.paused ? video.play() : video.pause(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); frameStep(-1, e.shiftKey); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); frameStep(1, e.shiftKey); }
      else if ((e.key === 'i' || e.key === 'I') && hStart) { setSelection(video.currentTime, Math.max(sel.end, video.currentTime + 0.1)); }
      else if ((e.key === 'o' || e.key === 'O') && hStart) { setSelection(Math.min(sel.start, video.currentTime - 0.1), video.currentTime); }
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && hStart) {
        e.preventDefault();
        var prev = undoStack.pop();
        if (prev) { sel.start = prev.start; sel.end = prev.end; renderSelection(); selChanged(sel); }
      }
    }
    if (!opts.mini) document.addEventListener('keydown', onKey);
    else container.addEventListener('keydown', onKey);

    // ---------- async timeline art ----------
    var thumbsReady = E.thumbnailStrip(opts.url, duration || (meta && meta.duration) || 1, thumbsCanvas, opts.thumbCount || 20);
    if (opts.file) E.waveformLane(opts.file, waveCanvas);

    // ---------- regions (cut tool) ----------
    function setRegions(list) {
      regionsHost.innerHTML = '';
      (list || []).forEach(function (r) {
        var d = document.createElement('div');
        d.className = 'timeline__region';
        d.style.left = (frac(r.start) * 100) + '%';
        d.style.width = ((frac(r.end) - frac(r.start)) * 100) + '%';
        regionsHost.appendChild(d);
      });
    }

    // ---------- selection playback ----------
    var selWatcher = null;
    function playSelection() {
      video.currentTime = sel.start;
      video.play();
      clearInterval(selWatcher);
      selWatcher = setInterval(function () {
        if (video.currentTime >= sel.end - 0.03 || video.paused) {
          video.pause();
          clearInterval(selWatcher);
        }
      }, 40);
    }

    return {
      video: video,
      overlayHost: overlayHost,
      stageEl: stageEl,
      thumbsReady: thumbsReady,
      getDuration: function () { return duration; },
      getFps: function () { return fps; },
      getSelection: function () { return { start: sel.start, end: sel.end }; },
      setSelection: setSelection,
      setRegions: setRegions,
      playSelection: playSelection,
      syncOverlay: syncOverlay,
      destroy: function () {
        cancelAnimationFrame(raf);
        clearInterval(selWatcher);
        document.removeEventListener('keydown', onKey);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('resize', syncOverlay);
        try { video.pause(); video.removeAttribute('src'); video.load(); } catch (e) {}
        container.innerHTML = '';
      }
    };
  }

  global.VideoStage = { create: create };
})(window);
