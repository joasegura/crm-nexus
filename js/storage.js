/* Capa de sincronización con el backend (Google Sheets vía /api/state).

   Antes esto era un shim sobre localStorage y cada persona tenía sus propias
   notas. Ahora el estado es compartido: lo que guarda uno lo ve el resto.

   En localStorage quedan solo dos cosas, que son de cada navegador y no del
   equipo: la contraseña (para no pedirla en cada visita) y el nombre de quien
   está usando la app. */
(function () {
  const K_PASS = 'crm-nexus-pass';
  const K_QUIEN = 'crm-nexus-quien';

  // Al escribir notas no mandamos una petición por tecla: esperamos a que la
  // persona deje de escribir. Google limita ~60 escrituras por minuto.
  const ESPERA_MS = 900;

  function lee(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function escribe(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* modo privado */ } }
  function borra(k) { try { localStorage.removeItem(k); } catch (e) { /* ídem */ } }

  const pendientes = new Map();   // id -> rec por guardar
  const timers = new Map();       // id -> timeout
  let enVuelo = 0;

  const sync = {
    quienes: [],

    get pass() { return lee(K_PASS) || ''; },
    set pass(v) { v ? escribe(K_PASS, v) : borra(K_PASS); },

    get quien() { return lee(K_QUIEN) || ''; },
    set quien(v) { v ? escribe(K_QUIEN, v) : borra(K_QUIEN); },

    // Los sobrescribe app.js para reflejar el estado en pantalla.
    onEstado: function () {},
    onError: function () {},
    onCambioRemoto: function () {},

    cabeceras() {
      const h = { 'Content-Type': 'application/json' };
      if (this.pass) h['X-CRM-Auth'] = this.pass;
      return h;
    },

    async pedir(url, opts) {
      const res = await fetch(url, Object.assign({ headers: this.cabeceras() }, opts || {}));
      if (res.status === 401) {
        const err = new Error('auth');
        err.auth = true;
        throw err;
      }
      return res;
    },

    /* ¿El backend exige contraseña? Si CRM_PASSWORD no está configurada en
       Vercel, el sitio es abierto y no tiene sentido mostrar el login. */
    async necesitaPass() {
      try {
        const res = await fetch('/api/state');
        return res.status === 401;
      } catch (e) {
        return true; // ante la duda, pedimos
      }
    },

    /* Prueba la contraseña contra el backend sin traer todos los datos. */
    async probarPass(pass) {
      const anterior = this.pass;
      this.pass = pass;
      try {
        const res = await fetch('/api/state', { headers: this.cabeceras() });
        if (res.status === 401) { this.pass = anterior; return false; }
        return true;
      } catch (e) {
        this.pass = anterior;
        return false;
      }
    },

    async leads() {
      const res = await this.pedir('/api/leads');
      return res.json();
    },

    async cargarEstado() {
      const res = await this.pedir('/api/state');
      const d = await res.json();
      if (!res.ok) throw new Error(d.mensaje || 'No se pudo leer el estado compartido.');
      this.quienes = d.quienes || [];
      return d;
    },

    /* Guardado por lead, con espera. Si alguien sigue editando el mismo lead,
       se reemplaza lo pendiente en vez de encolar otra escritura. */
    guardarLead(id, rec) {
      pendientes.set(id, JSON.parse(JSON.stringify(rec)));
      clearTimeout(timers.get(id));
      timers.set(id, setTimeout(() => this.vaciar(id), ESPERA_MS));
      this.onEstado('pendiente');
    },

    async vaciar(id) {
      const rec = pendientes.get(id);
      if (!rec) return;
      pendientes.delete(id);
      timers.delete(id);
      enVuelo++;
      this.onEstado('guardando');
      try {
        const res = await this.pedir('/api/state', {
          method: 'POST',
          body: JSON.stringify({ op: 'lead', id, rec, quien: this.quien }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.mensaje || 'Error al guardar.');
        this.onEstado(--enVuelo > 0 ? 'guardando' : 'guardado');
        return d;
      } catch (e) {
        enVuelo--;
        // Lo devolvemos a la cola para no perder el cambio.
        if (!pendientes.has(id)) pendientes.set(id, rec);
        this.onEstado('error');
        this.onError(e.auth ? 'Se cerró la sesión. Recargá la página.' : ('No se pudo guardar: ' + e.message));
        throw e;
      }
    },

    /* Fuerza el guardado de todo lo pendiente. Se usa al cerrar la pestaña. */
    async vaciarTodo() {
      const ids = [...pendientes.keys()];
      for (const id of ids) {
        clearTimeout(timers.get(id));
        await this.vaciar(id).catch(() => {});
      }
    },

    hayPendientes() { return pendientes.size > 0 || enVuelo > 0; },

    /* Importar un respaldo: se manda todo junto, no lead por lead. */
    async guardarBulk(db) {
      this.onEstado('guardando');
      const res = await this.pedir('/api/state', {
        method: 'POST',
        body: JSON.stringify({ op: 'bulk', db, quien: this.quien }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { this.onEstado('error'); throw new Error(d.mensaje || 'Error al importar.'); }
      this.onEstado('guardado');
      return d;
    },

    async guardarTpl(tpl) {
      this.onEstado('guardando');
      try {
        const res = await this.pedir('/api/state', {
          method: 'POST',
          body: JSON.stringify({ op: 'tpl', tpl, quien: this.quien }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.mensaje || 'Error al guardar las plantillas.');
        }
        this.onEstado('guardado');
      } catch (e) {
        this.onEstado('error');
        this.onError('No se pudieron guardar las plantillas: ' + e.message);
      }
    },
  };

  // Si alguien cierra la pestaña con cambios sin mandar, intentamos avisarle.
  window.addEventListener('beforeunload', e => {
    if (sync.hayPendientes()) { e.preventDefault(); e.returnValue = ''; }
  });

  window.sync = sync;
})();
