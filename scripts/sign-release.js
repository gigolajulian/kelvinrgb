// Signs the installer so installed copies accept it as an update. Run on Julian's PC after `npm run dist`:
//   npm run sign               writes dist/KelvinRGB Setup <version>.exe.sig
//   npm run sign -- --upload   also uploads the .sig to release v<version> (create the release first)
// Key: RELEASE_SIGNING_KEY (a file path) or ~/.release-keys/updates-ed25519.pem. Never in a repo, never printed.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { version } = require('../package.json');
const { signed } = require('../lib/update');

const tag = process.argv.includes('--upload') && `v${version}`;
const file = path.join(__dirname, '..', 'dist', `KelvinRGB Setup ${version}.exe`);
const keyFile = process.env.RELEASE_SIGNING_KEY || path.join(os.homedir(), '.release-keys', 'updates-ed25519.pem');

const sha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sig = crypto.sign(null, Buffer.from(`KelvinRGB ${version} ${sha}\n`), fs.readFileSync(keyFile)).toString('base64');
if (!signed(version, sha, sig)) throw new Error('this key does not match the public key in lib/update.js');
fs.writeFileSync(file + '.sig', sig + '\n');
console.log(`signed ${path.basename(file)}`);
if (tag) execFileSync('gh', ['release', 'upload', tag, file + '.sig', '--clobber', '-R', 'gigolajulian/kelvinrgb'], { stdio: 'inherit' });
