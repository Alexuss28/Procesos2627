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

function escenarioCorreo({ falla = false } = {}) {
  const repo = crearRepoMemoria();
  const enviados = [];
  const correo = {
    enviarConfirmacion: async (m) => {
      if (falla) throw new Error('servicio de correo caído');
      enviados.push(m);
    },
  };
  const servicio = crearServicioUsuarios({
    repo, correo, urlBase: 'http://localhost:3000', requiereConfirmacion: true, rondasHash: 4,
  });
  const tokenDe = (m) => new URL(m.enlace).searchParams.get('token');
  return { repo, servicio, enviados, tokenDe };
}

test('registrar con confirmación envía un correo con el enlace y deja la cuenta pendiente', async () => {
  const { servicio, enviados } = escenarioCorreo();
  const u = await servicio.registrar({ email: 'ana@test.com', password: 'password123' });
  assert.equal(u.estado, 'pendiente');
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].email, 'ana@test.com');
  assert.match(enviados[0].enlace, /^http:\/\/localhost:3000\/\?token=[0-9a-f]{64}$/);
});

test('confirmarCuenta activa la cuenta y permite iniciar sesión', async () => {
  const { servicio, enviados, tokenDe } = escenarioCorreo();
  await servicio.registrar({ email: 'ana@test.com', password: 'password123' });
  await assert.rejects(
    () => servicio.iniciarSesion({ email: 'ana@test.com', password: 'password123' }),
    { codigo: 'CUENTA_PENDIENTE' }
  );
  const u = await servicio.confirmarCuenta(tokenDe(enviados[0]));
  assert.equal(u.estado, 'activo');
  const sesion = await servicio.iniciarSesion({ email: 'ana@test.com', password: 'password123' });
  assert.equal(sesion.email, 'ana@test.com');
});

test('confirmarCuenta rechaza un token inventado (caso de error)', async () => {
  const { servicio } = escenarioCorreo();
  await assert.rejects(() => servicio.confirmarCuenta('a'.repeat(64)), { codigo: 'TOKEN_INVALIDO' });
});

test('el token de confirmación es de un solo uso', async () => {
  const { servicio, enviados, tokenDe } = escenarioCorreo();
  await servicio.registrar({ email: 'ana@test.com', password: 'password123' });
  const token = tokenDe(enviados[0]);
  await servicio.confirmarCuenta(token);
  await assert.rejects(() => servicio.confirmarCuenta(token), { codigo: 'TOKEN_INVALIDO' });
});

test('un token caducado no confirma la cuenta (caso de error)', async () => {
  const { servicio, repo, enviados, tokenDe } = escenarioCorreo();
  const u = await servicio.registrar({ email: 'ana@test.com', password: 'password123' });
  await repo.actualizar(u.id, { tokenExpira: new Date(Date.now() - 1000) });
  await assert.rejects(() => servicio.confirmarCuenta(tokenDe(enviados[0])), { codigo: 'TOKEN_CADUCADO' });
});

test('si falla el envío del correo, el registro se revierte y el email queda libre', async () => {
  const { servicio, repo } = escenarioCorreo({ falla: true });
  await assert.rejects(
    () => servicio.registrar({ email: 'ana@test.com', password: 'password123' }),
    { codigo: 'CORREO_NO_ENVIADO' }
  );
  assert.equal(await repo.buscarPorEmail('ana@test.com'), null);
});

test('reenviar confirmación: se ignora si es demasiado pronto y después invalida el token anterior', async () => {
  const { servicio, repo, enviados, tokenDe } = escenarioCorreo();
  const u = await servicio.registrar({ email: 'ana@test.com', password: 'password123' });
  const tokenViejo = tokenDe(enviados[0]);

  await servicio.reenviarConfirmacion('ana@test.com'); // justo después de registrar: ignorado
  assert.equal(enviados.length, 1);

  // Simulamos que el último correo se envió hace 2 minutos
  await repo.actualizar(u.id, { tokenExpira: new Date(Date.now() + 24 * 3600 * 1000 - 120000) });
  await servicio.reenviarConfirmacion('ana@test.com');
  assert.equal(enviados.length, 2);

  await assert.rejects(() => servicio.confirmarCuenta(tokenViejo), { codigo: 'TOKEN_INVALIDO' });
  const activa = await servicio.confirmarCuenta(tokenDe(enviados[1]));
  assert.equal(activa.estado, 'activo');
});

test('Google: un usuario nuevo se crea activo, con rol usuario y sin contraseña local', async () => {
  const { servicio } = crearEscenario();
  const u = await servicio.iniciarSesionConProveedor({
    proveedor: 'google', proveedorId: 'g-123', email: 'Ana@Test.com', emailVerificado: true,
  });
  assert.equal(u.email, 'ana@test.com');
  assert.equal(u.rol, 'usuario');
  assert.equal(u.estado, 'activo');
  // No tiene contraseña, así que no puede entrar por el login local
  await assert.rejects(
    () => servicio.iniciarSesion({ email: 'ana@test.com', password: 'cualquiera123' }),
    { codigo: 'CREDENCIALES_INVALIDAS' }
  );
});

test('Google: un segundo acceso devuelve la misma cuenta sin duplicarla', async () => {
  const { servicio, repo } = crearEscenario();
  const datos = { proveedor: 'google', proveedorId: 'g-123', email: 'ana@test.com', emailVerificado: true };
  const primera = await servicio.iniciarSesionConProveedor(datos);
  const segunda = await servicio.iniciarSesionConProveedor(datos);
  assert.equal(primera.id, segunda.id);
  assert.equal((await repo.listar()).length, 1);
});

test('Google: se rechaza un correo no verificado por el proveedor (caso de error)', async () => {
  const { servicio } = crearEscenario();
  await assert.rejects(
    () => servicio.iniciarSesionConProveedor({
      proveedor: 'google', proveedorId: 'g-123', email: 'ana@test.com', emailVerificado: false,
    }),
    { codigo: 'EMAIL_NO_VERIFICADO' }
  );
});

test('Google: no se vincula a una cuenta local existente con el mismo correo (caso de error)', async () => {
  const { servicio } = crearEscenario();
  await servicio.registrar({ email: 'ana@test.com', password: 'password123' });
  await assert.rejects(
    () => servicio.iniciarSesionConProveedor({
      proveedor: 'google', proveedorId: 'g-999', email: 'ana@test.com', emailVerificado: true,
    }),
    { codigo: 'EMAIL_EN_USO_LOCAL' }
  );
  // La cuenta local sigue funcionando con su contraseña
  const sesion = await servicio.iniciarSesion({ email: 'ana@test.com', password: 'password123' });
  assert.equal(sesion.email, 'ana@test.com');
});

test('Google: se rechaza un proveedor desconocido (caso de error)', async () => {
  const { servicio } = crearEscenario();
  await assert.rejects(
    () => servicio.iniciarSesionConProveedor({
      proveedor: 'facebook', proveedorId: 'x', email: 'ana@test.com', emailVerificado: true,
    }),
    { codigo: 'PROVEEDOR_INVALIDO' }
  );
});