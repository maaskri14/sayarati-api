// api/webhook.js - Receive "payment succeeded" from Chargily and activate credit
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
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  const raw = await readRawBody(req);
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
  try {
    event = JSON.parse(raw);
  } catch (e) {
    res.status(400).json({ error: 'JSON invalide' });
    return;
  }

  if (event.type !== 'checkout.paid') {
    res.status(200).json({ ok: true, ignored: event.type });
    return;
  }

  const desc = (event.data && event.data.description) || '';
  const match = desc.match(/^sayarati:(credit|premium):([A-Za-z0-9-]+)$/);
  if (!match) {
    res.status(200).json({ ok: true, ignored: true });
    return;
  }

  const product = match[1];
  const userId = match[2];

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
          body: JSON.stringify({ credits: (rows[0].credits || 0) + 3, updated_at: new Date().toISOString() }),
        });
      } else {
        await fetch(sb + '/pdf_credits', {
          method: 'POST',
          headers,
          body: JSON.stringify({ user_id: userId, credits: 3, updated_at: new Date().toISOString() }),
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
    console.error('SUPABASE_URL:', process.env.SUPABASE_URL);
    console.error('Service key present:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);
    res.status(500).json({ error: String(e), message: e.message });
  }
}

handler.config = { api: { bodyParser: false } };
module.exports = handler;
