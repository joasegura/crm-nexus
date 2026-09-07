const fs = require('fs');
const path = require('path');

// TODO(Google Sheets): reemplazar la lectura de archivo por una llamada a la
// API de Sheets (googleapis) usando credenciales de service account guardadas
// en variables de entorno de Vercel. El front-end no necesita cambios: sigue
// pidiendo GET /api/leads y esperando el mismo array de objetos.
module.exports = (req, res) => {
  const realPath = path.join(process.cwd(), 'data', 'leads.json');
  const samplePath = path.join(process.cwd(), 'data', 'leads.sample.json');
  const file = fs.existsSync(realPath) ? realPath : samplePath;

  try {
    const data = fs.readFileSync(file, 'utf8');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(200).send(data);
  } catch (err) {
    res.status(500).json({ error: 'No se pudo leer la lista de prospectos.' });
  }
};
