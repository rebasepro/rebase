---
sourceHash: 6f0489ae490ff4b1
title: Coleções
sidebar_label: Coleções
description: As coleções são o bloco de construção fundamental do Rebase — cada coleção mapeia para uma tabela do banco de dados e define seu schema, relações, segurança e comportamento de UI.
---

## O que é uma Coleção?

Uma **coleção** (collection) é um objeto TypeScript que descreve uma tabela do banco de dados e como ela deve aparecer no Rebase CMS. Ela define:

- **Schema** — Propriedades (colunas), seus tipos e regras de validação
- **Relações** — Chaves estrangeiras, tabelas de junção e caminhos de junção (joins)
- **Segurança** — Políticas de Row Level Security (segurança em nível de linha)
- **Ganchos de ciclo de vida (lifecycle hooks)** — Callbacks para operações de criação, atualização e exclusão
- **Comportamento no CMS** — Modos de visualização, edição em linha, visualizações de entidade, ações — tudo sob `admin`

## Declarando uma: `defineCollection`

Envolva o literal em `defineCollection`. Em tempo de execução, ela é a função identidade — retorna o objeto inalterado —, portanto não tem custo de desempenho. O que ela oferece é inferência: um parâmetro de tipo `const` captura as chaves de `properties` como tipos literais, e os campos em formato de chave do bloco `admin` são então verificados em relação a elas. Um nome que não seja uma das suas propriedades resulta em um **erro de compilação**, e não apenas em uma sugestão ausente.

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

| Formato | Exemplo | Notas |
| --- | --- | --- |
| Caminho com ponto dentro de um `map` | `"profile.displayName"` | A **raiz** deve ser uma propriedade real; o caminho abaixo dela não é verificado. Não é válido em `previewProperties` / `orderProperty`, que aceitam apenas uma chave de nível superior. |
| Coluna de subcoleção filha | `"subcollection:orders"` | Apenas para `propertiesOrder` / `listProperties`. |
| Uma chave de `additionalFields` | `"score" as AdditionalFieldKey` | Apenas para `propertiesOrder` / `listProperties`. Exige o type cast — veja abaixo. |

`AdditionalFieldDelegate.key` é uma `string` comum, de modo que o sistema de tipos não tem como saber quais chaves extras uma coleção declara. Em vez de reabrir esses campos para qualquer string arbitrária, o cast torna a exceção explícita:

```typescript
import type { AdditionalFieldKey } from "@rebasepro/cms-types";

propertiesOrder: ["title", "score" as AdditionalFieldKey]
```

Importe-a de `@rebasepro/cms-types` em um projeto que possua um painel de administração — essa é a versão que também faz a checagem de tipos do bloco `admin`. Um projeto BaaS headless, que não tem bloco admin, importa a mesma função de `@rebasepro/common`.

Anotar o tipo diretamente ainda funciona e continua sendo checado:

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

mas uma anotação apenas *valida a estrutura* — ela não consegue enxergar os nomes das suas propriedades, fazendo com que os campos de chave do `admin` passem a aceitar qualquer string. Dê preferência a `defineCollection`, a menos que precise nomear o tipo explicitamente.

:::note
`buildCollection` e `buildProperty` não existem mais. `buildCollection` é o `defineCollection` sem a inferência; `buildProperty` envolvia uma propriedade em um tipo que ela já possuía. Consulte o [changelog](/docs/changelog) para a migração de apenas uma linha.
:::

## Anatomia: o contrato e o painel

Um único arquivo, dois públicos. Tudo o que importa para o *banco de dados e a API* fica no nível superior; tudo o que o *painel de administração* renderiza fica dentro de `admin`.

```typescript
const posts = {
    // ── O backend lê estas propriedades ──────────────────────
    slug: "posts",
    table: "posts",
    properties: { /* … */ },
    relations: [ /* … */ ],
    securityRules: [ /* … */ ],
    callbacks: { /* … */ },
    history: true,

    // ── O painel de administração lê estas propriedades ──────
    admin: {
        icon: "FileText",
        listProperties: ["title", "status"],
        defaultViewMode: "table",
        entityViews: ["preview"]
    }
};
```

Essa separação não é meramente estética. É o que permite ao Rebase funcionar como um backend autônomo:

- Um projeto **BaaS ou headless** nunca escreve um bloco `admin`. Suas coleções — ou coleção nenhuma, já que o modo BaaS faz a introspecção do banco de dados — descrevem dados e autorização, nada mais. `@rebasepro/types` não inclui código de interface, mantendo a árvore de dependências de um projeto headless restrita apenas ao servidor.
- O **backend nunca lê o conteúdo dentro do bloco**. Ele é descartado antes que uma coleção seja serializada para o endpoint de contrato ou para um bundle de build, e é excluído da versão do schema — portanto, alterar um ícone não invalida todos os SDKs gerados.

### O bloco `admin` só existe se você instalar os tipos de admin

`@rebasepro/types` não declara nenhum campo `admin` — nem em uma coleção, nem em uma propriedade. Em um projeto BaaS, escrever um campo desses gera um **erro de tipo**. O pacote `@rebasepro/cms-types` o adiciona de volta por meio de mesclagem de declarações (declaration merging), exigindo apenas uma linha por projeto para ativá-lo:

```typescript no-verify
// config/cms.d.ts
/// <reference types="@rebasepro/cms-types" />
```

Depois disso, os tipos do core passam a suportar um bloco totalmente tipado — um erro de digitação como `icoon` resulta em erro, e você obtém autocompletar:

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
Uma declaração de ampliação (augmentation) se aplica a todo o *programa* TypeScript, e `config/` e `frontend/` são programas separados — e é por isso que a referência deve ficar no pacote de configuração. Não existe um tipo wrapper `AdminCollectionConfig`: com o campo mesclado, `CollectionConfig` é o tipo principal de criação.

:::note[Por que um projeto BaaS não tem sobrecarga]
O tipo de uma propriedade em uma instalação BaaS não possui `Field`, `columnWidth` nem `hideFromCollection` — esses residem em `AdminPropertyOptions` no pacote admin. Essa garantia é verificada em testes, não apenas declarada: `tests/e2e/baas-typecheck/src/admin_absent.ts` utiliza `@ts-expect-error` em `admin`, garantindo que a build falhe caso o campo volte a ser aceito no core.
:::

### Migrando de uma coleção simples (flat)

Antes da versão 0.11, esses campos ficavam no nível superior. Para movê-los:

```bash
node tooling/scripts/codemod/collections-admin-block.mjs config/collections
```

O script relata qualquer item que não possa mover com segurança — principalmente opções visuais dentro de `relations[].overrides`, que exigem `overrides: { admin: { … } }` manualmente.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

export const productsCollection = defineCollection({
    slug: "products",              // Caminho de URL e endpoint de API
    name: "Products",              // Nome de exibição (plural)
    singularName: "Product",       // Nome de exibição (singular)
    table: "products",            // Nome da tabela PostgreSQL

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
        icon: "Package"               // Nome do ícone Lucide
    }
});

```

## Propriedades Principais

### Identificação

| Propriedade | Tipo | Descrição |
|----------|------|-------------|
| `slug` | `string` | **Obrigatório.** Identificador seguro para URLs. Usado na URL da UI de administração e no caminho da REST API (`/api/data/{slug}`). |
| `name` | `string` | **Obrigatório.** Nome de exibição (plural). Exibido na navegação e nos cabeçalhos das páginas. |
| `singularName` | `string` | Nome de exibição para uma entidade individual. Usado em "Novo Produto", "Editar Produto", etc. |
| `description` | `string` | Uma frase sobre o conteúdo desta coleção, exibida acima da listagem. Suporta Markdown. |
| `table` | `string` | Nome da tabela no PostgreSQL. O padrão é `toSnakeCase(slug)` — defina-o apenas para desacoplar a URL da tabela, como uma tabela existente `blog_posts` servida em `/posts`. |
| `admin.icon` | `string` | Um nome de ícone do [Lucide](https://lucide.dev/icons), ex.: `"FileText"`, `"ShoppingCart"`. Um elemento renderizado também funciona, mas o nome resiste à serialização, sendo o que o editor de schemas grava de volta. |

### Schema

| Propriedade | Tipo | Descrição |
|----------|------|-------------|
| `properties` | `Properties` | **Obrigatório.** Mapa de chave de propriedade → definição da propriedade. Cada chave vira uma coluna no banco de dados. |
| `relations` | `Relation[]` | Relações SQL — chaves estrangeiras, tabelas de junção. Veja [Relações](/docs/collections/relations). |
| `securityRules` | `SecurityRule[]` | Políticas de Row Level Security. Veja [Regras de Segurança](/docs/collections/security-rules). |
| `indexes` | `CollectionIndex[]` | Índices do Postgres que esta tabela precisa. Veja [Índices](/docs/backend/indexes). |
| `search` | `SearchConfig` | Busca textual ranqueada (full-text search) sobre os campos especificados, incluindo conteúdo JSONB e arrays. Apenas Postgres. Veja [Busca](/docs/backend/search). |
| `auth` | `boolean \| AuthCollectionConfig` | Marca a coleção como de autenticação (gerenciamento de usuários, redefinição de senha, etc.). |
| `schema` | `string` | Schema do Postgres onde a tabela reside — `"public"`, `"rebase"`, `"auth"`. O padrão é `"public"`. |
| `disableDefaultPolicies` | `boolean` | Remove as políticas básicas injetadas pelo gerador — um SELECT de admin/servidor e, em coleções de auth, leitura própria mais um controle de escrita restrito a admins — assumindo total responsabilidade pelo RLS desta coleção. O padrão é `false`. Veja [Regras de Segurança](/docs/collections/security-rules). |
| `softDelete` | `boolean \| { field?: string }` | Converte operações de `delete` em um timestamp e oculta as linhas marcadas de todas as leituras. `true` usa `deletedAt`; o formato de objeto renomeia o campo. A própria coleção deve declarar essa propriedade `date`. Apenas Postgres — veja [Soft delete](/docs/collections/soft-delete). |
| `strictWrites` | `boolean` | Rejeita gravações que mencionem campos não declarados nesta coleção com erro 400. O padrão é `true`. Defina como `false` apenas se a coluna realmente existir e não estiver declarada — como campos preenchidos por gatilhos (triggers) ou identificados por introspecção em vez de definidos no código. |

### Configuração de UI

Todas as propriedades a seguir ficam dentro de `admin`.

| Propriedade | Tipo | Padrão | Descrição |
|----------|------|---------|-------------|
| `defaultViewMode` | `"list" \| "table" \| "cards" \| "kanban"` | `"list"` | Modo de visualização padrão |
| `enabledViews` | `ViewMode[]` | Os quatro modos integrados mais qualquer visualização customizada declarada (kanban apenas quando existir uma propriedade `enum`) | Quais modos de visualização estão disponíveis |
| `kanban` | `KanbanConfig` | — | Configuração de Kanban (propriedade de coluna). Sempre combine com `orderProperty` — veja [Modos de Visualização](/docs/frontend/view-modes) |
| `orderProperty` | `string` | — | Chave da propriedade **string** que armazena a ordem de arrastar e soltar (drag-and-drop). Necessária para o funcionamento do quadro Kanban |
| `openEntityMode` | `"side_panel" \| "full_screen" \| "split" \| "dialog"` | Definido pela visualização: `"split"` para list, `"full_screen"` para table e cards, `"side_panel"` para kanban e visualizações personalizadas | Como as entidades abrem para edição |
| `sideDialogWidth` | `number \| string` | — | Largura do diálogo lateral |
| `inlineEditing` | `boolean` | `true` | Habilita edição em linha na visualização de planilha |
| `defaultSize` | `"xs" \| "s" \| "m" \| "l" \| "xl"` | `"m"` | Densidade padrão das visualizações em lista, tabela e cartões (altura da linha da tabela) |
| `pagination` | `boolean \| number` | `true` (50) | Habilita a paginação e/ou define o tamanho da página. `false` carrega todas as linhas; em desenvolvimento, o console exibe um aviso quando houver mais de 10.000 linhas |
| `listProperties` | `string[]` | — | Propriedades a serem exibidas na visualização de lista |
| `propertiesOrder` | `string[]` | — | Ordem das colunas na visualização de tabela |
| `selectionEnabled` | `boolean` | `true` | Habilita a seleção de linhas |
| `hideFromNavigation` | `boolean` | `false` | Oculta da barra de navegação lateral |
| `defaultSelectedView` | `string \| function` | — | Visualização padrão ou subcoleção a ser aberta |

### Opções da Entidade

Dentro de `admin`, exceto `history`, que é um recurso de backend e permanece no nível superior.

| Propriedade | Tipo | Padrão | Descrição |
|----------|------|---------|-------------|
| `formAutoSave` | `boolean` | `false` | Salva automaticamente dois segundos após uma edição, assim que o formulário for validado. Um formulário de criação (Novo) não é salvo até que algo seja inserido. |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | `"manual_apply"` | Faz backup de alterações não salvas |
| `hideIdFromForm` | `boolean` | `false` | Oculta o ID da entidade no formulário |
| `hideIdFromCollection` | `boolean` | `false` | Oculta a coluna de ID na tabela |
| `includeJsonView` | `boolean` | `true` | Oferece a visualização dos valores brutos no inspetor de registros |
| `history` | `boolean` | `false` | Rastreia alterações no histórico da entidade |
| `alwaysApplyDefaultValues` | `boolean` | `false` | Quando um registro existente é aberto no formulário, preenche o `defaultValue` declarado de cada propriedade em campos que o registro deixa vazios (`null` ou ausente), gravando-o no próximo salvamento |
| `previewProperties` | `string[]` | — | Propriedades a serem exibidas nas pré-visualizações de referência |
| `display` | `EntityDisplay` | — | Define o que preenche cada papel visual — veja [Exibição da Entidade](#exibição-da-entidade) |

### Avançado

No nível superior, pois são lidas pelo backend:

| Propriedade | Tipo | Descrição |
|----------|------|-------------|
| `callbacks` | `CollectionCallbacks` | Ganchos de ciclo de vida (`beforeSave`, `afterSave`, `beforeDelete`, etc.) |
| `childCollections` | `() => CollectionConfig[]` | As coleções aninhadas sob uma entidade desta. Preenchido durante a normalização pelo que o driver expressa — `subcollections` no Firestore, uma relação `hasMany` no Postgres — sendo um driver customizado a única razão para defini-lo manualmente |
| `dataSource` | `string` | Qual fonte de dados registrada atende a esta coleção (padrão: a não nomeada) |
| `engine` | `string` | O mecanismo subjacente — `"postgres"`, `"firestore"`, `"mongodb"`. Resolvido a partir de `dataSource`; defina apenas para sobrescrever |
| `databaseId` | `string` | Banco de dados ou schema dentro do mecanismo |
| `metadata` | `Record<string, unknown>` | Qualquer informação necessária para seu próprio código associada à coleção. O Rebase não a lê; o dado resiste inalterado à serialização |
| `ownerId` | `string` | **Apenas para o formulário de administração — não imposto pela API ou banco de dados.** O ID do usuário que o editor de coleções vincula a uma coleção criada, sendo mostrado ao lado do nome. Nenhuma etapa no fluxo da requisição o consulta |

`subcollections` e `path` estão presentes apenas nas configurações de **bancos de dados baseados em documentos** — `FirebaseCollectionConfig` e, para `path`, `MongoDBCollectionConfig`:

| Propriedade | Tipo | Descrição |
|----------|------|-------------|
| `subcollections` | `() => CollectionConfig[]` | **Apenas Firestore.** Coleções aninhadas sob cada documento. Uma coleção do Postgres expressa o mesmo comportamento com uma [relação](/docs/collections/relations) `hasMany`, que é o que preenche `childCollections` |
| `path` | `string` | **Apenas Firestore e MongoDB.** O caminho ou nome da coleção no mecanismo, quando diferente do slug |

E dentro de `admin`, pois são renderizadas apenas pelo painel:

| Propriedade | Tipo | Descrição |
|----------|------|-------------|
| `admin.entityActions` | `EntityAction[]` | Ações customizadas em entidades (arquivar, publicar, etc.) |
| `admin.Actions` | `ComponentRef<CollectionActionsProps>[]` | Componentes de ações customizadas na barra de ferramentas |
| `admin.entityViews` | `EntityCustomView[]` | Abas customizadas na visualização detalhada da entidade |
| `admin.additionalFields` | `AdditionalFieldDelegate[]` | Colunas virtuais/computadas |
| `admin.exportable` | `boolean \| ExportConfig` | Habilita a exportação de dados |
| `admin.components` | `CollectionComponentOverrideMap` | Sobrescritas de componentes de UI com escopo de coleção |

Escrever qualquer uma dessas seis propriedades no nível superior gera um erro na inicialização, com uma mensagem indicando a chave e para onde ela foi movida.

## Exibição da Entidade

Toda superfície que renderiza um registro exibe algum subconjunto de seis papéis visuais: **title** (título), **subtitle** (subtítulo), **image** (imagem), **status**, **date** (data) e **tags**. Uma linha de lista exibe imagem + título + subtítulo + status + data; um cartão exibe o mesmo, com a imagem no topo; um seletor de referências exibe título + subtítulo; e o cabeçalho de uma página exibe apenas o título.

Cada papel visual é derivado das suas propriedades e pode ser declarado explicitamente — como um caminho de propriedade ou como uma função:

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

Tudo o que você omitir mantém seu valor derivado automaticamente; definir um papel não obriga você a declarar todos os seis.

O resolver recebe `{ row, context }`. `row` é o registro exatamente como enviado pelo servidor — no mesmo formato retornado por `useRows` e `context.data`: datas como strings ISO, uma relação belongsTo representada por sua coluna de chave estrangeira (`authorId`) e o campo `id` incluído. Relações carregadas pelo admin chegam aninhadas sob seu nome, assim como o parâmetro `include` do REST retorna — `row.author` é a linha do autor, ao lado de `authorId` — permitindo que o resolver leia o campo de um registro relacionado sem fazer requisições extras:

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

### Papéis computados e assíncronos

Um resolver pode ser `async`, o que permite a um papel visual ler algo que o registro não contém — um documento em uma subcoleção ou um valor vindo de uma API externa:

```typescript
admin: {
    display: {
        // The exercise's name lives one document down, per locale.
        title: async ({ row, context }) => {
            const locale = await context.data.exercise_locales.findById(`${String(row.id)}/de-DE`);
            return locale?.exercise_title;
        }
    }
}
```

Enquanto a promise está em andamento, a interface exibe o valor derivado e o substitui pelo valor resolvido assim que estiver pronto — o título nunca exibe um indicador de carregamento (spinner). Os resultados são armazenados em cache por registro e por papel visual, e chamadas concorrentes para o mesmo par compartilham uma única requisição. Dessa forma, uma lista de cinquenta linhas resolve cada linha apenas uma vez, em vez de uma vez por renderização.

Retorne `undefined` quando um registro não tiver valor para o papel correspondente; a própria interface possui fallbacks mais adequados para exibir (um cabeçalho usará o nome singular da coleção, um link usará o id). Se um resolver lançar um erro, ele será tratado como `undefined` e registrado no log uma única vez — uma falha ao buscar um título não deve quebrar a renderização da linha.

Prefira um caminho de propriedade sempre que o valor já estiver no registro: o caminho preserva a renderização nativa da propriedade, garantindo que um enum de status permaneça como uma etiqueta colorida e uma data continue formatada, algo que um resolver retornando uma string simples não consegue expressar.

:::note[`titleProperty` substituído]
`admin.titleProperty` foi descontinuado em favor de `admin.display.title`. A mesma string funciona nele, e o novo campo também aceita um resolver. Uma coleção que ainda utilize a chave antiga será rejeitada por `defineCollection` com o erro padrão de chave desconhecida.
:::

### Seleção da Propriedade de Título
Quando `display.title` não estiver configurado, a propriedade usada como título de exibição da entidade (em pré-visualizações e cabeçalhos) é determinada automaticamente:
1. Se `propertiesOrder` estiver definido explicitamente, a primeira propriedade nessa ordem capaz de atuar como título será escolhida: uma `string`, uma `relation` de cardinalidade única ou uma `reference`. Identificadores (chaves primárias e estrangeiras, colunas `uuid`, `isId`), campos de upload de arquivos e propriedades ocultas nunca se qualificam.
2. Se `propertiesOrder` não estiver definido, os mesmos candidatos são classificados por relevância: uma string cuja chave nomeie um rótulo (`name`, `title`, `label`, …) vem primeiro, seguida por texto curto simples, e-mail, enum, texto longo, seletor de usuário ou relação e, por último, uma referência. Em caso de empate, prevalece a ordem de declaração.

### Pré-visualizações de Relações em Tabelas
Quando `propertiesOrder` é configurado explicitamente, propriedades de relação **não** são filtradas automaticamente das colunas de pré-visualização padrão (enquanto são excluídas das configurações padrão não ordenadas para evitar operações lentas de join).

### Como o valor de um título é renderizado
Independentemente do tipo armazenado na propriedade de título, o painel renderiza uma string. Uma data é formatada, um array é concatenado e uma relação — que chega como `{ id, data: { values } }` e não como texto — é inspecionada em busca da primeira propriedade entre `name`, `title`, `label` ou `displayName` na linha relacionada; em seguida, busca seu primeiro valor de texto curto, recorrendo ao seu id em último caso. Assim, um título pode apontar para uma propriedade `relation` e ainda ser exibido como um nome amigável em vez de um UUID.

Isso não é um helper exportado: é o comportamento nativo de todas as superfícies que desenham um registro. Não há nada a chamar e nada a importar.

## Collection Builder

Para coleções dinâmicas que variam conforme o usuário ou dados externos, use uma função builder:

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

Você pode configurar filtros padrão ou fixos. Todos pertencem à apresentação visual — o estado inicial de abertura do painel — e, portanto, ficam em `admin`:

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

O usuário ainda pode filtrar uma coleção que possua um `fixedFilter`: quaisquer filtros aplicados em outros campos são combinados com ele (AND), e os campos fixos permanecem bloqueados.

Um `fixedFilter` apenas restringe o que o painel *requisita*; ele não serve como barreira de segurança. O que um cliente tem permissão para ler é determinado por uma [regra de segurança](/docs/collections/security-rules), que o banco de dados impõe para qualquer chamada, seja ela do painel ou não.

## Muitas coleções

Não há limites no Rebase quanto ao número de coleções, mas dois custos aumentam proporcionalmente:

- **O download inicial da interface administrativa.** O painel precisa de sua navegação no momento em que alguém faz login, de modo que a configuração de cada coleção é empacotada no que o navegador busca para a tela de autenticação — cerca de 2,4 KB minificados por coleção, o que significa que 200 coleções acrescentam aproximadamente 480 KB (cerca de 80 KB com gzip). O que a abertura de uma coleção necessita (a tabela, as visualizações de registros, o formulário) só é carregado sob demanda.
- **`rebase db push`.** O Atlas planeja o push calculando a diferença de todo o schema, e esse processo escala de forma mais rápida do que a contagem de tabelas: com 400 ou mais tabelas, um push leva dezenas de segundos — veja [quanto tempo leva um push](/docs/cli/schema#rebase-db-push).

## Próximos Passos

- **[Entity Callbacks](/docs/collections/callbacks)** — Ganchos de ciclo de vida para sincronização de dados entre coleções, validação e efeitos colaterais
- **[Propriedades](/docs/collections/properties)** — Todos os tipos de propriedade e opções
- **[Relações](/docs/collections/relations)** — Chaves estrangeiras, tabelas de junção e joins
- **[Regras de Segurança](/docs/collections/security-rules)** — Row Level Security
- **[Modos de Visualização](/docs/frontend/view-modes)** — Lista, Tabela, Cartões, Kanban
