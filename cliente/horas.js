// Presentación de las horas trabajadas. Habla con el servidor solo a través de Rest
// y usa los helpers mostrar() y accion() de index.html.
// Grupos.abrir() la activa con Horas.abrir(grupo, usuario) y Horas.cerrar() al salir del grupo.
const Horas = (() => {
  const q = (id) => document.getElementById(id);

  let yo = null;
  let grupo = null;
  let eventosRegistrados = false;

  const esEncargado = () => Boolean(grupo) && grupo.miRol === 'encargado';

  // 125 minutos -> "2 h 05 min"
  function formato(minutos) {
    const h = Math.floor(minutos / 60);
    const m = minutos % 60;
    return `${h} h ${String(m).padStart(2, '0')} min`;
  }

  function mesActual() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  async function cargar() {
    const mes = q('h-mes').value;
    if (!mes) throw new Error('Elige un mes');

    const mias = await Rest.horasMias(mes);
    q('h-mias').textContent = `Tus horas en ${mes}: ${formato(mias.minutos)}`;
    const ul = q('h-mias-grupos');
    ul.replaceChildren();
    for (const g of mias.porGrupo) {
      const li = document.createElement('li');
      li.textContent = `${g.grupoNombre || 'Grupo anterior'}: ${formato(g.minutos)}`; // textContent: sin HTML
      ul.appendChild(li);
    }

    q('h-zona-equipo').classList.toggle('oculto', !esEncargado());
    if (!esEncargado()) return;
    const equipo = await Rest.horasGrupo(grupo.id, mes);
    const tbody = q('h-equipo');
    tbody.replaceChildren();
    for (const e of equipo.empleados) {
      const fila = document.createElement('tr');
      for (const texto of [e.email || '', formato(e.minutos)]) {
        const td = document.createElement('td');
        td.textContent = texto;
        fila.appendChild(td);
      }
      tbody.appendChild(fila);
    }
    const total = document.createElement('tr');
    for (const texto of ['Total del equipo', formato(equipo.minutos)]) {
      const td = document.createElement('th');
      td.textContent = texto;
      total.appendChild(td);
    }
    tbody.appendChild(total);
  }

  return {
    async abrir(detalleGrupo, usuario) {
      yo = usuario;
      grupo = detalleGrupo;
      if (!eventosRegistrados) {
        q('h-ver').onclick = () => accion(cargar);
        eventosRegistrados = true;
      }
      q('zona-horas').classList.remove('oculto');
      q('h-mes').value = mesActual();
      try {
        await cargar();
      } catch (e) {
        mostrar(e.message);
      }
    },
    cerrar() {
      grupo = null;
      q('zona-horas').classList.add('oculto');
    },
  };
})();