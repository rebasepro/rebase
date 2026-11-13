---
sourceHash: 8f8ab97f8302c1f8
title: Relationen im Admin-Panel
sidebar_label: Relationen im Admin-Panel
description: "Wie das CMS die Relationen einer Tabelle darstellt: eine Auswahl für ein belongsTo, ein Tab unter dem Datensatz für jede To-Many-Relation, eigene versus geteilte Zeilen, dieselben Regeln über REST und die customizeTable-Optionen für Relationsfelder."
---

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Das CMS liest die [Relationen](/docs/collections/relations/) einer Tabelle aus ihrem
Deskriptor und stellt jede entsprechend ihres Typs dar:

| Relation | Im Datensatz |
|---|---|
| `belongsTo` | eine Auswahl der verknüpften Zeile anstelle ihrer Fremdschlüsselspalte |
| `hasOne` | eine Auswahl der einen verknüpften Zeile |
| `hasMany`, `manyToMany`, ein To-Many-`via` | ein **Tab**, der die verknüpften Zeilen auflistet |
| ein `via`, das nicht schreibbar ist | schreibgeschützt |

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

Das Formular zeigt **Author** als Auswahl eines Benutzers und kein `authorId`-Feld: Die
Auswahl bearbeitet diese Spalte. Sie ist erforderlich, da der Fremdschlüssel
`NOT NULL` ohne Standardwert ist. Ein Fremdschlüssel, der Teil des Primärschlüssels der
Tabelle ist, bleibt als eigenständiges Feld neben der Auswahl bestehen. **Tags** und
**Featured Tags** sind Tabs des Datensatzes.

Eine Relation, deren Ziel für den Aufrufer nicht bereitgestellt wird, wird weggelassen: Das
CMS kann keine Tabelle öffnen, auf die es keinen Zugriff hat. Ein `belongsTo` belässt seinen
Fremdschlüssel dann als einfaches Feld, sodass der Wert sichtbar und bearbeitbar bleibt. Ein
`belongsTo`, dessen Fremdschlüssel der Aufrufer nicht lesen darf, wird ebenfalls weggelassen.

## Das Pfadsegment ist der Relationsname

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Die Zeilen eines Tabs werden über `parent/parentId/relationName` adressiert:

```text
/c/authors/a-1/posts            the posts of author a-1
/c/articles/p-1/featuredTags    the featured tags of article p-1
```

Das letzte Segment ist der **Name der Relation**, der Schlüssel in `relations`, nicht
der Slug des Ziels. Dadurch funktionieren zwei Relationen zur selben Tabelle: Jede hat
ihren eigenen Namen, sodass jede ihren eigenen Tab und ihren eigenen Pfad erhält.

## Eigene Zeilen versus geteilte Zeilen

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Welche Aktionen in einem Tab möglich sind, hängt davon ab, wie die Relation gespeichert ist:

| | One-to-many (`hasMany`) | Many-to-many (`manyToMany`) |
|---|---|---|
| Das untergeordnete Element gehört zu | ausschließlich diesem übergeordneten Element | jedem übergeordneten Element, das es verknüpft |
| Erstellen | erstellt die Zeile unter diesem übergeordneten Element | erstellt die Zeile und verknüpft sie |
| Vorhandenes hinzufügen | — | verknüpft eine vorhandene Zeile |
| Entfernen | **löscht** die Zeile | **hebt die Verknüpfung auf**; die Zeile bleibt unverändert |

Ein Many-to-Many-Tab bietet **Add existing** und **Remove from this record** an und
niemals ein Löschen, das die Zeile anderen übergeordneten Elementen entziehen würde.

## Dieselben Regeln über REST

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Ein Tab ist eine gewöhnliche Abfrage, die auf ein übergeordnetes Element eingegrenzt ist,
daher akzeptiert er alles, was eine Root-Liste akzeptiert (Filter, `orderBy`, `limit`,
`offset`, `include`), und `meta.total` zählt die gefilterten Zeilen. Filtern Sie pro Feld
(`?field=op.value`) oder mit einem vollständigen Objekt `?where={"field":["op","value"]}`:

```text
GET    /api/data/authors/a-1/posts?status=eq.published&orderBy=title&limit=20
GET    /api/data/authors/a-1/posts?where={"status":["==","published"]}&orderBy=title
GET    /api/data/authors/a-1/posts/p-1
POST   /api/data/authors/a-1/posts          create under this parent
PATCH  /api/data/authors/a-1/posts/p-1      update; will not reparent
DELETE /api/data/authors/a-1/posts/p-1      delete (one-to-many) / unlink (many-to-many)
```

Das übergeordnete Segment wird erzwungen. Die Adressierung einer Zeile, die sich nicht unter
diesem übergeordneten Element befindet, gibt `404` zurück, und `PATCH` verschiebt niemals eine
Zeile von einem übergeordneten Element zu einem anderen: Setzen Sie den Fremdschlüssel explizit,
wenn dies gewünscht ist.

Bei einer Many-to-Many-Relation ist `PATCH parent/id/child/childId` eine *Mengenmitgliedschaft*:
Es verknüpft die Zeile, falls sie noch nicht verknüpft ist, und ist idempotent. Auf diese
Weise binden Sie eine bereits vorhandene Zeile an.

## Was nicht zu einem Tab wird

<span class="since-badge" data-since="0.31">Seit 0.31</span>

- **To-One-Relationen**: Ein `belongsTo` oder ein `hasOne` ist ein Feld des Datensatzes,
  keine Liste. Schreibzugriffe über einen To-One-Pfad werden abgewiesen.
- **Eine Tabelle mit `hideFromEntityViews`** in ihrem `customizeTable` wird nicht als Tab
  auf den Datensätzen von Tabellen angeboten, die sich auf sie beziehen.

## Relationsfelder anpassen

<span class="since-badge" data-since="0.31">Seit 0.31</span>

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

| Option | Auswirkung |
|---|---|
| `previewFields` | Die Felder des Ziels, die im Chip für eine verknüpfte Zeile angezeigt werden. Es passen höchstens drei. |
| `widget` | `"select"` wählt aus einem Dropdown-Menü, `"dialog"` aus einer durchsuchbaren Tabelle. |
| `fixedFilter` | Bietet nur Zeilen an, die diesen Filter erfüllen. |
| `includeId` | Zeigt die ID der verknüpften Zeile in Vorschauen an. |
| `includeEntityLink` | Zeigt einen Link an, der die verknüpfte Zeile öffnet. |
| `renderInForm` | Stellt eine To-Many-Relation zusätzlich als Auswahl im Formular neben ihrem Tab dar. |
| `overrides` | Wie das Ziel im Tab dieser Relation dargestellt wird: jede Tabellenoption außer `fields`. |

`overrides` passt die Darstellung des Tabs an, nicht die Felder des Ziels. Diese gehören zum
eigenen `customizeTable` der Zieltabelle, und das Definieren von `fields` innerhalb von `overrides`
wirft einen Fehler.

## Nächste Schritte

<span class="since-badge" data-since="0.31">Seit 0.31</span>

- [Relationen](/docs/collections/relations/): Die fünf Arten und wie jede deklariert wird
- [customizeTable](/docs/frontend/customize-table/#relations): Relationsoptionen in der Referenz
- [Schreiben über REST](/docs/backend/writes/): Erstellen, Aktualisieren und Löschen über einen Tab hinaus
