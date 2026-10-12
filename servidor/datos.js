// Todos los métodos son async para poder sustituirlos por una BD sin tocar la lógica.
function crearRepoMemoria() {
  const usuarios = new Map();
  return {
    async crear(u) { usuarios.set(u.id, { ...u }); },
    async buscarPorId(id) { return usuarios.get(id) || null; },
    async buscarPorEmail(email) {
      return [...usuarios.values()].find((u) => u.email === email) || null;
    },
    async listar() { return [...usuarios.values()]; },
    async eliminar(id) { usuarios.delete(id); },
  };
}

module.exports = { crearRepoMemoria };