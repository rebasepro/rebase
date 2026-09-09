---
sourceHash: ffb0a0aaabda1c4c
title: Fehlercodes
sidebar_label: Fehlercodes
description: Jeder Fehlercode, den ein Rebase-Backend zurückgeben kann, mit seinem HTTP-Status, seiner Bedeutung und Hinweisen zur Behebung – plus Response-Envelope, X-Request-ID und den Regeln für details.
---

Jeder Fehler, den ein Rebase-Backend zurückgibt, verwendet denselben Envelope und enthält einen stabilen
`code`. Dieser Code ist das Kriterium, auf das in der Anwendungslogik verzweigt werden sollte: Die Nachricht (`message`) ist für Menschen
geschrieben und kann umformuliert werden, der Status wird von einem Dutzend verschiedener Probleme geteilt,
und auf den Code trifft beides nicht zu.

## Der Envelope

```json
{
  "error": {
    "message": "Schema drift: table \"posts\" does not exist.",
    "code": "SCHEMA_DRIFT",
    "details": { "dbCode": "42P01" },
    "requestId": "6f1b2f3e-8a0c-4d1b-9c3e-2a5b7c9d1e0f"
  }
}
```

- **`message`** — menschenlesbar. Bei einem `4xx`-Fehler ist es die eigene Nachricht des Servers; bei
  einem `5xx`-Fehler ist sie bewusst generisch gehalten, da der zugrunde liegende Text einen Host,
  eine Rolle oder einen Spaltennamen enthalten kann.
- **`code`** — einer der unten aufgeführten Werte. Stabil über Minor-Versionen hinweg.
- **`details`** — optional und niemals garantiert. Siehe die unten stehenden Regeln.
- **`requestId`** — immer vorhanden, wenn die Anfrage die Request-ID-Middleware
  durchlaufen hat, was für jede Route unter `basePath` gilt.

### `X-Request-ID`

Jede Anfrage unter `basePath` erhält eine ID: den `X-Request-ID`-Header des Aufrufers,
wenn es sich um eine gültige UUID v4 handelt, andernfalls eine neu generierte. Sie wird in der
Antwort als `X-Request-ID` zurückgegeben, im Fehler-Envelope als `requestId` aufgeführt und
an die Protokollzeile des Servers für diese Anfrage angehängt.

Das ist der Verknüpfungsschlüssel (Join Key). Geben Sie ihn in einem Fehlerbericht an, kann ein Operator genau
die eine Protokollzeile finden, die den Fehler erklärt und den Grund enthält, der dem Client
nie angezeigt wurde.

Das Senden einer eigenen ID ermöglicht es, einen Trace über Stationen (Hops) hinweg beizubehalten: Ein Gateway oder ein Job-Runner,
der den Header weiterleitet, erhält eine einheitliche ID über alle Dienste hinweg, die die Anfrage verarbeitet haben.
Ein ungültiger Wert wird ignoriert und nicht abgelehnt – wegen eines fehlerhaften Headers eines
Aufrufers lohnt es sich nicht, eine Anfrage fehlschlagen zu lassen. Gehen Sie daher nicht davon aus, dass die gesendete ID
auch der erhaltenen ID entspricht. Prüfen Sie den Header der Antwort.

### Was in `details` enthalten ist

`details` dient der Diagnose und ist nicht vertraglich bindend. Drei Regeln bestimmen den Inhalt:

1. **Alles, was eine Route explizit setzt, wird immer zurückgegeben.** Dies sind die
   präzise beschriebenen Fehler des Aufrufers: welches Filterfeld unbekannt war,
   welche Relation nicht beschreibbar ist, welcher Wert nicht zu seinem Typ passte.
2. **Datenbankdiagnosen werden in der Produktionsumgebung gekürzt.** Wenn der Fehler
   von Postgres stammte, ist `details.dbCode` – der SQLSTATE – immer vorhanden: Er benennt
   die Problemklasse und gibt nichts über die Daten preis. `dbMessage`,
   `detail` und `hint` werden nur hinzugefügt, wenn `NODE_ENV` nicht `production` ist,
   da Postgres Zeileninhalte darin platziert. `23505` meldet
   `Key (email)=(a@b.c) already exists.`, was für jede beliebige Adresse die Frage
   „Ist diese Person registriert?“ beantworten würde.
3. **Verzweigen Sie niemals auf Basis von `details`.** Verzweigen Sie anhand von `code`. Der Inhalt von `details` ist
   lediglich das, was an dieser Aufrufstelle für eine Person nützlich war, und kann sich ändern.

## Einen Status interpretieren

| Status | Was er über die Anfrage aussagt |
| --- | --- |
| `400` | Fehlerhaft aufgebaut oder fordert etwas an, das im Schema nicht existiert. Anfrage korrigieren. |
| `401` | Nicht authentifiziert oder die Anmeldedaten sind abgelaufen. Anmelden oder aktualisieren. |
| `403` | Authentifiziert, aber nicht berechtigt. Ein erneuter Versuch mit derselben Identität hilft nicht. |
| `404` | Keine solche Route, Collection oder Zeile – oder eine Zeile, die durch Row-Level Security verborgen wird. |
| `409` | Ein Konflikt mit dem bestehenden Zustand: ein Duplikat oder ein gleichzeitiger Schreibzugriff. |
| `413` `415` `422` | Der Body ist zu groß, hat den falschen Medientyp oder wurde semantisch abgelehnt. |
| `429` | Ratenbegrenzung erreicht. Warten; die Nachricht gibt an, wie lange. |
| `500` | Der Server oder seine Datenbank ist fehlerhaft, nicht der Aufrufer. Protokolle prüfen. |
| `501` | Die Route existiert, aber dieses Deployment kann sie nicht bedienen – ein Feature, das deaktiviert oder nicht konfiguriert ist. |
| `502` `503` `504` | Eine Abhängigkeit war nicht erreichbar, nicht konfiguriert oder zu langsam. |

## Authentifizierung und Konten

| Code | Status | Bedeutung | Was zu tun ist |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | Die Route erfordert einen zweiten Faktor und die Sitzung hat nur einen. | Die MFA-Abfrage abschließen, dann wiederholen. |
| `ALREADY_VERIFIED` | 400 | Die Adresse oder der Faktor ist bereits verifiziert. | Nichts – der gewünschte Zustand ist bereits erreicht. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | Die anonyme Anmeldung ist auf diesem Server deaktiviert. | Aktivieren oder mit einer echten Identität anmelden. |
| `API_KEY_FORBIDDEN` | 403 | Ein API-Schlüssel wurde auf einer Route verwendet, die nur Personen aufrufen dürfen. | Eine Benutzersitzung verwenden. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Ein API-Schlüssel hat versucht, API-Schlüssel zu erstellen, aufzulisten oder zu widerrufen. | Schlüssel als angemeldeter Administrator verwalten. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Eine geschützte Route wurde ohne Rebase-Auth-Middleware davor ausgeführt, sodass die Anmeldedaten des Aufrufers nie geprüft wurden. | Die App über den Functions-Router mounten statt direkt auf dem eigenen Server. |
| `BOOTSTRAP_ANONYMOUS` | 403 | Der Bootstrap des ersten Administrators wurde von einem anonymen Aufrufer versucht. | Zuerst anmelden. |
| `BOOTSTRAP_COMPLETED` | 403 | Der erste Administrator existiert bereits. | Die Rolle von einem bestehenden Administrator zuweisen lassen. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | Der Bootstrap ist nur für den allerersten Benutzer gedacht, und dies ist nicht dieser Benutzer. | Die Rolle von einem bestehenden Administrator zuweisen lassen. |
| `CAPTCHA_FAILED` | 400 | Der Anbieter hat das CAPTCHA-Token abgelehnt. | Eine neue Aufgabe lösen. |
| `CAPTCHA_REQUIRED` | 400 | Die Route erfordert ein CAPTCHA-Token und es wurde keines gesendet. | Das Token mitsenden. |
| `CHALLENGE_EXHAUSTED` | 401 | Zu viele falsche Codes bei einer MFA-Abfrage. | Eine neue Abfrage starten. |
| `EMAIL_EXISTS` | 409 | Ein Konto mit dieser Adresse existiert bereits. | Anmelden oder das Zurücksetzen des Passworts starten. |
| `EMAIL_NOT_CONFIGURED` | 503 | Magic Links oder OTP wurden angefordert, aber der Server verfügt über keinen E-Mail-Transport. | SMTP konfigurieren oder eine andere Anmeldemethode verwenden. |
| `EMAIL_NOT_VERIFIED` | 403 | Das Konto existiert und seine Adresse ist nicht verifiziert. | Die Adresse verifizieren. |
| `FACTOR_NOT_VERIFIED` | 400 | Der MFA-Faktor wurde registriert, aber nie bestätigt. | Den Faktor bestätigen. |
| `IDENTITY_ALREADY_LINKED` | 409 | Diese OAuth-Identität gehört zu einem anderen Konto. | Damit anmelden oder dort zuerst die Verknüpfung aufheben. |
| `INVALID_ACCOUNT` | 400 | Das Konto befindet sich in einem Zustand, auf den diese Operation nicht angewendet werden kann. | Siehe die Nachricht. |
| `INVALID_CHALLENGE` | 400 | Die MFA-Abfrage ist unbekannt oder abgelaufen. | Eine neue starten. |
| `INVALID_CODE` | 401 | Der OTP- oder MFA-Code ist falsch. | Mit dem aktuellen Code wiederholen. |
| `INVALID_CREDENTIALS` | 401 | Falsche E-Mail-Adresse oder falsches Passwort – es wird bewusst nicht angegeben, was davon. | Wiederholen oder das Passwort zurücksetzen. |
| `INVALID_TOKEN` | 400 | Ein Bestätigungs-, Reset- oder Magic-Link-Token ist fehlerhaft oder unbekannt. | Einen neuen Link anfordern. |
| `LAST_ADMIN` | 403 | Die Änderung würde das Projekt ohne Administrator zurücklassen. | Zuerst jemand anderen hochstufen. |
| `MFA_REQUIRED` | 401 | Das Passwort war korrekt und das Konto verfügt über einen verifizierten zweiten Faktor; die Anmeldung ist also erst zur Hälfte abgeschlossen. `details` enthält ein kurzlebiges Token für die MFA-Abfrage – es handelt sich nicht um eine Sitzung. | Eine Abfrage öffnen und beantworten; die Antwort auf die Abfrage stellt die Sitzung aus. |
| `NO_SESSION` | 401 | Es wurde kein Sitzungs-Cookie oder Refresh-Token vorgelegt. Normal beim ersten Laden der Seite. | Anmelden. |
| `NOT_ANONYMOUS` | 400 | Eine Route zum Upgrade eines anonymen Kontos wurde von einem echten Konto aufgerufen. | Nichts zu upgraden. |
| `OAUTH_ERROR` | 401 | Der OAuth-Anbieter hat die Anfrage abgelehnt oder einen Fehler zurückgegeben. | Den Ablauf wiederholen; die Nachricht enthält den Grund des Anbieters. |
| `RATE_LIMITED` | 429 | Zu viele Versuche von diesem Aufrufer. | Warten; die Nachricht gibt an, wie lange. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | Das Weiterleitungsziel steht nicht auf der Zulassungsliste (Allowlist). | Zur Anbieterkonfiguration hinzufügen. |
| `REGISTRATION_DISABLED` | 403 | Die Selbstregistrierung ist deaktiviert. | Das Konto von einem Administrator erstellen lassen. |
| `ROLE_EXISTS` | 409 | Dieser Rollenname ist bereits vergeben. | Einen anderen Namen wählen. |
| `ROLE_LOOKUP_FAILED` | 503 | Die Rollen für eine Administrator-geschützte Anfrage konnten nicht gelesen werden. Scheitert restriktiv (Fail-Closed), anstatt dem Claim des Tokens blind zu vertrauen. | Wiederholen; die Datenbank prüfen. |
| `SELF_DELETE` | 400 | Ein Administrator hat versucht, sein eigenes Konto zu löschen. | Von einem anderen Administrator durchführen lassen. |
| `SESSION_REVOKED` | 401 | Die Sitzung wurde an anderer Stelle abgemeldet oder alle Sitzungen wurden widerrufen. | Erneut anmelden. |
| `SETUP_REQUIRED` | 403 | Das Projekt hat noch keinen Administrator, daher ist diese Route nicht verfügbar. | Die Einrichtung des ersten Administrators abschließen. |
| `TOKEN_ALREADY_USED` | 401 | Ein Einmal-Token wurde erneut verwendet. | Ein neues anfordern. |
| `TOKEN_EXPIRED` | 401 | Das Token hat seine Lebensdauer überschritten. | Ein neues anfordern. |
| `USER_NOT_FOUND` | 404 | Kein Konto mit dieser ID gefunden. | Die ID prüfen. |
| `WEAK_PASSWORD` | 400 | Das Passwort entspricht nicht der konfigurierten Richtlinie. | Ein stärkeres Passwort wählen. |

## Daten, Abfragen und Schreiboperationen

<span class="since-badge" data-since="0.20">Seit 0.20</span>

| Code | Status | Bedeutung | Was zu tun ist |
| --- | --- | --- | --- |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Dieser Treiber kann das angeforderte Aggregat nicht berechnen. | Einen Treiber verwenden, der dies unterstützt, oder die Berechnung im Client durchführen. |
| `BRANCHING_UNSUPPORTED` | — | Ein Datenbank-Branch wurde über den Studio-Websocket auf der verwalteten Entwicklungsdatenbank (PGlite) angefordert, bei der ein Branch mit dem Parent identisch *ist* und nichts isoliert würde. Die Verweigerung entspricht der Ausgabe von `rebase db branch`. | `DATABASE_URL` auf eine eigene Postgres-Instanz zeigen lassen (`rebase dev --docker` startet eine) und dort branchen. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` enthält mehr Operationen als das Batch-Limit erlaubt (standardmäßig 1000). Ein Batch ist eine einzige Transaktion und hält seine Sperren für die gesamte Dauer. | In kleineren Teilen senden; die Nachricht nennt das Limit und die tatsächliche Anzahl. |
| `BATCH_UNSUPPORTED` | 400 | Der Treiber dieses Backends kann nicht atomar über Collections hinweg schreiben, und eine Schleife von Einzelschreibvorgängen wäre weder atomar noch ein einzelner Roundtrip. | Die Schreibvorgänge als separate Anfragen oder als `/bulk`-Aufrufe pro Collection senden. |
| `BULK_TOO_LARGE` | 400 | Der Bulk-Body überschreitet das konfigurierte Elementlimit. | Die Anfrage aufteilen. |
| `BULK_UNSUPPORTED` | 400 | Diese Collection oder dieser Treiber unterstützt keine Bulk-Schreibvorgänge. | Die Zeilen einzeln schreiben. |
| `CALLBACK_REJECTED` | 400 | Ein Collection-Callback hat den Schreibvorgang verweigert. Ein `throw` in `beforeSave`/`beforeDelete`/`after*` ist ein 400-Fehler mit der Nachricht des Autors; ein `beforeDelete`, das `false` zurückgibt, ist ein 403-Fehler. `details.stage` gibt den Callback an, `details.path` die Collection. | Die Nachricht lesen – sie wurde von diesem Projekt verfasst, nicht von Rebase. |
| `CURSOR_WITH_OFFSET` | 400 | `?after=` wurde mit `?offset=` oder `?page=` kombiniert. Ein Cursor definiert bereits den Startpunkt der Seite; ein zusätzlicher Offset überspringt stillschweigend Zeilen nach dem Cursor – eine Lücke, die der Aufrufer in der Antwort nicht erkennen kann. | Entweder das eine oder das andere verwenden. |
| `DISTINCT_NOT_APPLICABLE` | 400 | `?distinct=true` wurde mit einer Such- oder Vektorabfrage kombiniert. Beide weisen einen Score pro Zeile zu, sodass nie zwei Zeilen identisch sind und `DISTINCT` nichts zusammenfassen würde – es sähe so aus, als hätte es funktioniert, würde aber nichts ändern. | Eines von beiden weglassen. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Ein `distinct`-Lesevorgang wird nach einer Spalte sortiert, die er nicht zurückgibt. Ein `SELECT DISTINCT` kann nur nach Spalten in seiner Auswahlliste sortiert werden, andernfalls haben die zusammengefassten Zeilen keine definierte Reihenfolge. `details.fields` nennt die Spalten. | Diese Felder zu `?fields=` hinzufügen oder aus `?orderBy=` entfernen. |
| `DB_PERMISSION_DENIED` | 500 | Postgres hat das Statement verweigert (`42501`): entweder verweigert eine Row-Level-Security-Policy diese Rolle oder es fehlt ein `GRANT`. | Siehe [Fehlerbehebung](/docs/troubleshooting/). |
| `FIELD_NOT_READABLE` | 400 | Ein Filter, `orderBy`, `fields`, Aggregat-`select` oder `groupBy` benennt ein Feld, das die Rollen dieses Aufrufers nicht lesen dürfen (`access.read`). Ein Feld, das keine Antwort enthalten darf, darf auch von keiner Abfrage abgefragt werden, da der Wert sonst Prädikat für Prädikat ausgelesen werden könnte. `details.violations` nennt die jeweiligen Felder. | Das Feld aus der Abfrage entfernen oder die erforderliche Rolle einnehmen. Siehe [Feldzugriff](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 | Der Body setzt ein Feld, das die Rollen dieses Aufrufers nicht schreiben dürfen (`access.write`). Wird abgelehnt statt verworfen: Ein Schreibvorgang, der ein Feld verwirft, würde Erfolg für eine Änderung melden, die gar nicht stattgefunden hat. `details.violations` nennt die jeweiligen Felder. | Das Feld entfernen oder die Rolle einnehmen. Ein Feld, das niemand schreiben darf, antwortet stattdessen mit `VALIDATION_EXCLUDED_FIELDS`. |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Eine frühere Anfrage mit demselben `Idempotency-Key` wird noch verarbeitet. | Wiederholen, sobald sie abgeschlossen ist. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | Derselbe `Idempotency-Key` wurde mit einem anderen Body übermittelt. | Einen neuen Schlüssel verwenden oder den ursprünglichen Body senden. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` hat eine Funktion angegeben, die nicht `count`, `sum`, `avg`, `min` oder `max` ist. | Eine dieser Funktionen verwenden; die Nachricht listet sie auf. |
| `INVALID_AGGREGATE_SELECT` | 400 | Ein Eintrag in `?select=` hat nicht das Format `fn(field)` oder einer Funktion außer `count()` wurde kein Feld übergeben. | `sum(total)`, `count()`, `avg(score)` angeben. |
| `INVALID_BATCH_BODY` | 400 | Bei einer `/_batch`-Operation fehlt `op`, `collection`, `values` oder `id`, sie benennt eine Collection, die dieses Backend nicht bedient, oder verwendet einen `ref`-Namen wieder. | Siehe die Nachricht; sie nennt die Operation nach ihrem Index. |
| `INVALID_BATCH_REF` | 400 | Ein `{ "$ref": "<name>.<field>" }` verweist auf keine frühere Operation, verweist nach vorne oder fragt ein Feld an, das die referenzierte Zeile nicht besitzt. Nur Rückwärtsreferenzen werden aufgelöst. | Die Operation mit `ref` benennen, *bevor* darauf verwiesen wird. |
| `INVALID_BULK_BODY` | 400 | Der Bulk-Body entspricht nicht der erwarteten Struktur. | Das dokumentierte `items`-Array senden. |
| `INVALID_CONFLICT_TARGET` | 400 | Das `on_conflict` / `onConflict` eines Upserts benennt Spalten ohne Eindeutigkeitsgarantie oder benennt sie ohne `upsert: true`. Postgres würde andernfalls mit 42P10 innerhalb einer Transaktion antworten, die bereits Arbeit verrichtet hat. | `validation: { unique: true }` oder einen `unique`-Index deklarieren; die Nachricht listet die vorhandenen Targets auf. |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` ist weder `include` noch `only`. Wird abgelehnt statt ignoriert: Ein vertipptes `?deleted=true`, das stillschweigend jede gelöschte Zeile ausblendet, würde so wirken, als hätte es funktioniert, beantwortet aber die gegenteilige Frage. | `include` (aktive und gelöschte) oder `only` (nur gelöschte) senden. Weglassen, um nur aktive Zeilen zu erhalten. |
| `INVALID_DISTINCT` | 400 | `?distinct=` ist weder `true` noch `false`. | Einen dieser Werte senden; `1` und `0` werden ebenfalls akzeptiert. |
| `INVALID_FIELD_OPERATION` | 400 | Ein `$inc` / `$push` / `$pull` / `$merge` wurde auf einem Property-Typ verwendet, für den es nicht definiert ist, mit einem Operanden der falschen Struktur, mit zwei Operatoren auf einem Feld, falsch geschrieben oder bei einer Erstellung (Create) – wo es keinen gespeicherten Wert gibt, auf dem operiert werden könnte. | Siehe [Schreiben über REST](/docs/backend/writes/#field-operations); die Nachricht nennt das Feld. |
| `INVALID_FILTER_FIELD` | 400 | Der Filter benennt ein Feld, das diese Collection nicht besitzt. | Die Schreibweise mit der Collection abgleichen. |
| `INVALID_FILTER_OPERATOR` | 400 | Der Operator wird von diesem Property-Typ nicht unterstützt. | Siehe [Daten abfragen](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | Ein Filterwert kann nicht als der Typ der Spalte gelesen werden, mit der er verglichen wurde: `?id=eq.abc` auf einem Integer-Schlüssel, ein Label außerhalb des Enums, ein ungültiger Zeitstempel, eine Zahl außerhalb des Typbereichs. `details.dbCode` enthält den SQLSTATE. | Einen Wert senden, der dem Typ der Spalte entspricht. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` ist weder `true` noch `false`. Jeder andere Wert wird abgelehnt, anstatt als „Nein“ interpretiert zu werden – ein Tippfehler, der Soft-Delete ausführt, wenn der Aufrufer endgültiges Löschen (Purge) gefordert hat, wiegt den Nutzer im falschen Glauben, die Daten seien weg. | `true` oder `false` senden. |
| `INVALID_INCLUDE` | 400 | `?include=` ist fehlerhaft: keine gültige Pfadliste oder tiefer geschachtelt als die maximale Tiefe erlaubt. Wird an der Schnittstelle abgefangen, anstatt aus dem Treiber als 500 zu entkommen. | Siehe die Nachricht; sie nennt den fehlerhaften Pfad. |
| `INVALID_INPUT` | 400 | Der Body hat die Validierung nicht bestanden. | Siehe die Nachricht. |
| `INVALID_LIMIT` | — | Ein Realtime-Abonnement hat ein Limit außerhalb des zulässigen Bereichs angefordert. Wird als WebSocket-`ERROR`-Frame übermittelt, nicht als HTTP-Antwort. | Das Limit verringern. |
| `INVALID_LOGICAL_GROUP` | 400 | Eine `?or=` / `?and=`-Gruppe ist fehlerhaft aufgebaut oder tiefer geschachtelt als zulässig. | Siehe die Nachricht; sie zeigt die Flattening-Regel. |
| `INVALID_OFFSET` | 400 | `?offset=` ist keine ganze Zahl größer oder gleich 0. | Eine nicht-negative Ganzzahl senden. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` entspricht nicht `field`, `field:desc` oder einem JSON-Array von `{ field, direction }`. | Siehe die Nachricht; sie zeigt alle drei Schreibweisen. |
| `INVALID_PAGE` | 400 | `?page=` ist keine ganze Zahl größer oder gleich 1. Seiten sind 1-basiert, daher ist `?page=0` ein Fehler und nicht die erste Seite. | `1` oder höher senden oder `?offset=` verwenden. |
| `INVALID_PARAM` | 400 | Ein Abfrageparameter ist fehlerhaft. | Siehe die Nachricht. |
| `INVALID_VECTOR` | 400 | `?vector=` ist kein JSON-Array von Zahlen. | `[0.1,0.2,0.3]` senden. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` ist weder `cosine`, `l2` noch `inner_product`. | Einen dieser drei Werte verwenden. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` ist keine Zahl. | Eine Zahl senden. |
| `INVALID_WHERE` | 400 | `?where=` ist kein JSON-Objekt, das Felder auf Bedingungen abbildet. | `{"status":["==","active"]}` senden. |
| `MISSING_AGGREGATE_SELECT` | 400 | Die Aggregat-Route wurde ohne `?select=` aufgerufen. | Einen Parameter hinzufügen, z. B. `?select=count()`. |
| `NO_COLLECTIONS` | 404 | Das Projekt stellt keine Collections bereit: weder im Code deklariert noch gibt es Tabellen, aus denen sie abgeleitet werden könnten. | Tabellen erstellen – per Migration, SQL oder einer Collection-Datei plus `rebase db push` – und neu starten. |
| `NOT_FOUND` | 404 | Keine Zeile mit dieser ID in dieser Collection – oder eine Zeile, die durch Row-Level Security vor diesem Aufrufer verborgen wird. | Die ID prüfen, danach die `securityRules` der Collection. |
| `UNKNOWN_RELATION` | 400 | `?include=` benennt etwas, das keine Relation der Collection ist. Derselbe Code antwortet mit **404**, wenn stattdessen ein geschachtelter *URL-Pfad* eine solche benennt, z. B. `/api/data/authors/1/posts`, wenn `authors` keine deklariert – dort verweist die URL ins Leere, weshalb es sich um ein "Not Found" und nicht um eine fehlerhafte Anfrage handelt. | Den Namen der Relation prüfen – die Nachricht listet die vorhandenen auf. Eine Rückwärtsreferenz muss auf dem Parent deklariert sein, um traversierbar zu sein. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | Die Sortierung benennt ein Feld, das nicht sortierbar ist. | Nach einer spaltenbasierten Eigenschaft sortieren. |
| `PAYLOAD_TOO_LARGE` | 413 | Der Body überschreitet das konfigurierte Limit. | Weniger Daten senden oder das Limit erhöhen. |
| `READ_ONLY_TRANSACTION` | 409 | Ein `afterRead`-Callback hat versucht zu schreiben. Ein anfragebezogener Lesevorgang läuft in einer `READ ONLY`-Transaktion, daher darf weder der Callback noch etwas, das er aufruft, schreiben. | Den Schreibvorgang aus dem Lesevorgang herauslösen: ein Hintergrundjob oder `rebase.dataAsAdmin` aus einem Cron-Job oder einer benutzerdefinierten Funktion. |
| `RELATION_MISCONFIGURED` | 500 | Eine Relation lässt sich anhand des registrierten Schemas nicht auflösen. Die Operation wird verweigert statt übersprungen: Ein Verwerfen würde Erfolg für einen Schreibvorgang melden, der nie stattfand, oder Leere für Zeilen zurückgeben, die existieren. | `rebase schema generate` ausführen, wenn das generierte Schema älter als die Datenbank ist. |
| `RELATION_NOT_UNLINKABLE` | 400 | Die Verknüpfung der Relation kann von dieser Seite aus nicht aufgehoben werden. | Von der besitzenden Seite aus schreiben. |
| `RELATION_NOT_WRITABLE` | 400 | Der geschachtelte Pfad ist keine beschreibbare Relation. | Siehe [Relationen](/docs/collections/relations/). |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | Ein Relations-Schreibvorgang hatte keinen Quellschlüssel, an den der Link angehängt werden konnte. | Die übergeordnete Zeile zuerst speichern. |
| `SCHEMA_DRIFT` | 500 | Eine vom Code erwartete Tabelle oder Spalte existiert in der Datenbank nicht. | `rebase db push` in der Entwicklung; bei einem verwalteten Mandanten neu deployen. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | `startAfter` wurde mit `orderBy: "_score"` kombiniert. Die Relevanz wird pro Abfrage berechnet und nicht gespeichert, daher kann sie nicht als Schlüssel für einen Cursor dienen. | Relevanz mit `limit`/`offset` paginieren oder nach einer Spalte sortieren. |
| `TENANT_IMMUTABLE` | 400 | Ein Schreibvorgang würde eine Zeile von einem Mandanten zu einem anderen verschieben. Eine Zeile kann den Mandanten nicht wechseln. `details.violations` nennt das Feld. | Die Zeile im anderen Mandanten erstellen und diese löschen, oder mit einer Rolle in `tenant.bypassRoles` schreiben. |
| `TENANT_MISMATCH` | 400 | Der Schreibvorgang benennt einen Mandanten, zu dem dieser Aufrufer nicht gehört; die Datenbank würde dies ebenfalls verweigern. | In einen Mandanten schreiben, dem der Aufrufer angehört, oder sich als zugehöriger Benutzer authentifizieren. |
| `TENANT_REQUIRED` | 400 | Die Collection ist mandantenbezogen und der Mandant kann nicht abgeleitet werden: Die Anfrage enthält keinen Mandanten oder der Aufrufer gehört mehreren an. | Das Mandantenfeld explizit senden oder sich als Aufrufer authentifizieren, der genau einem angehört. |
| `UNKNOWN_FIELD` | 400 | `?fields=` benennt ein Feld, das die Collection nicht besitzt. | Die Schreibweise prüfen; die Nachricht listet die gültigen Felder auf. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Ein Aggregat oder `groupBy` benennt ein Feld, das die Collection nicht besitzt. | Die Schreibweise prüfen; die Nachricht listet die gültigen Felder auf. |
| `UNKNOWN_FILTER_FIELD` | 400 | Der Filter benennt ein Feld, das diese Collection – oder das Ziel einer Relation – nicht besitzt. | Die Schreibweise prüfen; die Nachricht listet die gültigen Felder auf. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | Der Filter benennt einen nicht existierenden Operator. | Die Nachricht listet alle verfügbaren Operatoren auf. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | Die Sortierung benennt ein Feld, das diese Collection nicht besitzt. | Die Schreibweise prüfen; die Nachricht listet die gültigen Felder auf. |
| `PRECONDITION_FAILED` | 412 | Ein `If-Match` hat eine Version der Zeile benannt, die nicht mehr aktuell ist: Jemand hat zwischen dem Lesen und diesem Schreiben darauf geschrieben. Es wurde nichts geschrieben. | Die Zeile erneut lesen, die Änderung erneut anwenden und das neue `ETag` senden. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` fordert ein Feld an, das die Collection nicht besitzt. | Die Schreibweise prüfen; die Nachricht listet die bekannten Felder auf. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Eine Vektorsuche hat ein Feld benannt, das in dieser Collection kein `vector` ist. | Die Nachricht listet die Vektor-Eigenschaften der Collection auf. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Der `Content-Type` wird von dieser Route nicht akzeptiert. | Den in der Routendokumentation angegebenen Typ senden. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | Der Filter kreuzt eine `via`-Relation, deren Join-Pfad nur in eine Richtung definiert ist, sodass keine Zuordnung für eine Unterabfrage möglich ist. | Von der besitzenden Seite aus filtern. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | Der Operator ist für dieses Feld nicht definiert: Eine Relation ohne Spalte in dieser Zeile wird über Mitgliedschaft gefiltert, und Abgleiche ohne Berücksichtigung der Groß-/Kleinschreibung gelten nur für Text. | Siehe die Nachricht; sie listet auf, was das Feld akzeptiert. |
| `VALIDATION_CONSTRAINT` | 400 | Ein Wert hat eine von der Eigenschaft deklarierte `validation`-Regel verletzt – eine Länge, einen Bereich, ein Muster oder ein Pflichtfeld. | Siehe die Nachricht; sie nennt jede Verletzung. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | Der Body beschreibt eine Spalte, die mit `excludeFromApi` oder `access: { write: [] }` markiert ist – dieselbe Regel in zwei Schreibweisen. Diese dürfen nur vom Server gesetzt werden: ein Passworthash, ein Verifizierungstoken. Im Gegensatz zu `FIELD_NOT_WRITABLE` ist dies die gleiche Antwort für jeden Aufrufer, einschließlich `admin`. | Das Feld entfernen. Siehe [Feldzugriff](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | Ein Wert passt nicht zu seinem Eigenschaftstyp. | Siehe die Nachricht; sie nennt die Eigenschaft. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | Der Body benennt ein Feld, das die Collection nicht besitzt – einschließlich eines `id`-Arguments bei einer Collection, die einen anderen Primärschlüssel verwendet. | Die Schreibweise prüfen; die Nachricht listet die bekannten Felder auf. |
| `WRITE_DENIED` | 403 | Eine Sicherheitsregel oder eine Row-Level-Security-Policy hat den Schreibvorgang verweigert. | Die `securityRules` der Collection prüfen. |

## `PG_<SQLSTATE>` — Ein von der Datenbank abgelehnter Constraint

Ein Schreibvorgang, den Postgres aus einem Grund ablehnt, der in den *Daten des Aufrufers* liegt, antwortet
mit dem SQLSTATE im Code: `PG_23505`, `PG_23503` usw. Das ist eine
Familie, keine feste Liste – Postgres definiert Hunderte von SQLSTATEs –, aber nur zwei
Klassen gelangen jemals hierher, da nur diese beiden in der Verantwortung des Aufrufers liegen:

- **Klasse 23**, Integritäts-Constraint-Verletzung (Integrity Constraint Violation): ein Duplikat, ein Fremdschlüssel, der ins Leere zeigt, eine leere `NOT NULL`-Spalte;
- **Klasse 22**, Daten-Ausnahme (Data Exception): ein Wert, den der Typ der Spalte nicht aufnehmen kann.

Alles andere – eine abgebrochene Verbindung, eine fehlende Spalte, ein Berechtigungsproblem –
liegt in der Verantwortung des Servers und bleibt ein `500`. Daher ist `code.startsWith("PG_")` eine sichere Prüfung
für „Die von mir gesendete Zeile war fehlerhaft“, und die folgenden vier sind diejenigen, auf die
ein Client tatsächlich trifft. `details.dbCode` enthält bei allen denselben SQLSTATE, und
die Nachricht nennt den Constraint.

| Code | Status | Bedeutung | Was zu tun ist |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | Ein Wert konnte nicht als Typ der Spalte gelesen werden – das schreibseitige Gegenstück zu `INVALID_FILTER_VALUE`. | Einen Wert senden, der dem Typ der Spalte entspricht. |
| `PG_23502` | 400 | Eine `NOT NULL`-Spalte wurde leer gelassen. | Das Feld mitsenden oder der Spalte einen Standardwert geben. |
| `PG_23503` | 400 | Ein Fremdschlüssel verweist auf eine nicht existierende Zeile. | Die Zielzeile zuerst erstellen oder die ID korrigieren. |
| `PG_23505` | 409 | Ein Unique-Constraint wurde verletzt. Die Nachricht nennt den Constraint. | Einen anderen Wert verwenden oder die bestehende Zeile aktualisieren. |

## Storage

| Code | Status | Bedeutung | Was zu tun ist |
| --- | --- | --- | --- |
| `INVALID_STORAGE_BUCKET` | 400 | Der Bucket-Name ist fehlerhaft. | Den Namen prüfen. |
| `INVALID_STORAGE_KEY` | 400 | Der Objektschlüssel ist fehlerhaft oder verlässt sein Präfix. | Den Schlüssel prüfen. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | Die Bildtransformationsparameter liegen außerhalb des Bereichs oder widersprechen sich. | Siehe [Storage](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | Der Upload überschreitet das von der Zieleigenschaft deklarierte `maxSize`. Wird auf dem Server erzwungen, nicht nur im Browser. `details` enthält die Eigenschaft, das Limit und die tatsächliche Größe. | Eine kleinere Datei hochladen oder `maxSize` der Eigenschaft erhöhen. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | Der Typ des Uploads ist nicht in `acceptedFiles` der Eigenschaft enthalten. `details` enthält die Eigenschaft, die Liste akzeptierter Typen und den gesendeten Content-Type. | Einen akzeptierten Dateityp hochladen oder `acceptedFiles` erweitern. |
| `STORAGE_NOT_CONFIGURED` | 503 | Auf diesem Server ist kein Storage-Backend konfiguriert. | S3, GCS oder lokalen Speicher konfigurieren. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | Die Storage-Quelle ist deklariert, verfügt hier jedoch über keine Zugangsdaten. | Die Umgebungsvariablen für diese Quelle setzen. |
| `STORAGE_WRITE_FAILED` | 502 | Das Storage-Backend hat den Schreibvorgang verweigert oder abgebrochen. | Die Protokolle und Zugangsdaten des Backends prüfen. |
| `TRANSFORM_OVERLOADED` | 503 | Zu viele Bildtransformationen werden gleichzeitig ausgeführt. | Wiederholen; ein vorgeschaltetes CDN in Betracht ziehen. |
| `UNKNOWN_STORAGE_SOURCE` | 400 | Die Anfrage hat eine Storage-Quelle (`?storageId=`) benannt, die dieses Projekt nicht deklariert. Ein `bucket`, den dieses Deployment nicht bedient, liefert denselben Code mit **404** – der Store ist das, was fehlt, und `details` listet die tatsächlich existierenden Buckets und Quellen auf. Beides wurde früher als „Datei nicht gefunden“ zurückgegeben, identisch mit einem Schlüssel, der schlicht nicht existiert. | Die Quelle in `config/resources.ts` deklarieren oder `GET /api/storage/sources` prüfen. |

## Benutzerdefinierte Funktionen

| Code | Status | Bedeutung | Was zu tun ist |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | Es wird keine Funktion dieses Namens bereitgestellt – oder eine existiert, aber ihre eigenen Routen decken den Pfad danach nicht ab. Einem angemeldeten Aufrufer wird auch mitgeteilt, was *tatsächlich* bereitgestellt wird; einem anonymen nicht, da diese Liste eine Bestandsaufnahme jedes benutzerdefinierten Endpunkts darstellt. Wenn eine Datei dieses Namens nicht geladen werden konnte, gibt die Nachricht dies an: Das ist der Unterschied zwischen einem Tippfehler und einem fehlerhaften Deployment. | Den Namen mit `GET /api/functions` abgleichen oder das Startprotokoll auf Dateien prüfen, die nicht geladen werden konnten. |
| `FUNCTION_TIMEOUT` | 504 | Der Handler hat sein Timeout überschritten. Er läuft weiterhin; er kann von hier aus nicht abgebrochen werden. | Ausgehenden Aufrufen ein `AbortSignal` übergeben oder `REBASE_FUNCTIONS_TIMEOUT_MS` erhöhen. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Dieser Prozess leitet Funktionen per Proxy an einen anderen weiter, der nicht geantwortet hat. | Sicherstellen, dass die Functions-Instanz läuft. |

## Admin-Oberflächen und Schemabearbeitung

Diese Codes zeigen an, dass ein Feature deaktiviert oder nicht konfiguriert ist, und nicht, dass die Anfrage
fehlerhaft war. Jeder dieser Fehler wird auf der entsprechenden `/status`-Route auch mit einem `200` gemeldet,
sodass ein UI-Panel das Feature ausgrauen kann, anstatt einen Fehler anzuzeigen.

| Code | Status | Bedeutung | Was zu tun ist |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | Eine reine Administrator-Oberfläche wurde auf einem Server ohne konfigurierte Authentifizierung aufgerufen, sodass ein Administrator nicht von einem beliebigen Besucher unterschieden werden kann. | `auth.jwtSecret` setzen oder einen `AuthAdapter` übergeben. |
| `CONTRACT_UNAVAILABLE` | 404 | Der Projektvertrag wird nur bereitgestellt, wenn die Authentifizierung konfiguriert ist – er beschreibt jede Tabelle und Relation. | Authentifizierung konfigurieren. `/meta/schema-version` wird immer ausgeliefert. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | Kein Entwicklungs-Postfach aktiv. E-Mails werden nur abgefangen, wenn `SMTP_HOST` nicht gesetzt und `NODE_ENV` nicht `production` ist. | In der Entwicklung `SMTP_HOST` entfernen oder das echte Postfach prüfen. |
| `INVALID_CHANGE` | 400 | Die vorgeschlagene Schemaänderung ist nicht wohlgeformt. | Siehe die Nachricht. |
| `SCHEMA_CHANGE_FAILED` | 400 | Das Anwenden einer geplanten Schemaänderung ist aus einem Grund fehlgeschlagen, den spezifischere Codes nicht abdecken. | Siehe die Nachricht; sie enthält den zugrunde liegenden Fehler im Wortlaut. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | Die Änderung ist gültig, kann aber auf den aktuellen Stand des Schemas nicht angewendet werden. | Siehe die Nachricht. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | Das Repository enthält nicht committete Änderungen, sodass die Bearbeitung nicht sicher angewendet werden konnte. | Committen oder stashen, dann wiederholen. |
| `SCHEMA_EDIT_REFUSED` | 400 | Der Schema-Editor hat die Änderung verweigert. | Siehe die Nachricht; sie enthält die Ablehnung des Editors im Wortlaut. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Ein API-Schlüssel oder ein anderer maschineller Principal hat versucht, eine Schemaänderung anzuwenden. | Als Benutzer anmelden oder `liveSchema.allowMachineApply` setzen. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | Die Live-Schemabearbeitung benötigt `collectionsDir` oder `liveSchema.repository`, und dieser Server wurde mit keinem von beiden gestartet. | Eines davon konfigurieren. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | Die Planung funktioniert; es gibt jedoch kein Repository, in das die Änderung committet werden könnte. | `liveSchema.repository` konfigurieren. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Dieser Treiber kann keine Schemaänderungen planen. | Live-Bearbeitung ist unter Postgres verfügbar. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | Collections werden hier aus der Datenbank introspektiert, daher gibt es keine Quelldateien zu bearbeiten. | Das Schema mittels einer Migration ändern. |
| `SCHEMA_EDITOR_DISABLED` | 501 | Der Schema-Editor ist für diesen Server deaktiviert. | Über `schemaEditor` aktivieren. |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | Der Schema-Editor benötigt `ts-morph`, welches nicht installiert ist. | `pnpm add -D ts-morph@28.0.0` ausführen. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | Der Server hat kein `collectionsDir`, sodass der Editor kein Ziel zum Schreiben hat. | `collectionsDir` setzen. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | Der Editor ist unter `NODE_ENV=production` deaktiviert: Die Dateien eines deployten Servers werden bei jedem Deployment aus Ihrem Repository neu gebaut, sodass eine Bearbeitung hier verworfen werden würde. | Collections in der Entwicklungsumgebung bearbeiten und deployen. |

## Allgemeine Codes

Eine Route verwendet einen dieser Codes, wenn kein spezifischerer Code zutrifft.

| Code | Status | Bedeutung | Was zu tun ist |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Fehlerhaft aufgebaut, und es trifft kein spezifischerer Code zu. | Siehe die Nachricht. |
| `UNAUTHORIZED` | 401 | Nicht authentifiziert oder die Anmeldedaten wurden abgelehnt. | Anmelden oder aktualisieren. |
| `FORBIDDEN` | 403 | Authentifiziert, aber nicht berechtigt. | Ein erneuter Versuch mit derselben Identität hilft nicht. |
| `CONFLICT` | 409 | Ein Konflikt mit dem bestehenden Zustand. | Siehe die Nachricht. |
| `INTERNAL_ERROR` | 500 | Auf dem Server ist ein Fehler aufgetreten. Die Nachricht ist bewusst generisch gehalten. | Die `requestId` angeben; die Ursache steht in den Protokollen. |
| `NOT_CONFIGURED` | 503 | Eine Abhängigkeit, die diese Route benötigt, ist auf diesem Server nicht konfiguriert. | Siehe die Nachricht. |
| `SERVICE_UNAVAILABLE` | 503 | Eine Abhängigkeit war nicht erreichbar. | Wiederholen; die Protokolle prüfen. |

## Diese Seite aktuell halten

`pnpm verify:docs` schlägt fehl, wenn ein Code, den der Server auslösen kann, in diesen
Tabellen fehlt, wenn eine Tabelle einen Code auflistet, den nichts auslösen kann, wenn ein angegebener Status
nicht mit dem Quellcode übereinstimmt oder wenn eine Code-Familie wie `PG_<SQLSTATE>` keine Zeile
für einen SQLSTATE hat, auf den Aufrufer treffen können. Der entsprechende Schritt ist
`tooling/scripts/docs-verify/check-error-codes.mjs`.

Dieser Schritt überprüft sich zuerst selbst. Der Scan liest Codes aus TypeScript und nicht aus
einem laufenden Server aus, sodass seine toten Winkel konstruktionsbedingt unbemerkt bleiben: Er konnte
einst keinen Code erkennen, der über einen Einzeiler-Wrapper übergeben wurde, oder einen, der nach einer Nachricht
mit einer `)` stand, und meldete „Jeder Code, den der Server auslösen kann, ist dokumentiert“,
obwohl auf der Seite siebzehn fehlten. Daher führt dieser Schritt eine Testvorlage (Fixture) mit genau
diesen Mustern aus, bevor er diese Seite liest, und weigert sich, etwas zu melden, wenn er
diese nicht erkennen kann.

---
