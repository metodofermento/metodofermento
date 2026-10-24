// api/admin-celestia.js — datos de Celestia Management para el admin de chefprivado.ar/admin.
// Autoriza con la sesión de Supabase del admin de Celestia (mismo login del panel), sin claves extra.
// GET  ?que=resumen|leads|alumnos|compras
// POST { accion:'lead', id, estado?, notas? } | { accion:'alumno', id, activo?, cursos? } | { accion:'reset', email }
import { randomBytes, pbkdf2Sync } from 'crypto';
import nodemailer from 'nodemailer';

const CEL_URL  = 'https://qolpnuscpmzqeacshfvu.supabase.co';
const CEL_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvbHBudXNjcG16cWVhY3NoZnZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3NjQ3OTQsImV4cCI6MjA5MTM0MDc5NH0.BJOz5Gwkeb1NqID_gkGKD5YlymifMtOwaf8iQMaBCx8';
const ADMINS   = ['dario@dali-arquitectura.com.ar', 'celestiachefs@gmail.com'];
const SB = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_KEY;
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };

async function esAdmin(req) {
  const t = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!t) return false;
  const r = await fetch(CEL_URL + '/auth/v1/user', { headers: { apikey: CEL_ANON, Authorization: 'Bearer ' + t } });
  if (!r.ok) return false;
  const u = await r.json();
  return ADMINS.includes(String(u.email || '').toLowerCase());
}
const get = async (q) => { const r = await fetch(SB + '/rest/v1/' + q, { headers: H }); return r.ok ? r.json() : []; };
const patch = async (t, f, b) => (await fetch(SB + '/rest/v1/' + t + '?' + f, { method: 'PATCH', headers: H, body: JSON.stringify(b) })).ok;

export default async function handler(req, res) {
  if (!(await esAdmin(req))) return res.status(403).json({ error: 'No autorizado' });

  if (req.method === 'GET') {
    const que = req.query.que || 'resumen';
    if (que === 'leads') return res.json(await get('leads?select=id,nombre,email,tel,modulos_seleccionados,detalles_modulos,estado,notas,raw_payload,created_at&order=created_at.desc&limit=300'));
    if (que === 'alumnos') return res.json(await get('users?select=id,email,nombre,cursos,activo,ultimo_acceso,created_at&order=created_at.desc&limit=500'));
    if (que === 'compras') return res.json(await get('compras?select=id,email,producto,monto,estado,payment_id,created_at&order=created_at.desc&limit=500'));
    const [l, u, c] = await Promise.all([get('leads?select=estado'), get('users?select=id'), get('compras?select=monto')]);
    return res.json({
      leads: l.length, nuevos: l.filter((x) => x.estado === 'nuevo').length,
      alumnos: u.length, compras: c.length, facturado: c.reduce((s, x) => s + (Number(x.monto) || 0), 0),
    });
  }

  if (req.method === 'POST') {
    const b = req.body || {};
    if (b.accion === 'lead') {
      const up = { updated_at: new Date().toISOString() };
      if (['nuevo', 'contactado', 'cerrado', 'descartado'].includes(b.estado)) up.estado = b.estado;
      if (typeof b.notas === 'string') up.notas = b.notas.slice(0, 2000);
      return res.json({ ok: await patch('leads', 'id=eq.' + Number(b.id), up) });
    }
    if (b.accion === 'alumno') {
      const up = { updated_at: new Date().toISOString() };
      if (typeof b.activo === 'boolean') up.activo = b.activo;
      if (Array.isArray(b.cursos)) up.cursos = b.cursos.filter((c) => ['curso01', 'curso02', 'curso03', 'todos'].includes(c));
      return res.json({ ok: await patch('users', 'id=eq.' + Number(b.id), up) });
    }
    if (b.accion === 'reset') {
      const email = String(b.email || '').toLowerCase().trim();
      const [u] = await get('users?select=id,email,nombre&email=eq.' + encodeURIComponent(email) + '&limit=1');
      if (!u) return res.status(404).json({ error: 'No existe ese alumno' });
      const w = ['Fuego', 'Menta', 'Caldo', 'Horno', 'Masa', 'Sal', 'Aceite', 'Brasa', 'Lima', 'Anis'], p = () => w[randomBytes(1)[0] % w.length];
      const nueva = p() + p() + (10 + randomBytes(1)[0] % 90);
      const hash = pbkdf2Sync(nueva, process.env.PASSWORD_SALT || 'mf-salt-2025', 100000, 64, 'sha512').toString('hex');
      await patch('users', 'id=eq.' + u.id, { password_hash: hash, updated_at: new Date().toISOString() });
      try {
        await nodemailer.createTransport({ host: process.env.SMTP_HOST || 'smtp.gmail.com', port: Number(process.env.SMTP_PORT || 465), secure: true, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } }).sendMail({
          from: `"Celestia Management" <${process.env.SMTP_USER}>`, to: u.email, subject: 'Tu nueva contraseña · Celestia Management',
          html: `<p>Hola ${u.nombre || ''}, tu nueva contraseña para la plataforma de cursos es: <b style="font-family:monospace">${nueva}</b></p><p><a href="https://www.chefprivado.ar/management/login">Ingresar a mis cursos →</a></p>`,
        });
      } catch (e) {}
      return res.json({ ok: true, password: nueva });
    }
  }
  return res.status(400).json({ error: 'Acción no reconocida' });
}
