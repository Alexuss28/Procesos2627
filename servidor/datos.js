// Todos los métodos son async para poder sustituirlos por una BD sin tocar la lógica.
function crearRepoMemoria() {
  const usuarios = new Map();
  return {
    async crear(u) { usuarios.set(u.id, { ...u }); },
    async buscarPorId(id) { return usuarios.get(id) || null; },
    async buscarPorEmail(email) {
      return [...usuarios.values()].find((u) => u.email === email) || null;
    },
    async listar() { return [...usuarios.values()]; },
    async eliminar(id) { usuarios.delete(id); },
  };
}

const { Pool } = require('pg');

function crearRepoPostgres(connectionString) {
    const pool = new Pool({
    connectionString,
    ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: false },
  });

  const mapear = (f) => f && {
    id: f.id,
    email: f.email,
    passwordHash: f.password_hash,
    rol: f.rol,
    estado: f.estado,
    tokenConfirmacion: f.token_confirmacion,
  };

  return {
    pool, // lo reutiliza el almacén de sesiones

    async inicializar() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS usuarios (
          id UUID PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT,
          rol TEXT NOT NULL DEFAULT 'usuario',
          estado TEXT NOT NULL DEFAULT 'activo',
          token_confirmacion TEXT,
          creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
    },

    async crear(u) {
      await pool.query(
        `INSERT INTO usuarios (id, email, password_hash, rol, estado, token_confirmacion)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [u.id, u.email, u.passwordHash, u.rol, u.estado, u.tokenConfirmacion]
      );
    },
    async buscarPorId(id) {
      // Un id con formato no válido no puede existir: evita un error de Postgres
      if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
      const r = await pool.query('SELECT * FROM usuarios WHERE id = $1', [id]);
      return mapear(r.rows[0]) || null;
    },
    async buscarPorEmail(email) {
      const r = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
      return mapear(r.rows[0]) || null;
    },
    async listar() {
      const r = await pool.query('SELECT * FROM usuarios ORDER BY creado_en');
      return r.rows.map(mapear);
    },
    async eliminar(id) {
      await pool.query('DELETE FROM usuarios WHERE id = $1', [id]);
    },
  };
}

module.exports = { crearRepoMemoria, crearRepoPostgres };