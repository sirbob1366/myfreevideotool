/* Layer rendering: draws each layer type onto a 2D context, computes
   fade/animation envelopes, and runs the WebGL chroma keyer. */
(function (global) {
  'use strict';
  var S = global.EdState;

  var L = {};

  // ---------- envelope: opacity + transform offset from fades/animations ----------
  // returns {alpha, dx, dy, popScale} for layer at time t (dx/dy in canvas px)
  L.envelope = function (l, t, canvasW) {
    var local = t - l.start;
    var alpha = 1, dx = 0, dy = 0, pop = 1;
    var d = l.animDur || 0.5;

    if (l.fadeIn > 0 && local < l.fadeIn) alpha *= local / l.fadeIn;
    if (l.fadeOut > 0 && local > l.duration - l.fadeOut) alpha *= Math.max(0, (l.duration - local) / l.fadeOut);

    if (l.animIn !== 'none' && local < d) {
      var p = Math.max(0, local / d);
      var e = 1 - Math.pow(1 - p, 3); // ease-out cubic
      if (l.animIn === 'fade') alpha *= p;
      else if (l.animIn === 'slide') { dx = (1 - e) * canvasW * 0.25; alpha *= Math.min(1, p * 2); }
      else if (l.animIn === 'pop') { pop *= 0.6 + 0.4 * e; alpha *= Math.min(1, p * 2.5); }
    }
    if (l.animOut !== 'none' && local > l.duration - d) {
      var p2 = Math.max(0, (l.duration - local) / d);
      var e2 = 1 - Math.pow(1 - p2, 3);
      if (l.animOut === 'fade') alpha *= p2;
      else if (l.animOut === 'slide') { dx = -(1 - e2) * canvasW * 0.25; alpha *= Math.min(1, p2 * 2); }
      else if (l.animOut === 'pop') { pop *= 0.6 + 0.4 * e2; alpha *= Math.min(1, p2 * 2.5); }
    }
    return { alpha: Math.max(0, Math.min(1, alpha)), dx: dx, dy: dy, pop: pop };
  };

  // ---------- filter string ----------
  var FPRESETS = {
    none:  null,
    vivid: { brightness: 1.05, contrast: 1.15, saturate: 1.4, temperature: 0 },
    mono:  { brightness: 1, contrast: 1.08, saturate: 0, temperature: 0 },
    warm:  { brightness: 1.02, contrast: 1.02, saturate: 1.1, temperature: 30 },
    cool:  { brightness: 1.0, contrast: 1.04, saturate: 1.05, temperature: -30 },
    fade:  { brightness: 1.08, contrast: 0.85, saturate: 0.8, temperature: 5 }
  };
  L.FPRESETS = FPRESETS;

  L.filterString = function (l) {
    var f = l.fpreset !== 'none' && FPRESETS[l.fpreset] ? FPRESETS[l.fpreset] : l.filters;
    if (!f) f = l.filters;
    var parts = [];
    if (f.brightness !== 1) parts.push('brightness(' + f.brightness + ')');
    if (f.contrast !== 1) parts.push('contrast(' + f.contrast + ')');
    if (f.saturate !== 1) parts.push('saturate(' + f.saturate + ')');
    if (f.temperature > 0) parts.push('sepia(' + Math.round(f.temperature * 0.8) + '%)');
    else if (f.temperature < 0) parts.push('hue-rotate(' + Math.round(f.temperature * 0.45) + 'deg)');
    return parts.length ? parts.join(' ') : 'none';
  };

  // ---------- chroma key (WebGL, CPU-cheap per frame) ----------
  var _gl = null, _glCanvas = null, _glTex = null, _glLoc = {};
  function initGL(w, h) {
    if (!_glCanvas) {
      _glCanvas = document.createElement('canvas');
      _gl = _glCanvas.getContext('webgl', { premultipliedAlpha: false });
      if (!_gl) return null;
      var vs = 'attribute vec2 p;varying vec2 uv;void main(){uv=vec2(p.x*0.5+0.5,0.5-p.y*0.5);gl_Position=vec4(p,0.,1.);}';
      var fs = 'precision mediump float;varying vec2 uv;uniform sampler2D tex;uniform vec3 key;uniform float sim;uniform float smo;' +
        'void main(){vec4 c=texture2D(tex,uv);' +
        'float d=distance(c.rgb,key);' +
        'float a=smoothstep(sim,sim+max(smo,0.001),d);' +
        'gl_FragColor=vec4(c.rgb,c.a*a);}';
      function sh(type, src) {
        var s = _gl.createShader(type);
        _gl.shaderSource(s, src); _gl.compileShader(s);
        return s;
      }
      var prog = _gl.createProgram();
      _gl.attachShader(prog, sh(_gl.VERTEX_SHADER, vs));
      _gl.attachShader(prog, sh(_gl.FRAGMENT_SHADER, fs));
      _gl.linkProgram(prog);
      _gl.useProgram(prog);
      var buf = _gl.createBuffer();
      _gl.bindBuffer(_gl.ARRAY_BUFFER, buf);
      _gl.bufferData(_gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), _gl.STATIC_DRAW);
      var loc = _gl.getAttribLocation(prog, 'p');
      _gl.enableVertexAttribArray(loc);
      _gl.vertexAttribPointer(loc, 2, _gl.FLOAT, false, 0, 0);
      _glTex = _gl.createTexture();
      _gl.bindTexture(_gl.TEXTURE_2D, _glTex);
      _gl.texParameteri(_gl.TEXTURE_2D, _gl.TEXTURE_MIN_FILTER, _gl.LINEAR);
      _gl.texParameteri(_gl.TEXTURE_2D, _gl.TEXTURE_WRAP_S, _gl.CLAMP_TO_EDGE);
      _gl.texParameteri(_gl.TEXTURE_2D, _gl.TEXTURE_WRAP_T, _gl.CLAMP_TO_EDGE);
      _glLoc.key = _gl.getUniformLocation(prog, 'key');
      _glLoc.sim = _gl.getUniformLocation(prog, 'sim');
      _glLoc.smo = _gl.getUniformLocation(prog, 'smo');
    }
    if (_glCanvas.width !== w || _glCanvas.height !== h) {
      _glCanvas.width = w; _glCanvas.height = h;
      _gl.viewport(0, 0, w, h);
    }
    return _gl;
  }

  // keys `source` (video el or canvas) → returns canvas with keyed result, or null
  L.chromaKey = function (source, w, h, chroma) {
    try {
      var gl = initGL(w, h);
      if (!gl) return null;
      gl.bindTexture(gl.TEXTURE_2D, _glTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.uniform3f(_glLoc.key, chroma.color[0] / 255, chroma.color[1] / 255, chroma.color[2] / 255);
      gl.uniform1f(_glLoc.sim, chroma.similarity);
      gl.uniform1f(_glLoc.smo, chroma.smoothness);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return _glCanvas;
    } catch (e) { return null; }
  };

  // ---------- draw one layer ----------
  // ctx: 2D context already scaled so 1 unit = 1 project-canvas px
  L.draw = function (ctx, l, t, project) {
    var env = L.envelope(l, t, project.canvas.w);
    if (env.alpha <= 0.001) return;

    ctx.save();
    ctx.globalAlpha = env.alpha * l.opacity;
    ctx.globalCompositeOperation = l.blend || 'source-over';

    var cx = l.x * project.canvas.w + env.dx;
    var cy = l.y * project.canvas.h + env.dy;
    ctx.translate(cx, cy);
    if (l.rotation) ctx.rotate(l.rotation * Math.PI / 180);
    var sc = l.scale * env.pop;
    ctx.scale(l.flipH ? -sc : sc, l.flipV ? -sc : sc);

    if (l.type === 'video' || l.type === 'image') {
      var m = S.media[l.srcId];
      if (!m) { ctx.restore(); return; }
      var srcEl = l.type === 'video' ? m.videoEl : m.imgEl;
      if (!srcEl) { ctx.restore(); return; }
      var sw = m.w, sh = m.h;
      var crop = l.crop || { l: 0, r: 0, t: 0, b: 0 };
      var sx = crop.l * sw, sy = crop.t * sh;
      var cw = sw * (1 - crop.l - crop.r), ch = sh * (1 - crop.t - crop.b);
      if (cw < 2 || ch < 2) { ctx.restore(); return; }

      ctx.filter = L.filterString(l);
      var drawSrc = srcEl;
      if (l.type === 'video' && l.chroma.enabled) {
        var keyed = L.chromaKey(srcEl, Math.min(sw, 960), Math.min(sh, 960 * sh / sw), l.chroma);
        if (keyed) {
          // keyed canvas is full frame at reduced res; adjust crop coords proportionally
          var kx = keyed.width / sw, ky = keyed.height / sh;
          ctx.drawImage(keyed, sx * kx, sy * ky, cw * kx, ch * ky, -cw / 2, -ch / 2, cw, ch);
          ctx.filter = 'none';
          ctx.restore();
          return;
        }
      }
      try { ctx.drawImage(drawSrc, sx, sy, cw, ch, -cw / 2, -ch / 2, cw, ch); } catch (e) {}
      ctx.filter = 'none';

    } else if (l.type === 'text') {
      var size = l.fontSize;
      ctx.font = (l.bold ? '700 ' : '400 ') + size + 'px Arial, "Helvetica Neue", sans-serif';
      ctx.textAlign = l.align || 'center';
      ctx.textBaseline = 'middle';
      var lines = String(l.text || '').split('\n');
      var lh = size * 1.22;
      var y0 = -((lines.length - 1) * lh) / 2;

      if (l.tstyle === 'pill') {
        var maxW = 0;
        lines.forEach(function (ln) { maxW = Math.max(maxW, ctx.measureText(ln).width); });
        var padX = size * 0.45, padY = size * 0.3;
        ctx.fillStyle = l.tbg || '#000';
        var bx = l.align === 'left' ? -padX : l.align === 'right' ? -maxW - padX : -maxW / 2 - padX;
        roundRect(ctx, bx, y0 - lh / 2 - padY + (lh - size) / 2, maxW + padX * 2, lines.length * lh + padY * 2, size * 0.3);
        ctx.fill();
      }
      lines.forEach(function (ln, i) {
        var y = y0 + i * lh;
        if (l.tstyle === 'outline') {
          ctx.lineWidth = Math.max(2, size / 11);
          ctx.strokeStyle = '#000';
          ctx.lineJoin = 'round';
          ctx.strokeText(ln, 0, y);
        } else if (l.tstyle === 'shadow') {
          ctx.shadowColor = 'rgba(0,0,0,0.8)';
          ctx.shadowBlur = size / 7;
          ctx.shadowOffsetX = size / 22;
          ctx.shadowOffsetY = size / 22;
        }
        ctx.fillStyle = l.color || '#fff';
        ctx.fillText(ln, 0, y);
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
      });

    } else if (l.type === 'shape') {
      var w = l.shapeW * project.canvas.w;
      var h2 = l.shapeH * project.canvas.h;
      ctx.fillStyle = l.fill;
      ctx.strokeStyle = l.stroke;
      ctx.lineWidth = l.strokeW;
      if (l.shape === 'rect') {
        ctx.fillRect(-w / 2, -h2 / 2, w, h2);
        if (l.strokeW > 0) ctx.strokeRect(-w / 2, -h2 / 2, w, h2);
      } else if (l.shape === 'ellipse') {
        ctx.beginPath();
        ctx.ellipse(0, 0, w / 2, h2 / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        if (l.strokeW > 0) ctx.stroke();
      } else if (l.shape === 'line') {
        ctx.strokeStyle = l.fill;
        ctx.lineWidth = Math.max(2, l.strokeW || 6);
        ctx.beginPath();
        ctx.moveTo(-w / 2, 0);
        ctx.lineTo(w / 2, 0);
        ctx.stroke();
      }
    }
    // audio layers draw nothing
    ctx.restore();
  };

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------- bounding box of a layer in project-canvas px (for canvas selection UI) ----------
  L.bounds = function (l, project) {
    var w = 100, h = 100;
    if (l.type === 'video' || l.type === 'image') {
      var m = S.media[l.srcId];
      if (m) {
        var crop = l.crop || { l: 0, r: 0, t: 0, b: 0 };
        w = m.w * (1 - crop.l - crop.r);
        h = m.h * (1 - crop.t - crop.b);
      }
    } else if (l.type === 'text') {
      var lines = String(l.text || ' ').split('\n');
      var longest = lines.reduce(function (a, b) { return b.length > a.length ? b : a; }, '');
      w = Math.max(40, longest.length * l.fontSize * 0.55);
      h = lines.length * l.fontSize * 1.25;
      return { w: w, h: h }; // text bounds unaffected by scale (scale stays 1 for text)
    } else if (l.type === 'shape') {
      w = l.shapeW * project.canvas.w;
      h = l.shapeH * project.canvas.h;
    }
    return { w: w * l.scale, h: h * l.scale };
  };

  // ---------- subtitles ----------
  L.drawSubtitles = function (ctx, t, project) {
    var cue = project.subtitles.find(function (c) { return t >= c.start && t < c.end; });
    if (!cue || !cue.text) return;
    var st = project.subStyle;
    var size = st.size;
    ctx.save();
    ctx.font = '700 ' + size + 'px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var lines = cue.text.split('\n');
    var lh = size * 1.25;
    var cx = project.canvas.w / 2;
    var baseY = st.posY * project.canvas.h - ((lines.length - 1) * lh) / 2;
    lines.forEach(function (ln, i) {
      var y = baseY + i * lh;
      if (st.bg) {
        var w = ctx.measureText(ln).width;
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(cx - w / 2 - size * 0.35, y - lh / 2, w + size * 0.7, lh);
      }
      ctx.lineWidth = Math.max(2, size / 12);
      ctx.strokeStyle = '#000';
      ctx.lineJoin = 'round';
      if (!st.bg) ctx.strokeText(ln, cx, y);
      ctx.fillStyle = st.color || '#fff';
      ctx.fillText(ln, cx, y);
    });
    ctx.restore();
  };

  global.EdLayers = L;
})(window);
