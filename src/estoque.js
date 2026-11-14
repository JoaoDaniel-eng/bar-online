/* Controle de estoque (mesma ideia do Açaí da Roça, adaptada ao bar).
   - Cada item de estoque tem saldo, quantidade cheia (100% do medidor), alerta mínimo e valor gasto em compras.
   - Se o nome do item for igual ao de um produto do cardápio, o item fica LIGADO a ele (product_id):
     cada pedido desconta as unidades NA HORA (são garrafas/latas físicas), o cancelamento devolve,
     e o site mostra "Últimos!" / "Esgotado". Item sem ligação (gelo, copos...) só tem movimentação manual.
   - Produto do cardápio sem item de estoque = sem controle (vende sem limite, como sempre foi).
   - O que cada pedido descontou fica em orders.stock_used ({ "<itemId>": unidades }) para devolver exatamente o que saiu.
   Valores em dinheiro sempre em centavos. */
const { Router } = require('express');

const UNITS = ['un', 'kg', 'g', 'l', 'ml'];
const LOW_STOCK_LIMIT = 3;           // site: "Os 3 últimos!"
const MAX_QTY = 999999;
const MAX_CENTS = 99999999;
const MOVEMENT_TYPES = ['entrada', 'saida', 'perda', 'conferencia'];

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS inventory_items (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT 'un' CHECK (unit IN ('un','kg','g','l','ml')),
    quantity NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    capacity_quantity NUMERIC(14,3) NOT NULL DEFAULT 0,
    minimum_quantity NUMERIC(14,3) NOT NULL DEFAULT 0,
    purchase_total_cents INTEGER NOT NULL DEFAULT 0,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_name_uidx ON inventory_items (LOWER(TRIM(name))) WHERE active;
  CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_product_uidx ON inventory_items (product_id) WHERE active AND product_id IS NOT NULL;
  CREATE TABLE IF NOT EXISTS inventory_movements (
    id BIGSERIAL PRIMARY KEY, item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('entrada','saida','perda','conferencia','ajuste','venda','devolucao')),
    quantity NUMERIC(14,3) NOT NULL, total_cents INTEGER NOT NULL DEFAULT 0,
    reason TEXT NOT NULL DEFAULT '', supplier TEXT NOT NULL DEFAULT '',
    order_id INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE INDEX IF NOT EXISTS inventory_movements_item_idx ON inventory_movements (item_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS inventory_movements_recent_idx ON inventory_movements (created_at DESC);
  ALTER TABLE orders ADD COLUMN IF NOT EXISTS stock_used JSONB NOT NULL DEFAULT '{}';`;

/* ---------- Regras puras (testáveis sem banco) ---------- */

// "12,5" ou "12.5" -> número; vazio -> fallback; inválido -> NaN
const num = (v, fallback = 0) => {
  if (v === null || v === undefined || String(v).trim() === '') return fallback;
  return Number(String(v).trim().replace(',', '.'));
};
// "R$ 4,50" digitado no painel -> centavos (inteiro) ou null se inválido
function parseMoneyCents(v) {
  if (v === null || v === undefined || String(v).trim() === '') return 0;
  let t = String(v).replace(/[^\d,.-]/g, '');
  if (!/\d/.test(t)) return null;                                      // texto sem número
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');   // 1.234,50 -> 1234.50
  const n = Math.round(Number(t) * 100);
  return Number.isInteger(n) && n >= 0 && n <= MAX_CENTS ? n : null;
}
const validQty = (q, unit, { allowZero = false } = {}) =>
  Number.isFinite(q) && q <= MAX_QTY && (allowZero ? q >= 0 : q > 0) && (unit !== 'un' || Number.isInteger(q));

// Fatores para trocar a unidade sem perder o saldo (kg<->g, l<->ml)
const FACTORS = { 'kg>g': 1000, 'g>kg': 0.001, 'l>ml': 1000, 'ml>l': 0.001 };
function unitFactor(from, to) {
  if (from === to) return 1;
  const f = FACTORS[from + '>' + to];
  if (!f) throw new Error('Só é possível trocar entre kg e g, ou entre L e ml. Para outra unidade, cadastre um novo item.');
  return f;
}
const convertQty = (value, from, to) => Math.round(Number(value) * unitFactor(from, to) * 1000) / 1000;

// Situação do item para o medidor: usa o alerta mínimo quando existir; senão 20% da quantidade cheia.
function stockStatus({ quantity, capacity, minimum }) {
  const q = Number(quantity) || 0, cap = Math.max(Number(capacity) || 0, q), min = Number(minimum) || 0;
  const percent = cap > 0 ? Math.max(0, Math.min(100, (q / cap) * 100)) : 0;
  if (q <= 0) return { key: 'empty', label: 'Esgotado', percent: 0 };
  if ((min > 0 && q <= min) || percent <= 20) return { key: 'low', label: 'Está acabando', percent };
  return { key: 'good', label: 'Estoque bom', percent };
}
const lowStockLabel = left => (left === 1 ? 'Último!' : `Os ${left} últimos!`);

// Pedido -> Map(productId -> unidades)
function unitsByProduct(items) {
  const m = new Map();
  for (const i of items || []) {
    const id = Number(i.id), q = Number(i.qty);
    if (Number.isInteger(id) && id > 0 && Number.isInteger(q) && q > 0) m.set(id, (m.get(id) || 0) + q);
  }
  return m;
}
function shortageMessage({ name, left }) {
  if (left <= 0) return `${name} acabou! Tire do carrinho ou escolha outra bebida, ou fale com o bar pelo WhatsApp.`;
  return `Só temos ${left} unidade${left === 1 ? '' : 's'} de ${name}. Reduza a quantidade ou escolha outra bebida.`;
}

/* ---------- Baixa e devolução (rodam dentro da transação de quem chama) ---------- */

// Desconta do estoque o que o pedido comprou (só itens ligados a um produto do cardápio).
// Um UPDATE atômico por item, em ordem crescente de id: se dois clientes disputam a última unidade, só um leva.
// Retorna { used, shortage }; com `shortage` quem chamou deve dar ROLLBACK.
async function reserve(client, orderId) {
  const o = (await client.query('SELECT items FROM orders WHERE id=$1', [orderId])).rows[0];
  const want = unitsByProduct(o && o.items);
  if (!want.size) return { used: {}, shortage: null };
  const inv = (await client.query('SELECT id,product_id FROM inventory_items WHERE active AND product_id = ANY($1) ORDER BY id', [[...want.keys()]])).rows;
  const used = {};
  for (const it of inv) {
    const take = want.get(it.product_id);
    const r = await client.query('UPDATE inventory_items SET quantity=quantity-$1::numeric, updated_at=now() WHERE id=$2 AND quantity>=$1::numeric RETURNING quantity', [take, it.id]);
    if (!r.rowCount) {
      const cur = (await client.query('SELECT i.quantity::float8 AS quantity, p.name FROM inventory_items i JOIN products p ON p.id=i.product_id WHERE i.id=$1', [it.id])).rows[0];
      return { used, shortage: { name: cur.name, left: Math.max(0, Math.floor(cur.quantity)) } };
    }
    used[it.id] = take;
    await client.query("INSERT INTO inventory_movements (item_id,kind,quantity,reason,order_id) VALUES ($1,'venda',$2,$3,$4)", [it.id, take, `Pedido #${orderId}`, orderId]);
  }
  await client.query('UPDATE orders SET stock_used=$1 WHERE id=$2', [JSON.stringify(used), orderId]);
  return { used, shortage: null };
}

// Devolve ao estoque exatamente o que o pedido tinha descontado (cancelamento).
async function release(client, orderId) {
  const o = (await client.query('SELECT stock_used FROM orders WHERE id=$1', [orderId])).rows[0];
  const entries = Object.entries((o && o.stock_used) || {}).map(([id, q]) => [Number(id), Number(q)])
    .filter(([id, q]) => id > 0 && Number.isInteger(q) && q > 0).sort((a, b) => a[0] - b[0]);
  for (const [id, q] of entries) {
    const r = await client.query('UPDATE inventory_items SET quantity=quantity+$1::numeric, capacity_quantity=GREATEST(capacity_quantity,quantity+$1::numeric), updated_at=now() WHERE id=$2 RETURNING id', [q, id]);
    if (r.rowCount) await client.query("INSERT INTO inventory_movements (item_id,kind,quantity,reason,order_id) VALUES ($1,'devolucao',$2,$3,$4)", [id, q, `Pedido #${orderId} cancelado`, orderId]);
  }
  await client.query("UPDATE orders SET stock_used='{}' WHERE id=$1", [orderId]);
}

/* ---------- Painel: /api/admin/estoque ---------- */

function createRouter({ pool, auth, wrap, clip }) {
  const router = Router();
  router.use(auth);
  const bad = (res, msg, status = 400) => res.status(status).json({ error: msg });
  const NOT_FOUND = 'Item não encontrado ou removido. Atualize a página.';

  // Produto do cardápio com o mesmo nome e ainda sem item de estoque
  const matchProduct = async (db, name, exceptItemId = 0) => (await db.query(
    `SELECT p.id FROM products p WHERE LOWER(TRIM(p.name))=LOWER(TRIM($1))
       AND NOT EXISTS (SELECT 1 FROM inventory_items i WHERE i.active AND i.product_id=p.id AND i.id<>$2) ORDER BY p.id LIMIT 1`, [name, exceptItemId])).rows[0]?.id || null;

  router.get('/', wrap(async (req, res) => {
    const [items, movements, products] = await Promise.all([
      pool.query(`SELECT i.id,i.name,i.unit,i.quantity::float8 AS quantity,i.capacity_quantity::float8 AS capacity,i.minimum_quantity::float8 AS minimum,
                    i.purchase_total_cents,i.product_id,p.name AS product_name
                  FROM inventory_items i LEFT JOIN products p ON p.id=i.product_id WHERE i.active ORDER BY LOWER(i.name)`),
      pool.query(`SELECT m.id,m.kind,m.quantity::float8 AS quantity,m.total_cents,m.reason,m.supplier,m.order_id,m.created_at,i.name AS item_name,i.unit AS item_unit
                  FROM inventory_movements m JOIN inventory_items i ON i.id=m.item_id ORDER BY m.created_at DESC, m.id DESC LIMIT 100`),
      pool.query(`SELECT p.id,p.name,p.category FROM products p WHERE NOT EXISTS (SELECT 1 FROM inventory_items i WHERE i.active AND i.product_id=p.id) ORDER BY p.sort,p.id`)
    ]);
    res.json({ items: items.rows, movements: movements.rows, products: products.rows });
  }));

  // Contadores para o aviso na aba (acabando / esgotados)
  router.get('/summary', wrap(async (req, res) => {
    const r = (await pool.query(`SELECT
      COUNT(*) FILTER (WHERE quantity<=0)::int AS empty,
      COUNT(*) FILTER (WHERE quantity>0 AND ((minimum_quantity>0 AND quantity<=minimum_quantity) OR quantity<=0.2*GREATEST(capacity_quantity,quantity)))::int AS low
      FROM inventory_items WHERE active`)).rows[0];
    res.json(r);
  }));

  router.post('/items', wrap(async (req, res) => {
    const b = req.body || {}, name = clip(b.name, 100), unit = String(b.unit || 'un');
    const qty = num(b.quantity), minimum = num(b.minimumQuantity), paid = parseMoneyCents(b.purchaseTotal);
    if (name.length < 2 || !UNITS.includes(unit)) return bad(res, 'Informe o nome do produto e a unidade.');
    if (!validQty(qty, unit, { allowZero: true })) return bad(res, unit === 'un' ? 'Informe a quantidade em número inteiro (ex.: 24).' : 'Informe a quantidade que você tem agora.');
    if (!Number.isFinite(minimum) || minimum < 0 || minimum > MAX_QTY || (unit === 'un' && !Number.isInteger(minimum))) return bad(res, 'O alerta precisa ser um número válido (ou deixe em branco).');
    if (paid === null) return bad(res, 'O valor gasto precisa ser um valor válido.');
    if (paid > 0 && qty <= 0) return bad(res, 'Para informar o valor gasto, informe também a quantidade comprada.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if ((await client.query('SELECT 1 FROM inventory_items WHERE active AND LOWER(TRIM(name))=LOWER(TRIM($1))', [name])).rowCount) {
        await client.query('ROLLBACK'); return bad(res, 'Já existe um item de estoque com esse nome. Use “Adicionar compra” nele.', 409);
      }
      const productId = await matchProduct(client, name);
      if (productId && unit !== 'un') { await client.query('ROLLBACK'); return bad(res, 'Esse nome é de um produto do cardápio, que é controlado em unidades. Escolha a unidade “Unidades”.'); }
      const { rows } = await client.query(
        `INSERT INTO inventory_items (name,unit,quantity,capacity_quantity,minimum_quantity,purchase_total_cents,product_id) VALUES ($1,$2,$3,$3,$4,$5,$6) RETURNING id`,
        [name, unit, qty, minimum, paid, productId]);
      if (qty > 0) await client.query("INSERT INTO inventory_movements (item_id,kind,quantity,total_cents,reason) VALUES ($1,'entrada',$2,$3,'Estoque inicial cadastrado')", [rows[0].id, qty, paid]);
      await client.query('COMMIT');
      res.status(201).json({ id: rows[0].id, linked: !!productId });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      if (e.code === '23505') return bad(res, 'Já existe um item de estoque com esse nome ou ligado a esse produto.', 409);
      throw e;
    } finally { client.release(); }
  }));

  // Contagem inicial de vários produtos do cardápio de uma vez: [{ productId, quantity }]. Linhas em branco não são criadas (ficam sem controle).
  router.post('/bulk', wrap(async (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 500) : [];
    const todo = [];
    for (const r of rows) {
      if (r.quantity === null || r.quantity === undefined || String(r.quantity).trim() === '') continue;
      const id = Number(r.productId), q = num(r.quantity);
      if (!Number.isInteger(id) || id < 1 || !validQty(q, 'un', { allowZero: true })) return bad(res, 'Confira as quantidades: use números inteiros, sem negativos.');
      todo.push([id, q]);
    }
    if (!todo.length) return bad(res, 'Preencha a quantidade de pelo menos um produto.');
    const client = await pool.connect();
    let created = 0;
    try {
      await client.query('BEGIN');
      for (const [pid, q] of todo) {
        const p = (await client.query('SELECT name FROM products WHERE id=$1', [pid])).rows[0];
        if (!p) continue;
        const r = await client.query(
          `INSERT INTO inventory_items (name,unit,quantity,capacity_quantity,product_id) SELECT $1::text,'un',$2::numeric,$2::numeric,$3::int
           WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE active AND (product_id=$3::int OR LOWER(TRIM(name))=LOWER(TRIM($1::text)))) RETURNING id`, [p.name, q, pid]);
        if (!r.rowCount) continue;
        created++;
        if (q > 0) await client.query("INSERT INTO inventory_movements (item_id,kind,quantity,reason) VALUES ($1,'entrada',$2,'Estoque inicial (contagem)')", [r.rows[0].id, q]);
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
    res.status(201).json({ created });
  }));

  router.patch('/items/:id', wrap(async (req, res) => {
    const id = Number(req.params.id), b = req.body || {};
    if (!Number.isInteger(id) || id < 1) return bad(res, NOT_FOUND, 404);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query('SELECT id,name,unit,quantity::float8 AS quantity,capacity_quantity::float8 AS capacity,minimum_quantity::float8 AS minimum,product_id FROM inventory_items WHERE id=$1 AND active FOR UPDATE', [id]);
      if (!found.rowCount) { await client.query('ROLLBACK'); return bad(res, NOT_FOUND, 404); }
      const cur = found.rows[0];
      const name = b.name === undefined ? cur.name : clip(b.name, 100), unit = b.unit === undefined ? cur.unit : String(b.unit);
      if (name.length < 2 || !UNITS.includes(unit)) { await client.query('ROLLBACK'); return bad(res, 'Informe o nome e a unidade.'); }
      if (unit !== cur.unit && cur.product_id) { await client.query('ROLLBACK'); return bad(res, 'Item ligado a um produto do cardápio é controlado em unidades; não dá para trocar a unidade.'); }
      let factor = 1;
      try { factor = unitFactor(cur.unit, unit); } catch (e) { await client.query('ROLLBACK'); return bad(res, e.message); }
      const quantity = Math.round(cur.quantity * factor * 1000) / 1000;
      let capacity = b.capacity === undefined || String(b.capacity).trim() === '' ? Math.round(cur.capacity * factor * 1000) / 1000 : num(b.capacity);
      const minimum = b.minimum === undefined ? Math.round(cur.minimum * factor * 1000) / 1000 : num(b.minimum);
      if (![capacity, minimum].every(Number.isFinite) || capacity < 0 || minimum < 0 || capacity > MAX_QTY || minimum > MAX_QTY || (unit === 'un' && !(Number.isInteger(capacity) && Number.isInteger(minimum)))) {
        await client.query('ROLLBACK'); return bad(res, 'Confira a quantidade cheia e o alerta: números válidos (inteiros, se a unidade for “un.”).');
      }
      capacity = Math.max(capacity, quantity);
      if ((await client.query('SELECT 1 FROM inventory_items WHERE active AND id<>$1 AND LOWER(TRIM(name))=LOWER(TRIM($2))', [id, name])).rowCount) {
        await client.query('ROLLBACK'); return bad(res, 'Já existe um item de estoque com esse nome.', 409);
      }
      const productId = cur.product_id || (unit === 'un' ? await matchProduct(client, name, id) : null);
      await client.query('UPDATE inventory_items SET name=$1,unit=$2,quantity=$3,capacity_quantity=$4,minimum_quantity=$5,product_id=$6,updated_at=now() WHERE id=$7', [name, unit, quantity, capacity, minimum, productId, id]);
      if (unit !== cur.unit) await client.query("INSERT INTO inventory_movements (item_id,kind,quantity,reason) VALUES ($1,'ajuste',$2,$3)", [id, quantity, `Unidade alterada de ${cur.unit} para ${unit} (saldo convertido automaticamente)`]);
      await client.query('COMMIT');
      res.json({ ok: true, linked: !!productId && !cur.product_id });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      if (e.code === '23505') return bad(res, 'Já existe um item de estoque com esse nome ou ligado a esse produto.', 409);
      throw e;
    } finally { client.release(); }
  }));

  // Exclusão lógica: o histórico fica guardado e o produto do cardápio volta a vender sem controle.
  router.delete('/items/:id', wrap(async (req, res) => {
    const id = Number(req.params.id);
    const r = await pool.query('UPDATE inventory_items SET active=FALSE,product_id=NULL,updated_at=now() WHERE id=$1 AND active RETURNING id', [id]);
    if (!r.rowCount) return bad(res, NOT_FOUND, 404);
    res.json({ ok: true });
  }));

  router.post('/movements', wrap(async (req, res) => {
    const b = req.body || {}, id = Number(b.itemId), type = String(b.type || ''), qty = num(b.quantity, NaN), paid = parseMoneyCents(b.totalPaid);
    if (!Number.isInteger(id) || id < 1 || !MOVEMENT_TYPES.includes(type) || !Number.isFinite(qty) || paid === null) return bad(res, 'Informe uma quantidade válida e, para compras, o valor pago.');
    const reason = clip(b.reason, 300), supplier = clip(b.supplier, 120);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query('SELECT id,unit,quantity::float8 AS quantity FROM inventory_items WHERE id=$1 AND active FOR UPDATE', [id]);
      if (!found.rowCount) { await client.query('ROLLBACK'); return bad(res, NOT_FOUND, 404); }
      const item = found.rows[0], current = item.quantity;
      if (!validQty(qty, item.unit, { allowZero: type === 'conferencia' })) {
        await client.query('ROLLBACK'); return bad(res, item.unit === 'un' ? 'Informe a quantidade em número inteiro, maior que zero.' : 'Informe uma quantidade maior que zero.');
      }
      const delta = type === 'entrada' ? qty : type === 'conferencia' ? qty - current : -qty;
      if (current + delta < 0) { await client.query('ROLLBACK'); return bad(res, 'A quantidade informada é maior que o saldo disponível.', 409); }
      if (type === 'conferencia' && Math.abs(delta) < 0.0005) { await client.query('COMMIT'); return res.json({ ok: true, message: 'O saldo já corresponde à quantidade conferida.' }); }
      const spent = type === 'entrada' ? paid : 0;
      await client.query(`UPDATE inventory_items SET quantity=$1::numeric, capacity_quantity=GREATEST(capacity_quantity,$1::numeric),
        purchase_total_cents=purchase_total_cents+$2, updated_at=now() WHERE id=$3`, [Math.round((current + delta) * 1000) / 1000, spent, id]);
      const label = type === 'entrada' ? 'Compra/reposição de estoque'
        : type === 'conferencia' ? `Correção de saldo: de ${current} para ${qty} ${item.unit}`
        : type === 'perda' ? 'Perda / quebra / vencimento' : 'Retirada manual do estoque';
      await client.query('INSERT INTO inventory_movements (item_id,kind,quantity,total_cents,reason,supplier) VALUES ($1,$2,$3,$4,$5,$6)',
        [id, type, type === 'conferencia' ? Math.abs(delta) : qty, spent, reason || label, type === 'entrada' ? supplier : '']);
      await client.query('COMMIT');
      res.status(201).json({ ok: true, quantity: current + delta, message: type === 'entrada' ? 'Compra adicionada ao estoque.' : type === 'conferencia' ? 'Saldo atualizado.' : 'Retirada registrada.' });
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
  }));

  return router;
}

module.exports = {
  SCHEMA, UNITS, LOW_STOCK_LIMIT, createRouter, reserve, release,
  num, parseMoneyCents, validQty, convertQty, stockStatus, lowStockLabel, unitsByProduct, shortageMessage
};
