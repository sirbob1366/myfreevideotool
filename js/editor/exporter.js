/* Export pipeline.
   Path A (fast): full-res canvas.captureStream + Web Audio mix → MediaRecorder → WebM.
   Path B (compatible): Path A's WebM → self-hosted multithreaded FFmpeg → H.264 MP4.
   Runs at playback speed by design — everything stays on the device. */
(function (global) {
  'use strict';
  var S = global.EdState;
  var C = global.EdComp;

  var X = { running: false, _cancel: false };

  // opts: {format:'webm'|'mp4', height: 1080|720|source, onProgress(p, label), onDone(blob, ext), onError(err)}
  X.start = function (opts) {
    if (X.running) return;
    X.running = true;
    X._cancel = false;

    var p = S.project;
    var dur = S.duration();
    var scale = 1;
    if (opts.height && opts.height < Math.min(p.canvas.w, p.canvas.h)) {
      scale = opts.height / Math.min(p.canvas.w, p.canvas.h);
    }
    var W = Math.round(p.canvas.w * scale / 2) * 2;
    var H = Math.round(p.canvas.h * scale / 2) * 2;

    var exCanvas = document.createElement('canvas');
    exCanvas.width = W;
    exCanvas.height = H;
    var exCtx = exCanvas.getContext('2d');

    var actx = C.ensureAudio();
    var dest = actx.createMediaStreamDestination();
    C.connectExportDest(dest);

    var stream = exCanvas.captureStream(30);
    if (dest.stream.getAudioTracks().length) stream.addTrack(dest.stream.getAudioTracks()[0]);

    var mime = '';
    ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].some(function (m) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) { mime = m; return true; }
      return false;
    });
    if (!mime) {
      X.running = false;
      C.disconnectExportDest();
      return opts.onError(new Error('This browser cannot record canvas streams. Try Chrome, Edge or Firefox.'));
    }

    var rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: Math.min(12e6, W * H * 6) });
    var chunks = [];
    rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = function () {
      C.disconnectExportDest();
      stream.getTracks().forEach(function (t) { t.stop(); });
      var nativeExt = /mp4/.test(rec.mimeType) ? 'mp4' : 'webm';
      var blob = new Blob(chunks, { type: rec.mimeType });
      if (X._cancel) { X.running = false; return opts.onError(new Error('cancelled')); }
      if (opts.format === 'mp4' && nativeExt !== 'mp4') {
        transcode(blob, dur, opts);
      } else {
        X.running = false;
        opts.onDone(blob, nativeExt);
      }
    };

    // drive the compositor in export mode
    C.pause();
    C.exporting = true;
    S.time = 0;
    var startWall = 0;
    rec.start(500);

    function frame(now) {
      if (X._cancel) {
        C.exporting = false;
        C.pause();
        try { rec.stop(); } catch (e) {}
        return;
      }
      if (!startWall) startWall = now;
      var t = (now - startWall) / 1000;
      if (t >= dur) {
        C.exporting = false;
        S.playing = false;
        // final frame + stop
        C.render(dur - 0.001, exCtx, scale);
        try { rec.stop(); } catch (e) {}
        C.seek(0);
        return;
      }
      S.time = t;
      // keep media elements in sync & audible into the export destination
      S.playing = true;
      C.render(t, exCtx, scale);
      // also mirror to preview at preview scale for visual feedback
      C.render(t);
      syncAudioFrame(t);
      opts.onProgress(t / dur, 'Rendering ' + fmtT(t) + ' / ' + fmtT(dur));
      requestAnimationFrame(frame);
    }

    // media sync during export — reuse compositor's media handling by playing
    function syncAudioFrame(t) {
      S.activeAt(t).forEach(function (l) {
        if ((l.type !== 'video' && l.type !== 'audio') || !l.srcId) return;
        var m = S.media[l.srcId];
        var el = m && (m.kind === 'video' ? m.videoEl : m.audioEl);
        if (!el) return;
        var want = (t - l.start) * l.speed + l.inPoint;
        if (Math.abs(el.currentTime - want) > 0.2) { try { el.currentTime = want; } catch (e) {} }
        if (el.paused) el.play().catch(function () {});
      });
    }

    S.playing = true;
    requestAnimationFrame(frame);
  };

  function transcode(webmBlob, dur, opts) {
    opts.onProgress(0, 'Converting to MP4 (H.264)…');
    var E = global.VideoEngine;
    webmBlob.arrayBuffer().then(function (ab) {
      return E.runFFmpeg({
        args: ['-i', 'export.webm', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21',
               '-c:a', 'aac', '-b:a', '192k', '-movflags', 'faststart', 'out.mp4'],
        inputs: [{ name: 'export.webm', data: new Uint8Array(ab) }],
        outputs: ['out.mp4'],
        outDuration: dur,
        onLoadBytes: function (g, t) { opts.onProgress(g / t, 'Preparing video engine — one time, ~32 MB'); },
        onProgress: function (pr) { opts.onProgress(pr.pct, 'Converting to MP4 — ' + (pr.eta ? '~' + Math.ceil(pr.eta) + 's left' : '')); }
      });
    }).then(function (outs) {
      X.running = false;
      opts.onDone(new Blob([outs[0].data.buffer], { type: 'video/mp4' }), 'mp4');
    }).catch(function (err) {
      X.running = false;
      opts.onError(err);
    });
  }

  X.cancel = function () {
    X._cancel = true;
    var E = global.VideoEngine;
    if (E) E.cancelFFmpeg();
  };

  function fmtT(s) {
    var m = Math.floor(s / 60);
    return m + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  }

  global.EdExport = X;
})(window);
