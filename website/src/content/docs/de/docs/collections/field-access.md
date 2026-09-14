---
sourceHash: b3e463880abd2023
title: Feldzugriff
sidebar_label: Feldzugriff
description: Lese- und Schreibberechtigungen auf Eigenschaftsebene nach Rolle. Ein Aufrufer, den die Sicherheitsregeln der Zeile durchlassen, erhält dennoch kein Feld, das seine Rollen nicht lesen dürfen.
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

Die obige Regel wendet keinen Zeilenfilter auf `select` an, sodass jeder Aufrufer, den die API durchlässt,
jede staff-Zeile liest. Nur ein Aufrufer mit der Rolle `hr` erhält die Spalte `salary`,
und niemand kann sie über HTTP setzen.

## Die Regel

`access` hat zwei optionale Listen, und eine weggelassene Liste ist keine leere Liste – dieser
Unterschied macht das gesamte Feature aus.

| `read` / `write` | Bedeutung |
|------------------|-------|
| weggelassen | An die Zeile delegieren. Jeder, der laut den Sicherheitsregeln der Collection die Zeile lesen (oder schreiben) darf, erhält das Feld. |
| `[]` | Niemand über die API, mit keinerlei Berechtigung – weder `admin`, noch der Service-Key, noch ein prozessinterner Lesezugriff. |
| `["hr"]` | Ein Aufrufer mit der Rolle `hr` **oder** `admin` **oder** vertrauenswürdiger Server-Code ohne zugrundeliegenden Request. |

Rollen sind Rebase-Anwendungsrollen – dieselben, die `rebase.roles()` innerhalb
einer Policy zurückgibt und gegen die `policy.rolesOverlap` kompiliert. Sie stammen aus dem
Aufrufkontext: `user.roles` im authentifizierten Request.

### Warum `admin` immer durchgelassen wird

Jede von Rebase injizierte Basis-Policy enthält einen `rolesOverlap(['admin'])`-Zweig, und
`rebase.dataAsAdmin` läuft als `{ uid: "service", roles: ["admin"] }`. Eine Feldregel,
die einen Administrator von einer Spalte seiner eigenen Datenbank aussperren könnte,
würde auch verhindern, dass das Studio sie rendert und die CLI sie exportiert. Wenn Sie
eine Spalte benötigen, die kein Administrator über die API liest, ist das `read: []`.

### Warum die vertrauenswürdige Ebene durchgelassen wird

Server-Code ohne zugrundeliegenden Request – eine Migration oder der Auth-Adapter,
der ein Passwort überprüft – liest völlig ohne Rollen, und eine Rollenliste gilt
dafür nicht. `[]` gilt weiterhin: Das ist eine Aussage über die API-Oberfläche
und nicht darüber, wer der Aufrufer ist.

Das `context.data` eines Callbacks gehört nicht zu dieser Ebene. Innerhalb eines Requests liest es mit den
Rollen des Aufrufers, sodass die Feldregeln genau wie beim Request auch für das gelten,
was es liest.

## `excludeFromApi` ist derselbe Mechanismus

`excludeFromApi: true` ist syntaktischer Zucker für `access: { read: [], write: [] }`. Hinter
beiden Schreibweisen steht dasselbe Prädikat, sodass alles auf dieser Seite auch für dieses
Flag gilt. Verwenden Sie die Variante, die besser lesbar ist – jedoch nicht beide bei einer Eigenschaft,
was beim Booten abgewiesen wird.

## Was ein Aufrufer sieht

### Lesezugriffe

Ein Feld, das Sie nicht lesen können, ist in der Antwort **nicht vorhanden**. Nicht `null`, kein leerer
String – der Schlüssel existiert nicht.

```json
// GET /api/data/staff/1  as a caller holding `staff`
{ "id": 1, "name": "Ada" }

// the same row as a caller holding `hr`
{ "id": 1, "name": "Ada", "salary": 90000 }
```

Das ist beabsichtigt. Ein vorenthaltener Wert, der als `null` ausgeliefert wird, ist von einem
tatsächlich gespeicherten `null` nicht zu unterscheiden. Ein Client könnte somit die gesamte Spalte durch Zählen
abbilden – und ein `update`, das die Zeile zurückspiegelt, würde den echten Wert mit dem übergebenen
Null-Wert überschreiben.

Dies gilt für jeden Ausgabekanal: Listen, einzelne GET-Abfragen, über `?include=`
eingebundene Relationsziele, `_batch`-Ergebnisse, Realtime-Frames von `.listen()`, Aggregationsergebnisse
und [Historie](#historie)-Snapshots.

### Abfragen

Ein `where`, `orderBy`, `fields`, Aggregations-`select` oder `groupBy`, das ein Feld benennt, welches
Sie nicht lesen können, führt zu einem **400 `FIELD_NOT_READABLE`**:

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

Ohne dies wäre der Wert Prädikat für Prädikat lesbar: Zwanzig Requests entsprächen
einer binären Suche über ein Gehalt.

Der Fehler **benennt das Feld**. Das ist eine bewusste Entscheidung, kein Versehen: Das
veröffentlichte OpenAPI-Dokument listet jede Eigenschaft jeder Collection auf – es
wird von der App ausgeliefert, nicht vom authentifizierten Daten-Router – daher sind Feldnamen
bereits öffentlich. Den Namen hier zu verbergen, würde nichts schützen und einen echten Tippfehler
eines Aufrufers mit „Unbekanntes Feld“ beantworten, was ihn nach einem Schreibfehler suchen ließe,
den es gar nicht gibt. **Feldnamen sind öffentlich; Feldwerte sind es nicht.**

### Schreibzugriffe

Ein Wert für ein Feld, das Sie nicht schreiben dürfen, führt zu einem **400-Fehler**, niemals zu einem stillschweigend
verworfenen Schlüssel – ein Schreibvorgang, der ein Feld verwirft, würde einen Erfolg für eine
Änderung melden, die gar nicht stattgefunden hat.

| Code | Wann |
|------|------|
| `FIELD_NOT_WRITABLE` | `write` ist eine Rollenliste, die Sie nicht erfüllen. Ein Kollege erhält für denselben Body möglicherweise einen 200-Status. |
| `VALIDATION_EXCLUDED_FIELDS` | `write` ist `[]` (oder `excludeFromApi`). Niemand darf es schreiben; die Antwort ist für jeden Aufrufer gleich. |

Beide enthalten `details.violations`, geschlüsselt nach dem übertragenen Namen (wire name). Dies wird erzwungen
bei create, `PATCH`/`PUT`, `/bulk`, `_batch`, Upserts, Feldoperationen
(`{ "salary": { "$inc": 1000 } }` benennt `salary` wie jeder andere Wert auch) und dem
WebSocket-`SAVE`-Frame.

## Suche

Die Fallback-Suche – eine Collection ohne `search`-Block – führt ein `ILIKE`-Matching über
Ihre String-Eigenschaften durch und überspringt diejenigen, die der Aufrufer nicht lesen kann. Hierbei
leckt nichts nach außen.

Eine Collection, die **tatsächlich** einen [`search`-Block](/docs/backend/api/) deklariert, kompiliert
zu einer einzelnen generierten `tsvector`-Spalte, die von allen Aufrufern geteilt wird. Es gibt keine
rollenspezifische Variante davon, sodass ein eingeschränktes Feld, das in `search.fields` angegeben ist,
für Aufrufer, die seinen Wert niemals sehen können, *durchsuchbar* bliebe – rekonstruierbar Begriff für
Begriff. Rebase verweigert diese Kombination beim Booten: Entfernen Sie das Feld aus
`search.fields` oder heben Sie die Leseeinschränkung auf.

## Historie

Die [Entity-Historie](/docs/backend/api/) speichert die gesamte Zeile und wird jedem
bereitgestellt, der die Zeile lesen kann – die Zugangsbedingung lautet „Können Sie diese Entity abrufen?“,
nicht „Sind Sie ein Admin?“. Daher wird die Leseregel auch auf jeden gespeicherten Snapshot angewendet:
Der Eintrag wird weiterhin aufgeführt (mit der Information, wer ihn wann geändert hat), und die vorenthaltenen
Spalten sind aus seinen `values` entfernt.

Das Zurücksetzen (Revert) ist davon nicht betroffen. Die Revert-Route liest den gespeicherten Eintrag
serverseitig, sodass ein Aufrufer eine Version wiederherstellen kann, auch wenn er nicht jedes einzelne
ihrer Felder sehen kann – genau so, wie man eine Zeile bereits überschreiben kann, ohne sie vollständig
gelesen zu haben.

## Was das Admin-Panel anzeigt

Nichts muss konfiguriert werden. Das Studio liest über dieselbe API; ein Feld, das der
Aufrufer nicht lesen kann, kommt also niemals an und das Formular zeichnet es nicht; ein Feld,
das er nicht schreiben darf, wird abgewiesen, wenn etwas versucht, es zu senden. Dies ist eine
serverseitige Garantie – im Gegensatz zu `admin.hideFromCollection`, das lediglich verhindert, dass
das Panel ein Feld *rendert*, den Wert aber im JSON belässt.

## Generierte Typen und OpenAPI

Die Typen `Row`, `Insert` und `Update` des SDK haben für jeden Aufrufer dieselbe Form –
es gibt keinen `Row`-Typ, der sowohl für einen Leser mit `hr`-Rolle als auch für einen
ohne passend wäre – daher ändert eine **Rollen**-Regel nichts an ihnen. Ein Feld, das für jeden
gesperrt ist (`[]` oder `excludeFromApi`), fehlt in ihnen, wie bisher auch.

Das OpenAPI-Dokument gibt die Regel an, anstatt vorzugeben, aufruferspezifisch zu sein.
Jede eingeschränkte Eigenschaft enthält `x-rebase-access`:

```json
"salary": {
  "type": "number",
  "description": "Salary — Field access: readable by `hr` (and `admin`); writable by nobody through the API. A caller without the role does not receive the field at all — it is absent, not null.",
  "x-rebase-access": { "read": ["hr"], "write": [] }
}
```

Ein Feld, das niemand lesen kann, fehlt im Lese-Schema und in den Filter-Parametern;
ein Feld, das niemand schreiben kann, fehlt im Eingabe-Schema. Die beiden Richtungen sind
getrennte Schemas und werden separat bewertet, sodass ein Token, das ein Admin postet und
niemals zurückliest, im Request-Body erscheint, aber nicht in der Zeile.

## Prozessinterne Schreibzugriffe

Prozessinterne Schreibzugriffe – `context.data` in einem Callback, `rebase.dataAsAdmin` in
einem Callback, einer Funktion oder einem Cron-Job – durchlaufen die Schreibprüfung nicht.
Dies ist dieselbe Ausnahme, die `excludeFromApi` schon immer hatte, und genau das macht
die Regel überhaupt erst durchsetzbar: Irgendetwas muss in der Lage sein, den Passwort-Hash zu speichern.

Lesezugriffe über `rebase.dataAsAdmin` besitzen die Rolle `admin`, sodass eine Rollenregel
nichts vor ihnen verbirgt. `[]` tut dies weiterhin – auch vor `dataAsAdmin`. Verwenden
Sie [`rebase.sql()`](/docs/backend/api/), wenn Sie die rohe Spalte benötigen.

## Validierung

Folgendes wird beim Booten abgewiesen, bevor der Server Anfragen bedient:

- `access` und `excludeFromApi` bei derselben Eigenschaft – sie basieren auf demselben
  Mechanismus, und das Flag hat Vorrang, sodass der Block daneben wirkungslos wäre;
- ein einfacher String, wo eine Liste stehen müsste (`read: "admin"`), was als nicht-leere
  Regel interpretiert wird, die kein Aufrufer erfüllt, und das Feld vor jedem verbergen würde;
- eine Rolle, die kein nicht-leerer String ist;
- ein eingeschränktes Feld, das in den `search.fields` der Collection angegeben ist.

Rollen-*Namen* werden nicht gegen eine feste Menge geprüft: Rollen sind Anwendungsdaten,
die erstellt und gelöscht werden, während der Server läuft. Ein Tippfehler darin führt zu einem
Feld, das niemand lesen kann – was im Fehlerfall die sichere Richtung ist.

## Siehe auch

- [Sicherheitsregeln (RLS)](/docs/collections/security-rules/) – welche Zeilen ein Aufrufer erreicht
- [Eigenschaften](/docs/collections/properties/) – die vollständige Optionstabelle
- [Fehlercodes](/docs/backend/errors/) – `FIELD_NOT_READABLE`, `FIELD_NOT_WRITABLE`
