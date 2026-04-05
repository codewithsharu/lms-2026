const http = require('http');

const HOST = '127.0.0.1';
const PORT = 8787;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, statusCode, data) {
  setCors(res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function isAllowedUrl(urlText) {
  try {
    const url = new URL(urlText);
    if (url.protocol !== 'https:') {
      return false;
    }
    return (
      url.hostname === 'api.onecompiler.com' ||
      url.hostname === 'onecompiler.com'
    );
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    setCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'POST' || req.url !== '/proxy') {
    sendJson(res, 404, { ok: false, error: 'Route not found' });
    return;
  }

  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > MAX_BODY_BYTES) {
      req.destroy();
    }
  });

  req.on('end', async () => {
    let payload;
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      sendJson(res, 400, { ok: false, error: 'Invalid JSON body' });
      return;
    }

    const targetUrl = payload.url;
    const method = (payload.method || 'GET').toUpperCase();
    const headers = payload.headers && typeof payload.headers === 'object' ? payload.headers : {};
    const body = payload.body;

    if (!targetUrl || !isAllowedUrl(targetUrl)) {
      sendJson(res, 400, { ok: false, error: 'Target URL must be https://api.onecompiler.com or https://onecompiler.com' });
      return;
    }

    try {
      const fetchOptions = { method, headers };
      if (body != null && method !== 'GET' && method !== 'HEAD') {
        fetchOptions.body = body;
      }

      const upstream = await fetch(targetUrl, fetchOptions);
      const upstreamText = await upstream.text();

      sendJson(res, 200, {
        ok: true,
        status: upstream.status,
        statusText: upstream.statusText,
        headers: Object.fromEntries(upstream.headers.entries()),
        body: upstreamText
      });
    } catch (error) {
      sendJson(res, 502, { ok: false, error: String(error) });
    }
  });

  req.on('error', (error) => {
    sendJson(res, 500, { ok: false, error: String(error) });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`OneCompiler local proxy running at http://${HOST}:${PORT}/proxy`);
});