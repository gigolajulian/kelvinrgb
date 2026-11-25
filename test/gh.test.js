// SEC-8: release gh calls use the scoped KELVINRGB_GH_TOKEN when it is set, and never print it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { ghEnv } = require('../scripts/gh');

test('KELVINRGB_GH_TOKEN goes to gh as GH_TOKEN; unset falls back to the gh login with a warning', () => {
  const said = [];
  const env = ghEnv({ PATH: 'x', KELVINRGB_GH_TOKEN: 'tok-123' }, (m) => said.push(m));
  assert.strictEqual(env.GH_TOKEN, 'tok-123');
  assert.strictEqual(said.length, 0);
  const bare = ghEnv({ PATH: 'x' }, (m) => said.push(m));
  assert.ok(!('GH_TOKEN' in bare));
  assert.match(said[0], /KELVINRGB_GH_TOKEN is not set/);
});

test('the release scripts call gh only through scripts/gh.js', () => {
  const dir = path.join(__dirname, '..', 'scripts');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js') && x !== 'gh.js')) {
    assert.ok(!/execFile(Sync)?\(\s*['"]gh['"]|spawn(Sync)?\(\s*['"]gh['"]/.test(fs.readFileSync(path.join(dir, f), 'utf8')), `${f} calls gh directly`);
  }
});
