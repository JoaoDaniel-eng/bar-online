# Bar On-line do Cruzeiro

Esse é o meu primeiro projeto de verdade: um site de delivery de bebidas pro bar do Cruzeiro, aqui em Teresópolis. O cliente abre no celular, escolhe o que quer, monta o pedido e manda. Do outro lado tem um painel pra gente acompanhar o que entrou.

Fui aprendendo no caminho e usei IA pra me ajudar em algumas partes (principalmente layout, alguns trechos do servidor e o backup).

Feito com Node.js, Express e PostgreSQL (banco no Neon, site no Render). Também dá pra instalar como app no celular (PWA).

## O que já faz

Na loja:
- catálogo com categorias, busca e fotos dos produtos
- carrinho, cupom de desconto e taxa de entrega por bairro
- cadastro/login do cliente por WhatsApp e senha, com histórico de pedidos e favoritos
- aviso de maior de 18 anos logo na entrada
- botão pra instalar como app

No painel (`/admin`):
- ver pedidos e mudar o status
- cadastrar produtos, marcas, clientes e cupons
- estoque com histórico de entrada e saída
- caixa (abrir, movimentar, fechar)
- horário de funcionamento e botão de pausar pedidos
- vendas por período, exportar pedidos e backup

## Rodando na sua máquina

Precisa de Node 20+ e de um banco Postgres (eu uso o do Neon, que é de graça).

1. Copie o `.env.example` pra `.env` (o nome tem que ser `.env` mesmo, sem `.txt`)
2. Preencha as variáveis:

```env
DATABASE_URL=postgresql://usuario:senha@host/neondb?sslmode=require
ADMIN_PASSWORD=uma-senha-forte
SESSION_SECRET=um-texto-grande-e-aleatorio
WHATSAPP_NUMBER=5524999999999
STORE_NAME=Bar On-line do Cruzeiro
```

3. `npm install`
4. `npm start`

Loja em `http://localhost:3000` e painel em `http://localhost:3000/admin`. Na primeira vez ele cria as tabelas sozinho e já cadastra os produtos iniciais.

## Publicar no Render

Cria um Web Service ligado ao repositório, build `npm install` e start `npm start`. Coloca as mesmas variáveis do `.env` lá nas configurações. Tem que ser HTTPS pro PWA funcionar.

## Fotos

Dá pra mandar a foto pelo painel (fica salva no banco) ou jogar o arquivo em `public/produtos/` ou `public/brands/`. O nome do arquivo tem que ser minúsculo, sem acento e com hífen, tipo `heineken-long-neck.jpg`.

Rodando `npm run fotos` ele mostra quantos produtos já têm foto e gera um `LISTA-DE-FOTOS.txt` com os nomes que faltam.

Por enquanto só 20 dos 84 produtos têm foto. As que tenho são do catálogo da PMG Atacadista e carregam direto do site deles, então se saírem do ar a imagem some. Os logos das marcas ainda não coloquei.

## Mudar o catálogo

Produtos e preços iniciais ficam em `src/catalogo.js`. Pra aplicar num banco que já existe: `npm run catalogo`.

Cuidado: isso **apaga e recria** produtos e marcas. Faz backup antes se já tiver dado de verdade.

## Coisas pra lembrar

- nunca subir o `.env` pro GitHub
- o backup tem dados de cliente, não deixar público
- troca a senha do admin antes de usar de verdade

## Falta fazer

- fotos dos outros produtos e os logos
- testar melhor no iPhone
- mexer no visual, que ainda tá meio parecido com tudo quanto é site de bar
