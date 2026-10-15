const bcrypt = require('bcryptjs');
const crypto = require('crypto');

class ErrorApp extends Error {
  constructor(codigo, mensaje, estado = 400) {
    super(mensaje);
    this.codigo = codigo;
    this.estado = estado;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Regla pura: no accede a la base de datos
function calcularEstadoUsuario({ proveedor, confirmado, eliminado } = {}) {
  if (proveedor !== 'local' && proveedor !== 'oauth') {
    throw new ErrorApp('PROVEEDOR_INVALIDO', 'El proveedor debe ser "local" u "oauth"');
  }
  if (typeof confirmado !== 'boolean' || typeof eliminado !== 'boolean') {
    throw new ErrorApp('CAMPO_INVALIDO', 'Los campos "confirmado" y "eliminado" deben ser booleanos');
  }

  let estado;
  if (eliminado) estado = 'eliminado';
  else if (proveedor === 'oauth' || confirmado) estado = 'activo';
  else estado = 'pendiente';

  return { estado, puedeIniciarSesion: estado === 'activo' };
}

function crearServicioUsuarios({ repo, log = () => {}, rondasHash = 10, requiereConfirmacion = false }) {
  const publico = (u) => ({ id: u.id, email: u.email, rol: u.rol, estado: u.estado });

  async function obtenerActor(actorId) {
    const actor = actorId ? await repo.buscarPorId(actorId) : null;
    if (!actor) throw new ErrorApp('NO_AUTENTICADO', 'Debes iniciar sesión', 401);
    return actor;
  }

  async function exigirAdmin(actorId) {
    const actor = await obtenerActor(actorId);
    if (actor.rol !== 'administrador') {
      log('warn', 'acceso denegado: se requiere administrador', { actorId });
      throw new ErrorApp('PROHIBIDO', 'Solo un administrador puede hacer esto', 403);
    }
    return actor;
  }

  function validar(email, password) {
    if (!email || !EMAIL_RE.test(email)) throw new ErrorApp('EMAIL_INVALIDO', 'El email no es válido');
    if (!password || password.length < 8) {
      throw new ErrorApp('PASSWORD_DEBIL', 'La contraseña debe tener al menos 8 caracteres');
    }
  }

  async function crear({ email, password, rol, estado }) {
    validar(email, password);
    email = email.trim().toLowerCase();
    if (await repo.buscarPorEmail(email)) {
      throw new ErrorApp('EMAIL_DUPLICADO', 'Ya existe una cuenta con ese email', 409);
    }
    const usuario = {
      id: crypto.randomUUID(),
      email,
      passwordHash: await bcrypt.hash(password, rondasHash),
      rol,
      estado,
      tokenConfirmacion: estado === 'pendiente' ? crypto.randomBytes(24).toString('hex') : null,
    };
    await repo.crear(usuario);
    log('info', 'usuario creado', { id: usuario.id, rol });
    return usuario;
  }

  return {
    // Registro público: siempre rol "usuario"
    async registrar({ email, password }) {
      const estado = requiereConfirmacion ? 'pendiente' : 'activo';
      return publico(await crear({ email, password, rol: 'usuario', estado }));
    },

        async iniciarSesion({ email, password }) {
      const u = await repo.buscarPorEmail((email || '').trim().toLowerCase());
      const ok = u && u.passwordHash && (await bcrypt.compare(password || '', u.passwordHash));
      if (!ok) {
        log('warn', 'login fallido', { email });
        throw new ErrorApp('CREDENCIALES_INVALIDAS', 'Email o contraseña incorrectos', 401);
      }
      if (u.estado !== 'activo') {
        throw new ErrorApp('CUENTA_PENDIENTE', 'Debes confirmar tu cuenta por correo antes de entrar', 403);
      }
      log('info', 'login correcto', { id: u.id });
      return publico(u);
    },

    // Primer administrador (se llama al arrancar con ADMIN_EMAIL / ADMIN_PASSWORD)
    async asegurarAdministrador(email, password) {
      if (await repo.buscarPorEmail((email || '').trim().toLowerCase())) {
        log('info', 'el administrador ya existe', { email });
        return;
      }
      await crear({ email, password, rol: 'administrador', estado: 'activo' });
    },

    async listar(actorId) {
      await exigirAdmin(actorId);
      return (await repo.listar()).map(publico);
    },

    async estaActivo(actorId, id) {
      await exigirAdmin(actorId);
      const u = await repo.buscarPorId(id);
      return Boolean(u) && u.estado === 'activo';
    },

    async eliminar(actorId, id) {
      const actor = await obtenerActor(actorId);
      if (actor.rol !== 'administrador' && actor.id !== id) {
        log('warn', 'intento de eliminar a otro usuario', { actorId, id });
        throw new ErrorApp('PROHIBIDO', 'Solo puedes eliminar tu propia cuenta', 403);
      }
      if (!(await repo.buscarPorId(id))) throw new ErrorApp('NO_ENCONTRADO', 'El usuario no existe', 404);
      await repo.eliminar(id);
      log('info', 'usuario eliminado', { actorId, id });
    },

    obtenerActor: async (id) => publico(await obtenerActor(id)),
  };
}

module.exports = { crearServicioUsuarios, ErrorApp, calcularEstadoUsuario };