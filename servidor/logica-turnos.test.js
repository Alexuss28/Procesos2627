const test = require('node:test');
const assert = require('node:assert/strict');
const { crearServicioUsuarios } = require('./logica');
const { crearRepoMemoria } = require('./datos');
const { crearRepoTurnosMemoria } = require('./datos-turnos');
const { crearServicioTurnos, seSolapan } = require('./logica-turnos');
const { parsearFecha } = require('./fechas');

// Fechas de prueba: diciembre de 2026 en UTC
const f = (dia, hora, min = '00') => `2026-12-${String(dia).padStart(2, '0')}T${String(hora).padStart(2, '0')}:${min}:00Z`;

async function escenario() {
  const repoUsuarios = crearRepoMemoria();
  const usuarios = crearServicioUsuarios({ repo: repoUsuarios, rondasHash: 4 });
  await usuarios.asegurarAdministrador('jefe@test.com', 'admin12345');
  const jefe = await repoUsuarios.buscarPorEmail('jefe@test.com');
  const ana = await usuarios.registrar({ email: 'ana@test.com', password: 'password123' });
  const luis = await usuarios.registrar({ email: 'luis@test.com', password: 'password123' });
  const turnos = crearServicioTurnos({ repo: crearRepoTurnosMemoria(), repoUsuarios });
  return { turnos, jefe, ana, luis };
}

const rango = { desde: f(1, 0), hasta: f(8, 0) };

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

test('el encargado crea un turno y el empleado lo ve en sus turnos', async () => {
  const { turnos, jefe, ana } = await escenario();
  const t = await turnos.crearTurno(jefe.id, { empleadoId: ana.id, inicio: f(2, 9), fin: f(2, 17), nota: ' Apertura ' });
  assert.equal(t.nota, 'Apertura');
  const mios = await turnos.listarMios(ana.id, rango);
  assert.equal(mios.length, 1);
  assert.equal(mios[0].id, t.id);
});

test('un empleado no puede crear turnos (caso de error)', async () => {
  const { turnos, ana, luis } = await escenario();
  await assert.rejects(
    () => turnos.crearTurno(ana.id, { empleadoId: luis.id, inicio: f(2, 9), fin: f(2, 17) }),
    { codigo: 'PROHIBIDO' }
  );
});

test('sin sesión no se puede consultar nada (caso de error)', async () => {
  const { turnos } = await escenario();
  await assert.rejects(() => turnos.listarEquipo(undefined, rango), { codigo: 'NO_AUTENTICADO' });
});

test('un turno debe terminar después de empezar (caso de error)', async () => {
  const { turnos, jefe, ana } = await escenario();
  await assert.rejects(
    () => turnos.crearTurno(jefe.id, { empleadoId: ana.id, inicio: f(2, 17), fin: f(2, 9) }),
    { codigo: 'RANGO_INVALIDO' }
  );
});

test('un turno no puede durar más de 12 horas (caso de error)', async () => {
  const { turnos, jefe, ana } = await escenario();
  await assert.rejects(
    () => turnos.crearTurno(jefe.id, { empleadoId: ana.id, inicio: f(2, 8), fin: f(2, 21) }),
    { codigo: 'TURNO_DEMASIADO_LARGO' }
  );
  // Exactamente 12 horas sí se admite
  await turnos.crearTurno(jefe.id, { empleadoId: ana.id, inicio: f(2, 8), fin: f(2, 20) });
});

test('un empleado no puede tener dos turnos solapados (caso de error)', async () => {
  const { turnos, jefe, ana } = await escenario();
  await turnos.crearTurno(jefe.id, { empleadoId: ana.id, inicio: f(2, 9), fin: f(2, 13) });
  await assert.rejects(
    () => turnos.crearTurno(jefe.id, { empleadoId: ana.id, inicio: f(2, 12), fin: f(2, 16) }),
    { codigo: 'TURNO_SOLAPADO' }
  );
});

test('turnos consecutivos del mismo empleado y turnos simultáneos de empleados distintos son válidos', async () => {
  const { turnos, jefe, ana, luis } = await escenario();
  await turnos.crearTurno(jefe.id, { empleadoId: ana.id, inicio: f(2, 9), fin: f(2, 13) });
  await turnos.crearTurno(jefe.id, { empleadoId: ana.id, inicio: f(2, 13), fin: f(2, 17) });
  await turnos.crearTurno(jefe.id, { empleadoId: luis.id, inicio: f(2, 9), fin: f(2, 13) });
  assert.equal((await turnos.listarEquipo(jefe.id, rango)).length, 3);
});

test('no se asignan turnos al encargado ni a empleados inexistentes (caso de error)', async () => {
  const { turnos, jefe } = await escenario();
  await assert.rejects(
    () => turnos.crearTurno(jefe.id, { empleadoId: jefe.id, inicio: f(2, 9), fin: f(2, 13) }),
    { codigo: 'EMPLEADO_INVALIDO' }
  );
  await assert.rejects(
    () => turnos.crearTurno(jefe.id, { empleadoId: 'no-existe', inicio: f(2, 9), fin: f(2, 13) }),
    { codigo: 'NO_ENCONTRADO' }
  );
});

test('editar un turno aplica los cambios y vuelve a comprobar los solapes', async () => {
  const { turnos, jefe, ana } = await escenario();
  const a = await turnos.crearTurno(jefe.id, { empleadoId: ana.id, inicio: f(2, 9), fin: f(2, 13) });
  await turnos.crearTurno(jefe.id, { empleadoId: ana.id, inicio: f(2, 15), fin: f(2, 19) });

  // Alargar el turno sin invadir otro (y sin solaparse consigo mismo) es válido
  const editado = await turnos.editarTurno(jefe.id, a.id, { fin: f(2, 14) });
  assert.equal(editado.fin, new Date(f(2, 14)).toISOString());

  // Alargarlo hasta pisar el turno de la tarde falla
  await assert.rejects(() => turnos.editarTurno(jefe.id, a.id, { fin: f(2, 16) }), { codigo: 'TURNO_SOLAPADO' });
});

test('solo el encargado elimina turnos, y el turno desaparece', async () => {
  const { turnos, jefe, ana } = await escenario();
  const t = await turnos.crearTurno(jefe.id, { empleadoId: ana.id, inicio: f(2, 9), fin: f(2, 13) });
  await assert.rejects(() => turnos.eliminarTurno(ana.id, t.id), { codigo: 'PROHIBIDO' });
  await turnos.eliminarTurno(jefe.id, t.id);
  assert.equal((await turnos.listarMios(ana.id, rango)).length, 0);
  await assert.rejects(() => turnos.eliminarTurno(jefe.id, t.id), { codigo: 'NO_ENCONTRADO' });
});

test('"mis turnos" solo devuelve los del propio empleado', async () => {
  const { turnos, jefe, ana, luis } = await escenario();
  await turnos.crearTurno(jefe.id, { empleadoId: ana.id, inicio: f(2, 9), fin: f(2, 13) });
  await turnos.crearTurno(jefe.id, { empleadoId: luis.id, inicio: f(3, 9), fin: f(3, 13) });
  const mios = await turnos.listarMios(luis.id, rango);
  assert.equal(mios.length, 1);
  assert.equal(mios[0].empleadoId, luis.id);
});

test('el calendario del equipo lo ve todo el mundo, pero la nota solo el encargado y su dueño', async () => {
  const { turnos, jefe, ana, luis } = await escenario();
  await turnos.crearTurno(jefe.id, { empleadoId: ana.id, inicio: f(2, 9), fin: f(2, 13), nota: 'Cita médica' });

  const vistoPorLuis = await turnos.listarEquipo(luis.id, rango);
  assert.equal(vistoPorLuis.length, 1);
  assert.equal(vistoPorLuis[0].empleadoEmail, 'ana@test.com');
  assert.equal(vistoPorLuis[0].nota, null);

  assert.equal((await turnos.listarEquipo(ana.id, rango))[0].nota, 'Cita médica');
  assert.equal((await turnos.listarEquipo(jefe.id, rango))[0].nota, 'Cita médica');
});

test('disponibilidad: solo aparecen los empleados sin turnos en la franja', async () => {
  const { turnos, jefe, ana, luis } = await escenario();
  await turnos.crearTurno(jefe.id, { empleadoId: ana.id, inicio: f(2, 9), fin: f(2, 13) });

  const libres = await turnos.disponibilidad(luis.id, { inicio: f(2, 12), fin: f(2, 14) });
  assert.deepEqual(libres.map((u) => u.email), ['luis@test.com']); // el encargado no cuenta como empleado

  // Una franja que empieza justo cuando acaba el turno de Ana la deja libre
  const despues = await turnos.disponibilidad(luis.id, { inicio: f(2, 13), fin: f(2, 15) });
  assert.deepEqual(despues.map((u) => u.email).sort(), ['ana@test.com', 'luis@test.com']);
});

test('los rangos de consulta deben ser coherentes y no demasiado grandes (caso de error)', async () => {
  const { turnos, ana } = await escenario();
  await assert.rejects(() => turnos.listarMios(ana.id, { desde: f(8, 0), hasta: f(1, 0) }), { codigo: 'RANGO_INVALIDO' });
  await assert.rejects(
    () => turnos.listarEquipo(ana.id, { desde: '2026-01-01T00:00:00Z', hasta: '2026-12-31T00:00:00Z' }),
    { codigo: 'RANGO_EXCESIVO' }
  );
  await assert.rejects(() => turnos.listarMios(ana.id, { desde: 'ayer', hasta: f(8, 0) }), { codigo: 'FECHA_INVALIDA' });
});