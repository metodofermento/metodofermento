// api/precios.js
// GET  ?secret=XXX          → devuelve todos los precios + dólar BNA actual
// PATCH ?secret=XXX         → body { key, valor } → actualiza un precio

import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { realtime: { transport: ws } }
);

// Fetch dólar BNA desde la API de Bluelytics (gratuita, sin key)
async function fetchDolarBNA() {
  try {
    const res = await fetch('https://api.bluelytics.com.ar/v2/latest', {
      headers: { 'User-Agent': 'metodofermento-web/1.0' },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error('API no disponible');
    const data = await res.json();
    // Usamos el oficial venta (Banco Nación)
    const oficial = data?.oficial?.value_sell || null;
    return oficial;
  } catch {
    return null; // fallback al valor guardado en DB
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const secret = req.query?.secret || req.body?.secret;
  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'No autorizado.' });
  }

  // ── GET ──────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { data: precios, error } = await supabase
      .from('precios')
      .select('*')
      .order('key');

    if (error) return res.status(500).json({ error: error.message });

    // Intentar obtener dólar BNA en tiempo real
    const dolarBNA = await fetchDolarBNA();

    // Si obtuvimos el dólar, actualizamos EXCHANGE_RATE en DB automáticamente
    if (dolarBNA) {
      await supabase
        .from('precios')
        .update({ valor: dolarBNA, updated_at: new Date().toISOString() })
        .eq('key', 'EXCHANGE_RATE');
      // Actualizamos en el array local también
      const er = precios.find(p => p.key === 'EXCHANGE_RATE');
      if (er) er.valor = dolarBNA;
    }

    return res.status(200).json({
      precios,
      dolarBNA: dolarBNA || precios.find(p => p.key === 'EXCHANGE_RATE')?.valor,
      dolarFuente: dolarBNA ? 'Banco Nación (tiempo real)' : 'valor manual (API no disponible)',
    });
  }

  // ── PATCH — actualizar un precio ─────────────────────────────────
  if (req.method === 'PATCH') {
    const { key, valor } = req.body || {};
    if (!key || valor === undefined) return res.status(400).json({ error: 'key y valor requeridos' });

    const { data, error } = await supabase
      .from('precios')
      .update({ valor: Number(valor), updated_at: new Date().toISOString() })
      .eq('key', key)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, precio: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
