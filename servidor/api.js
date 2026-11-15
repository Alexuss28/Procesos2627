require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');
const { crearServicioUsuarios, ErrorApp, calcularEstadoUsuario } = require('./logica');
const { crearRepoMemoria, crearRepoPostgres } = require('./datos');
const { crearRepoTurnosMemoria, crearRepoTurnosPostgres } = require('./datos-turnos');
const { crearServicioTurnos } = require('./logica-turnos');
const { crearCorreoBrevo } = require('./correo');
const { crearGoogle } = require('./google');
const { log } = require('./logger');

function crearApp({ servicio, turnos, store, google = null }) {
  const app = express();
  const produccion = process.env.NODE_ENV === 'production';
  if (produccion) app.set('trust proxy', 1); // Render va detrás de un proxy HTTPS

  app.use(express.json());

  // Log de cada petición
  app.use((req, res, next) => {
    res.on('finish', () => log('info', 'petición', {
      metodo: req.method,
      ruta: req.path, // sin query string: el token y el código OAuth no deben quedar en los logs
      estado: res.statusCode,
    }));
    next();
  });

  app.use(session({
    store, // undefined => MemoryStore (solo desarrollo)
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: produccion, maxAge: 1000 * 60 * 60 * 24 * 7 },
  }));
  app.use(express.static(path.join(__dirname, '..', 'cliente')));

  const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
  const guardarSesion = (req) => new Promise((ok, ko) => req.session.save((e) => (e ? ko(e) : ok())));
  const regenerarSesion = (req) => new Promise((ok, ko) => req.session.regenerate((e) => (e ? ko(e) : ok())));

  function requiereSesion(req, res, next) {
    if (!req.session.usuarioId) {
      return next(new ErrorApp('NO_AUTENTICADO', 'Debes iniciar sesión', 401));
    }
    next();
  }

  // ---------------------------------------------------------------- Cuentas y acceso
  app.post('/api/registro', wrap(async (req, res) => {
    res.status(201).json(await servicio.registrar(req.body || {}));
  }));

  // Endpoint público (sin sesión): solo lee la petición, llama a la lógica y responde
  app.post('/api/prueba/estado', (req, res) => {
    try {
      res.status(200).json(calcularEstadoUsuario(req.body || {}));
    } catch (e) {
      if (e instanceof ErrorApp) return res.status(400).json({ error: e.message });
      throw e;
    }
  });

  // Confirmación de cuenta: POST (y no GET) para que un escáner de correo
  // que abra el enlace no active la cuenta por sí solo
  app.post('/api/confirmar', wrap(async (req, res) => {
    const usuario = await servicio.confirmarCuenta((req.body || {}).token);
    res.json({ email: usuario.email, estado: usuario.estado });
  }));

  app.post('/api/reenviar-confirmacion', wrap(async (req, res) => {
    await servicio.reenviarConfirmacion((req.body || {}).email);
    res.status(204).end();
  }));

  app.post('/api/login', wrap(async (req, res) => {
    const usuario = await servicio.iniciarSesion(req.body || {});
    await regenerarSesion(req);
    req.session.usuarioId = usuario.id;
    res.json(usuario);
  }));

  // Acceso con Google (son navegaciones del navegador, por eso redirigen en lugar de devolver JSON)
  app.get('/api/auth/google', async (req, res) => {
    if (!google) return res.redirect('/?error=oauth_no_configurado');
    try {
      const state = crypto.randomBytes(24).toString('hex');
      const nonce = crypto.randomBytes(24).toString('hex');
      const { url, codeVerifier } = await google.iniciar({ state, nonce });
      req.session.oauth = { state, nonce, codeVerifier };
      await guardarSesion(req); // la sesión debe estar guardada antes de salir hacia Google
      res.redirect(url);
    } catch (e) {
      log('error', 'no se pudo iniciar el acceso con Google', { motivo: e.message });
      res.redirect('/?error=oauth_error');
    }
  });

  app.get('/api/auth/google/callback', async (req, res) => {
    const fallo = (codigo) => res.redirect(`/?error=${codigo}`);
    try {
      const guardado = req.session.oauth;
      delete req.session.oauth; // uso único
      if (req.query.error) return fallo('oauth_cancelado');
      if (!google || !guardado
          || typeof req.query.state !== 'string' || req.query.state !== guardado.state
          || typeof req.query.code !== 'string') {
        log('warn', 'callback de Google con estado inválido');
        return fallo('oauth_invalido');
      }
      const identidad = await google.identificar({
        code: req.query.code,
        codeVerifier: guardado.codeVerifier,
        nonce: guardado.nonce,
      });
      const usuario = await servicio.iniciarSesionConProveedor({
        proveedor: 'google',
        proveedorId: identidad.id,
        email: identidad.email,
        emailVerificado: identidad.emailVerificado,
      });
      await regenerarSesion(req);
      req.session.usuarioId = usuario.id;
      res.redirect('/');
    } catch (e) {
      if (e instanceof ErrorApp) return fallo(e.codigo.toLowerCase());
      log('error', 'fallo en el acceso con Google', { motivo: e.message });
      fallo('oauth_error');
    }
  });

  app.post('/api/logout', wrap(async (req, res) => {
    await new Promise((ok) => req.session.destroy(() => ok()));
    res.clearCookie('connect.sid');
    res.status(204).end();
  }));

  app.get('/api/sesion', requiereSesion, wrap(async (req, res) => {
    try {
      res.json(await servicio.obtenerActor(req.session.usuarioId));
    } catch (e) {
      await new Promise((ok) => req.session.destroy(() => ok()));
      throw e;
    }
  }));

  // ---------------------------------------------------------------- Usuarios
  app.get('/api/usuarios', requiereSesion, wrap(async (req, res) => {
    res.json(await servicio.listar(req.session.usuarioId));
  }));

  app.get('/api/usuarios/:id/activo', requiereSesion, wrap(async (req, res) => {
    res.json({ activo: await servicio.estaActivo(req.session.usuarioId, req.params.id) });
  }));

  app.delete('/api/usuarios/:id', requiereSesion, wrap(async (req, res) => {
    await servicio.eliminar(req.session.usuarioId, req.params.id);
    if (req.params.id === req.session.usuarioId) {
      await new Promise((ok) => req.session.destroy(() => ok()));
      res.clearCookie('connect.sid');
    }
    res.status(204).end();
  }));

  // ---------------------------------------------------------------- Turnos
  // Las rutas solo leen la petición, llaman a la lógica y devuelven la respuesta.
  app.get('/api/turnos/mios', requiereSesion, wrap(async (req, res) => {
    res.json(await turnos.listarMios(req.session.usuarioId, {
      desde: req.query.desde, hasta: req.query.hasta,
    }));
  }));

  app.get('/api/turnos/equipo', requiereSesion, wrap(async (req, res) => {
    res.json(await turnos.listarEquipo(req.session.usuarioId, {
      desde: req.query.desde, hasta: req.query.hasta,
    }));
  }));

  app.get('/api/disponibilidad', requiereSesion, wrap(async (req, res) => {
    res.json(await turnos.disponibilidad(req.session.usuarioId, {
      inicio: req.query.inicio, fin: req.query.fin,
    }));
  }));

  app.post('/api/turnos', requiereSesion, wrap(async (req, res) => {
    res.status(201).json(await turnos.crearTurno(req.session.usuarioId, req.body || {}));
  }));

  app.put('/api/turnos/:id', requiereSesion, wrap(async (req, res) => {
    res.json(await turnos.editarTurno(req.session.usuarioId, req.params.id, req.body || {}));
  }));

  app.delete('/api/turnos/:id', requiereSesion, wrap(async (req, res) => {
    await turnos.eliminarTurno(req.session.usuarioId, req.params.id);
    res.status(204).end();
  }));

  // ---------------------------------------------------------------- Errores
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'El cuerpo no es un JSON válido' });
    }
    if (err instanceof ErrorApp) {
      return res.status(err.estado).json({ error: { codigo: err.codigo, mensaje: err.message } });
    }
    log('error', 'error interno', { mensaje: err.message });
    res.status(500).json({ error: { codigo: 'ERROR_INTERNO', mensaje: 'Error interno del servidor' } });
  });

  return app;
}

async function arrancar() {
  let repo, repoTurnos, store;

  if (process.env.DATABASE_URL) {
    repo = crearRepoPostgres(process.env.DATABASE_URL);
    await repo.inicializar();                    // primero usuarios: turnos depende de esa tabla
    repoTurnos = crearRepoTurnosPostgres(repo.pool);
    await repoTurnos.inicializar();
    const PgSession = require('connect-pg-simple')(session);
    store = new PgSession({ pool: repo.pool, createTableIfMissing: true });
  } else {
    log('warn', 'DATABASE_URL no definida: usando datos en memoria (solo desarrollo)');
    repo = crearRepoMemoria();
    repoTurnos = crearRepoTurnosMemoria();
  }

  const requiereConfirmacion = process.env.REQUIERE_CONFIRMACION === 'true';
  const urlBase = (process.env.APP_URL || '').replace(/\/+$/, '');

  let correo = null;
  if (process.env.BREVO_API_KEY && process.env.MAIL_FROM) {
    correo = crearCorreoBrevo({
      apiKey: process.env.BREVO_API_KEY,
      remitente: process.env.MAIL_FROM,
      nombreRemitente: process.env.MAIL_FROM_NAME || 'Mi aplicación',
    });
  }
  // Falla al arrancar, no en el primer registro, si la configuración está incompleta
  if (requiereConfirmacion && (!correo || !urlBase)) {
    throw new Error('REQUIERE_CONFIRMACION=true exige BREVO_API_KEY, MAIL_FROM y APP_URL');
  }

  let google = null;
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && urlBase) {
    google = crearGoogle({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      urlBase,
    });
  } else {
    log('warn', 'Google OAuth no configurado (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y APP_URL): el botón no funcionará');
  }

  const servicio = crearServicioUsuarios({ repo, correo, urlBase, log, requiereConfirmacion });
  const turnos = crearServicioTurnos({ repo: repoTurnos, repoUsuarios: repo, log });

  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    await servicio.asegurarAdministrador(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  } else {
    log('warn', 'ADMIN_EMAIL/ADMIN_PASSWORD no definidas: no se crea administrador');
  }

  const puerto = process.env.PORT || 3000;
  crearApp({ servicio, turnos, store, google }).listen(puerto, () => log('info', 'servidor arrancado', { puerto }));
}

if (require.main === module) {
  arrancar().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { crearApp };