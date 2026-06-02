-- ============================================================
-- MÉTODO FERMENTO — Tabla users (alumnos)
-- Ejecutar en Supabase > SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  nombre        TEXT NOT NULL,
  password_hash TEXT NOT NULL,           -- bcrypt hash
  cursos        TEXT[] DEFAULT '{}',     -- ['curso01','curso02','curso03'] o ['todos']
  activo        BOOLEAN NOT NULL DEFAULT true,
  ultimo_acceso TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
-- Solo service_role accede (las API routes usan service key)

-- ============================================================
-- Tabla sessions (tokens de sesión simples)
-- ============================================================

CREATE TABLE IF NOT EXISTS sessions (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,       -- UUID generado en el server
  expires_at TIMESTAMPTZ NOT NULL,       -- NOW() + 30 days
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_token   ON sessions (token);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Vista útil para el admin
-- ============================================================
CREATE OR REPLACE VIEW users_stats AS
SELECT
  COUNT(*)                                                        AS total,
  COUNT(*) FILTER (WHERE activo = true)                           AS activos,
  COUNT(*) FILTER (WHERE 'todos' = ANY(cursos))                   AS acceso_completo,
  COUNT(*) FILTER (WHERE ultimo_acceso >= NOW() - INTERVAL '7d')  AS activos_7_dias,
  COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30d')    AS nuevos_30_dias
FROM users;
