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
const ESPERA_REENVIO_MS = 60 * 1000; // mínimo entre dos correos de confirmación

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

// El token se guarda solo como hash: si se filtrase la base de datos no serviría para confirmar cuentas
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function crearServicioUsuarios({
  repo,
  correo = null,          // adaptador de correo: { enviarConfirmacion({ email, enlace }) }
  urlBase = '',           // URL pública de la app, para construir el enlace
  log = () => {},
  rondasHash = 10,
  requiereConfirmacion = false,
  horasValidezToken = 24,
}) {
  const validezMs = horasValidezToken * 60 * 60 * 1000;
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

  function nuevoToken() {
    const token = crypto.randomBytes(32).toString('hex');
    return { token, hash: hashToken(token), expira: new Date(Date.now() + validezMs) };
  }

  async function enviarConfirmacion(usuario, token) {
    if (!correo) {
      log('warn', 'correo no configurado: no se envía la confirmación', { id: usuario.id });
      return;
    }
    const enlace = `${urlBase}/?token=${token}`;
    await correo.enviarConfirmacion({ email: usuario.email, enlace });
  }

  async function crear({ email, password, rol, estado }) {
    validar(email, password);
    email = email.trim().toLowerCase();
    if (await repo.buscarPorEmail(email)) {
      throw new ErrorApp('EMAIL_DUPLICADO', 'Ya existe una cuenta con ese email', 409);
    }
    const t = estado === 'pendiente' ? nuevoToken() : null;
    const usuario = {
      id: crypto.randomUUID(),
      email,
      passwordHash: await bcrypt.hash(password, rondasHash),
      rol,
      estado,
      tokenConfirmacion: t ? t.hash : null,
      tokenExpira: t ? t.expira : null,
      proveedor: 'local',
      proveedorId: null,
    };
    await repo.crear(usuario);
    log('info', 'usuario creado', { id: usuario.id, rol });
    return { usuario, token: t ? t.token : null };
  }

  return {
    // Registro público: siempre rol "usuario"
    async registrar({ email, password }) {
      const estado = requiereConfirmacion ? 'pendiente' : 'activo';
      const { usuario, token } = await crear({ email, password, rol: 'usuario', estado });
      if (estado === 'pendiente') {
        try {
          await enviarConfirmacion(usuario, token);
        } catch (e) {
          // Si el correo no sale, se revierte el alta para no dejar una cuenta inalcanzable
          await repo.eliminar(usuario.id);
          log('error', 'fallo al enviar la confirmación: registro revertido', { id: usuario.id, motivo: e.message });
          throw new ErrorApp('CORREO_NO_ENVIADO',
            'No hemos podido enviar el correo de confirmación. Inténtalo de nuevo más tarde', 502);
        }
      }
      return publico(usuario);
    },

    async confirmarCuenta(token) {
      if (typeof token !== 'string' || token.length < 16) {
        throw new ErrorApp('TOKEN_INVALIDO', 'El enlace de confirmación no es válido o ya se ha usado');
      }
      const u = await repo.buscarPorToken(hashToken(token));
      if (!u) {
        log('warn', 'token de confirmación desconocido');
        throw new ErrorApp('TOKEN_INVALIDO', 'El enlace de confirmación no es válido o ya se ha usado');
      }
      if (u.tokenExpira && new Date(u.tokenExpira).getTime() < Date.now()) {
        throw new ErrorApp('TOKEN_CADUCADO', 'El enlace ha caducado. Solicita uno nuevo', 410);
      }
      // Uso único: se borra el token al confirmar
      await repo.actualizar(u.id, { estado: 'activo', tokenConfirmacion: null, tokenExpira: null });
      log('info', 'cuenta confirmada', { id: u.id });
      return publico({ ...u, estado: 'activo' });
    },

    // Responde siempre igual exista o no la cuenta, para no revelar qué correos están registrados
    async reenviarConfirmacion(email) {
      const u = await repo.buscarPorEmail(String(email || '').trim().toLowerCase());
      if (!u || u.estado !== 'pendiente') return;
      const emitido = u.tokenExpira ? new Date(u.tokenExpira).getTime() - validezMs : 0;
      if (Date.now() - emitido < ESPERA_REENVIO_MS) {
        log('warn', 'reenvío ignorado: demasiado pronto', { id: u.id });
        return;
      }
      const t = nuevoToken();
      await repo.actualizar(u.id, { tokenConfirmacion: t.hash, tokenExpira: t.expira });
      try {
        await enviarConfirmacion(u, t.token);
        log('info', 'confirmación reenviada', { id: u.id });
      } catch (e) {
        log('error', 'fallo al reenviar la confirmación', { id: u.id, motivo: e.message });
      }
    },

    // Primer administrador (se llama al arrancar con ADMIN_EMAIL / ADMIN_PASSWORD)
    async asegurarAdministrador(email, password) {
      if (await repo.buscarPorEmail((email || '').trim().toLowerCase())) {
        log('info', 'el administrador ya existe', { email });
        return;
      }
      await crear({ email, password, rol: 'administrador', estado: 'activo' });
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

        // Acceso con un proveedor externo (hoy solo Google). Las cuentas OAuth nacen activas y sin contraseña.
    async iniciarSesionConProveedor({ proveedor, proveedorId, email, emailVerificado }) {
      if (proveedor !== 'google') {
        throw new ErrorApp('PROVEEDOR_INVALIDO', 'Proveedor de acceso no soportado');
      }
      if (!proveedorId || !email) {
        throw new ErrorApp('IDENTIDAD_INVALIDA', 'El proveedor no ha devuelto una identidad válida');
      }
      if (emailVerificado !== true) {
        throw new ErrorApp('EMAIL_NO_VERIFICADO', 'El proveedor indica que ese correo no está verificado', 403);
      }

      const existente = await repo.buscarPorProveedor(proveedor, proveedorId);
      if (existente) {
        log('info', 'login con proveedor correcto', { id: existente.id, proveedor });
        return publico(existente);
      }

      const correo = email.trim().toLowerCase();
      // No se vincula automáticamente a una cuenta local: alguien podría haber registrado ese
      // correo sin confirmarlo, y al vincular heredaría el acceso de la víctima.
      if (await repo.buscarPorEmail(correo)) {
        log('warn', 'acceso con proveedor rechazado: el correo ya tiene una cuenta local', { proveedor });
        throw new ErrorApp('EMAIL_EN_USO_LOCAL',
          'Ya existe una cuenta con ese correo registrada con contraseña. Inicia sesión con tu contraseña', 409);
      }

      const usuario = {
        id: crypto.randomUUID(),
        email: correo,
        passwordHash: null,
        rol: 'usuario',
        estado: 'activo',
        tokenConfirmacion: null,
        tokenExpira: null,
        proveedor,
        proveedorId,
      };
      await repo.crear(usuario);
      log('info', 'usuario creado con proveedor', { id: usuario.id, proveedor });
      return publico(usuario);
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