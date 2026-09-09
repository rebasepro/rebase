---
sourceHash: b82ed0c23d6537de
title: Fehlercodes
sidebar_label: Fehlercodes
description: Jeder Fehlercode, den ein Rebase-Backend zurückgeben kann, inklusive HTTP-Status, Bedeutung und Behebung – plus Response-Envelope, X-Request-ID und Details-Regeln.
---

Jeder Fehler, den ein Rebase-Backend zurückgibt, verwendet denselben Envelope und enthält einen stabilen `code`. Der Code ist das Kriterium für Fallunterscheidungen im Code: Die Meldung ist für Menschen formuliert und kann sich im Wortlaut ändern, der Status wird von einem Dutzend verschiedener Probleme geteilt – der Code hingegen ist beides nicht.

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

- **`message`** — menschenlesbar. Bei einem `4xx`-Fehler ist es die eigene Meldung des Servers; bei einem `5xx`-Fehler ist sie bewusst generisch gehalten, da der zugrundeliegende Text Hosts, Rollen oder Spaltennamen enthalten kann.
- **`code`** — einer der unten aufgeführten Werte. Stabil über Minor-Versionen hinweg.
- **`details`** — optional und niemals garantiert. Siehe die unten stehenden Regeln.
- **`requestId`** — immer vorhanden, wenn die Anfrage die Request-ID-Middleware durchlaufen hat, was für jede Route unter `basePath` gilt.

### `X-Request-ID`

Jede Anfrage unter `basePath` erhält eine ID: den `X-Request-ID`-Header des Aufrufers, wenn es sich um eine gültige UUID v4 handelt, andernfalls eine neu generierte. Sie wird in der Antwort als `X-Request-ID` zurückgegeben, im Fehler-Envelope als `requestId` eingefügt und an die Server-Protokollzeile für diese Anfrage angehängt.

Das ist der Verknüpfungsschlüssel. Geben Sie ihn in einem Fehlerbericht an, und ein Operator kann die genaue Protokollzeile finden, die den Fehler erklärt und den Grund enthält, der dem Client niemals angezeigt wurde.

Das Senden einer eigenen ID ermöglicht es einem Trace, Systemgrenzen zu überwinden: Ein Gateway oder ein Job-Runner, der den Header weiterleitet, erhält eine einheitliche ID über alle Dienste hinweg, die die Anfrage verarbeitet haben. Ein ungültiger Wert wird ignoriert und nicht abgewiesen – wegen eines fehlerhaften Headers eines Aufrufers lohnt es sich nicht, eine Anfrage fehlschlagen zu lassen. Gehen Sie also nicht davon aus, dass die gesendete ID der empfangenen entspricht. Prüfen Sie den Response-Header.

### Was in `details` enthalten ist

`details` dient Diagnosezwecken und stellt keinen Vertrag dar. Drei Regeln bestimmen den Inhalt:

1. **Alles, was eine Route explizit setzt, wird immer zurückgegeben.** Dies sind die präzise beschriebenen Fehler des Aufrufers: welches Filterfeld unbekannt war, welche Relation nicht schreibbar ist, welcher Wert nicht zum Typ passte.
2. **Datenbankdiagnosen werden in der Produktionsumgebung gekürzt.** Wenn der Fehler von Postgres stammt, ist `details.dbCode` – der SQLSTATE – immer vorhanden: Er benennt die Fehlerklasse und gibt nichts über die Daten preis. `dbMessage`, `detail` und `hint` werden nur hinzugefügt, wenn `NODE_ENV` nicht `production` ist, da Postgres Zeileninhalte darin platziert. `23505` meldet `Key (email)=(a@b.c) already exists.`, was für jede beliebige Adresse die Frage beantwortet: „Ist diese Person registriert?“.
3. **Führen Sie niemals Verzweigungen basierend auf `details` aus.** Verzweigen Sie basierend auf `code`. Was unter `details` steht, ist rein das, was an dieser Aufrufstelle für einen Menschen nützlich war, und kann sich jederzeit ändern.

## Einen Status interpretieren

| Status | Was er über die Anfrage aussagt |
| --- | --- |
| `400` | Fehlerhaft formatiert oder fordert etwas an, das im Schema nicht existiert. Korrigieren Sie die Anfrage. |
| `401` | Nicht authentifiziert oder die Anmeldeinformationen sind abgelaufen. Anmelden oder aktualisieren. |
| `403` | Authentifiziert, aber nicht autorisiert. Ein erneuter Versuch mit derselben Identität wird nicht helfen. |
| `404` | Route, Collection oder Zeile existiert nicht – oder eine Zeile wird durch Row-Level Security verborgen. |
| `409` | Ein Konflikt mit dem bestehenden Zustand: ein Duplikat oder ein gleichzeitiger Schreibvorgang. |
| `413` `415` `422` | Der Body ist zu groß, der Medientyp ist falsch oder semantisch abgelehnt. |
| `429` | Ratenbegrenzung erreicht (Rate limited). Warten Sie ab; die Nachricht gibt an, wie lange. |
| `500` | Der Server oder seine Datenbank ist fehlerhaft, nicht der Aufrufer. Überprüfen Sie die Protokolle. |
| `501` | Die Route existiert, aber diese Bereitstellung kann sie nicht bedienen – eine Funktion ist deaktiviert oder unkonfiguriert. |
| `502` `503` `504` | Eine Abhängigkeit war nicht erreichbar, unkonfiguriert oder zu langsam. |

## Authentifizierung und Konten

| Code | Status | Bedeutung | Behebung |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | Die Route erfordert einen zweiten Faktor und die Sitzung hat nur einen. | Führen Sie die MFA-Challenge durch und versuchen Sie es erneut. |
| `ALREADY_VERIFIED` | 400 | Die Adresse oder der Faktor ist bereits verifiziert. | Nichts tun – der gewünschte Zustand ist bereits erreicht. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | Die anonyme Anmeldung ist auf diesem Server deaktiviert. | Aktivieren Sie sie oder melden Sie sich mit einer echten Identität an. |
| `API_KEY_FORBIDDEN` | 403 | Ein API-Schlüssel wurde für eine Route verwendet, die nur von Personen aufgerufen werden darf. | Verwenden Sie eine Benutzersitzung. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Ein API-Schlüssel hat versucht, API-Schlüssel zu erstellen, aufzulisten oder zu widerrufen. | Verwalten Sie Schlüssel als angemeldeter Administrator. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Eine geschützte Route wurde ohne Rebase-Auth-Middleware davor ausgeführt, daher wurden die Anmeldeinformationen des Aufrufers nie geprüft. | Binden Sie die App über den Functions-Router ein, anstatt direkt auf Ihrem eigenen Server. |
| `BOOTSTRAP_ANONYMOUS` | 403 | Das Initialisieren des ersten Administrators (Bootstrap) wurde von einem anonymen Aufrufer versucht. | Melden Sie sich zuerst an. |
| `BOOTSTRAP_COMPLETED` | 403 | Der erste Administrator existiert bereits. | Lassen Sie sich die Rolle von einem bestehenden Administrator zuweisen. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | Bootstrap ist nur für den allerersten Benutzer vorgesehen, und dies ist nicht dieser Benutzer. | Lassen Sie sich die Rolle von einem bestehenden Administrator zuweisen. |
| `CAPTCHA_FAILED` | 400 | Der Provider hat das CAPTCHA-Token abgelehnt. | Lösen Sie ein neues Challenge. |
| `CAPTCHA_REQUIRED` | 400 | Die Route erfordert ein CAPTCHA-Token, es wurde jedoch keines gesendet. | Fügen Sie das Token bei. |
| `CHALLENGE_EXHAUSTED` | 401 | Zu viele falsche Codes für eine MFA-Challenge. | Starten Sie ein neues Challenge. |
| `EMAIL_EXISTS` | 409 | Ein Konto mit dieser Adresse existiert bereits. | Melden Sie sich an oder starten Sie das Zurücksetzen des Passworts. |
| `EMAIL_NOT_CONFIGURED` | 503 | Magic Links oder OTP wurden angefordert, aber der Server verfügt über keinen E-Mail-Transport. | Konfigurieren Sie SMTP oder nutzen Sie eine andere Anmeldemethode. |
| `EMAIL_NOT_VERIFIED` | 403 | Das Konto existiert, aber die Adresse ist nicht verifiziert. | Verifizieren Sie die Adresse. |
| `FACTOR_NOT_VERIFIED` | 400 | Der MFA-Faktor wurde registriert, aber nie bestätigt. | Bestätigen Sie den Faktor. |
| `IDENTITY_ALREADY_LINKED` | 409 | Diese OAuth-Identität gehört zu einem anderen Konto. | Melden Sie sich damit an oder heben Sie die Verknüpfung dort zuerst auf. |
| `INVALID_ACCOUNT` | 400 | Das Konto befindet sich in einem Zustand, auf den diese Operation nicht angewendet werden kann. | Siehe Meldung. |
| `INVALID_CHALLENGE` | 400 | Die MFA-Challenge ist unbekannt oder abgelaufen. | Starten Sie eine neue. |
| `INVALID_CODE` | 401 | Der OTP- oder MFA-Code ist falsch. | Versuchen Sie es mit dem aktuellen Code erneut. |
| `INVALID_CREDENTIALS` | 401 | Falsche E-Mail-Adresse oder falsches Passwort – es wird bewusst nicht spezifiziert, was davon. | Versuchen Sie es erneut oder setzen Sie das Passwort zurück. |
| `INVALID_TOKEN` | 400 | Ein Verifizierungs-, Reset- oder Magic-Link-Token ist fehlerhaft oder unbekannt. | Fordern Sie einen neuen Link an. |
| `LAST_ADMIN` | 403 | Die Änderung würde das Projekt ohne Administrator hinterlassen. | Befördern Sie zuerst eine andere Person. |
| `MFA_REQUIRED` | 401 | Das Passwort war korrekt und das Konto verfügt über einen verifizierten zweiten Faktor, die Anmeldung ist also nur zur Hälfte abgeschlossen. `details` enthält ein kurzlebiges Token für die MFA-Challenge – es handelt sich nicht um eine Sitzung. | Öffnen Sie ein Challenge und beantworten Sie es; die Challenge-Antwort stellt die Sitzung aus. |
| `NO_SESSION` | 401 | Es wurde kein Sitzungs-Cookie oder Refresh-Token vorgelegt. Normal beim ersten Laden der Seite. | Melden Sie sich an. |
| `NOT_ANONYMOUS` | 400 | Eine Route für das Upgrade von einem anonymen Konto wurde von einem echten Konto aufgerufen. | Es gibt nichts zu aktualisieren. |
| `OAUTH_ERROR` | 401 | Der OAuth-Provider hat die Anfrage abgelehnt oder einen Fehler zurückgegeben. | Wiederholen Sie den Ablauf; die Meldung enthält die Begründung des Providers. |
| `RATE_LIMITED` | 429 | Zu viele Versuche von diesem Aufrufer. | Warten Sie ab; die Nachricht gibt an, wie lange. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | Das Weiterleitungsziel steht nicht auf der Whitelist/Allow-List. | Fügen Sie es zur Provider-Konfiguration hinzu. |
| `REGISTRATION_DISABLED` | 403 | Die Selbstregistrierung ist deaktiviert. | Lassen Sie das Konto von einem Administrator erstellen. |
| `ROLE_EXISTS` | 409 | Dieser Rollenname ist bereits vergeben. | Wählen Sie einen anderen Namen. |
| `ROLE_LOOKUP_FAILED` | 503 | Rollen für eine durch Administratorrechte geschützte Anfrage konnten nicht gelesen werden. Scheitert sicherheitshalber restriktiv (fails closed), anstatt dem Claim des Tokens blind zu vertrauen. | Erneut versuchen; überprüfen Sie die Datenbank. |
| `SELF_DELETE` | 400 | Ein Administrator hat versucht, sein eigenes Konto zu löschen. | Lassen Sie dies von einem anderen Administrator durchführen. |
| `SESSION_REVOKED` | 401 | Die Sitzung wurde an anderer Stelle abgemeldet oder alle Sitzungen wurden widerrufen. | Melden Sie sich erneut an. |
| `SETUP_REQUIRED` | 403 | Das Projekt hat noch keinen Administrator, daher ist diese Route nicht verfügbar. | Schließen Sie die Ersteinrichtung des Administrators ab. |
| `TOKEN_ALREADY_USED` | 401 | Ein Einmal-Token wurde wiederholt verwendet (Replay). | Fordern Sie ein neues an. |
| `TOKEN_EXPIRED` | 401 | Das Token hat seine Lebensdauer überschritten. | Fordern Sie ein neues an. |
| `USER_NOT_FOUND` | 404 | Kein Konto mit dieser ID vorhanden. | Überprüfen Sie die ID. |
| `WEAK_PASSWORD` | 400 | Das Passwort entspricht nicht den konfigurierten Richtlinien. | Wählen Sie ein stärkeres Passwort. |

## Daten, Abfragen und Schreibvorgänge

| Code | Status | Bedeutung | Behebung |
| --- | --- | --- | --- |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Dieser Treiber kann das angeforderte Aggregat nicht berechnen. | Verwenden Sie einen Treiber, der dies unterstützt, oder berechnen Sie es im Client. |
| `BRANCHING_UNSUPPORTED` | — | Ein Datenbank-Branch wurde über den Studio-Websocket auf der verwalteten Entwicklungsdatenbank (PGlite) angefordert, wo ein Branch der Parent-Datenbank *entspricht* und nichts isoliert wäre. Die Ablehnung entspricht der Ausgabe von `rebase db branch`. | Richten Sie `DATABASE_URL` auf ein eigenes Postgres (`rebase dev --docker` startet eines) und erstellen Sie dort Branches. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` enthält mehr Operationen als das Limit pro Batch erlaubt (standardmäßig 1000). Ein Batch bildet eine Transaktion und hält die Sperren über die gesamte Dauer. | Senden Sie ihn in Chunks; die Nachricht nennt das Limit und Ihre Anzahl. |
| `BATCH_UNSUPPORTED` | 400 | Der Treiber dieses Backends kann Schreibvorgänge über Collections hinweg nicht atomar ausführen, und eine Schleife einzelner Schreibvorgänge wäre weder atomar noch ein einzelner Roundtrip. | Senden Sie die Schreibvorgänge als separate Anfragen oder als `/bulk`-Aufrufe pro Collection. |
| `BULK_TOO_LARGE` | 400 | Der Bulk-Body überschreitet das konfigurierte Elementlimit. | Teilen Sie die Anfrage auf. |
| `BULK_UNSUPPORTED` | 400 | Diese Collection oder dieser Treiber unterstützt keine Bulk-Schreibvorgänge. | Schreiben Sie die Zeilen einzeln nacheinander. |
| `CALLBACK_REJECTED` | 400 | Ein Collection-Callback hat den Schreibvorgang verweigert. Ein `throw` aus `beforeSave`/`beforeDelete`/`after*` ist ein 400-Fehler mit der individuellen Meldung des Autors; ein `beforeDelete`, das `false` zurückgibt, ist ein 403-Fehler. `details.stage` nennt den Callback, `details.path` die Collection. | Lesen Sie die Nachricht – sie wurde von diesem Projekt verfasst, nicht von Rebase. |
| `CURSOR_WITH_OFFSET` | 400 | `?after=` wurde mit `?offset=` oder `?page=` kombiniert. Ein Cursor definiert bereits, wo die Seite beginnt; ein Offset darauf überspringt stillschweigend diese Anzahl von Zeilen nach dem Cursor – eine Lücke, die der Aufrufer in der Antwort nicht sehen kann. | Verwenden Sie das eine oder das andere. |
| `DISTINCT_NOT_APPLICABLE` | 400 | `?distinct=true` wurde mit einer Such- oder Vektorabfrage kombiniert. Beide weisen jeder Zeile einen Score zu, sodass niemals zwei Zeilen identisch sind und `DISTINCT` nichts zusammenfassen würde – es sähe funktionsfähig aus, würde aber nichts bewirken. | Entfernen Sie eines von beiden. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Ein `distinct`-Lesevorgang wird nach einer Spalte sortiert, die er nicht zurückgibt. Ein `SELECT DISTINCT` kann nur nach Spalten in seiner Auswahlliste sortiert werden, andernfalls haben die zusammengefassten Zeilen keine definierte Reihenfolge. `details.fields` listet sie auf. | Fügen Sie diese Felder zu `?fields=` hinzu oder entfernen Sie sie aus `?orderBy=`. |
| `DB_PERMISSION_DENIED` | 500 | Postgres hat das Statement verweigert (`42501`): Entweder verweigert eine Row-Level-Security-Richtlinie dieser Rolle den Zugriff oder es fehlt ein `GRANT`. | Siehe [Fehlerbehebung](/docs/troubleshooting/). |
| `FIELD_NOT_READABLE` | 400 | Ein Filter, `orderBy`, `fields`, Aggregat-`select` oder `groupBy` benennt ein Feld, das die Rollen dieses Aufrufers nicht lesen können (`access.read`). Ein Feld, das keine Antwort enthalten darf, darf auch von keiner Abfrage abgefragt werden, da der Wert sonst Prädikat für Prädikat ausgelesen werden könnte. `details.violations` nennt jedes Feld. | Entfernen Sie das Feld aus der Abfrage oder erwerben Sie die Rolle. Siehe [Feldzugriff](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 | Der Body setzt ein Feld, das die Rollen dieses Aufrufers nicht schreiben können (`access.write`). Abgelehnt statt verworfen: Ein Schreibvorgang, der ein Feld verwirft, würde den Erfolg einer Bearbeitung melden, die gar nicht stattgefunden hat. `details.violations` nennt jedes Feld. | Entfernen Sie das Feld oder erwerben Sie die Rolle. Ein Feld, das niemand schreiben darf, liefert stattdessen `VALIDATION_EXCLUDED_FIELDS`. |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Eine frühere Anfrage mit demselben `Idempotency-Key` wird noch ausgeführt. | Versuchen Sie es erneut, sobald sie beendet ist. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | Derselbe `Idempotency-Key` wurde mit einem anderen Body übermittelt. | Verwenden Sie einen neuen Schlüssel oder senden Sie den ursprünglichen Body. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` hat eine Funktion angegeben, die nicht `count`, `sum`, `avg`, `min` oder `max` ist. | Verwenden Sie eine dieser Funktionen; die Meldung listet sie auf. |
| `INVALID_AGGREGATE_SELECT` | 400 | Ein `?select=`-Eintrag entspricht nicht dem Format `fn(field)`, oder einer anderen Funktion als `count()` wurde kein Feld übergeben. | Schreiben Sie `sum(total)`, `count()`, `avg(score)`. |
| `INVALID_BATCH_BODY` | 400 | Einer `/_batch`-Operation fehlt `op`, `collection`, `values` oder `id`, sie benennt eine Collection, die dieses Backend nicht bedient, oder verwendet einen `ref`-Namen mehrfach. | Siehe Meldung; sie nennt die Operation nach Index. |
| `INVALID_BATCH_REF` | 400 | Ein `{ "$ref": "<name>.<field>" }` verweist auf keine frühere Operation, zeigt nach vorne oder fordert ein Feld an, das die referenzierte Zeile nicht besitzt. Es werden nur Rückwärtsreferenzen aufgelöst. | Vergeben Sie für die Operation einen Namen mit `ref`, *bevor* Sie darauf verweisen. |
| `INVALID_BULK_BODY` | 400 | Der Bulk-Body entspricht nicht dem erwarteten Format. | Senden Sie das dokumentierte `items`-Array. |
| `INVALID_CONFLICT_TARGET` | 400 | Das `on_conflict` / `onConflict` eines Upserts nennt Spalten ohne Eindeutigkeitsgarantie (Uniqueness) oder benennt sie ohne `upsert: true`. Postgres würde andernfalls mit 42P10 aus einer Transaktion antworten, die bereits Arbeit verrichtet hat. | Deklarieren Sie `validation: { unique: true }` oder einen `unique`-Index; die Meldung listet die tatsächlich vorhandenen Targets auf. |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` ist weder `include` noch `only`. Abgewiesen statt ignoriert: Ein vertipptes `?deleted=true`, das stillschweigend jede gelöschte Zeile ausblendet, würde funktionsfähig wirken, aber die gegenteilige Frage beantworten. | Senden Sie `include` (aktive und gelöschte) oder `only` (nur gelöschte). Lassen Sie den Parameter weg, um nur aktive Zeilen zu erhalten. |
| `INVALID_DISTINCT` | 400 | `?distinct=` ist weder `true` noch `false`. | Senden Sie einen dieser Werte; `1` und `0` werden ebenfalls akzeptiert. |
| `INVALID_FIELD_OPERATION` | 400 | Ein `$inc` / `$push` / `$pull` / `$merge` wurde auf einem Property-Typ verwendet, für den es nicht definiert ist, mit einem Operanden im falschen Format, mit zwei Operatoren auf einem Feld, falsch geschrieben oder bei einem Erstellvorgang (Create) – wo es keinen gespeicherten Wert gibt, auf dem operiert werden könnte. | Siehe [Schreiben über REST](/docs/backend/writes/#field-operations); die Nachricht nennt das Feld. |
| `INVALID_FILTER_FIELD` | 400 | Der Filter benennt eine Property, die diese Collection nicht besitzt. | Überprüfen Sie die Schreibweise anhand der Collection. |
| `INVALID_FILTER_OPERATOR` | 400 | Der Operator wird von diesem Property-Typ nicht unterstützt. | Siehe [Daten abfragen](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | Ein Filterwert kann nicht als Typ der Spalte gelesen werden, mit der er verglichen wurde: `?id=eq.abc` auf einem Integer-Schlüssel, ein Label, das nicht im Enum enthalten ist, ein Timestamp, der keiner ist, eine Zahl außerhalb des Wertebereichs des Typs. `details.dbCode` enthält den SQLSTATE. | Senden Sie einen Wert, der dem Typ der Spalte entspricht. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` ist weder `true` noch `false`. Jeder andere Wert wird abgelehnt, anstatt als „Nein“ interpretiert zu werden – ein Tippfehler, der ein Soft-Delete ausführt, wenn der Aufrufer endgültig löschen (Purge) wollte, würde den Benutzer im Glauben lassen, die Daten seien gelöscht. | Senden Sie `true` oder `false`. |
| `INVALID_INCLUDE` | 400 | `?include=` ist fehlerhaft: keine gültige Pfadliste oder tiefer geschachtelt als die maximal zulässige Tiefe. Wird an der Schnittstelle abgefangen, anstatt aus dem Treiber als 500 zu entkommen. | Siehe Meldung; sie nennt den fehlerhaften Pfad. |
| `INVALID_INPUT` | 400 | Der Body hat die Validierung nicht bestanden. | Siehe Meldung. |
| `INVALID_LIMIT` | — | Ein Echtzeit-Abonnement hat ein Limit außerhalb des zulässigen Bereichs angefordert. Wird als WebSocket-`ERROR`-Frame übermittelt, nicht als HTTP-Antwort. | Verringern Sie das Limit. |
| `INVALID_LOGICAL_GROUP` | 400 | Eine `?or=`- / `?and=`-Gruppe ist fehlerhaft formatiert oder tiefer als die erlaubte Tiefe verschachtelt. | Siehe Meldung; sie zeigt die Glättungsregel. |
| `INVALID_OFFSET` | 400 | `?offset=` ist keine ganze Zahl größer oder gleich 0. | Senden Sie eine nicht-negative Ganzzahl. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` entspricht nicht `field`, `field:desc` oder einem JSON-Array aus `{ field, direction }`. | Siehe Meldung; sie zeigt alle drei Schreibweisen. |
| `INVALID_PAGE` | 400 | `?page=` ist keine ganze Zahl größer oder gleich 1. Seiten sind 1-basiert, daher ist `?page=0` ein Fehler und nicht die erste Seite. | Senden Sie `1` oder höher, oder verwenden Sie `?offset=`. |
| `INVALID_PARAM` | 400 | Ein Abfrageparameter ist fehlerhaft formatiert. | Siehe Meldung. |
| `INVALID_VECTOR` | 400 | `?vector=` ist kein JSON-Array aus Zahlen. | Senden Sie `[0.1,0.2,0.3]`. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` ist weder `cosine`, `l2` noch `inner_product`. | Verwenden Sie einen dieser drei Werte. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` ist keine Zahl. | Senden Sie eine Zahl. |
| `INVALID_WHERE` | 400 | `?where=` ist kein JSON-Objekt, das Felder auf Bedingungen abbildet. | Senden Sie `{"status":["==","active"]}`. |
| `MISSING_AGGREGATE_SELECT` | 400 | Die Aggregat-Route wurde ohne `?select=` aufgerufen. | Fügen Sie einen Parameter hinzu, z. B. `?select=count()`. |
| `NO_COLLECTIONS` | 404 | Das Projekt stellt keine Collections bereit: weder im Code deklariert noch Tabellen vorhanden, aus denen sie abgeleitet werden könnten. | Erstellen Sie Tabellen – per Migration, SQL oder über eine Collection-Datei plus `rebase db push` – und starten Sie neu. |
| `NOT_FOUND` | 404 | Keine Zeile mit dieser ID in dieser Collection vorhanden – oder eine Zeile, die durch Row-Level Security vor diesem Aufrufer verborgen wird. | Überprüfen Sie die ID und anschließend die `securityRules` der Collection. |
| `UNKNOWN_RELATION` | 400 | `?include=` benennt etwas, das keine Relation der Collection ist. Derselbe Code antwortet mit **404**, wenn stattdessen ein geschachtelter *URL-Pfad* eine solche benennt, z. B. `/api/data/authors/1/posts`, wo `authors` keine deklariert – dort benennt die URL nichts, weshalb es sich um ein Not-Found und nicht um eine fehlerhafte Anfrage handelt. | Überprüfen Sie den Namen der Relation – die Meldung listet die Relationen der Collection auf. Eine Rückwärtsreferenz muss auf dem übergeordneten Element deklariert sein, um traversierbar zu sein. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | Die Sortierung benennt eine Property, die nicht sortierbar ist. | Sortieren Sie nach einer durch eine Spalte gestützten Property. |
| `PAYLOAD_TOO_LARGE` | 413 | Der Body überschreitet das konfigurierte Limit. | Senden Sie weniger Daten oder erhöhen Sie das Limit. |
| `READ_ONLY_TRANSACTION` | 409 | Ein `afterRead`-Callback hat versucht zu schreiben. Ein anfragebezogener Lesevorgang läuft in einer `READ ONLY`-Transaktion, daher darf weder der Callback noch etwas, das er aufruft, schreiben. | Lagern Sie den Schreibvorgang aus dem Lesevorgang aus: in einen Hintergrund-Job oder mittels `rebase.dataAsAdmin` aus einem Cron-Job bzw. einer benutzerdefinierten Funktion. |
| `RELATION_MISCONFIGURED` | 500 | Eine Relation lässt sich nicht gegen das registrierte Schema auflösen. Die Operation wird abgelehnt statt übersprungen: Das Verwerfen würde Erfolg für einen Schreibvorgang melden, der nie stattgefunden hat, oder Leere für Zeilen, die existieren. | Führen Sie `rebase schema generate` aus, wenn das generierte Schema älter als die Datenbank ist. |
| `RELATION_NOT_UNLINKABLE` | 400 | Die Verknüpfung der Relation kann von dieser Seite aus nicht aufgehoben werden. | Schreiben Sie von der besitzenden Seite aus. |
| `RELATION_NOT_WRITABLE` | 400 | Der verschachtelte Pfad ist keine schreibbare Relation. | Siehe [Relationen](/docs/collections/relations/). |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | Ein Relations-Schreibvorgang hatte keinen Quellschlüssel, an den die Verknüpfung angehängt werden konnte. | Speichern Sie zuerst die übergeordnete Zeile. |
| `SCHEMA_DRIFT` | 500 | Eine Tabelle oder Spalte, die der Code erwartet, existiert in der Datenbank nicht. | Führen Sie in der Entwicklung `rebase db push` aus; führen Sie bei einem verwalteten Tenant ein erneutes Deployment durch. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | `startAfter` wurde mit `orderBy: "_score"` kombiniert. Die Relevanz wird pro Abfrage berechnet und nicht gespeichert, daher kann sie nicht als Schlüssel für einen Cursor dienen. | Paginieren Sie die Relevanz mit `limit`/`offset` oder sortieren Sie nach einer Spalte. |
| `TENANT_IMMUTABLE` | 400 | Ein Schreibvorgang würde eine Zeile von einem Mandanten (Tenant) zu einem anderen verschieben. Eine Zeile kann den Mandanten nicht wechseln. `details.violations` nennt das Feld. | Erstellen Sie die Zeile im anderen Mandanten und löschen Sie diese hier, oder schreiben Sie mit einer Rolle in `tenant.bypassRoles`. |
| `TENANT_MISMATCH` | 400 | Der Schreibvorgang benennt einen Mandanten, zu dem dieser Aufrufer nicht gehört; die Datenbank würde dies ebenfalls ablehnen. | Schreiben Sie in einen Mandanten, zu dem der Aufrufer gehört, oder authentifizieren Sie sich als jemand, der zu ihm gehört. |
| `TENANT_REQUIRED` | 400 | Die Collection ist an Mandanten gebunden und der Mandant kann nicht abgeleitet werden: Die Anfrage enthält keinen Mandanten oder der Aufrufer gehört zu mehreren. | Senden Sie das Mandantenfeld explizit oder authentifizieren Sie sich als ein Aufrufer, der genau einem Mandanten angehört. |
| `UNKNOWN_FIELD` | 400 | `?fields=` benennt ein Feld, das die Collection nicht besitzt. | Prüfen Sie die Schreibweise; die Meldung listet die gültigen Felder auf. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Ein Aggregat oder `groupBy` benennt ein Feld, das die Collection nicht besitzt. | Prüfen Sie die Schreibweise; die Meldung listet die gültigen Felder auf. |
| `UNKNOWN_FILTER_FIELD` | 400 | Der Filter benennt ein Feld, das diese Collection – oder das Ziel einer Relation – nicht besitzt. | Prüfen Sie die Schreibweise; die Meldung listet die gültigen Felder auf. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | Der Filter benennt einen Operator, der nicht existiert. | Die Meldung listet alle Operatoren auf. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | Die Sortierung benennt ein Feld, das diese Collection nicht besitzt. | Prüfen Sie die Schreibweise; die Meldung listet die gültigen Felder auf. |
| `PRECONDITION_FAILED` | 412 | Ein `If-Match` hat eine Version der Zeile benannt, die nicht mehr aktuell ist: Jemand hat zwischen dem Lesen und diesem Schreibvorgang darauf geschrieben. Es wurde nichts geschrieben. | Lesen Sie die Zeile erneut, wenden Sie die Änderung erneut an und senden Sie das neue `ETag`. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` fragt nach einem Feld, das die Collection nicht besitzt. | Prüfen Sie die Schreibweise; die Meldung listet die bekannten Felder auf. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Eine Vektorsuche hat eine Property benannt, die kein `vector` in dieser Collection ist. | Die Meldung listet die Vektor-Properties der Collection auf. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Der `Content-Type` wird von dieser Route nicht akzeptiert. | Senden Sie den in der Dokumentation der Route angegebenen Typ. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | Der Filter kreuzt eine `via`-Relation, deren Join-Pfad nur unidirektional definiert ist, sodass keine Zuordnung für eine Unterabfrage zurückgeführt werden kann. | Filtern Sie von der besitzenden Seite aus. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | Der Operator ist für dieses Feld nicht definiert: Eine Relation ohne Spalte in dieser Zeile wird nach Mitgliedschaft gefiltert, und Abgleiche ohne Berücksichtigung der Groß-/Kleinschreibung (Case-Insensitive) gelten nur für Text. | Siehe Meldung; sie listet auf, was das Feld akzeptiert. |
| `VALIDATION_CONSTRAINT` | 400 | Ein Wert hat eine von der Property deklarierte `validation`-Regel verletzt – eine Länge, einen Bereich, ein Muster oder ein Pflichtfeld. | Siehe Meldung; sie nennt jede einzelne Verletzung. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | Der Body schreibt in eine Spalte, die mit `excludeFromApi` oder `access: { write: [] }` markiert ist – dieselbe Regel, zwei Schreibweisen. Diese werden vom Server gesetzt: ein Passwort-Hash, ein Verifizierungs-Token. Im Gegensatz zu `FIELD_NOT_WRITABLE` ist dies für jeden Aufrufer die gleiche Antwort, einschließlich `admin`. | Entfernen Sie das Feld. Siehe [Feldzugriff](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | Ein Wert passt nicht zu seinem Property-Typ. | Siehe Meldung; sie nennt die Property. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | Der Body benennt ein Feld, das die Collection nicht besitzt – einschließlich eines `id`-Arguments bei einer Collection, die über einen anderen Schlüssel definiert ist. | Prüfen Sie die Schreibweise; die Meldung listet die bekannten Felder auf. |
| `WRITE_DENIED` | 403 | Eine Sicherheitsregel oder eine Row-Level-Security-Richtlinie hat den Schreibvorgang verweigert. | Überprüfen Sie die `securityRules` der Collection. |

## `PG_<SQLSTATE>` — ein von der Datenbank abgelehnter Constraint

Ein Schreibvorgang, den Postgres aus einem Grund ablehnt, der in den *Daten des Aufrufers* liegt, antwortet mit dem SQLSTATE im Code: `PG_23505`, `PG_23503` usw. Dabei handelt es sich um eine Familie, nicht um eine feste Liste – Postgres definiert Hunderte von SQLSTATEs –, aber nur zwei Klassen erreichen diesen Zustand je, da nur diese beiden vom Aufrufer verschuldet sind:

- **Klasse 23**, Verletzung von Integritäts-Constraints: ein Duplikat, ein Fremdschlüssel, der ins Leere weist, eine NOT-NULL-Spalte, die leer gelassen wurde;
- **Klasse 22**, Daten-Ausnahme (Data Exception): ein Wert, den der Typ der Spalte nicht aufnehmen kann.

Alles andere – ein Verbindungsabbruch, eine fehlende Spalte, ein Berechtigungsproblem – liegt auf Seiten des Servers und bleibt ein `500`-Fehler. Daher ist `code.startsWith("PG_")` eine sichere Prüfung für „die von mir gesendete Zeile war fehlerhaft“, und die vier folgenden Codes sind diejenigen, auf die ein Client tatsächlich trifft. `details.dbCode` enthält bei allen denselben SQLSTATE, und die Meldung benennt den Constraint.

| Code | Status | Bedeutung | Behebung |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | Ein Wert konnte nicht als Typ der Spalte interpretiert werden – das schreibseitige Gegenstück zu `INVALID_FILTER_VALUE`. | Senden Sie einen Wert, der dem Typ der Spalte entspricht. |
| `PG_23502` | 400 | Eine `NOT NULL`-Spalte wurde leer gelassen. | Senden Sie das Feld mit oder versehen Sie die Spalte mit einem Standardwert. |
| `PG_23503` | 400 | Ein Fremdschlüssel verweist auf eine Zeile, die nicht existiert. | Erstellen Sie zuerst die Zielzeile oder korrigieren Sie die ID. |
| `PG_23505` | 409 | Ein Unique-Constraint wurde verletzt. Die Meldung benennt den Constraint. | Verwenden Sie einen anderen Wert oder aktualisieren Sie die bestehende Zeile. |

## Speicher (Storage)

| Code | Status | Bedeutung | Behebung |
| --- | --- | --- | --- |
| `INVALID_STORAGE_BUCKET` | 400 | Der Bucket-Name ist fehlerhaft. | Überprüfen Sie den Namen. |
| `INVALID_STORAGE_KEY` | 400 | Der Objektschlüssel ist fehlerhaft formatiert oder verlässt sein Präfix (Path Traversal). | Überprüfen Sie den Schlüssel. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | Die Parameter für die Bildtransformation liegen außerhalb des gültigen Bereichs oder widersprechen sich. | Siehe [Storage](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | Der Upload überschreitet die `maxSize`, die die Ziel-Property deklariert. Wird auf dem Server erzwungen, nicht nur im Browser. `details` enthält die Property, das Limit und die tatsächliche Größe. | Laden Sie eine kleinere Datei hoch oder erhöhen Sie `maxSize` für die Property. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | Der Typ des Uploads ist nicht in den `acceptedFiles` der Property enthalten. `details` enthält die Property, die Liste der akzeptierten Typen und den gesendeten Content-Type. | Laden Sie einen akzeptierten Typ hoch oder erweitern Sie `acceptedFiles`. |
| `STORAGE_NOT_CONFIGURED` | 503 | Auf diesem Server ist kein Storage-Backend konfiguriert. | Konfigurieren Sie S3, GCS oder lokalen Speicher. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | Die Storage-Quelle ist deklariert, verfügt hier jedoch über keine Anmeldeinformationen (Credentials). | Setzen Sie die Umgebungsvariablen dieser Quelle. |
| `STORAGE_WRITE_FAILED` | 502 | Das Storage-Backend hat den Schreibvorgang verweigert oder abgebrochen. | Überprüfen Sie dessen Protokolle und Anmeldeinformationen. |
| `TRANSFORM_OVERLOADED` | 503 | Zu viele Bildtransformationen werden gleichzeitig ausgeführt. | Versuchen Sie es erneut; erwägen Sie das Vorschalten eines CDNs. |
| `UNKNOWN_STORAGE_SOURCE` | 400 | Die Anfrage hat eine Storage-Quelle (`?storageId=`) benannt, die dieses Projekt nicht deklariert. Ein `bucket`, den diese Bereitstellung nicht bedient, liefert denselben Code bei **404** – der Speicherort ist es, was fehlt, und `details` listet die tatsächlich vorhandenen Buckets und Quellen auf. Früher wurden beide Fälle als „Datei nicht gefunden“ zurückgegeben, identisch mit einem Schlüssel, der schlicht fehlt. | Deklarieren Sie die Quelle in `config/resources.ts` oder prüfen Sie `GET /api/storage/sources`. |

## Benutzerdefinierte Funktionen (Custom functions)

| Code | Status | Bedeutung | Behebung |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | Es wird keine Funktion mit diesem Namen bereitgestellt – oder eine Funktion ist vorhanden, aber ihre eigenen Routen decken den Pfad dahinter nicht ab. Einem angemeldeten Aufrufer wird auch mitgeteilt, was *tatsächlich* bereitgestellt wird; einem anonymen nicht, da diese Liste ein Verzeichnis aller benutzerdefinierten Endpunkte darstellt. Wenn eine Datei dieses Namens nicht geladen werden konnte, weist die Meldung darauf hin: Das ist der Unterschied zwischen einem Tippfehler und einem fehlerhaften Deployment. | Gleichen Sie den Namen mit `GET /api/functions` ab oder prüfen Sie das Boot-Log auf eine Datei, die nicht geladen werden konnte. |
| `FUNCTION_TIMEOUT` | 504 | Der Handler hat sein Timeout überschritten. Er läuft noch weiter; er kann von hier aus nicht abgebrochen werden. | Versehen Sie ausgehende Aufrufe mit einem `AbortSignal` oder erhöhen Sie `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Dieser Prozess leitet Funktionen per Proxy an einen anderen Prozess weiter, der nicht geantwortet hat. | Prüfen Sie, ob die Functions-Einheit läuft. |

## Admin-Oberflächen und Schema-Bearbeitung

Diese Codes besagen, dass ein Feature deaktiviert oder unkonfiguriert ist, und nicht, dass die Anfrage falsch war. Jeder dieser Zustände wird auch auf der entsprechenden `/status`-Route mit einem `200`-Status gemeldet, sodass ein Dashboard das Feature ausgrauen kann, anstatt einen Fehler anzuzeigen.

| Code | Status | Bedeutung | Behebung |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | Eine reine Admin-Oberfläche wurde auf einem Server aufgerufen, auf dem keine Authentifizierung konfiguriert ist, sodass ein Administrator nicht von einem Fremden unterschieden werden kann. | Setzen Sie `auth.jwtSecret` oder übergeben Sie einen `AuthAdapter`. |
| `CONTRACT_UNAVAILABLE` | 404 | Der Projektvertrag wird nur dann bereitgestellt, wenn die Authentifizierung konfiguriert ist – er beschreibt jede Tabelle und Relation. | Konfigurieren Sie die Authentifizierung. `/meta/schema-version` wird immer bereitgestellt. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | Es ist kein Entwicklungs-Postfach aktiv. E-Mails werden nur abgefangen, wenn `SMTP_HOST` nicht gesetzt und `NODE_ENV` nicht `production` ist. | Entfernen Sie `SMTP_HOST` in der Entwicklung oder rufen Sie das echte Postfach ab. |
| `INVALID_CHANGE` | 400 | Die vorgeschlagene Schemaänderung ist nicht wohlgeformt. | Siehe Meldung. |
| `SCHEMA_CHANGE_FAILED` | 400 | Das Anwenden einer geplanten Schemaänderung ist aus einem Grund fehlgeschlagen, den spezifischere Codes nicht abdecken. | Siehe Meldung; sie gibt den zugrundeliegenden Fehler wortwörtlich wieder. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | Die Änderung ist gültig, kann jedoch auf das Schema im aktuellen Zustand nicht angewendet werden. | Siehe Meldung. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | Das Repository weist uncommittete Änderungen auf, weshalb die Bearbeitung nicht sicher angewendet werden konnte. | Committen oder stashen Sie die Änderungen und versuchen Sie es erneut. |
| `SCHEMA_EDIT_REFUSED` | 400 | Der Schema-Editor hat die Bearbeitung abgelehnt. | Siehe Meldung; es handelt sich um die eigene Ablehnung des Editors. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Ein API-Schlüssel oder ein anderer maschineller Principal hat versucht, eine Schemaänderung anzuwenden. | Melden Sie sich als Benutzer an oder setzen Sie `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | Die Live-Schema-Bearbeitung benötigt `collectionsDir` oder `liveSchema.repository`, und dieser Server wurde ohne beides gestartet. | Konfigurieren Sie eines davon. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | Die Planung funktioniert; es ist kein Repository vorhanden, in das die Änderung committet werden könnte. | Konfigurieren Sie `liveSchema.repository`. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Dieser Treiber kann keine Schemaänderungen planen. | Live-Bearbeitung ist auf Postgres verfügbar. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | Collections werden hier per Introspektion aus der Datenbank bezogen, daher gibt es keine Quelldateien zum Bearbeiten. | Ändern Sie das Schema über eine Migration. |
| `SCHEMA_EDITOR_DISABLED` | 501 | Der Schema-Editor ist für diesen Server deaktiviert. | Aktivieren Sie ihn mit `schemaEditor`. |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | Der Schema-Editor benötigt `ts-morph`, welches nicht installiert ist. | Führen Sie `pnpm add -D ts-morph@28.0.0` aus. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | Der Server hat kein `collectionsDir`, daher hat der Editor kein Ziel zum Schreiben. | Setzen Sie `collectionsDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | Der Editor ist unter `NODE_ENV=production` deaktiviert: Die Dateien eines bereitgestellten Servers werden bei jedem Deployment aus Ihrem Repository neu gebaut, sodass eine Bearbeitung hier verworfen werden würde. | Bearbeiten Sie Collections in der Entwicklung und deployen Sie anschließend. |

## Generische Codes

Eine Route verwendet einen dieser Codes, wenn nichts Spezifischeres zutrifft.

| Code | Status | Bedeutung | Behebung |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Fehlerhaft formatiert, und kein spezifischerer Code trifft zu. | Siehe Meldung. |
| `UNAUTHORIZED` | 401 | Nicht authentifiziert oder die Anmeldeinformationen wurden abgelehnt. | Anmelden oder aktualisieren. |
| `FORBIDDEN` | 403 | Authentifiziert, aber nicht autorisiert. | Ein erneuter Versuch mit derselben Identität wird nicht helfen. |
| `CONFLICT` | 409 | Ein Konflikt mit dem bestehenden Zustand. | Siehe Meldung. |
| `INTERNAL_ERROR` | 500 | Auf dem Server ist ein interner Fehler aufgetreten. Die Meldung ist absichtlich generisch. | Geben Sie die `requestId` an; die Ursache befindet sich in den Protokollen. |
| `NOT_CONFIGURED` | 503 | Eine Abhängigkeit, die diese Route benötigt, ist auf diesem Server nicht konfiguriert. | Siehe Meldung. |
| `SERVICE_UNAVAILABLE` | 503 | Eine Abhängigkeit war nicht erreichbar. | Erneut versuchen; überprüfen Sie die Protokolle. |

## Diese Seite aktuell halten

`pnpm verify:docs` schlägt fehl, wenn ein Code, den der Server auslösen kann, in diesen Tabellen fehlt, wenn eine Tabelle einen Code auflistet, den nichts auslösen kann, wenn ein angegebener Status nicht mit dem Quellcode übereinstimmt oder wenn eine Code-Familie wie `PG_<SQLSTATE>` keine Zeile für einen SQLSTATE enthält, auf den Aufrufer treffen können. Der entsprechende Schritt ist `tooling/scripts/docs-verify/check-error-codes.mjs`.

Das Skript prüft sich zunächst selbst. Der Scan liest Codes direkt aus TypeScript und nicht von einem laufenden Server aus, weshalb seine toten Winkel konstruktionsbedingt unbemerkt blieben: Einst konnte er einen Code nicht erkennen, der durch einen einzeiligen Wrapper übergeben wurde, oder einen, der nach einer Nachricht mit einer `)` stand, und meldete fälschlicherweise „jeder Code, den der Server auslösen kann, ist dokumentiert“ für eine Seite, auf der siebzehn davon fehlten. Daher führt der Schritt eine Fixture genau dieser Muster aus, bevor er diese Seite liest, und verweigert die Ausgabe jeglicher Berichte, wenn er diese nicht erkennen kann.

---
