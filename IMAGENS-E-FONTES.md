# Fotografias do catálogo

Foram vinculadas fotografias reais de embalagens para 20 dos 84 produtos cadastrados. O catálogo continua funcional para os demais itens, que permanecem sem fotografia específica até que uma imagem correta seja localizada.

## Como funciona

- O backend usa primeiro a imagem cadastrada no painel administrativo.
- Depois procura um arquivo local em `public/produtos/`.
- Por último, consulta o mapeamento de imagens externas em `src/fotos-catalogo.js`.
- As imagens externas são exibidas diretamente do CDN da PMG Atacadista; portanto, dependem de conexão com a internet e de o fornecedor manter os arquivos públicos disponíveis.

## Produtos com fotografia vinculada

Brahma, Itaipava, Império, Corona, Stella, Amstel, Absolut, Smirnoff, Bacardi, Campari, Dreher, Velho Barreiro, Monster, Red Bull, Coca-Cola 2 L, Coca-Cola 2 L Gelada, Coca-Cola 350 ml, Guaraná Antarctica, Guaraná Antarctica 350 ml e Água Tônica.

## Fonte

As fotografias foram localizadas no catálogo público da PMG Atacadista:

- https://pmg.com.br/produtos-lista/1/

Os tamanhos e versões das fotos são os que constam no catálogo do fornecedor. Para itens cujo nome do catálogo da loja não especifica volume, foi escolhida uma embalagem identificável da mesma marca; não foram criadas imagens por IA nem usados placeholders como se fossem fotos reais.

## Observação sobre logos

Os logotipos isolados das marcas não foram incluídos nesta etapa porque não foi possível validar um conjunto completo de arquivos oficiais. As marcas continuam identificadas pelo nome e pelas cores já configuradas no sistema.
