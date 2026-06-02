// api/auth.js — usa fetch nativo contra Supabase REST (sin SDK)
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

  // ── LOGOUT ───────────────────────────────────────────────────────
  if (action === 'logout' && req.method === 'POST') {
    const token = getToken(req);
    if (token) await sbDelete('sessions', `token=eq.${enc(token)}`);
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'Accion no reconocida.' });
};
