# Entregáveis — redesign do Bar On-line do Cruzeiro

- [x] Primeira direção visual aplicada e inspecionada; o usuário avaliou que a mudança ainda estava próxima demais do original.
- [x] Revisão estrutural V2 aplicada: busca no hero, trilho lateral de categorias no desktop, navegação de categorias adaptável no mobile, novos cards de vitrine e login administrativo em duas áreas.
- [x] Espécime de catálogo isolado usa placeholders explícitos, sem inventar produtos, fotos, valores, disponibilidade ou promoções.
- [x] A tela de autenticação continua usando o fluxo de login existente; os módulos administrativos continuam no mesmo arquivo e handlers.
- [x] Capturas da loja, do espécime e do login V2 salvas em `preview/`; preview estático não conecta a APIs/banco.
- [x] Aplicar a direção azul/dourada aprovada, manter tema claro/escuro e respeitar `prefers-reduced-motion` nas folhas de estilo.
- [x] Revalidar scripts inline, IDs, controles/campos, literais de endpoint, folhas CSS e respostas HTTP após a última alteração.
- [ ] Conferir os fluxos operacionais do catálogo/checkout e os 12 módulos administrativos com o ambiente conectado, sem executar pedidos ou operações reais neste preview.
- [ ] Aguardar avaliação da nova versão pelo usuário e aplicar os refinamentos solicitados.
- [ ] Somente após aprovação final, gerar ZIP limpo sem credenciais reais, dependências vendorizadas ou backups internos.
