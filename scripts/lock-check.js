// Supply-chain checks. Run: node scripts/lock-check.js [lock|dependabot] (no argument runs both).
//   lock:       lockfile committed and in step, runtime dependencies pinned exactly, CI installs with npm ci (SEC-3)
//   dependabot: Dependabot proposes updates for npm and the GitHub Actions (SEC-4)
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (f) => { try { return fs.readFileSync(path.join(root, f), 'utf8'); } catch { return ''; } };
const only = process.argv[2];
const problems = [];

if (only !== 'dependabot') {
  const pkg = JSON.parse(read('package.json'));
  let lock = null;
  try { lock = JSON.parse(read('package-lock.json')); } catch { problems.push('package-lock.json missing or unreadable'); }
  for (const [name, want] of Object.entries(pkg.dependencies || {})) {
    if (!/^\d+\.\d+\.\d+$/.test(want)) problems.push(`dependency ${name} is "${want}", not an exact version`);
    const got = lock?.packages?.[`node_modules/${name}`]?.version;
    if (lock && got !== want.replace(/^[\^~]/, '')) problems.push(`package-lock.json has ${name} ${got}, package.json wants ${want}`);
  }
  for (const [name, want] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
    const top = lock?.packages?.[''] || {};
    if (lock && !top.dependencies?.[name] && !top.devDependencies?.[name]) problems.push(`package-lock.json is out of step: ${name} ${want} not in it`);
  }
  const ci = read('.github/workflows/test.yml');
  if (!/\bnpm ci\b/.test(ci)) problems.push('CI does not install with npm ci');
  if (/\bnpm install\b/.test(ci)) problems.push('CI uses npm install');
}

if (only !== 'lock') {
  const dep = read('.github/dependabot.yml');
  for (const eco of ['npm', 'github-actions']) if (!new RegExp(`package-ecosystem:\\s*${eco}\\b`).test(dep)) problems.push(`Dependabot does not watch ${eco}`);
}

if (problems.length) { console.error(`lock-check:\n${problems.join('\n')}`); process.exit(1); }
console.log(`lock-check: ok${only ? ` (${only})` : ''}`);
