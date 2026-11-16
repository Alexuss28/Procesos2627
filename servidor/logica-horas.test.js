const test = require('node:test');
const assert = require('node:assert/strict');
const { crearServicioUsuarios } = require('./logica');
const { crearRepoMemoria } = require('./datos');
const { crearRepoGruposMemoria } = require('./datos-grupos');
const { crearRepoTurnosMemoria } = require('./datos-turnos');
const { crearServicioGrupos } = require('./logica-grupos');
const { crearServicioTurnos } = require('./logica-turnos');
const { crearServicioHoras, limitesDelMes, msEnRango } = require('./logica-horas');

const iso = (d) => d.toISOString();

test('los límites del mes se calculan en la hora de Madrid, con horario de verano e invierno', () => {
  // Diciembre 2026: UTC+1 todo el mes
  assert.deepEqual(
    [iso(limitesDelMes('2026-12').inicio), iso(limitesDelMes('2026-12').fin)],
    ['2026-11-30T23:00:00.000Z', '2026-12-31T23:00:00.000Z']);
  // Octubre 2026: empieza en horario de verano (UTC+2) y termina en invierno (UTC+1)
  assert.deepEqual(
    [iso(limitesDelMes('2026-10').inicio), iso(limitesDelMes('2026-10').fin)],
    ['2026-09-30T22:00:00.000Z', '2026-10-31T23:00:00.000Z']);
  // Marzo 2026: el cambio al horario de verano es el día 29
  assert.deepEqual(
    [iso(limitesDelMes('2026-03').inicio), iso(limitesDelMes('2026-03').fin)],
    ['2026-02-28T23:00:00.000Z', '2026-03-31T22:00:00.000Z']);
  // Otra zona horaria
  assert.equal(iso(limitesDelMes('2026-12', 'UTC').inicio), '2026-12-01T00:00:00.000Z');
});

test('un mes con formato incorrecto se rechaza (caso de error)', () => {
  for (const malo of ['2026-13', '2026-00', '26-12', 'diciembre', '2026/12', '1999-12', 202612, undefined, null]) {
    assert.throws(() => limitesDelMes(malo), { codigo: 'MES_INVALIDO' }, String(malo));
  }
});

test('un turno que cruza el cambio de mes se reparte entre los dos meses', () => {
  // De 21:00Z del 30 de noviembre a 03:00Z del 1 de diciembre (6 h): la medianoche de Madrid es a las 23:00Z
  const turno = { inicio: '2026-11-30T21:00:00Z', fin: '2026-12-01T03:00:00Z' };
  const dic = limitesDelMes('2026-12');
  const nov = limitesDelMes('2026-11');
  assert.equal(msEnRango(turno, dic.inicio, dic.fin), 4 * 3600 * 1000);
  assert.equal(msEnRango(turno, nov.inicio, nov.fin), 2 * 3600 * 1000);
  assert.equal(msEnRango(turno, limitesDelMes('2027-01').inicio, limitesDelMes('2027-01').fin), 0);
});

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
  const horas = crearServicioHoras({ repoTurnos, repoGrupos, repoUsuarios });

  const g = await grupos.crearGrupo(jefe.id, { nombre: 'Cafetería Sol' });
  for (const p of [ana, luis]) {
    const inv = await grupos.invitar(jefe.id, g.id, { email: p.email });
    await grupos.aceptarInvitacion(p.id, inv.id);
  }
  const crear = (grupoId, encargado, empleado, inicio, fin) =>
    turnos.crearTurno(encargado.id, grupoId, { empleadoId: empleado.id, inicio, fin });
  return { grupos, turnos, horas, jefe, ana, luis, eva, g, crear };
}

test('cada empleado ve sus horas del mes, incluida la parte de un turno que cruza de mes', async () => {
  const e = await escenario();
  await e.crear(e.g.id, e.jefe, e.ana, '2026-12-02T09:00:00Z', '2026-12-02T13:00:00Z'); // 4 h
  await e.crear(e.g.id, e.jefe, e.ana, '2026-12-03T09:00:00Z', '2026-12-03T17:00:00Z'); // 8 h
  await e.crear(e.g.id, e.jefe, e.ana, '2026-11-30T21:00:00Z', '2026-12-01T03:00:00Z'); // 4 h en diciembre y 2 h en noviembre
  await e.crear(e.g.id, e.jefe, e.ana, '2027-01-05T09:00:00Z', '2027-01-05T13:00:00Z'); // enero: no cuenta

  const dic = await e.horas.horasMias(e.ana.id, { mes: '2026-12' });
  assert.equal(dic.minutos, 16 * 60);
  assert.equal(dic.horas, 16);
  assert.deepEqual(dic.porGrupo.map((x) => [x.grupoNombre, x.horas]), [['Cafetería Sol', 16]]);

  const nov = await e.horas.horasMias(e.ana.id, { mes: '2026-11' });
  assert.equal(nov.horas, 2);
});

test('las horas se suman entre grupos y se desglosan por grupo', async () => {
  const e = await escenario();
  const g2 = await e.grupos.crearGrupo(e.eva.id, { nombre: 'Librería Luna' });
  const inv = await e.grupos.invitar(e.eva.id, g2.id, { email: 'ana@test.com' });
  await e.grupos.aceptarInvitacion(e.ana.id, inv.id);
  await e.crear(e.g.id, e.jefe, e.ana, '2026-12-02T09:00:00Z', '2026-12-02T13:00:00Z');   // 4 h
  await e.crear(g2.id, e.eva, e.ana, '2026-12-03T10:00:00Z', '2026-12-03T12:30:00Z');     // 2,5 h

  const r = await e.horas.horasMias(e.ana.id, { mes: '2026-12' });
  assert.equal(r.horas, 6.5);
  assert.deepEqual(r.porGrupo.map((x) => [x.grupoNombre, x.minutos]), [['Cafetería Sol', 240], ['Librería Luna', 150]]);
});

test('el encargado ve las horas de cada empleado de su grupo, incluso con 0 horas', async () => {
  const e = await escenario();
  await e.crear(e.g.id, e.jefe, e.ana, '2026-12-02T09:00:00Z', '2026-12-02T13:00:00Z');
  const r = await e.horas.horasDelGrupo(e.jefe.id, e.g.id, { mes: '2026-12' });
  assert.equal(r.horas, 4);
  assert.deepEqual(r.empleados.map((x) => [x.email, x.horas]), [['ana@test.com', 4], ['luis@test.com', 0]]);
});

test('un empleado no ve las horas del equipo y un ajeno no sabe que el grupo existe (caso de error)', async () => {
  const e = await escenario();
  await assert.rejects(() => e.horas.horasDelGrupo(e.ana.id, e.g.id, { mes: '2026-12' }), { codigo: 'PROHIBIDO' });
  await assert.rejects(() => e.horas.horasDelGrupo(e.eva.id, e.g.id, { mes: '2026-12' }), { codigo: 'NO_ENCONTRADO' });
  await assert.rejects(() => e.horas.horasDelGrupo(e.jefe.id, 'no-existe', { mes: '2026-12' }), { codigo: 'NO_ENCONTRADO' });
  await assert.rejects(() => e.horas.horasMias(undefined, { mes: '2026-12' }), { codigo: 'NO_AUTENTICADO' });
  await assert.rejects(() => e.horas.horasMias(e.ana.id, { mes: 'ayer' }), { codigo: 'MES_INVALIDO' });
});

test('al expulsar a un empleado se conserva el historial de horas de los meses pasados', async () => {
  const e = await escenario();
  await e.crear(e.g.id, e.jefe, e.ana, '2020-03-02T09:00:00Z', '2020-03-02T13:00:00Z'); // pasado: se conserva
  await e.grupos.expulsar(e.jefe.id, e.g.id, e.ana.id);
  const r = await e.horas.horasDelGrupo(e.jefe.id, e.g.id, { mes: '2020-03' });
  // Ana ya no está en el grupo, pero sus horas pasadas siguen contando; Luis sigue como empleado, con 0 horas
  assert.deepEqual(r.empleados.map((x) => [x.email, x.horas]), [['ana@test.com', 4], ['luis@test.com', 0]]);
});