# Bar On-line do Cruzeiro — delivery de bebidas (PWA)

Node + Express + PostgreSQL (Neon). Loja em `/`, painel em `/admin`. Código em `src/` (servidor em `src/server.js`, site em `src/public/`).

## Rodar local
1. `cp .env.example .env` e preencha `DATABASE_URL` (Neon), `ADMIN_PASSWORD`, `WHATSAPP_NUMBER` (ex.: 5524999999999).
2. `npm install`
3. `npm start` → http://localhost:3000

As tabelas e o cardápio de exemplo são criados sozinhos na primeira execução.

## Neon
Crie um projeto, copie a *connection string* (com `sslmode=require`) para `DATABASE_URL`.

## Render
New → Web Service → conecte o repositório. Build: `npm install`. Start: `npm start`.
Variáveis: `DATABASE_URL`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `WHATSAPP_NUMBER`, `STORE_NAME`.
(O `render.yaml` já está pronto.) O PWA só instala em HTTPS, que o Render já fornece.

## Painel `/admin`
Pedidos (atualiza a cada 20 s e muda o status), produtos (preço, foto por URL, ativar/desativar) e bairros com taxa de entrega.

## Catálogo
Os produtos e preços ficam em `src/catalogo.js`. Em banco novo eles são cadastrados sozinhos na primeira execução.
Para trocar os produtos de um banco que já existe pelo catálogo de `src/catalogo.js`, rode `npm run catalogo` (apaga produtos e marcas atuais; os pedidos não são afetados).

## Fotos e logos
Basta colocar os arquivos nas pastas, com o nome do produto/marca em minúsculas, sem acento e com hífen no lugar dos espaços:
- fotos dos produtos em `src/public/produtos/` (ex.: `heineken-long-neck.jpg`, `coca-cola-2-l.png`)
- logos das marcas em `src/public/brands/` (ex.: `skol.png`, `stella-artois.png`)
Aceita jpg, png, webp e svg. Não precisa reiniciar o servidor. A URL cadastrada no painel, se houver, tem prioridade.
`npm run fotos` mostra o que já está pronto e o que falta, e gera o arquivo `LISTA-DE-FOTOS.txt`.
