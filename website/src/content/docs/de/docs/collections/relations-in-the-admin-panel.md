---
sourceHash: 0ca75b0fa4561a93
title: Beziehungen im Admin-Panel
sidebar_label: Beziehungen im Admin-Panel
description: Wie jede To-many-Beziehung zu einem Tab unter einem Datensatz wird – das Pfadsegment, eigene gegenüber geteilten Zeilen, dieselben Regeln über REST und was kein Tab wird.
---

Jede Zu-viele-Beziehung — `hasMany`, `manyToMany` oder ein Zu-viele-`via` — wird
im Admin-Panel zu einem **Tab** unter einem Datensatz, der die Zeilen auflistet,
die dieser Datensatz erreicht.

## Das Pfadsegment ist der Beziehungsname

Eine Kindliste wird als `parent/parentId/relationName` adressiert:

```
/c/authors/a-1/posts          the posts of author a-1
/c/posts/p-1/tags             the tags of post p-1
```

Das letzte Segment ist der **Beziehungsname**, nicht der Slug der Zielsammlung.
Beide sind oft gleich, weil eine unbenannte Beziehung den Slug ihres Ziels
übernimmt — eine Inline-Beziehungseigenschaft übernimmt jedoch den
*Eigenschaftsschlüssel*:

```typescript
properties: {
    featuredTags: {
        type: "relation",
        relation: { kind: "manyToMany", target: () => tagsCollection }
    }
}
// tab and path segment: featuredTags   (not "tags")
```

Das ist auch der Grund, warum zwei Beziehungen zur selben Sammlung
funktionieren: Jede hat ihren eigenen Namen, also ihren eigenen Tab und ihren
eigenen Pfad.

## Eigene Zeilen gegenüber geteilten Zeilen

Was ein Tab Ihnen erlaubt, hängt davon ab, wie die Beziehung gespeichert ist,
denn die beiden Fälle bedeuten Unterschiedliches:

| | Eins-zu-viele (`foreignKeyOnTarget`) | Viele-zu-viele (`through`) |
|---|---|---|
| Das Kind gehört zu | allein diesem Elternteil | jedem Elternteil, das es verknüpft |
| Anlegen | legt die Zeile unter diesem Elternteil an | legt die Zeile an und verknüpft sie |
| Vorhandenes hinzufügen | — | verknüpft eine vorhandene Zeile |
| Entfernen | **löscht** die Zeile | **löst** die Verknüpfung; die Zeile bleibt unberührt |

Das Admin-Panel rendert das entsprechend: Ein Viele-zu-viele-Tab bietet
**Vorhandenes hinzufügen** und **Aus diesem Datensatz entfernen** an, und nie ein
Löschen, das die Zeile anderen Elternteilen wegnähme.

## Dieselben Regeln über REST

Kindlisten sind gewöhnliche Sammlungsabfragen, eingeschränkt auf einen
Elternteil, und akzeptieren daher alles, was eine Wurzelliste akzeptiert —
Filter, `orderBy`, `limit`, `offset`, `include` —, und `meta.total` zählt die
gefilterten Zeilen. Filtern Sie entweder pro Feld (`?field=op.value`) oder mit
einem ganzen Objekt `?where={"field":["op","value"]}`; beides erreicht dieselbe
Abfrage:

```
GET    /api/data/authors/a-1/posts?status=eq.published&orderBy=title&limit=20
GET    /api/data/authors/a-1/posts?where={"status":["==","published"]}&orderBy=title
GET    /api/data/authors/a-1/posts/p-1
POST   /api/data/authors/a-1/posts          create under this parent
PATCH  /api/data/authors/a-1/posts/p-1      update; will not reparent
DELETE /api/data/authors/a-1/posts/p-1      delete (one-to-many) / unlink (many-to-many)
```

Das Elternsegment wird durchgesetzt, es ist keine Dekoration. Eine Zeile zu
adressieren, die nicht unter diesem Elternteil liegt, ergibt `404`, und `PATCH`
verschiebt eine Zeile nie von einem Elternteil zu einem anderen — setzen Sie den
Fremdschlüssel ausdrücklich, wenn Sie genau das wollen.

Bei einer Viele-zu-viele-Beziehung ist `PATCH parent/id/child/childId`
*Mengenzugehörigkeit*: Es verknüpft die Zeile, falls sie noch nicht verknüpft
ist, und ist idempotent. So hängen Sie eine bereits vorhandene Zeile an.

## Was nicht zu einem Tab wird

- **Zu-eins-Beziehungen** — sie sind ein Feld am Datensatz, keine Liste. Das
  Schreiben über einen Zu-eins-Pfad wird abgelehnt: Der Fremdschlüssel liegt auf
  der Tabelle des Elternteils.
- **Beziehungen, die innerhalb einer `map` deklariert sind** — sie sind ein Feld
  dieser Map.

## Nächste Schritte

- **[Beziehungen](/docs/collections/relations/)** — die fünf Arten und wie man jede deklariert
- **[Schreiben über REST](/docs/backend/writes/)** — Erstellen, Aktualisieren und Löschen über eine Kindliste hinaus
