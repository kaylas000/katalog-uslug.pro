// scripts/verify-locations.mjs
import fs from 'node:fs/promises';

function ok(m){ console.log('[OK]  ' + m); }
function err(m){ console.log('[ERR] ' + m); process.exitCode = 1; }

async function exists(p){ try { await fs.access(p); return true; } catch { return false; } }

async function main(){
  console.log('=== verify locations feature ===');

  const must = [
    'db/migrations/010_locations.sql',
    'worker/src/locations.ts'
  ];

  for (const f of must) (await exists(f)) ? ok('exists: ' + f) : err('missing: ' + f);

  if (await exists('worker/src/index.ts')) {
    const t = await fs.readFile('worker/src/index.ts','utf8');
    t.includes('/v1/locations') ? ok('worker/src/index.ts routes /v1/locations') : err('worker/src/index.ts does NOT route /v1/locations');
  }

  if (await exists('worker/src/catalog-v2.ts')) {
    const t = await fs.readFile('worker/src/catalog-v2.ts','utf8');
    t.includes('locationId') ? ok('catalog-v2 mentions locationId') : err('catalog-v2 does NOT mention locationId');
  }

  const base = (process.env.KATALOG_API_BASE || '').trim().replace(/\/$/,'');
  if (!base) {
    console.log('[SKIP] set env KATALOG_API_BASE to run network smoke');
  } else {
    const u = base + '/v1/locations?q=моск&limit=5&kinds=region,city,district';
    const r = await fetch(u);
    if (!r.ok) err('API /v1/locations -> HTTP ' + r.status);
    else {
      const j = await r.json();
      Array.isArray(j.items) ? ok('API /v1/locations returns items[]') : err('API /v1/locations: items is not array');
    }
  }

  if (process.exitCode) { console.log('\\nFAILED'); process.exit(1); }
  console.log('\\nPASSED');
}

main().catch(e=>{ console.error(e); process.exit(1); });
