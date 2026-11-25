// No homemade crypto (SEC-10). Reads the shipped code: main.js, preload.js, lib/, renderer/ and the sidecar.
// Every random value comes from node:crypto, hashes are sha256, signatures are ed25519 or RSA-sha256 (Windows Hello) through crypto.verify.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const files = ['main.js', 'preload.js'];
for (const d of ['lib', 'renderer', 'sidecar']) for (const f of fs.readdirSync(path.join(root, d), { recursive: true })) if (/\.(js|cs)$/.test(f)) files.push(path.join(d, f));
const BAD = [
  [/Math\.random\s*\(/, 'Math.random is not a cryptographic source: use crypto.randomUUID or crypto.randomBytes'],
  [/new\s+(System\.)?Random\s*\(/, 'System.Random is not a cryptographic source'],
  [/create(De)?cipher\s*\(/, 'createCipher derives keys the weak way: use createCipheriv'],
  [/createHash\(\s*['"](md5|sha1)['"]/i, 'md5 and sha1 are broken for integrity checks'],
  [/\^=?\s*key\b|\bxor(Encrypt|Decrypt)?\s*\(/i, 'looks like a homemade cipher'],
];
const problems = [];
for (const f of files) {
  const text = fs.readFileSync(path.join(root, f), 'utf8');
  for (const [re, why] of BAD) if (re.test(text)) problems.push(`${f}: ${why}`);
}
const upd = fs.readFileSync(path.join(root, 'lib', 'update.js'), 'utf8');
if (!/crypto\.verify\(ALG\[/.test(upd) || !/type: 'spki'/.test(upd) || !upd.includes("const ALG = { ed25519: null, rsa: 'sha256' };")) problems.push('lib/update.js: release signature is not checked with crypto.verify (ed25519 or RSA sha256, algorithm from the trusted key)');
if (!/crypto\.randomUUID\(\)/.test(upd)) problems.push('lib/update.js: installer temp name is not from crypto.randomUUID');
if (problems.length) { console.error(`crypto-check:\n${problems.join('\n')}`); process.exit(1); }
console.log(`crypto-check: ok (${files.length} files)`);
