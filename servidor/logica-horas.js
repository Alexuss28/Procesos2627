const { ErrorApp } = require('./logica');

const ZONA_POR_DEFECTO = 'Europe/Madrid';
const MS_MINUTO = 60 * 1000;
const MS_HORA = 60 * MS_MINUTO;

// ---- Fechas y zonas horarias, sin bibliotecas externas (Node ya incluye los datos de zonas) ----

// Diferencia (en ms) entre la hora local de la zona y UTC en un instante dado
function desfaseMs(fecha, zona) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zona, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(fecha);
  const v = {};
  for (const p of partes) if (p.type !== 'literal') v[p.type] = Number(p.value);
  const comoUTC = Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute, v.second);
  return comoUTC - Math.floor(fecha.getTime() / 1000) * 1000;
}

// El instante UTC en el que es medianoche (00:00) del día indicado en esa zona
function medianocheLocal(anio, mes, dia, zona) {
  const aprox = Date.UTC(anio, mes - 1, dia, 0, 0, 0);
  const primero = aprox - desfaseMs(new Date(aprox), zona);
  return new Date(aprox - desfaseMs(new Date(primero), zona)); // segunda pasada: corrige si hay cambio de hora
}

// "2026-12" -> [medianoche del 1 de diciembre, medianoche del 1 de enero) en la zona indicada
function limitesDelMes(mes, zona = ZONA_POR_DEFECTO) {
  const m = typeof mes === 'string' ? /^(\d{4})-(0[1-9]|1[0-2])$/.exec(mes) : null;
  if (!m || Number(m[1]) < 2000 || Number(m[1]) > 2100) {
    throw new ErrorApp('MES_INVALIDO', 'El mes debe tener el formato AAAA-MM (por ejemplo 2026-12)');
  }
  const anio = Number(m[1]);
  const numMes = Number(m[2]);
  return {
    inicio: medianocheLocal(anio, numMes, 1, zona),
    fin: numMes === 12 ? medianocheLocal(anio + 1, 1, 1, zona) : medianocheLocal(anio, numMes + 1, 1, zona),
  };
}

// Milisegundos de un turno que caen dentro de [inicio, fin): un turno que cruza el cambio de mes se reparte
function msEnRango(turno, inicio, fin) {
  const a = Math.max(new Date(turno.inicio).getTime(), inicio.getTime());
  const b = Math.min(new Date(turno.fin).getTime(), fin.getTime());
  return Math.max(0, b - a);
}

const aMinutos = (ms) => Math.round(ms / MS_MINUTO);
const aHoras = (ms) => Math.round((ms / MS_HORA) * 100) / 100;

function crearServicioHoras({ repoTurnos, repoGrupos, repoUsuarios, zona = ZONA_POR_DEFECTO }) {
  async function obtenerActor(actorId) {
    const actor = actorId ? await repoUsuarios.buscarPorId(actorId) : null;
    if (!actor) throw new ErrorApp('NO_AUTENTICADO', 'Debes iniciar sesión', 401);
    return actor;
  }

  return {
    // Las horas del propio usuario en un mes, sumando todos sus grupos
    async horasMias(actorId, { mes } = {}) {
      const actor = await obtenerActor(actorId);
      const { inicio, fin } = limitesDelMes(mes, zona);
      const nombres = new Map((await repoGrupos.listarGruposDeUsuario(actor.id)).map((g) => [g.id, g.nombre]));
      const turnos = await repoTurnos.listarPorRango({ desde: inicio, hasta: fin, empleadoId: actor.id });

      let total = 0;
      const porGrupo = new Map();
      for (const t of turnos) {
        const ms = msEnRango(t, inicio, fin);
        total += ms;
        porGrupo.set(t.grupoId, (porGrupo.get(t.grupoId) || 0) + ms);
      }
      return {
        mes, zona, minutos: aMinutos(total), horas: aHoras(total),
        porGrupo: [...porGrupo].map(([grupoId, ms]) => ({
          grupoId, grupoNombre: nombres.get(grupoId) || null, minutos: aMinutos(ms), horas: aHoras(ms),
        })).sort((a, b) => String(a.grupoNombre).localeCompare(String(b.grupoNombre))),
      };
    },

    // Las horas de cada empleado de un grupo: solo para su encargado
    async horasDelGrupo(actorId, grupoId, { mes } = {}) {
      await obtenerActor(actorId);
      const grupo = typeof grupoId === 'string' ? await repoGrupos.buscarGrupo(grupoId) : null;
      const membresia = grupo ? await repoGrupos.buscarMembresia(grupoId, actorId) : null;
      if (!grupo || !membresia) throw new ErrorApp('NO_ENCONTRADO', 'El grupo no existe', 404);
      if (membresia.rol !== 'encargado') {
        throw new ErrorApp('PROHIBIDO', 'Solo el encargado del grupo puede consultar las horas del equipo', 403);
      }
      const { inicio, fin } = limitesDelMes(mes, zona);
      const turnos = await repoTurnos.listarPorRango({ desde: inicio, hasta: fin, grupoId });

      const msPorEmpleado = new Map();
      // Todos los empleados actuales aparecen (aunque tengan 0 horas)...
      for (const m of await repoGrupos.listarMiembros(grupoId)) {
        if (m.rol === 'empleado') msPorEmpleado.set(m.usuarioId, 0);
      }
      // ...y también quien ya no está pero tiene turnos pasados ese mes
      let total = 0;
      for (const t of turnos) {
        const ms = msEnRango(t, inicio, fin);
        total += ms;
        msPorEmpleado.set(t.empleadoId, (msPorEmpleado.get(t.empleadoId) || 0) + ms);
      }
      const emails = new Map((await repoUsuarios.listar()).map((u) => [u.id, u.email]));
      return {
        mes, zona, grupoId, minutos: aMinutos(total), horas: aHoras(total),
        empleados: [...msPorEmpleado].map(([id, ms]) => ({
          id, email: emails.get(id) || null, minutos: aMinutos(ms), horas: aHoras(ms),
        })).sort((a, b) => String(a.email).localeCompare(String(b.email))),
      };
    },
  };
}

module.exports = { crearServicioHoras, limitesDelMes, msEnRango };