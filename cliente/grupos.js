// Presentación de los grupos de trabajo e invitaciones. Habla con el servidor solo a través de Rest
// y usa los helpers mostrar() y accion() definidos en index.html.
const Grupos = (() => {
  const q = (id) => document.getElementById(id);

  let yo = null;
  let grupoActual = null; // detalle del grupo abierto: { id, nombre, miRol, miembros }
  let eventosRegistrados = false;

  const ROL = { encargado: 'Encargado', empleado: 'Empleado' };

  function boton(texto, onclick) {
    const b = document.createElement('button');
    b.textContent = texto;
    b.onclick = onclick;
    return b;
  }
  function celda(texto) {
    const td = document.createElement('td');
    td.textContent = texto; // textContent evita inyección de HTML
    return td;
  }

  // ---------------------------------------------------------------- Lista de grupos e invitaciones
  async function cargarLista() {
    const [grupos, invitaciones] = await Promise.all([Rest.misGrupos(), Rest.misInvitaciones()]);

    const ulInv = q('g-lista-invitaciones');
    ulInv.replaceChildren();
    q('g-invitaciones').classList.toggle('oculto', invitaciones.length === 0);
    for (const inv of invitaciones) {
      const li = document.createElement('li');
      li.append(
        `Te han invitado al grupo «${inv.grupoNombre}» `, // los textos se añaden como texto, no como HTML
        boton('Aceptar', () => accion(async () => {
          await Rest.aceptarInvitacion(inv.id);
          mostrar(`Te has unido al grupo «${inv.grupoNombre}».`, 'ok');
          await cargarLista();
        })),
        boton('Rechazar', () => accion(async () => {
          await Rest.rechazarInvitacion(inv.id);
          await cargarLista();
        }))
      );
      ulInv.appendChild(li);
    }

    const ul = q('g-lista');
    ul.replaceChildren();
    q('g-vacio').classList.toggle('oculto', grupos.length > 0);
    for (const g of grupos) {
      const li = document.createElement('li');
      li.append(
        `${g.nombre} — ${ROL[g.miRol]} · ${g.numMiembros} ${g.numMiembros === 1 ? 'miembro' : 'miembros'} `,
        boton('Abrir', () => accion(() => abrir(g.id)))
      );
      ul.appendChild(li);
    }
  }

  function mostrarLista() {
    Turnos.cerrar();
    Solicitudes.cerrar();
    Horas.cerrar();
    grupoActual = null;
    q('g-vista-lista').classList.remove('oculto');
    q('g-invitaciones').classList.remove('oculto');
    q('g-vista-detalle').classList.add('oculto');
  }

  // ---------------------------------------------------------------- Detalle de un grupo
  async function abrir(grupoId) {
    grupoActual = await Rest.obtenerGrupo(grupoId);
    const esEncargado = grupoActual.miRol === 'encargado';

    q('g-vista-lista').classList.add('oculto');
    q('g-invitaciones').classList.add('oculto');
    q('g-vista-detalle').classList.remove('oculto');
    q('g-titulo').textContent = grupoActual.nombre;
    q('g-rol').textContent = `Tu rol en este grupo: ${ROL[grupoActual.miRol]}`;
    q('g-zona-encargado').classList.toggle('oculto', !esEncargado);
    q('g-salir').classList.toggle('oculto', esEncargado);

    const tbody = q('g-miembros');
    tbody.replaceChildren();
    for (const m of grupoActual.miembros) {
      const fila = document.createElement('tr');
      fila.append(celda(m.email || ''), celda(ROL[m.rol]));
      const acciones = document.createElement('td');
      if (esEncargado && m.rol === 'empleado') {
        acciones.appendChild(boton('Expulsar', () => accion(async () => {
          if (!confirm(`¿Expulsar a ${m.email} del grupo? Se borrarán sus turnos futuros.`)) return;
          await Rest.expulsar(grupoActual.id, m.usuarioId);
          await abrir(grupoActual.id);
        })));
      }
      fila.appendChild(acciones);
      tbody.appendChild(fila);
    }

    if (esEncargado) await cargarPendientes();
    await Turnos.abrir(grupoActual, yo);
    await Solicitudes.abrir(grupoActual, yo);
    await Horas.abrir(grupoActual, yo);
  }

  async function cargarPendientes() {
    const pendientes = await Rest.invitacionesGrupo(grupoActual.id);
    const ul = q('g-pendientes');
    ul.replaceChildren();
    if (!pendientes.length) {
      const li = document.createElement('li');
      li.textContent = 'No hay invitaciones pendientes.';
      ul.appendChild(li);
      return;
    }
    for (const inv of pendientes) {
      const li = document.createElement('li');
      li.append(`${inv.email} `, boton('Cancelar', () => accion(async () => {
        await Rest.cancelarInvitacion(grupoActual.id, inv.id);
        await cargarPendientes();
      })));
      ul.appendChild(li);
    }
  }

  // ---------------------------------------------------------------- Eventos (se registran una sola vez)
  function registrarEventos() {
    q('g-crear').onclick = () => accion(async () => {
      const g = await Rest.crearGrupo(q('g-nombre').value);
      q('g-nombre').value = '';
      mostrar(`Grupo «${g.nombre}» creado. Ya puedes invitar a tu equipo.`, 'ok');
      await abrir(g.id);
    });

    q('g-volver').onclick = () => accion(async () => {
      mostrarLista();
      await cargarLista();
    });

    q('g-invitar').onclick = () => accion(async () => {
      const email = q('g-invitar-email').value;
      await Rest.invitar(grupoActual.id, email);
      q('g-invitar-email').value = '';
      mostrar('Invitación enviada. La persona la verá al entrar en la aplicación.', 'ok');
      await cargarPendientes();
    });

    q('g-salir').onclick = () => accion(async () => {
      if (!confirm('¿Salir del grupo? Se borrarán tus turnos futuros en él.')) return;
      await Rest.salirDelGrupo(grupoActual.id);
      mostrar('Has salido del grupo.', 'ok');
      mostrarLista();
      await cargarLista();
    });

    q('g-eliminar-grupo').onclick = () => accion(async () => {
      if (!confirm(`¿Eliminar el grupo «${grupoActual.nombre}»? Se borrarán sus miembros, invitaciones y turnos.`)) return;
      await Rest.eliminarGrupo(grupoActual.id);
      mostrar('Grupo eliminado.', 'ok');
      mostrarLista();
      await cargarLista();
    });
  }

  return {
    // Se llama desde index.html cuando hay una sesión iniciada
    async iniciar(usuario) {
      yo = usuario;
      if (!eventosRegistrados) { registrarEventos(); eventosRegistrados = true; }
      q('zona-grupos').classList.remove('oculto');
      mostrarLista();
      await accion(cargarLista);
    },
    limpiar() {
      yo = null;
      grupoActual = null;
      Turnos.cerrar();
      Solicitudes.cerrar();
      Horas.cerrar();
      q('zona-grupos').classList.add('oculto');
    },
  };
})();