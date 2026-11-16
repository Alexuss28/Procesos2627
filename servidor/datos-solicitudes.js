// Capa de datos de las solicitudes de cambio de turno.
// Misma interfaz en memoria y en PostgreSQL: la lógica no sabe cuál usa.
//
// aplicarAprobacion() es la operación delicada: marca la solicitud como aprobada Y cambia de manos
// los turnos implicados. En PostgreSQL se hace en UNA transacción: o se cumple todo, o nada.

function crearRepoSolicitudesMemoria({ repoTurnos }) {
  const solicitudes = new Map();
  const copia = (o) => (o ? { ...o } : null);
  const masRecientesPrimero = (a, b) => new Date(b.creadaEn) - new Date(a.creadaEn);
  const filtrarEstado = (estado) => (s) => !estado || s.estado === estado;

  return {
    async crear(s) { solicitudes.set(s.id, { ...s }); },
    async buscarPorId(id) { return copia(solicitudes.get(id)); },
    // Una solicitud pendiente por turno de origen
    async buscarPendientePorTurno(turnoId) {
      return copia([...solicitudes.values()].find(
        (s) => s.turnoOrigenId === turnoId && s.estado === 'pendiente'));
    },
    async listarPorGrupo(grupoId, { estado } = {}) {
      return [...solicitudes.values()]
        .filter((s) => s.grupoId === grupoId).filter(filtrarEstado(estado))
        .sort(masRecientesPrimero).map(copia);
    },
    // Las que ha pedido o en las que está implicado un empleado
    async listarPorGrupoYParticipante(grupoId, usuarioId, { estado } = {}) {
      return [...solicitudes.values()]
        .filter((s) => s.grupoId === grupoId
          && (s.solicitanteId === usuarioId || s.companeroId === usuarioId))
        .filter(filtrarEstado(estado)).sort(masRecientesPrimero).map(copia);
    },
    // Cierra una solicitud pendiente (rechazada o cancelada). Devuelve false si ya no estaba pendiente.
    async resolver(id, { estado, resueltaPor, comentario }) {
      const s = solicitudes.get(id);
      if (!s || s.estado !== 'pendiente') return false;
      Object.assign(s, { estado, resueltaPor, comentario, resueltaEn: new Date() });
      return true;
    },
    // cambios: [{ turnoId, deEmpleadoId, aEmpleadoId }]. Devuelve false si algo ya no cuadra.
    async aplicarAprobacion({ solicitudId, resueltaPor, comentario, cambios }) {
      const s = solicitudes.get(solicitudId);
      if (!s || s.estado !== 'pendiente') return false;
      for (const c of cambios) { // primero se comprueba todo...
        const t = await repoTurnos.buscarPorId(c.turnoId);
        if (!t || t.empleadoId !== c.deEmpleadoId) return false;
      }
      for (const c of cambios) await repoTurnos.actualizar(c.turnoId, { empleadoId: c.aEmpleadoId }); // ...y luego se aplica
      Object.assign(s, { estado: 'aprobada', resueltaPor, comentario, resueltaEn: new Date() });
      return true;
    },
  };
}

function crearRepoSolicitudesPostgres(pool) {
  const mapear = (f) => f && {
    id: f.id, grupoId: f.grupo_id, tipo: f.tipo,
    solicitanteId: f.solicitante_id, turnoOrigenId: f.turno_origen_id,
    companeroId: f.companero_id, turnoDestinoId: f.turno_destino_id,
    motivo: f.motivo, estado: f.estado,
    resueltaPor: f.resuelta_por, resueltaEn: f.resuelta_en,
    comentario: f.comentario, creadaEn: f.creada_en,
  };
  const uuidValido = (id) => /^[0-9a-f-]{36}$/i.test(String(id));
  const OBSOLETO = new Error('Los turnos han cambiado'); // señal interna para deshacer la transacción

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
    // Requiere que las tablas "usuarios", "grupos" y "turnos" ya existan
    async inicializar() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS solicitudes_cambio (
          id UUID PRIMARY KEY,
          grupo_id UUID NOT NULL REFERENCES grupos(id) ON DELETE CASCADE,
          tipo TEXT NOT NULL CHECK (tipo IN ('cesion', 'intercambio')),
          solicitante_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
          turno_origen_id UUID NOT NULL REFERENCES turnos(id) ON DELETE CASCADE,
          companero_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
          turno_destino_id UUID REFERENCES turnos(id) ON DELETE CASCADE,
          motivo TEXT,
          estado TEXT NOT NULL DEFAULT 'pendiente'
            CHECK (estado IN ('pendiente', 'aprobada', 'rechazada', 'cancelada')),
          resuelta_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
          resuelta_en TIMESTAMPTZ,
          comentario TEXT,
          creada_en TIMESTAMPTZ NOT NULL DEFAULT now(),
          CHECK ((tipo = 'intercambio') = (turno_destino_id IS NOT NULL))
        )`);
      // Una sola solicitud pendiente por turno de origen
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS solicitudes_pendiente_turno_idx
                        ON solicitudes_cambio (turno_origen_id) WHERE estado = 'pendiente'`);
      await pool.query(
        'CREATE INDEX IF NOT EXISTS solicitudes_grupo_idx ON solicitudes_cambio (grupo_id, creada_en DESC)');
    },

    async crear(s) {
      await pool.query(
        `INSERT INTO solicitudes_cambio
           (id, grupo_id, tipo, solicitante_id, turno_origen_id, companero_id, turno_destino_id, motivo, estado)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [s.id, s.grupoId, s.tipo, s.solicitanteId, s.turnoOrigenId, s.companeroId,
         s.turnoDestinoId, s.motivo, s.estado]);
    },
    async buscarPorId(id) {
      if (!uuidValido(id)) return null;
      const r = await pool.query('SELECT * FROM solicitudes_cambio WHERE id = $1', [id]);
      return mapear(r.rows[0]) || null;
    },
    async buscarPendientePorTurno(turnoId) {
      const r = await pool.query(
        "SELECT * FROM solicitudes_cambio WHERE turno_origen_id = $1 AND estado = 'pendiente'", [turnoId]);
      return mapear(r.rows[0]) || null;
    },
    async listarPorGrupo(grupoId, { estado } = {}) {
      const r = await pool.query(
        `SELECT * FROM solicitudes_cambio WHERE grupo_id = $1 AND ($2::text IS NULL OR estado = $2)
          ORDER BY creada_en DESC`, [grupoId, estado || null]);
      return r.rows.map(mapear);
    },
    async listarPorGrupoYParticipante(grupoId, usuarioId, { estado } = {}) {
      const r = await pool.query(
        `SELECT * FROM solicitudes_cambio
          WHERE grupo_id = $1 AND (solicitante_id = $2 OR companero_id = $2)
            AND ($3::text IS NULL OR estado = $3)
          ORDER BY creada_en DESC`, [grupoId, usuarioId, estado || null]);
      return r.rows.map(mapear);
    },
    async resolver(id, { estado, resueltaPor, comentario }) {
      const r = await pool.query(
        `UPDATE solicitudes_cambio
            SET estado = $2, resuelta_por = $3, comentario = $4, resuelta_en = now()
          WHERE id = $1 AND estado = 'pendiente'`, [id, estado, resueltaPor, comentario]);
      return r.rowCount === 1;
    },

    // Aprobar y cambiar los turnos de manos en una sola transacción.
    // Cada UPDATE exige que el turno siga en manos de quien se esperaba: si alguien lo ha tocado
    // entre medias, se deshace todo y se devuelve false.
    async aplicarAprobacion({ solicitudId, resueltaPor, comentario, cambios }) {
      try {
        return await enTransaccion(async (c) => {
          const r = await c.query(
            `UPDATE solicitudes_cambio
                SET estado = 'aprobada', resuelta_por = $2, comentario = $3, resuelta_en = now()
              WHERE id = $1 AND estado = 'pendiente'`, [solicitudId, resueltaPor, comentario]);
          if (r.rowCount !== 1) return false; // ya estaba resuelta
          for (const cambio of cambios) {
            const t = await c.query(
              'UPDATE turnos SET empleado_id = $2 WHERE id = $1 AND empleado_id = $3',
              [cambio.turnoId, cambio.aEmpleadoId, cambio.deEmpleadoId]);
            if (t.rowCount !== 1) throw OBSOLETO;
          }
          return true;
        });
      } catch (e) {
        if (e === OBSOLETO) return false; // la transacción ya se ha deshecho
        throw e;
      }
    },
  };
}

module.exports = { crearRepoSolicitudesMemoria, crearRepoSolicitudesPostgres };