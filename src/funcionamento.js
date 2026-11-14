/* Funcionamento do bar: dias, horário (aceita passar da meia-noite), fechamento manual, previsão e frete grátis.
   Sem nada configurado o bar fica aberto 24h, todos os dias (não bloqueia pedidos até você ajustar). */
const TZ = 'America/Sao_Paulo';
const DEFAULTS = {
  store_name: '', whatsapp_number: '', manual_closed: 'false',
  opening_days: '0,1,2,3,4,5,6', opening_time: '00:00', closing_time: '00:00',
  estimated_minutes_min: '', estimated_minutes_max: '', free_delivery_min: '0'
};
const KEYS = Object.keys(DEFAULTS);
const DAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const toMin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
const daysOf = s => new Set(String(s.opening_days || '').split(',').filter(x => x !== '').map(Number));

function localParts(date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(date).map(x => [x.type, x.value]));
  return { day: { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday], minutes: +p.hour * 60 + +p.minute };
}

// Horário igual na abertura e no fechamento = 24h. Fechamento menor que a abertura = passa da meia-noite
// (a madrugada conta como parte do dia em que o bar abriu).
function isOpenAt(date, s) {
  const { day, minutes } = localParts(date), open = toMin(s.opening_time), close = toMin(s.closing_time), days = daysOf(s);
  if (open === close) return days.has(day);
  if (open < close) return days.has(day) && minutes >= open && minutes < close;
  return (days.has(day) && minutes >= open) || (days.has((day + 6) % 7) && minutes < close);
}

function describeOpeningDays(s) {
  const open = daysOf(s), flags = WEEK_ORDER.map(d => open.has(d));
  if (flags.every(Boolean)) return 'todos os dias';
  const runs = [];
  flags.forEach((on, i) => { if (on) { if (i > 0 && flags[i - 1]) runs[runs.length - 1].push(WEEK_ORDER[i]); else runs.push([WEEK_ORDER[i]]); } });
  if (!runs.length) return 'nenhum dia';
  if (runs.length === 1 && runs[0].length > 2) return `${DAY_NAMES[runs[0][0]]} a ${DAY_NAMES[runs[0].at(-1)]}`;
  const names = runs.flat().map(d => DAY_NAMES[d]);
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} e ${names.at(-1)}`;
}

// Devolve { value } ou { error } para um campo do painel.
function validate(key, raw) {
  let v = String(raw ?? '').trim();
  const bad = error => ({ error });
  if (key === 'manual_closed' && !['true', 'false'].includes(v)) return bad('Valor de fechamento inválido.');
  if ((key === 'opening_time' || key === 'closing_time') && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) return bad('Horário inválido.');
  if (key === 'opening_days' && !/^([0-6](,[0-6])*)?$/.test(v)) return bad('Dias de funcionamento inválidos.');
  if (key === 'whatsapp_number' && v !== '' && !/^\d{10,15}$/.test(v)) return bad('Use o WhatsApp com DDI e DDD, apenas números (ex.: 5524999999999).');
  if (key === 'store_name' && v !== '' && (v.length < 2 || v.length > 120)) return bad('Nome do bar inválido.');
  if ((key === 'estimated_minutes_min' || key === 'estimated_minutes_max') && v !== '' && (!/^\d+$/.test(v) || +v < 10 || +v > 240)) return bad('A previsão deve ficar entre 10 e 240 minutos.');
  if (key === 'free_delivery_min') {
    if (v === '') v = '0';
    if (!/^\d{1,5}([.,]\d{1,2})?$/.test(v)) return bad('Informe o valor mínimo do frete grátis em reais (ex.: 80 ou 79,90), ou 0 para desligar.');
    v = String(Number(v.replace(',', '.')));
  }
  return { value: v };
}

module.exports = { DEFAULTS, KEYS, isOpenAt, describeOpeningDays, validate };
