
const { Pool } = require('pg');
(function loadEnv() {
  const p = require('path').join(__dirname, '..', '.env');
  try {
    require('fs').readFileSync(p, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).forEach(l => {
      const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    });
  } catch (e) { console.error('Não achei o arquivo .env em: ' + p + ' (o nome precisa ser exatamente .env, sem .txt)'); }
})();
const url = process.env.DATABASE_URL;
if (!url) { console.error('Faltou DATABASE_URL'); process.exit(1); }
const pool = new Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
(async () => {
  await pool.query(`CREATE TABLE IF NOT EXISTS products (id SERIAL PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, price_cents INTEGER NOT NULL CHECK (price_cents >= 0), description TEXT DEFAULT '', image_url TEXT DEFAULT '', active BOOLEAN NOT NULL DEFAULT TRUE, sort INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS brands (id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL, logo_url TEXT DEFAULT '', color TEXT DEFAULT '#2d6bff', sort INTEGER NOT NULL DEFAULT 0);
    ALTER TABLE products ADD COLUMN IF NOT EXISTS brand TEXT NOT NULL DEFAULT '';`);
  await pool.query('DELETE FROM products');
  await pool.query('DELETE FROM brands');
  const c = require('./catalogo');
  await c.load(pool);
  console.log('Catálogo cadastrado: ' + c.PRODUCTS.length + ' produtos, ' + c.BRANDS.length + ' marcas.');
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
