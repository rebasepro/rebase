---
sourceHash: 92f11ec9a842b6d9
title: Coleções
sidebar_label: Coleções
description: As coleções são o bloco de construção fundamental do Rebase — cada coleção é mapeada para uma tabela de banco de dados e define seu schema, relações, segurança e comportamento de UI.
---

## O que é uma Coleção?

Uma **coleção** é um objeto TypeScript que descreve uma tabela de banco de dados e como ela deve aparecer no Rebase CMS. Ela define:

- **Schema** — Propriedades (colunas), seus tipos e regras de validação
- **Relações** — Chaves estrangeiras, tabelas de junção e caminhos de junção (join paths)
- **Segurança** — Políticas de Row Level Security (RLS)
- **Hooks de ciclo de vida** — Callbacks para operações de criação, atualização e exclusão
- **Comportamento do CMS** — Modos de visualização, edição inline, visualizações de entidade, ações — tudo sob `admin`

## Declarando uma: `defineCollection`

Envolva o literal em `defineCollection`. Em tempo de execução, é a função identidade — ela retorna o objeto inalterado —, portanto, não custa nada. O que ela oferece é inferência: um parâmetro de tipo `const` captura as chaves de suas `properties` como tipos literais, e os campos em formato de chave do bloco `admin` são então verificados em relação a elas. Um nome que não seja uma de suas propriedades resulta em um **erro de compilação**, e não apenas uma sugestão ausente.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const products = defineCollection({
    name: "Products",
    slug: "products",
    table: "products",
    properties: {
        name: { name: "Name", type: "string" },
        price: { name: "Price", type: "number" }
    },
    admin: {
        display: { title: "name" },  // completion: "name" | "price"
        sort: ["price", "asc"],      // completion on the first element
        propertiesOrder: ["name", "price"]
    }
});
```

```typescript
    admin: {
        display: { title: "nmae" }
        //                ~~~~~~ Type '"nmae"' is not assignable to type
        //                       'PropertyPath<…>'. Did you mean '"name"'?
    }
```

Os campos verificados são `display`, `sort`, `propertiesOrder`, `listProperties`,
`previewProperties`, `orderProperty` e os filtros `defaultFilter`, `fixedFilter`
e `filterPresets`. Três formatos são aceitos além de uma chave de propriedade simples:

| Formato | Exemplo | Observações |
| --- | --- | --- |
| Caminho com ponto em um `map` | `"profile.displayName"` | A **raiz** deve ser uma propriedade real; o caminho abaixo dela não é verificado. Não é válido em `previewProperties` / `orderProperty`, que aceitam uma chave de nível superior. |
| Coluna de subcoleção (child-collection) | `"subcollection:orders"` | Apenas em `propertiesOrder` / `listProperties`. |
| Uma chave de `additionalFields` | `"score" as AdditionalFieldKey` | Apenas em `propertiesOrder` / `listProperties`. Requer o cast — veja abaixo. |

`AdditionalFieldDelegate.key` é uma `string` simples, portanto, o sistema de tipos não tem como saber quais chaves extras uma coleção declara. Em vez de reabrir esses campos para qualquer string, o cast torna a exceção explícita:

```typescript
import type { AdditionalFieldKey } from "@rebasepro/cms-types";

propertiesOrder: ["title", "score" as AdditionalFieldKey]
```

Importe-o de `@rebasepro/cms-types` em um projeto que possua um painel de administração — essa é a cópia que também realiza a checagem de tipos do bloco `admin`. Um projeto BaaS headless, que não possui bloco admin, importa a mesma função de `@rebasepro/common`.

Anotar o tipo diretamente ainda funciona e continua sendo verificado:

```typescript
import type { PostgresCollectionConfig } from "@rebasepro/types";

const products: PostgresCollectionConfig = {
    name: "Products",
    slug: "products",
    table: "products",
    properties: {
        name: { name: "Name", type: "string" }
    }
};
```

mas uma anotação apenas *valida a estrutura (shape)* — ela não consegue enxergar os nomes das suas propriedades, fazendo com que os campos de chave de `admin` voltem a aceitar qualquer string. Prefira `defineCollection`, a menos que precise nomear o tipo explicitamente.

:::note
`buildCollection` e `buildProperty` não existem mais. `buildCollection` é o `defineCollection` sem a inferência; `buildProperty` envolvia uma propriedade em um tipo que ela já possuía. Consulte o [changelog](/docs/changelog) para a migração de linha única.
:::

## Anatomia: o contrato e o painel

Um arquivo, dois públicos. Tudo com o que o *banco de dados e a API* se importam fica no nível superior; tudo o que o *painel de administração* renderiza fica dentro de `admin`.

```typescript
const posts = {
    // ── The backend reads these ──────────────────────────────
    slug: "posts",
    table: "posts",
    properties: { /* … */ },
    relations: [ /* … */ ],
    securityRules: [ /* … */ ],
    callbacks: { /* … */ },
    history: true,

    // ── The admin panel reads these ──────────────────────────
    admin: {
        icon: "FileText",
        listProperties: ["title", "status"],
        defaultViewMode: "table",
        entityViews: ["preview"]
    }
};
```

A divisão não é estética. É o que permite ao Rebase atuar como um backend por conta própria:

- Um projeto **BaaS ou headless** nunca escreve um bloco `admin`. Suas coleções — ou nenhuma coleção, já que o modo BaaS faz a introspecção do banco de dados — descrevem dados e autorização, nada mais. `@rebasepro/types` não contém código de UI, mantendo a árvore de dependências de um projeto headless restrita apenas ao servidor.
- O **backend nunca lê o conteúdo dentro do bloco**. Ele é descartado antes que uma coleção seja serializada para o endpoint de contrato ou para um pacote de build, e é excluído da versão do schema — portanto, alterar um ícone não marca todos os SDKs gerados como desatualizados.

### O bloco `admin` só existe se você instalar os tipos de admin

O `@rebasepro/types` não declara nenhum campo `admin` — nem em uma coleção, nem em uma propriedade. Em um projeto BaaS, escrever um é um **erro de tipo**. O `@rebasepro/cms-types` o adiciona de volta por meio de mesclagem de declarações (declaration merging), portanto, uma única linha por projeto o ativa:

```typescript no-verify
// config/cms.d.ts
/// <reference types="@rebasepro/cms-types" />
```

Depois disso, os tipos básicos do core passam a carregar um bloco totalmente tipado — um erro de digitação como `icoon` vira um erro, e você passa a ter autocompletar:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const posts = defineCollection({
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        title: { name: "Title", type: "string", admin: { multiline: true } }
    },
    admin: { icon: "FileText" }
});
```

<!-- docs-verify: ignore -->
Uma extensão (augmentation) se aplica a todo o *programa* TypeScript, e `config/` e `frontend/` são programas separados — razão pela qual a referência pertence ao pacote de configuração. Não existe um tipo wrapper `AdminCollectionConfig`: com o campo mesclado, `CollectionConfig` é o tipo usado para criação.

:::note[Por que um projeto BaaS não paga nada por isso]
Um tipo de propriedade em uma instalação BaaS não possui `Field`, `columnWidth` nem `hideFromCollection` — eles ficam em `AdminPropertyOptions` no pacote de administração. A garantia é verificada em código, não apenas prometida: `tests/e2e/baas-typecheck/src/admin_absent.ts` usa `@ts-expect-error` no `admin`, de modo que a compilação falhará se o campo voltar a ser gravável no core.
:::

### Migrando de uma coleção simples (flat)

Antes da versão 0.11, esses campos ficavam no nível superior. Para movê-los:

```bash
node tooling/scripts/codemod/collections-admin-block.mjs config/collections
```

Ele relata tudo o que não puder mover com segurança — principalmente itens de apresentação dentro de `relations[].overrides`, que exigem `overrides: { admin: { … } }` manualmente.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

export const productsCollection = defineCollection({
    slug: "products",              // URL path and API endpoint
    name: "Products",              // Display name (plural)
    singularName: "Product",       // Display name (singular)
    table: "products",            // PostgreSQL table name

    properties: {
        name: {
            type: "string",
            name: "Product Name",
            validation: { required: true }
        },
        price: {
            type: "number",
            name: "Price",
            validation: { required: true, min: 0 }
        },
        category: {
            type: "string",
            name: "Category",
            enum: [
                { id: "electronics", label: "Electronics", color: "blue" },
                { id: "clothing", label: "Clothing", color: "pink" },
                { id: "books", label: "Books", color: "orange" }
            ]
        },
        description: {
            type: "string",
            name: "Description",
            admin: { multiline: true }
        },
        active: {
            type: "boolean",
            name: "Active",
            defaultValue: true
        },
        createdAt: {
            type: "date",
            name: "Created At",
            autoValue: "on_create",
            admin: { readOnly: true }
        }
    },
    admin: {
        icon: "Package"               // Lucide icon name
    }
});

```

## Propriedades Principais

### Identificação

| Propriedade | Tipo | Descrição |
|----------|------|-------------|
| `slug` | `string` | **Obrigatório.** Identificador seguro para URLs. Usado na URL da UI de administração e no caminho da API REST (`/api/data/{slug}`). |
| `name` | `string` | **Obrigatório.** Nome de exibição (plural). Mostrado na navegação e nos cabeçalhos de página. |
| `singularName` | `string` | Nome de exibição para uma entidade individual. Usado em "Novo Produto", "Editar Produto", etc. |
| `description` | `string` | Uma frase sobre o que esta coleção armazena, exibida acima da lista. Markdown. |
| `table` | `string` | Nome da tabela no PostgreSQL. O padrão é `toSnakeCase(slug)` — defina-o apenas para desacoplar a URL da tabela, por exemplo, uma tabela existente `blog_posts` servida em `/posts`. |
| `admin.icon` | `string` | Um nome de ícone do [Lucide](https://lucide.dev/icons), por exemplo, `"FileText"`, `"ShoppingCart"`. Um elemento renderizado também funciona, mas o nome sobrevive à serialização, sendo o que o editor de esquemas grava de volta. |

### Schema

| Propriedade | Tipo | Descrição |
|----------|------|-------------|
| `properties` | `Properties` | **Obrigatório.** Mapeamento de chave de propriedade → definição de propriedade. Cada chave se torna uma coluna do banco de dados. |
| `relations` | `Relation[]` | Relações SQL — chaves estrangeiras, tabelas de junção. Consulte [Relações](/docs/collections/relations). |
| `securityRules` | `SecurityRule[]` | Políticas de Row Level Security (RLS). Consulte [Regras de Segurança](/docs/collections/security-rules). |
| `indexes` | `CollectionIndex[]` | Índices do Postgres que esta tabela precisa. Consulte [Índices](/docs/backend/indexes). |
| `search` | `SearchConfig` | Busca textual ranqueada (full-text search) sobre os campos especificados, incluindo conteúdo JSONB e arrays. Apenas Postgres. Consulte [Busca](/docs/backend/search). |
| `auth` | `boolean \| AuthCollectionConfig` | Marca a coleção como uma coleção de autenticação (gerenciamento de usuários, redefinição de senha, etc.) |
| `schema` | `string` | Schema do Postgres no qual a tabela reside — `"public"`, `"rebase"`, `"auth"`. O padrão é `"public"`. |
| `disableDefaultPolicies` | `boolean` | Remove as políticas básicas que o gerador injeta — um SELECT para admin/servidor e, em uma coleção de autenticação, leitura própria mais um controle de escrita restrito ao admin — assumindo total responsabilidade pelo RLS desta coleção. `false` por padrão. Consulte [Regras de Segurança](/docs/collections/security-rules). |
| `softDelete` | `boolean \| { field?: string }` | Transforma o `delete` em um timestamp e oculta as linhas marcadas de todas as leituras. `true` usa `deletedAt`; o formato de objeto renomeia o campo. A própria coleção deve declarar essa propriedade `date`. Apenas Postgres — consulte [Exclusão lógica (Soft delete)](/docs/collections/soft-delete) |
| `strictWrites` | `boolean` | Rejeita com código 400 qualquer escrita que especifique um campo não declarado por esta coleção. `true` por padrão. Defina como `false` apenas onde a coluna realmente existe e não está declarada — preenchida por um trigger ou inspecionada em vez de explicitamente descrita. |

### Configuração de UI

Tudo o que se segue vai dentro de `admin`.

| Propriedade | Tipo | Padrão | Descrição |
|----------|------|---------|-------------|
| `defaultViewMode` | `"list" \| "table" \| "cards" \| "kanban"` | `"list"` | Modo de visualização padrão |
| `enabledViews` | `ViewMode[]` | As quatro opções integradas mais todas as visualizações personalizadas declaradas (kanban apenas quando uma propriedade `enum` existir) | Quais modos de visualização estão disponíveis |
| `kanban` | `KanbanConfig` | — | Configuração de Kanban (propriedade de coluna). Sempre combine com `orderProperty` — consulte [Modos de Visualização](/docs/frontend/view-modes) |
| `orderProperty` | `string` | — | Chave da propriedade **string** que armazena a ordem de arrastar e soltar (drag-and-drop). Obrigatório para o funcionamento do quadro Kanban |
| `openEntityMode` | `"side_panel" \| "full_screen" \| "split" \| "dialog"` | Depende da visualização: `"split"` para lista, `"full_screen"` para tabela e cards, `"side_panel"` para kanban e visualizações customizadas | Como as entidades são abertas para edição |
| `sideDialogWidth` | `number \| string` | — | Largura do diálogo lateral |
| `inlineEditing` | `boolean` | `true` | Habilita a edição inline na visualização em planilha |
| `defaultSize` | `"xs" \| "s" \| "m" \| "l" \| "xl"` | `"m"` | Densidade padrão das visualizações de lista, tabela e cards (altura da linha da tabela) |
| `pagination` | `boolean \| number` | `true` (50) | Habilita paginação e/ou define o tamanho da página. `false` carrega todas as linhas; em desenvolvimento, o console exibe um aviso se houver mais de 10.000 linhas |
| `listProperties` | `string[]` | — | Propriedades a serem exibidas na visualização em lista |
| `propertiesOrder` | `string[]` | — | Ordem das colunas na visualização em tabela |
| `selectionEnabled` | `boolean` | `true` | Habilita a seleção de linhas |
| `hideFromNavigation` | `boolean` | `false` | Oculta da navegação na barra lateral |
| `defaultSelectedView` | `string \| function` | — | Visualização padrão ou subcoleção a ser aberta |

### Opções de Entidade

Dentro de `admin`, exceto `history`, que é um recurso do backend e permanece no nível superior.

| Propriedade | Tipo | Padrão | Descrição |
|----------|------|---------|-------------|
| `formAutoSave` | `boolean` | `false` | Salva automaticamente dois segundos após uma edição, assim que o formulário é validado. Um formulário de criação (New) não é salvo até que algo seja inserido. |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | `"manual_apply"` | Faz backup de alterações não salvas |
| `hideIdFromForm` | `boolean` | `false` | Oculta o ID da entidade no formulário |
| `hideIdFromCollection` | `boolean` | `false` | Oculta a coluna de ID na tabela |
| `includeJsonView` | `boolean` | `true` | Disponibiliza os valores brutos no inspetor de registros |
| `history` | `boolean` | `false` | Rastreia alterações no histórico da entidade |
| `alwaysApplyDefaultValues` | `boolean` | `false` | Quando um registro existente é aberto no formulário, preenche o `defaultValue` declarado de cada propriedade em valores que o registro deixou vazios (`null` ou ausentes), para que a próxima ação de salvar os grave |
| `previewProperties` | `string[]` | — | Propriedades a serem exibidas nas prévias de referência |
| `display` | `EntityDisplay` | — | O que preenche cada função de exibição — consulte [Exibição de entidade](#exibição-de-entidade) |

### Avançado

No nível superior, porque o backend as lê:

| Propriedade | Tipo | Descrição |
|----------|------|-------------|
| `callbacks` | `CollectionCallbacks` | Hooks de ciclo de vida (`beforeSave`, `afterSave`, `beforeDelete`, etc.) |
| `childCollections` | `() => CollectionConfig[]` | As coleções aninhadas sob uma entidade desta. Preenchido durante a normalização a partir do que o driver expressar — `subcollections` no Firestore, relação `hasMany` no Postgres — sendo um driver personalizado o único motivo para defini-lo manualmente |
| `dataSource` | `string` | Qual fonte de dados registrada dá suporte a esta coleção (padrão: a que não possui nome) |
| `engine` | `string` | A engine por trás dela — `"postgres"`, `"firestore"`, `"mongodb"`. Resolvido a partir de `dataSource`; defina-o apenas para sobrescrever |
| `databaseId` | `string` | Banco de dados ou schema dentro da engine |
| `metadata` | `Record<string, unknown>` | Qualquer informação que seu próprio código precise associar a uma coleção. O Rebase não a lê; ela permanece inalterada após a serialização |
| `ownerId` | `string` | **Apenas formulário de admin — não é imposto pela API ou pelo banco de dados.** O ID de usuário que o editor de coleções estampa em uma coleção criada por ele e exibe ao lado de seu nome. Nada no fluxo de requisições o consulta |

`subcollections` e `path` estão presentes apenas nas configurações de **bancos de dados de documentos** — `FirebaseCollectionConfig` e, para `path`, `MongoDBCollectionConfig`:

| Propriedade | Tipo | Descrição |
|----------|------|-------------|
| `subcollections` | `() => CollectionConfig[]` | **Apenas Firestore.** Coleções aninhadas sob cada documento. Uma coleção do Postgres expressa o mesmo conceito com uma [relação](/docs/collections/relations) `hasMany`, que é o que preenche `childCollections` |
| `path` | `string` | **Apenas Firestore e MongoDB.** O caminho ou nome da coleção na engine, quando diferir do slug |

E dentro de `admin`, porque apenas o painel os renderiza:

| Propriedade | Tipo | Descrição |
|----------|------|-------------|
| `admin.entityActions` | `EntityAction[]` | Ações personalizadas em entidades (arquivar, publicar, etc.) |
| `admin.Actions` | `ComponentRef<CollectionActionsProps>[]` | Componentes personalizados de ações na barra de ferramentas |
| `admin.entityViews` | `EntityCustomView[]` | Abas personalizadas na visualização de detalhes da entidade |
| `admin.additionalFields` | `AdditionalFieldDelegate[]` | Colunas computadas/virtuais |
| `admin.exportable` | `boolean \| ExportConfig` | Habilita a exportação de dados |
| `admin.components` | `CollectionComponentOverrideMap` | Substituições de componentes de UI com escopo de coleção |

Escrever qualquer um desses seis no nível superior resulta em um erro de inicialização (boot-time error), com uma mensagem indicando o nome da chave e para onde ela foi movida.

## Exibição de entidade

Cada superfície que exibe um registro renderiza algum subconjunto de seis funções: **título**, **subtítulo**, **imagem**, **status**, **data** e **tags**. Uma linha de lista é imagem + título + subtítulo + status + data, um card é o mesmo com a imagem no topo, um seletor de referência é título + subtítulo, e o cabeçalho de uma página é apenas o título.

Cada função é derivada de suas propriedades, e cada uma pode ser especificada alternativamente — como um caminho de propriedade (property path) ou como uma função:

```typescript
const exercises = defineCollection({
    name: "Exercises",
    slug: "exercises",
    table: "exercises",
    properties: {
        name: { name: "Name", type: "string" },
        cover: { name: "Cover", type: "string", storage: { storagePath: "covers/" } },
        city: { name: "City", type: "string" }
    },
    admin: {
        display: {
            title: "name",                                  // a property path
            image: "cover",
            subtitle: ({ row }) => `in ${String(row.city)}`        // computed
        }
    }
});
```

Tudo o que você omitir mantém seu valor derivado, portanto definir uma função não significa ter que definir todas as seis.

Um resolver recebe `{ row, id, context }`. `row` é o registro como o servidor o envia, o mesmo formato retornado por `useRows` e `context.data`: datas como strings ISO, um belongsTo como sua coluna de chave estrangeira (`authorId`), e `id` apenas onde a tabela possui essa coluna. `id` é o id do registro ao lado dele: sua chave primária como string, com as partes de uma chave composta unidas por `:::`. Uma relação carregada pelo admin chega aninhada sob seu nome, assim como retornado pelo `include` do REST — `row.author` é a linha do autor, contendo apenas suas próprias colunas, ao lado de `authorId` — portanto, um resolver lê o campo de um registro relacionado sem precisar fazer uma nova requisição por conta própria:

```typescript
admin: {
    display: {
        // Undefined where the row holds only the author's id.
        subtitle: ({ row }) => typeof row.author === "object" && row.author !== null && "name" in row.author
            ? String(row.author.name)
            : undefined
    }
}
```

### Funções computadas e assíncronas

Um resolver pode ser `async`, o que permite que uma função leia algo que o registro não contém — um documento em uma subcoleção, um valor em uma API externa:

```typescript
admin: {
    display: {
        // The exercise's name lives one document down, per locale.
        title: async ({ id, context }) => {
            const locale = await context.data.exercise_locales.findById(`${id}/de-DE`);
            return locale?.exercise_title;
        }
    }
}
```

Enquanto a promise está pendente, a interface exibe o valor derivado e o substitui pelo resolvido assim que ele chega — um título nunca exibe um spinner. Os resultados são mantidos em cache por registro e por função, e requisições simultâneas para o mesmo par compartilham a mesma chamada, garantindo que uma lista de cinquenta linhas resolva cada linha apenas uma vez, em vez de uma vez a cada renderização.

Retorne `undefined` quando um registro não tiver nada para a função; o fallback da própria interface está mais bem informado sobre o que deve ser colocado ali (um cabeçalho usa o nome singular da coleção, um link usa o id). Um resolver que lança um erro é tratado como `undefined` e registrado em log uma única vez — um título que não pôde ser buscado não deve quebrar a linha que o exibe.

Prefira um caminho (path) sempre que o valor estiver no registro: um caminho preserva a renderização nativa da propriedade, de modo que um status enum continua sendo uma tag colorida e uma data permanece formatada, algo que um resolver retornando uma string simples não consegue expressar.

:::note[`titleProperty` substituído]
`admin.titleProperty` foi removido em favor de `admin.display.title`. A mesma string funciona nele, e o novo campo também aceita um resolver. Uma coleção que ainda contenha a chave antiga será rejeitada pelo `defineCollection` com o erro habitual de chave desconhecida.
:::

### Seleção da Propriedade de Título
Quando `display.title` não está definido, a propriedade usada como o título de exibição da entidade (prévias, cabeçalhos) é resolvida automaticamente:
1. Se `propertiesOrder` for explicitamente definido, a primeira propriedade nessa ordem que puder ser um título será escolhida: uma `string`, uma `relation` de cardinalidade única ou uma `reference`. Identificadores (chaves primárias e estrangeiras, colunas `uuid`, `isId`), campos de upload de arquivo e propriedades ocultas nunca se qualificam.
2. Se nenhum `propertiesOrder` for definido, os mesmos candidatos são classificados: uma string cuja chave seja um rótulo (`name`, `title`, `label`, …) primeiro, depois texto simples e curto, um e-mail, um enum, texto longo, um seletor de relação ou usuário e, por último, uma referência. Empates são decididos pela ordem de declaração.

### Prévias de Relações em Tabelas
Quando `propertiesOrder` é explicitamente definido, propriedades de relação **não** são filtradas automaticamente das colunas de prévia padrão (ao passo que são excluídas dos padrões não ordenados para evitar operações de join lentas).

### Como o valor do título é renderizado
Independentemente do que a propriedade de título armazene, o painel renderiza uma string. Uma data é formatada, um array é concatenado (joined), e uma relação — que chega como `{ id, data: { values } }` em vez de texto — é inspecionada procurando a primeira propriedade entre `name`, `title`, `label` ou `displayName` na linha relacionada, depois pelo seu primeiro valor de string curta, recorrendo ao seu id em último caso. Assim, um título pode apontar para uma propriedade `relation` e ainda ser exibido como um nome em vez de um uuid.

Este não é um helper exportado: é o comportamento padrão de todas as superfícies que exibem um registro. Não há nada para chamar nem nada para importar.

## Collection Builder

Para coleções dinâmicas que mudam com base no usuário ou em dados externos, use uma função builder:

```typescript
const collectionsBuilder: CollectionConfigsBuilder = ({ user, authController }) => {
    const collections = [productsCollection];

    // `extra` is whatever your auth provider put there, so name its shape here.
    const extra = authController.extra as { role?: string };
    if (extra.role === "admin") {
        collections.push(adminSettingsCollection);
    }

    return collections;
};
```

O builder também recebe `data`, que lê as linhas da mesma forma que o servidor as envia, idêntico a `context.data`: `await data.collection("tenants").find()` resolve para `{ data: rows, meta }`.

## Filtragem e Ordenação

Você pode definir filtros padrão ou forçados. Todos os três são de apresentação — com o que o painel é aberto — portanto residem em `admin`:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const invoices = defineCollection({
    slug: "invoices",
    name: "Invoices",
    table: "invoices",
    properties: {
        active: { name: "Active", type: "boolean" },
        tenantId: { name: "Tenant", type: "string" },
        createdAt: { name: "Created", type: "date" }
    },
    admin: {
        // Default filter — users can change it
        defaultFilter: { active: ["==", true] },

        // Fixed filter — cannot be changed; filters the user applies
        // on other fields combine with it
        fixedFilter: { tenantId: ["==", currentTenantId] },

        // Default sort
        sort: ["createdAt", "desc"]
    }
});
```

O usuário ainda pode filtrar uma coleção que possua um `fixedFilter`: o que ele aplicar em outros campos é combinado com ele (AND), e os campos fixos permanecem bloqueados.

Um `fixedFilter` restringe o que o painel *solicita*; ele não é uma fronteira de segurança. O que um chamador tem permissão para ler é uma [regra de segurança](/docs/collections/security-rules), que o banco de dados impõe para qualquer chamador, seja o painel ou não.

## Muitas coleções

Nada no Rebase limita o número de coleções, mas dois custos aumentam com isso:

- **O primeiro download do admin.** O painel precisa de sua navegação no momento em que alguém faz login, de modo que a configuração de cada coleção é empacotada no que o navegador busca para a tela de login — cerca de 2,4 KB minificados cada, portanto 200 coleções adicionam aproximadamente 480 KB, cerca de 80 KB com gzip. O que a abertura de uma coleção exige (a tabela, as visualizações de registro, o formulário) só é carregado nesse momento.
- **`rebase db push`.** O Atlas planeja um push calculando a diferença (diff) de todo o schema, e isso cresce mais rápido do que a contagem de tabelas: com 400 ou mais tabelas, um push leva dezenas de segundos — consulte [quanto tempo um push leva](/docs/cli/schema#rebase-db-push).

## Próximos Passos

- **[Callbacks de Entidade](/docs/collections/callbacks)** — Hooks de ciclo de vida para sincronizar dados entre coleções, validação e efeitos colaterais
- **[Propriedades](/docs/collections/properties)** — Todos os tipos e opções de propriedades
- **[Relações](/docs/collections/relations)** — Chaves estrangeiras, tabelas de junção, joins
- **[Regras de Segurança](/docs/collections/security-rules)** — Row Level Security
- **[Modos de Visualização](/docs/frontend/view-modes)** — Lista, Tabela, Cards, Kanban
