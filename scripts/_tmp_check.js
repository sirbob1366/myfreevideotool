
(function () {
  'use strict';
  var E = window.VideoEngine;
  var queue = []; // {file, meta, row, status}
  var fmt = 'mp4';
  var running = false;

  var d