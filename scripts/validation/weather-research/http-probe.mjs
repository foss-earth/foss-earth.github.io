// Research-only HTTP probe. No credentials, personal location or browser required.
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { newOutputDirectory } from '../../lib/outputDirectory.mjs';
const output = newOutputDirectory('research', 'weather-http');
const requests = JSON.parse(await readFile(process.argv[2], 'utf8'));
const observations = [];
for (const [name, url, range] of requests) {
  const header = `${output}/${name}.headers`, body = `${output}/${name}.body`;
  const args = ['--location', '--silent', '--show-error', '--max-time', '40', '--max-filesize', '8388608', '-A', 'foss-earth-check/1.0', '-H', 'Origin: https://example.org', ...(range ? ['-H', `Range: bytes=${range}`] : []), '-D', header, '-o', body, '-w', '%{http_code}', url];
  const result = spawnSync('curl', args, { encoding: 'utf8' });
  const bytes = await readFile(body).catch(() => Buffer.alloc(0));
  observations.push({name, url, range, observedUtc: new Date().toISOString(), command: ['curl', ...args], exit: result.status, status: result.stdout, stderr: result.stderr, headers: await readFile(header,'utf8').catch(()=>''), bytes:bytes.length, sha256:createHash('sha256').update(bytes).digest('hex'), text: bytes.length < 12000 && !bytes.includes(0) ? bytes.toString() : undefined});
  console.log(name, result.stdout, bytes.length);
}
await writeFile(`${output}/observations.json`, JSON.stringify(observations,null,2)+'\n');
console.log(output);
