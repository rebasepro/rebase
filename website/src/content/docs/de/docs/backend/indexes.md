---
sourceHash: e086faac3624de8d
title: Indizes
sidebar_label: Indizes
description: Deklarieren Sie gewöhnliche Postgres-Indizes für eine Tabelle – btree, GIN und BRIN, partiell, zusammengesetzt, abdeckend und eindeutig – und warum manuell erstellte früher verschwanden.
---

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Eine Tabelle deklariert die Indizes, die ihre Abfragen benötigen, neben den Spalten, die sie abdecken:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const posts = defineTable("posts", {
    columns: {
        id:          col.uuid().primaryKey().defaultRandom(),
        title:       col.text().notNull(),
        status:      col.enum(["draft", "published"]).notNull().default("draft"),
        publishDate: col.timestamp({ withTimezone: true }),
    },
    indexes: [
        {
            columns: ["status", { column: "publishDate", direction: "desc" }],
            reason: "admin list: filter by status, newest first",
        },
    ],
    rls: "admin-only",
});
```

## Warum dies existiert

Der DDL-Generator hat schon immer Index-Anweisungen für genau zwei Dinge ausgegeben, und beides sind Strukturen, die einem *Feature* gehören und nicht von Ihnen geschriebenen Abfragen: der GIN-Index hinter einem [`search`-Block](/docs/backend/search) und der ANN-Index hinter einer [`col.vector()`-Spalte](/docs/sdk/aggregates-and-search#the-index). Der Standardfall – der btree-Index hinter einer `where`-Klausel – hatte überhaupt keinen Ort für eine Deklaration.

Die einzige Möglichkeit, einen zu haben, bestand also darin, ihn manuell zu schreiben. Und:

:::caution[Wenn Sie manuell geschriebene Indizes auf einer von Rebase verwalteten Tabelle haben]
`rebase db push` ist deklarativ. Ein Index auf einer verwalteten Tabelle, der in `schema.sql` fehlte, zählte als Drift, und Atlas plante dafür ein `DROP INDEX` – was nicht in der Liste der destruktiven Anweisungen steht, sodass die automatisch genehmigte Anwendung es ohne Nachfrage ausführte. Jeder manuell geschriebene Index auf einer verwalteten Tabelle lebte auf geborgter Zeit.

Dies wird durch die unten stehende Eigentumsregel behoben: Ein Index, den Rebase nicht erstellt hat, wird nun anhand des Namens aus dem Diff ausgeschlossen und niemals angetastet. Das Deklarieren Ihrer manuell geschriebenen Indizes ist immer noch der bessere Endzustand – ein deklarierter Index wird auf einer frischen Datenbank und auf jedem Mandanten erstellt, ein manuell geschriebener nicht –, aber in der Zwischenzeit werden sie durch nichts mehr gelöscht.
:::

## Die Struktur

<span class="since-badge" data-since="0.31">Seit 0.31</span>

| Feld | Typ | Beschreibung |
|-------|------|-------------|
| `columns` | `(string \| { column, direction?, nulls? })[]` | **Erforderlich.** Die Schlüsselspalten in Reihenfolge. 1–5 Einträge. |
| `reason` | `string` | Warum dieser Index existiert, in einer Zeile. Dringend empfohlen. |
| `using` | `"btree" \| "gin" \| "brin"` | Zugriffsmethode. Standardmäßig `btree`. |
| `where` | `IndexPredicate` | Macht den Index partiell – er deckt nur die Zeilen ab, die darauf zutreffen. |
| `unique` | `boolean` | Nur btree. Eine zusammengesetzte Eindeutigkeitsgarantie. |
| `include` | `string[]` | Nur btree. Payload-Spalten, die für Index-Only-Scans mitgeführt werden. |

### `columns` nimmt Spaltenschlüssel entgegen, niemals SQL-Namen

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Der Name einer `belongsTo`-Relation steht für deren Fremdschlüsselspalte, sodass die Relation `author` für die Spalte `author_id` steht:

```ts
indexes: [
    // `author` is the relation; its key is the column author_id.
    { columns: ["author"], reason: "an author's posts, and the ON DELETE cascade" },
]
```

Hier `author_id` zu schreiben wird abgelehnt: Es ist ein SQL-Spaltenname, kein Schlüssel der Tabelle, und `columns` benennt Schlüssel. Postgres indiziert eine Fremdschlüsselspalte nicht automatisch für Sie – ohne diesen Index sind sowohl „Beiträge dieses Autors auflisten“ als auch die `ON DELETE`-Kaskade sequenzielle Scans.

Eine `hasMany`- oder Many-to-Many-Relation besitzt keine Spalte auf dieser Tabelle und wird abgelehnt: Deklarieren Sie den Index auf der Tabelle, die den Fremdschlüssel besitzt.

### Reihenfolge ist wichtig, und nur eine führende Teilmenge ist nutzbar

Postgres kann eine führende Teilmenge der Schlüsselspalten verwenden, sodass `["ownerId", "createdAt"]` eine Abfrage bedient, die nach `ownerId` filtert, sowie eine, die nach beiden filtert, und **niemals** eine, die nur nach `createdAt` filtert.

`direction` und `nulls` haben ihre Berechtigung nur dann, wenn das `ORDER BY` einer Abfrage Richtungen mischt. Ein einzelner `DESC`-Index ist gegenüber seinem `ASC`-Zwilling redundant – Postgres scannt einen btree rückwärts genauso schnell –, sodass ein einziger Index den Filter *und* die Sortierung im Beispiel oben auf dieser Seite bedient.

```ts
indexes: [{ columns: [{ column: "createdAt", direction: "desc", nulls: "last" }], reason: "…" }]
```

Den Postgres-Standard explizit hinzuschreiben, ist kostenlos: Der abgeleitete Name hasht die *effektive* Reihenfolge, daher ist das Hinzufügen von `direction: "asc"` zu einer Spalte, die ohnehin aufsteigend war, keine Neudefinition und baut nichts neu auf.

Die Obergrenze liegt bei fünf Schlüsseln. Postgres erlaubt zweiunddreißig; ab vier sind die nachfolgenden Spalten bei jedem Schreibvorgang Ballast, und die Deklaration entspringt meist der Hoffnung, eine Abfrage durch bloßes Anhäufen schneller zu machen. Payload-Spalten, die nicht durchsucht werden, gehören in `include`, was nicht auf das Limit angerechnet wird.

### `where` ist strukturiert, kein SQL

```ts
indexes: [{
    columns: ["publishDate"],
    where: { column: "status", op: "=", value: "published" },
    reason: "public feed: published posts by date",
}]
```

Der Index enthält dann nur veröffentlichte Zeilen und bleibt klein, wenn sich Entwürfe ansammeln.

Operatoren sind `=`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `is null` und `is not null`, kombiniert mit `and`:

```ts
indexes: [{
    columns: ["assignee"],
    where: {
        and: [
            { column: "status", op: "in", value: ["open", "in_progress"] },
            { column: "archivedAt", op: "is null" },
        ],
    },
    reason: "the open-work queue, which is a fraction of the table",
}]
```

Es gibt bewusst kein `or`. Ein OR-Prädikat bedeutet fast immer, dass der Index überhaupt nicht partiell sein sollte; wenn Sie wirklich eines benötigen, deklarieren Sie zwei Indizes.

Ein Prädikat ist eine Struktur statt eines Strings, da ein String nicht gegen die Spalten der Tabelle geprüft werden könnte, kein Fingerprint davon erstellt werden könnte, ohne seinen eigenen Text in den Indexnamen einzufügen – eine Neuformatierung würde also einen produktiven Index umbenennen – und es wäre die einzige Stelle, an der ein Aufrufer nach einer Erweiterungs-Operatorklasse greift, die der Planer nicht wiederholen kann.

### `unique` gilt nur für zusammengesetzte Indizes

Eindeutigkeit für einzelne Spalten ist `.unique()` auf der Spalte, und dies auch hier zu deklarieren, wird abgelehnt, anstatt als Synonym akzeptiert zu werden. `.unique()` kompiliert zu einem Inline-`UNIQUE`, dessen zugrunde liegenden Index Postgres – nicht Rebase – `<table>_<column>_key` nennt.

```ts
indexes: [{ columns: ["workspaceId", "slug"], unique: true, reason: "one slug per workspace" }]
```

### `include` ermöglicht einen Index-Only-Scan

Payload-Spalten befinden sich in den Blattseiten: nicht durchsuchbar, nicht sortiert, und sie sparen einen Heap-Fetch auf Kosten eines größeren Index. Sie dürfen sich nicht mit `columns` überschneiden.

```ts
indexes: [{ columns: ["status"], include: ["title"], reason: "the status sidebar counts, without touching the heap" }]
```

### `using`

`btree` (der Standard) beantwortet Gleichheit, Bereiche, `ORDER BY` und Eindeutigkeit.

`gin` dient der Enthaltensein-Prüfung (Containment) über einer Array- oder `jsonb`-Spalte. `brin` ist für eine natürlich geordnete Spalte auf einer Append-only-Tabelle gedacht – winzig und nutzlos in dem Moment, in dem Zeilen in ungeordneter Reihenfolge eintreffen. Keiner von beiden besitzt eine Sortierung, daher sind `direction` und `nulls` bei ihnen nicht darstellbar, anstatt später von Postgres abgelehnt zu werden.

Es gibt kein `gist` und kein `hash`: Jede interessante Gist-Operatorklasse wird in einer Extension mitgeliefert, und Hash-Indizes können weder eindeutig, zusammengesetzt noch sortiert sein. Diese Einschränkung hält das gesamte Modell auf dem Atlas-Pfad – `rebase db push` materialisiert den Soll-Zustand in einer leeren Scratch-Datenbank, um dagegen zu planen, und `CREATE EXTENSION` kann nicht in dieser Datei stehen. **Trigramm-Suche ist [`search:`](/docs/backend/search); ANN ist eine [`col.vector()`-Spalte](/docs/sdk/aggregates-and-search#the-index).** Ein Index, der `gin_trgm_ops` oder `vector_cosine_ops` benötigt, wird zur Build-Zeit abgelehnt, anstatt ausgegeben zu werden, um später an einer Datenbank zu scheitern, die Sie noch nie gesehen haben.

### `reason`

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Es ist das einzige Feld, hinter dem kein SQL steht, und es ist optional – aber schreiben Sie es.

Ein Index ist das Einzige, was ein Schema deklarieren kann, das dauerhaft Geld kostet und dessen Nutzen in der Konfiguration unsichtbar ist. Die Begründung („reason“) wird neben „0 Scans in 34 Tagen, 412 MB“ ausgegeben – genau der Moment, in dem jemand in der Lage ist zu entscheiden, ob er gelöscht werden soll. Ohne sie kann niemand entscheiden, also tut es niemand, und die Tabelle häuft für die Lebensdauer des Produkts Indizes an.

Sie ist bewusst **kein** Teil der Identität des Index – das Umformulieren einer Begründung baut einen Index niemals neu auf.

## Wie eine Deklaration benannt wird

`<table>_<columns>_ix_<7 hex>`, oder `_ux_`, wenn eindeutig. Zum Beispiel `posts_status_publish_date_ix_a91c3f4`.

Der Hash bezieht sich auf die *Semantik* des Index – Methode, Spalten, Reihenfolge, Eindeutigkeit, enthaltene Spalten, Prädikat – und nicht auf sein gerendertes SQL, sodass eine Änderung der DDL-Formatierung von Rebase niemals etwas in Ihrer Datenbank umbenennt.

Der Hash ist tragend. `CREATE INDEX IF NOT EXISTS` gleicht über den **Namen** ab, nicht über die Definition: Bei einem lesbaren Namen würde das Ändern einer Deklaration den alten Index beibehalten und für immer Erfolg melden. Mit dem Hash im Namen ist eine Neudefinition ein anderes Objekt, sodass es erstellt und das alte gelöscht wird.

Zwei Konsequenzen, die erwähnenswert sind:

- **Das Ändern einer Deklaration ist ein DROP und ein CREATE**, direkt ausgegeben – ohne `CONCURRENTLY` und mit einem Zeitfenster dazwischen, in dem kein Index existiert. Auf einer Entwicklungsdatenbank ist das in Ordnung; auf einer großen Produktivtabelle sollten Sie dies zu einem von Ihnen gewählten Zeitpunkt anwenden.
- Der Name ist [ein festgeschriebener abgeleiteter Name (frozen derived name)](/docs/architecture/schema-as-code). Er steht in `contracts/derived-names.txt` und kann sich über Releases hinweg nicht ändern.

## Wem ein Index gehört

`_ix_`/`_ux_` plus sieben Hexadezimalzeichen ist für keinen anderen Namensgenerator hier erreichbar – `_fkey`, `_gin`, `_trgm`, `_pkey`, `_key`, die Vektordistanzen, das `idx_`-Präfix von Auth. Der Name allein entscheidet also über die Eigentümerschaft:

| Der Index | Im Plan? | Von Rebase benannt? | Was passiert |
|---|---|---|---|
| deklariert | ja | ja | erstellt, dann beibehalten |
| Deklaration gelöscht | nein | ja | wie beabsichtigt **gedroppt (gelöscht)** |
| manuell geschrieben oder aus Introspektion | nein | nein | **ausgeschlossen – wird niemals angetastet** |

Keiner der Fälle erfordert eine Bestätigung. Das Löschen einer Deklaration *sollte* den Index stillschweigend entfernen; was niemals gelöscht werden darf, ist ein Index, den Rebase nicht erstellt hat. Das macht auch den Introspektions-Roundtrip sicher: Die vorhandenen Indizes einer Datenbank, auf die Sie Rebase verweisen, sind fremd, bis jemand sie deklariert.

### Einen bereits vorhandenen Index deklarieren

Wenn Sie einen Index deklarieren, den die Datenbank unter einem anderen Namen bereits besitzt, übernimmt Rebase diesen Index, anstatt eine zweite Kopie zu erstellen. Bevor ein fehlender deklarierter Index erstellt wird, suchen `rebase db push`, `rebase db migrate` und der Boot-Vorgang nach einem vorhandenen Index auf derselben Tabelle, der in allen Teilen mit ihm übereinstimmt. Eine Übereinstimmung wird mit `ALTER INDEX … RENAME TO …` auf den deklarierten Namen umbenannt, was den Katalog ändert und nichts neu aufbaut. Von da an ist es der deklarierte Index: anhand des Namens auffindbar, beibehalten und gelöscht, wenn die Deklaration entfernt wird.

Diese Teile müssen alle übereinstimmen:

- die Zugriffsmethode;
- Eindeutigkeit;
- die Schlüsselspalten in Reihenfolge, jeweils mit ihrer Richtung und `NULLS`-Platzierung (Richtung zählt nur für `btree`);
- die `INCLUDE`-Spalten;
- das Prädikat. Anführungszeichen, Literal-Casts und Klammern von Postgres werden ignoriert; alles andere, was abweicht, bedeutet keine Übereinstimmung.

Rebase lässt einen bestehenden Index unberührt und erstellt den deklarierten daneben, wenn sich dieser Index in einem dieser Teile unterscheidet. Es lässt ihn auch unberührt, wenn ein Schlüssel ein Ausdruck ist, ein Schlüssel eine nicht standardmäßige Operatorklasse oder Sortierreihenfolge (Collation) verwendet, der Index ein Constraint absichert, der Index `INVALID` ist oder er bereits einen Rebase-Namen hat.

`rebase db generate` schreibt jeden deklarierten Index als `CREATE INDEX IF NOT EXISTS` in die Migration, sodass die Anweisung erfolgreich ist, wenn `rebase db migrate` gerade einen vorhandenen Index auf diesen Namen umbenannt hat.

## Wann sie erstellt werden

Beide Producer geben sie aus, was wichtig ist, da nicht jedes Deployment `db push` ausführt:

- **`rebase db push` / `rebase db generate`** legen sie in `schema.sql` auf dem gewöhnlichen Atlas-Pfad ab – so erhalten sie Migrationen, Drift-Erkennung und Rollbacks wie jedes andere Objekt.
- **`rebase schema generate`** schreibt sie auch in `schema.generated.ts`, sodass das Drizzle-Schema dieselbe Tabelle beschreibt, die die Datenbank besitzt. Die `INCLUDE`-Spalten eines abdeckenden Index sind die einzige Ausnahme: Drizzle kann diese nicht ausdrücken, und die generierte Zeile enthält einen entsprechenden Kommentar, der auf `schema.sql` verweist, wo dies möglich ist.
- **Schema Ensure beim Booten** erstellt sie ebenfalls, zu denselben Bedingungen wie die daneben liegenden Such- und ANN-Indizes. Ein Managed-Runtime-Mandant wird beim Booten bereitgestellt und führt niemals `db push` aus; ohne diesen Schritt würde er ohne seine deklarierten Indizes starten, ohne dass dies gemeldet würde. Eine Tabelle, die beim Booten erstellt wird, erhält ihre Indizes zusammen mit der Tabelle. Bei einer bereits vorhandenen Tabelle erstellt der Boot-Vorgang einen fehlenden Index im Hintergrund, nachdem der Server Anfragen bedient – genau so, wie er die [Fremdschlüssel-Indizes](#was-ein-upgrade-mit-einer-bestehenden-datenbank-macht) erstellt. Er verwendet `CREATE INDEX CONCURRENTLY` auf einer eigenen Verbindung, sodass das 30-Sekunden-`statement_timeout` des Pools einen langen Build-Vorgang nicht abbrechen kann. Ein Index, der durch einen unterbrochenen Build unter seinem Namen als `INVALID` zurückgelassen wurde, wird gelöscht und erneut erstellt. `IF NOT EXISTS` gleicht über den Namen ab, repariert also niemals einen solchen Index. Ein `unique`-Index wird auf dieselbe Weise erstellt, jedoch bevor der Server Anfragen bedient, und das Booten schlägt fehl, wenn er nicht erstellt werden kann. Anfragen ohne ihn zu bedienen, würde Duplikate in den Zeilen zulassen.

## Fremdschlüssel werden automatisch für Sie indiziert

Postgres erstellt den Index, auf den ein Fremdschlüssel *zeigt* – den Primärschlüssel des Ziels –, aber niemals einen auf der Spalte, die ihn *enthält*. Jeder Lesevorgang von der anderen Seite einer Verknüpfung filtert nach dieser Spalte: ein `hasMany`- oder `hasOne`-Include, eine verschachtelte Auflistung wie `/authors/5/posts` (deren Seite und Zählung), die Rückseite eines `manyToMany` und die `ON DELETE`-Prüfung, wenn eine übergeordnete Zeile gelöscht wird. Ohne einen Index liest jeder dieser Vorgänge jede Zeile der untergeordneten Tabelle.

Daher leitet Rebase einen einfachen btree ab für:

- den `localKey` jedes [`belongsTo`](/docs/collections/relations/#belongsto--the-key-is-on-this-table) – was auch die Spalte ist, die das `hasOne` / `hasMany` der Gegenseite liest;
- die Zielspalte jeder `manyToMany`-Verbindungstabelle (Junction). Der Primärschlüssel der Verbindungstabelle `(source, target)` bedient bereits Lookups nach der Quellspalte; die Rückseite der Verknüpfung benötigt diesen Index. Eine Verbindungstabelle ist eine Tabelle von Rebase, daher gibt es hierfür kein Opt-out.

Gemessen auf Postgres 18 mit warmem Cache, 1 Mio. Kommentare auf 50.000 Beiträge:

| Der Lesevorgang | Ohne den Index | Mit ihm |
|---|---|---|
| `include=comments` auf einer Seite mit 25 Beiträgen (`post_id IN (…)`) | 38 ms | 0.3 ms |
| `GET /posts/77/comments?limit=25` – die Seite | 28 ms | 0.3 ms |
| … und dessen `count(*)` | 29 ms | 0.2 ms |
| Löschen eines Beitrags (`ON DELETE SET NULL`-Prüfung) | 129 ms | 1.7 ms |

Nichts wird doppelt indiziert. Der abgeleitete Index wird übersprungen, wenn die Spalte bereits den Primärschlüssel anführt, ein `UNIQUE` trägt (`.unique()` auf einer gebundenen Spalte oder `unique: true` auf der Relation) oder einen Index in `indexes:` anführt – einfach oder zusammengesetzt, solange es sich um einen btree ohne `where` handelt. Ein partieller Index kann keinen Lookup bedienen, der jede Zeile erreichen muss, und ein GIN- oder BRIN-Index beantwortet eine andere Fragestellung, weshalb beide nicht zählen.

Der Name ist derjenige, den [eine Deklaration](#wie-eine-deklaration-benannt-wird) eines einfachen Index auf dieser Spalte ableitet – `posts_author_id_ix_00ad191` –, sodass der abgeleitete Index und `indexes: [{ columns: ["author"], … }]` ein einziges Objekt sind, nicht zwei. Es ist wie jeder andere ein [festgeschriebener abgeleiteter Name](/docs/architecture/schema-as-code).

Um das Constraint beizubehalten und den Index zu verwerfen – bei einer Tabelle mit so vielen Schreibzugriffen, dass der Index mehr kostet als die Lookups, die er bedient, oder bei einer, bei der Sie einen eigenen Index außerhalb von `indexes:` pflegen –, geben Sie dies auf der Relation an:

```ts
relations: {
    author: rel.belongsTo(() => authors, { index: false }),
}
```

`index` existiert nur bei `belongsTo`: Bei den anderen Arten ist der Fremdschlüssel eine Spalte auf dem Ziel (setzen Sie `index` auf dem `belongsTo` des Ziels) oder in einer Verbindungstabelle.

Rebase liest ausschließlich Ihre Tabellen, um dies zu entscheiden, niemals die Datenbank: `db push` und der Boot-Vorgang müssen denselben Satz von Indizes mit denselben Namen ermitteln, da der nächste Push sonst löschen würde, was der Boot-Vorgang aufgebaut hat. Ein Index, den Sie manuell auf derselben Spalte außerhalb von `indexes:` geschrieben haben, wird daher nicht erkannt – deklarieren Sie ihn in `indexes:` oder setzen Sie `index: false`, um einen Index statt zweier zu behalten.

### Was ein Upgrade mit einer bestehenden Datenbank macht

Die Indizes sind neue Objekte auf Tabellen, die bereits Daten enthalten, und die beiden Wege bauen sie unterschiedlich auf:

- **Der Boot-Vorgang wartet nicht auf sie.** Auf einer Tabelle, die bereits existiert, lässt das Schema-Ensure die fehlenden Fremdschlüssel-Indizes beim Booten außen vor und baut sie nacheinander im Hintergrund auf, nachdem der Server bereits Anfragen bedient – mittels `CREATE INDEX CONCURRENTLY` auf einer eigenen Verbindung (das 30-Sekunden-`statement_timeout` des Pools gilt dafür nicht). Dies erfordert keine Sperren, auf die Lese- oder Schreibvorgänge warten müssten. Eine Tabelle, die von einer anderen Sitzung blockiert wird – der Build einer anderen Instanz, ein `ALTER TABLE` –, wird innerhalb des Sperr-Budgets des Boot-Vorgangs aufgegeben und beim nächsten Booten erneut versucht. Ein Index, der durch einen unterbrochenen Build als `INVALID` zurückgelassen wurde (ein Deployment, das den Prozess mitten im Build ersetzt hat, oder zwei Instanzen, die um denselben Namen konkurrieren), wird gelöscht und erneut gebaut. Jeder Index wird protokolliert, wenn er beginnt und abgeschlossen ist; ein Fehler ist eine Warnung, niemals ein Boot-Fehler. Eine Tabelle, die durch diesen Boot-Vorgang erstellt wird, erhält ihre Indizes zusammen mit der Tabelle, bevor irgendetwas darauf schreiben kann. Unter `REBASE_PROVISION_ONLY` laufen die Builds, bevor der Prozess beendet wird, da danach nichts mehr da wäre, um sie auszuführen.
- **`rebase db push` baut sie auf, bevor es plant**, mit demselben Builder und zu denselben Bedingungen wie der Boot-Vorgang: `CREATE INDEX CONCURRENTLY`, nacheinander, sodass Lese- und Schreibvorgänge während der Ausführung fortgesetzt werden können (etwa 0,4 s bei 1 Mio. Zeilen und 6 s bei 10 Mio. Zeilen als einfacher Build auf einer Laptop-SSD, `maintenance_work_mem` 64 MB; ein nebenläufiger Build dauert länger, blockiert jedoch nichts). Atlas findet dann jeden Index an Ort und Stelle vor und plant nichts dafür. Ein Index, der nicht vorab gebaut werden konnte – weil eine Tabelle für das gesamte Sperr-Budget von einer anderen Sitzung gehalten wurde –, wird Atlas überlassen, das ihn innerhalb der Push-Transaktion aufbaut und somit Schreibvorgänge auf diese Tabelle für die Dauer des Builds blockiert; der Push gibt an, welche betroffen sind. Eine Fremdschlüsselspalte, die der Push selbst hinzufügt, erhält ihren Index von Atlas zusammen mit der Spalte, bevor irgendwelche Daten darin sind. `--dry-run` baut nichts: Es benennt die Indizes, die ein echter Push vorab bauen würde, und der ausgegebene Plan listet sie auf, da sie noch nicht existieren.

## Was abgelehnt wird und wann

<span class="since-badge" data-since="0.31">Seit 0.31</span>

All dies wird abgelehnt, wenn das Schema kompiliert wird, unter Nennung der Tabelle und der Position im Array – ein Index, der stillschweigend nicht existiert, ist genau der Fehler, den dieses gesamte Feature beseitigt:

- ein Schlüssel, der keine Spalte oder `belongsTo`-Relation der Tabelle ist, oder eine Relation, deren Fremdschlüssel sich auf der anderen Tabelle befindet
- mehr als fünf Schlüssel in `columns` oder dieselbe Spalte zweimal
- exakt die Spalten des Primärschlüssels – `<table>_pkey` indiziert diese bereits
- eine Spalte sowohl in `columns` als auch in `include`
- `unique` auf einer einzelnen Spalte, die bereits `.unique()` deklariert
- `direction` oder `nulls` unter `gin` oder `brin`
- eine `in`-Liste, die einen Wert wiederholt
- zwei Deklarationen, die denselben Namen ableiten – sie sind derselbe Index, doppelt
- ein leerer `reason`

## Verwandte Themen

<span class="since-badge" data-since="0.31">Seit 0.31</span>

- [Suche](/docs/backend/search) – bewertete Volltextsuche (ranked full-text), die ihren eigenen GIN-Index über einem generierten `tsvector` erstellt
- [Vektorsuche](/docs/sdk/aggregates-and-search#vector-search) – der ANN-Index über einer Embedding-Spalte, konfiguriert über `col.vector()`
- [Schema as Code](/docs/architecture/schema-as-code) – wie Deklarationen die Datenbank erreichen und was ein abgeleiteter Name ist
- [Tabellen](/docs/schema/) – jeder Schlüssel von `defineTable`
