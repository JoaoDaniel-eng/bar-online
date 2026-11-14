/* Contas de clientes: cadastro, login (telefone + senha), perfil, pedidos, favoritos, cupons e pontos do clube.
   Sessão do cliente = token assinado (HMAC) guardado no navegador. Senhas ficam só como hash (scrypt).
   Pontos: 1 ponto a cada R$ 1,00 em bebidas (já com desconto, sem a taxa de entrega) de pedidos ENTREGUES. */
const crypto = require('crypto');
const { Router } = require('express');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, phone VARCHAR(15) NOT NULL UNIQUE,
    pass_salt TEXT NOT NULL, pass_hash TEXT NOT NULL,
    address TEXT NOT NULL DEFAULT '', zone TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE IF NOT EXISTS customer_favorites (
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (customer_id, product_id));
  ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL;
  CREATE INDEX IF NOT EXISTS orders_customer_idx ON orders (customer_id);
  ALTER TABLE coupons ADD COLUMN IF NOT EXISTS public BOOLEAN NOT NULL DEFAULT FALSE;`;

const MIN_PASS = 6;
/* Telefone só com dígitos, sem o 55 do país: 10 ou 11 números (DDD + número). */
function normPhone(v) {
  let d = String(v || '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  return d.length === 10 || d.length === 11 ? d : '';
}
const hashPass = (pw, salt) => crypto.scryptSync(String(pw), salt, 64).toString('hex');
function makePass(pw) { const salt = crypto.randomBytes(16).toString('hex'); return { salt, hash: hashPass(pw, salt) }; }
function checkPass(pw, salt, hash) {
  const a = Buffer.from(hashPass(pw, salt), 'hex'), b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const TOKEN_DAYS = 60;
function createAuth(secret) {
  const key = 'cliente:' + secret;
  const sig = body => crypto.createHmac('sha256', key).update(body).digest('hex');
  const sign = id => { const body = id + '.' + (Date.now() + TOKEN_DAYS * 864e5); return body + '.' + sig(body); };
  /* devolve o id do cliente ou null */
  function verify(header) {
    const t = String(header || '').replace(/^Bearer\s+/i, '');
    const [id, exp, s] = t.split('.');
    if (!id || !exp || !s || s.length !== 64 || !(Number(exp) > Date.now())) return null;
    const good = sig(id + '.' + exp);
    return crypto.timingSafeEqual(Buffer.from(s), Buffer.from(good)) ? parseInt(id, 10) || null : null;
  }
  return { sign, verify };
}

const PROFILE_COLS = 'id,name,phone,address,zone,created_at';
const pointsSql = `COALESCE((SELECT SUM(GREATEST(0, FLOOR((o.subtotal_cents - o.discount_cents) / 100.0)))::int FROM orders o WHERE o.customer_id=c.id AND o.status='entregue'),0)`;
async function loadProfile(pool, id) {
  return (await pool.query(`SELECT c.id,c.name,c.phone,c.address,c.zone,c.created_at,${pointsSql} AS points,
    (SELECT COUNT(*)::int FROM orders o WHERE o.customer_id=c.id AND o.status<>'cancelado') AS orders
    FROM customers c WHERE c.id=$1`, [id])).rows[0];
}

function createRouter({ pool, wrap, clip, SECRET }) {
  const router = Router();
  const A = createAuth(SECRET);

  /* limite de tentativas por IP (cadastro e login) */
  const hits = new Map();
  const limited = (req, max) => {
    const ip = String(req.headers['x-forwarded-for'] || req.ip || ''), now = Date.now();
    let h = hits.get(ip);
    if (!h || now - h.at > 15 * 60e3) h = { n: 0, at: now };
    h.n++; hits.set(ip, h);
    if (hits.size > 5000) for (const [k, v] of hits) if (now - v.at > 15 * 60e3) hits.delete(k);
    return h.n > max;
  };

  router.post('/register', wrap(async (req, res) => {
    if (limited(req, 20)) return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
    const b = req.body || {}, name = clip(b.name, 80), phone = normPhone(b.phone), pw = String(b.password || '');
    if (name.length < 2) return res.status(400).json({ error: 'Informe seu nome.' });
    if (!phone) return res.status(400).json({ error: 'Informe um WhatsApp com DDD.' });
    if (pw.length < MIN_PASS || pw.length > 100) return res.status(400).json({ error: `A senha precisa ter pelo menos ${MIN_PASS} caracteres.` });
    const { salt, hash } = makePass(pw);
    try {
      const r = await pool.query('INSERT INTO customers (name,phone,pass_salt,pass_hash) VALUES ($1,$2,$3,$4) RETURNING id', [name, phone, salt, hash]);
      res.status(201).json({ token: A.sign(r.rows[0].id), profile: await loadProfile(pool, r.rows[0].id) });
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'Esse WhatsApp já tem cadastro. Entre com a sua senha.' });
      throw e;
    }
  }));

  router.post('/login', wrap(async (req, res) => {
    if (limited(req, 30)) return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
    const phone = normPhone(req.body?.phone), pw = String(req.body?.password || '');
    const c = phone ? (await pool.query('SELECT id,pass_salt,pass_hash FROM customers WHERE phone=$1', [phone])).rows[0] : null;
    if (!c || !pw || !checkPass(pw, c.pass_salt, c.pass_hash)) return res.status(401).json({ error: 'WhatsApp ou senha incorretos.' });
    res.json({ token: A.sign(c.id), profile: await loadProfile(pool, c.id) });
  }));

  /* tudo daqui para baixo exige cliente logado */
  router.use((req, res, next) => {
    (async () => {
      const id = A.verify(req.headers.authorization);
      const ok = id && (await pool.query('SELECT 1 FROM customers WHERE id=$1', [id])).rowCount;
      if (!ok) return res.status(401).json({ error: 'Entre na sua conta para continuar.' });
      req.cid = id; next();
    })().catch(e => { console.error(e); res.status(500).json({ error: 'Erro interno. Tente novamente.' }); });
  });

  router.get('/me', wrap(async (req, res) => { res.set('Cache-Control', 'no-store').json(await loadProfile(pool, req.cid)); }));

  router.patch('/me', wrap(async (req, res) => {
    const b = req.body || {}, sets = [], vals = [];
    if (b.name !== undefined) { const v = clip(b.name, 80); if (v.length < 2) return res.status(400).json({ error: 'Informe seu nome.' }); vals.push(v); sets.push('name=$' + vals.length); }
    if (b.address !== undefined) { vals.push(clip(b.address, 200)); sets.push('address=$' + vals.length); }
    if (b.zone !== undefined) { vals.push(clip(b.zone, 80)); sets.push('zone=$' + vals.length); }
    if (b.newPassword !== undefined && b.newPassword !== '') {
      const c = (await pool.query('SELECT pass_salt,pass_hash FROM customers WHERE id=$1', [req.cid])).rows[0];
      if (!checkPass(String(b.currentPassword || ''), c.pass_salt, c.pass_hash)) return res.status(400).json({ error: 'A senha atual não confere.' });
      const np = String(b.newPassword);
      if (np.length < MIN_PASS || np.length > 100) return res.status(400).json({ error: `A nova senha precisa ter pelo menos ${MIN_PASS} caracteres.` });
      const { salt, hash } = makePass(np);
      vals.push(salt); sets.push('pass_salt=$' + vals.length); vals.push(hash); sets.push('pass_hash=$' + vals.length);
    }
    if (sets.length) { vals.push(req.cid); await pool.query(`UPDATE customers SET ${sets.join(',')} WHERE id=$${vals.length}`, vals); }
    res.json(await loadProfile(pool, req.cid));
  }));

  router.get('/me/orders', wrap(async (req, res) => {
    res.set('Cache-Control', 'no-store').json((await pool.query(
      `SELECT id,created_at,status,items,subtotal_cents,fee_cents,discount_cents,coupon_code,total_cents,payment,zone,address
       FROM orders WHERE customer_id=$1 ORDER BY id DESC LIMIT 50`, [req.cid])).rows);
  }));

  router.get('/me/favorites', wrap(async (req, res) => {
    res.set('Cache-Control', 'no-store').json((await pool.query('SELECT product_id FROM customer_favorites WHERE customer_id=$1 ORDER BY created_at DESC', [req.cid])).rows.map(r => r.product_id));
  }));
  router.put('/me/favorites/:pid', wrap(async (req, res) => {
    const pid = parseInt(req.params.pid, 10);
    if (!Number.isInteger(pid) || !(await pool.query('SELECT 1 FROM products WHERE id=$1', [pid])).rowCount) return res.status(404).json({ error: 'Produto não encontrado.' });
    await pool.query('INSERT INTO customer_favorites (customer_id,product_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.cid, pid]);
    res.json({ ok: true });
  }));
  router.delete('/me/favorites/:pid', wrap(async (req, res) => {
    await pool.query('DELETE FROM customer_favorites WHERE customer_id=$1 AND product_id=$2', [req.cid, parseInt(req.params.pid, 10) || 0]);
    res.json({ ok: true });
  }));

  /* Cupons que o cliente pode usar: os que o dono marcou como "visíveis para clientes" + os que o cliente já usou. */
  router.get('/me/coupons', wrap(async (req, res) => {
    const rows = (await pool.query(
      `SELECT c.code,c.discount_type,c.discount_value,c.min_subtotal_cents,c.active,
        (SELECT COUNT(*)::int FROM orders o WHERE o.customer_id=$1 AND o.coupon_code=c.code AND o.status<>'cancelado') AS used
       FROM coupons c WHERE (c.public AND c.active) OR EXISTS (SELECT 1 FROM orders o WHERE o.customer_id=$1 AND o.coupon_code=c.code)
       ORDER BY c.active DESC, c.id DESC`, [req.cid])).rows;
    res.set('Cache-Control', 'no-store').json(rows);
  }));

  return router;
}

/* Painel: lista de clientes e redefinição de senha (quem esqueceu a senha chama o bar). */
function createAdminRouter({ pool, auth, wrap }) {
  const router = Router();
  router.use(auth);
  router.get('/', wrap(async (req, res) => {
    res.json((await pool.query(`SELECT c.id,c.name,c.phone,c.zone,c.created_at,${pointsSql} AS points,
      (SELECT COUNT(*)::int FROM orders o WHERE o.customer_id=c.id AND o.status<>'cancelado') AS orders,
      (SELECT COALESCE(SUM(o.total_cents),0)::int FROM orders o WHERE o.customer_id=c.id AND o.status<>'cancelado') AS spent
      FROM customers c ORDER BY c.created_at DESC LIMIT 500`)).rows);
  }));
  router.post('/:id/password', wrap(async (req, res) => {
    const pw = String(req.body?.password || '');
    if (pw.length < MIN_PASS || pw.length > 100) return res.status(400).json({ error: `A senha precisa ter pelo menos ${MIN_PASS} caracteres.` });
    const { salt, hash } = makePass(pw);
    const r = await pool.query('UPDATE customers SET pass_salt=$1,pass_hash=$2 WHERE id=$3', [salt, hash, parseInt(req.params.id, 10) || 0]);
    if (!r.rowCount) return res.status(404).json({ error: 'Cliente não encontrado.' });
    res.json({ ok: true });
  }));
  router.delete('/:id', wrap(async (req, res) => {
    await pool.query('DELETE FROM customers WHERE id=$1', [parseInt(req.params.id, 10) || 0]);
    res.json({ ok: true });
  }));
  return router;
}

module.exports = { SCHEMA, normPhone, makePass, checkPass, createAuth, createRouter, createAdminRouter, loadProfile };
