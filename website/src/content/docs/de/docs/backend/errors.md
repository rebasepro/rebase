---
sourceHash: 98630809329b42c5
title: Fehlercodes
sidebar_label: Fehlercodes
description: Jeder Fehlercode, den ein Rebase-Backend zurückgeben kann, mit seinem HTTP-Status, seiner Bedeutung und Lösungsansätzen – plus Response-Envelope, X-Request-ID und den Details-Regeln.
---

Jeder Fehler, den ein Rebase-Backend zurückgibt, verwendet ein einheitliches Envelope und enthält einen stabilen `code`. Nach dem Code sollte verzweigt werden: Die Nachricht (`message`) ist für Menschen geschrieben und kann sich im Wortlaut ändern, der Status wird von einem Dutzend verschiedener Probleme geteilt, und auf den Code trifft beides nicht zu.

## Das Envelope

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

- **`message`** — menschenlesbar. Bei einem `4xx` ist es die eigene Nachricht des Servers; bei einem `5xx` ist sie bewusst generisch gehalten, da der zugrundeliegende Text einen Host, eine Rolle oder einen Spaltennamen enthalten kann.
- **`code`** — einer der unten aufgeführten Werte. Stabil über Minor-Versionen hinweg.
- **`details`** — optional und niemals garantiert. Siehe die nachstehenden Regeln.
- **`requestId`** — vorhanden, wann immer der Request die Request-ID-Middleware durchlaufen hat, was auf jede Route unter `basePath` zutrifft.

### `X-Request-ID`

Jeder Request unter `basePath` erhält eine ID: den `X-Request-ID`-Header des Aufrufers, sofern es sich um eine gültige UUID v4 handelt, andernfalls eine neu generierte. Sie wird in der Response als `X-Request-ID` zurückgegeben, im Fehler-Envelope als `requestId` eingefügt und an die Log-Zeile des Servers für diesen Request angehängt.

Das ist der Verknüpfungsschlüssel. Geben Sie ihn in einem Fehlerbericht an, und ein Operator kann genau die eine Log-Zeile finden, die den Fehler erklärt und den Grund enthält, der dem Client nie angezeigt wurde.

Einen eigenen Header zu senden stellt sicher, dass ein Trace über Hops hinweg erhalten bleibt: Ein Gateway oder ein Job-Runner, der den Header weiterleitet, erhält dieselbe ID über jeden Dienst hinweg, der den Request verarbeitet hat. Ein ungültiger Wert wird ignoriert und nicht abgelehnt – ein fehlerhafter Header eines Aufrufers ist es nicht wert, einen Request fehlschlagen zu lassen. Gehen Sie daher nicht davon aus, dass die gesendete ID der empfangenen entspricht. Lesen Sie den Response-Header aus.

### Was in `details` enthalten ist

`details` dient der Diagnose und ist nicht vertraglich bindend. Es gelten drei Regeln:

1. **Alles, was eine Route explizit setzt, wird immer zurückgegeben.** Dies sind die präzise beschriebenen Fehler des Aufrufers: welches Filterfeld unbekannt war, welche Relation nicht schreibbar ist, welcher Wert nicht zu seinem Typ passte.
2. **Datenbankdiagnosen werden in der Produktion gekürzt.** Wenn der Fehler von Postgres stammt, ist `details.dbCode` – der SQLSTATE – immer vorhanden: Er benennt die Problemklasse und gibt nichts über die Daten preis. `dbMessage`, `detail` und `hint` werden nur hinzugefügt, wenn `NODE_ENV` nicht `production` ist, da Postgres Zeileninhalte darin platziert. `23505` meldet `Key (email)=(a@b.c) already exists.`, was für jede beliebige Adresse die Frage „Ist diese Person registriert?“ beantwortet.
3. **Niemals anhand von `details` verzweigen.** Verzweigen Sie anhand von `code`. Was unter `details` steht, ist rein das, was für einen Menschen an dieser Aufrufstelle nützlich war, und kann sich ändern.

## Einen Status interpretieren

| Status | Was er über den Request aussagt |
| --- | --- |
| `400` | Ungültig formatiert oder fragt etwas ab, das im Schema nicht existiert. Korrigieren Sie den Request. |
| `401` | Nicht authentifiziert oder die Anmeldeinformationen sind abgelaufen. Melden Sie sich an oder erneuern Sie die Session. |
| `403` | Authentifiziert, aber nicht berechtigt. Ein erneuter Versuch mit derselben Identität hilft nicht weiter. |
| `404` | Route, Collection oder Zeile existiert nicht – oder eine Zeile wird durch Row-Level Security verborgen. |
| `409` | Ein Konflikt mit dem bestehenden Zustand: ein Duplikat oder ein gleichzeitiger Schreibvorgang. |
| `413` `415` `422` | Der Body ist zu groß, hat den falschen Medientyp oder wurde semantisch abgelehnt. |
| `429` | Ratenbegrenzung erreicht (Rate limited). Warten Sie ab; die Nachricht gibt an, wie lange. |
| `500` | Der Server oder seine Datenbank ist fehlerhaft, nicht der Aufrufer. Prüfen Sie die Logs. |
| `501` | Die Route existiert, aber dieses Deployment kann sie nicht bedienen – eine Funktion ist deaktiviert oder unkonfiguriert. |
| `502` `503` `504` | Eine Abhängigkeit war nicht erreichbar, unkonfiguriert oder zu langsam. |

## Authentifizierung und Konten

| Code | Status | Bedeutung | Maßnahme |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | Die Route erfordert einen zweiten Faktor und die Session verfügt nur über einen. | Schließen Sie die MFA-Abfrage ab und versuchen Sie es erneut. |
| `ALREADY_VERIFIED` | 400 | Die Adresse oder der Faktor ist bereits verifiziert. | Nichts – der gewünschte Zustand ist bereits erreicht. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | Anonyme Anmeldung ist auf diesem Server deaktiviert. | Aktivieren Sie sie oder melden Sie sich mit einer echten Identität an. |
| `API_KEY_FORBIDDEN` | 403 | Ein API-Schlüssel wurde für eine Route verwendet, die nur von Personen aufgerufen werden darf. | Verwenden Sie eine Benutzersitzung. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Ein API-Schlüssel hat versucht, API-Schlüssel zu erstellen, aufzulisten oder zu widerrufen. | Verwalten Sie Schlüssel als angemeldeter Administrator. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Eine geschützte Route wurde ohne vorherige Rebase-Auth-Middleware ausgeführt, sodass die Anmeldeinformationen des Aufrufers nie geprüft wurden. | Binden Sie die App über den Functions-Router ein, anstatt direkt auf Ihrem eigenen Server. |
| `BOOTSTRAP_ANONYMOUS` | 403 | Das Bootstrapping des ersten Administrators wurde von einem anonymen Aufrufer versucht. | Melden Sie sich zuerst an. |
| `BOOTSTRAP_COMPLETED` | 403 | Der erste Administrator existiert bereits. | Lassen Sie die Rolle von einem bestehenden Administrator gewähren. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | Das Bootstrapping ist nur für den allerersten Benutzer vorgesehen, und dies ist nicht dieser. | Lassen Sie die Rolle von einem bestehenden Administrator gewähren. |
| `CAPTCHA_FAILED` | 400 | Der Anbieter hat das CAPTCHA-Token abgelehnt. | Lösen Sie ein neues CAPTCHA. |
| `CAPTCHA_REQUIRED` | 400 | Die Route erfordert ein CAPTCHA-Token und es wurde keines gesendet. | Fügen Sie das Token bei. |
| `CHALLENGE_EXHAUSTED` | 401 | Zu viele falsche Codes für dieselbe MFA-Abfrage. | Starten Sie eine neue Abfrage. |
| `EMAIL_EXISTS` | 409 | Ein Konto mit dieser Adresse existiert bereits. | Melden Sie sich an oder starten Sie das Zurücksetzen des Passworts. |
| `EMAIL_NOT_CONFIGURED` | 503 | Magic Links oder OTP wurden angefordert, aber der Server verfügt über keinen Mail-Transport. | Konfigurieren Sie SMTP oder verwenden Sie eine andere Anmeldemethode. |
| `EMAIL_NOT_VERIFIED` | 403 | Das Konto existiert und seine Adresse ist nicht verifiziert. | Verifizieren Sie die Adresse. |
| `FACTOR_NOT_VERIFIED` | 400 | Der MFA-Faktor wurde registriert, aber nie bestätigt. | Bestätigen Sie den Faktor. |
| `IDENTITY_ALREADY_LINKED` | 409 | Diese OAuth-Identität gehört zu einem anderen Konto. | Melden Sie sich damit an oder heben Sie die Verknüpfung dort zuerst auf. |
| `INVALID_ACCOUNT` | 400 | Das Konto befindet sich in einem Zustand, auf den diese Operation nicht angewendet werden kann. | Siehe Nachricht. |
| `INVALID_CHALLENGE` | 400 | Die MFA-Abfrage ist unbekannt oder abgelaufen. | Starten Sie eine neue Abfrage. |
| `INVALID_CODE` | 401 | Der OTP- oder MFA-Code ist falsch. | Versuchen Sie es mit dem aktuellen Code erneut. |
| `INVALID_CREDENTIALS` | 401 | Falsche E-Mail-Adresse oder falsches Passwort – bewusst ohne Angabe, was davon zutrifft. | Versuchen Sie es erneut oder setzen Sie das Passwort zurück. |
| `INVALID_TOKEN` | 400 | Ein Verifizierungs-, Reset- oder Magic-Link-Token ist fehlerhaft oder unbekannt. | Fordern Sie einen neuen Link an. |
| `LAST_ADMIN` | 403 | Die Änderung würde dazu führen, dass das Projekt keinen Administrator mehr hat. | Befördern Sie zuerst eine andere Person. |
| `MFA_REQUIRED` | 401 | Das Passwort war korrekt und das Konto verfügt über einen verifizierten zweiten Faktor, sodass die Anmeldung erst zur Hälfte abgeschlossen ist. `details` enthält ein kurzlebiges Token, das auf die MFA-Abfrage beschränkt ist – es handelt sich nicht um eine Session. | Starten Sie eine Abfrage und beantworten Sie diese; die Abfrage-Response stellt die Session aus. |
| `NO_SESSION` | 401 | Es wurde kein Session-Cookie oder Refresh-Token übergeben. Normal beim ersten Laden der Seite. | Melden Sie sich an. |
| `NOT_ANONYMOUS` | 400 | Eine Route zum Upgrade eines anonymen Kontos wurde von einem regulären Konto aufgerufen. | Es gibt nichts zu upgraden. |
| `OAUTH_ERROR` | 401 | Der OAuth-Anbieter hat abgelehnt oder einen Fehler zurückgegeben. | Wiederholen Sie den Vorgang; die Nachricht enthält die Begründung des Anbieters. |
| `RATE_LIMITED` | 429 | Zu viele Versuche von diesem Aufrufer. | Warten Sie ab; die Nachricht gibt an, wie lange. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | Das Weiterleitungsziel steht nicht auf der Allowlist. | Fügen Sie es zur Anbieterkonfiguration hinzu. |
| `REGISTRATION_DISABLED` | 403 | Die Selbstregistrierung ist deaktiviert. | Lassen Sie das Konto von einem Administrator anlegen. |
| `ROLE_EXISTS` | 409 | Dieser Rollenname ist bereits vergeben. | Wählen Sie einen anderen Namen. |
| `ROLE_LOOKUP_FAILED` | 503 | Rollen konnten für einen durch Admin-Rechte geschützten Request nicht gelesen werden. Scheitert sicherheitshalber („fail closed“), anstatt dem Claim des Tokens blind zu vertrauen. | Versuchen Sie es erneut; überprüfen Sie die Datenbank. |
| `SELF_DELETE` | 400 | Ein Administrator hat versucht, sein eigenes Konto zu löschen. | Lassen Sie dies einen anderen Administrator durchführen. |
| `SESSION_REVOKED` | 401 | Die Session wurde an anderer Stelle abgemeldet oder alle Sessions wurden widerrufen. | Melden Sie sich erneut an. |
| `SETUP_REQUIRED` | 403 | Das Projekt hat noch keinen Administrator, daher ist diese Route nicht verfügbar. | Schließen Sie das Setup des ersten Administrators ab. |
| `TOKEN_ALREADY_USED` | 401 | Ein Einmal-Token wurde wiederholt verwendet. | Fordern Sie ein neues an. |
| `TOKEN_EXPIRED` | 401 | Das Token hat seine Gültigkeitsdauer überschritten. | Fordern Sie ein neues an. |
| `USER_NOT_FOUND` | 404 | Kein Konto mit dieser ID. | Überprüfen Sie die ID. |
| `WEAK_PASSWORD` | 400 | Das Passwort entspricht nicht den konfigurierten Richtlinien. | Wählen Sie ein stärkeres Passwort. |

## Daten, Abfragen und Schreibvorgänge

| Code | Status | Bedeutung | Maßnahme |
| --- | --- | --- | --- |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Dieser Treiber kann das angeforderte Aggregat nicht berechnen. | Verwenden Sie einen Treiber, der dies unterstützt, oder berechnen Sie es im Client. |
| `BRANCHING_UNSUPPORTED` | — | Ein Datenbank-Branch wurde über das Studio-Websocket auf der verwalteten Entwicklungsdatenbank (PGlite) angefordert, bei der ein Branch mit dem Parent *identisch* ist und nichts isoliert werden würde. Die Ablehnung entspricht der von `rebase db branch`. | Richten Sie `DATABASE_URL` auf ein eigenes Postgres (`rebase dev --docker` startet eines) und erstellen Sie dort den Branch. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` enthält mehr Operationen als das Limit pro Batch (standardmäßig 1000). Ein Batch ist eine Transaktion und hält seine Sperren für die gesamte Dauer. | Senden Sie ihn in Blöcken; die Nachricht nennt das Limit und Ihre Anzahl. |
| `BATCH_UNSUPPORTED` | 400 | Der Treiber dieses Backends kann Schreibvorgänge über Collections hinweg nicht atomar ausführen, und eine Schleife von Einzelschreibvorgängen wäre weder atomar noch ein einzelner Roundtrip. | Senden Sie die Schreibvorgänge als separate Requests oder als `/bulk`-Aufrufe pro Collection. |
| `BULK_TOO_LARGE` | 400 | Der Bulk-Body überschreitet das konfigurierte Elementlimit. | Teilen Sie den Request auf. |
| `BULK_UNSUPPORTED` | 400 | Diese Collection oder dieser Treiber unterstützt keine Bulk-Schreibvorgänge. | Schreiben Sie die Zeilen einzeln. |
| `CALLBACK_REJECTED` | 400 | Ein Collection-Callback hat den Schreibvorgang verweigert. Ein `throw` aus `beforeSave`/`beforeDelete`/`after*` ist ein 400 mit der eigenen Nachricht des Autors; ein `beforeDelete`, das `false` zurückgibt, ist ein 403. `details.stage` nennt den Callback, `details.path` die Collection. | Lesen Sie die Nachricht – sie stammt von diesem Projekt, nicht von Rebase. |
| `CURSOR_WITH_OFFSET` | 400 | `?after=` wurde mit `?offset=` oder `?page=` kombiniert. Ein Cursor gibt bereits an, wo die Seite beginnt, sodass ein zusätzlicher Offset stillschweigend so viele Zeilen hinter dem Cursor überspringt – eine Lücke, die der Aufrufer in der Response nicht sehen kann. | Verwenden Sie entweder das eine oder das andere. |
| `DISTINCT_NOT_APPLICABLE` | 400 | `?distinct=true` wurde mit einer Such- oder Vektorabfrage kombiniert. Beide fügen einen Score pro Zeile hinzu, sodass niemals zwei Zeilen gleich sind und `DISTINCT` nichts zusammenfassen würde – es würde aussehen, als hätte es funktioniert, aber nichts ändern. | Entfernen Sie eines von beiden. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Ein `distinct`-Lesevorgang wird nach einer Spalte sortiert, die er nicht zurückgibt. Ein `SELECT DISTINCT` kann nur nach Spalten in seiner Auswahlliste sortiert werden, andernfalls haben die zusammengefassten Zeilen keine definierte Reihenfolge. `details.fields` listet sie auf. | Fügen Sie diese Felder zu `?fields=` hinzu oder entfernen Sie sie aus `?orderBy=`. |
| `DB_PERMISSION_DENIED` | 500 | Postgres hat das Statement verweigert (`42501`): entweder verweigert eine Row-Level-Security-Richtlinie diese Rolle oder es fehlt ein `GRANT`. | Siehe [Troubleshooting](/docs/troubleshooting/). |
| `FIELD_NOT_READABLE` | 400 | Ein Filter, `orderBy`, `fields`, Aggregat-`select` oder `groupBy` benennt ein Feld, das die Rollen dieses Aufrufers nicht lesen können (`access.read`). Ein Feld, das in keiner Response vorkommen darf, darf auch von keiner Abfrage geprüft werden können, da der Wert sonst Prädikat für Prädikat ausgelesen werden könnte. `details.violations` nennt jedes Feld. | Entfernen Sie das Feld aus der Abfrage oder fordern Sie die Rolle an. Siehe [Field access](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 | Der Body setzt ein Feld, das die Rollen dieses Aufrufers nicht schreiben können (`access.write`). Wird verweigert statt verworfen: Ein Schreibvorgang, der ein Feld verwirft, würde Erfolg für eine Änderung melden, die nicht stattgefunden hat. `details.violations` nennt jedes Feld. | Entfernen Sie das Feld oder fordern Sie die Rolle an. Ein Feld, das niemand schreiben darf, antwortet stattdessen mit `VALIDATION_EXCLUDED_FIELDS`. |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Ein früherer Request mit demselben `Idempotency-Key` wird noch ausgeführt. | Versuchen Sie es erneut, sobald er abgeschlossen ist. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | Derselbe `Idempotency-Key` wurde mit einem anderen Body gesendet. | Verwenden Sie einen neuen Schlüssel oder senden Sie den ursprünglichen Body. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` benennt eine Funktion, die nicht `count`, `sum`, `avg`, `min` oder `max` ist. | Verwenden Sie eine dieser Funktionen; die Nachricht listet sie auf. |
| `INVALID_AGGREGATE_SELECT` | 400 | Ein `?select=`-Eintrag entspricht nicht dem Format `fn(field)`, oder einer anderen Funktion als `count()` wurde kein Feld übergeben. | Schreiben Sie `sum(total)`, `count()`, `avg(score)`. |
| `INVALID_BATCH_BODY` | 400 | Bei einer `/_batch`-Operation fehlt `op`, `collection`, `values` oder `id`, sie benennt eine Collection, die dieses Backend nicht bedient, oder verwendet einen `ref`-Namen mehrfach. | Siehe Nachricht; sie nennt die Operation anhand des Index. |
| `INVALID_BATCH_REF` | 400 | Ein `{ "$ref": "<name>.<field>" }` bezieht sich auf keine frühere Operation, verweist nach vorne oder fragt ein Feld ab, das die referenzierte Zeile nicht besitzt. Nur Rückwärtsreferenzen werden aufgelöst. | Vergeben Sie den Namen der Operation mit `ref`, *bevor* Sie darauf verweisen. |
| `INVALID_BULK_BODY` | 400 | Der Bulk-Body entspricht nicht dem erwarteten Format. | Senden Sie das dokumentierte `items`-Array. |
| `INVALID_CONFLICT_TARGET` | 400 | Das `on_conflict` / `onConflict` eines Upserts benennt Spalten ohne Eindeutigkeitsgarantie oder benennt sie ohne `upsert: true`. Postgres würde andernfalls mit 42P10 aus einer Transaktion heraus antworten, die bereits Arbeit verrichtet hat. | Deklarieren Sie `validation: { unique: true }` oder einen `unique`-Index; die Nachricht listet die vorhandenen Targets auf. |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` ist weder `include` noch `only`. Wird verweigert statt ignoriert: Ein vertipptes `?deleted=true`, das stillschweigend jede gelöschte Zeile ausblendet, würde so aussehen, als hätte es funktioniert, beantwortet jedoch das Gegenteil der Frage. | Senden Sie `include` (aktive und gelöschte) oder `only` (nur gelöschte). Lassen Sie den Parameter weg, um nur aktive Zeilen zu erhalten. |
| `INVALID_DISTINCT` | 400 | `?distinct=` ist nicht `true` oder `false`. | Senden Sie einen dieser Werte; `1` und `0` werden ebenfalls akzeptiert. |
| `INVALID_FIELD_OPERATION` | 400 | Ein `$inc` / `$push` / `$pull` / `$merge` wurde auf einem Property-Typ verwendet, für den es nicht definiert ist, mit einem Operanden im falschen Format, mit zwei Operatoren auf einem Feld, falsch geschrieben oder bei einem Create-Vorgang – wo es keinen gespeicherten Wert gibt, auf dem operiert werden kann. | Siehe [Writing over REST](/docs/backend/writes/#field-operations); die Nachricht nennt das Feld. |
| `INVALID_FILTER_FIELD` | 400 | Der Filter benennt eine Property, die diese Collection nicht besitzt. | Überprüfen Sie die Schreibweise anhand der Collection. |
| `INVALID_FILTER_OPERATOR` | 400 | Der Operator wird von diesem Property-Typ nicht unterstützt. | Siehe [Querying data](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | Ein Filterwert kann nicht in den Typ der Spalte konvertiert werden, mit der er verglichen wurde: `?id=eq.abc` bei einem Integer-Schlüssel, ein Label, das nicht im Enum enthalten ist, ein Timestamp, der keiner ist, eine Zahl außerhalb des Typbereichs. `details.dbCode` enthält den SQLSTATE. | Senden Sie einen Wert vom Typ der Spalte. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` ist nicht `true` oder `false`. Jeder andere Wert wird verweigert, anstatt als „nein“ interpretiert zu werden – ein Tippfehler, der ein Soft-Delete ausführt, obwohl der Aufrufer ein endgültiges Löschen verlangt hat, ließe diesen im Glauben, die Daten seien gelöscht. | Senden Sie `true` oder `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` ist fehlerhaft: keine gültige Pfadliste oder tiefer geschachtelt als die maximale Tiefe. Wird an der Schnittstelle beantwortet, anstatt als 500 aus dem Treiber auszubrechen. | Siehe Nachricht; sie nennt den fehlerhaften Pfad. |
| `INVALID_INPUT` | 400 | Der Body hat die Validierung nicht bestanden. | Siehe Nachricht. |
| `INVALID_LIMIT` | — | Eine Realtime-Subscription hat ein Limit außerhalb des zulässigen Bereichs angefordert. Wird als WebSocket-`ERROR`-Frame übermittelt, nicht als HTTP-Response. | Verringern Sie das Limit. |
| `INVALID_LOGICAL_GROUP` | 400 | Eine `?or=` / `?and=`-Gruppe ist fehlerhaft oder tiefer als die erlaubte Tiefe geschachtelt. | Siehe Nachricht; sie zeigt die Flattening-Regel. |
| `INVALID_OFFSET` | 400 | `?offset=` ist keine ganze Zahl von 0 oder größer. | Senden Sie eine nicht-negative Ganzzahl. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` ist nicht `field`, `field:desc` oder ein JSON-Array von `{ field, direction }`. | Siehe Nachricht; sie zeigt alle drei Schreibweisen. |
| `INVALID_PAGE` | 400 | `?page=` ist keine ganze Zahl von 1 oder größer. Seiten sind 1-basiert, daher ist `?page=0` ein Fehler und nicht die erste Seite. | Senden Sie `1` oder höher, oder verwenden Sie `?offset=`. |
| `INVALID_PARAM` | 400 | Ein Abfrageparameter ist fehlerhaft. | Siehe Nachricht. |
| `INVALID_VECTOR` | 400 | `?vector=` ist kein JSON-Array von Zahlen. | Senden Sie `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` ist nicht `cosine`, `l2` oder `inner_product`. | Verwenden Sie eine dieser drei Optionen. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` ist keine Zahl. | Senden Sie eine Zahl. |
| `INVALID_WHERE` | 400 | `?where=` ist kein JSON-Objekt, das Felder auf Bedingungen abbildet. | Senden Sie `{"status":["==","active"]}`. |
| `MISSING_AGGREGATE_SELECT` | 400 | Die Aggregat-Route wurde ohne `?select=` aufgerufen. | Fügen Sie einen Parameter hinzu, z. B. `?select=count()`. |
| `NO_COLLECTIONS` | 404 | Das Projekt stellt keine Collections bereit: keine im Code deklarierten und keine Tabellen, aus denen sie abgeleitet werden könnten. | Erstellen Sie Tabellen – per Migration, SQL oder eine Collection-Datei plus `rebase db push` – und starten Sie neu. |
| `NOT_FOUND` | 404 | Keine Zeile mit dieser ID in dieser Collection – oder eine Zeile, die durch Row-Level Security vor diesem Aufrufer verborgen wird. | Prüfen Sie die ID, dann die `securityRules` der Collection. |
| `UNKNOWN_RELATION` | 400 | `?include=` benennt etwas, das keine Relation in der Collection ist. Derselbe Code antwortet mit **404**, wenn stattdessen ein geschachtelter *URL-Pfad* eine solche benennt, z. B. `/api/data/authors/1/posts`, wo `authors` keine deklariert – dort benennt die URL nichts, weshalb es sich um ein Not-Found und nicht um einen fehlerhaften Request handelt. | Überprüfen Sie den Namen der Relation – die Nachricht listet die der Collection auf. Eine Rückwärtsreferenz muss auf dem Parent deklariert sein, um traversiert werden zu können. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | Die Sortierung benennt eine Property, die nicht sortierbar ist. | Sortieren Sie nach einer spaltenbasierten Property. |
| `PAYLOAD_TOO_LARGE` | 413 | Der Body überschreitet das konfigurierte Limit. | Senden Sie weniger Daten oder erhöhen Sie das Limit. |
| `READ_ONLY_TRANSACTION` | 409 | Ein `afterRead`-Callback hat versucht zu schreiben. Ein Request-bezogener Lesevorgang läuft in einer `READ ONLY`-Transaktion, daher darf weder der Callback noch etwas, das er aufruft, schreiben. | Lagern Sie das Schreiben aus dem Lesevorgang aus: ein Hintergrundjob oder `rebase.dataAsAdmin` aus einem Cron-Job oder einer benutzerdefinierten Funktion. |
| `RELATION_HAS_NO_PIVOT` | 400 | Der Schreibvorgang enthielt eine Link-Payload, aber der Pfad erreicht sein Ziel nicht über ein `manyToMany`, das `through.properties` deklariert – es gibt also keine Zwischentabellen-Zeile, auf der sie abgelegt werden könnte. | Deklarieren Sie `through.properties` für die Relation oder entfernen Sie die Payload aus dem Schreibvorgang. Siehe [Relations](/docs/collections/relations/). |
| `RELATION_MISCONFIGURED` | 500 | Eine Relation kann nicht mit dem registrierten Schema aufgelöst werden. Die Operation wird verweigert statt übersprungen: Das Verwerfen würde Erfolg für einen Schreibvorgang melden, der nie stattgefunden hat, oder Leere für Zeilen, die existieren. | Führen Sie `rebase schema generate` aus, falls das generierte Schema älter als die Datenbank ist. |
| `RELATION_NOT_UNLINKABLE` | 400 | Die Verknüpfung der Relation kann von dieser Seite aus nicht aufgehoben werden. | Schreiben Sie von der besitzenden Seite aus. |
| `RELATION_NOT_WRITABLE` | 400 | Der geschachtelte Pfad ist keine schreibbare Relation. | Siehe [Relations](/docs/collections/relations/). |
| `RELATION_PIVOT_UNSUPPORTED` | 400 | Die Relation deklariert Zwischentabellen-Spalten, aber diese Datenquelle kann sie nicht schreiben. | Die Verknüpfung selbst funktioniert weiterhin; nur die Payload darauf nicht. Überprüfen Sie die Fähigkeiten des Treibers. |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | Ein Relations-Schreibvorgang hatte keinen Quellschlüssel, an den der Link angehängt werden konnte. | Speichern Sie zuerst die übergeordnete Zeile. |
| `SCHEMA_DRIFT` | 500 | Eine vom Code erwartete Tabelle oder Spalte existiert nicht in der Datenbank. | `rebase db push` in der Entwicklung; bei einem Managed Tenant neu deployen. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | `startAfter` wurde mit `orderBy: "_score"` kombiniert. Die Relevanz wird pro Abfrage berechnet und nicht gespeichert, daher kann sie nicht als Cursor-Schlüssel dienen. | Paginieren Sie die Relevanz mit `limit`/`offset` oder sortieren Sie nach einer Spalte. |
| `TENANT_IMMUTABLE` | 400 | Ein Schreibvorgang würde eine Zeile von einem Mandanten zu einem anderen verschieben. Eine Zeile kann den Mandanten nicht wechseln. `details.violations` nennt das Feld. | Erstellen Sie die Zeile im anderen Mandanten und löschen Sie diese, oder schreiben Sie mit einer Rolle in `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | Der Schreibvorgang gibt einen Mandanten an, zu dem dieser Aufrufer nicht gehört; die Datenbank würde ihn ebenfalls ablehnen. | Schreiben Sie in einen Mandanten, zu dem der Aufrufer gehört, oder authentifizieren Sie sich als jemand, der dazu gehört. |
| `TENANT_REQUIRED` | 400 | Die Collection ist mandantenbezogen und der Mandant kann nicht abgeleitet werden: Der Request enthält keinen, oder der Aufrufer gehört zu mehreren. | Senden Sie das Mandantenfeld explizit oder authentifizieren Sie sich als Aufrufer, der genau einem Mandanten angehört. |
| `UNKNOWN_FIELD` | 400 | `?fields=` benennt ein Feld, das die Collection nicht besitzt. | Überprüfen Sie die Schreibweise; die Nachricht listet die gültigen Felder auf. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Ein Aggregat oder `groupBy` benennt ein Feld, das die Collection nicht besitzt. | Überprüfen Sie die Schreibweise; die Nachricht listet die gültigen Felder auf. |
| `UNKNOWN_FILTER_FIELD` | 400 | Der Filter benennt ein Feld, das diese Collection – oder das Ziel einer Relation – nicht besitzt. | Überprüfen Sie die Schreibweise; die Nachricht listet die gültigen Felder auf. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | Der Filter benennt einen Operator, der nicht existiert. | Die Nachricht listet alle Operatoren auf. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | Die Sortierung benennt ein Feld, das diese Collection nicht besitzt. | Überprüfen Sie die Schreibweise; die Nachricht listet die gültigen Felder auf. |
| `PRECONDITION_FAILED` | 412 | Ein `If-Match` benennt eine Version der Zeile, die nicht mehr aktuell ist: Jemand hat zwischen dem Lesen und diesem Schreibvorgang darauf geschrieben. Es wurde nichts geschrieben. | Lesen Sie die Zeile erneut, wenden Sie die Änderung erneut an und senden Sie das neue `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` fordert ein Feld an, das die Collection nicht besitzt. | Überprüfen Sie die Schreibweise; die Nachricht listet die bekannten Felder auf. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Eine Vektorsuche benennt eine Property, die kein `vector` in dieser Collection ist. | Die Nachricht listet die Vektor-Properties der Collection auf. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Der `Content-Type` wird von dieser Route nicht akzeptiert. | Senden Sie den von der Route dokumentierten Typ. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | Der Filter verläuft über eine `via`-Relation, deren Join-Pfad nur in eine Richtung definiert ist, sodass keine Subquery zurückkorreliert werden kann. | Filtern Sie von der besitzenden Seite aus. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | Der Operator ist für dieses Feld nicht definiert: Eine Relation ohne Spalte in dieser Zeile wird über die Zugehörigkeit gefiltert, und Abgleiche ohne Berücksichtigung der Groß-/Kleinschreibung gelten nur für Text. | Siehe Nachricht; sie listet auf, was das Feld akzeptiert. |
| `VALIDATION_CONSTRAINT` | 400 | Ein Wert hat eine von der Property deklarierte `validation`-Regel verletzt – eine Länge, einen Bereich, ein Muster oder ein erforderliches Feld. | Siehe Nachricht; sie nennt jede Verletzung. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | Der Body schreibt in eine Spalte, die mit `excludeFromApi` oder `access: { write: [] }` markiert ist – dieselbe Regel, zwei Schreibweisen. Diese werden vom Server gesetzt: ein Passwort-Hash, ein Verifizierungs-Token. Anders als bei `FIELD_NOT_WRITABLE` ist dies die gleiche Antwort für jeden Aufrufer, einschließlich `admin`. | Entfernen Sie das Feld. Siehe [Field access](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | Ein Wert passt nicht zu seinem Property-Typ. | Siehe Nachricht; sie nennt die Property. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | Der Body benennt ein Feld, das die Collection nicht besitzt – einschließlich eines `id`-Arguments bei einer Collection, die über etwas anderes geschlüsselt ist. | Überprüfen Sie die Schreibweise; die Nachricht listet die bekannten Felder auf. |
| `WRITE_DENIED` | 403 | Eine Sicherheitsregel oder Row-Level-Security-Richtlinie hat den Schreibvorgang verweigert. | Prüfen Sie die `securityRules` der Collection. |

## `PG_<SQLSTATE>` — ein Constraint, den die Datenbank verweigert hat

Ein Schreibvorgang, den Postgres aus einem Grund ablehnt, der in den *Daten des Aufrufers* liegt, antwortet mit dem SQLSTATE im Code: `PG_23505`, `PG_23503` usw. Dabei handelt es sich um eine Familie, nicht um eine feste Liste – Postgres definiert Hunderte von SQLSTATEs –, aber nur zwei Klassen erreichen diesen Zustand jemals, da nur diese beiden vom Aufrufer verschuldet sind:

- **Klasse 23**, Verletzung von Integritäts-Constraints: ein Duplikat, ein Fremdschlüssel, der ins Leere zeigt, eine NOT-NULL-Spalte, die leer gelassen wurde;
- **Klasse 22**, Data Exception: ein Wert, den der Typ der Spalte nicht aufnehmen kann.

Alles andere – eine abgebrochene Verbindung, eine fehlende Spalte, ein Berechtigungsproblem – liegt auf Serverseite und bleibt ein `500`. Daher ist `code.startsWith("PG_")` eine verlässliche Prüfung für „die von mir gesendete Zeile war fehlerhaft“, und die vier unten aufgeführten sind diejenigen, denen ein Client in der Praxis begegnet. `details.dbCode` enthält bei allen denselben SQLSTATE, und die Nachricht nennt den Constraint.

| Code | Status | Bedeutung | Maßnahme |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | Ein Wert konnte nicht als Typ der Spalte gelesen werden – das schreibseitige Gegenstück zu `INVALID_FILTER_VALUE`. | Senden Sie einen Wert vom Typ der Spalte. |
| `PG_23502` | 400 | Eine `NOT NULL`-Spalte wurde leer gelassen. | Senden Sie das Feld oder definieren Sie einen Standardwert für die Spalte. |
| `PG_23503` | 400 | Ein Fremdschlüssel verweist auf eine Zeile, die nicht existiert. | Erstellen Sie zuerst die Zielzeile oder korrigieren Sie die ID. |
| `PG_23505` | 409 | Ein Unique-Constraint wurde verletzt. Die Nachricht nennt den Constraint. | Verwenden Sie einen anderen Wert oder aktualisieren Sie die bestehende Zeile. |

## Storage

| Code | Status | Bedeutung | Maßnahme |
| --- | --- | --- | --- |
| `INVALID_STORAGE_BUCKET` | 400 | Der Bucket-Name ist fehlerhaft. | Überprüfen Sie den Namen. |
| `INVALID_STORAGE_KEY` | 400 | Der Objektschlüssel ist fehlerhaft oder verlässt sein Präfix. | Überprüfen Sie den Schlüssel. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | Die Parameter für die Bildtransformation liegen außerhalb des gültigen Bereichs oder widersprechen sich. | Siehe [Storage](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | Der Upload überschreitet die `maxSize`, die von der Ziel-Property deklariert wurde. Wird auf dem Server erzwungen, nicht nur im Browser. `details` enthält die Property, das Limit und die tatsächliche Größe. | Laden Sie eine kleinere Datei hoch oder erhöhen Sie `maxSize` für die Property. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | Der Typ des Uploads ist nicht in den `acceptedFiles` der Property enthalten. `details` enthält die Property, die Liste der akzeptierten Typen und den gesendeten Content-Type. | Laden Sie einen akzeptierten Typ hoch oder erweitern Sie `acceptedFiles`. |
| `STORAGE_NOT_CONFIGURED` | 503 | Auf diesem Server ist kein Storage-Backend konfiguriert. | Konfigurieren Sie S3, GCS oder lokalen Speicher. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | Die Storage-Quelle ist deklariert, verfügt hier jedoch über keine Anmeldeinformationen. | Setzen Sie die Umgebungsvariablen dieser Quelle. |
| `STORAGE_WRITE_FAILED` | 502 | Das Storage-Backend hat den Schreibvorgang verweigert oder abgebrochen. | Prüfen Sie dessen eigene Logs und Anmeldeinformationen. |
| `TRANSFORM_OVERLOADED` | 503 | Zu viele Bildtransformationen werden gleichzeitig verarbeitet. | Versuchen Sie es erneut; ziehen Sie ein CDN davor in Betracht. |
| `UNKNOWN_STORAGE_SOURCE` | 400 | Der Request hat eine Storage-Quelle (`?storageId=`) benannt, die dieses Projekt nicht deklariert. Ein `bucket`, den dieses Deployment nicht bedient, ist derselbe Code mit **404** – der Speicher ist das, was fehlt, und `details` benennt die Buckets und Quellen, die existieren. Beides wurde früher als „file not found“ zurückgegeben, identisch mit einem Schlüssel, der schlicht nicht existiert. | Deklarieren Sie die Quelle in `config/resources.ts` oder prüfen Sie `GET /api/storage/sources`. |

## Custom Functions

| Code | Status | Bedeutung | Maßnahme |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | Es wird keine Funktion dieses Namens bereitgestellt – oder doch, aber ihre eigenen Routen decken den Pfad dahinter nicht ab. Einem angemeldeten Aufrufer wird auch mitgeteilt, was bereitgestellt *wird*; einem anonymen Aufrufer nicht, da diese Liste ein Verzeichnis aller benutzerdefinierten Endpunkte darstellt. Wenn eine Datei dieses Namens nicht geladen werden konnte, weist die Nachricht darauf hin: Das ist der Unterschied zwischen einem Tippfehler und einem fehlerhaften Deployment. | Überprüfen Sie den Namen anhand von `GET /api/functions` oder das Boot-Log auf eine Datei, die nicht geladen werden konnte. |
| `FUNCTION_TIMEOUT` | 504 | Der Handler hat sein Timeout überschritten. Er läuft noch; er kann von hier aus nicht abgebrochen werden. | Übergeben Sie ausgehenden Aufrufen ein `AbortSignal` oder erhöhen Sie `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Dieser Prozess leitet Funktionen per Proxy an einen anderen weiter, der nicht geantwortet hat. | Überprüfen Sie, ob die Functions-Einheit läuft. |

## Admin-Oberflächen und Schema-Bearbeitung

Diese besagen eher, dass eine Funktion deaktiviert oder unkonfiguriert ist, als dass der Request fehlerhaft war. Jeder dieser Fehler wird auch auf der entsprechenden `/status`-Route mit einem `200` gemeldet, sodass ein Dashboard das Feature ausgrauen kann, anstatt einen Fehler anzuzeigen.

| Code | Status | Bedeutung | Maßnahme |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | Eine reine Admin-Oberfläche wurde auf einem Server ohne konfigurierte Authentifizierung aufgerufen, sodass ein Administrator nicht von einem beliebigen Besucher unterschieden werden kann. | Setzen Sie `auth.jwtSecret` oder übergeben Sie einen `AuthAdapter`. |
| `CONTRACT_UNAVAILABLE` | 404 | Der Projektvertrag (Contract) wird nur bereitgestellt, wenn die Authentifizierung konfiguriert ist – er beschreibt jede Tabelle und Relation. | Konfigurieren Sie die Authentifizierung. `/meta/schema-version` wird immer bereitgestellt. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | Kein Entwicklungs-Postfach ist aktiv. E-Mails werden nur erfasst, wenn `SMTP_HOST` nicht gesetzt ist und `NODE_ENV` nicht auf `production` steht. | Entfernen Sie `SMTP_HOST` in der Entwicklung oder lesen Sie das echte Postfach. |
| `INVALID_CHANGE` | 400 | Die vorgeschlagene Schemaänderung ist nicht wohlgeformt. | Siehe Nachricht. |
| `SCHEMA_CHANGE_FAILED` | 400 | Das Anwenden einer geplanten Schemaänderung ist aus einem Grund fehlgeschlagen, der von spezifischeren Codes nicht abgedeckt wird. | Siehe Nachricht; sie enthält den zugrundeliegenden Fehler im Wortlaut. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | Die Änderung ist gültig, kann aber auf das Schema im aktuellen Zustand nicht angewendet werden. | Siehe Nachricht. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | Das Repository weist nicht committete Änderungen auf, sodass die Bearbeitung nicht sicher angewendet werden konnte. | Führen Sie ein Commit oder Stash durch und versuchen Sie es erneut. |
| `SCHEMA_EDIT_REFUSED` | 400 | Der Schema-Editor hat die Bearbeitung verweigert. | Siehe Nachricht; es ist die eigene Verweigerung des Editors. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Ein API-Schlüssel oder ein anderer maschineller Principal hat versucht, eine Schemaänderung anzuwenden. | Melden Sie sich als Benutzer an oder setzen Sie `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | Die Live-Schema-Bearbeitung erfordert `collectionsDir` oder `liveSchema.repository`, und dieser Server wurde ohne beides gestartet. | Konfigurieren Sie eines von beiden. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | Die Planung funktioniert; es ist kein Repository vorhanden, in das die Änderung committet werden könnte. | Konfigurieren Sie `liveSchema.repository`. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Dieser Treiber kann keine Schemaänderungen planen. | Live-Bearbeitung ist unter Postgres verfügbar. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | Collections werden hier aus der Datenbank introspektiert, daher gibt es keine Quelldateien zum Bearbeiten. | Ändern Sie das Schema über eine Migration. |
| `SCHEMA_EDITOR_DISABLED` | 501 | Der Schema-Editor ist für diesen Server deaktiviert. | Aktivieren Sie ihn über `schemaEditor`. |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | Der Schema-Editor benötigt `ts-morph`, das nicht installiert ist. | `pnpm add -D ts-morph@28.0.0`. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | Der Server hat kein `collectionsDir`, sodass der Editor keinen Speicherort zum Schreiben hat. | Setzen Sie `collectionsDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | Der Editor ist unter `NODE_ENV=production` deaktiviert: Die Dateien eines deployten Servers werden bei jedem Deployment aus Ihrem Repository neu gebaut, sodass eine Bearbeitung hier verworfen werden würde. | Bearbeiten Sie Collections in der Entwicklung und deployen Sie anschließend. |

## Generische Codes

Eine Route verwendet einen dieser Codes, wenn nichts Spezifischeres zutrifft.

| Code | Status | Bedeutung | Maßnahme |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Fehlerhaft formatiert, und nichts Spezifischeres trifft zu. | Siehe Nachricht. |
| `UNAUTHORIZED` | 401 | Nicht authentifiziert oder die Anmeldeinformationen wurden abgelehnt. | Melden Sie sich an oder erneuern Sie die Session. |
| `FORBIDDEN` | 403 | Authentifiziert, aber nicht berechtigt. | Ein erneuter Versuch mit derselben Identität hilft nicht weiter. |
| `CONFLICT` | 409 | Ein Konflikt mit dem bestehenden Zustand. | Siehe Nachricht. |
| `INTERNAL_ERROR` | 500 | Etwas auf dem Server ist fehlgeschlagen. Die Nachricht ist bewusst generisch. | Geben Sie die `requestId` an; die Ursache steht in den Logs. |
| `NOT_CONFIGURED` | 503 | Eine Abhängigkeit, die diese Route benötigt, ist auf diesem Server nicht konfiguriert. | Siehe Nachricht. |
| `SERVICE_UNAVAILABLE` | 503 | Eine Abhängigkeit war nicht erreichbar. | Versuchen Sie es erneut; prüfen Sie die Logs. |

## Diese Seite aktuell halten

`pnpm verify:docs` schlägt fehl, wenn ein Code, den der Server auslösen kann, in diesen Tabellen fehlt, wenn eine Tabelle einen Code auflistet, den nichts auslösen kann, wenn ein angegebener Status nicht mit dem Quellcode übereinstimmt oder wenn eine Code-Familie wie `PG_<SQLSTATE>` keine Zeile für einen SQLSTATE enthält, dem Aufrufer begegnen. Der entsprechende Schritt ist `tooling/scripts/docs-verify/check-error-codes.mjs`.

Er prüft sich zuerst selbst. Der Scan liest Codes aus TypeScript statt aus einem laufenden Server aus, weshalb seine blinden Flecken konstruktionsbedingt lautlos sind: Einst konnte er einen Code nicht erkennen, der über einen einzeiligen Wrapper übergeben wurde, oder einen, der nach einer Nachricht mit einer `)` stand, und meldete „jeder Code, den der Server auslösen kann, ist dokumentiert“, obwohl auf der Seite siebzehn davon fehlten. Daher führt dieser Schritt eine Test-Fixture genau dieser Formen aus, bevor er diese Seite liest, und verweigert jeden Erfolgsbericht, falls er diese nicht erkennen kann.

---
