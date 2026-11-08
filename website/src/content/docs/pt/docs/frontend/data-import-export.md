---
sourceHash: 3c4991a6d78c115c
title: Importação e Exportação de Dados
sidebar_label: Importação e Exportação de Dados
description: Importe dados de arquivos CSV, JSON e Excel para suas coleções e exporte dados de coleções para CSV ou JSON com campos computados opcionais.
---

## Visão Geral

O Rebase inclui ferramentas integradas de importação e exportação de dados acessíveis diretamente a partir do painel de administração. A importação suporta arquivos CSV, JSON e Excel com um assistente de mapeamento de colunas. A exportação suporta CSV e JSON com campos computados opcionais.

Ambas estão disponíveis em todas as coleções. A exportação pode ser configurada por coleção com campos computados, ou desativada com `exportable: false`; a importação não pode ser desativada por coleção.

## Importando Dados

### Como Importar

1. Abra uma coleção no painel de administração
2. Clique no botão **Import** na barra de ferramentas
3. Selecione ou arraste e solte seu arquivo
4. Mapeie as colunas do arquivo para as propriedades da coleção
5. Pré-visualize os dados, incluindo quaisquer valores que não puderem ser convertidos
6. Clique em **Save data** para gravar as linhas

### Formatos Suportados

| Formato | Extensões | Notas |
|---------|-----------|-------|
| CSV | `.csv` | Detecta delimitadores automaticamente |
| JSON | `.json` | Espera um array de objetos |
| Excel | `.xlsx` | Lê a primeira planilha |

### Mapeamento de Colunas

O assistente de importação tenta automaticamente associar as colunas do arquivo às propriedades da coleção por nome. Você pode ajustar os mapeamentos manualmente antes de importar:

- **Correspondências exatas** são mapeadas automaticamente (ex.: `name` → `name`)
- **Colunas não correspondidas** podem ser mapeadas manualmente ou ignoradas
- **Conversão de tipo** transforma cada célula no tipo da propriedade para a qual está mapeada, mas somente quando nada é perdido (veja abaixo)

### Conversão de tipo

Uma célula só é convertida quando o tipo da propriedade pode conter exatamente o que ela representa:

| Tipo de propriedade | Converte | Não converte |
|---|---|---|
| Number | `12`, `-3.5`, `10.00`, `1e3` | `02134` (um zero à esquerda seria perdido), números com mais de 15 dígitos significativos, `1,234`, `$5.00`, `12%`, `N/A` |
| Boolean | `true`/`false`, `yes`/`no`, `y`/`n`, `1`/`0`, em qualquer combinação de maiúsculas/minúsculas | qualquer outra coisa |
| Date | ISO 8601 (`2024-01-05`, `2024-01-05T10:00:00Z`), datas por extenso (`5 Jan 2024`), `05/01/2024`, segundos ou milissegundos de época (epoch) | texto que não especifica uma data |
| Geopoint | o objeto que a exportação grava, `{"latitude": 41.9, "longitude": 12.5}`, ou seu JSON em uma célula CSV | qualquer outra coisa, ou uma coordenada fora do intervalo |
| Map without declared fields | um objeto, ou seu JSON em uma célula CSV | qualquer outra coisa |
| Vector | uma lista de números (`[0.1, 0.2]`, `0.1, 0.2`), ou o `{"value": [0.1, 0.2]}` da exportação | uma lista contendo qualquer coisa que não seja um número |

Uma data sem horário é considerada como aquele dia em UTC. Para datas escritas como `05/01/2024`, a coluna decide a ordem: um primeiro número superior a 12 faz a coluna adotar o dia primeiro; um segundo número superior a 12 faz adotar o mês primeiro. Quando uma coluna nunca define isso explicitamente, a localidade (locale) do navegador decide, e quando ela contém ambas as ordens, uma data que poderia ser lida em qualquer uma das ordens não é convertida.

Uma célula em branco é tratada como nenhum valor: ela não define nada, e o valor padrão que você escolheu para essa propriedade é aplicado.

Um arquivo exportado de uma coleção é importado novamente para os mesmos valores, seja CSV ou JSON. Um mapa (map) com campos declarados é lido com uma coluna por campo (`address.street`), da forma como a exportação o grava; qualquer outro valor, incluindo um geopoint ou um mapa chave-valor, é uma única coluna. Um número de época (epoch) entre -100.000.000.000 e 100.000.000.000 é lido como segundos, portanto uma data entre 31 de outubro de 1966 e 3 de março de 1973 exportada como timestamp não retorna corretamente: exporte essas datas como texto. Um campo de hora do dia (time-of-day) lê um número inferior a um dia (86.400.000) como os milissegundos desde a meia-noite gravados pela exportação.

### Valores que não podem ser importados

A pré-visualização lista todas as células que não são convertidas, por coluna, informando a quantidade existente e as primeiras ocorrências por linha e motivo. Essas células são deixadas vazias nas linhas importadas; nada é transformado em `0`, `false` ou um valor vazio sem ser listado. Volte para mapear a coluna para outra propriedade ou corrija o arquivo e faça o upload novamente.

As regras da própria coleção — campos obrigatórios, opções de enum, valores únicos — são verificadas pelo servidor à medida que as linhas são gravadas, em lotes de até 500 linhas (menos quando as linhas são extensas, para que a requisição permaneça abaixo de aproximadamente 1 MB). Um lote é salvo por inteiro ou não é salvo. Se uma linha for recusada, a importação é interrompida e a identifica; os lotes anteriores já estão salvos e a opção **Retry** retoma a partir da primeira linha do lote da linha recusada.

Uma linha cujo id já existe na coleção atualiza esse registro: as colunas presentes no arquivo são gravadas e as outras mantêm seus valores armazenados; portanto, um arquivo de `id,price` atualiza os preços de produtos existentes sem a necessidade de repetir seus campos obrigatórios. Uma nova linha ainda precisa de todos os campos obrigatórios. Um lote que mistura atualizações e novas linhas é gravado como duas requisições, de modo que uma nova linha recusada pode deixar as atualizações desse lote salvas; o **Retry** grava-as novamente com os mesmos valores.

### Importando usuários

Uma nova linha na coleção de usuários representa a criação de um usuário: a coluna `password` é convertida em hash, nunca armazenada como digitada, e uma linha sem ela recebe uma senha gerada ou um convite, assim como quando um administrador adiciona um usuário. As senhas nesse tipo de arquivo geralmente foram definidas sob as regras de outro sistema, portanto a importação solicita ao servidor para ignorar a [política de senhas](/docs/backend/auth-endpoints/#password-policy) para essas linhas. O servidor aceita apenas quando você é um administrador; qualquer outra pessoa que importe usuários estará sujeita à política, e uma senha fraca interrompe a importação com `WEAK_PASSWORD`.

### Criando uma coleção a partir de um arquivo

Quando você cria uma coleção a partir de um arquivo, o tipo de cada coluna é inferido a partir de seus valores. Uma coluna é considerada numérica apenas se todos os valores nela forem um número ou texto que se converta exatamente em um, de modo que uma coluna de CEPs, códigos de produtos com zeros à esquerda, SKUs longos ou números de telefone permanece como texto. Uma coluna que mistura tipos (números e palavras, booleanos e números) permanece como texto. Células em branco não contam, portanto uma coluna majoritariamente vazia não é marcada como obrigatória. Uma coluna de números inteiros cujo nome termine com uma palavra que indique um momento no tempo (`created_at`, `updatedAt`, `signup_date`, `timestamp`) torna-se uma data quando todos os valores são timestamps de época entre 2001 e 2103, em segundos ou milissegundos; com qualquer outro nome, ou com qualquer outro valor, ela permanece como número.

### Configuração de Importação

A importação está disponível em todas as coleções. Não há uma configuração por coleção para desativá-la.

## Exportando Dados

### Como Exportar

1. Abra uma coleção no painel de administração
2. Opcionalmente, aplique filtros para exportar um subconjunto de dados
3. Clique no botão **Export** na barra de ferramentas
4. Escolha o formato: **CSV** ou **JSON**
5. O download do arquivo inicia imediatamente

### Formatos de Exportação

| Formato | Descrição |
|---------|-----------|
| CSV | Valores separados por vírgula, compatível com Excel e Google Sheets |
| JSON | Array de objetos, útil para consumo programático |

### Filtrando Antes de Exportar

Quaisquer filtros ativos na visualização da coleção são aplicados à exportação. Isso permite exportar apenas um subconjunto dos seus dados:

- Aplique filtros de coluna ou termos de busca na visualização da coleção
- Clique em **Export** — apenas as linhas filtradas serão incluídas

### Configuração de Exportação

A exportação está disponível em todas as coleções, a menos que você a desative. `admin.exportable` a configura: `exportable: false` remove o botão **Export**, e um `ExportConfig` a mantém e adiciona colunas computadas, como visto abaixo.

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
                    builder: ({ row }) => {
                        const price = Number(row.price ?? 0);
                        const cost = Number(row.cost ?? 0);
                        return String(price - cost);
                    }
                },
                {
                    key: "full_url",
                    builder: ({ row }) => {
                        return `https://mystore.com/products/${String(row.id)}`;
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
| `builder` | `({ row, context }) => string \| Promise<string>` | Função que calcula o valor |

A função `builder` recebe cada registro exportado como `row`, no formato enviado pelo servidor (datas como strings ISO, um belongsTo como sua coluna de chave estrangeira, `id` incluído), e o `RebaseContext` (que inclui o usuário autenticado), permitindo calcular valores com base tanto nos dados quanto nas permissões.

### Campos Computados Assíncronos

A função `builder` pode ser assíncrona, o que é útil quando o valor computado requer uma consulta ao banco de dados ou uma chamada de API:

```typescript
exportable: {
    additionalFields: [
        {
            key: "author_name",
            builder: async ({ row, context }) => {
                const author = await context.data.users.findById(String(row.authorId));
                // `context.data` returns the row itself: its columns are on it.
                return String(author?.displayName ?? "Unknown");
            }
        }
    ]
}
```

## Próximos Passos

- **[Coleções](/docs/collections)** — Defina seu modelo de dados
- **[Visão Geral do Frontend](/docs/frontend)** — Painel de administração e componentes de interface
- **[Typed SDK](/docs/sdk)** — Acesso programático aos dados
