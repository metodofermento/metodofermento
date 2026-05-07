// api/leads.js
// Vercel Serverless Function
// Variables de entorno necesarias en Vercel:
//   SUPABASE_URL        → URL de tu proyecto Supabase
//   SUPABASE_SERVICE_KEY → Service role key (no la anon key)
//   SMTP_HOST           → smtp.gmail.com (o tu proveedor)
//   SMTP_PORT           → 465
//   SMTP_USER           → metodofermento@gmail.com
//   SMTP_PASS           → App Password de Gmail
//   ADMIN_EMAIL         → donde recibís el resumen
//   ADMIN_SECRET        → contraseña del panel admin (cualquier string seguro)

import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST  || 'smtp.gmail.com',
  port:   Number(process.env.SMTP_PORT || 465),
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { nombre, email, tel, mods } = req.body;

    if (!nombre || !email) {
      return res.status(400).json({ error: 'Nombre y email son obligatorios.' });
    }

    // ── 1. Parsear módulos seleccionados ──────────────────────────
    const modulosSeleccionados = [];
    const detallesMods = {};

    Object.entries(mods || {}).forEach(([id, mod]) => {
      if (mod.checks?.length > 0 || mod.nota) {
        modulosSeleccionados.push(mod.title);
        detallesMods[mod.title] = {
          items: mod.checks || [],
          nota:  mod.nota   || '',
        };
      }
    });

    // ── 2. Guardar en Supabase ─────────────────────────────────────
    const { data: lead, error: dbError } = await supabase
      .from('leads')
      .insert({
        nombre,
        email,
        tel:                 tel || null,
        modulos_seleccionados: modulosSeleccionados,
        detalles_modulos:    detallesMods,
        estado:              'nuevo',
        fuente:              'wizard-web',
        raw_payload:         req.body,
      })
      .select()
      .single();

    if (dbError) {
      console.error('Supabase error:', dbError);
      // no cortamos — igual mandamos el mail
    }

    // ── 3. Armar el email resumen ──────────────────────────────────
    const modsHtml = Object.entries(detallesMods).map(([title, data]) => `
      <tr>
        <td style="padding:14px 16px;border-bottom:1px solid #e8e3dc;vertical-align:top;width:36%">
          <strong style="color:#1C1917;font-size:14px">${title}</strong>
        </td>
        <td style="padding:14px 16px;border-bottom:1px solid #e8e3dc;vertical-align:top">
          ${data.items.map(i => `<span style="display:inline-block;margin:2px 4px 2px 0;padding:2px 9px;background:#f5f0ea;border:1px solid #e2ddd6;border-radius:999px;font-size:12px;color:#5a5450">${i}</span>`).join('')}
          ${data.nota ? `<p style="margin:8px 0 0;font-size:13px;color:#6b6560;font-style:italic">"${data.nota}"</p>` : ''}
        </td>
      </tr>
    `).join('');

    const emailHtml = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f7f4ef;font-family:'Helvetica Neue',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f4ef;padding:40px 0">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

      <!-- Header -->
      <tr><td style="background:#1A1A2E;border-radius:16px 16px 0 0;padding:28px 32px">
        <p style="margin:0;color:rgba(255,255,255,.5);font-size:11px;letter-spacing:.15em;text-transform:uppercase">Nuevo lead</p>
        <h1 style="margin:6px 0 0;color:#fff;font-size:22px;font-weight:700">Diagnóstico recibido</h1>
        <p style="margin:4px 0 0;color:#A85636;font-size:13px">metodofermento.com.ar</p>
      </td></tr>

      <!-- Datos contacto -->
      <tr><td style="background:#fff;padding:24px 32px;border-left:1px solid #e2ddd6;border-right:1px solid #e2ddd6">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:8px 0;border-bottom:1px solid #f0ece6;width:30%"><span style="font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#9c9490">Nombre</span></td>
            <td style="padding:8px 0;border-bottom:1px solid #f0ece6"><strong style="color:#1c1917">${nombre}</strong></td>
          </tr>
          <tr>
            <td style="padding:8px 0;border-bottom:1px solid #f0ece6"><span style="font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#9c9490">Email</span></td>
            <td style="padding:8px 0;border-bottom:1px solid #f0ece6"><a href="mailto:${email}" style="color:#A85636">${email}</a></td>
          </tr>
          <tr>
            <td style="padding:8px 0"><span style="font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#9c9490">Teléfono</span></td>
            <td style="padding:8px 0;color:#1c1917">${tel || '—'}</td>
          </tr>
        </table>
      </td></tr>

      <!-- Módulos -->
      ${modulosSeleccionados.length > 0 ? `
      <tr><td style="background:#faf8f5;border-left:1px solid #e2ddd6;border-right:1px solid #e2ddd6;padding:20px 32px 8px">
        <p style="margin:0 0 12px;font-size:11px;font-weight:600;letter-spacing:.15em;text-transform:uppercase;color:#9c9490">Módulos seleccionados</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2ddd6;border-radius:10px;overflow:hidden;background:#fff">
          ${modsHtml}
        </table>
      </td></tr>
      ` : `
      <tr><td style="background:#faf8f5;border-left:1px solid #e2ddd6;border-right:1px solid #e2ddd6;padding:20px 32px">
        <p style="margin:0;color:#9c9490;font-style:italic;font-size:14px">No seleccionó módulos específicos — consulta general.</p>
      </td></tr>
      `}

      <!-- Acciones rápidas -->
      <tr><td style="background:#fff;border:1px solid #e2ddd6;border-top:none;padding:24px 32px;border-radius:0 0 16px 16px">
        <p style="margin:0 0 14px;font-size:13px;color:#6b6560">Respondé directamente a este email para contactar a <strong>${nombre}</strong>.</p>
        <a href="mailto:${email}?subject=Tu consulta en Método Fermento&body=Hola ${nombre},%0A%0A" 
           style="display:inline-block;padding:11px 22px;background:#A85636;color:#fff;border-radius:999px;font-size:13px;font-weight:600;text-decoration:none;margin-right:10px">
          Responder ahora
        </a>
        ${tel ? `<a href="https://wa.me/${tel.replace(/\D/g,'')}?text=Hola%20${encodeURIComponent(nombre)}%2C%20te%20contacto%20desde%20M%C3%A9todo%20Fermento." 
           style="display:inline-block;padding:11px 22px;background:#25D366;color:#fff;border-radius:999px;font-size:13px;font-weight:600;text-decoration:none">
          WhatsApp
        </a>` : ''}
      </td></tr>

      <!-- Footer -->
      <tr><td style="padding:20px 0;text-align:center">
        <p style="margin:0;font-size:11px;color:#b0a89e">Método Fermento · metodofermento.com.ar</p>
        <p style="margin:4px 0 0;font-size:11px;color:#c8c0b6">Lead ID: ${lead?.id || 'pendiente'}</p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>
    `;

    // ── 4. Enviar el email ─────────────────────────────────────────
    await transporter.sendMail({
      from:    `"Método Fermento Web" <${process.env.SMTP_USER}>`,
      to:      process.env.ADMIN_EMAIL,
      replyTo: email,
      subject: `🍽️ Nuevo diagnóstico — ${nombre}`,
      html:    emailHtml,
    });

    return res.status(200).json({ status: 'ok', id: lead?.id });

  } catch (err) {
    console.error('Error en /api/leads:', err);
    return res.status(500).json({ status: 'error', message: err.message });
  }
}
