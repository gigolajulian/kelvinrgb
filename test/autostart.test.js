// EXIT-2: nothing starts at login unless the user turns on Start with Windows. Static, like scripts/uninstall-check.js:
// the logon task is the only autostart KelvinRGB has, and only the Settings/Setup toggle and the tray checkbox create it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const main = read('main.js'), nsh = read('build/installer.nsh'), pkg = JSON.parse(read('package.json'));

test('setAutostart runs only from the user toggle (IPC) and the tray checkbox', () => {
  const calls = main.split('\n').filter((l) => /setAutostart\(/.test(l) && !/^function setAutostart\(/.test(l)).map((l) => l.trim());
  assert.strictEqual(calls.length, 2, calls.join('\n'));
  assert.ok(calls.some((l) => /^on\('autostart', \(v\) => setAutostart\(v === true\)\);$/.test(l)), 'IPC handler');
  assert.ok(calls.some((l) => /click: \(m\) => setAutostart\(m\.checked\)/.test(l)), 'tray checkbox');
});

test('no other way to start at login: no login item, Run key or Startup folder, and the installer adds none', () => {
  for (const [name, src] of [['main.js', main], ['installer.nsh', nsh]]) {
    assert.ok(!/setLoginItemSettings|openAtLogin/.test(src), `${name}: login item`);
    assert.ok(!/CurrentVersion\+Run/i.test(src), `${name}: Run key`);
    assert.ok(!/Programs\+Startup|SMSTARTUP|shell:startup/i.test(src), `${name}: Startup folder`);
  }
  assert.ok(!/schtasks[^\n]*\/Create/i.test(nsh), 'the installer creates no task');
  assert.ok(!/\/Create/.test(main.replace(/const args = on \? \['\/Create'/, '')), 'main.js creates a task only in setAutostart(on)');
  assert.notStrictEqual(pkg.build.nsis.runAtStartup, true);
});
