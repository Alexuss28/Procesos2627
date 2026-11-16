const test = require('node:test');
const assert = require('node:assert/strict');
const { crearServicioUsuarios } = require('./logica');
const { crearRepoMemoria } = require('./datos');
const { crearRepoGruposMemoria } = require('./datos-grupos');
const { crearRepoTurnosMemoria } = require('./datos-turnos');
const { crearRepoSolicitudesMemoria } = require('./datos-solicitudes');
const { crearServicioGrupos } = require('./logica-grupos');
const { crearServicioTurnos } = require('./logica-turnos');
const { crearServicioSolicitudes } = require('./logica-solicitudes');

// "Hoy" es el 1 de diciembre de 2026: los turnos de los días 2 en adelante son futuros
const AHORA = new Date('2026-12-01T00:00:00Z');
const f = (dia, hora) => `2026-12-${String(dia).padStart(2, '0')}T${String(hora).padStart(2, '0')}:00:00Z`;
const rango = { desde: f(1, 0), hasta: f(20, 0) };

async function unir(grupos, encargado, grupo, persona) {
  const inv = await grupos.invitar(encargado.id, grupo.id, { email: persona.email });
  await grupos.aceptarInvitacion(persona.id, inv.id);
}

// Grupo "Cafetería Sol": encargado jefe; empleados ana, luis y pepe. eva no pertenece a ningún grupo.
// Turnos: t1 (ana, día 2 9-13), t2 (luis, día 3 9-13), t3 (ana, día 5 9-13), t4 (luis, día 2 14-18)
async function escenario() {
  const repoUsuarios = crearRepoMemoria();
  const usuarios = crearServicioUsuarios({ repo: repoUsuarios, rondasHash: 4 });
  const registrar = (n) => usuarios.registrar({ email: `${n}@test.com`, password: 'password123' });
  const jefe = await registrar('jefe');
  const ana = await registrar('ana');
  const luis = await registrar('luis');
  const pepe = await registrar('pepe');
  const eva = await registrar('eva');

  const repoGrupos = crearRepoGruposMemoria();
  const repoTurnos = crearRepoTurnosMemoria();
  const repoSolicitudes = crearRepoSolicitudesMemoria({ repoTurnos });
  const grupos = crearServicioGrupos({ repo: repoGrupos, repoUsuarios, repoTurnos });
  const turnos = crearServicioTurnos({ repo: repoTurnos, repoGrupos, repoUsuarios });
  const solicitudes = crearServicioSolicitudes({
    repo: repoSolicitudes, repoTurnos, repoGrupos, repoUsuarios, ahora: () => AHORA,
  });

  const g = await grupos.crearGrupo(jefe.id, { nombre: 'Cafetería Sol' });
  for (const p of [ana, luis, pepe]) await unir(grupos, jefe, g, p);

  const crear = (empleado, dia, h1, h2) =>
    turnos.crearTurno(jefe.id, g.id, { empleadoId: empleado.id, inicio: f(dia, h1), fin: f(dia, h2) });
  const t1 = await crear(ana, 2, 9, 13);
  const t2 = await crear(luis, 3, 9, 13);
  const t3 = await crear(ana, 5, 9, 13);
  const t4 = await crear(luis, 2, 14, 18);
  return { repoSolicitudes, repoTurnos, grupos, turnos, solicitudes, jefe, ana, luis, pepe, eva, g, t1, t2, t3, t4, crear };
}

const cesion = (e, extra = {}) => ({ tipo: 'cesion', turnoId: e.t1.id, companeroId: e.luis.id, ...extra });

test('un empleado pide ceder su turno y queda pendiente', async () => {
  const e = await escenario();
  const s = await e.solicitudes.crearSolicitud(e.ana.id, e.g.id, cesion(e, { motivo: ' Médico ' }));
  assert.equal(s.estado, 'pendiente');
  assert.equal(s.tipo, 'cesion');
  assert.equal(s.motivo, 'Médico');
  assert.equal(s.solicitante.email, 'ana@test.com');
  assert.equal(s.companero.email, 'luis@test.com');
  assert.equal(s.turnoDestino, null);
});

test('aprobar una cesión pasa el turno al compañero', async () => {
  const e = await escenario();
  const s = await e.solicitudes.crearSolicitud(e.ana.id, e.g.id, cesion(e));
  const aprobada = await e.solicitudes.aprobarSolicitud(e.jefe.id, s.id, { comentario: 'Vale' });
  assert.equal(aprobada.estado, 'aprobada');
  assert.equal(aprobada.comentario, 'Vale');
  const deAna = (await e.turnos.listarMios(e.ana.id, rango)).map((t) => t.id);
  const deLuis = (await e.turnos.listarMios(e.luis.id, rango)).map((t) => t.id);
  assert.ok(!deAna.includes(e.t1.id));
  assert.ok(deLuis.includes(e.t1.id));
});

test('aprobar un intercambio cambia de manos los dos turnos', async () => {
  const e = await escenario();
  const s = await e.solicitudes.crearSolicitud(e.ana.id, e.g.id,
    { tipo: 'intercambio', turnoId: e.t1.id, companeroId: e.luis.id, turnoDestinoId: e.t2.id });
  assert.equal(s.turnoDestino.id, e.t2.id);
  await e.solicitudes.aprobarSolicitud(e.jefe.id, s.id);
  const deAna = (await e.turnos.listarMios(e.ana.id, rango)).map((t) => t.id);
  const deLuis = (await e.turnos.listarMios(e.luis.id, rango)).map((t) => t.id);
  assert.ok(deAna.includes(e.t2.id) && !deAna.includes(e.t1.id));
  assert.ok(deLuis.includes(e.t1.id) && !deLuis.includes(e.t2.id));
});

test('rechazar una solicitud no cambia ningún turno y guarda el comentario', async () => {
  const e = await escenario();
  const s = await e.solicitudes.crearSolicitud(e.ana.id, e.g.id, cesion(e));
  const r = await e.solicitudes.rechazarSolicitud(e.jefe.id, s.id, { comentario: 'Hace falta gente' });
  assert.equal(r.estado, 'rechazada');
  assert.equal(r.comentario, 'Hace falta gente');
  assert.ok((await e.turnos.listarMios(e.ana.id, rango)).some((t) => t.id === e.t1.id));
});

test('solo quien la pidió puede cancelar una solicitud pendiente (caso de error)', async () => {
  const e = await escenario();
  const s = await e.solicitudes.crearSolicitud(e.ana.id, e.g.id, cesion(e));
  await assert.rejects(() => e.solicitudes.cancelarSolicitud(e.luis.id, s.id), { codigo: 'PROHIBIDO' });
  await assert.rejects(() => e.solicitudes.cancelarSolicitud(e.eva.id, s.id), { codigo: 'NO_ENCONTRADO' });
  assert.equal((await e.solicitudes.cancelarSolicitud(e.ana.id, s.id)).estado, 'cancelada');
  await assert.rejects(() => e.solicitudes.cancelarSolicitud(e.ana.id, s.id), { codigo: 'SOLICITUD_NO_PENDIENTE' });
  // Cancelada la anterior, se puede volver a pedir
  await e.solicitudes.crearSolicitud(e.ana.id, e.g.id, cesion(e));
});

test('solo el encargado resuelve solicitudes (caso de error)', async () => {
  const e = await escenario();
  const s = await e.solicitudes.crearSolicitud(e.ana.id, e.g.id, cesion(e));
  for (const quien of [e.ana, e.luis, e.pepe]) {
    await assert.rejects(() => e.solicitudes.aprobarSolicitud(quien.id, s.id), { codigo: 'PROHIBIDO' });
    await assert.rejects(() => e.solicitudes.rechazarSolicitud(quien.id, s.id), { codigo: 'PROHIBIDO' });
  }
  // Quien es ajeno al grupo ni siquiera sabe que existe, aunque sea encargado de otro grupo
  await e.grupos.crearGrupo(e.eva.id, { nombre: 'Librería Luna' });
  await assert.rejects(() => e.solicitudes.aprobarSolicitud(e.eva.id, s.id), { codigo: 'NO_ENCONTRADO' });
  await assert.rejects(() => e.solicitudes.aprobarSolicitud(undefined, s.id), { codigo: 'NO_AUTENTICADO' });
});

test('solo los empleados piden cambios, y solo de sus propios turnos (caso de error)', async () => {
  const e = await escenario();
  await assert.rejects(() => e.solicitudes.crearSolicitud(e.jefe.id, e.g.id, cesion(e)), { codigo: 'PROHIBIDO' });
  await assert.rejects(() => e.solicitudes.crearSolicitud(e.eva.id, e.g.id, cesion(e)), { codigo: 'NO_ENCONTRADO' });
  // Ana intenta ceder el turno de Luis
  await assert.rejects(
    () => e.solicitudes.crearSolicitud(e.ana.id, e.g.id, { tipo: 'cesion', turnoId: e.t2.id, companeroId: e.pepe.id }),
    { codigo: 'TURNO_NO_PROPIO' }
  );
  await assert.rejects(
    () => e.solicitudes.crearSolicitud(e.ana.id, e.g.id, cesion(e, { turnoId: 'no-existe' })),
    { codigo: 'NO_ENCONTRADO' }
  );
});

test('no se puede cambiar un turno que ya ha empezado (caso de error)', async () => {
  const e = await escenario();
  const pasado = await e.turnos.crearTurno(e.jefe.id, e.g.id,
    { empleadoId: e.ana.id, inicio: '2026-11-20T09:00:00Z', fin: '2026-11-20T13:00:00Z' });
  await assert.rejects(
    () => e.solicitudes.crearSolicitud(e.ana.id, e.g.id, cesion(e, { turnoId: pasado.id })),
    { codigo: 'TURNO_PASADO' }
  );
});

test('el compañero debe ser otro empleado del grupo (caso de error)', async () => {
  const e = await escenario();
  for (const companeroId of [e.ana.id, e.jefe.id, e.eva.id, 'nadie', undefined]) {
    await assert.rejects(
      () => e.solicitudes.crearSolicitud(e.ana.id, e.g.id, cesion(e, { companeroId })),
      { codigo: 'COMPANERO_INVALIDO' }
    );
  }
  await assert.rejects(
    () => e.solicitudes.crearSolicitud(e.ana.id, e.g.id, cesion(e, { tipo: 'trueque' })),
    { codigo: 'TIPO_INVALIDO' }
  );
});

test('un intercambio exige un turno del compañero indicado (caso de error)', async () => {
  const e = await escenario();
  const base = { tipo: 'intercambio', turnoId: e.t1.id, companeroId: e.luis.id };
  await assert.rejects(() => e.solicitudes.crearSolicitud(e.ana.id, e.g.id, base), { codigo: 'TURNO_DESTINO_INVALIDO' });
  // t3 es de la propia Ana, no de Luis
  await assert.rejects(
    () => e.solicitudes.crearSolicitud(e.ana.id, e.g.id, { ...base, turnoDestinoId: e.t3.id }),
    { codigo: 'TURNO_DESTINO_INVALIDO' }
  );
});

test('un turno no puede tener dos solicitudes pendientes (caso de error)', async () => {
  const e = await escenario();
  await e.solicitudes.crearSolicitud(e.ana.id, e.g.id, cesion(e));
  await assert.rejects(
    () => e.solicitudes.crearSolicitud(e.ana.id, e.g.id, cesion(e, { companeroId: e.pepe.id })),
    { codigo: 'SOLICITUD_DUPLICADA' }
  );
});

test('no se pide un cambio que dejaría a alguien con dos turnos a la vez (caso de error)', async () => {
  const e = await escenario();
  // Luis ya trabaja el día 2 de 12 a 16: no puede recibir el turno de Ana del día 2 de 9 a 13
  const choca = await e.turnos.crearTurno(e.jefe.id, e.g.id, { empleadoId: e.pepe.id, inicio: f(2, 11), fin: f(2, 15) });
  await assert.rejects(
    () => e.solicitudes.crearSolicitud(e.ana.id, e.g.id, cesion(e, { companeroId: e.pepe.id })),
    { codigo: 'TURNO_SOLAPADO' }
  );
  assert.ok(choca.id);
  // En un intercambio también cuenta lo que recibe quien pide: Ana recibiría el turno de Pepe del día 5 de 11 a 15,
  // que pisa su propio turno t3 (día 5, 9-13)
  const t5 = await e.crear(e.pepe, 5, 11, 15);
  await assert.rejects(
    () => e.solicitudes.crearSolicitud(e.ana.id, e.g.id,
      { tipo: 'intercambio', turnoId: e.t1.id, companeroId: e.pepe.id, turnoDestinoId: t5.id }),
    { codigo: 'TURNO_SOLAPADO' }
  );
});

test('una solicitud resuelta no se puede resolver otra vez (caso de error)', async () => {
  const e = await escenario();
  const s = await e.solicitudes.crearSolicitud(e.ana.id, e.g.id, cesion(e));
  await e.solicitudes.aprobarSolicitud(e.jefe.id, s.id);
  await assert.rejects(() => e.solicitudes.aprobarSolicitud(e.jefe.id, s.id), { codigo: 'SOLICITUD_NO_PENDIENTE' });
  await assert.rejects(() => e.solicitudes.rechazarSolicitud(e.jefe.id, s.id), { codigo: 'SOLICITUD_NO_PENDIENTE' });
});

test('al aprobar se vuelve a comprobar: si entre medias aparece un choque, no se aplica (caso de error)', async () => {
  const e = await escenario();
  const s = await e.solicitudes.crearSolicitud(e.ana.id, e.g.id, cesion(e));
  // Tras la solicitud, el encargado le pone a Luis un turno que choca con el que va a recibir
  await e.turnos.crearTurno(e.jefe.id, e.g.id, { empleadoId: e.luis.id, inicio: f(2, 10), fin: f(2, 12) });
  await assert.rejects(() => e.solicitudes.aprobarSolicitud(e.jefe.id, s.id), { codigo: 'TURNO_SOLAPADO' });
  // La solicitud sigue pendiente y el turno sigue siendo de Ana
  assert.equal((await e.solicitudes.listarSolicitudes(e.jefe.id, e.g.id, { estado: 'pendiente' })).length, 1);
  assert.ok((await e.turnos.listarMios(e.ana.id, rango)).some((t) => t.id === e.t1.id));
});

test('si el turno cambió de manos desde la solicitud, la solicitud queda obsoleta (caso de error)', async () => {
  const e = await escenario();
  const s = await e.solicitudes.crearSolicitud(e.ana.id, e.g.id, cesion(e));
  await e.turnos.editarTurno(e.jefe.id, e.t1.id, { empleadoId: e.pepe.id }); // el encargado lo reasigna
  await assert.rejects(() => e.solicitudes.aprobarSolicitud(e.jefe.id, s.id), { codigo: 'SOLICITUD_OBSOLETA' });
  // El encargado puede rechazarla para cerrarla
  assert.equal((await e.solicitudes.rechazarSolicitud(e.jefe.id, s.id)).estado, 'rechazada');
});

test('el repositorio no aplica nada si alguno de los turnos ya no está en manos esperadas', async () => {
  const e = await escenario();
  const s = await e.solicitudes.crearSolicitud(e.ana.id, e.g.id,
    { tipo: 'intercambio', turnoId: e.t1.id, companeroId: e.luis.id, turnoDestinoId: e.t2.id });
  // Se simula una carrera: el segundo turno ya no es de Luis, así que el cambio no debe aplicarse a medias
  const ok = await e.repoSolicitudes.aplicarAprobacion({
    solicitudId: s.id, resueltaPor: e.jefe.id, comentario: null,
    cambios: [
      { turnoId: e.t1.id, deEmpleadoId: e.ana.id, aEmpleadoId: e.luis.id },
      { turnoId: e.t2.id, deEmpleadoId: e.pepe.id, aEmpleadoId: e.ana.id },
    ],
  });
  assert.equal(ok, false);
  assert.equal((await e.repoTurnos.buscarPorId(e.t1.id)).empleadoId, e.ana.id); // el primero NO se tocó
  assert.equal((await e.repoSolicitudes.buscarPorId(s.id)).estado, 'pendiente');
});

test('cada uno ve las solicitudes que le afectan; el encargado, todas; un ajeno, ninguna', async () => {
  const e = await escenario();
  await e.solicitudes.crearSolicitud(e.ana.id, e.g.id, cesion(e));
  assert.equal((await e.solicitudes.listarSolicitudes(e.jefe.id, e.g.id)).length, 1);
  assert.equal((await e.solicitudes.listarSolicitudes(e.ana.id, e.g.id)).length, 1);  // la pidió
  assert.equal((await e.solicitudes.listarSolicitudes(e.luis.id, e.g.id)).length, 1); // es el compañero
  assert.equal((await e.solicitudes.listarSolicitudes(e.pepe.id, e.g.id)).length, 0); // no le afecta
  await assert.rejects(() => e.solicitudes.listarSolicitudes(e.eva.id, e.g.id), { codigo: 'NO_ENCONTRADO' });
  await assert.rejects(() => e.solicitudes.listarSolicitudes(e.jefe.id, e.g.id, { estado: 'rara' }), { codigo: 'ESTADO_INVALIDO' });
  assert.equal((await e.solicitudes.listarSolicitudes(e.jefe.id, e.g.id, { estado: 'aprobada' })).length, 0);
});