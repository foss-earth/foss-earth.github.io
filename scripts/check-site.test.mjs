import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { assembleSite, validateManifest } from './assemble.mjs';
import { startSiteServer } from './serve.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function archive(entries) {
  const blocks = [];
  for (const { filename, bytes = Buffer.alloc(0), type = '0' } of entries) {
    const header = Buffer.alloc(512);
    const text = (value, offset, length) => header.write(value, offset, length, 'utf8');
    const octal = (value, offset, length) => text(value.toString(8).padStart(length - 1, '0') + '\0', offset, length);
    text(filename, 0, 100);
    octal(0o644, 100, 8); octal(0, 108, 8); octal(0, 116, 8);
    octal(bytes.length, 124, 12); octal(0, 136, 12);
    header.fill(32, 148, 156);
    text(type, 156, 1); text('ustar\0', 257, 6); text('00', 263, 2);
    text(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148, 8);
    blocks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}

async function fixture(t, overrides = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'earth-landing-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const entries = overrides.entries ?? [
    { filename: 'index.html', bytes: Buffer.from('<!doctype html><title>Exact globe fixture</title><script src="/app/assets/main.js"></script>') },
    { filename: 'assets/main.js', bytes: Buffer.from('globalThis.fixtureApp = "exact bytes";') },
    { filename: 'app-files-sw.js', bytes: Buffer.from('self.addEventListener("fetch", () => {});') },
  ];
  const bytes = archive(entries);
  const manifest = {
    schemaVersion: 1, owner: 'foss-earth/app', sourceRevision: '1'.repeat(40), base: '/app/',
    archive: { path: 'deps/app-compiled.tgz', sha256: digest(bytes), sizeBytes: bytes.length },
    files: entries.filter(entry => !entry.type || entry.type === '0').map(entry => ({ path: entry.filename, sha256: digest(entry.bytes), sizeBytes: entry.bytes.length })),
  };
  await mkdir(path.join(root, 'deps'));
  await writeFile(path.join(root, 'deps/app-compiled.tgz'), bytes);
  await writeFile(path.join(root, 'index.html'), '<title>Landing fixture</title><a href="/app/">Open the globe</a>');
  await writeFile(path.join(root, 'landing.css'), 'body { color: white; }');
  async function save() { await writeFile(path.join(root, 'app-release.json'), JSON.stringify(manifest)); }
  await save();
  return { root, entries, bytes, manifest, save };
}

test('assembles unchanged exact app bytes and retains prior owned output', async t => {
  const f = await fixture(t);
  const receipt = await assembleSite({ root: f.root });
  assert.equal(receipt.appSourceRevision, f.manifest.sourceRevision);
  for (const entry of f.entries) assert.deepEqual(await readFile(path.join(f.root, 'dist/app', entry.filename)), entry.bytes);
  assert.match(await readFile(path.join(f.root, 'dist/index.html'), 'utf8'), /href="\/app\/"/);
  assert.deepEqual((await readdir(path.join(f.root, 'dist'))).sort(), ['app', 'assembly-receipt.json', 'index.html', 'landing.css']);
  await assembleSite({ root: f.root });
  assert.equal((await readdir(path.join(f.root, 'build/assembly-retained'))).filter(name => name.startsWith('previous-')).length, 1);
});

test('rejects a changed archive before creating output', async t => {
  const f = await fixture(t);
  const changed = Buffer.from(f.bytes); changed[changed.length - 1] ^= 1;
  await writeFile(path.join(f.root, 'deps/app-compiled.tgz'), changed);
  await assert.rejects(assembleSite({ root: f.root }), /archive identity mismatch/);
  await assert.rejects(readFile(path.join(f.root, 'dist/index.html')), { code: 'ENOENT' });
});

test('rejects wrong file identities, unlisted files and missing manifest files', async t => {
  const f = await fixture(t);
  f.manifest.files[0].sha256 = '0'.repeat(64); await f.save();
  await assert.rejects(assembleSite({ root: f.root }), /file identity mismatch/);
  f.manifest.files[0].sha256 = digest(f.entries[0].bytes);
  const omitted = f.manifest.files.pop(); await f.save();
  await assert.rejects(assembleSite({ root: f.root }), /Unlisted/);
  f.manifest.files.push(omitted, { path: 'missing.js', sha256: digest(Buffer.from('missing')), sizeBytes: 7 }); await f.save();
  await assert.rejects(assembleSite({ root: f.root }), /Incomplete/);
});

test('rejects path escape and links even when the archive hash is approved', async t => {
  const f = await fixture(t);
  const escaped = `outside-${path.basename(f.root)}`;
  for (const entry of [
    { filename: '../' + escaped, bytes: Buffer.from('escape') },
    { filename: 'linked.js', type: '2', bytes: Buffer.alloc(0) },
  ]) {
    const bytes = archive([...f.entries, entry]);
    f.manifest.archive.sha256 = digest(bytes); f.manifest.archive.sizeBytes = bytes.length;
    await writeFile(path.join(f.root, 'deps/app-compiled.tgz'), bytes); await f.save();
    await assert.rejects(assembleSite({ root: f.root }), /Unsafe artifact path|Unsupported app archive entry type/);
  }
  await assert.rejects(readFile(path.join(f.root, '..', escaped)), { code: 'ENOENT' });
});

test('rejects invalid release scope, duplicate files and application source', async t => {
  const f = await fixture(t);
  assert.throws(() => validateManifest({ ...f.manifest, base: '/' }), /Invalid/);
  assert.throws(() => validateManifest({ ...f.manifest, archive: { ...f.manifest.archive, path: '../app.tgz' } }), /Unsafe/);
  assert.throws(() => validateManifest({ ...f.manifest, files: [...f.manifest.files, f.manifest.files[0]] }), /Duplicate/);
  assert.throws(() => validateManifest({ ...f.manifest, files: [...f.manifest.files, { path: 'src/main.ts', sha256: '0'.repeat(64), sizeBytes: 0 }] }), /source/);
});

test('preserves unmarked existing output instead of replacing old evidence', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.root, 'dist'));
  await writeFile(path.join(f.root, 'dist/old-evidence'), 'retain this');
  await assert.rejects(assembleSite({ root: f.root }), /unowned dist/);
  assert.equal(await readFile(path.join(f.root, 'dist/old-evidence'), 'utf8'), 'retain this');
});

test('serves assembled landing/app routes without broadening worker scope', async t => {
  const f = await fixture(t);
  await assembleSite({ root: f.root });
  const { server, url } = await startSiteServer({ root: path.join(f.root, 'dist'), port: 0 });
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const landing = await fetch(url);
  assert.equal(landing.status, 200); assert.match(await landing.text(), /Landing fixture/);
  const redirect = await fetch(url + 'app', { redirect: 'manual' });
  assert.equal(redirect.status, 308); assert.equal(redirect.headers.get('location'), '/app/');
  const app = await fetch(url + 'app/');
  assert.equal(app.status, 200); assert.match(await app.text(), /Exact globe fixture/);
  const worker = await fetch(url + 'app/app-files-sw.js');
  assert.equal(worker.status, 200); assert.match(worker.headers.get('content-type'), /javascript/);
  assert.equal(worker.headers.get('service-worker-allowed'), null);
  assert.equal((await fetch(url + 'app-files-sw.js')).status, 404);
  assert.equal((await fetch(url + 'app/assets/missing.js')).status, 404);
  assert.equal((await fetch(url + '%2e%2e%2fsecret')).status, 400);
  assert.equal((await fetch(url + 'app/assets/main.js', { method: 'HEAD' })).status, 200);
  assert.equal((await fetch(url, { method: 'POST' })).status, 405);
  const route = await fetch(url + 'app/example-route', { headers: { accept: 'text/html' } });
  assert.equal(route.status, 200); assert.match(await route.text(), /Exact globe fixture/);
});
