// Licences (LIC-1): our own licence is in place, and every third-party file we bundle ships with its licence.
// Static: reads LICENSE, package.json, third_party/ and the runtime dependencies in node_modules.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const pkg = JSON.parse(read('package.json'));
const problems = [];

if (!/All rights reserved/i.test(read('LICENSE'))) problems.push('LICENSE: no licence chosen');
// What the installer ships, per target folder: [from, to, file name pattern]
const shipped = (pkg.build.extraResources || []).flatMap((r) => (r.filter || []).map((f) => [r.from, r.to, f]));
const ships = (to, name) => shipped.some(([, t, f]) => t === to && (f === name || new RegExp(`^${f.replace(/\./g, '\.').replace(/\*/g, '.*')}$`).test(name)));
// Bundled binaries and the licence text each needs beside it.
const NEEDS = [
  ['sidecar/lib', 'SIDECAR-NOTICE.txt', /LibreHardwareMonitorLib[\s\S]*BlackSharp[\s\S]*DiskInfoToolkit[\s\S]*RAMSPDToolkit[\s\S]*HidSharp[\s\S]*System\./],
  ['sidecar/lib', 'MPL-2.0.txt', /Mozilla Public License Version 2\.0/],
  ['sidecar/lib', 'HidSharp-LICENSE.txt', /Apache License, Version 2\.0/],
  ['sidecar/lib', 'dotnet-LICENSE.txt', /MIT License/],
  ['setup', 'PawnIO-LICENSE.txt', /GNU GENERAL PUBLIC LICENSE/],
  ['setup', 'PawnIO-NOTICE.txt', /source/i],
];
for (const [to, name, re] of NEEDS) {
  const f = path.join('third_party', name);
  if (!fs.existsSync(path.join(root, f))) problems.push(`${f}: missing`);
  else if (!re.test(read(f))) problems.push(`${f}: not the expected text`);
  if (!ships(to, name)) problems.push(`${name}: not shipped to ${to} (package.json build.extraResources)`);
}
// Runtime npm dependencies ship inside the app: each needs a licence we can redistribute, with its text.
for (const dep of Object.keys(pkg.dependencies || {})) {
  const dir = path.join(root, 'node_modules', dep);
  const has = fs.existsSync(dir) && fs.readdirSync(dir).some((f) => /^licen[cs]e/i.test(f));
  if (!has) problems.push(`${dep}: no licence file in node_modules/${dep}`);
  if (!new RegExp(`\[${dep}\]`).test(read('README.md'))) problems.push(`${dep}: not credited in README`);
}
if (problems.length) { console.error(`licence-check:\n${problems.join('\n')}`); process.exit(1); }
console.log('licence-check: ok');
