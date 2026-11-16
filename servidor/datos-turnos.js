// Capa de datos de los turnos. Misma interfaz en memoria y en PostgreSQL,
// de modo que la lógica no sabe cuál de las dos está usando.

function crearRepoTurnosMemoria() {
  const turnos = new Map();
  return {
    async crear(t) { turnos.set(t.id, { ...t }); },
    async buscarPorId(id) {
      const t = turnos.get(id);
      return t ? { ...t } : null;
    },
    async actualizar(id, cambios) {
      const t = turnos.get(id);
      if (t) Object.assign(t, cambios);
    },
    async eliminar(id) { turnos.delete(id); },

    // Turnos que se solapan con [desde, hasta): empiezan antes de "hasta" y acaban después de "desde".
    // Se puede filtrar por empleado y/o por grupo.
    async listarPorRango({ desde, hasta, empleadoId = null, grupoId = null }) {
      return [...turnos.values()]
        .filter((t) => new Date(t.inicio) < hasta
          && new Date(t.fin) > desde
          && (!empleadoId || t.empleadoId === empleadoId)
          && (!grupoId || t.grupoId === grupoId))
        .sort((a, b) => new Date(a.inicio) - new Date(b.inicio))
        .map((t) => ({ ...t }));
    },

    // Turnos de un empleado en un grupo que empiezan a partir de "desde" (al salir o ser expulsado)
    async eliminarFuturos({ grupoId, empleadoId, desde }) {
      for (const [id, t] of turnos) {
        if (t.grupoId === grupoId && t.empleadoId === empleadoId && new Date(t.inicio) >= desde) {
          turnos.delete(id);
        }
      }
    },
    // Todos los turnos de un grupo (al eliminar el grupo)
    async eliminarPorGrupo(grupoId) {
      for (const [id, t] of turnos) if (t.grupoId === grupoId) turnos.delete(id);
    },
  };
}

// Lista blanca de campos actualizables (evita construir SQL con claves arbitrarias)
const COLUMNAS_TURNO = {
  empleadoId: 'empleado_id',
  inicio: 'inicio',
  fin: 'fin',
  nota: 'nota',
};

function crearRepoTurnosPostgres(pool) {
  const mapear = (f) => f && {
    id: f.id,
    grupoId: f.grupo_id,
    empleadoId: f.empleado_id,
    inicio: f.inicio,
    fin: f.fin,
    nota: f.nota,
    creadoPor: f.creado_por,
  };

  return {
    // Requiere que las tablas "usuarios" y "grupos" ya existan
    async inicializar() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS turnos (
          id UUID PRIMARY KEY,
          empleado_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
          inicio TIMESTAMPTZ NOT NULL,
          fin TIMESTAMPTZ NOT NULL,
          nota TEXT,
          creado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
          creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
          CHECK (fin > inicio)
        )`);
      // Migración: los turnos ahora pertenecen a un grupo
      await pool.query(
        'ALTER TABLE turnos ADD COLUMN IF NOT EXISTS grupo_id UUID REFERENCES grupos(id) ON DELETE CASCADE');
      // Los turnos de la semana 1 (sin grupo) eran de prueba: no pertenecen a ningún grupo y se descartan
      await pool.query('DELETE FROM turnos WHERE grupo_id IS NULL');
      await pool.query('ALTER TABLE turnos ALTER COLUMN grupo_id SET NOT NULL');
      await pool.query(
        'CREATE INDEX IF NOT EXISTS turnos_empleado_inicio_idx ON turnos (empleado_id, inicio)');
      await pool.query(
        'CREATE INDEX IF NOT EXISTS turnos_grupo_inicio_idx ON turnos (grupo_id, inicio)');
    },

    async crear(t) {
      await pool.query(
        `INSERT INTO turnos (id, grupo_id, empleado_id, inicio, fin, nota, creado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [t.id, t.grupoId, t.empleadoId, t.inicio, t.fin, t.nota, t.creadoPor]
      );
    },
    async buscarPorId(id) {
      if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
      const r = await pool.query('SELECT * FROM turnos WHERE id = $1', [id]);
      return mapear(r.rows[0]) || null;
    },
    async actualizar(id, cambios) {
      const claves = Object.keys(cambios).filter((k) => COLUMNAS_TURNO[k]);
      if (!claves.length) return;
      const sets = claves.map((k, i) => `${COLUMNAS_TURNO[k]} = $${i + 2}`).join(', ');
      await pool.query(`UPDATE turnos SET ${sets} WHERE id = $1`, [id, ...claves.map((k) => cambios[k])]);
    },
    async eliminar(id) {
      await pool.query('DELETE FROM turnos WHERE id = $1', [id]);
    },
    async listarPorRango({ desde, hasta, empleadoId = null, grupoId = null }) {
      const params = [hasta, desde];
      let sql = 'SELECT * FROM turnos WHERE inicio < $1 AND fin > $2';
      if (empleadoId) {
        params.push(empleadoId);
        sql += ` AND empleado_id = $${params.length}`;
      }
      if (grupoId) {
        params.push(grupoId);
        sql += ` AND grupo_id = $${params.length}`;
      }
      sql += ' ORDER BY inicio';
      const r = await pool.query(sql, params);
      return r.rows.map(mapear);
    },
    async eliminarFuturos({ grupoId, empleadoId, desde }) {
      await pool.query(
        'DELETE FROM turnos WHERE grupo_id = $1 AND empleado_id = $2 AND inicio >= $3',
        [grupoId, empleadoId, desde]);
    },
    async eliminarPorGrupo(grupoId) {
      await pool.query('DELETE FROM turnos WHERE grupo_id = $1', [grupoId]);
    },
  };
}

module.exports = { crearRepoTurnosMemoria, crearRepoTurnosPostgres };