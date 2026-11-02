<div align="center">

# dsh-store-replenish

> **Repositório oficial. O único repositório oficial deste pacote, mantido por PerryLink. Apache-2.0.**

</div>

Transforma uma tabela CSV de vendas e estoque por loja-SKU em sugestões de reposição por SKU, um pedido de reposição por loja e um CSV de reposição. Fórmula: média diária × (dias de ciclo + dias de segurança) − estoque − em trânsito, arredondada para cima até o MOQ. Sinaliza SKUs de baixo giro (mais de 60 dias) e risco de ruptura de estoque. Tudo roda localmente: sem rede, sem upload e sem alterar o CSV original.

A amostra incluída é sintética (2 lojas × 8 SKUs) e contém um SKU de baixo giro e dois com risco de ruptura. O resultado de referência vem de uma execução real e a captura de tela é a saída real do terminal.

## Documentação completa

A documentação completa (instalação, formato de entrada, regras de MOQ, permissões, exemplos e solução de problemas) está em [README.md](README.md) e [README-zh.md](README-zh.md).

## Licença

Apache-2.0. Ver `LICENSE`, `NOTICE` e `THIRD-PARTY-NOTICES`.
