import { createServer, request as proxyRequest } from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { authorizedSetup, importCredential } from './credential-importer.mjs';

const setupKey = process.env.CUSTOMERLEAD_SETUP_KEY;
if (!setupKey || setupKey.length < 32 || !process.env.CUSTOMERLEAD_OPERATOR_PROJECT_ID) throw new Error('Configure the operator setup secret and existing n8n project before starting.');
const upstreamPort = Number(process.env.N8N_PORT || 5678);
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname.startsWith('/customerlead-setup/')) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json');
    const send = (status, body) => { response.writeHead(status); response.end(JSON.stringify(body)); };
    if (!authorizedSetup(request.headers['x-customerlead-setup-key'], setupKey)) return send(401, { error: 'Unauthorized.' });
    if (request.method === 'GET' && url.pathname === '/customerlead-setup/health') return send(200, { ready: true, version: 1 });
    if (request.method !== 'POST' || url.pathname !== '/customerlead-setup/credentials') return send(404, { error: 'Not found.' });
    const chunks = []; let size = 0;
    try {
      for await (const chunk of request) { size += chunk.length; if (size > 48000) return send(413, { error: 'Request too large.' }); chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const result = await importCredential(body, { directory: path.join(process.env.N8N_USER_FOLDER || '/home/node', '.n8n', 'customerlead-setup-receipts'), projectId: process.env.CUSTOMERLEAD_OPERATOR_PROJECT_ID });
      return send(200, result);
    } catch (error) { return send(error.message === 'invalid-request' ? 400 : 503, { error: error.message === 'invalid-request' ? 'Invalid request.' : 'Import result requires operator review.' }); }
  }
  const forwarded = { ...request.headers, host: request.headers.host, 'x-forwarded-proto': 'https', 'x-forwarded-host': request.headers.host, 'x-forwarded-for': [request.headers['x-forwarded-for'], request.socket.remoteAddress].filter(Boolean).join(', ') };
  const upstream = proxyRequest({ hostname: '127.0.0.1', port: upstreamPort, path: request.url, method: request.method, headers: forwarded }, result => { response.writeHead(result.statusCode || 502, result.headers); result.pipe(response); });
  upstream.on('error', () => { if (!response.headersSent) response.writeHead(503); response.end('Automation is starting.'); });
  request.pipe(upstream);
});
server.on('upgrade', (request, socket, head) => {
  if (request.url?.startsWith('/customerlead-setup/')) { socket.destroy(); return; }
  const upstream = net.connect(upstreamPort, '127.0.0.1', () => {
    upstream.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n` + Object.entries(request.headers).map(([key, value]) => `${key}: ${value}`).join('\r\n') + '\r\n\r\n');
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy());
});
server.listen(Number(process.env.CUSTOMERLEAD_PROXY_PORT || 8080), '0.0.0.0');
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
