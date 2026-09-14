---
sourceHash: 8bade8e09da44b98
title: Coleções
sidebar_label: Coleções
description: As coleções são o bloco de construção fundamental do Rebase — cada coleção é mapeada para uma tabela de banco de dados e define seu esquema, relações, segurança e comportamento de interface.
---

## O que é uma Coleção?

Uma **coleção** é um objeto TypeScript que descreve uma tabela de banco de dados e como ela deve aparecer no Rebase CMS. Ela define:

- **Schema** — Propriedades (colunas), seus tipos e regras de validação
- **Relações** — Chaves estrangeiras, tabelas de junção e caminhos de join
- **Segurança** — Políticas de Row Level Security (RLS)
- **Ganchos de ciclo de vida (Lifecycle hooks)** — Callbacks para operações de criação, atualização e exclusão
- **Comportamento do CMS** — Modos de visualização, edição inline, visualizações de entidade, ações — tudo sob `admin`

## Declarando uma: `defineCollection`

Envolva o literal em `defineCollection`. Em tempo de execução, ela é a função de identidade — ela retorna o objeto inalterado —, portanto não tem custo algum. O benefício obtido é a inferência: um parâmetro de tipo `const` captura suas chaves de `properties` como tipos literais, e os campos em formato de chave do bloco `admin` são então verificados em relação a elas. Um nome que não seja uma de suas propriedades resulta em um **erro de compilação**, e não apenas em uma sugestão ausente.

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

Os campos verificados são `display`, `sort`, `propertiesOrder` e `listProperties`. Três formatos são aceitos além de uma chave de propriedade comum:

| Formato | Exemplo | Notas |
| --- | --- | --- |
| Caminho pontilhado em um `map` | `"profile.displayName"` | A **raiz** deve ser uma propriedade real; o caminho abaixo dela não é verificado. |
| Coluna de coleção filha | `"subcollection:orders"` | Apenas `propertiesOrder` / `listProperties`. |
| Uma chave de `additionalFields` | `"score" as AdditionalFieldKey` | Precisa da coerção de tipo (cast) — veja abaixo. |

`AdditionalFieldDelegate.key` é uma `string` simples, portanto o sistema de tipos não tem como saber quais chaves adicionais uma coleção declara. Em vez de reabrir esses campos para qualquer string, o cast torna a exceção explícita:

```typescript
import type { AdditionalFieldKey } from "@rebasepro/cms-types";

propertiesOrder: ["title", "score" as AdditionalFieldKey]
```

Importe-o de `@rebasepro/cms-types` em um projeto que possui um painel administrativo — essa é a versão que também faz a checagem de tipos do bloco `admin`. Um projeto BaaS headless, que não possui bloco admin, importa a mesma função de `@rebasepro/common`.

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

mas uma anotação apenas *valida a estrutura* — ela não consegue enxergar os nomes das suas propriedades, então os campos de chave em `admin` passam a aceitar qualquer string como fallback. Prefira `defineCollection`, a menos que precise nomear o tipo explicitamente.

:::note
`buildCollection` e `buildProperty` não existem mais. `buildCollection` é o `defineCollection` sem a inferência; `buildProperty` envolvia uma propriedade em um tipo que ela já possuía. Consulte o [changelog](/docs/changelog) para a migração de linha única.
:::

## Anatomia: o contrato e o painel

Um arquivo, dois públicos. Tudo o que importa para o *banco de dados e a API* fica no nível superior; tudo o que o *painel administrativo* renderiza fica dentro de `admin`.

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

Essa separação não é cosmética. É o que permite ao Rebase funcionar como um backend independente:

- Um projeto **BaaS ou headless** nunca escreve um bloco `admin`. Suas coleções — ou nenhuma coleção, já que o modo BaaS faz introspecção do banco de dados — descrevem dados e autorização, nada mais. `@rebasepro/types` não carrega código de interface de usuário (UI), portanto a árvore de dependências de um projeto headless permanece restrita ao servidor.
- O **backend nunca lê o conteúdo dentro do bloco**. Ele é descartado antes que uma coleção seja serializada para o endpoint de contrato ou em um bundle de build, e é excluído da versão do schema — portanto, alterar um ícone não marca todos os SDKs gerados como desatualizados.

### O bloco `admin` só existe se você instalar os tipos de admin

`@rebasepro/types` não declara nenhum campo `admin` — nem em uma coleção, nem em uma propriedade. Em um projeto BaaS, escrever um é um **erro de tipo**. `@rebasepro/cms-types` o adiciona de volta por meio de mesclagem de declarações (declaration merging), portanto uma única linha por projeto o ativa:

```typescript no-verify
// config/cms.d.ts
/// <reference types="@rebasepro/cms-types" />
```

Depois disso, tipos básicos do core passam a conter um bloco totalmente tipado — um erro de digitação como `icoon` se torna um erro, e você obtém autocompletion:

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
Uma extensão (augmentation) se aplica a todo o *programa* TypeScript, e `config/` e `frontend/` são programas separados — por isso a referência pertence ao pacote de configuração. Não existe um tipo wrapper `AdminCollectionConfig`: com o campo mesclado, `CollectionConfig` é o tipo usado na criação.

:::note[Por que um projeto BaaS não tem custo adicional]
O tipo de uma propriedade em uma instalação BaaS não tem `Field`, não tem `columnWidth`, nem `hideFromCollection` — esses residem em `AdminPropertyOptions` no pacote admin. Essa garantia é verificada em código, não apenas alegada: `e2e/baas-typecheck/src/admin_absent.ts` usa `@ts-expect-error` em `admin`, portanto o build falhará se o campo voltar a ser aceito no core.
:::

### Migrando a partir de uma coleção plana (flat)

Antes da versão 0.11, esses campos ficavam no nível superior. Para movê-los:

```bash
node scripts/codemod/collections-admin-block.mjs config/collections
```

O comando relata qualquer coisa que não possa mover com segurança — principalmente apresentação dentro de `relations[].overrides`, que necessita de `overrides: { admin: { … } }` manualmente.

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
|----------|------|-------------|
| `slug` | `string` | **Obrigatório.** Identificador seguro para URL. Usado na URL da UI administrativa e no caminho da API REST (`/api/data/{slug}`). |
| `name` | `string` | **Obrigatório.** Nome de exibição (plural). Exibido na navegação e nos cabeçalhos de página. |
| `singularName` | `string` | Nome de exibição para uma única entidade. Usado em "Novo Produto", "Editar Produto", etc. |
| `description` | `string` | Uma frase sobre o que esta coleção armazena, exibida acima da lista. Markdown. |
| `table` | `string` | Nome da tabela PostgreSQL. O padrão é `toSnakeCase(slug)` — defina-o apenas para desacoplar a URL da tabela, por exemplo, uma tabela existente `blog_posts` servida em `/posts`. |
| `admin.icon` | `string` | Um nome de ícone do [Lucide](https://lucide.dev/icons), por exemplo `"FileText"`, `"ShoppingCart"`. Um elemento renderizado também funciona, mas o nome sobrevive à serialização, portanto é o que o editor de esquema grava de volta. |

### Esquema (Schema)

| Propriedade | Tipo | Descrição |
|----------|------|-------------|
| `properties` | `Properties` | **Obrigatório.** Mapeamento de chave da propriedade → definição da propriedade. Cada chave se torna uma coluna no banco de dados. |
| `relations` | `Relation[]` | Relações SQL — chaves estrangeiras, tabelas de junção. Consulte [Relations](/docs/collections/relations). |
| `securityRules` | `SecurityRule[]` | Políticas de Row Level Security. Consulte [Security Rules](/docs/collections/security-rules). |
| `indexes` | `CollectionIndex[]` | Índices do Postgres que esta tabela necessita. Consulte [Indexes](/docs/backend/indexes). |
| `search` | `SearchConfig` | Busca textual ranqueada (full-text search) nos campos especificados, incluindo conteúdo JSONB e arrays. Apenas Postgres. Consulte [Search](/docs/backend/search). |
| `auth` | `boolean \| AuthCollectionConfig` | Marca a coleção como de autenticação (gestão de usuários, redefinição de senha, etc.) |
| `schema` | `string` | Esquema do Postgres onde a tabela reside — `"public"`, `"rebase"`, `"auth"`. O padrão é `"public"`. |
| `disableDefaultPolicies` | `boolean` | Remove as políticas de base que o gerador injeta — um SELECT para admin/servidor e, em coleções de autenticação, leitura própria mais restrição de escrita exclusiva para administradores — e assume total responsabilidade pelo RLS desta coleção. Padrão: `false`. Consulte [Security Rules](/docs/collections/security-rules). |
| `softDelete` | `boolean \| { field?: string }` | Transforma o `delete` em um timestamp e oculta as linhas marcadas de qualquer leitura. `true` utiliza `deletedAt`; a forma em objeto renomeia o campo. A própria coleção deve declarar essa propriedade `date`. Apenas Postgres — consulte [Soft delete](/docs/collections/soft-delete) |
| `strictWrites` | `boolean` | Rejeita uma gravação que especifique um campo não declarado por esta coleção, com erro 400. Padrão: `true`. Defina como `false` apenas quando a coluna realmente existir e não estiver declarada — preenchida por um trigger ou obtida via introspecção em vez de declarada manualmente. |

### Configuração de UI

Tudo o que segue deve ficar dentro de `admin`.

| Propriedade | Tipo | Padrão | Descrição |
|----------|------|---------|-------------|
| `defaultViewMode` | `"list" \| "table" \| "cards" \| "kanban"` | `"list"` | Modo de visualização padrão |
| `enabledViews` | `ViewMode[]` | Todas as quatro | Quais modos de visualização estão disponíveis |
| `kanban` | `KanbanConfig` | — | Configuração do Kanban (propriedade de coluna). Sempre combine com `orderProperty` — consulte [View Modes](/docs/frontend/view-modes) |
| `orderProperty` | `string` | — | Chave da propriedade **string** que armazena a ordem para drag-and-drop. Obrigatória para o funcionamento do quadro Kanban |
| `openEntityMode` | `"side_panel" \| "full_screen" \| "split" \| "dialog"` | `"full_screen"` | Como as entidades abrem para edição |
| `sideDialogWidth` | `number \| string` | — | Largura do diálogo lateral |
| `inlineEditing` | `boolean` | `true` | Habilitar edição inline na visualização em planilha/tabela |
| `defaultSize` | `"xs" \| "s" \| "m" \| "l" \| "xl"` | `"m"` | Altura de linha padrão na tabela |
| `pagination` | `boolean \| number` | `true` (50) | Habilitar paginação e/ou definir o tamanho da página |
| `listProperties` | `string[]` | — | Propriedades a serem exibidas na visualização de lista |
| `propertiesOrder` | `string[]` | — | Ordem das colunas na visualização de tabela |
| `selectionEnabled` | `boolean` | `true` | Habilitar seleção de linhas |
| `hideFromNavigation` | `boolean` | `false` | Ocultar da barra de navegação lateral |
| `defaultSelectedView` | `string \| function` | — | Visualização padrão ou subcoleção a ser aberta |

### Opções de Entidade

Dentro de `admin`, exceto `history`, que é um recurso de backend e permanece no nível superior.

| Propriedade | Tipo | Padrão | Descrição |
|----------|------|---------|-------------|
| `formAutoSave` | `boolean` | `false` | Salvamento automático ao alterar campos |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | `"manual_apply"` | Fazer backup de alterações não salvas |
| `hideIdFromForm` | `boolean` | `false` | Ocultar o ID da entidade do formulário |
| `hideIdFromCollection` | `boolean` | `false` | Ocultar a coluna de ID da tabela |
| `includeJsonView` | `boolean` | `true` | Disponibilizar os valores brutos no inspetor de registros |
| `history` | `boolean` | `false` | Rastrear alterações no histórico da entidade |
| `alwaysApplyDefaultValues` | `boolean` | `false` | Aplicar valores padrão a cada salvamento |
| `previewProperties` | `string[]` | — | Propriedades a serem exibidas em pré-visualizações de referências |
| `display` | `EntityDisplay` | — | O que preenche cada papel de exibição — consulte [Exibição de entidade](#exibição-de-entidade-entity-display) |

### Avançado

No nível superior, porque o backend os lê:

| Propriedade | Tipo | Descrição |
|----------|------|-------------|
| `callbacks` | `CollectionCallbacks` | Ganchos de ciclo de vida (`beforeSave`, `afterSave`, `beforeDelete`, etc.) |
| `childCollections` | `() => CollectionConfig[]` | As coleções aninhadas sob uma entidade desta coleção. Preenchido durante a normalização a partir do que o driver expressa — `subcollections` do Firestore, relação `hasMany` do Postgres —, portanto, um driver customizado é o único motivo para defini-lo manualmente |
| `dataSource` | `string` | Qual fonte de dados registrada dá suporte a esta coleção (padrão: a não nomeada) |
| `engine` | `string` | A engine por trás dela — `"postgres"`, `"firestore"`, `"mongodb"`. Resolvido a partir de `dataSource`; defina apenas para sobrescrever |
| `databaseId` | `string` | Banco de dados ou esquema dentro da engine |
| `metadata` | `Record<string, unknown>` | Qualquer informação que seu próprio código precise associar a uma coleção. O Rebase não lê este campo; ele sobrevive à serialização inalterado |
| `ownerId` | `string` | **Apenas formulário administrativo — não imposto pela API ou pelo banco de dados.** O ID de usuário que o editor de coleções vincula a uma coleção criada por ele e exibe ao lado de seu nome. Nada no caminho da requisição o consulta |

`subcollections` e `path` estão presentes apenas nas configurações de **bancos de dados de documentos** — `FirebaseCollectionConfig` e, para `path`, `MongoDBCollectionConfig`:

| Propriedade | Tipo | Descrição |
|----------|------|-------------|
| `subcollections` | `() => CollectionConfig[]` | **Apenas Firestore.** Coleções aninhadas sob cada documento. Uma coleção Postgres expressa o mesmo por meio de uma [relação](/docs/collections/relations) `hasMany`, que é o que preenche `childCollections` |
| `path` | `string` | **Apenas Firestore e MongoDB.** O caminho ou nome da coleção na engine, caso seja diferente do slug |

E dentro de `admin`, porque apenas o painel os renderiza:

| Propriedade | Tipo | Descrição |
|----------|------|-------------|
| `admin.entityActions` | `EntityAction[]` | Ações personalizadas em entidades (arquivar, publicar, etc.) |
| `admin.Actions` | `React.ComponentType` | Componente personalizado de ações na barra de ferramentas |
| `admin.entityViews` | `EntityCustomView[]` | Abas personalizadas na visualização de detalhes da entidade |
| `admin.additionalFields` | `AdditionalFieldDelegate[]` | Colunas virtuais/computadas |
| `admin.exportable` | `boolean \| ExportConfig` | Habilitar exportação de dados |
| `admin.components` | `CollectionComponentOverrideMap` | Sobrescrita de componentes de interface no escopo da coleção |

Escrever qualquer um desses seis no nível superior resulta em um erro durante a inicialização (boot-time), com uma mensagem indicando a chave e para onde ela foi movida.

## Exibição de entidade {#entity-display}

Cada superfície que renderiza um registro exibe algum subconjunto de seis papéis: **title**, **subtitle**, **image**, **status**, **date** e **tags**. Uma linha de lista é image + title + subtitle + status + date; um card é o mesmo com a imagem no topo; um seletor de referência é title + subtitle; e o cabeçalho de uma página é apenas o title.

Cada papel é derivado das suas propriedades, e cada um pode ser declarado explicitamente — como um caminho de propriedade (property path) ou como uma função:

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

Qualquer papel que você omitir mantém seu valor derivado, portanto declarar um papel não significa ter que declarar os seis.

### Papéis computados e assíncronos

Um resolvedor (resolver) pode ser `async`, o que permite a um papel ler algo que o registro não contém — um documento em uma subcoleção, um valor retornado por uma API:

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

Enquanto a promise está pendente, a superfície exibe o valor derivado e o substitui pelo valor resolvido assim que este estiver disponível — um título nunca é exibido como um spinner. Os resultados são mantidos em cache por registro e por papel, e requisições concorrentes para o mesmo par compartilham uma única chamada, de modo que uma lista de cinquenta linhas resolve cada linha apenas uma vez, em vez de uma vez por renderização.

Retorne `undefined` quando um registro não tiver nada para o papel; o fallback da própria superfície está mais bem preparado para decidir o que colocar no lugar (um cabeçalho usa o nome singular da coleção, um link usa o ID). Um resolver que lança uma exceção é tratado como `undefined` e registrado em log uma única vez — um título que falhar ao ser buscado não deve quebrar a linha que o exibe.

Prefira um caminho sempre que o valor já estiver no registro: um caminho preserva a renderização nativa da propriedade, de forma que um status de enum continue sendo uma tag colorida (chip) e uma data permaneça formatada, o que um resolver que retorna uma string simples não consegue expressar.

:::note[`titleProperty` substituído]
`admin.titleProperty` foi removido em favor de `admin.display.title`. A mesma string funciona nele, e o novo campo também aceita um resolver. Uma coleção que ainda utilize a chave antiga será rejeitada por `defineCollection` com o erro padrão de chave desconhecida.
:::

### Seleção da Propriedade de Título
Quando `display.title` não está definido, a propriedade usada como o título de exibição da entidade (pré-visualizações, cabeçalhos) é resolvida automaticamente:
1. Se `propertiesOrder` estiver explicitamente definido, a primeira propriedade que não seja de ID e que seja do tipo `relation` ou `string` é escolhida como o título.
2. Se nenhum `propertiesOrder` estiver definido, o framework busca as propriedades em ordem e escolhe a primeira propriedade do tipo string.

### Pré-visualizações de Relações em Tabelas
Quando `propertiesOrder` é definido explicitamente, as propriedades de relação **não** são filtradas automaticamente das colunas de pré-visualização padrão (ao passo que são excluídas dos padrões não ordenados para evitar operações lentas de join).

### Como o valor de um título é renderizado
Independentemente do que a propriedade de título contenha, o painel renderiza uma string. Uma data é formatada, um array é concatenado, e uma relação — que chega como `{ id, data: { values } }` em vez de texto — é examinada em busca do primeiro valor entre `name`, `title`, `label` ou `displayName` na linha relacionada, usando o seu id como fallback. Assim, um título pode apontar para uma propriedade `relation` e ainda assim ser exibido como um nome, e não como um UUID.

Isso não é um helper exportado: é o que cada superfície que desenha um registro já faz. Não há nada a chamar nem nada a importar.

## Construtor de Coleção (Collection Builder)

Para coleções dinâmicas que mudam com base no usuário ou em dados externos, use uma função construtora (builder):

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

Você pode definir filtros padrão ou forçados. Todos os três são aspectos de apresentação — como o painel é inicializado —, portanto residem em `admin`:

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

Um `fixedFilter` restringe o que o painel *solicita*; ele não é um limite de segurança. O que um solicitante tem permissão para ler é uma [regra de segurança](/docs/collections/security-rules), que o banco de dados impõe para qualquer chamador, seja ele o painel ou não.

## Próximos Passos

- **[Entity Callbacks](/docs/collections/callbacks)** — Ganchos de ciclo de vida para sincronizar dados entre coleções, validação e efeitos colaterais
- **[Properties](/docs/collections/properties)** — Todos os tipos de propriedade e opções
- **[Relations](/docs/collections/relations)** — Chaves estrangeiras, tabelas de junção, joins
- **[Security Rules](/docs/collections/security-rules)** — Políticas de Row Level Security
- **[View Modes](/docs/frontend/view-modes)** — Lista, Tabela, Cards, Kanban
