const crypto = require('crypto');
const { ErrorApp } = require('./logica');
const { parsearFecha } = require('./fechas');

const HORAS_MAX_TURNO = 12;
const DIAS_MAX_CONSULTA = 62;
const LONGITUD_MAX_NOTA = 200;
const MS_HORA = 60 * 60 * 1000;
const MS_DIA = 24 * MS_HORA;

// Regla pura: dos intervalos se solapan si cada uno empieza antes de que acabe el otro.
// Turnos consecutivos (uno acaba justo cuando empieza el siguiente) NO se solapan.
const seSolapan = (aIni, aFin, bIni, bFin) => aIni < bFin && bIni < aFin;

const iso = (fecha) => new Date(fecha).toISOString();
const publico = (t, conNota) => ({
  id: t.id,
  grupoId: t.grupoId,
  empleadoId: t.empleadoId,
  inicio: iso(t.inicio),
  fin: iso(t.fin),
  nota: conNota ? (t.nota || null) : null,
});

// Los turnos viven dentro de un grupo. Los permisos no salen del rol global de la cuenta,
// sino de la pertenencia al grupo: el encargado gestiona, los empleados consultan.
function crearServicioTurnos({ repo, repoGrupos, repoUsuarios, log = () => {} }) {
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

  function exigirRolEncargado(membresia, actorId, grupoId) {
    if (membresia.rol !== 'encargado') {
      log('warn', 'acceso denegado: se requiere ser encargado del grupo', { actorId, grupoId });
      throw new ErrorApp('PROHIBIDO', 'Solo el encargado del grupo puede gestionar los turnos', 403);
    }
  }

  async function exigirEncargado(actorId, grupoId) {
    exigirRolEncargado(await exigirMiembro(actorId, grupoId), actorId, grupoId);
  }

  // Para editar o eliminar un turno concreto: hay que ser encargado del grupo al que pertenece
  async function exigirEncargadoDelTurno(actorId, turnoId) {
    const turno = typeof turnoId === 'string' ? await repo.buscarPorId(turnoId) : null;
    const membresia = turno ? await repoGrupos.buscarMembresia(turno.grupoId, actorId) : null;
    if (!turno || !membresia) throw new ErrorApp('NO_ENCONTRADO', 'El turno no existe', 404);
    exigirRolEncargado(membresia, actorId, turno.grupoId);
    return turno;
  }

  // Los turnos solo se asignan a empleados del propio grupo
  async function exigirEmpleadoDelGrupo(grupoId, empleadoId) {
    const m = typeof empleadoId === 'string' ? await repoGrupos.buscarMembresia(grupoId, empleadoId) : null;
    if (!m || m.rol !== 'empleado') {
      throw new ErrorApp('EMPLEADO_INVALIDO', 'Los turnos solo se asignan a empleados del grupo');
    }
  }

  function validarRangoTurno(inicio, fin) {
    if (fin <= inicio) {
      throw new ErrorApp('RANGO_INVALIDO', 'El turno debe terminar después de empezar');
    }
    if (fin - inicio > HORAS_MAX_TURNO * MS_HORA) {
      throw new ErrorApp('TURNO_DEMASIADO_LARGO', `Un turno no puede durar más de ${HORAS_MAX_TURNO} horas`);
    }
  }

  function validarRangoConsulta(desde, hasta) {
    if (hasta <= desde) {
      throw new ErrorApp('RANGO_INVALIDO', 'La fecha final debe ser posterior a la inicial');
    }
    if (hasta - desde > DIAS_MAX_CONSULTA * MS_DIA) {
      throw new ErrorApp('RANGO_EXCESIVO', `No se pueden consultar más de ${DIAS_MAX_CONSULTA} días de una vez`);
    }
  }

  function validarNota(nota) {
    if (nota === undefined || nota === null || nota === '') return null;
    if (typeof nota !== 'string' || nota.length > LONGITUD_MAX_NOTA) {
      throw new ErrorApp('NOTA_INVALIDA', `La nota debe ser un texto de hasta ${LONGITUD_MAX_NOTA} caracteres`);
    }
    return nota.trim() || null;
  }

  // Una persona no puede estar en dos sitios a la vez: el solape se comprueba en TODOS sus grupos
  async function comprobarSolape(empleadoId, inicio, fin, excluirId = null) {
    const existentes = await repo.listarPorRango({ desde: inicio, hasta: fin, empleadoId });
    if (existentes.some((t) => t.id !== excluirId)) {
      throw new ErrorApp('TURNO_SOLAPADO', 'El empleado ya tiene un turno en ese horario', 409);
    }
  }

  return {
    async crearTurno(actorId, grupoId, { empleadoId, inicio, fin, nota } = {}) {
      await obtenerActor(actorId);
      await exigirEncargado(actorId, grupoId);
      const ini = parsearFecha(inicio, 'inicio');
      const f = parsearFecha(fin, 'fin');
      validarRangoTurno(ini, f);
      await exigirEmpleadoDelGrupo(grupoId, empleadoId);
      await comprobarSolape(empleadoId, ini, f);

      const turno = {
        id: crypto.randomUUID(),
        grupoId,
        empleadoId,
        inicio: ini,
        fin: f,
        nota: validarNota(nota),
        creadoPor: actorId,
      };
      await repo.crear(turno);
      log('info', 'turno creado', { id: turno.id, grupoId, empleadoId, actorId });
      return publico(turno, true);
    },

    async editarTurno(actorId, id, cambios = {}) {
      await obtenerActor(actorId);
      const actual = await exigirEncargadoDelTurno(actorId, id);

      const empleadoId = cambios.empleadoId !== undefined ? cambios.empleadoId : actual.empleadoId;
      const ini = cambios.inicio !== undefined ? parsearFecha(cambios.inicio, 'inicio') : new Date(actual.inicio);
      const f = cambios.fin !== undefined ? parsearFecha(cambios.fin, 'fin') : new Date(actual.fin);
      const nota = cambios.nota !== undefined ? validarNota(cambios.nota) : actual.nota;

      validarRangoTurno(ini, f);
      if (cambios.empleadoId !== undefined) await exigirEmpleadoDelGrupo(actual.grupoId, empleadoId);
      await comprobarSolape(empleadoId, ini, f, actual.id); // se excluye a sí mismo

      await repo.actualizar(id, { empleadoId, inicio: ini, fin: f, nota });
      log('info', 'turno editado', { id, actorId });
      return publico({ ...actual, empleadoId, inicio: ini, fin: f, nota }, true);
    },

    async eliminarTurno(actorId, id) {
      await obtenerActor(actorId);
      await exigirEncargadoDelTurno(actorId, id);
      await repo.eliminar(id);
      log('info', 'turno eliminado', { id, actorId });
    },

    // Los turnos del propio usuario en todos sus grupos
    async listarMios(actorId, { desde, hasta } = {}) {
      const actor = await obtenerActor(actorId);
      const d = parsearFecha(desde, 'desde');
      const h = parsearFecha(hasta, 'hasta');
      validarRangoConsulta(d, h);

      const nombres = new Map((await repoGrupos.listarGruposDeUsuario(actor.id)).map((g) => [g.id, g.nombre]));
      const turnos = await repo.listarPorRango({ desde: d, hasta: h, empleadoId: actor.id });
      return turnos.map((t) => ({ ...publico(t, true), grupoNombre: nombres.get(t.grupoId) || null }));
    },

    // Calendario del grupo: lo ven sus miembros, en solo lectura.
    // La nota solo la ven el encargado y el propio empleado.
    async listarEquipo(actorId, grupoId, { desde, hasta } = {}) {
      await obtenerActor(actorId);
      const membresia = await exigirMiembro(actorId, grupoId);
      const d = parsearFecha(desde, 'desde');
      const h = parsearFecha(hasta, 'hasta');
      validarRangoConsulta(d, h);

      const emails = new Map((await repoUsuarios.listar()).map((u) => [u.id, u.email]));
      const turnos = await repo.listarPorRango({ desde: d, hasta: h, grupoId });
      return turnos.map((t) => ({
        ...publico(t, membresia.rol === 'encargado' || t.empleadoId === actorId),
        empleadoEmail: emails.get(t.empleadoId) || null,
      }));
    },

    // Disponibilidad derivada: está libre el empleado del grupo sin ningún turno
    // (en ningún grupo) que se solape con la franja
    async disponibilidad(actorId, grupoId, { inicio, fin } = {}) {
      await obtenerActor(actorId);
      await exigirMiembro(actorId, grupoId);
      const ini = parsearFecha(inicio, 'inicio');
      const f = parsearFecha(fin, 'fin');
      validarRangoConsulta(ini, f);

      const ocupados = new Set(
        (await repo.listarPorRango({ desde: ini, hasta: f })).map((t) => t.empleadoId)
      );
      const emails = new Map((await repoUsuarios.listar()).map((u) => [u.id, u.email]));
      return (await repoGrupos.listarMiembros(grupoId))
        .filter((m) => m.rol === 'empleado' && !ocupados.has(m.usuarioId))
        .map((m) => ({ id: m.usuarioId, email: emails.get(m.usuarioId) || null }));
    },
  };
}

module.exports = { crearServicioTurnos, seSolapan, HORAS_MAX_TURNO };