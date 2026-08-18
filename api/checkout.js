// api/checkout.js - Create a Chargily payment with embedded user ID
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = req.body || {};
  const userId = body.user_id;
  const product = body.product;
  const amounts = { credit: 500, premium: 1000 };

  if (!userId || !amounts[product]) {
    res.status(400).json({ error: 'Parametres invalides' });
    return;
  }

  const base = process.env.CHARGILY_BASE_URL || 'https://pay.chargily.net/live/api/v2';

  try {
    const response = await fetch(base + '/checkouts', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + process.env.CHARGILY_SECRET_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: amounts[product],
        currency: 'dzd',
        locale: 'fr',
        description: 'sayarati:' + product + ':' + userId,
        success_url: process.env.SUCCESS_URL || 'https://maaskri14.github.io/sayarati-web/',
        webhook_endpoint: process.env.BASE_URL + '/api/webhook',
      }),
    });

    const data = await response.json();

    if (!response.ok || !data.checkout_url) {
      res.status(502).json({ error: 'Erreur Chargily', details: data });
      return;
    }

    res.status(200).json({ checkout_url: data.checkout_url });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
