const express = require('express');
const path = require('path');
const { crearServicioUsuarios, ErrorApp } = require('./logica');
const { crearRepoMemoria } = require('./datos');

function crearApp({ servicio }) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'cliente')));

  const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
  // TEMPORAL (hito 1): el actor llega por cabecera. En el hito 2 pasa a ser la sesión.
  const actor = (req) => req.get('x-usuario-id');

  app.post('/api/registro', wrap(async (req, res) => {
    res.status(201).json(await servicio.registrar(req.body || {}));
  }));

  app.get('/api/usuarios', wrap(async (req, res) => {
    res.json(await servicio.listar(actor(req)));
  }));

  app.get('/api/usuarios/:id/activo', wrap(async (req, res) => {
    res.json({ activo: await servicio.estaActivo(actor(req), req.params.id) });
  }));

  app.delete('/api/usuarios/:id', wrap(async (req, res) => {
    await servicio.eliminar(actor(req), req.params.id);
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
