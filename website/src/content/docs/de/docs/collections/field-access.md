---
sourceHash: 0d49afd8ac50f59e
title: Feldzugriff
sidebar_label: Feldzugriff
description: Lese- und Schreibberechtigungen pro Eigenschaft nach Rolle. Ein Aufrufer, den die Sicherheitsregeln der Zeile durchlassen, erhält dennoch kein Feld, das seine Rollen nicht lesen können.
---

## Übersicht

[Sicherheitsregeln](/docs/collections/security-rules/) entscheiden, welche **Zeilen** ein Aufrufer
erreicht. `access` entscheidet, welche **Felder einer erreichten Zeile** er sieht und setzen darf.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const staff = defineCollection({
    slug: "staff",
    name: "Staff",
    table: "staff",
    properties: {
        id: { type: "number", isId: "increment" },
        name: { type: "string" },
        salary: {
            type: "number",
            // Read by HR (and admins). Set by nobody through the API.
            access: { read: ["hr"], write: [] }
        }
    },
    securityRules: [
        { operation: "select", access: "public" }
    ]
});
```

Die obige Regel definiert keinen Zeilenfilter für `select`, sodass jeder Aufrufer, den die API hineinlässt,
jede staff-Zeile liest. Nur ein Aufrufer mit der Rolle `hr` erhält die Spalte `salary`,
und niemand kann sie über HTTP setzen.

## Die Regel

`access` hat zwei optionale Listen, und eine weggelassene Liste ist keine leere Liste – dieser
Unterschied macht das gesamte Feature aus.

| `read` / `write` | Bedeutung |
|------------------|-------|
| weggelassen | Delegiert an die Zeile. Jeder, dem die Sicherheitsregeln der Collection das Lesen (oder Schreiben) der Zeile erlauben, erhält das Feld. |
| `[]` | Niemand über die API, mit keinem Recht – weder `admin` noch der Service-Key noch ein prozessinterner Lesezugriff. |
| `["hr"]` | Ein Aufrufer mit `hr` **oder** `admin` **oder** vertrauenswürdiger Servercode ohne zugrunde liegenden Request. |

Rollen sind Rebase-Anwendungsrollen – dieselben, die `rebase.roles()` innerhalb
einer Policy zurückgibt und gegen die `policy.rolesOverlap` kompiliert. Sie stammen aus dem
Aufrufkontext: `user.roles` des authentifizierten Requests.

### Warum `admin` immer durchkommt

Jede von Rebase injizierte Basis-Policy enthält einen `rolesOverlap(['admin'])`-Zweig, und
`rebase.dataAsAdmin` wird als `{ uid: "service", roles: ["admin"] }` ausgeführt. Eine Feldregel,
die einen Administrator von einer Spalte seiner eigenen Datenbank aussperren könnte, würde
auch das Studio am Rendern und die CLI am Exportieren hindern. Wenn Sie
eine Spalte benötigen, die kein Administrator über die API liest, verwenden Sie `read: []`.

### Warum die vertrauenswürdige Ebene durchkommt

Ein prozessinterner Aufruf von `rebase.data` in einem Hook, einer Migration oder dem Auth-Adapter
zur Passwortüberprüfung hat keinen Request und keine Rollen im Hintergrund. Dies ist
Servercode, und eine Rollenliste gilt dafür nicht. `[]` gilt jedoch weiterhin: Dies ist eine
Aussage über die API-Oberfläche und nicht darüber, wer der Aufrufer ist.

## `excludeFromApi` ist derselbe Mechanismus

`excludeFromApi: true` ist syntaktischer Zucker für `access: { read: [], write: [] }`. Hinter
beiden Schreibweisen steht dasselbe Prädikat, daher gilt alles auf dieser Seite auch für
dieses Flag. Schreiben Sie, was besser lesbar ist – jedoch nicht beides bei einer Eigenschaft,
was beim Booten abgewiesen wird.

## Was ein Aufrufer sieht

### Lesezugriffe

Ein Feld, das Sie nicht lesen können, ist in der Antwort **nicht vorhanden** (absent). Nicht `null`, keine
leere Zeichenkette – der Schlüssel existiert schlichtweg nicht.

```json
// GET /api/data/staff/1  as a caller holding `staff`
{ "id": 1, "name": "Ada" }

// the same row as a caller holding `hr`
{ "id": 1, "name": "Ada", "salary": 90000 }
```

Das ist Absicht. Ein vorenthaltener Wert, der als `null` ausgeliefert wird, ist nicht von einem
gespeicherten `null` zu unterscheiden, sodass ein Client die gesamte Spalte durch Zählen abbilden
könnte – und ein `update`, das die Zeile zurückspiegelt, würde den echten Wert mit dem übergebenen
Null-Wert überschreiben.

Dies gilt an jedem Ausgangspunkt: Listen, einzelne Get-Abfragen, mit
`?include=` eingebundene Relationsziele, `_batch`-Ergebnisse, Echtzeit-Frames von `.listen()`,
Aggregat-Ergebnisse und [Historien](#historie)-Snapshots.

### Abfragen

Ein `where`, `orderBy`, `fields`, Aggregat-`select` oder `groupBy`, das ein Feld benennt, das Sie
nicht lesen können, führt zu einem **400 `FIELD_NOT_READABLE`**:

```http
GET /api/data/staff?salary=gt.100000
```

```json
{
  "error": {
    "code": "FIELD_NOT_READABLE",
    "message": "'salary' is not readable on 'staff' with your roles, so it cannot be used in a filter.",
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

Ohne dies wäre der Wert Prädikat für Prädikat lesbar: Zwanzig Anfragen entsprächen
einer binären Suche über ein Gehalt.

Der Fehler **nennt das Feld**. Das ist eine bewusste Entscheidung, kein Versehen: Das
veröffentlichte OpenAPI-Dokument listet jede Eigenschaft jeder Collection auf – es wird
von der App ausgeliefert, nicht vom authentifizierten Daten-Router –, daher sind Feldnamen
bereits öffentlich. Den Namen hier zu verbergen, würde nichts schützen und einen echten
Tippfehler des Aufrufers mit „Unbekanntes Feld“ beantworten, was ihn nach einem Schreibfehler
suchen ließe, der gar nicht existiert. **Feldnamen sind öffentlich; Feldwerte sind es nicht.**

### Schreibzugriffe

Ein Wert für ein Feld, das Sie nicht schreiben dürfen, führt zu einem **400**, niemals zu einem stillschweigend
verworfenen Schlüssel – ein Schreibzugriff, der ein Feld verwirft, meldet sonst Erfolg für
eine Bearbeitung, die gar nicht stattgefunden hat.

| Code | Wann |
|------|------|
| `FIELD_NOT_WRITABLE` | `write` ist eine Rollenliste, die Sie nicht erfüllen. Ihre Kollegin oder Ihr Kollege erhält für denselben Body möglicherweise einen 200. |
| `VALIDATION_EXCLUDED_FIELDS` | `write` ist `[]` (oder `excludeFromApi`). Niemand darf es schreiben; die Antwort ist für jeden Aufrufer gleich. |

Beide enthalten `details.violations`, geschlüsselt nach dem von Ihnen gesendeten Wire-Namen. Dies wird erzwungen
bei create, `PATCH`/`PUT`, `/bulk`, `_batch`, Upserts, Feldoperationen
(`{ "salary": { "$inc": 1000 } }` benennt `salary` wie jeder normale Wert) und dem
WebSocket-`SAVE`-Frame.

## Suche

Die Fallback-Suche – eine Collection ohne `search`-Block – gleicht mittels `ILIKE` über
Ihre String-Eigenschaften ab und überspringt diejenigen, die der Aufrufer nicht lesen kann. Hierüber
dringt nichts nach außen.

Eine Collection, die **tatsächlich** einen [`search`-Block](/docs/backend/api/) deklariert, kompiliert
zu einer einzelnen generierten `tsvector`-Spalte, die von allen Aufrufern gemeinsam genutzt wird. Es gibt
davon keine rollenspezifische Variante, sodass ein eingeschränktes Feld, das in `search.fields` aufgeführt ist,
für Aufrufer, die seinen Wert niemals sehen können, weiterhin *treffbar* bliebe – Begriff für
Begriff rekonstruierbar. Rebase lehnt diese Kombination beim Booten ab: Entfernen Sie das Feld aus
`search.fields` oder heben Sie die Leseeinschränkung auf.

## Historie

Die [Entitätshistorie](/docs/backend/api/) speichert die gesamte Zeile und wird an jeden ausgeliefert,
der die Zeile lesen kann – die Zugangsbedingung lautet „Dürfen Sie diese Entität abrufen?“, nicht
„Sind Sie ein Administrator?“. Daher wird die Leseregel auch auf jeden gespeicherten Snapshot angewendet:
Der Eintrag wird weiterhin aufgeführt, inklusive der Information, wer ihn wann geändert hat, und die
vorenthaltenen Spalten sind aus seinen `values` entfernt.

Das Zurücksetzen (Revert) ist davon unberührt. Die Revert-Route liest den gespeicherten Eintrag
serverseitig, sodass ein Aufrufer eine Version wiederherstellen kann, selbst wenn er nicht jedes ihrer
Felder sehen kann – genau so, wie er bereits eine Zeile überschreiben kann, ohne sie vollständig zu lesen.

## Was das Admin-Panel anzeigt

Hier gibt es nichts zu konfigurieren. Das Studio liest über dieselbe API, sodass ein Feld,
das der Aufrufer nicht lesen kann, niemals ankommt und das Formular es nicht darstellt; ein Feld,
das er nicht schreiben darf, wird abgelehnt, wenn etwas versucht, es zu senden. Dies ist eine
serverseitige Garantie, anders als bei `admin.hideFromCollection`, das lediglich verhindert, dass
das Panel ein Feld *rendert*, den Wert aber im JSON belässt.

## Generierte Typen und OpenAPI

Die SDK-Typen `Row`, `Insert` und `Update` haben für jeden Aufrufer dieselbe Form –
es gibt kein `Row`, das sowohl für einen Leser mit `hr` als auch für einen ohne
passend wäre –, daher ändert eine **Rollen**-Regel diese Typen nicht. Ein für jeden geschlossenes
Feld (`[]` oder `excludeFromApi`) fehlt darin, wie es schon immer der Fall war.

Das OpenAPI-Dokument gibt die Regel an, anstatt vorzugeben, benutzerspezifisch zu sein.
Jede eingeschränkte Eigenschaft trägt `x-rebase-access`:

```json
"salary": {
  "type": "number",
  "description": "Salary — Field access: readable by `hr` (and `admin`); writable by nobody through the API. A caller without the role does not receive the field at all — it is absent, not null.",
  "x-rebase-access": { "read": ["hr"], "write": [] }
}
```

Ein Feld, das niemand lesen kann, fehlt im Lese-Schema und in den Filterparametern; ein Feld,
das niemand schreiben kann, fehlt im Eingabe-Schema. Die beiden Richtungen sind separate Schemas
und werden separat bewertet, sodass ein Token, das ein Admin sendet (POST) und niemals zurückliest,
im Request-Body und nicht in der Zeile erscheint.

## Prozessinterne Schreibzugriffe

`rebase.data` und `rebase.dataAsAdmin` in einem Hook, einer Funktion oder einem Cron-Job durchlaufen
die Schreibprüfung nicht. Das ist dieselbe Ausnahme, die `excludeFromApi` schon immer hatte,
und erst das macht die Regel überhaupt durchsetzbar: Irgendetwas muss schließlich in der Lage sein,
den Passwort-Hash zu speichern.

Lesezugriffe über `rebase.dataAsAdmin` besitzen die Rolle `admin`, weshalb eine Rollenregel
nichts vor ihnen verbirgt. `[]` tut dies weiterhin – auch vor `dataAsAdmin`. Verwenden Sie
[`rebase.sql()`](/docs/backend/api/), wenn Sie die rohe Spalte benötigen.

## Validierung

Folgendes wird beim Booten abgelehnt, bevor der Server überhaupt Anfragen bedient:

- `access` und `excludeFromApi` bei derselben Eigenschaft – sie basieren auf demselben Mechanismus,
  und das Flag gewinnt, sodass der Block daneben wirkungslos wäre;
- ein einfacher String, wo eine Liste stehen müsste (`read: "admin"`), was als nicht-leere
  Regel interpretiert wird, die kein Aufrufer erfüllt, und das Feld vor jedem verbergen würde;
- eine Rolle, die kein nicht-leerer String ist;
- ein eingeschränktes Feld, das in den `search.fields` der Collection aufgeführt ist.

Rollen*namen* werden nicht gegen eine feste Menge geprüft: Rollen sind Anwendungsdaten, die erstellt
und gelöscht werden, während der Server läuft. Ein Tippfehler bei einem Namen führt dazu, dass niemand
das Feld lesen kann – was im Fehlerfall die sichere Richtung ist (fail-safe).

## Siehe auch

- [Sicherheitsregeln (RLS)](/docs/collections/security-rules/) – welche Zeilen ein Aufrufer erreicht
- [Eigenschaften](/docs/collections/properties/) – die vollständige Optionstabelle
- [Fehlercodes](/docs/backend/errors/) – `FIELD_NOT_READABLE`, `FIELD_NOT_WRITABLE`

---
