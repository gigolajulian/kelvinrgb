const test = require('node:test');
const assert = require('node:assert');
const C = require('../lib/conflicts');

test('fan apps and who controls a fan (#26)', () => {
  const rows = ['"AsusFanControlService.exe","1","Services","0","1 K"', '"NZXT CAM.exe","2","Console","1","1 K"', '"OpenRGB.exe","3","Services","0","1 K"'];
  const apps = C.fanApps(C.parse(rows.join('\r\n')));
  assert.deepStrictEqual(apps.map((a) => a.label), ['Armoury Crate', 'NZXT CAM']);
  assert.strictEqual(C.fanAppFor(apps, undefined).label, 'Armoury Crate');
  assert.strictEqual(C.fanAppFor(apps, 'hub').label, 'NZXT CAM');
  assert.strictEqual(C.fanAppFor([{ label: 'Fan Control', scope: 'all' }], 'hub').label, 'Fan Control');
  assert.strictEqual(C.fanAppFor([], 'hub'), undefined);
});
