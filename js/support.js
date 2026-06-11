/* MyFreeVideoTool — support widget. Fully client-side: searchable FAQ +
   mailto fallback. No network calls. Lazy-loaded by site.js after idle. */
(function () {
  'use strict';
  if (document.getElementById('mfvt-help-btn')) return;

  var EMAIL = ['sawantrob', '@', 'gmail', '.', 'com'].join('');
  var SITE = 'MyFreeVideoTool';

  var FAQS = [
    { q: 'Is it really free? What’s the catch?',
      a: 'Yes — every tool and the full editor are 100% free with no watermark, no signup and no export caps. There’s no catch: your videos are processed on your own device, so we have no server costs to pass on to you.',
      k: 'free cost price catch watermark signup account login pay premium pro paywall money' },
    { q: 'Are my videos uploaded to a server?',
      a: 'No. Files never leave your device — all processing happens inside your browser using WebAssembly and WebGL. There is no upload, which is also why even large files open instantly.',
      k: 'upload server privacy private secure safe cloud data leave device local browser store' },
    { q: 'Is there a file size limit?',
      a: 'No hard limit — the practical ceiling is your device’s memory. Lossless operations like trim and mute handle very large files easily; re-encoding tools (compress, convert) work harder, so very long 4K files can be slow on low-RAM devices.',
      k: 'size limit big large maximum max gb mb long 4k memory ram cap' },
    { q: 'Why does the editor export take so long?',
      a: 'Editor exports render in real time — every frame is composited live on your machine, so a 3-minute project takes about 3 minutes to export. The single-purpose tools are faster, and lossless trims finish in seconds.',
      k: 'export slow long time render speed stuck wait progress minutes editor' },
    { q: 'Which formats can I convert?',
      a: 'The Convert tool handles MP4, WebM, MOV, MKV and AVI, and there are dedicated Video-to-GIF and Video-to-MP3 tools. Conversion runs on FFmpeg compiled to WebAssembly, entirely on-device.',
      k: 'format convert conversion mp4 webm mov mkv avi gif mp3 codec change type' },
    { q: 'How do I merge more than two videos?',
      a: 'The Merge Videos tool accepts as many clips as you like — add them all, drag to reorder, and export. If you want transitions, music or text between clips, open the full Editor and place the clips on the timeline.',
      k: 'merge combine join multiple many clips two three videos together concatenate' },
    { q: 'Can subtitles be generated automatically?',
      a: 'Not yet — auto-AI subtitles are on the roadmap. Today you can type subtitles manually or import an existing .SRT file in the subtitle tool or the editor, then burn them into your video.',
      k: 'subtitles captions auto automatic ai transcribe srt speech text generate' },
    { q: 'Why is my trim cut point slightly off?',
      a: 'Fast trims are lossless stream copies, which can only cut on keyframes — that’s why they finish in seconds but may shift the cut by a moment. Choose the re-encode option for frame-exact cuts.',
      k: 'trim cut exact precise keyframe off wrong point accurate frame lossless' },
    { q: 'Does it work on phones and tablets?',
      a: 'Yes — the tools work in modern mobile browsers. Heavy jobs like compressing long videos are faster on a desktop, and the Screen Recorder needs a desktop browser.',
      k: 'phone mobile iphone android tablet ipad ios safari work support device' },
    { q: 'My file won’t open or plays without sound',
      a: 'Your browser is probably missing a decoder for that codec (common with HEVC/H.265 .MOV files). Run the file through the Convert tool to MP4 first, or use Chrome or Edge, which have the broadest codec support.',
      k: 'open broken error sound audio missing black hevc h265 mov unsupported play fail won’t wont' }
  ];

  var css = '\n' +
    '#mfvt-help-btn{position:fixed;right:20px;bottom:20px;z-index:95;width:48px;height:48px;border-radius:50%;border:none;cursor:pointer;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:var(--shadow-float);transition:transform .15s ease,box-shadow .15s ease}' +
    '#mfvt-help-btn:hover{transform:translateY(-2px);box-shadow:var(--glow),var(--shadow-float)}' +
    '#mfvt-help-btn:focus-visible{outline:2px solid var(--accent);outline-offset:3px}' +
    '#mfvt-help-panel{position:fixed;right:20px;bottom:80px;z-index:95;width:min(360px,calc(100vw - 40px));max-height:min(540px,calc(100vh - 110px));display:none;flex-direction:column;background:var(--panel);border:1px solid var(--border-2);border-radius:var(--radius);box-shadow:var(--shadow-hover);overflow:hidden;font-family:var(--font)}' +
    '#mfvt-help-panel.open{display:flex}' +
    '.mfvt-h-head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--border);background:var(--panel-2)}' +
    '.mfvt-h-head svg{flex:none;border-radius:8px}' +
    '.mfvt-h-title{font-weight:800;font-size:.92rem;letter-spacing:-.02em;color:var(--ink);flex:1}' +
    '.mfvt-h-close{border:1px solid var(--border-2);background:var(--panel);color:var(--ink-2);width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:14px;line-height:1}' +
    '.mfvt-h-close:hover{color:var(--ink);border-color:var(--accent)}' +
    '.mfvt-h-greet{margin:14px 16px 0;padding:10px 14px;background:var(--accent-tint);border:1px solid var(--border);border-radius:14px 14px 14px 4px;color:var(--ink);font-size:.85rem;line-height:1.5}' +
    '.mfvt-h-search{margin:12px 16px;padding:9px 12px;border:1px solid var(--border-2);border-radius:10px;background:var(--canvas);color:var(--ink);font-size:.85rem;font-family:var(--font)}' +
    '.mfvt-h-search:focus{outline:none;border-color:var(--accent)}' +
    '.mfvt-h-search::placeholder{color:var(--ink-2)}' +
    '.mfvt-h-list{overflow-y:auto;padding:0 10px 10px;flex:1}' +
    '.mfvt-h-item{border:1px solid transparent;border-radius:10px;margin:2px 0}' +
    '.mfvt-h-item summary{list-style:none;cursor:pointer;padding:9px 10px;font-size:.85rem;font-weight:600;color:var(--ink);border-radius:10px;display:flex;gap:8px;align-items:baseline}' +
    '.mfvt-h-item summary::-webkit-details-marker{display:none}' +
    '.mfvt-h-item summary::before{content:"+";color:var(--accent);font-family:var(--mono);font-weight:700;flex:none}' +
    '.mfvt-h-item[open] summary::before{content:"−"}' +
    '.mfvt-h-item summary:hover{background:var(--accent-tint)}' +
    '.mfvt-h-item summary:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}' +
    '.mfvt-h-item[open]{border-color:var(--border);background:var(--panel-2)}' +
    '.mfvt-h-item p{margin:0;padding:2px 12px 12px 28px;font-size:.82rem;line-height:1.55;color:var(--ink-2)}' +
    '.mfvt-h-none{padding:14px 12px;font-size:.84rem;color:var(--ink-2);line-height:1.55}' +
    '.mfvt-h-none a{color:var(--accent);font-weight:600}' +
    '.mfvt-h-foot{padding:10px 16px;border-top:1px solid var(--border);font-size:.74rem;color:var(--ink-2);font-family:var(--mono)}' +
    '.mfvt-h-foot a{color:var(--accent)}' +
    '@media (max-width:640px){#mfvt-help-panel{right:0;left:0;bottom:0;width:100%;max-height:min(80vh,560px);border-radius:var(--radius) var(--radius) 0 0;border-left:none;border-right:none;border-bottom:none}}' +
    '@media (prefers-reduced-motion:reduce){#mfvt-help-btn{transition:none}}';

  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  function mailto(subjectSuffix) {
    return 'mailto:' + EMAIL +
      '?subject=' + encodeURIComponent('Support: ' + SITE + (subjectSuffix ? ' — ' + subjectSuffix : '')) +
      '&body=' + encodeURIComponent('Browser & device (e.g. Chrome on Windows 11):\n\nWhich tool I was using:\n\nWhat happened:\n');
  }

  var btn = document.createElement('button');
  btn.id = 'mfvt-help-btn';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Help and support');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', 'mfvt-help-panel');
  btn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/></svg>';

  var panel = document.createElement('div');
  panel.id = 'mfvt-help-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Help and support');

  var items = FAQS.map(function (f, i) {
    return '<details class="mfvt-h-item" data-i="' + i + '"><summary>' + f.q + '</summary><p>' + f.a + '</p></details>';
  }).join('');

  panel.innerHTML =
    '<div class="mfvt-h-head">' +
      '<svg width="24" height="24" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="15" fill="#e63b47"/><path d="M25 19.5c0-2.3 2.5-3.7 4.5-2.5l17 10.5c1.9 1.2 1.9 3.9 0 5l-17 10.5c-2 1.2-4.5-.2-4.5-2.5z" fill="#fff"/></svg>' +
      '<span class="mfvt-h-title">' + SITE + ' help</span>' +
      '<button class="mfvt-h-close" type="button" aria-label="Close help">✕</button>' +
    '</div>' +
    '<div class="mfvt-h-greet">Hi! 👋 Ask a question or browse the answers below. Everything here runs on your device — nothing is sent anywhere.</div>' +
    '<input class="mfvt-h-search" type="search" placeholder="Type a question…" aria-label="Search frequently asked questions">' +
    '<div class="mfvt-h-list" role="list">' + items + '</div>' +
    '<div class="mfvt-h-foot">Stuck? <a id="mfvt-h-mail" href="#">Email support</a> — we read everything.</div>';

  document.body.appendChild(btn);
  document.body.appendChild(panel);

  var search = panel.querySelector('.mfvt-h-search');
  var list = panel.querySelector('.mfvt-h-list');
  var details = [].slice.call(list.querySelectorAll('.mfvt-h-item'));
  panel.querySelector('#mfvt-h-mail').href = mailto('');

  var none = document.createElement('div');
  none.className = 'mfvt-h-none';
  none.style.display = 'none';
  none.innerHTML = 'No match for that — sorry! We’d still love to help: <a href="#">email us</a> and we’ll get back to you. Mention your browser and what happened so we can dig in fast.';
  list.appendChild(none);
  var noneLink = none.querySelector('a');

  function score(f, words) {
    var s = 0, hay = f.q.toLowerCase();
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (w.length < 3) continue;
      if (f.k.indexOf(w) !== -1) s += 3;
      if (hay.indexOf(w) !== -1) s += 2;
      if (f.a.toLowerCase().indexOf(w) !== -1) s += 1;
    }
    return s;
  }

  function filter() {
    var q = search.value.trim().toLowerCase();
    if (!q) {
      details.forEach(function (d) { d.style.display = ''; d.open = false; });
      none.style.display = 'none';
      return;
    }
    var words = q.split(/[^a-z0-9']+/);
    var scored = FAQS.map(function (f, i) { return [score(f, words), i]; });
    var any = false;
    scored.forEach(function (si) {
      var d = details[si[1]];
      if (si[0] > 0) { d.style.display = ''; any = true; } else { d.style.display = 'none'; d.open = false; }
    });
    // best match opens itself so the answer is one glance away
    if (any) {
      var best = scored.slice().sort(function (a, b) { return b[0] - a[0]; })[0];
      details.forEach(function (d, i) { d.open = (i === best[1]); });
    }
    none.style.display = any ? 'none' : '';
    if (!any) noneLink.href = mailto(search.value.trim().slice(0, 80));
  }
  search.addEventListener('input', filter);

  var OPEN_KEY = 'mfvt-support-open';
  function setOpen(open, focusSearch) {
    panel.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
    try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch (e) {}
    if (open && focusSearch) search.focus();
    if (!open) btn.focus();
  }

  btn.addEventListener('click', function () { setOpen(!panel.classList.contains('open'), true); });
  panel.querySelector('.mfvt-h-close').addEventListener('click', function () { setOpen(false); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && panel.classList.contains('open')) setOpen(false);
  });

  // restore last state, but never steal focus on load
  var saved = null;
  try { saved = localStorage.getItem(OPEN_KEY); } catch (e) {}
  if (saved === '1') {
    panel.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
  }
})();
