/* MyFreeVideoTool — theme, reveals, micro-interactions */
(function () {
  'use strict';

  // ----- Theme -----
  var theme = null;
  try { theme = localStorage.getItem('mfvt-theme'); } catch (e) {}
  if (!theme) theme = (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);

  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.querySelector('.theme-toggle');
    if (btn) btn.addEventListener('click', function () {
      theme = theme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', theme);
      try { localStorage.setItem('mfvt-theme', theme); } catch (e) {}
    });

    // ----- Scroll reveals (single + staggered groups) -----
    var els = document.querySelectorAll('.reveal, .stagger');
    if (els.length) {
      if (reduced || !('IntersectionObserver' in window)) {
        els.forEach(function (el) { el.classList.add('visible'); });
      } else {
        var io = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              entry.target.classList.add('visible');
              io.unobserve(entry.target);
            }
          });
        }, { threshold: 0.12 });
        els.forEach(function (el) { io.observe(el); });
      }
    }

    // ----- Count-up numbers (data-countup="120") -----
    var counters = document.querySelectorAll('[data-countup]');
    if (counters.length && !reduced && 'IntersectionObserver' in window) {
      var cio = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          cio.unobserve(entry.target);
          var el = entry.target;
          var target = parseFloat(el.dataset.countup);
          var suffix = el.dataset.suffix || '';
          var start = performance.now();
          (function tick(now) {
            var t = Math.min(1, (now - start) / 1100);
            var eased = 1 - Math.pow(1 - t, 3);
            el.textContent = Math.round(target * eased) + suffix;
            if (t < 1) requestAnimationFrame(tick);
          })(start);
        });
      }, { threshold: 0.4 });
      counters.forEach(function (el) { cio.observe(el); });
    } else {
      counters.forEach(function (el) { el.textContent = el.dataset.countup + (el.dataset.suffix || ''); });
    }

    // ----- Magnetic buttons (subtle cursor-follow, spring back) -----
    if (!reduced && matchMedia('(pointer: fine)').matches) {
      document.querySelectorAll('.btn--primary').forEach(function (el) {
        el.addEventListener('mousemove', function (e) {
          var r = el.getBoundingClientRect();
          var dx = (e.clientX - r.left - r.width / 2) / r.width;
          var dy = (e.clientY - r.top - r.height / 2) / r.height;
          el.style.transform = 'translate(' + (dx * 5).toFixed(1) + 'px,' + (dy * 4).toFixed(1) + 'px)';
        });
        el.addEventListener('mouseleave', function () {
          el.style.transform = '';
        });
      });
    }
  });
})();
