---
sourceHash: 8f8ab97f8302c1f8
title: Relações no painel de administração
sidebar_label: Relações no painel de administração
description: "Como o CMS renderiza as relações de uma tabela: um seletor para belongsTo, uma aba sob o registro para cada relação to-many, linhas próprias versus compartilhadas, as mesmas regras via REST e as opções de customizeTable para campos de relação."
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

O CMS lê as [relações](/docs/collections/relations/) de uma tabela a partir do seu descritor e renderiza cada uma de acordo com o que ela é:

| Relação | No registro |
|---|---|
| `belongsTo` | um seletor da linha relacionada, no lugar da sua coluna de chave estrangeira |
| `hasOne` | um seletor da única linha relacionada |
| `hasMany`, `manyToMany`, um `via` to-many | uma **aba** listando as linhas relacionadas |
| um `via` que não é gravável | somente leitura |

```ts
// backend/schema/articles.ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { users } from "./users";
import { tags } from "./tags";

export const articles = defineTable("articles", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull(),
    },
    relations: {
        author:       rel.belongsTo(() => users, { notNull: true }),
        tags:         rel.manyToMany(() => tags),
        featuredTags: rel.manyToMany(() => tags, { through: "articles_featured_tags" }),
    },
    rls: "admin-only",
});
```

O formulário exibe **Author** como um seletor de usuário e nenhum campo `authorId`: o seletor edita essa coluna. Ele é obrigatório, pois a chave estrangeira é `NOT NULL` sem valor padrão. Uma chave estrangeira que faz parte da chave primária da tabela permanece como um campo próprio ao lado do seletor. **Tags** e **Featured Tags** são abas do registro.

Uma relação cujo destino não é disponibilizado ao chamador é omitida: o CMS não pode abrir uma tabela que não possui. Nesse caso, um `belongsTo` mantém sua chave estrangeira como um campo simples, para que o valor permaneça visível e editável. Um `belongsTo` cuja chave estrangeira o chamador não tem permissão para ler também é omitido.

## O segmento do caminho é o nome da relação

<span class="since-badge" data-since="0.31">Desde 0.31</span>

As linhas de uma aba são endereçadas como `parent/parentId/relationName`:

```text
/c/authors/a-1/posts            the posts of author a-1
/c/articles/p-1/featuredTags    the featured tags of article p-1
```

O último segmento é o **nome da relação**, a chave em `relations`, e não o slug do destino. É isso que permite que duas relações com a mesma tabela funcionem: cada uma tem seu próprio nome, portanto cada uma ganha sua própria aba e seu próprio caminho.

## Linhas próprias versus linhas compartilhadas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

O que uma aba permite fazer depende de como a relação é armazenada:

| | Um-para-muitos (`hasMany`) | Muitos-para-muitos (`manyToMany`) |
|---|---|---|
| O filho pertence a | apenas este pai | todo pai que o vincula |
| Criar | cria a linha sob este pai | cria a linha e a vincula |
| Adicionar existente | — | vincula uma linha existente |
| Remover | **exclui** a linha | **desvincula-a**; a linha permanece intocada |

Uma aba muitos-para-muitos oferece **Add existing** e **Remove from this record**, e nunca uma exclusão que removeria a linha de outros pais.

## As mesmas regras via REST

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Uma aba é uma consulta comum restrita a um pai, portanto aceita tudo o que uma listagem raiz aceita (filtros, `orderBy`, `limit`, `offset`, `include`) e `meta.total` faz a contagem das linhas filtradas. Filtre por campo (`?field=op.value`) ou com um objeto completo `?where={"field":["op","value"]}`:

```text
GET    /api/data/authors/a-1/posts?status=eq.published&orderBy=title&limit=20
GET    /api/data/authors/a-1/posts?where={"status":["==","published"]}&orderBy=title
GET    /api/data/authors/a-1/posts/p-1
POST   /api/data/authors/a-1/posts          create under this parent
PATCH  /api/data/authors/a-1/posts/p-1      update; will not reparent
DELETE /api/data/authors/a-1/posts/p-1      delete (one-to-many) / unlink (many-to-many)
```

O segmento do pai é obrigatório. Endereçar uma linha que não está sob esse pai retorna `404`, e `PATCH` nunca move uma linha de um pai para outro: defina a chave estrangeira explicitamente se for isso o que deseja.

Para um muitos-para-muitos, `PATCH parent/id/child/childId` é uma *associação de conjunto* (*set membership*): vincula a linha se ela ainda não estiver vinculada e é idempotente. É assim que você anexa uma linha que já existe.

## O que não se torna uma aba

<span class="since-badge" data-since="0.31">Desde 0.31</span>

- **Relações to-one**: um `belongsTo` ou um `hasOne` é um campo do registro, não uma lista. A escrita por meio de um caminho to-one é rejeitada.
- **Uma tabela com `hideFromEntityViews`** em seu `customizeTable` não é oferecida como uma aba nos registros das tabelas relacionadas a ela.

## Personalizando campos de relação

<span class="since-badge" data-since="0.31">Desde 0.31</span>

```tsx
// frontend/src/cms/articles.tsx
import { customizeTable } from "@rebasepro/cms";
import type { articles } from "../../../backend/schema/articles";

export const articlesCms = customizeTable<typeof articles>("articles", {
    fields: {
        author: {
            previewFields: ["displayName", "email"],
            widget: "dialog",
            includeEntityLink: true,
        },
        featuredTags: {
            name: "Featured",
            renderInForm: true,
            overrides: { name: "Featured tags", defaultViewMode: "cards" },
        },
    },
});
```

| Opção | Efeito |
|---|---|
| `previewFields` | Os campos de destino exibidos no chip de uma linha relacionada. Cabem no máximo três. |
| `widget` | `"select"` seleciona a partir de um dropdown, `"dialog"` a partir de uma tabela com busca. |
| `fixedFilter` | Oferece apenas linhas que passem por este filtro. |
| `includeId` | Mostra o id da linha relacionada nas pré-visualizações. |
| `includeEntityLink` | Mostra um link que abre a linha relacionada. |
| `renderInForm` | Também renderiza uma relação to-many como um seletor no formulário, ao lado de sua aba. |
| `overrides` | Como o destino é apresentado na aba desta relação: qualquer opção de tabela, exceto `fields`. |

O `overrides` altera o estilo da aba, não os campos do destino. Esses pertencem ao próprio `customizeTable` da tabela de destino, e definir `fields` dentro de `overrides` lança um erro.

## Próximos passos

<span class="since-badge" data-since="0.31">Desde 0.31</span>

- [Relações](/docs/collections/relations/): os cinco tipos e como declarar cada um
- [customizeTable](/docs/frontend/customize-table/#relations): opções de relação na referência
- [Escrita via REST](/docs/backend/writes/): criação, atualização e exclusão além de uma aba
