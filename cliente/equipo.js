// Vista "Equipo": miembros del grupo, invitaciones y gestión del grupo.
const VistaEquipo = (() => {
  const { h, accion, avatar, confirmar, toast } = UI;
  const ROL = { encargado: 'Encargado', empleado: 'Empleado' };

  async function montar(cont, ctx) {
    const { grupo, yo } = ctx;
    const esEncargado = grupo.miRol === 'encargado';
    const pendientes = esEncargado ? await Rest.invitacionesGrupo(grupo.id) : [];

    const filas = grupo.miembros.map((m) => h('div', { class: 'fila-miembro' },
      avatar(m.email, m.usuarioId),
      h('div', { class: 'grande' },
        h('strong', {}, m.email || '—'),
        m.usuarioId === yo.id ? h('span', { class: 'sub' }, ' (tú)') : null),
      h('span', { class: `chip ${m.rol === 'encargado' ? 'marca' : ''}` }, ROL[m.rol]),
      esEncargado && m.rol === 'empleado'
        ? h('button', {
          class: 'btn pequeno',
          onclick: () => accion(async () => {
            if (!(await confirmar(`¿Expulsar a ${m.email}? Se borrarán sus turnos futuros en este grupo.`, 'Expulsar'))) return;
            await Rest.expulsar(grupo.id, m.usuarioId);
            toast(`${m.email} ya no está en el grupo`);
            await ctx.recargarGrupo();
          }),
        }, 'Expulsar')
        : null));

    const nodos = [
      h('div', { class: 'cab-vista' },
        h('div', {},
          h('h2', {}, grupo.nombre),
          h('p', { class: 'sub' }, `Tu rol en este grupo: ${ROL[grupo.miRol]} · ${grupo.miembros.length} ${grupo.miembros.length === 1 ? 'miembro' : 'miembros'}`))),
      h('div', { class: 'tarjeta' }, h('h3', {}, 'Miembros'), filas),
    ];

    if (esEncargado) {
      const correo = h('input', {
        type: 'email',
        placeholder: 'empleado@correo.com',
        onkeydown: (e) => { if (e.key === 'Enter') invitar(); },
      });
      const invitar = () => accion(async () => {
        await Rest.invitar(grupo.id, correo.value);
        toast('Invitación enviada. La verá al entrar en Turnado.');
        await ctx.refrescar();
      });
      nodos.push(h('div', { class: 'tarjeta' },
        h('h3', {}, 'Invitar a una persona'),
        h('p', { class: 'sub' }, 'Verá la invitación al entrar. Si aún no tiene cuenta, la esperará hasta que se registre con ese correo.'),
        h('div', { class: 'fila-formulario' }, correo, h('button', { class: 'btn primario', onclick: invitar }, 'Enviar invitación')),
        pendientes.length ? h('h4', { class: 'subtitulo' }, 'Invitaciones pendientes') : null,
        pendientes.map((inv) => h('div', { class: 'fila-miembro' },
          h('div', { class: 'grande' }, inv.email),
          h('button', {
            class: 'btn pequeno',
            onclick: () => accion(async () => {
              await Rest.cancelarInvitacion(grupo.id, inv.id);
              await ctx.refrescar();
            }),
          }, 'Cancelar')))));
    }

    nodos.push(h('div', { class: 'tarjeta zona-peligro' },
      h('h3', {}, esEncargado ? 'Eliminar el grupo' : 'Salir del grupo'),
      h('p', { class: 'sub' }, esEncargado
        ? 'Se borrarán sus miembros, invitaciones, turnos y solicitudes. Los demás miembros recibirán un aviso.'
        : 'Se borrarán tus turnos futuros en este grupo. El historial de horas se conserva.'),
      h('button', {
        class: 'btn peligro',
        onclick: () => accion(async () => {
          const pregunta = esEncargado
            ? `¿Eliminar el grupo «${grupo.nombre}»? Esta acción no se puede deshacer.`
            : `¿Salir del grupo «${grupo.nombre}»?`;
          if (!(await confirmar(pregunta, esEncargado ? 'Eliminar grupo' : 'Salir'))) return;
          if (esEncargado) await Rest.eliminarGrupo(grupo.id); else await Rest.salirDelGrupo(grupo.id);
          toast(esEncargado ? 'Grupo eliminado' : 'Has salido del grupo');
          await ctx.recargarGrupos();
        }),
      }, esEncargado ? 'Eliminar grupo' : 'Salir del grupo')));

    cont.replaceChildren(...nodos);
  }

  return { montar };
})();