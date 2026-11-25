// Vista "Calendario": rejilla semanal con las personas en filas y los días en columnas, como un cuadro de turnos.
// El encargado crea turnos pulsando en una celda y los edita pulsando en un bloque; los empleados consultan
// y, desde un turno suyo, pueden pedir un cambio.
const VistaCalendario = (() => {
  const { h, campo, accion, modal, confirmar, toast, avatar, color } = UI;

  let lunes = UI.lunesDe(new Date()); // semana que se muestra (se recuerda al cambiar de sección)
  let modo = 'equipo';                // 'equipo' (calendario del grupo) | 'mios' (mis turnos en todos mis grupos)

  const nombre = (email) => String(email || '').split('@')[0];

  async function montar(cont, ctx) {
    const { grupo, yo } = ctx;
    const esEncargado = grupo.miRol === 'encargado';
    const hasta = UI.sumarDias(lunes, 7);
    const turnos = modo === 'mios'
      ? await Rest.misTurnos(lunes.toISOString(), hasta.toISOString())
      : await Rest.turnosEquipo(grupo.id, lunes.toISOString(), hasta.toISOString());
    const personas = modo === 'mios'
      ? [{ usuarioId: yo.id, email: yo.email }]
      : grupo.miembros.filter((m) => m.rol === 'empleado');

    // Reparto de los turnos por persona y día (un turno cuenta en el día en que empieza)
    const dias = Array.from({ length: 7 }, (_, i) => UI.sumarDias(lunes, i));
    const hoy = UI.claveDia(new Date());
    const clavesSemana = new Set(dias.map(UI.claveDia));
    const celdas = new Map();
    const minutosSemana = new Map();
    for (const t of turnos) {
      const dia = UI.claveDia(new Date(t.inicio));
      if (!clavesSemana.has(dia)) continue; // empezó la semana anterior: se ve allí
      const clave = `${t.empleadoId}|${dia}`;
      if (!celdas.has(clave)) celdas.set(clave, []);
      celdas.get(clave).push(t);
      minutosSemana.set(t.empleadoId,
        (minutosSemana.get(t.empleadoId) || 0) + Math.round((new Date(t.fin) - new Date(t.inicio)) / 60000));
    }

    const editable = esEncargado && modo === 'equipo';
    const bloque = (t) => h('button', {
      class: `turno ${t.empleadoId === yo.id ? 'propio' : ''}`,
      style: `--c:${color(t.empleadoId)}`,
      title: t.nota || '',
      onclick: (e) => { e.stopPropagation(); detalle(ctx, t); },
    },
    UI.franjaHoras(t),
    modo === 'mios' ? h('small', {}, t.grupoNombre || '') : (t.nota ? h('small', {}, t.nota) : null));

    const celdaPersona = (p) => h('div', { class: 'cal-persona' },
      avatar(p.email, p.usuarioId),
      h('div', {}, h('strong', {}, nombre(p.email)), h('small', {}, `${UI.minutos(minutosSemana.get(p.usuarioId) || 0)} esta semana`)));

    const celdaDia = (p, d) => {
      const clave = UI.claveDia(d);
      return h('div', {
        class: `cal-celda ${clave === hoy ? 'hoy' : ''} ${editable ? 'editable' : ''}`,
        onclick: editable ? () => formTurno(ctx, { empleadoId: p.usuarioId, dia: d }) : null,
      }, (celdas.get(`${p.usuarioId}|${clave}`) || []).map(bloque));
    };

    // ---- Barra de herramientas ----
    const mover = (n) => { lunes = UI.sumarDias(lunes, n); return ctx.refrescar(); };
    const rango = `${lunes.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} – `
      + `${UI.sumarDias(lunes, 6).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}`;
    const barra = h('div', { class: 'barra-herr' },
      h('div', { class: 'nav-semana' },
        h('button', { class: 'btn', 'aria-label': 'Semana anterior', onclick: () => mover(-7) }, '‹'),
        h('button', { class: 'btn', 'aria-label': 'Semana siguiente', onclick: () => mover(7) }, '›'),
        h('button', { class: 'btn', onclick: () => { lunes = UI.lunesDe(new Date()); return ctx.refrescar(); } }, 'Hoy'),
        h('strong', { class: 'rango' }, rango)),
      h('div', { class: 'herr-der' },
        h('div', { class: 'segmentado' },
          [['equipo', 'Equipo'], ['mios', 'Mis turnos']].map(([valor, texto]) => h('button', {
            class: modo === valor ? 'activo' : '',
            onclick: () => { modo = valor; return ctx.refrescar(); },
          }, texto))),
        h('button', { class: 'btn', onclick: () => modalLibres(ctx) }, '¿Quién está libre?'),
        esEncargado ? h('button', { class: 'btn primario', onclick: () => formTurno(ctx, {}) }, '＋ Nuevo turno') : null));

    const rejilla = h('div', { class: 'cal-rejilla', role: 'grid' },
      h('div', { class: 'cal-esquina' }, `${personas.length} ${personas.length === 1 ? 'persona' : 'personas'}`),
      dias.map((d) => h('div', { class: `cal-dia ${UI.claveDia(d) === hoy ? 'hoy' : ''}` },
        h('strong', {}, d.getDate()),
        h('span', {}, d.toLocaleDateString('es-ES', { weekday: 'short' })))),
      personas.map((p) => [celdaPersona(p), dias.map((d) => celdaDia(p, d))]));

    // replaceChildren escribiría la palabra "null" si le llega un null: se descartan los huecos
    cont.replaceChildren(...[
      barra,
      personas.length
        ? h('div', { class: 'cal' }, rejilla)
        : h('div', { class: 'tarjeta vacio' },
          h('div', { class: 'emoji' }, '👥'),
          h('h3', {}, 'Aún no hay empleados en el grupo'),
          h('p', {}, 'Invita a tu equipo para poder asignarles turnos.'),
          h('button', { class: 'btn primario', onclick: () => ctx.irA('equipo') }, 'Ir a Equipo')),
      editable && personas.length ? h('p', { class: 'sub' }, 'Pulsa en una celda para crear un turno, o en un bloque para editarlo.') : null,
    ].filter(Boolean));
  }

  // ---- Crear o editar un turno (encargado) ----
  function formTurno(ctx, { turno, empleadoId, dia } = {}) {
    const empleados = ctx.grupo.miembros.filter((m) => m.rol === 'empleado');
    if (!empleados.length) {
      toast('Invita primero a algún empleado desde la sección Equipo.', 'error');
      return;
    }
    const inicioPorDefecto = new Date(dia || new Date());
    inicioPorDefecto.setHours(9, 0, 0, 0);
    const finPorDefecto = new Date(inicioPorDefecto);
    finPorDefecto.setHours(17, 0, 0, 0);

    const selEmpleado = h('select', { value: turno ? turno.empleadoId : (empleadoId || empleados[0].usuarioId) },
      empleados.map((m) => h('option', { value: m.usuarioId }, m.email)));
    const inicio = h('input', { type: 'datetime-local', value: UI.aInputLocal(turno ? turno.inicio : inicioPorDefecto.toISOString()) });
    const fin = h('input', { type: 'datetime-local', value: UI.aInputLocal(turno ? turno.fin : finPorDefecto.toISOString()) });
    const nota = h('input', { type: 'text', maxlength: 200, placeholder: 'Opcional', value: turno ? (turno.nota || '') : '' });

    modal({
      titulo: turno ? 'Editar turno' : 'Nuevo turno',
      cuerpo: [campo('Empleado', selEmpleado), campo('Inicio', inicio), campo('Fin', fin), campo('Nota', nota)],
      acciones: [
        turno ? {
          texto: 'Eliminar turno',
          clase: 'peligro',
          onclick: async (cerrar) => {
            if (!(await confirmar('¿Eliminar este turno? El empleado recibirá un aviso.', 'Eliminar'))) return;
            await Rest.eliminarTurno(turno.id);
            cerrar();
            toast('Turno eliminado');
            await ctx.refrescar();
          },
        } : null,
        { texto: 'Cancelar', onclick: (cerrar) => cerrar() },
        {
          texto: 'Guardar',
          clase: 'primario',
          onclick: async (cerrar) => {
            const cuerpo = {
              empleadoId: selEmpleado.value,
              inicio: UI.desdeInput(inicio.value),
              fin: UI.desdeInput(fin.value),
              nota: nota.value,
            };
            if (turno) await Rest.editarTurno(turno.id, cuerpo);
            else await Rest.crearTurno(ctx.grupo.id, cuerpo);
            cerrar();
            toast(turno ? 'Turno actualizado' : 'Turno creado');
            await ctx.refrescar();
          },
        },
      ].filter(Boolean),
    });
  }

  // ---- Detalle de un turno (empleados y vista "Mis turnos") ----
  function detalle(ctx, t) {
    const { grupo, yo } = ctx;
    if (grupo.miRol === 'encargado' && modo === 'equipo') return formTurno(ctx, { turno: t });
    const futuro = new Date(t.inicio) > new Date();
    const propio = t.empleadoId === yo.id;
    const acciones = [];
    if (futuro && propio && t.grupoId === grupo.id && grupo.miRol === 'empleado') {
      acciones.push({
        texto: 'Pedir un cambio',
        clase: 'primario',
        onclick: (cerrar) => { cerrar(); return VistaSolicitudes.nueva(ctx, { turnoId: t.id }); },
      });
    }
    if (futuro && !propio && modo === 'equipo' && grupo.miRol === 'empleado') {
      acciones.push({
        texto: 'Proponer intercambio',
        onclick: (cerrar) => { cerrar(); return VistaSolicitudes.nueva(ctx, { tipo: 'intercambio', companeroId: t.empleadoId, destinoId: t.id }); },
      });
    }
    acciones.push({ texto: 'Cerrar', onclick: (cerrar) => cerrar() });
    const quien = t.empleadoEmail || yo.email;
    modal({
      titulo: 'Turno',
      cuerpo: [
        h('div', { class: 'fila-miembro' }, avatar(quien, t.empleadoId), h('div', { class: 'grande' }, h('strong', {}, quien))),
        h('p', {}, UI.franja(t)),
        modo === 'mios' && t.grupoNombre ? h('p', { class: 'sub' }, `Grupo: ${t.grupoNombre}`) : null,
        t.nota ? h('p', { class: 'sub' }, `Nota: ${t.nota}`) : null,
      ],
      acciones,
    });
  }

  // ---- ¿Quién está libre en una franja? ----
  function modalLibres(ctx) {
    const ini = new Date();
    ini.setHours(9, 0, 0, 0);
    const fin = new Date(ini);
    fin.setHours(17, 0, 0, 0);
    const desde = h('input', { type: 'datetime-local', value: UI.aInputLocal(ini.toISOString()) });
    const hasta = h('input', { type: 'datetime-local', value: UI.aInputLocal(fin.toISOString()) });
    const resultado = h('div', {});
    modal({
      titulo: '¿Quién está libre?',
      cuerpo: [
        h('p', { class: 'sub' }, 'Empleados del grupo sin ningún turno en esa franja, en ninguno de sus grupos.'),
        campo('Desde', desde), campo('Hasta', hasta), resultado,
      ],
      acciones: [
        { texto: 'Cerrar', onclick: (cerrar) => cerrar() },
        {
          texto: 'Consultar',
          clase: 'primario',
          onclick: async () => { // no cierra la ventana: muestra el resultado debajo
            const libres = await Rest.disponibilidad(ctx.grupo.id, UI.desdeInput(desde.value), UI.desdeInput(hasta.value));
            resultado.replaceChildren(...(libres.length
              ? libres.map((u) => h('div', { class: 'fila-miembro' }, avatar(u.email, u.id), h('div', { class: 'grande' }, u.email)))
              : [h('p', { class: 'sub' }, 'Nadie está libre en esa franja.')]));
          },
        },
      ],
    });
  }

  return { montar };
})();