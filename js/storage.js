/* Shim de persistencia local. La app original corría en un entorno con
   window.storage nativo (Claude Artifacts); fuera de ahí no existe, así que
   lo reemplazamos por localStorage con la misma interfaz (get/set async).

   Cuando conectemos Google Sheets, este es el único archivo que hay que
   tocar: get()/set() pueden pasar a llamar a /api/state en vez de
   localStorage, sin cambiar app.js. */
window.storage = {
  async get(key) {
    const v = localStorage.getItem(key);
    return v == null ? null : { value: v };
  },
  async set(key, value) {
    localStorage.setItem(key, value);
    return true;
  }
};
