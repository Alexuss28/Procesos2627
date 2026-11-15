// Presentación de los turnos. Habla con el servidor solo a través de Rest (rest.js)
// y usa los helpers mostrar() y accion() definidos en index.html.
const Turnos = (() => {
  const q = (id) => document.getElementById(id);

  let yo = null;
  let lunes = null;   // inicio (Date) de la semana que se muestra
  let editando = null; // id del turno que el encargado está editando

  const esEncargado = () => Boolean(yo) && yo.rol === 'administrador';
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

  function pintarTabla(lista) {
    const tbody = q('t-tabla');
    tbody.replaceChildren();
    q('t-vacio').classList.toggle('oculto', lista.length > 0);

    for (const t of lista) {
      const fila = document.createElement('tr');
      fila.append(
        celda(t.empleadoEmail || yo.email),
        celda(fmtFechaHora(t.inicio)),
        celda(fmtFechaHora(t.fin)),
        celda(t.nota || '')
      );
      if (esEncargado()) {
        const acciones = document.createElement('td');
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
        fila.appendChild(acciones);
      } else {
        fila.appendChild(document.createElement('td'));
      }
      tbody.appendChild(fila);
    }
  }

  async function cargar() {
    const hasta = sumarDias(lunes, 7);
    q('t-semana').textContent =
      `${lunes.toLocaleDateString('es-ES')} – ${sumarDias(lunes, 6).toLocaleDateString('es-ES')}`;
    const lista = vistaActual() === 'mios'
      ? await Rest.misTurnos(lunes.toISOString(), hasta.toISOString())
      : await Rest.turnosEquipo(lunes.toISOString(), hasta.toISOString());
    pintarTabla(lista);
  }

  // ---- Formulario del encargado ----
  async function cargarEmpleados() {
    const usuarios = await Rest.listarUsuarios();
    const select = q('t-empleado');
    select.replaceChildren();
    for (const u of usuarios.filter((x) => x.rol === 'usuario' && x.estado === 'activo')) {
      const op = document.createElement('option');
      op.value = u.id;
      op.textContent = u.email;
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
        await Rest.crearTurno(cuerpo);
        mostrar('Turno creado.', 'ok');
      }
      cancelarEdicion();
      await cargar();
    });
    q('t-cancelar').onclick = cancelarEdicion;

    q('t-buscar-disp').onclick = () => accion(async () => {
      const libres = await Rest.disponibilidad(desdeInput(q('t-disp-inicio').value), desdeInput(q('t-disp-fin').value));
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

  let eventosRegistrados = false;

  return {
    // Se llama desde index.html cuando hay una sesión iniciada
    async iniciar(usuario) {
      yo = usuario;
      if (!eventosRegistrados) { registrarEventos(); eventosRegistrados = true; }
      q('zona-turnos').classList.remove('oculto');
      q('t-admin').classList.toggle('oculto', !esEncargado());
      // El encargado no tiene turnos propios: su vista por defecto es la del equipo
      q('t-opcion-mios').classList.toggle('oculto', esEncargado());
      document.querySelector(`input[name="t-vista"][value="${esEncargado() ? 'equipo' : 'mios'}"]`).checked = true;
      lunes = lunesDe(new Date());
      cancelarEdicion();
      await accion(async () => {
        if (esEncargado()) await cargarEmpleados();
        await cargar();
      });
    },
    limpiar() {
      yo = null;
      q('zona-turnos').classList.add('oculto');
    },
  };
})();