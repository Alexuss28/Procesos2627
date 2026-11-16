// Capa de datos de grupos de trabajo, miembros e invitaciones.
// Misma interfaz en memoria y en PostgreSQL: la lógica no sabe cuál usa.

function crearRepoGruposMemoria() {
  const grupos = new Map();
  const miembros = []; // { grupoId, usuarioId, rol, desde }
  const invitaciones = new Map();
  const copia = (o) => (o ? { ...o } : null);
  const esMiembro = (grupoId, usuarioId) => (m) => m.grupoId === grupoId && m.usuarioId === usuarioId;

  return {
    // El grupo y su encargado se crean juntos: o se crean los dos o ninguno
    async crearGrupoConEncargado(grupo, usuarioId) {
      grupos.set(grupo.id, { ...grupo, creadoEn: new Date() });
      miembros.push({ grupoId: grupo.id, usuarioId, rol: 'encargado', desde: new Date() });
    },
    async buscarGrupo(id) { return copia(grupos.get(id)); },
    async eliminarGrupo(id) {
      grupos.delete(id);
      for (let i = miembros.length - 1; i >= 0; i--) if (miembros[i].grupoId === id) miembros.splice(i, 1);
      for (const [clave, inv] of invitaciones) if (inv.grupoId === id) invitaciones.delete(clave);
    },

    async buscarMembresia(grupoId, usuarioId) {
      return copia(miembros.find(esMiembro(grupoId, usuarioId)));
    },
    async listarMiembros(grupoId) {
      return miembros.filter((m) => m.grupoId === grupoId).map(copia);
    },
    async eliminarMiembro(grupoId, usuarioId) {
      const i = miembros.findIndex(esMiembro(grupoId, usuarioId));
      if (i >= 0) miembros.splice(i, 1);
    },
    async listarGruposDeUsuario(usuarioId) {
      return miembros
        .filter((m) => m.usuarioId === usuarioId && grupos.has(m.grupoId))
        .map((m) => ({ ...grupos.get(m.grupoId), rol: m.rol }));
    },
    async contarGruposDeEncargado(usuarioId) {
      return miembros.filter((m) => m.usuarioId === usuarioId && m.rol === 'encargado').length;
    },

    async crearInvitacion(inv) { invitaciones.set(inv.id, { ...inv }); },
    async buscarInvitacion(id) { return copia(invitaciones.get(id)); },
    async buscarInvitacionPendiente(grupoId, email) {
      return copia([...invitaciones.values()].find(
        (i) => i.grupoId === grupoId && i.email === email && i.estado === 'pendiente'));
    },
    async listarInvitacionesPendientesDeGrupo(grupoId) {
      return [...invitaciones.values()]
        .filter((i) => i.grupoId === grupoId && i.estado === 'pendiente').map(copia);
    },
    async listarInvitacionesPendientesPorEmail(email) {
      return [...invitaciones.values()]
        .filter((i) => i.email === email && i.estado === 'pendiente').map(copia);
    },
    async actualizarInvitacion(id, estado) {
      const inv = invitaciones.get(id);
      if (inv) inv.estado = estado;
    },
    // Marca la invitación como aceptada y añade al miembro, juntas. Devuelve false si ya no estaba pendiente.
    async aceptarInvitacion(invitacion, usuarioId) {
      const inv = invitaciones.get(invitacion.id);
      if (!inv || inv.estado !== 'pendiente') return false;
      inv.estado = 'aceptada';
      miembros.push({ grupoId: invitacion.grupoId, usuarioId, rol: 'empleado', desde: new Date() });
      return true;
    },
  };
}

function crearRepoGruposPostgres(pool) {
  const mapGrupo = (f) => f && { id: f.id, nombre: f.nombre, creadoPor: f.creado_por, creadoEn: f.creado_en };
  const mapMiembro = (f) => f && { grupoId: f.grupo_id, usuarioId: f.usuario_id, rol: f.rol, desde: f.desde };
  const mapInvitacion = (f) => f && {
    id: f.id, grupoId: f.grupo_id, email: f.email,
    invitadoPor: f.invitado_por, estado: f.estado, creadaEn: f.creada_en,
  };
  const uuidValido = (id) => /^[0-9a-f-]{36}$/i.test(String(id));

  // Varias sentencias que deben cumplirse todas o ninguna
  async function enTransaccion(fn) {
    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      const resultado = await fn(cliente);
      await cliente.query('COMMIT');
      return resultado;
    } catch (e) {
      await cliente.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      cliente.release();
    }
  }

  return {
    // Requiere que la tabla "usuarios" ya exista
    async inicializar() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS grupos (
          id UUID PRIMARY KEY,
          nombre TEXT NOT NULL,
          creado_por UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
          creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS miembros_grupo (
          grupo_id UUID NOT NULL REFERENCES grupos(id) ON DELETE CASCADE,
          usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
          rol TEXT NOT NULL CHECK (rol IN ('encargado', 'empleado')),
          desde TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (grupo_id, usuario_id)
        )`);
      await pool.query('CREATE INDEX IF NOT EXISTS miembros_usuario_idx ON miembros_grupo (usuario_id)');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS invitaciones (
          id UUID PRIMARY KEY,
          grupo_id UUID NOT NULL REFERENCES grupos(id) ON DELETE CASCADE,
          email TEXT NOT NULL,
          invitado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
          estado TEXT NOT NULL DEFAULT 'pendiente',
          creada_en TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
      // Solo puede haber una invitación pendiente por grupo y correo
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS invitaciones_pendiente_idx
                        ON invitaciones (grupo_id, email) WHERE estado = 'pendiente'`);
      await pool.query('CREATE INDEX IF NOT EXISTS invitaciones_email_idx ON invitaciones (email)');
    },

    async crearGrupoConEncargado(grupo, usuarioId) {
      await enTransaccion(async (c) => {
        await c.query('INSERT INTO grupos (id, nombre, creado_por) VALUES ($1, $2, $3)',
          [grupo.id, grupo.nombre, grupo.creadoPor]);
        await c.query("INSERT INTO miembros_grupo (grupo_id, usuario_id, rol) VALUES ($1, $2, 'encargado')",
          [grupo.id, usuarioId]);
      });
    },
    async buscarGrupo(id) {
      if (!uuidValido(id)) return null;
      const r = await pool.query('SELECT * FROM grupos WHERE id = $1', [id]);
      return mapGrupo(r.rows[0]) || null;
    },
    async eliminarGrupo(id) {
      await pool.query('DELETE FROM grupos WHERE id = $1', [id]); // miembros e invitaciones caen en cascada
    },

    async buscarMembresia(grupoId, usuarioId) {
      if (!uuidValido(grupoId) || !uuidValido(usuarioId)) return null;
      const r = await pool.query(
        'SELECT * FROM miembros_grupo WHERE grupo_id = $1 AND usuario_id = $2', [grupoId, usuarioId]);
      return mapMiembro(r.rows[0]) || null;
    },
    async listarMiembros(grupoId) {
      const r = await pool.query('SELECT * FROM miembros_grupo WHERE grupo_id = $1 ORDER BY desde', [grupoId]);
      return r.rows.map(mapMiembro);
    },
    async eliminarMiembro(grupoId, usuarioId) {
      await pool.query('DELETE FROM miembros_grupo WHERE grupo_id = $1 AND usuario_id = $2', [grupoId, usuarioId]);
    },
    async listarGruposDeUsuario(usuarioId) {
      const r = await pool.query(
        `SELECT g.*, m.rol FROM grupos g
           JOIN miembros_grupo m ON m.grupo_id = g.id
          WHERE m.usuario_id = $1 ORDER BY g.creado_en`, [usuarioId]);
      return r.rows.map((f) => ({ ...mapGrupo(f), rol: f.rol }));
    },
    async contarGruposDeEncargado(usuarioId) {
      const r = await pool.query(
        "SELECT count(*)::int AS n FROM miembros_grupo WHERE usuario_id = $1 AND rol = 'encargado'", [usuarioId]);
      return r.rows[0].n;
    },

    async crearInvitacion(inv) {
      await pool.query(
        'INSERT INTO invitaciones (id, grupo_id, email, invitado_por, estado) VALUES ($1, $2, $3, $4, $5)',
        [inv.id, inv.grupoId, inv.email, inv.invitadoPor, inv.estado]);
    },
    async buscarInvitacion(id) {
      if (!uuidValido(id)) return null;
      const r = await pool.query('SELECT * FROM invitaciones WHERE id = $1', [id]);
      return mapInvitacion(r.rows[0]) || null;
    },
    async buscarInvitacionPendiente(grupoId, email) {
      const r = await pool.query(
        "SELECT * FROM invitaciones WHERE grupo_id = $1 AND email = $2 AND estado = 'pendiente'", [grupoId, email]);
      return mapInvitacion(r.rows[0]) || null;
    },
    async listarInvitacionesPendientesDeGrupo(grupoId) {
      const r = await pool.query(
        "SELECT * FROM invitaciones WHERE grupo_id = $1 AND estado = 'pendiente' ORDER BY creada_en", [grupoId]);
      return r.rows.map(mapInvitacion);
    },
    async listarInvitacionesPendientesPorEmail(email) {
      const r = await pool.query(
        "SELECT * FROM invitaciones WHERE email = $1 AND estado = 'pendiente' ORDER BY creada_en", [email]);
      return r.rows.map(mapInvitacion);
    },
    async actualizarInvitacion(id, estado) {
      await pool.query('UPDATE invitaciones SET estado = $2 WHERE id = $1', [id, estado]);
    },
    async aceptarInvitacion(invitacion, usuarioId) {
      return enTransaccion(async (c) => {
        const r = await c.query(
          "UPDATE invitaciones SET estado = 'aceptada' WHERE id = $1 AND estado = 'pendiente'", [invitacion.id]);
        if (r.rowCount !== 1) return false;
        await c.query(
          `INSERT INTO miembros_grupo (grupo_id, usuario_id, rol) VALUES ($1, $2, 'empleado')
           ON CONFLICT DO NOTHING`, [invitacion.grupoId, usuarioId]);
        return true;
      });
    },
  };
}

module.exports = { crearRepoGruposMemoria, crearRepoGruposPostgres };