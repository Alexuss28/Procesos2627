// Campana de avisos: contador de no leídos y panel con las últimas notificaciones.
// app.js la crea con Notificaciones.crear({ abrirGrupo }) y la destruye al cerrar sesión.
const Notificaciones = (() => {
  const { h, accion, toast } = UI;
  const REFRESCO_MS = 60 * 1000; // se consulta al servidor cada minuto

  function crear({ abrirGrupo }) {
    const badge = h('span', { class: 'badge oculto' }, '0');
    const panel = h('div', { class: 'panel-notif oculto' });
    const boton = h('button', { class: 'btn fantasma campana', 'aria-label': 'Notificaciones', onclick: alternar }, '🔔', badge);
    const caja = h('div', { class: 'campana-caja' }, boton, panel);
    let ultimo = null; // nº de no leídas en la última consulta: sirve para avisar cuando llegan nuevas

    function pintarContador(n) {
      badge.textContent = n > 99 ? '99+' : String(n);
      badge.classList.toggle('oculto', n === 0);
    }

    function pintarPanel(r) {
      panel.replaceChildren(
        h('div', { class: 'panel-cab' },
          h('strong', {}, 'Notificaciones'),
          h('button', {
            class: 'btn fantasma pequeno',
            onclick: () => accion(async () => { await Rest.leerTodasNotificaciones(); await refrescar(true); }),
          }, 'Marcar todas como leídas')),
        ...(r.notificaciones.length
          ? r.notificaciones.map((n) => h('div', { class: `notif ${n.leida ? 'leida' : ''}`, onclick: () => abrir(n) },
            n.mensaje, h('small', {}, UI.relativo(n.creadaEn))))
          : [h('div', { class: 'vacio' }, h('p', {}, 'No tienes notificaciones.'))]));
    }

    // Pulsar un aviso lo marca como leído y abre el grupo al que se refiere
    function abrir(n) {
      return accion(async () => {
        if (!n.leida) await Rest.leerNotificacion(n.id);
        panel.classList.add('oculto');
        await refrescar(false);
        if (n.grupoId) await abrirGrupo(n.grupoId);
      });
    }

    async function refrescar(conPanel) {
      try {
        const r = await Rest.notificaciones();
        if (ultimo !== null && r.noLeidas > ultimo) toast('Tienes notificaciones nuevas');
        ultimo = r.noLeidas;
        pintarContador(r.noLeidas);
        if (conPanel) pintarPanel(r);
      } catch (_) { /* un fallo al consultar los avisos no debe molestar al usuario */ }
    }

    function alternar() {
      const abierto = !panel.classList.contains('oculto');
      panel.classList.toggle('oculto', abierto);
      if (!abierto) refrescar(true);
    }

    // Se cierra al pulsar fuera de la campana
    const alPulsarFuera = (e) => { if (!caja.contains(e.target)) panel.classList.add('oculto'); };
    document.addEventListener('click', alPulsarFuera);
    const temporizador = setInterval(() => refrescar(false), REFRESCO_MS);
    refrescar(false);

    return {
      elemento: caja,
      refrescar,
      destruir() {
        clearInterval(temporizador);
        document.removeEventListener('click', alPulsarFuera);
      },
    };
  }

  return { crear };
})();