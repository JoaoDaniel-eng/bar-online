/* Controle de caixa (abrir, lançar movimentos, fechar com conferência, histórico).
   Mesma lógica do Açaí da Roça, adaptada ao bar: login por senha única e pagamento pix/cartao/dinheiro.
   Valores sempre em centavos. */
const { Router } = require('express');

const MOVEMENT_KINDS = { suprimento: 'Entrada de dinheiro', sangria: 'Retirada (sangria)', despesa: 'Despesa paga do caixa' };
const MAX_CENTS = 99999999;
const CASH_METHOD = 'Dinheiro';
const METHODS = ['Dinheiro', 'Pix', 'Cartão'];
const METHOD_LABEL = { dinheiro: 'Dinheiro', pix: 'Pix', cartao: 'Cartão' };

function parseCents(value, { allowZero = true } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > MAX_CENTS || (!allowZero && n === 0)) return null;
  return n;
}

// salesRows: [{ payment, orders, total_cents }] · movements: [{ kind, amount_cents }]
function summarizeCash({ openingCents = 0, salesRows = [], movements = [] }) {
  const byMethod = Object.fromEntries(METHODS.map(m => [m, { orders: 0, totalCents: 0 }]));
  for (const r of salesRows) {
    const key = METHOD_LABEL[r.payment] || r.payment || 'Outro';
    byMethod[key] = byMethod[key] || { orders: 0, totalCents: 0 };
    byMethod[key].orders += Number(r.orders || 0);
    byMethod[key].totalCents += Number(r.total_cents || 0);
  }
  const sum = kind => movements.filter(m => m.kind === kind).reduce((n, m) => n + Number(m.amount_cents || 0), 0);
  const supplies = sum('suprimento'), withdrawals = sum('sangria'), expenses = sum('despesa');
  const cashSales = byMethod[CASH_METHOD].totalCents;
  const expectedCashCents = Number(openingCents) + cashSales + supplies - withdrawals - expenses;
  const all = Object.values(byMethod);
  return {
    openingCents: Number(openingCents), byMethod, cashSalesCents: cashSales, suppliesCents: supplies,
    withdrawalsCents: withdrawals, expensesCents: expenses, expectedCashCents,
    totalSalesCents: all.reduce((n, m) => n + m.totalCents, 0), totalOrders: all.reduce((n, m) => n + m.orders, 0)
  };
}
const cashDifference = (counted, expected) => Number(counted) - Number(expected); // + sobra, − falta

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS cash_sessions (
    id BIGSERIAL PRIMARY KEY, opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), opened_by TEXT NOT NULL DEFAULT 'Painel',
    opening_cents INTEGER NOT NULL CHECK (opening_cents >= 0), open_notes TEXT NOT NULL DEFAULT '',
    closed_at TIMESTAMPTZ, closed_by TEXT, counted_cents INTEGER CHECK (counted_cents >= 0),
    expected_cents INTEGER, difference_cents INTEGER, close_notes TEXT NOT NULL DEFAULT '', summary JSONB);
  CREATE UNIQUE INDEX IF NOT EXISTS cash_sessions_one_open ON cash_sessions ((TRUE)) WHERE closed_at IS NULL;
  CREATE INDEX IF NOT EXISTS cash_sessions_opened_idx ON cash_sessions (opened_at DESC);
  CREATE TABLE IF NOT EXISTS cash_movements (
    id BIGSERIAL PRIMARY KEY, session_id BIGINT NOT NULL REFERENCES cash_sessions(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('suprimento','sangria','despesa')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0), reason TEXT NOT NULL,
    created_by TEXT NOT NULL DEFAULT 'Painel', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE INDEX IF NOT EXISTS cash_movements_session_idx ON cash_movements (session_id, created_at);`;

function createRouter({ pool, auth, wrap, clip, setPaused }) {
  const router = Router();
  router.use(auth);

  // Pedidos do período (sem cancelados) por forma de pagamento.
  const salesBetween = async (db, from, to) => (await db.query(
    `SELECT payment, COUNT(*)::int AS orders, COALESCE(SUM(total_cents),0)::int AS total_cents
     FROM orders WHERE status <> 'cancelado' AND created_at >= $1 AND created_at <= $2 GROUP BY 1`, [from, to])).rows;

  async function buildReport(db, session) {
    const movements = (await db.query('SELECT id,kind,amount_cents,reason,created_by,created_at FROM cash_movements WHERE session_id=$1 ORDER BY created_at,id', [session.id])).rows;
    const summary = session.closed_at && session.summary
      ? session.summary
      : summarizeCash({ openingCents: session.opening_cents, salesRows: await salesBetween(db, session.opened_at, new Date()), movements });
    return { session, movements, summary };
  }

  router.get('/current', wrap(async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM cash_sessions WHERE closed_at IS NULL LIMIT 1');
    res.json(rows[0] ? await buildReport(pool, rows[0]) : { session: null });
  }));

  router.post('/open', wrap(async (req, res) => {
    const opening = parseCents(req.body?.openingCents);
    if (opening === null) return res.status(400).json({ error: 'Informe o troco inicial (pode ser R$ 0,00).' });
    let created;
    try {
      created = await pool.query('INSERT INTO cash_sessions (opened_by,opening_cents,open_notes) VALUES ($1,$2,$3) RETURNING *',
        [clip(req.body?.by, 60) || 'Painel', opening, clip(req.body?.notes, 500)]);
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'Já existe um caixa aberto. Feche-o antes de abrir outro.' });
      throw e;
    }
    if (req.body?.resumeOrders === true && setPaused) await setPaused(false);
    res.status(201).json(await buildReport(pool, created.rows[0]));
  }));

  router.post('/movements', wrap(async (req, res) => {
    const kind = String(req.body?.kind || ''), amount = parseCents(req.body?.amountCents, { allowZero: false }), reason = clip(req.body?.reason, 200);
    if (!MOVEMENT_KINDS[kind]) return res.status(400).json({ error: 'Escolha o tipo do lançamento.' });
    if (amount === null) return res.status(400).json({ error: 'Informe um valor maior que zero.' });
    if (reason.length < 3) return res.status(400).json({ error: 'Explique o motivo do lançamento (mínimo de 3 letras).' });
    const open = await pool.query('SELECT id FROM cash_sessions WHERE closed_at IS NULL LIMIT 1');
    if (!open.rowCount) return res.status(409).json({ error: 'O caixa está fechado. Abra o caixa para lançar movimentos.' });
    const r = await pool.query('INSERT INTO cash_movements (session_id,kind,amount_cents,reason,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [open.rows[0].id, kind, amount, reason, clip(req.body?.by, 60) || 'Painel']);
    res.status(201).json({ id: r.rows[0].id });
  }));

  // Só dá para desfazer um lançamento enquanto o caixa dele está aberto.
  router.delete('/movements/:id', wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Lançamento inválido.' });
    const r = await pool.query('DELETE FROM cash_movements m USING cash_sessions s WHERE m.id=$1 AND s.id=m.session_id AND s.closed_at IS NULL', [id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Lançamento não encontrado ou o caixa dele já foi fechado.' });
    res.json({ ok: true });
  }));

  router.post('/close', async (req, res) => {
    const counted = parseCents(req.body?.countedCents);
    if (counted === null) return res.status(400).json({ error: 'Informe quanto dinheiro você contou no caixa.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const open = await client.query('SELECT * FROM cash_sessions WHERE closed_at IS NULL FOR UPDATE');
      if (!open.rowCount) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Não há caixa aberto.' }); }
      const session = open.rows[0], now = new Date();
      const movements = (await client.query('SELECT kind,amount_cents FROM cash_movements WHERE session_id=$1', [session.id])).rows;
      const summary = summarizeCash({ openingCents: session.opening_cents, salesRows: await salesBetween(client, session.opened_at, now), movements });
      const diff = cashDifference(counted, summary.expectedCashCents);
      await client.query('UPDATE cash_sessions SET closed_at=$2,closed_by=$3,counted_cents=$4,expected_cents=$5,difference_cents=$6,close_notes=$7,summary=$8 WHERE id=$1',
        [session.id, now, clip(req.body?.by, 60) || 'Painel', counted, summary.expectedCashCents, diff, clip(req.body?.notes, 500), JSON.stringify(summary)]);
      await client.query('COMMIT');
      if (req.body?.pauseOrders === true && setPaused) await setPaused(true);
      const closed = (await pool.query('SELECT * FROM cash_sessions WHERE id=$1', [session.id])).rows[0];
      res.json(await buildReport(pool, closed));
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(e); res.status(500).json({ error: 'Erro interno. Tente novamente.' });
    } finally { client.release(); }
  });

  router.get('/history', wrap(async (req, res) => {
    const limit = Math.min(100, Math.max(1, Math.trunc(Number(req.query.limit)) || 30));
    res.json((await pool.query('SELECT id,opened_at,opened_by,opening_cents,closed_at,closed_by,counted_cents,expected_cents,difference_cents FROM cash_sessions WHERE closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT $1', [limit])).rows);
  }));

  router.get('/sessions/:id', wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Caixa inválido.' });
    const { rows } = await pool.query('SELECT * FROM cash_sessions WHERE id=$1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Caixa não encontrado.' });
    res.json(await buildReport(pool, rows[0]));
  }));

  return router;
}

module.exports = { createRouter, SCHEMA, summarizeCash, cashDifference, parseCents, MOVEMENT_KINDS };
