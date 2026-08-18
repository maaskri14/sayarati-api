const crypto = require('crypto');

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }

  const raw = await readRawBody(req);
  console.log('=== WEBHOOK RAW ===', raw);

  const signature = req.headers['signature'];
  const computed = crypto
    .createHmac('sha256', process.env.CHARGILY_SECRET_KEY || '')
    .update(raw)
    .digest('hex');
  if (!signature || computed !== signature) {
    res.status(403).json({ error: 'Signature invalide' });
    return;
  }

  let event;
  try { event = JSON.parse(raw); } catch (e) { res.status(400).json({ error: 'JSON invalide' }); return; }

  console.log('TYPE EVENEMENT:', event.type);
  if (event.type !== 'checkout.paid') {
    res.status(200).json({ ok: true, ignored: event.type });
    return;
  }

  const data = event.data || {};
  console.log('DESCRIPTION:', data.description);
  console.log('SUCCESS_URL:', data.success_url);
  console.log('METADATA:', JSON.stringify(data.metadata));

  let product = null;
  let userId = null;

  // 🥇 Stratégie 1 : description
  const m1 = String(data.description || '').match(/sayarati:(credit|premium):([A-Za-z0-9-]+)/);
  if (m1) { product = m1[1]; userId = m1[2]; }

  // 🥈 Stratégie 2 : success_url
  if (!userId) {
    const m2 = String(data.success_url || '').match(/[?&]u=([A-Za-z0-9-]+)&p=(credit|premium)/);
    if (m2) { userId = m2[1]; product = m2[2]; }
  }

  // 🥉 Stratégie 3 : metadata
  if (!userId && data.metadata) {
    try {
      const md = Array.isArray(data.metadata) ? data.metadata[0] : data.metadata;
      if (md && md.user_id) { userId = md.user_id; product = md.product || 'credit'; }
    } catch (e) {}
  }

  console.log('IDENTIFICATION:', product, userId);

  if (!userId || !product) {
    res.status(200).json({ ok: true, ignored: true });
    return;
  }

  const sb = process.env.SUPABASE_URL + '/rest/v1';
  const headers = {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY,
    'Content-Type': 'application/json',
  };

  try {
    if (product === 'credit') {
      const get = await fetch(sb + '/pdf_credits?user_id=eq.' + userId + '&select=credits', { headers });
      const rows = await get.json();
      if (Array.isArray(rows) && rows.length > 0) {
        await fetch(sb + '/pdf_credits?user_id=eq.' + userId, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ credits: (rows[0].credits || 0) + 4, updated_at: new Date().toISOString() }),
        });
      } else {
        await fetch(sb + '/pdf_credits', {
          method: 'POST',
          headers,
          body: JSON.stringify({ user_id: userId, credits: 4, updated_at: new Date().toISOString() }),
        });
      }
    } else {
      const get = await fetch(sb + '/user_premium?user_id=eq.' + userId + '&select=user_id,is_premium,expires_at', { headers });
      const rows = await get.json();
      const now = new Date();
      let baseDate = now;
      if (Array.isArray(rows) && rows.length > 0 && rows[0].expires_at) {
        const ex = new Date(rows[0].expires_at);
        if (ex > now) baseDate = ex;
      }
      const expires = new Date(baseDate);
      expires.setFullYear(expires.getFullYear() + 1);
      if (Array.isArray(rows) && rows.length > 0) {
        await fetch(sb + '/user_premium?user_id=eq.' + userId, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ is_premium: true, expires_at: expires.toISOString() }),
        });
      } else {
        await fetch(sb + '/user_premium', {
          method: 'POST',
          headers,
          body: JSON.stringify({ user_id: userId, is_premium: true, expires_at: expires.toISOString() }),
        });
      }
    }
    res.status(200).json({ ok: true, activated: product });
  } catch (e) {
    console.error('Erreur Supabase:', e);
    res.status(500).json({ error: String(e) });
  }
}

handler.config = { api: { bodyParser: false } };
module.exports = handler;
