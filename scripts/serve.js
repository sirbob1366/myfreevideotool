/* Dev server replicating the production _headers (COOP/COEP) so the
   multithreaded FFmpeg + SharedArrayBuffer path can be tested locally. */
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const MIME = { html: 'text/html', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml',
  wasm: 'application/wasm', mp4: 'video/mp4', ttf: 'font/ttf', xml: 'application/xml', txt: 'text/plain' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  let file = path.join(root, p);
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end('404'); }
  const ext = path.extname(file).slice(1);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp'
  });
  fs.createReadStream(file).pipe(res);
}).listen(8787, () => console.log('serving on http://localhost:8787'));
