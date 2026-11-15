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
    turnosEquipo: (desde, hasta) => peticion('GET', `/api/turnos/equipo${rango(desde, hasta, 'desde', 'hasta')}`),
    disponibilidad: (inicio, fin) => peticion('GET', `/api/disponibilidad${rango(inicio, fin, 'inicio', 'fin')}`),
    crearTurno: (turno) => peticion('POST', '/api/turnos', turno),
    editarTurno: (id, turno) => peticion('PUT', `/api/turnos/${encodeURIComponent(id)}`, turno),
    eliminarTurno: (id) => peticion('DELETE', `/api/turnos/${encodeURIComponent(id)}`),
  };
})();