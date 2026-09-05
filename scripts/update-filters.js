const fs = require('fs');
const https = require('https');
const path = require('path');

const FILTER_SOURCES = [
  'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/pro.mini.txt',
  'https://cdn.jsdelivr.net/gh/hagezi/nrd@latest/adblock/nrd7.txt',
  'https://raw.githubusercontent.com/iam-py-test/uBlock-combo/main/list.txt'
];

function parseHostsList(raw) {
  const set = new Set();
  if (!raw) return set;
  raw.split(/\r?\n/).forEach(line => {
    const l = line.trim();
    if (!l || l.startsWith('!') || l.startsWith('#')) return;
    
    // Parse uBlock/ABP style or plain domains
    const cleaned = l
      .replace(/^\|\|/, '')
      .replace(/^@@.*/, '')
      .replace(/\^.*$/, '')
      .replace(/^\d+\.\d+\.\d+\.\d+$/, '') // skip exact IPs
      .trim();
    
    if (!cleaned) return;
    
    const domain = cleaned.split(/[\/:]/)[0];
    if (domain && /[a-zA-Z0-9.-]/.test(domain) && domain.includes('.')) {
      set.add(domain.toLowerCase());
    }
  });
  return set;
}

async function fetchFilters() {
  console.log('Fetching adblock filters...');
  const merged = new Set();
  
  for (const url of FILTER_SOURCES) {
    console.log(`Downloading: ${url}`);
    try {
      const data = await new Promise((resolve, reject) => {
        https.get(url, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
             // Basic redirect handling if needed, though raw.github usually doesn't redirect
             https.get(res.headers.location, (res2) => {
               let buf = '';
               res2.setEncoding('utf8');
               res2.on('data', chunk => { buf += chunk; });
               res2.on('end', () => resolve(buf));
             }).on('error', reject);
             return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`Failed with status ${res.statusCode}`));
            return;
          }
          let buf = '';
          res.setEncoding('utf8');
          res.on('data', chunk => { buf += chunk; });
          res.on('end', () => resolve(buf));
        }).on('error', reject);
      });
      
      const parsed = parseHostsList(data);
      parsed.forEach(d => merged.add(d));
      console.log(` -> Parsed ${parsed.size} domains`);
    } catch (err) {
      console.error(` -> Failed to fetch ${url}:`, err.message);
    }
  }

  const domainsArray = Array.from(merged);
  console.log(`Total unique blocked domains: ${domainsArray.length}`);
  
  const destPath = path.join(__dirname, '..', 'src', 'main', 'adblock-filters.json');
  fs.writeFileSync(destPath, JSON.stringify(domainsArray));
  console.log(`Saved filters to ${destPath}`);
}

fetchFilters().catch(err => {
  console.error(err);
  process.exit(1);
});
