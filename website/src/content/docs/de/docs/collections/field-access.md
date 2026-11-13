---
sourceHash: 8ce5fe3122103e0c
title: Feldzugriff
sidebar_label: Feldzugriff
description: "Lese- und Schreibberechtigungen pro Spalte nach Rolle mit .access(), Spalten, die den Server nie verlassen mit .private(), und Spalten, die Clients nicht beschreiben können mit .readOnly(). Ein Aufrufer, den die Zeilenrichtlinien durchlassen, erhält dennoch keine Spalte, die seine Rollen nicht lesen dürfen."
---

<span class="since-badge" data-since="0.31">Seit 0.31</span>

[Row-level security](/docs/collections/security-rules/) entscheidet, welche **Zeilen** ein
Aufrufer erreicht. Drei Spaltenmodifikatoren bestimmen, welche **Spalten einer erreichten Zeile**
er sieht und setzen darf:

| Modifikator | Lesen | Schreiben |
|---|---|---|
| `.access({ read, write })` | die Rollen in `read`, falls angegeben | die Rollen in `write`, falls angegeben |
| `.private()` | niemand über die API | niemand über die API |
| `.readOnly()` | wie die Zeile | niemand über die API |

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

Die obige Regel setzt keinen Zeilenfilter auf `select`, sodass jeder Aufrufer, den die API
hineinlässt, jede `staff`-Zeile liest. Nur ein Aufrufer mit der Rolle `hr` erhält die Spalte
`salary` einer Zeile, und niemand kann sie über HTTP setzen.

## Die Regel

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`.access()` nimmt zwei optionale Listen entgegen, und eine weggelassene Liste ist keine leere Liste –
dieser Unterschied macht das gesamte Feature aus.

| `read` / `write` | Bedeutung |
|------------------|-----------|
| weggelassen | An die Zeile delegieren. Jeder, der die Zeile gemäß dem `rls` der Tabelle lesen (oder schreiben) darf, erhält die Spalte. |
| `[]` | Niemand über die API, mit keinerlei Berechtigung – weder `admin`, noch der Service-Key, noch ein prozessinterner Lesevorgang. |
| `["hr"]` | Ein Aufrufer mit `hr`, **oder** `admin`, **oder** vertrauenswürdiger Servercode ohne zugrunde liegenden Request. |

Rollen sind Rebase-Anwendungsrollen – dieselben, die `rebase.roles()` innerhalb
einer Policy zurückgibt und gegen die `policy.rolesOverlap` kompiliert. Sie stammen aus
dem Aufrufkontext: `user.roles` auf dem authentifizierten Request.

### Warum `admin` immer durchkommt

Jede von Rebase injizierte Baseline-Policy enthält einen `rolesOverlap(['admin'])`-Zweig, und
`rebase.dataAsAdmin` wird als `{ uid: "service", roles: ["admin"] }` ausgeführt. Eine Feldregel,
die einen Administrator aus einer Spalte der eigenen Datenbank aussperren könnte, würde
auch das Studio am Rendern und das CLI am Exportieren hindern. Wenn Sie eine Spalte benötigen,
die kein Administrator über die API lesen darf, entspricht das `read: []`.

### Warum die vertrauenswürdige Ebene durchkommt

Servercode ohne zugrunde liegenden Request – eine Migration oder der Auth-Adapter,
der ein Passwort verifiziert – liest gänzlich ohne Rollen, und eine Rollenliste
findet darauf keine Anwendung. `[]` gilt dennoch: Dies ist eine Festlegung über die API-Oberfläche
und nicht darüber, wer der Aufrufer ist.

Das `context.data` eines Hooks gehört nicht zu dieser Ebene. Innerhalb eines Requests liest es mit
den Rollen des Aufrufers, sodass die Feldregeln auf das Gelesene genau so angewendet werden wie
auf den Request: Der Treiber selbst verweigert Filter, Sortierung, Projektion, Include,
Vektorsuche, Aggregate oder Eindeutigkeitsprüfungen, die eine Spalte benennen, die diese
Rollen nicht lesen dürfen (`FIELD_NOT_READABLE`), und antwortet auf einen `.private()`-Namen
wie auf einen Tippfehler – genauso wie REST und der Socket.

## `.private()` und `.readOnly()` sind derselbe Mechanismus

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`.private()` ist `.access({ read: [], write: [] })`, mit einem Unterschied: Eine
private Spalte wird auch aus OpenAPI, den SDK-Typen und den MCP-Tool-Schemas weggelassen,
sodass ihr Name ebenfalls nicht öffentlich ist (siehe [Abfragen](#abfragen)). Eine Spalte
kann nicht gleichzeitig `.private()` sein und `.access()` deklarieren; das Schema wird abgewiesen.

`.readOnly()` entspricht `write: []`: Niemand kann die Spalte über die API beschreiben,
unabhängig von der Rolle, während Standardwerte, Trigger und Servercode sie weiterhin befüllen.
Lesevorgänge werden der Zeile überlassen oder `.access({ read })`, wenn beides angegeben ist.

## Was ein Aufrufer sieht

### Lesevorgänge

Ein Feld, das Sie nicht lesen dürfen, **fehlt** in der Antwort. Nicht `null`, kein leerer
String – der Schlüssel ist schlicht nicht vorhanden.

```json
// GET /api/data/staff/1  as a caller holding `staff`
{ "id": 1, "name": "Ada" }

// the same row as a caller holding `hr`
{ "id": 1, "name": "Ada", "salary": 90000 }
```

Das ist beabsichtigt. Ein vorenthaltener Wert, der als `null` ausgeliefert wird, ist von einem
gespeicherten `null` nicht zu unterscheiden, sodass ein Client die gesamte Spalte durch Zählen
abbilden könnte – und ein `update`, das die Zeile zurücksendet, würde den echten Wert mit dem
übergebenen Nullwert überschreiben.

Dies gilt an jedem Ausgangspunkt: Listenabfragen, einzelne Gets, mit `?include=` eingebundene
Relationsziele, `_batch`-Ergebnisse, Realtime-Frames von `.listen()`, Aggregat-Ergebnisse
und [Verlaufs-Snapshots](#verlauf).

Der Wert einer Relation besteht aus ihren verknüpften Zeilen, daher wird eine Relation,
die Sie nicht lesen dürfen, vollständig vorenthalten. `?include=` lässt sie samt ihrem `_count`
an jeder Schnittstelle aus der Zeile heraus: REST, dem SDK, `.listen()` sowie verschachtelten
Includes eine Ebene tiefer. Die Benennung an beliebiger anderer Stelle wird wie bei einem Feld
abgewiesen (siehe [Abfragen](#abfragen)).

### Abfragen

Ein `where`, `orderBy`, `fields`, Aggregat-`select` oder `groupBy`, das ein Feld benennt,
welches Sie nicht lesen dürfen, führt zu einem **400 `FIELD_NOT_READABLE`**. Das Gleiche gilt
für einen Filter über eine Relation auf ein nicht lesbares Feld ihres Ziels (`?author.salary=gt.1`),
eine Aggregatsortierung darüber (`orderBy=max(staff.salary)`) und eine nicht lesbare Relation,
die in einem verschachtelten Pfad (`/departments/1/members`, `/departments/1/members/7`) oder
einer Aggregatsortierung (`orderBy=count(members)`) benannt wird:

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

Ohne dies wäre der Wert Prädikat für Prädikat lesbar: Zwanzig Requests entsprächen einer
binären Suche über ein Gehalt.

Der Fehler **nennt das Feld beim Namen**. Dies ist eine bewusste Entscheidung, kein
Versehen: Das veröffentlichte OpenAPI-Dokument listet jede Spalte jeder Tabelle auf – es
wird über die App ausgeliefert, nicht über den authentifizierten Daten-Router –, sodass Feldnamen
bereits öffentlich sind. Den Namen hier zu verbergen, würde nichts schützen und einen echten
Tippfehler eines Aufrufers mit „Unbekanntes Feld“ beantworten, was ihn nach einem Rechtschreibfehler
suchen ließe, den es gar nicht gibt. **Feldnamen sind öffentlich; Feldwerte sind es nicht.**

Ausgenommen hiervon sind `.private()`-Spalten. OpenAPI, `describe_table` und das generierte
SDK lassen sie aus, sodass ihr Name nicht öffentlich ist und die Meldung „nicht lesbar“ ihre
Existenz bestätigen würde. Ein Filter, `orderBy`, `fields`, `include`, Aggregat-`select`
oder `groupBy` oder `vector_search`, der eine solche Spalte benennt, erhält exakt dieselbe
Antwort wie ein falsch geschriebener Name – `UNKNOWN_FILTER_FIELD`, `UNKNOWN_ORDER_BY_FIELD`,
`UNKNOWN_FIELD`, `UNKNOWN_RELATION`, `UNKNOWN_AGGREGATE_FIELD` oder `UNKNOWN_VECTOR_PROPERTY`,
mit derselben Nachricht und denselben Details – und keine Unbekanntes-Feld-Antwort führt
sie unter den gültigen Feldern auf.

### Schreibvorgänge

Ein Wert für ein Feld, das Sie nicht beschreiben dürfen, führt zu einem **400**, niemals zu einem
stillschweigend verworfenen Schlüssel – ein Schreibvorgang, der ein Feld verwirft, meldet Erfolg
für eine Bearbeitung, die gar nicht stattgefunden hat.

| Code | Wann |
|------|------|
| `FIELD_NOT_WRITABLE` | `write` ist eine Rollenliste, die Sie nicht erfüllen. Ihre Kollegin oder Ihr Kollege erhält für denselben Body möglicherweise einen 200. |
| `VALIDATION_EXCLUDED_FIELDS` | `write` ist `[]`, oder die Spalte ist `.private()` oder `.readOnly()`. Niemand darf sie beschreiben; die Antwort ist für jeden Aufrufer gleich. |

Beide enthalten `details.violations`, geschlüsselt nach dem übertragenen Wire-Namen.
Dies wird durchgesetzt bei Erstellung, `PATCH`/`PUT`, `/bulk`, `_batch`, Upserts,
Feldoperationen (`{ "salary": { "$inc": 1000 } }` benennt `salary` wie jeder andere Wert)
und dem WebSocket-`SAVE`-Frame.

Eine Feldoperation erfordert zudem `read` auf ihrem Feld. Eine Operation auf einem Feld,
das Sie schreiben, aber nicht lesen dürfen, wird mit `FIELD_NOT_READABLE` verweigert: Ob
ein Grenzwert überschritten wurde, würde Ihnen den Wert verraten, den Sie eigentlich nicht
sehen dürfen.

### Eine Verknüpfung folgt ihrer Schlüsselspalte

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Ein `belongsTo` und die Schlüsselspalte, an die es gebunden ist, sind ein Feld in zwei
Schreibweisen. Das Schreiben von `{ "reviewer": 7 }` unterliegt jeder Regel von `reviewerId`
(seiner Schreibregel, `.readOnly()`, `.private()`, einem Create-Stamp, der Tenant-Spalte);
das Senden beider mit unterschiedlichen Werten ergibt `400 VALIDATION_INVALID_VALUE`.
Ein Aufrufer, der `reviewerId` nicht lesen darf, erhält `reviewer` nicht in einem `include`,
und ein Filter-, Sortierungs- oder `fields`-Eintrag, der es benennt, antwortet mit `FIELD_NOT_READABLE`;
hinter einem `.private()`-Schlüssel existiert die Relation für Clients überhaupt nicht.
Der Schema-Endpunkt, OpenAPI und MCP beschreiben beide zusammen.

Dasselbe gilt für jede Relation über alles, was ihr Join liest: Ein `hasMany` / `hasOne`
liest den Fremdschlüssel des Ziels, ein `via` jede Spalte, über die seine Schritte joinen,
auf jeder Tabelle, die es durchläuft. Ein Aufrufer, der eine dieser Spalten nicht lesen
darf, erhält die Relation weder in einem `include` noch in einem `_count`, erhält `FIELD_NOT_READABLE`
beim Filtern oder Sortieren darüber (eine unbekannte Relation, wenn die Spalte `.private()` ist)
und sieht sie nicht beschrieben.

`strictWrites: false` an einer Tabelle lässt lediglich Schlüssel, die die Tabelle nicht deklariert,
an den Treiber durch. Es lockert niemals eine Regel für eine deklarierte Spalte, einen Stamp,
den Tenant, den Primärschlüssel, ein Relationsziel oder `_pivot` auf.

## Suche

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Die Fallback-Suche – bei einer Tabelle ohne `search`-Block – führt einen `ILIKE`-Abgleich
über Ihre Textspalten durch und überspringt diejenigen, die der Aufrufer nicht lesen darf.
Dadurch dringt nichts nach außen.

Eine Tabelle, die **tatsächlich** einen [`search`-Block](/docs/backend/search) deklariert,
wird zu einer einzigen generierten `tsvector`-Spalte kompiliert, die von allen Aufrufern
gemeinsam genutzt wird. Es gibt keine rollenspezifische Variante davon. Eine eingeschränkte
Spalte, die in `search.fields` benannt ist, bliebe daher für Aufrufer *durchsuchbar* (matchable),
die ihren Wert niemals sehen dürfen – und ließe sich Begriff für Begriff rekonstruieren.
Das Schema wird bei dieser Kombination abgewiesen: Entfernen Sie die Spalte aus `search.fields`
oder heben Sie die Leseeinschränkung auf. Eine `tenant`-Spalte darf ebenfalls nicht
lesebeschränkt sein.

## Verlauf

Der [Entitätsverlauf](/docs/backend/history) speichert die gesamte Zeile und wird jedem
bereitgestellt, der die Zeile lesen kann – die Bedingung lautet „Können Sie diese Entität
abrufen?“, nicht „Sind Sie Administrator?“. Daher wird die Leseregel auch auf jeden
gespeicherten Snapshot angewendet: Der Eintrag wird weiterhin aufgeführt, zusammen mit der
Information, wer ihn wann geändert hat, und die vorenthaltenen Spalten sind aus seinen
`values` entfernt.

Das Zurücksetzen ist davon nicht betroffen. Die Revert-Route liest den gespeicherten
Eintrag serverseitig, sodass ein Aufrufer eine Version wiederherstellen kann, von der er
nicht jedes Feld sehen darf – genauso wie er bereits eine Zeile überschreiben kann,
ohne sie vollständig zu lesen.

## Was das CMS anzeigt

Nichts muss konfiguriert werden. Das CMS liest über dieselbe API, sodass eine Spalte,
die der Aufrufer nicht lesen darf, niemals ankommt und das Formular sie nicht anzeigt;
eine Spalte, die er nicht beschreiben darf, wird abgewiesen, falls versucht wird, sie zu
senden. Dies ist eine serverseitige Garantie – im Gegensatz zum bloßen Ausblenden eines
Feldes im CMS, was lediglich dessen *Rendering* verhindert, den Wert jedoch im JSON belässt.

## Generierte Typen und OpenAPI

Die `Row`-, `Insert`- und `Update`-Typen des SDKs besitzen für jeden Aufrufer dieselbe
Gestalt – es gibt keinen `Row`-Typ, der sowohl für einen Leser mit der Rolle `hr` als auch
für einen ohne diese passend wäre –, daher ändert eine **Rollen**-Regel diese nicht. Eine
`.private()`-Spalte fehlt in allen dreien, und eine `.readOnly()`-Spalte fehlt in `Insert`
und `Update`. Die [abgeleiteten Typen](/docs/schema/types/) folgen derselben Regel.

Das OpenAPI-Dokument gibt die Regel an, anstatt vorzugeben, aufruferspezifisch zu sein.
Jede eingeschränkte Spalte enthält `x-rebase-access`:

```json
"salary": {
  "type": "number",
  "description": "Salary — Field access: readable by `hr` (and `admin`); writable by nobody through the API. A caller without the role does not receive the field at all — it is absent, not null.",
  "x-rebase-access": { "read": ["hr"], "write": [] }
}
```

Ein Feld, das niemand lesen kann, fehlt im Lese-Schema und in den Filterparametern; ein
Feld, das niemand beschreiben kann, fehlt im Eingabe-Schema. Die beiden Richtungen sind
getrennte Schemas und werden separat beurteilt, sodass ein Token, das ein Administrator sendet
und nie zurückliest, im Request-Body erscheint, aber nicht in der Zeile.

## Prozessinterne Schreibvorgänge

Prozessinterne Schreibvorgänge – `context.data` in einem Hook, `rebase.dataAsAdmin` in einem
Hook, einer Funktion oder einem Cron-Job – durchlaufen die Schreibprüfung nicht: `.readOnly()`,
ein feldspezifisches `access.write` und `.private()` sind Regeln der API-Grenze. Genau das
macht die Regel überhaupt durchsetzbar: Irgendetwas muss schließlich in der Lage sein, den
Passwort-Hash zu speichern. Was prozessintern gleichermaßen für eine Spalte wie für die daran
gebundene Verknüpfung gilt: Server-Stamps haben Vorrang vor einem übergebenen Wert, eine Zeile
kann den Tenant nicht wechseln, und ihr Primärschlüssel kann nicht geändert werden. Row-Level
Security gilt überall.

Lesevorgänge über `rebase.dataAsAdmin` besitzen die `admin`-Rolle, sodass eine Rollenregel
nichts vor ihnen verbirgt. `[]` tut dies weiterhin – auch vor `dataAsAdmin`. Verwenden Sie
[`rebase.sql()`](/docs/backend/custom-functions), wenn Sie die rohe Spalte benötigen.

## Validierung

<span class="since-badge" data-since="0.31">Seit 0.31</span>

`.access()` auf einer Spalte und `access` auf einer Relation werfen beim Laden des Moduls
einen Fehler, es sei denn, `read` und `write` sind Listen nicht-leerer Rollennamen: Ein String,
wo eine Liste hingehört (`read: "admin"`), wird abgewiesen, anstatt als etwas anderes
interpretiert zu werden.

Folgendes wird beim Kompilieren des Schemas abgewiesen, noch bevor der Server Anfragen bedient:

- `.private()` und `.access()` auf derselben Spalte: Sie sind ein und derselbe Mechanismus;
- eine lesebeschränkte Spalte, die in den `search.fields` der Tabelle aufgeführt oder als ihr
  `tenant`-Feld verwendet wird;
- ein `.private()`-Primärschlüssel: Über den Primärschlüssel wird jede Zeile adressiert.

Rollen*namen* werden nicht gegen eine feste Menge geprüft: Rollen sind Anwendungsdaten, die
während der Serverlaufzeit erstellt und gelöscht werden. Ein Tippfehler darin führt zu einem
Feld, das niemand lesen kann – was das sicherere Fehlverhalten darstellt.

## Siehe auch

- [Row-level security](/docs/collections/security-rules/) – welche Zeilen ein Aufrufer erreicht
- [Spalten](/docs/schema/columns/) – alle Spaltenmodifikatoren
- [Fehlercodes](/docs/backend/errors/) – `FIELD_NOT_READABLE`, `FIELD_NOT_WRITABLE`
