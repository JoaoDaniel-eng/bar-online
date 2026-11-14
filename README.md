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
- **Bairros e taxas**: cada bairro tem nome, taxa e chave Ativo. Dá para editar nome e taxa direto na lista, desativar sem apagar (some do site) e o sistema recusa bairro repetido. Pedidos só aceitam bairros ativos.
- **Funcionamento**: nome do bar, WhatsApp, dias e horário (aceita madrugada: abre 18:00, fecha 02:00; abre e fecha no mesmo horário = 24h), previsão de entrega, frete grátis a partir de um valor e fechamento manual. Fora do horário, ou com o fechamento manual, o site mostra o aviso de fechado e o servidor recusa pedidos. O botão **Pausar pedidos** no topo do painel liga e desliga o fechamento manual; o Caixa pode reabrir/pausar os pedidos ao abrir/fechar. Nome e WhatsApp vazios usam `STORE_NAME` e `WHATSAPP_NUMBER` do `.env`. Sem nada configurado o bar fica aberto 24h, todos os dias. Código em `src/funcionamento.js`.
- **Relatórios**: resumo de Hoje / Esta semana / Este mês (a semana começa na segunda), e para 7, 30 ou 90 dias: faturamento, pedidos, ticket médio, taxas de entrega, faturamento por dia, 10 mais vendidos, horários de pico (a madrugada fica junto da noite), dias da semana e formas de pagamento. Horário de Brasília; cancelados não contam.
- **Cupons**: código, desconto em % ou valor fixo, pedido mínimo, ativar/desativar e excluir; mostra quantos pedidos usaram cada cupom e quanto saiu em descontos. O cliente aplica no fim do pedido; o servidor recalcula o desconto (sobre o valor das bebidas, antes da entrega) e o frete grátis considera o valor já com desconto. A comanda, o WhatsApp e os Relatórios mostram o cupom. As tentativas de código no site são limitadas a 30 por IP a cada 10 min. O cupom automático de primeira compra do açaí não foi levado (precisa de conta de cliente). Código em `src/cupons.js`.
- **Estoque** (mesma ideia do Açaí da Roça): cada item tem saldo, medidor (bom / está acabando / esgotado), alerta mínimo e gasto em compras. Ações: **Adicionar compra** (soma ao saldo, guarda valor e fornecedor), **Corrigir saldo** (informa o que existe de verdade; a diferença vai para o histórico como conferência, sem contar como compra), **Retirar / perda** (uso, quebra, vencimento), **Editar** (nome, alerta, quantidade cheia; trocar kg↔g ou L↔ml converte o saldo) e **Excluir** (lógico: o histórico fica). Há busca, filtro por situação e o histórico de movimentações. Para cadastrar vários produtos de uma vez use **Contar vários produtos de uma vez**.
  - **Ligação com o cardápio:** se o nome do item for igual ao de um produto do cardápio, ele fica ligado. Cada pedido desconta as unidades **na hora** (são garrafas e latas físicas); se dois clientes disputam a última unidade, só um leva e o outro recebe a mensagem "acabou". Cancelar o pedido devolve exatamente o que saiu; reativar um cancelado desconta de novo (e recusa se não houver mais).
  - **No site:** com 3 ou menos unidades aparece "Os 3 últimos!" (2 → "Os 2 últimos!", 1 → "Último!"); com 0, "Esgotado" e não dá para comprar; o carrinho nunca passa do saldo.
  - **Sem controle:** produto do cardápio sem item de estoque vende sem limite, como antes. Cuidado: item ligado com saldo **0** aparece como Esgotado no site. Itens que não são vendidos (gelo, copos) ficam só com controle manual.
  - O aviso na aba mostra quantos itens estão acabando ou esgotados. Código em `src/estoque.js`; as tabelas `inventory_items` e `inventory_movements` e a coluna `orders.stock_used` (o que cada pedido descontou) são criadas sozinhas na primeira execução, sem apagar nada.
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

## Conta de cliente (login, pedidos, favoritos, pontos)

- O cliente cria conta com **WhatsApp + senha** (menu ☰ ou botão "Entrar" no topo da loja). As tabelas `customers` e `customer_favorites` são criadas sozinhas ao iniciar.
- Menu da conta: Minha conta, Meus pedidos (com "Pedir de novo"), Meus cupons, Meus favoritos (♡ ao lado de cada bebida) e Configurações (nome, endereço, trocar senha).
- **Pontos do clube:** 1 ponto a cada R$ 1,00 em bebidas (já com desconto, sem a entrega) de pedidos com status **entregue**.
- **Meus cupons** mostra os cupons marcados como "Visível p/ clientes" (aba Cupons do painel) e os que o cliente já usou.
- Painel → aba **Clientes**: lista com pedidos, gasto e pontos; "Nova senha" para quem esqueceu a senha; "Excluir" conta.
- Pedidos feitos sem login continuam funcionando normalmente.
- A sessão do cliente usa `SESSION_SECRET` (ou `ADMIN_PASSWORD`) para assinar o token: não troque esse valor depois de publicar, senão todos saem da conta.
