// Turnado: pantalla de acceso, estructura general (menú lateral y barra superior), grupos y administración.
// Cada sección del menú es una "vista" (VistaCalendario, VistaSolicitudes, VistaHoras, VistaEquipo) con un
// método montar(contenedor, contexto). Si una vista no está cargada, se muestra un aviso en su lugar.
const App = (() => {
  const { h, campo, toast, accion, modal, confirmar, avatar } = UI;
  const raiz = document.getElementById('raiz');

  const MENSAJES_OAUTH = {
    oauth_cancelado: 'Has cancelado el acceso con Google.',
    oauth_invalido: 'No se pudo validar el acceso con Google. Inténtalo de nuevo.',
    oauth_error: 'Ha ocurrido un error con Google. Inténtalo de nuevo más tarde.',
    oauth_no_configurado: 'El acceso con Google no está disponible ahora mismo.',
    email_en_uso_local: 'Ya existe una cuenta con ese correo registrada con contraseña. Inicia sesión con tu contraseña.',
    email_no_verificado: 'Google indica que ese correo no está verificado.',
  };
  const NAV = [
    ['calendario', 'Calendario', '📅'],
    ['solicitudes', 'Solicitudes', '🔁'],
    ['horas', 'Horas', '⏱️'],
    ['equipo', 'Equipo', '👥'],
  ];
  const TITULOS = {
    calendario: 'Calendario', solicitudes: 'Solicitudes de cambio', horas: 'Horas trabajadas',
    equipo: 'Equipo', admin: 'Administración de la web',
  };
  const CLAVE_GRUPO = 'turnado.grupo';

  let yo = null;
  let estado = { grupos: [], invitaciones: [], grupo: null, vista: 'calendario' };
  let refs = {};
  let renderId = 0;
  let campana = null;

  // Las vistas se buscan al usarlas: así la aplicación arranca aunque alguna no esté cargada todavía
  function vistas() {
    return {
      calendario: typeof VistaCalendario !== 'undefined' ? VistaCalendario : null,
      solicitudes: typeof VistaSolicitudes !== 'undefined' ? VistaSolicitudes : null,
      horas: typeof VistaHoras !== 'undefined' ? VistaHoras : null,
      equipo: VistaEquipo,
    };
  }

  // El navegador puede impedir el almacenamiento local: nunca debe romper la aplicación
  const leerRecuerdo = () => { try { return localStorage.getItem(CLAVE_GRUPO); } catch (_) { return null; } };
  const guardarRecuerdo = (id) => { try { localStorage.setItem(CLAVE_GRUPO, id); } catch (_) { /* nada */ } };

  const logo = (solido) => h('div', { class: 'logo' }, h('span', { class: `logo-marca ${solido ? 'solido' : ''}` }, 'T'), 'Turnado');

  // ================================================================ Acceso
  function ilustracion() {
    const filas = [['Ana', [0, 1, 3]], ['Luis', [1, 2, 4]], ['Marta', [0, 2, 3]]];
    return h('div', { class: 'ilus', 'aria-hidden': 'true' },
      filas.map(([nombre, dias], i) => h('div', { class: 'ilus-fila' },
        h('span', {}, nombre),
        [0, 1, 2, 3, 4].map((d) => h('span', { class: `ilus-celda ${dias.includes(d) ? `on c${(i + d) % 4}` : ''}` })))));
  }

  function pantallaAuth(aviso) {
    descartarSesionUI();
    let modo = 'entrar';
    let pendiente = false; // cuenta sin confirmar: se ofrece reenviar el correo
    const msg = h('p', { class: 'auth-msg oculto', role: 'alert' });
    const poner = (texto, tipo = 'error') => {
      msg.textContent = texto || '';
      msg.className = `auth-msg ${tipo}${texto ? '' : ' oculto'}`;
    };
    const email = h('input', { type: 'email', placeholder: 'tu@correo.com', autocomplete: 'email', required: true });
    const clave = h('input', { type: 'password', placeholder: 'Contraseña', required: true });
    const card = h('div', { class: 'auth-card' });

    async function enviar() {
      poner('');
      try {
        if (modo === 'entrar') {
          yo = await Rest.login(email.value, clave.value);
          await entrar();
        } else {
          const u = await Rest.registrar(email.value, clave.value);
          if (u.estado === 'pendiente') {
            poner('Cuenta creada. Te hemos enviado un correo de confirmación (revisa también la carpeta de spam).', 'ok');
          } else {
            modo = 'entrar';
            pintar();
            poner('Cuenta creada. Ya puedes iniciar sesión.', 'ok');
          }
        }
      } catch (e) {
        if (e.codigo === 'CUENTA_PENDIENTE') { pendiente = true; pintar(); }
        poner(e.message);
      }
    }

    function pintar() {
      clave.setAttribute('autocomplete', modo === 'entrar' ? 'current-password' : 'new-password');
      clave.setAttribute('placeholder', modo === 'entrar' ? 'Contraseña' : 'Mínimo 8 caracteres');
      card.replaceChildren(
        h('div', { class: 'pestanas' },
          h('button', { type: 'button', class: modo === 'entrar' ? 'activo' : '', onclick: () => { modo = 'entrar'; pintar(); poner(''); } }, 'Iniciar sesión'),
          h('button', { type: 'button', class: modo === 'registro' ? 'activo' : '', onclick: () => { modo = 'registro'; pintar(); poner(''); } }, 'Crear cuenta')),
        h('h2', {}, modo === 'entrar' ? 'Bienvenido de nuevo' : 'Crea tu cuenta'),
        h('p', { class: 'sub' }, modo === 'entrar' ? 'Entra para ver los turnos de tu equipo.' : 'Gratis y en menos de un minuto.'),
        h('form', { class: 'formulario', onsubmit: (ev) => { ev.preventDefault(); enviar(); } },
          campo('Correo electrónico', email),
          campo('Contraseña', clave),
          msg,
          h('button', { type: 'submit', class: 'btn primario ancho' }, modo === 'entrar' ? 'Entrar' : 'Crear cuenta'),
          pendiente && modo === 'entrar'
            ? h('button', {
              type: 'button',
              class: 'btn ancho',
              onclick: () => accion(async () => {
                await Rest.reenviarConfirmacion(email.value);
                poner('Si la cuenta existe y está pendiente, te hemos enviado un nuevo correo.', 'ok');
              }),
            }, 'Reenviar correo de confirmación')
            : null),
        h('div', { class: 'separador' }, 'o'),
        h('button', { type: 'button', class: 'btn ancho', onclick: () => { location.href = Rest.urlAccesoGoogle; } },
          h('span', { class: 'g-marca' }, 'G'), 'Continuar con Google'));
    }

    raiz.replaceChildren(h('div', { class: 'auth' },
      h('section', { class: 'auth-marca' },
        logo(false),
        h('h1', {}, 'Los turnos de tu equipo, sin líos.'),
        h('p', {}, 'Organiza el calendario, gestiona los cambios entre compañeros y controla las horas trabajadas en un solo sitio.'),
        h('ul', { class: 'ventajas' },
          h('li', {}, 'Calendario semanal claro para todo el equipo'),
          h('li', {}, 'Cambios de turno con aprobación del encargado'),
          h('li', {}, 'Horas del mes calculadas automáticamente'),
          h('li', {}, 'Avisos cuando algo cambia')),
        ilustracion()),
      h('section', { class: 'auth-panel' }, card)));
    pintar();
    if (aviso) poner(aviso.texto, aviso.tipo);
  }

  // ================================================================ Estructura general
  function descartarSesionUI() {
    if (campana) campana.destruir();
    campana = null;
    estado = { grupos: [], invitaciones: [], grupo: null, vista: 'calendario' };
    refs = {};
    renderId++;
  }

  function construirShell() {
    descartarSesionUI();
    refs.selector = h('select', {
      class: 'selector-grupo',
      'aria-label': 'Grupo de trabajo',
      onchange: (e) => accion(() => seleccionarGrupo(e.target.value)),
    });
    refs.menu = new Map();
    const botonMenu = (vista, texto, icono) => {
      const b = h('button', { onclick: () => irA(vista) }, h('span', {}, icono), texto);
      refs.menu.set(vista, b);
      return b;
    };
    refs.titulo = h('h2', { class: 'titulo-vista' });
    refs.contenido = h('main', { class: 'contenido' });
    if (typeof Notificaciones !== 'undefined') {
      // Al pulsar un aviso se abre su grupo; si aún no eres miembro (una invitación), se refresca la pantalla para ver la invitación
      campana = Notificaciones.crear({
        abrirGrupo: (id) => accion(async () => { if (!(await seleccionarGrupo(id))) await irA(estado.vista); }),
      });
    }

    raiz.replaceChildren(h('div', { class: 'app' },
      h('aside', { class: 'lateral' },
        logo(true),
        h('div', { class: 'selector' },
          h('span', { class: 'etiqueta-suave' }, 'Grupo de trabajo'),
          refs.selector,
          h('button', { class: 'btn pequeno', onclick: modalNuevoGrupo }, '＋ Nuevo grupo')),
        h('nav', { class: 'menu' },
          NAV.map(([vista, texto, icono]) => botonMenu(vista, texto, icono)),
          yo.rol === 'administrador' ? botonMenu('admin', 'Administración', '🛠️') : null)),
      h('div', { class: 'principal' },
        h('header', { class: 'barra-sup' },
          refs.titulo,
          h('div', { class: 'barra-sup-der' },
            campana ? campana.elemento : null,
            h('button', { class: 'btn fantasma', onclick: modalCuenta, 'aria-label': 'Mi cuenta' },
              avatar(yo.email, yo.id), h('span', { class: 'solo-ancho' }, yo.email)))),
        refs.contenido)));
  }

  async function entrar() {
    construirShell();
    await cargarGrupos();
  }

  async function cargarGrupos(preferido) {
    const [grupos, invitaciones] = await Promise.all([Rest.misGrupos(), Rest.misInvitaciones()]);
    estado.grupos = grupos;
    estado.invitaciones = invitaciones;
    const id = [preferido, estado.grupo && estado.grupo.id, leerRecuerdo()]
      .find((x) => x && grupos.some((g) => g.id === x)) || (grupos[0] && grupos[0].id);
    estado.grupo = id ? await Rest.obtenerGrupo(id) : null;
    if (id) guardarRecuerdo(id);
    pintarSelector();
    await render();
  }

  function pintarSelector() {
    refs.selector.replaceChildren(...(estado.grupos.length
      ? estado.grupos.map((g) => h('option', { value: g.id }, g.nombre))
      : [h('option', { value: '' }, 'Aún no tienes grupos')]));
    if (estado.grupo) refs.selector.value = estado.grupo.id;
    refs.selector.disabled = !estado.grupos.length;
  }

  // Devuelve true si el grupo se ha podido abrir (la campana lo usa para saltar al grupo de un aviso)
  async function seleccionarGrupo(id) {
    try {
      estado.grupo = await Rest.obtenerGrupo(id);
    } catch (_) {
      return false;
    }
    guardarRecuerdo(id);
    if (estado.vista === 'admin') estado.vista = 'calendario';
    pintarSelector();
    await render();
    return true;
  }

  async function recargarGrupo() {
    estado.grupo = await Rest.obtenerGrupo(estado.grupo.id);
    await render();
  }

  // Al cambiar de sección se vuelven a leer las invitaciones: así aparecen las que lleguen con la sesión abierta
  async function irA(vista) {
    estado.vista = vista;
    try { estado.invitaciones = await Rest.misInvitaciones(); } catch (_) { /* se mantiene la lista anterior */ }
    await render();
  }

  const contexto = () => ({
    yo, grupo: estado.grupo, grupos: estado.grupos,
    refrescar: render, recargarGrupo, recargarGrupos: () => cargarGrupos(), irA, seleccionarGrupo,
  });

  function bannersInvitaciones() {
    return estado.invitaciones.map((inv) => h('div', { class: 'banner' },
      h('span', {}, `Te han invitado al grupo «${inv.grupoNombre}»`),
      h('div', { class: 'acciones-inline' },
        h('button', {
          class: 'btn primario pequeno',
          onclick: () => accion(async () => {
            await Rest.aceptarInvitacion(inv.id);
            toast(`Te has unido a «${inv.grupoNombre}»`);
            await cargarGrupos(inv.grupoId);
          }),
        }, 'Aceptar'),
        h('button', {
          class: 'btn pequeno',
          onclick: () => accion(async () => {
            await Rest.rechazarInvitacion(inv.id);
            await cargarGrupos();
          }),
        }, 'Rechazar'))));
  }

  function estadoVacio() {
    return h('div', { class: 'tarjeta vacio' },
      h('div', { class: 'emoji' }, '📅'),
      h('h3', {}, 'Aún no perteneces a ningún grupo'),
      h('p', {}, 'Crea el tuyo para organizar los turnos de tu equipo, o espera a que te inviten a uno.'),
      h('button', { class: 'btn primario', onclick: modalNuevoGrupo }, 'Crear mi primer grupo'));
  }

  async function render() {
    const mio = ++renderId; // si llega otro render mientras se carga este, el antiguo se descarta
    for (const [vista, boton] of refs.menu) boton.classList.toggle('activo', vista === estado.vista);
    refs.titulo.textContent = TITULOS[estado.vista] + (estado.grupo && estado.vista !== 'admin' ? ` · ${estado.grupo.nombre}` : '');
    const cuerpo = h('div', { class: 'vista' });
    try {
      if (estado.vista === 'admin') {
        await vistaAdmin(cuerpo);
      } else if (!estado.grupo) {
        cuerpo.append(estadoVacio());
      } else {
        const vista = vistas()[estado.vista];
        if (vista) await vista.montar(cuerpo, contexto());
        else cuerpo.append(h('div', { class: 'tarjeta vacio' }, h('p', {}, 'Esta sección todavía no está disponible.')));
      }
    } catch (e) {
      cuerpo.replaceChildren(h('div', { class: 'tarjeta' }, h('p', { class: 'error-texto' }, e.message)));
    }
    if (mio !== renderId) return;
    refs.contenido.replaceChildren(...bannersInvitaciones(), cuerpo);
  }

  // ================================================================ Ventanas de la estructura
  function modalNuevoGrupo() {
    const nombre = h('input', { type: 'text', maxlength: 60, placeholder: 'Por ejemplo: Cafetería Sol' });
    modal({
      titulo: 'Nuevo grupo de trabajo',
      cuerpo: [
        h('p', { class: 'sub' }, 'Serás su encargado: podrás invitar a tu equipo, crear turnos y resolver cambios.'),
        campo('Nombre del grupo', nombre),
      ],
      acciones: [
        { texto: 'Cancelar', onclick: (cerrar) => cerrar() },
        {
          texto: 'Crear grupo',
          clase: 'primario',
          onclick: async (cerrar) => {
            const g = await Rest.crearGrupo(nombre.value);
            cerrar();
            toast(`Grupo «${g.nombre}» creado. Ya puedes invitar a tu equipo.`);
            estado.vista = 'equipo';
            await cargarGrupos(g.id);
          },
        },
      ],
    });
  }

  function modalCuenta() {
    modal({
      titulo: 'Mi cuenta',
      cuerpo: [
        h('div', { class: 'fila-miembro' },
          avatar(yo.email, yo.id),
          h('div', { class: 'grande' },
            h('strong', {}, yo.email),
            h('div', { class: 'sub' }, yo.rol === 'administrador' ? 'Administrador de la web' : 'Usuario'))),
        h('p', { class: 'sub' }, 'Si eliminas tu cuenta se borrarán también los grupos de los que eres encargado, con sus turnos.'),
      ],
      acciones: [
        {
          texto: 'Eliminar mi cuenta',
          clase: 'peligro',
          onclick: async (cerrar) => {
            cerrar();
            if (!(await confirmar('¿Seguro que quieres eliminar tu cuenta? Esta acción no se puede deshacer.', 'Sí, eliminar'))) return;
            await Rest.eliminarUsuario(yo.id);
            yo = null;
            pantallaAuth({ texto: 'Tu cuenta se ha eliminado.', tipo: 'ok' });
          },
        },
        {
          texto: 'Cerrar sesión',
          clase: 'primario',
          onclick: async (cerrar) => {
            cerrar();
            await Rest.logout();
            yo = null;
            pantallaAuth();
          },
        },
      ],
    });
  }

  // ================================================================ Administración de la web (solo rol administrador)
  async function vistaAdmin(cont) {
    const usuarios = await Rest.listarUsuarios();
    const chip = (texto, clase) => h('span', { class: `chip ${clase || ''}` }, texto);
    cont.replaceChildren(
      h('div', { class: 'cab-vista' }, h('div', {},
        h('h2', {}, 'Usuarios de la web'),
        h('p', { class: 'sub' }, `${usuarios.length} cuentas registradas. Aquí solo se gestionan cuentas: los grupos y sus turnos son privados.`))),
      h('div', { class: 'tarjeta' }, h('table', { class: 'tabla' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Cuenta'), h('th', {}, 'Rol'), h('th', {}, 'Estado'), h('th', {}, ''))),
        h('tbody', {}, usuarios.map((u) => h('tr', {},
          h('td', {}, h('div', { class: 'fila-inline' }, avatar(u.email, u.id), u.email)),
          h('td', {}, chip(u.rol === 'administrador' ? 'Administrador' : 'Usuario', u.rol === 'administrador' ? 'marca' : '')),
          h('td', {}, chip(u.estado, u.estado === 'activo' ? 'ok' : 'aviso')),
          h('td', { class: 'acciones-celda' },
            h('button', {
              class: 'btn pequeno',
              onclick: () => accion(async () => {
                const r = await Rest.estaActivo(u.id);
                toast(`${u.email}: ${r.activo ? 'cuenta activa' : 'cuenta no activa'}`);
              }),
            }, '¿Activa?'),
            h('button', {
              class: 'btn pequeno peligro',
              onclick: () => accion(async () => {
                if (!(await confirmar(`¿Eliminar la cuenta de ${u.email}? Se borrarán también sus grupos.`, 'Eliminar'))) return;
                await Rest.eliminarUsuario(u.id);
                if (u.id === yo.id) { yo = null; pantallaAuth(); return; }
                toast('Cuenta eliminada');
                await render();
              }),
            }, 'Eliminar'))))))));
  }

  // ================================================================ Arranque
  async function iniciar() {
    const params = new URLSearchParams(location.search);
    const error = params.get('error');
    const token = params.get('token');
    if (error || token) history.replaceState(null, '', location.pathname); // limpia la barra de direcciones

    let aviso = null;
    if (error) aviso = { texto: MENSAJES_OAUTH[error] || 'No se pudo completar el acceso con Google.', tipo: 'error' };
    if (token) {
      try {
        await Rest.confirmar(token);
        aviso = { texto: 'Cuenta confirmada. Ya puedes iniciar sesión.', tipo: 'ok' };
      } catch (e) {
        aviso = { texto: e.message, tipo: 'error' };
      }
    }
    try { yo = await Rest.sesion(); } catch (_) { yo = null; }
    if (yo) {
      await entrar();
      if (aviso) toast(aviso.texto, aviso.tipo);
    } else {
      pantallaAuth(aviso);
    }
  }

  return { iniciar };
})();

App.iniciar();