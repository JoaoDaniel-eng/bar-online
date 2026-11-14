/* Cupons de desconto (código, % ou valor fixo, pedido mínimo, ativo/inativo).
   Mesma regra do Açaí da Roça: o site só mostra o desconto, quem manda é o servidor, que recalcula no pedido.
   Valores em centavos. O cupom de primeira compra do açaí não foi levado (depende de conta de cliente). */
const { Router } = require('express');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS coupons (
    id SERIAL PRIMARY KEY, code VARCHAR(40) NOT NULL UNIQUE,
    discount_type VARCHAR(10) NOT NULL CHECK (discount_type IN ('percent','fixed')),
    discount_value INTEGER NOT NULL CHECK (discount_value > 0),
    min_subtotal_cents INTEGER NOT NULL DEFAULT 0 CHECK (min_subtotal_cents >= 0),
    active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
  ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(40);
  ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_cents INTEGER NOT NULL DEFAULT 0;`;

const INVALID = 'Cupom inválido ou indisponível.';
const BRL = c => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const normalizeCode = v => String(v || '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 40);

// Percentual arredondado para baixo e nunca acima de 100%; valor fixo nunca passa do subtotal.
function discountFor(subtotalCents, c) {
  const v = Number(c.discount_value);
  return c.discount_type === 'percent' ? Math.floor((subtotalCents * Math.min(100, v)) / 100) : Math.min(subtotalCents, v);
}
// { discountCents } ou { error, status }
function apply(c, subtotalCents) {
  if (!c || !c.active) return { error: INVALID, status: 404 };
  if (subtotalCents < Number(c.min_subtotal_cents)) return { error: `Este cupom exige um subtotal mínimo de ${BRL(Number(c.min_subtotal_cents))}.`, status: 400 };
  return { discountCents: discountFor(subtotalCents, c) };
}
const find = async (db, code) => (await db.query('SELECT id,code,discount_type,discount_value,min_subtotal_cents,active FROM coupons WHERE code=$1', [code])).rows[0];

// Painel: /api/admin/coupons (já exige login)
function createAdminRouter({ pool, auth, wrap }) {
  const router = Router();
  router.use(auth);
  router.get('/', wrap(async (req, res) => {
    res.json((await pool.query(`SELECT c.id,c.code,c.discount_type,c.discount_value,c.min_subtotal_cents,c.active,c.created_at,
      (SELECT COUNT(*)::int FROM orders o WHERE o.coupon_code=c.code AND o.status<>'cancelado') AS uses,
      (SELECT COALESCE(SUM(o.discount_cents),0)::int FROM orders o WHERE o.coupon_code=c.code AND o.status<>'cancelado') AS discounted
      FROM coupons c ORDER BY c.created_at DESC, c.id DESC`)).rows);
  }));
  router.post('/', async (req, res) => {
    try {
      const b = req.body || {}, code = normalizeCode(b.code), type = String(b.discountType || ''), value = Number(b.discountValue), min = Number(b.minSubtotalCents || 0);
      if (!/^[A-Z0-9_-]{3,40}$/.test(code) || !['percent', 'fixed'].includes(type) || !Number.isInteger(value) || value < 1 ||
        (type === 'percent' && value > 100) || (type === 'fixed' && value > 2000000) || !Number.isInteger(min) || min < 0 || min > 2000000)
        return res.status(400).json({ error: 'Confira código (3 a 40 letras/números), desconto e pedido mínimo.' });
      const r = await pool.query('INSERT INTO coupons (code,discount_type,discount_value,min_subtotal_cents) VALUES ($1,$2,$3,$4) RETURNING id', [code, type, value, min]);
      res.status(201).json({ id: r.rows[0].id });
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'Já existe um cupom com esse código.' });
      console.error(e); res.status(500).json({ error: 'Erro interno. Tente novamente.' });
    }
  });
  router.patch('/:id', wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (typeof req.body?.active !== 'boolean') return res.status(400).json({ error: 'Estado do cupom inválido.' });
    const r = Number.isInteger(id) ? await pool.query('UPDATE coupons SET active=$1 WHERE id=$2 RETURNING id', [req.body.active, id]) : { rowCount: 0 };
    if (!r.rowCount) return res.status(404).json({ error: 'Cupom não encontrado.' });
    res.json({ ok: true });
  }));
  router.delete('/:id', wrap(async (req, res) => {
    const id = Number(req.params.id);
    const r = Number.isInteger(id) ? await pool.query('DELETE FROM coupons WHERE id=$1', [id]) : { rowCount: 0 };
    if (!r.rowCount) return res.status(404).json({ error: 'Cupom não encontrado.' });
    res.json({ ok: true });
  }));
  return router;
}

// Site: GET /api/coupons/validate?code=XXX&subtotalCents=1234 — no máximo 30 tentativas por IP a cada 10 min (evita adivinhar códigos).
function validateHandler({ pool, wrap }) {
  const hits = new Map();
  return wrap(async (req, res) => {
    const ip = String(req.headers['x-forwarded-for'] || req.ip || ''), now = Date.now();
    const h = hits.get(ip) && now - hits.get(ip).at < 600e3 ? hits.get(ip) : { n: 0, at: now };
    if (++h.n > 30) { hits.set(ip, h); return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' }); }
    hits.set(ip, h);
    if (hits.size > 5000) for (const [k, v] of hits) if (now - v.at > 600e3) hits.delete(k);
    const code = normalizeCode(req.query.code), subtotal = Number(req.query.subtotalCents);
    if (!code || !Number.isInteger(subtotal) || subtotal < 0) return res.status(400).json({ error: 'Informe um cupom e um subtotal válido.' });
    const c = await find(pool, code), r = apply(c, subtotal);
    if (r.error) return res.status(r.status).json({ error: r.error });
    res.set('Cache-Control', 'no-store').json({ code: c.code, discount_cents: r.discountCents, discount_type: c.discount_type, discount_value: c.discount_value });
  });
}

module.exports = { SCHEMA, normalizeCode, discountFor, apply, find, createAdminRouter, validateHandler };
