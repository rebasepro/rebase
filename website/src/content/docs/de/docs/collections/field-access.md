---
sourceHash: f55095351eb33abe
title: Feldzugriff
sidebar_label: Feldzugriff
description: "Lese- und Schreibberechtigungen pro Spalte nach Rolle mit .access(), Spalten, die den Server nie verlassen mit .private(), und Spalten, die Clients nicht schreiben können mit .readOnly(). Ein Aufrufer, den die Richtlinien der Zeile durchlassen, erhält dennoch keine Spalte, die seine Rollen nicht lesen dürfen."
---

<span class="since-badge" data-since="0.31">Seit 0.31</span>

[Sicherheit auf Zeilenebene (Row-level security)](/docs/collections/security-rules/) entscheidet, welche **Zeilen** ein
Aufrufer erreicht. Drei Spaltenmodifikatoren entscheiden, welche **Spalten einer erreichten Zeile**
er sieht und setzen darf:

| Modifikator | Lesen | Schreiben |
|---|---|---|
| `.access({ read, write })` | die Rollen in `read`, falls angegeben | die Rollen in `write`, falls angegeben |
| `.private()` | niemand, über die API | niemand, über die API |
| `.readOnly()` | wie die Zeile | niemand, über die API |

Relationen übernehmen dieselben Regeln als Optionen: `rel.*(target, { access: { read, write } })`
und `rel.*(target, { private: true })`.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const staff = defineTable("staff", {
    columns: {
        id:     col.integer().primaryKey().generatedByDefaultAsIdentity(),
        name:   col.text().notNull(),
        // Read by HR (and admins). Set by nobody through the API.
        salary: col.numeric({ precision: 10, scale: 2 }).access({ read: ["hr"], write: [] }),
    },
    rls: [{ operation: "select", access: "public" }],
});
```

Die obige Regel setzt keinen Zeilenfilter auf `select`, sodass jeder Aufrufer, den die API hineinlässt,
jede Mitarbeiterzeile liest. Nur ein Aufrufer mit der Rolle `hr` erhält die Spalte `salary`
einer Zeile, und niemand setzt sie über HTTP.

## Die Regel

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`.access()` akzeptiert zwei optionale Listen, und eine weggelassene Liste ist keine leere Liste —
dieser Unterschied macht das gesamte Feature aus.

| `read` / `write` | Bedeutung |
|------------------|-----------|
| weggelassen | An die Zeile delegieren. Jeder, der die Zeile laut `rls` der Tabelle lesen (oder schreiben) darf, erhält die Spalte. |
| `[]` | Niemand, über die API, mit keinem Privileg — nicht `admin`, nicht der Service-Schlüssel, kein prozessinternes Lesen. |
| `["hr"]` | Ein Aufrufer mit `hr` **oder** `admin` **oder** vertrauenswürdiger Servercode ohne dahinterstehenden Request. |

Rollen sind Rebase-Anwendungsrollen — dieselben, die `rebase.roles()` innerhalb
einer Richtlinie zurückgibt und gegen die `policy.rolesOverlap` kompiliert. Sie stammen aus dem
Aufrufkontext: `user.roles` im authentifizierten Request.

### Warum `admin` immer durchkommt

Jede von Rebase injizierte Baseline-Richtlinie enthält einen `rolesOverlap(['admin'])`-Zweig, und
`rebase.dataAsAdmin` wird als `{ uid: "service", roles: ["admin"] }` ausgeführt. Eine Feldregel,
die einen Administrator von einer Spalte seiner eigenen Datenbank aussperren könnte,
würde auch das Studio daran hindern, sie zu rendern, und die CLI daran, sie zu exportieren. Wenn Sie
eine Spalte benötigen, die kein Administrator über die API liest, entspricht das `read: []`.

### Warum die vertrauenswürdige Ebene durchkommt

Servercode ohne dahinterstehenden Request — eine Migration oder der Auth-Adapter,
der ein Passwort überprüft — liest völlig ohne Rollen, und eine Rollenliste
gilt dafür nicht. `[]` gilt dennoch: Das ist eine Aussage über die API-Oberfläche
und nicht darüber, wer aufruft.

Das `context.data` eines Hooks ist nicht diese Ebene. Innerhalb eines Requests liest es mit den
Rollen des Aufrufers, sodass die Feldregeln auf das, was es liest, genauso zutreffen
wie auf den Request: Der Treiber selbst verweigert einen Filter, eine Sortierung, eine Projektion, ein Include,
eine Vektorsuche, ein Aggregat oder eine Eindeutigkeitsprüfung, die eine Spalte benennt, die diese Rollen
nicht lesen können (`FIELD_NOT_READABLE`), und antwortet auf einen `.private()`-Namen wie auf
einen Tippfehler — genauso wie REST und der Socket.

## `.private()` und `.readOnly()` nutzen denselben Mechanismus

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`.private()` entspricht `.access({ read: [], write: [] })`, mit einem Unterschied: Eine
private Spalte wird auch in OpenAPI, den SDK-Typen und den MCP-Tool-Schemas
weggelassen, sodass ihr Name ebenfalls nicht öffentlich ist (siehe [Abfragen](#abfragen)). Eine Spalte
kann nicht sowohl `.private()` sein als auch `.access()` deklarieren; das Schema wird abgelehnt.

`.readOnly()` entspricht `write: []`: Niemand schreibt die Spalte über die API, unabhängig
von seiner Rolle, während Standardwerte, Trigger und Servercode sie weiterhin befüllen. Lesevorgänge
werden der Zeile überlassen oder `.access({ read })`, wenn beides angegeben ist.

## Was ein Aufrufer sieht

### Lesevorgänge

Ein Feld, das Sie nicht lesen dürfen, ist in der Antwort **nicht vorhanden**. Nicht `null`, kein leerer
String — der Schlüssel existiert nicht.

```json
// GET /api/data/staff/1  as a caller holding `staff`
{ "id": 1, "name": "Ada" }

// the same row as a caller holding `hr`
{ "id": 1, "name": "Ada", "salary": 90000 }
```

Das ist Absicht. Ein vorenthaltener Wert, der als `null` ausgeliefert wird, ist nicht von einem
gespeicherten `null` zu unterscheiden, sodass ein Client die gesamte Spalte durch Zählen abbilden könnte — und ein
`update`, das die Zeile zurücksendet, würde den echten Wert mit dem übergebenen Null-Wert überschreiben.

Dies gilt an jedem Ausgang: Liste, einzelner Abruf, mit `?include=` eingebundene Relationsziele,
`_batch`-Ergebnisse, Echtzeit-Frames von `.listen()`, Aggregat-Ergebnisse
und [Verlaufs-Snapshots](#verlauf).

Der Wert einer Relation besteht aus ihren verknüpften Zeilen, daher wird eine Relation, die Sie nicht lesen dürfen,
vollständig vorenthalten. `?include=` lässt sie aus der Zeile weg, mitsamt ihrem `_count`, an
jeder Schnittstelle: REST, das SDK, `.listen()` und verschachtelte Includes eine Ebene tiefer.
Wird sie an anderer Stelle benannt, wird dies wie bei einem Feld verweigert (siehe [Abfragen](#abfragen)).

### Abfragen

Ein `where`, `orderBy`, `fields`, Aggregat-`select` oder `groupBy`, das ein Feld benennt, das Sie
nicht lesen dürfen, führt zu einem **400 `FIELD_NOT_READABLE`**. Dasselbe gilt für einen Filter über eine Relation
auf ein Feld ihres Ziels, das Sie nicht lesen dürfen (`?author.salary=gt.1`), eine Aggregat-Sortierung
darüber (`orderBy=max(staff.salary)`) und eine Relation, die Sie nicht lesen dürfen,
benannt in einem verschachtelten Pfad (`/departments/1/members`, `/departments/1/members/7`) oder
einer Aggregat-Sortierung (`orderBy=count(members)`):

```http
GET /api/data/staff?salary=gt.100000
```

```json
{
  "error": {
    "code": "FIELD_NOT_READABLE",
    "message": "'salary' is not readable on table 'staff' with your roles, so it cannot be used in a filter.",
    "details": {
      "collection": "staff",
      "fields": ["salary"],
      "violations": [
        { "field": "salary", "code": "access", "message": "'salary' is not readable with your roles." }
      ]
    }
  }
}
```

Ohne dies wäre der Wert Prädikat für Prädikat lesbar: Zwanzig Requests entsprechen
einer binären Suche über ein Gehalt.

Der Fehler **nennt das Feld beim Namen**. Das ist eine bewusste Entscheidung, kein Versehen: Das
veröffentlichte OpenAPI-Dokument listet jede Spalte jeder Tabelle auf — es wird
über die App ausgeliefert, nicht über den authentifizierten Daten-Router — Feldnamen
sind also bereits öffentlich. Den Namen hier zu verbergen, würde nichts schützen und würde auf
einen echten Tippfehler eines Aufrufers mit "unbekanntes Feld" antworten, was ihn nach einem Rechtschreibfehler
suchen ließe, den es gar nicht gibt. **Feldnamen sind öffentlich; Feldwerte sind es nicht.**

Ausgenommen sind die Spalten von `.private()`. OpenAPI, `describe_table` und das generierte
SDK lassen sie weg, sodass ihr Name nicht öffentlich ist, und "nicht lesbar" würde bestätigen,
dass sie existieren. Ein Filter, `orderBy`, `fields`, `include`, Aggregat-`select` oder
`groupBy` oder `vector_search`, der eine solche Spalte benennt, erhält genau die Antwort, die ein falsch geschriebener Name
erhält — `UNKNOWN_FILTER_FIELD`, `UNKNOWN_ORDER_BY_FIELD`, `UNKNOWN_FIELD`,
`UNKNOWN_RELATION`, `UNKNOWN_AGGREGATE_FIELD` oder `UNKNOWN_VECTOR_PROPERTY`, mit derselben Meldung und denselben Details — und keine Antwort zu unbekannten Feldern listet sie unter den gültigen
Feldern auf.

### Schreibvorgänge

Ein Wert für ein Feld, das Sie nicht schreiben dürfen, führt zu einem **400**, niemals zu einem stillschweigend verworfenen Schlüssel —
ein Schreibvorgang, der ein Feld verwirft, würde Erfolg für eine Bearbeitung melden, die nicht stattgefunden hat.

| Code | Wann |
|------|------|
| `FIELD_NOT_WRITABLE` | `write` ist eine Rollenliste, die Sie nicht erfüllen. Ihr Kollege erhält möglicherweise ein 200 für denselben Body. |
| `VALIDATION_EXCLUDED_FIELDS` | `write` ist `[]`, oder die Spalte ist `.private()` oder `.readOnly()`. Niemand darf sie schreiben; die Antwort ist für jeden Aufrufer gleich. |

Beide enthalten `details.violations`, geschlüsselt nach dem von Ihnen gesendeten Wire-Namen. Wird erzwungen bei
Erstellung, `PATCH`/`PUT`, `/bulk`, `_batch`, Upserts, Feldoperationen
(`{ "salary": { "$inc": 1000 } }` benennt `salary` wie jeder andere Wert auch) und dem
WebSocket-`SAVE`-Frame.

Eine Feldoperation benötigt außerdem `read`-Rechte auf ihrem Feld. Eine Operation auf einem Feld, das Sie
schreiben, aber nicht lesen dürfen, wird mit `FIELD_NOT_READABLE` verweigert: Ob sie eine
Grenze überschritten hat, würde Ihnen den Wert verraten, den Sie nicht sehen dürfen.

### Ein Link folgt seiner Schlüsselspalte

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Ein `belongsTo` und die Schlüsselspalte, an die es gebunden ist, sind ein Feld mit zwei
Schreibweisen. Das Schreiben von `{ "reviewer": 7 }` unterliegt jeder Regel von `reviewerId`
(seiner Schreibregel, `.readOnly()`, `.private()`, einem Erstellungs-Zeitstempel, der Mandanten-Spalte);
das Senden von beidem mit unterschiedlichen Werten führt zu `400 VALIDATION_INVALID_VALUE`.
Ein Aufrufer, der `reviewerId` nicht lesen darf, erhält `reviewer` nicht in einem `include`,
und ein Filter-, Sortier- oder `fields`-Eintrag, der es benennt, antwortet mit `FIELD_NOT_READABLE`;
hinter einem `.private()`-Schlüssel existiert die Relation für Clients überhaupt nicht. Der
Schema-Endpunkt, OpenAPI und MCP beschreiben die beiden gemeinsam.

Dasselbe gilt für jede Relation, über alles, was ihr Join liest: Ein
`hasMany` / `hasOne` liest den Fremdschlüssel des Ziels, ein `via` jede Spalte, über die
seine Schritte joinen, in jeder Tabelle, die es durchläuft. Ein Aufrufer, der eine
dieser Spalten nicht lesen darf, erhält die Relation weder in einem `include` noch in einem `_count`, erhält
`FIELD_NOT_READABLE` beim Filtern oder Sortieren darüber (eine unbekannte Relation, wenn
die Spalte `.private()` ist), und sieht sie nicht beschrieben.

Ein `via` über eine Tabelle, die der Server nicht bereitstellt — eine, die er vorenthält
(`TABLE_WITHHELD`), oder eine, die seine Tabellen nicht deklarieren —, ist für jeden
Aufrufer geschlossen, vertrauenswürdiger Code eingeschlossen: Seine Join-Spalten gelten als nicht lesbar und
nicht schreibbar, daher wird es in `include` weggelassen, und ein Filter, eine Sortierung oder ein Pfad
darüber wird verweigert (`FIELD_NOT_READABLE` oder `503 TABLE_WITHHELD` unter Nennung der
vorenthaltenen Tabelle).

Ein `manyToMany`, dessen Verknüpfungstabelle (Junction) eine von Ihnen deklarierte Tabelle ist (`through` benennt ein
`defineTable`), unterliegt den Spaltenregeln dieser Tabelle: Ein Schreibvorgang, der eine Verknüpfungsspalte setzt,
die auf der Junction `.readOnly()`, `.private()` oder durch `access.write` geschlossen ist,
wird verweigert (`VALIDATION_EXCLUDED_FIELDS` / `FIELD_NOT_WRITABLE`), ebenso wie ein
`_pivot`-Feld, das die Junction schließt. Dasselbe gilt über die verschachtelten Routen
(`POST`, `PATCH` und `DELETE /:table/:id/:relation/:targetId` und eine `_pivot`-Bearbeitung)
und den WebSocket. Eine von Rebase erstellte Verknüpfungstabelle hat keine eigenen Regeln.

`strictWrites: false` an einer Tabelle lässt lediglich einen Schlüssel, den die Tabelle nicht deklariert,
zum Treiber durch. Es lockert niemals eine Regel für eine deklarierte Spalte, einen Zeitstempel,
den Mandanten, den Schlüssel, ein Relationsziel oder `_pivot`.

## Suche

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Die Fallback-Suche — eine Tabelle ohne `search`-Block — gleicht mittels `ILIKE` über
Ihre Textspalten ab und überspringt diejenigen, die der Aufrufer nicht lesen darf. Nichts sickert
dadurch durch.

Eine Tabelle, die **tatsächlich** einen [`search`-Block](/docs/backend/search) deklariert, kompiliert
zu einer einzelnen generierten `tsvector`-Spalte, die von allen Aufrufern geteilt wird. Es gibt keine
rollenbasierte Variante davon, sodass eine eingeschränkte Spalte, die in `search.fields` benannt ist,
für Aufrufer, die ihren Wert niemals sehen können, *abgleichbar* bliebe — Begriff für Begriff
rekonstruierbar. Das Schema wird bei dieser Kombination abgelehnt: Entfernen Sie die Spalte aus
`search.fields` oder heben Sie die Leseeinschränkung auf. Eine `tenant`-Spalte kann ebenfalls nicht
lesebeschränkt werden.

## Verlauf

Der [Entitätsverlauf](/docs/backend/history) speichert die gesamte Zeile und wird jedem bereitgestellt,
der die Zeile lesen kann — die Zugangsvoraussetzung lautet "kannst du diese Entität abrufen", nicht "bist
du ein Admin". Die Leseregel wird daher auch auf jeden gespeicherten Snapshot angewendet: Der Eintrag
wird weiterhin aufgelistet, mit der Information, wer ihn wann geändert hat, und die vorenthaltenen Spalten sind
aus seinen `values` entfernt.

Das Zurücksetzen (Revert) ist davon nicht betroffen. Die Revert-Route liest den gespeicherten Eintrag serverseitig, sodass ein
Aufrufer eine Version wiederherstellen kann, von der er nicht jedes Feld sehen kann — genau so, wie er
bereits eine Zeile überschreiben kann, ohne sie vollständig zu lesen.

## Was das CMS anzeigt

Nichts zu konfigurieren. Das CMS liest über dieselbe API, sodass eine Spalte, die der
Aufrufer nicht lesen darf, niemals ankommt und das Formular sie nicht zeichnet; eine Spalte, die er
nicht schreiben darf, wird verweigert, falls versucht wird, sie zu senden. Dies ist eine serverseitige
Garantie, im Gegensatz zum Ausblenden eines Felds im CMS, was lediglich verhindert, dass es
*gerendert* wird, und den Wert im JSON belässt.

## Generierte Typen und OpenAPI

Die Typen `Row`, `Insert` und `Update` des SDKs haben für jeden Aufrufer dieselbe Gestalt —
es gibt keinen `Row`-Typ, der sowohl für einen Leser mit der Rolle `hr` als auch für einen ohne sie
passend ist — eine **Rollen**regel ändert sie daher nicht. Eine `.private()`-Spalte fehlt
in allen dreien, und eine `.readOnly()`-Spalte in `Insert` und `Update`. Die
[abgeleiteten Typen](/docs/schema/types/) folgen derselben Regel.

Das OpenAPI-Dokument gibt die Regel an, anstatt vorzugeben, pro Aufrufer spezifisch zu sein.
Jede eingeschränkte Spalte trägt `x-rebase-access`:

```json
"salary": {
  "type": "number",
  "description": "Salary — Field access: readable by `hr` (and `admin`); writable by nobody through the API. A caller without the role does not receive the field at all — it is absent, not null.",
  "x-rebase-access": { "read": ["hr"], "write": [] }
}
```

Ein Feld, das niemand lesen kann, fehlt im Lese-Schema und in den Filterparametern;
ein Feld, das niemand schreiben kann, fehlt im Eingabe-Schema. Die beiden
Richtungen sind separate Schemas und werden separat beurteilt, sodass ein Token, das ein Admin
sendet (POST) und nie wieder zurückliest, im Request-Body erscheint und nicht in der Zeile.

## Prozessinterne Schreibvorgänge

Prozessinterne Schreibvorgänge — `context.data` in einem Hook, `rebase.dataAsAdmin` in einem Hook,
einer Funktion oder einem Cron-Job — durchlaufen die Schreibprüfung nicht: `.readOnly()`,
ein feldspezifisches `access.write` und `.private()` sind Regeln der API-Grenze.
Das ist es, was die Regel überhaupt durchsetzbar macht: Irgendetwas muss in der Lage sein,
den Passwort-Hash zu speichern. Was im Prozess weiterhin gilt, gleichermaßen für eine Spalte wie für den
daran gebundenen Link: Server-Zeitstempel gewinnen gegenüber einem übergebenen Wert, eine Zeile kann den
Mandanten nicht wechseln und ihr Schlüssel kann sich nicht ändern. Sicherheit auf Zeilenebene gilt
überall.

Lesevorgänge über `rebase.dataAsAdmin` besitzen die `admin`-Rolle, sodass eine Rollenregel
nichts vor ihnen verbirgt. `[]` tut dies weiterhin — auch vor `dataAsAdmin`. Verwenden Sie
[`rebase.sql()`](/docs/backend/custom-functions), wenn Sie die rohe Spalte benötigen.

## Validierung

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`.access()` auf einer Spalte und `access` auf einer Relation werfen beim Laden des Moduls
einen Fehler, es sei denn, `read` und `write` sind Listen nicht-leerer Rollennamen: Ein String,
wo eine Liste hingehört (`read: "admin"`), wird abgelehnt, anstatt als etwas anderes
interpretiert zu werden.

Folgendes wird abgelehnt, wenn das Schema kompiliert wird, bevor der Server überhaupt Anfragen bedient:

- `.private()` und `.access()` auf derselben Spalte: Sie stellen denselben Mechanismus dar;
- eine lesebeschränkte Spalte, die in den `search.fields` der Tabelle benannt ist oder als deren
  `tenant`-Feld verwendet wird;
- ein `.private()`-Primärschlüssel: Über den Schlüssel wird jede Zeile adressiert.

Rollen*namen* werden nicht gegen eine feste Menge geprüft: Rollen sind Anwendungsdaten, die erstellt
und gelöscht werden, während der Server läuft. Ein Tippfehler darin führt zu einem Feld, das niemand lesen kann,
was die sichere Fehlerrichtung darstellt.

## Siehe auch

- [Sicherheit auf Zeilenebene (Row-level security)](/docs/collections/security-rules/) — welche Zeilen ein Aufrufer erreicht
- [Spalten](/docs/schema/columns/) — alle Spaltenmodifikatoren
- [Fehlercodes](/docs/backend/errors/) — `FIELD_NOT_READABLE`, `FIELD_NOT_WRITABLE`
