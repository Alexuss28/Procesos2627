const { ErrorApp } = require('./logica');

// Solo se aceptan fechas ISO 8601 con zona horaria explícita (Z o ±hh:mm).
// Una fecha sin zona sería ambigua: dependería de dónde se ejecute el servidor.
const ISO_CON_ZONA =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

function parsearFecha(valor, campo = 'fecha') {
  const error = () => new ErrorApp(
    'FECHA_INVALIDA',
    `El campo "${campo}" debe ser una fecha ISO 8601 con zona horaria (por ejemplo 2026-12-01T09:00:00Z)`
  );
  if (typeof valor !== 'string') throw error();
  const m = ISO_CON_ZONA.exec(valor);
  if (!m) throw error();

  const [, anio, mes, dia, hora, minuto, segundo = '0'] = m;
  const diasDelMes = new Date(Date.UTC(Number(anio), Number(mes), 0)).getUTCDate();
  if (Number(mes) < 1 || Number(mes) > 12
      || Number(dia) < 1 || Number(dia) > diasDelMes
      || Number(hora) > 23 || Number(minuto) > 59 || Number(segundo) > 59) {
    throw error();
  }
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) throw error();
  return fecha;
}

module.exports = { parsearFecha };