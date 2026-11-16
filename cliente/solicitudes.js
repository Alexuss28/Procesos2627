// Presentación de las solicitudes de cambio de turno de un grupo.
// Habla con el servidor solo a través de Rest y usa los helpers mostrar() y accion() de index.html.
// Grupos.abrir() la activa con Solicitudes.abrir(grupo, usuario) y Solicitudes.cerrar() al salir del grupo.
const Solicitudes = (() => {
  const q = (id) => document.getElementById(id);

  const DIAS_VISTA = 60; // los turnos que se pueden cambiar: los de los próximos 60 días
  const ESTADO = { pendiente: 'Pendiente', aprobada: 'Aprobada', rechazada: 'Rechazada', cancelada: 'Cancelada' };
  const TIPO = { cesion: 'Cesión', intercambio: 'Intercambio' };

  let yo = null;
  let grupo = null;      // { id, nombre, miRol, miembros }
  let turnosGrupo = [];  // turnos futuros del grupo (para elegir el turno del compañero en un intercambio)
  let eventosRegistrados = false;

  const esEncargado = () => Boolean(grupo) && grupo.miRol === 'encargado';

  const hora = (iso) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const dia = (iso) => new Date(iso).toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: '2-digit' });
  const franja = (t) => (t ? `${dia(t.inicio)} ${hora(t.inicio)}–${hora(t.fin)}` : '—');

  function celda(texto) {
    const td = document.createElement('td');
    td.textContent = texto; // textContent evita inyección de HTML
    return td;
  }
  function boton(texto, onclick) {
    const b = document.createElement('button');
    b.textContent = texto;
    b.onclick = onclick;
    return b;
  }

  // Rellena un <select> con pares [valor, etiqueta]; si no hay opciones, muestra el aviso "vacio"
  function llenar(id, pares, vacio) {
    const select = q(id);
    select.replaceChildren();
    if (!pares.length) {
      const op = document.createElement('option');
      op.value = '';
      op.textContent = vacio;
      select.appendChild(op);
      return;
    }
    for (const [valor, etiqueta] of pares) {
      const op = document.createElement('option');
      op.value = valor;
      op.textContent = etiqueta;
      select.appendChild(op);
    }
  }

  function llenarDestino() {
    const companero = q('s-companero').value;
    llenar('s-destino',
      turnosGrupo.filter((t) => t.empleadoId === companero).map((t) => [t.id, franja(t)]),
      'Ese compañero no tiene turnos futuros');
  }

  async function cargarFormulario() {
    const desde = new Date();
    const hasta = new Date(desde.getTime() + DIAS_VISTA * 24 * 3600 * 1000);
    const [mios, equipo] = await Promise.all([
      Rest.misTurnos(desde.toISOString(), hasta.toISOString()),
      Rest.turnosEquipo(grupo.id, desde.toISOString(), hasta.toISOString()),
    ]);
    const futuros = (t) => new Date(t.inicio) > desde;
    turnosGrupo = equipo.filter(futuros);
    llenar('s-turno',
      mios.filter((t) => t.grupoId === grupo.id && futuros(t)).map((t) => [t.id, franja(t)]),
      'No tienes turnos futuros en este grupo');
    llenar('s-companero',
      grupo.miembros.filter((m) => m.rol === 'empleado' && m.usuarioId !== yo.id).map((m) => [m.usuarioId, m.email]),
      'No hay compañeros en el grupo');
    llenarDestino();
  }

  async function cargarLista() {
    const lista = await Rest.solicitudes(grupo.id);
    const tbody = q('s-tabla');
    tbody.replaceChildren();
    q('s-vacio').classList.toggle('oculto', lista.length > 0);

    for (const s of lista) {
      const fila = document.createElement('tr');
      const estado = ESTADO[s.estado] + (s.comentario ? ` — ${s.comentario}` : '');
      fila.append(
        celda(TIPO[s.tipo]),
        celda(s.solicitante.email || ''),
        celda(s.companero.email || ''),
        celda(franja(s.turnoOrigen)),
        celda(s.tipo === 'intercambio' ? franja(s.turnoDestino) : '—'),
        celda(s.motivo || ''),
        celda(estado)
      );

      const acciones = document.createElement('td');
      if (s.estado === 'pendiente') {
        if (s.solicitante.id === yo.id) {
          acciones.appendChild(boton('Cancelar', () => accion(async () => {
            await Rest.cancelarSolicitud(s.id);
            await cargarLista();
            await cargarFormulario();
          })));
        }
        if (esEncargado()) {
          acciones.appendChild(boton('Aprobar', () => accion(async () => {
            const comentario = prompt('Comentario para el empleado (opcional):');
            if (comentario === null) return; // ha cancelado el cuadro
            await Rest.aprobarSolicitud(s.id, comentario);
            mostrar('Solicitud aprobada: el cambio ya está aplicado en el calendario.', 'ok');
            await cargarLista();
            await Turnos.abrir(grupo, yo); // el calendario ha cambiado
          })));
          acciones.appendChild(boton('Rechazar', () => accion(async () => {
            const comentario = prompt('Motivo del rechazo (opcional):');
            if (comentario === null) return;
            await Rest.rechazarSolicitud(s.id, comentario);
            mostrar('Solicitud rechazada.', 'ok');
            await cargarLista();
          })));
        }
      }
      fila.appendChild(acciones);
      tbody.appendChild(fila);
    }
  }

  function registrarEventos() {
    q('s-tipo').onchange = () => {
      q('s-zona-destino').classList.toggle('oculto', q('s-tipo').value !== 'intercambio');
    };
    q('s-companero').onchange = llenarDestino;

    q('s-enviar').onclick = () => accion(async () => {
      const tipo = q('s-tipo').value;
      const cuerpo = {
        tipo,
        turnoId: q('s-turno').value,
        companeroId: q('s-companero').value,
        motivo: q('s-motivo').value,
      };
      if (tipo === 'intercambio') cuerpo.turnoDestinoId = q('s-destino').value;
      await Rest.crearSolicitud(grupo.id, cuerpo);
      q('s-motivo').value = '';
      mostrar('Solicitud enviada. El encargado la revisará.', 'ok');
      await cargarLista();
    });
  }

  return {
    async abrir(detalleGrupo, usuario) {
      yo = usuario;
      grupo = detalleGrupo;
      if (!eventosRegistrados) { registrarEventos(); eventosRegistrados = true; }
      q('zona-solicitudes').classList.remove('oculto');
      // Pedir cambios es cosa de los empleados; el encargado solo resuelve
      q('s-formulario').classList.toggle('oculto', esEncargado());
      q('s-tipo').value = 'cesion';
      q('s-zona-destino').classList.add('oculto');
      try {
        if (!esEncargado()) await cargarFormulario();
        await cargarLista();
      } catch (e) {
        mostrar(e.message); // sin accion(): no se borra el mensaje que haya mostrado quien nos llama
      }
    },
    cerrar() {
      grupo = null;
      q('zona-solicitudes').classList.add('oculto');
    },
  };
})();