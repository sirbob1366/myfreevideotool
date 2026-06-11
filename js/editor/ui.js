/* Editor UI glue: media bin, layer list, canvas selection box,
   properties panel, subtitles tab, transport, quick actions,
   export dialog, keyboard map, toasts. */
(function (global) {
  'use strict';
  var S = global.EdState;
  var C = global.EdComp;
  var L = global.EdLayers;
  var T = global.EdTimeline;

  var U = { tab: 'props' };

  function $(sel) { return document.querySelector(sel); }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  // ---------- toast ----------
  var toastTimer = 0;
  U.toast = function (msg, isErr) {
    var t = $('.ed-toast');
    t.textContent = msg;
    t.classList.toggle('err', !!isErr);
    t.classList.add('open');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('open'); }, 2600);
  };

  // ---------- media bin ----------
  function renderMedia() {
    var bin = $('#mediaItems');
    bin.innerHTML = '';
    Object.keys(S.media).forEach(function (id) {
      var m = S.media[id];
      var row = el('div', 'media-item');
      var icon = m.kind === 'video' ? '🎬' : m.kind === 'audio' ? '♪' : '🖼';
      row.innerHTML = '<div class="mthumb">' + icon + '</div><span class="mname"></span><span class="mdur">' +
        (m.duration ? fmtT(m.duration) : '') + '</span>';
      row.querySelector('.mname').textContent = m.name;
      row.title = 'Click to add to timeline at the playhead';
      row.addEventListener('click', function () {
        S.addLayer(S.layerFromMedia(m));
        U.toast('Added ' + m.name);
      });
      bin.appendChild(row);
    });
  }

  function importFiles(files) {
    Array.prototype.slice.call(files).forEach(function (f) {
      S.addMedia(f).then(function (m) {
        // auto-add first video to an empty timeline
        if (!S.project.layers.length && m.kind === 'video') {
          S.addLayer(S.layerFromMedia(m));
        }
        U.toast('Imported ' + m.name);
      }).catch(function (err) { U.toast(err.message, true); });
    });
  }

  // ---------- layer list ----------
  var TYPE_ICONS = { video: '🎬', image: '🖼', text: 'T', audio: '♪', shape: '◼' };
  function renderLayers() {
    var list = $('#layerList');
    list.innerHTML = '';
    // top track first (visually top = topmost layer)
    S.project.layers.slice().sort(function (a, b) { return b.track - a.track || a.start - b.start; }).forEach(function (l) {
      var row = el('div', 'layer-row' + (l.id === S.selectedId ? ' selected' : ''));
      row.innerHTML = '<span class="ltype">' + (TYPE_ICONS[l.type] || '?') + '</span><span class="lname"></span>' +
        '<button class="leye' + (l.visible ? '' : ' off') + '" title="Show/hide" type="button">👁</button>';
      row.querySelector('.lname').textContent = l.name;
      row.addEventListener('click', function (e) {
        if (e.target.classList.contains('leye')) {
          S.commit('visibility');
          l.visible = !l.visible;
          S.emit('layers');
          C.render(S.time);
          return;
        }
        S.select(l.id);
      });
      list.appendChild(row);
    });
  }

  // ---------- canvas selection box ----------
  var selBox = null;
  function canvasRect() { return $('#previewCanvas').getBoundingClientRect(); }

  function renderSelBox() {
    var holder = $('.ed-canvas-overlay');
    var l = S.selected();
    if (selBox) { selBox.remove(); selBox = null; }
    if (!l || l.type === 'audio' || !l.visible) return;
    if (S.time < l.start || S.time >= l.start + l.duration) return;

    var p = S.project;
    var r = canvasRect();
    var k = r.width / p.canvas.w;
    var b = L.bounds(l, p);
    selBox = el('div', 'sel-box',
      '<div class="rot-line"></div><div class="h nw"></div><div class="h ne"></div><div class="h sw"></div><div class="h se"></div><div class="h rot" title="Rotate"></div>');
    var w = b.w * k, h = b.h * k;
    selBox.style.width = w + 'px';
    selBox.style.height = h + 'px';
    selBox.style.left = (l.x * p.canvas.w * k - w / 2) + 'px';
    selBox.style.top = (l.y * p.canvas.h * k - h / 2) + 'px';
    selBox.style.transform = 'rotate(' + l.rotation + 'deg)';
    holder.appendChild(selBox);

    selBox.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      var kind = e.target.classList.contains('h')
        ? (e.target.classList.contains('rot') ? 'rot' : 'scale-' + e.target.className.split(' ')[1])
        : 'move';
      var sx = e.clientX, sy = e.clientY;
      var o = { x: l.x, y: l.y, scale: l.scale, rotation: l.rotation, shapeW: l.shapeW, shapeH: l.shapeH, fontSize: l.fontSize };
      var committed = false;
      function mv(ev) {
        if (!committed) { S.commit('transform'); committed = true; }
        var dx = (ev.clientX - sx) / (p.canvas.w * k);
        var dy = (ev.clientY - sy) / (p.canvas.h * k);
        if (kind === 'move') {
          l.x = Math.min(1.2, Math.max(-0.2, o.x + dx));
          l.y = Math.min(1.2, Math.max(-0.2, o.y + dy));
        } else if (kind === 'rot') {
          var cx = r.left + l.x * p.canvas.w * k;
          var cy = r.top + l.y * p.canvas.h * k;
          var ang = Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI + 90;
          l.rotation = ev.shiftKey ? Math.round(ang / 15) * 15 : Math.round(ang);
        } else {
          // corner scale: distance ratio from center
          var cx2 = r.left + o.x * p.canvas.w * k;
          var cy2 = r.top + o.y * p.canvas.h * k;
          var d0 = Math.hypot(sx - cx2, sy - cy2) || 1;
          var d1 = Math.hypot(ev.clientX - cx2, ev.clientY - cy2);
          var f = d1 / d0;
          if (l.type === 'text') l.fontSize = Math.max(10, Math.round(o.fontSize * f));
          else if (l.type === 'shape') { l.shapeW = Math.max(0.02, o.shapeW * f); l.shapeH = Math.max(0.02, o.shapeH * f); }
          else l.scale = Math.max(0.02, o.scale * f);
        }
        C.render(S.time);
        renderSelBox();
        renderProps();
      }
      function up() {
        window.removeEventListener('pointermove', mv);
        window.removeEventListener('pointerup', up);
        S.scheduleSave();
      }
      window.addEventListener('pointermove', mv);
      window.addEventListener('pointerup', up);
    });
  }

  // click on canvas selects topmost layer under point; supports chroma eyedropper
  var eyedropper = null; // callback(r,g,b)
  U.armEyedropper = function (cb) {
    eyedropper = cb;
    U.toast('Click the green-screen color on the preview');
  };

  function onCanvasClick(e) {
    var p = S.project;
    var r = canvasRect();
    var px = (e.clientX - r.left) / r.width * p.canvas.w;
    var py = (e.clientY - r.top) / r.height * p.canvas.h;

    if (eyedropper) {
      var cnv = $('#previewCanvas');
      var g = cnv.getContext('2d');
      var sc = cnv.width / p.canvas.w;
      var d = g.getImageData(Math.round(px * sc), Math.round(py * sc), 1, 1).data;
      eyedropper([d[0], d[1], d[2]]);
      eyedropper = null;
      return;
    }
    // hit test topmost first
    var hits = S.activeAt(S.time).slice().reverse().filter(function (l) {
      if (l.type === 'audio') return false;
      var b = L.bounds(l, p);
      var cx = l.x * p.canvas.w, cy = l.y * p.canvas.h;
      // rotate point into layer space
      var ang = -l.rotation * Math.PI / 180;
      var rx = Math.cos(ang) * (px - cx) - Math.sin(ang) * (py - cy);
      var ry = Math.sin(ang) * (px - cx) + Math.cos(ang) * (py - cy);
      return Math.abs(rx) <= b.w / 2 && Math.abs(ry) <= b.h / 2;
    });
    S.select(hits.length ? hits[0].id : null);
  }

  // ---------- properties panel ----------
  function prow(label, inputHtml, valId) {
    return '<div class="prow"><label>' + label + '</label>' + inputHtml +
      (valId ? '<span class="pval" id="' + valId + '"></span>' : '') + '</div>';
  }
  function slider(id, min, max, step, val) {
    return '<input type="range" id="' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '">';
  }

  function bind(id, evt, fn) {
    var n = $('#' + id);
    if (n) n.addEventListener(evt, fn);
  }
  // commit-once-per-gesture slider binding
  function bindSlide(id, fn) {
    var n = $('#' + id);
    if (!n) return;
    var committed = false;
    n.addEventListener('input', function () {
      if (!committed) { S.commit('adjust'); committed = true; }
      fn(parseFloat(n.value));
      C.render(S.time);
    });
    n.addEventListener('change', function () { committed = false; S.scheduleSave(); });
  }

  function renderProps() {
    if (U.tab !== 'props') return;
    var body = $('#propBody');
    var l = S.selected();
    if (!l) {
      body.innerHTML = '<div class="prop-empty">Select a clip on the timeline or canvas.<br><br>Shortcuts: space play · S split · Ctrl+Z undo · I/O loop region · Del delete</div>';
      return;
    }
    var isAV = l.type === 'video' || l.type === 'audio';
    var isVis = l.type !== 'audio';
    var html = '';

    html += '<div class="prop-sec"><h4>' + l.type + ' — ' + esc(l.name) + '</h4>' +
      '<div class="chip-row">' +
      '<button id="pDup" type="button">Duplicate</button>' +
      '<button id="pSplit" type="button">Split at playhead</button>' +
      '<button id="pDel" type="button" style="color:var(--e-red)">Delete</button>' +
      '</div></div>';

    if (isVis) {
      html += '<div class="prop-sec"><h4>Transform</h4>' +
        prow('X', slider('pX', -0.2, 1.2, 0.005, l.x), 'pXv') +
        prow('Y', slider('pY', -0.2, 1.2, 0.005, l.y), 'pYv') +
        (l.type === 'text' ? prow('Size', slider('pScale', 12, 300, 1, l.fontSize), 'pScalev')
          : l.type === 'shape' ? prow('Width', slider('pShW', 0.02, 1.5, 0.01, l.shapeW), 'pShWv') + prow('Height', slider('pShH', 0.02, 1.5, 0.01, l.shapeH), 'pShHv')
          : prow('Scale', slider('pScale', 0.05, 4, 0.01, l.scale), 'pScalev')) +
        prow('Rotation', slider('pRot', -180, 180, 1, l.rotation), 'pRotv') +
        prow('Opacity', slider('pOp', 0, 1, 0.01, l.opacity), 'pOpv') +
        prow('Blend', '<select id="pBlend"><option value="source-over"' + sel(l.blend, 'source-over') + '>Normal</option><option value="multiply"' + sel(l.blend, 'multiply') + '>Multiply</option><option value="screen"' + sel(l.blend, 'screen') + '>Screen</option></select>') +
        (l.type === 'video' || l.type === 'image' ? '<div class="chip-row"><button id="pFlipH" type="button"' + (l.flipH ? ' class="active"' : '') + '>Flip H</button><button id="pFlipV" type="button"' + (l.flipV ? ' class="active"' : '') + '>Flip V</button></div>' : '') +
        '</div>';
    }

    html += '<div class="prop-sec"><h4>Timing &amp; animation</h4>' +
      prow('Fade in', slider('pFin', 0, 5, 0.1, l.fadeIn), 'pFinv') +
      prow('Fade out', slider('pFout', 0, 5, 0.1, l.fadeOut), 'pFoutv') +
      prow('Enter', '<select id="pAin">' + animOpts(l.animIn) + '</select>') +
      prow('Exit', '<select id="pAout">' + animOpts(l.animOut) + '</select>') +
      prow('Anim time', slider('pAdur', 0.2, 2, 0.1, l.animDur), 'pAdurv') +
      '</div>';

    if (isAV) {
      html += '<div class="prop-sec"><h4>Audio &amp; speed</h4>' +
        prow('Volume', slider('pVol', 0, 2, 0.01, l.volume), 'pVolv') +
        '<div class="chip-row"><button id="pMute" type="button"' + (l.muted ? ' class="active"' : '') + '>Mute</button></div>' +
        prow('Speed', slider('pSpeed', 0.25, 4, 0.05, l.speed), 'pSpeedv') +
        '<div class="prow"><label></label><label style="width:auto;display:flex;gap:6px;align-items:center"><input type="checkbox" id="pPitch"' + (l.pitchCorrect ? ' checked' : '') + '> pitch-corrected</label></div>' +
        '</div>';
    }

    if (l.type === 'video' || l.type === 'image') {
      html += '<div class="prop-sec"><h4>Crop (inset %)</h4>' +
        prow('Left', slider('pCl', 0, 0.45, 0.01, l.crop.l), 'pClv') +
        prow('Right', slider('pCr', 0, 0.45, 0.01, l.crop.r), 'pCrv') +
        prow('Top', slider('pCt', 0, 0.45, 0.01, l.crop.t), 'pCtv') +
        prow('Bottom', slider('pCb', 0, 0.45, 0.01, l.crop.b), 'pCbv') +
        '</div>';
      html += '<div class="prop-sec"><h4>Filters</h4>' +
        '<div class="chip-row" id="pPresets">' +
        ['none', 'vivid', 'mono', 'warm', 'cool', 'fade'].map(function (f) {
          return '<button data-f="' + f + '" type="button"' + (l.fpreset === f ? ' class="active"' : '') + '>' + f + '</button>';
        }).join('') + '</div>' +
        prow('Brightness', slider('pBr', 0.4, 1.8, 0.02, l.filters.brightness), 'pBrv') +
        prow('Contrast', slider('pCo', 0.4, 1.8, 0.02, l.filters.contrast), 'pCov') +
        prow('Saturation', slider('pSa', 0, 2.5, 0.02, l.filters.saturate), 'pSav') +
        prow('Warmth', slider('pTe', -50, 50, 1, l.filters.temperature), 'pTev') +
        '</div>';
    }

    if (l.type === 'video') {
      html += '<div class="prop-sec"><h4>Chroma key (green screen)</h4>' +
        '<div class="prow"><label></label><label style="width:auto;display:flex;gap:6px;align-items:center"><input type="checkbox" id="pCkOn"' + (l.chroma.enabled ? ' checked' : '') + '> enable keying</label></div>' +
        '<div class="chip-row" style="margin-bottom:7px"><button id="pCkPick" type="button">⊙ Pick color from frame</button>' +
        '<span style="width:18px;height:18px;border-radius:5px;display:inline-block;border:1px solid var(--e-line2);background:rgb(' + l.chroma.color.join(',') + ')"></span></div>' +
        prow('Similarity', slider('pCkSim', 0.02, 0.8, 0.01, l.chroma.similarity), 'pCkSimv') +
        prow('Smoothness', slider('pCkSmo', 0, 0.4, 0.01, l.chroma.smoothness), 'pCkSmov') +
        '</div>';
    }

    if (l.type === 'text') {
      html += '<div class="prop-sec"><h4>Text</h4>' +
        '<textarea id="pText" rows="2">' + esc(l.text) + '</textarea>' +
        '<div class="prow" style="margin-top:7px"><label>Color</label><input type="color" id="pTColor" value="' + l.color + '">' +
        '<select id="pTStyle"><option value="outline"' + sel(l.tstyle, 'outline') + '>Outline</option><option value="shadow"' + sel(l.tstyle, 'shadow') + '>Shadow</option><option value="pill"' + sel(l.tstyle, 'pill') + '>Background pill</option><option value="plain"' + sel(l.tstyle, 'plain') + '>Plain</option></select></div>' +
        '<div class="prow"><label>Pill color</label><input type="color" id="pTBg" value="' + l.tbg + '">' +
        '<label style="width:auto;display:flex;gap:6px;align-items:center"><input type="checkbox" id="pTBold"' + (l.bold ? ' checked' : '') + '> bold</label></div>' +
        '<div class="chip-row" id="pAlign">' +
        ['left', 'center', 'right'].map(function (a) { return '<button data-a="' + a + '" type="button"' + (l.align === a ? ' class="active"' : '') + '>' + a + '</button>'; }).join('') +
        '</div></div>';
    }

    if (l.type === 'shape') {
      html += '<div class="prop-sec"><h4>Shape</h4>' +
        '<div class="chip-row" id="pShapeKind">' +
        ['rect', 'ellipse', 'line'].map(function (s2) { return '<button data-s="' + s2 + '" type="button"' + (l.shape === s2 ? ' class="active"' : '') + '>' + s2 + '</button>'; }).join('') + '</div>' +
        '<div class="prow" style="margin-top:7px"><label>Fill</label><input type="color" id="pFill" value="' + l.fill + '"><label style="width:auto">Stroke</label><input type="color" id="pStroke" value="' + l.stroke + '"></div>' +
        prow('Stroke W', slider('pStrokeW', 0, 30, 1, l.strokeW), 'pStrokeWv') +
        '</div>';
    }

    body.innerHTML = html;

    // wire
    bind('pDup', 'click', function () { T.duplicate(); });
    bind('pSplit', 'click', function () { T.split(); });
    bind('pDel', 'click', function () { S.removeLayer(l.id); C.render(S.time); });

    bindSlide('pX', function (v) { l.x = v; renderSelBox(); });
    bindSlide('pY', function (v) { l.y = v; renderSelBox(); });
    bindSlide('pScale', function (v) { if (l.type === 'text') l.fontSize = v; else l.scale = v; renderSelBox(); });
    bindSlide('pShW', function (v) { l.shapeW = v; renderSelBox(); });
    bindSlide('pShH', function (v) { l.shapeH = v; renderSelBox(); });
    bindSlide('pRot', function (v) { l.rotation = v; renderSelBox(); });
    bindSlide('pOp', function (v) { l.opacity = v; });
    bind('pBlend', 'change', function () { S.commit('blend'); l.blend = this.value; C.render(S.time); });
    bind('pFlipH', 'click', function () { S.commit('flip'); l.flipH = !l.flipH; C.render(S.time); renderProps(); });
    bind('pFlipV', 'click', function () { S.commit('flip'); l.flipV = !l.flipV; C.render(S.time); renderProps(); });

    bindSlide('pFin', function (v) { l.fadeIn = v; });
    bindSlide('pFout', function (v) { l.fadeOut = v; });
    bind('pAin', 'change', function () { S.commit('anim'); l.animIn = this.value; });
    bind('pAout', 'change', function () { S.commit('anim'); l.animOut = this.value; });
    bindSlide('pAdur', function (v) { l.animDur = v; });

    bindSlide('pVol', function (v) { l.volume = v; });
    bind('pMute', 'click', function () { S.commit('mute'); l.muted = !l.muted; renderProps(); });
    bindSlide('pSpeed', function (v) {
      // keep media coverage valid: clamp duration after speed change.
      // NOTE: no emit here — a layers event re-renders this panel and would
      // destroy the slider mid-drag; the timeline refreshes on 'change'.
      l.speed = v;
      var m = S.media[l.srcId];
      if (m && m.duration) l.duration = Math.min(l.duration, (m.duration - l.inPoint) / v);
    });
    bind('pSpeed', 'change', function () { S.emit('layers'); });
    bind('pPitch', 'change', function () { l.pitchCorrect = this.checked; });

    ['pCl', 'pCr', 'pCt', 'pCb'].forEach(function (id) {
      bindSlide(id, function (v) {
        l.crop[{ pCl: 'l', pCr: 'r', pCt: 't', pCb: 'b' }[id]] = v;
        renderSelBox();
      });
    });

    var presets = $('#pPresets');
    if (presets) presets.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      S.commit('filter preset');
      l.fpreset = b.dataset.f;
      if (b.dataset.f !== 'none' && L.FPRESETS[b.dataset.f]) {
        l.filters = JSON.parse(JSON.stringify(L.FPRESETS[b.dataset.f]));
      }
      C.render(S.time);
      renderProps();
    });
    bindSlide('pBr', function (v) { l.filters.brightness = v; l.fpreset = 'none'; });
    bindSlide('pCo', function (v) { l.filters.contrast = v; l.fpreset = 'none'; });
    bindSlide('pSa', function (v) { l.filters.saturate = v; l.fpreset = 'none'; });
    bindSlide('pTe', function (v) { l.filters.temperature = v; l.fpreset = 'none'; });

    bind('pCkOn', 'change', function () { S.commit('chroma'); l.chroma.enabled = this.checked; C.render(S.time); });
    bind('pCkPick', 'click', function () {
      U.armEyedropper(function (rgb) {
        S.commit('chroma color');
        l.chroma.color = rgb;
        l.chroma.enabled = true;
        C.render(S.time);
        renderProps();
      });
    });
    bindSlide('pCkSim', function (v) { l.chroma.similarity = v; });
    bindSlide('pCkSmo', function (v) { l.chroma.smoothness = v; });

    bind('pText', 'input', function () { l.text = this.value; l.name = this.value.split('\n')[0].slice(0, 24) || 'text'; C.render(S.time); S.scheduleSave(); });
    bind('pText', 'focus', function () { S.commit('text'); });
    bind('pTColor', 'input', function () { l.color = this.value; C.render(S.time); });
    bind('pTBg', 'input', function () { l.tbg = this.value; C.render(S.time); });
    bind('pTStyle', 'change', function () { S.commit('text style'); l.tstyle = this.value; C.render(S.time); });
    bind('pTBold', 'change', function () { l.bold = this.checked; C.render(S.time); });
    var alignRow = $('#pAlign');
    if (alignRow) alignRow.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      S.commit('align'); l.align = b.dataset.a; C.render(S.time); renderProps();
    });

    var shapeKind = $('#pShapeKind');
    if (shapeKind) shapeKind.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      S.commit('shape'); l.shape = b.dataset.s; C.render(S.time); renderProps();
    });
    bind('pFill', 'input', function () { l.fill = this.value; C.render(S.time); });
    bind('pStroke', 'input', function () { l.stroke = this.value; C.render(S.time); });
    bindSlide('pStrokeW', function (v) { l.strokeW = v; });

    refreshVals();
  }

  function refreshVals() {
    document.querySelectorAll('.prow input[type="range"]').forEach(function (n) {
      var v = $('#' + n.id + 'v');
      if (v) v.textContent = (+n.value).toFixed(n.step >= 1 ? 0 : 2);
    });
  }
  document.addEventListener('input', function (e) {
    if (e.target.matches('.prow input[type="range"]')) refreshVals();
  });

  function animOpts(cur) {
    return ['none', 'fade', 'slide', 'pop'].map(function (a) {
      return '<option value="' + a + '"' + sel(cur, a) + '>' + a + '</option>';
    }).join('');
  }
  function sel(a, b) { return a === b ? ' selected' : ''; }
  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function fmtT(s) {
    var m = Math.floor(s / 60);
    return m + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  }

  // ---------- subtitles tab ----------
  function renderSubs() {
    if (U.tab !== 'subs') return;
    var body = $('#propBody');
    var p = S.project;
    var html = '<div class="prop-sec"><h4>Subtitle style</h4>' +
      prow('Size', slider('sSize', 20, 100, 2, p.subStyle.size), 'sSizev') +
      '<div class="prow"><label>Color</label><input type="color" id="sColor" value="' + p.subStyle.color + '">' +
      '<label style="width:auto;display:flex;gap:6px;align-items:center"><input type="checkbox" id="sBg"' + (p.subStyle.bg ? ' checked' : '') + '> background</label></div>' +
      prow('Position', slider('sPos', 0.1, 0.95, 0.01, p.subStyle.posY), 'sPosv') +
      '</div>' +
      '<div class="prop-sec"><h4>Cues</h4>' +
      '<div class="chip-row" style="margin-bottom:8px">' +
      '<button id="sAdd" type="button">+ Add at playhead</button>' +
      '<button id="sImport" type="button">Import SRT/VTT</button>' +
      '<button id="sExportSrt" type="button">Export SRT</button>' +
      '<button id="sExportVtt" type="button">Export VTT</button>' +
      '</div><div id="subRows"></div>' +
      '<p class="note" style="font-size:10.5px;color:var(--e-ink2)">Subtitles burn in at export. Auto-transcription is coming later — manual entry and SRT import cover the workflow today.</p>' +
      '</div>';
    body.innerHTML = html;

    bindSlide('sSize', function (v) { p.subStyle.size = v; });
    bind('sColor', 'input', function () { p.subStyle.color = this.value; C.render(S.time); });
    bind('sBg', 'change', function () { p.subStyle.bg = this.checked; C.render(S.time); });
    bindSlide('sPos', function (v) { p.subStyle.posY = v; });

    bind('sAdd', 'click', function () {
      S.commit('subtitle');
      p.subtitles.push({ start: round2(S.time), end: round2(S.time + 2.5), text: 'New subtitle' });
      p.subtitles.sort(function (a, b) { return a.start - b.start; });
      renderSubs();
      C.render(S.time);
    });
    bind('sImport', 'click', function () {
      var inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.srt,.vtt';
      inp.onchange = function () {
        if (!inp.files.length) return;
        inp.files[0].text().then(function (txt) {
          var cues = parseSubs(txt);
          if (!cues.length) return U.toast('No cues found in that file.', true);
          S.commit('import subtitles');
          p.subtitles = cues;
          renderSubs();
          C.render(S.time);
          U.toast('Imported ' + cues.length + ' cues');
        });
      };
      inp.click();
    });
    bind('sExportSrt', 'click', function () { exportSubs('srt'); });
    bind('sExportVtt', 'click', function () { exportSubs('vtt'); });

    var rows = $('#subRows');
    p.subtitles.forEach(function (cue, i) {
      var row = el('div', 'sub-row',
        '<input type="text" class="sub-t" value="' + secToStamp(cue.start, false) + '" title="start">' +
        '<input type="text" class="sub-t" value="' + secToStamp(cue.end, false) + '" title="end">' +
        '<textarea rows="1"></textarea>' +
        '<button class="ed-btn ed-btn--sm" type="button" title="Jump">→</button>' +
        '<button class="ed-btn ed-btn--sm ed-btn--danger" type="button" title="Delete">✕</button>');
      row.querySelector('textarea').value = cue.text;
      var tIns = row.querySelectorAll('.sub-t');
      tIns[0].addEventListener('change', function () { S.commit('cue'); cue.start = stampToSec(this.value); C.render(S.time); });
      tIns[1].addEventListener('change', function () { S.commit('cue'); cue.end = stampToSec(this.value); C.render(S.time); });
      row.querySelector('textarea').addEventListener('input', function () { cue.text = this.value; C.render(S.time); S.scheduleSave(); });
      row.querySelectorAll('button')[0].addEventListener('click', function () { C.seek(cue.start + 0.01); });
      row.querySelectorAll('button')[1].addEventListener('click', function () {
        S.commit('delete cue');
        p.subtitles.splice(i, 1);
        renderSubs();
        C.render(S.time);
      });
      rows.appendChild(row);
    });
  }

  function round2(n) { return Math.round(n * 100) / 100; }
  function secToStamp(s, comma) {
    var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = Math.floor(s % 60), ms = Math.round((s % 1) * 1000);
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0') + (comma ? ',' : '.') + String(ms).padStart(3, '0');
  }
  function stampToSec(str) {
    var m = /(\d+):(\d+):(\d+)[.,](\d+)/.exec(str) || /(\d+):(\d+)[.,]?(\d*)/.exec(str);
    if (!m) return 0;
    if (m.length === 5) return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
    return (+m[1]) * 60 + (+m[2]) + (m[3] ? +('0.' + m[3]) : 0);
  }
  function parseSubs(txt) {
    var cues = [];
    txt = txt.replace(/\r/g, '');
    var re = /(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})[^\n]*\n([\s\S]*?)(?=\n\n|\n*$)/g;
    var m;
    while ((m = re.exec(txt))) {
      var text = m[3].trim().replace(/<[^>]+>/g, '');
      if (text) cues.push({ start: stampToSec(m[1]), end: stampToSec(m[2]), text: text });
    }
    return cues;
  }
  function exportSubs(fmt) {
    var p = S.project;
    if (!p.subtitles.length) return U.toast('No subtitles yet.', true);
    var out = fmt === 'vtt' ? 'WEBVTT\n\n' : '';
    p.subtitles.forEach(function (c, i) {
      if (fmt === 'srt') out += (i + 1) + '\n' + secToStamp(c.start, true) + ' --> ' + secToStamp(c.end, true) + '\n' + c.text + '\n\n';
      else out += secToStamp(c.start, false) + ' --> ' + secToStamp(c.end, false) + '\n' + c.text + '\n\n';
    });
    var blob = new Blob([out], { type: 'text/plain' });
    global.VideoEngine ? global.VideoEngine.downloadBlob(blob, 'subtitles.' + fmt) : (function () {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'subtitles.' + fmt; a.click();
    })();
  }

  // ---------- export dialog ----------
  function openExport() {
    $('#exportDialog').classList.add('open');
    $('#expProg').style.display = 'none';
    $('#expActions').style.display = '';
    $('#expDone').style.display = 'none';
  }
  function runExport() {
    var fmt = $('#expFmt').value;
    var res = $('#expRes').value;
    $('#expProg').style.display = 'block';
    $('#expActions').style.display = 'none';
    var fill = $('#expFill'), lab = $('#expLabel'), pct = $('#expPct');
    global.EdExport.start({
      format: fmt,
      height: res === 'source' ? 0 : +res,
      onProgress: function (p, label) {
        fill.style.width = Math.round(p * 100) + '%';
        pct.textContent = Math.round(p * 100) + '%';
        lab.textContent = label;
      },
      onDone: function (blob, ext) {
        $('#expProg').style.display = 'none';
        $('#expDone').style.display = 'block';
        $('#expDone').innerHTML = '<p style="margin:0 0 10px">✓ Export complete — ' + fmtBytes(blob.size) + '</p>' +
          '<button class="ed-btn ed-btn--amber" id="expDl" type="button">Download .' + ext + '</button> ' +
          '<button class="ed-btn" id="expClose2" type="button">Close</button>';
        $('#expDl').addEventListener('click', function () {
          global.VideoEngine.downloadBlob(blob, 'myfreevideotool-export.' + ext);
        });
        $('#expClose2').addEventListener('click', function () { $('#exportDialog').classList.remove('open'); });
      },
      onError: function (err) {
        $('#expProg').style.display = 'none';
        $('#expActions').style.display = '';
        if (!/cancelled/i.test(err.message || '')) U.toast(err.message || 'Export failed', true);
      }
    });
  }
  function fmtBytes(b) { return b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1) + ' MB'; }

  // ---------- quick actions ----------
  var QA = {
    trim: function () {
      U.toast('Drop a video, then drag the clip edges on the timeline to trim');
      $('#mediaFile').click();
    },
    music: function () {
      var inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'audio/*';
      inp.onchange = function () { if (inp.files.length) importFiles(inp.files); };
      inp.click();
    },
    subtitles: function () { setTab('subs'); },
    meme: function () {
      S.commit('meme preset');
      var top = S.defaultLayer('text');
      top.text = 'TOP TEXT'; top.y = 0.09; top.fontSize = 90; top.duration = Math.max(5, S.duration()); top.start = 0; top.track = S.freeTrack(0, top.duration); top.name = 'TOP TEXT';
      var bot = S.defaultLayer('text');
      bot.text = 'BOTTOM TEXT'; bot.y = 0.9; bot.fontSize = 90; bot.duration = top.duration; bot.start = 0; bot.track = S.freeTrack(0, bot.duration); bot.name = 'BOTTOM TEXT';
      S.project.layers.push(top, bot);
      S.emit('layers');
      S.select(top.id);
      U.toast('Meme text added — drag to position, edit in the panel');
    },
    vertical: function () {
      S.setPreset('9:16');
      C.resize();
      U.toast('Canvas set to 9:16 for TikTok / Reels / Shorts');
    }
  };

  // ---------- tabs ----------
  function setTab(tab) {
    U.tab = tab;
    document.querySelectorAll('.prop-tab').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    tab === 'subs' ? renderSubs() : renderProps();
  }

  // ---------- keyboard ----------
  function onKey(e) {
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    var k = e.key.toLowerCase();
    if (e.code === 'Space') { e.preventDefault(); C.toggle(); }
    else if (k === 'arrowleft') { e.preventDefault(); C.step(e.shiftKey ? -30 : -1); }
    else if (k === 'arrowright') { e.preventDefault(); C.step(e.shiftKey ? 30 : 1); }
    else if (k === 'j') C.shuttle(-1);
    else if (k === 'k') C.shuttle(0);
    else if (k === 'l') C.shuttle(1);
    else if (k === 's' && !e.ctrlKey && !e.metaKey) T.split();
    else if (k === 'i') { S.loop = S.loop || { start: 0, end: S.duration() }; S.loop.start = S.time; if (S.loop.end <= S.loop.start) S.loop.end = S.duration(); T.refreshLoop(); }
    else if (k === 'o') { S.loop = S.loop || { start: 0, end: S.duration() }; S.loop.end = S.time; if (S.loop.start >= S.loop.end) S.loop.start = 0; T.refreshLoop(); }
    else if (k === 'escape') { S.loop = null; T.refreshLoop(); }
    else if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) { e.preventDefault(); S.undo(); C.render(S.time); }
    else if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); S.redo(); C.render(S.time); }
    else if ((e.ctrlKey || e.metaKey) && k === 'd') { e.preventDefault(); T.duplicate(); }
    else if ((e.ctrlKey || e.metaKey) && k === 'c') { T.copy(); }
    else if ((e.ctrlKey || e.metaKey) && k === 'v') { T.paste(); }
    else if (k === 'delete' || k === 'backspace') {
      if (S.selectedId) { S.removeLayer(S.selectedId, e.shiftKey); C.render(S.time); }
    }
  }

  // ---------- init ----------
  U.init = function () {
    // media import
    var addBtn = $('#mediaAdd');
    var fileInput = $('#mediaFile');
    addBtn.addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () {
      if (fileInput.files.length) importFiles(fileInput.files);
      fileInput.value = '';
    });
    ['dragenter', 'dragover'].forEach(function (evt) {
      document.addEventListener(evt, function (e) { e.preventDefault(); addBtn.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach(function (evt) {
      document.addEventListener(evt, function (e) {
        e.preventDefault();
        if (evt === 'drop' || e.target === document.documentElement) addBtn.classList.remove('dragover');
      });
    });
    document.addEventListener('drop', function (e) {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files.length) importFiles(e.dataTransfer.files);
    });

    // add layer buttons
    $('#addText').addEventListener('click', function () { S.addLayer(S.defaultLayer('text')); });
    $('#addShape').addEventListener('click', function () { S.addLayer(S.defaultLayer('shape')); });

    // canvas
    $('.ed-canvas-overlay').addEventListener('pointerdown', function (e) {
      if (e.target.closest('.sel-box')) return;
      onCanvasClick(e);
    });

    // transport
    $('#tPlay').addEventListener('click', function () { C.toggle(); });
    $('#tBack').addEventListener('click', function () { C.step(-1); });
    $('#tFwd').addEventListener('click', function () { C.step(1); });

    // canvas preset
    $('#canvasPreset').addEventListener('change', function () {
      S.setPreset(this.value);
      C.resize();
    });

    // undo/redo buttons
    $('#btnUndo').addEventListener('click', function () { S.undo(); C.render(S.time); });
    $('#btnRedo').addEventListener('click', function () { S.redo(); C.render(S.time); });

    // export
    $('#btnExport').addEventListener('click', openExport);
    $('#expGo').addEventListener('click', runExport);
    $('#expCancel').addEventListener('click', function () {
      global.EdExport.cancel();
      $('#exportDialog').classList.remove('open');
    });
    $('#expClose').addEventListener('click', function () { $('#exportDialog').classList.remove('open'); });

    // quick actions
    document.querySelectorAll('.qa-btn').forEach(function (b) {
      b.addEventListener('click', function () { if (QA[b.dataset.qa]) QA[b.dataset.qa](); });
    });

    // tabs
    document.querySelectorAll('.prop-tab').forEach(function (b) {
      b.addEventListener('click', function () { setTab(b.dataset.tab); });
    });

    // zoom slider
    $('#tlZoom').addEventListener('input', function () { T.setZoom(+this.value); });

    document.addEventListener('keydown', onKey);

    // state subscriptions
    S.on('media', renderMedia);
    S.on('layers', function () { renderLayers(); if (U.tab === 'props') renderProps(); renderSelBox(); });
    S.on('select', function () { renderLayers(); setTab('props'); renderSelBox(); T.refreshSelection(); });
    S.on('project', function () {
      $('#canvasPreset').value = S.project.preset;
      renderLayers();
      renderProps();
    });
    S.on('transport', function () {
      $('#tPlay').innerHTML = S.playing
        ? '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.54.84l10-6.5a1 1 0 0 0 0-1.68l-10-6.5A1 1 0 0 0 8 5.5z"/></svg>';
    });

    C.onFrame = function (t) {
      $('#tTime').innerHTML = '<b>' + tc(t) + '</b> <span>/ ' + tc(S.duration()) + '</span>';
      T.refreshPlayhead();
      renderSelBox();
    };
    C.onFrame(0);
    setTab('props');
  };

  function tc(s) {
    var m = Math.floor(s / 60), sec = s % 60;
    return String(m).padStart(2, '0') + ':' + (sec < 10 ? '0' : '') + sec.toFixed(1);
  }

  U.renderProps = renderProps;
  U.importFiles = importFiles;
  global.EdUI = U;
})(window);
