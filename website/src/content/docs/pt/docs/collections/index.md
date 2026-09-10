---
sourceHash: 7bd4e27e22c6c53b
title: Coleções
sidebar_label: Coleções
description: Coleções são o bloco de construção principal do Rebase — cada coleção é mapeada para uma tabela de banco de dados e define seu esquema, relações, segurança e comportamento de UI.
---

## O que é uma Coleção?

Uma **coleção** é um objeto TypeScript que descreve uma tabela do banco de dados e como ela deve aparecer na UI de administração. Ela define:

- **Esquema** — Propriedades (colunas), seus tipos e regras de validação
- **Relações** — Chaves estrangeiras, tabelas de junção e caminhos de junção (joins)
- **Segurança** — Políticas de Row Level Security
- **Hooks de ciclo de vida** — Callbacks para operações de criação, atualização e exclusão
- **Comportamento da UI de administração** — Modos de visualização, edição inline, visualizações de entidade, ações — tudo sob `admin`

## Declarando uma: `defineCollection`

Envolva o literal em `defineCollection`. Em tempo de execução, ela é a função identidade — retorna o objeto inalterado —, portanto não tem custo algum. O que ela oferece é inferência: um parâmetro de tipo `const` captura as chaves de `properties` como tipos literais, e os campos em formato de chave do bloco `admin` são então validados contra eles. Um nome que não seja uma de suas propriedades resulta em um **erro de compilação**, não apenas em uma sugestão ausente.

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

Os campos verificados são `display`, `sort`, `propertiesOrder` e `listProperties`.
Três formatos são aceitos além de uma chave de propriedade simples:

| Formato | Exemplo | Observações |
| --- | --- | --- |
| Caminho delimitado por ponto em um `map` | `"profile.displayName"` | A **raiz** deve ser uma propriedade real; o caminho abaixo dela não é verificado. |
| Coluna de subcoleção filha | `"subcollection:orders"` | Apenas para `propertiesOrder` / `listProperties`. |
| Uma chave de `additionalFields` | `"score" as AdditionalFieldKey` | Precisa da asserção de tipo (cast) — veja abaixo. |

`AdditionalFieldDelegate.key` é uma `string` simples, portanto o sistema de tipos não tem como saber quais chaves extras uma coleção declara. Em vez de reabrir esses campos para qualquer string, o cast torna a exceção explícita:

```typescript
import type { AdditionalFieldKey } from "@rebasepro/cms-types";

propertiesOrder: ["title", "score" as AdditionalFieldKey]
```

Importe-o de `@rebasepro/cms-types` em um projeto que possua um painel de administração — essa é a cópia que também faz a checagem de tipos do bloco `admin`. Um projeto BaaS headless, que não possui bloco admin, importa a mesma função de `@rebasepro/common`.

Anotar o tipo diretamente ainda funciona e ainda é verificado:

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

mas uma anotação apenas *valida a estrutura (shape)* — ela não consegue ver os nomes das suas propriedades, então os campos de chave do `admin` passam a aceitar qualquer string como fallback. Prefira `defineCollection`, a menos que precise nomear o tipo.

:::note
`buildCollection` e `buildProperty` não existem mais. `buildCollection` é o `defineCollection` sem a inferência; `buildProperty` envolvia uma propriedade em um tipo que ela já tinha. Consulte o [changelog](/docs/changelog) para ver a migração em linha única.
:::

## Anatomia: o contrato e o painel

Um arquivo, dois públicos. Tudo o que importa para o *banco de dados e a API* fica no nível superior; tudo o que o *painel de administração* renderiza fica dentro de `admin`.

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

A divisão não é estética. É o que permite ao Rebase ser um backend por si só:

- Um projeto **BaaS ou headless** nunca escreve um bloco `admin`. Suas coleções — ou nenhuma coleção, já que o modo BaaS faz a introspecção do banco de dados — descrevem dados e autorização, nada mais. `@rebasepro/types` não contém código de UI, portanto a árvore de dependências de um projeto headless permanece restrita ao servidor.
- O **backend nunca lê o conteúdo desse bloco**. Ele é descartado antes de a coleção ser serializada para o endpoint de contrato ou para um bundle de build, e é excluído da versão do schema — portanto, alterar um ícone não marcará todos os SDKs gerados como desatualizados.

### O bloco `admin` existe apenas se você instalar os tipos de administração

`@rebasepro/types` não declara nenhum campo `admin` — nem em uma coleção, nem em uma propriedade. Em um projeto BaaS, escrever um é um **erro de tipo**. `@rebasepro/cms-types` o adiciona de volta por meio de declaration merging, de modo que uma linha por projeto o ativa:

```typescript no-verify
// config/cms.d.ts
/// <reference types="@rebasepro/cms-types" />
```

Depois disso, os tipos padrão do core passam a conter um bloco totalmente tipado — um erro de digitação como `icoon` é um erro, e você obtém autocompletar:

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
Uma ampliação (augmentation) se aplica a todo o *programa* TypeScript, e `config/` e `frontend/` são programas separados — e é por isso que a referência pertence ao pacote config. Não existe um tipo wrapper `AdminCollectionConfig`: com o campo mesclado, `CollectionConfig` é o tipo usado na criação.

:::note[Por que um projeto BaaS não paga nada]
O tipo de uma propriedade em uma instalação BaaS não tem `Field`, nem `columnWidth`, nem `hideFromCollection` — esses vivem em `AdminPropertyOptions` no pacote admin. Essa garantia é verificada em testes, não apenas alegada: `e2e/baas-typecheck/src/admin_absent.ts` usa `@ts-expect-error` em `admin`, de modo que a compilação falha se o campo voltar a ser gravável no core.
:::

### Migrando de uma coleção plana (flat)

Antes da versão 0.11, esses campos ficavam no nível superior. Para movê-los:

```bash
node scripts/codemod/collections-admin-block.mjs config/collections
```

Ele relata qualquer item que não possa mover com segurança — principalmente a apresentação dentro de `relations[].overrides`, que precisa de `overrides: { admin: { … } }` manualmente.

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
        icon: "inventory_2"           // Material icon key
    }
});

```

## Propriedades Principais

### Identificação

| Propriedade | Tipo | Descrição |
|---|---|---|
| `slug` | `string` | **Obrigatório.** Identificador seguro para URL. Usado na URL da UI de administração e no caminho da API REST (`/api/data/{slug}`). |
| `name` | `string` | **Obrigatório.** Nome de exibição (plural). Exibido na navegação e nos cabeçalhos de página. |
| `singularName` | `string` | Nome de exibição para uma única entidade. Usado em "Novo Produto", "Editar Produto", etc. |
| `description` | `string` | Uma frase sobre o que esta coleção contém, exibida acima da lista. Markdown. |
| `table` | `string` | Nome da tabela no PostgreSQL. O padrão é `toSnakeCase(slug)` — defina-o apenas para desacoplar a URL da tabela, por exemplo, uma tabela `blog_posts` existente servida em `/posts`. |
| `admin.icon` | `string` | O nome de um ícone [Lucide](https://lucide.dev/icons), por exemplo, `"FileText"`, `"ShoppingCart"`. Um elemento renderizado também funciona, mas o nome sobrevive à serialização, portanto é o que o editor de esquema grava de volta. |

### Esquema

| Propriedade | Tipo | Descrição |
|---|---|---|
| `properties` | `Properties` | **Obrigatório.** Mapeamento de chave de propriedade → definição de propriedade. Cada chave se torna uma coluna no banco de dados. |
| `relations` | `Relation[]` | Relações SQL — chaves estrangeiras, tabelas de junção. Consulte [Relações](/docs/collections/relations). |
| `securityRules` | `SecurityRule[]` | Políticas de Row Level Security. Consulte [Regras de Segurança](/docs/collections/security-rules). |
| `indexes` | `CollectionIndex[]` | Índices do Postgres necessários para esta tabela. Consulte [Índices](/docs/backend/indexes). |
| `search` | `SearchConfig` | Busca textual classificada (ranked full-text search) nos campos especificados, incluindo conteúdo JSONB e arrays. Apenas Postgres. Consulte [Busca](/docs/backend/search). |
| `auth` | `boolean \| AuthCollectionConfig` | Marca a coleção como de autenticação (gestão de usuários, redefinição de senha, etc.) |
| `schema` | `string` | Esquema do Postgres onde a tabela reside — `"public"`, `"rebase"`, `"auth"`. O padrão é `"public"`. |
| `disableDefaultPolicies` | `boolean` | Remove as políticas padrão injetadas pelo gerador — um SELECT de admin/servidor e, em uma coleção de autenticação, leitura própria mais um controle de escrita exclusivo para admin — assumindo total responsabilidade pelo RLS desta coleção. O padrão é `false`. Consulte [Regras de Segurança](/docs/collections/security-rules). |
| `softDelete` | `boolean \| { field?: string }` | Converte `delete` em um timestamp e oculta as linhas marcadas de todas as leituras. `true` usa `deletedAt`; o formato de objeto renomeia o campo. A coleção deve declarar essa propriedade `date` por conta própria. Apenas Postgres — consulte [Exclusão reversível (Soft delete)](/docs/collections/soft-delete). |
| `strictWrites` | `boolean` | Rejeita uma escrita que cite um campo que esta coleção não declara, com status 400. O padrão é `true`. Defina como `false` apenas quando a coluna genuinamente existir e não estiver declarada — preenchida por uma trigger ou identificada por introspecção em vez de declarada no código. |

### Configuração da UI

Todos os itens a seguir vão dentro de `admin`.

| Propriedade | Tipo | Padrão | Descrição |
|---|---|---|---|
| `defaultViewMode` | `"list" \| "table" \| "cards" \| "kanban"` | `"list"` | Modo de visualização padrão |
| `enabledViews` | `ViewMode[]` | Todos os quatro | Quais modos de visualização estão disponíveis |
| `kanban` | `KanbanConfig` | — | Configuração do Kanban (propriedade da coluna). Sempre combine com `orderProperty` — consulte [Modos de Visualização](/docs/frontend/view-modes) |
| `orderProperty` | `string` | — | Chave da propriedade **string** que armazena a chave de ordenação de arrastar e soltar (drag-and-drop). Obrigatório para o funcionamento do quadro Kanban |
| `openEntityMode` | `"side_panel" \| "full_screen" \| "split" \| "dialog"` | `"full_screen"` | Como as entidades são abertas para edição |
| `sideDialogWidth` | `number \| string` | — | Largura do diálogo lateral |
| `inlineEditing` | `boolean` | `true` | Habilita a edição inline na visualização em planilha |
| `defaultSize` | `"xs" \| "s" \| "m" \| "l" \| "xl"` | `"m"` | Altura de linha padrão na tabela |
| `pagination` | `boolean \| number` | `true` (50) | Habilita a paginação e/ou define o tamanho da página |
| `listProperties` | `string[]` | — | Propriedades a serem exibidas na visualização de lista |
| `propertiesOrder` | `string[]` | — | Ordem das colunas na visualização de tabela |
| `selectionEnabled` | `boolean` | `true` | Habilita a seleção de linhas |
| `hideFromNavigation` | `boolean` | `false` | Oculta da navegação na barra lateral |
| `defaultSelectedView` | `string \| function` | — | Visualização ou subcoleção padrão a ser aberta |

### Opções de Entidade

Dentro de `admin`, exceto `history`, que é um recurso de backend e permanece no nível superior.

| Propriedade | Tipo | Padrão | Descrição |
|---|---|---|---|
| `formAutoSave` | `boolean` | `false` | Salvamento automático na alteração de campos |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | `"manual_apply"` | Backup de alterações não salvas |
| `hideIdFromForm` | `boolean` | `false` | Oculta o ID da entidade no formulário |
| `hideIdFromCollection` | `boolean` | `false` | Oculta a coluna de ID na tabela |
| `includeJsonView` | `boolean` | `true` | Disponibiliza os valores brutos no inspetor de registros |
| `history` | `boolean` | `false` | Rastreia alterações no histórico da entidade |
| `alwaysApplyDefaultValues` | `boolean` | `false` | Aplica valores padrão a cada salvamento |
| `previewProperties` | `string[]` | — | Propriedades a serem exibidas nas prévias de referência |
| `display` | `EntityDisplay` | — | O que preenche cada função de exibição — consulte [Exibição da entidade](#entity-display) |

### Avançado

No nível superior, porque o backend os lê:

| Propriedade | Tipo | Descrição |
|---|---|---|
| `callbacks` | `CollectionCallbacks` | Hooks de ciclo de vida (`beforeSave`, `afterSave`, `beforeDelete`, etc.) |
| `childCollections` | `() => CollectionConfig[]` | As coleções aninhadas sob uma entidade desta. Preenchidas durante a normalização a partir do que o driver expressa — uma `subcollections` do Firestore, uma relação `hasMany` do Postgres — portanto, um driver customizado é o único motivo para defini-las manualmente |
| `dataSource` | `string` | Qual fonte de dados registrada suporta esta coleção (padrão: a sem nome) |
| `engine` | `string` | O mecanismo subjacente — `"postgres"`, `"firestore"`, `"mongodb"`. Resolvido a partir de `dataSource`; defina-o apenas para sobrescrever |
| `databaseId` | `string` | Banco de dados ou schema dentro do mecanismo |
| `metadata` | `Record<string, unknown>` | Qualquer dado que seu próprio código precise associar a uma coleção. O Rebase não o lê; ele permanece inalterado após a serialização |
| `ownerId` | `string` | **Apenas formulário admin — não aplicado pela API ou pelo banco de dados.** O ID de usuário que o editor de coleções atribui a uma coleção que cria, e exibe ao lado de seu nome. Nada no fluxo da requisição o consulta |

`subcollections` e `path` existem apenas nas configurações de **bancos de dados de documentos** — `FirebaseCollectionConfig` e, para `path`, `MongoDBCollectionConfig`:

| Propriedade | Tipo | Descrição |
|---|---|---|
| `subcollections` | `() => CollectionConfig[]` | **Apenas Firestore.** Coleções aninhadas sob cada documento. Uma coleção do Postgres expressa a mesma coisa com uma [relação](/docs/collections/relations) `hasMany`, que é o que preenche `childCollections` |
| `path` | `string` | **Apenas Firestore e MongoDB.** O caminho ou nome da coleção no mecanismo, quando diferente do slug |

E dentro de `admin`, porque apenas o painel os renderiza:

| Propriedade | Tipo | Descrição |
|---|---|---|
| `admin.entityActions` | `EntityAction[]` | Ações personalizadas em entidades (arquivar, publicar, etc.) |
| `admin.Actions` | `React.ComponentType` | Componente personalizado de ações da barra de ferramentas |
| `admin.entityViews` | `EntityCustomView[]` | Abas personalizadas na visualização de detalhes da entidade |
| `admin.additionalFields` | `AdditionalFieldDelegate[]` | Colunas computadas/virtuais |
| `admin.exportable` | `boolean \| ExportConfig` | Habilita a exportação de dados |
| `admin.components` | `CollectionComponentOverrideMap` | Sobrescritas de componentes de UI com escopo de coleção |

Escrever qualquer um desses seis no nível superior resulta em um erro no momento de inicialização (boot-time), com uma mensagem indicando a chave e para onde ela foi movida.

## Exibição da entidade

Toda superfície que renderiza um registro desenha algum subconjunto de seis funções: **title**, **subtitle**, **image**, **status**, **date** e **tags**. Uma linha de lista é image + title + subtitle + status + date, um card é a mesma coisa com a imagem no topo, um seletor de referência é title + subtitle e o cabeçalho de uma página é apenas o title.

Cada função é derivada de suas propriedades e cada uma pode, alternativamente, ser especificada — como um caminho de propriedade (property path) ou como uma função:

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
            subtitle: ({ entity }) => `in ${entity.values.city}`   // computed
        }
    }
});
```

Qualquer função que você omitir manterá seu valor derivado, portanto definir uma função não significa ter que definir todas as seis.

### Funções computadas e assíncronas

Um resolver pode ser `async`, o que permite a uma função ler algo que o registro não contém — um documento em uma subcoleção, um valor vindo de uma API:

```typescript
admin: {
    display: {
        // The exercise's name lives one document down, per locale.
        title: async ({ entity, context }) => {
            const locale = await context.data.exercise_locales.get(`${entity.id}/de-DE`);
            return locale?.exercise_title;
        }
    }
}
```

Enquanto a promise está em andamento, a superfície exibe o valor derivado e o substitui pelo valor resolvido quando ele chega — um título nunca é um spinner. Os resultados são armazenados em cache por registro e por função, e solicitações simultâneas para o mesmo par compartilham uma única chamada, de modo que uma lista de cinquenta linhas resolve cada linha uma única vez em vez de uma vez por renderização.

Retorne `undefined` quando um registro não tiver nada para a função; o fallback da própria superfície está mais bem preparado sobre o que deve ficar no lugar (um cabeçalho usa o nome singular da coleção, um link usa o ID). Um resolver que lança uma exceção é tratado como `undefined` e registrado em log uma vez — um título que não pode ser obtido não deve quebrar a linha que o exibe.

Prefira um caminho sempre que o valor estiver no registro: um caminho mantém a renderização própria da propriedade, de modo que um status enum continua sendo um chip colorido e uma data permanece formatada, algo que um resolver que retorna apenas uma string não consegue expressar.

:::note[Substituição de `titleProperty`]
`admin.titleProperty` foi removido em favor de `admin.display.title`. A mesma string funciona ali, e o novo campo também aceita um resolver. Uma coleção que ainda contenha a chave antiga será rejeitada pelo `defineCollection` com o erro comum de chave desconhecida.
:::

### Seleção da Propriedade de Título
Quando `display.title` não está definido, a propriedade usada como título de exibição da entidade (prévias, cabeçalhos) é resolvida automaticamente:
1. Se `propertiesOrder` estiver explicitamente definido, a primeira propriedade que não seja ID e que seja do tipo `relation` ou `string` será escolhida como título.
2. Se nenhum `propertiesOrder` for definido, o framework busca as propriedades em ordem e escolhe a primeira propriedade do tipo string.

### Pré-visualizações de Relações em Tabelas
Quando `propertiesOrder` está explicitamente definido, as propriedades de relação **não** são filtradas automaticamente das colunas de pré-visualização padrão (ao passo que são excluídas dos padrões não ordenados para evitar operações de join lentas).

### Como o valor de um título é renderizado
Independentemente do que a propriedade de título contenha, o painel renderiza uma string. Uma data é formatada, um array é concatenado (joined), e uma relação — que chega como `{ id, data: { values } }` em vez de texto — é examinada em busca do primeiro valor entre `name`, `title`, `label` ou `displayName` na linha relacionada, usando seu ID como fallback. Portanto, um título pode apontar para uma propriedade `relation` e ainda assim ser lido como um nome em vez de um UUID.

Este não é um helper exportado: é o que toda superfície que exibe um registro já faz. Não há nada para chamar nem nada para importar.

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

## Filtragem e Ordenação

Você pode definir filtros padrão ou forçados. Todos os três são parte da apresentação — com o que o painel é aberto —, portanto vivem em `admin`:

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

        // Fixed filter — cannot be changed
        fixedFilter: { tenantId: ["==", currentTenantId] },

        // Default sort
        sort: ["createdAt", "desc"]
    }
});
```

Um `fixedFilter` restringe o que o painel *solicita*; não é uma fronteira de segurança. O que um chamador tem permissão para ler é uma [regra de segurança](/docs/collections/security-rules), a qual o banco de dados impõe a todos os chamadores, seja pelo painel ou não.

## Próximos Passos

- **[Entity Callbacks](/docs/collections/callbacks)** — Hooks de ciclo de vida para sincronizar dados entre coleções, validação, efeitos colaterais
- **[Propriedades](/docs/collections/properties)** — Todos os tipos de propriedade e opções
- **[Relações](/docs/collections/relations)** — Chaves estrangeiras, tabelas de junção, joins
- **[Regras de Segurança](/docs/collections/security-rules)** — Row Level Security
- **[Modos de Visualização](/docs/frontend/view-modes)** — Lista, Tabela, Cards, Kanban

---
