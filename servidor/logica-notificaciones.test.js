const test = require('node:test');
const assert = require('node:assert/strict');
const { crearServicioUsuarios } = require('./logica');
const { crearRepoMemoria } = require('./datos');
const { crearRepoGruposMemoria } = require('./datos-grupos');
const { crearRepoTurnosMemoria } = require('./datos-turnos');
const { crearRepoSolicitudesMemoria } = require('./datos-solicitudes');
const { crearRepoNotificacionesMemoria } = require('./datos-notificaciones');
const { crearServicioGrupos } = require('./logica-grupos');
const { crearServicioTurnos } = require('./logica-turnos');
const { crearServicioSolicitudes } = require('./logica-solicitudes');
const { crearServicioNotificaciones, describirFranja } = require('./logica-notificaciones');

const AHORA = new Date('2026-12-01T00:00:00Z');
const f = (dia, hora) => `2026-12-${String(dia).padStart(2, '0')}T${String(hora).padStart(2, '0')}:00:00Z`;

// Escenario completo con las notificaciones enchufadas a los servicios.
// Grupo "Cafetería Sol": encargado jefe; empleados ana y luis. eva y marta están fuera del grupo.
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
  const repoSolicitudes = crearRepoSolicitudesMemoria({ repoTurnos });
  const notificaciones = crearServicioNotificaciones({ repo: crearRepoNotificacionesMemoria(), repoUsuarios });
  const { notificar } = notificaciones;
  const grupos = crearServicioGrupos({ repo: repoGrupos, repoUsuarios, repoTurnos, notificar });
  const turnos = crearServicioTurnos({ repo: repoTurnos, repoGrupos, repoUsuarios, notificar });
  const solicitudes = crearServicioSolicitudes({
    repo: repoSolicitudes, repoTurnos, repoGrupos, repoUsuarios, notificar, ahora: () => AHORA,
  });

  const g = await grupos.crearGrupo(jefe.id, { nombre: 'Cafetería Sol' });
  for (const p of [ana, luis]) {
    const inv = await grupos.invitar(jefe.id, g.id, { email: p.email });
    await grupos.aceptarInvitacion(p.id, inv.id);
  }
  // Lo anterior ya ha generado avisos: se parte de cero
  for (const u of [jefe, ana, luis, eva]) await notificaciones.marcarTodasLeidas(u.id);
  const mensajes = async (u) => (await notificaciones.listar(u.id)).notificaciones.filter((n) => !n.leida).map((n) => n.mensaje);
  return { usuarios, repoUsuarios, notificaciones, grupos, turnos, solicitudes, jefe, ana, luis, eva, g, mensajes };
}

test('describirFranja escribe el día y la hora de Madrid', () => {
  // 08:00Z en diciembre son las 09:00 en Madrid (UTC+1)
  assert.match(describirFranja('2026-12-02T08:00:00Z', '2026-12-02T12:00:00Z'), /09:00–13:00$/);
  // En verano son dos horas de diferencia
  assert.match(describirFranja('2026-07-02T08:00:00Z', '2026-07-02T12:00:00Z'), /10:00–14:00$/);
});

test('cada usuario ve solo sus avisos, el más reciente primero, con el contador de no leídos', async () => {
  const { notificaciones, ana, eva } = await escenario(); // eva parte sin ningún aviso
  await notificaciones.notificar([eva.id], { tipo: 'turno', mensaje: 'primero' });
  await notificaciones.notificar([eva.id, eva.id, null], { tipo: 'turno', mensaje: 'segundo' }); // sin duplicados ni nulos
  const r = await notificaciones.listar(eva.id);
  assert.deepEqual(r.notificaciones.map((n) => n.mensaje), ['segundo', 'primero']);
  assert.equal(r.noLeidas, 2);
  const deAna = (await notificaciones.listar(ana.id)).notificaciones.map((n) => n.mensaje);
  assert.ok(!deAna.includes('primero') && !deAna.includes('segundo')); // los avisos de eva no son de ana
  assert.equal((await notificaciones.listar(eva.id, { limite: 1 })).notificaciones.length, 1);
});

test('marcar como leída: solo el dueño, y se puede marcar todo de una vez (caso de error)', async () => {
  const { notificaciones, ana, luis } = await escenario();
  await notificaciones.notificar([ana.id], { tipo: 'turno', mensaje: 'uno' });
  await notificaciones.notificar([ana.id], { tipo: 'turno', mensaje: 'dos' });
  const [primera] = (await notificaciones.listar(ana.id)).notificaciones;
  await assert.rejects(() => notificaciones.marcarLeida(luis.id, primera.id), { codigo: 'NO_ENCONTRADO' });
  await assert.rejects(() => notificaciones.marcarLeida(ana.id, 'no-existe'), { codigo: 'NO_ENCONTRADO' });
  await notificaciones.marcarLeida(ana.id, primera.id);
  assert.equal((await notificaciones.listar(ana.id)).noLeidas, 1);
  await notificaciones.marcarTodasLeidas(ana.id);
  assert.equal((await notificaciones.listar(ana.id)).noLeidas, 0);
  await assert.rejects(() => notificaciones.listar(undefined), { codigo: 'NO_AUTENTICADO' });
});

test('si falla el guardado de un aviso, la operación principal sigue adelante', async () => {
  const repoRoto = { crear: async () => { throw new Error('base de datos caída'); } };
  const registros = [];
  const n = crearServicioNotificaciones({
    repo: repoRoto, repoUsuarios: crearRepoMemoria(), log: (nivel, mensaje) => registros.push([nivel, mensaje]),
  });
  await n.notificar(['alguien'], { tipo: 'turno', mensaje: 'x' }); // no lanza
  assert.deepEqual(registros, [['error', 'no se pudo crear la notificación']]);
});

test('invitar avisa a quien ya tiene cuenta; a un correo sin cuenta no hay nadie a quien avisar', async () => {
  const { grupos, usuarios, jefe, eva, g, mensajes } = await escenario();
  await grupos.invitar(jefe.id, g.id, { email: 'eva@test.com' });
  assert.deepEqual(await mensajes(eva), ['Te han invitado al grupo «Cafetería Sol»']);
  await grupos.invitar(jefe.id, g.id, { email: 'nadie@test.com' }); // sin error
  const nueva = await usuarios.registrar({ email: 'nadie@test.com', password: 'password123' });
  assert.deepEqual(await mensajes(nueva), []); // la invitación la espera, pero no genera aviso retroactivo
});

test('aceptar, salir, expulsar y eliminar el grupo avisan a quien corresponde', async () => {
  const { grupos, jefe, ana, luis, eva, g, mensajes } = await escenario();

  const inv = await grupos.invitar(jefe.id, g.id, { email: 'eva@test.com' });
  await grupos.aceptarInvitacion(eva.id, inv.id);
  assert.ok((await mensajes(jefe)).includes('eva@test.com se ha unido al grupo «Cafetería Sol»'));

  await grupos.salir(luis.id, g.id);
  assert.ok((await mensajes(jefe)).includes('luis@test.com ha salido del grupo «Cafetería Sol»'));

  await grupos.expulsar(jefe.id, g.id, eva.id);
  assert.ok((await mensajes(eva)).includes('Te han expulsado del grupo «Cafetería Sol»'));

  await grupos.eliminarGrupo(jefe.id, g.id);
  assert.ok((await mensajes(ana)).includes('El grupo «Cafetería Sol» ha sido eliminado por su encargado'));
  assert.equal((await mensajes(jefe)).filter((m) => m.includes('eliminado')).length, 0); // quien elimina no se avisa a sí mismo
});

test('crear, cambiar, reasignar y eliminar un turno avisa al empleado afectado', async () => {
  const { turnos, jefe, ana, luis, g, mensajes } = await escenario();
  const t = await turnos.crearTurno(jefe.id, g.id, { empleadoId: ana.id, inicio: f(2, 9), fin: f(2, 13) });
  let m = await mensajes(ana);
  assert.equal(m.length, 1);
  assert.match(m[0], /^Te han asignado un turno en Cafetería Sol: .*10:00–14:00$/);

  await turnos.editarTurno(jefe.id, t.id, { nota: 'solo una nota' }); // un cambio que no afecta al horario no avisa
  assert.equal((await mensajes(ana)).length, 1);

  await turnos.editarTurno(jefe.id, t.id, { fin: f(2, 14) });
  assert.match((await mensajes(ana))[0], /^Tu turno en Cafetería Sol ha cambiado: ahora es .*10:00–15:00$/);

  await turnos.editarTurno(jefe.id, t.id, { empleadoId: luis.id });
  assert.match((await mensajes(ana))[0], /^Te han quitado un turno en Cafetería Sol/);
  assert.match((await mensajes(luis))[0], /^Te han asignado un turno en Cafetería Sol/);

  await turnos.eliminarTurno(jefe.id, t.id);
  assert.match((await mensajes(luis))[0], /^Se ha eliminado tu turno en Cafetería Sol/);
});

test('las solicitudes avisan al encargado y al compañero; resolverlas avisa a los implicados', async () => {
  const { turnos, solicitudes, jefe, ana, luis, g, mensajes } = await escenario();
  const t1 = await turnos.crearTurno(jefe.id, g.id, { empleadoId: ana.id, inicio: f(3, 9), fin: f(3, 13) });
  const t2 = await turnos.crearTurno(jefe.id, g.id, { empleadoId: luis.id, inicio: f(4, 9), fin: f(4, 13) });

  const s = await solicitudes.crearSolicitud(ana.id, g.id,
    { tipo: 'intercambio', turnoId: t1.id, companeroId: luis.id, turnoDestinoId: t2.id });
  assert.ok((await mensajes(jefe)).some((m) => /^ana pide intercambiar un turno con luis/.test(m)));
  assert.ok((await mensajes(luis)).some((m) => /^ana propone intercambiar su turno/.test(m)));

  await solicitudes.aprobarSolicitud(jefe.id, s.id, { comentario: 'Vale' });
  assert.ok((await mensajes(ana)).includes('Tu solicitud de cambio de turno ha sido aprobada: «Vale»'));
  assert.ok((await mensajes(luis)).some((m) => /^Se ha aprobado un cambio con ana/.test(m)));
});

test('rechazar una solicitud avisa a quien la pidió con el motivo', async () => {
  const { turnos, solicitudes, jefe, ana, luis, g, mensajes } = await escenario();
  const t1 = await turnos.crearTurno(jefe.id, g.id, { empleadoId: ana.id, inicio: f(3, 9), fin: f(3, 13) });
  const s = await solicitudes.crearSolicitud(ana.id, g.id, { tipo: 'cesion', turnoId: t1.id, companeroId: luis.id });
  await solicitudes.rechazarSolicitud(jefe.id, s.id, { comentario: 'Falta gente ese día' });
  assert.ok((await mensajes(ana)).includes('Tu solicitud de cambio de turno ha sido rechazada: «Falta gente ese día»'));
});