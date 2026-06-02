// api/webhook-mp.js
import { MercadoPagoConfig, Payment } from 'mercadopago';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import nodemailer from 'nodemailer';
import crypto from 'crypto';

const mp = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { realtime: { transport: ws } }
);

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST || 'smtp.gmail.com',
  port:   Number(process.env.SMTP_PORT || 465),
  secure: true,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

const CURSOS_NOMBRES = {
  curso01: 'Marketing Gastronómico y Redes',
  curso02: 'Claves para Armar tu Emprendimiento',
  curso03: 'Administración de Negocios Gastronómico',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function hashPassword(password) {
  const salt = process.env.PASSWORD_SALT || 'mf-salt-2025';
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

function generatePassword() {
  // 3 palabras random + número: fácil de recordar
  const words = ['Fuego','Menta','Caldo','Horno','Masa','Sal','Aceite','Brasa','Lima','Anís'];
  const w1 = words[Math.floor(Math.random() * words.length)];
  const w2 = words[Math.floor(Math.random() * words.length)];
  const n  = Math.floor(Math.random() * 90 + 10);
  return `${w1}${w2}${n}`;
}

function extractData(payment) {
  // email
  let email = payment.metadata?.buyer_email;
  if (!email && payment.payer?.email &&
      !payment.payer.email.includes('@mailinator') &&
      !payment.payer.email.includes('test_user')) {
    email = payment.payer.email;
  }
  // nombre y producto desde external_reference: slug-email-nombre-timestamp
  let nombre  = payment.metadata?.buyer_nombre || '';
  let product = payment.metadata?.product_id   || '';

  if (payment.external_reference && (!nombre || !product)) {
    const parts = payment.external_reference.split('-');
    if (parts.length >= 4) {
      if (!product) product = parts[0];
      if (!email)   email   = decodeURIComponent(parts[1]);
      if (!nombre)  nombre  = decodeURIComponent(parts[2]);
    }
  }

  return { email, nombre, product };
}

async function pagoYaProcesado(paymentId) {
  const { data } = await supabase
    .from('compras').select('id').eq('payment_id', String(paymentId)).maybeSingle();
  return data !== null;
}

async function registrarCompra({ email, paymentId, externalRef, amount, product }) {
  await supabase.from('compras').insert([{
    email,
    payment_id:         String(paymentId),
    external_reference: externalRef,
    monto:              amount,
    producto:           product,
    estado:             'aprobado',
    created_at:         new Date().toISOString(),
  }]);
}

async function getDownloadUrl(filePath) {
  const { data, error } = await supabase.storage
    .from(process.env.SUPABASE_STORAGE_BUCKET || 'productos')
    .createSignedUrl(filePath, 60 * 60 * 24 * 30);
  if (error) throw new Error('No se pudo generar el link: ' + filePath);
  return data.signedUrl;
}

// ── Crear usuario alumno y mandar credenciales ────────────────────────────────

async function procesarCurso({ email, nombre, product }) {
  const cursoNombre = CURSOS_NOMBRES[product] || product;
  const baseUrl     = process.env.BASE_URL || 'https://metodofermento.com.ar';

  // Ver si ya existe el usuario
  const { data: existing } = await supabase
    .from('users').select('id, cursos').eq('email', email.toLowerCase()).maybeSingle();

  let password = null;
  let esNuevo  = false;

  if (existing) {
    // Ya existe — agregar el curso si no lo tiene
    const cursosActuales = existing.cursos || [];
    if (!cursosActuales.includes(product) && !cursosActuales.includes('todos')) {
      await supabase.from('users')
        .update({ cursos: [...cursosActuales, product], updated_at: new Date().toISOString() })
        .eq('id', existing.id);
    }
  } else {
    // Usuario nuevo
    password = generatePassword();
    esNuevo  = true;
    await supabase.from('users').insert({
      email:         email.toLowerCase().trim(),
      nombre:        nombre || email.split('@')[0],
      password_hash: hashPassword(password),
      cursos:        [product],
    });
  }

  // Mail de credenciales / acceso
  const html = esNuevo ? `
<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f7f4ef;font-family:'Helvetica Neue',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f4ef;padding:40px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
  <tr><td style="background:#1A1A2E;border-radius:16px 16px 0 0;padding:28px 32px">
    <p style="margin:0 0 6px;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:rgba(255,255,255,.5)">Método Fermento · Plataforma Educativa</p>
    <h1 style="margin:0;font-size:24px;font-weight:700;color:#fff;font-family:Georgia,serif">¡Tu acceso está listo, ${nombre}!</h1>
  </td></tr>
  <tr><td style="background:#fff;border-left:1px solid #e2ddd6;border-right:1px solid #e2ddd6;padding:32px">
    <p style="margin:0 0 20px;font-size:15px;color:#1c1917;line-height:1.7">Gracias por tu compra. Ya podés ingresar a <strong>${cursoNombre}</strong> con estas credenciales:</p>
    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f7f4ef;border:1px solid #e2ddd6;border-radius:10px;margin-bottom:24px">
      <tr><td style="padding:16px 20px">
        <p style="margin:0 0 10px;font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:#9c9490">Tus credenciales</p>
        <p style="margin:0 0 6px;font-size:14px;color:#1c1917"><strong>Email:</strong> ${email}</p>
        <p style="margin:0;font-size:14px;color:#1c1917"><strong>Contraseña:</strong> <span style="font-family:monospace;background:#fff;padding:2px 8px;border-radius:4px;border:1px solid #e2ddd6">${password}</span></p>
      </td></tr>
    </table>
    <p style="margin:0 0 20px;font-size:13px;color:#6b6560;line-height:1.7">Te recomendamos cambiar tu contraseña después del primer acceso. Guardá este mail.</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 auto">
      <tr><td style="background:#A85636;border-radius:8px">
        <a href="${baseUrl}/login" style="display:inline-block;padding:14px 32px;font-family:Georgia,serif;font-size:15px;color:#fff;text-decoration:none;font-weight:700">Ingresar a la plataforma →</a>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="background:#faf8f5;border:1px solid #e2ddd6;border-top:none;padding:16px 32px;border-radius:0 0 16px 16px;text-align:center">
    <p style="margin:0;font-size:11px;color:#b0a89e">Método Fermento · metodofermento.com.ar · Buenos Aires, Argentina</p>
  </td></tr>
</table></td></tr></table></body></html>` : `
<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f7f4ef;font-family:'Helvetica Neue',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f4ef;padding:40px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
  <tr><td style="background:#1A1A2E;border-radius:16px 16px 0 0;padding:28px 32px">
    <p style="margin:0 0 6px;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:rgba(255,255,255,.5)">Método Fermento · Plataforma Educativa</p>
    <h1 style="margin:0;font-size:24px;font-weight:700;color:#fff;font-family:Georgia,serif">Nuevo curso activado</h1>
  </td></tr>
  <tr><td style="background:#fff;border-left:1px solid #e2ddd6;border-right:1px solid #e2ddd6;padding:32px">
    <p style="margin:0 0 20px;font-size:15px;color:#1c1917;line-height:1.7">Hola ${nombre}, agregamos <strong>${cursoNombre}</strong> a tu cuenta. Ingresá con tu email y contraseña habitual.</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 auto">
      <tr><td style="background:#A85636;border-radius:8px">
        <a href="${baseUrl}/login" style="display:inline-block;padding:14px 32px;font-family:Georgia,serif;font-size:15px;color:#fff;text-decoration:none;font-weight:700">Ir a mis cursos →</a>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="background:#faf8f5;border:1px solid #e2ddd6;border-top:none;padding:16px 32px;border-radius:0 0 16px 16px;text-align:center">
    <p style="margin:0;font-size:11px;color:#b0a89e">Método Fermento · metodofermento.com.ar · Buenos Aires, Argentina</p>
  </td></tr>
</table></td></tr></table></body></html>`;

  await transporter.sendMail({
    from:    `"Método Fermento" <${process.env.SMTP_USER}>`,
    to:      email,
    replyTo: process.env.ADMIN_EMAIL,
    subject: esNuevo
      ? `✅ Tu acceso a ${cursoNombre} – Método Fermento`
      : `✅ ${cursoNombre} activado en tu cuenta – Método Fermento`,
    html,
  });

  // Notificar al admin
  await transporter.sendMail({
    from:    `"Método Fermento Web" <${process.env.SMTP_USER}>`,
    to:      process.env.ADMIN_EMAIL,
    subject: `🎓 Nueva compra — ${cursoNombre} · ${email}`,
    html:    `<p><strong>Producto:</strong> ${cursoNombre}<br><strong>Email:</strong> ${email}<br><strong>Nombre:</strong> ${nombre}<br><strong>Usuario nuevo:</strong> ${esNuevo ? 'Sí' : 'No (ya existía)'}</p>`,
  });
}

// ── Procesar guía PDF (lógica existente) ─────────────────────────────────────

async function procesarGuia({ email }) {
  const downloadUrlPdf  = await getDownloadUrl('guias/guia-foodcost-mf.pdf');
  const downloadUrlXlsx = await getDownloadUrl('guias/planillas-mf.xlsx');

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f7f4ef;font-family:'Helvetica Neue',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f4ef;padding:40px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
  <tr><td style="background:#1A1A2E;border-radius:16px 16px 0 0;padding:28px 32px">
    <p style="margin:0 0 8px;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:rgba(255,255,255,.5)">Método Fermento</p>
    <h1 style="margin:0;font-size:26px;font-weight:400;color:#f5f0e8;line-height:1.3;font-family:Georgia,serif">Tu material ya está listo 🧮</h1>
  </td></tr>
  <tr><td style="background:#fff;border-left:1px solid #e2ddd6;border-right:1px solid #e2ddd6;padding:32px">
    <p style="margin:0 0 16px;font-size:15px;color:#1c1917;line-height:1.7">¡Gracias por tu compra! Tu pago fue aprobado. Los links están disponibles 30 días.</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 auto 12px"><tr><td style="background:#A85636;border-radius:8px">
      <a href="${downloadUrlPdf}" style="display:inline-block;padding:15px 36px;font-family:Georgia,serif;font-size:15px;color:#fff;text-decoration:none">Descargar Guía PDF →</a>
    </td></tr></table>
    <table cellpadding="0" cellspacing="0" style="margin:0 auto 12px"><tr><td style="background:#1A1A2E;border-radius:8px">
      <a href="${downloadUrlXlsx}" style="display:inline-block;padding:15px 36px;font-family:Georgia,serif;font-size:15px;color:#fff;text-decoration:none">Descargar Planilla Excel →</a>
    </td></tr></table>
  </td></tr>
  <tr><td style="background:#faf8f5;border:1px solid #e2ddd6;border-top:none;padding:16px 32px;border-radius:0 0 16px 16px;text-align:center">
    <p style="margin:0;font-size:11px;color:#b0a89e">Método Fermento · metodofermento.com.ar · Buenos Aires, Argentina</p>
  </td></tr>
</table></td></tr></table></body></html>`;

  await transporter.sendMail({
    from:    `"Método Fermento" <${process.env.SMTP_USER}>`,
    to:      email,
    replyTo: process.env.ADMIN_EMAIL,
    subject: '🧮 Tu Guía de Costeo & Food Cost – Links de descarga',
    html,
  });
}

// ── Handler principal ─────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method === 'GET')  return res.status(200).json({ ok: true });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    console.log('[webhook-mp] Body recibido:', JSON.stringify(req.body));
    const { type, data } = req.body;
    if (type !== 'payment') return res.status(200).json({ received: true, skipped: type });

    const paymentId = data?.id;
    if (!paymentId) return res.status(400).json({ error: 'Sin payment id' });

    if (await pagoYaProcesado(paymentId))
      return res.status(200).json({ received: true, duplicate: true });

    const paymentClient = new Payment(mp);
    const payment = await paymentClient.get({ id: paymentId });

    if (payment.status !== 'approved')
      return res.status(200).json({ received: true, status: payment.status });

    const { email, nombre, product } = extractData(payment);
    if (!email) return res.status(422).json({ error: 'Email no encontrado' });

    // Registrar compra (idempotencia)
    await registrarCompra({
      email, paymentId,
      externalRef: payment.external_reference,
      amount:      payment.transaction_amount,
      product:     product || 'guia',
    });

    // Despachar según producto
    if (product === 'guia' || !product) {
      await procesarGuia({ email });
    } else {
      await procesarCurso({ email, nombre, product });
    }

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('[webhook-mp] Error crítico:', error.message);
    return res.status(200).json({ received: true, error: error.message });
  }
}
