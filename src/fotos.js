// npm run fotos -> mostra quais fotos/logos já existem e quais faltam; gera LISTA-DE-FOTOS.txt
const fs = require('fs'), path = require('path');
const { PRODUCTS, BRANDS } = require('./catalogo');
const slug = x => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const have = dir => {
  try { return new Set(fs.readdirSync(path.join(__dirname, 'public', dir)).map(f => slug(path.basename(f, path.extname(f))))); } catch (e) { return new Set(); }
};
const hp = have('produtos'), hb = have('brands');
const out = [];
out.push('FOTOS DOS PRODUTOS (pasta src/public/produtos) — jpg, png ou webp\n');
let missP = 0;
PRODUCTS.forEach(p => { const ok = hp.has(slug(p[1])); if (!ok) missP++; out.push(`${ok ? '[x]' : '[ ]'} ${slug(p[1])}.jpg   (${p[1]})`); });
out.push('\nLOGOS DAS MARCAS (pasta src/public/brands) — de preferência png com fundo transparente\n');
let missB = 0;
BRANDS.forEach(b => { const ok = hb.has(slug(b[0])); if (!ok) missB++; out.push(`${ok ? '[x]' : '[ ]'} ${slug(b[0])}.png   (${b[0]})`); });
fs.writeFileSync(path.join(__dirname, '..', 'LISTA-DE-FOTOS.txt'), out.join('\n') + '\n');
console.log(`Produtos: ${PRODUCTS.length - missP}/${PRODUCTS.length} com foto. Marcas: ${BRANDS.length - missB}/${BRANDS.length} com logo.`);
console.log('Lista completa com os nomes dos arquivos em LISTA-DE-FOTOS.txt');
