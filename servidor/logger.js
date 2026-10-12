function log(nivel, mensaje, datos = {}) {
  console.log(JSON.stringify({ t: new Date().toISOString(), nivel, mensaje, ...datos }));
}
module.exports = { log };