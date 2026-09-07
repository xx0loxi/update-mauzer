// CDP probe: evaluate JS in every newtab target via remote debugging port
const http = require('http');
const WebSocket = require('./node_modules/ws');

const port = process.argv[2] || '9222';
const expr = process.argv[3] || 'document.documentElement.className';

http.get(`http://127.0.0.1:${port}/json/list`, (res) => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    const targets = JSON.parse(d).filter(t => /newtab\.html/.test(t.url));
    if (!targets.length) { console.log('NO-NEWTAB-TARGET'); process.exit(0); }
    const t = targets[0];
    const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }));
    });
    ws.on('message', (m) => {
      const msg = JSON.parse(m);
      if (msg.id === 1) {
        console.log('RESULT:', JSON.stringify(msg.result?.result?.value ?? msg.result));
        process.exit(0);
      }
    });
    ws.on('error', (e) => { console.log('WS-ERR', e.message); process.exit(1); });
  });
}).on('error', e => { console.log('HTTP-ERR', e.message); process.exit(1); });
