const test = require('node:test');
const assert = require('node:assert/strict');
const { crearServicioUsuarios } = require('./logica');
const { crearRepoMemoria } = require('./datos');
const { crearRepoGruposMemoria } = require('./datos-grupos');
const { crearServicioGrupos, MAX_GRUPOS_COMO_ENCARGADO } = require('./logica-grupos');

// Escenario: cuatro usuarios registrados y un "repoTurnos" falso que anota las limpiezas pedidas
async function escenario() {
  const repoUsuarios = crearRepoMemoria();
  const usuarios = crearServicioUsuarios({ repo: repoUsuarios, rondasHash: 4 });
  const registrar = (nombre) => usuarios.registrar({ email: `${nombre}@test.com`, password: 'password123' });
  const jefe = await registrar('jefe');
  const ana = await registrar('ana');
  const luis = await registrar('luis');
  const eva = await registrar('eva');

  const limpiezas = [];
  const repoTurnos = {
    eliminarFuturos: async (datos) => { limpiezas.push(['futuros', datos]); },
    eliminarPorGrupo: async (grupoId) => { limpiezas.push(['grupo', grupoId]); },
  };
  const grupos = crearServicioGrupos({ repo: crearRepoGruposMemoria(), repoUsuarios, repoTurnos });
  return { grupos, usuarios, jefe, ana, luis, eva, limpiezas };
}

// Crea un grupo del jefe y mete dentro a Ana (invitación + aceptación)
async function grupoConAna() {
  const e = await escenario();
  const g = await e.grupos.crearGrupo(e.jefe.id, { nombre: 'Cafetería Sol' });
  const inv = await e.grupos.invitar(e.jefe.id, g.id, { email: 'ana@test.com' });
  await e.grupos.aceptarInvitacion(e.ana.id, inv.id);
  return { ...e, g };
}

test('quien crea un grupo es su encargado y lo ve en sus grupos', async () => {
  const { grupos, jefe } = await escenario();
  const g = await grupos.crearGrupo(jefe.id, { nombre: '  Cafetería Sol ' });
  assert.equal(g.nombre, 'Cafetería Sol');
  assert.equal(g.miRol, 'encargado');
  const mis = await grupos.listarMisGrupos(jefe.id);
  assert.deepEqual(mis.map((x) => [x.nombre, x.miRol, x.numMiembros]), [['Cafetería Sol', 'encargado', 1]]);
});

test('el nombre del grupo debe tener entre 2 y 60 caracteres (caso de error)', async () => {
  const { grupos, jefe } = await escenario();
  for (const malo of ['', ' a ', 'x'.repeat(61), undefined, 42]) {
    await assert.rejects(() => grupos.crearGrupo(jefe.id, { nombre: malo }), { codigo: 'NOMBRE_INVALIDO' });
  }
});

test('hay un límite de grupos por encargado (caso de error)', async () => {
  const { grupos, jefe } = await escenario();
  for (let i = 0; i < MAX_GRUPOS_COMO_ENCARGADO; i++) await grupos.crearGrupo(jefe.id, { nombre: `Grupo ${i}` });
  await assert.rejects(() => grupos.crearGrupo(jefe.id, { nombre: 'Uno más' }), { codigo: 'LIMITE_GRUPOS' });
});

test('sin sesión no se puede hacer nada (caso de error)', async () => {
  const { grupos } = await escenario();
  await assert.rejects(() => grupos.crearGrupo(undefined, { nombre: 'Grupo' }), { codigo: 'NO_AUTENTICADO' });
  await assert.rejects(() => grupos.listarMisGrupos('no-existe'), { codigo: 'NO_AUTENTICADO' });
});

test('solo el encargado invita; un empleado recibe 403 y un ajeno 404 (caso de error)', async () => {
  const { grupos, ana, eva, g } = await grupoConAna();
  await assert.rejects(() => grupos.invitar(ana.id, g.id, { email: 'luis@test.com' }), { codigo: 'PROHIBIDO' });
  await assert.rejects(() => grupos.invitar(eva.id, g.id, { email: 'luis@test.com' }), { codigo: 'NO_ENCONTRADO' });
});

test('no se invita con un correo inválido, a quien ya es miembro, ni dos veces (caso de error)', async () => {
  const { grupos, jefe, g } = await grupoConAna();
  await assert.rejects(() => grupos.invitar(jefe.id, g.id, { email: 'no-es-un-correo' }), { codigo: 'EMAIL_INVALIDO' });
  await assert.rejects(() => grupos.invitar(jefe.id, g.id, { email: 'ana@test.com' }), { codigo: 'YA_ES_MIEMBRO' });
  await assert.rejects(() => grupos.invitar(jefe.id, g.id, { email: 'JEFE@test.com' }), { codigo: 'YA_ES_MIEMBRO' });
  await grupos.invitar(jefe.id, g.id, { email: 'luis@test.com' });
  await assert.rejects(() => grupos.invitar(jefe.id, g.id, { email: ' Luis@Test.com ' }), { codigo: 'INVITACION_DUPLICADA' });
});

test('al aceptar una invitación la persona entra como empleado y la invitación no se reutiliza', async () => {
  const { grupos, jefe, ana, g } = await grupoConAna();
  const mis = await grupos.listarMisGrupos(ana.id);
  assert.deepEqual(mis.map((x) => [x.nombre, x.miRol, x.numMiembros]), [['Cafetería Sol', 'empleado', 2]]);
  assert.equal((await grupos.listarMisInvitaciones(ana.id)).length, 0);
  assert.equal((await grupos.listarInvitacionesDeGrupo(jefe.id, g.id)).length, 0);
});

test('una invitación solo la puede aceptar o rechazar su destinatario (caso de error)', async () => {
  const { grupos, jefe, luis, eva, g } = await grupoConAna();
  const inv = await grupos.invitar(jefe.id, g.id, { email: 'luis@test.com' });
  await assert.rejects(() => grupos.aceptarInvitacion(eva.id, inv.id), { codigo: 'NO_ENCONTRADO' });
  await assert.rejects(() => grupos.rechazarInvitacion(eva.id, inv.id), { codigo: 'NO_ENCONTRADO' });
  await grupos.aceptarInvitacion(luis.id, inv.id);
  // Ya aceptada: no se puede volver a usar
  await assert.rejects(() => grupos.aceptarInvitacion(luis.id, inv.id), { codigo: 'NO_ENCONTRADO' });
});

test('una invitación a un correo aún sin cuenta espera y se puede aceptar al registrarse', async () => {
  const { grupos, usuarios, jefe, g } = await grupoConAna();
  const inv = await grupos.invitar(jefe.id, g.id, { email: 'nuevo@test.com' });
  const nuevo = await usuarios.registrar({ email: 'nuevo@test.com', password: 'password123' });
  const recibidas = await grupos.listarMisInvitaciones(nuevo.id);
  assert.equal(recibidas.length, 1);
  assert.equal(recibidas[0].grupoNombre, 'Cafetería Sol');
  await grupos.aceptarInvitacion(nuevo.id, inv.id);
  assert.equal((await grupos.obtenerGrupo(nuevo.id, g.id)).miRol, 'empleado');
});

test('rechazar una invitación no mete a nadie en el grupo', async () => {
  const { grupos, jefe, luis, g } = await grupoConAna();
  const inv = await grupos.invitar(jefe.id, g.id, { email: 'luis@test.com' });
  await grupos.rechazarInvitacion(luis.id, inv.id);
  assert.equal((await grupos.listarMisInvitaciones(luis.id)).length, 0);
  await assert.rejects(() => grupos.obtenerGrupo(luis.id, g.id), { codigo: 'NO_ENCONTRADO' });
  // Tras rechazar, el encargado puede volver a invitarle
  await grupos.invitar(jefe.id, g.id, { email: 'luis@test.com' });
});

test('el encargado puede cancelar una invitación pendiente', async () => {
  const { grupos, jefe, ana, luis, g } = await grupoConAna();
  const inv = await grupos.invitar(jefe.id, g.id, { email: 'luis@test.com' });
  await assert.rejects(() => grupos.cancelarInvitacion(ana.id, g.id, inv.id), { codigo: 'PROHIBIDO' });
  await grupos.cancelarInvitacion(jefe.id, g.id, inv.id);
  assert.equal((await grupos.listarMisInvitaciones(luis.id)).length, 0);
  await assert.rejects(() => grupos.cancelarInvitacion(jefe.id, g.id, inv.id), { codigo: 'NO_ENCONTRADO' });
});

test('los miembros ven el grupo con sus miembros; un ajeno no lo ve (caso de error)', async () => {
  const { grupos, ana, eva, g } = await grupoConAna();
  const visto = await grupos.obtenerGrupo(ana.id, g.id);
  assert.deepEqual(visto.miembros.map((m) => [m.email, m.rol]), [['jefe@test.com', 'encargado'], ['ana@test.com', 'empleado']]);
  await assert.rejects(() => grupos.obtenerGrupo(eva.id, g.id), { codigo: 'NO_ENCONTRADO' });
  await assert.rejects(() => grupos.obtenerGrupo(eva.id, 'id-inventado'), { codigo: 'NO_ENCONTRADO' });
});

test('expulsar: solo el encargado, nunca a sí mismo, y se limpian los turnos futuros', async () => {
  const { grupos, jefe, ana, g, limpiezas } = await grupoConAna();
  await assert.rejects(() => grupos.expulsar(ana.id, g.id, jefe.id), { codigo: 'PROHIBIDO' });
  await assert.rejects(() => grupos.expulsar(jefe.id, g.id, jefe.id), { codigo: 'NO_PERMITIDO' });
  await assert.rejects(() => grupos.expulsar(jefe.id, g.id, 'nadie'), { codigo: 'NO_ENCONTRADO' });

  await grupos.expulsar(jefe.id, g.id, ana.id);
  await assert.rejects(() => grupos.obtenerGrupo(ana.id, g.id), { codigo: 'NO_ENCONTRADO' });
  assert.equal(limpiezas.length, 1);
  assert.equal(limpiezas[0][0], 'futuros');
  assert.equal(limpiezas[0][1].grupoId, g.id);
  assert.equal(limpiezas[0][1].empleadoId, ana.id);
});

test('un empleado puede salir del grupo, pero el encargado no (caso de error)', async () => {
  const { grupos, jefe, ana, g, limpiezas } = await grupoConAna();
  await assert.rejects(() => grupos.salir(jefe.id, g.id), { codigo: 'NO_PERMITIDO' });
  await grupos.salir(ana.id, g.id);
  assert.equal((await grupos.listarMisGrupos(ana.id)).length, 0);
  assert.equal(limpiezas[0][0], 'futuros');
});

test('eliminar un grupo: solo su encargado, y desaparece para todos', async () => {
  const { grupos, jefe, ana, g, limpiezas } = await grupoConAna();
  await assert.rejects(() => grupos.eliminarGrupo(ana.id, g.id), { codigo: 'PROHIBIDO' });
  await grupos.eliminarGrupo(jefe.id, g.id);
  assert.equal((await grupos.listarMisGrupos(jefe.id)).length, 0);
  assert.equal((await grupos.listarMisGrupos(ana.id)).length, 0);
  assert.deepEqual(limpiezas, [['grupo', g.id]]);
  await assert.rejects(() => grupos.obtenerGrupo(jefe.id, g.id), { codigo: 'NO_ENCONTRADO' });
});

test('una persona puede ser encargada de un grupo y empleada de otro', async () => {
  const { grupos, jefe, ana, g } = await grupoConAna();
  const propio = await grupos.crearGrupo(ana.id, { nombre: 'Librería Luna' });
  const inv = await grupos.invitar(ana.id, propio.id, { email: 'jefe@test.com' });
  await grupos.aceptarInvitacion(jefe.id, inv.id);
  const deJefe = await grupos.listarMisGrupos(jefe.id);
  assert.deepEqual(deJefe.map((x) => [x.nombre, x.miRol]).sort(), [['Cafetería Sol', 'encargado'], ['Librería Luna', 'empleado']]);
  assert.equal(g.miRol, 'encargado');
});