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
    // Turnos que se solapan con [desde, hasta): empiezan antes de "hasta" y acaban después de "desde"
    async listarPorRango({ desde, hasta, empleadoId = null }) {
      return [...turnos.values()]
        .filter((t) => new Date(t.inicio) < hasta
          && new Date(t.fin) > desde
          && (!empleadoId || t.empleadoId === empleadoId))
        .sort((a, b) => new Date(a.inicio) - new Date(b.inicio))
        .map((t) => ({ ...t }));
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
    empleadoId: f.empleado_id,
    inicio: f.inicio,
    fin: f.fin,
    nota: f.nota,
    creadoPor: f.creado_por,
  };

  return {
    // Requiere que la tabla "usuarios" ya exista
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
      await pool.query(
        'CREATE INDEX IF NOT EXISTS turnos_empleado_inicio_idx ON turnos (empleado_id, inicio)');
    },

    async crear(t) {
      await pool.query(
        `INSERT INTO turnos (id, empleado_id, inicio, fin, nota, creado_por)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [t.id, t.empleadoId, t.inicio, t.fin, t.nota, t.creadoPor]
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
    async listarPorRango({ desde, hasta, empleadoId = null }) {
      const params = [hasta, desde];
      let sql = 'SELECT * FROM turnos WHERE inicio < $1 AND fin > $2';
      if (empleadoId) {
        params.push(empleadoId);
        sql += ' AND empleado_id = $3';
      }
      sql += ' ORDER BY inicio';
      const r = await pool.query(sql, params);
      return r.rows.map(mapear);
    },
  };
}

module.exports = { crearRepoTurnosMemoria, crearRepoTurnosPostgres };