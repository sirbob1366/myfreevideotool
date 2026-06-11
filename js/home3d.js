/* MyFreeVideoTool — homepage 3D: "THE CUTTING ROOM".
   A film strip with sprocket holes winds through dark space carrying
   procedurally-painted movie stills — some mid-edit with crop marks and
   scrub bars — fed by spinning projector reels under a faint light beam.
   Palette: silver screen + cinema red. No gold.
   Three.js self-hosted (/vendor/three/) for COEP isolation. Lazy after idle,
   pauses offscreen/hidden, static frame under prefers-reduced-motion. */
(function () {
  'use strict';

  var RED = 0xe63b47;
  var SILVER = 0xc9ccd6;
  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  var loaded = false, loading = false, queue = [];
  function whenThree(cb) {
    if (loaded) return cb();
    queue.push(cb);
    if (loading) return;
    loading = true;
    var s = document.createElement('script');
    s.src = '/vendor/three/three.min.js';
    s.onload = function () {
      loaded = true;
      queue.forEach(function (fn) { fn(); });
      queue = [];
    };
    document.head.appendChild(s);
  }
  // start fetching after idle so it never competes with first paint
  if ('requestIdleCallback' in window) requestIdleCallback(function () { whenThree(function () {}); }, { timeout: 2000 });
  else setTimeout(function () { whenThree(function () {}); }, 400);

  // ============ procedural movie stills (canvas → texture) ============
  function drawStill(g, kind, x, y, w, h) {
    var grad;
    if (kind === 0) {            // dusk ridge — magenta night sky over black mountains
      grad = g.createLinearGradient(0, y, 0, y + h);
      grad.addColorStop(0, '#2a2030'); grad.addColorStop(0.7, '#13101c'); grad.addColorStop(1, '#0a0a10');
      g.fillStyle = grad; g.fillRect(x, y, w, h);
      g.fillStyle = '#d8dbe2'; g.beginPath(); g.arc(x + w * 0.72, y + h * 0.3, h * 0.1, 0, 7); g.fill();
      g.fillStyle = '#07070b';
      g.beginPath(); g.moveTo(x, y + h);
      g.lineTo(x + w * 0.3, y + h * 0.55); g.lineTo(x + w * 0.5, y + h * 0.78);
      g.lineTo(x + w * 0.72, y + h * 0.48); g.lineTo(x + w, y + h * 0.85);
      g.lineTo(x + w, y + h); g.closePath(); g.fill();
    } else if (kind === 1) {     // night city
      grad = g.createLinearGradient(0, y, 0, y + h);
      grad.addColorStop(0, '#0d1119'); grad.addColorStop(1, '#05060a');
      g.fillStyle = grad; g.fillRect(x, y, w, h);
      for (var b = 0; b < 9; b++) {
        var bw = w * 0.07 + Math.random() * w * 0.05;
        var bh = h * 0.25 + Math.random() * h * 0.5;
        var bx = x + (b / 9) * w;
        g.fillStyle = '#10141d';
        g.fillRect(bx, y + h - bh, bw, bh);
        g.fillStyle = Math.random() < 0.2 ? '#e63b47' : '#aeb6c6';
        for (var win = 0; win < 5; win++) {
          if (Math.random() < 0.5) g.fillRect(bx + 3 + Math.random() * (bw - 6), y + h - bh + 4 + Math.random() * (bh - 10), 2, 3);
        }
      }
    } else if (kind === 2) {     // moonlit sea
      grad = g.createLinearGradient(0, y, 0, y + h);
      grad.addColorStop(0, '#121826'); grad.addColorStop(0.55, '#0a0e16'); grad.addColorStop(1, '#06080d');
      g.fillStyle = grad; g.fillRect(x, y, w, h);
      g.strokeStyle = 'rgba(216,219,226,0.5)'; g.beginPath();
      g.moveTo(x, y + h * 0.55); g.lineTo(x + w, y + h * 0.55); g.stroke();
      g.fillStyle = '#d8dbe2'; g.beginPath(); g.arc(x + w * 0.3, y + h * 0.25, h * 0.09, 0, 7); g.fill();
      g.fillStyle = 'rgba(216,219,226,0.25)';
      for (var r = 0; r < 7; r++) g.fillRect(x + w * 0.26 + Math.random() * 8, y + h * (0.58 + r * 0.055), w * 0.08 - r * 2, 2);
    } else if (kind === 3) {     // spotlight portrait
      grad = g.createRadialGradient(x + w / 2, y + h * 0.42, 6, x + w / 2, y + h * 0.42, h * 0.85);
      grad.addColorStop(0, '#2c2f3a'); grad.addColorStop(1, '#08090d');
      g.fillStyle = grad; g.fillRect(x, y, w, h);
      g.fillStyle = '#05060a';
      g.beginPath(); g.arc(x + w / 2, y + h * 0.42, h * 0.16, 0, 7); g.fill();
      g.beginPath(); g.arc(x + w / 2, y + h * 1.05, h * 0.42, Math.PI, 0); g.fill();
      g.strokeStyle = 'rgba(216,219,226,0.7)'; g.lineWidth = 1.4;
      g.beginPath(); g.arc(x + w / 2 + 3, y + h * 0.42, h * 0.165, -0.9, 0.9); g.stroke();
    } else if (kind === 4) {     // noir blinds
      g.fillStyle = '#0a0b10'; g.fillRect(x, y, w, h);
      g.save(); g.translate(x + w / 2, y + h / 2); g.rotate(-0.32);
      for (var s2 = -8; s2 < 9; s2++) {
        g.fillStyle = 'rgba(200,204,214,' + (0.05 + (s2 % 2 ? 0.07 : 0)) + ')';
        g.fillRect(-w, s2 * 13, w * 2, 6);
      }
      g.restore();
      g.fillStyle = '#04050a';
      g.beginPath(); g.arc(x + w * 0.62, y + h * 0.52, h * 0.14, 0, 7); g.fill();
      g.beginPath(); g.arc(x + w * 0.62, y + h * 1.08, h * 0.38, Math.PI, 0); g.fill();
    } else {                     // headlights on a wet road
      grad = g.createLinearGradient(0, y, 0, y + h);
      grad.addColorStop(0, '#0a0c12'); grad.addColorStop(1, '#0e0f15');
      g.fillStyle = grad; g.fillRect(x, y, w, h);
      g.strokeStyle = 'rgba(216,219,226,0.35)';
      g.beginPath(); g.moveTo(x, y + h * 0.45); g.lineTo(x + w, y + h * 0.45); g.stroke();
      g.fillStyle = 'rgba(230,59,71,0.85)';
      g.beginPath(); g.arc(x + w * 0.4, y + h * 0.5, 3.2, 0, 7); g.fill();
      g.beginPath(); g.arc(x + w * 0.47, y + h * 0.5, 3.2, 0, 7); g.fill();
      g.fillStyle = 'rgba(230,59,71,0.18)';
      g.fillRect(x + w * 0.385, y + h * 0.52, 4, h * 0.4);
      g.fillRect(x + w * 0.455, y + h * 0.52, 4, h * 0.4);
    }
    // film grain
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.globalAlpha = 0.06;
    for (var d = 0; d < 130; d++) g.fillRect(x + Math.random() * w, y + Math.random() * h, 1, 1);
    g.globalAlpha = 1;
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  // one film cell: black base, sprocket rows, a still, optional edit overlay
  function cellTexture(kind, editing) {
    var c = document.createElement('canvas');
    c.width = 256; c.height = 192;
    var g = c.getContext('2d');
    g.fillStyle = '#0c0c10';
    g.fillRect(0, 0, 256, 192);
    g.fillStyle = '#191920';
    for (var i = 0; i < 7; i++) {
      roundRect(g, 13 + i * 34, 4, 17, 11, 3.5); g.fill();
      roundRect(g, 13 + i * 34, 177, 17, 11, 3.5); g.fill();
    }
    var ix = 9, iy = 21, iw = 238, ih = 150;
    g.save();
    g.beginPath(); g.rect(ix, iy, iw, ih); g.clip();
    drawStill(g, kind, ix, iy, iw, ih);
    g.restore();
    g.strokeStyle = 'rgba(200,204,214,0.4)';
    g.strokeRect(ix + 0.5, iy + 0.5, iw - 1, ih - 1);

    if (editing) {
      // the frame is "being edited": crop marks, selection ants, scrub bar
      g.strokeStyle = '#e63b47';
      g.lineWidth = 1.6;
      g.setLineDash([6, 5]);
      g.strokeRect(ix + 26.5, iy + 20.5, iw - 78, ih - 58);
      g.setLineDash([]);
      var cs = 9;
      [[ix + 26, iy + 20], [ix + iw - 52, iy + 20], [ix + 26, iy + ih - 38], [ix + iw - 52, iy + ih - 38]].forEach(function (pt) {
        g.beginPath();
        g.moveTo(pt[0], pt[1] + cs); g.lineTo(pt[0], pt[1]); g.lineTo(pt[0] + cs, pt[1]);
        g.stroke();
      });
      g.fillStyle = 'rgba(255,255,255,0.22)';
      g.fillRect(ix + 12, iy + ih - 14, iw - 24, 3);
      g.fillStyle = '#e63b47';
      g.fillRect(ix + 12 + Math.random() * (iw - 30), iy + ih - 17, 3, 9);
      g.beginPath(); g.arc(ix + iw - 18, iy + 12, 3.4, 0, 7); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.font = '700 8px monospace';
      g.fillText('REC', ix + iw - 44, iy + 15);
    }
    var tex = new THREE.CanvasTexture(c);
    if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // ============ hero: the cutting room ============
  function initHero(canvas) {
    var renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true }); }
    catch (e) { return null; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

    var scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0b0b0e, 0.048);
    var camera = new THREE.PerspectiveCamera(56, 1, 0.1, 120);
    camera.position.set(0, 0, 9);

    // textures: 6 stills × {plain, editing}
    var textures = [];
    for (var k = 0; k < 6; k++) {
      textures.push(cellTexture(k, false));
      textures.push(cellTexture(k, true));
    }

    // the strip: cells flowing along a sweeping S-curve through the frame
    var CELLS = 26, STEP = 0.92, SPAN = CELLS * STEP;
    var cells = [];
    var cellGeo = new THREE.PlaneGeometry(1.78, 1.34);
    for (var i = 0; i < CELLS; i++) {
      var mat = new THREE.MeshBasicMaterial({
        map: textures[Math.floor(Math.random() * textures.length)],
        transparent: true, opacity: 0.96, side: THREE.DoubleSide
      });
      var m = new THREE.Mesh(cellGeo, mat);
      m.userData.i = i;
      m.userData.twist = (Math.random() - 0.5) * 0.22;
      cells.push(m);
      scene.add(m);
    }
    function pathPoint(s, out) {
      out.set(Math.sin(s * 0.33) * 5.4, Math.cos(s * 0.21) * 2.1, -s * 1.28 + 4.5);
      return out;
    }
    var _p = new THREE.Vector3(), _p2 = new THREE.Vector3();

    // projector reels
    function makeReel() {
      var g = new THREE.Group();
      var solid = new THREE.MeshBasicMaterial({ color: SILVER, transparent: true, opacity: 0.8 });
      var faint = new THREE.MeshBasicMaterial({ color: SILVER, transparent: true, opacity: 0.35 });
      var rim = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.055, 8, 48), solid);
      var mid = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.04, 8, 40), faint);
      var hub = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.16, 18), solid);
      hub.rotation.x = Math.PI / 2;
      var dot = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.2, 12),
        new THREE.MeshBasicMaterial({ color: RED }));
      dot.rotation.x = Math.PI / 2;
      g.add(rim, mid, hub, dot);
      for (var sp = 0; sp < 3; sp++) {
        var spoke = new THREE.Mesh(new THREE.BoxGeometry(0.07, 2.85, 0.05), faint);
        spoke.rotation.z = sp * Math.PI / 3;
        g.add(spoke);
      }
      return g;
    }
    var reelA = makeReel();
    reelA.position.set(-5.6, 2.7, 1.2);
    reelA.rotation.y = 0.5;
    scene.add(reelA);
    var reelB = makeReel();
    reelB.scale.setScalar(0.7);
    reelB.position.set(5.9, -2.5, -0.5);
    reelB.rotation.y = -0.55;
    scene.add(reelB);

    // projector light beam
    var beam = new THREE.Mesh(
      new THREE.ConeGeometry(2.8, 11, 24, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xd8dbe2, transparent: true, opacity: 0.05,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false
      })
    );
    beam.position.set(-4.6, 2.1, -1);
    beam.rotation.z = -1.18;
    scene.add(beam);

    // silver dust
    var N = 480, pos = new Float32Array(N * 3);
    for (var p = 0; p < N; p++) {
      pos[p * 3] = (Math.random() - 0.5) * 34;
      pos[p * 3 + 1] = (Math.random() - 0.5) * 18;
      pos[p * 3 + 2] = -Math.random() * 50 + 6;
    }
    var pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    var dust = new THREE.Points(pg, new THREE.PointsMaterial({
      color: 0xd8dbe2, size: 0.06, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    scene.add(dust);

    var mouse = { x: 0, y: 0 }, targetM = { x: 0, y: 0 };
    addEventListener('mousemove', function (e) {
      targetM.x = (e.clientX / innerWidth - 0.5) * 2;
      targetM.y = (e.clientY / innerHeight - 0.5) * 2;
    }, { passive: true });

    function resize() {
      var r = canvas.parentElement.getBoundingClientRect();
      renderer.setSize(r.width, r.height, false);
      camera.aspect = r.width / Math.max(1, r.height);
      camera.updateProjectionMatrix();
    }
    addEventListener('resize', resize, { passive: true });
    resize();

    return function tick(t) {
      mouse.x += (targetM.x - mouse.x) * 0.05;
      mouse.y += (targetM.y - mouse.y) * 0.05;

      // film advances through the cutting room
      for (var i = 0; i < cells.length; i++) {
        var m = cells[i];
        var s = ((m.userData.i * STEP + t * 0.5) % SPAN + SPAN) % SPAN;
        pathPoint(s, _p);
        pathPoint(s + 0.14, _p2);
        m.position.copy(_p);
        m.lookAt(_p2);
        m.rotateY(Math.PI / 2);
        m.rotateX(m.userData.twist + Math.sin(t * 0.3 + i) * 0.05);
        // fade in from the deep fog, fade out as it passes the lens
        var depth = _p.z;
        m.material.opacity = Math.max(0, Math.min(0.96, (depth + 30) / 14)) * (depth > 5 ? Math.max(0, (7.5 - depth) / 2.5) : 1);
      }
      reelA.rotation.z = t * 0.85;
      reelB.rotation.z = -t * 1.1;
      dust.rotation.y = t * 0.012;
      beam.material.opacity = 0.045 + Math.sin(t * 1.7) * 0.012; // projector flicker

      // cinematic pan + scroll dolly + mouse parallax
      var scroll = Math.min(620, scrollY || 0);
      camera.position.x = mouse.x * 0.8 + Math.sin(t * 0.05) * 0.5;
      camera.position.y = -mouse.y * 0.5 - scroll * 0.0012;
      camera.position.z = 9 - scroll * 0.004;
      camera.lookAt(0.5 + Math.sin(t * 0.06) * 1.5, Math.sin(t * 0.045) * 0.45, -4);

      renderer.render(scene, camera);
    };
  }

  // ============ story vignettes (silver + red) ============
  function pts(n, gen, color, size, opacity) {
    var pos = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) {
      var p = gen();
      pos[i * 3] = p[0]; pos[i * 3 + 1] = p[1]; pos[i * 3 + 2] = p[2];
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return new THREE.Points(g, new THREE.PointsMaterial({
      color: color, size: size, transparent: true, opacity: opacity,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
  }
  function onSphere(rMin, rMax) {
    var r = rMin + Math.random() * (rMax - rMin);
    var th = Math.random() * Math.PI * 2;
    var ph = Math.acos(2 * Math.random() - 1);
    return [r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph)];
  }

  var STORY = {
    shield: function (scene) {
      var group = new THREE.Group();
      var shell = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(3, 1)),
        new THREE.LineBasicMaterial({ color: RED, transparent: true, opacity: 0.3 })
      );
      group.add(shell);
      var inner = pts(260, function () { return onSphere(0.2, 2.5); }, RED, 0.08, 0.8);
      group.add(inner);
      var strays = pts(80, function () { return onSphere(4.6, 9); }, 0x8a8a95, 0.06, 0.3);
      group.add(strays);
      group.position.x = 2.6;
      scene.add(group);
      return function (t) {
        shell.rotation.y = t * 0.1;
        shell.rotation.x = Math.sin(t * 0.25) * 0.15;
        inner.rotation.y = -t * 0.32;
        inner.rotation.x = Math.sin(t * 0.2) * 0.3;
        strays.rotation.y = t * 0.04;
      };
    },
    layers: function (scene) {
      var group = new THREE.Group();
      var edge = new THREE.EdgesGeometry(new THREE.PlaneGeometry(4.6, 2.6));
      var planes = [];
      for (var i = 0; i < 5; i++) {
        var ln = new THREE.LineSegments(edge, new THREE.LineBasicMaterial({
          color: i === 2 ? RED : SILVER, transparent: true, opacity: 0.5 - i * 0.07
        }));
        ln.position.set(i * 0.28 - 0.6, i * 0.34 - 0.7, -i * 0.9);
        planes.push(ln);
        group.add(ln);
      }
      var sparks = pts(110, function () {
        return [(Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4, -Math.random() * 4.5];
      }, SILVER, 0.06, 0.4);
      group.add(sparks);
      group.position.x = 2.4;
      group.rotation.set(-0.22, -0.38, 0.05);
      scene.add(group);
      return function (t) {
        group.rotation.y = -0.38 + Math.sin(t * 0.4) * 0.12;
        for (var i = 0; i < planes.length; i++) {
          planes[i].position.y = i * 0.34 - 0.7 + Math.sin(t * 0.8 + i) * 0.07;
        }
        sparks.rotation.z = t * 0.05;
      };
    },
    export: function (scene) {
      var knot = new THREE.Mesh(
        new THREE.TorusKnotGeometry(1.7, 0.5, 110, 14),
        new THREE.MeshBasicMaterial({ color: SILVER, wireframe: true, transparent: true, opacity: 0.4 })
      );
      knot.position.x = 2.7;
      scene.add(knot);
      var glints = pts(140, function () { return onSphere(2.8, 5); }, RED, 0.07, 0.6);
      glints.position.x = 2.7;
      scene.add(glints);
      return function (t) {
        knot.rotation.y = t * 0.25;
        knot.rotation.x = t * 0.17;
        glints.rotation.y = -t * 0.1;
        glints.rotation.z = t * 0.05;
      };
    }
  };

  function storyScene(canvas, type) {
    var st = { built: false, running: false, t: Math.random() * 10 };
    function build() {
      if (st.built || !STORY[type]) return;
      try { st.renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true }); }
      catch (e) { canvas.remove(); return; }
      st.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
      st.scene = new THREE.Scene();
      st.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 60);
      st.camera.position.set(0, 0, 9);
      st.tick = STORY[type](st.scene);
      st.built = true;
      resize();
      if (reduced) { st.tick(st.t); st.renderer.render(st.scene, st.camera); }
    }
    function resize() {
      if (!st.built) return;
      var r = canvas.parentElement.getBoundingClientRect();
      st.renderer.setSize(r.width, r.height, false);
      st.camera.aspect = r.width / Math.max(1, r.height);
      st.camera.updateProjectionMatrix();
    }
    addEventListener('resize', resize, { passive: true });
    function loop() {
      if (!st.running) return;
      st.t += 0.016;
      st.tick(st.t);
      st.renderer.render(st.scene, st.camera);
      requestAnimationFrame(loop);
    }
    function start() {
      if (reduced || st.running || document.hidden || !st.built) return;
      st.running = true;
      requestAnimationFrame(loop);
    }
    new IntersectionObserver(function (en) {
      if (en[0].isIntersecting) whenThree(function () { build(); start(); });
      else st.running = false;
    }, { threshold: 0.05 }).observe(canvas);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { st.running = false; return; }
      var r = canvas.getBoundingClientRect();
      if (r.bottom > 0 && r.top < innerHeight) start();
    });
  }

  // ============ boot ============
  document.addEventListener('DOMContentLoaded', function () {
    var heroCanvas = document.getElementById('hero3d');
    if (heroCanvas) {
      var hero = { tick: null, running: false, visible: true, t: 0 };
      function startHero() {
        if (reduced || hero.running || document.hidden || !hero.tick) return;
        hero.running = true;
        requestAnimationFrame(loopHero);
      }
      function loopHero() {
        if (!hero.running) return;
        hero.t += 0.016;
        hero.tick(hero.t);
        requestAnimationFrame(loopHero);
      }
      whenThree(function () {
        hero.tick = initHero(heroCanvas);
        if (!hero.tick) return;
        if (reduced) { hero.tick(0); return; }
        new IntersectionObserver(function (en) {
          hero.visible = en[0].isIntersecting;
          if (hero.visible) startHero(); else hero.running = false;
        }, { threshold: 0.02 }).observe(heroCanvas);
        document.addEventListener('visibilitychange', function () {
          if (document.hidden) hero.running = false;
          else if (hero.visible) startHero();
        });
        startHero();
      });
    }
    document.querySelectorAll('.story3d').forEach(function (c) {
      storyScene(c, c.dataset.scene);
    });
  });
})();
