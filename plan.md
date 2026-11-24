# Plano — redesign do Bar On-line do Cruzeiro

## Decisão de redesign

- **Modo:** Redesign · Overhaul visual, mantendo produto, conteúdo, capacidades e contratos técnicos existentes.
- **Preservar:** identidade azul/dourada, logo e imagens fornecidas; página `/`, painel `/admin`, APIs e banco; confirmação de idade; busca, categorias/marcas, quantidades, favoritos, carrinho, cupom, endereço e taxas por bairro, pagamento, login, histórico, WhatsApp, PWA; doze módulos do painel e todas as rotinas de operação.
- **Melhorar:** hierarquia visual, clareza de descoberta, legibilidade de preço/estoque, composição da loja e uso móvel, apresentação do painel e estados de foco/hover/feedback.
- **Remover:** aparência visual inconsistente entre faixas da página, excesso de fundos ornamentais, tratamento homogêneo do catálogo e dependência de símbolos decorativos como estrutura visual.
- **Contratos protegidos:** rotas e handlers, IDs/atributos observados pelo JavaScript, campos e nomes dos formulários, eventos e requisições, chaves persistentes, textos legais, regras do carrinho/checkout e identidades reais da marca. Mudanças de apresentação preferencialmente via CSS; não mudar endpoints nem dados.
- **Design Read + calibração (revisto após feedback):** loja/PWA de delivery local para pessoas que podem desconhecer o bar; painel operacional para equipe. Família visual: empório local noturno, editorial, caloroso e confiante. Variância visual 9/10; movimento 5/10; densidade 6/10 na loja e 8/10 no painel; dependência de assets 7/10; fidelidade à marca 8/10.
- **Sistema visual aprovado:** marinho `#0B1022`, azul de marca `#2D6BFF`, dourado `#FFB020`, creme `#F7F1E3` e cinzas frios; títulos em Barlow Condensed, texto e interface em Barlow; unidade de espaçamento 8 px; cantos moderados; movimento curto e orientado a feedback, obedecendo movimento reduzido.
- **Risco principal:** JavaScript inline usa seletores por IDs/classes e markup dinâmico. Mudanças de DOM podem quebrar os fluxos. Mitigação: snapshot dos originais; preservar marcação funcional e priorizar superfícies CSS; conferir contratos e executar checagens de sintaxe disponíveis.
- **Recomposição da v2:** hero tipográfico de grande escala com busca encaixada; área de compra passa a trilho lateral de categorias + vitrine em grade no desktop e navegação horizontal aderente no mobile. Login do painel torna-se uma capa dividida de identidade e autenticação. Controles e IDs mantidos.
- **Rollback:** originais em `../backups/pre-redesign/` dentro do workspace de entrega. Comparação por hash foi feita antes da edição.

## Conteúdo e densidade

- Loja: hero com oferta de serviço sem dados novos; busca; categorias; produtos; ação de quantidade; estado do bar; conta/favoritos; carrinho/checkout; avisos legais e suporte.
- Painel: resumo e quatro KPIs; pedidos e status; produtos e imagens; estoque; marcas; bairros; relatórios; cupons; clientes; caixa; funcionamento/pausa; backup/exportação.
- Referências investigadas: Zé Delivery, CervejaBox, The-Bar, Wine e Imigrantes Bebidas. Só padrões diretamente observáveis são transferidos; escala, dados e promessas dos sites de referência não são copiadas.

## Estrutura do projeto

- `public/index.html`: loja, busca, estados de conta e checkout existentes.
- `public/admin.html`: autenticação e painel administrativo monolítico existente; os doze módulos continuam sendo selecionados pela chave `tab`.
- `public/*-redesign.css`: camadas de estilo do redesign separadas do código funcional inline.
- `public/sw.js`, ícones e manifesto: PWA e recursos de identidade.
- `src/server.js` e módulos `src/*`: API Express, catálogo PostgreSQL, clientes, cupons, funcionamento, caixa, estoque e backup; permanecem fora do escopo visual.
- `referencias-ux.md`: síntese da pesquisa e limites de observação.
- `TODO.md`: resultados a entregar e verificação final.
