---
sourceHash: 2e2dfa451a30f422
title: Importação e Exportação de Dados
sidebar_label: Importação e Exportação de Dados
description: Importe dados de arquivos CSV, JSON e Excel para suas coleções e exporte dados de coleções para CSV ou JSON com campos computados opcionais.
---

## Visão Geral

O Rebase inclui ferramentas integradas de importação e exportação de dados acessíveis diretamente do painel de administração. A importação suporta arquivos CSV, JSON e Excel com um assistente de mapeamento de colunas. A exportação suporta CSV e JSON com campos computados opcionais.

Ambos estão disponíveis em todas as coleções. A exportação pode ser configurada por coleção com campos computados; nenhum dos dois recursos pode ser desativado por coleção.

## Importando Dados

### Como Importar

1. Abra uma coleção no painel de administração
2. Clique no botão **Importar** na barra de ferramentas
3. Selecione ou arraste e solte seu arquivo
4. Mapeie as colunas do arquivo para as propriedades da coleção
5. Pré-visualize os dados e resolva eventuais erros de validação
6. Clique em **Importar** para salvar todas as entidades

### Formatos Suportados

| Formato | Extensões | Observações |
|---------|-----------|-------------|
| CSV | `.csv` | Detecta delimitadores automaticamente |
| JSON | `.json` | Espera um array de objetos |
| Excel | `.xlsx` | Lê a primeira planilha |

### Mapeamento de Colunas

O assistente de importação tenta corresponder automaticamente as colunas do arquivo com as propriedades da coleção pelo nome. Você pode ajustar os mapeamentos manualmente antes de importar:

- **Correspondências exatas** são mapeadas automaticamente (ex.: `name` → `name`)
- **Colunas não correspondidas** podem ser mapeadas manualmente ou ignoradas
- **Coerção de tipos** lida com conversões de string para número, string para booleano e análise de datas

### Validação

Antes de importar, o assistente valida todas as linhas em relação às definições de propriedade da sua coleção:

- Campos obrigatórios devem estar presentes
- Valores de enum devem corresponder às opções definidas
- Tipos de dados devem ser compatíveis (ex.: um valor de texto em um campo numérico é sinalizado)
- Erros de validação são exibidos linha por linha para que você possa corrigi-los antes de importar

### Configuração de Importação

A importação está disponível em todas as coleções. Não há configuração por coleção para desativá-la.

## Exportando Dados

### Como Exportar

1. Abra uma coleção no painel de administração
2. Opcionalmente, aplique filtros para exportar um subconjunto de dados
3. Clique no botão **Exportar** na barra de ferramentas
4. Escolha o formato: **CSV** ou **JSON**
5. O download do arquivo inicia imediatamente

### Formatos de Exportação

| Formato | Descrição |
|---------|-----------|
| CSV | Valores separados por vírgula, compatível com Excel e Google Planilhas |
| JSON | Array de objetos, útil para consumo programático |

### Filtragem Antes da Exportação

Quaisquer filtros ativos na visualização da coleção são aplicados à exportação. Isso permite exportar apenas um subconjunto dos seus dados:

- Aplique filtros de coluna ou termos de busca na visualização da coleção
- Clique em **Exportar** — apenas as linhas filtradas serão incluídas

### Configuração de Exportação

A exportação está disponível em todas as coleções. O `admin.exportable` a configura: forneça a ele um `ExportConfig` para adicionar colunas computadas, como mostrado abaixo. O tipo também aceita um booleano, mas nada o lê — `exportable: false` não remove o botão **Exportar**.

### Adicionando Campos Computados

Use o objeto `ExportConfig` para adicionar colunas computadas personalizadas às suas exportações. Essas colunas não existem no banco de dados — elas são calculadas no momento da exportação:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const productsCollection = defineCollection({
    slug: "products",
    table: "products",
    name: "Products",
    properties: { /* ... */ },
    admin: {
        exportable: {
            additionalFields: [
                {
                    key: "computed_margin",
                    builder: ({ entity }) => {
                        const price = entity.values.price as number;
                        const cost = entity.values.cost as number;
                        return String(price - cost);
                    }
                },
                {
                    key: "full_url",
                    builder: ({ entity }) => {
                        return `https://mystore.com/products/${entity.id}`;
                    }
                }
            ]
        }
    }
});

```

Cada entrada de `additionalFields` possui:

| Propriedade | Tipo | Descrição |
|-------------|------|-----------|
| `key` | `string` | Nome da coluna na exportação |
| `builder` | `({ entity, context }) => string \| Promise<string>` | Função que calcula o valor |

A função `builder` recebe a `entity` atual e o `RebaseContext` (que inclui o usuário autenticado), permitindo calcular valores com base tanto nos dados quanto nas permissões.

### Campos Computados Assíncronos

A função `builder` pode ser assíncrona, o que é útil quando o valor computado requer uma consulta ao banco de dados ou uma chamada de API:

```typescript
exportable: {
    additionalFields: [
        {
            key: "author_name",
            builder: async ({ entity, context }) => {
                const author = await context.data.users.findById(
                    entity.values.authorId as string
                );
                return author?.values.displayName ?? "Unknown";
            }
        }
    ]
}
```

## Próximos Passos

- **[Coleções](/docs/collections)** — Defina seu modelo de dados
- **[Visão Geral do Frontend](/docs/frontend)** — Painel de administração e componentes de UI
- **[SDK do Cliente](/docs/sdk)** — Acesso programático aos dados
