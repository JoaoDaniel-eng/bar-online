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
- **Resumo**: faturamento, pedidos, ticket médio, vendas por dia, mais vendidos, pagamentos e bairros (hoje, 7 ou 30 dias; cancelados não contam).
- **Pedidos**: aviso sonoro e contador na aba quando chega pedido novo, filtros por status, busca por nº/nome/telefone, botão para avançar o status, impressão da comanda e link do WhatsApp.
- **Caixa**: abre com o troco inicial, aceita retiradas (sangria), despesas e entradas com motivo, e fecha comparando o dinheiro contado com o esperado (troco + vendas em dinheiro + entradas − retiradas − despesas). Mostra vendas por forma de pagamento (Dinheiro, Pix, Cartão), guarda o histórico e imprime o relatório. Só um caixa fica aberto por vez; pedidos cancelados não contam. Código em `src/caixa.js`; as tabelas `cash_sessions` e `cash_movements` são criadas sozinhas na primeira execução.
- **Produtos** (com busca, fotos e ativar/desativar), **Marcas** e **Bairros** com taxa de entrega.

## Catálogo
Os produtos e preços ficam em `src/catalogo.js`. Em banco novo eles são cadastrados sozinhos na primeira execução.
Para trocar os produtos de um banco que já existe pelo catálogo de `src/catalogo.js`, rode `npm run catalogo` (apaga produtos e marcas atuais; os pedidos não são afetados).

## Fotos e logos
Basta colocar os arquivos nas pastas, com o nome do produto/marca em minúsculas, sem acento e com hífen no lugar dos espaços:
- fotos dos produtos em `src/public/produtos/` (ex.: `heineken-long-neck.jpg`, `coca-cola-2-l.png`)
- logos das marcas em `src/public/brands/` (ex.: `skol.png`, `stella-artois.png`)
Aceita jpg, png, webp e svg. Não precisa reiniciar o servidor. A URL cadastrada no painel, se houver, tem prioridade.
`npm run fotos` mostra o que já está pronto e o que falta, e gera o arquivo `LISTA-DE-FOTOS.txt`.

## Enviar fotos dos produtos pelo painel

1. Acesse `/admin` e entre com a senha configurada em `ADMIN_PASSWORD`.
2. Abra a aba **Produtos**.
3. No cartão do produto, escolha uma foto JPG, PNG ou WebP e clique em **Enviar foto**.
4. A imagem é redimensionada e otimizada no navegador antes do envio. Use **Remover foto** para apagar a imagem enviada.

As fotos enviadas ficam gravadas no campo `image_url` da tabela `products` no PostgreSQL/Neon (como imagem JPEG em base64). Assim, elas continuam disponíveis após novos deploys no Render e não dependem do disco efêmero do serviço. O limite de envio é de aproximadamente 3,3 MB por foto original já otimizada (o servidor aceita até 4,5 MB de conteúdo codificado). Para manter o banco leve, prefira fotos de produto com até 1.100 px no maior lado.

## Trocar a logo das marcas pelo painel
Aba **Marcas** → no cartão da marca, escolha uma imagem (JPG, PNG ou WebP) e clique em **Enviar logo**. Ela é reduzida no navegador (256 px) e guardada no banco, então não some em novos deploys. **Remover logo** apaga a enviada.

## Desempenho (Render + Neon)
- Fotos e logos enviadas pelo painel continuam no banco, mas são entregues como arquivo em `/img/p/ID` e `/img/b/ID`, com cache de 1 ano no navegador. As listas `/api/products` e `/api/config` carregam só o endereço da imagem, não a imagem.
- Essas duas listas ficam 60 s em memória no servidor (limpas na hora quando você altera algo no painel), o que reduz as consultas ao Neon.
- Imagens por link (https://...) não passam pelo seu servidor: o navegador do cliente baixa direto do site de origem.
- Fotos de produto são reduzidas a 800 px antes do envio; logos, a 256 px.
