---
sourceHash: f3bc0de4cbc7297e
title: Fehlercodes
sidebar_label: Fehlercodes
description: Jeder Fehlercode, den ein Rebase-Backend zurückgeben kann, inklusive HTTP-Status, Bedeutung und Behebung – plus Response-Envelope, X-Request-ID und die Regeln für details.
---

Jeder Fehler, den ein Rebase-Backend zurückgibt, verwendet denselben Envelope und enthält einen stabilen
`code`. Dieser Code ist das Element, nach dem im Code verzweigt werden sollte: Die Meldung ist für Menschen
geschrieben und kann umformuliert werden, der Status wird von einem Dutzend verschiedener Probleme geteilt,
der Code hingegen nicht.

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

- **`message`** — menschenlesbar. Bei einem `4xx`-Fehler ist es die spezifische Meldung des Servers; bei
  einem `5xx`-Fehler ist sie bewusst generisch gehalten, da der zugrundeliegende Text einen Host,
  eine Rolle oder einen Spaltennamen enthalten kann.
- **`code`** — einer der unten aufgeführten Werte. Stabil über Minor-Versionen hinweg.
- **`details`** — optional und niemals garantiert. Siehe die unten stehenden Regeln.
- **`requestId`** — vorhanden, wann immer die Anfrage die Request-ID-Middleware
  durchlaufen hat, was auf jede Route unter `basePath` zutrifft.

### `X-Request-ID`

Jede Anfrage unter `basePath` erhält eine ID: den `X-Request-ID`-Header des Aufrufers,
sofern es sich um eine UUID handelt, andernfalls eine neu generierte. Sie wird in der
Antwort als `X-Request-ID` zurückgegeben, im Fehler-Envelope als `requestId` aufgeführt und
an die Protokollzeile des Servers für diese Anfrage angehängt.

Das ist der Verknüpfungsschlüssel. Geben Sie ihn in einem Fehlerbericht an, und Administratoren können genau
die eine Protokollzeile finden, die den Fehler erklärt – inklusive des Grundes, der dem Client
nie angezeigt wurde.

Das Senden einer eigenen ID ermöglicht es einem Trace, Hops über Dienste hinweg zu überstehen: Ein Gateway
oder ein Job-Runner, der den Header weiterleitet, sorgt für eine einheitliche ID über alle verarbeitenden Dienste hinweg.
Ein ungültiger Wert wird ignoriert statt abgewiesen – ein fehlerhafter Header eines Aufrufers
rechtfertigt keinen Abbruch der Anfrage. Gehen Sie daher nicht davon aus, dass die gesendete ID der empfangenen
entspricht. Prüfen Sie den Response-Header.

### Inhalt von `details`

`details` dient der Diagnose, nicht als Vertrag. Es gelten drei Regeln:

1. **Alles, was eine Route explizit setzt, wird immer zurückgegeben.** Dies sind präzise
   beschriebene Fehler des Aufrufers selbst: welches Filterfeld unbekannt war,
   welche Relation nicht beschreibbar ist oder welcher Wert nicht zum Typ passte.
2. **Datenbank-Diagnosen werden in der Produktion gekürzt.** Stammt der Fehler
   von Postgres, ist `details.dbCode` – der SQLSTATE – immer vorhanden: Er benennt
   die Problemklasse und gibt nichts über die Daten preis. `dbMessage`,
   `detail` und `hint` werden nur hinzugefügt, wenn `NODE_ENV` nicht `production` ist,
   da Postgres Zeileninhalte darin platziert. `23505` meldet beispielsweise
   `Key (email)=(a@b.c) already exists.`, was für jede beliebige Adresse die Frage "Ist diese Person registriert?"
   beantworten würde.
3. **Verzweigen Sie niemals auf Basis von `details`.** Verzweigen Sie anhand von `code`. Der Inhalt
   unter `details` umfasst rein das, was an der jeweiligen Aufrufstelle für Menschen nützlich war, und kann sich ändern.

## Statuscodes interpretieren

| Status | Bedeutung für die Anfrage |
| --- | --- |
| `400` | Fehlerhaft aufgebaut oder fragt etwas ab, das im Schema nicht existiert. Korrigieren Sie die Anfrage. |
| `401` | Nicht authentifiziert oder die Anmeldedaten sind abgelaufen. Anmelden oder aktualisieren. |
| `403` | Authentifiziert, aber nicht autorisiert. Ein erneuter Versuch mit derselben Identität hilft nicht. |
| `404` | Keine solche Route, Collection oder Zeile – oder eine Zeile, die durch Row-Level Security ausgeblendet wird. |
| `409` | Konflikt mit bestehendem Zustand: ein Duplikat oder ein gleichzeitiger Schreibvorgang. |
| `413` `415` `422` | Der Body ist zu groß, hat den falschen Medientyp oder wurde semantisch abgelehnt. |
| `429` | Ratenbegrenzung erreicht. Warten Sie ab; die Meldung gibt die Dauer an. |
| `500` | Der Server oder seine Datenbank hat einen Fehler, nicht der Aufrufer. Protokolle prüfen. |
| `501` | Die Route existiert, kann aber von diesem Deployment nicht bedient werden – ein Feature ist deaktiviert oder unkonfiguriert. |
| `502` `503` `504` | Eine Abhängigkeit war nicht erreichbar, nicht konfiguriert oder zu langsam. |

## Authentifizierung und Konten

| Code | Status | Bedeutung | Maßnahme |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | Die Route erfordert einen zweiten Faktor und die Sitzung hat nur einen. | MFA-Challenge abschließen und erneut versuchen. |
| `ALREADY_VERIFIED` | 400 | Die Adresse oder der Faktor ist bereits verifiziert. | Nichts tun – der gewünschte Zustand ist bereits erreicht. |
| `ACCOUNT_OUTRANKS_CALLER` | 403 | Das bearbeitete, zurückgesetzte oder gelöschte Konto besitzt eine Rolle oder einen Scope, den der Aufrufer nicht hat. `details.beyond` listet sie auf. | Die Änderung durch jemanden durchführen lassen, der diese Berechtigungen besitzt. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | Anonyme Anmeldung ist auf diesem Server deaktiviert. | Aktivieren oder mit einer echten Identität anmelden. |
| `ANONYMOUS_NOT_ALLOWED` | 403 | Eine Gastsitzung hat versucht, ein Geräte-Login zu bestätigen. Ein Gast hat kein Konto, das er einem Gerät zuweisen könnte. | Mit einem Konto anmelden und dann bestätigen. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Ein API-Schlüssel hat versucht, API-Schlüssel (eigene Art oder persönliche) aufzulisten, zu erstellen, zu ändern oder zu widerrufen. | Schlüssel als Person mit `keys:write` oder mit dem Service-Schlüssel verwalten. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Eine geschützte Route wurde ohne Rebase-Auth-Middleware ausgeführt, sodass die Anmeldedaten des Aufrufers nie geprüft wurden. | Die App über den Functions-Router mounten statt direkt auf dem eigenen Server. |
| `BOOTSTRAP_ANONYMOUS` | 403 | Das Bootstrapping des ersten Admins wurde von einem anonymen Aufrufer versucht. | Zuerst anmelden. |
| `BOOTSTRAP_COMPLETED` | 403 | Der erste Administrator existiert bereits. | Die Rolle von einem bestehenden Admin zuweisen lassen. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | Bootstrap ist nur für den allerersten Benutzer gedacht, und dies ist nicht der Fall. | Die Rolle von einem bestehenden Admin zuweisen lassen. |
| `CAPTCHA_FAILED` | 400 | Der Provider hat das CAPTCHA-Token abgelehnt. | Eine neue Challenge lösen. |
| `CAPTCHA_REQUIRED` | 400 | Die Route erfordert ein CAPTCHA-Token und es wurde keines gesendet. | Token beifügen. |
| `CHALLENGE_EXHAUSTED` | 401 | Zu viele falsche Codes bei einer MFA-Challenge eingegeben. | Eine neue Challenge starten. |
| `DEVICE_LOGIN_DECIDED` | 409 | Das Geräte-Login wurde bereits genehmigt oder abgelehnt. Ein Login wird nur einmal entschieden. | Auf dem Gerät neu starten. |
| `DEVICE_LOGIN_EXPIRED` | 410 | Das Zeitfenster von zehn Minuten für das Geräte-Login ist vor der Entscheidung abgelaufen. | Auf dem Gerät neu starten. |
| `DEVICE_LOGIN_NOT_FOUND` | 404 | Kein Geräte-Login mit diesem Benutzercode gefunden. Das Polling des Geräts selbst liefert stattdessen die kleingeschriebenen RFC-8628-Codes: `authorization_pending`, `slow_down`, `access_denied`, `expired_token`, `invalid_grant`. | Code mit dem auf dem Gerät angezeigten abgleichen. |
| `EMAIL_EXISTS` | 409 | Ein Konto mit dieser Adresse existiert bereits – bei der Registrierung, bei einer Adressänderung oder beim Aufrufen eines Links zur Adressänderung, wenn ein anderes Konto die Adresse inzwischen belegt hat. | Anmelden oder Passwort-Reset anfordern; bei Adressänderung eine andere Adresse wählen. |
| `EMAIL_NOT_CONFIGURED` | 503 | Magic Links oder OTP wurden angefordert, aber der Server verfügt über keinen Mail-Transport. | SMTP konfigurieren oder eine andere Anmeldemethode nutzen. |
| `EMAIL_NOT_VERIFIED` | 403 | Ein OAuth-Login hat ein Konto mit derselben Adresse gefunden, und der Provider hat diese Adresse nicht verifiziert, weshalb keine Verknüpfung erfolgt ist. | Mit der bestehenden Methode anmelden, dann `POST /auth/link/<provider>`. |
| `FACTOR_NOT_VERIFIED` | 400 | Der MFA-Faktor wurde registriert, aber nie bestätigt. | Faktor bestätigen. |
| `IDENTITY_ALREADY_LINKED` | 409 | Diese OAuth-Identität gehört bereits zu einem anderen Konto. | Damit anmelden oder sie dort zuerst trennen. |
| `IMPERSONATION_FORBIDDEN` | 403 | Eine Anfrage enthielt `x-rebase-impersonate` und der Aufrufer darf keine Aktionen im Namen eines anderen Benutzers ausführen. Nur die eigene Sitzung eines angemeldeten Administrators ist dazu berechtigt, niemals ein API-Schlüssel oder der Service-Schlüssel. | Mit der Sitzung eines Administrators senden oder den Header weglassen. |
| `IMPERSONATION_INVALID` | 400 | `x-rebase-impersonate` wurde leer übermittelt. | Die UID des Zielbenutzers angeben oder den Header weglassen. |
| `IMPERSONATION_TARGET_NOT_FOUND` | 404 | `x-rebase-impersonate` benennt keinen aktiven Benutzer: Kein Konto hat diese UID oder es ist deaktiviert. | UID überprüfen. |
| `IMPERSONATION_UNAVAILABLE` | 501 | Die Authentifizierung dieses Backends kann keine Anfragen als anderer Benutzer ausführen, da ihr `AuthAdapter` kein `resolveUser` besitzt. | `resolveUser` im Adapter implementieren oder den Header weglassen. |
| `IMPERSONATION_UNSUPPORTED` | 400 | `x-rebase-impersonate` wurde an eine Route gesendet, die keinen Benutzerwechsel unterstützt. Nur die Daten-API und Custom Functions unterstützen dies; der Realtime-Socket unterstützt `impersonate` bei `AUTHENTICATE`. | Anfrage ohne den Header senden. |
| `SIMULATION_FORBIDDEN` | 403 | Eine Anfrage enthielt einen `x-rebase-simulate-*`-Header (der RLS-Simulator) oder forderte `/api/admin/rls-simulator` an, und der Aufrufer darf keinen Zugriff simulieren. Nur die eigene Sitzung eines angemeldeten Administrators ist dazu berechtigt, niemals ein API-Schlüssel oder der Service-Schlüssel. | Mit der Sitzung eines Administrators senden oder die Header weglassen. |
| `SIMULATION_INVALID` | 400 | Die Simulation war fehlerhaft: ein Header wurde leer übermittelt, `x-rebase-simulate-api-key-id` wurde mit einer Rolle oder Benutzer-ID kombiniert, oder die Simulation wurde mit `x-rebase-impersonate` kombiniert. | Genau eine Rolle (optional mit UID), eine Benutzer-ID oder eine API-Schlüssel-ID angeben. |
| `SIMULATION_READ_ONLY` | 403 | Ein Schreibvorgang, Löschvorgang, `_batch`, Verlaufs-Revert oder eine Custom Function, die mit einem anderen Verb als `GET`/`HEAD`/`OPTIONS` aufgerufen wurde, trug einen `x-rebase-simulate-*`-Header. Simulierter Zugriff ist schreibgeschützt: Der Schreibvorgang würde als simulierte Identität und nicht als Administrator ausgeführt. Lesevorgänge, einschließlich `POST …/query` und `…/count`, funktionieren weiterhin. | Simulation beenden, um Änderungen vorzunehmen. |
| `SIMULATION_TARGET_NOT_FOUND` | 404 | Die Simulation benennt keinen aktiven Benutzer (eine Benutzer-ID ohne Rolle übermittelt) oder keinen gültigen API-Schlüssel. | ID überprüfen oder eine Rolle mit der UID übermitteln, um eine UID ohne Konto zu simulieren. |
| `SIMULATION_UNAVAILABLE` | 501 | Dieses Backend kann keinen Zugriff simulieren: Sein `AuthAdapter` hat kein `resolveUser` zur Bestätigung eines Administrators, oder es wurde ein Schlüssel auf einem Backend ohne API-Schlüssel angegeben. | `resolveUser` implementieren oder die Header weglassen. |
| `SIMULATION_UNSUPPORTED` | 400 | Ein `x-rebase-simulate-*`-Header wurde an eine Route gesendet, die keinen simulierten Zugriff unterstützt. Nur die Daten-API und Custom Functions unterstützen diese Header. | Anfrage ohne die Header senden. |
| `GUEST_REFERENCED` | 409 | Ein Gast konnte nicht gelöscht werden, da eine projekteigene Zeile ihn über einen Fremdschlüssel mit `ON DELETE RESTRICT` oder `NO ACTION` referenziert. `DELETE /api/admin/guests` meldet dies pro Gast in `skipped` und fährt fort. | Die verweisende Zeile löschen oder den Gast belassen. |
| `INVALID_ACCOUNT` | 400 | Das Konto befindet sich in einem Zustand, auf den diese Operation nicht angewendet werden kann. | Siehe Meldung. |
| `INVALID_CHALLENGE` | 400 | Die MFA-Challenge ist unbekannt oder abgelaufen. | Eine neue Challenge starten. |
| `INVALID_CODE` | 400 / 401 | Der OTP- oder MFA-Code ist falsch: 400 bei der Anmeldung per E-Mail-Code (`/auth/otp/verify`), 401 bei einer MFA-Registrierung oder -Challenge. | Mit dem aktuellen Code erneut versuchen. |
| `INVALID_CREDENTIALS` | 401 | Falsche E-Mail-Adresse oder falsches Passwort – bewusst ohne Angabe, was davon nicht stimmte. | Erneut versuchen oder Passwort zurücksetzen. |
| `INVALID_PLATFORM_TOKEN` | 401 | Ein `rpt_`-Plattform-Token wurde abgelehnt: ungültige Signatur, falsche Audience, abgelaufen oder Lebensdauer über dem Limit. Die Meldung spezifiziert die Ursache. | Von der Plattform ein neues ausstellen lassen – auf Rebase Cloud den Befehl erneut ausführen. |
| `INVALID_SCOPES` | 400 | Für einen Schlüssel wurde etwas angefordert, das kein Scope ist: fehlerhaft, unbekannt oder mit einem Ziel, das der Scope nicht akzeptiert. `details.problems` nennt Ursache und Details; `details.validScopes` listet zulässige Scopes für Schlüssel auf. `keys:read` und `keys:write` sind ausgeschlossen, da kein Schlüssel diese halten kann. | Einen Namen aus der Liste verwenden. Siehe [Rollen und Scopes](/docs/backend/roles-and-scopes/). |
| `INVALID_TOKEN` | 400 / 401 | Ein Verifizierungs-, Reset-, Magic-Link- oder Adressänderungs-Token ist fehlerhaft, unbekannt, bereits verbraucht oder abgelaufen (400). Ein OAuth-Provider-Credential oder ein Refresh-Token, das sich nicht verifizieren lässt, ergibt einen 401. | Neuen Link anfordern oder erneut anmelden. |
| `INVALID_USER_CODE` | 400 | Der als Geräte-Login-Code übermittelte Wert ist ungültig: gefordert sind acht Buchstaben wie `BCDF-GHJK`. | Den auf dem Gerät angezeigten Code exakt kopieren. |
| `INVALID_ROLE` | 400 | Ein zu schreibender Rollenname ist kein String, ist leer oder enthält `,` `{` `}` `"` `\` oder ein Steuerzeichen. Diese Zeichen würden beim Auslesen als separate Rollen interpretiert werden: Eine Rolle wird in einem Postgres `text[]` und in der kommagetrennten Liste transportiert, die RLS-Policies parsen; `"support,admin"` würde somit als `admin` zurückkommen. `details.problems` benennt jeden Fehler. | Rolle umbenennen. Jeder andere Name wird akzeptiert. |
| `KEY_MANAGEMENT_SCOPE` | 400 | Für einen Schlüssel wurde `keys:read` oder `keys:write` angefordert. Kein Schlüssel darf Schlüssel verwalten. `details.scopes` nennt sie. | Diese Scopes weglassen. |
| `KEY_OUTRANKS_CALLER` | 403 | Ein Inhaber von `keys:write` hat versucht, einen Service-Schlüssel zu ändern oder zu widerrufen, der Rollen oder Scopes hält, die der Aufrufer selbst nicht besitzt. Nur ein Admin kann beliebige Schlüssel verwalten. `details.roles` und `details.scopes` listen auf, was der Schlüssel über die Rechte des Aufrufers hinaus besitzt. | Durch einen Admin oder jemanden mit den entsprechenden Rechten ändern lassen. |
| `LAST_ADMIN` | 403 | Die Änderung würde dazu führen, dass das Projekt keinen Administrator mehr hat. | Zuerst eine andere Person zum Administrator ernennen. |
| `MFA_REQUIRED` | 401 | Das Passwort war korrekt und das Konto besitzt einen verifizierten zweiten Faktor, daher ist die Anmeldung erst zur Hälfte abgeschlossen. `details` enthält ein kurzlebiges Token für die MFA-Challenge – es ist keine Sitzung. | Eine Challenge öffnen und beantworten; die Antwort auf die Challenge stellt die Sitzung aus. |
| `NO_SESSION` | 401 | Kein Session-Cookie oder Refresh-Token übergeben. Normal beim ersten Laden der Seite. | Anmelden. |
| `NOT_ANONYMOUS` | 400 | Eine Route zum Upgrade eines anonymen Nutzers wurde von einem echten Konto aufgerufen, oder `DELETE /api/admin/guests/:uid` hat ein solches benannt. | Kein Upgrade erforderlich. Um ein Konto zu löschen, `DELETE /api/admin/users/:uid` verwenden. |
| `OAUTH_ERROR` | 401 | Der OAuth-Provider hat die Autorisierung verweigert oder einen Fehler gemeldet. | Flow wiederholen; die Meldung enthält die Begründung des Providers. |
| `PERSONAL_KEYS_DISABLED` | 403 | Persönliche API-Schlüssel sind auf diesem Backend deaktiviert. | `personalKeys: true` im `auth`-Block der Users-Collection setzen. |
| `PERSONAL_KEY_NEEDS_ACCOUNT` | 403 | Der Service-Schlüssel oder eine Gastsitzung hat versucht, Routen für persönliche Schlüssel zu nutzen. Beide besitzen kein Konto, für das ein Schlüssel agieren könnte. | An einem Konto anmelden oder einen Service-Schlüssel unter `/api/admin/api-keys` erstellen. |
| `PLATFORM_TOKENS_OFF` | 401 | Ein `rpt_`-Plattform-Token hat einen Server erreicht, der diese nicht akzeptiert: `REBASE_PLATFORM_TOKEN_KEY` und `REBASE_PLATFORM_TOKEN_AUDIENCE` sind nicht gesetzt. | Die Hosting-Plattform setzt beide Werte beim Deployment; neu deployen oder auf andere Weise an der App anmelden. |
| `RATE_LIMITED` | 429 | Zu viele Versuche von diesem Aufrufer. | Warten; die Meldung gibt die Dauer an. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | Das Weiterleitungsziel steht nicht auf der Allowlist. | Zur Provider-Konfiguration hinzufügen. |
| `REGISTRATION_DISABLED` | 403 | Die Selbstregistrierung ist deaktiviert. | Konto durch einen Administrator anlegen lassen. |
| `ROLE_EXCEEDS_CALLER` | 403 | Die zu vergebenden Rollen enthalten einen Scope oder `admin`, den der Aufrufer nicht besitzt. `details.beyond` nennt sie. | Rollen durch jemanden vergeben lassen, der diese Rechte hat. |
| `ROLE_EXCEEDS_CREATOR` | 403 | Einem Service-Schlüssel wurde eine RLS-Rolle zugewiesen, die sein Ersteller nicht besitzt. Nur ein Administrator darf beliebige Rollen vergeben. `details.roles` nennt sie. | Rolle entfernen oder den Schlüssel durch einen Administrator erstellen lassen. |
| `ROLE_EXISTS` | 409 | Dieser Rollenname ist bereits vergeben. | Einen anderen Namen wählen. |
| `ROLE_LOOKUP_FAILED` | 503 | Die Rollen des Aufrufers konnten nicht gelesen werden – auf einer Admin-Route oder bei einer Datenanfrage auf einem Backend mit `config.auth`. Schlägt sicherheitshalber fehl (fail-closed), anstatt den Rollen im Token zu vertrauen. Ein Token, dessen UID zu keinem Konto passt (inklusive UIDs, die die Users-Tabelle nicht aufnehmen kann), liefert einen 401, nicht diesen Fehler. Eine nicht erreichbare Datenbank ist `DATABASE_UNAVAILABLE`. | Erneut versuchen; Datenbank prüfen. |
| `SCOPE_EXCEEDS_CREATOR` | 403 | Für einen Schlüssel wurde ein Scope angefordert, den sein Ersteller nicht besitzt. Ein Schlüssel hat niemals mehr Rechte als das Konto, das ihn erzeugt. `details.scopes` nennt sie. | Scopes weglassen oder den Schlüssel durch jemanden erstellen lassen, der sie besitzt. |
| `SCOPE_MISSING` | 403 | Das Credential verfügt nicht über den Scope, den diese Route, Collection, Storage-Quelle oder Funktion benötigt. `details.requiredScope` nennt ihn inklusive Ziel. | Für Personen: eine Rolle mit diesem Scope. Für Schlüssel: ein Schlüssel mit diesem Scope. Siehe [Rollen und Scopes](/docs/backend/roles-and-scopes/). |
| `SCOPE_NOT_DECLARED` | 500 | Eine mit `requireScope` geschützte Route benennt einen App-Scope, den dieses Backend nicht deklariert; folglich besitzt ihn niemand, auch kein Administrator. Ein Name, der überhaupt kein Scope ist, oder ein falsch geschriebener integrierter Scope wie `data:raed`, gelangt gar nicht so weit: `requireScope` wirft bereits bei der Routenregistrierung einen Fehler. | Den Scope unter `auth.scopes` in der Users-Collection deklarieren oder den Namen korrigieren. Siehe [Rollen und Scopes](/docs/backend/roles-and-scopes/). |
| `SELF_DELETE` | 400 | Ein Administrator hat versucht, sein eigenes Konto zu löschen. | Durch einen anderen Administrator ausführen lassen. |
| `SESSION_REVOKED` | 401 | Die Sitzung wurde an anderer Stelle abgemeldet, alle Sitzungen wurden widerrufen oder das Konto wurde gelöscht. Jeder Einstiegspunkt, der eine Sitzung akzeptiert, weist ein solches Access-Token ab: Daten-API, Storage, Custom Functions und Admin-Routen. Der Realtime-Socket lehnt `AUTHENTICATE` mit einem `AUTH_ERROR`-Frame ab, der denselben Code trägt. Das SDK versucht einen Refresh, dieser wird abgelehnt, und es meldet sich ab. | Erneut anmelden. |
| `ACCOUNT_DISABLED` | 401/403 | Ein Administrator hat das Konto deaktiviert: Anmeldung (403), Refresh und jedes Token des Kontos (401) werden an allen Schnittstellen abgelehnt. Der Realtime-Socket lehnt `AUTHENTICATE` mit einem `AUTH_ERROR`-Frame mit demselben Code ab. | An einen Administrator wenden. |
| `EMAIL_NOT_CONFIRMED` | 403 | `requireEmailVerification` ist aktiv und die Adresse wurde noch nicht verifiziert. Wird nur bei korrektem Passwort zurückgegeben; ein neuer Link wird per Mail gesendet. | Dem Link in der Mail folgen. |
| `PROOF_REQUIRED` | 409 | `POST /auth/verify-email`: Das Konto enthält ein Passwort oder eine Identität, die von niemandem nachgewiesen wurde, und die Anfrage weist keines von beiden nach. Das Token wird nicht verbraucht. | `password` übermitteln, um es zu behalten, oder `removeUnproven: true`, um ohne Nachweis zu verifizieren. |
| `UNDELIVERABLE_ADDRESS` | 400 / 409 | Eine Bestätigungsmail wurde für eine unzustellbare Adresse angefordert – die eines Gastes oder ein Platzhalter von X (400) – oder ein Konto wollte auf eine solche Adresse umgestellt werden (409, `POST /auth/change-email`). | Zuerst eine echte Adresse hinterlegen. |
| `EMAIL_UNCHANGED` | 400 | `POST /auth/change-email` hat die aktuelle Adresse des Kontos angegeben. | Nichts zu ändern. |
| `ANONYMOUS_USER` | 403 | Ein Gast hat versucht, seine E-Mail-Adresse zu ändern; ein Gast besitzt keine eigene. | Zuerst in ein vollwertiges Konto umwandeln (`POST /auth/anonymous/link`). |
| `MFA_NOT_ENROLLED` | 400 | Wiederherstellungscodes wurden für ein Konto ohne verifizierten zweiten Faktor angefordert. | Zuerst einen Faktor registrieren. |
| `HOOK_REJECTED` | 400 | Ein `beforeUserCreate`-, `beforeLogin`-, `beforeUserDelete`- oder `beforeEmailChange`-Hook hat einen Fehler geworfen. Die Meldung stammt vom Hook; hat ein Hook einen 4xx-Status gewählt, wird dieser zurückgegeben. | Siehe Meldung. |
| `INVALID_JSON` | 400 | Der Request-Body ist kein gültiges JSON. | Einen gültigen JSON-Body senden. |
| `SELF_DISABLE` | 400 | Ein Administrator hat versucht, sein eigenes Konto zu deaktivieren. | An einen anderen Administrator wenden. |
| `NOT_SUPPORTED` | 501 | Das Auth-Repository dieses Backends unterstützt die angeforderte Aktion nicht (Konten deaktivieren, Adresse ändern). | Server neu starten, damit die Spalte angelegt wird, oder ein Repository nutzen, das dies unterstützt. |
| `UNKNOWN_SCOPE_TARGET` | 400 | Das Ziel eines Scopes benennt eine Collection, Storage-Quelle oder Funktion, die dieses Backend nicht bereitstellt. `details` listet die verfügbaren Ziele auf. | Ziel korrigieren. |
| `UNVERIFIED_IDENTITIES` | 409 | Ein Magic Link, E-Mail-Code oder Passwort-Reset hat die Adresse eines unbestätigten Kontos bestätigt, und das Konto enthält eine Login-Identität, deren Provider diese Adresse nie verifiziert hat. Das Auth-Repository kann diese nicht entfernen (es fehlt `unlinkUserIdentity`), weshalb die Bestätigung abgelehnt wird, um keine ungesicherte Zugriffsmöglichkeit auf einem verifizierten Konto zu belassen. | `unlinkUserIdentity` im benutzerdefinierten Auth-Repository implementieren oder das Konto von einem Admin prüfen lassen. |
| `SETUP_REQUIRED` | 403 | Das Projekt hat noch keinen Administrator, daher ist diese Route nicht verfügbar. | Ersteinrichtung des Administrators abschließen. |
| `TOKEN_ALREADY_USED` | 401 | Ein Einmal-Token wurde wiederverwendet, oder ein Refresh-Token, das vor mehr als `refreshTokenReuseIntervalSeconds` rotiert wurde. | Neues Token anfordern oder erneut anmelden. |
| `TOKEN_EXPIRED` | 401 | Die Gültigkeitsdauer des Tokens ist abgelaufen. | Neues Token anfordern. |
| `USER_NOT_FOUND` | 404 | Kein Konto mit dieser ID vorhanden. | ID überprüfen. |
| `WEAK_PASSWORD` | 400 | Das Passwort entspricht nicht der [Passwortrichtlinie](/docs/backend/auth-endpoints/#password-policy) (standardmäßig 8+ Zeichen mit Großbuchstabe, Kleinbuchstabe und Ziffer) – bei Registrierung, Reset, Änderung oder bei Passwörtern, die ein Admin setzt: `POST /api/admin/users`, Erstellung in der Users-Collection über die Daten-API, `PUT /api/admin/users/:id` oder `POST /api/admin/users/:id/reset-password`. | Stärkeres Passwort wählen. Ein Administrator, der Konten importiert, kann bei der Erstellung `skipPasswordPolicy: true` übergeben. |

## Daten, Abfragen und Schreibvorgänge

| Code | Status | Bedeutung | Maßnahme |
| --- | --- | --- | --- |
| `AGGREGATE_MASKED_BY_AFTER_READ` | 400 | Ein Aggregat außer `count()` ohne `groupBy` auf einer Collection, die durch einen `afterRead`-Callback modifiziert wird (global, Collection oder Property). Ein Aggregat liest die gespeicherten Werte direkt und führt den Callback nicht aus, sodass Summe, Minimum, Maximum, Feldanzahl oder Gruppierung Werte lesen würden, die der Callback verbirgt. | `count()` ohne `groupBy` nutzen oder die Zeilen normal lesen, wodurch der Callback ausgeführt wird. |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Dieser Treiber kann das angeforderte Aggregat nicht berechnen. | Treiber nutzen, der dies unterstützt, oder die Berechnung im Client durchführen. |
| `BRANCHING_UNSUPPORTED` | — | Ein Datenbank-Branch wurde über den Studio-Websocket auf der verwalteten Entwicklungsdatenbank (PGlite) angefordert, bei der ein Branch mit dem Parent *identisch ist* und nichts isoliert werden würde. Dieselbe Ablehnung wie bei `rebase db branch`. | `DATABASE_URL` auf eine eigene Postgres-Instanz verweisen (`rebase dev --docker` startet eine) und dort branchen. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` enthält mehr Operationen als das Batch-Limit (standardmäßig 1000). Ein Batch bildet eine einzige Transaktion und hält Locks über die gesamte Dauer. | In kleineren Chunks senden; die Meldung nennt das Limit und die übermittelte Anzahl. |
| `BATCH_UNSUPPORTED` | 400 | Der Treiber dieses Backends kann nicht über mehrere Collections hinweg atomar schreiben, und eine Schleife aus Einzelschreibvorgängen wäre weder atomar noch ein einzelner Roundtrip. | Schreibvorgänge als separate Anfragen oder als `/bulk`-Aufrufe pro Collection ausführen. |
| `BULK_TOO_LARGE` | 400 | Der Bulk-Body überschreitet das konfigurierte Element-Limit. | Anfrage aufteilen. |
| `BULK_UNSUPPORTED` | 400 | Diese Collection oder dieser Treiber unterstützt keine Bulk-Schreibvorgänge. | Zeilen einzeln schreiben. |
| `CALLBACK_REJECTED` | 400 / 403 | Ein Collection-Callback hat den Schreibvorgang abgelehnt. Ein `throw` in `beforeSave`/`beforeDelete`/`after*` liefert einen 400-Fehler mit der individuellen Meldung des Autors; ein `beforeDelete`, das `false` zurückgibt, liefert 403. `details.stage` benennt den Callback, `details.path` die Collection. | Meldung lesen – sie wurde von diesem Projekt verfasst, nicht von Rebase. |
| `CALLBACK_RECURSION` | 500 | Durch Hooks initiierte Schreibvorgänge waren tiefer als 16 Ebenen verschachtelt: Der `context.data`-Schreibvorgang eines Hooks löst erneut Hooks dieser Collection aus, und nichts in der Kette unterbricht dies – typischerweise ein `afterSave`, das bedingungslos seine eigene Zeile aktualisiert. Der gesamte Schreibvorgang wurde zurückgerollt. Die Meldung nennt Hook und Collection; `details.chain` listet jeden Hook-zu-Schreib-Schritt auf. | Schreibvorgang des Hooks an eine Bedingung knüpfen: nur bei `status === "new"` ausführen oder überspringen, wenn `values` den Zielwert bereits enthalten. |
| `COLLECTION_READ_ONLY` | 405 | Ein Schreibvorgang zielte auf eine Collection ab, die auf einer SQL-View (`view`) basiert. Eine View ist schreibgeschützt. | In die Tabellen schreiben, aus denen die View liest. Siehe [Views](/docs/collections/views/). |
| `SQL_NOT_ALLOWED` | 400 | Als Aufrufer ausgeführtes SQL (`getSql(c)`, `withAuth(user).sql`) war kein einfaches `SELECT`-, `WITH`-, `VALUES`-, `TABLE`-, `INSERT`-, `UPDATE`-, `DELETE`- oder `MERGE`-Statement oder rief `set_config` auf bzw. benannte `pg_settings`. Die Identität des Aufrufers wird in Sitzungseinstellungen verwaltet, weshalb Statements, die diese manipulieren könnten, abgewiesen werden. | Den Abfragetext auf ein einzelnes Statement beschränken und alle Werte über `params` übergeben. Siehe [Custom Functions](/docs/backend/custom-functions/#3-getsqlc--sql-as-the-caller). |
| `CURSOR_WITH_OFFSET` | 400 | `?after=` wurde mit `?offset=` oder `?page=` kombiniert. Ein Cursor definiert bereits, wo die Seite beginnt; ein zusätzlicher Offset würde unbemerkt Zeilen hinter dem Cursor überspringen – eine Lücke, die der Aufrufer in der Antwort nicht erkennen kann. | Entweder das eine oder das andere nutzen. |
| `DISTINCT_NOT_APPLICABLE` | 400 | `?distinct=true` wurde mit einer Such- oder Vektorabfrage kombiniert. Beide fügen jeder Zeile einen individuellen Score hinzu, sodass niemals zwei Zeilen identisch sind und `DISTINCT` nichts zusammenfassen würde – die Abfrage schiene erfolgreich, änderte aber nichts am Ergebnis. | Eine der beiden Optionen weglassen. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Ein Lesevorgang mit `distinct` wird nach einer Spalte sortiert, die nicht zurückgegeben wird. Ein `SELECT DISTINCT` kann nur nach Spalten in seiner Select-Liste sortiert werden, da zusammengefasste Zeilen andernfalls keine definierte Reihenfolge besitzen. `details.fields` nennt die Spalten. | Diese Felder zu `?fields=` hinzufügen oder aus `?orderBy=` entfernen. |
| `DATABASE_UNAVAILABLE` | 503 | Die Datenbank war nicht erreichbar: Verbindung abgelehnt oder unterbrochen, Host nicht auflösbar, Server fährt herunter oder startet, oder die Datenbank nimmt keine neuen Verbindungen an (`ALLOW_CONNECTIONS false`, was ein abgebrochenes `rebase db branch create --force` auf der Quelle hinterlassen kann; das Serverprotokoll nennt die Datenbank, `rebase db branch list` öffnet sie wieder). Jeder Einstiegspunkt liefert diesen Fehler, inklusive Anmeldung, Admin-Routen und Realtime-Socket (ein `ERROR`-Frame). Wird mit `Retry-After: 5` gesendet. | Erneut versuchen; das SDK tut dies automatisch. Prüfen, ob die Datenbank läuft und vom Server erreichbar ist. |
| `DB_CONNECTIONS_EXHAUSTED` | 503 | Der Datenbankserver hat eine neue Verbindung abgelehnt, da keine mehr frei sind (`53300` zu viele Clients, `53400` Verbindungslimit einer Rolle oder Datenbank erreicht). Alle Serverinstanzen teilen sich das `max_connections` des Servers; hierzu kommt es typischerweise bei mehreren Instanzen mit großen Pools ohne Pooler. Eine Lastsituation, kein Fehler; wird mit `Retry-After: 2` gesendet. Der Server protokolliert einmal pro Minute Abhilfemaßnahmen. | Erneut versuchen; das SDK tut dies automatisch. `DB_POOL_MAX` (oder über `REBASE_DB_POOL_MAX`) instanzübergreifend senken, einen Pooler vor die Datenbank schalten (`DATABASE_POOLED`) oder `max_connections` erhöhen. |
| `DB_CONNECT_TIMEOUT` | 503 | Der Verbindungsaufbau zur Datenbank dauerte länger als `DB_POOL_CONNECT_TIMEOUT`: Die Datenbank nimmt Verbindungen nur langsam an oder die Netzwerklatenz ist zu hoch. Wird mit `Retry-After` gesendet. | Erneut versuchen; das SDK tut dies automatisch. Datenbanklast und Netzwerkanbindung prüfen. |
| `DB_PERMISSION_DENIED` | 500 | Postgres hat das Statement abgewiesen (`42501`): Entweder verweigert eine Row-Level-Security-Policy dieser Rolle den Zugriff oder es fehlt ein `GRANT`. | Siehe [Fehlerbehebung](/docs/troubleshooting/). |
| `DB_POOL_EXHAUSTED` | 503 | Alle gepoolten Datenbankverbindungen waren über die gesamte Zeitspanne von `DB_POOL_CONNECT_TIMEOUT` ausgelastet, sodass diese Anfrage die Datenbank nie erreichte. Eine Lastsituation, kein Fehler; wird mit `Retry-After` gesendet. Der Server protokolliert einmal pro Minute Abhilfemaßnahmen. | Erneut versuchen; das SDK tut dies automatisch. `DB_POOL_MAX` erhöhen oder langsame Abfragen bzw. lange Transaktionen identifizieren, die Verbindungen blockieren. |
| `FIELD_NOT_READABLE` | 400 | Ein Filter, `orderBy`, `fields`, Aggregat-`select` oder `groupBy` benennt ein Feld, das die Rollen des Aufrufers nicht lesen dürfen (`access.read`), ein verschachtelter Pfad oder ein Aggregat-Sort benennt eine Relation, die nicht gelesen werden darf – oder eine Feldoperation (`$inc`, `$push`, …) zielt darauf ab, wobei ein abgewiesener Grenzwert den gespeicherten Wert offenbaren würde. Ein Feld, das in keiner Antwort enthalten sein darf, darf auch in keiner Abfrage analysierbar sein, da der Wert sonst Prädikat für Prädikat erraten werden könnte. Ein Filter über eine Relation (`author.salary`) und ein Aggregat-Sort über das Feld einer Relation (`max(staff.salary)`) werden nach den Regeln des Ziels bewertet. `details.violations` nennt jedes Feld. Ein per `excludeFromApi` verborgenes Feld verhält sich so, als existiere es nicht: Ein Filter, `orderBy`, `fields`, `include`, Aggregat-`select` oder -`groupBy` oder `vector_search`, der darauf zugreift, erhält exakt die Antwort eines falsch geschriebenen Namens (`UNKNOWN_FILTER_FIELD`, `UNKNOWN_ORDER_BY_FIELD`, `UNKNOWN_FIELD`, `UNKNOWN_RELATION`, `UNKNOWN_AGGREGATE_FIELD` oder `UNKNOWN_VECTOR_PROPERTY`), und keine Antwort zu unbekannten Feldern führt es auf. | Feld aus der Abfrage entfernen oder entsprechende Rolle erlangen. Siehe [Feldzugriff](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 | Der Body setzt ein Feld, das die Rollen des Aufrufers nicht schreiben dürfen (`access.write`). Wird abgewiesen statt verworfen: Ein Schreibvorgang, der ein Feld ignoriert, würde den Erfolg einer Bearbeitung melden, die gar nicht stattfand. Derselbe Code weist Schreibvorgänge über ein Parent-Objekt ab, die eine für den Aufrufer nicht beschreibbare Relation setzen, sowie Updates, die ein `softDelete`-Feld direkt auf einen Wert setzen – nur ein Löschvorgang darf diesen markieren. `details.violations` nennt jedes Feld. | Feld entfernen oder die Rolle erlangen. Ein Feld, das niemand schreiben darf, liefert stattdessen `VALIDATION_EXCLUDED_FIELDS`. |
| `FILTERED_USER_WRITE` | 400 | Ein gefiltertes Update oder Delete wurde über HTTP an die Users-Collection gesendet, deren Schreibvorgänge vor der Ausführung Benutzer für Benutzer validiert werden müssen. | Die Benutzer lesen und anschließend per ID über `updateMany`/`deleteMany` bearbeiten. |
| `FILTER_REQUIRED` | 400 | Ein gefilterter Schreibvorgang (Update oder Delete per `where`/`logical` aus dem SDK oder den Bulk-Routen) enthält keine Bedingung und würde daher alle Zeilen betreffen. Wird vor der Ausführung abgewiesen. | Bedingung hinzufügen. Um absichtlich alle Zeilen zu ändern, eine Bedingung nutzen, die auf jede Zeile zutrifft. |
| `HISTORY_UNAVAILABLE` | 503 | Ein Schreibvorgang auf eine Collection mit `history: true` wurde verweigert, da der Verlaufseintrag nicht gespeichert werden konnte: In der Datenbank fehlt die Tabelle `rebase.entity_history` oder (bei `openRebase` und `rebase console`) die Funktion `rebase.record_history`. Auf dieser Datenbank wurde noch kein Backend mit aktiviertem Verlauf gebootet. Es wurde nichts ausgeführt (auch keine Callbacks); Lesevorgänge sind nicht betroffen. Wird von `openRebase` geworfen und von einem Backend mit `provision: false` zurückgegeben. | Das Backend einmalig mit aktiviertem Verlauf und `provision: true` booten (`rebase dev` übernimmt dies), dann erneut versuchen. |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Eine frühere Anfrage mit demselben `Idempotency-Key` wird derzeit noch verarbeitet. | Nach Abschluss der ersten Anfrage erneut versuchen. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | Derselbe `Idempotency-Key` wurde für eine andere Anfrage verwendet: abweichende Methode, Pfad, Query-String oder Body. | Neuen Schlüssel verwenden oder die Originalanfrage unverändert senden. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` hat eine Funktion benannt, die keine Aggregatfunktion ist (`count`, `sum`, `avg`, `min`, `max`, `countDistinct`, `mode`, `percentile`, `distinct`, `fingerprint`). | Eine der genannten Funktionen verwenden; die Meldung listet sie auf. |
| `INVALID_AGGREGATE_GROUP` | 400 | Eine `groupBy`-Transformation ist unbekannt oder lässt sich nicht auf die Spalte anwenden: `year`/`month`/`day` auf einer Nicht-Datumsspalte, `unnest` auf einer Nicht-Array-Spalte. | `lower`, `upper`, `year`, `month`, `day` oder `unnest` auf einer Spalte des passenden Typs nutzen. |
| `INVALID_AGGREGATE_SELECT` | 400 | Ein Eintrag in `?select=` entspricht nicht `fn(field)`; einer Funktion außer `count()` oder `fingerprint()` wurde kein Feld übergeben; bei `percentile` fehlt ein Bruchwert zwischen 0 und 1; oder `fingerprint()` wurde auf einer normalen View aufgerufen, die keine Zeilen speichert. | `sum(total)`, `count()`, `percentile(price,0.95)` schreiben. |
| `INVALID_AGGREGATE_WINDOW` | 400 | `offset`, `page` oder `orderBy` bei einem Aggregat ohne `groupBy`, oder ein Cursor auf irgendeinem Aggregat. Ein ungruppiertes Aggregat ist genau eine Zeile, und eine Gruppe ist keine Zeile, nach der ein Cursor fortgesetzt werden kann. | `groupBy` hinzufügen oder die Parameter weglassen; Gruppen per `offset` oder `page` paginieren. Siehe [Aggregate](/docs/sdk/aggregates-and-search/#aggregates). |
| `INVALID_BATCH_BODY` | 400 | Bei einer `/_batch`-Operation fehlen `op`, `collection`, `values` oder `id`, sie benennt eine nicht existierende Collection oder verwendet einen `ref`-Namen doppelt. | Siehe Meldung; sie nennt die Operation nach Index. |
| `INVALID_BATCH_REF` | 400 | Ein `{ "$ref": "<name>.<field>" }` verweist auf keine frühere Operation, verweist nach vorne oder fragt ein Feld ab, das die referenzierte Zeile nicht besitzt. Nur Rückwärtsreferenzen sind auflösbar. | Die referenzierte Operation per `ref` benennen, *bevor* darauf verwiesen wird. |
| `INVALID_BULK_BODY` | 400 | Der Bulk-Body entspricht nicht der erwarteten Struktur. | Das von der Route geforderte Array senden: `{ "rows": [...] }` an `POST /bulk`, `{ "updates": [{ "id", "data" }] }` an `PATCH /bulk`, `{ "ids": [...] }` an `POST /bulk/delete`. |
| `INVALID_CONFLICT_RULE` | 400 | Die Konfliktregel eines Upserts (Duplikate beibehalten oder nur bei einem `where` ersetzen) wurde ohne `upsert: true` gesendet, oder beide Regeln wurden zusammen übermittelt. | `upsert: true` und genau eine der beiden Regeln senden. |
| `INVALID_CONFLICT_TARGET` | 400 | Das `on_conflict` / `onConflict` eines Upserts benennt Spalten ohne Eindeutigkeitsgarantie (Unique Constraint), wird ohne `upsert: true` übergeben oder bei einem verschachtelten Erstellvorgang genutzt, bei dem eine gematchte Zeile unter das neue Parent-Element verschoben würde. Postgres würde andernfalls einen 42P10-Fehler innerhalb einer bereits aktiven Transaktion werfen. Gilt auch für Upserts auf der Users-(Auth-)Collection, bei der Create und Update unterschiedlichen Regeln folgen. | `validation: { unique: true }` oder einen `unique`-Index deklarieren; die Meldung listet vorhandene Targets auf. Bei der Users-Collection `POST` zum Erstellen und `PATCH` zum Aktualisieren nutzen. |
| `INVALID_COUNT` | 400 | `?count=` ist weder `exact` noch `none`. Wird abgewiesen statt als Standardwert interpretiert: Ein Tippfehler wie `?count=nnone` würde sonst die Rechenleistung für den Count aufwenden, den er eigentlich überspringen sollte. | `exact` (Standard) oder `none` übergeben. Siehe [Count überspringen](/docs/backend/api/#skipping-the-count). |
| `INVALID_CURSOR` | 400 | Der `after`-Cursor kann nicht gelesen werden oder nennt eine Zeilen-ID, die nicht zu den Schlüsselspalten der Collection passt: Er wurde abgeschnitten, neu kodiert oder manuell erstellt. Ein lesbarer Cursor mit einem abweichenden `orderBy` führt zu `CURSOR_ORDER_MISMATCH` (ebenfalls 400). | `meta.nextCursor` der vorherigen Seite unverändert mit demselben oder keinem `orderBy` übergeben. Siehe [Paginierung](/docs/sdk/pagination/). |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` ist weder `include` noch `only`. Wird abgewiesen statt ignoriert: Ein Tippfehler wie `?deleted=true`, der gelöschte Zeilen stillschweigend ausblendet, würde scheinbar funktionieren, aber das Gegenteil liefern. | `include` (aktive und gelöschte) oder `only` (ausschließlich gelöschte) senden. Für rein aktive Zeilen weglassen. |
| `INVALID_DISTINCT` | 400 | `?distinct=` ist weder `true` noch `false`. | Einen dieser Werte senden; `1` und `0` werden ebenfalls akzeptiert. |
| `INVALID_FIELD_OPERATION` | 400 | `$inc` / `$push` / `$pull` / `$merge` wurde auf einem Property-Typ verwendet, für den es nicht definiert ist, mit einem Operanden des falschen Typs, mit zwei Operatoren auf einem Feld, falsch geschrieben oder bei einem Erstellvorgang (wo kein gespeicherter Wert existiert). | Siehe [Schreiben über REST](/docs/backend/writes/#field-operations); die Meldung nennt das Feld. |
| `INVALID_FILTERED_WRITE` | 400 | Ein gefilterter Schreibvorgang zielte auf einen Pfad über eine Relation ab (`posts/1/comments`) oder benannte gar keine Collection. | In die verknüpfte Collection mit einem Filter auf deren Verknüpfung schreiben. |
| `INVALID_FILTER_FIELD` | 400 | Der Filter benennt ein Property, das diese Collection nicht besitzt. | Schreibweise mit der Collection abgleichen. |
| `INVALID_FILTER_OPERATOR` | 400 | Der Operator wird von diesem Property-Typ nicht unterstützt – beispielsweise `like` auf einer Zahl oder einem Datum. | Siehe [Daten abfragen](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | Ein Filterwert kann nicht in den Typ der verglichenen Spalte konvertiert werden: `?id=eq.abc` bei einem Integer-Schlüssel, ein Label außerhalb des Enums, ein ungültiger Timestamp oder eine Zahl außerhalb des Wertebereichs. `details.dbCode` enthält den SQLSTATE. | Einen typkompatiblen Wert für die Spalte übergeben. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` ist weder `true` noch `false`. Alles andere wird abgewiesen statt als "nein" interpretiert – ein Tippfehler, der Soft-Delete ausführt, obwohl der Aufrufer endgültig löschen wollte, ließe diesen fälschlicherweise glauben, die Daten seien bereinigt. | `true` oder `false` senden. |
| `INVALID_INCLUDE` | 400 | `?include=` ist fehlerhaft: keine gültige Pfadliste oder ein Relation-Options-Objekt mit falscher Struktur. Ein mehr als drei Hops tiefer Pfad führt zu `INCLUDE_TOO_DEEP` (ebenfalls 400). Wird an der Schnittstelle abgefangen, anstatt als 500-Fehler aus dem Treiber zu entkommen. | Siehe Meldung; sie nennt den fehlerhaften Pfad. |
| `INVALID_INPUT` | 400 | Der Body hat die Validierung nicht bestanden. | Siehe Meldung. |
| `INVALID_LIMIT` | 400 | `?limit=` ist keine ganze Zahl von 1 bis zum Maximum (standardmäßig 1000); ein größerer Wert wird abgewiesen und nicht automatisch gekappt. Eine Realtime-Subscription mit einem Limit außerhalb dieses Bereichs erhält denselben Code als WebSocket-`ERROR`-Frame. | Limit reduzieren und die restlichen Daten paginieren. |
| `INVALID_LOGICAL_GROUP` | 400 | Eine `?or=`- / `?and=`- / `?not=`-Gruppe ist fehlerhaft oder überschreitet die maximal erlaubte Verschachtelungstiefe. | Siehe Meldung; sie zeigt die Glättungsregel. |
| `INVALID_OFFSET` | 400 | `?offset=` ist keine ganze Zahl größer oder gleich 0. | Eine nicht-negative Ganzzahl senden. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` entspricht nicht `field`, `field:desc`, `field:desc:last` oder einem JSON-Array von `{ field, direction, nulls }` – oder gibt eine andere Richtung als `asc`/`desc` bzw. eine andere NULL-Platzierung als `first`/`last` an. | Siehe Meldung; sie listet alle gültigen Schreibweisen auf. |
| `INVALID_PAGE` | 400 | `?page=` ist keine ganze Zahl größer oder gleich 1. Seiten sind 1-basiert; `?page=0` ist ein Fehler und nicht die erste Seite. | `1` oder höher senden, oder `?offset=` verwenden. |
| `INVALID_PARAM` | 400 | Ein Query-Parameter ist fehlerhaft aufgebaut. | Siehe Meldung. |
| `INVALID_QUERY_BODY` | 400 | Der Body von `POST …/query` enthält Werte, die die URL nicht transportieren könnte: eine Liste für einen Einmal-Parameter (`fields`, `limit`, …), ein Objekt für einen Filter, oder Parameter wurden zusätzlich in der URL angegeben – `POST …/query` liest ausnahmslos alle Parameter aus dem Body. | Werte wie in der URL formatieren – als String oder Liste für wiederholte Filter; `where`, `include`, `orderBy` und `vector` erwarten JSON. Siehe [Zu lange Abfragen für URLs](/docs/backend/vector-search/#queries-too-long-for-a-url). |
| `INVALID_VECTOR` | 400 | `?vector=` ist kein JSON-Array aus Zahlen. | `[0.1,0.2,0.3]` senden. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` ist weder `cosine`, `l2` noch `inner_product`. | Einen dieser drei Werte verwenden. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` ist keine Zahl. | Eine Zahl übermitteln. |
| `INVALID_WHERE` | 400 | `?where=` ist kein JSON-Objekt, das Felder auf Bedingungen mappt. | `{"status":["==","active"]}` senden. |
| `KEY_IMMUTABLE` | 400 | Ein Update benennt den Zeilenschlüssel mit einem anderen Wert als dem, über den sie adressiert wird – im Body oder durch ein `beforeSave`. Eine Zeile kann nicht auf einen neuen Schlüssel verschoben werden: Jeder nachfolgende Schritt (Rücklesen, `afterSave`, Verlauf, Realtime) adressiert sie über den bisherigen Schlüssel. Wird an allen Schnittstellen vor Ausführung jeglicher Hooks abgewiesen, ohne dass Daten geschrieben werden. `details.violations` nennt das Feld. | Zeile unter dem neuen Schlüssel anlegen und die alte löschen. Den unveränderten Schlüssel mitzusenden ist erlaubt. |
| `MISSING_AGGREGATE_SELECT` | 400 | Die Aggregat-Route wurde ohne `?select=` aufgerufen. | Parameter hinzufügen, z. B. `?select=count()`. |
| `NOT_A_MATERIALIZED_VIEW` | 400 | `refresh()` wurde auf einer Collection aufgerufen, die keine Materialized View darstellt. | Nur Collections mit `view: { materialized: true }` aktualisieren. |
| `NO_COLLECTIONS` | 404 | Das Projekt stellt keine Collections bereit: keine im Code deklariert und keine Tabellen vorhanden, aus denen sie abgeleitet werden könnten. Wenn Tabellen existieren, auf ihnen aber Row-Level Security deaktiviert ist, nennt die Meldung diese Tabellen samt SQL zur Aktivierung, und `details.unprotectedTables` listet sie auf. | Tabellen anlegen – per Migration, SQL oder Collection-Datei plus `rebase db push` – und neu starten. |
| `NOT_FOUND` | 404 | Keine Zeile mit dieser ID in der Collection gefunden – oder eine Zeile, die durch Row-Level Security vor diesem Aufrufer verborgen wird. | Zuerst die ID, dann die `securityRules` der Collection prüfen. |
| `UNKNOWN_RELATION` | 400 / 404 | `?include=` benennt eine Relation, die in der Collection nicht existiert. Derselbe Code antwortet mit **404**, wenn ein verschachtelter *URL-Pfad* eine solche benennt, z. B. `/api/data/authors/1/posts`, wenn `authors` keine definiert – dort adressiert die URL nichts, weshalb es sich um einen Not-Found- und keinen Bad-Request-Fehler handelt. | Relationsnamen prüfen – die Meldung listet die vorhandenen auf. Eine Rückwärtsreferenz muss auf dem Parent deklariert sein, um traversierbar zu sein. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | Die Sortierung bezieht sich auf ein Property, das nicht sortierbar ist. | Nach einem spaltenbasierten Property sortieren. |
| `PAGE_WITH_OFFSET` | 400 | `?page=` wurde mit `?offset=` kombiniert – oder `page` mit `offset` in einem `find()`, was das Client-SDK, das prozessinterne `rebase.data` und der Offline-Client vor jeder Anfrage mit demselben Code abweisen. Beide Parameter beschreiben denselben Fensterausschnitt; früher überschrieb `page` stillschweigend ein `offset`, das der Aufrufer dann nie angewendet sah. | Nur einen der beiden Parameter übergeben. |
| `PAYLOAD_TOO_LARGE` | 413 | Der Body überschreitet das konfigurierte Limit. | Weniger Daten senden oder das Limit anheben. |
| `READ_ONLY_TRANSACTION` | 409 | Ein `afterRead`-Callback hat versucht zu schreiben. Ein anfragebezogener Lesevorgang läuft in einer `READ ONLY`-Transaktion; weder der Callback noch von ihm aufgerufene Funktionen dürfen schreiben. | Schreibvorgang aus dem Lesevorgang auslagern: Background-Job oder `rebase.dataAsAdmin` aus einem Cron-Job bzw. einer Custom Function. |
| `REFRESH_NOT_SUPPORTED` | 501 | `POST /api/data/<slug>/refresh` erreichte einen Datentreiber ohne Materialized Views. | Auf diesem Backend gibt es nichts zu aktualisieren. |
| `RELATION_HAS_NO_PIVOT` | 400 | Der Schreibvorgang enthielt Link-Nutzdaten, aber der Pfad erreicht sein Ziel nicht über ein `manyToMany`, das `through.properties` deklariert – es gibt somit keine Zwischentabelle, an die Daten angehängt werden könnten. | `through.properties` an der Relation deklarieren oder die Nutzdaten aus dem Schreibvorgang entfernen. Siehe [Relationen](/docs/collections/relations/). |
| `RELATION_MISCONFIGURED` | 500 | Eine Relation kann gegen das registrierte Schema nicht aufgelöst werden. Die Operation wird verweigert statt übersprungen: Ein Weglassen würde Erfolg für einen nicht ausgeführten Schreibvorgang vortäuschen oder leere Ergebnisse für tatsächlich vorhandene Zeilen liefern. | `rebase schema generate` ausführen, falls das generierte Schema älter als die Datenbank ist. |
| `RELATION_NOT_UNLINKABLE` | 400 | Die Relation kann von dieser Seite aus nicht getrennt werden. | Von der besitzenden Seite aus schreiben. |
| `RELATION_NOT_WRITABLE` | 400 | Der verschachtelte Pfad ist keine beschreibbare Relation, oder eine Erstellung bzw. Aktualisierung nennt eine mehrstufige `via`-Relation – nur einstufige `via`-Relationen sind beschreibbar. `details.fields` listet die `via`-Schlüssel auf. Es wurden keine Daten geschrieben. | Die Zeilen, die die Kette verbindet, direkt schreiben. Siehe [Relationen](/docs/collections/relations/#via--an-explicit-join-chain). |
| `RELATION_PIVOT_UNSUPPORTED` | 400 | Die Relation deklariert Zwischentabellenspalten, aber diese Datenquelle unterstützt das Schreiben darauf nicht. | Die Verknüpfung selbst funktioniert; lediglich zusätzliche Nutzdaten darauf werden nicht unterstützt. Treiberfähigkeiten prüfen. |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | Einem Relations-Schreibvorgang fehlte der Quellschlüssel zur Zuordnung des Links. | Zuerst die übergeordnete Zeile (Parent) speichern. |
| `RESULT_TOO_LARGE` | — | Ein über `EXECUTE_SQL` des Realtime-Sockets gesendetes Statement – `admin.executeSql` eines Clients, Katalogabfragen des Admin-Panels – lieferte mehr als 128 MB an Zeilen zurück, weshalb das Ergebnis verworfen wurde. Wird als WebSocket-`ERROR`-Frame übermittelt. Ausführungen der SQL-Konsole selbst werden nicht blockiert: Sie zeigen die ersten Zeilen an. | `LIMIT` ergänzen oder weniger Spalten abfragen und das Ergebnis in Teilen lesen. |
| `ROW_IN_TRASH` | 409 | Der Schlüssel eines Upserts gehört zu einer Zeile im Papierkorb (eine per Soft-Delete gelöschte Zeile belegt ihren Schlüssel weiterhin). Ein Upsert schreibt an keinem Einstiegspunkt in eine gelöschte Zeile: REST `?on_conflict=`, `/bulk`- und `/_batch`-Upserts, SDK und Realtime-Socket. Es wurden keine Daten geschrieben. | Zeile zuerst wiederherstellen (Update setzt Soft-Delete-Feld auf `null`) oder per `?hard=true` endgültig bereinigen und das Upsert wiederholen. Siehe [Soft Delete](/docs/collections/soft-delete/). |
| `SCHEMA_DRIFT` | 500 | Eine vom Code erwartete Tabelle oder Spalte existiert in der Datenbank nicht. | In der Entwicklung `rebase db push` ausführen; auf einem verwalteten Tenant neu deployen. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | `startAfter` wurde mit `orderBy: "_score"` kombiniert. Relevanz wird pro Abfrage berechnet und nicht gespeichert; sie eignet sich daher nicht als Cursor-Schlüssel. | Relevanzergebnisse per `limit`/`offset` paginieren oder nach einer Spalte sortieren. |
| `SQL_ERROR` | 400 | Die Datenbank hat vom Benutzer verfasstes SQL abgewiesen. Über `EXECUTE_SQL` des Realtime-Sockets wird ein `ERROR`-Frame mit der Meldung der Datenbank zurückgegeben. `POST /api/admin/sql/csv` liefert diesen Fehler, bevor Daten gesendet werden: Syntaxfehler, Schreibvorgang (Download läuft read-only), mehr als ein Statement oder eine für die Verbindung unzulässige Rolle. | SQL korrigieren. Ein Download akzeptiert genau ein `SELECT`, `WITH … SELECT`, `TABLE` oder `VALUES`. |
| `VIEW_NOT_READABLE` | 403 | Ein Aufrufer ohne eine der in `view.roles` hinterlegten Rollen hat eine Materialized View gelesen oder deren Aktualisierung angefordert. Materialized Views haben keine Row-Level Security; sie werden vollständig und ausschließlich an diese Rollen ausgeliefert. | Mit einer berechtigten Rolle lesen oder die Rolle des Aufrufers in `view.roles` eintragen. |
| `TENANT_IMMUTABLE` | 400 | Ein Schreibvorgang würde eine Zeile von einem Mandanten zu einem anderen verschieben. Eine Zeile kann ihren Mandanten nicht wechseln. `details.violations` nennt das Feld. Ein Trigger setzt dieselbe Regel in der Datenbank durch; als Aufrufer ausgeführtes SQL schlägt daher mit Postgres-Fehler `42501` und einer Meldung fehl, die mit `TENANT_IMMUTABLE` beginnt. | Zeile im Zielmandanten neu anlegen und alte löschen, oder mit einer Rolle in `tenant.bypassRoles` schreiben. |
| `TENANT_MISMATCH` | 400 | Der Schreibvorgang benennt einen Mandanten, zu dem der Aufrufer nicht gehört; die Datenbank würde dies ebenfalls verweigern. | In den Mandanten des Aufrufers schreiben oder sich als zugehöriger Mandant authentifizieren. |
| `TENANT_REQUIRED` | 400 | Die Collection ist mandantenabhängig und der Mandant kann nicht abgeleitet werden: Die Anfrage enthält keinen Mandanten oder der Aufrufer gehört mehreren an. | Mandantenfeld explizit übergeben oder als Aufrufer authentifizieren, der genau einem Mandanten zugeordnet ist. |
| `TRANSACTION_ABORTED` | 500 | Ein Statement in der Transaktion des Schreibvorgangs schlug fehl und ein Callback hat den Fehler abgefangen. Postgres hatte die Transaktion zu diesem Zeitpunkt bereits abgebrochen, sodass der Schreibvorgang zurückgerollt und nichts gespeichert wurde. Nur ein von der Datenbank abgewiesenes `context.data`-Create, -Update oder -Delete wird isoliert rückgängig gemacht und kann gefahrlos abgefangen werden. | Den Fehler werfen lassen oder Vorbedingungen vor der Ausführung des Statements prüfen. Siehe [Transaktionssemantik](/docs/collections/context-data-api/#transaction-semantics). |
| `UNKNOWN_FIELD` | 400 | `?fields=` benennt ein Feld, das in der Collection nicht existiert. | Schreibweise prüfen; die Meldung listet gültige Felder auf. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Ein Aggregat oder `groupBy` benennt ein Feld, das in der Collection nicht existiert. | Schreibweise prüfen; die Meldung listet gültige Felder auf. |
| `UNKNOWN_FILTER_FIELD` | 400 | Der Filter benennt ein Feld, das in dieser Collection – oder dem Ziel einer Relation – nicht existiert, oder eines, das per `excludeFromApi` ausgeblendet ist. | Schreibweise prüfen; die Meldung listet gültige Felder auf. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | Der Filter benennt einen Operator, der nicht existiert. | Die Meldung listet alle verfügbaren Operatoren auf. |
| `UNKNOWN_MESSAGE_TYPE` | 400 | Ein Frame des Realtime-Sockets hat einen `type`, den der Server nicht verarbeiten kann. Wird als `ERROR`-Frame mit der `requestId` der Anfrage beantwortet, damit die Anfrage abgeschlossen wird statt in einen Timeout zu laufen. | `type` des Frames prüfen; die Meldung nennt den Typ. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | Die Sortierung bezieht sich auf ein Feld, das in dieser Collection nicht existiert. | Schreibweise prüfen; die Meldung listet gültige Felder auf. |
| `PRECONDITION_FAILED` | 412 | Ein `If-Match` benannte eine Version der Zeile, die nicht mehr aktuell ist: Zwischen dem Lesen und diesem Schreibvorgang wurde die Zeile verändert. Es wurden keine Daten geschrieben. | Zeile neu einlesen, Änderungen erneut anwenden und mit dem neuen `ETag` senden. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` fordert ein Feld an, das in der Collection nicht existiert. | Schreibweise prüfen; die Meldung listet bekannte Felder auf. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Eine Vektorsuche bezog sich auf ein Property, das in dieser Collection kein `vector` ist. | Die Meldung listet die Vektor-Properties der Collection auf. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Der `Content-Type` wird von dieser Route nicht unterstützt. | Den in der Routendokumentation spezifizierten Typ senden. |
| `UNSUPPORTED_OPTION` | — | Wird geworfen, nicht als HTTP-Fehler beantwortet: Ein Schreibvorgang über den prozessinternen Accessor (`context.data` in einem Callback, `rebase.data` in einer Funktion oder einem Cron) enthielt `ifMatch` oder `idempotencyKey`. An dieser Schnittstelle gibt es weder Precondition-Checks noch Idempotenz-Speicher; die Option wird vor dem Schreiben abgewiesen statt ignoriert. | Option an dieser Stelle weglassen oder über den HTTP-Client schreiben, der beides unterstützt. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | Der Filter traversiert eine `via`-Relation, deren Join-Pfad nur unidirektional definiert ist, weshalb keine Korrelation für eine Unterabfrage hergestellt werden kann. | Von der besitzenden Seite aus filtern. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | Der Operator ist für dieses Feld nicht definiert: Eine Relation ohne Spalte in dieser Zeile wird über Mitgliedschaft gefiltert, und Musterabgleiche (`like`, `ilike` und deren Negationen) funktionieren nur auf Text. | Siehe Meldung; sie listet auf, was das Feld akzeptiert. |
| `VALIDATION_CONSTRAINT` | 400 | Ein Wert hat eine vom Property deklarierte `validation`-Regel verletzt – Länge, Wertebereich, Muster, Pflichtfeld. | Siehe Meldung; sie nennt die verletzten Regeln. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | Der Body schreibt in eine Spalte mit `excludeFromApi` oder `access: { write: [] }` – dieselbe Regel in zwei Schreibweisen. Diese Felder sind rein servergesteuert: Passwort-Hashes, Verifizierungs-Tokens. Anders als bei `FIELD_NOT_WRITABLE` ist dies die Antwort für alle Aufrufer, inklusive `admin`. | Feld aus dem Request entfernen. Siehe [Feldzugriff](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | Ein Wert passt nicht zum Typ des Propertys. | Siehe Meldung; sie nennt das Property. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | Der Body benennt ein Feld, das die Collection nicht besitzt – inklusive eines `id`-Arguments bei einer Collection, die über ein anderes Feld geschlüsselt ist. | Schreibweise prüfen; die Meldung listet bekannte Felder auf. |
| `VECTOR_CURSOR_UNSUPPORTED` | 400 | Ein Cursor (`after` / `startAfter`) wurde mit einer Vektorsuche kombiniert. Zeilen werden nach einer distanzbezogenen Relevanz sortiert, die dynamisch berechnet wird und sich nicht als Cursor eignet; eine Vektor-Auflistung liefert daher kein `nextCursor`. | Die am nächsten liegenden Zeilen per `limit`/`offset` paginieren. |
| `WRITE_DENIED` | 403 | Eine Sicherheitsregel oder Row-Level-Security-Policy hat den Schreibvorgang abgelehnt. | `securityRules` der Collection prüfen. |

## `PG_<SQLSTATE>` — vom Datenbankserver abgewiesenes Constraint

Ein Schreibvorgang, den Postgres aus Gründen ablehnt, die in den *Daten des Aufrufers* liegen,
antwortet mit dem SQLSTATE im Code: `PG_23505`, `PG_23503` usw. Dies ist eine Familie
und keine feste Liste – Postgres definiert hunderte von SQLSTATEs –, aber nur zwei
Klassen erreichen diesen Endpunkt, da nur diese auf Fehler des Aufrufers zurückzuführen sind:

- **Klasse 23**, Verletzung von Integritäts-Constraints: ein Duplikat, ein Fremdschlüssel,
  der ins Leere läuft, eine NOT-NULL-Spalte ohne Wert;
- **Klasse 22**, Daten-Ausnahme (Data Exception): ein Wert, der nicht in den Spaltentyp passt.

Alles andere – Verbindungsabbrüche, fehlende Spalten, Berechtigungsprobleme –
liegt in der Verantwortung des Servers und bleibt ein `500`. Daher ist `code.startsWith("PG_")` eine zuverlässige
Prüfung für "die übermittelte Zeile war fehlerhaft", und die vier folgenden Codes sind jene,
auf die Clients in der Praxis treffen. `details.dbCode` enthält bei allen denselben SQLSTATE, und
die Meldung benennt das konkrete Constraint.

| Code | Status | Bedeutung | Maßnahme |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | Ein Wert konnte nicht als Typ der Spalte interpretiert werden – das schreibende Gegenstück zu `INVALID_FILTER_VALUE`. | Einen typkompatiblen Wert für die Spalte übergeben. |
| `PG_23502` | 400 | Eine `NOT NULL`-Spalte wurde leer gelassen. | Feld übermitteln oder der Spalte einen Standardwert geben. |
| `PG_23503` | 400 / 409 | Beim Speichern verweist ein Fremdschlüssel auf eine nicht existente Zeile (400). Beim Löschen verweisen andere Zeilen noch auf diese Zeile (409; ein `RESTRICT`-Schlüssel löst `PG_23001` aus, ebenfalls 409). | Zielzeile zuerst anlegen bzw. ID korrigieren; beim Löschen zuerst die referenzierenden Zeilen entfernen oder umhängen. |
| `PG_23505` | 409 | Ein Unique-Constraint wurde verletzt. Die Meldung nennt das Constraint. | Einen anderen Wert verwenden oder die bestehende Zeile aktualisieren. |

## Storage

| Code | Status | Bedeutung | Maßnahme |
| --- | --- | --- | --- |
| `INVALID_LIST_OPTIONS` | 400 | Das `maxResults` einer Storage-Auflistung ist keine ganze Zahl von mindestens 1, oder sein `pageToken` stammt nicht von dieser Quelle. Eine Seitengröße unter 1 lieferte früher eine leere Seite mit demselben Token zurück, sodass eine `while (pageToken)`-Schleife nie endete. | Positives `maxResults` senden und `nextPageToken` unverändert zurückgeben. |
| `INVALID_STORAGE_BUCKET` | 400 | Der Bucket-Name ist ungültig. | Namen überprüfen. |
| `INVALID_STORAGE_KEY` | 400 | Der Objekt-Key ist ungültig, bricht aus seinem Prefix aus oder liegt unter einem reservierten Prefix (`_rebase/renditions/`, `_rebase/maintenance/`). | Key überprüfen. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | Die Parameter für die Bildtransformation liegen außerhalb des Wertebereichs oder widersprechen sich. | Siehe [Storage](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | Der Upload überschreitet das im Ziel-Property definierte `maxSize`. Wird auf dem Server erzwungen, nicht nur im Browser. `details` enthält Property, Limit und tatsächliche Dateigröße. | Kleinere Datei hochladen oder `maxSize` im Property erhöhen. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | Der Dateityp des Uploads ist nicht in den `acceptedFiles` des Propertys oder nicht in den `allowedMimeTypes` der Storage-Quelle enthalten. `details` nennt das Property (oder die Liste der Quelle), die erlaubte Liste und den gesendeten Content-Type. | Einen zulässigen Typ hochladen oder `acceptedFiles` / `allowedMimeTypes` erweitern. |
| `STORAGE_MISCONFIGURED` | 502 | Der für diese Quelle konfigurierte S3- oder GCS-Bucket existiert nicht, oder der Provider hat die Anmeldedaten dieses Deployments dafür abgelehnt. Die Meldung nennt den Bucket; `details.reason` ist `NoSuchBucket` oder die Ablehnung des Providers. Ein fehlender Bucket wurde früher bei jeder Datei als "file not found" interpretiert. | Bucket-Namen (`S3_BUCKET` / `GCS_BUCKET`, `__<KEY>` für benannte Quellen) oder Berechtigungen der Zugangsdaten korrigieren. |
| `STORAGE_NOT_CONFIGURED` | 501 / 503 | Auf diesem Server ist kein Storage-Backend konfiguriert, oder keines ist als Standard definiert und die Anfrage benennt keine Quelle; die Meldung nennt die verfügbaren Quellen (501). Ein fortsetzbarer Upload, dessen Quelle vor dem Abschluss verschwunden ist, ergibt einen 503. | S3, GCS oder lokalen Speicher konfigurieren, oder Quelle per `?storageId=` angeben. |
| `STORAGE_SAME_LOCATION` | 400 | `POST /api/admin/storage/move` mit `deleteSource` (`rebase storage move --delete-source`) zwischen zwei Quellen, die denselben Bucket oder dasselbe Verzeichnis nutzen. Jede Datei würde als bereits im Ziel vorhanden gewertet, da es dieselbe Datei ist; das Löschen der Quellkopie würde die einzige Datei löschen. Es wurde nichts verschoben oder gelöscht. | Das Property direkt auf die andere Quelle verweisen; die Dateien liegen bereits dort. |
| `STORAGE_SCAN_INCOMPLETE` | 409 | `DELETE /api/admin/storage/orphans` (`rebase storage orphans --delete`) konnte nicht alle Collections lesen, sodass eine darin referenzierte Datei fälschlicherweise als ungenutzt erscheinen würde. Bei Angabe von `?scan=` war der angegebene Scan derjenige, der nicht alle Collections lesen konnte. Es wurde nichts gelöscht; `details.unscanned` nennt jede Collection und den Grund, warum sie nicht lesbar war. | Ursache beheben, die das Lesen der Collections verhindert, und den Befehl erneut ausführen. |
| `STORAGE_SCAN_NOT_FOUND` | 404 | `GET /api/admin/storage/orphans/scans/:id` oder `DELETE /api/admin/storage/orphans?scan=:id` benennt einen Scan, der in der Quelle nicht existiert. Scans werden 7 Tage lang in der gescannten Quelle aufbewahrt; eine abweichende `storageId` findet den Scan daher ebenfalls nicht. | Die `storageId` des Scans übergeben oder einen neuen Scan starten. |
| `STORAGE_SCAN_NOT_COMPLETE` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` benennt einen Scan, der noch den Status `queued` oder `running` hat oder der auf `failed` steht. Es wurde nichts gelöscht; `details.status` nennt den Status. | Auf den Abschluss des Scans warten oder einen neuen starten. |
| `STORAGE_SCAN_EXPIRED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` benennt einen Scan, der vor mehr als 15 Minuten abgeschlossen wurde. Es wurde nichts gelöscht. | Neuen Scan starten und auf dessen Basis löschen. |
| `STORAGE_SCAN_DELETION_STARTED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` benennt einen Scan, dessen verwaiste Dateien bereits gelöscht werden. | Den Löschfortschritt über `GET /api/admin/storage/orphans/scans/:id` im Feld `deletion` abrufen. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | Die Storage-Quelle ist deklariert, verfügt hier jedoch über keine Zugangsdaten. | Die Umgebungsvariablen für diese Quelle konfigurieren. |
| `STORAGE_WRITE_FAILED` | 502 | Das Storage-Backend hat den Schreibvorgang verweigert oder abgebrochen. | Logs und Zugangsdaten des Storage-Backends prüfen. |
| `TRANSFORM_OVERLOADED` | 503 | Zu viele gleichzeitige Bildtransformationen aktiv. | Erneut versuchen; den Einsatz eines vorgelagerten CDN prüfen. |
| `UNKNOWN_STORAGE_SOURCE` | 400 / 404 | Die Anfrage hat eine Storage-Quelle benannt (`?storageId=`), die in diesem Projekt nicht deklariert ist. Ein `bucket`, den dieses Deployment nicht bedient, liefert denselben Code mit **404** (bei einer Auflistung, einem Upload, einem Ordner oder einem fortsetzbaren Upload zu S3 oder GCS) – der Speicherort selbst fehlt, und `details` nennt die existierenden Buckets und Quellen. Beides wurde früher als "file not found" zurückgemeldet, identisch zu einem nicht existierenden Dateischlüssel. | Die Quelle in `config/resources.ts` deklarieren oder `GET /api/storage/sources` abfragen. |
| `UPLOAD_LOCKED` | 423 | Ein `PATCH` für einen fortsetzbaren Upload traf ein, während ein anderer Chunk desselben Uploads noch empfangen wurde – fast immer bedingt durch einen Client, der den laufenden Chunk erneut sendet. Die Anfrage wird abgewiesen statt eingereiht, analog zu tusd. | Den aktuellen Offset per `HEAD /api/storage/tus/:id` erfragen und von dort fortsetzen; der tus-js-client pausiert und versucht es automatisch erneut. Siehe [Fortsetzbare Uploads (TUS)](/docs/backend/storage-resumable-uploads/). |

## Custom Functions

| Code | Status | Bedeutung | Maßnahme |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | Es wird keine Funktion dieses Namens bereitgestellt – oder sie existiert, deckt aber den Pfad dahinter nicht ab. Einem angemeldeten Aufrufer wird mitgeteilt, was *tatsächlich* bereitgestellt wird; einem anonymen Aufrufer nicht, da diese Liste ein Verzeichnis aller benutzerdefinierten Endpunkte darstellt. Konnte eine Datei dieses Namens nicht geladen werden, erfährt ein angemeldeter Aufrufer dies inklusive des Dateinamens: Das unterscheidet einen Tippfehler von einem fehlerhaften Deployment. Ein anonymer Aufrufer erhält die neutrale Meldung für unbekannte Namen. | Namen mit `GET /api/functions` abgleichen oder das Startprotokoll auf nicht ladbare Dateien prüfen. |
| `FUNCTION_TIMEOUT` | 504 | Der Handler hat sein Zeitlimit überschritten. Er läuft im Hintergrund weiter und kann von hier aus nicht abgebrochen werden. | Ausgehenden Aufrufen ein `AbortSignal` mitgeben oder `REBASE_FUNCTIONS_TIMEOUT_MS` erhöhen. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Dieser Prozess leitet Functions per Proxy an einen anderen weiter, der nicht geantwortet hat. | Sicherstellen, dass die Functions-Instanz ausgeführt wird. |

## Cron-Jobs

| Code | Status | Bedeutung | Maßnahme |
| --- | --- | --- | --- |
| `CRON_JOB_ALREADY_EXECUTING` | 409 | Ein manueller Trigger für einen Cron-Job, der bereits läuft – auf dem antwortenden Prozess oder auf einem anderen Prozess, der den Ausführungs-Lease des Jobs hält (z. B. der Worker hinter einem `api`-Prozess). Es wurde nichts ausgeführt. Das Überspringen wird im Verlauf des Jobs festgehalten; `details.log` enthält diesen Eintrag und nennt den ausführenden Prozess. | Erneut versuchen, sobald der laufende Durchlauf beendet ist. Siehe [Cron-Jobs](/docs/backend/cron-across-instances/#concurrency-guarding). |

## Administrationsbereich und Schema-Bearbeitung

Diese Fehler bedeuten, dass ein Feature deaktiviert oder nicht konfiguriert ist, nicht dass die Anfrage
fehlerhaft war. Jeder dieser Zustände wird auf der zugehörigen `/status`-Route mit einem `200` gemeldet,
sodass ein Panel das Feature ausgrauen kann, anstatt einen Fehler anzuzeigen.

| Code | Status | Bedeutung | Maßnahme |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | Ein administrativer Bereich wurde auf einem Server ohne konfigurierte Authentifizierung aufgerufen, sodass Admins nicht von beliebigen Nutzern unterschieden werden können. | `auth.jwtSecret` setzen oder einen `AuthAdapter` übergeben. |
| `BRANCH_DIFF_STALE` | 409 | An `POST /api/admin/branches/:name/merge` wurde der Fingerprint eines Diffs übermittelt, der nicht mehr aktuell ist: Der Branch oder sein Parent wurden zwischenzeitlich geändert. Es wurde nichts geschrieben. | Diff erneut abrufen, prüfen und mit dem neuen `fingerprint` mergen. |
| `BRANCH_DIFF_UNSUPPORTED` | 501 | Die Datenquelle kann Branches nicht vergleichen: Sie unterstützt kein SQL oder kein Branching (keine Admin-Verbindung vorhanden). | Ein Postgres-Backend mit gesetztem `adminConnectionString` verwenden. |
| `BRANCH_MERGE_BLOCKED` | 409 | Eine Tabelle mit Differenzen kann nicht gemergt werden – durch den Branch hinzugefügt oder entfernt, abweichende Spalten oder Primärschlüssel, kein Primärschlüssel vorhanden, zu viele Zeilen für einen Abgleich oder nach Branch-Erstellung neu geschrieben (`TABLE_REWRITTEN`). Eine Tabelle, deren Zeilen nicht abgeglichen werden konnten, blockiert selbst dann, wenn ihre Zähler 0 anzeigen: Sie sind unbekannt, nicht null. `details.tables` nennt jede Tabelle mit Begründung. Es wurde nichts geschrieben. | Schema zuerst über Migrationen anwenden oder mit `skipBlocked: true` mergen, um diese Tabellen auszulassen. |
| `BRANCH_MERGE_CONFLICT` | 409 | Zeilen wurden sowohl auf dem Branch als auch auf dem Parent geändert und `onConflict` war `"abort"` (Standard); oder der Parent hat Teile des Merges abgewiesen – eine Zeile wurde zwischenzeitlich geändert, ein Trigger hat sie übersprungen, eine Policy hat sie verborgen. Es wurde nichts geschrieben. | Konfliktlösung über `onConflict: "branch"` oder `"target"` steuern, oder den Diff erneut prüfen. |
| `BRANCH_MERGE_FAILED` | 409 | Der Parent hat die Zeilen des Branches innerhalb des Merge-Statements abgelehnt – ein Constraint, ein Enum-Wert oder ein Fremdschlüssel auf dem Parent wird durch die Zeilen des Branches verletzt, meist durch Schema-Unterschiede. `details` liefert `sqlState`, `table`, `constraint` und `detail`. Es wurde nichts geschrieben. | Schema-Änderungen im Diff prüfen, das Schema des Parents per Migration angleichen oder Zeilen des Branches bereinigen und erneut mergen. |
| `BRANCH_NOT_FOUND` | 404 | Kein Branch dieses Namens in der Registry gefunden. | `rebase db branch list` oder die Branches-Ansicht listet vorhandene Branches auf. |
| `CONTRACT_UNAVAILABLE` | 404 | Der Projekt-Contract wird nur ausgeliefert, wenn Authentifizierung konfiguriert ist – er beschreibt alle Tabellen und Relationen. | Authentifizierung konfigurieren. `/meta/schema-version` ist immer erreichbar. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | Kein Entwicklungs-Postfach aktiv. E-Mails werden nur abgefangen, wenn `SMTP_HOST` nicht gesetzt und `NODE_ENV` nicht auf `production` steht. | `SMTP_HOST` in der Entwicklungsumgebung entfernen oder den echten Posteingang prüfen. |
| `INVALID_CHANGE` | 400 | Die vorgeschlagene Schema-Änderung ist fehlerhaft formatiert. | Siehe Meldung. |
| `SCHEMA_CHANGE_FAILED` | 400 | Das Anwenden einer geplanten Schema-Änderung schlug aus einem Grund fehl, den spezifischere Codes nicht abdecken. | Siehe Meldung; sie enthält den zugrundeliegenden Fehler im Wortlaut. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | Die Änderung ist formal gültig, kann aber auf das Schema im aktuellen Zustand nicht angewendet werden. | Siehe Meldung. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | Das Repository enthält nicht committete Änderungen; die Bearbeitung konnte nicht sicher angewendet werden. | Änderungen committen oder stashen, dann erneut versuchen. |
| `SCHEMA_EDIT_REFUSED` | 400 | Der Schema-Editor hat die Änderung abgewiesen. | Siehe Meldung; sie enthält die Ablehnungsbegründung des Editors. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Ein API-Schlüssel oder ein anderer maschineller Principal hat versucht, eine Schema-Änderung anzuwenden. | Als Benutzer anmelden oder `liveSchema.allowMachineApply` aktivieren. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | Live-Schema-Editing erfordert `collectionsDir` oder `liveSchema.repository`; dieser Server wurde ohne beides gestartet. | Eine der Optionen konfigurieren. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | Die Planung funktioniert; es ist jedoch kein Repository konfiguriert, in das die Änderung committet werden könnte. | `liveSchema.repository` konfigurieren. |
| `SCHEMA_EDITING_PROVISIONING_OFF` | 409 | Dieses Deployment nimmt keine Änderungen an der Datenbank vor (`REBASE_PROVISION=false`), daher kann eine Änderung nicht über das Panel angewendet werden. | Rein als Quellcode committen und die Änderung durch den zuständigen Datenbank-Prozess anwenden lassen. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Dieser Treiber kann keine Schema-Änderungen planen. | Live-Editing ist auf Postgres verfügbar. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | Collections werden hier per Introspektion aus der Datenbank geladen; es gibt keine Quelldateien zur Bearbeitung. | Schema über eine Migration ändern. |
| `SCHEMA_EDITOR_DISABLED` | 501 | Der Schema-Editor ist für diesen Server deaktiviert. Ein kompiliertes Bundle gibt immer diesen Fehler zurück. | Über `schemaEditor` aktivieren. Bei einem Bundle `REBASE_LIVE_SCHEMA_REPOSITORY` setzen, um Collections über ein Repository zu bearbeiten – siehe [Live-Schema-Editing](/docs/backend/live-schema-editing#from-a-built-bundle). |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | Der Schema-Editor benötigt `ts-morph`, welches nicht installiert ist. | Im Backend-Package installieren und neu starten: `pnpm --dir backend add -D ts-morph@28.0.0` im Root eines Scaffolded-Projekts oder `pnpm add -D ts-morph@28.0.0`, falls das Backend das Hauptprojekt ist. Die Meldung nennt den genauen Befehl. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | Der Server hat kein `collectionsDir` konfiguriert; der Editor hat kein Ziel zum Schreiben. | `collectionsDir` konfigurieren. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | Der Editor ist unter `NODE_ENV=production` deaktiviert: Die Dateien eines Deployments werden bei jedem Deploy neu aus dem Repository gebaut; Änderungen hier würden überschrieben. | Collections in der Entwicklungsumgebung anpassen und deployen, oder `liveSchema.repository` konfigurieren, um direkt dorthin zu committen. |
| `SQL_EXPORT_UNSUPPORTED` | 501 | `POST /api/admin/sql/csv` kann Ergebnisse hier nicht streamen: Die prozessinterne Entwicklungsdatenbank (PGlite) verfügt nur über eine Verbindung; ein während eines Downloads gehaltener Cursor würde alle anderen Abfragen blockieren; oder die Datenquelle unterstützt keine SQL-Cursor. | `DATABASE_URL` auf ein eigenes Postgres verweisen (`rebase dev --docker` startet eines) oder `LIMIT` nutzen und die Zeilen direkt im Panel exportieren. |

### Schema abgleichen (Reconcile)

[`rebase schema reconcile`](/docs/cli/schema/#rebase-schema-reconcile) plant
über `POST /api/admin/schema/reconcile/plan` und wendet Änderungen über
`/reconcile/apply` an. Eine Abweisung ändert nichts; lediglich `SCHEMA_RECONCILE_FAILED`
hinterlässt einen Plan teilweise angewendet.

| Code | Status | Bedeutung | Maßnahme |
| --- | --- | --- | --- |
| `INVALID_RECONCILE` | 400 | Der Body ist kein JSON-Objekt oder `drop` ist keine Liste von `"<collection>.<column>"`-Strings. | `{ "drop": ["voice_cache.wav"] }` senden oder `drop` weglassen. |
| `SCHEMA_RECONCILE_FAILED` | 400 | Ein Statement schlug während der Ausführung fehl. Vorherige Statements wurden angewendet und bleiben bestehen; `details.applied` listet sie auf. | Das in der Meldung benannte Problem beheben und neu planen: Der neue Plan schließt bereits Ausgeführtes aus. |
| `SCHEMA_RECONCILE_INVALID` | 400 | Der Plan kann nicht angewendet werden; die Meldung listet die Gründe: ein `drop`, das nicht dem Format `<collection>.<column>` entspricht, keine Collection bzw. Spalte benennt, oder eine Spalte nennt, die in der Collection noch deklariert ist. `details.plan` enthält den Plan. | Die `drop`-Liste korrigieren. Eine deklarierte Spalte wird entfernt, indem ihr Property gelöscht, die App deployt und anschließend abgeglichen wird. |
| `SCHEMA_RECONCILE_STALE` | 409 | Datenbank oder Collections haben sich seit dem bestätigten Plan geändert. `details.plan` enthält den neuen Plan. | Den neuen Plan prüfen und dessen `digest` bestätigen. |
| `SCHEMA_RECONCILE_UNCONFIRMED` | 400 | An `/reconcile/apply` wurde kein `confirm` übermittelt. | Zuerst planen und den `digest` des Plans als `confirm` mitsenden. Die CLI erledigt dies nach Eingabe von `yes`. |
| `SCHEMA_RECONCILE_UNSUPPORTED` | 503 | Der Treiber dieses Backends kann keinen Abgleich planen oder kein SQL ausführen. | Reconcile funktioniert auf Postgres. |

### Warum eine Tabelle eines Branches nicht gemergt werden kann

`BRANCH_MERGE_BLOCKED` führt jede abgewiesene Tabelle in `details.tables` mit einem
dieser Codes auf. Derselbe Code steht im Diff selbst am Feld `blocked` der Tabelle,
sodass Studio dies anzeigen kann, bevor jemand auf **Merge** klickt. Keiner davon ist
eine eigenständige Serverantwort.

| Code | Status | Bedeutung | Maßnahme |
| --- | --- | --- | --- |
| `COLUMNS_DIFFER` | — | Die Spalten der Tabelle unterscheiden sich zwischen Branch und Parent. Zeilen werden nur über gemeinsame Spalten verglichen. | Fehlende Spalten per Migration auf dem Parent ergänzen (`rebase db push`), dann mergen. Eine Migration, die die Tabelle neu schreibt (z. B. Spaltentypänderung), führt zu `TABLE_REWRITTEN`: vor einer solchen Änderung mergen oder den Branch danach neu erstellen. |
| `NO_PRIMARY_KEY` | — | Die Tabelle besitzt keinen Primärschlüssel, sodass Zeilen nicht einzeln abgeglichen werden können; der Diff liefert nur Zeilenanzahlen. | Der Tabelle einen Primärschlüssel geben oder Zeilen manuell übertragen. |
| `PRIMARY_KEY_DIFFERS` | — | Die Spalten des Primärschlüssels oder deren Typen unterscheiden sich zwischen beiden Seiten. | Schema zuerst auf den Parent anwenden. |
| `TABLE_ADDED` | — | Die Tabelle wurde im Branch neu erstellt. Ein Merge erstellt niemals Tabellen. | Die Tabelle per Migration auf dem Parent anlegen, dann ihre Zeilen mergen. |
| `TABLE_DROPPED` | — | Die Tabelle wurde im Branch gelöscht. Ein Merge löscht niemals Tabellen. | Die Tabelle per Migration löschen. |
| `TABLE_REWRITTEN` | — | Eine Seite hat nach der Erstellung des Branches alle Zeilen der Tabelle neu geschrieben – Spaltentypänderung, `ADD COLUMN` mit volatilem Default, `VACUUM FULL`, `CLUSTER` –, sodass jede Zeile als modifiziert gilt und nicht mehr ermittelt werden kann, welche Seite welche Zeile geändert hat. | Den Branch vor einer solchen Migration mergen oder ihn danach neu vom Parent abzweigen. |
| `TOO_LARGE` | — | Die Tabelle enthält auf einer Seite mehr Zeilen, als ein Diff einzeln abgleicht (standardmäßig 100.000, `maxRowsPerTable`). | `maxRowsPerTable` sowohl für Diff als auch Merge anheben oder die Zeilen auf anderem Weg übertragen. |

## Generische Codes

Eine Route greift auf diese Codes zurück, wenn kein spezifischerer Fehler vorliegt.

| Code | Status | Bedeutung | Maßnahme |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Anfrage ist fehlerhaft aufgebaut, und kein spezifischerer Code trifft zu. | Siehe Meldung. |
| `UNAUTHORIZED` | 401 | Nicht authentifiziert oder Anmeldedaten wurden abgelehnt. | Anmelden oder Token aktualisieren. |
| `FORBIDDEN` | 403 | Authentifiziert, aber nicht autorisiert. | Ein erneuter Versuch mit denselben Zugangsdaten hilft nicht. |
| `CONFLICT` | 409 | Konflikt mit bestehendem Zustand. | Siehe Meldung. |
| `INTERNAL_ERROR` | 500 | Serverfehler. Die Meldung ist bewusst generisch gehalten. | `requestId` angeben; die Ursache steht in den Protokollen. |
| `NOT_CONFIGURED` | 503 | Eine von dieser Route benötigte Abhängigkeit ist auf diesem Server nicht konfiguriert. | Siehe Meldung. |
| `SERVICE_UNAVAILABLE` | 503 | Ein Dienst, von dem die Anfrage abhängt, war nicht erreichbar: ein S3- oder MinIO-Bucket oder ein Host, den eine Function per `fetch()` aufruft und der die Verbindung ablehnt oder nicht auflöst. Das Serverprotokoll nennt den Host, die Response nicht. Eine nicht erreichbare Datenbank liefert `DATABASE_UNAVAILABLE`. Eine fehlschlagende Verbindung zu solchen Diensten antwortet hiermit. | Erneut versuchen; Protokolle prüfen. |

## Korrektheit dieser Seite sicherstellen

`pnpm verify:docs` schlägt fehl, wenn ein vom Server werfbarer Code in diesen
Tabellen fehlt, wenn eine Tabelle einen Code auflistet, der nirgends geworfen werden kann,
wenn die Statuscodes einer Zeile nicht exakt mit dem Quellcode übereinstimmen oder
wenn eine Code-Familie wie `PG_<SQLSTATE>` keine Zeile für einen SQLSTATE enthält,
auf den Aufrufer treffen können. Der entsprechende Testschritt liegt in
`tooling/scripts/docs-verify/check-error-codes.mjs`.

Das Tool überprüft sich zunächst selbst. Da der Scan die Codes direkt aus dem TypeScript-Code
und nicht von einem laufenden Server ausliest, sind tote Winkel konstruktionsbedingt unbemerkt:
Früher wurden Codes übersehen, die durch Einzeiler-Wrapper weitergeleitet wurden oder hinter einer Meldung
mit einer `)` standen. So meldete der Test einst "alle Codes sind dokumentiert", obwohl siebzehn
auf der Seite fehlten. Daher verarbeitet der Testschritt vor dieser Seite eine Fixture
mit genau solchen Sonderfällen und verweigert die Validierung, falls er diese Konstrukte nicht erkennt.
