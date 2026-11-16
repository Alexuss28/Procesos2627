// Presentación de los turnos de un grupo. Habla con el servidor solo a través de Rest (rest.js)
// y usa los helpers mostrar() y accion() definidos en index.html.
// Grupos.abrir() la activa con Turnos.abrir(grupo, usuario) y Turnos.cerrar() al salir del grupo.
const Turnos = (() => {
  const q = (id) => document.getElementById(id);

  let yo = null;
  let grupo = null;    // { id, nombre, miRol, miembros } del grupo abierto
  let lunes = null;    // inicio (Date) de la semana que se muestra
  let editando = null; // id del turno que el encargado está editando
  let eventosRegistrados = false;

  const esEncargado = () => Boolean(grupo) && grupo.miRol === 'encargado';
  const vistaActual = () => document.querySelector('input[name="t-vista"]:checked').value;

  // ---- Fechas: el servidor trabaja en UTC (ISO); el navegador las muestra en la hora local ----
  function lunesDe(fecha) {
    const d = new Date(fecha);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
  }
  function sumarDias(fecha, n) {
    const d = new Date(fecha);
    d.setDate(d.getDate() + n);
    return d;
  }
  const fmtFechaHora = (iso) => new Date(iso).toLocaleString('es-ES', {
    weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const aInputLocal = (iso) => {
    const d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };
  function desdeInput(valor) {
    if (!valor) throw new Error('Rellena las fechas de inicio y de fin');
    return new Date(valor).toISOString(); // datetime-local (hora local) -> ISO en UTC
  }

  // ---- Tabla de turnos ----
  function celda(texto) {
    const td = document.createElement('td');
    td.textContent = texto; // textContent evita inyección de HTML
    return td;
  }

  function pintarTabla(lista, vista) {
    const tbody = q('t-tabla');
    tbody.replaceChildren();
    q('t-vacio').classList.toggle('oculto', lista.length > 0);

    for (const t of lista) {
      const fila = document.createElement('tr');
      fila.append(
        celda(t.empleadoEmail || yo.email),
        celda(vista === 'equipo' ? grupo.nombre : (t.grupoNombre || '—')),
        celda(fmtFechaHora(t.inicio)),
        celda(fmtFechaHora(t.fin)),
        celda(t.nota || '')
      );
      const acciones = document.createElement('td');
      // Solo el encargado edita, y solo los turnos de este grupo
      if (esEncargado() && vista === 'equipo') {
        const bEditar = document.createElement('button');
        bEditar.textContent = 'Editar';
        bEditar.onclick = () => empezarEdicion(t);
        const bBorrar = document.createElement('button');
        bBorrar.textContent = 'Eliminar';
        bBorrar.onclick = () => accion(async () => {
          if (!confirm('¿Eliminar este turno?')) return;
          await Rest.eliminarTurno(t.id);
          if (editando === t.id) cancelarEdicion();
          await cargar();
        });
        acciones.append(bEditar, bBorrar);
      }
      fila.appendChild(acciones);
      tbody.appendChild(fila);
    }
  }

  async function cargar() {
    const hasta = sumarDias(lunes, 7);
    q('t-semana').textContent =
      `${lunes.toLocaleDateString('es-ES')} – ${sumarDias(lunes, 6).toLocaleDateString('es-ES')}`;
    const vista = vistaActual();
    const lista = vista === 'mios'
      ? await Rest.misTurnos(lunes.toISOString(), hasta.toISOString())
      : await Rest.turnosEquipo(grupo.id, lunes.toISOString(), hasta.toISOString());
    pintarTabla(lista, vista);
  }

  // ---- Formulario del encargado ----
  function llenarEmpleados() {
    const select = q('t-empleado');
    select.replaceChildren();
    const empleados = grupo.miembros.filter((m) => m.rol === 'empleado');
    q('t-sin-empleados').classList.toggle('oculto', empleados.length > 0);
    for (const m of empleados) {
      const op = document.createElement('option');
      op.value = m.usuarioId;
      op.textContent = m.email;
      select.appendChild(op);
    }
  }

  function empezarEdicion(t) {
    editando = t.id;
    q('t-form-titulo').textContent = 'Editar turno';
    q('t-guardar').textContent = 'Guardar cambios';
    q('t-cancelar').classList.remove('oculto');
    q('t-empleado').value = t.empleadoId;
    q('t-inicio').value = aInputLocal(t.inicio);
    q('t-fin').value = aInputLocal(t.fin);
    q('t-nota').value = t.nota || '';
    q('t-admin').scrollIntoView({ behavior: 'smooth' });
  }

  function cancelarEdicion() {
    editando = null;
    q('t-form-titulo').textContent = 'Nuevo turno';
    q('t-guardar').textContent = 'Crear turno';
    q('t-cancelar').classList.add('oculto');
    q('t-inicio').value = '';
    q('t-fin').value = '';
    q('t-nota').value = '';
  }

  // ---- Eventos (se registran una sola vez) ----
  function registrarEventos() {
    q('t-anterior').onclick = () => accion(async () => { lunes = sumarDias(lunes, -7); await cargar(); });
    q('t-siguiente').onclick = () => accion(async () => { lunes = sumarDias(lunes, 7); await cargar(); });
    q('t-hoy').onclick = () => accion(async () => { lunes = lunesDe(new Date()); await cargar(); });
    for (const r of document.querySelectorAll('input[name="t-vista"]')) {
      r.onchange = () => accion(cargar);
    }

    q('t-guardar').onclick = () => accion(async () => {
      const cuerpo = {
        empleadoId: q('t-empleado').value,
        inicio: desdeInput(q('t-inicio').value),
        fin: desdeInput(q('t-fin').value),
        nota: q('t-nota').value,
      };
      if (editando) {
        await Rest.editarTurno(editando, cuerpo);
        mostrar('Turno actualizado.', 'ok');
      } else {
        await Rest.crearTurno(grupo.id, cuerpo);
        mostrar('Turno creado.', 'ok');
      }
      cancelarEdicion();
      await cargar();
    });
    q('t-cancelar').onclick = cancelarEdicion;

    q('t-buscar-disp').onclick = () => accion(async () => {
      const libres = await Rest.disponibilidad(
        grupo.id, desdeInput(q('t-disp-inicio').value), desdeInput(q('t-disp-fin').value));
      const ul = q('t-disp-resultado');
      ul.replaceChildren();
      if (!libres.length) {
        const li = document.createElement('li');
        li.textContent = 'Nadie está disponible en esa franja.';
        ul.appendChild(li);
        return;
      }
      for (const u of libres) {
        const li = document.createElement('li');
        li.textContent = u.email;
        ul.appendChild(li);
      }
    });
  }

  return {
    // Se llama desde Grupos.abrir() con el detalle del grupo y el usuario de la sesión
    async abrir(detalleGrupo, usuario) {
      yo = usuario;
      grupo = detalleGrupo;
      if (!eventosRegistrados) { registrarEventos(); eventosRegistrados = true; }
      q('zona-turnos').classList.remove('oculto');
      q('t-admin').classList.toggle('oculto', !esEncargado());
      llenarEmpleados();
      document.querySelector('input[name="t-vista"][value="equipo"]').checked = true;
      lunes = lunesDe(new Date());
      cancelarEdicion();
      q('t-disp-resultado').replaceChildren();
      try {
        await cargar();
      } catch (e) {
        mostrar(e.message); // sin accion(): no se borra el mensaje que haya mostrado quien nos llama
      }
    },
    cerrar() {
      grupo = null;
      editando = null;
      q('zona-turnos').classList.add('oculto');
    },
  };
})();