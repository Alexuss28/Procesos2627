// Vista "Horas": horas trabajadas en un mes (en hora de Madrid). Cada persona ve las suyas; el encargado, las del equipo.
const VistaHoras = (() => {
  const { h, avatar, toast } = UI;

  let mes = null; // "AAAA-MM"; se recuerda al cambiar de sección
  const mesActual = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  async function montar(cont, ctx) {
    const { grupo } = ctx;
    const esEncargado = grupo.miRol === 'encargado';
    mes = mes || mesActual();
    const [mias, equipo] = await Promise.all([
      Rest.horasMias(mes),
      esEncargado ? Rest.horasGrupo(grupo.id, mes) : null,
    ]);
    const maximo = equipo ? Math.max(1, ...equipo.empleados.map((e) => e.minutos)) : 1;

    // Firefox no tiene selector de mes y deja escribir texto: se comprueba el formato antes de pedirlo
    const selector = h('input', {
      type: 'month',
      value: mes,
      placeholder: 'AAAA-MM',
      'aria-label': 'Mes',
      style: 'width:auto',
      onchange: (e) => {
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)) { toast('Escribe el mes con el formato AAAA-MM', 'error'); return; }
        mes = e.target.value;
        ctx.refrescar();
      },
    });

    // replaceChildren escribiría la palabra "null" si le llega un null: se descartan los huecos
    cont.replaceChildren(...[
      h('div', { class: 'cab-vista' },
        h('div', {},
          h('h2', {}, 'Horas trabajadas'),
          h('p', { class: 'sub' }, 'Calculadas a partir de los turnos de cada mes. Un turno que cruza de mes se reparte entre los dos.')),
        selector),
      h('div', { class: 'tarjetas-num' },
        h('div', { class: 'tarjeta' },
          h('span', { class: 'etiqueta-suave' }, 'Tus horas'),
          h('div', { class: 'num' }, UI.minutos(mias.minutos)),
          mias.porGrupo.length
            ? mias.porGrupo.map((g) => h('p', { class: 'sub' }, `${g.grupoNombre || 'Grupo anterior'}: ${UI.minutos(g.minutos)}`))
            : h('p', { class: 'sub' }, 'Sin turnos este mes')),
        equipo ? h('div', { class: 'tarjeta' },
          h('span', { class: 'etiqueta-suave' }, 'Horas del equipo'),
          h('div', { class: 'num' }, UI.minutos(equipo.minutos)),
          h('p', { class: 'sub' }, `${equipo.empleados.length} ${equipo.empleados.length === 1 ? 'empleado' : 'empleados'}`)) : null),
      equipo ? h('div', { class: 'tarjeta' },
        h('h3', {}, 'Por empleado'),
        h('table', { class: 'tabla' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Empleado'), h('th', {}, 'Horas'), h('th', {}, ''))),
          h('tbody', {}, equipo.empleados.map((e) => h('tr', {},
            h('td', {}, h('div', { class: 'fila-inline' }, avatar(e.email, e.id), e.email || '—')),
            h('td', {}, UI.minutos(e.minutos)),
            h('td', {}, h('div', { class: 'barra-horas' }, h('span', { style: `width:${Math.round((e.minutos / maximo) * 100)}%` }))))))))
        : null,
    ].filter(Boolean));
  }

  return { montar };
})();