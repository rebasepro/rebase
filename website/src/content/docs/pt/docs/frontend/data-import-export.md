---
sourceHash: d8dc261c256b2bc3
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
5. Pré-visualize os dados, incluindo quaisquer valores que não possam ser convertidos
6. Clique em **Salvar dados** para gravar as linhas

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
- **Conversão de tipos** transforma cada célula no tipo da propriedade à qual ela é mapeada, mas apenas quando nada é perdido (veja abaixo)

### Conversão de tipos

Uma célula só é convertida quando o tipo da propriedade consegue conter exatamente o que ela diz:

| Tipo de propriedade | Converte | Não converte |
|---|---|---|
| Número | `12`, `-3.5`, `10.00`, `1e3` | `02134` (um zero à esquerda seria perdido), números com mais de 15 dígitos significativos, `1,234`, `$5.00`, `12%`, `N/A` |
| Booleano | `true`/`false`, `yes`/`no`, `y`/`n`, `1`/`0`, em qualquer caixa | qualquer outra coisa |
| Data | ISO 8601 (`2024-01-05`, `2024-01-05T10:00:00Z`), datas escritas por extenso (`5 Jan 2024`), `05/01/2024`, segundos ou milissegundos epoch | texto que não nomeia uma data |
| Geopoint | o objeto que a exportação escreve, `{"latitude": 41.9, "longitude": 12.5}`, ou o seu JSON numa célula CSV | qualquer outra coisa, ou uma coordenada fora do intervalo |
| Mapa sem campos declarados | um objeto, ou o seu JSON numa célula CSV | qualquer outra coisa |
| Vetor | uma lista de números (`[0.1, 0.2]`, `0.1, 0.2`), ou o `{"value": [0.1, 0.2]}` da exportação | uma lista que contém algo que não é um número |

Uma data sem horário é esse dia em UTC. Para datas escritas como `05/01/2024`, a coluna decide a ordem: um primeiro número acima de 12 torna a coluna dia-primeiro, um segundo número acima de 12 torna-a mês-primeiro. Quando uma coluna nunca o indica, o locale do navegador decide, e quando ela contém as duas ordens, uma data que qualquer uma das ordens poderia ler não é convertida.

Uma célula em branco não é um valor: ela não define nada, e o padrão que você escolheu para essa propriedade se aplica.

Um arquivo exportado de uma coleção é importado de volta com os mesmos valores, seja CSV ou JSON. Um mapa com campos declarados é lido com uma coluna por campo (`address.street`), como a exportação o escreve; qualquer outro valor, incluindo um geopoint ou um mapa chave-valor, é uma única coluna. Um número epoch entre -100,000,000,000 e 100,000,000,000 é lido como segundos, então uma data entre 31 de outubro de 1966 e 3 de março de 1973 exportada como timestamp não volta igual: exporte essas datas como texto. Um campo de hora do dia lê um número abaixo de um dia (86,400,000) como os milissegundos desde a meia-noite que a exportação escreve.

### Valores que não podem ser importados

A pré-visualização lista cada célula que não é convertida, por coluna, com quantas existem e as primeiras por linha e motivo. Essas células são deixadas vazias nas linhas importadas; nada é transformado em `0`, `false` ou um valor vazio sem ser listado. Volte para mapear a coluna para outra propriedade, ou corrija o arquivo e envie-o novamente.

As próprias regras da coleção — campos obrigatórios, opções de enum, valores únicos — são verificadas pelo servidor conforme as linhas são gravadas, 25 linhas por vez. Se uma linha for recusada, a importação para e a identifica; as linhas anteriores a ela já estão salvas, e **Tentar novamente** retoma a partir da linha recusada.

### Criando uma coleção a partir de um arquivo

Ao criar uma coleção a partir de um arquivo, o tipo de cada coluna é inferido a partir de seus valores. Uma coluna só é numérica se todo valor nela for um número ou texto que se converte exatamente em um, então uma coluna de CEPs, códigos de produto com zeros à esquerda, SKUs longos ou números de telefone permanece texto. Uma coluna que mistura tipos (números e palavras, booleanos e números) é texto. Células em branco não contam, então uma coluna majoritariamente vazia não é marcada como obrigatória.

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
- **[SDK tipado](/docs/sdk)** — Acesso programático aos dados
