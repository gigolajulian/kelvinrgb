// SEC-9: the release tooling refuses a signing key stored in plain text; a passphrase-protected one is used.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadKey } = require('../scripts/release-key');

test('an unencrypted signing key is refused; a protected one asks for its passphrase', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'krgb-key-'));
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const plain = path.join(dir, 'plain.pem'), enc = path.join(dir, 'enc.pem');
  fs.writeFileSync(plain, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  fs.writeFileSync(enc, privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'test only' }));
  const was = process.env.RELEASE_SIGNING_KEY;
  try {
    process.env.RELEASE_SIGNING_KEY = plain;
    await assert.rejects(loadKey(), /refusing plain\.pem/);
    process.env.RELEASE_SIGNING_KEY = enc;
    if (!process.stdin.isTTY) await assert.rejects(loadKey(), /needs its passphrase/); // no terminal in tests: it asks, it doesn't read the key in clear
  } finally {
    if (was === undefined) delete process.env.RELEASE_SIGNING_KEY; else process.env.RELEASE_SIGNING_KEY = was;
  }
});
