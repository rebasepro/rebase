---
title: Importação e Exportação de Dados
sidebar_label: Importação e Exportação de Dados
description: Importe dados de arquivos CSV, JSON e Excel para suas coleções, e exporte os dados das coleções para CSV ou JSON com campos computados opcionais.
---

## Visão Geral

A Rebase inclui ferramentas integradas de importação e exportação de dados acessíveis diretamente do painel de administração. A importação suporta arquivos CSV, JSON e Excel com um assistente de mapeamento de colunas. A exportação suporta CSV e JSON com campos computados opcionais.

Ambos os recursos são habilitados por padrão em todas as coleções e podem ser configurados ou desativados por coleção.

## Importando Dados

### Como Importar

1. Abra uma coleção no painel de administração
2. Clique no botão **Importar** na barra de ferramentas
3. Selecione ou arraste e solte o seu arquivo
4. Mapeie as colunas do arquivo para as propriedades da coleção
5. Pré-visualize os dados e resolva quaisquer erros de validação
6. Clique em **Importar** para salvar todas as entidades

### Formatos Suportados

| Formato | Extensões | Notas |
|--------|-----------|-------|
| CSV | `.csv` | Detecta delimitadores automaticamente |
| JSON | `.json` | Espera um array de objetos |
| Excel | `.xlsx` | Lê a primeira planilha |

### Mapeamento de Colunas

O assistente de importação tenta automaticamente corresponder as colunas do arquivo às propriedades da coleção por nome. Você pode ajustar os mapeamentos manualmente antes de importar:

- **Correspondências exatas** são mapeadas automaticamente (por ex., `name` → `name`)
- **Colunas sem correspondência** podem ser mapeadas manualmente ou ignoradas
- A **coerção de tipos** cuida da conversão de string para número, string para booleano e análise de datas

### Validação

Antes de importar, o assistente valida todas as linhas contra as definições de propriedade da sua coleção:

- Os campos obrigatórios devem estar presentes
- Os valores enum devem corresponder às opções definidas
- Os tipos de dados devem ser compatíveis (por ex., um valor de texto para um campo numérico é sinalizado)
- Os erros de validação são exibidos por linha para que você possa corrigi-los antes de importar

### Configuração de Importação

A importação é habilitada por padrão. Para desativá-la em uma coleção específica, use o sub-objeto `admin`:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const productsCollection = defineCollection({
    slug: "products",
    table: "products",
    name: "Products",
    properties: { /* ... */ },
    // Import is enabled by default
});
```

## Exportando Dados

### Como Exportar

1. Abra uma coleção no painel de administração
2. Opcionalmente aplique filtros para exportar um subconjunto de dados
3. Clique no botão **Exportar** na barra de ferramentas
4. Escolha o formato: **CSV** ou **JSON**
5. O arquivo é baixado imediatamente

### Formatos de Exportação

| Formato | Descrição |
|--------|-------------|
| CSV | Valores separados por vírgula, compatível com Excel e Google Sheets |
| JSON | Array de objetos, útil para consumo programático |

### Filtrando Antes de Exportar

Quaisquer filtros ativos na visão da coleção são aplicados à exportação. Isso permite exportar apenas um subconjunto dos seus dados:

- Aplique filtros de coluna ou termos de busca na visão da coleção
- Clique em **Exportar** — apenas as linhas filtradas são incluídas

### Configuração de Exportação

A exportação é habilitada por padrão. Você pode configurá-la com campos computados adicionais:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const productsCollection = defineCollection({
    slug: "products",
    table: "products",
    name: "Products",
    properties: { /* ... */ },
    admin: {
        exportable: true            // Enable (default: true)
    }
});

```

Para desativar a exportação:

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const productsCollection = defineCollection({
    slug: "products",
    table: "products",
    name: "Products",
    properties: { /* ... */ },
    admin: {
        exportable: false
    }
});

```

### Adicionando Campos Computados

Use o objeto `ExportConfig` para adicionar colunas computadas personalizadas às suas exportações. Essas colunas não existem no banco de dados — são calculadas no momento da exportação:

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

Cada entrada de `additionalFields` tem:

| Propriedade | Tipo | Descrição |
|----------|------|-------------|
| `key` | `string` | Nome da coluna na exportação |
| `builder` | `({ entity, context }) => string \| Promise<string>` | Função que computa o valor |

A função `builder` recebe a `entity` atual e o `RebaseContext` (que inclui o usuário autenticado), então você pode computar valores com base tanto nos dados quanto nas permissões.

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
- **[SDK Cliente](/docs/sdk)** — Acesso programático aos dados
