---
sourceHash: 816748d7e340be51
title: Fehlercodes
sidebar_label: Fehlercodes
description: Jeder Fehlercode, den ein Rebase-Backend zurückgeben kann, inklusive HTTP-Status, Bedeutung und Behebung – plus Response-Envelope, X-Request-ID und Details-Regeln.
---

Jeder Fehler, den ein Rebase-Backend zurückgibt, verwendet denselben Envelope und enthält einen stabilen
`code`. Dieser Code ist das Element, auf das im Code verzweigt werden sollte: Die Meldung (`message`) ist für Menschen
geschrieben und kann umformuliert werden, der Status wird von einem Dutzend verschiedener Probleme geteilt,
und der Code ist keines von beiden.

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

- **`message`** — Für Menschen lesbar. Bei einem `4xx`-Fehler ist es die eigene Nachricht des Servers; bei
  einem `5xx`-Fehler ist sie bewusst generisch gehalten, da der zugrunde liegende Text einen Host,
  eine Rolle oder einen Spaltennamen enthalten kann.
- **`code`** — Einer der unten aufgeführten Werte. Stabil über Minor-Versionen hinweg.
- **`details`** — Optional und niemals garantiert. Siehe die unten stehenden Regeln.
- **`requestId`** — Vorhanden, sobald die Anfrage die Request-ID-Middleware
  durchlaufen hat, was für jede Route unter `basePath` der Fall ist.

### `X-Request-ID`

Jede Anfrage unter `basePath` erhält eine ID: den `X-Request-ID`-Header des Aufrufers,
wenn es sich um eine UUID handelt, andernfalls eine neu generierte ID. Sie wird in der
Antwort als `X-Request-ID` zurückgegeben, im Fehler-Envelope als `requestId` eingefügt und
an die Log-Zeile des Servers für diese Anfrage angehängt.

Das ist der Join-Schlüssel. Geben Sie ihn in einem Fehlerbericht an, und ein Administrator kann genau die
eine Log-Zeile finden, die den Fehler erklärt – einschließlich des Grundes, der dem Client
nie angezeigt wurde.

Das Senden einer eigenen ID ermöglicht es einem Trace, Hops zu überstehen: Ein Gateway oder ein Job-Runner,
der den Header weiterleitet, sorgt für eine einheitliche ID über jeden Dienst hinweg, der die Anfrage verarbeitet hat.
Ein ungültiger Wert wird ignoriert und nicht abgelehnt – ein fehlerhafter Header eines
Aufrufers ist es nicht wert, eine Anfrage scheitern zu lassen. Gehen Sie daher nicht davon aus, dass die gesendete ID
der erhaltenen ID entspricht. Prüfen Sie den Response-Header.

### Was in `details` enthalten ist

`details` dient der Diagnose und ist nicht vertraglich zugesichert. Drei Regeln bestimmen den Inhalt:

1. **Alles, was eine Route explizit setzt, wird immer zurückgegeben.** Dies sind die
   präzise beschriebenen Fehler des Aufrufers: welches Filterfeld unbekannt war,
   welche Relation nicht beschreibbar ist, welcher Wert nicht zum Typ passte.
2. **Datenbankdiagnosen werden in der Produktionsumgebung gekürzt.** Wenn der Fehler
   von Postgres stammt, ist `details.dbCode` – der SQLSTATE – immer vorhanden: Er benennt
   die Problemklasse und gibt nichts über die Daten preis. `dbMessage`,
   `detail` und `hint` werden nur hinzugefügt, wenn `NODE_ENV` nicht `production` ist,
   da Postgres darin Zeileninhalte ausgibt. `23505` meldet
   `Key (email)=(a@b.c) already exists.`, was für jede beliebige Adresse die Frage
   "Ist diese Person registriert?" beantworten würde.
3. **Verzweigen Sie niemals auf Basis von `details`.** Verzweigen Sie anhand von `code`. Der Inhalt von
   `details` ist das, was an dieser Aufrufstelle für eine Person nützlich war, und kann sich ändern.

## Statuscodes interpretieren

| Status | Bedeutung für die Anfrage |
| --- | --- |
| `400` | Fehlerhaft aufgebaut oder fragt nach etwas, das im Schema nicht existiert. Anfrage korrigieren. |
| `401` | Nicht authentifiziert oder die Anmeldedaten sind abgelaufen. Anmelden oder aktualisieren. |
| `403` | Authentifiziert, aber nicht berechtigt. Ein erneuter Versuch mit derselben Identität nützt nichts. |
| `404` | Route, Tabelle oder Zeile existiert nicht – oder eine Zeile wird durch Row-Level Security ausgeblendet. |
| `409` | Ein Konflikt mit dem bestehenden Zustand: ein Duplikat oder ein gleichzeitiger Schreibvorgang. |
| `413` `415` `422` | Der Body ist zu groß, der Medientyp falsch oder semantisch abgelehnt. |
| `429` | Rate-Limit erreicht. Warten; die Meldung gibt an, wie lange. |
| `500` | Der Server oder seine Datenbank hat einen Fehler, nicht der Aufrufer. Logs prüfen. |
| `501` | Die Route existiert, aber dieses Deployment kann sie nicht bedienen – eine Funktion ist deaktiviert oder nicht konfiguriert. |
| `502` `503` `504` | Eine Abhängigkeit war nicht erreichbar, nicht konfiguriert oder zu langsam. |

## Authentifizierung und Konten

| Code | Status | Bedeutung | Behebung |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | Die Route erfordert einen zweiten Faktor und die Sitzung hat nur einen. | MFA-Challenge abschließen, dann wiederholen. |
| `ALREADY_VERIFIED` | 400 | Die Adresse oder der Faktor ist bereits verifiziert. | Nichts – der gewünschte Zustand ist bereits erreicht. |
| `ACCOUNT_OUTRANKS_CALLER` | 403 | Das bearbeitete, zurückgesetzte oder gelöschte Konto besitzt eine Rolle oder einen Scope, den der Aufrufer nicht hat. `details.beyond` benennt sie. | Die Änderung durch jemanden durchführen lassen, der diese Berechtigungen besitzt. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | Anonyme Anmeldung ist auf diesem Server deaktiviert. | Aktivieren oder mit einer echten Identität anmelden. |
| `ANONYMOUS_NOT_ALLOWED` | 403 | Eine Gastsitzung hat versucht, ein Device-Login zu genehmigen. Ein Gast hat kein Konto, das er einem Gerät zuweisen könnte. | Mit einem Konto anmelden, dann genehmigen. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Ein API-Schlüssel hat versucht, API-Schlüssel (seines eigenen Typs oder persönliche) aufzulisten, zu erstellen, zu ändern oder zu widerrufen. | Schlüssel als Person mit `keys:write` oder mit dem Service-Schlüssel verwalten. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Eine geschützte Route wurde ohne Rebase-Auth-Middleware ausgeführt, daher wurden die Anmeldedaten des Aufrufers nie geprüft. | Die App über den Functions-Router anstatt direkt auf dem eigenen Server mounten. |
| `BOOTSTRAP_ANONYMOUS` | 403 | Das Initialisieren des ersten Administrators wurde von einem anonymen Aufrufer versucht. | Zuerst anmelden. |
| `BOOTSTRAP_COMPLETED` | 403 | Der erste Administrator existiert bereits. | Die Rolle von einem bestehenden Administrator gewähren lassen. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | Bootstrap ist nur für den allerersten Benutzer gedacht, und dies ist nicht dieser Benutzer. | Die Rolle von einem bestehenden Administrator gewähren lassen. |
| `CAPTCHA_FAILED` | 400 | Der Provider hat das CAPTCHA-Token abgelehnt. | Eine neue Challenge lösen. |
| `CAPTCHA_REQUIRED` | 400 | Die Route erfordert ein CAPTCHA-Token und es wurde keines gesendet. | Das Token beifügen. |
| `CHALLENGE_EXHAUSTED` | 401 | Zu viele falsche Codes für eine MFA-Challenge. | Eine neue Challenge starten. |
| `DEVICE_LOGIN_DECIDED` | 409 | Das Device-Login wurde bereits genehmigt oder abgelehnt. Ein Login wird nur einmal entschieden. | Ein neues auf dem Gerät starten. |
| `DEVICE_LOGIN_EXPIRED` | 410 | Das Device-Login hat seine zehn Minuten überschritten, bevor es entschieden wurde. | Ein neues auf dem Gerät starten. |
| `DEVICE_LOGIN_NOT_FOUND` | 404 | Kein Device-Login hat diesen Benutzercode. Das Polling des Geräts selbst antwortet stattdessen mit den Kleinbuchstaben-Codes von RFC 8628: `authorization_pending`, `slow_down`, `access_denied`, `expired_token`, `invalid_grant`. | Code mit dem auf dem Gerät angezeigten abgleichen. |
| `EMAIL_EXISTS` | 409 | Ein Konto mit dieser Adresse existiert bereits – bei der Registrierung, bei einer Adressänderung oder beim Aufrufen eines Links zur Adressänderung, wenn ein anderes Konto die Adresse inzwischen belegt hat. | Anmelden oder Passwort zurücksetzen; bei einer Adressänderung eine andere Adresse wählen. |
| `EMAIL_NOT_CONFIGURED` | 503 | Magic Links oder OTP wurden angefordert, aber der Server verfügt über keinen Mail-Transport. | SMTP konfigurieren oder eine andere Anmeldemethode verwenden. |
| `EMAIL_NOT_VERIFIED` | 403 | Ein OAuth-Login hat ein Konto mit derselben Adresse gefunden, und der Provider hat diese Adresse nicht verifiziert, daher wird sie nicht verknüpft. | Mit der bestehenden Methode anmelden, dann `POST /auth/link/<provider>` ausführen. |
| `FACTOR_NOT_VERIFIED` | 400 | Der MFA-Faktor wurde registriert, aber nie bestätigt. | Den Faktor bestätigen. |
| `IDENTITY_ALREADY_LINKED` | 409 | Diese OAuth-Identität gehört zu einem anderen Konto. | Damit anmelden oder sie dort zuerst trennen. |
| `IMPERSONATION_FORBIDDEN` | 403 | Eine Anfrage hat `x-rebase-impersonate` gesendet, aber der Aufrufer darf keine Anfragen als anderer Benutzer ausführen. Nur die eigene Sitzung eines angemeldeten Administrators darf dies, niemals ein API-Schlüssel oder der Service-Schlüssel. | Mit einer Administratorsitzung senden oder den Header weglassen. |
| `IMPERSONATION_INVALID` | 400 | `x-rebase-impersonate` wurde leer gesendet. | Die UID des Benutzers senden, als der agiert werden soll, oder den Header weglassen. |
| `IMPERSONATION_TARGET_NOT_FOUND` | 404 | `x-rebase-impersonate` benennt keinen aktiven Benutzer: Kein Konto hat diese UID oder es ist deaktiviert. | UID überprüfen. |
| `IMPERSONATION_UNAVAILABLE` | 501 | Die Authentifizierung dieses Backends kann keine Anfragen als anderer Benutzer ausführen, da sein `AuthAdapter` kein `resolveUser` besitzt. | `resolveUser` im Adapter implementieren oder den Header weglassen. |
| `IMPERSONATION_UNSUPPORTED` | 400 | `x-rebase-impersonate` wurde an eine Route gesendet, die nicht als anderer Benutzer ausgeführt werden kann. Nur die Daten-API und benutzerdefinierte Funktionen unterstützen dies; das Realtime-Socket unterstützt `impersonate` bei `AUTHENTICATE`. | Anfrage ohne den Header senden. |
| `SIMULATION_FORBIDDEN` | 403 | Eine Anfrage hat einen `x-rebase-simulate-*`-Header gesendet (der RLS-Simulator) oder `/api/admin/rls-simulator` aufgerufen, und der Aufrufer darf den Zugriff nicht simulieren. Nur die eigene Sitzung eines angemeldeten Administrators darf dies, niemals ein API-Schlüssel oder der Service-Schlüssel. | Mit einer Administratorsitzung senden oder die Header weglassen. |
| `SIMULATION_INVALID` | 400 | Die Simulation war fehlerhaft: Ein Header wurde leer gesendet, `x-rebase-simulate-api-key-id` wurde mit einer Rolle oder Benutzer-ID kombiniert, oder die Simulation wurde mit `x-rebase-impersonate` kombiniert. | Eine Rolle (optional mit UID), eine Benutzer-ID oder eine API-Schlüssel-ID angeben. |
| `SIMULATION_READ_ONLY` | 403 | Ein Schreibvorgang, Löschvorgang, `_batch`, ein Versions-Revert oder eine benutzerdefinierte Funktion, die mit einem anderen Verb als `GET`/`HEAD`/`OPTIONS` aufgerufen wurde, trug einen `x-rebase-simulate-*`-Header. Simulierter Zugriff ist schreibgeschützt: Der Schreibvorgang würde als simulierte Identität ausgeführt, nicht als Administrator. Lesevorgänge, einschließlich `POST …/query` und `…/count`, funktionieren weiterhin. | Simulation beenden, um Änderungen vorzunehmen. |
| `SIMULATION_TARGET_NOT_FOUND` | 404 | Die Simulation benennt keinen aktiven Benutzer (Benutzer-ID ohne Rolle gesendet) oder keinen aktiven API-Schlüssel. | ID überprüfen oder eine Rolle mit der UID senden, um eine UID zu simulieren, die kein Konto hat. |
| `SIMULATION_UNAVAILABLE` | 501 | Dieses Backend kann Zugriffe nicht simulieren: Sein `AuthAdapter` hat kein `resolveUser`, um einen Administrator zu bestätigen, oder es wurde ein Schlüssel auf einem Backend ohne API-Schlüssel angegeben. | `resolveUser` implementieren oder die Header weglassen. |
| `SIMULATION_UNSUPPORTED` | 400 | Ein `x-rebase-simulate-*`-Header wurde an eine Route gesendet, die nicht mit simuliertem Zugriff ausgeführt werden kann. Nur die Daten-API und benutzerdefinierte Funktionen unterstützen dies. | Anfrage ohne die Header senden. |
| `GUEST_REFERENCED` | 409 | Ein Gast konnte nicht gelöscht werden, weil eine eigene Zeile des Projekts ihn über einen Fremdschlüssel mit `ON DELETE RESTRICT` oder `NO ACTION` referenziert. `DELETE /api/admin/guests` meldet dies pro Gast in `skipped` und fährt fort. | Zeile löschen oder den Gast belassen. |
| `INVALID_ACCOUNT` | 400 | Das Konto befindet sich in einem Zustand, auf den diese Operation nicht angewendet werden kann. | Siehe Meldung. |
| `INVALID_CHALLENGE` | 400 | Die MFA-Challenge ist unbekannt oder abgelaufen. | Eine neue starten. |
| `INVALID_CODE` | 400 / 401 | Der OTP- oder MFA-Code ist falsch: 400 beim Login per E-Mail-Code (`/auth/otp/verify`), 401 bei einer MFA-Registrierung oder -Challenge. | Mit dem aktuellen Code wiederholen. |
| `INVALID_CREDENTIALS` | 401 | Falsche E-Mail oder falsches Passwort – bewusst ohne Angabe, was davon zutrifft. | Wiederholen oder Passwort zurücksetzen. |
| `INVALID_PLATFORM_TOKEN` | 401 | Ein `rpt_`-Plattform-Token wurde abgelehnt: ungültige Signatur, falsche Audience, abgelaufen oder Lebensdauer über der Obergrenze. Die Meldung gibt den genauen Grund an. | Von der Plattform ein neues erstellen lassen – in Rebase Cloud den Befehl erneut ausführen. |
| `INVALID_SCOPES` | 400 | Für einen Schlüssel wurde etwas angefordert, das kein Scope ist: fehlerhaft, unbekannt oder mit einem Ziel, das der Scope nicht akzeptiert. `details.problems` nennt Details; `details.validScopes` listet gültige Scopes auf. `keys:read` und `keys:write` sind ausgenommen, da kein Schlüssel sie besitzen darf. | Einen Namen aus der Liste verwenden. Siehe [Rollen und Scopes](/docs/backend/roles-and-scopes/). |
| `INVALID_TOKEN` | 400 / 401 | Ein Verifizierungs-, Reset-, Magic-Link- oder Adressänderungs-Token ist fehlerhaft, unbekannt, aufgebraucht oder abgelaufen (400). OAuth-Provider-Anmeldedaten oder ein Refresh-Token, das nicht verifiziert werden kann, liefert 401. | Neuen Link anfordern oder erneut anmelden. |
| `INVALID_USER_CODE` | 400 | Der als Device-Login-Code gesendete Wert ist ungültig: erwartet werden acht Buchstaben wie `BCDF-GHJK`. | Den auf dem Gerät angezeigten Code kopieren. |
| `INVALID_ROLE` | 400 | Ein geschriebener Rollenname ist kein String, leer oder enthält `,` `{` `}` `"` `\` oder ein Steuerzeichen. Diese Zeichen würden als andere Rollen eingelesen: Eine Rolle wird in einem Postgres-`text[]` und in der durch Kommas getrennten Liste geführt, die RLS-Policies parsen; `"support,admin"` würde als `admin` zurückkommen. `details.problems` benennt die Probleme. | Rolle umbenennen. Jeder andere Name wird akzeptiert. |
| `KEY_MANAGEMENT_SCOPE` | 400 | Ein Schlüssel hat `keys:read` oder `keys:write` angefordert. Kein Schlüssel darf Schlüssel verwalten. `details.scopes` listet sie auf. | Diese weglassen. |
| `KEY_OUTRANKS_CALLER` | 403 | Ein Inhaber von `keys:write` hat versucht, einen Service-Schlüssel zu ändern oder zu widerrufen, der eine Rolle oder einen Scope besitzt, den er selbst nicht hat. Nur ein Admin verwaltet beliebige Schlüssel. `details.roles` und `details.scopes` listen die übersteigenden Rechte auf. | Den Schlüssel durch einen Admin oder jemanden mit diesen Rechten ändern lassen. |
| `LAST_ADMIN` | 403 | Die Änderung würde das Projekt ohne Admin zurücklassen. | Zuerst jemand anderen befördern. |
| `MFA_REQUIRED` | 401 | Das Passwort war korrekt und das Konto hat einen verifizierten zweiten Faktor, daher ist die Anmeldung erst zur Hälfte abgeschlossen. `details` enthält ein kurzlebiges Token für die MFA-Challenge – es ist keine Sitzung. | Eine Challenge öffnen und beantworten; die Challenge-Antwort stellt die Sitzung aus. |
| `NO_SESSION` | 401 | Kein Session-Cookie oder Refresh-Token vorgelegt. Normal beim ersten Laden der Seite. | Anmelden. |
| `NOT_ANONYMOUS` | 400 | Eine Route zum Upgrade von einem anonymen Konto wurde von einem echten Konto aufgerufen, oder `DELETE /api/admin/guests/:uid` hat ein solches benannt. | Nichts zu aktualisieren. Um ein Konto zu löschen, `DELETE /api/admin/users/:uid` verwenden. |
| `OAUTH_ERROR` | 401 | Der OAuth-Provider hat die Anfrage verweigert oder einen Fehler zurückgegeben. | Den Vorgang wiederholen; die Meldung enthält den Grund des Providers. |
| `PERSONAL_KEYS_DISABLED` | 403 | Persönliche API-Schlüssel sind auf diesem Backend deaktiviert. | `personalKeys: true` in den `auth`-Optionen der Auth-Tabelle setzen (`defineAuthTable`). |
| `PERSONAL_KEY_NEEDS_ACCOUNT` | 403 | Der Service-Schlüssel oder eine Gastsitzung hat versucht, die Routen für persönliche Schlüssel zu nutzen. Keines von beiden besitzt ein Konto, als das ein Schlüssel agieren könnte. | An einem Konto anmelden oder einen Service-Schlüssel unter `/api/admin/api-keys` erstellen. |
| `PLATFORM_TOKENS_OFF` | 401 | Ein `rpt_`-Plattform-Token erreichte einen Server, der diese nicht akzeptiert: `REBASE_PLATFORM_TOKEN_KEY` und `REBASE_PLATFORM_TOKEN_AUDIENCE` sind nicht gesetzt. | Die Hosting-Plattform setzt beide beim Deployment; neu deployen oder sich auf andere Weise an der App anmelden. |
| `RATE_LIMITED` | 429 | Zu viele Versuche von diesem Aufrufer. | Warten; die Meldung gibt an, wie lange. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | Das Weiterleitungsziel steht nicht auf der Allowlist. | Zur Konfiguration des Providers hinzufügen. |
| `REGISTRATION_DISABLED` | 403 | Die Self-Service-Registrierung ist deaktiviert. | Das Konto von einem Admin erstellen lassen. |
| `ROLE_EXCEEDS_CALLER` | 403 | Die zugewiesenen Rollen enthalten einen Scope oder `admin`, den der Aufrufer nicht besitzt. `details.beyond` benennt sie. | Die Rolle von jemandem zuweisen lassen, der diese Berechtigungen hat. |
| `ROLE_EXCEEDS_CREATOR` | 403 | Einem Service-Schlüssel wurde eine RLS-Rolle zugewiesen, die sein Ersteller nicht besitzt. Nur ein Admin darf beliebige Rollen vergeben. `details.roles` benennt sie. | Rolle entfernen oder den Schlüssel von einem Admin erstellen lassen. |
| `ROLE_EXISTS` | 409 | Dieser Rollenname ist bereits vergeben. | Einen anderen Namen wählen. |
| `ROLE_LOOKUP_FAILED` | 503 | Die Rollen des Aufrufers konnten nicht gelesen werden – auf einer Admin-Route oder bei einer Datenanfrage auf einem Backend mit `config.auth`. Schlägt sicherheitshalber fehl (fail-closed), anstatt den Rollen im Token zu vertrauen. Ein Token, dessen UID kein Konto benennt, liefert 401, nicht diesen Fehler. Eine nicht erreichbare Datenbank ist `DATABASE_UNAVAILABLE`. | Wiederholen; Datenbank überprüfen. |
| `SCOPE_EXCEEDS_CREATOR` | 403 | Für einen Schlüssel wurde ein Scope angefordert, den sein Ersteller nicht besitzt. Ein Schlüssel hat nie mehr Rechte als das Konto, das ihn erstellt. `details.scopes` listet sie auf. | Diese entfernen oder den Schlüssel von jemandem mit entsprechenden Rechten erstellen lassen. |
| `SCOPE_MISSING` | 403 | Die Anmeldedaten enthalten nicht den Scope, den diese Route, Tabelle, Speicherquelle oder Funktion benötigt. `details.requiredScope` benennt ihn inklusive Ziel. | Für Personen: Eine Rolle mit dem Scope. Für Schlüssel: Ein Schlüssel mit diesem Scope. Siehe [Rollen und Scopes](/docs/backend/roles-and-scopes/). |
| `SCOPE_NOT_DECLARED` | 500 | Eine mit `requireScope` geschützte Route benennt einen App-Scope, den dieses Backend nicht deklariert; niemand besitzt ihn, auch kein Administrator. Ein ungültiger oder falsch geschriebener Name wie `data:raed` kommt gar nicht so weit: `requireScope` wirft beim Registrieren der Route einen Fehler. | Den Scope unter `auth.scopes` in der Auth-Tabelle deklarieren oder den Namen korrigieren. Siehe [Rollen und Scopes](/docs/backend/roles-and-scopes/). |
| `SELF_DELETE` | 400 | Ein Administrator hat versucht, sein eigenes Konto zu löschen. | Von einem anderen Administrator löschen lassen. |
| `SESSION_REVOKED` | 401 | Die Sitzung wurde andernorts abgemeldet, alle Sitzungen wurden widerrufen oder das Konto wurde gelöscht. Gilt für alle Endpunkte: Daten-API, Storage, benutzerdefinierte Funktionen und Admin-Routen. Das Realtime-Socket verweigert `AUTHENTICATE` mit einem `AUTH_ERROR`-Frame mit demselben Code. Das SDK versucht einen Refresh, dieser wird abgelehnt, und es meldet sich ab. | Erneut anmelden. |
| `ACCOUNT_DISABLED` | 401/403 | Ein Administrator hat das Konto deaktiviert: Login (403), Refresh und jedes Token (401) werden an allen Endpunkten abgewiesen. Das Realtime-Socket verweigert `AUTHENTICATE` mit einem `AUTH_ERROR`-Frame mit demselben Code. | An einen Administrator wenden. |
| `EMAIL_NOT_CONFIRMED` | 403 | `requireEmailVerification` ist aktiv und die Adresse noch nicht verifiziert. Wird nur bei korrektem Passwort zurückgegeben; ein neuer Link wird per E-Mail gesendet. | Dem Link in der E-Mail folgen. |
| `PROOF_REQUIRED` | 409 | `POST /auth/verify-email`: Das Konto enthält ein Passwort oder eine Identität, die nicht nachgewiesen wurde, und die Anfrage weist keines davon nach. Das Token wird nicht verbraucht. | `password` mitsenden, um es zu behalten, oder `removeUnproven: true`, um ohne Nachweis zu verifizieren. |
| `UNDELIVERABLE_ADDRESS` | 400 / 409 | Es wurde eine Bestätigungs-E-Mail für eine unzustellbare Adresse angefordert – Gast-Adresse oder Platzhalter von X (400) – oder ein Konto wollte auf eine solche Adresse wechseln (409, `POST /auth/change-email`). | Zuerst eine echte Adresse festlegen. |
| `EMAIL_UNCHANGED` | 400 | `POST /auth/change-email` hat die aktuelle Adresse des Kontos angegeben. | Nichts zu ändern. |
| `ANONYMOUS_USER` | 403 | Ein Gast hat versucht, seine E-Mail-Adresse zu ändern; ein Gast hat keine eigene. | Zuerst in ein Konto umwandeln (`POST /auth/anonymous/link`). |
| `MFA_NOT_ENROLLED` | 400 | Wiederherstellungscodes wurden für ein Konto ohne verifizierten zweiten Faktor angefordert. | Zuerst einen Faktor registrieren. |
| `HOOK_REJECTED` | 400 | Ein `beforeUserCreate`-, `beforeLogin`-, `beforeUserDelete`- oder `beforeEmailChange`-Hook hat einen Fehler geworfen. Die Meldung stammt vom Hook; hat der Hook einen 4xx-Status gewählt, wird dieser geantwortet. | Siehe Meldung. |
| `INVALID_JSON` | 400 | Der Request-Body ist kein gültiges JSON. | Einen gültigen JSON-Body senden. |
| `SELF_DISABLE` | 400 | Ein Administrator hat versucht, sein eigenes Konto zu deaktivieren. | An einen anderen Administrator wenden. |
| `NOT_SUPPORTED` | 501 | Das Auth-Repository dieses Backends unterstützt die angeforderte Aktion nicht (Konten deaktivieren, Adresse ändern). | Server neu starten, damit die Spalte hinzugefügt wird, oder ein kompatibles Repository verwenden. |
| `UNKNOWN_SCOPE_TARGET` | 400 | Das Ziel eines Scopes benennt eine Tabelle, Speicherquelle oder Funktion, die dieses Backend nicht bereitstellt. `details` listet die verfügbaren auf. | Ziel korrigieren. |
| `UNVERIFIED_IDENTITIES` | 409 | Ein Magic Link, E-Mail-Code oder Passwort-Reset hat die Adresse eines unbestätigten Kontos bestätigt, aber das Konto enthält eine Anmelde-Identität, deren Provider diese Adresse nie verifiziert hat. Das Auth-Repository kann sie nicht entfernen (kein `unlinkUserIdentity`), daher wird die Bestätigung verweigert, um keine ungesicherte Zugriffsmöglichkeit auf einem verifizierten Konto zu hinterlassen. | `unlinkUserIdentity` im benutzerdefinierten Auth-Repository implementieren oder das Konto von einem Admin prüfen lassen. |
| `SETUP_REQUIRED` | 403 | Das Projekt hat noch keinen Administrator, daher ist diese Route nicht verfügbar. | Erst-Administrator-Setup abschließen. |
| `TOKEN_ALREADY_USED` | 401 | Ein Einmal-Token wurde wiederverwendet, oder ein Refresh-Token, das vor mehr als `refreshTokenReuseIntervalSeconds` rotiert wurde. | Ein neues anfordern oder erneut anmelden. |
| `TOKEN_EXPIRED` | 401 | Die Gültigkeitsdauer des Tokens ist abgelaufen. | Ein neues anfordern. |
| `USER_NOT_FOUND` | 404 | Kein Konto mit dieser ID vorhanden. | ID überprüfen. |
| `WEAK_PASSWORD` | 400 | Das Passwort entspricht nicht der [Passwortrichtlinie](/docs/backend/auth-endpoints/#password-policy) (standardmäßig mind. 8 Zeichen mit Großbuchstabe, Kleinbuchstabe und Ziffer) – bei Registrierung, Reset, Änderung oder bei vom Admin festgelegten Passwörtern: `POST /api/admin/users`, Erstellung über die Daten-API auf der Auth-Tabelle, `PUT /api/admin/users/:id` oder `POST /api/admin/users/:id/reset-password`. | Ein stärkeres Passwort wählen. Ein Administrator, der Konten importiert, kann beim Erstellen `skipPasswordPolicy: true` übergeben. |

## Daten, Abfragen und Schreibvorgänge

| Code | Status | Bedeutung | Behebung |
| --- | --- | --- | --- |
| `AGGREGATE_MASKED_BY_AFTER_READ` | 400 | Ein Aggregat außer `count()` ohne `groupBy` auf einer Tabelle, die von einem `afterRead`-Hook umgeschrieben wird (global, Tabelle oder `.transform()` einer Spalte). Ein Aggregat liest die gespeicherten Werte und führt den Hook nie aus, daher würde eine Summe, ein Min/Max oder eine Gruppierung Daten lesen, die der Hook verbirgt. | `count()` ohne `groupBy` verwenden oder die Zeilen abrufen, die den Hook durchlaufen. |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Dieser Treiber kann das angeforderte Aggregat nicht berechnen. | Einen Treiber verwenden, der dies unterstützt, oder die Berechnung im Client durchführen. |
| `BRANCHING_UNSUPPORTED` | — | Ein Datenbank-Branch wurde über den Studio-Websocket auf der verwalteten Entwicklungsdatenbank (PGlite) angefordert, bei der ein Branch mit dem Parent *identisch* ist und nichts isoliert würde. Entspricht der Meldung von `rebase db branch`. | `DATABASE_URL` auf ein eigenes Postgres zeigen lassen (`rebase dev --docker` startet eines) und dort branchen. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` enthält mehr Operationen als das Batch-Limit (standardmäßig 1000). Ein Batch ist eine einzige Transaktion und hält Locks über die gesamte Dauer. | In kleineren Chunks senden; die Meldung nennt das Limit und die Anzahl. |
| `BATCH_UNSUPPORTED` | 400 | Der Treiber dieses Backends kann tabellenübergreifend nicht atomar schreiben, und eine Schleife aus Einzelschreibvorgängen wäre weder atomar noch ein einzelner Roundtrip. | Schreibvorgänge als separate Anfragen oder als tabellenspezifische `/bulk`-Aufrufe senden. |
| `BULK_TOO_LARGE` | 400 | Der Bulk-Body überschreitet das konfigurierte Element-Limit. | Anfrage aufteilen. |
| `BULK_UNSUPPORTED` | 400 | Diese Tabelle oder dieser Treiber unterstützt keine Bulk-Schreibvorgänge. | Zeilen einzeln schreiben. |
| `CALLBACK_REJECTED` | 400 / 403 | Ein Tabellen-Hook hat den Schreibvorgang verweigert. Ein `throw` in `beforeSave`/`beforeDelete`/`after*` ist ein 400-Fehler mit der Nachricht des Autors; ein `beforeDelete`, das `false` zurückgibt, ist ein 403. `details.stage` benennt den Hook, `details.path` die Tabelle. | Meldung lesen – sie stammt vom Projekt, nicht von Rebase. |
| `CALLBACK_RECURSION` | 500 | Durch Hooks ausgelöste Schreibvorgänge waren tiefer als 16 Ebenen verschachtelt: Ein `context.data`-Schreibvorgang eines Hooks führt die Hooks dieser Tabelle erneut aus, und nichts bricht die Kette ab – meist ein `afterSave`, das seine eigene Zeile bedingungslos aktualisiert. Der gesamte Schreibvorgang wurde zurückgerollt. Die Meldung nennt Hook und Tabelle; `details.chain` listet jeden Schritt auf. | Schreibvorgang im Hook an Bedingungen knüpfen: Nur bei `status === "new"` ausführen oder überspringen, wenn `values` den Zielwert bereits enthalten. |
| `TABLE_READ_ONLY` | 405 | Ein Schreibvorgang erreichte einen View (`defineView`). Ein View ist schreibgeschützt. Zuvor `COLLECTION_READ_ONLY`. | In die Tabellen schreiben, die der View abfragt. Siehe [Views](/docs/collections/views/). |
| `TABLE_WITHHELD` | 503 | Die Tabelle ist deklariert, aber die Datenbank schützt sie nicht: Row-Level Security ist deaktiviert, keine der deklarierten Policies existiert oder eine deklarierte restriktive Policy fehlt. (Eine fehlende permissive Policy wird mit einer Boot-Warnung toleriert.) Dies passiert, wenn der Server seine Tabellen nicht bereitstellt (`REBASE_PROVISION=false`, `provisionSchema: false`, `provision.tables: false`, `REBASE_MIGRATE_ON_BOOT=none`), und der Server hält die Tabelle zurück, anstatt jede Zeile für jeden Aufrufer offenzulegen. Für Many-to-Many-Verknüpfungstabellen gilt dasselbe: Schlagen sie fehl, werden Tabellen mit entsprechenden Relationen zurückgehalten (die Meldung nennt die Junction); ebenso Tabellen, deren `via` durch eine zurückgehaltene Tabelle führt. Lesezugriffe oder Filter über solche Relationen liefern ebenfalls diesen Code. Andere Tabellen werden normal ausgeliefert. Das Boot-Log nennt die Schutzanweisungen. | Die im Boot-Log genannten SQL-Anweisungen anwenden (`rebase db push` erledigt das), dann neu starten. |
| `SQL_NOT_ALLOWED` | 400 | Als Aufrufer ausgeführtes SQL (`getSql(c)`, `withAuth(user).sql`) war kein einfaches `SELECT`, `WITH`, `VALUES`, `TABLE`, `INSERT`, `UPDATE`, `DELETE` oder `MERGE`, oder es rief `set_config` auf bzw. benannte `pg_settings`. Die Identität des Aufrufers wird in Sitzungseinstellungen verwaltet; Statements, die diese ändern könnten, werden abgewiesen. | Den Abfragetext als einzelnes Statement verfassen und alle Werte über `params` übergeben. Siehe [Benutzerdefinierte Funktionen](/docs/backend/custom-functions/#3-getsqlc--sql-as-the-caller). |
| `CURSOR_WITH_OFFSET` | 400 | `?after=` wurde mit `?offset=` oder `?page=` kombiniert. Ein Cursor definiert bereits den Seitenanfang; ein zusätzlicher Offset würde stillschweigend Zeilen hinter dem Cursor überspringen – eine Lücke, die der Aufrufer in der Antwort nicht bemerkt. | Entweder das eine oder das andere verwenden. |
| `DISTINCT_NOT_APPLICABLE` | 400 | `?distinct=true` wurde mit einer Such- oder Vektorabfrage kombiniert. Beide weisen einen zeilenbezogenen Score zu, wodurch nie zwei Zeilen identisch sind und `DISTINCT` keine Zeilen zusammenfassen würde. | Eines von beiden weglassen. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Eine `distinct`-Abfrage wird nach einer Spalte sortiert, die nicht zurückgegeben wird. Ein `SELECT DISTINCT` kann nur nach Spalten in der Select-Liste sortiert werden, da die zusammengefassten Zeilen sonst keine definierte Reihenfolge haben. `details.fields` listet sie auf. | Diese Felder zu `?fields=` hinzufügen oder aus `?orderBy=` entfernen. |
| `DATABASE_UNAVAILABLE` | 503 | Die Datenbank konnte nicht erreicht werden: Verbindung verweigert oder abgebrochen, Hostname nicht aufgelöst, Server startet/stoppt gerade oder Datenbank akzeptiert keine Verbindungen (`ALLOW_CONNECTIONS false`, was ein abgebrochenes `rebase db branch create --force` hinterlässt; das Server-Log nennt die Datenbank, und `rebase db branch list` öffnet sie wieder). Jeder Endpunkt antwortet damit (inkl. Login, Admin-Routen und Realtime-Socket via `ERROR`-Frame). Wird mit `Retry-After: 5` gesendet. | Wiederholen; das SDK tut dies automatisch. Prüfen, ob die Datenbank läuft und vom Server erreichbar ist. |
| `DB_CONNECTIONS_EXHAUSTED` | 503 | Der Datenbankserver hat eine neue Verbindung abgelehnt, da keine mehr frei sind (`53300` zu viele Clients, `53400` Verbindungslimit einer Rolle oder Datenbank erreicht). Alle Serverinstanzen teilen sich das `max_connections` des Servers; dies tritt typischerweise bei mehreren Instanzen mit großen Pools ohne Pooler auf. Lastbedingt, kein Fehler; gesendet mit `Retry-After: 2`. Der Server loggt Lösungsschritte einmal pro Minute. | Wiederholen; das SDK tut dies automatisch. `DB_POOL_MAX` (oder über `REBASE_DB_POOL_MAX`) instanzübergreifend senken, einen Pooler vor die Datenbank schalten (`DATABASE_POOLED`) oder `max_connections` erhöhen. |
| `DB_CONNECT_TIMEOUT` | 503 | Das Öffnen einer neuen Verbindung dauerte länger als `DB_POOL_CONNECT_TIMEOUT`: Die Datenbank antwortet zu langsam oder ist zu weit entfernt. Gesendet mit `Retry-After`. | Wiederholen; das SDK tut dies automatisch. Datenbankauslastung und Netzwerk prüfen. |
| `DB_PERMISSION_DENIED` | 500 | Postgres hat das Statement abgewiesen (`42501`): Entweder verweigert eine RLS-Policy dieser Rolle den Zugriff oder es fehlt ein `GRANT`. | Siehe [Fehlerbehebung](/docs/troubleshooting/). |
| `DB_POOL_EXHAUSTED` | 503 | Alle gepoolten Datenbankverbindungen waren über die Dauer von `DB_POOL_CONNECT_TIMEOUT` ausgelastet; die Anfrage erreichte die Datenbank nie. Lastbedingt, kein Fehler; gesendet mit `Retry-After`. Der Server loggt Lösungsschritte einmal pro Minute. | Wiederholen; das SDK tut dies automatisch. `DB_POOL_MAX` erhöhen oder langsame Abfragen/Transaktionen optimieren. |
| `FIELD_NOT_READABLE` | 400 | Ein Filter, `orderBy`, `fields`, Aggregat-`select` oder `groupBy` benennt ein Feld, das die Rollen dieses Aufrufers nicht lesen dürfen (`access.read`), ein verschachtelter Pfad oder ein Aggregat-Sort benennt eine nicht lesbare Relation – oder eine Feldoperation (`$inc`, `$push`, …) zielt darauf ab, wobei ein abgewiesenes Limit den gespeicherten Wert offenbaren würde. Ein Feld, das keine Antwort enthalten darf, darf von keiner Abfrage geprüft werden können. Filter über Relationen (`author.salary`) und Aggregat-Sortierungen über Relationsfelder (`max(staff.salary)`) unterliegen den Regeln des Ziels. `details.violations` nennt die Felder. Dies gilt auch für In-Process-Abfragen (`context.data` im Scope des Aufrufers) sowie Vektorsuche, Include- oder Eindeutigkeitsprüfungen. Eine `.private()`-Spalte verhält sich so, als existiere sie nicht: Abfragen darauf erhalten exakt dieselbe Antwort wie bei einem Tippfehler (`UNKNOWN_FILTER_FIELD`, `UNKNOWN_ORDER_BY_FIELD`, `UNKNOWN_FIELD`, `UNKNOWN_RELATION`, `UNKNOWN_AGGREGATE_FIELD` oder `UNKNOWN_VECTOR_PROPERTY`), und keine Unbekannt-Meldung listet sie auf. | Feld aus der Abfrage entfernen oder entsprechende Rolle anfordern. Siehe [Feldzugriff](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 / 403 | Der Body setzt ein Feld, das die Rollen des Aufrufers nicht schreiben dürfen (`access.write`). Wird abgewiesen statt ignoriert: Das Verwerfen eines Felds würde fälschlicherweise Erfolg für eine unvollständige Bearbeitung melden. Gilt auch für Schreibvorgänge über ein übergeordnetes Objekt, die eine nicht beschreibbare Relation setzen, sowie Updates, die ein `softDelete`-Feld auf einen Wert setzen – nur ein Delete darf dieses setzen. Das Realtime-Socket antwortet bei Pfaden, deren übergeordnete Tabelle, Relation oder Zieltabelle dort nicht bereitgestellt wird, mit 403 und diesem Code. `details.violations` listet die Felder auf. | Feld entfernen oder Rolle anfordern. Ein für niemanden beschreibbares Feld liefert stattdessen `VALIDATION_EXCLUDED_FIELDS`. |
| `FILTERED_USER_WRITE` | 400 | Ein gefiltertes Update oder Delete wurde über HTTP an die Auth-Tabelle gesendet, deren Schreibvorgänge vor der Ausführung Benutzer für Benutzer geprüft werden. | Benutzer abrufen und anschließend per `updateMany`/`deleteMany` anhand der ID aktualisieren/löschen. |
| `FILTER_REQUIRED` | 400 | Ein gefilterter Schreibvorgang (Update/Delete über `where`/`logical` via SDK oder Bulk-Routen) enthält keine Bedingung und würde daher alle Zeilen betreffen. Wird vor der Ausführung abgewiesen. | Bedingung hinzufügen. Um absichtlich alle Zeilen zu ändern, eine Bedingung angeben, die auf alle Zeilen zutrifft. |
| `HISTORY_UNAVAILABLE` | 503 | Ein Schreibvorgang auf eine Tabelle mit `history: true` wurde abgewiesen, da der Verlaufseintrag nicht gespeichert werden konnte: Der Datenbank fehlt die Tabelle `rebase.entity_history` oder (für `openRebase` und `rebase console`) die Funktion `rebase.record_history`. Auf dieser Datenbank wurde kein Backend mit aktiviertem Verlauf gebootet. Es wurde nichts ausgeführt (auch keine Hooks), Lesevorgänge sind nicht betroffen. Wird von `openRebase` geworfen und von Backends mit `provision: false` zurückgegeben. | Backend einmalig mit aktivem Verlauf und `provision: true` booten (`rebase dev` tut dies), dann wiederholen. |
| `HISTORY_UNSERVABLE` | 501 | Der Datentreiber der Tabelle kann die Leseregeln und `afterRead`-Hooks nicht auf gespeicherten Zeilen ausführen (`DataDriver.serveStoredRows`), und Historien werden niemals unmaskiert ausgeliefert. Der mitgelieferte Postgres-Treiber unterstützt dies. | `serveStoredRows` im benutzerdefinierten Treiber implementieren. Siehe [Verlauf](/docs/backend/history/). |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Eine frühere Anfrage mit demselben `Idempotency-Key` wird noch verarbeitet. | Nach Abschluss der ersten Anfrage wiederholen. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | Derselbe `Idempotency-Key` wurde für eine andere Anfrage verwendet: abweichende Methode, Pfad, Query-String oder Body. | Neuen Schlüssel verwenden oder die Originalanfrage unverändert senden. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` benennt eine Funktion, die keine Aggregatfunktion ist (`count`, `sum`, `avg`, `min`, `max`, `countDistinct`, `mode`, `percentile`, `distinct`, `fingerprint`). | Eine der gültigen Funktionen verwenden; die Meldung listet sie auf. |
| `INVALID_AGGREGATE_GROUP` | 400 | Eine `groupBy`-Transformation ist unbekannt oder passt nicht zur Spalte: z. B. `year`/`month`/`day` auf einer Spalte, die kein Datum ist, oder `unnest` auf einer Spalte, die kein Array ist. | `lower`, `upper`, `year`, `month`, `day` oder `unnest` auf einer Spalte des passenden Typs verwenden. |
| `INVALID_AGGREGATE_SELECT` | 400 | Ein Eintrag in `?select=` entspricht nicht dem Format `fn(field)`; einer Funktion außer `count()` oder `fingerprint()` wurde kein Feld übergeben; `percentile` hat keinen Wert zwischen 0 und 1; oder `fingerprint()` wurde auf einem einfachen View aufgerufen, der keine Zeilen speichert. | Format anpassen: z. B. `sum(total)`, `count()`, `percentile(price,0.95)`. |
| `INVALID_AGGREGATE_WINDOW` | 400 | `offset`, `page` oder `orderBy` bei einem Aggregat ohne `groupBy`, oder ein Cursor auf einem beliebigen Aggregat. Ein ungruppiertes Aggregat ist genau eine Zeile, und eine Gruppe ist keine Zeile, hinter der ein Cursor fortsetzen könnte. | `groupBy` hinzufügen oder Parameter weglassen; Gruppen über `offset` oder `page` paginieren. Siehe [Aggregate](/docs/sdk/aggregates-and-search/#aggregates). |
| `INVALID_BATCH_BODY` | 400 | Einer `/_batch`-Operation fehlt `op`, `table`, `values` oder `id`, sie nennt eine unbekannte Tabelle oder verwendet einen `ref`-Namen mehrfach. | Siehe Meldung; nennt die fehlerhafte Operation nach Index. |
| `INVALID_BATCH_REF` | 400 | Ein `{ "$ref": "<name>.<field>" }` verweist auf keine frühere Operation, zeigt nach vorne oder fragt ein nicht existentes Feld ab. Nur Rückwärtsreferenzen sind zulässig. | Operation mit `ref` definieren, *bevor* darauf referenziert wird. |
| `INVALID_BULK_BODY` | 400 | Der Bulk-Body entspricht nicht dem erwarteten Format. | Das von der Route erwartete Array senden: `{ "rows": [...] }` an `POST /bulk`, `{ "updates": [{ "id", "data" }] }` an `PATCH /bulk`, `{ "ids": [...] }` an `POST /bulk/delete`. |
| `INVALID_CONFLICT_RULE` | 400 | Die Konfliktregel eines Upserts (Duplikate behalten oder nur bei `where` ersetzen) wurde ohne `upsert: true` übergeben, oder beide Regeln wurden kombiniert. | `upsert: true` und genau eine der beiden Regeln übergeben. |
| `INVALID_CONFLICT_TARGET` | 400 | Das `on_conflict` / `onConflict` eines Upserts benennt Spalten ohne Eindeutigkeitsgarantie, wurde ohne `upsert: true` gesendet oder bei einem verschachtelten Erstellvorgang verwendet (wo eine gematchte Zeile unter den neuen Parent verschoben würde). Postgres würde sonst innerhalb der Transaktion mit 42P10 fehlschlagen. Gilt auch für Upserts auf der Auth-Tabelle, da Create und Update dort unterschiedlichen Regeln folgen. | `.unique()` auf der Spalte oder einen Unique-Index deklarieren; die Meldung listet gültige Ziele auf. Auf der Users-Tabelle `POST` zum Erstellen und `PATCH` zum Aktualisieren nutzen. |
| `INVALID_COUNT` | 400 | `?count=` ist weder `exact` noch `none`. Wird abgewiesen statt standardisiert: Ein Tippfehler wie `?count=nnone` würde sonst die Zählung ausführen, die eigentlich übersprungen werden sollte. | `exact` (Standard) oder `none` übergeben. Siehe [Zählung überspringen](/docs/backend/api/#skipping-the-count). |
| `INVALID_CURSOR` | 400 | Der `after`-Cursor kann nicht gelesen werden oder benennt eine Zeilen-ID, die nicht zu den Schlüsselsspalten passt (abgeschnitten, falsch kodiert oder manuell erstellt). Ein lesbarer Cursor mit einem abweichenden `orderBy` liefert `CURSOR_ORDER_MISMATCH` (ebenfalls 400). | `meta.nextCursor` der vorherigen Seite unverändert mit demselben oder ohne `orderBy` übergeben. Siehe [Paginierung](/docs/sdk/pagination/). |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` ist weder `include` noch `only`. Wird abgewiesen statt ignoriert: Ein Tippfehler wie `?deleted=true` würde sonst gelöschte Zeilen fälschlicherweise verbergen. | `include` (aktive und gelöschte) oder `only` (nur gelöschte) übergeben. Für ausschließlich aktive Zeilen weglassen. |
| `INVALID_DISTINCT` | 400 | `?distinct=` ist nicht `true` oder `false`. | `true` oder `false` übergeben; `1` und `0` werden ebenfalls akzeptiert. |
| `INVALID_FIELD_OPERATION` | 400 | Ein Operator wie `$inc` / `$push` / `$pull` / `$merge` wurde auf einem inkompatiblen Spaltentyp verwendet, mit falschem Operandenformat, mehrfach auf einem Feld, falsch geschrieben oder bei einem Erstellvorgang aufgerufen (wo kein gespeicherter Wert existiert). | Siehe [Schreiben über REST](/docs/backend/writes/#field-operations); die Meldung nennt das Feld. |
| `INVALID_FILTERED_WRITE` | 400 | Ein gefilterter Schreibvorgang zielte auf einen Pfad über eine Relation (`posts/1/comments`) oder auf gar keine Tabelle. | In die verknüpfte Tabelle schreiben, mit einem Filter auf deren Verknüpfung. |
| `INVALID_FILTER_FIELD` | 400 | Der Filter benennt eine Spalte, die in der Tabelle nicht existiert. | Schreibweise anhand der Tabelle überprüfen. |
| `INVALID_FILTER_OPERATOR` | 400 | Der Operator wird von diesem Spaltentyp nicht unterstützt – z. B. `like` auf Zahlen oder Datumsangaben. | Siehe [Daten abfragen](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | Ein Filterwert kann nicht in den Typ der Zielspalte konvertiert werden: `?id=eq.abc` bei Integer-Schlüsseln, ungültiger Enum-Wert, ungültiger Timestamp, Zahl außerhalb des Wertebereichs. `details.dbCode` enthält den SQLSTATE. | Einen typkonformen Wert senden. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` ist nicht `true` oder `false`. Jeder andere Wert wird abgewiesen, um versehentliches Soft-Deleting bei beabsichtigtem permanentem Löschen zu verhindern. | `true` oder `false` übergeben. |
| `INVALID_INCLUDE` | 400 | `?include=` ist fehlerhaft: keine gültige Pfadliste oder ungültiges Optionsobjekt pro Relation. Pfade mit mehr als 3 Hops liefern `INCLUDE_TOO_DEEP` (ebenfalls 400). Wird an der Schnittstelle abgefangen, statt als 500er-Fehler aus dem Treiber zu entkommen. | Siehe Meldung; nennt den fehlerhaften Pfad. |
| `INVALID_INPUT` | 400 | Der Body hat die Validierung nicht bestanden. | Siehe Meldung. |
| `INVALID_LIMIT` | 400 | `?limit=` ist keine Ganzzahl zwischen 1 und dem Maximum (standardmäßig 1000); größere Werte werden abgewiesen, nicht gedeckelt. Realtime-Subscriptions mit Werten außerhalb dieses Bereichs erhalten denselben Code im WebSocket-`ERROR`-Frame. | Limit reduzieren und restliche Daten paginieren. |
| `INVALID_LOGICAL_GROUP` | 400 | Eine `?or=` / `?and=` / `?not=`-Gruppe ist fehlerhaft aufgebaut oder zu tief verschachtelt. | Siehe Meldung; erläutert die Flattening-Regeln. |
| `INVALID_OFFSET` | 400 | `?offset=` ist keine Ganzzahl größer oder gleich 0. | Eine nicht-negative Ganzzahl übergeben. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` entspricht nicht dem Format `field`, `field:desc`, `field:desc:last` oder einem JSON-Array aus `{ field, direction, nulls }` – oder gibt eine andere Richtung als `asc`/`desc` bzw. NULL-Platzierung als `first`/`last` an. | Siehe Meldung; zeigt alle zulässigen Formate. |
| `INVALID_PAGE` | 400 | `?page=` ist keine Ganzzahl größer oder gleich 1. Seitenzahlen beginnen bei 1; `?page=0` ist ein Fehler. | `1` oder höher übergeben oder `?offset=` nutzen. |
| `INVALID_PARAM` | 400 | Ein Query-Parameter ist fehlerhaft. | Siehe Meldung. |
| `INVALID_QUERY_BODY` | 400 | Der Body von `POST …/query` enthält Werte, die über die URL nicht zulässig wären: Listen für Einmal-Parameter (`fields`, `limit`, …), Objekte für Filter, oder Parameter wurden sowohl in der URL als auch im Body übergeben (ein `POST …/query` liest alle Parameter ausschließlich aus dem Body). | Werte wie in der URL formatieren – String oder Liste für wiederholte Filter; `where`, `include`, `orderBy` und `vector` erwarten JSON. Siehe [Abfragen, die zu lang für eine URL sind](/docs/backend/vector-search/#queries-too-long-for-a-url). |
| `INVALID_VECTOR` | 400 | `?vector=` ist kein JSON-Array aus Zahlen. | Z. B. `[0.1,0.2,0.3]` übergeben. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` ist weder `cosine`, `l2` noch `inner_product`. | Einen dieser drei Werte verwenden. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` ist keine Zahl. | Eine Zahl übergeben. |
| `INVALID_WHERE` | 400 | `?where=` ist kein JSON-Objekt, das Felder auf Bedingungen mappt. | Z. B. `{"status":["==","active"]}` senden. |
| `KEY_IMMUTABLE` | 400 | Ein Update weist dem Primärschlüssel der Zeile einen anderen Wert zu als jenen, über den sie adressiert wird (im Body oder durch ein `beforeSave`). Zeilen können nicht auf einen neuen Schlüssel verschoben werden, da alle nachfolgenden Schritte (Rücklesen, `afterSave`, Verlauf, Realtime) die Zeile über ihren bisherigen Schlüssel ansprechen. Wird vor Ausführung jeglicher Hooks abgewiesen; es wird nichts geschrieben. `details.violations` nennt das Feld. | Zeile unter dem neuen Schlüssel neu anlegen und alte löschen. Den identischen Schlüssel mitzusenden ist erlaubt. |
| `MISSING_AGGREGATE_SELECT` | 400 | Die Aggregat-Route wurde ohne `?select=` aufgerufen. | Parameter ergänzen, z. B. `?select=count()`. |
| `NOT_A_MATERIALIZED_VIEW` | 400 | `refresh()` wurde auf einer Tabelle aufgerufen, die kein Materialized View ist. | Nur auf Views anwenden, die mit `defineView(…, { materialized: true })` definiert wurden. |
| `NO_TABLES` | 404 | Das Projekt stellt keine Tabellen bereit: Weder in `backend/schema` deklariert noch in der Datenbank vorhanden. Existieren Tabellen, auf denen RLS deaktiviert ist, nennt die Meldung diese samt SQL zur Aktivierung; `details.unprotectedTables` listet sie auf. Zuvor `NO_COLLECTIONS`. | Tabellen erstellen – per Migration, SQL oder via `defineTable`-Datei plus `rebase db push` – und neu starten. |
| `NOT_FOUND` | 404 | Keine Zeile mit dieser ID in der Tabelle vorhanden – oder sie wird durch Row-Level Security vor diesem Aufrufer verborgen. | ID und RLS-Regeln der Tabelle prüfen. |
| `UNKNOWN_RELATION` | 400 / 404 | `?include=` benennt eine Relation, die auf der Tabelle nicht existiert. Derselbe Code liefert **404**, wenn stattdessen ein verschachtelter *URL-Pfad* eine solche benennt (z. B. `/api/data/authors/1/posts`, wenn `authors` keine solche Relation hat) – hier referenziert die URL ein nicht existentes Ziel. | Relationsnamen prüfen – die Meldung listet vorhandene auf. Rückreferenzen müssen auf dem Parent deklariert sein, um navigierbar zu sein. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | Die Sortierung benennt ein Feld, nach dem nicht sortiert werden kann. | Nach einer regulären Spalte sortieren. |
| `PAGE_WITH_OFFSET` | 400 | `?page=` wurde mit `?offset=` kombiniert – oder `page` mit `offset` in einem `find()`, was Client-SDK, In-Process-`rebase.data` und Offline-Client bereits vor Absenden der Anfrage mit diesem Code abweisen. Beide beschreiben denselben Ausschnitt; früher überschrieb `page` stillschweigend `offset`. | Nur einen der beiden Parameter übergeben. |
| `PAYLOAD_TOO_LARGE` | 413 | Der Body überschreitet das konfigurierte Limit. | Payload verkleinern oder Limit anheben. |
| `READ_ONLY_TRANSACTION` | 409 | Ein `afterRead`-Hook hat versucht zu schreiben. Ein anfragebezogener Lesevorgang läuft in einer `READ ONLY`-Transaktion, daher darf weder der Hook noch von ihm aufgerufener Code schreiben. | Schreibvorgang auslagern: Background-Job oder `rebase.dataAsAdmin` über Cron-Job bzw. benutzerdefinierte Funktion. |
| `REFRESH_NOT_SUPPORTED` | 501 | `POST /api/data/<slug>/refresh` erreichte einen Datentreiber ohne Materialized Views. | Keine Views zum Aktualisieren auf diesem Backend vorhanden. |
| `RELATION_HAS_NO_PIVOT` | 400 | Der Schreibvorgang enthielt Link-Daten (Payload), der Pfad erreicht sein Ziel jedoch nicht über eine `manyToMany`-Relation mit deklariertem `pivot` – es existiert somit keine Zwischentabelle für diese Daten. | `pivot`-Spalten auf der Relation definieren oder Payload weglassen. Siehe [Relationen](/docs/collections/relations/). |
| `RELATION_MISCONFIGURED` | 500 | Eine Relation kann im registrierten Schema nicht aufgelöst werden. Die Operation wird verweigert statt übersprungen, um Scheinerfolge oder fälschlicherweise leere Resultate zu verhindern. | `rebase schema generate` ausführen, falls das generierte Schema älter als die Datenbank ist. |
| `RELATION_NOT_UNLINKABLE` | 400 | Die Relation kann von dieser Seite aus nicht getrennt werden. | Vorgang von der besitzenden Seite aus durchführen. |
| `RELATION_NOT_WRITABLE` | 400 | Der Pfad ist keine beschreibbare Relation, oder Create/Update benennt eine Multi-Hop-`via`-Relation – nur Single-Hop-`via`-Relationen sind beschreibbar. `details.fields` listet die `via`-Schlüssel auf. Es wurde nichts geschrieben. | Die von der Kette verknüpften Zeilen direkt beschreiben. Siehe [Relationen](/docs/collections/relations/#via--an-explicit-join-chain). |
| `RELATION_PIVOT_UNSUPPORTED` | 400 | Die Relation deklariert Pivot-Spalten, diese Datenquelle kann sie jedoch nicht beschreiben. | Die Verknüpfung selbst funktioniert; lediglich die Nutzdaten darauf nicht. Treiberfunktionen prüfen. |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | Einem Relations-Schreibvorgang fehlte der Quellschlüssel zur Verknüpfung. | Übergeordnete Zeile zuerst speichern. |
| `RESULT_TOO_LARGE` | — | Ein über den Realtime-Socket ausgeführter `EXECUTE_SQL`-Befehl (`admin.executeSql` eines Clients, Katalogabfragen des Admin-Panels) ergab mehr als 128 MB an Daten; es wurde nichts übertragen. Wird als WebSocket-`ERROR`-Frame übermittelt. Ausführungen der SQL-Konsole sind hiervon ausgenommen: Sie zeigen die ersten Zeilen. | `LIMIT` ergänzen, weniger Spalten wählen und Resultate schrittweise abrufen. |
| `ROW_IN_TRASH` | 409 | Der Schlüssel eines Upserts gehört zu einer Zeile im Papierkorb (soft-gelöschte Zeilen behalten ihren Schlüssel). Ein Upsert überschreibt an keinem Endpunkt gelöschte Zeilen (REST `?on_conflict=`, `/bulk`, `/_batch`, SDK und Realtime-Socket). Es wurde nichts geschrieben. | Zeile zuerst wiederherstellen (Update setzt Soft-Delete-Feld auf `null`) oder mit `?hard=true` endgültig löschen und Upsert wiederholen. Siehe [Soft Delete](/docs/collections/soft-delete/). |
| `SCHEMA_DRIFT` | 500 | Eine vom Code erwartete Tabelle oder Spalte existiert nicht in der Datenbank. | In der Entwicklung `rebase db push` ausführen; auf Managed Tenants neu deployen. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | `startAfter` wurde mit `orderBy: "_score"` kombiniert. Relevanz wird pro Abfrage berechnet und nicht gespeichert; sie eignet sich nicht als Cursor-Schlüssel. | Relevanzbasierte Ergebnisse mit `limit`/`offset` paginieren oder nach einer Spalte sortieren. |
| `SQL_ERROR` | 400 | Die Datenbank hat vom Benutzer geschriebenes SQL abgelehnt. Über das Realtime-Socket (`EXECUTE_SQL`) als `ERROR`-Frame mit Datenbank-Fehlermeldung. `POST /api/admin/sql/csv` antwortet damit vor dem Senden der Datei: Syntaxfehler, Schreibvorgang (Download ist schreibgeschützt), mehr als ein Statement oder unzulässige Rolle. | SQL korrigieren. Ein Download akzeptiert genau ein `SELECT`, `WITH … SELECT`, `TABLE` oder `VALUES`. |
| `VIEW_NOT_READABLE` | 403 | Ein Aufrufer, der keine der in `view.roles` definierten Rollen besitzt, hat einen Materialized View gelesen oder dessen Aktualisierung angefordert. Materialized Views unterstützen keine RLS, werden vollständig ausgeliefert und sind ausschließlich diesen Rollen vorbehalten. | Mit einer der Rollen abfragen oder die Rolle des Aufrufers in `view.roles` aufnehmen. |
| `TENANT_IMMUTABLE` | 400 | Ein Schreibvorgang würde eine Zeile zu einem anderen Mandanten (Tenant) verschieben. Zeilen können den Tenant nicht wechseln. `details.violations` nennt das Feld. Ein Trigger setzt diese Regel auch in der DB durch; direkt ausgeführtes SQL scheitert mit Postgres-Fehler `42501` und Präfix `TENANT_IMMUTABLE`. | Zeile im neuen Tenant anlegen und im alten löschen, oder mit einer Rolle aus `tenant.bypassRoles` schreiben. |
| `TENANT_MISMATCH` | 400 | Der Schreibvorgang benennt einen Tenant, zu dem der Aufrufer nicht gehört; die Datenbank würde dies ebenfalls verweigern. | In den Tenant schreiben, dem der Aufrufer angehört, oder als passender Benutzer authentifizieren. |
| `TENANT_REQUIRED` | 400 | Die Tabelle ist mandantenabhängig und der Tenant kann nicht abgeleitet werden: Die Anfrage enthält keinen oder der Aufrufer gehört mehreren an. | Tenant-Feld explizit mitsenden oder als Aufrufer authentifizieren, der genau einem Tenant angehört. |
| `TRANSACTION_ABORTED` | 500 | Ein Statement in der Transaktion schlug fehl und ein Hook fing den Fehler ab. Postgres hatte die Transaktion bereits abgebrochen; der Vorgang wurde zurückgerollt und nichts gespeichert. Nur abgewiesene `context.data`-Creates, -Updates oder -Deletes werden isoliert zurückgerollt und können sicher abgefangen werden. | Den Fehler werfen lassen oder Vorbedingungen vor Ausführung prüfen. Siehe [Transaktionssemantik](/docs/collections/context-data-api/#transaction-semantics). |
| `UNKNOWN_FIELD` | 400 | `?fields=` benennt ein Feld, das die Tabelle nicht besitzt. | Schreibweise prüfen; die Meldung listet gültige Felder auf. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Ein Aggregat oder `groupBy` benennt ein nicht existentes Feld. | Schreibweise prüfen; die Meldung listet gültige Felder auf. |
| `UNKNOWN_FILTER_FIELD` | 400 | Der Filter benennt ein Feld, das diese Tabelle (oder das Relationsziel) nicht hat, oder eine `.private()`-Spalte. | Schreibweise prüfen; die Meldung listet gültige Felder auf. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | Der Filter verwendet einen unbekannten Operator. | Die Meldung listet alle gültigen Operatoren auf. |
| `UNKNOWN_MESSAGE_TYPE` | 400 | Ein Frame des Realtime-Sockets hat einen `type`, den der Server nicht unterstützt. Wird als `ERROR`-Frame mit der `requestId` beantwortet, damit Anfragen beendet werden statt ins Timeout zu laufen. | Frame-`type` prüfen; die Meldung nennt den Typ. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | Die Sortierung benennt ein Feld, das die Tabelle nicht besitzt. | Schreibweise prüfen; die Meldung listet gültige Felder auf. |
| `PRECONDITION_FAILED` | 412 | `If-Match` benannte eine Zeilenversion, die nicht mehr aktuell ist: Zwischen Lese- und Schreibvorgang fand eine Änderung statt. Es wurde nichts geschrieben. | Zeile neu abrufen, Änderungen erneut anwenden und mit neuem `ETag` senden. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` fordert ein nicht existentes Feld an. | Schreibweise prüfen; die Meldung listet bekannte Felder auf. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Eine Vektorsuche benannte eine Spalte, die kein `col.vector()` dieser Tabelle ist. | Die Meldung listet alle Vektorspalten der Tabelle auf. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Der `Content-Type` wird von dieser Route nicht unterstützt. | Den dokumentierten Medientyp verwenden. |
| `UNSUPPORTED_OPTION` | — | Wird geworfen, nicht als Response gesendet: Ein Schreibvorgang über In-Process-Zugriffe (`context.data` im Hook, `rebase.data` in Funktionen/Crons) enthielt `ifMatch` oder `idempotencyKey`. Diese Schnittstelle besitzt keine Vorbedingungsprüfung oder Idempotenzspeicher; die Option wird vor dem Schreiben abgewiesen statt ignoriert. | Option weglassen oder über den HTTP-Client schreiben, der beides unterstützt. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | Der Filter kreuzt eine `via`-Relation, deren Join-Pfad unidirektional definiert ist, weshalb keine Subquery-Korrelation möglich ist. | Von der besitzenden Seite aus filtern. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | Der Operator ist für dieses Feld nicht definiert: Relationen ohne eigene Spalte auf der Zeile werden über Enthaltensein gefiltert; Musterabgleiche (`like`, `ilike` etc.) sind rein für Textfelder. | Siehe Meldung; zeigt an, was das Feld akzeptiert. |
| `VALIDATION_CONSTRAINT` | 400 | Ein Wert verletzt Spaltenregeln (`.validate()`, `.notNull()`, `.oneOf()`) – Länge, Wertebereich, Muster, Pflichtfeld oder unzulässiger Enum-Wert. Jeder Eintrag in `details.violations` enthält einen `code`: `required`, `min_length`, `max_length`, `length`, `min`, `max`, `less_than`, `more_than`, `positive`, `negative`, `integer`, `pattern`, `email`, `url`, `enum`, `min_items`, `max_items`, `unique_items` (doppelte Array-Elemente, inkl. `$push`), `unique_by` (doppelte Werte im Feld `uniqueBy` innerhalb eines JSON-Arrays), `date_min`, `date_max`, `geopoint_range`. | Siehe Meldung; nennt Tabelle, Spalte und Verletzung. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | Der Body schreibt in eine als `.private()` oder `.access({ write: [] })` markierte Spalte (zwei Schreibweisen für dieselbe Regel). Diese sind serverseitig reserviert: z. B. Passwort-Hashes oder Tokens. Gilt im Gegensatz zu `FIELD_NOT_WRITABLE` ausnahmslos für alle Aufrufer inklusive `admin`. | Feld entfernen. Siehe [Feldzugriff](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | Ein Wert passt nicht zum Datentyp der Spalte. | Siehe Meldung; nennt die Spalte. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | Der Body benennt Spalten, die die Tabelle nicht hat – einschließlich eines `id`-Arguments bei Tabellen mit abweichendem Primärschlüssel. | Schreibweise prüfen; die Meldung nennt Tabelle und vorhandene Spalten. |
| `VECTOR_CURSOR_UNSUPPORTED` | 400 | Ein Cursor (`after` / `startAfter`) wurde mit einer Vektorsuche kombiniert. Zeilen werden nach dynamischer Distanz sortiert, die nicht als Cursor-Schlüssel dienen kann; Vektorabfragen liefern daher kein `nextCursor`. | Ähnlichste Zeilen mittels `limit`/`offset` paginieren. |
| `WRITE_DENIED` | 403 | Eine Sicherheitsregel oder RLS-Policy hat den Schreibvorgang abgewiesen. | `rls`-Regeln der Tabelle überprüfen. |

## `PG_<SQLSTATE>` — Vom Datenbanksystem abgewiesene Constraints

Schlägt ein Schreibvorgang in Postgres aufgrund der *übergebenen Daten des Aufrufers* fehl,
wird der SQLSTATE direkt im Code zurückgegeben: `PG_23505`, `PG_23503` usw. Dies ist eine
ganze Familie von Codes. Es werden jedoch nur zwei Klassen an den Client weitergegeben,
da nur diese auf Fehler des Aufrufers zurückzuführen sind:

- **Klasse 23**, Integritätsverletzung (Integrity Constraint Violation): Duplikate, Verweise auf nicht existierende Fremdschlüssel, leere NOT-NULL-Spalten;
- **Klasse 22**, Daten-Ausnahme (Data Exception): Ein Wert, der den Wertebereich des Spaltentyps übersteigt.

Alles andere – Verbindungsabbrüche, fehlende Spalten, Rechteprobleme –
liegt in der Verantwortung des Servers und bleibt ein `500`. Die Prüfung `code.startsWith("PG_")` ist daher ein
zuverlässiger Indikator für "Die gesendete Zeile war fehlerhaft". Die vier folgenden Codes
treten in der Praxis am häufigsten auf. `details.dbCode` enthält bei allen denselben SQLSTATE, und
die Nachricht nennt den verletzten Constraint.

| Code | Status | Bedeutung | Behebung |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | Ein Wert konnte nicht in den Spaltentyp konvertiert werden – das schreibende Gegenstück zu `INVALID_FILTER_VALUE`. | Einen typkonformen Wert senden. |
| `PG_23502` | 400 | Eine `NOT NULL`-Spalte wurde nicht befüllt. | Das Feld mitsenden oder einen Standardwert für die Spalte definieren. |
| `PG_23503` | 400 / 409 | Beim Speichern: Ein Fremdschlüssel verweist auf eine nicht existente Zeile (400). Beim Löschen: Andere Zeilen verweisen noch hierauf (409; ein `RESTRICT`-Schlüssel löst `PG_23001` aus, ebenfalls 409). | Zielzeile zuerst anlegen bzw. ID korrigieren; beim Löschen abhängige Zeilen vorher entfernen oder umhängen. |
| `PG_23505` | 409 | Eindeutigkeits-Constraint verletzt (Unique Constraint). Die Meldung nennt den Constraint. | Anderen Wert wählen oder bestehende Zeile aktualisieren. |

## Speicher (Storage)

| Code | Status | Bedeutung | Behebung |
| --- | --- | --- | --- |
| `INVALID_LIST_OPTIONS` | 400 | Das `maxResults` eines Listings ist keine Ganzzahl von mindestens 1, oder `pageToken` stammt nicht von dieser Quelle. Werte unter 1 lieferten früher leere Seiten mit demselben Token, wodurch `while (pageToken)`-Schleifen endlos liefen. | Positives `maxResults` senden und `nextPageToken` unverändert zurückgeben. |
| `INVALID_STORAGE_BUCKET` | 400 | Der Bucket-Name ist ungültig formatiert. | Namen überprüfen. |
| `INVALID_STORAGE_KEY` | 400 | Der Objektschlüssel ist fehlerhaft, bricht aus seinem Prefix aus oder liegt unter reservierten Pfaden (`_rebase/renditions/`, `_rebase/maintenance/`). | Schlüssel überprüfen. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | Die Bildtransformationsparameter sind außerhalb des Bereichs oder widersprüchlich. | Siehe [Storage](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | Der Upload überschreitet das in der `col.storage()`-Spalte definierte `maxBytes`. Wird serverseitig erzwungen, nicht nur im Browser. `details` nennt Spalte, Limit und tatsächliche Dateigröße. | Kleinere Datei hochladen oder `maxBytes` der Spalte erhöhen. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | Der Dateityp steht nicht in der `accept`-Liste der Spalte oder nicht in den `allowedMimeTypes` der Speicherquelle. `details` liefert Spalte (oder Quellenliste), erlaubte Typen und den empfangenen Content-Type. | Erlaubten Typ hochladen oder `accept` / `allowedMimeTypes` erweitern. |
| `STORAGE_MISCONFIGURED` | 502 | Der für diese Quelle konfigurierte S3- oder GCS-Bucket existiert nicht, oder der Provider hat die Zugangsdaten abgelehnt. Die Meldung nennt den Bucket; `details.reason` liefert `NoSuchBucket` oder die Ablehnungsursache. Ein fehlender Bucket lieferte früher bei allen Dateien fälschlicherweise "file not found". | Bucket-Namen (`S3_BUCKET` / `GCS_BUCKET`, `__<KEY>` für benannte Quellen) oder Zugriffsrechte korrigieren. |
| `STORAGE_NOT_CONFIGURED` | 501 / 503 | Auf dem Server ist kein Speicher-Backend konfiguriert, oder keines ist als Standard definiert und die Anfrage benennt keine Quelle; die Meldung listet verfügbare Quellen auf (501). Bricht ein fortsetzbarer Upload ab, weil die Quelle vor Abschluss entfernt wurde, folgt 503. | S3, GCS oder lokalen Speicher konfigurieren, oder Quelle per `?storageId=` angeben. |
| `STORAGE_SAME_LOCATION` | 400 | `POST /api/admin/storage/move` mit `deleteSource` (`rebase storage move --delete-source`) zwischen zwei Quellen im selben Bucket/Verzeichnis aufgerufen. Jede Datei gälte als bereits vorhanden; das Löschen der Quelldatei würde die einzige Kopie vernichten. Es wurde nichts bewegt oder gelöscht. | Spalte direkt auf die andere Quelle umbiegen; Dateien befinden sich bereits dort. |
| `STORAGE_SCAN_INCOMPLETE` | 409 | `DELETE /api/admin/storage/orphans` (`rebase storage orphans --delete`) konnte nicht alle Tabellen lesen; darin referenzierte Dateien würden als verwaist eingestuft. Bei `?scan=` konnte der benannte Scan nicht alle Tabellen lesen. Es wurde nichts gelöscht; `details.unscanned` listet betroffene Tabellen samt Grund auf. | Ursache für Leseprobleme beheben und Vorgang wiederholen. |
| `STORAGE_SCAN_NOT_FOUND` | 404 | `GET /api/admin/storage/orphans/scans/:id` oder `DELETE /api/admin/storage/orphans?scan=:id` benennt einen Scan, den die Quelle nicht enthält. Scans werden 7 Tage in der gescannten Quelle vorgehalten; eine abweichende `storageId` findet ihn ebenfalls nicht. | Die richtige `storageId` übergeben oder neuen Scan starten. |
| `STORAGE_SCAN_NOT_COMPLETE` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` benennt einen Scan mit Status `queued`, `running` oder `failed`. Es wurde nichts gelöscht; `details.status` nennt den Status. | Warten, bis der Scan abgeschlossen ist, oder neuen Scan starten. |
| `STORAGE_SCAN_EXPIRED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` benennt einen Scan, der vor mehr als 15 Minuten abgeschlossen wurde. Es wurde nichts gelöscht. | Neuen Scan starten und Löschung darauf basierend ausführen. |
| `STORAGE_SCAN_DELETION_STARTED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` benennt einen Scan, dessen verwaiste Dateien bereits gelöscht werden. | Löschstatus über `GET /api/admin/storage/orphans/scans/:id` im Feld `deletion` abfragen. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | Die Speicherquelle ist deklariert, besitzt hier aber keine Zugangsdaten. | Umgebungsvariablen für diese Quelle konfigurieren. |
| `STORAGE_WRITE_FAILED` | 502 | Das Speicher-Backend hat den Schreibvorgang verweigert oder abgebrochen. | Logs und Zugangsdaten des Speicheranbieters prüfen. |
| `TRANSFORM_OVERLOADED` | 503 | Zu viele gleichzeitige Bildtransformationen werden verarbeitet. | Wiederholen; ggf. ein CDN vorschalten. |
| `UNKNOWN_STORAGE_SOURCE` | 400 / 404 | Die Anfrage hat eine Speicherquelle (`?storageId=`) angegeben, die das Projekt nicht deklariert. Ein nicht bereitgestellter `bucket` liefert denselben Code mit **404** (bei Listings, Uploads, Ordnern oder tus-Uploads auf S3/GCS) – der Store fehlt. `details` listet existierende Buckets und Quellen auf. Führte früher zu verwirrenden "file not found"-Meldungen. | Quelle in `config/resources.ts` deklarieren oder `GET /api/storage/sources` abfragen. |
| `UPLOAD_LOCKED` | 423 | Ein `PATCH` eines fortsetzbaren Uploads traf ein, während ein anderer Chunk desselben Uploads noch verarbeitet wurde – meist hervorgerufen durch voreilige Client-Retries. Wird wie bei tusd abgelehnt statt eingereiht. | Aktuellen Offset via `HEAD /api/storage/tus/:id` abfragen und dort fortsetzen; `tus-js-client` handhabt Retries eigenständig. Siehe [Fortsetzbare Uploads (TUS)](/docs/backend/storage-resumable-uploads/). |

## Benutzerdefinierte Funktionen

| Code | Status | Bedeutung | Behebung |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | Keine Funktion dieses Namens verfügbar – oder die Funktion existiert, aber ihre internen Routen decken den Subpfad nicht ab. Angemeldeten Nutzern wird mitgeteilt, welche Funktionen existieren; anonymen nicht (um Endpunkte nicht offenzulegen). Konnte eine Datei dieses Namens nicht geladen werden, nennt die Meldung für angemeldete Nutzer die Datei (Unterscheidung zwischen Tippfehler und fehlerhaftem Deployment). Anonyme Nutzer erhalten stets die generische "Unbekannt"-Meldung. | Funktionsnamen mit `GET /api/functions` abgleichen oder Boot-Logs auf Ladefehler prüfen. |
| `FUNCTION_TIMEOUT` | 504 | Der Handler hat das Zeitlimit überschritten. Er läuft im Hintergrund weiter und kann von hier aus nicht abgebrochen werden. | Ausgehenden Aufrufen ein `AbortSignal` übergeben oder `REBASE_FUNCTIONS_TIMEOUT_MS` erhöhen. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Dieser Prozess leitet Funktionsaufrufe an einen anderen weiter, der nicht geantwortet hat. | Prüfen, ob die Functions-Unit läuft. |

## Push-Benachrichtigungen

| Code | Status | Bedeutung | Behebung |
| --- | --- | --- | --- |
| `PUSH_ENDPOINT_REFUSED` | 400 | Der Endpoint der Subscription gehört zu keinem von Browsern genutzten Push-Dienst (FCM, Mozilla, Apple, Windows) über `https`. Der Server sendet Requests an diese Adresse und akzeptiert keine anderen. | `PushSubscription.toJSON()` direkt aus dem Browser unverändert übergeben oder Testdienste in `push.allowedHosts` eintragen. Siehe [Push-Benachrichtigungen](/docs/backend/push-notifications/#routes). |
| `PUSH_NEEDS_A_USER` | 403 | Ein API-Schlüssel oder der Service-Schlüssel hat eine Push-Route aufgerufen. Eine Subscription ist an den Browser einer angemeldeten Person gebunden. | Mit der Nutzersitzung dieser Person aufrufen. |
| `PUSH_NOT_CONFIGURED` | 503 | Push ist aktiv, kann aber nicht senden: Keine VAPID-Schlüssel in Produktion hinterlegt oder interne Tabelle konnte nicht initialisiert werden. Die Meldung spezifiziert das Problem. | `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` und `REBASE_VAPID_SUBJECT` setzen. Siehe [Push-Benachrichtigungen](/docs/backend/push-notifications/#keys). |

## Cron-Jobs

| Code | Status | Bedeutung | Behebung |
| --- | --- | --- | --- |
| `CRON_JOB_ALREADY_EXECUTING` | 409 | Ein manueller Trigger rief einen Cron-Job auf, der bereits ausgeführt wird – entweder auf diesem Prozess oder auf einem anderen Worker, der den Job-Lease hält. Es wurde nichts gestartet. Das Überspringen wird im Verlauf vermerkt (`details.log`), inklusive Nennung des ausführenden Prozesses. | Nach Abschluss des aktuellen Laufs erneut versuchen. Siehe [Cron-Jobs](/docs/backend/cron-across-instances/#concurrency-guarding). |

## Admin-Oberflächen und Schema-Bearbeitung

Diese Codes signalisieren, dass ein Feature deaktiviert oder nicht konfiguriert ist,
nicht zwingend einen Client-Fehler. Sie werden auf den entsprechenden `/status`-Routen
mit `200` gemeldet, damit Oberflächen Funktionen ausgrauen können, statt Fehler anzuzeigen.

| Code | Status | Bedeutung | Behebung |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | Ein Admin-Bereich wurde auf einem Server ohne konfigurierte Authentifizierung aufgerufen, wodurch Admins nicht identifiziert werden können. | `auth.jwtSecret` setzen oder einen `AuthAdapter` übergeben. |
| `BRANCH_DIFF_STALE` | 409 | An `POST /api/admin/branches/:name/merge` wurde der Fingerprint eines Diffs gesendet, der veraltet ist: Branch oder Parent wurden zwischenzeitlich modifiziert. Es wurde nichts geschrieben. | Diff neu laden, prüfen und mit dem neuen `fingerprint` mergen. |
| `BRANCH_DIFF_UNSUPPORTED` | 501 | Die Datenquelle kann Branches nicht vergleichen: Kein SQL verfügbar oder Branching nicht aktiv (keine Admin-Verbindung). | Postgres-Backend mit gesetztem `adminConnectionString` verwenden. |
| `BRANCH_MERGE_BLOCKED` | 409 | Eine Tabelle mit Differenzen kann nicht zusammengeführt werden – durch Branch hinzugefügt/gelöscht, abweichende Spalten/Primärschlüssel, kein Primärschlüssel vorhanden, zu viele Zeilen für einen Abgleich oder Tabelle wurde seit Branch-Erstellung neu geschrieben (`TABLE_REWRITTEN`). Scheitert der Zeilenabgleich, blockiert die Tabelle selbst bei 0 Zeilen (Status unbekannt, nicht null). `details.tables` nennt Tabellen und Ursachen. Es wurde nichts geschrieben. | Schema vorab per Migration angleichen oder mit `skipBlocked: true` mergen, um problematische Tabellen auszuklammern. |
| `BRANCH_MERGE_CONFLICT` | 409 | Zeilen wurden sowohl im Branch als auch im Parent geändert und `onConflict` war `"abort"` (Standard); oder der Parent lehnte Teile des Merges ab (parallele Zeilenänderung, Trigger-Abbruch, RLS-Filter). Es wurde nichts geschrieben. | Konfliktlösung festlegen mit `onConflict: "branch"` oder `"target"`, oder Diff neu abrufen. |
| `BRANCH_MERGE_FAILED` | 409 | Der Parent hat Zeilen des Branches innerhalb des Merge-Statements abgelehnt – ausgelöst durch Constraints, Enum-Werte oder Fremdschlüssel, meist aufgrund abweichender Schemas. `details` liefert `sqlState`, `table`, `constraint` und `detail`. Es wurde nichts geschrieben. | Schemaänderungen im Diff analysieren, Parent per Migration anpassen oder Zeilen im Branch korrigieren, dann erneut mergen. |
| `BRANCH_NOT_FOUND` | 404 | Ein Branch dieses Namens ist in der Registry nicht verzeichnet. | Vorhandene Branches mit `rebase db branch list` oder im Branches-Panel abfragen. |
| `CONTRACT_UNAVAILABLE` | 404 | Der Projektvertrag (Contract) wird nur ausgeliefert, wenn Authentifizierung konfiguriert ist – er beschreibt alle Tabellen und Relationen. | Authentifizierung konfigurieren. `/meta/schema-version` ist immer erreichbar. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | Kein Entwicklungs-Postfach aktiv. E-Mails werden nur abgefangen, wenn `SMTP_HOST` nicht gesetzt und `NODE_ENV` ungleich `production` ist. | In der Entwicklung `SMTP_HOST` entfernen oder echte Mailbox prüfen. |
| `DOCS_UNAVAILABLE` | 404 | `GET /api/docs` steht denselben Aufrufern offen wie `GET /api/schema/tables`; ohne Auth-Konfiguration existiert kein Kontext zur Auslieferung. | Auth konfigurieren oder Dokumentation via `enableSwagger: true` (`REBASE_ENABLE_SWAGGER=true`) öffentlich bereitstellen. |
| `INVALID_CHANGE` | 400 | Die vorgeschlagene Schema-Änderung ist fehlerhaft aufgebaut. | Siehe Meldung. |
| `SCHEMA_CHANGE_FAILED` | 400 | Das Anwenden einer Schema-Änderung schlug aus Gründen fehl, die kein spezifischerer Code abdeckt. | Siehe Meldung; enthält den Fehlertext im Wortlaut. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | Die Änderung ist formal valide, kann aber auf das aktuelle Schema nicht angewendet werden. | Siehe Meldung. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | Das Repository enthält nicht committete Änderungen; Bearbeitung kann nicht sicher angewendet werden. | Änderungen committen oder stashen, dann wiederholen. |
| `SCHEMA_EDIT_REFUSED` | 400 | Der Schema-Editor verweigerte die Bearbeitung: Änderungen betreffen Code-Muster, die er nicht umschreiben kann (Spread-Operatoren, Helper, berechnete Keys), oder Operationen, die grundsätzlich manuell erfolgen müssen (Tabellen umbenennen, letzte Regel entfernen). `details.problems` listet Details. Es wurde nichts geschrieben. | Siehe Meldung. Änderungen manuell in `backend/schema` vornehmen. |
| `SCHEMA_EDIT_DOES_NOT_COMPILE` | 400 | Die Änderung ist möglich, das resultierende Schema würde jedoch TypeScript-Fehler werfen – verwaiste Relationen zu gelöschten Tabellen, Regeln auf gelöschten Spalten. `details.problems` nennt Compiler-Fehler aufgeschlüsselt nach Tabelle/Spalte. Es wurde nichts geschrieben. | Zuerst abhängige Tabellen aktualisieren oder Änderung direkt im Code vornehmen. |
| `SCHEMA_EDIT_STALE_FILE` | 409 | Eine Zieldatei wurde seit Vorbereitung der Änderung auf der Festplatte modifiziert (Speichern in der IDE, anderer Prozess). Es wurde nichts geschrieben. | Neu laden und Bearbeitung auf Basis der aktuellen Datei wiederholen. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Ein API-Schlüssel oder ein technischer Benutzer hat versucht, eine Schema-Änderung anzuwenden. | Als Benutzer anmelden oder `liveSchema.allowMachineApply` aktivieren. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | Live-Schema-Editing erfordert `schemaDir` (`backend/schema`) oder `liveSchema.repository`; der Server wurde ohne beides gestartet. Der Code behält seinen historischen Namen. | Einen der beiden Parameter konfigurieren. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | Die Planung funktioniert, es existiert jedoch kein Git-Repository für den Commit – Server läuft aus gebautem Bundle oder `backend/schema` liegt nicht im Git-Tree (Schema-Applies erfordern stets einen Git-Commit). | `git init` ausführen und Server neu starten (Repo wird beim Boot erkannt), oder `liveSchema.repository` konfigurieren. |
| `SCHEMA_EDITING_PROVISIONING_OFF` | 409 | Dieses Deployment führt keine Datenbankänderungen durch (`REBASE_PROVISION=false`), weshalb Schema-Applies über das Panel blockiert sind. | Änderung als reinen Code committen und über den DB-Migrationsprozess anwenden lassen. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Dieser Treiber unterstützt keine Schema-Änderungsplanung. | Live-Schema-Editing wird auf Postgres unterstützt. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | Tabellen werden per Introspektion aus der Datenbank geladen; es existieren keine Quelldateien zum Bearbeiten. | Schema-Änderungen über Datenbankmigrationen durchführen. |
| `SCHEMA_EDITOR_DISABLED` | 501 | Der Schema-Editor ist für diesen Server deaktiviert. Gebaute Bundles liefern diesen Fehler standardmäßig. | Über `schemaEditor` aktivieren. Bei Bundles `REBASE_LIVE_SCHEMA_REPOSITORY` setzen, um `backend/schema` über ein Repository zu bearbeiten – siehe [Live Schema Editing](/docs/backend/live-schema-editing#from-a-built-bundle). |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | Dem Schema-Editor fehlt das Paket `ts-morph`. | Im Backend-Package installieren und neu starten: `pnpm --dir backend add -D ts-morph@28.0.0` (im Root gescaffoldeter Projekte) oder `pnpm add -D ts-morph@28.0.0`. Die Fehlermeldung nennt den exakten Befehl. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | Der Server hat kein `schemaDir` definiert; der Editor hat kein Schreibziel. Der Code behält seinen historischen Namen. | `schemaDir` definieren. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | Der Editor ist unter `NODE_ENV=production` deaktiviert: Deployed-Dateien werden bei jedem Deployment aus dem Git-Repo neu gebaut, Online-Änderungen würden überschrieben. | `backend/schema` in Entwicklungsumgebungen ändern und neu deployen, oder `liveSchema.repository` für Remote-Commits nutzen. |
| `SCHEMA_UNAVAILABLE` | 404 | `GET /api/schema/tables` auf einem Backend ohne Auth-Konfiguration: Es existiert kein Benutzerkontext zur Filterung der Tabellensichten; `auth.requireAuth: false` ändert daran nichts. | Auth-Adapter oder `auth.jwtSecret` einrichten. Siehe [Endpunkte](/docs/backend/endpoints/#schema). |
| `TABLE_NOT_FOUND` | 404 | `GET /api/schema/tables/:slug` benennt eine Tabelle, auf die dieser Aufrufer keinen Zugriff hat – existiert nicht oder Scopes der Zugangsdaten reichen nicht aus. | Slug und `data:*`-Scopes der Anmeldedaten prüfen. |
| `UI_PREFERENCES_NEED_A_PERSON` | 403 | `/api/admin/ui-config` wurde mit API-Schlüssel, Plattform-Token oder Service-Schlüssel aufgerufen. UI-Präferenzen sind an Benutzerkonten gebunden. | Als regulärer Benutzer anmelden. |
| `UI_PREFERENCES_TOO_LARGE` | 413 | Die UI-Einstellungen einer einzelnen Tabelle überschreiten 64 KB. | Konfiguration reduzieren: Präferenzen steuern die Darstellung, dienen nicht als Datenspeicher. |
| `UI_PREFERENCES_UNSUPPORTED` | 501 | Der Treiber dieses Backends unterstützt kein SQL und speichert keine UI-Einstellungen; das Panel verwaltet sie im Browser. | Kein Handlungsbedarf: Einstellungen verbleiben lokal im Browser. |
| `UI_CONFIG_FILE_INVALID` | 500 | `frontend/src/cms/ui-config.json` (Ablageort für Workspace-UI-Einstellungen in Entwicklungsumgebungen) ist kein gültiges JSON. | Datei korrigieren oder löschen; das Panel generiert sie beim nächsten Speichern neu. |
| `SQL_EXPORT_UNSUPPORTED` | 501 | `POST /api/admin/sql/csv` kann Resultate hier nicht streamen: Die lokale Entwicklungsdatenbank (PGlite) besitzt nur eine Verbindung; ein blockierter Cursor während des Downloads würde alle anderen Queries lahmlegen. Alternativ unterstützt die Datenquelle keine SQL-Cursor. | `DATABASE_URL` auf ein vollwertiges Postgres umbiegen (`rebase dev --docker` startet eines) oder Abfrage per `LIMIT` begrenzen und Bildschirminhalte exportieren. |

### Schema abgleichen (Reconcile)

[`rebase schema reconcile`](/docs/cli/schema/#rebase-schema-reconcile) erstellt
Pläne via `POST /api/admin/schema/reconcile/plan` und wendet sie über
`/reconcile/apply` an. Eine Ablehnung ändert nichts; lediglich `SCHEMA_RECONCILE_FAILED`
hinterlässt teilweise angewendete Pläne.

| Code | Status | Bedeutung | Behebung |
| --- | --- | --- | --- |
| `INVALID_RECONCILE` | 400 | Der Body ist kein JSON-Objekt oder `drop` ist keine Liste aus `"<table>.<column>"`-Strings. | `{ "drop": ["voice_cache.wav"] }` senden oder `drop` weglassen. |
| `SCHEMA_RECONCILE_FAILED` | 400 | Ein Statement schlug während des Prozesses fehl. Vorherige Statements wurden angewendet und bleiben aktiv; `details.applied` listet sie auf. | Fehlermeldung analysieren, Ursache beheben und neu planen: Der neue Plan schließt bereits angewendete Schritte aus. |
| `SCHEMA_RECONCILE_INVALID` | 400 | Der Plan kann nicht ausgeführt werden. Die Meldung spezifiziert den Grund: Ein `drop` entspricht nicht dem Format `<table>.<column>`, benennt ungültige Tabellen/Spalten oder referenziert Spalten, die im Code noch deklariert sind. `details.plan` enthält den Plan. | `drop`-Liste korrigieren. Deklarierte Spalten müssen zuerst aus `defineTable` entfernt und deployed werden, bevor ein Reconcile sie löschen kann. |
| `SCHEMA_RECONCILE_STALE` | 409 | Datenbank oder Code-Tabellen wurden seit Erstellung des bestätigten Plans modifiziert. `details.plan` liefert den neuen Plan. | Neuen Plan analysieren und dessen `digest` bestätigen. |
| `SCHEMA_RECONCILE_UNCONFIRMED` | 400 | An `/reconcile/apply` wurde kein `confirm`-Wert übergeben. | Zuerst planen und den `digest` des Plans als `confirm` übermitteln. Die CLI erledigt dies nach Eingabe von `yes`. |
| `SCHEMA_RECONCILE_UNSUPPORTED` | 503 | Der Treiber dieses Backends kann Abgleiche nicht planen oder unterstützt kein SQL. | Schema-Reconcile erfordert Postgres. |

### Ursachen für blockierte Tabellen-Merges

`BRANCH_MERGE_BLOCKED` listet jede abgewiesene Tabelle in `details.tables` mit
einem der folgenden Codes auf. Derselbe Code findet sich im Diff unter `blocked` der jeweiligen
Tabelle, sodass Studio Probleme signalisieren kann, bevor **Merge** geklickt wird.
Keiner dieser Codes stellt eine eigenständige HTTP-Antwort dar.

| Code | Status | Bedeutung | Behebung |
| --- | --- | --- | --- |
| `COLUMNS_DIFFER` | — | Die Spalten der Tabelle unterscheiden sich zwischen Branch und Parent. Zeilen werden nur anhand gemeinsamer Spalten verglichen. | Fehlende Spalten per Migration (`rebase db push`) auf dem Parent ergänzen, dann mergen. Tabellen-Rewrites durch Migrationen erzeugen `TABLE_REWRITTEN`: Vor solchen Änderungen mergen oder Branch danach neu anlegen. |
| `NO_PRIMARY_KEY` | — | Tabelle besitzt keinen Primärschlüssel; Zeilenabgleich ist unmöglich. Das Diff liefert reine Zeilenzahlen. | Primärschlüssel definieren oder Zeilen manuell übertragen. |
| `PRIMARY_KEY_DIFFERS` | — | Spalten oder Datentypen des Primärschlüssels weichen voneinander ab. | Schema zuerst auf dem Parent anwenden. |
| `TABLE_ADDED` | — | Die Tabelle wurde im Branch neu angelegt. Ein Merge erstellt niemals neue Tabellen. | Tabelle per Migration im Parent erstellen, danach Zeileninhalte mergen. |
| `TABLE_DROPPED` | — | Die Tabelle wurde im Branch gelöscht. Ein Merge löscht keine Tabellen im Parent. | Tabelle per Migration auf dem Parent löschen. |
| `TABLE_REWRITTEN` | — | Eine Seite hat nach Branch-Erstellung alle Tabellenzeilen neu geschrieben (Spaltentyp-Änderung, `ADD COLUMN` mit flüchtigem Default, `VACUUM FULL`, `CLUSTER`); Herkunft einzelner Änderungen ist nicht mehr ermittelbar. | Vor solchen Migrationen mergen oder Branch vom Parent neu ableiten. |
| `TOO_LARGE` | — | Die Zeilenanzahl übersteigt das Maximum für zeilenbasierte Diff-Vergleiche (Standard: 100.000, gesteuert über `maxRowsPerTable`). | `maxRowsPerTable` für Diff und Merge erhöhen oder Daten auf anderem Weg migrieren. |

## Generische Codes

Routen greifen auf diese Codes zurück, wenn kein spezifischerer Fehlercode zutrifft.

| Code | Status | Bedeutung | Behebung |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Anfrage ist fehlerhaft aufgebaut; kein spezifischerer Code vorhanden. | Siehe Meldung. |
| `UNAUTHORIZED` | 401 | Nicht authentifiziert oder Zugangsdaten abgewiesen. | Anmelden oder Token aktualisieren. |
| `FORBIDDEN` | 403 | Authentifiziert, Aktion jedoch nicht autorisiert. | Wiederholung mit identischen Rechten ist zwecklos. |
| `CONFLICT` | 409 | Konflikt mit bestehendem Datenzustand. | Siehe Meldung. |
| `INTERNAL_ERROR` | 500 | Unerwarteter Serverfehler. Meldung ist bewusst generisch. | `requestId` notieren; Details finden sich in den Server-Logs. |
| `NOT_CONFIGURED` | 503 | Eine für diese Route benötigte Abhängigkeit ist auf diesem Server nicht eingerichtet. | Siehe Meldung. |
| `SERVICE_UNAVAILABLE` | 503 | Ein abhängiger externer Dienst war nicht erreichbar: S3-/MinIO-Bucket oder Host eines `fetch()`-Aufrufs in einer Funktion verweigert Verbindung / löst nicht auf. Das Server-Log nennt den Host; die Client-Antwort nicht. Nicht erreichbare Datenbanken melden `DATABASE_UNAVAILABLE`. Schlägt eine Verbindung zu solchen Services fehl, wird dieser Code ausgegeben. | Wiederholen; Logs überprüfen. |

## Vollständigkeit dieser Dokumentation

`pnpm verify:docs` schlägt fehl, wenn ein vom Server geworfener Code in diesen
Tabellen fehlt, ein gelisteter Code nirgendwo im Quellcode existiert, die dokumentierten HTTP-Statuswerte
nicht exakt mit dem Code übereinstimmen oder eine Code-Familie wie `PG_<SQLSTATE>` keinen Eintrag
für einen SQLSTATE enthält, der Aufrufern begegnen kann. Die Prüfung erfolgt über
`tooling/scripts/docs-verify/check-error-codes.mjs`.

Das Script testet sich vorab selbst. Da die Analyse über den TypeScript-AST und nicht
über eine laufende Serverinstanz erfolgt, könnten Implementierungslücken unbemerkt bleiben:
In früheren Versionen wurden Codes übersehen, die durch Einzeiler-Wrapper geschleift oder
hinter Meldungen mit `)` platziert wurden. Das Script validiert sich daher vor dem Prüfen
dieser Seite gegen Fixtures genau jener Code-Muster und bricht ab, falls es diese Konstrukte
nicht auflösen kann.
