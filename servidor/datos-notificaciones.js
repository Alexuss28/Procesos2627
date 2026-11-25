// Capa de datos de las notificaciones internas. Misma interfaz en memoria y en PostgreSQL.

function crearRepoNotificacionesMemoria() {
  const notificaciones = new Map();
  let secuencia = 0; // desempata notificaciones creadas en el mismo instante
  const copia = (n) => ({ id: n.id, usuarioId: n.usuarioId, grupoId: n.grupoId, tipo: n.tipo,
    mensaje: n.mensaje, leida: n.leida, creadaEn: n.creadaEn });
  const deUsuario = (usuarioId) => [...notificaciones.values()].filter((n) => n.usuarioId === usuarioId);

  return {
    async crear(n) { notificaciones.set(n.id, { ...n, secuencia: secuencia++ }); },
    async listar(usuarioId, { limite = 30 } = {}) {
      return deUsuario(usuarioId)
        .sort((a, b) => new Date(b.creadaEn) - new Date(a.creadaEn) || b.secuencia - a.secuencia)
        .slice(0, limite).map(copia);
    },
    async contarNoLeidas(usuarioId) { return deUsuario(usuarioId).filter((n) => !n.leida).length; },
    // Solo el dueño puede marcarla. Devuelve false si no existe o no es suya.
    async marcarLeida(id, usuarioId) {
      const n = notificaciones.get(id);
      if (!n || n.usuarioId !== usuarioId) return false;
      n.leida = true;
      return true;
    },
    async marcarTodasLeidas(usuarioId) { for (const n of deUsuario(usuarioId)) n.leida = true; },
  };
}

function crearRepoNotificacionesPostgres(pool) {
  const mapear = (f) => f && {
    id: f.id, usuarioId: f.usuario_id, grupoId: f.grupo_id, tipo: f.tipo,
    mensaje: f.mensaje, leida: f.leida, creadaEn: f.creada_en,
  };
  const uuidValido = (id) => /^[0-9a-f-]{36}$/i.test(String(id));

  return {
    // Requiere que la tabla "usuarios" ya exista
    async inicializar() {
      // grupo_id es solo informativo (sin clave foránea): el aviso "te han expulsado" debe sobrevivir al grupo
      await pool.query(`
        CREATE TABLE IF NOT EXISTS notificaciones (
          id UUID PRIMARY KEY,
          usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
          grupo_id UUID,
          tipo TEXT NOT NULL,
          mensaje TEXT NOT NULL,
          leida BOOLEAN NOT NULL DEFAULT false,
          creada_en TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
      await pool.query(
        'CREATE INDEX IF NOT EXISTS notificaciones_usuario_idx ON notificaciones (usuario_id, creada_en DESC)');
      // Los avisos de hace más de dos meses ya no interesan
      await pool.query("DELETE FROM notificaciones WHERE creada_en < now() - interval '60 days'");
    },
    async crear(n) {
      await pool.query(
        'INSERT INTO notificaciones (id, usuario_id, grupo_id, tipo, mensaje, leida) VALUES ($1, $2, $3, $4, $5, $6)',
        [n.id, n.usuarioId, n.grupoId, n.tipo, n.mensaje, n.leida]);
    },
    async listar(usuarioId, { limite = 30 } = {}) {
      const r = await pool.query(
        'SELECT * FROM notificaciones WHERE usuario_id = $1 ORDER BY creada_en DESC LIMIT $2', [usuarioId, limite]);
      return r.rows.map(mapear);
    },
    async contarNoLeidas(usuarioId) {
      const r = await pool.query(
        'SELECT count(*)::int AS n FROM notificaciones WHERE usuario_id = $1 AND NOT leida', [usuarioId]);
      return r.rows[0].n;
    },
    async marcarLeida(id, usuarioId) {
      if (!uuidValido(id)) return false;
      const r = await pool.query(
        'UPDATE notificaciones SET leida = true WHERE id = $1 AND usuario_id = $2', [id, usuarioId]);
      return r.rowCount === 1;
    },
    async marcarTodasLeidas(usuarioId) {
      await pool.query('UPDATE notificaciones SET leida = true WHERE usuario_id = $1 AND NOT leida', [usuarioId]);
    },
  };
}

module.exports = { crearRepoNotificacionesMemoria, crearRepoNotificacionesPostgres };