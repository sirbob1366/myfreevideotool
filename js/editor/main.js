/* Editor boot: new project, resume-session banner, tool-page handoff intake. */
(function () {
  'use strict';
  var S = window.EdState;
  var C = window.EdComp;
  var T = window.EdTimeline;
  var U = window.EdUI;

  document.addEventListener('DOMContentLoaded', function () {
    S.newProject('16:9');
    C.init(document.getElementById('previewCanvas'));
    T.init(document.querySelector('.ed-dock'));
    U.init();
    C.resize();
    window.addEventListener('resize', function () { C.resize(); });

    // re-render preview whenever layers change while paused
    S.on('layers', function () { if (!S.playing) C.render(S.time); });
    S.on('project', function () { C.resize(); });

    // tool-page handoff: ?handoff=1 → take the file parked in IndexedDB
    var params = new URLSearchParams(location.search);
    var boot = Promise.resolve(false);
    if (params.get('handoff')) {
      boot = S.takeHandoff().then(function (file) {
        if (!file) return false;
        U.importFiles([file]);
        return true;
      });
    }

    // quick-action deep links (?qa=subtitles|meme|vertical|music|trim)
    boot.then(function (hadHandoff) {
      var qa = params.get('qa');
      if (qa) {
        setTimeout(function () {
          var btn = document.querySelector('.qa-btn[data-qa="' + qa + '"]');
          if (btn && qa !== 'trim') btn.click();
          else if (qa === 'trim' && !hadHandoff) btn && btn.click();
        }, hadHandoff ? 600 : 200);
      }

      // resume banner (only when there's no handoff taking precedence)
      if (!hadHandoff) {
        S.hasSaved().then(function (has) {
          if (!has) return;
          var banner = document.getElementById('resumeBanner');
          banner.classList.add('open');
          document.getElementById('resumeYes').addEventListener('click', function () {
            banner.classList.remove('open');
            S.restore().then(function () {
              C.resize();
              U.toast('Project restored');
            }).catch(function () { U.toast('Could not restore the previous session', true); });
          });
          document.getElementById('resumeNo').addEventListener('click', function () {
            banner.classList.remove('open');
            S.clearSaved();
          });
        });
      }
    });
  });
})();
