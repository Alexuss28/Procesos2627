const test = require('node:test');
const assert = require('node:assert/strict');
const { crearServicioUsuarios, calcularEstadoUsuario } = require('./logica');
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

test('login correcto devuelve el usuario', async () => {
  const { servicio } = crearEscenario();
  await servicio.registrar({ email: 'ana@test.com', password: 'password123' });
  const u = await servicio.iniciarSesion({ email: 'ana@test.com', password: 'password123' });
  assert.equal(u.email, 'ana@test.com');
});

test('login con contraseña incorrecta falla', async () => {
  const { servicio } = crearEscenario();
  await servicio.registrar({ email: 'ana@test.com', password: 'password123' });
  await assert.rejects(
    () => servicio.iniciarSesion({ email: 'ana@test.com', password: 'mala' }),
    { codigo: 'CREDENCIALES_INVALIDAS' }
  );
});

test('login con cuenta pendiente de confirmar falla', async () => {
  const servicio = crearServicioUsuarios({ repo: crearRepoMemoria(), rondasHash: 4, requiereConfirmacion: true });
  await servicio.registrar({ email: 'ana@test.com', password: 'password123' });
  await assert.rejects(
    () => servicio.iniciarSesion({ email: 'ana@test.com', password: 'password123' }),
    { codigo: 'CUENTA_PENDIENTE' }
  );
});

test('un usuario eliminado no puede volver a iniciar sesión', async () => {
  const { servicio } = crearEscenario();
  const u = await servicio.registrar({ email: 'ana@test.com', password: 'password123' });
  await servicio.eliminar(u.id, u.id);
  await assert.rejects(
    () => servicio.iniciarSesion({ email: 'ana@test.com', password: 'password123' }),
    { codigo: 'CREDENCIALES_INVALIDAS' }
  );
});

test('variante6: local sin confirmar queda pendiente y no puede iniciar sesión', () => {
  const r = calcularEstadoUsuario({ proveedor: 'local', confirmado: false, eliminado: false });
  assert.deepEqual(r, { estado: 'pendiente', puedeIniciarSesion: false });
});

test('variante6: local confirmado está activo y puede iniciar sesión', () => {
  const r = calcularEstadoUsuario({ proveedor: 'local', confirmado: true, eliminado: false });
  assert.deepEqual(r, { estado: 'activo', puedeIniciarSesion: true });
});

test('variante6: oauth está activo aunque no esté confirmado', () => {
  const r = calcularEstadoUsuario({ proveedor: 'oauth', confirmado: false, eliminado: false });
  assert.deepEqual(r, { estado: 'activo', puedeIniciarSesion: true });
});

test('variante6: eliminado gana a cualquier otro dato', () => {
  for (const proveedor of ['local', 'oauth']) {
    const r = calcularEstadoUsuario({ proveedor, confirmado: true, eliminado: true });
    assert.deepEqual(r, { estado: 'eliminado', puedeIniciarSesion: false });
  }
});

test('variante6: rechaza un proveedor desconocido', () => {
  assert.throws(
    () => calcularEstadoUsuario({ proveedor: 'github', confirmado: true, eliminado: false }),
    { codigo: 'PROVEEDOR_INVALIDO' }
  );
});

test('variante6: rechaza campos que no son booleanos', () => {
  assert.throws(
    () => calcularEstadoUsuario({ proveedor: 'local', confirmado: 'si', eliminado: false }),
    { codigo: 'CAMPO_INVALIDO' }
  );
  assert.throws(
    () => calcularEstadoUsuario({ proveedor: 'local', confirmado: true }),
    { codigo: 'CAMPO_INVALIDO' }
  );
});