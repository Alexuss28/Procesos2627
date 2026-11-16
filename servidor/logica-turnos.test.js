const test = require('node:test');
const assert = require('node:assert/strict');
const { crearServicioUsuarios } = require('./logica');
const { crearRepoMemoria } = require('./datos');
const { crearRepoGruposMemoria } = require('./datos-grupos');
const { crearRepoTurnosMemoria } = require('./datos-turnos');
const { crearServicioGrupos } = require('./logica-grupos');
const { crearServicioTurnos, seSolapan } = require('./logica-turnos');
const { parsearFecha } = require('./fechas');

// Fechas de prueba: diciembre de 2026 en UTC
const f = (dia, hora, min = '00') => `2026-12-${String(dia).padStart(2, '0')}T${String(hora).padStart(2, '0')}:${min}:00Z`;
const rango = { desde: f(1, 0), hasta: f(8, 0) };

// Mete a una persona en un grupo como empleado (invitación + aceptación)
async function unir(grupos, encargado, grupo, persona) {
  const inv = await grupos.invitar(encargado.id, grupo.id, { email: persona.email });
  await grupos.aceptarInvitacion(persona.id, inv.id);
}

// Escenario: "Cafetería Sol" (encargado: jefe; empleados: ana y luis) y eva, que no pertenece a ningún grupo
async function escenario() {
  const repoUsuarios = crearRepoMemoria();
  const usuarios = crearServicioUsuarios({ repo: repoUsuarios, rondasHash: 4 });
  const registrar = (n) => usuarios.registrar({ email: `${n}@test.com`, password: 'password123' });
  const jefe = await registrar('jefe');
  const ana = await registrar('ana');
  const luis = await registrar('luis');
  const eva = await registrar('eva');

  const repoGrupos = crearRepoGruposMemoria();
  const repoTurnos = crearRepoTurnosMemoria();
  const grupos = crearServicioGrupos({ repo: repoGrupos, repoUsuarios, repoTurnos });
  const turnos = crearServicioTurnos({ repo: repoTurnos, repoGrupos, repoUsuarios });

  const g = await grupos.crearGrupo(jefe.id, { nombre: 'Cafetería Sol' });
  await unir(grupos, jefe, g, ana);
  await unir(grupos, jefe, g, luis);
  return { usuarios, repoUsuarios, grupos, turnos, jefe, ana, luis, eva, g };
}

test('fechas: acepta ISO con zona horaria y rechaza el resto (caso de error)', () => {
  assert.equal(parsearFecha('2026-12-01T09:00:00Z').toISOString(), '2026-12-01T09:00:00.000Z');
  assert.equal(parsearFecha('2026-12-01T10:00:00+01:00').toISOString(), '2026-12-01T09:00:00.000Z');
  for (const malo of ['2026-12-01T09:00:00', '2026-12-01', 'mañana', '2026-02-31T10:00:00Z', '2026-13-01T10:00:00Z', 123, null]) {
    assert.throws(() => parsearFecha(malo), { codigo: 'FECHA_INVALIDA' }, String(malo));
  }
});

test('seSolapan: intervalos que se cruzan, contenidos y consecutivos', () => {
  const d = (h) => new Date(f(1, h));
  assert.equal(seSolapan(d(9), d(13), d(12), d(16)), true);
  assert.equal(seSolapan(d(9), d(17), d(11), d(12)), true);
  assert.equal(seSolapan(d(9), d(13), d(13), d(17)), false); // consecutivos: no se solapan
  assert.equal(seSolapan(d(9), d(10), d(14), d(15)), false);
});

test('el encargado del grupo crea un turno y el empleado lo ve en sus turnos', async () => {
  const { turnos, jefe, ana, g } = await escenario();
  const t = await turnos.crearTurno(jefe.id, g.id, { empleadoId: ana.id, inicio: f(2, 9), fin: f(2, 17), nota: ' Apertura ' });
  assert.equal(t.nota, 'Apertura');
  assert.equal(t.grupoId, g.id);
  const mios = await turnos.listarMios(ana.id, rango);
  assert.equal(mios.length, 1);
  assert.equal(mios[0].id, t.id);
  assert.equal(mios[0].grupoNombre, 'Cafetería Sol');
});

test('un empleado del grupo no puede crear turnos (caso de error)', async () => {
  const { turnos, ana, luis, g } = await escenario();
  await assert.rejects(
    () => turnos.crearTurno(ana.id, g.id, { empleadoId: luis.id, inicio: f(2, 9), fin: f(2, 17) }),
    { codigo: 'PROHIBIDO' }
  );
});

test('quien no pertenece al grupo no puede crear ni consultar sus turnos (caso de error)', async () => {
  const { turnos, eva, ana, g } = await escenario();
  await assert.rejects(
    () => turnos.crearTurno(eva.id, g.id, { empleadoId: ana.id, inicio: f(2, 9), fin: f(2, 17) }),
    { codigo: 'NO_ENCONTRADO' }
  );
  await assert.rejects(() => turnos.listarEquipo(eva.id, g.id, rango), { codigo: 'NO_ENCONTRADO' });
  await assert.rejects(
    () => turnos.disponibilidad(eva.id, g.id, { inicio: f(2, 9), fin: f(2, 17) }),
    { codigo: 'NO_ENCONTRADO' }
  );
});

test('el administrador de la web no gestiona los turnos de grupos ajenos (caso de error)', async () => {
  const { usuarios, repoUsuarios, turnos, ana, g } = await escenario();
  await usuarios.asegurarAdministrador('admin@test.com', 'admin12345');
  const admin = await repoUsuarios.buscarPorEmail('admin@test.com');
  await assert.rejects(
    () => turnos.crearTurno(admin.id, g.id, { empleadoId: ana.id, inicio: f(2, 9), fin: f(2, 17) }),
    { codigo: 'NO_ENCONTRADO' }
  );
  await assert.rejects(() => turnos.listarEquipo(admin.id, g.id, rango), { codigo: 'NO_ENCONTRADO' });
});

test('sin sesión no se puede consultar nada (caso de error)', async () => {
  const { turnos, g } = await escenario();
  await assert.rejects(() => turnos.listarEquipo(undefined, g.id, rango), { codigo: 'NO_AUTENTICADO' });
  await assert.rejects(() => turnos.listarMios(undefined, rango), { codigo: 'NO_AUTENTICADO' });
});

test('un turno debe terminar después de empezar (caso de error)', async () => {
  const { turnos, jefe, ana, g } = await escenario();
  await assert.rejects(
    () => turnos.crearTurno(jefe.id, g.id, { empleadoId: ana.id, inicio: f(2, 17), fin: f(2, 9) }),
    { codigo: 'RANGO_INVALIDO' }
  );
});

test('un turno no puede durar más de 12 horas (caso de error)', async () => {
  const { turnos, jefe, ana, g } = await escenario();
  await assert.rejects(
    () => turnos.crearTurno(jefe.id, g.id, { empleadoId: ana.id, inicio: f(2, 8), fin: f(2, 21) }),
    { codigo: 'TURNO_DEMASIADO_LARGO' }
  );
  // Exactamente 12 horas sí se admite
  await turnos.crearTurno(jefe.id, g.id, { empleadoId: ana.id, inicio: f(2, 8), fin: f(2, 20) });
});

test('un empleado no puede tener dos turnos solapados (caso de error)', async () => {
  const { turnos, jefe, ana, g } = await escenario();
  await turnos.crearTurno(jefe.id, g.id, { empleadoId: ana.id, inicio: f(2, 9), fin: f(2, 13) });
  await assert.rejects(
    () => turnos.crearTurno(jefe.id, g.id, { empleadoId: ana.id, inicio: f(2, 12), fin: f(2, 16) }),
    { codigo: 'TURNO_SOLAPADO' }
  );
});

test('turnos consecutivos del mismo empleado y simultáneos de empleados distintos son válidos', async () => {
  const { turnos, jefe, ana, luis, g } = await escenario();
  await turnos.crearTurno(jefe.id, g.id, { empleadoId: ana.id, inicio: f(2, 9), fin: f(2, 13) });
  await turnos.crearTurno(jefe.id, g.id, { empleadoId: ana.id, inicio: f(2, 13), fin: f(2, 17) });
  await turnos.crearTurno(jefe.id, g.id, { empleadoId: luis.id, inicio: f(2, 9), fin: f(2, 13) });
  assert.equal((await turnos.listarEquipo(jefe.id, g.id, rango)).length, 3);
});

test('los turnos solo se asignan a empleados del grupo (caso de error)', async () => {
  const { turnos, jefe, eva, g } = await escenario();
  for (const empleadoId of [eva.id, jefe.id, 'no-existe', undefined]) {
    await assert.rejects(
      () => turnos.crearTurno(jefe.id, g.id, { empleadoId, inicio: f(2, 9), fin: f(2, 13) }),
      { codigo: 'EMPLEADO_INVALIDO' }
    );
  }
});

test('una persona que trabaja en dos grupos no puede tener turnos solapados entre ellos (caso de error)', async () => {
  const { grupos, turnos, jefe, ana, eva } = await escenario();
  const g1 = (await grupos.listarMisGrupos(jefe.id))[0];
  const g2 = await grupos.crearGrupo(eva.id, { nombre: 'Librería Luna' });
  await unir(grupos, eva, g2, ana);

  await turnos.crearTurno(jefe.id, g1.id, { empleadoId: ana.id, inicio: f(2, 9), fin: f(2, 13) });
  await assert.rejects(
    () => turnos.crearTurno(eva.id, g2.id, { empleadoId: ana.id, inicio: f(2, 12), fin: f(2, 16) }),
    { codigo: 'TURNO_SOLAPADO' }
  );
  await turnos.crearTurno(eva.id, g2.id, { empleadoId: ana.id, inicio: f(2, 14), fin: f(2, 18) });

  // En "mis turnos" ve los de los dos grupos, con el nombre de cada uno
  const mios = await turnos.listarMios(ana.id, rango);
  assert.deepEqual(mios.map((t) => t.grupoNombre), ['Cafetería Sol', 'Librería Luna']);
  // El encargado de un grupo solo ve los turnos de su grupo
  assert.equal((await turnos.listarEquipo(jefe.id, g1.id, rango)).length, 1);
});

test('editar un turno aplica los cambios y vuelve a comprobar los solapes', async () => {
  const { turnos, jefe, ana, luis, g } = await escenario();
  const a = await turnos.crearTurno(jefe.id, g.id, { empleadoId: ana.id, inicio: f(2, 9), fin: f(2, 13) });
  await turnos.crearTurno(jefe.id, g.id, { empleadoId: ana.id, inicio: f(2, 15), fin: f(2, 19) });

  // Alargar el turno sin invadir otro (y sin solaparse consigo mismo) es válido
  const editado = await turnos.editarTurno(jefe.id, a.id, { fin: f(2, 14) });
  assert.equal(editado.fin, new Date(f(2, 14)).toISOString());
  // Alargarlo hasta pisar el turno de la tarde falla
  await assert.rejects(() => turnos.editarTurno(jefe.id, a.id, { fin: f(2, 16) }), { codigo: 'TURNO_SOLAPADO' });
  // Pasarlo a otro empleado del grupo es válido; a alguien ajeno al grupo, no
  assert.equal((await turnos.editarTurno(jefe.id, a.id, { empleadoId: luis.id })).empleadoId, luis.id);
  await assert.rejects(() => turnos.editarTurno(jefe.id, a.id, { empleadoId: 'nadie' }), { codigo: 'EMPLEADO_INVALIDO' });
});

test('solo el encargado de ese grupo edita o elimina sus turnos (caso de error)', async () => {
  const { grupos, turnos, jefe, ana, eva, g } = await escenario();
  const t = await turnos.crearTurno(jefe.id, g.id, { empleadoId: ana.id, inicio: f(2, 9), fin: f(2, 13) });
  const otro = await grupos.crearGrupo(eva.id, { nombre: 'Librería Luna' }); // eva es encargada de OTRO grupo

  await assert.rejects(() => turnos.eliminarTurno(ana.id, t.id), { codigo: 'PROHIBIDO' });
  await assert.rejects(() => turnos.editarTurno(ana.id, t.id, { nota: 'x' }), { codigo: 'PROHIBIDO' });
  await assert.rejects(() => turnos.eliminarTurno(eva.id, t.id), { codigo: 'NO_ENCONTRADO' });
  assert.ok(otro.id);

  await turnos.eliminarTurno(jefe.id, t.id);
  assert.equal((await turnos.listarMios(ana.id, rango)).length, 0);
  await assert.rejects(() => turnos.eliminarTurno(jefe.id, t.id), { codigo: 'NO_ENCONTRADO' });
});

test('"mis turnos" solo devuelve los del propio empleado', async () => {
  const { turnos, jefe, ana, luis, g } = await escenario();
  await turnos.crearTurno(jefe.id, g.id, { empleadoId: ana.id, inicio: f(2, 9), fin: f(2, 13) });
  await turnos.crearTurno(jefe.id, g.id, { empleadoId: luis.id, inicio: f(3, 9), fin: f(3, 13) });
  const mios = await turnos.listarMios(luis.id, rango);
  assert.equal(mios.length, 1);
  assert.equal(mios[0].empleadoId, luis.id);
});

test('el calendario del grupo lo ven sus miembros, pero la nota solo el encargado y su dueño', async () => {
  const { turnos, jefe, ana, luis, g } = await escenario();
  await turnos.crearTurno(jefe.id, g.id, { empleadoId: ana.id, inicio: f(2, 9), fin: f(2, 13), nota: 'Cita médica' });

  const vistoPorLuis = await turnos.listarEquipo(luis.id, g.id, rango);
  assert.equal(vistoPorLuis.length, 1);
  assert.equal(vistoPorLuis[0].empleadoEmail, 'ana@test.com');
  assert.equal(vistoPorLuis[0].nota, null);

  assert.equal((await turnos.listarEquipo(ana.id, g.id, rango))[0].nota, 'Cita médica');
  assert.equal((await turnos.listarEquipo(jefe.id, g.id, rango))[0].nota, 'Cita médica');
});

test('disponibilidad: solo empleados del grupo sin turnos en la franja, en cualquiera de sus grupos', async () => {
  const { grupos, turnos, jefe, ana, luis, eva, g } = await escenario();
  await turnos.crearTurno(jefe.id, g.id, { empleadoId: ana.id, inicio: f(2, 9), fin: f(2, 13) });

  const libres = await turnos.disponibilidad(luis.id, g.id, { inicio: f(2, 12), fin: f(2, 14) });
  assert.deepEqual(libres.map((u) => u.email), ['luis@test.com']); // el encargado no cuenta como empleado

  // Una franja que empieza justo cuando acaba el turno de Ana la deja libre
  const despues = await turnos.disponibilidad(luis.id, g.id, { inicio: f(2, 13), fin: f(2, 15) });
  assert.deepEqual(despues.map((u) => u.email).sort(), ['ana@test.com', 'luis@test.com']);

  // Luis ocupado en otro grupo: tampoco está libre
  const g2 = await grupos.crearGrupo(eva.id, { nombre: 'Librería Luna' });
  await unir(grupos, eva, g2, luis);
  await turnos.crearTurno(eva.id, g2.id, { empleadoId: luis.id, inicio: f(2, 14), fin: f(2, 18) });
  const conOtroGrupo = await turnos.disponibilidad(ana.id, g.id, { inicio: f(2, 14), fin: f(2, 16) });
  assert.deepEqual(conOtroGrupo.map((u) => u.email), ['ana@test.com']);
});

test('los rangos de consulta deben ser coherentes y no demasiado grandes (caso de error)', async () => {
  const { turnos, ana, g } = await escenario();
  await assert.rejects(() => turnos.listarMios(ana.id, { desde: f(8, 0), hasta: f(1, 0) }), { codigo: 'RANGO_INVALIDO' });
  await assert.rejects(
    () => turnos.listarEquipo(ana.id, g.id, { desde: '2026-01-01T00:00:00Z', hasta: '2026-12-31T00:00:00Z' }),
    { codigo: 'RANGO_EXCESIVO' }
  );
  await assert.rejects(() => turnos.listarMios(ana.id, { desde: 'ayer', hasta: f(8, 0) }), { codigo: 'FECHA_INVALIDA' });
});

test('al expulsar a un empleado se borran sus turnos futuros pero se conserva el historial', async () => {
  const { grupos, turnos, jefe, ana, g } = await escenario();
  const ahora = Date.now();
  const dia = 24 * 3600 * 1000;
  const turno = (desdeAhora) => ({
    empleadoId: ana.id,
    inicio: new Date(ahora + desdeAhora * dia).toISOString(),
    fin: new Date(ahora + desdeAhora * dia + 4 * 3600 * 1000).toISOString(),
  });
  await turnos.crearTurno(jefe.id, g.id, turno(-3)); // pasado
  await turnos.crearTurno(jefe.id, g.id, turno(3));  // futuro
  const amplio = { desde: new Date(ahora - 10 * dia).toISOString(), hasta: new Date(ahora + 10 * dia).toISOString() };
  assert.equal((await turnos.listarMios(ana.id, amplio)).length, 2);

  await grupos.expulsar(jefe.id, g.id, ana.id);
  const quedan = await turnos.listarMios(ana.id, amplio);
  assert.equal(quedan.length, 1);
  assert.ok(new Date(quedan[0].inicio).getTime() < ahora);
});

test('al eliminar el grupo se eliminan todos sus turnos', async () => {
  const { grupos, turnos, jefe, ana, luis, g } = await escenario();
  await turnos.crearTurno(jefe.id, g.id, { empleadoId: ana.id, inicio: f(2, 9), fin: f(2, 13) });
  await turnos.crearTurno(jefe.id, g.id, { empleadoId: luis.id, inicio: f(3, 9), fin: f(3, 13) });
  await grupos.eliminarGrupo(jefe.id, g.id);
  assert.equal((await turnos.listarMios(ana.id, rango)).length, 0);
  assert.equal((await turnos.listarMios(luis.id, rango)).length, 0);
});