// api/admin-leads.js
// GET  ?secret=XXX              → lista todos los leads
// GET  ?secret=XXX&stats=1      → solo estadísticas
// GET  ?secret=XXX&export=csv   → descarga CSV
// PATCH ?secret=XXX             → body { id, estado, notas }
// DELETE ?secret=XXX            → body { id }

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function authCheck(req, res) {
  const secret = req.query?.secret || req.body?.secret;
  if (secret !== process.env.ADMIN_SECRET) {
    res.status(401).json({ error: 'No autorizado.' });
    return false;
  }
  return true;
}

function toCSV(leads) {
  const cols = ['id','nombre','email','tel','estado','modulos','fuente','notas','created_at'];
  const header = cols.join(',');
  const rows = leads.map(l => [
    l.id,
    `"${(l.nombre||'').replace(/"/g,'""')}"`,
    `"${(l.email||'').replace(/"/g,'""')}"`,
    `"${(l.tel||'').replace(/"/g,'""')}"`,
    l.estado,
    `"${(l.modulos_seleccionados||[]).join(' | ')}"`,
    l.fuente,
    `"${(l.notas||'').replace(/"/g,'""')}"`,
    l.created_at,
  ].join(','));
  return [header, ...rows].join('\n');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!authCheck(req, res)) return;

  // ── GET ───────────────────────────────────────────────────────────
  if (req.method === 'GET') {

    // Stats
    if (req.query.stats) {
      const { data: leads } = await supabase.from('leads').select('estado,modulos_seleccionados,created_at');

      const byEstado = { nuevo:0, contactado:0, cerrado:0, descartado:0 };
      const byMod    = {};
      const byMonth  = {};

      (leads || []).forEach(l => {
        byEstado[l.estado] = (byEstado[l.estado] || 0) + 1;
        (l.modulos_seleccionados || []).forEach(m => { byMod[m] = (byMod[m] || 0) + 1; });
        const mes = (l.created_at || '').slice(0,7);
        byMonth[mes] = (byMonth[mes] || 0) + 1;
      });

      return res.status(200).json({ byEstado, byMod, byMonth, total: leads?.length || 0 });
    }

    // Export CSV
    if (req.query.export === 'csv') {
      const { data: leads } = await supabase.from('leads').select('*').order('created_at', { ascending: false });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="mf-leads-${new Date().toISOString().slice(0,10)}.csv"`);
      return res.status(200).send('\uFEFF' + toCSV(leads || [])); // BOM para Excel
    }

    // Lista paginada
    const page  = Number(req.query.page  || 1);
    const limit = Number(req.query.limit || 25);
    const desde = (page - 1) * limit;
    const filtroEstado = req.query.estado;
    const busqueda     = req.query.q;

    let query = supabase.from('leads').select('*', { count: 'exact' });

    if (filtroEstado && filtroEstado !== 'todos') query = query.eq('estado', filtroEstado);
    if (busqueda) query = query.or(`nombre.ilike.%${busqueda}%,email.ilike.%${busqueda}%`);

    query = query.order('created_at', { ascending: false }).range(desde, desde + limit - 1);

    const { data: leads, count, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({ leads, total: count, page, limit });
  }

  // ── PATCH — actualizar estado o notas ─────────────────────────────
  if (req.method === 'PATCH') {
    const { id, estado, notas } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id requerido' });

    const updates = {};
    if (estado !== undefined) updates.estado = estado;
    if (notas  !== undefined) updates.notas  = notas;
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase.from('leads').update(updates).eq('id', id).select().single();
    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({ ok: true, lead: data });
  }

  // ── DELETE ────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id requerido' });

    const { error } = await supabase.from('leads').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
