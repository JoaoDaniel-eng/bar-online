# Bar On-line do Cruzeiro — delivery de bebidas (PWA)

Node + Express + PostgreSQL (Neon). Loja em `/`, painel em `/admin`. O servidor e os módulos da aplicação ficam em `src/`; os arquivos públicos do site ficam em `public/`.

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
- **Cupons**: código, desconto em % ou valor fixo, pedido mínimo, ativar/desativar e excluir; mostra quantos pedidos usaram cada cupom e quanto saiu em descontos. O cliente aplica no fim do pedido; o servidor recalcula o desconto (sobre o valor das bebidas, antes da entrega) e o frete grátis considera o valor já com desconto. A comanda, o WhatsApp e os Relatórios mostram o cupom. As tentativas de código no site são limitadas a 30 por IP a cada 10 min. Código em `src/cupons.js`.
- **Estoque**: cada item tem saldo, medidor (bom / está acabando / esgotado), alerta mínimo e gasto em compras. Ações: **Adicionar compra** (soma ao saldo, guarda valor e fornecedor), **Corrigir saldo** (informa o que existe de verdade; a diferença vai para o histórico como conferência, sem contar como compra), **Retirar / perda** (uso, quebra, vencimento), **Editar** (nome, alerta, quantidade cheia; trocar kg↔g ou L↔ml converte o saldo) e **Excluir** (lógico: o histórico fica). Há busca, filtro por situação e o histórico de movimentações. Para cadastrar vários produtos de uma vez use **Contar vários produtos de uma vez**.
  - **Ligação com o cardápio:** se o nome do item for igual ao de um produto do cardápio, ele fica ligado. Cada pedido desconta as unidades **na hora** (são garrafas e latas físicas); se dois clientes disputam a última unidade, só um leva e o outro recebe a mensagem "acabou". Cancelar o pedido devolve exatamente o que saiu; reativar um cancelado desconta de novo (e recusa se não houver mais).
  - **No site:** com 3 ou menos unidades aparece "Os 3 últimos!" (2 → "Os 2 últimos!", 1 → "Último!"); com 0, "Esgotado" e não dá para comprar; o carrinho nunca passa do saldo.
  - **Sem controle:** produto do cardápio sem item de estoque vende sem limite, como antes. Cuidado: item ligado com saldo **0** aparece como Esgotado no site. Itens que não são vendidos (gelo, copos) ficam só com controle manual.
  - O aviso na aba mostra quantos itens estão acabando ou esgotados. Código em `src/estoque.js`; as tabelas `inventory_items` e `inventory_movements` e a coluna `orders.stock_used` (o que cada pedido descontou) são criadas sozinhas na primeira execução, sem apagar nada.
- **Backup**: baixa um arquivo .json com todos os dados (com ou sem as fotos enviadas pelo painel), exporta os pedidos em CSV (Excel), guarda cópias dentro do próprio banco (1 automática por dia quando há movimento, as 5 últimas; mais as manuais e as feitas antes de restaurar) e restaura de uma cópia ou de um arquivo. Restaurar substitui os dados atuais, exige digitar RESTAURAR e antes guarda uma cópia do que existia, tudo dentro de uma transação (se algo falhar, nada muda). Lê a lista de tabelas do banco sozinho, então tabelas novas entram no backup sem alterar o código. A tabela `backups` é criada sozinha. O arquivo de backup tem dados de clientes (incluindo o hash das senhas): não compartilhe. Código em `src/backup.js`.
- **Produtos** (com busca, fotos e ativar/desativar), **Marcas** e **Bairros** com taxa de entrega.

## Catálogo
Os produtos e preços ficam em `src/catalogo.js`. Em banco novo eles são cadastrados sozinhos na primeira execução.
Para trocar os produtos de um banco que já existe pelo catálogo de `src/catalogo.js`, rode `npm run catalogo` (apaga produtos e marcas atuais; os pedidos não são afetados).

## Fotos e logos
Basta colocar os arquivos nas pastas, com o nome do produto/marca em minúsculas, sem acento e com hífen no lugar dos espaços:
- fotos dos produtos em `public/produtos/` (ex.: `heineken-long-neck.jpg`, `coca-cola-2-l.png`)
- logos das marcas em `public/brands/` (ex.: `skol.png`, `stella-artois.png`)
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

## Checkout (entrega)
- Se faltar nome, WhatsApp com DDD, bairro, endereço ou forma de pagamento, o campo fica com contorno vermelho, aparece o aviso embaixo dele e a tela rola até o primeiro que falta. O aviso some quando o cliente corrige.
- A caixinha **Salvar meus dados de entrega** vem marcada. Sem conta, os dados ficam só no aparelho (navegador) e já vêm preenchidos no próximo pedido. Com conta, nome, bairro e endereço também são salvos na conta. Desmarcada, nada é guardado (e o que estava no aparelho é apagado). A escolha fica lembrada.

## Botão "Instalar app"
- Fica no topo da loja, também no celular. Some sozinho quando o app já está instalado (ou quando o cliente instala).
- No Android/Chrome e no computador (Chrome/Edge), um toque abre a janela de instalação do navegador. Se o navegador ainda não liberou a instalação, o botão mostra o passo a passo.
- No iPhone o Safari não permite instalar por botão: o toque mostra o passo a passo (Compartilhar → Adicionar à Tela de Início). Dentro do Instagram/WhatsApp ele orienta a abrir no navegador.
- A instalação só funciona em HTTPS (o Render já fornece). Em telas estreitas o botão vira só o ícone, e "Meu pedido" vira "Pedido" para tudo caber.

## Aviso de nova versão (depois de um deploy)
- A cada deploy o servidor gera um número de versão (no Render, o commit; fora dele, um hash do conteúdo do site) e coloca no `sw.js`. Quem está com a loja aberta ou instalada no celular vê embaixo "Há uma nova atualização disponível" com o botão **Atualizar**. Ao tocar, a loja recarrega já na versão nova; o carrinho é mantido.
- O celular confere a versão ao abrir, ao voltar para a loja e a cada 10 minutos. Quem só abriu a loja pela primeira vez não vê o aviso.
- Não precisa mais mexer no número de versão do `sw.js` (`__BUILD__` é trocado sozinho pelo servidor em `src/server.js`).
