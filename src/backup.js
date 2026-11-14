/* Backup do painel: arquivo completo para baixar, restauração, cópias automáticas guardadas no banco e pedidos em CSV.
   Funciona com QUALQUER tabela do banco (lê a lista sozinho), então tabelas novas entram no backup sem mexer aqui.
   A tabela "backups" (as cópias guardadas) nunca entra no arquivo nem é apagada ao restaurar. */
const express = require('express');
const { Router } = express;
const zlib = require('zlib');

const APP = 'bar-online-cruzeiro';
const FORMAT = 1;
const SKIP = new Set(['backups']);
const KEEP = { auto: 5, manual: 5, 'antes-de-restaurar': 3 }; // quantas cópias de cada tipo ficam guardadas
const DAY = 24 * 3600e3;
const CONFIRM = 'RESTAURAR';
const TZ = 'America/Sao_Paulo';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS backups (
    id SERIAL PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    kind TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
    size_bytes INTEGER NOT NULL, tables_count INTEGER NOT NULL, rows_count INTEGER NOT NULL,
    data BYTEA NOT NULL);`;

const q = n => '"' + String(n).replace(/"/g, '""') + '"';

async function listTables(db) {
  const { rows } = await db.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name");
  return rows.map(r => r.table_name).filter(n => !SKIP.has(n));
}

/* Tabelas filhas dependem das pais (chave estrangeira): na restauração, as pais entram primeiro. */
async function foreignKeys(db) {
  const { rows } = await db.query(
    `SELECT cc.relname AS child, pc.relname AS parent
       FROM pg_constraint c
       JOIN pg_class cc ON cc.oid=c.conrelid JOIN pg_class pc ON pc.oid=c.confrelid
       JOIN pg_namespace n ON n.oid=c.connamespace
      WHERE c.contype='f' AND n.nspname='public'`);
  return rows.filter(r => r.child !== r.parent);
}
function sortByDependency(names, edges) {
  const set = new Set(names), left = new Set(names), out = [];
  while (left.size) {
    const ready = [...left].filter(t => !edges.some(e => e.child === t && set.has(e.parent) && left.has(e.parent)));
    if (!ready.length) { out.push(...left); break; } // ciclo: segue na ordem que está
    for (const t of ready) { out.push(t); left.delete(t); }
  }
  return out;
}

const hasPhoto = v => typeof v === 'string' && v.startsWith('data:image/');

async function exportAll(db, { images = true } = {}) {
  const names = await listTables(db), tables = {}, counts = {};
  let total = 0;
  for (const t of names) {
    let rows = (await db.query(`SELECT COALESCE(json_agg(x),'[]'::json) AS d FROM ${q(t)} x`)).rows[0].d;
    if (!images && t === 'products') rows = rows.map(r => hasPhoto(r.image_url) ? { ...r, image_url: '', image_ver: 0 } : r);
    if (!images && t === 'brands') rows = rows.map(r => hasPhoto(r.logo_url) ? { ...r, logo_url: '', image_ver: 0 } : r);
    tables[t] = rows; counts[t] = rows.length; total += rows.length;
  }
  return { app: APP, format: FORMAT, created_at: new Date().toISOString(), images: !!images, counts, tables, total_rows: total };
}

/* ---------- Cópias guardadas no banco ---------- */
let running = false;
async function snapshot(db, kind, note) {
  if (running) { const e = new Error('Já existe um backup sendo gerado. Aguarde alguns segundos.'); e.status = 409; throw e; }
  running = true;
  try {
    const b = await exportAll(db, { images: true });
    const data = zlib.gzipSync(Buffer.from(JSON.stringify(b)));
    const r = await db.query(
      'INSERT INTO backups (kind,note,size_bytes,tables_count,rows_count,data) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [kind, String(note || '').slice(0, 120), data.length, Object.keys(b.tables).length, b.total_rows, data]);
    if (KEEP[kind]) await db.query(
      'DELETE FROM backups WHERE kind=$1 AND id NOT IN (SELECT id FROM backups WHERE kind=$1 ORDER BY id DESC LIMIT $2)', [kind, KEEP[kind]]);
    return r.rows[0].id;
  } finally { running = false; }
}

/* Cópia automática: 1 por dia, só quando alguém está usando o site/painel (assim o Neon continua podendo "dormir"). */
let lastTouch = Date.now(), timer = null;
const touch = () => { lastTouch = Date.now(); };
async function autoTick(db) {
  if (Date.now() - lastTouch > 40 * 60e3 || running) return;
  const t = (await db.query("SELECT max(created_at) AS t FROM backups WHERE kind='auto'")).rows[0].t;
  if (!t || Date.now() - new Date(t).getTime() > DAY) await snapshot(db, 'auto', 'Cópia automática diária');
}
function startAuto(db) {
  const run = () => autoTick(db).catch(e => console.error('Backup automático falhou:', e.message));
  run();
  timer = setInterval(run, 30 * 60e3);
  if (timer.unref) timer.unref();
}

/* ---------- Restauração ---------- */
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

async function restoreFrom(pool, backup) {
  if (!backup || backup.app !== APP || typeof backup.tables !== 'object' || !backup.tables)
    throw httpError(400, 'Este arquivo não é um backup do Bar On-line do Cruzeiro.');
  if (Number(backup.format) > FORMAT) throw httpError(400, 'Este backup é de uma versão mais nova do sistema. Atualize o sistema antes de restaurar.');
  const dbTables = await listTables(pool);
  const present = dbTables.filter(t => Array.isArray(backup.tables[t]));
  if (!present.length) throw httpError(400, 'O arquivo não tem nenhuma tabela reconhecida.');
  const edges = await foreignKeys(pool);
  // Tabela que não está no arquivo e depende de uma que vai ser limpa seria apagada junto: melhor recusar do que perder dados.
  for (const t of dbTables.filter(x => !present.includes(x))) {
    if (!edges.some(e => e.child === t && present.includes(e.parent))) continue;
    const has = (await pool.query(`SELECT EXISTS (SELECT 1 FROM ${q(t)}) AS x`)).rows[0].x;
    if (has) throw httpError(400, `Este backup é antigo e não tem a tabela "${t}", que tem dados. Restaurar apagaria esses dados, então foi cancelado.`);
  }
  const safetyId = await snapshot(pool, 'antes-de-restaurar', 'Cópia de segurança feita antes de restaurar');
  const order = sortByDependency(present, edges);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`TRUNCATE ${order.map(q).join(', ')} RESTART IDENTITY CASCADE`);
    for (const t of order) {
      const rows = backup.tables[t];
      if (!rows.length) continue;
      const ok = new Set((await client.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema='public' AND table_name=$1 AND is_generated='NEVER' AND (is_identity='NO' OR identity_generation='BY DEFAULT')`, [t])).rows.map(r => r.column_name));
      const cols = Object.keys(rows[0] || {}).filter(c => ok.has(c));
      if (!cols.length) continue;
      const list = cols.map(q).join(',');
      let chunk = [], size = 0;
      const flush = async () => {
        if (!chunk.length) return;
        await client.query(`INSERT INTO ${q(t)} (${list}) SELECT ${list} FROM json_populate_recordset(null::${q(t)}, $1::json)`, [JSON.stringify(chunk)]);
        chunk = []; size = 0;
      };
      for (const r of rows) {
        const n = JSON.stringify(r).length;
        if (chunk.length && (chunk.length >= 300 || size + n > 4e6)) await flush();
        chunk.push(r); size += n;
      }
      await flush();
    }
    // Contadores (ids automáticos) continuam depois do maior id restaurado.
    for (const t of order) {
      const seqs = (await client.query(
        `SELECT a.attname AS col, pg_get_serial_sequence(format('%I.%I','public',$1::text), a.attname) AS seq
           FROM pg_attribute a WHERE a.attrelid=format('%I.%I','public',$1::text)::regclass AND a.attnum>0 AND NOT a.attisdropped`, [t])).rows.filter(s => s.seq);
      for (const s of seqs) await client.query(`SELECT setval($1, COALESCE((SELECT MAX(${q(s.col)}) FROM ${q(t)}),0)+1, false)`, [s.seq]);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (!e.status) { e.message = 'Não foi possível restaurar (' + e.message + '). Nada foi alterado.'; e.status = 400; }
    throw e;
  } finally { client.release(); }
  return { tables: order.length, rows: order.reduce((n, t) => n + backup.tables[t].length, 0), safetyId };
}

/* ---------- Pedidos em CSV (abre direto no Excel) ---------- */
const csvCell = v => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita que o Excel execute o texto como fórmula
  return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const money = c => (Number(c || 0) / 100).toFixed(2).replace('.', ',');
function ordersCsv(rows) {
  const head = ['Pedido', 'Data', 'Cliente', 'Telefone', 'Endereço', 'Bairro', 'Pagamento', 'Itens', 'Subtotal', 'Cupom', 'Desconto', 'Entrega', 'Total', 'Status', 'Observações'];
  const lines = [head.map(csvCell).join(';')];
  for (const o of rows) {
    const items = (Array.isArray(o.items) ? o.items : []).map(i => `${i.qty}x ${i.name}`).join(' | ');
    lines.push([o.id, o.day, o.customer_name, o.phone, o.address, o.zone, o.payment, items, money(o.subtotal_cents),
      o.coupon_code || '', money(o.discount_cents), money(o.fee_cents), money(o.total_cents), o.status, o.notes].map(csvCell).join(';'));
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

const stamp = () => new Date().toLocaleString('sv-SE', { timeZone: TZ }).slice(0, 16).replace(' ', '_').replace(':', '-'); // 2026-11-14_15-30
function sendJson(res, obj, name) {
  const body = Buffer.from(JSON.stringify(obj));
  res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store', 'Content-Length': body.length }).send(body);
}

function createRouter({ pool, auth, wrap, clip, onRestored = () => {} }) {
  const router = Router();
  router.use(auth);

  router.get('/summary', wrap(async (req, res) => {
    const names = await listTables(pool);
    const tables = [];
    for (const t of names) tables.push({ name: t, rows: (await pool.query(`SELECT count(*)::int AS n FROM ${q(t)}`)).rows[0].n });
    const snaps = (await pool.query('SELECT id,created_at,kind,note,size_bytes,tables_count,rows_count FROM backups ORDER BY id DESC')).rows;
    const dbBytes = Number((await pool.query('SELECT pg_database_size(current_database()) AS b')).rows[0].b) || 0;
    res.set('Cache-Control', 'no-store').json({ tables, snapshots: snaps, snapshots_bytes: snaps.reduce((n, s) => n + s.size_bytes, 0), db_bytes: dbBytes,
      keep: KEEP, confirm_word: CONFIRM });
  }));

  router.get('/download', wrap(async (req, res) => {
    const images = req.query.images !== '0';
    sendJson(res, await exportAll(pool, { images }), `backup-bar-cruzeiro-${stamp()}${images ? '' : '-sem-fotos'}.json`);
  }));

  router.get('/orders.csv', wrap(async (req, res) => {
    const rows = (await pool.query(
      `SELECT id, to_char(created_at AT TIME ZONE '${TZ}','DD/MM/YYYY HH24:MI') AS day, customer_name, phone, address, zone, payment, items,
              subtotal_cents, coupon_code, discount_cents, fee_cents, total_cents, status, notes FROM orders ORDER BY id`)).rows;
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="pedidos-${stamp()}.csv"`, 'Cache-Control': 'no-store' }).send(ordersCsv(rows));
  }));

  router.post('/snapshots', wrap(async (req, res) => {
    try { res.json({ id: await snapshot(pool, 'manual', clip(req.body?.note, 120) || 'Cópia manual') }); }
    catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); throw e; }
  }));

  router.get('/snapshots/:id/download', wrap(async (req, res) => {
    const r = (await pool.query('SELECT created_at,data FROM backups WHERE id=$1', [parseInt(req.params.id, 10)])).rows[0];
    if (!r) return res.status(404).json({ error: 'Cópia não encontrada.' });
    const body = zlib.gunzipSync(r.data);
    res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="backup-bar-cruzeiro-${new Date(r.created_at).toISOString().slice(0, 10)}-copia-${req.params.id}.json"`, 'Cache-Control': 'no-store', 'Content-Length': body.length }).send(body);
  }));

  router.delete('/snapshots/:id', wrap(async (req, res) => {
    const r = await pool.query('DELETE FROM backups WHERE id=$1', [parseInt(req.params.id, 10)]);
    if (!r.rowCount) return res.status(404).json({ error: 'Cópia não encontrada.' });
    res.json({ ok: true });
  }));

  const done = (res, out) => { onRestored(); res.json({ ok: true, ...out }); };
  const fail = (res, e) => { if (e.status) return res.status(e.status).json({ error: e.message }); throw e; };

  router.post('/snapshots/:id/restore', wrap(async (req, res) => {
    if (req.headers['x-confirm'] !== CONFIRM) return res.status(400).json({ error: `Digite ${CONFIRM} para confirmar.` });
    const r = (await pool.query('SELECT data FROM backups WHERE id=$1', [parseInt(req.params.id, 10)])).rows[0];
    if (!r) return res.status(404).json({ error: 'Cópia não encontrada.' });
    try { done(res, await restoreFrom(pool, JSON.parse(zlib.gunzipSync(r.data).toString('utf8')))); } catch (e) { fail(res, e); }
  }));

  // Arquivo enviado pelo painel. Parser próprio (o limite geral do servidor é de 5 MB, pequeno demais para backups com fotos).
  router.post('/restore', express.json({ limit: '120mb' }), wrap(async (req, res) => {
    if (req.headers['x-confirm'] !== CONFIRM) return res.status(400).json({ error: `Digite ${CONFIRM} para confirmar.` });
    try { done(res, await restoreFrom(pool, req.body)); } catch (e) { fail(res, e); }
  }));

  // Erros do envio do arquivo (grande demais, JSON quebrado) em português, em vez da página de erro padrão.
  router.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    res.status(err.status === 413 ? 413 : 400).json({ error: err.status === 413 ? 'Arquivo grande demais (máximo de 120 MB).' : 'Não consegui ler o arquivo. Use o .json baixado pelo próprio painel.' });
  });

  return router;
}

module.exports = { SCHEMA, createRouter, startAuto, touch, exportAll, restoreFrom, sortByDependency, ordersCsv, CONFIRM };
