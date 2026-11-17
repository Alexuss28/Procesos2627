# Mi SaaS

Organizador de turnos y cambios entre empleados, pensado para pequeños negocios con personal que trabaja por turnos. Aplicación web tipo SaaS con gestión de usuarios, organizada en capas.
Proyecto individual de *Procesos de Ingeniería del Software* (curso 2026-2027).

- **URL pública:** https://procesos2627.onrender.com
- **Repositorio:** https://github.com/Alexuss28/Procesos2627

> La capa gratuita de Render se suspende tras un periodo de inactividad: la primera petición puede tardar cerca de un minuto en responder.

## Qué permite hacer

- Crear calendarios de turnos.
- Consultar disponibilidad.
- Solicitar cambios de turno.
- Aprobar o rechazar solicitudes.
- Notificar modificaciones.
- Consultar horas trabajadas.

## Tecnologías

| Tecnología | Justificación |
|---|---|
| Node.js + Express | Servidor ligero que sirve el frontend y la API desde el mismo origen. |
| HTML + JavaScript (sin framework) | Interfaz sencilla, con la presentación y el cliente de comunicación separados. |
| PostgreSQL en Supabase | Base de datos relacional real y persistente, con capa gratuita. |
| pg | Cliente oficial de PostgreSQL para Node. |
| bcryptjs | Hash seguro de contraseñas (nunca se guardan en texto plano). |
| express-session + connect-pg-simple | Sesiones con cookie `httpOnly` guardadas en la base de datos, que sobreviven a recargas y reinicios. |
| Brevo | Envío de los correos de confirmación de cuenta (y de invitaciones/notificaciones) mediante su servicio de correo transaccional. |
| Google (OAuth 2.0) | Registro e inicio de sesión con cuenta de Google. |
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
  logica.js    → capa de lógica de negocio (reglas de usuarios, grupos, turnos, solicitudes, validación, hash)
  datos.js     → capa de acceso a datos (PostgreSQL y repositorio en memoria)
  logger.js    → registro (log) de la actividad
```

- El servidor sirve el frontend (mismo origen) y toda la lógica reside en el servidor.
- La comunicación cliente-servidor se hace exclusivamente a través de la API (`/api/...`).
- La lógica no depende de Express ni de PostgreSQL: recibe el repositorio como dependencia.
- Los permisos se comprueban en el servidor: el rol de administrador de la web y la pertenencia a cada grupo (encargado o empleado).

## Ejecutar en local

Requisitos: Node.js 20 o superior, una base de datos PostgreSQL (por ejemplo, un proyecto gratuito en Supabase) y, para probar el correo y Google, una cuenta de Brevo y un cliente OAuth de Google.

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

Ejecuta las pruebas unitarias automatizadas de la capa de lógica (registro y confirmación de cuenta, inicio de sesión, roles, eliminación de usuarios, grupos, turnos, solicitudes de cambio, horas trabajadas y casos de error).

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
| `REQUIERE_CONFIRMACION` | `true` para exigir confirmación de cuenta por correo (activado desde el Sprint 2); `false` para desarrollo sin envío de correos. |
| `BREVO_API_KEY` | Clave de la API de Brevo para enviar correos. |
| `MAIL_FROM` | Dirección remitente de los correos (verificada en Brevo). |
| `GOOGLE_CLIENT_ID` | ID de cliente de OAuth de Google. |
| `GOOGLE_CLIENT_SECRET` | Secreto del cliente de OAuth de Google. |
| `BASE_URL` | URL pública de la aplicación, usada en los enlaces de los correos y en la redirección de Google. |

## Acceso como administrador

El primer administrador se crea automáticamente al arrancar el servidor a partir de `ADMIN_EMAIL` y `ADMIN_PASSWORD`. Si ya existe, no se modifica. Así no hay credenciales en el código ni endpoints públicos de promoción.

El administrador es solo el de la web: gestiona cuentas, pero no tiene poder sobre los grupos ni los turnos de otros usuarios.

Las credenciales de prueba para la revisión se envían junto con la entrega, no se publican en este repositorio.

## Funcionalidades

### Sprint 1: usuarios y sesiones

- Registro de usuarios locales con contraseña almacenada con hash (bcrypt).
- Inicio y cierre de sesión, con la sesión mantenida entre recargas.
- Roles `usuario` y `administrador`.
- Listado de usuarios y comprobación de si un usuario está activo (solo administrador).
- Eliminación de usuarios: el administrador puede eliminar a cualquiera; un usuario normal solo su propia cuenta.
- Rutas protegidas que rechazan peticiones sin sesión válida o sin el rol necesario.
- Persistencia en PostgreSQL y registro de la actividad relevante.

### Sprint 2: cuentas, grupos, turnos y solicitudes

#### Confirmación de cuenta por correo

- Al registrar una cuenta nueva se envía un correo de confirmación mediante **Brevo**.
- No se puede iniciar sesión hasta que la cuenta esté confirmada.
- **Aviso:** el correo de confirmación puede llegar a la carpeta de **spam** o correo no deseado. Si no aparece en la bandeja de entrada, conviene revisarla.

#### Registro e inicio de sesión con Google

- Se puede registrar una cuenta e iniciar sesión con Google, sin necesidad de contraseña propia.

#### Grupos de trabajo

- Cualquier usuario puede crear un grupo y queda como su **encargado**. Hay un máximo de 5 grupos como encargado y de 50 miembros por grupo.
- Una persona puede estar en varios grupos, por ejemplo como encargada de uno y como empleada de otro.
- **Invitar:** el encargado invita por correo. La persona ve la invitación al entrar y la acepta o rechaza; al aceptar se convierte en empleado del grupo. Si el correo aún no tiene cuenta, la invitación espera hasta que se registre.
- **Privacidad:** quien no es miembro de un grupo recibe «no existe» (404), no «prohibido», para que no se pueda averiguar qué grupos hay.
- **Expulsar, salir y eliminar:** el encargado expulsa a empleados y elimina el grupo; un empleado puede salir. El encargado no puede salir ni ser expulsado.
- **Limpieza:** al expulsar a alguien o al salir, se borran sus turnos futuros en ese grupo y se conserva el historial. Al eliminar el grupo se borran todos sus turnos.

#### Gestión de turnos

- Los turnos pertenecen a un grupo. El encargado del grupo crea, edita y elimina los turnos de su grupo; el administrador de la web recibe «no existe» si lo intenta, igual que cualquier ajeno al grupo.
- Se rechazan los turnos que acaban antes de empezar, los de más de 12 horas y los que se solapan con otro del mismo empleado. Los turnos consecutivos sí son válidos.
- Los turnos solo se asignan a miembros del grupo con rol de empleado y con cuenta activa.
- **Solapes entre grupos:** una persona que trabaja en dos grupos no puede tener dos turnos a la vez, aunque sean de grupos distintos.
- La nota de un turno solo la ven el encargado y su dueño.

#### Calendario y disponibilidad

- **Calendario:** cada empleado ve sus turnos y los del equipo en solo lectura, por semanas.
- **Disponibilidad:** quién está libre en una franja, calculado a partir de los turnos existentes. Solo cuenta a los empleados del grupo, y está ocupado quien tenga un turno en cualquiera de sus grupos.

#### Solicitudes de cambio de turno

- Un empleado pide ceder su turno a un compañero o intercambiarlo por uno suyo. El encargado del grupo aprueba o rechaza; el compañero no tiene que aceptar.
- Solo se piden cambios de turnos propios y futuros. El compañero debe ser otro empleado del grupo, y cada turno admite una sola solicitud pendiente.
- Los solapes se comprueban dos veces: al pedir y al aprobar. Si entre medias alguien ha cambiado los turnos, la aprobación falla y la solicitud sigue pendiente (o queda «obsoleta»).
- **Aprobar es atómico:** en PostgreSQL se marca la solicitud y se cambian de manos los dos turnos en una transacción. Si alguno ya no está en las manos esperadas, se deshace todo.
- Cada empleado ve las solicitudes que le afectan, y el encargado ve todas las de su grupo.

#### Horas trabajadas

- Cada empleado ve las suyas por mes, sumando todos sus grupos y desglosadas por grupo. El encargado ve las de cada empleado de su grupo.
- Los meses se calculan en la hora de Madrid, con horario de verano e invierno, y un turno que cruza de mes se reparte entre los dos.

## Flujo de trabajo y CI/CD

- **GitHub Flow:** una rama por cambio, pruebas en local antes del pull request e integración en `main` mediante pull request.
- **Integración continua:** GitHub Actions (`.github/workflows/ci.yml`) ejecuta `npm ci` y `npm test` en cada pull request y en cada cambio en `main`.
- **Despliegue continuo:** Render despliega automáticamente cada cambio que llega a `main`.
- Los hitos están etiquetados en el historial (`hito-1`, `hito-2`, `hito-3`).to-1`, `hito-2`, `hito-3`).
