/* MyFreeVideoTool — shared video engine.
   100% on-device: files never leave the browser. */
(function (global) {
  'use strict';

  var E = {};

  // ============ formatting ============
  E.formatTime = function (sec, withMs) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    var core = (h ? h + ':' : '') + (h ? String(m).padStart(2, '0') : m) + ':' + (s < 10 ? '0' : '') + (withMs === false ? Math.floor(s) : s.toFixed(withMs === 'ms' ? 3 : 1));
    return core;
  };

  // hh:mm:ss.ms editable form
  E.toTimeInput = function (sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = (sec % 60);
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + (s < 10 ? '0' : '') + s.toFixed(3);
  };

  E.parseTimeInput = function (str) {
    if (typeof str !== 'string') return NaN;
    var parts = str.trim().split(':').map(parseFloat);
    if (parts.some(isNaN)) return NaN;
    var sec = 0;
    for (var i = 0; i < parts.length; i++) sec = sec * 60 + parts[i];
    return sec;
  };

  E.formatBytes = function (bytes) {
    if (!isFinite(bytes)) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(2) + ' GB';
  };

  E.baseName = function (name) { return (name || 'video').replace(/\.[^.]+$/, '') || 'video'; };

  E.humanError = function (err) {
    var m = (err && err.message) || String(err || '');
    if (/cancelled/i.test(m)) return 'Cancelled.';
    if (/SharedArrayBuffer|crossOriginIsolated/i.test(m)) return 'This browser/context blocks multithreaded processing. Try the latest Chrome, Edge or Firefox over HTTPS.';
    if (/decod|demux|unsupported|invalid data/i.test(m)) return 'This file appears to be corrupted or in a format your browser cannot read.';
    if (/memory|allocation|OOM/i.test(m)) return 'Your device ran out of memory for this file. Try a shorter or smaller video.';
    if (/Failed to fetch|network/i.test(m)) return 'A required component could not be downloaded. Check your connection and try again.';
    return m || 'Something went wrong. Please try again.';
  };

  E.downloadBlob = function (blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  };

  E.status = function (el, msg, kind) {
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  };

  // ============ dropzone (page-wide drops, gentle >2GB warning) ============
  var SIZE_WARN = 2 * 1073741824;
  E.setupDropzone = function (zone, input, onFiles, opts) {
    opts = opts || {};
    var accept = opts.accept || function (f) {
      return /^video\//.test(f.type) || /\.(mp4|webm|mov|mkv|avi|m4v|mpg|mpeg|wmv|flv|3gp|ts)$/i.test(f.name);
    };

    function handle(files) {
      files = files.filter(accept);
      if (!files.length) return;
      var big = files.find(function (f) { return f.size > SIZE_WARN; });
      if (big) {
        var note = zone.querySelector('.size-warn') || (function () {
          var d = document.createElement('p');
          d.className = 'status error size-warn';
          zone.appendChild(d);
          return d;
        })();
        note.textContent = '⚠ ' + big.name + ' is over 2 GB — this can work, but may be slow or run out of memory on some devices.';
      }
      onFiles(files);
    }

    zone.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () {
      if (input.files.length) handle(Array.prototype.slice.call(input.files));
      input.value = '';
    });
    ['dragenter', 'dragover'].forEach(function (evt) {
      document.addEventListener(evt, function (e) {
        e.preventDefault();
        zone.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach(function (evt) {
      document.addEventListener(evt, function (e) {
        e.preventDefault();
        if (evt === 'drop' || e.target === document.documentElement) zone.classList.remove('dragover');
      });
    });
    document.addEventListener('drop', function (e) {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        handle(Array.prototype.slice.call(e.dataTransfer.files));
      }
    });
  };

  // ============ editor handoff ============
  // Tool pages park the current file in IndexedDB and jump to /editor/.
  E.lastFile = null;
  E.openInEditor = function (file) {
    file = file || E.lastFile;
    if (!file) { location.href = '/editor/'; return; }
    var req = indexedDB.open('mfvt-editor', 1);
    req.onupgradeneeded = function () {
      var d = req.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('media')) d.createObjectStore('media');
    };
    req.onsuccess = function () {
      var tx = req.result.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ blob: file, name: file.name }, 'handoff');
      tx.oncomplete = function () { location.href = '/editor/?handoff=1'; };
      tx.onerror = function () { location.href = '/editor/'; };
    };
    req.onerror = function () { location.href = '/editor/'; };
  };
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.open-editor');
    if (btn) { e.preventDefault(); E.openInEditor(); }
  });

  // ============ metadata probe ============
  // Resolves { url, duration, width, height, fps (estimated|null), size, name, type, hasVideo }
  E.probeFile = function (file) {
    E.lastFile = file;
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      v.playsInline = true;
      v.src = url;
      var done = false;
      var timer = setTimeout(function () { fail(new Error('Could not read this video. The format may be unsupported by your browser.')); }, 15000);
      function fail(err) {
        if (done) return; done = true;
        clearTimeout(timer);
        URL.revokeObjectURL(url);
        reject(err);
      }
      v.addEventListener('error', function () { fail(new Error('Could not read this video. The format may be unsupported by your browser.')); });
      v.addEventListener('loadedmetadata', function () {
        if (done) return; done = true;
        clearTimeout(timer);
        var meta = {
          url: url, file: file, name: file.name, size: file.size, type: file.type || 'video',
          duration: v.duration, width: v.videoWidth, height: v.videoHeight,
          hasVideo: v.videoWidth > 0, fps: null
        };
        // fps estimate via requestVideoFrameCallback (best-effort, ~0.5s of playback)
        if (v.requestVideoFrameCallback && meta.hasVideo) {
          var times = [];
          var raf = function (now, md) {
            times.push(md.mediaTime);
            if (times.length < 12 && md.mediaTime < (v.duration || 9)) v.requestVideoFrameCallback(raf);
            else {
              v.pause();
              var deltas = [];
              for (var i = 1; i < times.length; i++) deltas.push(times[i] - times[i - 1]);
              deltas = deltas.filter(function (d) { return d > 0.001 && d < 0.5; });
              if (deltas.length >= 4) {
                deltas.sort(function (a, b) { return a - b; });
                meta.fps = Math.round(1 / deltas[Math.floor(deltas.length / 2)]);
              }
              v.currentTime = 0;
              resolve(meta);
            }
          };
          v.requestVideoFrameCallback(raf);
          v.play().catch(function () { resolve(meta); });
          setTimeout(function () { if (times.length < 12) { try { v.pause(); } catch (e) {} resolve(meta); } }, 2500);
        } else {
          resolve(meta);
        }
      });
    });
  };

  E.metaLine = function (meta) {
    var bits = [E.formatTime(meta.duration), meta.width + '×' + meta.height];
    if (meta.fps) bits.push('~' + meta.fps + ' fps');
    bits.push((meta.type || '').replace('video/', '') || 'video');
    bits.push(E.formatBytes(meta.size));
    return bits.join(' · ');
  };

  // ============ thumbnail strip (chunked, non-blocking) ============
  // Draws `count` evenly spaced frames into canvas; resolves when done.
  E.thumbnailStrip = function (url, duration, canvas, count) {
    count = count || 20;
    return new Promise(function (resolve) {
      var v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto';
      v.src = url;
      var g = canvas.getContext('2d');
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var rect = canvas.getBoundingClientRect();
      var W = Math.max(200, Math.round(rect.width)) * dpr;
      var H = Math.round(rect.height) * dpr || 56 * dpr;
      canvas.width = W; canvas.height = H;
      var cellW = W / count;
      var i = 0;
      var guard = setTimeout(finish, 30000);
      function finish() {
        clearTimeout(guard);
        v.removeAttribute('src');
        try { v.load(); } catch (e) {}
        resolve();
      }
      function next() {
        if (i >= count) return finish();
        var t = (i + 0.5) / count * duration;
        var step = i;
        var to = setTimeout(function () { i++; next(); }, 3000); // skip stuck seeks
        v.onseeked = function () {
          clearTimeout(to);
          try {
            var vw = v.videoWidth, vh = v.videoHeight;
            var scale = Math.max(cellW / vw, H / vh);
            var dw = vw * scale, dh = vh * scale;
            g.drawImage(v, step * cellW + (cellW - dw) / 2, (H - dh) / 2, dw, dh);
          } catch (e) {}
          i++;
          setTimeout(next, 0); // yield to main thread between frames
        };
        try { v.currentTime = Math.min(t, Math.max(0, duration - 0.05)); } catch (e) { finish(); }
      }
      v.addEventListener('loadeddata', next, { once: true });
      v.addEventListener('error', finish, { once: true });
    });
  };

  // ============ audio waveform lane (best-effort) ============
  var _actx = null;
  E.getAudioContext = function () {
    if (!_actx) _actx = new (window.AudioContext || window.webkitAudioContext)();
    if (_actx.state === 'suspended') _actx.resume();
    return _actx;
  };
  ['touchend', 'mousedown', 'keydown'].forEach(function (evt) {
    document.addEventListener(evt, function () {
      if (_actx && _actx.state === 'suspended') _actx.resume();
    }, { passive: true });
  });

  E.waveformLane = function (file, canvas) {
    return file.arrayBuffer().then(function (ab) {
      return new Promise(function (resolve, reject) {
        E.getAudioContext().decodeAudioData(ab, resolve, function (e) { reject(e || new Error('no audio')); });
      });
    }).then(function (buf) {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var rect = canvas.getBoundingClientRect();
      var W = Math.max(200, Math.round(rect.width)) * dpr;
      var H = (Math.round(rect.height) || 26) * dpr;
      canvas.width = W; canvas.height = H;
      var g = canvas.getContext('2d');
      var data = buf.getChannelData(0);
      var cols = Math.floor(W / (2 * dpr));
      var block = Math.max(1, Math.floor(data.length / cols));
      var accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#5b5bf0';
      g.fillStyle = accent;
      g.globalAlpha = 0.55;
      for (var c = 0; c < cols; c++) {
        var max = 0;
        var start = c * block;
        var step = block > 32 ? Math.floor(block / 32) : 1;
        for (var i = start; i < start + block && i < data.length; i += step) {
          var a = Math.abs(data[i]);
          if (a > max) max = a;
        }
        var h = Math.max(1, max * H);
        g.fillRect(c * 2 * dpr, (H - h) / 2, 1.4 * dpr, h);
      }
      return true;
    }).catch(function () { return false; });
  };

  // ============ FFmpeg (self-hosted multithreaded core) ============
  var FF_BASE = '/vendor/ffmpeg/';
  var _ffmpeg = null;
  var _loadPromise = null;
  var _running = false;
  var _cancelled = false;

  E.ffmpegLoaded = function () { return !!_ffmpeg; };

  E.loadFFmpeg = function (onBytes) {
    if (_ffmpeg) return Promise.resolve(_ffmpeg);
    if (_loadPromise) return _loadPromise;
    if (!window.crossOriginIsolated) {
      return Promise.reject(new Error('crossOriginIsolated is false — SharedArrayBuffer unavailable. The _headers COOP/COEP setup did not apply (local servers need the same headers).'));
    }
    _loadPromise = (function () {
      // load UMD wrapper
      return new Promise(function (resolve, reject) {
        if (window.FFmpeg) return resolve();
        var s = document.createElement('script');
        s.src = FF_BASE + 'ffmpeg.min.js';
        s.onload = resolve;
        s.onerror = function () { reject(new Error('Failed to fetch the video engine.')); };
        document.head.appendChild(s);
      }).then(function () {
        // prefetch wasm with byte progress (same-origin; lands in HTTP cache)
        return fetch(FF_BASE + 'ffmpeg-core.wasm').then(function (res) {
          if (!res.ok || !res.body) return;
          var total = parseInt(res.headers.get('Content-Length') || '0', 10) || 24465514;
          var reader = res.body.getReader();
          var got = 0;
          function pump() {
            return reader.read().then(function (r) {
              if (r.done) return;
              got += r.value.length;
              if (onBytes) onBytes(got, total);
              return pump();
            });
          }
          return pump();
        }).catch(function () {});
      }).then(function () {
        var ff = FFmpeg.createFFmpeg({ corePath: FF_BASE + 'ffmpeg-core.js', log: false });
        return ff.load().then(function () {
          _ffmpeg = ff;
          return ff;
        });
      }).catch(function (err) {
        _loadPromise = null;
        throw err;
      });
    })();
    return _loadPromise;
  };

  // parse "time=00:01:23.45" from ffmpeg log lines
  function parseLogTime(line) {
    var m = /time=\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);
    if (!m) return null;
    return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
  }

  // Run one ffmpeg job.
  // job: { args: [...], inputs: [{name, file|data}], outputs: [name],
  //        outDuration: seconds (for progress %), onProgress({pct, eta, raw}) }
  // Returns Promise<[{name, data:Uint8Array}]>
  E.runFFmpeg = function (job) {
    if (_running) return Promise.reject(new Error('Another job is already running.'));
    _running = true;
    _cancelled = false;
    var startedAt = 0;
    return E.loadFFmpeg(job.onLoadBytes).then(function (ff) {
      var writes = (job.inputs || []).map(function (inp) {
        if (inp.data) { ff.FS('writeFile', inp.name, inp.data); return Promise.resolve(); }
        return inp.file.arrayBuffer().then(function (ab) {
          ff.FS('writeFile', inp.name, new Uint8Array(ab));
        });
      });
      return Promise.all(writes).then(function () {
        startedAt = Date.now();
        ff.setLogger(function (l) {
          if (!job.onProgress || !l || !l.message) return;
          var t = parseLogTime(l.message);
          if (t === null || !job.outDuration) return;
          var pct = Math.min(0.995, t / job.outDuration);
          var elapsed = (Date.now() - startedAt) / 1000;
          var eta = pct > 0.02 ? Math.max(0, elapsed / pct - elapsed) : null;
          job.onProgress({ pct: pct, eta: eta, raw: l.message });
        });
        return ff.run.apply(ff, job.args);
      }).then(function () {
        if (_cancelled) throw new Error('cancelled');
        var outs = (job.outputs || []).map(function (name) {
          var data = ff.FS('readFile', name);
          return { name: name, data: data };
        });
        // cleanup FS
        (job.inputs || []).forEach(function (inp) { try { ff.FS('unlink', inp.name); } catch (e) {} });
        (job.outputs || []).forEach(function (name) { try { ff.FS('unlink', name); } catch (e) {} });
        ff.setLogger(function () {});
        _running = false;
        return outs;
      });
    }).catch(function (err) {
      _running = false;
      if (_cancelled) throw new Error('cancelled');
      throw err;
    });
  };

  E.cancelFFmpeg = function () {
    if (!_ffmpeg || !_running) return;
    _cancelled = true;
    try { _ffmpeg.exit(); } catch (e) {}
    _ffmpeg = null;
    _loadPromise = null;
    _running = false;
  };

  // ============ processing UI (determinate bar + ETA + cancel; never a spinner) ============
  // procEl markup is generated here. Returns controller.
  E.procUI = function (procEl) {
    procEl.classList.add('proc');
    procEl.innerHTML =
      '<div class="proc__row">' +
        '<div class="proc__bar"><div class="proc__fill"></div></div>' +
        '<span class="proc__pct">0%</span>' +
      '</div>' +
      '<div class="proc__label">' +
        '<span class="proc__text"></span>' +
        '<span class="proc__eta"></span>' +
        '<button class="proc__cancel" type="button">Cancel</button>' +
      '</div>';
    var fill = procEl.querySelector('.proc__fill');
    var pctEl = procEl.querySelector('.proc__pct');
    var textEl = procEl.querySelector('.proc__text');
    var etaEl = procEl.querySelector('.proc__eta');
    var cancelBtn = procEl.querySelector('.proc__cancel');
    var onCancel = null;
    cancelBtn.addEventListener('click', function () { if (onCancel) onCancel(); });
    return {
      start: function (label, cancellable) {
        procEl.classList.add('active');
        textEl.textContent = label || 'Processing…';
        fill.style.width = '0%';
        pctEl.textContent = '0%';
        etaEl.textContent = '';
        cancelBtn.style.display = cancellable === false ? 'none' : '';
      },
      label: function (t) { textEl.textContent = t; },
      update: function (pct, eta) {
        var p = Math.round(Math.min(1, Math.max(0, pct)) * 100);
        fill.style.width = p + '%';
        pctEl.textContent = p + '%';
        etaEl.textContent = (eta !== null && eta !== undefined && isFinite(eta)) ? '~' + Math.ceil(eta) + 's left' : '';
      },
      bytes: function (got, total) {
        this.update(got / total, null);
        textEl.textContent = 'Preparing video engine — one time, ~32 MB (' + E.formatBytes(got) + ' / ' + E.formatBytes(total) + ')';
      },
      done: function () { procEl.classList.remove('active'); },
      onCancel: function (cb) { onCancel = cb; }
    };
  };

  // success checkmark SVG
  E.checkmark = function () {
    return '<svg class="checkdraw" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18"/><path d="M12 20.5l5.5 5.5L28 15"/></svg>';
  };

  E.MIMES = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', gif: 'image/gif', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', png: 'image/png', jpg: 'image/jpeg' };

  E.inExt = function (name) {
    var m = /\.([^.]+)$/.exec(name || '');
    return m ? m[1].toLowerCase() : 'mp4';
  };

  global.VideoEngine = E;
})(window);
