---
title: Importação de Dados
sidebar_label: Importação de Dados
slug: pt/docs/features/data-import
description: Importe dados de arquivos CSV, JSON e Excel para suas coleções com mapeamento de campos e validação.
---

## Visão Geral

Rebase suporta a importação de dados de:

- arquivos **CSV**
- arquivos **JSON**
- arquivos **Excel** (`.xlsx`)

O assistente de importação lida com o mapeamento de colunas, coerção de tipo de dados e validação.

## Como Importar

1. Abra uma coleção no painel de administração
2. Clique no botão **Importar** na barra de ferramentas
3. Selecione ou arraste e solte seu arquivo
4. Mapeie as colunas do arquivo para as propriedades da coleção
5. Visualize os dados e resolva quaisquer erros de validação
6. Clique em **Importar** para salvar todas as entidades

![Interface de importação de dados](/img/data_import.png)

## Configuração

Ativar/desativar importação por coleção:

```typescript
const productsCollection: EntityCollection = {
    slug: "products",
    // Import is enabled by default
    // To disable:
    // importable: false
    properties: { /* ... */ }
};
```

## Próximos Passos

- **[Exportação de Dados](/docs/features/data-export)** — Exporte dados para CSV/JSON

---
