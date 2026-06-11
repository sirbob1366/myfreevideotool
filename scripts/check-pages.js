/* Static page checker: extracts inline scripts, syntax-checks them,
   and verifies every getElementById/#id reference exists in the page. */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const pages = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && !['node_modules', '.git', 'vendor', 'assets', 'scripts', 'js', 'css'].includes(e.name)) {
      walk(path.join(dir, e.name));
    } else if (e.name === 'index.html') {
      pages.push(path.join(dir, e.name));
    }
  }
})(root);
pages.push(path.join(root, 'index.html'));

let fails = 0;
for (const page of pages) {
  const html = fs.readFileSync(page, 'utf8');
  const rel = path.relative(root, page);

  // collect ids present in markup
  const ids = new Set();
  for (const m of html.matchAll(/\bid="([^"]+)"/g)) ids.add(m[1]);

  // extract inline scripts (skip ld+json and external)
  const scripts = [];
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/application\/ld\+json/.test(m[1])) continue;
    scripts.push(m[2]);
  }

  for (const [i, code] of scripts.entries()) {
    // syntax check
    const tmp = path.join(__dirname, '_tmp_check.js');
    fs.writeFileSync(tmp, code);
    try {
      execSync(`node --check "${tmp}"`, { stdio: 'pipe' });
    } catch (e) {
      console.log(`SYNTAX FAIL ${rel} [script ${i}]: ${String(e.stderr).split('\n')[0]}`);
      fails++;
    }
    // id refs
    for (const m of code.matchAll(/getElementById\('([^']+)'\)/g)) {
      if (!ids.has(m[1])) {
        console.log(`MISSING ID  ${rel}: getElementById('${m[1]}') has no matching id in page`);
        fails++;
      }
    }
    for (const m of code.matchAll(/querySelector\('#([A-Za-z][\w-]*)'\)/g)) {
      if (!ids.has(m[1])) {
        console.log(`MISSING ID  ${rel}: querySelector('#${m[1]}') has no matching id in page`);
        fails++;
      }
    }
  }

  // check editor module id refs against editor page
  if (rel.replace(/\\/g, '/') === 'editor/index.html') {
    const mods = ['state', 'layers', 'compositor', 'timeline', 'exporter', 'ui', 'main']
      .map(n => fs.readFileSync(path.join(root, 'js/editor', n + '.js'), 'utf8')).join('\n');
    const refs = new Set();
    for (const m of mods.matchAll(/getElementById\('([^']+)'\)/g)) refs.add(m[1]);
    for (const m of mods.matchAll(/\$\('#([A-Za-z][\w-]*)'\)/g)) refs.add(m[1]);
    // ids created dynamically by ui.js (prop panel etc.) — skip those
    const dynamic = /^(p[A-Z]|s[A-Z]|exp[A-Z]|sub|qa)/;
    for (const r of refs) {
      if (!ids.has(r) && !dynamic.test(r)) {
        console.log(`MISSING ID  editor: #${r} referenced by modules but not in editor/index.html`);
        fails++;
      }
    }
  }
}
try { fs.unlinkSync(path.join(__dirname, '_tmp_check.js')); } catch (e) {}
console.log(fails ? `\n${fails} problems found across ${pages.length} pages` : `ALL CLEAN — ${pages.length} pages checked`);
process.exit(0);
