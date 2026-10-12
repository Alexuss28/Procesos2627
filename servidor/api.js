const express = require('express');
const session = require('express-session');
const path = require('path');
const { crearServicioUsuarios, ErrorApp } = require('./logica');
const { crearRepoMemoria } = require('./datos');

function crearApp({ servicio, store }) {
  const app = express();
  const produccion = process.env.NODE_ENV === 'production';
  if (produccion) app.set('trust proxy', 1); // Render va detrás de un proxy HTTPS

  app.use(express.json());
  app.use(session({
    store, // undefined => MemoryStore (solo desarrollo)
    secret: process.env.SESSION_SECRET || require('crypto').randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: produccion, maxAge: 1000 * 60 * 60 * 24 * 7 },
  }));
  app.use(express.static(path.join(__dirname, '..', 'cliente')));

  const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

  // Middleware de autenticación: rechaza peticiones sin sesión válida
  function requiereSesion(req, res, next) {
    if (!req.session.usuarioId) {
      return next(new ErrorApp('NO_AUTENTICADO', 'Debes iniciar sesión', 401));
    }
    next();
  }

  app.post('/api/registro', wrap(async (req, res) => {
    res.status(201).json(await servicio.registrar(req.body || {}));
  }));

  app.post('/api/login', wrap(async (req, res) => {
    const usuario = await servicio.iniciarSesion(req.body || {});
    // regenerate evita la fijación de sesión
    await new Promise((ok, ko) => req.session.regenerate((e) => (e ? ko(e) : ok())));
    req.session.usuarioId = usuario.id;
    res.json(usuario);
  }));

  app.post('/api/logout', wrap(async (req, res) => {
    await new Promise((ok) => req.session.destroy(() => ok()));
    res.clearCookie('connect.sid');
    res.status(204).end();
  }));

  // Permite al cliente recuperar la sesión tras recargar la página
  app.get('/api/sesion', requiereSesion, wrap(async (req, res) => {
    try {
      res.json(await servicio.obtenerActor(req.session.usuarioId));
    } catch (e) {
      // El usuario de la sesión ya no existe (p. ej. eliminado): se invalida
      await new Promise((ok) => req.session.destroy(() => ok()));
      throw e;
    }
  }));

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

  app.use((err, req, res, next) => {
    if (err instanceof ErrorApp) {
      return res.status(err.estado).json({ error: { codigo: err.codigo, mensaje: err.message } });
    }
    console.error(err);
    res.status(500).json({ error: { codigo: 'ERROR_INTERNO', mensaje: 'Error interno del servidor' } });
  });

  return app;
}

if (require.main === module) {
  const servicio = crearServicioUsuarios({ repo: crearRepoMemoria(), log: (n, m, d) => console.log(n, m, d || '') });
  const puerto = process.env.PORT || 3000;
  crearApp({ servicio }).listen(puerto, () => console.log(`Servidor en puerto ${puerto}`));
}

module.exports = { crearApp };