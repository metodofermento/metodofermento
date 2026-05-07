// api/leads.js
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import ws from 'ws';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { realtime: { transport: ws } }
);

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST  || 'smtp.gmail.com',
  port:   Number(process.env.SMTP_PORT || 465),
  secure: true,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

const MOD_PREFIX = { 1:'M1', 2:'M2', 3:'M3', 4:'M4', 5:'M5', 6:'M6', 7:'M7', 8:'M8' };

function fmt(n) {
  return new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}).format(n);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { nombre, email, tel, mods } = req.body;
    if (!nombre || !email) return res.status(400).json({ error: 'Nombre y email son obligatorios.' });

    // ── 1. Cargar precios desde Supabase ──────────────────────────
    const { data: preciosRows } = await supabase.from('precios').select('key,valor');
    const P = {};
    (preciosRows || []).forEach(r => { P[r.key] = Number(r.valor); });
    const exchangeRate = P['EXCHANGE_RATE'] || 1400;

    // ── 2. Calcular presupuesto ───────────────────────────────────
    let totalARS = 0;
    const modulosDetalle = [];
    const modulosSeleccionados = [];

    Object.entries(mods || {}).forEach(([id, mod]) => {
      if (!mod.checks?.length && !mod.nota) return;
      const prefix = MOD_PREFIX[Number(id)];
      if (!prefix) return;
      modulosSeleccionados.push(mod.title);

      let subtotal = 0;
      const itemsValores = [];

      if (mod.checks?.length) {
        mod.checks.forEach((check, i) => {
          const val = P[`${prefix}_ITEM${i+1}`] || 0;
          subtotal += val;
          itemsValores.push({ label: check, valor: val });
        });
        const modTotal = P[`${prefix}_TOTAL`] || subtotal;
        if (subtotal > modTotal) subtotal = modTotal;
      } else {
        subtotal = P[`${prefix}_TOTAL`] || 0;
      }

      totalARS += subtotal;
      modulosDetalle.push({ title: mod.title, items: mod.checks||[], itemsValores, nota: mod.nota||'', subtotal });
    });

    const totalUSD = exchangeRate > 0 ? Math.round(totalARS / exchangeRate) : 0;

    // ── 3. Guardar en Supabase ────────────────────────────────────
    const { data: lead } = await supabase.from('leads').insert({
      nombre, email, tel: tel||null,
      modulos_seleccionados: modulosSeleccionados,
      detalles_modulos: Object.fromEntries(
        modulosDetalle.map(m => [m.title, { items: m.items, nota: m.nota, subtotal: m.subtotal }])
      ),
      estado: 'nuevo', fuente: 'wizard-web',
      raw_payload: { ...req.body, totalARS, totalUSD },
    }).select().single();

    // ── 4. Mail AL CLIENTE ────────────────────────────────────────
    const whatsappNum  = (process.env.WHATSAPP_NUM || '5491124946818').replace(/\D/g,'');
    const whatsappText = encodeURIComponent(`Hola, soy ${nombre}. Recibí el presupuesto estimativo y quiero avanzar.`);

    const modsClienteHtml = modulosDetalle.map(m => `
      <tr>
        <td style="padding:14px 16px;border-bottom:1px solid #f0ece6;vertical-align:top">
          <strong style="color:#1c1917;font-size:14px">${m.title}</strong>
          ${m.items.length ? `<div style="margin-top:6px">${m.items.map(i=>`<span style="display:inline-block;margin:2px 4px 2px 0;padding:2px 9px;background:#f5f0ea;border:1px solid #e2ddd6;border-radius:999px;font-size:12px;color:#5a5450">${i}</span>`).join('')}</div>` : ''}
          ${m.nota ? `<div style="margin-top:6px;font-size:12px;color:#9c9490;font-style:italic">"${m.nota}"</div>` : ''}
        </td>
        <td style="padding:14px 16px;border-bottom:1px solid #f0ece6;text-align:right;white-space:nowrap;vertical-align:top">
          <strong style="color:#A85636;font-size:14px">${fmt(m.subtotal)}</strong>
        </td>
      </tr>`).join('');

    const mailCliente = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f7f4ef;font-family:'Helvetica Neue',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f4ef;padding:40px 0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
  <tr><td style="background:#1A1A2E;border-radius:16px 16px 0 0;padding:28px 32px">
    <p style="margin:0;color:rgba(255,255,255,.5);font-size:11px;letter-spacing:.15em;text-transform:uppercase">Presupuesto estimativo</p>
    <h1 style="margin:8px 0 4px;color:#fff;font-size:24px;font-weight:700">Gracias, ${nombre}</h1>
    <p style="margin:0;color:#A85636;font-size:13px">metodofermento.com.ar</p>
  </td></tr>
  <tr><td style="background:#fff;padding:24px 32px;border-left:1px solid #e2ddd6;border-right:1px solid #e2ddd6">
    <p style="margin:0 0 8px;font-size:15px;color:#1c1917">Recibimos tu consulta y preparamos este estimativo basado en los módulos que seleccionaste.</p>
    <p style="margin:0;font-size:13.5px;color:#6b6560">Los valores son referenciales y se confirman luego de una reunión de trabajo.</p>
  </td></tr>
  <tr><td style="background:#faf8f5;border-left:1px solid #e2ddd6;border-right:1px solid #e2ddd6;padding:20px 32px 8px">
    <p style="margin:0 0 12px;font-size:11px;font-weight:600;letter-spacing:.15em;text-transform:uppercase;color:#9c9490">Detalle por módulo</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2ddd6;border-radius:10px;overflow:hidden;background:#fff">
      ${modsClienteHtml}
    </table>
  </td></tr>
  <tr><td style="background:#fff;border-left:1px solid #e2ddd6;border-right:1px solid #e2ddd6;padding:20px 32px">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#1A1A2E;border-radius:12px;padding:20px 24px"><tr><td>
      <p style="margin:0;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.45)">Total estimativo (ARS)</p>
      <p style="margin:6px 0 0;font-size:28px;font-weight:700;color:#A85636">${fmt(totalARS)}</p>
      <p style="margin:4px 0 0;font-size:13px;color:rgba(255,255,255,.45)">Equivale aprox. a USD ${totalUSD.toLocaleString('es-AR')} al tipo de cambio BNA ${fmt(exchangeRate).replace('ARS\u00a0','$')}/USD</p>
    </td></tr></table>
  </td></tr>
  <tr><td style="background:#faf8f5;border-left:1px solid #e2ddd6;border-right:1px solid #e2ddd6;padding:20px 32px">
    <p style="margin:0 0 10px;font-size:11px;font-weight:600;letter-spacing:.15em;text-transform:uppercase;color:#9c9490">Alcance del servicio</p>
    <p style="margin:0 0 10px;font-size:13.5px;color:#4a4a4a;line-height:1.7">Método Fermento brinda un servicio de consultoría integral para el desarrollo de proyectos gastronómicos, que consiste en analizar, planificar y proponer paso a paso las acciones necesarias para poner en funcionamiento el negocio.</p>
    <p style="margin:0 0 10px;font-size:13.5px;color:#4a4a4a;line-height:1.7"><strong>Condiciones y límites:</strong> Los valores presentados tienen carácter referencial según las respuestas del formulario y pueden variar en función de la dimensión del local, complejidad del proyecto, proveedores y decisiones operativas. Este presupuesto es un estimativo inicial que podrá ajustarse luego de la evaluación detallada y reuniones de trabajo.</p>
    <p style="margin:0;font-size:12px;color:#9c9490;line-height:1.6;font-style:italic">Exención de responsabilidad: El servicio es de naturaleza consultiva/estratégica y no garantiza resultados económicos específicos ni el éxito comercial del proyecto, el cual depende de factores externos a nuestra intervención (coyuntura económica, contexto de mercado, regulaciones, gestión y operación del cliente, entre otros).</p>
  </td></tr>
  <tr><td style="background:#fff;border:1px solid #e2ddd6;border-top:none;padding:24px 32px;border-radius:0 0 16px 16px;text-align:center">
    <p style="margin:0 0 16px;font-size:14px;color:#6b6560">¿Querés avanzar? Contactanos por WhatsApp y coordinamos una reunión sin costo.</p>
    <a href="https://wa.me/${whatsappNum}?text=${whatsappText}" style="display:inline-block;padding:13px 28px;background:#25D366;color:#fff;border-radius:999px;font-size:14px;font-weight:600;text-decoration:none">Continuar por WhatsApp →</a>
  </td></tr>
  <tr><td style="padding:20px 0;text-align:center">
    <p style="margin:0;font-size:11px;color:#b0a89e">Método Fermento · metodofermento.com.ar · Buenos Aires, Argentina</p>
  </td></tr>
</table></td></tr></table></body></html>`;

    // ── 5. Mail A VOS ─────────────────────────────────────────────
    const modsAdminHtml = modulosDetalle.map(m => `
      <tr>
        <td style="padding:12px 16px;border-bottom:1px solid #f0ece6;vertical-align:top;width:35%">
          <strong style="color:#1c1917;font-size:13px">${m.title}</strong>
          ${m.nota ? `<div style="margin-top:4px;font-size:12px;color:#9c9490;font-style:italic">"${m.nota}"</div>` : ''}
        </td>
        <td style="padding:12px 16px;border-bottom:1px solid #f0ece6;vertical-align:top">
          ${m.items.map(i=>`<span style="display:inline-block;margin:2px 4px 2px 0;padding:2px 8px;background:#f5f0ea;border:1px solid #e2ddd6;border-radius:999px;font-size:12px;color:#5a5450">${i}</span>`).join('')}
        </td>
        <td style="padding:12px 16px;border-bottom:1px solid #f0ece6;text-align:right;white-space:nowrap;vertical-align:top">
          <strong style="color:#A85636">${fmt(m.subtotal)}</strong>
        </td>
      </tr>`).join('');

    const mailAdmin = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f7f4ef;font-family:'Helvetica Neue',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f4ef;padding:40px 0"><tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%">
  <tr><td style="background:#1A1A2E;border-radius:16px 16px 0 0;padding:24px 28px">
    <p style="margin:0;color:rgba(255,255,255,.5);font-size:11px;letter-spacing:.15em;text-transform:uppercase">Nuevo lead · Wizard web</p>
    <h1 style="margin:6px 0 0;color:#fff;font-size:20px;font-weight:700">${nombre}</h1>
    <p style="margin:4px 0 0;color:#A85636;font-size:13px">${email}${tel ? ' · ' + tel : ''}</p>
  </td></tr>
  <tr><td style="background:#fff;border-left:1px solid #e2ddd6;border-right:1px solid #e2ddd6;padding:20px 28px">
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2ddd6;border-radius:10px;overflow:hidden;background:#fff">
      <tr style="background:#faf8f5">
        <th style="padding:10px 16px;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#9c9490;text-align:left;font-weight:600">Módulo</th>
        <th style="padding:10px 16px;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#9c9490;text-align:left;font-weight:600">Ítems</th>
        <th style="padding:10px 16px;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#9c9490;text-align:right;font-weight:600">Valor</th>
      </tr>
      ${modsAdminHtml}
    </table>
  </td></tr>
  <tr><td style="background:#faf8f5;border-left:1px solid #e2ddd6;border-right:1px solid #e2ddd6;padding:16px 28px">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-size:13px;color:#6b6560">Total estimativo enviado al cliente</td>
      <td style="text-align:right">
        <strong style="font-size:20px;color:#A85636">${fmt(totalARS)}</strong>
        <span style="font-size:12px;color:#9c9490;margin-left:8px">≈ USD ${totalUSD.toLocaleString('es-AR')}</span>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="background:#fff;border:1px solid #e2ddd6;border-top:none;padding:18px 28px;border-radius:0 0 16px 16px">
    <a href="mailto:${email}?subject=Tu consulta en Método Fermento" style="display:inline-block;padding:10px 20px;background:#A85636;color:#fff;border-radius:999px;font-size:13px;font-weight:600;text-decoration:none;margin-right:8px">Responder</a>
    ${tel ? `<a href="https://wa.me/${tel.replace(/\D/g,'')}?text=Hola%20${encodeURIComponent(nombre)}%2C%20te%20contacto%20desde%20M%C3%A9todo%20Fermento." style="display:inline-block;padding:10px 20px;background:#25D366;color:#fff;border-radius:999px;font-size:13px;font-weight:600;text-decoration:none">WhatsApp</a>` : ''}
    <div style="margin-top:12px;font-size:11px;color:#c0b8b0">Lead ID: ${lead?.id||'—'} · TC BNA: ${fmt(exchangeRate).replace('ARS\u00a0','$')}/USD</div>
  </td></tr>
  <tr><td style="padding:16px 0;text-align:center">
    <p style="margin:0;font-size:11px;color:#b0a89e">Método Fermento Admin · metodofermento.com.ar</p>
  </td></tr>
</table></td></tr></table></body></html>`;

    await Promise.all([
      transporter.sendMail({
        from:    `"Método Fermento" <${process.env.SMTP_USER}>`,
        to:      email,
        replyTo: process.env.ADMIN_EMAIL,
        subject: `Tu presupuesto estimativo · Método Fermento`,
        html:    mailCliente,
      }),
      transporter.sendMail({
        from:    `"Método Fermento Web" <${process.env.SMTP_USER}>`,
        to:      process.env.ADMIN_EMAIL,
        replyTo: email,
        subject: `🍽️ Nuevo lead — ${nombre} · ${fmt(totalARS)}`,
        html:    mailAdmin,
      }),
    ]);

    return res.status(200).json({ status:'ok', id: lead?.id, totalARS, totalUSD });

  } catch(err) {
    console.error('Error en /api/leads:', err);
    return res.status(500).json({ status:'error', message: err.message });
  }
}
