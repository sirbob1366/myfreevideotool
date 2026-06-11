/* Editor state: project model, selection, undo/redo (50 snapshots),
   IndexedDB autosave (project JSON + source blobs), handoff intake. */
(function (global) {
  'use strict';

  var CANVAS_PRESETS = {
    '16:9': { w: 1920, h: 1080 },
    '9:16': { w: 1080, h: 1920 },
    '1:1':  { w: 1080, h: 1080 },
    '4:5':  { w: 1080, h: 1350 }
  };

  var S = {
    project: null,
    media: {},            // id -> {blob, url, kind:'video'|'image'|'audio', duration, w, h, name, videoEl?, imgEl?, audioEl?}
    selectedId: null,
    time: 0,
    playing: false,
    rate: 1,
    loop: null,           // {start, end} | null
    listeners: {},
    _undo: [],
    _redo: [],
    _saveTimer: 0,
    _nextId: 1
  };

  S.PRESETS = CANVAS_PRESETS;

  // ---------- events ----------
  S.on = function (evt, fn) { (S.listeners[evt] = S.listeners[evt] || []).push(fn); };
  S.emit = function (evt, arg) { (S.listeners[evt] || []).forEach(function (fn) { fn(arg); }); };

  // ---------- project ----------
  S.newProject = function (preset) {
    var c = CANVAS_PRESETS[preset || '16:9'];
    S.project = {
      preset: preset || '16:9',
      canvas: { w: c.w, h: c.h },
      layers: [],
      subtitles: [],
      subStyle: { size: 48, color: '#ffffff', bg: true, posY: 0.88 }
    };
    S.selectedId = null;
    S.time = 0;
    S._undo = [];
    S._redo = [];
    S.emit('project');
  };

  S.setPreset = function (preset) {
    var c = CANVAS_PRESETS[preset];
    if (!c) return;
    S.commit('canvas preset');
    S.project.preset = preset;
    S.project.canvas = { w: c.w, h: c.h };
    S.emit('project');
  };

  S.duration = function () {
    var d = 0;
    S.project.layers.forEach(function (l) { d = Math.max(d, l.start + l.duration); });
    S.project.subtitles.forEach(function (c) { d = Math.max(d, c.end); });
    return Math.max(d, 1);
  };

  S.id = function () { return 'L' + (S._nextId++); };

  S.defaultLayer = function (type) {
    return {
      id: S.id(), type: type, name: type, visible: true,
      start: 0, duration: 5, inPoint: 0, track: 0,
      x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, blend: 'source-over',
      fadeIn: 0, fadeOut: 0,
      animIn: 'none', animOut: 'none', animDur: 0.5,
      volume: 1, muted: false, speed: 1, pitchCorrect: true,
      pan: 0, eq: { low: 0, mid: 0, high: 0 }, reverb: 0,
      srcId: null, crop: { l: 0, r: 0, t: 0, b: 0 }, flipH: false, flipV: false,
      filters: { brightness: 1, contrast: 1, saturate: 1, temperature: 0 }, fpreset: 'none',
      chroma: { enabled: false, color: [0, 255, 0], similarity: 0.32, smoothness: 0.1 },
      transIn: null,   // {type:'crossfade'|'fadeblack'|'slide', dur}
      // text
      text: 'Your text', fontSize: 72, color: '#ffffff', bold: true, align: 'center',
      tstyle: 'outline', tbg: '#000000',
      // shape
      shape: 'rect', fill: '#ffb443', stroke: '#000000', strokeW: 0, shapeW: 0.4, shapeH: 0.22
    };
  };

  S.getLayer = function (id) {
    return S.project.layers.find(function (l) { return l.id === id; }) || null;
  };
  S.selected = function () { return S.getLayer(S.selectedId); };

  S.select = function (id) {
    S.selectedId = id;
    S.emit('select');
  };

  S.addLayer = function (layer) {
    S.commit('add layer');
    // place on a free track at the playhead
    layer.start = Math.max(0, S.time);
    layer.track = S.freeTrack(layer.start, layer.duration);
    S.project.layers.push(layer);
    S.select(layer.id);
    S.emit('layers');
    return layer;
  };

  S.removeLayer = function (id, ripple) {
    var l = S.getLayer(id);
    if (!l) return;
    S.commit('delete layer');
    S.project.layers = S.project.layers.filter(function (x) { return x.id !== id; });
    if (ripple) {
      S.project.layers.forEach(function (x) {
        if (x.track === l.track && x.start > l.start) x.start = Math.max(0, x.start - l.duration);
      });
    }
    if (S.selectedId === id) S.selectedId = null;
    S.emit('layers');
    S.emit('select');
  };

  S.freeTrack = function (start, dur) {
    for (var t = 0; t < 12; t++) {
      var clash = S.project.layers.some(function (l) {
        return l.track === t && start < l.start + l.duration && start + dur > l.start;
      });
      if (!clash) return t;
    }
    return 0;
  };

  S.trackCount = function () {
    var m = 2;
    S.project.layers.forEach(function (l) { m = Math.max(m, l.track + 1); });
    return m + 1; // one spare lane
  };

  // render order: track 0 bottom → higher tracks on top; audio order irrelevant
  S.renderOrder = function () {
    return S.project.layers.slice().sort(function (a, b) { return a.track - b.track; });
  };

  S.activeAt = function (t) {
    return S.renderOrder().filter(function (l) {
      return l.visible && t >= l.start && t < l.start + l.duration;
    });
  };

  // ---------- undo / redo (snapshots, 50) ----------
  function snapshot() { return JSON.stringify(S.project); }
  S.commit = function () {
    S._undo.push(snapshot());
    if (S._undo.length > 50) S._undo.shift();
    S._redo = [];
    S.scheduleSave();
  };
  S.undo = function () {
    if (!S._undo.length) return;
    S._redo.push(snapshot());
    S.project = JSON.parse(S._undo.pop());
    if (!S.getLayer(S.selectedId)) S.selectedId = null;
    S.emit('project'); S.emit('layers'); S.emit('select');
    S.scheduleSave();
  };
  S.redo = function () {
    if (!S._redo.length) return;
    S._undo.push(snapshot());
    S.project = JSON.parse(S._redo.pop());
    if (!S.getLayer(S.selectedId)) S.selectedId = null;
    S.emit('project'); S.emit('layers'); S.emit('select');
    S.scheduleSave();
  };

  // ---------- media ----------
  S.addMedia = function (file, opts) {
    opts = opts || {};
    var id = 'M' + Date.now() + '_' + Math.floor(Math.random() * 1e4);
    var url = URL.createObjectURL(file);
    var kind = /^video\//.test(file.type) ? 'video' : /^audio\//.test(file.type) ? 'audio' : /^image\//.test(file.type) ? 'image' : null;
    if (!kind) {
      // fall back to extension sniffing
      if (/\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(file.name)) kind = 'video';
      else if (/\.(mp3|wav|m4a|ogg|flac|aac)$/i.test(file.name)) kind = 'audio';
      else if (/\.(png|jpe?g|gif|webp)$/i.test(file.name)) kind = 'image';
      else return Promise.reject(new Error('Unsupported file type: ' + file.name));
    }
    var m = { id: id, blob: file, url: url, kind: kind, name: file.name, duration: 0, w: 0, h: 0 };
    return new Promise(function (resolve, reject) {
      if (kind === 'image') {
        var img = new Image();
        img.onload = function () {
          m.w = img.naturalWidth; m.h = img.naturalHeight; m.imgEl = img;
          S.media[id] = m; S.emit('media'); if (!opts.noSave) S.saveMediaBlob(m); resolve(m);
        };
        img.onerror = function () { reject(new Error('Could not read image ' + file.name)); };
        img.src = url;
      } else {
        var el = document.createElement(kind === 'video' ? 'video' : 'audio');
        el.preload = 'auto';
        el.muted = kind === 'video';
        el.playsInline = true;
        el.crossOrigin = 'anonymous';
        el.src = url;
        var to = setTimeout(function () { reject(new Error('Could not read ' + file.name)); }, 15000);
        el.addEventListener('loadedmetadata', function () {
          clearTimeout(to);
          m.duration = el.duration;
          if (kind === 'video') { m.w = el.videoWidth; m.h = el.videoHeight; m.videoEl = el; }
          else m.audioEl = el;
          S.media[id] = m; S.emit('media'); if (!opts.noSave) S.saveMediaBlob(m); resolve(m);
        }, { once: true });
        el.addEventListener('error', function () { clearTimeout(to); reject(new Error('Could not read ' + file.name)); }, { once: true });
      }
    });
  };

  S.layerFromMedia = function (m) {
    var l = S.defaultLayer(m.kind);
    l.name = m.name;
    l.srcId = m.id;
    if (m.kind !== 'image') l.duration = m.duration || 5;
    if (m.kind === 'video') {
      // fit to canvas
      var c = S.project.canvas;
      l.scale = Math.min(c.w / m.w, c.h / m.h);
    }
    if (m.kind === 'image') {
      var c2 = S.project.canvas;
      l.scale = Math.min(c2.w / m.w, c2.h / m.h) * 0.5;
      l.duration = 5;
    }
    return l;
  };

  // ---------- IndexedDB persistence ----------
  var DB_NAME = 'mfvt-editor', DB_VER = 1, _db = null;
  function db() {
    if (_db) return Promise.resolve(_db);
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
        if (!d.objectStoreNames.contains('media')) d.createObjectStore('media');
      };
      req.onsuccess = function () { _db = req.result; resolve(_db); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function idbPut(store, key, val) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var tx = d.transaction(store, 'readwrite');
        tx.objectStore(store).put(val, key);
        tx.oncomplete = res; tx.onerror = function () { rej(tx.error); };
      });
    });
  }
  function idbGet(store, key) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var tx = d.transaction(store, 'readonly');
        var rq = tx.objectStore(store).get(key);
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = function () { rej(rq.error); };
      });
    });
  }
  function idbKeys(store) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var tx = d.transaction(store, 'readonly');
        var rq = tx.objectStore(store).getAllKeys();
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = function () { rej(rq.error); };
      });
    });
  }
  function idbDel(store, key) {
    return db().then(function (d) {
      return new Promise(function (res) {
        var tx = d.transaction(store, 'readwrite');
        tx.objectStore(store).delete(key);
        tx.oncomplete = res; tx.onerror = res;
      });
    });
  }

  S.saveMediaBlob = function (m) {
    idbPut('media', m.id, { blob: m.blob, kind: m.kind, name: m.name }).catch(function () {});
  };

  S.scheduleSave = function () {
    clearTimeout(S._saveTimer);
    S._saveTimer = setTimeout(function () {
      if (!S.project) return;
      idbPut('kv', 'project', JSON.stringify({ project: S.project, nextId: S._nextId, savedAt: Date.now() })).catch(function () {});
    }, 800);
  };

  S.hasSaved = function () {
    return idbGet('kv', 'project').then(function (v) { return !!v; }).catch(function () { return false; });
  };

  S.restore = function () {
    return idbGet('kv', 'project').then(function (raw) {
      if (!raw) throw new Error('no saved project');
      var data = JSON.parse(raw);
      var srcIds = {};
      data.project.layers.forEach(function (l) { if (l.srcId) srcIds[l.srcId] = true; });
      return idbKeys('media').then(function (keys) {
        var loads = keys.filter(function (k) { return srcIds[k]; }).map(function (k) {
          return idbGet('media', k).then(function (rec) {
            if (!rec) return null;
            var f = new File([rec.blob], rec.name || 'media', { type: rec.blob.type });
            return S.addMedia(f, { noSave: true }).then(function (m) {
              // remap: replace the new id with the saved key
              delete S.media[m.id];
              m.id = k;
              S.media[k] = m;
              return m;
            });
          });
        });
        return Promise.all(loads);
      }).then(function () {
        S.project = data.project;
        S._nextId = data.nextId || 1000;
        // drop layers whose media is missing
        S.project.layers = S.project.layers.filter(function (l) { return !l.srcId || S.media[l.srcId]; });
        S.emit('project'); S.emit('layers'); S.emit('media'); S.emit('select');
      });
    });
  };

  S.clearSaved = function () {
    idbDel('kv', 'project');
    idbKeys('media').then(function (keys) { keys.forEach(function (k) { idbDel('media', k); }); });
  };

  // ---------- doorway handoff (tool pages → editor) ----------
  S.takeHandoff = function () {
    return idbGet('kv', 'handoff').then(function (rec) {
      if (!rec) return null;
      idbDel('kv', 'handoff');
      return new File([rec.blob], rec.name || 'video.mp4', { type: rec.blob.type });
    }).catch(function () { return null; });
  };

  global.EdState = S;
})(window);
