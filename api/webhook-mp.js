// api/webhook-mp.js
import { MercadoPagoConfig, Payment } from 'mercadopago';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import nodemailer from 'nodemailer';

const mp = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});

// Mismo patrón que leads.js: SUPABASE_URL + SUPABASE_SERVICE_KEY
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { realtime: { transport: ws } }
);

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST || 'smtp.gmail.com',
  port:   Number(process.env.SMTP_PORT || 465),
  secure: true, // igual que leads.js
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// ─── Extraer email del pago (3 fuentes con fallback) ─────────────────────────
function extractEmail(payment) {
  // 1. Metadata enviada en la preferencia
  if (payment.metadata?.buyer_email) return payment.metadata.buyer_email;

  // 2. Email del pagador (filtramos emails de sandbox de MP)
  if (payment.payer?.email &&
      !payment.payer.email.includes('@mailinator') &&
      !payment.payer.email.includes('test_user')) {
    return payment.payer.email;
  }

  // 3. external_reference: "guia-EMAIL_ENCODED-TIMESTAMP"
  if (payment.external_reference) {
    const ref = payment.external_reference;
    const firstDash = ref.indexOf('-');
    const lastDash = ref.lastIndexOf('-');
    if (firstDash !== -1 && lastDash > firstDash) {
      const emailCandidate = decodeURIComponent(ref.slice(firstDash + 1, lastDash));
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailCandidate)) {
        return emailCandidate;
      }
    }
  }

  return null;
}

// ─── Idempotencia: verificar si ya procesamos este pago ──────────────────────
async function pagoYaProcesado(paymentId) {
  const { data, error } = await supabase
    .from('compras')
    .select('id')
    .eq('payment_id', String(paymentId))
    .maybeSingle();

  if (error) {
    console.error('[webhook-mp] Error verificando idempotencia:', error);
    return false; // ante la duda, procesamos
  }
  return data !== null;
}

// ─── Generar URL firmada de Supabase Storage (30 días) ───────────────────────
async function getDownloadUrl(filePath) {
  const EXPIRES = 60 * 60 * 24 * 30; // 30 días en segundos
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'productos';

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(filePath, EXPIRES);

  if (error) {
    console.error('[webhook-mp] Error generando URL firmada:', error);
    throw new Error('No se pudo generar el link de descarga');
  }

  return data.signedUrl;
}

// ─── Registrar compra en Supabase DB ─────────────────────────────────────────
async function registrarCompra({ email, paymentId, externalRef, amount }) {
  const { error } = await supabase.from('compras').insert([{
    email,
    payment_id:         String(paymentId),
    external_reference: externalRef,
    monto:              amount,
    producto:           'guia-fermento-v1',
    estado:             'aprobado',
    created_at:         new Date().toISOString(),
  }]);

  if (error) {
    // No bloqueamos el flujo; el email tiene prioridad
    console.error('[webhook-mp] Error registrando en DB:', error);
  }
}

// ─── Enviar email con link de descarga ───────────────────────────────────────
async function enviarEmailDescarga({ email, downloadUrl }) {
  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Tu Guía Método Fermento</title>
</head>
<body style="margin:0;padding:0;background:#f7f4ef;font-family:'Helvetica Neue',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f4ef;padding:40px 0">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

      <!-- Header -->
      <tr><td style="background:#1A1A2E;border-radius:16px 16px 0 0;padding:28px 32px">
        <p style="margin:0 0 8px;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:rgba(255,255,255,.5)">Método Fermento</p>
        <h1 style="margin:0;font-size:26px;font-weight:400;color:#f5f0e8;line-height:1.3;font-family:Georgia,serif">
          Tu guía ya está lista 🌾
        </h1>
      </td></tr>

      <!-- Body -->
      <tr><td style="background:#fff;border-left:1px solid #e2ddd6;border-right:1px solid #e2ddd6;padding:32px">
        <p style="margin:0 0 16px;font-size:15px;color:#1c1917;line-height:1.7">
          ¡Gracias por tu compra! Tu pago fue aprobado y la guía está lista para descargar.
        </p>
        <p style="margin:0 0 28px;font-size:14px;color:#6b6560;line-height:1.7">
          Hacé clic en el botón de abajo. El link es personal y estará disponible durante 30 días.
        </p>

        <!-- CTA -->
        <table cellpadding="0" cellspacing="0" style="margin:0 auto 28px">
          <tr><td style="background:#A85636;border-radius:8px">
            <a href="${downloadUrl}"
               style="display:inline-block;padding:16px 40px;font-family:Georgia,serif;font-size:16px;color:#fff;text-decoration:none;letter-spacing:.02em">
              Descargar material – Guía de Costeo & Food Cost →
            </a>
          </td></tr>
        </table>

        <!-- Link de respaldo -->
        <p style="margin:0 0 6px;font-size:12px;color:#9c9490;text-align:center">
          Si el botón no funciona, copiá este link:
        </p>
        <p style="margin:0 0 28px;font-size:11px;color:#A85636;text-align:center;word-break:break-all">
          ${downloadUrl}
        </p>

        <hr style="border:none;border-top:1px solid #f0ece6;margin:0 0 20px">

        <p style="margin:0;font-size:13px;color:#9c9490;line-height:1.6">
          ¿Tenés alguna pregunta? Respondé este email y te ayudamos.<br>
          — El equipo de Método Fermento
        </p>
      </td></tr>

      <!-- Footer -->
      <tr><td style="background:#faf8f5;border:1px solid #e2ddd6;border-top:none;padding:16px 32px;border-radius:0 0 16px 16px;text-align:center">
        <p style="margin:0;font-size:11px;color:#b0a89e">
          Método Fermento · metodofermento.com.ar · Buenos Aires, Argentina
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;

  await transporter.sendMail({
    from:    `"Método Fermento" <${process.env.SMTP_USER}>`,
    to:      email,
    replyTo: process.env.ADMIN_EMAIL,
    subject: '🌾 🧮 Tu Guía de Costeo & Food Cost – Links de descarga',
    html,
    text: `Tu compra fue aprobada. Descargá tu guía en: ${downloadUrl}`,
  });

  console.log(`[webhook-mp] Email enviado a ${email}`);
}

// ─── Handler principal ────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // MP hace GET para verificar que el endpoint existe
  if (req.method === 'GET') return res.status(200).json({ ok: true });

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body;
    console.log('[webhook-mp] Notificación recibida:', JSON.stringify(body));

    const { type, data } = body;

    // Solo procesamos eventos de tipo "payment"
    if (type !== 'payment') {
      return res.status(200).json({ received: true, skipped: type });
    }

    const paymentId = data?.id;
    if (!paymentId) {
      return res.status(400).json({ error: 'Sin payment id' });
    }

    // ── Idempotencia ──
    const duplicado = await pagoYaProcesado(paymentId);
    if (duplicado) {
      console.log(`[webhook-mp] Pago ${paymentId} ya procesado, ignorando.`);
      return res.status(200).json({ received: true, duplicate: true });
    }

    // ── Verificar el pago contra la API de MP ──
    const paymentClient = new Payment(mp);
    const payment = await paymentClient.get({ id: paymentId });

    console.log('[webhook-mp] Estado:', payment.status, '| ID:', paymentId);

    if (payment.status !== 'approved') {
      return res.status(200).json({ received: true, status: payment.status });
    }

    // ── Extraer email ──
    const email = extractEmail(payment);
    if (!email) {
      console.error('[webhook-mp] Email no encontrado:', {
        metadata: payment.metadata,
        payer:    payment.payer?.email,
        ext_ref:  payment.external_reference,
      });
      return res.status(422).json({ error: 'Email no encontrado' });
    }

    // ── URL firmada desde Supabase Storage ──
    const downloadUrl = await getDownloadUrl('guias/guia-fermento-v1.pdf');

    // ── Registrar en DB (best effort) ──
    await registrarCompra({
      email,
      paymentId,
      externalRef: payment.external_reference,
      amount:      payment.transaction_amount,
    });

    // ── Enviar email ──
    await enviarEmailDescarga({ email, downloadUrl });

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('[webhook-mp] Error crítico:', error.message);
    // Retornamos 200 para que MP no reintente indefinidamente
    return res.status(200).json({ received: true, error: error.message });
  }
}
