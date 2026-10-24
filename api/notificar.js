// api/notificar.js — avisos internos de Celestia (reservas, pedidos de cajas, clases, etc.)
// Los manda por el Gmail de Celestia Management a los destinatarios FIJOS de lib/avisos.js:
// no se puede elegir el destinatario desde afuera, así que no sirve para mandar spam a terceros.
import nodemailer from 'nodemailer';
import { AVISOS_A } from '../lib/avisos.js';

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST || 'smtp.gmail.com',
  port:   Number(process.env.SMTP_PORT || 465),
  secure: true,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (req.headers['x-celestia'] !== 'aviso') return res.status(403).json({ error: 'No autorizado' });
  const { asunto, html, replyTo } = req.body || {};
  if (!asunto || !html) return res.status(400).json({ error: 'Faltan asunto o html' });
  try {
    await transporter.sendMail({
      from:    `"Celestia" <${process.env.SMTP_USER}>`,
      to:      AVISOS_A,
      replyTo: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo || '') ? replyTo : undefined,
      subject: String(asunto).slice(0, 180),
      html:    String(html).slice(0, 60000),
    });
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[notificar]', e.message);
    return res.status(500).json({ ok: false, error: 'No se pudo enviar' });
  }
}
