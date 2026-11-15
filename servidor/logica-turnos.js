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
  empleadoId: t.empleadoId,
  inicio: iso(t.inicio),
  fin: iso(t.fin),
  nota: conNota ? (t.nota || null) : null,
});

function crearServicioTurnos({ repo, repoUsuarios, log = () => {} }) {
  async function obtenerActor(actorId) {
    const actor = actorId ? await repoUsuarios.buscarPorId(actorId) : null;
    if (!actor) throw new ErrorApp('NO_AUTENTICADO', 'Debes iniciar sesión', 401);
    return actor;
  }

  async function exigirEncargado(actorId) {
    const actor = await obtenerActor(actorId);
    if (actor.rol !== 'administrador') {
      log('warn', 'acceso denegado: se requiere el encargado', { actorId });
      throw new ErrorApp('PROHIBIDO', 'Solo el encargado puede gestionar los turnos', 403);
    }
    return actor;
  }

  async function exigirEmpleado(empleadoId) {
    const empleado = typeof empleadoId === 'string' ? await repoUsuarios.buscarPorId(empleadoId) : null;
    if (!empleado) throw new ErrorApp('NO_ENCONTRADO', 'El empleado no existe', 404);
    if (empleado.rol !== 'usuario' || empleado.estado !== 'activo') {
      throw new ErrorApp('EMPLEADO_INVALIDO', 'Los turnos solo se asignan a empleados con la cuenta activa');
    }
    return empleado;
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

  // Un empleado no puede tener dos turnos a la vez
  async function comprobarSolape(empleadoId, inicio, fin, excluirId = null) {
    const existentes = await repo.listarPorRango({ desde: inicio, hasta: fin, empleadoId });
    if (existentes.some((t) => t.id !== excluirId)) {
      throw new ErrorApp('TURNO_SOLAPADO', 'El empleado ya tiene un turno en ese horario', 409);
    }
  }

  return {
    async crearTurno(actorId, { empleadoId, inicio, fin, nota } = {}) {
      await exigirEncargado(actorId);
      const ini = parsearFecha(inicio, 'inicio');
      const f = parsearFecha(fin, 'fin');
      validarRangoTurno(ini, f);
      await exigirEmpleado(empleadoId);
      await comprobarSolape(empleadoId, ini, f);

      const turno = {
        id: crypto.randomUUID(),
        empleadoId,
        inicio: ini,
        fin: f,
        nota: validarNota(nota),
        creadoPor: actorId,
      };
      await repo.crear(turno);
      log('info', 'turno creado', { id: turno.id, empleadoId, actorId });
      return publico(turno, true);
    },

    async editarTurno(actorId, id, cambios = {}) {
      await exigirEncargado(actorId);
      const actual = await repo.buscarPorId(id);
      if (!actual) throw new ErrorApp('NO_ENCONTRADO', 'El turno no existe', 404);

      const empleadoId = cambios.empleadoId !== undefined ? cambios.empleadoId : actual.empleadoId;
      const ini = cambios.inicio !== undefined ? parsearFecha(cambios.inicio, 'inicio') : new Date(actual.inicio);
      const f = cambios.fin !== undefined ? parsearFecha(cambios.fin, 'fin') : new Date(actual.fin);
      const nota = cambios.nota !== undefined ? validarNota(cambios.nota) : actual.nota;

      validarRangoTurno(ini, f);
      if (cambios.empleadoId !== undefined) await exigirEmpleado(empleadoId);
      await comprobarSolape(empleadoId, ini, f, actual.id); // se excluye a sí mismo

      await repo.actualizar(id, { empleadoId, inicio: ini, fin: f, nota });
      log('info', 'turno editado', { id, actorId });
      return publico({ ...actual, empleadoId, inicio: ini, fin: f, nota }, true);
    },

    async eliminarTurno(actorId, id) {
      await exigirEncargado(actorId);
      if (!(await repo.buscarPorId(id))) throw new ErrorApp('NO_ENCONTRADO', 'El turno no existe', 404);
      await repo.eliminar(id);
      log('info', 'turno eliminado', { id, actorId });
    },

    // Los turnos del propio usuario en un rango
    async listarMios(actorId, { desde, hasta } = {}) {
      const actor = await obtenerActor(actorId);
      const d = parsearFecha(desde, 'desde');
      const h = parsearFecha(hasta, 'hasta');
      validarRangoConsulta(d, h);
      const turnos = await repo.listarPorRango({ desde: d, hasta: h, empleadoId: actor.id });
      return turnos.map((t) => publico(t, true));
    },

    // Calendario del equipo: lo ve cualquier usuario autenticado, en solo lectura.
    // La nota solo la ven el encargado y el propio empleado.
    async listarEquipo(actorId, { desde, hasta } = {}) {
      const actor = await obtenerActor(actorId);
      const d = parsearFecha(desde, 'desde');
      const h = parsearFecha(hasta, 'hasta');
      validarRangoConsulta(d, h);

      const emails = new Map((await repoUsuarios.listar()).map((u) => [u.id, u.email]));
      const turnos = await repo.listarPorRango({ desde: d, hasta: h });
      return turnos.map((t) => ({
        ...publico(t, actor.rol === 'administrador' || t.empleadoId === actor.id),
        empleadoEmail: emails.get(t.empleadoId) || null,
      }));
    },

    // Disponibilidad derivada: está libre quien no tiene ningún turno que se solape con la franja
    async disponibilidad(actorId, { inicio, fin } = {}) {
      await obtenerActor(actorId);
      const ini = parsearFecha(inicio, 'inicio');
      const f = parsearFecha(fin, 'fin');
      validarRangoConsulta(ini, f);

      const ocupados = new Set(
        (await repo.listarPorRango({ desde: ini, hasta: f })).map((t) => t.empleadoId)
      );
      return (await repoUsuarios.listar())
        .filter((u) => u.rol === 'usuario' && u.estado === 'activo' && !ocupados.has(u.id))
        .map((u) => ({ id: u.id, email: u.email }));
    },
  };
}

module.exports = { crearServicioTurnos, seSolapan, HORAS_MAX_TURNO };