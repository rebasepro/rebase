---
sourceHash: b82ed0c23d6537de
title: Fehlercodes
sidebar_label: Fehlercodes
description: Jeder Fehlercode, den ein Rebase-Backend zurückgeben kann, samt HTTP-Status, Bedeutung und Behebung – plus Antwort-Envelope, X-Request-ID und Details-Regeln.
---

Jeder Fehler, den ein Rebase-Backend zurückgibt, verwendet denselben Envelope und enthält einen stabilen
`code`. Der Code ist das Kriterium für Fallunterscheidungen: Die Nachricht ist für Menschen
verfasst und kann umformuliert werden, der Status wird von einem Dutzend verschiedener Probleme
geteilt, und der Code ist keines von beidem.

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

- **`message`** — menschenlesbar. Bei einem `4xx` ist es die eigene Nachricht des Servers; bei
  einem `5xx` ist sie bewusst generisch gehalten, da der zugrunde liegende Text einen Host,
  eine Rolle oder einen Spaltennamen enthalten kann.
- **`code`** — einer der unten aufgeführten Werte. Stabil über Minor-Versionen hinweg.
- **`details`** — optional und niemals garantiert. Siehe die nachfolgenden Regeln.
- **`requestId`** — vorhanden, sobald der Request die Request-ID-Middleware durchlaufen hat,
  was für jede Route unter `basePath` der Fall ist.

### `X-Request-ID`

Jeder Request unter `basePath` erhält eine ID: den `X-Request-ID`-Header des Aufrufers,
wenn es sich um eine gültige UUID v4 handelt, andernfalls eine neu generierte. Sie wird in der
Response als `X-Request-ID` zurückgespiegelt, im Fehler-Envelope als `requestId` eingefügt und
an die Protokollzeile des Servers für diesen Request angehängt.

Das ist der Verknüpfungsschlüssel. Geben Sie ihn in einem Fehlerbericht an, damit ein Operator
genau die Protokollzeile finden kann, die den Fehler erklärt und den Grund enthält, der dem
Client vorenthalten wurde.

Das Senden einer eigenen ID ermöglicht es einem Trace, Hops zu überstehen: Ein Gateway oder
ein Job-Runner, der den Header weiterleitet, sorgt für eine einheitliche ID über alle Services
hinweg, die den Request verarbeitet haben. Ein ungültiger Wert wird ignoriert statt abgelehnt –
ein fehlerhafter Header eines Aufrufers rechtfertigt keinen fehlschlagenden Request –, gehen Sie
also nicht davon aus, dass die gesendete ID der erhaltenen ID entspricht. Prüfen Sie den Response-Header.

### Was in `details` enthalten ist

`details` dient der Diagnose, nicht als Vertrag. Drei Regeln gelten dafür:

1. **Alles, was eine Route explizit setzt, wird immer zurückgegeben.** Dies sind präzise
   beschriebene Fehler des Aufrufers: welches Filterfeld unbekannt war, welche Relation
   nicht schreibbar ist, welcher Wert nicht zum Typ passte.
2. **Datenbank-Diagnosen werden in Produktionsumgebungen gekürzt.** Wenn der Fehler von
   Postgres stammt, ist `details.dbCode` — der SQLSTATE — immer vorhanden: Er benennt die
   Problemklasse und gibt keine Daten preis. `dbMessage`, `detail` und `hint` werden nur
   hinzugefügt, wenn `NODE_ENV` nicht `production` ist, da Postgres Zeileninhalte darin
   platziert. `23505` meldet `Key (email)=(a@b.c) already exists.`, was für jede beliebige
   Adresse die Frage beantwortet: „Ist diese Person registriert?“.
3. **Führen Sie niemals Verzweigungen anhand von `details` durch.** Verwenden Sie stattdessen
   `code`. Der Inhalt von `details` dient rein der menschlichen Diagnose an der jeweiligen
   Aufrufstelle und kann sich ändern.

## Einen Status interpretieren

| Status | Bedeutung für den Request |
| --- | --- |
| `400` | Fehlerhaft aufgebaut oder fordert etwas an, das im Schema nicht existiert. Korrigieren Sie den Request. |
| `401` | Nicht authentifiziert oder die Anmeldedaten sind abgelaufen. Melden Sie sich an oder aktualisieren Sie das Token. |
| `403` | Authentifiziert, aber nicht autorisiert. Ein erneuter Versuch mit derselben Identität hilft nicht. |
| `404` | Keine solche Route, Collection oder Zeile – oder eine Zeile, die durch Row-Level Security verborgen wird. |
| `409` | Konflikt mit dem bestehenden Zustand: ein Duplikat oder ein gleichzeitiger Schreibvorgang. |
| `413` `415` `422` | Der Body ist zu groß, hat den falschen Medientyp oder wurde semantisch abgelehnt. |
| `429` | Ratenbegrenzung überschritten (Rate limited). Warten Sie ab; die Nachricht gibt an, wie lange. |
| `500` | Der Fehler liegt beim Server oder seiner Datenbank, nicht beim Aufrufer. Überprüfen Sie die Protokolle. |
| `501` | Die Route existiert, aber dieses Deployment kann sie nicht bedienen – eine Funktion ist deaktiviert oder unkonfiguriert. |
| `502` `503` `504` | Eine Abhängigkeit war nicht erreichbar, unkonfiguriert oder zu langsam. |

## Authentifizierung und Konten

| Code | Status | Bedeutung | Maßnahme |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | Die Route erfordert einen zweiten Faktor und die Session verfügt nur über einen. | Schließen Sie die MFA-Challenge ab und versuchen Sie es erneut. |
| `ALREADY_VERIFIED` | 400 | Die Adresse oder der Faktor ist bereits verifiziert. | Nichts – der gewünschte Zustand ist bereits erreicht. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | Anonyme Anmeldung ist auf diesem Server deaktiviert. | Aktivieren Sie sie oder melden Sie sich mit einer echten Identität an. |
| `API_KEY_FORBIDDEN` | 403 | Ein API-Schlüssel wurde auf einer Route verwendet, die nur von Personen aufgerufen werden darf. | Verwenden Sie eine Benutzersitzung. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Ein API-Schlüssel hat versucht, API-Schlüssel zu erstellen, aufzulisten oder zu widerrufen. | Verwalten Sie Schlüssel als angemeldeter Administrator. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Eine geschützte Route wurde ohne vorherige Rebase-Auth-Middleware ausgeführt, sodass die Anmeldedaten des Aufrufers nie geprüft wurden. | Binden Sie die App über den Functions-Router ein, anstatt sie direkt in Ihren eigenen Server einzuhängen. |
| `BOOTSTRAP_ANONYMOUS` | 403 | Der Bootstrap des ersten Administrators wurde von einem anonymen Aufrufer versucht. | Melden Sie sich zuerst an. |
| `BOOTSTRAP_COMPLETED` | 403 | Der erste Administrator existiert bereits. | Lassen Sie sich die Rolle von einem bestehenden Administrator zuweisen. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | Bootstrap ist nur für den allerersten Benutzer gedacht, und dies ist nicht dieser Benutzer. | Lassen Sie sich die Rolle von einem bestehenden Administrator zuweisen. |
| `CAPTCHA_FAILED` | 400 | Der Anbieter hat das CAPTCHA-Token abgelehnt. | Lösen Sie ein neues Challenge. |
| `CAPTCHA_REQUIRED` | 400 | Die Route erfordert ein CAPTCHA-Token und es wurde keines gesendet. | Fügen Sie das Token bei. |
| `CHALLENGE_EXHAUSTED` | 401 | Zu viele falsche Codes für eine MFA-Challenge. | Starten Sie eine neue Challenge. |
| `EMAIL_EXISTS` | 409 | Ein Konto mit dieser Adresse existiert bereits. | Melden Sie sich an oder initiieren Sie das Zurücksetzen des Passworts. |
| `EMAIL_NOT_CONFIGURED` | 503 | Magic Links oder OTP wurden angefordert, aber der Server verfügt über keinen E-Mail-Transport. | Konfigurieren Sie SMTP oder nutzen Sie eine andere Anmeldemethode. |
| `EMAIL_NOT_VERIFIED` | 403 | Das Konto existiert und seine Adresse ist nicht verifiziert. | Verifizieren Sie die Adresse. |
| `FACTOR_NOT_VERIFIED` | 400 | Der MFA-Faktor wurde registriert, aber nie bestätigt. | Bestätigen Sie den Faktor. |
| `IDENTITY_ALREADY_LINKED` | 409 | Diese OAuth-Identität gehört zu einem anderen Konto. | Melden Sie sich damit an oder heben Sie die Verknüpfung dort zuerst auf. |
| `INVALID_ACCOUNT` | 400 | Das Konto befindet sich in einem Zustand, auf den diese Operation nicht angewendet werden kann. | Siehe Nachricht. |
| `INVALID_CHALLENGE` | 400 | Die MFA-Challenge ist unbekannt oder abgelaufen. | Starten Sie eine neue. |
| `INVALID_CODE` | 401 | Der OTP- oder MFA-Code ist falsch. | Versuchen Sie es mit dem aktuellen Code erneut. |
| `INVALID_CREDENTIALS` | 401 | Falsche E-Mail-Adresse oder falsches Passwort – bewusst ohne Angabe, was davon zutrifft. | Versuchen Sie es erneut oder setzen Sie das Passwort zurück. |
| `INVALID_TOKEN` | 400 | Ein Verifizierungs-, Reset- oder Magic-Link-Token ist fehlerhaft oder unbekannt. | Fordern Sie einen neuen Link an. |
| `LAST_ADMIN` | 403 | Die Änderung würde dazu führen, dass das Projekt keinen Administrator mehr hat. | Befördern Sie zuerst eine andere Person. |
| `MFA_REQUIRED` | 401 | Das Passwort war korrekt und das Konto hat einen verifizierten zweiten Faktor, daher ist die Anmeldung erst zur Hälfte abgeschlossen. `details` enthält ein kurzlebiges Token, das auf die MFA-Challenge beschränkt ist – es ist keine Session. | Öffnen Sie eine Challenge und beantworten Sie diese; die Challenge-Response stellt die Session aus. |
| `NO_SESSION` | 401 | Es wurde weder ein Session-Cookie noch ein Refresh-Token übermittelt. Normal beim ersten Laden einer Seite. | Melden Sie sich an. |
| `NOT_ANONYMOUS` | 400 | Eine Upgrade-Route von einem anonymen Konto wurde von einem echten Konto aufgerufen. | Nichts zum Upgraden vorhanden. |
| `OAUTH_ERROR` | 401 | Der OAuth-Provider hat die Anfrage abgelehnt oder einen Fehler zurückgegeben. | Wiederholen Sie den Ablauf; die Nachricht enthält die Begründung des Providers. |
| `RATE_LIMITED` | 429 | Zu viele Versuche von diesem Aufrufer. | Warten Sie ab; die Nachricht gibt an, wie lange. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | Das Weiterleitungsziel steht nicht auf der Allowlist. | Fügen Sie es zur Provider-Konfiguration hinzu. |
| `REGISTRATION_DISABLED` | 403 | Die Self-Service-Registrierung ist deaktiviert. | Lassen Sie das Konto von einem Administrator anlegen. |
| `ROLE_EXISTS` | 409 | Dieser Rollenname ist bereits vergeben. | Wählen Sie einen anderen Namen. |
| `ROLE_LOOKUP_FAILED` | 503 | Rollen konnten für einen durch Admin-Rechte geschützten Request nicht gelesen werden. Verweigert vorsichtshalber den Zugriff (fail-closed), anstatt dem Claim des Tokens blind zu vertrauen. | Versuchen Sie es erneut; überprüfen Sie die Datenbank. |
| `SELF_DELETE` | 400 | Ein Administrator hat versucht, sein eigenes Konto zu löschen. | Lassen Sie dies durch einen anderen Administrator ausführen. |
| `SESSION_REVOKED` | 401 | Die Session wurde an anderer Stelle abgemeldet oder alle Sessions wurden widerrufen. | Melden Sie sich erneut an. |
| `SETUP_REQUIRED` | 403 | Das Projekt hat noch keinen Administrator, daher ist diese Route nicht verfügbar. | Schließen Sie die Ersteinrichtung des Administrators ab. |
| `TOKEN_ALREADY_USED` | 401 | Ein Einmal-Token wurde wiederholt verwendet. | Fordern Sie ein neues an. |
| `TOKEN_EXPIRED` | 401 | Das Token hat seine Lebensdauer überschritten. | Fordern Sie ein neues an. |
| `USER_NOT_FOUND` | 404 | Kein Konto mit dieser ID vorhanden. | Prüfen Sie die ID. |
| `WEAK_PASSWORD` | 400 | Das Passwort entspricht nicht den konfigurierten Richtlinien. | Wählen Sie ein sichereres Passwort. |

## Daten, Abfragen und Schreibvorgänge

| Code | Status | Bedeutung | Maßnahme |
| --- | --- | --- | --- |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Dieser Treiber kann das angeforderte Aggregat nicht berechnen. | Verwenden Sie einen Treiber, der dies unterstützt, oder berechnen Sie es im Client. |
| `BRANCHING_UNSUPPORTED` | — | Ein Datenbank-Branch wurde über das Studio-WebSocket auf der verwalteten Entwicklungsdatenbank (PGlite) angefordert, bei der ein Branch mit dem Parent identisch ist und nichts isoliert werden würde. Die Ablehnung entspricht der Ausgabe von `rebase db branch`. | Richten Sie `DATABASE_URL` auf ein eigenes Postgres (`rebase dev --docker` startet eines) und erstellen Sie dort Branches. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` enthält mehr Operationen als das Limit pro Batch (standardmäßig 1000). Ein Batch bildet eine Transaktion und hält Locks für deren gesamte Dauer. | Senden Sie ihn in Chunks; die Nachricht nennt das Limit und Ihre Anzahl. |
| `BATCH_UNSUPPORTED` | 400 | Der Treiber dieses Backends kann Schreibvorgänge über Collections hinweg nicht atomar ausführen, und eine Schleife von Einzelschreibvorgängen wäre weder atomar noch ein einzelner Roundtrip. | Senden Sie die Schreibvorgänge als separate Requests oder als `/bulk`-Aufrufe pro Collection. |
| `BULK_TOO_LARGE` | 400 | Der Bulk-Body überschreitet das konfigurierte Elementlimit. | Teilen Sie den Request auf. |
| `BULK_UNSUPPORTED` | 400 | Diese Collection oder dieser Treiber unterstützt keine Bulk-Schreibvorgänge. | Schreiben Sie die Zeilen einzeln nacheinander. |
| `CALLBACK_REJECTED` | 400 | Ein Collection-Callback hat den Schreibvorgang verweigert. Ein `throw` aus `beforeSave`/`beforeDelete`/`after*` ist ein 400er-Fehler mit der eigenen Nachricht des Autors; ein `beforeDelete`, das `false` zurückgibt, ist ein 403er-Fehler. `details.stage` nennt den Callback, `details.path` die Collection. | Lesen Sie die Nachricht – sie wurde von diesem Projekt verfasst, nicht von Rebase. |
| `CURSOR_WITH_OFFSET` | 400 | `?after=` wurde mit `?offset=` oder `?page=` kombiniert. Ein Cursor definiert bereits, wo die Seite beginnt; ein zusätzlicher Offset überspringt stillschweigend diese Anzahl an Zeilen hinter dem Cursor – eine Lücke, die der Aufrufer in der Response nicht sehen kann. | Verwenden Sie entweder das eine oder das andere. |
| `DISTINCT_NOT_APPLICABLE` | 400 | `?distinct=true` wurde mit einer Such- oder Vektorabfrage kombiniert. Beide versehen jede Zeile mit einem Score, sodass keine zwei Zeilen jemals identisch sind und `DISTINCT` nichts zusammenfassen würde – es sähe so aus, als hätte es funktioniert, würde aber nichts ändern. | Lassen Sie eines von beiden weg. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Ein `distinct`-Lesevorgang ist nach einer Spalte sortiert, die er nicht zurückgibt. Ein `SELECT DISTINCT` kann nur nach Spalten in seiner Auswahlliste sortiert werden, andernfalls haben die zusammengefassten Zeilen keine definierte Reihenfolge. `details.fields` nennt diese Spalten. | Fügen Sie diese Felder zu `?fields=` hinzu oder entfernen Sie sie aus `?orderBy=`. |
| `DB_PERMISSION_DENIED` | 500 | Postgres hat die Anweisung abgewiesen (`42501`): Entweder verweigert eine Row-Level-Security-Policy dieser Rolle den Zugriff, oder es fehlt ein `GRANT`. | Siehe [Troubleshooting](/docs/troubleshooting/). |
| `FIELD_NOT_READABLE` | 400 | Ein Filter, `orderBy`, `fields`, Aggregat-`select` oder `groupBy` benennt ein Feld, das die Rollen dieses Aufrufers nicht lesen dürfen (`access.read`). Ein Feld, das in keiner Response enthalten sein darf, darf auch von keiner Abfrage abgefragt werden können, da der Wert sonst Prädikat für Prädikat ausgelesen werden könnte. `details.violations` nennt jedes Feld. | Entfernen Sie das Feld aus der Abfrage oder fordern Sie die Rolle an. Siehe [Field access](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 | Der Body setzt ein Feld, das die Rollen dieses Aufrufers nicht schreiben dürfen (`access.write`). Wird abgelehnt statt verworfen: Ein Schreibvorgang, der ein Feld verwirft, würde Erfolg für eine Änderung melden, die gar nicht stattgefunden hat. `details.violations` nennt jedes Feld. | Entfernen Sie das Feld oder fordern Sie die Rolle an. Ein Feld, das niemand schreiben darf, antwortet stattdessen mit `VALIDATION_EXCLUDED_FIELDS`. |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Ein früherer Request mit demselben `Idempotency-Key` wird noch ausgeführt. | Versuchen Sie es erneut, sobald er beendet ist. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | Derselbe `Idempotency-Key` wurde mit einem anderen Body gesendet. | Verwenden Sie einen neuen Schlüssel oder senden Sie den ursprünglichen Body. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` hat eine Funktion angegeben, die nicht `count`, `sum`, `avg`, `min` oder `max` ist. | Verwenden Sie eine dieser Funktionen; die Nachricht listet sie auf. |
| `INVALID_AGGREGATE_SELECT` | 400 | Ein `?select=`-Eintrag entspricht nicht dem Muster `fn(field)`, oder einer anderen Funktion als `count()` wurde kein Feld übergeben. | Schreiben Sie `sum(total)`, `count()`, `avg(score)`. |
| `INVALID_BATCH_BODY` | 400 | Bei einer `/_batch`-Operation fehlt `op`, `collection`, `values` oder `id`, sie benennt eine Collection, die dieses Backend nicht bereitstellt, oder verwendet einen `ref`-Namen mehrfach. | Siehe Nachricht; sie nennt die Operation nach Index. |
| `INVALID_BATCH_REF` | 400 | Ein `{ "$ref": "<name>.<field>" }` verweist auf keine frühere Operation, zeigt nach vorne oder verlangt ein Feld, das die referenzierte Zeile nicht besitzt. Nur Rückwärtsreferenzen können aufgelöst werden. | Benennen Sie die Operation mit `ref`, *bevor* Sie darauf verweisen. |
| `INVALID_BULK_BODY` | 400 | Der Bulk-Body entspricht nicht dem erwarteten Format. | Senden Sie das dokumentierte `items`-Array. |
| `INVALID_CONFLICT_TARGET` | 400 | Das `on_conflict` / `onConflict` eines Upserts benennt Spalten ohne Eindeutigkeitsgarantie oder benennt sie ohne `upsert: true`. Postgres würde andernfalls mit 42P10 aus einer Transaktion antworten, die bereits Arbeit verrichtet hat. | Deklarieren Sie `validation: { unique: true }` oder einen `unique`-Index; die Nachricht listet die vorhandenen Targets auf. |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` ist weder `include` noch `only`. Wird abgelehnt statt ignoriert: Ein fehlerhaft geschriebenes `?deleted=true`, das gelöschte Zeilen stillschweigend verbergen würde, sähe funktionsfähig aus, würde aber das Gegenteil bewirken. | Senden Sie `include` (aktive und gelöschte) oder `only` (nur gelöschte). Für ausschließlich aktive Zeilen weglassen. |
| `INVALID_DISTINCT` | 400 | `?distinct=` ist weder `true` noch `false`. | Senden Sie einen dieser Werte; `1` und `0` werden ebenfalls akzeptiert. |
| `INVALID_FIELD_OPERATION` | 400 | Ein `$inc` / `$push` / `$pull` / `$merge` wurde auf einem Eigenschaftstyp verwendet, für den es nicht definiert ist, mit einem Operanden im falschen Format, mit zwei Operatoren für ein Feld, fehlerhaft geschrieben oder bei einem Erstellungsvorgang – bei dem es noch keinen gespeicherten Wert gibt, auf den die Operation angewendet werden könnte. | Siehe [Writing over REST](/docs/backend/writes/#field-operations); die Nachricht nennt das Feld. |
| `INVALID_FILTER_FIELD` | 400 | Der Filter benennt eine Eigenschaft, die diese Collection nicht besitzt. | Überprüfen Sie die Schreibweise anhand der Collection. |
| `INVALID_FILTER_OPERATOR` | 400 | Der Operator wird von diesem Eigenschaftstyp nicht unterstützt. | Siehe [Querying data](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | Ein Filterwert kann nicht als Typ der Spalte interpretiert werden, mit der er verglichen wurde: `?id=eq.abc` bei einem Integer-Schlüssel, ein Label, das nicht im Enum enthalten ist, ein Timestamp, der keiner ist, eine Zahl außerhalb des Typbereichs. `details.dbCode` enthält den SQLSTATE. | Senden Sie einen Wert, der dem Typ der Spalte entspricht. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` ist weder `true` noch `false`. Jeder andere Wert wird abgewiesen statt als „Nein“ interpretiert – ein Tippfehler, der einen Soft-Delete durchführt, wenn eigentlich ein endgültiges Löschen gefordert war, würde den Aufrufer fälschlicherweise im Glauben lassen, die Daten seien weg. | Senden Sie `true` oder `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` ist fehlerhaft: keine gültige Pfadliste oder über die maximale Tiefe hinaus verschachtelt. Wird bereits an der Schnittstelle abgefangen, anstatt als 500er-Fehler aus dem Treiber zu entweichen. | Siehe Nachricht; sie nennt den fehlerhaften Pfad. |
| `INVALID_INPUT` | 400 | Der Body hat die Validierung nicht bestanden. | Siehe Nachricht. |
| `INVALID_LIMIT` | — | Eine Realtime-Subscription hat ein Limit außerhalb des zulässigen Bereichs angefordert. Wird als WebSocket-`ERROR`-Frame übermittelt, nicht als HTTP-Response. | Verringern Sie das Limit. |
| `INVALID_LOGICAL_GROUP` | 400 | Eine `?or=` / `?and=`-Gruppe ist fehlerhaft oder über die zulässige Tiefe hinaus verschachtelt. | Siehe Nachricht; sie zeigt die Glättungsregel. |
| `INVALID_OFFSET` | 400 | `?offset=` ist keine ganze Zahl größer oder gleich 0. | Senden Sie eine nicht-negative ganze Zahl. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` ist weder `field`, `field:desc` noch ein JSON-Array aus `{ field, direction }`. | Siehe Nachricht; sie zeigt alle drei Schreibweisen. |
| `INVALID_PAGE` | 400 | `?page=` ist keine ganze Zahl größer oder gleich 1. Seitenzahlen beginnen bei 1, daher ist `?page=0` ein Fehler und nicht die erste Seite. | Senden Sie `1` oder höher, oder verwenden Sie `?offset=`. |
| `INVALID_PARAM` | 400 | Ein Abfrageparameter ist fehlerhaft. | Siehe Nachricht. |
| `INVALID_VECTOR` | 400 | `?vector=` ist kein JSON-Array aus Zahlen. | Senden Sie `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` ist weder `cosine`, `l2` noch `inner_product`. | Verwenden Sie einen dieser drei Werte. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` ist keine Zahl. | Senden Sie eine Zahl. |
| `INVALID_WHERE` | 400 | `?where=` ist kein JSON-Objekt, das Felder auf Bedingungen abbildet. | Senden Sie `{"status":["==","active"]}`. |
| `MISSING_AGGREGATE_SELECT` | 400 | Die Aggregat-Route wurde ohne `?select=` aufgerufen. | Fügen Sie einen Parameter hinzu, z. B. `?select=count()`. |
| `NO_COLLECTIONS` | 404 | Das Projekt stellt keine Collections bereit: weder im Code deklariert noch gibt es Tabellen, aus denen sie abgeleitet werden könnten. | Erstellen Sie Tabellen – per Migration, SQL oder einer Collection-Datei plus `rebase db push` – und starten Sie neu. |
| `NOT_FOUND` | 404 | Keine Zeile mit dieser ID in dieser Collection – oder eine Zeile, die durch Row-Level Security vor diesem Aufrufer verborgen wird. | Überprüfen Sie die ID, danach die `securityRules` der Collection. |
| `UNKNOWN_RELATION` | 400 | `?include=` benennt etwas, das keine Relation in der Collection ist. Derselbe Code antwortet mit **404**, wenn stattdessen ein verschachtelter *URL-Pfad* eine solche benennt, z. B. `/api/data/authors/1/posts`, wenn `authors` keine deklariert – dort benennt die URL nichts, weshalb es sich um ein „Not Found“ und nicht um einen fehlerhaften Request handelt. | Prüfen Sie den Namen der Relation – die Nachricht listet die vorhandenen Relationen der Collection auf. Eine Rückwärtsreferenz muss auf dem Parent deklariert sein, um traversierbar zu sein. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | Die Sortierung benennt eine Eigenschaft, die nicht sortierbar ist. | Sortieren Sie nach einer Eigenschaft, die auf einer Spalte basiert. |
| `PAYLOAD_TOO_LARGE` | 413 | Der Body überschreitet das konfigurierte Limit. | Senden Sie weniger Daten oder erhöhen Sie das Limit. |
| `READ_ONLY_TRANSACTION` | 409 | Ein `afterRead`-Callback hat versucht zu schreiben. Ein Request-bezogener Lesevorgang läuft in einer `READ ONLY`-Transaktion, weshalb weder der Callback noch von ihm aufgerufene Funktionen schreiben dürfen. | Verlagern Sie den Schreibvorgang aus dem Lesevorgang heraus: in einen Hintergrundjob oder über `rebase.dataAsAdmin` aus einem Cronjob oder einer Custom Function. |
| `RELATION_MISCONFIGURED` | 500 | Eine Relation kann anhand des registrierten Schemas nicht aufgelöst werden. Die Operation wird verweigert statt übersprungen: Das Auslassen würde Erfolg für einen Schreibvorgang melden, der nie stattgefunden hat, oder Leere für Zeilen anzeigen, die existieren. | Führen Sie `rebase schema generate` aus, falls das generierte Schema älter als die Datenbank ist. |
| `RELATION_NOT_UNLINKABLE` | 400 | Die Verknüpfung der Relation kann von dieser Seite aus nicht aufgehoben werden. | Schreiben Sie von der besitzenden Seite aus. |
| `RELATION_NOT_WRITABLE` | 400 | Der verschachtelte Pfad ist keine beschreibbare Relation. | Siehe [Relations](/docs/collections/relations/). |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | Ein Schreibvorgang auf eine Relation hatte keinen Quellschlüssel, an den der Link gehängt werden konnte. | Speichern Sie zuerst die übergeordnete Zeile. |
| `SCHEMA_DRIFT` | 500 | Eine vom Code erwartete Tabelle oder Spalte existiert nicht in der Datenbank. | Führen Sie `rebase db push` in der Entwicklungsumgebung aus; deployen Sie bei einem Managed Tenant neu. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | `startAfter` wurde mit `orderBy: "_score"` kombiniert. Relevanz wird pro Abfrage berechnet und nicht gespeichert, daher kann sie nicht als Cursor-Schlüssel dienen. | Paginieren Sie die Relevanz mit `limit`/`offset` oder sortieren Sie nach einer Spalte. |
| `TENANT_IMMUTABLE` | 400 | Ein Schreibvorgang würde eine Zeile von einem Tenant zu einem anderen verschieben. Eine Zeile kann den Tenant nicht wechseln. `details.violations` nennt das Feld. | Erstellen Sie die Zeile im anderen Tenant und löschen Sie diese, oder schreiben Sie mit einer Rolle aus `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | Der Schreibvorgang benennt einen Tenant, zu dem dieser Aufrufer nicht gehört; die Datenbank würde ihn ebenfalls ablehnen. | Schreiben Sie in einen Tenant, zu dem der Aufrufer gehört, oder authentifizieren Sie sich als eine Identität, die zu ihm gehört. |
| `TENANT_REQUIRED` | 400 | Die Collection ist Mandanten-bezogen und der Tenant kann nicht abgeleitet werden: Der Request enthält keinen oder der Aufrufer gehört mehreren an. | Senden Sie das Tenant-Feld explizit oder authentifizieren Sie sich als Aufrufer, der genau einem Tenant angehört. |
| `UNKNOWN_FIELD` | 400 | `?fields=` benennt ein Feld, das die Collection nicht besitzt. | Überprüfen Sie die Schreibweise; die Nachricht listet die gültigen Felder auf. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Ein Aggregat oder `groupBy` benennt ein Feld, das die Collection nicht besitzt. | Überprüfen Sie die Schreibweise; die Nachricht listet die gültigen Felder auf. |
| `UNKNOWN_FILTER_FIELD` | 400 | Der Filter benennt ein Feld, das diese Collection – oder das Ziel einer Relation – nicht besitzt. | Überprüfen Sie die Schreibweise; die Nachricht listet die gültigen Felder auf. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | Der Filter benennt einen Operator, der nicht existiert. | Die Nachricht listet alle Operatoren auf. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | Die Sortierung benennt ein Feld, das diese Collection nicht besitzt. | Überprüfen Sie die Schreibweise; die Nachricht listet die gültigen Felder auf. |
| `PRECONDITION_FAILED` | 412 | Ein `If-Match` hat eine Version der Zeile benannt, die nicht mehr aktuell ist: Jemand hat zwischen dem Lesen und diesem Schreibvorgang Änderungen daran vorgenommen. Es wurde nichts geschrieben. | Zeile erneut lesen, Änderung erneut anwenden und das neue `ETag` senden. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` fordert ein Feld an, das die Collection nicht besitzt. | Überprüfen Sie die Schreibweise; die Nachricht listet die bekannten Felder auf. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Eine Vektorsuche hat eine Eigenschaft benannt, die auf dieser Collection kein `vector` ist. | Die Nachricht listet die Vektoreigenschaften der Collection auf. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Der `Content-Type` wird von dieser Route nicht akzeptiert. | Senden Sie den von der Route dokumentierten Typ. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | Der Filter überquert eine `via`-Relation, deren Join-Pfad nur unidirektional definiert ist, sodass keine Rückbeziehung für eine Unterabfrage hergestellt werden kann. | Filtern Sie von der besitzenden Seite aus. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | Der Operator ist für dieses Feld nicht definiert: Eine Relation ohne Spalte in dieser Zeile wird nach Mitgliedschaft gefiltert, und Übereinstimmungen ohne Beachtung der Groß-/Kleinschreibung gelten nur für Text. | Siehe Nachricht; sie listet auf, was das Feld akzeptiert. |
| `VALIDATION_CONSTRAINT` | 400 | Ein Wert hat eine von der Eigenschaft deklarierte `validation`-Regel verletzt – eine Länge, einen Wertebereich, ein Muster, ein Pflichtfeld. | Siehe Nachricht; sie nennt jede einzelne Verletzung. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | Der Body beschreibt eine Spalte, die mit `excludeFromApi` oder `access: { write: [] }` markiert ist – dieselbe Regel in zwei Schreibweisen. Diese dürfen nur vom Server gesetzt werden: ein Passworthash, ein Verifizierungstoken. Im Gegensatz zu `FIELD_NOT_WRITABLE` ist dies die gleiche Antwort für jeden Aufrufer, einschließlich `admin`. | Entfernen Sie das Feld. Siehe [Field access](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | Ein Wert passt nicht zu seinem Eigenschaftstyp. | Siehe Nachricht; sie nennt die Eigenschaft. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | Der Body benennt ein Feld, das die Collection nicht besitzt – einschließlich eines `id`-Arguments bei einer Collection, deren Schlüssel ein anderes Feld ist. | Überprüfen Sie die Schreibweise; die Nachricht listet die bekannten Felder auf. |
| `WRITE_DENIED` | 403 | Eine Sicherheitsregel oder eine Row-Level-Security-Policy hat den Schreibvorgang verweigert. | Überprüfen Sie die `securityRules` der Collection. |

## `PG_<SQLSTATE>` — ein Constraint, den die Datenbank abgelehnt hat

Ein Schreibvorgang, den Postgres aus einem Grund ablehnt, der in den *Daten des Aufrufers* liegt,
antwortet mit dem SQLSTATE im Code: `PG_23505`, `PG_23503` usw. Dabei handelt es sich um eine
Familie, nicht um eine feste Liste – Postgres definiert Hunderte von SQLSTATEs –, aber nur zwei
Klassen erreichen diesen Zustand, da nur diese beiden vom Aufrufer verursacht werden:

- **Klasse 23**, Verletzung von Integritäts-Constraints: ein Duplikat, ein Fremdschlüssel,
  der ins Leere zeigt, eine leere NOT NULL-Spalte;
- **Klasse 22**, Daten-Ausnahme: ein Wert, der vom Spaltentyp nicht aufgenommen werden kann.

Alles andere – ein Verbindungsabbruch, eine fehlende Spalte, ein Rechteproblem – liegt beim
Server und bleibt ein `500`. Daher ist `code.startsWith("PG_")` eine zuverlässige Prüfung auf
„die von mir gesendete Zeile war fehlerhaft“, und die vier unten aufgeführten Codes sind diejenigen,
auf die ein Client in der Praxis trifft. `details.dbCode` enthält bei allen denselben SQLSTATE,
und die Nachricht nennt den Constraint.

| Code | Status | Bedeutung | Maßnahme |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | Ein Wert konnte nicht als Typ der Spalte interpretiert werden – das schreibseitige Gegenstück zu `INVALID_FILTER_VALUE`. | Senden Sie einen Wert, der dem Typ der Spalte entspricht. |
| `PG_23502` | 400 | Eine `NOT NULL`-Spalte wurde leer gelassen. | Senden Sie das Feld mit oder versehen Sie die Spalte mit einem Standardwert. |
| `PG_23503` | 400 | Ein Fremdschlüssel zeigt auf eine nicht existierende Zeile. | Erstellen Sie zuerst die Zielzeile oder korrigieren Sie die ID. |
| `PG_23505` | 409 | Ein Unique-Constraint wurde verletzt. Die Nachricht nennt den Constraint. | Verwenden Sie einen anderen Wert oder aktualisieren Sie die vorhandene Zeile. |

## Storage

| Code | Status | Bedeutung | Maßnahme |
| --- | --- | --- | --- |
| `INVALID_STORAGE_BUCKET` | 400 | Der Bucket-Name ist fehlerhaft. | Überprüfen Sie den Namen. |
| `INVALID_STORAGE_KEY` | 400 | Der Objektschlüssel ist fehlerhaft oder verlässt sein Präfix. | Überprüfen Sie den Schlüssel. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | Die Parameter für die Bildtransformation liegen außerhalb des zulässigen Bereichs oder widersprechen sich. | Siehe [Storage](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | Der Upload überschreitet die für die Zieleigenschaft deklarierte `maxSize`. Wird auf dem Server erzwungen, nicht nur im Browser. `details` enthält die Eigenschaft, das Limit und die tatsächliche Größe. | Laden Sie eine kleinere Datei hoch oder erhöhen Sie `maxSize` für die Eigenschaft. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | Der Dateityp des Uploads ist nicht in `acceptedFiles` der Eigenschaft enthalten. `details` enthält die Eigenschaft, die Liste der akzeptierten Typen und den gesendeten Content-Type. | Laden Sie einen akzeptierten Typ hoch oder erweitern Sie `acceptedFiles`. |
| `STORAGE_NOT_CONFIGURED` | 503 | Auf diesem Server ist kein Storage-Backend konfiguriert. | Konfigurieren Sie S3, GCS oder lokalen Speicher. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | Die Storage-Quelle ist deklariert, verfügt hier jedoch über keine Anmeldedaten. | Setzen Sie die Umgebungsvariablen für diese Quelle. |
| `STORAGE_WRITE_FAILED` | 502 | Das Storage-Backend hat den Schreibvorgang verweigert oder abgebrochen. | Überprüfen Sie dessen eigene Protokolle und Anmeldedaten. |
| `TRANSFORM_OVERLOADED` | 503 | Zu viele Bildtransformationen werden gleichzeitig verarbeitet. | Versuchen Sie es erneut; erwägen Sie ein vorgeschaltetes CDN. |
| `UNKNOWN_STORAGE_SOURCE` | 400 | Der Request hat eine Storage-Quelle (`?storageId=`) angegeben, die dieses Projekt nicht deklariert. Ein `bucket`, den dieses Deployment nicht bedient, ist derselbe Code mit Status **404** – der Store ist das, was fehlt, und `details` nennt die Buckets und Quellen, die tatsächlich existieren. Beide wurden früher als „Datei nicht gefunden“ zurückgegeben, identisch mit einem Schlüssel, der schlicht nicht existiert. | Deklarieren Sie die Quelle in `config/resources.ts` oder prüfen Sie `GET /api/storage/sources`. |

## Custom functions

| Code | Status | Bedeutung | Maßnahme |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | Keine Funktion dieses Namens wird bereitgestellt – oder sie existiert, aber ihre eigenen Routen decken den Pfad dahinter nicht ab. Einem angemeldeten Aufrufer wird auch mitgeteilt, was *tatsächlich* bereitgestellt wird; einem anonymen Aufrufer nicht, da diese Liste ein Inventar aller benutzerdefinierten Endpunkte darstellt. Wenn eine Datei dieses Namens nicht geladen werden konnte, wird dies in der Nachricht angegeben: Das ist der Unterschied zwischen einem Tippfehler und einem fehlerhaften Deployment. | Überprüfen Sie den Namen anhand von `GET /api/functions` oder prüfen Sie das Boot-Protokoll auf eine Datei, die nicht geladen werden konnte. |
| `FUNCTION_TIMEOUT` | 504 | Der Handler hat sein Timeout überschritten. Er läuft noch; er kann von hier aus nicht abgebrochen werden. | Versehen Sie ausgehende Aufrufe mit einem `AbortSignal` oder erhöhen Sie `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Dieser Prozess leitet Functions an einen anderen weiter, der nicht geantwortet hat. | Stellen Sie sicher, dass die Functions-Instanz ausgeführt wird. |

## Admin-Oberflächen und Schemabearbeitung

Diese Fehler weisen darauf hin, dass eine Funktion deaktiviert oder unkonfiguriert ist, und nicht,
dass der Request falsch war. Jeder dieser Zustände wird auch auf der entsprechenden `/status`-Route
mit einem `200` gemeldet, sodass ein Panel die Funktion ausgrauen kann, anstatt einen Fehler anzuzeigen.

| Code | Status | Bedeutung | Maßnahme |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | Eine reine Admin-Oberfläche wurde auf einem Server ohne konfigurierte Authentifizierung aufgerufen, sodass Admins nicht von fremden Personen unterschieden werden können. | Setzen Sie `auth.jwtSecret` oder übergeben Sie einen `AuthAdapter`. |
| `CONTRACT_UNAVAILABLE` | 404 | Der Projektvertrag wird nur bereitgestellt, wenn Authentifizierung konfiguriert ist – er beschreibt jede Tabelle und Relation. | Konfigurieren Sie Auth. `/meta/schema-version` wird immer bereitgestellt. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | Es ist kein Entwicklungs-Postfach aktiv. E-Mails werden nur erfasst, wenn `SMTP_HOST` nicht gesetzt und `NODE_ENV` nicht production ist. | Entfernen Sie `SMTP_HOST` in der Entwicklungsumgebung oder prüfen Sie das echte Postfach. |
| `INVALID_CHANGE` | 400 | Die vorgeschlagene Schemaänderung ist nicht wohlgeformt. | Siehe Nachricht. |
| `SCHEMA_CHANGE_FAILED` | 400 | Die Anwendung einer geplanten Schemaänderung ist aus einem Grund fehlgeschlagen, den spezifischere Codes nicht abdecken. | Siehe Nachricht; sie gibt den zugrunde liegenden Fehler wortgetreu wieder. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | Die Änderung ist gültig, kann jedoch auf das aktuelle Schema nicht angewendet werden. | Siehe Nachricht. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | Das Repository enthält nicht committete Änderungen, sodass die Bearbeitung nicht sicher angewendet werden konnte. | Committen oder stashen Sie die Änderungen und versuchen Sie es erneut. |
| `SCHEMA_EDIT_REFUSED` | 400 | Der Schema-Editor hat die Bearbeitung abgelehnt. | Siehe Nachricht; sie enthält die Ablehnungsbegründung des Editors. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Ein API-Schlüssel oder ein anderer maschineller Principal hat versucht, eine Schemaänderung anzuwenden. | Melden Sie sich als Benutzer an oder setzen Sie `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | Die Live-Schemabearbeitung erfordert `collectionsDir` oder `liveSchema.repository`, und dieser Server wurde mit keinem von beiden gestartet. | Konfigurieren Sie eines davon. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | Die Planung funktioniert; es ist kein Repository vorhanden, in das die Änderung committet werden könnte. | Konfigurieren Sie `liveSchema.repository`. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Dieser Treiber kann keine Schemaänderungen planen. | Live-Bearbeitung ist unter Postgres verfügbar. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | Collections werden hier aus der Datenbank introspektiert, daher gibt es keine Quelldateien zum Bearbeiten. | Ändern Sie das Schema über eine Migration. |
| `SCHEMA_EDITOR_DISABLED` | 501 | Der Schema-Editor ist für diesen Server deaktiviert. | Aktivieren Sie ihn über `schemaEditor`. |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | Der Schema-Editor benötigt `ts-morph`, welches nicht installiert ist. | `pnpm add -D ts-morph@28.0.0`. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | Der Server hat kein `collectionsDir`, sodass der Editor kein Schreibziel hat. | Setzen Sie `collectionsDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | Der Editor ist unter `NODE_ENV=production` deaktiviert: Die Dateien eines bereitgestellten Servers werden bei jedem Deployment aus Ihrem Repository neu erstellt, sodass eine Bearbeitung hier verworfen werden würde. | Bearbeiten Sie Collections in der Entwicklungsumgebung und deployen Sie anschließend. |

## Generische Codes

Eine Route verwendet einen dieser Codes, wenn nichts Spezifischeres zutrifft.

| Code | Status | Bedeutung | Maßnahme |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Fehlerhaft aufgebaut, und nichts Spezifischeres trifft zu. | Siehe Nachricht. |
| `UNAUTHORIZED` | 401 | Nicht authentifiziert oder die Anmeldedaten wurden abgelehnt. | Melden Sie sich an oder aktualisieren Sie das Token. |
| `FORBIDDEN` | 403 | Authentifiziert, aber nicht autorisiert. | Ein erneuter Versuch mit derselben Identität hilft nicht. |
| `CONFLICT` | 409 | Konflikt mit dem bestehenden Zustand. | Siehe Nachricht. |
| `INTERNAL_ERROR` | 500 | Etwas auf dem Server ist fehlgeschlagen. Die Nachricht ist bewusst generisch gehalten. | Geben Sie die `requestId` an; die Ursache befindet sich in den Protokollen. |
| `NOT_CONFIGURED` | 503 | Eine von dieser Route benötigte Abhängigkeit ist auf diesem Server nicht konfiguriert. | Siehe Nachricht. |
| `SERVICE_UNAVAILABLE` | 503 | Eine Abhängigkeit war nicht erreichbar. | Versuchen Sie es erneut; prüfen Sie die Protokolle. |

## Diese Seite aktuell halten

`pnpm verify:docs` schlägt fehl, wenn ein Code, den der Server auslösen kann, in diesen
Tabellen fehlt, wenn eine Tabelle einen Code auflistet, den nichts auslösen kann, wenn ein angegebener
Status nicht mit dem Quellcode übereinstimmt oder wenn eine Code-Familie wie `PG_<SQLSTATE>` keine Zeile
für einen SQLSTATE enthält, auf den Aufrufer treffen. Der entsprechende Schritt ist
`tooling/scripts/docs-verify/check-error-codes.mjs`.

Er prüft sich zuerst selbst. Der Scan liest Codes direkt aus TypeScript und nicht von einem laufenden
Server aus, weshalb seine blinden Flecken konstruktionsbedingt lautlos sind: Einst konnte er keinen
Code erkennen, der über einen einzeiligen Wrapper weitergegeben wurde, oder einen, der nach einer
Nachricht mit einer `)` stand, und meldete „Jeder Code, den der Server auslösen kann, ist dokumentiert“
auf einer Seite, auf der siebzehn davon fehlten. Daher führt dieser Prüfschritt vor dem Lesen dieser
Seite eine Test-Fixture mit genau diesen Mustern aus und verweigert jeden Bericht, wenn er diese
nicht erkennen kann.

---
