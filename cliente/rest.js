// Única capa del frontend que habla con el servidor.
const Rest = (() => {
  async function peticion(metodo, url, cuerpo) {
    const res = await fetch(url, {
      method: metodo,
      headers: cuerpo ? { 'Content-Type': 'application/json' } : undefined,
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      credentials: 'same-origin',
    });
    const datos = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error((datos && datos.error && datos.error.mensaje) || `Error inesperado (${res.status})`);
      err.estado = res.status;
      err.codigo = datos && datos.error && datos.error.codigo;
      throw err;
    }
    return datos;
  }

  const rango = (a, b, nombreA, nombreB) =>
    `?${nombreA}=${encodeURIComponent(a)}&${nombreB}=${encodeURIComponent(b)}`;

  return {
    // Cuentas y acceso
    registrar: (email, password) => peticion('POST', '/api/registro', { email, password }),
    confirmar: (token) => peticion('POST', '/api/confirmar', { token }),
    reenviarConfirmacion: (email) => peticion('POST', '/api/reenviar-confirmacion', { email }),
    login: (email, password) => peticion('POST', '/api/login', { email, password }),
    urlAccesoGoogle: '/api/auth/google', // es una navegación del navegador, no un fetch
    logout: () => peticion('POST', '/api/logout'),
    sesion: () => peticion('GET', '/api/sesion'),

    // Usuarios
    listarUsuarios: () => peticion('GET', '/api/usuarios'),
    estaActivo: (id) => peticion('GET', `/api/usuarios/${encodeURIComponent(id)}/activo`),
    eliminarUsuario: (id) => peticion('DELETE', `/api/usuarios/${encodeURIComponent(id)}`),

    // Turnos
    misTurnos: (desde, hasta) => peticion('GET', `/api/turnos/mios${rango(desde, hasta, 'desde', 'hasta')}`),
    turnosEquipo: (grupoId, desde, hasta) =>
      peticion('GET', `/api/grupos/${encodeURIComponent(grupoId)}/turnos${rango(desde, hasta, 'desde', 'hasta')}`),
    disponibilidad: (grupoId, inicio, fin) =>
      peticion('GET', `/api/grupos/${encodeURIComponent(grupoId)}/disponibilidad${rango(inicio, fin, 'inicio', 'fin')}`),
    crearTurno: (grupoId, turno) => peticion('POST', `/api/grupos/${encodeURIComponent(grupoId)}/turnos`, turno),
    editarTurno: (id, turno) => peticion('PUT', `/api/turnos/${encodeURIComponent(id)}`, turno),
    eliminarTurno: (id) => peticion('DELETE', `/api/turnos/${encodeURIComponent(id)}`),
    
    // Grupos e invitaciones
    misGrupos: () => peticion('GET', '/api/grupos'),
    crearGrupo: (nombre) => peticion('POST', '/api/grupos', { nombre }),
    obtenerGrupo: (id) => peticion('GET', `/api/grupos/${encodeURIComponent(id)}`),
    eliminarGrupo: (id) => peticion('DELETE', `/api/grupos/${encodeURIComponent(id)}`),
    salirDelGrupo: (id) => peticion('POST', `/api/grupos/${encodeURIComponent(id)}/salir`),
    expulsar: (grupoId, usuarioId) =>
      peticion('DELETE', `/api/grupos/${encodeURIComponent(grupoId)}/miembros/${encodeURIComponent(usuarioId)}`),
    invitacionesGrupo: (grupoId) => peticion('GET', `/api/grupos/${encodeURIComponent(grupoId)}/invitaciones`),
    invitar: (grupoId, email) =>
      peticion('POST', `/api/grupos/${encodeURIComponent(grupoId)}/invitaciones`, { email }),
    cancelarInvitacion: (grupoId, invitacionId) =>
      peticion('DELETE', `/api/grupos/${encodeURIComponent(grupoId)}/invitaciones/${encodeURIComponent(invitacionId)}`),
    misInvitaciones: () => peticion('GET', '/api/invitaciones'),
    aceptarInvitacion: (id) => peticion('POST', `/api/invitaciones/${encodeURIComponent(id)}/aceptar`),
    rechazarInvitacion: (id) => peticion('POST', `/api/invitaciones/${encodeURIComponent(id)}/rechazar`),

    // Solicitudes de cambio de turno
    solicitudes: (grupoId) => peticion('GET', `/api/grupos/${encodeURIComponent(grupoId)}/solicitudes`),
    crearSolicitud: (grupoId, solicitud) =>
      peticion('POST', `/api/grupos/${encodeURIComponent(grupoId)}/solicitudes`, solicitud),
    cancelarSolicitud: (id) => peticion('POST', `/api/solicitudes/${encodeURIComponent(id)}/cancelar`),
    aprobarSolicitud: (id, comentario) =>
      peticion('POST', `/api/solicitudes/${encodeURIComponent(id)}/aprobar`, { comentario }),
    rechazarSolicitud: (id, comentario) =>
      peticion('POST', `/api/solicitudes/${encodeURIComponent(id)}/rechazar`, { comentario }),

    // Horas trabajadas
    horasMias: (mes) => peticion('GET', `/api/horas?mes=${encodeURIComponent(mes)}`),
    horasGrupo: (grupoId, mes) =>
      peticion('GET', `/api/grupos/${encodeURIComponent(grupoId)}/horas?mes=${encodeURIComponent(mes)}`),

    // Notificaciones
    notificaciones: () => peticion('GET', '/api/notificaciones'),
    leerNotificacion: (id) => peticion('POST', `/api/notificaciones/${encodeURIComponent(id)}/leer`),
    leerTodasNotificaciones: () => peticion('POST', '/api/notificaciones/leer-todas'),
  };
})();