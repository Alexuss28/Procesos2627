const test = require('node:test');
const assert = require('node:assert/strict');
const { crearServicioUsuarios } = require('./logica');
const { crearRepoMemoria } = require('./datos');

function nuevoServicio(opciones = {}) {
  return crearServicioUsuarios({ repo: crearRepoMemoria(), rondasHash: 4, ...opciones });
}

async function conAdminYUsuarios(servicio) {
  await servicio.asegurarAdministrador('admin@test.com', 'admin12345');
  const admin = (await servicio.listar(await idPorEmail(servicio, 'admin@test.com'))) ;
  return admin;
}

// Helper: obtiene el id del admin leyendo el repo a través del servicio
async function idPorEmail(servicio, email) {
  return servicio.__repo.buscarPorEmail(email).then((u) => u.id);
}

function crearEscenario() {
  const repo = crearRepoMemoria();
  const servicio = crearServicioUsuarios({ repo, rondasHash: 4 });
  return { repo, servicio };
}

test('registrar crea un usuario activo con rol usuario', async () => {
  const { servicio } = crearEscenario();
  const u = await servicio.registrar({ email: 'Ana@Test.com', password: 'password123' });
  assert.equal(u.email, 'ana@test.com');
  assert.equal(u.rol, 'usuario');
  assert.equal(u.estado, 'activo');
});

test('registrar con un email ya existente falla (caso de error)', async () => {
  const { servicio } = crearEscenario();
  await servicio.registrar({ email: 'ana@test.com', password: 'password123' });
  await assert.rejects(
    () => servicio.registrar({ email: 'ana@test.com', password: 'otrapassword' }),
    { codigo: 'EMAIL_DUPLICADO' }
  );
});

test('registrar rechaza contraseñas cortas', async () => {
  const { servicio } = crearEscenario();
  await assert.rejects(() => servicio.registrar({ email: 'a@b.com', password: '123' }), { codigo: 'PASSWORD_DEBIL' });
});

test('con confirmación activada, la cuenta queda pendiente y no está activa', async () => {
  const repo = crearRepoMemoria();
  const servicio = crearServicioUsuarios({ repo, rondasHash: 4, requiereConfirmacion: true });
  await servicio.asegurarAdministrador('admin@test.com', 'admin12345');
  const admin = await repo.buscarPorEmail('admin@test.com');
  const u = await servicio.registrar({ email: 'ana@test.com', password: 'password123' });
  assert.equal(u.estado, 'pendiente');
  assert.equal(await servicio.estaActivo(admin.id, u.id), false);
});

test('un usuario normal no puede listar usuarios', async () => {
  const { servicio } = crearEscenario();
  const u = await servicio.registrar({ email: 'ana@test.com', password: 'password123' });
  await assert.rejects(() => servicio.listar(u.id), { codigo: 'PROHIBIDO' });
});

test('el administrador lista usuarios con email, rol y estado', async () => {
  const { servicio, repo } = crearEscenario();
  await servicio.asegurarAdministrador('admin@test.com', 'admin12345');
  await servicio.registrar({ email: 'ana@test.com', password: 'password123' });
  const admin = await repo.buscarPorEmail('admin@test.com');
  const lista = await servicio.listar(admin.id);
  assert.equal(lista.length, 2);
  assert.deepEqual(Object.keys(lista[0]).sort(), ['email', 'estado', 'id', 'rol']);
});

test('un usuario normal no puede eliminar a otro', async () => {
  const { servicio } = crearEscenario();
  const ana = await servicio.registrar({ email: 'ana@test.com', password: 'password123' });
  const luis = await servicio.registrar({ email: 'luis@test.com', password: 'password123' });
  await assert.rejects(() => servicio.eliminar(ana.id, luis.id), { codigo: 'PROHIBIDO' });
});

test('un usuario puede eliminar su propia cuenta y el admin la de cualquiera', async () => {
  const { servicio, repo } = crearEscenario();
  await servicio.asegurarAdministrador('admin@test.com', 'admin12345');
  const admin = await repo.buscarPorEmail('admin@test.com');
  const ana = await servicio.registrar({ email: 'ana@test.com', password: 'password123' });
  const luis = await servicio.registrar({ email: 'luis@test.com', password: 'password123' });
  await servicio.eliminar(ana.id, ana.id);
  await servicio.eliminar(admin.id, luis.id);
  assert.equal((await servicio.listar(admin.id)).length, 1);
});