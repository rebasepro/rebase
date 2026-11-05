---
sourceHash: 0ca75b0fa4561a93
title: Relações no painel de administração
sidebar_label: Relações no painel de administração
description: Como toda relação para muitos vira uma aba sob um registro — o segmento do caminho, linhas próprias e compartilhadas, as mesmas regras via REST e o que não vira aba.
---

Toda relação para-muitos — `hasMany`, `manyToMany` ou um `via` para-muitos —
vira uma **aba** sob um registro no painel de administração, listando as linhas
que aquele registro alcança.

## O segmento de caminho é o nome da relação

Uma lista de filhos é endereçada como `parent/parentId/relationName`:

```
/c/authors/a-1/posts          the posts of author a-1
/c/posts/p-1/tags             the tags of post p-1
```

O último segmento é o **nome da relação**, não o slug da coleção de destino.
Muitas vezes são iguais, porque uma relação sem nome assume o slug do seu destino
— mas uma propriedade de relação inline assume a *chave da propriedade*:

```typescript
properties: {
    featuredTags: {
        type: "relation",
        relation: { kind: "manyToMany", target: () => tagsCollection }
    }
}
// tab and path segment: featuredTags   (not "tags")
```

É isso também que faz duas relações para a mesma coleção funcionarem: cada uma
tem o seu nome, então cada uma tem a sua aba e o seu caminho.

## Linhas próprias versus linhas compartilhadas

O que uma aba deixa você fazer depende de como a relação é armazenada, porque os
dois casos significam coisas diferentes:

| | Um-para-muitos (`foreignKeyOnTarget`) | Muitos-para-muitos (`through`) |
|---|---|---|
| O filho pertence a | só a este pai | a todo pai que o vincula |
| Criar | cria a linha sob este pai | cria a linha e a vincula |
| Adicionar existente | — | vincula uma linha existente |
| Remover | **exclui** a linha | **desvincula**; a linha fica intacta |

O painel de administração renderiza cada caso de acordo: uma aba
muitos-para-muitos oferece **Adicionar existente** e **Remover deste registro**,
e nunca uma exclusão que tiraria a linha dos outros pais.

## As mesmas regras via REST

Listas de filhos são consultas de coleção comuns restritas a um pai, então
aceitam tudo o que uma lista raiz aceita — filtros, `orderBy`, `limit`, `offset`,
`include` — e `meta.total` conta as linhas filtradas. Filtre por campo
(`?field=op.value`) ou com um objeto inteiro `?where={"field":["op","value"]}`;
os dois chegam à mesma consulta:

```
GET    /api/data/authors/a-1/posts?status=eq.published&orderBy=title&limit=20
GET    /api/data/authors/a-1/posts?where={"status":["==","published"]}&orderBy=title
GET    /api/data/authors/a-1/posts/p-1
POST   /api/data/authors/a-1/posts          create under this parent
PATCH  /api/data/authors/a-1/posts/p-1      update; will not reparent
DELETE /api/data/authors/a-1/posts/p-1      delete (one-to-many) / unlink (many-to-many)
```

O segmento do pai é imposto, não decorativo. Endereçar uma linha que não está sob
aquele pai retorna `404`, e `PATCH` nunca move uma linha de um pai para outro —
defina a chave estrangeira explicitamente se for isso que você quer.

Num muitos-para-muitos, `PATCH parent/id/child/childId` é *pertinência ao
conjunto*: vincula a linha se ela ainda não estiver vinculada, e é idempotente. É
assim que você anexa uma linha que já existe.

## O que não vira aba

- **Relações para-um** — elas são um campo do registro, não uma lista. Escrever
  através de um caminho para-um é rejeitado: a chave estrangeira vive na tabela
  do pai.
- **Relações declaradas dentro de um `map`** — elas são um campo daquele map.

## Próximos Passos

- **[Relações](/docs/collections/relations/)** — os cinco tipos e como declarar cada um
- **[Escrita via REST](/docs/backend/writes/)** — criar, atualizar e excluir além de uma lista filha
