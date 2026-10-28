// Downloads LibreHardwareMonitorLib and its .NET Framework 4.7.2 dependency tree from nuget.org
// into sidecar/lib, so the sidecar builds with the csc.exe that ships with Windows (no .NET SDK).
import { mkdirSync, writeFileSync, readFileSync, readdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const libDir = join(here, 'lib');
const work = join(tmpdir(), 'rgb-nuget');
const ROOT = ['LibreHardwareMonitorLib', '0.9.6'];
// Best match first for a .NET Framework 4.8 host.
const TFMS = ['net472', 'net471', 'net47', 'net462', 'net461', 'net46', 'net452', 'net45', 'netstandard2.0', 'netstandard1.3'];
const GROUPS = ['.NETFramework4.7.2', '.NETFramework4.6.2', '.NETFramework4.6.1', '.NETFramework4.6', '.NETFramework4.5', '.NETStandard2.0'];

mkdirSync(libDir, { recursive: true });
mkdirSync(work, { recursive: true });
const seen = new Set();

async function get(id, version) {
  const key = id.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  const v = version.replace(/[\[\]()]/g, '').split(',')[0];
  const url = `https://api.nuget.org/v3-flatcontainer/${key}/${v}/${key}.${v}.nupkg`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  const pkg = join(work, `${key}.${v}`);
  rmSync(pkg, { recursive: true, force: true });
  mkdirSync(pkg, { recursive: true });
  const zip = pkg + '.zip';
  writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  // Windows' own bsdtar reads zips; a Git Bash tar on PATH would not.
  execFileSync(join(process.env.SystemRoot, 'System32', 'tar.exe'), ['-xf', zip, '-C', pkg]);

  // LHM 0.9.6 ships its real assembly per runtime; lib/ is absent.
  const rt = join(pkg, 'runtimes', 'win-x64', 'lib');
  const libRoot = existsSync(rt) ? rt : join(pkg, 'lib');
  const tfm = existsSync(libRoot) && TFMS.find((t) => existsSync(join(libRoot, t)));
  if (tfm) {
    for (const f of readdirSync(join(libRoot, tfm))) {
      if (f.endsWith('.dll')) copyFileSync(join(libRoot, tfm, f), join(libDir, f));
    }
  }
  console.log(`${id} ${v} -> ${tfm || 'no lib (framework provides it)'}`);

  const nuspec = readdirSync(pkg).find((f) => f.endsWith('.nuspec'));
  const xml = readFileSync(join(pkg, nuspec), 'utf8');
  const groups = [...xml.matchAll(/<group targetFramework="([^"]+)"\s*(?:\/>|>([\s\S]*?)<\/group>)/g)];
  const group = GROUPS.map((g) => groups.find((m) => m[1] === g)).find(Boolean);
  const deps = group ? [...(group[2] || '').matchAll(/<dependency id="([^"]+)" version="([^"]+)"/g)] : [];
  for (const [, depId, depV] of deps) await get(depId, depV);
}

await get(...ROOT);
console.log('done:', readdirSync(libDir).join(', '));
