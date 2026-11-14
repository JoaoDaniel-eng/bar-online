const express = require('express');
const { Pool } = require('pg');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

(function loadEnv() {
  const p = require('path').join(__dirname, '..', '.env');
  try {
    require('fs').readFileSync(p, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).forEach(l => {
      const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    });
  } catch (e) { console.error('Não achei o arquivo .env em: ' + p + ' (o nome precisa ser exatamente .env, sem .txt)'); }
})();

const { DATABASE_URL, ADMIN_PASSWORD, WHATSAPP_NUMBER = '', STORE_NAME = 'Bar On-line do Cruzeiro' } = process.env;
const SECRET = process.env.SESSION_SECRET || ADMIN_PASSWORD || 'dev-secret';
const PORT = process.env.PORT || 3000;

if (!DATABASE_URL) { console.error('Faltou DATABASE_URL: o .env foi lido, mas essa linha não está nele (ou está vazia). Confira o nome da variável.'); process.exit(1); }
if (!ADMIN_PASSWORD) { console.error('Faltou ADMIN_PASSWORD. Veja .env.example'); process.exit(1); }

const local = /localhost|127\.0\.0\.1/.test(DATABASE_URL);
const pool = new Pool({ connectionString: DATABASE_URL, ssl: local ? false : { rejectUnauthorized: false } });
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

const wrap = fn => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(500).json({ error: 'Erro interno. Tente novamente.' }); });
const clip = (v, n) => String(v ?? '').trim().slice(0, n);

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
      price_cents INTEGER NOT NULL CHECK (price_cents >= 0), description TEXT DEFAULT '',
      image_url TEXT DEFAULT '', active BOOLEAN NOT NULL DEFAULT TRUE, sort INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS zones (id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL, fee_cents INTEGER NOT NULL CHECK (fee_cents >= 0));
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      customer_name TEXT NOT NULL, phone TEXT NOT NULL, address TEXT NOT NULL, zone TEXT NOT NULL,
      payment TEXT NOT NULL, change_for TEXT DEFAULT '', notes TEXT DEFAULT '', items JSONB NOT NULL,
      subtotal_cents INTEGER NOT NULL, fee_cents INTEGER NOT NULL, total_cents INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'novo');
    CREATE TABLE IF NOT EXISTS brands (id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL, logo_url TEXT DEFAULT '', color TEXT DEFAULT '#2d6bff', sort INTEGER NOT NULL DEFAULT 0);
    ALTER TABLE products ADD COLUMN IF NOT EXISTS brand TEXT NOT NULL DEFAULT '';`);
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM products');
  const catalogo = require('./catalogo');
  if (rows[0].n === 0) await catalogo.load(pool);
  else if ((await pool.query('SELECT COUNT(*)::int AS n FROM brands')).rows[0].n === 0) {
    await catalogo.loadBrands(pool);
    await pool.query("UPDATE products SET brand=b.name FROM brands b WHERE products.brand='' AND products.name ILIKE b.name||'%'");
  }
  const z = await pool.query('SELECT COUNT(*)::int AS n FROM zones');
  if (z.rows[0].n === 0) {
    await pool.query("INSERT INTO zones (name, fee_cents) VALUES ('Centro',500),('Cruzeiro',600),('Outros bairros',1000)");
  }
}

/* Fotos automáticas: arquivo com o nome do produto/marca em src/public/produtos e src/public/brands */
const slug = x => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
function scan(dir) {
  const m = {};
  try {
    fs.readdirSync(path.join(__dirname, 'public', dir)).forEach(f => {
      const e = path.extname(f).toLowerCase();
      if (['.jpg', '.jpeg', '.png', '.webp', '.svg'].includes(e)) m[slug(path.basename(f, path.extname(f)))] = '/' + dir + '/' + encodeURIComponent(f);
    });
  } catch (e) {}
  return m;
}

/* ---------- Loja ---------- */
app.get('/api/config', wrap(async (req, res) => {
  const zones = (await pool.query('SELECT id,name,fee_cents FROM zones ORDER BY fee_cents,name')).rows;
  const logos = scan('brands');
  const brands = (await pool.query('SELECT id,name,logo_url,color FROM brands ORDER BY sort,name')).rows
    .map(b => ({ ...b, logo_url: b.logo_url || logos[slug(b.name)] || '' }));
  res.json({ name: STORE_NAME, whatsapp: WHATSAPP_NUMBER.replace(/\D/g, ''), zones, brands });
}));

// Fotos reais verificadas em catálogo de distribuidor (PMG). Quando houver foto
// local ou URL cadastrada no painel, ela tem prioridade sobre este mapa.
const VERIFIED_PRODUCT_IMAGES = {
  'brahma': 'https://sistema.pmg.com.br/ImagesUpload/webP_ID508_prd_2b617_508.webp',
  'coca-cola-2-l': 'https://sistema.pmg.com.br/ImagesUpload/prd_e43ab_5.webp',
  'guarana-antarctica': 'https://sistema.pmg.com.br/ImagesUpload/prd_dc397_18.webp',
  'heineken-latao': 'https://sistema.pmg.com.br/ImagesUpload/prd_bdc1e_1579.webp',
  'heineken-long-neck': 'https://sistema.pmg.com.br/ImagesUpload/webP_ID3197_prd_4d2c9_3197.webp',
  'cachaca-51': 'https://sistema.pmg.com.br/ImagesUpload/webP_ID1578_prd_f2ea7_1578.JPG.webp'
};
app.get('/api/products', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT id,name,category,price_cents,description,image_url,brand FROM products WHERE active ORDER BY sort,id');
  const imgs = scan('produtos');
  res.json(rows.map(r => ({ ...r, image_url: r.image_url || imgs[slug(r.name)] || VERIFIED_PRODUCT_IMAGES[slug(r.name)] || '' })));
}));

app.post('/api/orders', wrap(async (req, res) => {
  const b = req.body || {};
  const name = clip(b.name, 80), phone = clip(b.phone, 25), address = clip(b.address, 200), zoneName = clip(b.zone, 80);
  const payment = clip(b.payment, 20), changeFor = clip(b.change_for, 20), notes = clip(b.notes, 300);
  if (name.length < 2) return res.status(400).json({ error: 'Informe seu nome.' });
  if (phone.replace(/\D/g, '').length < 10) return res.status(400).json({ error: 'Informe um WhatsApp com DDD.' });
  if (address.length < 5) return res.status(400).json({ error: 'Informe o endereço com número.' });
  if (!['pix', 'cartao', 'dinheiro'].includes(payment)) return res.status(400).json({ error: 'Escolha a forma de pagamento.' });
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 50) return res.status(400).json({ error: 'Seu carrinho está vazio.' });
  const zone = (await pool.query('SELECT name,fee_cents FROM zones WHERE name=$1', [zoneName])).rows[0];
  if (!zone) return res.status(400).json({ error: 'Escolha o bairro de entrega.' });
  const ids = b.items.map(i => parseInt(i.id, 10)).filter(Number.isInteger);
  const prods = (await pool.query('SELECT id,name,price_cents FROM products WHERE active AND id = ANY($1)', [ids])).rows;
  const map = new Map(prods.map(p => [p.id, p]));
  const items = []; let subtotal = 0;
  for (const i of b.items) {
    const p = map.get(parseInt(i.id, 10)); const qty = parseInt(i.qty, 10);
    if (!p || !(qty >= 1 && qty <= 99)) return res.status(400).json({ error: 'Alguns itens não estão mais disponíveis. Atualize o carrinho.' });
    items.push({ id: p.id, name: p.name, qty, price_cents: p.price_cents }); subtotal += p.price_cents * qty;
  }
  const total = subtotal + zone.fee_cents;
  const r = await pool.query(
    `INSERT INTO orders (customer_name,phone,address,zone,payment,change_for,notes,items,subtotal_cents,fee_cents,total_cents)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [name, phone, address, zone.name, payment, changeFor, notes, JSON.stringify(items), subtotal, zone.fee_cents, total]);
  res.json({ id: r.rows[0].id, subtotal_cents: subtotal, fee_cents: zone.fee_cents, total_cents: total, items });
}));

/* ---------- Admin ---------- */
const sign = exp => exp + '.' + crypto.createHmac('sha256', SECRET).update(String(exp)).digest('hex');
function auth(req, res, next) {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  const [exp, sig] = t.split('.');
  const ok = exp && sig && Number(exp) > Date.now() && sig.length === 64 &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(exp).split('.')[1]));
  if (!ok) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
  next();
}
const tries = new Map();
app.post('/api/admin/login', (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.ip; const t = tries.get(ip) || { n: 0, at: Date.now() };
  if (Date.now() - t.at > 15 * 60e3) { t.n = 0; t.at = Date.now(); }
  if (t.n >= 8) return res.status(429).json({ error: 'Muitas tentativas. Aguarde 15 minutos.' });
  const a = Buffer.from(String(req.body?.password || '')), b = Buffer.from(ADMIN_PASSWORD);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) { t.n++; tries.set(ip, t); return res.status(401).json({ error: 'Senha incorreta.' }); }
  tries.delete(ip);
  res.json({ token: sign(Date.now() + 12 * 3600e3) });
});

app.get('/api/admin/orders', auth, wrap(async (req, res) => {
  res.json((await pool.query('SELECT * FROM orders ORDER BY id DESC LIMIT 200')).rows);
}));
app.patch('/api/admin/orders/:id', auth, wrap(async (req, res) => {
  const st = clip(req.body?.status, 20);
  if (!['novo', 'preparando', 'saiu', 'entregue', 'cancelado'].includes(st)) return res.status(400).json({ error: 'Status inválido.' });
  await pool.query('UPDATE orders SET status=$1 WHERE id=$2', [st, parseInt(req.params.id, 10)]);
  res.json({ ok: true });
}));
app.get('/api/admin/products', auth, wrap(async (req, res) => {
  res.json((await pool.query('SELECT * FROM products ORDER BY sort,id')).rows);
}));
function prodBody(b) {
  const price = Math.round(parseFloat(String(b.price).replace(',', '.')) * 100);
  if (!clip(b.name, 100) || !clip(b.category, 40) || !(price >= 0)) return null;
  return [clip(b.name, 100), clip(b.category, 40), price, clip(b.description, 200), clip(b.image_url, 500), b.active !== false, clip(b.brand, 60)];
}
app.post('/api/admin/products', auth, wrap(async (req, res) => {
  const v = prodBody(req.body || {}); if (!v) return res.status(400).json({ error: 'Preencha nome, categoria e preço.' });
  const mx = (await pool.query('SELECT COALESCE(MAX(sort),0)+1 AS n FROM products')).rows[0].n;
  await pool.query('INSERT INTO products (name,category,price_cents,description,image_url,active,brand,sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [...v, mx]);
  res.json({ ok: true });
}));
app.put('/api/admin/products/:id', auth, wrap(async (req, res) => {
  const v = prodBody(req.body || {}); if (!v) return res.status(400).json({ error: 'Preencha nome, categoria e preço.' });
  await pool.query('UPDATE products SET name=$1,category=$2,price_cents=$3,description=$4,image_url=$5,active=$6,brand=$7 WHERE id=$8', [...v, parseInt(req.params.id, 10)]);
  res.json({ ok: true });
}));
app.delete('/api/admin/products/:id', auth, wrap(async (req, res) => {
  await pool.query('DELETE FROM products WHERE id=$1', [parseInt(req.params.id, 10)]); res.json({ ok: true });
}));
app.post('/api/admin/zones', auth, wrap(async (req, res) => {
  const fee = Math.round(parseFloat(String(req.body?.fee).replace(',', '.')) * 100), n = clip(req.body?.name, 80);
  if (!n || !(fee >= 0)) return res.status(400).json({ error: 'Informe bairro e taxa.' });
  await pool.query('INSERT INTO zones (name,fee_cents) VALUES ($1,$2) ON CONFLICT (name) DO UPDATE SET fee_cents=$2', [n, fee]);
  res.json({ ok: true });
}));
app.delete('/api/admin/zones/:id', auth, wrap(async (req, res) => {
  await pool.query('DELETE FROM zones WHERE id=$1', [parseInt(req.params.id, 10)]); res.json({ ok: true });
}));

app.post('/api/admin/brands', auth, wrap(async (req, res) => {
  const n = clip(req.body?.name, 60), logo = clip(req.body?.logo_url, 500);
  const color = /^#[0-9a-fA-F]{6}$/.test(clip(req.body?.color, 7)) ? clip(req.body.color, 7) : '#2d6bff';
  if (!n) return res.status(400).json({ error: 'Informe o nome da marca.' });
  if (logo && !/^(\/|https?:\/\/)/.test(logo)) return res.status(400).json({ error: 'A logo deve começar com / ou https://' });
  await pool.query('INSERT INTO brands (name,logo_url,color) VALUES ($1,$2,$3) ON CONFLICT (name) DO UPDATE SET logo_url=$2,color=$3', [n, logo, color]);
  res.json({ ok: true });
}));
app.delete('/api/admin/brands/:id', auth, wrap(async (req, res) => {
  await pool.query('DELETE FROM brands WHERE id=$1', [parseInt(req.params.id, 10)]); res.json({ ok: true });
}));

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/healthz', (req, res) => res.send('ok'));

initDb().then(() => app.listen(PORT, () => console.log('Bar On-line do Cruzeiro rodando na porta ' + PORT)))
  .catch(e => { console.error('Falha ao iniciar o banco:', e.message); process.exit(1); });
