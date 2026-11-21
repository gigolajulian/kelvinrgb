// Downloads the PawnIO installer the Setup sheet ships, pinned by hash, into setup/ (gitignored).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const URL = 'https://github.com/namazso/PawnIO.Setup/releases/download/2.2.0/PawnIO_setup.exe';
const SHA256 = '1f519a22e47187f70a1379a48ca604981c4fcf694f4e65b734aaa74a9fba3032'; // 2.2.0, signed by namazso.eu
const out = path.join(__dirname, '..', 'setup', 'PawnIO_setup.exe');
const hash = (b) => crypto.createHash('sha256').update(b).digest('hex');
(async () => {
  if (fs.existsSync(out) && hash(fs.readFileSync(out)) === SHA256) return;
  const buf = Buffer.from(await (await fetch(URL)).arrayBuffer());
  if (hash(buf) !== SHA256) throw new Error('PawnIO_setup.exe hash mismatch, not saved');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buf);
})().catch((e) => { console.error(e.message); process.exit(1); });
