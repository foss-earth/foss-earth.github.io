import { createServer } from 'node:http';
import { readFile, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'], ['.ico', 'image/x-icon'], ['.wasm', 'application/wasm'],
  ['.woff', 'font/woff'], ['.woff2', 'font/woff2'], ['.ktx2', 'image/ktx2'],
]);

export async function startSiteServer({ root, port = 4174, host = '127.0.0.1' }) {
  if (host !== '127.0.0.1') throw new Error('The verification server binds only to 127.0.0.1');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid local port');
  root = await realpath(root);
  if (!(await stat(root)).isDirectory()) throw new Error('Existing assembled dist directory required');
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-cache');
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { Allow: 'GET, HEAD' }); response.end('Method not allowed'); return;
      }
      let pathname;
      try { pathname = decodeURIComponent((request.url ?? '/').split('?')[0]); } catch { response.writeHead(400); response.end('Invalid path'); return; }
      if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0') ||
          pathname.split('/').some(part => part === '.' || part === '..' || part.startsWith('.'))) {
        response.writeHead(400); response.end('Invalid path'); return;
      }
      if (pathname === '/app') { response.writeHead(308, { Location: '/app/' }); response.end(); return; }
      if (pathname.endsWith('/')) pathname += 'index.html';
      let filename = path.join(root, pathname.slice(1));
      let info;
      try { info = await stat(filename); } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
        if (pathname.startsWith('/app/') && !path.extname(pathname) && request.headers.accept?.includes('text/html')) {
          filename = path.join(root, 'app', 'index.html'); info = await stat(filename);
        }
      }
      if (!info?.isFile()) { response.writeHead(404); response.end('Not found'); return; }
      const actual = await realpath(filename);
      if (!actual.startsWith(root + path.sep)) { response.writeHead(403); response.end('Forbidden'); return; }
      response.setHeader('Content-Type', contentTypes.get(path.extname(filename).toLowerCase()) ?? 'application/octet-stream');
      response.setHeader('Content-Length', info.size);
      response.writeHead(200);
      response.end(request.method === 'HEAD' ? undefined : await readFile(actual));
    } catch {
      if (!response.headersSent) response.writeHead(500);
      response.end('Unable to serve assembled file');
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return { server, url: `http://${host}:${server.address().port}/` };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let port = 4174;
  for (let index = 0; index < args.length; index++) {
    if (args[index] !== '--port' || index + 1 === args.length || !/^\d+$/.test(args[index + 1])) throw new Error('Usage: node scripts/serve.mjs [--port 4174]');
    port = Number(args[++index]);
  }
  if (port === 0) throw new Error('Choose an explicit nonzero local port');
  const root = fileURLToPath(new URL('../dist/', import.meta.url));
  const { server, url } = await startSiteServer({ root, port });
  console.log(`Serving exact landing/app assembly at ${url} (PID ${process.pid}).`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => process.exit(0)));
}
