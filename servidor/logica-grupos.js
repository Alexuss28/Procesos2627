const crypto = require('crypto');
const { ErrorApp } = require('./logica');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_GRUPOS_COMO_ENCARGADO = 5;
const MAX_MIEMBROS_POR_GRUPO = 50;

const iso = (fecha) => new Date(fecha).toISOString();

// repoTurnos es opcional: si se pasa, al salir o ser expulsado alguien se borran sus turnos futuros
// de ese grupo, y al eliminar un grupo se borran todos sus turnos.
function crearServicioGrupos({ repo, repoUsuarios, repoTurnos = null, log = () => {} }) {
  async function obtenerActor(actorId) {
    const actor = actorId ? await repoUsuarios.buscarPorId(actorId) : null;
    if (!actor) throw new ErrorApp('NO_AUTENTICADO', 'Debes iniciar sesión', 401);
    return actor;
  }

  // Si el grupo no existe o no eres miembro, la respuesta es la misma (404): no se revela qué grupos hay
  async function exigirMiembro(actorId, grupoId) {
    const grupo = typeof grupoId === 'string' ? await repo.buscarGrupo(grupoId) : null;
    const membresia = grupo ? await repo.buscarMembresia(grupoId, actorId) : null;
    if (!grupo || !membresia) throw new ErrorApp('NO_ENCONTRADO', 'El grupo no existe', 404);
    return { grupo, membresia };
  }

  async function exigirEncargado(actorId, grupoId) {
    const r = await exigirMiembro(actorId, grupoId);
    if (r.membresia.rol !== 'encargado') {
      log('warn', 'acceso denegado: se requiere ser encargado del grupo', { actorId, grupoId });
      throw new ErrorApp('PROHIBIDO', 'Solo el encargado del grupo puede hacer esto', 403);
    }
    return r;
  }

  async function invitacionPendienteDe(actor, invitacionId) {
    const inv = typeof invitacionId === 'string' ? await repo.buscarInvitacion(invitacionId) : null;
    if (!inv || inv.estado !== 'pendiente' || inv.email !== actor.email.toLowerCase()) {
      throw new ErrorApp('NO_ENCONTRADO', 'La invitación no existe o ya no está disponible', 404);
    }
    return inv;
  }

  const publicaInvitacion = (inv, grupo) => ({
    id: inv.id,
    grupoId: inv.grupoId,
    grupoNombre: grupo ? grupo.nombre : null,
    email: inv.email,
    creadaEn: iso(inv.creadaEn),
  });

  return {
    async crearGrupo(actorId, { nombre } = {}) {
      const actor = await obtenerActor(actorId);
      const n = typeof nombre === 'string' ? nombre.trim() : '';
      if (n.length < 2 || n.length > 60) {
        throw new ErrorApp('NOMBRE_INVALIDO', 'El nombre del grupo debe tener entre 2 y 60 caracteres');
      }
      if ((await repo.contarGruposDeEncargado(actor.id)) >= MAX_GRUPOS_COMO_ENCARGADO) {
        throw new ErrorApp('LIMITE_GRUPOS',
          `Solo puedes ser encargado de ${MAX_GRUPOS_COMO_ENCARGADO} grupos`, 409);
      }
      const grupo = { id: crypto.randomUUID(), nombre: n, creadoPor: actor.id };
      await repo.crearGrupoConEncargado(grupo, actor.id);
      log('info', 'grupo creado', { id: grupo.id, actorId });
      return { id: grupo.id, nombre: n, miRol: 'encargado' };
    },

    async listarMisGrupos(actorId) {
      const actor = await obtenerActor(actorId);
      const grupos = await repo.listarGruposDeUsuario(actor.id);
      return Promise.all(grupos.map(async (g) => ({
        id: g.id,
        nombre: g.nombre,
        miRol: g.rol,
        numMiembros: (await repo.listarMiembros(g.id)).length,
      })));
    },

    async obtenerGrupo(actorId, grupoId) {
      const { grupo, membresia } = await exigirMiembro(actorId, grupoId);
      const emails = new Map((await repoUsuarios.listar()).map((u) => [u.id, u.email]));
      const miembros = (await repo.listarMiembros(grupoId))
        .map((m) => ({ usuarioId: m.usuarioId, email: emails.get(m.usuarioId) || null, rol: m.rol }))
        .sort((a, b) => (a.rol === b.rol ? 0 : a.rol === 'encargado' ? -1 : 1));
      return { id: grupo.id, nombre: grupo.nombre, miRol: membresia.rol, miembros };
    },

    async eliminarGrupo(actorId, grupoId) {
      await exigirEncargado(actorId, grupoId);
      if (repoTurnos) await repoTurnos.eliminarPorGrupo(grupoId);
      await repo.eliminarGrupo(grupoId);
      log('info', 'grupo eliminado', { id: grupoId, actorId });
    },

    // ------------------------------------------------------------ Invitaciones (lado del encargado)
    async invitar(actorId, grupoId, { email } = {}) {
      await exigirEncargado(actorId, grupoId);
      const correo = typeof email === 'string' ? email.trim().toLowerCase() : '';
      if (!EMAIL_RE.test(correo)) throw new ErrorApp('EMAIL_INVALIDO', 'El correo no es válido');

      const existente = await repoUsuarios.buscarPorEmail(correo);
      if (existente && (await repo.buscarMembresia(grupoId, existente.id))) {
        throw new ErrorApp('YA_ES_MIEMBRO', 'Esa persona ya pertenece al grupo', 409);
      }
      if (await repo.buscarInvitacionPendiente(grupoId, correo)) {
        throw new ErrorApp('INVITACION_DUPLICADA', 'Ya hay una invitación pendiente para ese correo', 409);
      }
      if ((await repo.listarMiembros(grupoId)).length >= MAX_MIEMBROS_POR_GRUPO) {
        throw new ErrorApp('GRUPO_LLENO', `Un grupo admite como máximo ${MAX_MIEMBROS_POR_GRUPO} miembros`, 409);
      }

      // Se acepta también un correo que aún no se ha registrado: la invitación esperará.
      // La respuesta no revela si ese correo tiene cuenta.
      const inv = {
        id: crypto.randomUUID(), grupoId, email: correo,
        invitadoPor: actorId, estado: 'pendiente', creadaEn: new Date(),
      };
      await repo.crearInvitacion(inv);
      log('info', 'invitación creada', { id: inv.id, grupoId, actorId });
      return { id: inv.id, email: correo, estado: 'pendiente' };
    },

    async listarInvitacionesDeGrupo(actorId, grupoId) {
      await exigirEncargado(actorId, grupoId);
      return (await repo.listarInvitacionesPendientesDeGrupo(grupoId))
        .map((i) => ({ id: i.id, email: i.email, creadaEn: iso(i.creadaEn) }));
    },

    async cancelarInvitacion(actorId, grupoId, invitacionId) {
      await exigirEncargado(actorId, grupoId);
      const inv = typeof invitacionId === 'string' ? await repo.buscarInvitacion(invitacionId) : null;
      if (!inv || inv.grupoId !== grupoId || inv.estado !== 'pendiente') {
        throw new ErrorApp('NO_ENCONTRADO', 'La invitación no existe o ya no está pendiente', 404);
      }
      await repo.actualizarInvitacion(inv.id, 'cancelada');
      log('info', 'invitación cancelada', { id: inv.id, grupoId, actorId });
    },

    // ------------------------------------------------------------ Invitaciones (lado del invitado)
    async listarMisInvitaciones(actorId) {
      const actor = await obtenerActor(actorId);
      const pendientes = await repo.listarInvitacionesPendientesPorEmail(actor.email.toLowerCase());
      return Promise.all(pendientes.map(async (i) => publicaInvitacion(i, await repo.buscarGrupo(i.grupoId))));
    },

    async aceptarInvitacion(actorId, invitacionId) {
      const actor = await obtenerActor(actorId);
      const inv = await invitacionPendienteDe(actor, invitacionId);
      const grupo = await repo.buscarGrupo(inv.grupoId);
      if (!grupo) throw new ErrorApp('NO_ENCONTRADO', 'El grupo ya no existe', 404);

      if (!(await repo.buscarMembresia(inv.grupoId, actor.id))) {
        if ((await repo.listarMiembros(inv.grupoId)).length >= MAX_MIEMBROS_POR_GRUPO) {
          throw new ErrorApp('GRUPO_LLENO', 'El grupo ya no admite más miembros', 409);
        }
        const ok = await repo.aceptarInvitacion(inv, actor.id);
        if (!ok) throw new ErrorApp('INVITACION_NO_VALIDA', 'La invitación ya no está pendiente', 409);
      } else {
        await repo.actualizarInvitacion(inv.id, 'aceptada'); // ya era miembro: solo se cierra la invitación
      }
      log('info', 'invitación aceptada', { id: inv.id, grupoId: inv.grupoId, actorId });
      return { id: grupo.id, nombre: grupo.nombre, miRol: 'empleado' };
    },

    async rechazarInvitacion(actorId, invitacionId) {
      const actor = await obtenerActor(actorId);
      const inv = await invitacionPendienteDe(actor, invitacionId);
      await repo.actualizarInvitacion(inv.id, 'rechazada');
      log('info', 'invitación rechazada', { id: inv.id, grupoId: inv.grupoId, actorId });
    },

    // ------------------------------------------------------------ Salir y expulsar
    async expulsar(actorId, grupoId, usuarioId) {
      await exigirEncargado(actorId, grupoId);
      const objetivo = typeof usuarioId === 'string' ? await repo.buscarMembresia(grupoId, usuarioId) : null;
      if (!objetivo) throw new ErrorApp('NO_ENCONTRADO', 'Esa persona no pertenece al grupo', 404);
      if (objetivo.rol === 'encargado') {
        throw new ErrorApp('NO_PERMITIDO', 'El encargado no puede ser expulsado del grupo', 409);
      }
      if (repoTurnos) await repoTurnos.eliminarFuturos({ grupoId, empleadoId: usuarioId, desde: new Date() });
      await repo.eliminarMiembro(grupoId, usuarioId);
      log('info', 'miembro expulsado', { grupoId, usuarioId, actorId });
    },

    async salir(actorId, grupoId) {
      const { membresia } = await exigirMiembro(actorId, grupoId);
      if (membresia.rol === 'encargado') {
        throw new ErrorApp('NO_PERMITIDO',
          'El encargado no puede salir del grupo. Si ya no lo necesitas, elimínalo', 409);
      }
      if (repoTurnos) await repoTurnos.eliminarFuturos({ grupoId, empleadoId: actorId, desde: new Date() });
      await repo.eliminarMiembro(grupoId, actorId);
      log('info', 'miembro ha salido del grupo', { grupoId, actorId });
    },
  };
}

module.exports = { crearServicioGrupos, MAX_GRUPOS_COMO_ENCARGADO };