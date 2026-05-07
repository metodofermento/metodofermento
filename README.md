# Método Fermento — Deploy Guide

## Estructura del proyecto

```
mf-project/
├── api/
│   ├── leads.js           ← recibe el wizard, guarda en Supabase, manda mail
│   └── admin-leads.js     ← CRUD del panel admin
├── admin/
│   └── index.html         ← panel admin (acceso: /admin)
├── public/
│   └── index.html         ← sitio principal (copiar metodofermento-v2.html acá)
├── supabase-migration.sql ← ejecutar en Supabase una sola vez
├── vercel.json
├── package.json
└── README.md
```

---

## Paso 1 — Supabase (base de datos)

1. Crear cuenta en [supabase.com](https://supabase.com) (gratis)
2. Crear nuevo proyecto → elegir región **South America (São Paulo)**
3. Ir a **SQL Editor** → pegar y ejecutar el contenido de `supabase-migration.sql`
4. Ir a **Settings → API** y copiar:
   - **Project URL** → `SUPABASE_URL`
   - **service_role key** (no la anon key) → `SUPABASE_SERVICE_KEY`

---

## Paso 2 — Gmail App Password (para el mail)

1. Ir a [myaccount.google.com/security](https://myaccount.google.com/security)
2. Activar **Verificación en dos pasos** si no está activa
3. Buscar **Contraseñas de aplicaciones**
4. Crear nueva → nombre: "Método Fermento Web"
5. Copiar la contraseña de 16 caracteres → `SMTP_PASS`

---

## Paso 3 — Vercel (deploy)

1. Crear cuenta en [vercel.com](https://vercel.com) (gratis)
2. Instalar Vercel CLI: `npm i -g vercel`
3. En la carpeta del proyecto: `vercel login` y luego `vercel`
4. Ir a **Settings → Environment Variables** y agregar:

| Variable              | Valor                                          |
|-----------------------|------------------------------------------------|
| `SUPABASE_URL`        | URL de tu proyecto Supabase                    |
| `SUPABASE_SERVICE_KEY`| Service role key de Supabase                  |
| `SMTP_HOST`           | `smtp.gmail.com`                               |
| `SMTP_PORT`           | `465`                                          |
| `SMTP_USER`           | `metodofermento@gmail.com`                     |
| `SMTP_PASS`           | App Password de Gmail (16 caracteres)          |
| `ADMIN_EMAIL`         | email donde recibís los leads                  |
| `ADMIN_SECRET`        | contraseña del panel admin (inventá una segura)|

5. Redeploy: `vercel --prod`

---

## Paso 4 — Apuntar el dominio

En Vercel → **Settings → Domains** → agregar `metodofermento.com.ar`

En tu registrador de dominio, agregar los DNS que te da Vercel:
```
Type: CNAME
Name: www
Value: cname.vercel-dns.com
```

---

## Paso 5 — Actualizar el wizard en index.html

En `public/index.html`, buscar la línea con `WIZ_URL` y cambiar:

```js
// ANTES (Google Apps Script):
const WIZ_URL = 'https://script.google.com/macros/s/...';

// DESPUÉS (tu propia API):
const WIZ_URL = '/api/leads';
```

---

## Panel admin

Accedé en: `https://www.metodofermento.com.ar/admin`

- Ingresás con la contraseña que definiste en `ADMIN_SECRET`
- Podés cambiar el estado de cada lead (nuevo → contactado → cerrado)
- Agregar notas internas
- Ver estadísticas de módulos más pedidos
- Exportar todo a CSV con un clic

---

## El mail sigue llegando igual

Cada vez que alguien completa el wizard, recibís un email con:
- Datos de contacto del lead
- Módulos seleccionados con detalle
- Botón para responder directamente
- Botón de WhatsApp si dejó teléfono

---

## Seguridad

- El panel admin está protegido por `ADMIN_SECRET` — nunca la expongas en el código
- Supabase tiene RLS activado — la base de datos solo es accesible desde el server
- La `anon key` de Supabase **no** tiene acceso a la tabla de leads
