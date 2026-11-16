const crypto = require('crypto');
const { ErrorApp } = require('./logica');

const LONGITUD_MAX_TEXTO = 200;
const TIPOS = ['cesion', 'intercambio'];
const ESTADOS = ['pendiente', 'aprobada', 'rechazada', 'cancelada'];
const iso = (fecha) => new Date(fecha).toISOString();

// Solicitudes de cambio de turno dentro de un grupo:
//  - cesión: el empleado cede su turno a un compañero
//  - intercambio: el empleado cambia su turno por uno de un compañero
// Las pide un empleado y las resuelve el encargado del grupo (el compañero no tiene que aceptar).
// "ahora" se inyecta para poder probar con fechas fijas.
function crearServicioSolicitudes({ repo, repoTurnos, repoGrupos, repoUsuarios, log = () => {}, ahora = () => new Date() }) {
  async function obtenerActor(actorId) {
    const actor = actorId ? await repoUsuarios.buscarPorId(actorId) : null;
    if (!actor) throw new ErrorApp('NO_AUTENTICADO', 'Debes iniciar sesión', 401);
    return actor;
  }

  // Si el grupo no existe o no eres miembro, la respuesta es la misma (404)
  async function exigirMiembro(actorId, grupoId) {
    const grupo = typeof grupoId === 'string' ? await repoGrupos.buscarGrupo(grupoId) : null;
    const membresia = grupo ? await repoGrupos.buscarMembresia(grupoId, actorId) : null;
    if (!grupo || !membresia) throw new ErrorApp('NO_ENCONTRADO', 'El grupo no existe', 404);
    return membresia;
  }

  async function turnoDelGrupo(turnoId, grupoId) {
    const t = typeof turnoId === 'string' ? await repoTurnos.buscarPorId(turnoId) : null;
    return t && t.grupoId === grupoId ? t : null;
  }

  function validarTexto(valor, campo) {
    if (valor === undefined || valor === null || valor === '') return null;
    if (typeof valor !== 'string' || valor.length > LONGITUD_MAX_TEXTO) {
      throw new ErrorApp('TEXTO_INVALIDO', `El campo "${campo}" admite como máximo ${LONGITUD_MAX_TEXTO} caracteres`);
    }
    return valor.trim() || null;
  }

  // Tras el cambio, nadie puede tener dos turnos a la vez (en ninguno de sus grupos).
  // "ignorar" son los turnos que la propia persona deja de tener con el cambio.
  async function sinChoques(empleadoId, turno, ignorar) {
    const existentes = await repoTurnos.listarPorRango({
      desde: new Date(turno.inicio), hasta: new Date(turno.fin), empleadoId,
    });
    if (existentes.some((t) => t.id !== turno.id && !ignorar.includes(t.id))) {
      throw new ErrorApp('TURNO_SOLAPADO', 'El cambio dejaría a un empleado con dos turnos a la vez', 409);
    }
  }

  async function comprobarCambio({ tipo, origen, destino, solicitanteId, companeroId }) {
    // El compañero recibe el turno de origen (y, en un intercambio, deja el de destino)
    await sinChoques(companeroId, origen, destino ? [destino.id] : []);
    // En un intercambio, el solicitante recibe el de destino (y deja el de origen)
    if (tipo === 'intercambio') await sinChoques(solicitanteId, destino, [origen.id]);
  }

  async function publica(s, emails) {
    const correos = emails || new Map((await repoUsuarios.listar()).map((u) => [u.id, u.email]));
    const origen = await repoTurnos.buscarPorId(s.turnoOrigenId);
    const destino = s.turnoDestinoId ? await repoTurnos.buscarPorId(s.turnoDestinoId) : null;
    const turno = (t) => (t ? { id: t.id, inicio: iso(t.inicio), fin: iso(t.fin) } : null);
    return {
      id: s.id,
      grupoId: s.grupoId,
      tipo: s.tipo,
      estado: s.estado,
      motivo: s.motivo || null,
      comentario: s.comentario || null,
      solicitante: { id: s.solicitanteId, email: correos.get(s.solicitanteId) || null },
      companero: { id: s.companeroId, email: correos.get(s.companeroId) || null },
      turnoOrigen: turno(origen),
      turnoDestino: turno(destino),
      creadaEn: iso(s.creadaEn),
      resueltaEn: s.resueltaEn ? iso(s.resueltaEn) : null,
    };
  }

  // Carga una solicitud y exige que quien actúa sea el encargado de su grupo
  async function solicitudParaEncargado(actorId, solicitudId) {
    const s = typeof solicitudId === 'string' ? await repo.buscarPorId(solicitudId) : null;
    const membresia = s ? await repoGrupos.buscarMembresia(s.grupoId, actorId) : null;
    if (!s || !membresia) throw new ErrorApp('NO_ENCONTRADO', 'La solicitud no existe', 404);
    if (membresia.rol !== 'encargado') {
      log('warn', 'acceso denegado: se requiere ser encargado del grupo', { actorId, grupoId: s.grupoId });
      throw new ErrorApp('PROHIBIDO', 'Solo el encargado del grupo puede resolver solicitudes', 403);
    }
    return s;
  }

  return {
    async crearSolicitud(actorId, grupoId, { tipo, turnoId, companeroId, turnoDestinoId, motivo } = {}) {
      await obtenerActor(actorId);
      const membresia = await exigirMiembro(actorId, grupoId);
      if (membresia.rol !== 'empleado') {
        throw new ErrorApp('PROHIBIDO', 'Solo los empleados del grupo pueden pedir cambios de turno', 403);
      }
      if (!TIPOS.includes(tipo)) throw new ErrorApp('TIPO_INVALIDO', 'El tipo debe ser "cesion" o "intercambio"');
      const motivoLimpio = validarTexto(motivo, 'motivo');

      const origen = await turnoDelGrupo(turnoId, grupoId);
      if (!origen) throw new ErrorApp('NO_ENCONTRADO', 'El turno no existe', 404);
      if (origen.empleadoId !== actorId) {
        throw new ErrorApp('TURNO_NO_PROPIO', 'Solo puedes pedir cambios de tus propios turnos', 403);
      }
      if (new Date(origen.inicio) <= ahora()) {
        throw new ErrorApp('TURNO_PASADO', 'No se puede cambiar un turno que ya ha empezado', 409);
      }

      const mc = typeof companeroId === 'string' && companeroId !== actorId
        ? await repoGrupos.buscarMembresia(grupoId, companeroId) : null;
      if (!mc || mc.rol !== 'empleado') {
        throw new ErrorApp('COMPANERO_INVALIDO', 'El compañero debe ser otro empleado del grupo');
      }

      let destino = null;
      if (tipo === 'intercambio') {
        destino = await turnoDelGrupo(turnoDestinoId, grupoId);
        if (!destino || destino.empleadoId !== companeroId) {
          throw new ErrorApp('TURNO_DESTINO_INVALIDO', 'Para intercambiar, elige un turno de ese compañero');
        }
        if (new Date(destino.inicio) <= ahora()) {
          throw new ErrorApp('TURNO_PASADO', 'No se puede cambiar un turno que ya ha empezado', 409);
        }
      }

      if (await repo.buscarPendientePorTurno(origen.id)) {
        throw new ErrorApp('SOLICITUD_DUPLICADA', 'Ese turno ya tiene una solicitud pendiente', 409);
      }
      await comprobarCambio({ tipo, origen, destino, solicitanteId: actorId, companeroId });

      const solicitud = {
        id: crypto.randomUUID(), grupoId, tipo,
        solicitanteId: actorId, turnoOrigenId: origen.id,
        companeroId, turnoDestinoId: destino ? destino.id : null,
        motivo: motivoLimpio, estado: 'pendiente', creadaEn: new Date(),
      };
      await repo.crear(solicitud);
      log('info', 'solicitud de cambio creada', { id: solicitud.id, grupoId, tipo, actorId });
      return publica(solicitud);
    },

    // El encargado ve todas las del grupo; un empleado, las suyas y aquellas en las que es el compañero
    async listarSolicitudes(actorId, grupoId, { estado } = {}) {
      await obtenerActor(actorId);
      const membresia = await exigirMiembro(actorId, grupoId);
      if (estado !== undefined && !ESTADOS.includes(estado)) {
        throw new ErrorApp('ESTADO_INVALIDO', `El estado debe ser uno de: ${ESTADOS.join(', ')}`);
      }
      const todas = membresia.rol === 'encargado'
        ? await repo.listarPorGrupo(grupoId, { estado })
        : await repo.listarPorGrupoYParticipante(grupoId, actorId, { estado });
      const emails = new Map((await repoUsuarios.listar()).map((u) => [u.id, u.email]));
      const resultado = [];
      for (const s of todas) {
        const p = await publica(s, emails);
        if (p.turnoOrigen) resultado.push(p); // si el turno ya no existe, la solicitud no tiene sentido
      }
      return resultado;
    },

    async cancelarSolicitud(actorId, solicitudId) {
      await obtenerActor(actorId);
      const s = typeof solicitudId === 'string' ? await repo.buscarPorId(solicitudId) : null;
      const membresia = s ? await repoGrupos.buscarMembresia(s.grupoId, actorId) : null;
      if (!s || !membresia) throw new ErrorApp('NO_ENCONTRADO', 'La solicitud no existe', 404);
      if (s.solicitanteId !== actorId) {
        throw new ErrorApp('PROHIBIDO', 'Solo quien la pidió puede cancelar la solicitud', 403);
      }
      if (s.estado !== 'pendiente') {
        throw new ErrorApp('SOLICITUD_NO_PENDIENTE', 'La solicitud ya está resuelta', 409);
      }
      const ok = await repo.resolver(s.id, { estado: 'cancelada', resueltaPor: actorId, comentario: null });
      if (!ok) throw new ErrorApp('SOLICITUD_NO_PENDIENTE', 'La solicitud ya está resuelta', 409);
      log('info', 'solicitud cancelada', { id: s.id, actorId });
      return publica({ ...s, estado: 'cancelada', resueltaEn: new Date() });
    },

    async rechazarSolicitud(actorId, solicitudId, { comentario } = {}) {
      await obtenerActor(actorId);
      const s = await solicitudParaEncargado(actorId, solicitudId);
      if (s.estado !== 'pendiente') {
        throw new ErrorApp('SOLICITUD_NO_PENDIENTE', 'La solicitud ya está resuelta', 409);
      }
      const texto = validarTexto(comentario, 'comentario');
      const ok = await repo.resolver(s.id, { estado: 'rechazada', resueltaPor: actorId, comentario: texto });
      if (!ok) throw new ErrorApp('SOLICITUD_NO_PENDIENTE', 'La solicitud ya está resuelta', 409);
      log('info', 'solicitud rechazada', { id: s.id, actorId });
      return publica({ ...s, estado: 'rechazada', comentario: texto, resueltaEn: new Date() });
    },

    // Aprobar vuelve a comprobarlo todo con los datos de AHORA (los turnos pueden haber cambiado)
    // y aplica el cambio de forma atómica.
    async aprobarSolicitud(actorId, solicitudId, { comentario } = {}) {
      await obtenerActor(actorId);
      const s = await solicitudParaEncargado(actorId, solicitudId);
      if (s.estado !== 'pendiente') {
        throw new ErrorApp('SOLICITUD_NO_PENDIENTE', 'La solicitud ya está resuelta', 409);
      }
      const texto = validarTexto(comentario, 'comentario');
      const obsoleta = () => new ErrorApp('SOLICITUD_OBSOLETA',
        'Los turnos han cambiado desde que se hizo la solicitud. Recházala para que se pida de nuevo', 409);

      const origen = await repoTurnos.buscarPorId(s.turnoOrigenId);
      const destino = s.turnoDestinoId ? await repoTurnos.buscarPorId(s.turnoDestinoId) : null;
      if (!origen || origen.empleadoId !== s.solicitanteId) throw obsoleta();
      if (s.tipo === 'intercambio' && (!destino || destino.empleadoId !== s.companeroId)) throw obsoleta();

      // Los dos siguen en el grupo como empleados
      for (const id of [s.solicitanteId, s.companeroId]) {
        const m = await repoGrupos.buscarMembresia(s.grupoId, id);
        if (!m || m.rol !== 'empleado') throw obsoleta();
      }
      const tiempo = ahora();
      if (new Date(origen.inicio) <= tiempo || (destino && new Date(destino.inicio) <= tiempo)) {
        throw new ErrorApp('TURNO_PASADO', 'No se puede cambiar un turno que ya ha empezado', 409);
      }
      await comprobarCambio({
        tipo: s.tipo, origen, destino, solicitanteId: s.solicitanteId, companeroId: s.companeroId,
      });

      const cambios = [{ turnoId: origen.id, deEmpleadoId: s.solicitanteId, aEmpleadoId: s.companeroId }];
      if (s.tipo === 'intercambio') {
        cambios.push({ turnoId: destino.id, deEmpleadoId: s.companeroId, aEmpleadoId: s.solicitanteId });
      }
      const ok = await repo.aplicarAprobacion({ solicitudId: s.id, resueltaPor: actorId, comentario: texto, cambios });
      if (!ok) throw obsoleta();

      log('info', 'solicitud aprobada', { id: s.id, tipo: s.tipo, actorId });
      return publica({ ...s, estado: 'aprobada', comentario: texto, resueltaEn: new Date() });
    },
  };
}

module.exports = { crearServicioSolicitudes };