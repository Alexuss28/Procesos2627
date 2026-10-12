# Mi SaaS

Aplicación web tipo SaaS con gestión de usuarios, organizada en capas.
Proyecto individual de *Procesos de Ingeniería del Software* (curso 2026-2027).

- **URL pública:** https://procesos2627.onrender.com
- **Repositorio:** https://github.com/Alexuss28/Procesos2627

> La capa gratuita de Render se suspende tras un periodo de inactividad: la primera petición puede tardar cerca de un minuto en responder.

## Tecnologías

| Tecnología | Justificación |
|---|---|
| Node.js + Express | Servidor ligero que sirve el frontend y la API desde el mismo origen. |
| HTML + JavaScript (sin framework) | Interfaz sencilla, con la presentación y el cliente de comunicación separados. |
| PostgreSQL en Supabase | Base de datos relacional real y persistente, con capa gratuita. |
| pg | Cliente oficial de PostgreSQL para Node. |
| bcryptjs | Hash seguro de contraseñas (nunca se guardan en texto plano). |
| express-session + connect-pg-simple | Sesiones con cookie `httpOnly` guardadas en la base de datos, que sobreviven a recargas y reinicios. |
| dotenv | Carga de secretos desde variables de entorno en local. |
| node:test | Framework de pruebas incluido en Node, sin dependencias adicionales. |
| GitHub Actions | Integración continua: ejecuta las pruebas en cada pull request y en cada cambio en `main`. |
| Render | Despliegue continuo en la nube: cada cambio en `main` se despliega automáticamente. |

## Arquitectura

```
cliente/
  index.html   → capa de presentación (interfaz)
  rest.js      → cliente de comunicación con el servidor (único uso de fetch)
servidor/
  api.js       → capa API (rutas HTTP, sesión, gestión de errores)
  logica.js    → capa de lógica de negocio (reglas de usuarios, roles, validación, hash)
  datos.js     → capa de acceso a datos (PostgreSQL y repositorio en memoria)
  logger.js    → registro (log) de la actividad
```

- El servidor sirve el frontend (mismo origen) y toda la lógica reside en el servidor.
- La comunicación cliente-servidor se hace exclusivamente a través de la API (`/api/...`).
- La lógica no depende de Express ni de PostgreSQL: recibe el repositorio como dependencia.
- Los permisos (usuario/administrador) se comprueban en el servidor.

## Ejecutar en local

Requisitos: Node.js 20 o superior y una base de datos PostgreSQL (por ejemplo, un proyecto gratuito en Supabase).

1. Clonar el repositorio e instalar dependencias:
```bash
   npm install
```
2. Copiar `.env.example` a `.env` y rellenar los valores (ver sección siguiente).
3. Arrancar:
```bash
   npm start
```
4. Abrir <http://localhost:3000>.

Si `DATABASE_URL` está vacía, la aplicación arranca con datos en memoria (solo para desarrollo; se pierden al reiniciar).

## Ejecutar las pruebas

```bash
npm test
```

Ejecuta las pruebas unitarias automatizadas de la capa de lógica (registro, inicio de sesión, roles, eliminación de usuarios y casos de error).

## Variables de entorno

Solo se indican los nombres; los valores reales nunca se suben al repositorio (ver `.env.example`).

| Variable | Descripción |
|---|---|
| `PORT` | Puerto del servidor (en Render lo asigna la plataforma). |
| `NODE_ENV` | `development` o `production`. |
| `DATABASE_URL` | Cadena de conexión a PostgreSQL. |
| `SESSION_SECRET` | Clave para firmar la cookie de sesión. |
| `ADMIN_EMAIL` | Email del administrador inicial. |
| `ADMIN_PASSWORD` | Contraseña del administrador inicial. |
| `REQUIERE_CONFIRMACION` | `true` para exigir confirmación de cuenta por correo; `false` en este sprint. |

## Acceso como administrador

El primer administrador se crea automáticamente al arrancar el servidor a partir de `ADMIN_EMAIL` y `ADMIN_PASSWORD`. Si ya existe, no se modifica. Así no hay credenciales en el código ni endpoints públicos de promoción.

Las credenciales de prueba para la revisión se envían junto con la entrega, no se publican en este repositorio.

## Funcionalidades del Sprint 1

- Registro de usuarios locales con contraseña almacenada con hash (bcrypt).
- Inicio y cierre de sesión, con la sesión mantenida entre recargas.
- Roles `usuario` y `administrador`.
- Listado de usuarios y comprobación de si un usuario está activo (solo administrador).
- Eliminación de usuarios: el administrador puede eliminar a cualquiera; un usuario normal solo su propia cuenta.
- Rutas protegidas que rechazan peticiones sin sesión válida o sin el rol necesario.
- Persistencia en PostgreSQL y registro de la actividad relevante.

## Flujo de trabajo y CI/CD

- **GitHub Flow:** una rama por cambio, pruebas en local antes del pull request e integración en `main` mediante pull request.
- **Integración continua:** GitHub Actions (`.github/workflows/ci.yml`) ejecuta `npm ci` y `npm test` en cada pull request y en cada cambio en `main`.
- **Despliegue continuo:** Render despliega automáticamente cada cambio que llega a `main`.
- Los hitos están etiquetados en el historial (`hito-1`, `hito-2`, `hito-3`).