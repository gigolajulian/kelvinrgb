const test = require('node:test');
const assert = require('node:assert');
const C = require('../lib/conflicts');

const csv = '"System","4","Services","0","1 K"\r\n"NZXT CAM.exe","100","Console","1","9 K"\r\n"nzxt cam.exe","101","Console","1","9 K"\r\n"SteelSeriesGG.exe","200","Console","1","9 K"\r\n"ArmouryCrate.Service.exe","300","Services","0","9 K"\r\n"OpenRGB.exe","400","Services","0","9 K"\r\n';

test('parse and pick', () => {
  const p = C.parse(csv);
  assert.strictEqual(p.length, 6);
  assert.deepStrictEqual(C.toClose(p).map((x) => x.pid), [100, 101, 200]);
  assert.deepStrictEqual(C.toWarn(p), ['ArmouryCrate.Service.exe']);
  assert.ok(!C.toClose(p).some((x) => /openrgb|signalrgb/i.test(x.name)));
});

test('label and closable', () => {
  assert.strictEqual(C.label('ArmouryCrate.Service.exe'), 'Armoury Crate');
  assert.strictEqual(C.label('Foo.exe'), 'Foo');
  assert.ok(C.closable('nzxt cam.exe'));
  assert.strictEqual(C.service('armourycrate.service.exe'), 'ArmouryCrateService');
  assert.strictEqual(C.service('SignalRgb.exe'), undefined);
  assert.ok(!C.closable('SignalRgb.exe') && !C.closable('OpenRGB.exe') && !C.closable('ArmouryCrate.Service.exe'));
});

test('message', () => {
  assert.strictEqual(C.message(['A.exe', 'A.exe']), 'KelvinRGB closed A.exe.');
  assert.strictEqual(C.message(['A.exe', 'B.exe']), 'KelvinRGB closed A.exe and B.exe.');
  assert.strictEqual(C.message(['A.exe', 'B.exe', 'C.exe', 'D.exe']), 'KelvinRGB closed A.exe, B.exe and 2 other processes.');
});
