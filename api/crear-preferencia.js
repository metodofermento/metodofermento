// api/crear-preferencia.js
import { MercadoPagoConfig, Preference } from 'mercadopago';

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email } = req.body;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Email inválido' });
    }

    const baseUrl = process.env.BASE_URL || 'https://metodofermento.com.ar';

    // Email codificado para que no rompa el parseo del external_reference
    const emailEncoded = encodeURIComponent(email);
    const externalRef = `guia-${emailEncoded}-${Date.now()}`;

    const preference = new Preference(client);

    const result = await preference.create({
      body: {
        items: [
          {
            id: 'guia-fermento-v1',
            title: 'Guía de Costeo & Food Cost – Método Fermento',
            description: 'Guía de Costeo & Food Cost para negocios gastronómicos. PDF + planilla profesional.',
            quantity: 1,
            currency_id: 'ARS',
            unit_price: 1,
          },
        ],
        payer: { email },
        metadata: {
          buyer_email: email,
          product_id: 'guia-fermento-v1',
        },
        back_urls: {
          success: `${baseUrl}/guia/gracias.html`,
          failure: `${baseUrl}/guia.html?pago=error`,
          pending: `${baseUrl}/guia/pendiente`,
        },
        auto_return: 'approved',
        notification_url: `${baseUrl}/api/webhook-mp`,
        external_reference: externalRef,
        expires: true,
        expiration_date_to: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      },
    });

    return res.status(200).json({
      init_point: result.init_point,
      preference_id: result.id,
    });

  } catch (error) {
    console.error('[crear-preferencia] Error:', error);
    return res.status(500).json({ error: 'Error al crear la preferencia de pago' });
  }
}
