import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, lstat, realpath, rename, rm, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonnegativeInteger = value => Number.isSafeInteger(value) && value >= 0;
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function safeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\') ||
      value.includes('\0') || value.startsWith('/') || /^[A-Za-z]:/.test(value) ||
      value.split('/').some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new Error('Unsafe artifact path');
  }
  return value;
}

export function validateManifest(value) {
  if (!plainObject(value) || value.schemaVersion !== 1 || value.owner !== 'foss-earth/app' ||
      value.base !== '/app/' || typeof value.sourceRevision !== 'string' ||
      !/^[a-f0-9]{40}$/.test(value.sourceRevision) || !plainObject(value.archive) ||
      !digest(value.archive.sha256) || !nonnegativeInteger(value.archive.sizeBytes) ||
      !Array.isArray(value.files) || value.files.length === 0) {
    throw new Error('Invalid compiled app release manifest');
  }
  const archivePath = safeRelativePath(value.archive.path);
  if (!archivePath.startsWith('deps/') || !archivePath.endsWith('.tgz')) {
    throw new Error('App archive must be a repository-local deps/*.tgz artifact');
  }
  const files = new Map();
  for (const file of value.files) {
    if (!plainObject(file) || !digest(file.sha256) || !nonnegativeInteger(file.sizeBytes)) {
      throw new Error('Invalid compiled app file identity');
    }
    const filename = safeRelativePath(file.path);
    if (files.has(filename)) throw new Error('Duplicate compiled app manifest file');
    if (/^(?:src|vite|node_modules|scripts|\.git)(?:\/|$)/.test(filename) ||
        /\.(?:ts|tsx)$/.test(filename) || filename === 'package.json' || filename === 'package-lock.json') {
      throw new Error('Application source is not a compiled artifact');
    }
    files.set(filename, { path: filename, sha256: file.sha256, sizeBytes: file.sizeBytes });
  }
  if (!files.has('index.html')) throw new Error('Compiled app artifact lacks index.html');
  const decodedBytes = [...files.values()].reduce((sum, file) => sum + file.sizeBytes, 0);
  if (!Number.isSafeInteger(decodedBytes)) throw new Error('Compiled app file sizes exceed safe limits');
  return { ...value, archive: { ...value.archive, path: archivePath }, files, decodedBytes };
}

function tarText(block, start, length) {
  const field = block.subarray(start, start + length);
  const nul = field.indexOf(0);
  return new TextDecoder('utf-8', { fatal: true }).decode(nul === -1 ? field : field.subarray(0, nul));
}

function tarOctal(block, start, length) {
  const field = tarText(block, start, length).trim();
  if (!/^[0-7]+$/.test(field)) throw new Error('Invalid USTAR numeric field');
  const result = Number.parseInt(field, 8);
  if (!Number.isSafeInteger(result)) throw new Error('USTAR numeric field exceeds safe limits');
  return result;
}

export function verifiedAppFiles(archiveBytes, manifest) {
  if (archiveBytes.length !== manifest.archive.sizeBytes || sha256(archiveBytes) !== manifest.archive.sha256) {
    throw new Error('Compiled app archive identity mismatch');
  }
  // Only regular USTAR files/directories are accepted; no link or extended-header interpretation.
  const maximumBytes = manifest.decodedBytes + manifest.files.size * 2048 + 1024 * 1024;
  if (!Number.isSafeInteger(maximumBytes)) throw new Error('Compiled app archive exceeds safe limits');
  const tar = gunzipSync(archiveBytes, { maxOutputLength: maximumBytes });
  if (tar.length % 512 !== 0) throw new Error('Truncated USTAR archive');
  const files = new Map();
  const members = new Set();
  let offset = 0;
  let ended = false;
  while (offset + 512 <= tar.length) {
    const block = tar.subarray(offset, offset + 512);
    if (block.every(byte => byte === 0)) {
      if (offset + 1024 > tar.length || !tar.subarray(offset).every(byte => byte === 0)) {
        throw new Error('Invalid USTAR end marker');
      }
      ended = true;
      break;
    }
    const claimedChecksum = tarOctal(block, 148, 8);
    const actualChecksum = block.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    if (claimedChecksum !== actualChecksum) throw new Error('USTAR header checksum mismatch');
    if (tarText(block, 257, 6) !== 'ustar') throw new Error('App archive must use regular USTAR entries');
    const entryType = block[156];
    const directory = entryType === 53;
    if (!directory && entryType !== 0 && entryType !== 48) throw new Error('Unsupported app archive entry type');
    if (tarText(block, 157, 100) !== '') throw new Error('App archive links are forbidden');
    const prefix = tarText(block, 345, 155);
    let filename = [prefix, tarText(block, 0, 100)].filter(Boolean).join('/');
    if (directory && filename.endsWith('/')) filename = filename.slice(0, -1);
    safeRelativePath(filename);
    if (members.has(filename)) throw new Error('Duplicate app archive member');
    members.add(filename);
    const size = tarOctal(block, 124, 12);
    if (directory && size !== 0) throw new Error('App archive directory contains data');
    const dataStart = offset + 512;
    const paddedSize = Math.ceil(size / 512) * 512;
    if (!Number.isSafeInteger(paddedSize) || dataStart + paddedSize > tar.length) throw new Error('Truncated app archive file');
    if (!directory) {
      const expected = manifest.files.get(filename);
      if (!expected) throw new Error('Unlisted compiled app archive file');
      const bytes = tar.subarray(dataStart, dataStart + size);
      if (size !== expected.sizeBytes || sha256(bytes) !== expected.sha256) throw new Error('Compiled app file identity mismatch');
      files.set(filename, bytes);
    }
    offset = dataStart + paddedSize;
  }
  if (!ended || files.size !== manifest.files.size) throw new Error('Incomplete compiled app archive');
  return files;
}

async function exists(filename) {
  try { return await lstat(filename); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function assembleSite({ root, manifestPath = 'app-release.json' }) {
  root = await realpath(root);
  const manifest = validateManifest(JSON.parse(await readFile(path.join(root, safeRelativePath(manifestPath)), 'utf8')));
  const archiveFilename = await realpath(path.join(root, manifest.archive.path));
  if (!archiveFilename.startsWith(root + path.sep)) throw new Error('Compiled app archive escapes repository');
  const files = verifiedAppFiles(await readFile(archiveFilename), manifest);
  const landing = new Map(await Promise.all(['index.html', 'landing.css'].map(async filename => [filename, await readFile(path.join(root, filename))])));
  const output = path.join(root, 'dist');
  const prior = await exists(output);
  if (prior) {
    if (!prior.isDirectory() || prior.isSymbolicLink()) throw new Error('Refusing to replace unowned dist output');
    let priorReceipt;
    try { priorReceipt = JSON.parse(await readFile(path.join(output, 'assembly-receipt.json'), 'utf8')); } catch { /* An unmarked output is retained untouched. */ }
    if (priorReceipt?.schemaVersion !== 1 || priorReceipt?.owner !== 'foss-earth/foss-earth.github.io') {
      throw new Error('Refusing to replace unowned dist output');
    }
  }
  const assemblyRoot = path.join(root, 'build', 'assembly-retained');
  await mkdir(assemblyRoot, { recursive: true });
  const staging = await mkdtemp(path.join(assemblyRoot, 'staging-'));
  let retainedOutput;
  try {
    for (const [filename, bytes] of files) {
      const destination = path.join(staging, 'app', filename);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, bytes, { flag: 'wx' });
    }
    for (const [filename, bytes] of landing) await writeFile(path.join(staging, filename), bytes, { flag: 'wx' });
    const receipt = {
      schemaVersion: 1,
      owner: 'foss-earth/foss-earth.github.io',
      appOwner: manifest.owner,
      appSourceRevision: manifest.sourceRevision,
      base: manifest.base,
      archive: manifest.archive,
      files: [...manifest.files.values()],
      landing: [...landing].map(([filename, bytes]) => ({ path: filename, sha256: sha256(bytes), sizeBytes: bytes.length })),
    };
    await writeFile(path.join(staging, 'assembly-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    if (prior) {
      const retained = await mkdtemp(path.join(assemblyRoot, 'previous-'));
      retainedOutput = path.join(retained, 'dist');
      await rename(output, retainedOutput);
    }
    await rename(staging, output);
    return receipt;
  } catch (error) {
    if (retainedOutput && !await exists(output)) await rename(retainedOutput, output);
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) throw new Error('assemble.mjs takes no arguments; use repository app-release.json');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const receipt = await assembleSite({ root });
  console.log(`Assembled ${receipt.files.length} exact app files at dist/app/ from ${receipt.appSourceRevision}.`);
}
