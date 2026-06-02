// api/crear-preferencia.js
import { MercadoPagoConfig, Preference } from 'mercadopago';

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});

const CURSOS = {
  'curso01': {
    id:          'curso01-marketing',
    title:       'Marketing Gastronómico y Redes',
    description: 'Acceso completo al curso online: 14 módulos con material interactivo y evaluaciones.',
    price:       69000,
    slug:        'curso01',
  },
  'curso02': {
    id:          'curso02-emprendimiento',
    title:       'Claves para Armar tu Emprendimiento Gastronómico',
    description: 'Acceso completo al curso online: 14 módulos con material interactivo y evaluaciones.',
    price:       49000,
    slug:        'curso02',
  },
  'curso03': {
    id:          'curso03-administracion',
    title:       'Administración de Negocios Gastronómico',
    description: 'Acceso completo al curso online: 12 módulos con material interactivo y evaluaciones.',
    price:       79000,
    slug:        'curso03',
  },
  // Producto existente — guía PDF
  'guia': {
    id:          'guia-fermento-v1',
    title:       'Guía de Costeo & Food Cost – Método Fermento',
    description: 'Guía de Costeo & Food Cost para negocios gastronómicos. PDF + planilla profesional.',
    price:       9900,
    slug:        'guia',
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email, nombre, producto } = req.body;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: 'Email inválido' });

    if (!nombre || nombre.trim().length < 2)
      return res.status(400).json({ error: 'Nombre requerido' });

    const curso = CURSOS[producto];
    if (!curso)
      return res.status(400).json({ error: 'Producto no reconocido' });

    const baseUrl  = process.env.BASE_URL || 'https://metodofermento.com.ar';
    const emailEnc = encodeURIComponent(email);
    const nomEnc   = encodeURIComponent(nombre.trim());
    const extRef   = `${curso.slug}-${emailEnc}-${nomEnc}-${Date.now()}`;

    const preference = new Preference(client);
    const result = await preference.create({
      body: {
        items: [{
          id:          curso.id,
          title:       curso.title,
          description: curso.description,
          quantity:    1,
          currency_id: 'ARS',
          unit_price:  curso.price,
        }],
        payer: { email, name: nombre.trim() },
        metadata: {
          buyer_email:  email,
          buyer_nombre: nombre.trim(),
          product_id:   curso.slug,
        },
        back_urls: {
          success: curso.slug === 'guia'
            ? `${baseUrl}/guia-gracias.html`
            : `${baseUrl}/login?activado=1`,
          failure: `${baseUrl}/?pago=error`,
          pending: `${baseUrl}/?pago=pendiente`,
        },
        auto_return:      'approved',
        notification_url: `${baseUrl}/api/webhook-mp`,
        external_reference: extRef,
        expires: true,
        expiration_date_to: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      },
    });

    return res.status(200).json({
      init_point:    result.init_point,
      preference_id: result.id,
    });

  } catch (error) {
    console.error('[crear-preferencia] Error:', error);
    return res.status(500).json({ error: 'Error al crear la preferencia de pago' });
  }
}
