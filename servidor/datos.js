// Todos los métodos son async para poder sustituirlos por una BD sin tocar la lógica.
function crearRepoMemoria() {
  const usuarios = new Map();
  return {
    async crear(u) { usuarios.set(u.id, { ...u }); },
    async buscarPorId(id) { return usuarios.get(id) || null; },
    async buscarPorEmail(email) {
      return [...usuarios.values()].find((u) => u.email === email) || null;
    },
    async buscarPorToken(hash) {
      return [...usuarios.values()].find((u) => u.tokenConfirmacion === hash) || null;
    },
    async buscarPorProveedor(proveedor, proveedorId) {
      return [...usuarios.values()].find(
        (u) => u.proveedor === proveedor && u.proveedorId === proveedorId
      ) || null;
    },
    async actualizar(id, cambios) {
      const u = usuarios.get(id);
      if (u) Object.assign(u, cambios);
    },
    async listar() { return [...usuarios.values()]; },
    async eliminar(id) { usuarios.delete(id); },
  };
}

const { Pool } = require('pg');

// Lista blanca de campos actualizables (evita construir SQL con claves arbitrarias)
const COLUMNAS = {
  estado: 'estado',
  tokenConfirmacion: 'token_confirmacion',
  tokenExpira: 'token_expira',
};

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
    tokenExpira: f.token_expira,
    proveedor: f.proveedor,
    proveedorId: f.proveedor_id,
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
      // Migraciones incrementales (hito 4)
      await pool.query('ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS token_expira TIMESTAMPTZ');
      await pool.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS proveedor TEXT NOT NULL DEFAULT 'local'");
      await pool.query('ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS proveedor_id TEXT');
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS usuarios_proveedor_idx
                        ON usuarios (proveedor, proveedor_id) WHERE proveedor_id IS NOT NULL`);
    },

    async crear(u) {
      await pool.query(
        `INSERT INTO usuarios
           (id, email, password_hash, rol, estado, token_confirmacion, token_expira, proveedor, proveedor_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [u.id, u.email, u.passwordHash, u.rol, u.estado, u.tokenConfirmacion, u.tokenExpira,
         u.proveedor || 'local', u.proveedorId || null]
      );
    },
    async buscarPorId(id) {
      if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
      const r = await pool.query('SELECT * FROM usuarios WHERE id = $1', [id]);
      return mapear(r.rows[0]) || null;
    },
    async buscarPorEmail(email) {
      const r = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
      return mapear(r.rows[0]) || null;
    },
    async buscarPorToken(hash) {
      const r = await pool.query('SELECT * FROM usuarios WHERE token_confirmacion = $1', [hash]);
      return mapear(r.rows[0]) || null;
    },
    async buscarPorProveedor(proveedor, proveedorId) {
      const r = await pool.query(
        'SELECT * FROM usuarios WHERE proveedor = $1 AND proveedor_id = $2', [proveedor, proveedorId]);
      return mapear(r.rows[0]) || null;
    },
    async actualizar(id, cambios) {
      const claves = Object.keys(cambios).filter((k) => COLUMNAS[k]);
      if (!claves.length) return;
      const sets = claves.map((k, i) => `${COLUMNAS[k]} = $${i + 2}`).join(', ');
      await pool.query(`UPDATE usuarios SET ${sets} WHERE id = $1`, [id, ...claves.map((k) => cambios[k])]);
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