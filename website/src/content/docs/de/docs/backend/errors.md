---
sourceHash: 983cce6efed81a1a
title: Fehlercodes
sidebar_label: Fehlercodes
description: Jeder Fehlercode, den ein Rebase-Backend zurückgeben kann, inklusive HTTP-Status, Bedeutung und Behebung – plus Response-Envelope, X-Request-ID und Details-Regeln.
---

Jeder Fehler, den ein Rebase-Backend zurückgibt, verwendet denselben Envelope und enthält einen stabilen
`code`. Dieser Code ist der Wert, auf den im Code verzweigt werden sollte: Die Meldung (`message`) ist für Menschen
geschrieben und kann umformuliert werden, der HTTP-Status wird von einem Dutzend verschiedener Probleme geteilt –
der Code hingegen ist weder noch.

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

- **`message`** — für Menschen lesbar. Bei `4xx`-Fehlern ist es die Nachricht des Servers selbst; bei
  `5xx`-Fehlern ist sie bewusst generisch gehalten, da der zugrundeliegende Text einen Host,
  eine Rolle oder einen Spaltennamen enthalten kann.
- **`code`** — einer der unten aufgeführten Werte. Über Minor-Versionen hinweg stabil.
- **`details`** — optional und nie garantiert. Siehe die unten stehenden Regeln.
- **`requestId`** — vorhanden, wann immer die Anfrage die Request-ID-Middleware
  durchlaufen hat, was auf jede Route unter `basePath` zutrifft.

### `X-Request-ID`

Jede Anfrage unter `basePath` erhält eine ID: den `X-Request-ID`-Header des Aufrufers,
wenn es sich um eine UUID handelt, andernfalls eine neu generierte. Sie wird in der
Antwort als `X-Request-ID` zurückgegeben, im Fehler-Envelope als `requestId` aufgeführt und
an den Log-Eintrag des Servers für diese Anfrage angehängt.

Das ist der Verknüpfungsschlüssel. Geben Sie ihn in einem Fehlerbericht an, damit ein Operator genau den
einen Log-Eintrag finden kann, der den Fehler erklärt – inklusive des Grundes, der dem Client
nie angezeigt wurde.

Das Senden einer eigenen ID ermöglicht es, einen Trace über Zwischenstationen (Hops) hinweg beizubehalten: Ein Gateway oder ein Job-Runner,
der den Header weiterleitet, sorgt für eine einheitliche ID über alle Dienste hinweg, die die Anfrage verarbeitet haben.
Ein ungültiger Wert wird ignoriert statt abgewiesen – wegen eines fehlerhaften Headers eines
Aufrufers lohnt es sich nicht, eine Anfrage fehlschlagen zu lassen –, gehen Sie also nicht davon aus, dass die gesendete ID
auch der empfangenen ID entspricht. Lesen Sie den Antwort-Header aus.

### Was in `details` enthalten ist

`details` dient Diagnosezwecken und ist nicht vertraglich festgelegt. Es gelten drei Regeln:

1. **Alles, was eine Route explizit setzt, wird immer zurückgegeben.** Dies sind präzise
   beschriebene Fehler des Aufrufers selbst: welches Filterfeld unbekannt war,
   welche Relation nicht beschreibbar ist, welcher Wert nicht zu seinem Typ passte.
2. **Datenbankdiagnosen werden in der Produktionsumgebung gekürzt.** Wenn der Fehler von
   Postgres stammt, ist `details.dbCode` – der SQLSTATE – immer vorhanden: Er benennt
   die Problemklasse und gibt nichts über die Daten preis. `dbMessage`,
   `detail` und `hint` werden nur hinzugefügt, wenn `NODE_ENV` nicht `production` ist,
   da Postgres darin Zeileninhalte wiedergibt. `23505` meldet
   `Key (email)=(a@b.c) already exists.`, was für jede beliebige Adresse die Frage
   "Ist diese Person registriert?" beantwortet.
3. **Verzweigen Sie niemals auf Basis von `details`.** Verzweigen Sie auf Basis von `code`. Der Inhalt von `details`
   entspricht dem, was für eine Person an dieser Aufrufstelle nützlich war, und kann sich ändern.

## Statuscodes interpretieren

| Status | Bedeutung für die Anfrage |
| --- | --- |
| `400` | Fehlerhaft aufgebaut oder fragt etwas ab, das im Schema nicht existiert. Anfrage korrigieren. |
| `401` | Nicht authentifiziert oder die Anmeldeinformationen sind abgelaufen. Anmelden oder aktualisieren. |
| `403` | Authentifiziert, aber nicht autorisiert. Ein erneuter Versuch mit derselben Identität hilft nicht. |
| `404` | Keine solche Route, Collection oder Zeile – oder eine Zeile, die durch Row-Level Security verborgen wird. |
| `409` | Ein Konflikt mit dem bestehenden Zustand: ein Duplikat oder ein gleichzeitiger Schreibvorgang. |
| `413` `415` `422` | Der Body ist zu groß, hat den falschen Medientyp oder wurde semantisch abgelehnt. |
| `429` | Rate-Limit erreicht. Warten Sie; die Meldung gibt an, wie lange. |
| `500` | Der Server oder seine Datenbank ist fehlerhaft, nicht der Aufrufer. Logs prüfen. |
| `501` | Die Route existiert, aber dieses Deployment kann sie nicht bedienen – ein Feature ist deaktiviert oder nicht konfiguriert. |
| `502` `503` `504` | Eine Abhängigkeit war nicht erreichbar, nicht konfiguriert oder zu langsam. |

## Authentifizierung und Konten

| Code | Status | Bedeutung | Maßnahme |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | Die Route erfordert einen zweiten Faktor und die Sitzung hat nur einen. | MFA-Challenge abschließen, dann erneut versuchen. |
| `ALREADY_VERIFIED` | 400 | Die Adresse oder der Faktor ist bereits verifiziert. | Nichts tun – der gewünschte Zustand ist bereits eingetreten. |
| `ACCOUNT_OUTRANKS_CALLER` | 403 | Das bearbeitete, zurückgesetzte oder gelöschte Konto besitzt eine Rolle oder einen Scope, den der Aufrufer nicht hat. `details.beyond` benennt diese. | Von jemandem durchführen lassen, der diese Berechtigungen besitzt. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | Anonyme Anmeldung ist auf diesem Server deaktiviert. | Aktivieren oder mit einer echten Identität anmelden. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | Ein API-Schlüssel hat versucht, API-Schlüssel (seiner eigenen Art oder persönliche) aufzulisten, zu erstellen, zu ändern oder zu widerrufen. | Schlüssel als Person mit `keys:write` oder mit dem Service-Schlüssel verwalten. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | Eine geschützte Route wurde ohne vorherige Rebase-Auth-Middleware ausgeführt, sodass die Anmeldeinformationen des Aufrufers nie geprüft wurden. | App über den Functions-Router mounten statt direkt auf dem eigenen Server. |
| `BOOTSTRAP_ANONYMOUS` | 403 | Das Bootstrap des ersten Administrators wurde von einem anonymen Aufrufer versucht. | Zuerst anmelden. |
| `BOOTSTRAP_COMPLETED` | 403 | Der erste Administrator existiert bereits. | Die Rolle von einem bestehenden Administrator zuweisen lassen. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | Bootstrap ist nur für den allerersten Benutzer gedacht, und dies ist nicht der Fall. | Die Rolle von einem bestehenden Administrator zuweisen lassen. |
| `CAPTCHA_FAILED` | 400 | Der Anbieter hat das CAPTCHA-Token abgelehnt. | Eine neue Challenge lösen. |
| `CAPTCHA_REQUIRED` | 400 | Die Route erfordert ein CAPTCHA-Token und es wurde keines gesendet. | Token beifügen. |
| `CHALLENGE_EXHAUSTED` | 401 | Zu viele falsche Codes für eine MFA-Challenge. | Neue Challenge starten. |
| `EMAIL_EXISTS` | 409 | Ein Konto mit dieser Adresse existiert bereits – bei der Registrierung, bei einer Adressänderung oder beim Folgen eines Adressänderungs-Links, wenn ein anderes Konto die Adresse während der Wartezeit übernommen hat. | Anmelden oder Passwort-Reset starten; bei Adressänderung eine andere Adresse wählen. |
| `EMAIL_NOT_CONFIGURED` | 503 | Magic Links oder OTP wurden angefordert, aber der Server verfügt über keinen Mail-Transport. | SMTP konfigurieren oder eine andere Anmeldemethode verwenden. |
| `EMAIL_NOT_VERIFIED` | 403 | Ein OAuth-Login hat ein Konto mit derselben Adresse gefunden, der Anbieter hat diese Adresse jedoch nicht verifiziert, daher wird sie nicht verknüpft. | Mit der bestehenden Methode anmelden, dann `POST /auth/link/<provider>`. |
| `FACTOR_NOT_VERIFIED` | 400 | Der MFA-Faktor wurde registriert, aber nie bestätigt. | Den Faktor bestätigen. |
| `IDENTITY_ALREADY_LINKED` | 409 | Diese OAuth-Identität gehört zu einem anderen Konto. | Damit anmelden oder dort zuerst die Verknüpfung aufheben. |
| `IMPERSONATION_FORBIDDEN` | 403 | Eine Anfrage hat `x-rebase-impersonate` gesendet, aber der Aufrufer darf keine Anfragen als anderer Benutzer ausführen. Nur die eigene Sitzung eines angemeldeten Administrators darf dies, niemals ein API-Schlüssel oder der Service-Schlüssel. | Mit der Sitzung eines Administrators senden oder den Header weglassen. |
| `IMPERSONATION_INVALID` | 400 | `x-rebase-impersonate` wurde leer gesendet. | Die UID des zu imitierenden Benutzers senden oder den Header weglassen. |
| `IMPERSONATION_TARGET_NOT_FOUND` | 404 | `x-rebase-impersonate` benennt keinen aktiven Benutzer: Kein Konto hat diese UID oder es ist deaktiviert. | UID prüfen. |
| `IMPERSONATION_UNAVAILABLE` | 501 | Die Authentifizierung dieses Backends kann keine Anfragen als anderer Benutzer ausführen, da der `AuthAdapter` kein `resolveUser` besitzt. | `resolveUser` im Adapter implementieren oder den Header weglassen. |
| `IMPERSONATION_UNSUPPORTED` | 400 | `x-rebase-impersonate` wurde an eine Route gesendet, die nicht als anderer Benutzer ausgeführt werden kann. Nur die Data-API und benutzerdefinierte Funktionen unterstützen dies; das Realtime-Socket unterstützt `impersonate` bei `AUTHENTICATE`. | Anfrage ohne den Header senden. |
| `SIMULATION_FORBIDDEN` | 403 | Eine Anfrage hat einen `x-rebase-simulate-*`-Header (den RLS-Simulator) gesendet oder `/api/admin/rls-simulator` angefordert, und der Aufrufer darf Zugriffe nicht simulieren. Nur die eigene Sitzung eines angemeldeten Administrators darf dies, niemals ein API-Schlüssel oder der Service-Schlüssel. | Mit der Sitzung eines Administrators senden oder die Header weglassen. |
| `SIMULATION_INVALID` | 400 | Die Simulation war fehlerhaft: ein Header wurde leer gesendet, `x-rebase-simulate-api-key-id` wurde mit einer Rolle oder Benutzer-ID kombiniert, oder die Simulation wurde mit `x-rebase-impersonate` kombiniert. | Eine Rolle (optional mit UID), eine Benutzer-ID oder eine API-Schlüssel-ID angeben. |
| `SIMULATION_READ_ONLY` | 403 | Ein Schreibvorgang, ein Löschvorgang, `_batch`, ein History-Revert oder eine benutzerdefinierte Funktion, die mit einem anderen Verb als `GET`/`HEAD`/`OPTIONS` aufgerufen wurde, trug einen `x-rebase-simulate-*`-Header. Simulierter Zugriff ist schreibgeschützt: Der Schreibvorgang würde als die simulierte Identität ausgeführt werden, nicht als der Administrator. Lesevorgänge, einschließlich `POST …/query` und `…/count`, werden weiterhin ausgeführt. Unter 0.25 wurde der Schreibvorgang als die simulierte Identität ausgeführt. | Simulation beenden, um Änderungen vorzunehmen. |
| `SIMULATION_TARGET_NOT_FOUND` | 404 | Die Simulation benennt keinen aktiven Benutzer (eine Benutzer-ID ohne Rolle) oder keinen aktiven API-Schlüssel. | ID überprüfen oder eine Rolle zusammen mit der UID senden, um eine UID zu simulieren, die kein Konto hat. |
| `SIMULATION_UNAVAILABLE` | 501 | Dieses Backend kann keinen Zugriff simulieren: Sein `AuthAdapter` hat kein `resolveUser` zur Bestätigung eines Administrators, oder es wurde ein Schlüssel auf einem Backend ohne API-Schlüssel angegeben. | `resolveUser` implementieren oder die Header weglassen. |
| `SIMULATION_UNSUPPORTED` | 400 | Ein `x-rebase-simulate-*`-Header wurde an eine Route gesendet, die nicht mit simuliertem Zugriff ausgeführt werden kann. Nur die Data-API und benutzerdefinierte Funktionen unterstützen diese. | Anfrage ohne die Header senden. |
| `GUEST_REFERENCED` | 409 | Ein Gast konnte nicht gelöscht werden, da eine eigene Zeile des Projekts ihn über einen Fremdschlüssel mit `ON DELETE RESTRICT` oder `NO ACTION` voraussetzt. `DELETE /api/admin/guests` meldet dies pro Gast in `skipped` und fährt fort. | Die Zeile löschen oder den Gast belassen. |
| `INVALID_ACCOUNT` | 400 | Das Konto befindet sich in einem Zustand, auf den diese Operation nicht angewendet werden kann. | Siehe Meldung. |
| `INVALID_CHALLENGE` | 400 | Die MFA-Challenge ist unbekannt oder abgelaufen. | Eine neue starten. |
| `INVALID_CODE` | 400 / 401 | Der OTP- oder MFA-Code ist falsch: 400 bei der E-Mail-Code-Anmeldung (`/auth/otp/verify`), 401 bei einer MFA-Registrierung oder -Challenge. | Mit dem aktuellen Code erneut versuchen. |
| `INVALID_CREDENTIALS` | 401 | Falsche E-Mail-Adresse oder falsches Passwort – es wird bewusst nicht angegeben, was davon falsch ist. | Erneut versuchen oder Passwort zurücksetzen. |
| `INVALID_PLATFORM_TOKEN` | 401 | Ein `rpt_`-Plattform-Token wurde abgelehnt: ungültige Signatur, falsche Audience, abgelaufen oder Lebensdauer über dem Limit. Die Meldung gibt den genauen Grund an. | Plattform ein neues Token ausstellen lassen – auf Rebase Cloud den Befehl erneut ausführen. |
| `INVALID_SCOPES` | 400 | Für einen Schlüssel wurde etwas angefordert, das kein Scope ist: fehlerhaft, unbekannt oder mit einem Ziel, das der Scope nicht akzeptiert. `details.problems` gibt an, was und warum; `details.validScopes` listet die Scopes auf, die ein Schlüssel besitzen darf. `keys:read` und `keys:write` werden ausgelassen, da kein Schlüssel diese besitzen kann; unter 0.24 werden sie aufgeführt. | Einen Namen aus der Liste verwenden. Siehe [Rollen und Scopes](/docs/backend/roles-and-scopes/). |
| `INVALID_TOKEN` | 400 / 401 | Ein Verifizierungs-, Reset-, Magic-Link- oder Adressänderungs-Token ist fehlerhaft, unbekannt, aufgebraucht oder abgelaufen (400). Ein OAuth-Provider-Credential oder ein Refresh-Token, das sich nicht verifizieren lässt, ergibt 401. | Neuen Link anfordern oder erneut anmelden. |
| `INVALID_ROLE` | 400 | Ein zu schreibender Rollenname ist kein String, ist leer oder enthält `,` `{` `}` `"` `\` oder ein Steuerzeichen. Diese Zeichen würden beim erneuten Auslesen als andere Rollen interpretiert: Eine Rolle wird in einem Postgres `text[]` und in der kommagetrennten Liste transportiert, die RLS-Policies aufteilen, sodass `"support,admin"` als `admin` zurückkäme. Unter 0.25 wurde ein solcher Name gespeichert. `details.problems` benennt jeden einzelnen. | Die Rolle umbenennen. Jeder andere Name wird akzeptiert. |
| `KEY_MANAGEMENT_SCOPE` | 400 | Für einen Schlüssel wurde `keys:read` oder `keys:write` angefordert. Kein Schlüssel darf Schlüssel verwalten. `details.scopes` benennt sie. | Diese weglassen. |
| `KEY_OUTRANKS_CALLER` | 403 | Ein Inhaber von `keys:write` hat versucht, einen Service-Schlüssel zu ändern oder zu widerrufen, der eine Rolle oder einen Scope besitzt, den er selbst nicht hat. Nur ein Admin verwaltet jeden Schlüssel. `details.roles` und `details.scopes` benennen, was der Schlüssel über den Aufrufer hinaus besitzt. Unter 0.25 wurde die Änderung durchgeführt. | Einen Admin oder jemanden, der diese Rechte hat, den Schlüssel ändern lassen. |
| `LAST_ADMIN` | 403 | Die Änderung würde das Projekt ohne Admin zurücklassen. | Zuerst jemand anderen hochstufen. |
| `MFA_REQUIRED` | 401 | Das Passwort war korrekt und das Konto verfügt über einen verifizierten zweiten Faktor, daher ist die Anmeldung erst zur Hälfte abgeschlossen. `details` enthält ein kurzlebiges Token für die MFA-Challenge – es ist keine Sitzung. | Eine Challenge öffnen und beantworten; die Challenge-Antwort stellt die Sitzung aus. |
| `NO_SESSION` | 401 | Kein Sitzungs-Cookie oder Refresh-Token vorgelegt. Normal beim ersten Laden der Seite. | Anmelden. |
| `NOT_ANONYMOUS` | 400 | Eine Upgrade-Route für anonyme Konten wurde von einem echten Konto aufgerufen, oder `DELETE /api/admin/guests/:uid` hat ein solches benannt. | Nichts zum Upgraden vorhanden. Um ein Konto zu löschen, `DELETE /api/admin/users/:uid` verwenden. |
| `OAUTH_ERROR` | 401 | Der OAuth-Anbieter hat die Anfrage abgelehnt oder einen Fehler zurückgegeben. | Den Flow wiederholen; die Meldung enthält den Grund des Anbieters. |
| `PERSONAL_KEYS_DISABLED` | 403 | Persönliche API-Schlüssel sind auf diesem Backend deaktiviert. | `personalKeys: true` im `auth`-Block der Users-Collection setzen. |
| `PERSONAL_KEY_NEEDS_ACCOUNT` | 403 | Der Service-Schlüssel oder eine Gastsitzung hat versucht, die Routen für persönliche Schlüssel zu verwenden. Keines von beiden hat ein Konto, als das ein Schlüssel agieren könnte. | An einem Konto anmelden oder einen Service-Schlüssel unter `/api/admin/api-keys` erstellen. |
| `PLATFORM_TOKENS_OFF` | 401 | Ein `rpt_`-Plattform-Token erreichte einen Server, der diese nicht akzeptiert: `REBASE_PLATFORM_TOKEN_KEY` und `REBASE_PLATFORM_TOKEN_AUDIENCE` sind nicht gesetzt. | Die Plattform, die die App hostet, setzt beides beim Deployment; neu deployen oder sich auf anderem Weg in der App anmelden. |
| `RATE_LIMITED` | 429 | Zu viele Versuche von diesem Aufrufer. | Warten; die Meldung gibt an, wie lange. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | Das Weiterleitungsziel steht nicht auf der Allowlist. | Zur Provider-Konfiguration hinzufügen. |
| `REGISTRATION_DISABLED` | 403 | Selbstregistrierung ist deaktiviert. | Ein Konto von einem Administrator anlegen lassen. |
| `ROLE_EXCEEDS_CALLER` | 403 | Die zu vergebenden Rollen besitzen einen Scope oder `admin`, den der Aufrufer nicht hat. `details.beyond` benennt diese. | Von jemandem gewähren lassen, der diese Berechtigungen besitzt. |
| `ROLE_EXCEEDS_CREATOR` | 403 | Einem Service-Schlüssel wurde eine RLS-Rolle zugewiesen, die sein Ersteller nicht besitzt. Nur ein Admin darf jede Rolle vergeben. `details.roles` benennt diese. | Die Rolle entfernen oder den Schlüssel von einem Admin erstellen lassen. |
| `ROLE_EXISTS` | 409 | Dieser Rollenname ist bereits vergeben. | Einen anderen Namen wählen. |
| `ROLE_LOOKUP_FAILED` | 503 | Die Rollen des Aufrufers konnten nicht gelesen werden – auf einer Admin-Route oder bei einer Datenanfrage auf einem Backend mit `config.auth`. Schlägt sicherheitshalber fehl (Fail-Closed), statt den Rollen im Token zu vertrauen. Ein Token, dessen UID keinem Konto zugeordnet ist (einschließlich einer UID, die die Benutzertabelle nicht aufnehmen kann), ergibt 401, nicht diesen Fehler (unter 0.24 ergab eine unzulässige UID diesen 503-Fehler). Eine nicht erreichbare Datenbank führt zu `DATABASE_UNAVAILABLE`, nicht zu diesem Fehler (unter 0.24 war es dieser 503-Fehler). | Erneut versuchen; Datenbank prüfen. |
| `SCOPE_EXCEEDS_CREATOR` | 403 | Für einen Schlüssel wurde ein Scope angefordert, den sein Ersteller nicht besitzt. Ein Schlüssel hat niemals mehr Rechte als das Konto, das ihn erstellt. `details.scopes` benennt diese. | Scopes entfernen oder den Schlüssel von jemandem erstellen lassen, der diese Berechtigungen besitzt. |
| `SCOPE_MISSING` | 403 | Die Anmeldeinformationen besitzen nicht den Scope, den diese Route, Collection, Storage-Quelle oder Funktion benötigt. `details.requiredScope` gibt diesen inklusive Ziel an. | Für eine Person: eine Rolle, die den Scope deklariert. Für einen Schlüssel: ein Schlüssel, der ihn besitzt. Siehe [Rollen und Scopes](/docs/backend/roles-and-scopes/). |
| `SCOPE_NOT_DECLARED` | 500 | Eine mit `requireScope` geschützte Route benennt einen App-Scope, den dieses Backend nicht deklariert, sodass niemand ihn besitzt – auch kein Administrator. Ein Name, der überhaupt kein Scope ist, oder ein falsch geschriebener integrierter Scope wie `data:raed`, kommt gar nicht so weit: `requireScope` wirft dort einen Fehler, wo die Route registriert wird. Unter 0.24 antworten beide jedem Aufrufer mit `403 SCOPE_MISSING`. | Den Scope unter `auth.scopes` in der Users-Collection deklarieren oder den Namen korrigieren. Siehe [Rollen und Scopes](/docs/backend/roles-and-scopes/). |
| `SELF_DELETE` | 400 | Ein Administrator hat versucht, sein eigenes Konto zu löschen. | Von einem anderen Administrator durchführen lassen. |
| `SESSION_REVOKED` | 401 | Die Sitzung wurde an anderer Stelle abgemeldet, alle Sitzungen wurden widerrufen oder das Konto wurde gelöscht. Jeder Endpunkt, der eine Sitzung akzeptiert, antwortet bei einem solchen Access-Token damit: die Data-API, Storage, benutzerdefinierte Funktionen und die Admin-Routen (unter 0.24 antworten die ersten drei mit `UNAUTHORIZED` "Invalid or expired token"). Das Realtime-Socket verweigert sein `AUTHENTICATE` mit einem `AUTH_ERROR`-Frame, der denselben Code enthält. Das SDK führt einen Refresh durch, der abgelehnt wird, und meldet sich ab. | Erneut anmelden. |
| `ACCOUNT_DISABLED` | 401/403 | Ein Administrator hat das Konto deaktiviert: Anmeldung (403), Refresh und jedes Token des Kontos (401) werden an jedem Endpunkt abgelehnt, der eine Sitzung akzeptiert (unter 0.24 antworten die Data-API, Storage und benutzerdefinierte Funktionen mit `UNAUTHORIZED`). Das Realtime-Socket verweigert sein `AUTHENTICATE` mit einem `AUTH_ERROR`-Frame, der denselben Code enthält. | An einen Administrator wenden. |
| `EMAIL_NOT_CONFIRMED` | 403 | `requireEmailVerification` ist aktiv und die Adresse ist noch nicht verifiziert. Wird nur bei korrektem Passwort zurückgegeben; ein neuer Link wird per Mail gesendet. | Dem Link in der E-Mail folgen. |
| `PROOF_REQUIRED` | 409 | `POST /auth/verify-email`: Das Konto enthält ein Passwort oder eine Identität, die niemand bestätigt hat, und die Anfrage bestätigt keines von beiden. Das Token wird nicht verbraucht. | `password` mitsenden, um es zu behalten, oder `removeUnproven: true`, um ohne dieses zu verifizieren. |
| `UNDELIVERABLE_ADDRESS` | 400 / 409 | Eine Bestätigungsmail wurde für eine Adresse angefordert, die nicht erreichbar ist – die eines Gastes oder der Platzhalter von X (400) – oder ein Konto wollte auf eine solche Adresse wechseln (409, `POST /auth/change-email`). | Zuerst eine echte Adresse einrichten. |
| `EMAIL_UNCHANGED` | 400 | `POST /auth/change-email` hat die aktuelle Adresse des Kontos angegeben. | Nichts zu ändern. |
| `ANONYMOUS_USER` | 403 | Ein Gast hat versucht, seine E-Mail-Adresse zu ändern; ein Gast hat keine eigene Adresse. | Zuerst in ein reguläres Konto umwandeln (`POST /auth/anonymous/link`). |
| `MFA_NOT_ENROLLED` | 400 | Wiederherstellungscodes wurden für ein Konto ohne verifizierten zweiten Faktor angefordert. | Zuerst einen Faktor registrieren. |
| `HOOK_REJECTED` | 400 | Ein Hook (`beforeUserCreate`, `beforeLogin`, `beforeUserDelete` oder `beforeEmailChange`) hat einen Fehler geworfen. Die Meldung stammt vom Hook; ein Hook, der einen 4xx-Status gewählt hat, antwortet damit. | Siehe Meldung. |
| `INVALID_JSON` | 400 | Der Request-Body ist kein gültiges JSON. | Einen JSON-Body senden. |
| `SELF_DISABLE` | 400 | Ein Administrator hat versucht, sein eigenes Konto zu deaktivieren. | Einen anderen Administrator darum bitten. |
| `NOT_SUPPORTED` | 501 | Das Auth-Repository dieses Backends unterstützt die angeforderte Aktion nicht (z. B. Konten deaktivieren, Adresse ändern). | Den Server neu starten, damit die Spalte hinzugefügt wird, oder ein Repository verwenden, das dies unterstützt. |
| `UNKNOWN_SCOPE_TARGET` | 400 | Das Ziel eines Scopes benennt eine Collection, eine Storage-Quelle oder eine Funktion, die von diesem Backend nicht bereitgestellt wird. `details` listet die verfügbaren auf. | Ziel korrigieren. |
| `UNVERIFIED_IDENTITIES` | 409 | Ein Magic Link, ein E-Mail-Code oder ein Passwort-Reset hat die Adresse eines nicht verifizierten Kontos bestätigt, und das Konto enthält eine Anmeldeidentität, deren Anbieter diese Adresse nie verifiziert hat. Das Auth-Repository kann diese nicht entfernen (es fehlt `unlinkUserIdentity`), daher wird die Bestätigung verweigert, statt diesen Zugangsweg auf einem verifizierten Konto zu belassen. | `unlinkUserIdentity` im benutzerdefinierten Auth-Repository implementieren oder das Konto von einem Admin überprüfen lassen. |
| `SETUP_REQUIRED` | 403 | Das Projekt hat noch keinen Administrator, daher ist diese Route nicht verfügbar. | Die Einrichtung des ersten Administrators abschließen. |
| `TOKEN_ALREADY_USED` | 401 | Ein Einmal-Token wurde wiederverwendet, oder ein Refresh-Token, das vor mehr als `refreshTokenReuseIntervalSeconds` rotiert wurde. | Ein neues anfordern oder erneut anmelden. |
| `TOKEN_EXPIRED` | 401 | Die Gültigkeitsdauer des Tokens ist abgelaufen. | Ein neues anfordern. |
| `USER_NOT_FOUND` | 404 | Kein Konto mit dieser ID vorhanden. | ID prüfen. |
| `WEAK_PASSWORD` | 400 | Das Passwort entspricht nicht der [Passwort-Richtlinie](/docs/backend/auth-endpoints/#password-policy) (standardmäßig mindestens 8 Zeichen mit einem Großbuchstaben, einem Kleinbuchstaben und einer Ziffer) – bei Registrierung, Reset oder Änderung sowie bei vom Administrator gewählten Passwörtern: `POST /api/admin/users`, Erstellung in der Users-Collection über die Data-API, `PUT /api/admin/users/:id` oder `POST /api/admin/users/:id/reset-password`. | Ein stärkeres Passwort wählen. Ein Administrator, der Konten importiert, kann beim Erstellen `skipPasswordPolicy: true` übergeben. |

## Daten, Abfragen und Schreibvorgänge

| Code | Status | Bedeutung | Maßnahme |
| --- | --- | --- | --- |
| `AGGREGATE_NOT_SUPPORTED` | 501 | Dieser Treiber kann das angeforderte Aggregat nicht berechnen. | Einen Treiber verwenden, der dies unterstützt, oder die Berechnung im Client durchführen. |
| `BRANCHING_UNSUPPORTED` | — | Ein Datenbank-Branch wurde über den Studio-Websocket auf der verwalteten Entwicklungsdatenbank (PGlite) angefordert, wo ein Branch mit dem Parent identisch *ist* und nichts isoliert werden würde. Die Ablehnung entspricht der Ausgabe von `rebase db branch`. | `DATABASE_URL` auf eine eigene Postgres-Instanz zeigen lassen (`rebase dev --docker` startet eine) und dort branchen. |
| `BATCH_TOO_LARGE` | 400 | `POST /api/data/_batch` enthält mehr Operationen als das Limit pro Batch erlaubt (standardmäßig 1000). Ein Batch bildet eine Transaktion und hält Locks über die gesamte Dauer. | In kleineren Chunks senden; die Meldung nennt das Limit und die Anzahl. |
| `BATCH_UNSUPPORTED` | 400 | Der Treiber dieses Backends kann Schreibvorgänge über Collections hinweg nicht atomar ausführen, und eine Schleife von Einzelschreibvorgängen wäre weder atomar noch ein einzelner Roundtrip. | Die Schreibvorgänge als separate Anfragen oder als `/bulk`-Aufrufe pro Collection senden. |
| `BULK_TOO_LARGE` | 400 | Der Bulk-Body überschreitet das konfigurierte Element-Limit. | Anfrage aufteilen. |
| `BULK_UNSUPPORTED` | 400 | Diese Collection oder dieser Treiber unterstützt keine Bulk-Schreibvorgänge. | Die Zeilen einzeln schreiben. |
| `CALLBACK_REJECTED` | 400 / 403 | Ein Collection-Callback hat den Schreibvorgang verweigert. Ein `throw` aus `beforeSave`/`beforeDelete`/`after*` ist ein 400-Fehler mit der Nachricht des Autors; ein `beforeDelete`, das `false` zurückgibt, ist ein 403-Fehler. `details.stage` benennt den Callback, `details.path` die Collection. | Die Meldung lesen – sie wurde von diesem Projekt verfasst, nicht von Rebase. |
| `CALLBACK_RECURSION` | 500 | Durch Hooks ausgelöste Schreibvorgänge waren tiefer als 16 Ebenen verschachtelt: Ein `context.data`-Schreibvorgang eines Hooks führt die Hooks dieser Collection erneut aus, und nichts in der Kette bricht dies ab – typischerweise ein `afterSave`, das seine eigene Zeile bedingungslos aktualisiert. Der gesamte Schreibvorgang wurde zurückgerollt. Die Meldung benennt den Hook und die Collection; `details.chain` listet jeden Hook-→-Schreib-Schritt auf. | Den Schreibvorgang im Hook an Bedingungen knüpfen: nur auf `status === "new"` reagieren oder überspringen, wenn `values` bereits die zu schreibenden Daten enthält. |
| `CURSOR_WITH_OFFSET` | 400 | `?after=` wurde mit `?offset=` oder `?page=` kombiniert. Ein Cursor gibt bereits an, wo die Seite beginnt; ein zusätzlicher Offset würde stillschweigend diese Anzahl von Zeilen hinter dem Cursor überspringen – eine Lücke, die der Aufrufer in der Antwort nicht sehen kann. | Nur eines von beiden verwenden. |
| `DISTINCT_NOT_APPLICABLE` | 400 | `?distinct=true` wurde mit einer Suche oder einer Vektorabfrage kombiniert. Beide fügen einen Score pro Zeile hinzu, sodass nie zwei Zeilen gleich sind und `DISTINCT` nichts zusammenfassen würde – es sähe so aus, als hätte es funktioniert, würde aber nichts ändern. | Eines von beiden weglassen. |
| `DISTINCT_ORDER_BY_NOT_SELECTED` | 400 | Ein `distinct`-Lesevorgang wird nach einer Spalte sortiert, die er nicht zurückgibt. Ein `SELECT DISTINCT` kann nur nach Spalten in seiner Select-Liste sortiert werden, da die zusammengefassten Zeilen sonst keine definierte Reihenfolge haben. `details.fields` benennt diese. | Diese Felder zu `?fields=` hinzufügen oder aus `?orderBy=` entfernen. |
| `DATABASE_UNAVAILABLE` | 503 | Die Datenbank konnte nicht erreicht werden: Verbindung verweigert oder unterbrochen, Host konnte nicht aufgelöst werden, Server fährt herunter oder startet, oder die Datenbank nimmt keine neuen Verbindungen an (`ALLOW_CONNECTIONS false`, was ein abgebrochenes `rebase db branch create --force` auf seiner Quelle hinterlässt; das Server-Log benennt die Datenbank, und `rebase db branch list` öffnet sie wieder). Jeder Endpunkt antwortet damit, einschließlich Login, Admin-Routen und Realtime-Socket (ein `ERROR`-Frame). Wird mit `Retry-After: 5` gesendet. Unter 0.24 antwortet derselbe Ausfall mit `ROLE_LOOKUP_FAILED`, `INTERNAL_ERROR` oder einem 500-Fehler mit dem Code `ECONNREFUSED`. | Erneut versuchen; das SDK tut dies automatisch. Prüfen, ob die Datenbank läuft und vom Server aus erreichbar ist. |
| `DB_CONNECT_TIMEOUT` | 503 | Das Öffnen einer neuen Datenbankverbindung dauerte länger als `DB_POOL_CONNECT_TIMEOUT`: Die Datenbank nimmt Verbindungen nur langsam an oder ist zu weit entfernt. Wird mit `Retry-After` gesendet. | Erneut versuchen; das SDK tut dies automatisch. Last auf der Datenbank und Netzwerkverbindung prüfen. |
| `DB_PERMISSION_DENIED` | 500 | Postgres hat das Statement abgewiesen (`42501`): entweder verweigert eine Row-Level-Security-Policy dieser Rolle den Zugriff oder es fehlt ein `GRANT`. | Siehe [Fehlerbehebung](/docs/troubleshooting/). |
| `DB_POOL_EXHAUSTED` | 503 | Alle gepoolten Datenbankverbindungen blieben für die Dauer von `DB_POOL_CONNECT_TIMEOUT` belegt, sodass diese Anfrage die Datenbank nie erreichte. Lastbedingt, kein Defekt; wird mit `Retry-After` gesendet. Der Server loggt einmal pro Minute Abhilfemaßnahmen. | Erneut versuchen; das SDK tut dies automatisch. `DB_POOL_MAX` erhöhen oder langsame Abfragen und lange Transaktionen identifizieren, die Verbindungen blockieren. |
| `FIELD_NOT_READABLE` | 400 | Ein Filter, `orderBy`, `fields`, Aggregat-`select` oder `groupBy` benennt ein Feld, das die Rollen dieses Aufrufers nicht lesen dürfen (`access.read`), ein verschachtelter Pfad oder ein Aggregat-Sort benennt eine Relation, die sie nicht lesen dürfen – oder eine Feld-Operation (`$inc`, `$push`, …) zielt auf ein solches Feld ab, wo eine abgewiesene Grenze den gespeicherten Wert verraten würde. Ein Feld, das in keiner Antwort enthalten sein darf, darf auch in keiner Abfrage abgefragt werden können, da der Wert sonst Prädikat für Prädikat ausgelesen werden könnte. Ein Filter über eine Relation (`author.salary`) und eine Aggregat-Sortierung über das Feld einer Relation (`max(staff.salary)`) werden nach den Regeln des Ziels beurteilt. `details.violations` benennt jedes Feld. Ein mit `excludeFromApi` verborgenes Feld verhält sich so, als existiere es nicht: Ein Filter, `orderBy`, `fields`, `include`, Aggregat-`select` oder `groupBy` oder `vector_search`, der ein solches Feld benennt, erhält exakt dieselbe Antwort wie ein falsch geschriebener Name (`UNKNOWN_FILTER_FIELD`, `UNKNOWN_ORDER_BY_FIELD`, `UNKNOWN_FIELD`, `UNKNOWN_RELATION`, `UNKNOWN_AGGREGATE_FIELD` oder `UNKNOWN_VECTOR_PROPERTY`), und keine Unbekanntes-Feld-Antwort führt ein solches Feld auf. | Das Feld aus der Abfrage entfernen oder die erforderliche Rolle erlangen. Siehe [Feldzugriff](/docs/collections/field-access/). |
| `FIELD_NOT_WRITABLE` | 400 | Der Body setzt ein Feld, das die Rollen dieses Aufrufers nicht schreiben dürfen (`access.write`). Abgewiesen statt verworfen: Ein Schreibvorgang, der ein Feld ignoriert, würde Erfolg für eine Änderung melden, die nicht stattfand. Derselbe Code verweigert einen Schreibvorgang über ein Parent-Element, der eine Relation setzt, die der Aufrufer nicht schreiben darf, sowie ein Update, das ein `softDelete`-Feld auf einen Wert setzt – nur ein Löschvorgang darf dieses setzen. `details.violations` benennt jedes Feld. | Feld entfernen oder die Rolle erlangen. Ein Feld, das niemand schreiben darf, antwortet stattdessen mit `VALIDATION_EXCLUDED_FIELDS`. |
| `HISTORY_UNAVAILABLE` | 503 | Ein Schreibvorgang in eine Collection mit `history: true` wurde verweigert, da der History-Eintrag nicht aufgezeichnet werden konnte: Der Datenbank fehlt die Tabelle `rebase.entity_history` oder, für `openRebase` und `rebase console`, die Funktion `rebase.record_history`. Auf dieser Datenbank wurde noch kein Backend mit aktiver History gestartet. Nichts wurde ausgeführt (einschließlich Callbacks), Lesevorgänge sind nicht betroffen. Wird von `openRebase` geworfen und von einem Backend beantwortet, das mit `provision: false` erstellt wurde. | Das Backend einmal mit aktiver History und `provision: true` starten (`rebase dev` tut dies), dann erneut versuchen. |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | Eine frühere Anfrage mit demselben `Idempotency-Key` wird noch ausgeführt. | Erneut versuchen, sobald sie abgeschlossen ist. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | Derselbe `Idempotency-Key` wurde bei einer anderen Anfrage verwendet: andere Methode, anderer Pfad, anderer Query-String oder anderer Body. | Neuen Schlüssel verwenden oder die ursprüngliche Anfrage senden. |
| `INVALID_AGGREGATE_FUNCTION` | 400 | `?select=` hat eine Funktion angegeben, die nicht `count`, `sum`, `avg`, `min` oder `max` ist. | Eine dieser Funktionen verwenden; die Meldung listet sie auf. |
| `INVALID_AGGREGATE_SELECT` | 400 | Ein Eintrag in `?select=` hat nicht das Format `fn(field)`, oder einer Funktion außer `count()` wurde kein Feld übergeben. | `sum(total)`, `count()`, `avg(score)` verwenden. |
| `INVALID_AGGREGATE_WINDOW` | 400 | `offset`, `page` oder `orderBy` bei einem Aggregat ohne `groupBy`, oder ein Cursor bei einem beliebigen Aggregat. Ein ungruppiertes Aggregat ist eine einzelne Zeile, und eine Gruppe ist keine Zeile, nach der ein Cursor fortgesetzt werden kann. | `groupBy` hinzufügen oder die Parameter weglassen; Gruppen mit `offset` oder `page` paginieren. Siehe [Aggregate](/docs/sdk/aggregates-and-search/#aggregates). |
| `INVALID_BATCH_BODY` | 400 | Einer `/_batch`-Operation fehlt `op`, `collection`, `values` oder `id`, sie benennt eine Collection, die dieses Backend nicht bedient, oder verwendet einen `ref`-Namen wieder. | Siehe Meldung; sie benennt die Operation nach Index. |
| `INVALID_BATCH_REF` | 400 | Ein `{ "$ref": "<name>.<field>" }` benennt keine frühere Operation, verweist nach vorne oder fragt ein Feld ab, das die referenzierte Zeile nicht besitzt. Nur Rückwärtsreferenzen werden aufgelöst. | Die Operation mit `ref` benennen, *bevor* darauf referenziert wird. |
| `INVALID_BULK_BODY` | 400 | Der Bulk-Body entspricht nicht dem erwarteten Format. | Das Array senden, das die Route erwartet: `{ "rows": [...] }` an `POST /bulk`, `{ "updates": [{ "id", "data" }] }` an `PATCH /bulk`, `{ "ids": [...] }` an `POST /bulk/delete`. |
| `INVALID_CONFLICT_TARGET` | 400 | Das `on_conflict` / `onConflict` eines Upserts benennt Spalten ohne Eindeutigkeitsgarantie, benennt sie ohne `upsert: true` oder wird bei einer verschachtelten Erstellung gesendet, bei der eine gefundene Zeile unter das neue Parent verschoben würde. Postgres würde andernfalls mit 42P10 aus einer Transaktion antworten, die bereits Arbeit verrichtet hat. Gilt auch für jedes Upsert auf der Users-Collection (Auth), wo Erstellung und Aktualisierung unterschiedlichen Regeln folgen. | `validation: { unique: true }` oder einen `unique`-Index deklarieren; die Meldung listet die existierenden Ziele auf. Bei der Users-Collection `POST` zum Erstellen und `PATCH` zum Aktualisieren senden. |
| `INVALID_COUNT` | 400 | `?count=` ist weder `exact` noch `none`. Abgewiesen statt auf den Standardwert zurückzufallen: Ein Tippfehler wie `?count=nnone` würde sonst die Zählung ausführen, die eigentlich übersprungen werden sollte. | `exact` (Standard) oder `none` senden. Siehe [Zählung überspringen](/docs/backend/api/#skipping-the-count). |
| `INVALID_CURSOR` | 400 | Der `after`-Cursor kann nicht gelesen werden oder benennt eine Zeilen-ID, die nicht zu den Schlüsselspalten der Collection passt: Er wurde abgeschnitten, neu kodiert oder manuell erstellt. Ein lesbarer Cursor, der mit einem anderen `orderBy` als bei seiner Ausstellung gesendet wird, erzeugt `CURSOR_ORDER_MISMATCH` (ebenfalls 400). | `meta.nextCursor` von der vorherigen Seite unverändert zurückgeben, mit demselben oder ohne `orderBy`. Siehe [Paginierung](/docs/sdk/pagination/). |
| `INVALID_DELETED_PARAM` | 400 | `?deleted=` ist weder `include` noch `only`. Abgewiesen statt ignoriert: Ein Tippfehler wie `?deleted=true`, der stillschweigend alle gelöschten Zeilen ausblendet, würde scheinbar funktionieren, aber das Gegenteil bewirken. | `include` (aktive und gelöschte) oder `only` (nur gelöschte) senden. Weglassen, um nur aktive Zeilen zu erhalten. |
| `INVALID_DISTINCT` | 400 | `?distinct=` ist nicht `true` oder `false`. | Einen dieser Werte senden; `1` und `0` werden ebenfalls akzeptiert. |
| `INVALID_FIELD_OPERATION` | 400 | Ein `$inc` / `$push` / `$pull` / `$merge` wurde auf einem Eigenschaftstyp verwendet, für den es nicht definiert ist, mit einem Operanden im falschen Format, mit zwei Operatoren auf einem Feld, falsch geschrieben oder bei einer Erstellung – wo es keinen gespeicherten Wert gibt, auf dem operiert werden könnte. | Siehe [Schreiben über REST](/docs/backend/writes/#field-operations); die Meldung benennt das Feld. |
| `INVALID_FILTER_FIELD` | 400 | Der Filter benennt eine Eigenschaft, die diese Collection nicht besitzt. | Schreibweise anhand der Collection überprüfen. |
| `INVALID_FILTER_OPERATOR` | 400 | Der Operator wird von diesem Eigenschaftstyp nicht unterstützt – beispielsweise `like` auf einer Zahl oder einem Datum. | Siehe [Daten abfragen](/docs/sdk/querying/). |
| `INVALID_FILTER_VALUE` | 400 | Ein Filterwert kann nicht als Typ der Spalte interpretiert werden, mit der er verglichen wurde: `?id=eq.abc` bei einem Integer-Schlüssel, ein Label, das nicht im Enum enthalten ist, ein Timestamp, der keiner ist, eine Zahl außerhalb des Wertebereichs. `details.dbCode` enthält den SQLSTATE. | Einen Wert vom Typ der Spalte senden. |
| `INVALID_HARD_PARAM` | 400 | `?hard=` ist nicht `true` oder `false`. Jeder andere Wert wird abgewiesen, statt als "nein" interpretiert zu werden – ein Tippfehler, der Soft-Delete ausführt, wenn der Aufrufer endgültig löschen wollte, würde ihn fälschlicherweise im Glauben lassen, die Daten seien gelöscht. | `true` oder `false` senden. |
| `INVALID_INCLUDE` | 400 | `?include=` ist fehlerhaft: keine gültige Pfadliste oder ein options-Objekt pro Relation mit falscher Struktur. Ein über mehr als drei Hops verschachtelter Pfad ergibt `INCLUDE_TOO_DEEP` (ebenfalls 400). Wird an der Schnittstelle abgefangen, statt den Treiber mit einem 500-Fehler zu verlassen. | Siehe Meldung; sie benennt den fehlerhaften Pfad. |
| `INVALID_INPUT` | 400 | Der Body hat die Validierung nicht bestanden. | Siehe Meldung. |
| `INVALID_LIMIT` | 400 | `?limit=` ist keine ganze Zahl von 1 bis zum Maximum (standardmäßig 1000); ein größerer Wert wird abgelehnt und nicht gekappt. Eine Realtime-Subscription, die ein Limit außerhalb dieses Bereichs anfordert, erhält denselben Code als WebSocket-`ERROR`-Frame. | Limit reduzieren und den Rest paginieren. |
| `INVALID_LOGICAL_GROUP` | 400 | Eine `?or=`- / `?and=`- / `?not=`-Gruppe ist fehlerhaft aufgebaut oder tiefer als erlaubt verschachtelt. | Siehe Meldung; sie zeigt die Flattening-Regel. |
| `INVALID_OFFSET` | 400 | `?offset=` ist keine ganze Zahl von 0 oder größer. | Eine nicht-negative Ganzzahl senden. |
| `INVALID_ORDER_BY` | 400 | `?orderBy=` entspricht nicht `field`, `field:desc`, `field:desc:last` oder einem JSON-Array von `{ field, direction, nulls }` – oder gibt eine andere Richtung als `asc`/`desc` bzw. eine andere NULL-Platzierung als `first`/`last` an. | Siehe Meldung; sie zeigt alle gültigen Schreibweisen. |
| `INVALID_PAGE` | 400 | `?page=` ist keine ganze Zahl von 1 oder größer. Seitennummern beginnen bei 1; `?page=0` ist daher ein Fehler und nicht die erste Seite. | `1` oder höher senden, oder `?offset=` verwenden. |
| `INVALID_PARAM` | 400 | Ein Query-Parameter ist fehlerhaft. | Siehe Meldung. |
| `INVALID_QUERY_BODY` | 400 | Der Body eines `POST …/query` enthält einen Wert, den die URL nicht hätte transportieren können: eine Liste für einen Parameter, den die URL nur einmal liest (`fields`, `limit`, …), ein Objekt für einen Filter, oder ein beliebiger Parameter, der gleichzeitig auch in der URL steht – ein `POST …/query` liest alle Parameter aus dem Body. | Jeden Wert wie in der URL angeben – ein String oder eine Liste für einen wiederholten Filter; `where`, `include`, `orderBy` und `vector` akzeptieren JSON. Siehe [Abfragen, die zu lang für eine URL sind](/docs/backend/vector-search/#queries-too-long-for-a-url). |
| `INVALID_VECTOR` | 400 | `?vector=` ist kein JSON-Array von Zahlen. | `[0.1,0.2,0.3]` senden. |
| `INVALID_VECTOR_DISTANCE` | 400 | `?vector_distance=` ist nicht `cosine`, `l2` oder `inner_product`. | Einen dieser drei Werte verwenden. |
| `INVALID_VECTOR_THRESHOLD` | 400 | `?vector_threshold=` ist keine Zahl. | Eine Zahl senden. |
| `INVALID_WHERE` | 400 | `?where=` ist kein JSON-Objekt, das Felder auf Bedingungen abbildet. | `{"status":["==","active"]}` senden. |
| `KEY_IMMUTABLE` | 400 | Eine Aktualisierung benennt den Schlüssel der Zeile mit einem anderen Wert als dem, über den sie adressiert wird – im Body oder durch ein `beforeSave` geschrieben. Eine Zeile kann nicht auf einen anderen Schlüssel verschoben werden: Alles nach dem Schreibvorgang (Zurücklesen, `afterSave`, History, Realtime) adressiert sie über den bisherigen Schlüssel. Wird vor der Ausführung von Hooks abgewiesen, ohne dass etwas geschrieben wird, an allen Endpunkten. `details.violations` benennt das Feld. | Die Zeile unter dem neuen Schlüssel neu erstellen und diese hier löschen. Den Schlüssel zu senden, den die Zeile bereits hat, ist zulässig. |
| `MISSING_AGGREGATE_SELECT` | 400 | Die Aggregat-Route wurde ohne `?select=` aufgerufen. | Einen Parameter hinzufügen, z. B. `?select=count()`. |
| `NO_COLLECTIONS` | 404 | Das Projekt stellt keine Collections bereit: keine im Code deklariert und keine Tabellen vorhanden, aus denen sie abgeleitet werden könnten. Wenn Tabellen existieren, aber Row-Level Security auf ihnen deaktiviert ist, nennt die Meldung diese samt SQL zur Aktivierung, und `details.unprotectedTables` listet sie auf; unter 0.24 meldet der Fehler, dass keine Tabellen existieren. | Tabellen anlegen – per Migration, SQL oder Collection-Datei plus `rebase db push` – und neu starten. |
| `NOT_FOUND` | 404 | Keine Zeile mit dieser ID in dieser Collection – oder eine Zeile, die durch Row-Level Security vor diesem Aufrufer verborgen wird. | ID prüfen, dann die `securityRules` der Collection prüfen. |
| `UNKNOWN_RELATION` | 400 / 404 | `?include=` benennt etwas, das keine Relation der Collection ist. Derselbe Code antwortet mit **404**, wenn stattdessen ein verschachtelter *URL-Pfad* eine solche benennt, z. B. `/api/data/authors/1/posts`, wenn `authors` keine solche deklariert – dort benennt die URL nichts, weshalb es sich um "Nicht gefunden" statt um eine fehlerhafte Anfrage handelt. | Namen der Relation prüfen – die Meldung listet die vorhandenen Relationen auf. Eine Rückwärtsreferenz muss auf dem Parent deklariert sein, um navigierbar zu sein. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | Die Sortierung benennt eine Eigenschaft, die nicht sortierbar ist. | Nach einer spaltenbasierten Eigenschaft sortieren. |
| `PAGE_WITH_OFFSET` | 400 | `?page=` wurde mit `?offset=` kombiniert – oder `page` mit `offset` in einem `find()`, was das Client-SDK, das In-Process-`rebase.data` und der Offline-Client mit demselben Code vor jeder Anfrage ablehnen. Beide beschreiben denselben Ausschnitt, und früher überschrieb `page` stillschweigend das `offset`, ohne dass der Aufrufer dies mitbekam. | Nur eines von beiden senden. |
| `PAYLOAD_TOO_LARGE` | 413 | Der Body überschreitet das konfigurierte Limit. | Weniger Daten senden oder das Limit erhöhen. |
| `READ_ONLY_TRANSACTION` | 409 | Ein `afterRead`-Callback hat versucht zu schreiben. Ein anfragebezogener Lesevorgang läuft in einer `READ ONLY`-Transaktion, daher darf weder der Callback noch irgendetwas, das er aufruft, schreiben. | Den Schreibvorgang aus dem Lesevorgang auslagern: Background-Job oder `rebase.dataAsAdmin` aus einem Cron-Job oder einer benutzerdefinierten Funktion. |
| `RELATION_HAS_NO_PIVOT` | 400 | Der Schreibvorgang enthielt eine Link-Payload, aber der Pfad erreicht sein Ziel nicht über ein `manyToMany`, das `through.properties` deklariert – es gibt also keine Zwischentabellen-Zeile (Junction Row), auf der sie abgelegt werden könnte. | `through.properties` an der Relation deklarieren oder die Payload aus dem Schreibvorgang entfernen. Siehe [Relationen](/docs/collections/relations/). |
| `RELATION_MISCONFIGURED` | 500 | Eine Relation lässt sich anhand des registrierten Schemas nicht auflösen. Die Operation wird abgewiesen statt übersprungen: Das Verwerfen würde Erfolg für einen Schreibvorgang melden, der nie stattfand, oder Leere für Zeilen vortäuschen, die eigentlich existieren. | `rebase schema generate` ausführen, falls das generierte Schema älter als die Datenbank ist. |
| `RELATION_NOT_UNLINKABLE` | 400 | Die Verknüpfung der Relation kann von dieser Seite aus nicht aufgehoben werden. | Den Vorgang von der besitzenden Seite aus durchführen. |
| `RELATION_NOT_WRITABLE` | 400 | Der verschachtelte Pfad ist keine beschreibbare Relation, oder ein Create/Update benennt eine Multi-Hop-`via`-Relation – nur Single-Hop-`via`-Relationen sind beschreibbar. `details.fields` listet die `via`-Schlüssel auf. Es wurde nichts geschrieben. | Die Zeilen direkt schreiben, die durch die Kette verbunden werden. Siehe [Relationen](/docs/collections/relations/#via--an-explicit-join-chain). |
| `RELATION_PIVOT_UNSUPPORTED` | 400 | Die Relation deklariert Zwischentabellenspalten, aber diese Datenquelle kann diese nicht schreiben. | Die Verknüpfung selbst funktioniert weiterhin; nur die darauf bezogene Payload nicht. Fähigkeiten des Treibers prüfen. |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | Ein Relations-Schreibvorgang hatte keinen Quellschlüssel, an dem die Verknüpfung verankert werden konnte. | Zuerst die übergeordnete Zeile (Parent) speichern. |
| `RESULT_TOO_LARGE` | — | Ein Statement, das über `EXECUTE_SQL` des Realtime-Sockets gesendet wurde – `admin.executeSql` von einem Client, Katalog-Abfragen des Admin-Panels – hat mehr als 128 MB an Zeilen zurückgegeben, weshalb nichts davon gesendet wurde. Wird als WebSocket-`ERROR`-Frame übermittelt. Ausführungen der SQL-Konsole selbst werden nicht abgewiesen: Sie zeigen die ersten Zeilen an. | `LIMIT` hinzufügen oder weniger Spalten auswählen und das Ergebnis stückweise abrufen. |
| `ROW_IN_TRASH` | 409 | Der Schlüssel eines Upserts gehört zu einer Zeile im Papierkorb (eine als Soft-Delete gelöschte Zeile belegt weiterhin ihren Schlüssel). Ein Upsert schreibt an keinem Endpunkt in eine gelöschte Zeile: REST `?on_conflict=`, `/bulk`- und `/_batch`-Upserts, SDK und Realtime-Socket. Es wurde nichts geschrieben. | Die Zeile zuerst wiederherstellen (Update, das das Soft-Delete-Feld auf `null` setzt) oder mit `?hard=true` endgültig bereinigen und das Upsert wiederholen. Siehe [Soft Delete](/docs/collections/soft-delete/). |
| `SCHEMA_DRIFT` | 500 | Eine Tabelle oder Spalte, die der Code erwartet, existiert in der Datenbank nicht. | `rebase db push` in der Entwicklung; bei einem Managed Tenant neu deployen. |
| `SCORE_CURSOR_UNSUPPORTED` | 400 | `startAfter` wurde mit `orderBy: "_score"` kombiniert. Relevanz wird pro Abfrage berechnet und nicht gespeichert, daher kann sie nicht als Schlüssel für einen Cursor dienen. | Relevanz mit `limit`/`offset` paginieren oder nach einer Spalte sortieren. |
| `SQL_ERROR` | 400 | Die Datenbank hat manuell verfasstes SQL abgewiesen. Über `EXECUTE_SQL` des Realtime-Sockets ist dies ein `ERROR`-Frame mit der Meldung der Datenbank. `POST /api/admin/sql/csv` antwortet damit, bevor Daten der Datei gesendet werden: Syntaxfehler, Schreibvorgang (Download läuft read-only), mehr als ein Statement oder eine Rolle, die die Verbindung nicht annehmen darf. | SQL korrigieren. Ein Download akzeptiert ein einzelnes `SELECT`, `WITH … SELECT`, `TABLE` oder `VALUES`. |
| `TENANT_IMMUTABLE` | 400 | Ein Schreibvorgang würde eine Zeile von einem Mandanten (Tenant) zu einem anderen verschieben. Eine Zeile kann den Mandanten nicht wechseln. `details.violations` benennt das Feld. | Zeile im anderen Mandanten erstellen und diese hier löschen, oder mit einer Rolle aus `tenant.bypassRoles` schreiben. |
| `TENANT_MISMATCH` | 400 | Der Schreibvorgang gibt einen Mandanten an, zu dem dieser Aufrufer nicht gehört; die Datenbank würde dies ebenfalls ablehnen. | In einen Mandanten schreiben, zu dem der Aufrufer gehört, oder als Berechtigter dieses Mandanten authentifizieren. |
| `TENANT_REQUIRED` | 400 | Die Collection ist mandantenbezogen und der Mandant kann nicht abgeleitet werden: Die Anfrage enthält keinen Mandanten oder der Aufrufer gehört mehreren an. | Das Mandantenfeld explizit mitsenden oder als Aufrufer authentifizieren, der genau einem Mandanten angehört. |
| `TRANSACTION_ABORTED` | 500 | Ein Statement in der Transaktion des Schreibvorgangs ist fehlgeschlagen und ein Callback hat den Fehler abgefangen. Postgres hatte die Transaktion bereits abgebrochen, sodass der Schreibvorgang zurückgerollt und nichts gespeichert wurde. Nur ein von der Datenbank abgewiesenes Erstellen, Aktualisieren oder Löschen via `context.data` wird isoliert rückgängig gemacht und kann sicher abgefangen werden. | Den Fehler durchschlagen lassen (throw) oder Bedingungen vor dem Ausführen des Statements prüfen. Siehe [Transaktionssemantik](/docs/collections/context-data-api/#transaction-semantics). |
| `UNKNOWN_FIELD` | 400 | `?fields=` benennt ein Feld, das die Collection nicht besitzt. | Schreibweise prüfen; die Meldung listet die gültigen Felder auf. |
| `UNKNOWN_AGGREGATE_FIELD` | 400 | Ein Aggregat oder `groupBy` benennt ein Feld, das die Collection nicht besitzt. | Schreibweise prüfen; die Meldung listet die gültigen Felder auf. |
| `UNKNOWN_FILTER_FIELD` | 400 | Der Filter benennt ein Feld, das diese Collection – oder das Ziel einer Relation – nicht besitzt, oder eines, das mit `excludeFromApi` verborgen ist. | Schreibweise prüfen; die Meldung listet die gültigen Felder auf. |
| `UNKNOWN_FILTER_OPERATOR` | 400 | Der Filter benennt einen Operator, der nicht existiert. | Die Meldung listet alle verfügbaren Operatoren auf. |
| `UNKNOWN_MESSAGE_TYPE` | 400 | Ein Realtime-Socket-Frame hat einen `type`, den der Server nicht verarbeiten kann. Wird als `ERROR`-Frame mit der `requestId` der Anfrage beantwortet, sodass die Anfrage abgeschlossen wird statt in ein Timeout zu laufen. | `type` des Frames prüfen; die Meldung benennt ihn. |
| `UNKNOWN_ORDER_BY_FIELD` | 400 | Die Sortierung benennt ein Feld, das diese Collection nicht besitzt. | Schreibweise prüfen; die Meldung listet die gültigen Felder auf. |
| `PRECONDITION_FAILED` | 412 | Ein `If-Match` hat eine Version der Zeile benannt, die nicht mehr aktuell ist: Jemand hat zwischen dem Lesen und diesem Schreibvorgang Änderungen daran vorgenommen. Es wurde nichts geschrieben. | Zeile erneut einlesen, Änderung erneut anwenden und das neue `ETag` senden. |
| `UNKNOWN_RESPONSE_FIELD` | 400 | `?fields=` fordert ein Feld an, das die Collection nicht besitzt. | Schreibweise prüfen; die Meldung listet die bekannten Felder auf. |
| `UNKNOWN_VECTOR_PROPERTY` | 400 | Eine Vektorsuche hat eine Eigenschaft benannt, die in dieser Collection kein `vector` ist. | Die Meldung listet die Vektoreigenschaften der Collection auf. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Der `Content-Type` wird von dieser Route nicht akzeptiert. | Den in der Dokumentation der Route angegebenen Typ senden. |
| `UNSUPPORTED_OPTION` | — | Wird geworfen, nicht als HTTP-Status beantwortet: Ein Schreibvorgang über den In-Process-Accessor (`context.data` in einem Callback, `rebase.data` in einer Funktion oder einem Cron-Job) erhielt `ifMatch` oder `idempotencyKey`. Dieser Zugriffsweg hat keine Precondition-Prüfung oder Idempotenz-Speicher, daher wird die Option abgewiesen, bevor etwas geschrieben wird, statt ignoriert zu werden. | Die Option dort weglassen oder den Schreibvorgang über den HTTP-Client durchführen, der beides unterstützt. |
| `UNSUPPORTED_RELATION_FILTER` | 400 | Der Filter verläuft über eine `via`-Relation, deren Join-Pfad nur unidirektional definiert ist, sodass es keinen Bezugspunkt gibt, um eine Unterabfrage zuzuordnen. | Von der besitzenden Seite aus filtern. |
| `UNSUPPORTED_RELATION_FILTER_OPERATOR` | 400 | Der Operator ist für dieses Feld nicht definiert: Eine Relation ohne Spalte in dieser Zeile wird über Mitgliedschaft gefiltert, und Mustervergleiche (`like`, `ilike` und deren Negationen) gelten nur für Text. | Siehe Meldung; sie listet auf, was das Feld akzeptiert. |
| `VALIDATION_CONSTRAINT` | 400 | Ein Wert hat eine von der Eigenschaft deklarierte `validation`-Regel verletzt – Länge, Wertebereich, Muster, Pflichtfeld. | Siehe Meldung; sie benennt jede Verletzung. |
| `VALIDATION_EXCLUDED_FIELDS` | 400 | Der Body schreibt eine Spalte, die mit `excludeFromApi` oder `access: { write: [] }` markiert ist – dieselbe Regel in zwei Schreibweisen. Diese dürfen nur vom Server gesetzt werden: ein Passwort-Hash, ein Verifizierungstoken. Im Gegensatz zu `FIELD_NOT_WRITABLE` ist dies die Antwort für jeden Aufrufer, einschließlich `admin`. | Feld entfernen. Siehe [Feldzugriff](/docs/collections/field-access/). |
| `VALIDATION_INVALID_VALUE` | 400 | Ein Wert passt nicht zu seinem Eigenschaftstyp. | Siehe Meldung; sie benennt die Eigenschaft. |
| `VALIDATION_UNKNOWN_FIELDS` | 400 | Der Body benennt ein Feld, das die Collection nicht besitzt – einschließlich eines `id`-Arguments bei einer Collection, deren Primärschlüssel anders definiert ist. | Schreibweise prüfen; die Meldung listet die bekannten Felder auf. |
| `VECTOR_CURSOR_UNSUPPORTED` | 400 | Ein Cursor (`after` / `startAfter`) wurde mit einer Vektorsuche kombiniert. Zeilen werden nach einer pro Abfrage berechneten Distanz sortiert, die nicht als Cursor-Schlüssel dienen kann; daher enthält eine Vektorauflistung kein `nextCursor`. | Nächste Zeilen mit `limit`/`offset` paginieren. |
| `WRITE_DENIED` | 403 | Eine Sicherheitsregel oder Row-Level-Security-Policy hat den Schreibvorgang abgewiesen. | Die `securityRules` der Collection prüfen. |

## `PG_<SQLSTATE>` — ein von der Datenbank abgewiesenes Constraint

Ein Schreibvorgang, den Postgres aus einem Grund ablehnt, der in den *Daten des Aufrufers* liegt,
antwortet mit dem SQLSTATE im Code: `PG_23505`, `PG_23503` usw. Das ist eine
Familie von Fehlern, keine feste Liste – Postgres definiert Hunderte von SQLSTATEs –, aber nur zwei
Klassen treten hier jemals auf, da nur diese beiden vom Aufrufer verschuldet sind:

- **Klasse 23**, Verletzung von Integritäts-Constraints: ein Duplikat, ein Fremdschlüssel,
  der ins Leere zeigt, eine leere NOT NULL-Spalte;
- **Klasse 22**, Daten-Ausnahme (Data Exception): ein Wert, den der Typ der Spalte nicht aufnehmen kann.

Alles andere – eine abgebrochene Verbindung, eine fehlende Spalte, ein Berechtigungsproblem –
liegt auf Serverseite und bleibt ein `500`. Daher ist `code.startsWith("PG_")` eine zuverlässige Prüfung
für "die gesendete Zeile war fehlerhaft", und die vier unten aufgeführten sind diejenigen, auf die ein
Client in der Praxis trifft. `details.dbCode` enthält bei allen denselben SQLSTATE, und
die Meldung benennt das Constraint.

| Code | Status | Bedeutung | Maßnahme |
| --- | --- | --- | --- |
| `PG_22P02` | 400 | Ein Wert konnte nicht als Typ der Spalte interpretiert werden – das schreibseitige Gegenstück zu `INVALID_FILTER_VALUE`. | Einen Wert vom Typ der Spalte senden. |
| `PG_23502` | 400 | Eine `NOT NULL`-Spalte wurde leer gelassen. | Das Feld mitsenden oder der Spalte einen Standardwert geben. |
| `PG_23503` | 400 / 409 | Beim Speichern verweist ein Fremdschlüssel auf eine Zeile, die nicht existiert (400). Beim Löschen referenzieren andere Zeilen noch diese Zeile (409; ein `RESTRICT`-Schlüssel löst `PG_23001` aus, ebenfalls 409). | Zuerst die Zielzeile erstellen oder die ID korrigieren; beim Löschen zuerst die referenzierenden Zeilen entfernen oder umbiegen. |
| `PG_23505` | 409 | Ein Eindeutigkeits-Constraint (Unique Constraint) wurde verletzt. Die Meldung benennt das Constraint. | Einen anderen Wert verwenden oder die bestehende Zeile aktualisieren. |

## Storage

| Code | Status | Bedeutung | Maßnahme |
| --- | --- | --- | --- |
| `INVALID_LIST_OPTIONS` | 400 | Das `maxResults` einer Storage-Auflistung ist keine ganze Zahl von mindestens 1 oder das `pageToken` stammt nicht von dieser Quelle. Eine Seitengröße unter 1 lieferte früher eine leere Seite mit demselben Token zurück, sodass eine `while (pageToken)`-Schleife nie endete. | Ein positives `maxResults` senden und `nextPageToken` unverändert zurückgeben. |
| `INVALID_STORAGE_BUCKET` | 400 | Der Bucket-Name ist fehlerhaft. | Den Namen überprüfen. |
| `INVALID_STORAGE_KEY` | 400 | Der Objektschlüssel ist fehlerhaft, bricht aus seinem Präfix aus oder liegt unter einem reservierten Präfix (`_rebase/renditions/`, `_rebase/maintenance/`). | Den Schlüssel überprüfen. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | Die Parameter für die Bildtransformation liegen außerhalb des gültigen Bereichs oder widersprechen sich. | Siehe [Storage](/docs/backend/storage/). |
| `STORAGE_FILE_TOO_LARGE` | 413 | Der Upload überschreitet das von der Zieleigenschaft deklarierte `maxSize`. Wird auf dem Server erzwungen, nicht nur im Browser. `details` enthält die Eigenschaft, das Limit und die tatsächliche Größe. | Eine kleinere Datei hochladen oder `maxSize` für die Eigenschaft erhöhen. |
| `STORAGE_FILE_TYPE_REFUSED` | 400 | Der Dateityp des Uploads ist nicht in den `acceptedFiles` der Eigenschaft oder nicht in den `allowedMimeTypes` der Storage-Quelle enthalten. `details` enthält die Eigenschaft (oder die Liste der Quelle), die Liste der akzeptierten Typen und den gesendeten Content-Type. | Einen akzeptierten Typ hochladen oder `acceptedFiles` / `allowedMimeTypes` erweitern. |
| `STORAGE_MISCONFIGURED` | 502 | Der für diese Quelle konfigurierte S3- oder GCS-Bucket existiert nicht, oder der Anbieter hat die Zugangsdaten dieses Deployments dafür abgelehnt. Die Meldung benennt den Bucket; `details.reason` ist `NoSuchBucket` oder die Ablehnung des Anbieters. Ein fehlender Bucket wurde früher bei jeder Datei als "Datei nicht gefunden" interpretiert. | Bucket-Namen (`S3_BUCKET` / `GCS_BUCKET`, `__<KEY>` für eine benannte Quelle) oder Berechtigungen der Zugangsdaten korrigieren. |
| `STORAGE_NOT_CONFIGURED` | 501 / 503 | Auf diesem Server ist kein Storage-Backend konfiguriert, oder keines ist als Standard definiert und die Anfrage benennt keine Storage-Quelle; die Meldung nennt die bereitgestellten Quellen (501). Ein fortsetzbarer Upload (Resumable Upload), dessen Quelle vor Abschluss verschwunden ist, ergibt 503. | S3, GCS oder lokalen Speicher konfigurieren oder eine Quelle mit `?storageId=` angeben. |
| `STORAGE_SAME_LOCATION` | 400 | `POST /api/admin/storage/move` mit `deleteSource` (`rebase storage move --delete-source`) zwischen zwei Quellen, die im selben Bucket oder Verzeichnis speichern. Da es sich um dieselbe Datei handelt, würde jede Datei im Ziel bereits als vorhanden gelten, und das Löschen der Quellkopie würde das einzige Exemplar löschen. Nichts wurde verschoben oder gelöscht. | Die Eigenschaft auf die andere Quelle verweisen lassen; ihre Dateien befinden sich bereits dort. |
| `STORAGE_SCAN_INCOMPLETE` | 409 | `DELETE /api/admin/storage/orphans` (`rebase storage orphans --delete`) konnte nicht alle Collections lesen, sodass eine Datei, die von einer dieser Collections referenziert wird, als unbenutzt erscheinen würde. Bei Angabe von `?scan=` ist der angegebene Scan derjenige, der nicht alle Collections lesen konnte. Nichts wurde gelöscht; `details.unscanned` nennt jede Collection und den Grund, warum sie nicht gelesen werden konnte. | Das Problem beheben, das das Lesen dieser Collections verhindert, und den Vorgang wiederholen. |
| `STORAGE_SCAN_NOT_FOUND` | 404 | `GET /api/admin/storage/orphans/scans/:id` oder `DELETE /api/admin/storage/orphans?scan=:id` benennt einen Scan, den die Quelle nicht enthält. Scans werden 7 Tage lang in der Quelle aufbewahrt, die sie gescannt haben; eine von der des Scans abweichende `storageId` findet daher ebenfalls nichts. | Die `storageId` des Scans übergeben oder einen neuen Scan starten. |
| `STORAGE_SCAN_NOT_COMPLETE` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` benennt einen Scan, der noch den Status `queued` oder `running` hat oder `failed` ist. Nichts wurde gelöscht; `details.status` gibt den Status an. | Warten, bis der Scan abgeschlossen ist, oder einen neuen starten. |
| `STORAGE_SCAN_EXPIRED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` benennt einen Scan, der vor mehr als 15 Minuten abgeschlossen wurde. Nichts wurde gelöscht. | Einen neuen Scan starten und ausgehend von diesem löschen. |
| `STORAGE_SCAN_DELETION_STARTED` | 409 | `DELETE /api/admin/storage/orphans?scan=:id` benennt einen Scan, dessen verwaiste Dateien bereits gelöscht werden. | Den Löschstatus des Scans mit `GET /api/admin/storage/orphans/scans/:id` abrufen. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | Die Storage-Quelle ist deklariert, verfügt hier jedoch über keine Anmeldeinformationen. | Umgebungsvariablen dieser Quelle setzen. |
| `STORAGE_WRITE_FAILED` | 502 | Das Storage-Backend hat den Schreibvorgang verweigert oder abgebrochen. | Eigene Logs und Zugangsdaten des Storage-Backends prüfen. |
| `TRANSFORM_OVERLOADED` | 503 | Zu viele Bildtransformationen werden derzeit verarbeitet. | Erneut versuchen; den Einsatz eines CDN vorschalten. |
| `UNKNOWN_STORAGE_SOURCE` | 400 / 404 | Die Anfrage hat eine Storage-Quelle (`?storageId=`) benannt, die dieses Projekt nicht deklariert. Ein `bucket`, den dieses Deployment nicht bedient, ist derselbe Code mit Status **404** (bei Auflistung sowie beim Upload, einem Ordner oder einem fortsetzbaren Upload zu S3 oder GCS) – der Speicher selbst fehlt, und `details` benennt die existierenden Buckets und Quellen. Beides wurde früher als "Datei nicht gefunden" zurückgegeben, identisch zu einem Key, der schlicht nicht existiert. | Die Quelle in `config/resources.ts` deklarieren oder `GET /api/storage/sources` prüfen. |
| `UPLOAD_LOCKED` | 423 | Der `PATCH`-Request eines fortsetzbaren Uploads traf ein, während ein anderer Chunk desselben Uploads noch empfangen wurde – fast immer versucht ein Client dabei den noch laufenden Chunk erneut zu senden. Er wird abgewiesen statt in eine Warteschlange eingereiht (wie bei tusd). | Den Offset mit `HEAD /api/storage/tus/:id` abfragen und von dort fortsetzen; `tus-js-client` wartet ab und wiederholt dies selbstständig. Siehe [Fortsetzbare Uploads (TUS)](/docs/backend/storage-resumable-uploads/). |

## Benutzerdefinierte Funktionen

| Code | Status | Bedeutung | Maßnahme |
| --- | --- | --- | --- |
| `FUNCTION_NOT_FOUND` | 404 | Keine Funktion dieses Namens wird bereitgestellt – oder sie wird bereitgestellt, aber ihre eigenen Routen decken den Pfad dahinter nicht ab. Einem angemeldeten Aufrufer wird auch mitgeteilt, was *tatsächlich* bereitgestellt wird; einem anonymen Aufrufer nicht, da diese Liste ein Verzeichnis aller benutzerdefinierten Endpunkte darstellt. Wenn eine Datei dieses Namens nicht geladen werden konnte, informiert die Meldung einen angemeldeten Aufrufer darüber und nennt die Datei: Das ist der Unterschied zwischen einem Tippfehler und einem fehlerhaften Deployment. Ein anonymer Aufrufer erhält die einfache Antwort für unbekannte Namen, wie bei einem Namen, der mit nichts übereinstimmt. | Namen mit `GET /api/functions` abgleichen oder das Boot-Log auf Dateien prüfen, die nicht geladen werden konnten. |
| `FUNCTION_TIMEOUT` | 504 | Der Handler hat sein Timeout überschritten. Er läuft weiterhin; er kann von hier aus nicht abgebrochen werden. | Ausgehenden Aufrufen ein `AbortSignal` mitgeben oder `REBASE_FUNCTIONS_TIMEOUT_MS` erhöhen. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | Dieser Prozess leitet Funktionen per Proxy an einen anderen weiter, der nicht geantwortet hat. | Prüfen, ob die Functions-Unit läuft. |

## Cron-Jobs

| Code | Status | Bedeutung | Maßnahme |
| --- | --- | --- | --- |
| `CRON_JOB_ALREADY_EXECUTING` | 409 | Ein manueller Trigger eines Cron-Jobs, der bereits läuft – auf dem Prozess, der geantwortet hat, oder auf einem anderen, der den Ausführungs-Lease des Jobs hält (z. B. der Worker hinter einem `api`-Prozess). Nichts wurde ausgeführt. Das Überspringen wird in der Historie des Jobs vermerkt, und `details.log` ist dieser Eintrag; die Zeile nennt den Prozess, der den Job ausführt. | Erneut versuchen, wenn dieser Durchlauf beendet ist. Siehe [Cron-Jobs](/docs/backend/cron-across-instances/#concurrency-guarding). |

## Admin-Oberflächen und Schema-Bearbeitung

Diese Codes besagen, dass ein Feature deaktiviert oder nicht konfiguriert ist, und nicht, dass die Anfrage
fehlerhaft war. Jeder dieser Fehler wird auch auf der entsprechenden `/status`-Route mit `200`
gemeldet, damit ein Frontend das Feature ausgrauen kann, anstatt einen Fehler anzuzeigen.

| Code | Status | Bedeutung | Maßnahme |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | Eine reine Admin-Oberfläche wurde auf einem Server aufgerufen, auf dem keine Authentifizierung konfiguriert ist, sodass ein Admin nicht von einem Fremden unterschieden werden kann. | `auth.jwtSecret` setzen oder einen `AuthAdapter` übergeben. |
| `BRANCH_DIFF_STALE` | 409 | An `POST /api/admin/branches/:name/merge` wurde der Fingerprint eines Diffs gesendet, der nicht mehr aktuell ist: Der Branch oder sein Parent hat sich in der Zwischenzeit geändert. Es wurde nichts geschrieben. | Diff erneut abrufen, prüfen und mit dem neuen `fingerprint` mergen. |
| `BRANCH_DIFF_UNSUPPORTED` | 501 | Die Datenquelle kann Branches nicht vergleichen: Sie unterstützt kein SQL oder kein Branching (keine Admin-Verbindung). | Ein Postgres-Backend mit gesetztem `adminConnectionString` verwenden. |
| `BRANCH_MERGE_BLOCKED` | 409 | Eine Tabelle mit Unterschieden kann nicht gemergt werden – durch den Branch hinzugefügt oder entfernt, abweichende Spalten oder Primärschlüssel, kein Primärschlüssel vorhanden, zu viele Zeilen für einen Abgleich oder seit Erstellung des Branches neu geschrieben (`TABLE_REWRITTEN`). Eine Tabelle, deren Zeilen nicht abgeglichen werden konnten, blockiert selbst dann, wenn ihre Zeilenzahl 0 anzeigt: Die Zahlen sind unbekannt, nicht null. `details.tables` benennt jede Tabelle samt Begründung. Es wurde nichts geschrieben. | Schema zuerst über eigene Migrationen anwenden oder mit `skipBlocked: true` mergen, um diese Tabellen unverändert zu lassen. |
| `BRANCH_MERGE_CONFLICT` | 409 | Zeilen wurden sowohl auf dem Branch als auch auf seinem Parent geändert, und `onConflict` war auf `"abort"` gesetzt (Standard); oder der Parent hat einen Teil des Merges abgelehnt – eine Zeile wurde zwischenzeitlich geändert, ein Trigger hat sie übersprungen, eine Policy hat sie verborgen. Es wurde nichts geschrieben. | Mit `onConflict: "branch"` oder `"target"` festlegen, welche Seite Vorrang hat, oder das Diff erneut abrufen. |
| `BRANCH_MERGE_FAILED` | 409 | Der Parent hat die Zeilen des Branches innerhalb des Merge-Statements abgelehnt – ein Constraint, ein Enum-Wert oder ein Fremdschlüssel, der auf dem Parent existiert und durch die Zeilen des Branches verletzt wird, meist aufgrund unterschiedlicher Schemas. `details` enthält `sqlState`, `table`, `constraint` und `detail`. Es wurde nichts geschrieben. | Schema-Änderungen im Diff prüfen, das Schema des Parents über Migrationen angleichen oder die Zeilen des Branches korrigieren, dann erneut mergen. |
| `BRANCH_NOT_FOUND` | 404 | Kein Branch mit diesem Namen in der Registry gefunden. | `rebase db branch list` oder der Branches-Bereich listet die vorhandenen Branches auf. |
| `CONTRACT_UNAVAILABLE` | 404 | Der Projekt-Vertrag (Contract) wird nur bereitgestellt, wenn Authentifizierung konfiguriert ist – er beschreibt jede Tabelle und Relation. | Authentifizierung konfigurieren. `/meta/schema-version` wird immer bereitgestellt. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | Kein Entwicklungs-Postfach aktiv. E-Mails werden nur abgefangen, wenn `SMTP_HOST` nicht gesetzt und `NODE_ENV` nicht `production` ist. | `SMTP_HOST` in der Entwicklungsumgebung entfernen oder das echte Postfach prüfen. |
| `INVALID_CHANGE` | 400 | Die vorgeschlagene Schema-Änderung ist nicht wohlgeformt. | Siehe Meldung. |
| `SCHEMA_CHANGE_FAILED` | 400 | Das Anwenden einer geplanten Schema-Änderung ist aus einem Grund fehlgeschlagen, den spezifischere Codes nicht abdecken. | Siehe Meldung; sie gibt den zugrundeliegenden Fehler wortwörtlich wieder. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | Die Änderung ist gültig, kann jedoch auf das aktuelle Schema nicht angewendet werden. | Siehe Meldung. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | Das Repository enthält nicht committete Änderungen, sodass die Bearbeitung nicht sicher angewendet werden konnte. | Committen oder stashen, dann erneut versuchen. |
| `SCHEMA_EDIT_REFUSED` | 400 | Der Schema-Editor hat die Änderung verweigert. | Siehe Meldung; es ist die direkte Ablehnung des Editors. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | Ein API-Schlüssel oder ein anderer maschineller Principal hat versucht, eine Schema-Änderung anzuwenden. | Als Benutzer anmelden oder `liveSchema.allowMachineApply` setzen. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | Live-Schema-Bearbeitung erfordert `collectionsDir` oder `liveSchema.repository`, und dieser Server wurde ohne beides gestartet. | Eines davon konfigurieren. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | Die Planung funktioniert; es ist jedoch kein Repository konfiguriert, in das die Änderung committet werden könnte. | `liveSchema.repository` konfigurieren. |
| `SCHEMA_EDITING_PROVISIONING_OFF` | 409 | Dieses Deployment ändert nichts an seiner Datenbank (`REBASE_PROVISION=false`), daher kann eine Änderung nicht über das Panel angewendet werden. | Nur als Quellcode committen und die Änderung durch den Prozess anwenden lassen, der die Datenbank verwaltet. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | Dieser Treiber kann keine Schema-Änderungen planen. | Live-Bearbeitung ist auf Postgres verfügbar. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | Collections werden hier per Introspektion aus der Datenbank geladen, daher gibt es keine Quelldateien zum Bearbeiten. | Schema über eine Migration ändern. |
| `SCHEMA_EDITOR_DISABLED` | 501 | Der Schema-Editor ist für diesen Server deaktiviert. Ein fertig gebautes Bundle antwortet immer hiermit. | Über `schemaEditor` aktivieren. Bei einem Bundle `REBASE_LIVE_SCHEMA_REPOSITORY` setzen, um Collections über ein Repository zu bearbeiten – siehe [Live-Schema-Bearbeitung](/docs/backend/live-schema-editing#from-a-built-bundle). |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | Der Schema-Editor benötigt `ts-morph`, was nicht installiert ist. | Im Package installieren, das das Backend ausführt, und neu starten: `pnpm --dir backend add -D ts-morph@28.0.0` im Root-Verzeichnis eines Scaffold-Projekts oder `pnpm add -D ts-morph@28.0.0`, wenn das Backend das Hauptprojekt ist. Die Meldung nennt den genauen Befehl für Ihr Projekt. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | Der Server hat kein `collectionsDir`, daher hat der Editor kein Ziel zum Schreiben. | `collectionsDir` konfigurieren. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | Der Editor ist unter `NODE_ENV=production` deaktiviert: Die Dateien eines deployten Servers werden bei jedem Deployment neu aus dem Repository gebaut, sodass eine Bearbeitung hier verworfen werden würde. | Collections in der Entwicklungsumgebung bearbeiten und deployen, oder `liveSchema.repository` konfigurieren, um sie dort zu committen. |
| `SQL_EXPORT_UNSUPPORTED` | 501 | `POST /api/admin/sql/csv` kann hier kein Ergebnis streamen: Die prozessinterne Entwicklungsdatenbank (PGlite) verfügt nur über eine Verbindung, und ein über einen Download hinweg gehaltener Cursor würde jede andere Abfrage dahinter blockieren; oder die Datenquelle unterstützt keine SQL-Cursor. | `DATABASE_URL` auf eine eigene Postgres-Instanz zeigen lassen (`rebase dev --docker` startet eine) oder ein `LIMIT` hinzufügen und die Zeilen auf dem Bildschirm exportieren. |

### Warum die Tabelle eines Branches nicht gemergt werden kann

`BRANCH_MERGE_BLOCKED` benennt jede abgelehnte Tabelle in `details.tables` mit einem
dieser Codes. Derselbe Code steht auch bei `blocked` der Tabelle im Diff selbst,
sodass Studio dies anzeigen kann, bevor jemand auf **Merge** klickt. Keiner dieser Codes ist eine eigenständige
HTTP-Antwort.

| Code | Status | Bedeutung | Maßnahme |
| --- | --- | --- | --- |
| `COLUMNS_DIFFER` | — | Die Spalten der Tabelle unterscheiden sich zwischen dem Branch und seinem Parent. Zeilen werden anhand der gemeinsamen Spalten verglichen. | Fehlende Spalten über Migrationen (`rebase db push`) zum Parent hinzufügen, dann mergen. Eine Migration, die die Tabelle neu schreibt – etwa eine Änderung des Spaltentyps –, führt zu `TABLE_REWRITTEN`: vor einer solchen Änderung mergen oder den Branch danach neu erstellen. |
| `NO_PRIMARY_KEY` | — | Die Tabelle hat keinen Primärschlüssel, sodass Zeilen nicht einzeln abgeglichen werden können; das Diff liefert nur die Zeilenanzahl. | Der Tabelle einen Primärschlüssel geben oder ihre Zeilen manuell übertragen. |
| `PRIMARY_KEY_DIFFERS` | — | Die Spalten des Primärschlüssels oder deren Typen unterscheiden sich zwischen beiden Seiten. | Das Schema zuerst auf den Parent anwenden. |
| `TABLE_ADDED` | — | Der Branch hat die Tabelle erstellt. Ein Merge erstellt niemals Tabellen. | Die Tabelle über Migrationen auf dem Parent erstellen, dann ihre Zeilen mergen. |
| `TABLE_DROPPED` | — | Der Branch hat die Tabelle gelöscht. Ein Merge löscht niemals Tabellen. | Die Tabelle über Migrationen löschen. |
| `TABLE_REWRITTEN` | — | Eine Seite hat nach der Erstellung des Branches jede Zeile der Tabelle neu geschrieben – eine Spaltentypänderung, ein `ADD COLUMN` mit volatilem Standardwert, `VACUUM FULL`, `CLUSTER` – sodass jede Zeile als seitdem geändert gilt und nicht mehr ermittelt werden kann, welche Seite welche Zeile geändert hat. | Den Branch vor einer solchen Migration mergen oder ihn danach neu vom Parent abzweigen. |
| `TOO_LARGE` | — | Die Tabelle enthält auf einer Seite mehr Zeilen, als ein Diff einzeln abgleicht (standardmäßig 100.000, `maxRowsPerTable`). | `maxRowsPerTable` sowohl für das Diff als auch für den Merge erhöhen oder die Zeilen auf anderem Weg übertragen. |

## Generische Codes

Eine Route verwendet einen dieser Codes, wenn kein spezifischerer Code zutrifft.

| Code | Status | Bedeutung | Maßnahme |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Fehlerhafte Anfrage, und kein spezifischerer Code trifft zu. | Siehe Meldung. |
| `UNAUTHORIZED` | 401 | Nicht authentifiziert oder Anmeldedaten wurden abgelehnt. | Anmelden oder aktualisieren. |
| `FORBIDDEN` | 403 | Authentifiziert, aber nicht berechtigt. | Ein erneuter Versuch mit derselben Identität hilft nicht. |
| `CONFLICT` | 409 | Ein Konflikt mit dem bestehenden Zustand. | Siehe Meldung. |
| `INTERNAL_ERROR` | 500 | Auf dem Server ist ein Fehler aufgetreten. Die Meldung ist absichtlich generisch gehalten. | `requestId` angeben; die Ursache steht in den Logs. |
| `NOT_CONFIGURED` | 503 | Eine Abhängigkeit, die diese Route benötigt, ist auf diesem Server nicht konfiguriert. | Siehe Meldung. |
| `SERVICE_UNAVAILABLE` | 503 | Ein Dienst, von dem die Anfrage abhängt, konnte nicht erreicht werden: ein S3- oder MinIO-Bucket oder ein Host, den eine Funktion per `fetch()` aufruft, der die Verbindung verweigert oder nicht aufgelöst werden kann. Das Server-Log nennt den Host; die Antwort tut dies nicht. Eine nicht erreichbare Datenbank ergibt `DATABASE_UNAVAILABLE`. Eine fehlschlagende Verbindung zu einem solchen Dienst antwortet hiermit; unter 0.24 antwortet sie mit einem `500`-Fehler, dessen Code der Socket-Fehler ist (`ECONNREFUSED`), oder mit `INTERNAL_ERROR`. | Erneut versuchen; Logs prüfen. |

## Diese Seite aktuell halten

`pnpm verify:docs` schlägt fehl, wenn ein Code, den der Server auslösen kann, in diesen
Tabellen fehlt, wenn eine Tabelle einen Code auflistet, den nichts auslösen kann, wenn die Statuswerte einer Zeile nicht
exakt denen entsprechen, mit denen der Quellcode den Code auslöst, oder wenn eine Code-Familie wie `PG_<SQLSTATE>` keine Zeile
für einen SQLSTATE hat, auf den Aufrufer treffen können. Die entsprechende Stufe ist
`tooling/scripts/docs-verify/check-error-codes.mjs`.

Sie prüft sich zuerst selbst. Der Scan liest Codes aus TypeScript-Dateien statt aus
einem laufenden Server aus, weshalb seine blinden Flecken prinzipbedingt unbemerkt blieben: Einst
konnte er einen Code nicht erkennen, der über einen Einzeiler-Wrapper übergeben wurde, oder einen, der nach einer Nachricht
mit einer `)` stand, und meldete "jeder Code, den der Server auslösen kann, ist dokumentiert"
auf einer Seite, auf der siebzehn davon fehlten. Daher führt die Prüfstufe eine Testvorlage mit exakt
diesen Mustern aus, bevor sie diese Seite liest, und verweigert jegliche Meldung, wenn sie diese nicht
erkennen kann.
