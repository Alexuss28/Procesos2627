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
      throw err;
    }
    return datos;
  }

  return {
    registrar: (email, password) => peticion('POST', '/api/registro', { email, password }),
    login: (email, password) => peticion('POST', '/api/login', { email, password }),
    logout: () => peticion('POST', '/api/logout'),
    sesion: () => peticion('GET', '/api/sesion'),
    listarUsuarios: () => peticion('GET', '/api/usuarios'),
    estaActivo: (id) => peticion('GET', `/api/usuarios/${encodeURIComponent(id)}/activo`),
    eliminarUsuario: (id) => peticion('DELETE', `/api/usuarios/${encodeURIComponent(id)}`),
  };
})();