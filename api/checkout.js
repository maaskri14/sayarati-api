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

  try {
    const body = req.body || {};
    console.log('Body reçu:', JSON.stringify(body));
    
    const userId = body.user_id;
    const product = body.product;
    const amounts = { credit: 500, premium: 1000 };

    if (!userId || !amounts[product]) {
      res.status(400).json({ error: 'Parametres invalides' });
      return;
    }

    const secretKey = process.env.CHARGILY_SECRET_KEY;
    console.log('Secret key present:', !!secretKey);
    console.log('Secret key prefix:', secretKey ? secretKey.substring(0, 10) + '...' : 'MISSING');

    if (!secretKey) {
      res.status(500).json({ error: 'CHARGILY_SECRET_KEY manquante dans Vercel' });
      return;
    }

    const base = 'https://pay.chargily.net/live/api/v2';
    const payload = {
      amount: amounts[product],
      currency: 'dzd',
      locale: 'fr',
      description: 'sayarati:' + product + ':' + userId,
      success_url: 'https://maaskri14.github.io/sayarati-web/',
      webhook_endpoint: process.env.BASE_URL + '/api/webhook',
    };

    console.log('Appel Chargily:', JSON.stringify(payload));

    const response = await fetch(base + '/checkouts', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + secretKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    console.log('Reponse Chargily:', JSON.stringify(data));

    if (!response.ok || !data.checkout_url) {
      res.status(502).json({ 
        error: 'Erreur Chargily', 
        status: response.status,
        details: data 
      });
      return;
    }

    res.status(200).json({ checkout_url: data.checkout_url });
  } catch (e) {
    console.error('Exception:', e);
    console.error('Stack:', e.stack);
    res.status(500).json({ 
      error: e.message, 
      name: e.name,
      stack: e.stack 
    });
  }
};
