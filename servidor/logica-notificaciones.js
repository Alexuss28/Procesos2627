const crypto = require('crypto');
const { ErrorApp } = require('./logica');

const ZONA = 'Europe/Madrid';
const LIMITE_POR_DEFECTO = 30;
const LIMITE_MAXIMO = 100;

// "mié, 2 dic, 09:00–13:00" en la hora de Madrid (los avisos se escriben en el servidor)
function describirFranja(inicio, fin, zona = ZONA) {
  const i = new Date(inicio);
  const f = new Date(fin);
  const dia = new Intl.DateTimeFormat('es-ES', { timeZone: zona, weekday: 'short', day: 'numeric', month: 'short' }).format(i);
  const hora = (d) => new Intl.DateTimeFormat('es-ES', {
    timeZone: zona, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(d);
  return `${dia}, ${hora(i)}–${hora(f)}`;
}

function crearServicioNotificaciones({ repo, repoUsuarios, log = () => {} }) {
  async function obtenerActor(actorId) {
    const actor = actorId ? await repoUsuarios.buscarPorId(actorId) : null;
    if (!actor) throw new ErrorApp('NO_AUTENTICADO', 'Debes iniciar sesión', 401);
    return actor;
  }

  return {
    // Lo usan los demás servicios cuando pasa algo que otra persona debe saber.
    // Una notificación que falla NUNCA debe romper la operación principal: solo se anota en el log.
    async notificar(usuarioIds, { tipo, mensaje, grupoId = null }) {
      try {
        for (const usuarioId of new Set((usuarioIds || []).filter(Boolean))) {
          await repo.crear({
            id: crypto.randomUUID(), usuarioId, grupoId, tipo, mensaje, leida: false, creadaEn: new Date(),
          });
        }
      } catch (e) {
        log('error', 'no se pudo crear la notificación', { motivo: e.message });
      }
    },

    async listar(actorId, { limite } = {}) {
      const actor = await obtenerActor(actorId);
      const n = Number.isInteger(Number(limite)) && Number(limite) > 0
        ? Math.min(Number(limite), LIMITE_MAXIMO) : LIMITE_POR_DEFECTO;
      const lista = await repo.listar(actor.id, { limite: n });
      return {
        noLeidas: await repo.contarNoLeidas(actor.id),
        notificaciones: lista.map((x) => ({
          id: x.id, tipo: x.tipo, mensaje: x.mensaje, grupoId: x.grupoId,
          leida: x.leida, creadaEn: new Date(x.creadaEn).toISOString(),
        })),
      };
    },

    async marcarLeida(actorId, id) {
      const actor = await obtenerActor(actorId);
      if (!(await repo.marcarLeida(id, actor.id))) {
        throw new ErrorApp('NO_ENCONTRADO', 'La notificación no existe', 404);
      }
    },

    async marcarTodasLeidas(actorId) {
      const actor = await obtenerActor(actorId);
      await repo.marcarTodasLeidas(actor.id);
    },
  };
}

module.exports = { crearServicioNotificaciones, describirFranja };