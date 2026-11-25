// Vista "Solicitudes": cambios de turno (cesión o intercambio) que piden los empleados y resuelve el encargado.
const VistaSolicitudes = (() => {
  const { h, campo, accion, modal, toast } = UI;
  const ESTADO = { pendiente: ['Pendiente', 'aviso'], aprobada: ['Aprobada', 'ok'], rechazada: ['Rechazada', 'error'], cancelada: ['Cancelada', ''] };
  const TIPO = { cesion: 'Cesión', intercambio: 'Intercambio' };
  const DIAS_VISTA = 60; // se pueden cambiar los turnos de los próximos 60 días

  let filtro = 'pendiente'; // 'pendiente' | 'todas'
  const nombre = (email) => String(email || '').split('@')[0];

  function descripcion(s) {
    const a = nombre(s.solicitante.email);
    const b = nombre(s.companero.email);
    return s.tipo === 'cesion'
      ? `${a} cede a ${b} su turno del ${UI.franja(s.turnoOrigen)}`
      : `${a} cambia su turno del ${UI.franja(s.turnoOrigen)} por el de ${b} del ${UI.franja(s.turnoDestino)}`;
  }

  async function montar(cont, ctx) {
    const { grupo } = ctx;
    const esEncargado = grupo.miRol === 'encargado';
    const todas = await Rest.solicitudes(grupo.id);
    const pendientes = todas.filter((s) => s.estado === 'pendiente').length;
    const lista = filtro === 'pendiente' ? todas.filter((s) => s.estado === 'pendiente') : todas;

    cont.replaceChildren(
      h('div', { class: 'cab-vista' },
        h('div', {},
          h('h2', {}, 'Solicitudes de cambio'),
          h('p', { class: 'sub' }, esEncargado
            ? 'Aprueba o rechaza los cambios que piden tus empleados.'
            : 'Pide ceder o intercambiar un turno con un compañero. Lo resuelve el encargado.')),
        h('div', { class: 'herr-der' },
          h('div', { class: 'segmentado' },
            [['pendiente', `Pendientes (${pendientes})`], ['todas', 'Todas']].map(([valor, texto]) => h('button', {
              class: filtro === valor ? 'activo' : '',
              onclick: () => { filtro = valor; return ctx.refrescar(); },
            }, texto))),
          !esEncargado ? h('button', { class: 'btn primario', onclick: () => accion(() => nueva(ctx)) }, '＋ Nueva solicitud') : null)),
      lista.length
        ? h('div', { class: 'lista-tarjetas' }, lista.map((s) => tarjeta(s, ctx)))
        : h('div', { class: 'tarjeta vacio' },
          h('div', { class: 'emoji' }, '🔁'),
          h('h3', {}, filtro === 'pendiente' ? 'No hay solicitudes pendientes' : 'Todavía no hay solicitudes'),
          h('p', {}, esEncargado
            ? 'Cuando un empleado pida un cambio de turno, aparecerá aquí.'
            : 'Pulsa «Nueva solicitud» o abre un turno tuyo en el calendario.')));
  }

  function tarjeta(s, ctx) {
    const { yo, grupo } = ctx;
    const [textoEstado, claseEstado] = ESTADO[s.estado];
    const acciones = [];
    if (s.estado === 'pendiente') {
      if (s.solicitante.id === yo.id) {
        acciones.push(h('button', {
          class: 'btn pequeno',
          onclick: () => accion(async () => {
            await Rest.cancelarSolicitud(s.id);
            toast('Solicitud cancelada');
            await ctx.refrescar();
          }),
        }, 'Cancelar solicitud'));
      }
      if (grupo.miRol === 'encargado') {
        acciones.push(
          h('button', { class: 'btn primario pequeno', onclick: () => resolver(ctx, s, true) }, 'Aprobar'),
          h('button', { class: 'btn pequeno', onclick: () => resolver(ctx, s, false) }, 'Rechazar'));
      }
    }
    return h('div', { class: 'tarjeta' },
      h('div', { class: 'sol-cab' },
        h('span', { class: 'chip marca' }, TIPO[s.tipo]),
        h('span', { class: `chip ${claseEstado}` }, textoEstado),
        h('span', { class: 'sub' }, UI.relativo(s.creadaEn))),
      h('p', {}, h('strong', {}, descripcion(s))),
      s.motivo ? h('p', { class: 'sub' }, `Motivo: ${s.motivo}`) : null,
      s.comentario ? h('p', { class: 'sub' }, `Respuesta del encargado: ${s.comentario}`) : null,
      acciones.length ? h('div', { class: 'acciones' }, acciones) : null);
  }

  // El encargado aprueba o rechaza, con un comentario opcional para el empleado
  function resolver(ctx, s, aprobar) {
    const comentario = h('input', { type: 'text', maxlength: 200, placeholder: 'Opcional' });
    modal({
      titulo: aprobar ? 'Aprobar solicitud' : 'Rechazar solicitud',
      cuerpo: [
        h('p', {}, descripcion(s)),
        h('p', { class: 'sub' }, aprobar
          ? 'Al aprobar, el cambio se aplica en el calendario y se avisa a los dos empleados.'
          : 'El empleado recibirá un aviso con tu respuesta.'),
        campo(aprobar ? 'Comentario para el empleado' : 'Motivo del rechazo', comentario),
      ],
      acciones: [
        { texto: 'Cancelar', onclick: (cerrar) => cerrar() },
        {
          texto: aprobar ? 'Aprobar' : 'Rechazar',
          clase: aprobar ? 'primario' : 'peligro',
          onclick: async (cerrar) => {
            if (aprobar) await Rest.aprobarSolicitud(s.id, comentario.value);
            else await Rest.rechazarSolicitud(s.id, comentario.value);
            cerrar();
            toast(aprobar ? 'Solicitud aprobada: el calendario ya está actualizado.' : 'Solicitud rechazada.');
            await ctx.refrescar();
          },
        },
      ],
    });
  }

  // Formulario de una solicitud nueva. "prefill" permite abrirlo desde el calendario con datos ya elegidos.
  async function nueva(ctx, prefill = {}) {
    const { grupo, yo } = ctx;
    const desde = new Date();
    const hasta = new Date(desde.getTime() + DIAS_VISTA * 24 * 3600 * 1000);
    const [mios, equipo] = await Promise.all([
      Rest.misTurnos(desde.toISOString(), hasta.toISOString()),
      Rest.turnosEquipo(grupo.id, desde.toISOString(), hasta.toISOString()),
    ]);
    const futuros = (t) => new Date(t.inicio) > desde;
    const misTurnos = mios.filter((t) => t.grupoId === grupo.id && futuros(t));
    const delGrupo = equipo.filter(futuros);
    const companeros = grupo.miembros.filter((m) => m.rol === 'empleado' && m.usuarioId !== yo.id);
    if (!misTurnos.length) throw new Error('No tienes turnos futuros en este grupo para cambiar.');
    if (!companeros.length) throw new Error('No hay compañeros en el grupo con quien cambiar.');

    const tipo = h('select', { value: prefill.tipo || 'cesion', onchange: pintarDestino },
      h('option', { value: 'cesion' }, 'Ceder mi turno a un compañero'),
      h('option', { value: 'intercambio' }, 'Intercambiar mi turno por uno de un compañero'));
    const turno = h('select', { value: prefill.turnoId || misTurnos[0].id },
      misTurnos.map((t) => h('option', { value: t.id }, UI.franja(t))));
    const companero = h('select', { value: prefill.companeroId || companeros[0].usuarioId, onchange: llenarDestino },
      companeros.map((m) => h('option', { value: m.usuarioId }, m.email)));
    const destino = h('select', {});
    const zonaDestino = campo('Turno del compañero', destino);
    const motivo = h('input', { type: 'text', maxlength: 200, placeholder: 'Opcional' });

    function llenarDestino() {
      const deEse = delGrupo.filter((t) => t.empleadoId === companero.value);
      destino.replaceChildren(...(deEse.length
        ? deEse.map((t) => h('option', { value: t.id }, UI.franja(t)))
        : [h('option', { value: '' }, 'Ese compañero no tiene turnos futuros')]));
      if (prefill.destinoId && deEse.some((t) => t.id === prefill.destinoId)) destino.value = prefill.destinoId;
    }
    function pintarDestino() { zonaDestino.classList.toggle('oculto', tipo.value !== 'intercambio'); }
    llenarDestino();
    pintarDestino();

    modal({
      titulo: 'Nueva solicitud de cambio',
      cuerpo: [campo('Tipo de cambio', tipo), campo('Mi turno', turno), campo('Compañero', companero), zonaDestino, campo('Motivo', motivo)],
      acciones: [
        { texto: 'Cancelar', onclick: (cerrar) => cerrar() },
        {
          texto: 'Enviar solicitud',
          clase: 'primario',
          onclick: async (cerrar) => {
            const cuerpo = { tipo: tipo.value, turnoId: turno.value, companeroId: companero.value, motivo: motivo.value };
            if (tipo.value === 'intercambio') cuerpo.turnoDestinoId = destino.value;
            await Rest.crearSolicitud(grupo.id, cuerpo);
            cerrar();
            toast('Solicitud enviada. El encargado la revisará.');
            filtro = 'pendiente';
            await ctx.irA('solicitudes');
          },
        },
      ],
    });
  }

  return { montar, nueva };
})();