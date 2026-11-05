---
sourceHash: 0ca75b0fa4561a93
title: Relazioni nel pannello di amministrazione
sidebar_label: Relazioni nel pannello di amministrazione
description: Come ogni relazione a molti diventa una scheda sotto un record — il segmento di percorso, righe proprie e condivise, le stesse regole via REST e cosa non diventa una scheda.
---

Ogni relazione a-molti — `hasMany`, `manyToMany` o un `via` a-molti — diventa una
**scheda** sotto un record nel pannello di amministrazione, che elenca le righe
che quel record raggiunge.

## Il segmento di percorso è il nome della relazione

Un elenco di figli si indirizza come `parent/parentId/relationName`:

```
/c/authors/a-1/posts          the posts of author a-1
/c/posts/p-1/tags             the tags of post p-1
```

L'ultimo segmento è il **nome della relazione**, non lo slug della collezione di
destinazione. Spesso coincidono, perché una relazione senza nome prende lo slug
della sua destinazione — ma una proprietà di relazione inline prende la *chiave
della proprietà*:

```typescript
properties: {
    featuredTags: {
        type: "relation",
        relation: { kind: "manyToMany", target: () => tagsCollection }
    }
}
// tab and path segment: featuredTags   (not "tags")
```

È anche ciò che fa funzionare due relazioni verso la stessa collezione: ognuna ha
il proprio nome, quindi ognuna ha la propria scheda e il proprio percorso.

## Righe possedute contro righe condivise

Ciò che una scheda ti permette di fare dipende da come la relazione è
memorizzata, perché i due casi significano cose diverse:

| | Uno-a-molti (`foreignKeyOnTarget`) | Molti-a-molti (`through`) |
|---|---|---|
| Il figlio appartiene a | questo solo padre | ogni padre che lo collega |
| Creare | crea la riga sotto questo padre | crea la riga e la collega |
| Aggiungi esistente | — | collega una riga esistente |
| Rimuovi | **elimina** la riga | **scollega**; la riga resta intatta |

Il pannello di amministrazione rende ciascun caso di conseguenza: una scheda
molti-a-molti offre **Aggiungi esistente** e **Rimuovi da questo record**, e mai
un'eliminazione che toglierebbe la riga agli altri padri.

## Le stesse regole via REST

Gli elenchi di figli sono normali query di collezione ristrette a un padre,
quindi accettano tutto ciò che accetta un elenco radice — filtri, `orderBy`,
`limit`, `offset`, `include` — e `meta.total` conta le righe filtrate. Filtra per
campo (`?field=op.value`) oppure con un oggetto intero
`?where={"field":["op","value"]}`; entrambi raggiungono la stessa query:

```
GET    /api/data/authors/a-1/posts?status=eq.published&orderBy=title&limit=20
GET    /api/data/authors/a-1/posts?where={"status":["==","published"]}&orderBy=title
GET    /api/data/authors/a-1/posts/p-1
POST   /api/data/authors/a-1/posts          create under this parent
PATCH  /api/data/authors/a-1/posts/p-1      update; will not reparent
DELETE /api/data/authors/a-1/posts/p-1      delete (one-to-many) / unlink (many-to-many)
```

Il segmento del padre è imposto, non decorativo. Indirizzare una riga che non sta
sotto quel padre restituisce `404`, e `PATCH` non sposta mai una riga da un padre
a un altro — imposta esplicitamente la chiave esterna se è quello che vuoi.

Per un molti-a-molti, `PATCH parent/id/child/childId` è *appartenenza
all'insieme*: collega la riga se non è ancora collegata, ed è idempotente. È così
che alleghi una riga che esiste già.

## Cosa non diventa una scheda

- **Relazioni a-uno** — sono un campo del record, non un elenco. Scrivere
  attraverso un percorso a-uno viene rifiutato: la chiave esterna vive sulla
  tabella del padre.
- **Relazioni dichiarate dentro una `map`** — sono un campo di quella map.

## Passi Successivi

- **[Relazioni](/docs/collections/relations/)** — i cinque tipi e come dichiararli
- **[Scrivere via REST](/docs/backend/writes/)** — creare, aggiornare ed eliminare oltre una lista figlia
