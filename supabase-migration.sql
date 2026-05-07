-- ============================================================
-- MÉTODO FERMENTO — Tabla leads
-- Ejecutar en Supabase > SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS leads (
  id                    BIGSERIAL PRIMARY KEY,
  nombre                TEXT NOT NULL,
  email                 TEXT NOT NULL,
  tel                   TEXT,

  -- Módulos seleccionados (array de strings con los títulos)
  modulos_seleccionados TEXT[] DEFAULT '{}',

  -- Detalle completo por módulo (JSON)
  detalles_modulos      JSONB DEFAULT '{}',

  -- Estado del lead en el pipeline
  estado                TEXT NOT NULL DEFAULT 'nuevo'
                        CHECK (estado IN ('nuevo','contactado','cerrado','descartado')),

  -- Notas internas del admin
  notas                 TEXT,

  -- Origen
  fuente                TEXT DEFAULT 'wizard-web',

  -- Payload crudo por si necesitás reprocesar
  raw_payload           JSONB,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices útiles para filtros frecuentes
CREATE INDEX IF NOT EXISTS idx_leads_estado      ON leads (estado);
CREATE INDEX IF NOT EXISTS idx_leads_email       ON leads (email);
CREATE INDEX IF NOT EXISTS idx_leads_created_at  ON leads (created_at DESC);

-- Row Level Security: solo el service role puede leer/escribir
-- (la anon key NO tiene acceso)
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

-- Política: el service role bypasea RLS por defecto → no necesitás policy adicional.
-- Si en algún momento usás la anon key (no recomendado), agregá:
-- CREATE POLICY "solo_service_role" ON leads USING (false);

-- ============================================================
-- Vista útil para estadísticas rápidas
-- ============================================================
CREATE OR REPLACE VIEW leads_stats AS
SELECT
  COUNT(*)                                                      AS total,
  COUNT(*) FILTER (WHERE estado = 'nuevo')                     AS nuevos,
  COUNT(*) FILTER (WHERE estado = 'contactado')                AS contactados,
  COUNT(*) FILTER (WHERE estado = 'cerrado')                   AS cerrados,
  COUNT(*) FILTER (WHERE estado = 'descartado')                AS descartados,
  COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7d') AS ultimos_7_dias,
  COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30d')AS ultimos_30_dias
FROM leads;
