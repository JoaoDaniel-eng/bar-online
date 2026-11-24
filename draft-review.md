# Rascunho v2 — Bar On-line do Cruzeiro

A primeira passagem preservou demais a composição original. Esta revisão reorganiza de forma visível a experiência: navegação de marca em marinho, hero tipográfico editorial em duas colunas com o asset real do projeto, busca ampla acoplada ao hero e nova área de compra com navegação de categorias lateral no desktop e faixa horizontal aderente no mobile. Os cards usam espaço maior para imagens reais cadastradas e deixam nome, descrição, valor e ação de adicionar em hierarquia própria. As molduras de produto foram ampliadas e usam enquadramento `contain` centralizado para acomodar embalagens altas sem cortar a imagem.

## Loja

A captura abaixo é a loja real, após a confirmação etária nesta sessão de preview. O hero e a busca aparecem normalmente; a prévia estática não acessa as APIs, por isso o catálogo mostra a mensagem de falha de carregamento. A tela isolada seguinte demonstra a composição da vitrine com placeholders rotulados — não contém produtos, preços, avaliações, estoque ou promoções inventados.

![Loja V2 na prévia estática — catálogo não conectado](/home/ubuntu/bar-online-cruzeiro-redesign/bar-online-cruzeiro/preview/store-live-v2.webp)

![Espécime V2 da vitrine — todos os dados entre colchetes são placeholders](/home/ubuntu/bar-online-cruzeiro-redesign/bar-online-cruzeiro/preview/store-draft-v2.webp)

## Painel

O login administrativo agora tem uma capa dividida entre identidade oficial do bar e formulário de autenticação. O formulário continua no mesmo fluxo; a captura não inclui credenciais nem dados operacionais.

![Login administrativo V2](/home/ubuntu/bar-online-cruzeiro-redesign/bar-online-cruzeiro/preview/admin-login-v2.webp)

## Prévia temporária

- Loja: https://8000-ik0gibf3ytc90bgv5u2r1-454310d4.us3.manus.computer/
- Painel: https://8000-ik0gibf3ytc90bgv5u2r1-454310d4.us3.manus.computer/admin.html
- Espécime de catálogo: disponível no servidor temporário da sessão em `/preview/catalog-specimen.html`.

A prévia é apenas para inspeção visual. Não foi publicada, não se conecta ao banco nem às APIs e não deve ser usada para fazer pedidos ou operar o bar. Nenhuma infraestrutura externa foi modificada.

## Avaliação solicitada

A mudança agora é estrutural, não apenas de acabamento. Por favor, avalie sobretudo se a separação hero → busca → trilho de categorias → vitrine ficou suficientemente distante do original. Vou aguardar sua avaliação antes de novos refinamentos ou de preparar o ZIP final.
