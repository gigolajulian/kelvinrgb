// Signs the installer so installed copies accept it as an update. Run on Julian's PC after `npm run dist`:
//   npm run sign               writes dist/KelvinRGB Setup <version>.exe.sig
//   npm run sign -- --upload   also uploads the .sig to release v<version> (create the release first)
//   --recovery                 signs with the passphrase-protected ed25519 key instead of Windows Hello
// Keys: scripts/release-key.js. Never in a repo, never printed.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { version } = require('../package.json');
const { signed } = require('../lib/update');
const { loadKey, helloSign } = require('./release-key');
const { gh } = require('./gh'); // KELVINRGB_GH_TOKEN for the upload (SEC-8)

const tag = process.argv.includes('--upload') && `v${version}`;
const file = path.join(__dirname, '..', 'dist', `KelvinRGB Setup ${version}.exe`);

(async () => {
  const sha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const text = `KelvinRGB ${version} ${sha}\n`;
  const sig = process.argv.includes('--recovery') ? crypto.sign(null, Buffer.from(text), await loadKey()).toString('base64') : helloSign(text);
  if (!signed(version, sha, sig)) throw new Error('this key does not match a public key in lib/update.js');
  fs.writeFileSync(file + '.sig', sig + '\n');
  console.log(`signed ${path.basename(file)}`);
  if (tag) gh(['release', 'upload', tag, file + '.sig', '--clobber', '-R', 'gigolajulian/kelvinrgb']);
})().catch(e => { console.error(e.message); process.exit(1); });
