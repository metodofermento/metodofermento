// api/auth.js
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function hashPassword(password) {
  const salt = process.env.PASSWORD_SALT || 'mf-salt-2025';
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

function generateToken() {
  return crypto.randomUUID() + '-' + crypto.randomBytes(16).toString('hex');
}

function getToken(req) {
  const auth = req.headers['authorization'] || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query?.action;

  // LOGIN
  if (action === 'login' && req.method === 'POST') {
    const { email, password } = req.body || {};
    if (!email || !password)
      return res.status(400).json({ error: 'Email y contrasena requeridos.' });

    const { data: user } = await supabase
      .from('users')
      .select('id,email,nombre,cursos,activo,password_hash')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    if (!user || user.password_hash !== hashPassword(password))
      return res.status(401).json({ error: 'Email o contrasena incorrectos.' });

    if (!user.activo)
      return res.status(403).json({ error: 'Tu cuenta esta desactivada.' });

    const token = generateToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    await supabase.from('sessions').insert({ user_id: user.id, token, expires_at: expiresAt });
    await supabase.from('users').update({ ultimo_acceso: new Date().toISOString() }).eq('id', user.id);

    return res.status(200).json({
      token,
      user: { id: user.id, email: user.email, nombre: user.nombre, cursos: user.cursos }
    });
  }

  // REGISTER
  if (action === 'register' && req.method === 'POST') {
    const { email, nombre, password, cursos, secret } = req.body || {};
    if (secret !== process.env.ADMIN_SECRET)
      return res.status(401).json({ error: 'No autorizado.' });
    if (!email || !nombre || !password)
      return res.status(400).json({ error: 'Email, nombre y contrasena requeridos.' });

    const { error } = await supabase.from('users').insert({
      email:         email.toLowerCase().trim(),
      nombre:        nombre.trim(),
      password_hash: hashPassword(password),
      cursos:        cursos || ['todos'],
    });

    if (error) {
      if (error.code === '23505')
        return res.status(409).json({ error: 'Ese email ya esta registrado.' });
      return res.status(500).json({ error: error.message });
    }
    return res.status(201).json({ ok: true });
  }

  // VERIFY
  if (action === 'verify' && req.method === 'GET') {
    const token = getToken(req);
    if (!token) return res.status(401).json({ error: 'Token requerido.' });

    const { data: session } = await supabase
      .from('sessions')
      .select('user_id, expires_at')
      .eq('token', token)
      .maybeSingle();

    if (!session) return res.status(401).json({ error: 'Sesion invalida.' });
    if (new Date(session.expires_at) < new Date())
      return res.status(401).json({ error: 'Sesion expirada.' });

    const { data: user } = await supabase
      .from('users')
      .select('id,email,nombre,cursos,activo')
      .eq('id', session.user_id)
      .maybeSingle();

    if (!user || !user.activo)
      return res.status(403).json({ error: 'Cuenta inactiva.' });

    return res.status(200).json({ user });
  }

  // LOGOUT
  if (action === 'logout' && req.method === 'POST') {
    const token = getToken(req);
    if (token) await supabase.from('sessions').delete().eq('token', token);
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'Accion no reconocida.' });
}
