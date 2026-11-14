const express = require('express');
const { Pool } = require('pg');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { PRODUCT_IMAGE_URLS } = require('./fotos-catalogo');
const caixa = require('./caixa');
const func = require('./funcionamento');
const cupons = require('./cupons');
const estoque = require('./estoque');
const clientes = require('./clientes');

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
const clienteAuth = clientes.createAuth(SECRET);
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '5mb' }));

const wrap = fn => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(500).json({ error: 'Erro interno. Tente novamente.' }); });
const clip = (v, n) => String(v ?? '').trim().slice(0, n);

/* Cache em memória: evita bater no Neon a cada visita (e deixa o banco "dormir"). Limpa sozinho quando o admin altera algo. */
const memo = new Map();
const cached = (key, ttl, fn) => wrap(async (req, res) => {
  let h = memo.get(key);
  if (!h || Date.now() - h.t > ttl) { h = { t: Date.now(), v: await fn() }; memo.set(key, h); }
  res.set('Cache-Control', 'public, max-age=30').json(h.v);
});
app.use('/api/admin', (req, res, next) => { if (req.method !== 'GET') res.on('finish', () => memo.clear()); next(); });

/* Fotos enviadas pelo painel: servidas como arquivo (com cache longo no navegador), não dentro do JSON. */
const imgCache = new Map(); let imgBytes = 0; const IMG_MAX = 40 * 1024 * 1024;
async function sendImg(req, res, sql) {
  const id = parseInt(req.params.id, 10), key = (sql.includes('products') ? 'p' : 'b') + ':' + id + ':' + String(req.query.v || '').slice(0, 20);
  let hit = imgCache.get(key);
  if (!hit) {
    const d = (await pool.query(sql, [id])).rows[0]?.img || '';
    const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s.exec(d);
    if (!m) return res.status(404).end();
    hit = { type: m[1], buf: Buffer.from(m[2], 'base64') };
    imgCache.set(key, hit); imgBytes += hit.buf.length;
    for (const [k, v] of imgCache) { if (imgBytes <= IMG_MAX) break; imgCache.delete(k); imgBytes -= v.buf.length; }
  }
  res.set({ 'Content-Type': hit.type, 'Cache-Control': 'public, max-age=31536000, immutable' }).send(hit.buf);
}
app.get('/img/p/:id', wrap((req, res) => sendImg(req, res, 'SELECT image_url AS img FROM products WHERE id=$1 AND image_ver>0')));
app.get('/img/b/:id', wrap((req, res) => sendImg(req, res, 'SELECT logo_url AS img FROM brands WHERE id=$1 AND image_ver>0')));

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
    ALTER TABLE products ADD COLUMN IF NOT EXISTS brand TEXT NOT NULL DEFAULT '';
    ALTER TABLE products ADD COLUMN IF NOT EXISTS image_ver BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE brands ADD COLUMN IF NOT EXISTS image_ver BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE zones ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
    UPDATE products SET image_ver=1 WHERE image_ver=0 AND left(image_url,11)='data:image/';
    UPDATE brands SET image_ver=1 WHERE image_ver=0 AND left(logo_url,11)='data:image/';`);
  await pool.query(caixa.SCHEMA);
  await pool.query(cupons.SCHEMA);
  await pool.query(estoque.SCHEMA);
  await pool.query(clientes.SCHEMA);
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

/* Funcionamento: valores do painel (tabela settings) com os padrões de funcionamento.js; nome e WhatsApp caem no .env se não preenchidos. */
async function getSettings() {
  const h = memo.get('settings');
  if (h && Date.now() - h.t < 30e3) return h.v;
  const rows = (await pool.query('SELECT key,value FROM settings')).rows;
  const v = { ...func.DEFAULTS };
  for (const r of rows) if (r.key in v) v[r.key] = r.value;
  v.store_name = v.store_name || STORE_NAME;
  v.whatsapp_number = v.whatsapp_number || WHATSAPP_NUMBER.replace(/\D/g, '');
  memo.set('settings', { t: Date.now(), v });
  return v;
}
const isOpenNow = s => s.manual_closed !== 'true' && func.isOpenAt(new Date(), s);
const closedText = s => s.manual_closed === 'true'
  ? 'Estamos fechados no momento. Volte em breve!'
  : `Estamos fechados agora. Funcionamos ${func.describeOpeningDays(s)}${s.opening_time === s.closing_time ? ', 24 horas' : ', das ' + s.opening_time + ' às ' + s.closing_time}.`;
const freeMin = s => Math.round(Number(s.free_delivery_min || 0) * 100);

/* ---------- Loja ---------- */
app.get('/api/config', cached('config', 60e3, async () => {
  const zones = (await pool.query('SELECT id,name,fee_cents FROM zones WHERE active ORDER BY fee_cents,name')).rows;
  const logos = scan('brands');
  const brands = (await pool.query(`SELECT id,name,color,CASE WHEN image_ver>0 THEN '/img/b/'||id||'?v='||image_ver ELSE logo_url END AS logo_url FROM brands ORDER BY sort,name`)).rows
    .map(b => ({ ...b, logo_url: b.logo_url || logos[slug(b.name)] || '' }));
  const st = await getSettings();
  return { name: st.store_name, whatsapp: st.whatsapp_number, zones, brands, free_delivery_min_cents: freeMin(st),
    estimated_min: Number(st.estimated_minutes_min) || 0, estimated_max: Number(st.estimated_minutes_max) || 0 };
}));

/* Aberto/fechado agora: sempre fresco (sem cache do navegador) */
app.get('/api/store', wrap(async (req, res) => {
  const st = await getSettings(), open = isOpenNow(st);
  res.set('Cache-Control', 'no-store').json({ open, manual_closed: st.manual_closed === 'true', message: open ? '' : closedText(st),
    opening_time: st.opening_time, closing_time: st.closing_time, all_day: st.opening_time === st.closing_time, days: func.describeOpeningDays(st) });
}));

app.get('/api/products', cached('products', 60e3, async () => {
  // stock: unidades disponíveis quando o produto tem item de estoque ligado; null = sem controle (vende sem limite).
  const { rows } = await pool.query(`SELECT p.id,p.name,p.category,p.price_cents,p.description,p.brand,CASE WHEN p.image_ver>0 THEN '/img/p/'||p.id||'?v='||p.image_ver ELSE p.image_url END AS image_url,
      FLOOR(i.quantity)::int AS stock
    FROM products p LEFT JOIN inventory_items i ON i.product_id=p.id AND i.active AND i.unit='un' WHERE p.active ORDER BY p.sort,p.id`);
  const imgs = scan('produtos');
  return rows.map(r => ({ ...r, image_url: r.image_url || imgs[slug(r.name)] || PRODUCT_IMAGE_URLS[slug(r.name)] || '' }));
}));

app.post('/api/orders', wrap(async (req, res) => {
  const b = req.body || {};
  let customerId = clienteAuth.verify(req.headers.authorization);
  if (customerId && !(await pool.query('SELECT 1 FROM customers WHERE id=$1', [customerId])).rowCount) customerId = null;
  const name = clip(b.name, 80), phone = clip(b.phone, 25), address = clip(b.address, 200), zoneName = clip(b.zone, 80);
  const payment = clip(b.payment, 20), changeFor = clip(b.change_for, 20), notes = clip(b.notes, 300);
  if (name.length < 2) return res.status(400).json({ error: 'Informe seu nome.' });
  if (phone.replace(/\D/g, '').length < 10) return res.status(400).json({ error: 'Informe um WhatsApp com DDD.' });
  if (address.length < 5) return res.status(400).json({ error: 'Informe o endereço com número.' });
  if (!['pix', 'cartao', 'dinheiro'].includes(payment)) return res.status(400).json({ error: 'Escolha a forma de pagamento.' });
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 50) return res.status(400).json({ error: 'Seu carrinho está vazio.' });
  const st = await getSettings();
  if (!isOpenNow(st)) return res.status(409).json({ error: closedText(st) });
  const zone = (await pool.query('SELECT name,fee_cents FROM zones WHERE name=$1 AND active', [zoneName])).rows[0];
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
  let discount = 0, couponCode = null;
  const code = cupons.normalizeCode(b.coupon);
  if (code) {
    const c = await cupons.find(pool, code), r = cupons.apply(c, subtotal);
    if (r.error) return res.status(r.status).json({ error: r.error });
    discount = r.discountCents; couponCode = c.code;
  }
  // Frete grátis vale o que o cliente paga pelas bebidas, já com o desconto do cupom.
  const fee = freeMin(st) > 0 && subtotal - discount >= freeMin(st) ? 0 : zone.fee_cents;
  const total = subtotal - discount + fee;
  // O pedido e a baixa do estoque acontecem juntos: se faltar unidade de algum item, nada é gravado.
  const client = await pool.connect();
  let r;
  try {
    await client.query('BEGIN');
    r = await client.query(
      `INSERT INTO orders (customer_name,phone,address,zone,payment,change_for,notes,items,subtotal_cents,fee_cents,total_cents,coupon_code,discount_cents,customer_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [name, phone, address, zone.name, payment, changeFor, notes, JSON.stringify(items), subtotal, fee, total, couponCode, discount, customerId]);
    const rs = await estoque.reserve(client, r.rows[0].id);
    if (rs.shortage) {
      await client.query('ROLLBACK');
      memo.delete('products');
      return res.status(409).json({ error: estoque.shortageMessage(rs.shortage), stock: true });
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
  memo.delete('products'); // o saldo mudou: a loja precisa ver o estoque novo
  res.json({ id: r.rows[0].id, subtotal_cents: subtotal, coupon_code: couponCode, discount_cents: discount, fee_cents: fee, free_delivery: fee === 0 && zone.fee_cents > 0, total_cents: total, items });
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

/* Resumo de vendas (fuso de Brasília). Pedidos cancelados não entram no faturamento. */
const TZ = 'America/Sao_Paulo';
app.get('/api/admin/stats', auth, wrap(async (req, res) => {
  const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 7));
  const rows = (await pool.query(
    `SELECT to_char(created_at AT TIME ZONE '${TZ}','YYYY-MM-DD') AS day, payment, zone, items, total_cents, status
     FROM orders WHERE (created_at AT TIME ZONE '${TZ}') >= date_trunc('day', now() AT TIME ZONE '${TZ}') - (($1::int - 1) * interval '1 day')`, [days])).rows;
  const valid = rows.filter(o => o.status !== 'cancelado');
  const byDay = {};
  for (let i = days - 1; i >= 0; i--) byDay[new Date(Date.now() - i * 864e5).toLocaleDateString('en-CA', { timeZone: TZ })] = { total: 0, n: 0 };
  const top = {}, pay = {}, zone = {};
  let revenue = 0;
  for (const o of valid) {
    revenue += o.total_cents;
    if (byDay[o.day]) { byDay[o.day].total += o.total_cents; byDay[o.day].n++; }
    pay[o.payment] = (pay[o.payment] || 0) + 1;
    zone[o.zone] = (zone[o.zone] || 0) + 1;
    for (const i of o.items) { const t = top[i.name] || (top[i.name] = { name: i.name, qty: 0, total: 0 }); t.qty += i.qty; t.total += i.qty * i.price_cents; }
  }
  const sortArr = (obj, k) => Object.entries(obj).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n).slice(0, k);
  res.json({
    days, revenue, orders: valid.length, cancelled: rows.length - valid.length,
    avg: valid.length ? Math.round(revenue / valid.length) : 0,
    byDay: Object.entries(byDay).map(([day, v]) => ({ day, ...v })),
    top: Object.values(top).sort((a, b) => b.qty - a.qty).slice(0, 8),
    payments: sortArr(pay, 5), zones: sortArr(zone, 5)
  });
}));
/* Relatórios (fuso de Brasília; cancelados não contam). Os dias são dias de calendário: "7 dias" = hoje + os 6 anteriores. */
app.get('/api/admin/reports', auth, wrap(async (req, res) => {
  const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 30));
  const since = `(date_trunc('day', now() AT TIME ZONE '${TZ}') - (($1::int - 1) * interval '1 day')) AT TIME ZONE '${TZ}'`;
  const base = `FROM orders WHERE status <> 'cancelado' AND created_at >= ${since}`;
  const [summary, daily, top, hours, weekdays, pays] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS orders, COALESCE(SUM(total_cents),0)::int AS revenue, COALESCE(AVG(total_cents),0)::int AS average_ticket, COALESCE(SUM(fee_cents),0)::int AS fees, COALESCE(SUM(discount_cents),0)::int AS discounts, COUNT(coupon_code)::int AS coupon_orders ${base}`, [days]),
    pool.query(`SELECT to_char((created_at AT TIME ZONE '${TZ}')::date,'YYYY-MM-DD') AS day, COUNT(*)::int AS orders, COALESCE(SUM(total_cents),0)::int AS revenue ${base} GROUP BY 1`, [days]),
    pool.query(`SELECT item->>'name' AS name, COALESCE(SUM((item->>'qty')::int),0)::int AS quantity, COALESCE(SUM((item->>'qty')::int * (item->>'price_cents')::int),0)::int AS revenue
      FROM orders o CROSS JOIN LATERAL jsonb_array_elements(o.items) item WHERE o.status <> 'cancelado' AND o.created_at >= ${since} GROUP BY 1 ORDER BY quantity DESC, revenue DESC LIMIT 10`, [days]),
    pool.query(`SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE '${TZ}')::int AS hour, COUNT(*)::int AS orders, COALESCE(SUM(total_cents),0)::int AS revenue ${base} GROUP BY 1 ORDER BY 1`, [days]),
    pool.query(`SELECT EXTRACT(DOW FROM created_at AT TIME ZONE '${TZ}')::int AS dow, COUNT(*)::int AS orders, COALESCE(SUM(total_cents),0)::int AS revenue ${base} GROUP BY 1 ORDER BY 1`, [days]),
    pool.query(`SELECT payment, COUNT(*)::int AS orders, COALESCE(SUM(total_cents),0)::int AS revenue ${base} GROUP BY 1 ORDER BY revenue DESC`, [days])
  ]);
  const map = new Map(daily.rows.map(r => [r.day, r]));
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5).toLocaleDateString('en-CA', { timeZone: TZ }), r = map.get(d);
    series.push({ day: d.split('-').reverse().slice(0, 2).join('/'), orders: r ? r.orders : 0, revenue: r ? r.revenue : 0 });
  }
  res.json({ days, summary: summary.rows[0], daily: series, top: top.rows, hours: hours.rows, weekdays: weekdays.rows, payments: pays.rows });
}));
app.get('/api/admin/reports/periods', auth, wrap(async (req, res) => {
  const local = `now() AT TIME ZONE '${TZ}'`;
  const { rows } = await pool.query(`WITH periods(label, start_at, ord) AS (VALUES
      ('Hoje', date_trunc('day', ${local}) AT TIME ZONE '${TZ}', 1),
      ('Esta semana', date_trunc('week', ${local}) AT TIME ZONE '${TZ}', 2),
      ('Este mês', date_trunc('month', ${local}) AT TIME ZONE '${TZ}', 3))
    SELECT p.label, COUNT(o.id)::int AS orders, COALESCE(SUM(o.total_cents),0)::int AS revenue, COALESCE(AVG(o.total_cents),0)::int AS average_ticket
    FROM periods p LEFT JOIN orders o ON o.created_at >= p.start_at AND o.status <> 'cancelado' GROUP BY p.label, p.ord ORDER BY p.ord`);
  res.json(rows);
}));
app.get('/api/admin/orders', auth, wrap(async (req, res) => {
  res.json((await pool.query('SELECT * FROM orders ORDER BY id DESC LIMIT 200')).rows);
}));
app.patch('/api/admin/orders/:id', auth, wrap(async (req, res) => {
  const st = clip(req.body?.status, 20);
  if (!['novo', 'preparando', 'saiu', 'entregue', 'cancelado'].includes(st)) return res.status(400).json({ error: 'Status inválido.' });
  const id = parseInt(req.params.id, 10);
  // Cancelar devolve ao estoque o que o pedido tinha descontado; reativar um cancelado desconta de novo (e recusa se não houver mais).
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = (await client.query('SELECT status FROM orders WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!cur) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Pedido não encontrado.' }); }
    if (st === 'cancelado' && cur.status !== 'cancelado') await estoque.release(client, id);
    else if (st !== 'cancelado' && cur.status === 'cancelado') {
      const rs = await estoque.reserve(client, id);
      if (rs.shortage) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Não dá para reativar este pedido: ' + estoque.shortageMessage(rs.shortage) }); }
    }
    await client.query('UPDATE orders SET status=$1 WHERE id=$2', [st, id]);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
  res.json({ ok: true });
}));
app.get('/api/admin/products', auth, wrap(async (req, res) => {
  res.json((await pool.query("SELECT id,name,category,price_cents,description,active,sort,brand,image_ver>0 AS has_upload,CASE WHEN image_ver>0 THEN '/img/p/'||id||'?v='||image_ver ELSE image_url END AS image_url FROM products ORDER BY sort,id")).rows);
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
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'image_url') && !String(req.body.image_url).startsWith('data:')) {
    await pool.query('UPDATE products SET name=$1,category=$2,price_cents=$3,description=$4,image_url=$5,active=$6,brand=$7,image_ver=0 WHERE id=$8', [...v, parseInt(req.params.id, 10)]);
  } else {
    await pool.query('UPDATE products SET name=$1,category=$2,price_cents=$3,description=$4,active=$6,brand=$7 WHERE id=$8', [v[0],v[1],v[2],v[3],v[5],v[6],parseInt(req.params.id,10)]);
  }
  res.json({ ok: true });
}));
app.put('/api/admin/products/:id/image', auth, wrap(async (req, res) => {
  const data = String(req.body?.image_data || '');
  // Uploads são armazenados no Neon para não desaparecerem em novos deploys do Render.
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(data)) return res.status(400).json({ error: 'Envie uma imagem JPG, PNG ou WebP válida.' });
  if (data.length > 4_500_000) return res.status(413).json({ error: 'Imagem muito grande. Escolha uma foto menor.' });
  const id = parseInt(req.params.id, 10);
  const result = await pool.query('UPDATE products SET image_url=$1,image_ver=(extract(epoch from now())*1000)::bigint WHERE id=$2 RETURNING id', [data, id]);
  if (!result.rowCount) return res.status(404).json({ error: 'Produto não encontrado.' });
  res.json({ ok: true });
}));
app.delete('/api/admin/products/:id/image', auth, wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const result = await pool.query("UPDATE products SET image_url='',image_ver=0 WHERE id=$1 RETURNING id", [id]);
  if (!result.rowCount) return res.status(404).json({ error: 'Produto não encontrado.' });
  res.json({ ok: true });
}));
app.delete('/api/admin/products/:id', auth, wrap(async (req, res) => {
  await pool.query('DELETE FROM products WHERE id=$1', [parseInt(req.params.id, 10)]); res.json({ ok: true });
}));
const zoneFee = v => { const f = Math.round(parseFloat(String(v ?? '').replace(',', '.')) * 100); return Number.isInteger(f) && f >= 0 && f <= 100000 ? f : null; };
app.get('/api/admin/zones', auth, wrap(async (req, res) => {
  res.json((await pool.query('SELECT id,name,fee_cents,active FROM zones ORDER BY name')).rows);
}));
app.post('/api/admin/zones', auth, wrap(async (req, res) => {
  const n = clip(req.body?.name, 80), fee = zoneFee(req.body?.fee);
  if (n.length < 2 || fee === null) return res.status(400).json({ error: 'Informe bairro e taxa válida.' });
  if ((await pool.query('SELECT 1 FROM zones WHERE LOWER(TRIM(name))=LOWER(TRIM($1))', [n])).rowCount) return res.status(409).json({ error: 'Esse bairro já existe.' });
  await pool.query('INSERT INTO zones (name,fee_cents) VALUES ($1,$2)', [n, fee]);
  res.json({ ok: true });
}));
app.patch('/api/admin/zones/:id', auth, wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10), n = clip(req.body?.name, 80), fee = zoneFee(req.body?.fee), active = req.body?.active;
  if (typeof active !== 'boolean') return res.status(400).json({ error: 'Disponibilidade do bairro inválida.' });
  if (n.length < 2 || fee === null) return res.status(400).json({ error: 'Informe bairro e taxa válida.' });
  if ((await pool.query('SELECT 1 FROM zones WHERE LOWER(TRIM(name))=LOWER(TRIM($1)) AND id<>$2', [n, id])).rowCount) return res.status(409).json({ error: 'Esse bairro já existe.' });
  const r = await pool.query('UPDATE zones SET name=$1,fee_cents=$2,active=$3 WHERE id=$4 RETURNING id', [n, fee, active, id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Bairro não encontrado.' });
  res.json({ ok: true });
}));
app.delete('/api/admin/zones/:id', auth, wrap(async (req, res) => {
  const r = await pool.query('DELETE FROM zones WHERE id=$1', [parseInt(req.params.id, 10)]);
  if (!r.rowCount) return res.status(404).json({ error: 'Bairro não encontrado.' });
  res.json({ ok: true });
}));

app.post('/api/admin/brands', auth, wrap(async (req, res) => {
  const n = clip(req.body?.name, 60), logo = clip(req.body?.logo_url, 500);
  const color = /^#[0-9a-fA-F]{6}$/.test(clip(req.body?.color, 7)) ? clip(req.body.color, 7) : '#2d6bff';
  if (!n) return res.status(400).json({ error: 'Informe o nome da marca.' });
  if (logo && !/^(\/|https?:\/\/)/.test(logo)) return res.status(400).json({ error: 'A logo deve começar com / ou https://' });
  await pool.query("INSERT INTO brands (name,logo_url,color) VALUES ($1,$2::text,$3) ON CONFLICT (name) DO UPDATE SET logo_url=CASE WHEN $2::text='' THEN brands.logo_url ELSE $2::text END,image_ver=CASE WHEN $2::text='' THEN brands.image_ver ELSE 0 END,color=$3", [n, logo, color]);
  res.json({ ok: true });
}));
app.put('/api/admin/brands/:id/logo', auth, wrap(async (req, res) => {
  const data = String(req.body?.image_data || '');
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(data)) return res.status(400).json({ error: 'Envie uma imagem JPG, PNG ou WebP válida.' });
  if (data.length > 1_000_000) return res.status(413).json({ error: 'Imagem muito grande. Escolha uma logo menor.' });
  const r = await pool.query('UPDATE brands SET logo_url=$1,image_ver=(extract(epoch from now())*1000)::bigint WHERE id=$2 RETURNING id', [data, parseInt(req.params.id, 10)]);
  if (!r.rowCount) return res.status(404).json({ error: 'Marca não encontrada.' });
  res.json({ ok: true });
}));
app.delete('/api/admin/brands/:id/logo', auth, wrap(async (req, res) => {
  const r = await pool.query("UPDATE brands SET logo_url='',image_ver=0 WHERE id=$1 RETURNING id", [parseInt(req.params.id, 10)]);
  if (!r.rowCount) return res.status(404).json({ error: 'Marca não encontrada.' });
  res.json({ ok: true });
}));
app.delete('/api/admin/brands/:id', auth, wrap(async (req, res) => {
  await pool.query('DELETE FROM brands WHERE id=$1', [parseInt(req.params.id, 10)]); res.json({ ok: true });
}));

app.get('/api/coupons/validate', cupons.validateHandler({ pool, wrap }));

/* Funcionamento (aba do painel) */
app.get('/api/admin/settings', auth, wrap(async (req, res) => { res.json(await getSettings()); }));
app.patch('/api/admin/settings', auth, wrap(async (req, res) => {
  const b = req.body || {}, cur = await getSettings(), out = {};
  for (const key of func.KEYS) {
    if (b[key] === undefined) continue;
    const r = func.validate(key, b[key]);
    if (r.error) return res.status(400).json({ error: r.error });
    out[key] = r.value;
  }
  const mn = out.estimated_minutes_min ?? cur.estimated_minutes_min, mx = out.estimated_minutes_max ?? cur.estimated_minutes_max;
  if (mn && mx && +mn > +mx) return res.status(400).json({ error: 'O tempo mínimo não pode ser maior que o máximo.' });
  if ((out.opening_days ?? cur.opening_days) === '') return res.status(400).json({ error: 'Marque pelo menos um dia de funcionamento.' });
  for (const [k, v] of Object.entries(out))
    await pool.query('INSERT INTO settings (key,value,updated_at) VALUES ($1,$2,now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()', [k, v]);
  memo.clear();
  res.json(await getSettings());
}));
const setPaused = async (paused) => { await pool.query("INSERT INTO settings (key,value,updated_at) VALUES ('manual_closed',$1,now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()", [String(paused)]); memo.clear(); };

/* Caixa: /api/admin/cash/* (já exige login) */
app.use('/api/customers', clientes.createRouter({ pool, wrap, clip, SECRET }));
app.use('/api/admin/customers', clientes.createAdminRouter({ pool, auth, wrap }));
app.use('/api/admin/coupons', cupons.createAdminRouter({ pool, auth, wrap }));
app.use('/api/admin/cash', caixa.createRouter({ pool, auth, wrap, clip, setPaused }));
app.use('/api/admin/estoque', estoque.createRouter({ pool, auth, wrap, clip }));

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], setHeaders: (res, f) => { if (/\.(png|jpe?g|webp|svg)$/i.test(f)) res.set('Cache-Control', 'public, max-age=86400'); } }));
app.get('/healthz', (req, res) => res.send('ok'));

initDb().then(() => app.listen(PORT, () => console.log('Bar On-line do Cruzeiro rodando na porta ' + PORT)))
  .catch(e => { console.error('Falha ao iniciar o banco:', e.message); process.exit(1); });
