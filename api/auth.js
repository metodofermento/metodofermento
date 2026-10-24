// api/auth.js — fetch nativo, sin SDK Supabase [v2]
const { pbkdf2Sync, randomBytes, randomUUID } = require('crypto');

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

const headers = {
  'apikey':        SB_KEY,
  'Authorization': 'Bearer ' + SB_KEY,
  'Content-Type':  'application/json',
  'Prefer':        'return=representation',
};

async function sbGet(table, filter) {
  const url = `${SB_URL}/rest/v1/${table}?${filter}&limit=1`;
  const r = await fetch(url, { headers: { ...headers, Prefer: 'return=representation' } });
  const data = await r.json();
  return Array.isArray(data) ? data[0] || null : null;
}

async function sbPost(table, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: 'POST', headers, body: JSON.stringify(body)
  });
  const data = await r.json();
  if (!r.ok) return { error: data };
  return { data: Array.isArray(data) ? data[0] : data };
}

async function sbPatch(table, filter, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH', headers, body: JSON.stringify(body)
  });
  return r.ok;
}

async function sbDelete(table, filter) {
  await fetch(`${SB_URL}/rest/v1/${table}?${filter}`, { method: 'DELETE', headers });
}

function hashPassword(password) {
  const salt = process.env.PASSWORD_SALT || 'mf-salt-2025';
  return pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

function generateToken() {
  return randomUUID() + '-' + randomBytes(16).toString('hex');
}

function getToken(req) {
  const auth = req.headers['authorization'] || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

function enc(s) { return encodeURIComponent(s); }

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query && req.query.action;

  // ── LOGIN ────────────────────────────────────────────────────────
  if (action === 'login' && req.method === 'POST') {
    const { email, password } = req.body || {};
    if (!email || !password)
      return res.status(400).json({ error: 'Email y contrasena requeridos.' });

    const user = await sbGet('users',
      `select=id,email,nombre,cursos,activo,password_hash&email=eq.${enc(email.toLowerCase().trim())}`
    );

    if (!user || user.password_hash !== hashPassword(password))
      return res.status(401).json({ error: 'Email o contrasena incorrectos.' });

    if (!user.activo)
      return res.status(403).json({ error: 'Tu cuenta esta desactivada.' });

    const token     = generateToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    await sbPost('sessions', { user_id: user.id, token, expires_at: expiresAt });
    await sbPatch('users', `id=eq.${user.id}`, { ultimo_acceso: new Date().toISOString() });

    return res.status(200).json({
      token,
      user: { id: user.id, email: user.email, nombre: user.nombre, cursos: user.cursos }
    });
  }

  // ── REGISTER ─────────────────────────────────────────────────────
  if (action === 'register' && req.method === 'POST') {
    const { email, nombre, password, cursos, secret } = req.body || {};
    if (secret !== process.env.ADMIN_SECRET)
      return res.status(401).json({ error: 'No autorizado.' });
    if (!email || !nombre || !password)
      return res.status(400).json({ error: 'Email, nombre y contrasena requeridos.' });

    const { error } = await sbPost('users', {
      email:         email.toLowerCase().trim(),
      nombre:        nombre.trim(),
      password_hash: hashPassword(password),
      cursos:        cursos || ['todos'],
    });

    if (error) {
      if (error.code === '23505')
        return res.status(409).json({ error: 'Ese email ya esta registrado.' });
      return res.status(500).json({ error: error.message || JSON.stringify(error) });
    }
    return res.status(201).json({ ok: true });
  }

  // ── VERIFY ───────────────────────────────────────────────────────
  if (action === 'verify' && req.method === 'GET') {
    const token = getToken(req);
    if (!token) return res.status(401).json({ error: 'Token requerido.' });

    const session = await sbGet('sessions',
      `select=user_id,expires_at&token=eq.${enc(token)}`
    );

    if (!session) return res.status(401).json({ error: 'Sesion invalida.' });
    if (new Date(session.expires_at) < new Date())
      return res.status(401).json({ error: 'Sesion expirada.' });

    const user = await sbGet('users',
      `select=id,email,nombre,cursos,activo&id=eq.${session.user_id}`
    );

    if (!user || !user.activo)
      return res.status(403).json({ error: 'Cuenta inactiva.' });

    return res.status(200).json({ user });
  }

  // ── RESET: genera una contraseña nueva y la manda por mail ──────
  if (action === 'reset' && req.method === 'POST') {
    const email = String((req.body || {}).email || '').toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: 'Ingresá un email válido.' });
    const user = await sbGet('users', `select=id,email,nombre,activo&email=eq.${enc(email)}`);
    // Respuesta igual exista o no la cuenta (no revelamos qué emails están registrados)
    if (user && user.activo) {
      const words = ['Fuego','Menta','Caldo','Horno','Masa','Sal','Aceite','Brasa','Lima','Anis'];
      const pick = () => words[randomBytes(1)[0] % words.length];
      const nueva = pick() + pick() + (10 + randomBytes(1)[0] % 90);
      await sbPatch('users', `id=eq.${user.id}`, { password_hash: hashPassword(nueva), updated_at: new Date().toISOString() });
      await sbDelete('sessions', `user_id=eq.${user.id}`);
      try {
        const nodemailer = require('nodemailer');
        const t = nodemailer.createTransport({ host: process.env.SMTP_HOST || 'smtp.gmail.com', port: Number(process.env.SMTP_PORT || 465), secure: true, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
        const site = process.env.SITE_URL || 'https://www.chefprivado.ar/management';
        await t.sendMail({
          from: `"Celestia Management" <${process.env.SMTP_USER}>`, to: user.email, replyTo: process.env.ADMIN_EMAIL,
          subject: 'Tu nueva contraseña · Celestia Management',
          html: `<div style="background:#FAF6EF;padding:28px 12px;font-family:Arial,sans-serif"><div style="max-width:560px;margin:auto;background:#fff;border:1px solid #E7DFCF;border-radius:16px;overflow:hidden">
            <div style="background:#0D1B2A;padding:24px 28px"><img src="https://www.chefprivado.ar/img/management/logo-pill.png" width="220" alt="Celestia Management" style="display:block;height:auto;border:0"></div>
            <div style="padding:26px 28px;color:#1c1f2a;font-size:15px;line-height:1.7"><p style="margin:0 0 14px">Hola ${user.nombre || ''}, te generamos una contraseña nueva para entrar a la plataforma de cursos:</p>
            <p style="margin:0 0 6px"><b>Email:</b> ${user.email}</p><p style="margin:0 0 20px"><b>Contraseña:</b> <span style="font-family:monospace;background:#FAF6EF;border:1px solid #E7DFCF;border-radius:6px;padding:3px 9px">${nueva}</span></p>
            <a href="${site}/login" style="display:inline-block;background:#C9A84C;color:#0D1B2A;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:24px">Ingresar a mis cursos →</a>
            <p style="margin:20px 0 0;font-size:13px;color:#777">Si no pediste este cambio, escribinos por WhatsApp al +54 9 11 6041-0607.</p></div></div></div>`,
        });
      } catch (e) { console.error('[auth reset] mail', e.message); }
    }
    return res.status(200).json({ ok: true });
  }

  // ── LOGOUT ───────────────────────────────────────────────────────
  if (action === 'logout' && req.method === 'POST') {
    const token = getToken(req);
    if (token) await sbDelete('sessions', `token=eq.${enc(token)}`);
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'Accion no reconocida.' });
};
