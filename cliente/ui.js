// Utilidades de interfaz de Turnado: elementos sin innerHTML, avisos, ventanas modales, avatares y fechas.
const UI = (() => {
  function anadir(el, hijos) {
    for (const hijo of hijos.flat(Infinity)) {
      if (hijo === null || hijo === undefined || hijo === false) continue;
      el.append(typeof hijo === 'object' ? hijo : String(hijo)); // los textos se añaden como texto, nunca como HTML
    }
  }

  // h('div', { class: 'x', onclick: fn }, 'texto', otroElemento) -> crea el elemento con sus hijos
  function h(etiqueta, props, ...hijos) {
    const el = document.createElement(etiqueta);
    let valor;
    for (const [clave, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (clave === 'class') el.className = v;
      else if (clave === 'value') valor = v; // se aplica al final, cuando ya existen las <option>
      else if (clave.startsWith('on') && typeof v === 'function') el.addEventListener(clave.slice(2), v);
      else if (['checked', 'disabled', 'selected'].includes(clave)) el[clave] = v;
      else el.setAttribute(clave, v === true ? '' : v);
    }
    anadir(el, hijos);
    if (valor !== undefined) el.value = valor;
    return el;
  }

  // Etiqueta + control de formulario
  const campo = (etiqueta, control) => h('div', { class: 'campo' }, h('label', {}, etiqueta), control);

  // ---- Avisos y ventanas ----
  function toast(mensaje, tipo = 'ok') {
    let caja = document.getElementById('toasts');
    if (!caja) {
      caja = h('div', { id: 'toasts', class: 'toasts', 'aria-live': 'polite' });
      document.body.appendChild(caja);
    }
    const aviso = h('div', { class: `toast ${tipo}` }, mensaje);
    caja.appendChild(aviso);
    setTimeout(() => aviso.remove(), tipo === 'error' ? 6000 : 3500);
  }

  // Ejecuta una acción del usuario y, si falla, muestra el motivo en un aviso
  async function accion(fn) {
    try {
      await fn();
    } catch (e) {
      toast(e.message || 'Ha ocurrido un error', 'error');
    }
  }

  // acciones: [{ texto, clase, onclick(cerrar) }]. alCerrar se llama siempre que la ventana se cierra.
  function modal({ titulo, cuerpo, acciones = [], ancho, alCerrar }) {
    const fondo = h('div', { class: 'modal-fondo' });
    const alTeclear = (e) => { if (e.key === 'Escape') cerrar(); };
    function cerrar() {
      fondo.remove();
      document.removeEventListener('keydown', alTeclear);
      if (alCerrar) alCerrar();
    }
    const botones = acciones.map((a) =>
      h('button', { class: `btn ${a.clase || ''}`, onclick: () => accion(() => a.onclick(cerrar)) }, a.texto));
    fondo.appendChild(h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', style: ancho ? `max-width:${ancho}px` : null },
      h('div', { class: 'modal-cab' },
        h('h3', {}, titulo),
        h('button', { class: 'btn fantasma pequeno', 'aria-label': 'Cerrar', onclick: cerrar }, '✕')),
      h('div', { class: 'modal-cuerpo' }, cuerpo),
      botones.length ? h('div', { class: 'modal-pie' }, botones) : null));
    fondo.addEventListener('mousedown', (e) => { if (e.target === fondo) cerrar(); });
    document.addEventListener('keydown', alTeclear);
    document.body.appendChild(fondo);
    return { cerrar };
  }

  // Pregunta de confirmación: devuelve una promesa con true (aceptar) o false (cancelar o cerrar)
  function confirmar(mensaje, textoAceptar = 'Aceptar') {
    return new Promise((resolver) => {
      modal({
        titulo: 'Confirmar',
        cuerpo: h('p', {}, mensaje),
        alCerrar: () => resolver(false),
        acciones: [
          { texto: 'Cancelar', onclick: (cerrar) => cerrar() },
          { texto: textoAceptar, clase: 'peligro', onclick: (cerrar) => { resolver(true); cerrar(); } },
        ],
      });
    });
  }

  // ---- Avatares y colores (el mismo color para la misma persona en todas partes) ----
  const PALETA = ['#4f46e5', '#0891b2', '#16a34a', '#d97706', '#db2777', '#7c3aed', '#dc2626', '#0d9488'];
  function color(clave) {
    let n = 0;
    for (const c of String(clave)) n = (n * 31 + c.charCodeAt(0)) >>> 0;
    return PALETA[n % PALETA.length];
  }
  const avatar = (email, id) =>
    h('span', { class: 'avatar', style: `background:${color(id || email)}` }, String(email || '?').slice(0, 2).toUpperCase());

  // ---- Fechas: el servidor trabaja en UTC (ISO) y el navegador las muestra en la hora local ----
  const dos = (n) => String(n).padStart(2, '0');
  const lunesDe = (fecha) => {
    const d = new Date(fecha);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
  };
  const sumarDias = (fecha, n) => {
    const d = new Date(fecha);
    d.setDate(d.getDate() + n);
    return d;
  };
  const claveDia = (d) => `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
  const hora = (iso) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const diaCorto = (iso) => new Date(iso).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
  const franjaHoras = (t) => `${hora(t.inicio)} – ${hora(t.fin)}`;
  const franja = (t) => (t ? `${diaCorto(t.inicio)}, ${franjaHoras(t)}` : '—');
  const aInputLocal = (iso) => {
    const d = new Date(iso);
    return `${claveDia(d)}T${dos(d.getHours())}:${dos(d.getMinutes())}`;
  };
  const desdeInput = (valor) => {
    if (!valor) throw new Error('Rellena las fechas de inicio y de fin');
    return new Date(valor).toISOString(); // datetime-local (hora local) -> ISO en UTC
  };
  const minutos = (m) => `${Math.floor(m / 60)} h ${dos(m % 60)} min`;
  function relativo(iso) {
    const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 1) return 'ahora mismo';
    if (min < 60) return `hace ${min} min`;
    if (min < 1440) return `hace ${Math.round(min / 60)} h`;
    return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  }

  return {
    h, campo, toast, accion, modal, confirmar, color, avatar,
    lunesDe, sumarDias, claveDia, hora, diaCorto, franjaHoras, franja, aInputLocal, desdeInput, minutos, relativo,
  };
})();