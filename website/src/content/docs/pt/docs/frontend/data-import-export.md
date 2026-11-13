---
sourceHash: 66fc9b42bef4d463
title: Importação e Exportação de Dados
sidebar_label: Importação e Exportação de Dados
description: Importe dados de arquivos CSV, JSON e Excel para suas coleções e exporte dados de coleções para CSV ou JSON com campos computados opcionais.
---

## Visão Geral

O Rebase inclui ferramentas integradas de importação e exportação de dados acessíveis diretamente do painel de administração. A importação suporta arquivos CSV, JSON e Excel com um assistente de mapeamento de colunas. A exportação suporta CSV e JSON com campos computados opcionais.

Ambos estão disponíveis em todas as coleções. A exportação pode ser configurada por coleção com campos computados ou desativada com `exportable: false`; a importação não pode ser desativada por coleção.

## Importando Dados

### Como Importar

1. Abra uma coleção no painel de administração
2. Clique no botão **Import** na barra de ferramentas
3. Selecione ou arraste e solte seu arquivo
4. Mapeie as colunas do arquivo para as propriedades da coleção
5. Visualize os dados, incluindo quaisquer valores que não puderem ser convertidos
6. Clique em **Save data** para gravar as linhas

### Formatos Suportados

| Formato | Extensões | Observações |
|---------|-----------|-------------|
| CSV | `.csv` | Detecta delimitadores automaticamente |
| JSON | `.json` | Espera um array de objetos |
| Excel | `.xlsx` | Lê a primeira planilha |

### Mapeamento de Colunas

O assistente de importação tenta corresponder automaticamente as colunas do arquivo às propriedades da coleção por nome. Você pode ajustar manualmente os mapeamentos antes de importar:

- **Correspondências exatas** são mapeadas automaticamente (ex.: `name` → `name`)
- **Colunas não correspondidas** podem ser mapeadas manualmente ou ignoradas
- **A conversão de tipo** transforma cada célula no tipo da propriedade para a qual ela é mapeada, mas somente quando nada é perdido (veja abaixo)

### Conversão de tipo

Uma célula é convertida apenas quando o tipo da propriedade pode conter exatamente o que ela diz:

| Tipo de propriedade | Converte | Não converte |
|---|---|---|
| Number | `12`, `-3.5`, `10.00`, `1e3` | `02134` (um zero à esquerda seria perdido), números com mais de 15 dígitos significativos, `1,234`, `$5.00`, `12%`, `N/A` |
| Boolean | `true`/`false`, `yes`/`no`, `y`/`n`, `1`/`0`, em qualquer combinação de maiúsculas/minúsculas | qualquer outra coisa |
| Date | ISO 8601 (`2024-01-05`, `2024-01-05T10:00:00Z`), datas por extenso (`5 Jan 2024`), `05/01/2024`, segundos ou milissegundos de época (epoch) | texto que não especifica uma data |
| Geopoint | o objeto gravado pela exportação, `{"latitude": 41.9, "longitude": 12.5}`, ou seu JSON em uma célula CSV | qualquer outra coisa, ou uma coordenada fora do intervalo |
| Map sem campos declarados | um objeto, ou seu JSON em uma célula CSV | qualquer outra coisa |
| Vector | uma lista de números (`[0.1, 0.2]`, `0.1, 0.2`), ou o `{"value": [0.1, 0.2]}` da exportação | uma lista contendo qualquer coisa que não seja um número |

Uma data sem horário corresponde àquele dia em UTC. Para datas escritas como `05/01/2024`, a coluna decide a ordem: um primeiro número maior que 12 define a coluna como dia primeiro; um segundo número maior que 12 define-a como mês primeiro. Quando uma coluna não torna isso evidente, a localidade (locale) do navegador decide, e quando ela contém ambas as ordens, uma data que poderia ser lida em qualquer uma das ordens não é convertida.

Uma célula vazia equivale a nenhum valor: ela não define nada, e o valor padrão escolhido para essa propriedade é aplicado.

Um arquivo exportado de uma coleção é importado novamente com os mesmos valores, seja CSV ou JSON. Um map com campos declarados é lido como uma coluna por campo (`address.street`), conforme a exportação o grava; qualquer outro valor, incluindo um geopoint ou um map chave-valor, é uma coluna. Um número de época entre -100.000.000.000 e 100.000.000.000 é lido como segundos, portanto uma data entre 31 de outubro de 1966 e 3 de março de 1973 exportada como timestamp não é restaurada: exporte essas datas como texto. Um campo de hora do dia lê um número menor que um dia (86.400.000) como os milissegundos desde a meia-noite gravados pela exportação.

### Valores que não podem ser importados

A pré-visualização lista cada célula que não é convertida, por coluna, informando a quantidade e as primeiras ocorrências por linha e motivo. Essas células são deixadas vazias nas linhas importadas; nada é transformado em `0`, `false` ou em um valor vazio sem ser listado. Volte para mapear a coluna para outra propriedade ou corrija o arquivo e faça o upload novamente.

As regras da própria coleção — campos obrigatórios, opções de enum, valores únicos — são verificadas pelo servidor à medida que as linhas são gravadas, em lotes de até 500 linhas (menos quando as linhas são amplas, para que a requisição permaneça abaixo de cerca de 1 MB). Um lote é salvo por inteiro ou não é salvo. Se uma linha for recusada, a importação é interrompida e indica qual foi; os lotes anteriores já estão salvos, e o **Retry** retoma a partir da primeira linha do lote da linha recusada.

Uma linha cujo id já esteja na coleção atualiza esse registro: as colunas contidas no arquivo são gravadas, e as demais mantêm seus valores armazenados; assim, um arquivo de `id,price` atualiza os preços de produtos existentes sem repetir seus campos obrigatórios. Uma nova linha ainda precisa de todos os campos obrigatórios. Um lote que mistura atualizações e novas linhas é gravado em duas requisições, de modo que uma nova linha recusada pode manter as atualizações daquele lote salvas; o **Retry** as grava novamente com os mesmos valores.

### Importando usuários

Uma nova linha na tabela de usuários é uma criação de usuário: a coluna `password` tem seu hash gerado e nunca é armazenada como foi escrita, e uma linha sem essa coluna recebe uma senha gerada ou um convite, como quando um administrador adiciona um usuário. As senhas em um arquivo desse tipo geralmente foram definidas de acordo com as regras de outro sistema, portanto a importação solicita ao servidor que ignore a [política de senhas](/docs/backend/auth-endpoints/#password-policy) para essas linhas. O servidor aceita apenas se você for um administrador; qualquer outra pessoa que importe usuários estará sujeita à política, e uma senha fraca interrompe a importação com `WEAK_PASSWORD`.

### Criando uma coleção a partir de um arquivo

Ao criar uma coleção a partir de um arquivo, o tipo de cada coluna é inferido a partir de seus valores. Uma coluna é considerada numérica somente se todos os valores nela forem números ou textos que se convertam exatamente em um número; portanto, uma coluna de CEPs/códigos postais, códigos de produto com zeros à esquerda, SKUs longos ou números de telefone permanece como texto. Uma coluna que mistura tipos (números e palavras, booleanos e números) é texto. Células em branco não contam, portanto uma coluna praticamente vazia não é marcada como obrigatória. Uma coluna de números inteiros cujo nome termina com uma palavra que indica que ela armazena um momento (`created_at`, `updatedAt`, `signup_date`, `timestamp`) é considerada uma data se todos os valores forem timestamps de época entre 2001 e 2103, em segundos ou milissegundos; sob qualquer outro nome ou com qualquer outro valor, ela permanece como número.

### Configuração de Importação

A importação está disponível em todas as coleções. Não há uma configuração por coleção para desativá-la.

## Exportando Dados

### Como Exportar

1. Abra uma coleção no painel de administração
2. Opcionalmente, aplique filtros para exportar um subconjunto de dados
3. Clique no botão **Export** na barra de ferramentas
4. Escolha o formato: **CSV** ou **JSON**
5. O download do arquivo é iniciado imediatamente

### Formatos de Exportação

| Formato | Descrição |
|---------|-----------|
| CSV | Valores separados por vírgula, compatíveis com Excel e Google Sheets |
| JSON | Array de objetos, útil para consumo programático |

### Filtrando Antes de Exportar

Quaisquer filtros ativos na visualização da coleção são aplicados à exportação. Isso permite exportar apenas um subconjunto dos seus dados:

- Aplique filtros de coluna ou termos de busca na visualização da coleção
- Clique em **Export** — apenas as linhas filtradas serão incluídas

### Configuração de Exportação

<span class="since-badge" data-since="0.31">A partir de 0.31</span>

A exportação está disponível em todas as coleções, a menos que você a desative. A propriedade `exportable` em `customizeTable` a configura: `exportable: false` remove o botão **Export**, e um `ExportConfig` a mantém e adiciona colunas computadas.

### Adicionando Campos Computados

<span class="since-badge" data-since="0.31">A partir de 0.31</span>

`additionalFields` adiciona colunas que não existem na tabela; cada uma é calculada no momento da exportação e pode ser assíncrona:

```tsx
// frontend/src/cms/products.tsx
import { customizeTable } from "@rebasepro/cms";
import type { products } from "../../../backend/schema/products";

export const productsCms = customizeTable<typeof products>("products", {
    exportable: {
        additionalFields: [
            {
                key: "computed_margin",
                builder: ({ row }) => String(Number(row.price ?? 0) - Number(row.cost ?? 0))
            },
            {
                key: "full_url",
                builder: ({ id }) => `https://mystore.com/products/${id}`
            },
            {
                key: "author_name",
                builder: async ({ row, context }) => {
                    const author = await context.data.users.findById(String(row.authorId));
                    // `context.data` returns the row itself: its columns are on it.
                    return String(author?.displayName ?? "Unknown");
                }
            }
        ]
    },
});
```

Cada entrada de `additionalFields` possui:

| Propriedade | Tipo | Descrição |
|-------------|------|-----------|
| `key` | `string` | Nome da coluna na exportação |
| `builder` | `({ row, id, context }) => string \| Promise<string>` | Função que computa o valor |

A função `builder` recebe cada registro exportado como `row`, no formato enviado pelo servidor (datas como strings ISO, um belongsTo como sua coluna de chave estrangeira), o `id` do registro ao lado (sua chave primária como string, ou as partes de uma chave composta unidas por `:::`), e o `RebaseContext` (que inclui o usuário autenticado), permitindo computar valores com base tanto nos dados quanto nas permissões.

## Próximos Passos

- **[Tabelas no CMS](/docs/collections)** — O que o painel exibe para cada tabela
- **[Visão Geral do Frontend](/docs/frontend)** — Painel de administração e componentes de interface
- **[SDK Tipado](/docs/sdk)** — Acesso programático a dados
