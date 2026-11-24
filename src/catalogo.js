
const C = {
  cerv: 'Cervejas', dest: 'Destilados', cach: 'Cachaças e Licores', vin: 'Vinhos e Festa',
  ene: 'Energéticos', drk: 'Drinks Prontos', ref: 'Refrigerantes e Água', conv: 'Conveniência'
};
const L = [
  [C.cerv, 'Brahma', 8, 'Brahma'], [C.cerv, 'Itaipava', 8, 'Itaipava'], [C.cerv, 'Império', 8, 'Império'],
  [C.cerv, 'Antarctica', 8, 'Antarctica'], [C.cerv, 'Corona', 11, 'Corona'], [C.cerv, 'Stella', 10, 'Stella Artois'],
  [C.cerv, 'Amstel', 8, 'Amstel'], [C.cerv, 'Lokal Latão', 6, 'Lokal'], [C.cerv, 'Teresópolis Gold', 14, 'Teresópolis'],
  [C.cerv, 'Heineken Latão', 12, 'Heineken'], [C.cerv, 'Heineken Long Neck', 12, 'Heineken'],

  [C.dest, 'Absolut', 130], [C.dest, 'Smirnoff', 55], [C.dest, 'Miscov', 20], [C.dest, 'Kriscov', 20],
  [C.dest, 'Royal Whisky', 28], [C.dest, 'Chanceler', 35], [C.dest, 'Cavalo Branco', 140],
  [C.dest, 'Gin Albin', 55], [C.dest, 'Gin Safira', 45], [C.dest, 'Gin Rock', 46], [C.dest, 'Tequila', 30],
  [C.dest, 'Bacardi', 45], [C.dest, 'Montilla', 40], [C.dest, 'Contini', 50], [C.dest, 'Red Rod', 15],

  [C.cach, 'Campari', 75], [C.cach, 'Catuaba', 19], [C.cach, 'Dreher', 25], [C.cach, 'Melfort', 20],
  [C.cach, 'Mineira 500 ml', 15], [C.cach, 'Bananinha', 30],
  [C.cach, 'Joinville Amendoim', 35], [C.cach, 'Joinville Coco', 35], [C.cach, 'Joinville Banana', 35], [C.cach, 'Joinville Maracujá', 35],
  [C.cach, 'Para Tudo', 20], [C.cach, 'Velho Barreiro', 25], [C.cach, 'Cachaça Presidente', 20],
  [C.cach, 'Caninha da Roça', 8], [C.cach, 'Canelinha', 19], [C.cach, 'Jurupinga', 40], [C.cach, 'Menta', 19],
  [C.cach, 'Cachaça 51', 18], [C.cach, 'Combo Corote', 20],

  [C.vin, 'Vinho Pérgola', 30], [C.vin, 'Galiotto', 30], [C.vin, 'Cata Festa', 30],
  [C.vin, 'Cantina da Serra', 12], [C.vin, 'Sangue de Festa', 30], [C.vin, 'Budagão 2 L', 30],

  [C.ene, 'Monster', 15], [C.ene, 'TNT', 14], [C.ene, 'Flying Horse', 14], [C.ene, 'Red Bull', 17],

  [C.drk, 'Drinkball Milkshake Morango', 8], [C.drk, 'Drinkball Tropical Sunset', 8],
  [C.drk, 'Drinkball Doce de Leite', 8], [C.drk, 'Drinkball Summer', 8],

  [C.ref, 'Coca-Cola 2 L', 12], [C.ref, 'Coca-Cola 2 L Gelada', 19], [C.ref, 'Coca-Cola 600 ml', 10],
  [C.ref, 'Coca-Cola 350 ml', 8], [C.ref, 'Guaraná Antarctica', 15], [C.ref, 'Guaraná Antarctica 350 ml', 8],
  [C.ref, 'It Guaraná', 7], [C.ref, 'It Laranja', 7], [C.ref, 'It Cola', 7],
  [C.ref, 'Guaravita', 4], [C.ref, 'Guaraviton', 8], [C.ref, 'Água Tônica', 10],

  [C.conv, 'Amendoim', 3], [C.conv, 'Ceda (pacote)', 7], [C.conv, 'Ceda (unidade)', 2],
  [C.conv, 'Bic Grande', 8], [C.conv, 'Bic Pequeno', 5],
  [C.conv, 'Halls Preta', 5], [C.conv, 'Halls Uva', 5], [C.conv, 'Halls Verde', 5], [C.conv, 'Halls Menta', 5], [C.conv, 'Halls Melancia', 5],
  [C.conv, 'Trident', 5], [C.conv, 'KitKat', 5], [C.conv, 'Choquito', 5]
];

const PRODUCTS = L.map(p => [p[0], p[1], Math.round(p[2] * 100), '', p[3] || '']);

const BRANDS = [['Brahma', '#c8281e'], ['Itaipava', '#d6a100'], ['Império', '#8a1c1c'], ['Antarctica', '#1f5fae'],
  ['Corona', '#0e2147'], ['Stella Artois', '#b3121b'], ['Amstel', '#a30f2d'], ['Lokal', '#2a7a4b'],
  ['Teresópolis', '#b8860b'], ['Heineken', '#0c7a3d']];

async function loadBrands(pool) {
  for (let i = 0; i < BRANDS.length; i++) {
    await pool.query('INSERT INTO brands (name,color,sort) VALUES ($1,$2,$3) ON CONFLICT (name) DO NOTHING', [BRANDS[i][0], BRANDS[i][1], i]);
  }
}
async function load(pool) {
  for (let i = 0; i < PRODUCTS.length; i++) {
    const x = PRODUCTS[i];
    await pool.query('INSERT INTO products (name,category,price_cents,description,sort,brand) VALUES ($1,$2,$3,$4,$5,$6)', [x[1], x[0], x[2], x[3], i, x[4]]);
  }
  await loadBrands(pool);
}
module.exports = { PRODUCTS, BRANDS, load, loadBrands };
