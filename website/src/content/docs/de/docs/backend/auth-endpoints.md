---
sourceHash: 928eebeb904fa5e0
title: Auth-Endpunkte und Token
sidebar_label: Auth-Endpunkte
description: Die Authentifizierungs-Routen, die das Rebase-Backend bereitstellt, deren Antwortstrukturen, Multi-Faktor-Authentifizierung, der Datenbankkontext für Policies, JWKS und Service-Keys.
---

Die Routen, die [der `auth`-Block](/docs/backend/authentication/) bereitstellt, und die Token, die sie zurückgeben.

## Auth-Endpunkte

Alle Auth-Endpunkte sind unter `/api/auth/` bereitgestellt:

| Methode | Pfad | Beschreibung |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Ein neues Konto erstellen |
| `POST` | `/api/auth/login` | Anmelden mit E-Mail/Passwort |
| `POST` | `/api/auth/refresh` | Das Access-Token aktualisieren |
| `POST` | `/api/auth/<provider>` | OAuth-Anmeldung (z. B. `/api/auth/google`, `/api/auth/linkedin`) |
| `POST` | `/api/auth/link/<provider>` | Einen OAuth-Anbieter mit dem authentifizierten Konto verknüpfen. Bei einem Gast ist dies eine Registrierung: Sie erfordert `allowRegistration`, übernimmt die Adresse des Anbieters, wenn dieser dafür bürgt, und antwortet mit einer Sitzung für das Konto, zu dem der Gast geworden ist |
| `POST` | `/api/auth/logout` | Refresh-Token widerrufen |
| `POST` | `/api/auth/forgot-password` | E-Mail zum Zurücksetzen des Passworts senden |
| `POST` | `/api/auth/reset-password` | Passwort mit Token zurücksetzen |
| `POST` | `/api/auth/find-user` | Eine E-Mail zu einem minimalen öffentlichen Profil auflösen (Opt-in — `AUTH_ALLOW_USER_LOOKUP`) |
| `POST` | `/api/auth/change-password` | Das eigene Passwort des Aufrufers ändern (authentifiziert). Beendet jede andere Sitzung und antwortet mit einer neuen für den Aufrufer |
| `GET` | `/api/auth/me` | Das eigene Profil des Aufrufers |
| `PATCH` | `/api/auth/me` | Das eigene Profil des Aufrufers aktualisieren |
| `POST` | `/api/auth/change-email` | `{ newEmail }`: Überträgt das eigene Konto des Aufrufers auf eine andere Adresse. Sendet einen Link an die neue Adresse und eine Benachrichtigung an die alte; nichts ändert sich, bis dem Link gefolgt wird. Erfordert `aal2` bei einem Konto mit einem zweiten Faktor. `409 EMAIL_EXISTS` oder `UNDELIVERABLE_ADDRESS`, `400 EMAIL_UNCHANGED`, `403 ANONYMOUS_USER` für einen Gast — siehe [Ändern einer E-Mail-Adresse](#ändern-einer-e-mail-adresse) |
| `POST` | `/api/auth/confirm-email-change` | `{ token }` aus dem Link. Keine Sitzung erforderlich. Überträgt das Konto verifiziert auf die neue Adresse; `400 INVALID_TOKEN` bei einem bereits verwendeten, ersetzten oder abgelaufenen Link, `409 EMAIL_EXISTS`, wenn die Adresse während des Wartens vergeben wurde |
| `GET` | `/api/auth/config` | Was dieses Backend einer Anmeldeseite bietet — `needsSetup`, `registrationEnabled`, `passwordReset`, `emailVerification`, `magicLink`, `anonymousLogin`, `adminPasswordReset`, `enabledProviders` und `storage`, welches angibt, ob das Backend Dateispeicher bereitstellt. Unauthentifiziert und basierend auf denselben Prädikaten berechnet, die die Routen erzwingen, sodass die Angaben auf der Oberfläche nicht von den tatsächlichen Möglichkeiten abweichen können |
| `POST` | `/api/auth/send-verification` | Dem Aufrufer einen Link zur E-Mail-Verifizierung senden |
| `GET` | `/api/auth/verify-email` | Einen Verifizierungslink einlösen (die URL in dieser E-Mail). Behält bei, was eine aktive Sitzung des Kontos nachweist, und entfernt, was niemand nachgewiesen hat — siehe [E-Mail-Verifizierung](/docs/backend/email-verification/) |
| `POST` | `/api/auth/verify-email` | Dasselbe mit `{ token, password?, removeUnproven? }`: Das Passwort behält es bei und meldet an; ohne Nachweis antwortet ein Konto, das einen hält, mit `409 PROOF_REQUIRED` |
| `POST` | `/api/auth/magic-link` | Einen einmaligen Anmeldelink per E-Mail senden. `503 EMAIL_NOT_CONFIGURED` ohne SMTP |
| `POST` | `/api/auth/magic-link/verify` | Ein Magic-Link-Token gegen eine Sitzung eintauschen |
| `POST` | `/api/auth/otp` | Einen sechsstelligen Anmeldecode per E-Mail senden. Antwortet identisch, unabhängig davon, ob für die Adresse ein Konto existiert |
| `POST` | `/api/auth/otp/verify` | `{ email, code }` gegen eine Sitzung eintauschen |
| `POST` | `/api/auth/anonymous` | Eine anonyme Sitzung erstellen (Opt-in — `ALLOW_ANONYMOUS`) |
| `POST` | `/api/auth/anonymous/link` | Echte Anmeldedaten an das bereits angemeldete anonyme Konto anhängen. Erfordert sowohl `allowAnonymous` als auch eine offene Registrierung: `403 ANONYMOUS_AUTH_DISABLED`, sobald die anonyme Anmeldung deaktiviert ist (einschließlich zuvor angemeldeter Gäste), und `403 REGISTRATION_DISABLED`, solange die Registrierung geschlossen ist |
| `GET` | `/api/auth/sessions` | Die aktiven Sitzungen des Aufrufers auflisten, eine pro Anmeldung. Die eigene des Aufrufers ist als `isCurrentSession` markiert |
| `DELETE` | `/api/auth/sessions` | Jede Sitzung widerrufen, einschließlich dieser — Remote-Abmeldung auf jedem Gerät |
| `DELETE` | `/api/auth/sessions/:id` | Eine Sitzung widerrufen: ihr Refresh-Token und das Access-Token, das dieses Gerät hält |
| `GET` | `/api/auth/scopes` | Jeder [Scope](/docs/backend/roles-and-scopes/), den dieses Backend kennt, und diejenigen, die der Aufrufer besitzt |
| `GET` | `/api/auth/keys` | Die eigenen [persönlichen API-Schlüssel](/docs/backend/api-keys/#personal-keys) des Aufrufers |
| `POST` | `/api/auth/keys` | Einen persönlichen Schlüssel erstellen. `403 PERSONAL_KEYS_DISABLED`, es sei denn, die Users-Tabelle setzt `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | Einen der eigenen Schlüssel des Aufrufers widerrufen |
| `GET` | `/.well-known/jwks.json` | Das öffentliche JWKS — im Root gemountet, nicht unter `basePath`, da ein Verifier dort sucht. Gemountet, wann immer das Backend eigene Token ausstellt; ein leeres Schlüsselset, bis [asymmetrisches Signieren](#asymmetrische-token-und-jwks) konfiguriert ist |
| `POST` | `/api/auth/mfa/enroll` | TOTP-Registrierung starten (gibt das Secret und Wiederherstellungscodes zurück) |
| `POST` | `/api/auth/mfa/verify` | Eine Registrierung mit einem Code aus dem Authenticator bestätigen |
| `GET` | `/api/auth/mfa/factors` | Die registrierten Faktoren des Aufrufers auflisten |
| `POST` | `/api/auth/mfa/challenge` | Eine Challenge für einen verifizierten Faktor öffnen |
| `POST` | `/api/auth/mfa/challenge/verify` | Eine Challenge beantworten — dies stellt die Sitzung aus |
| `DELETE` | `/api/auth/mfa/unenroll` | Einen Faktor entfernen (erfordert eine `aal2`-Sitzung, sobald das Konto über einen verifizierten Faktor verfügt) |
| `POST` | `/api/auth/mfa/recovery-codes` | Die Wiederherstellungscodes des Aufrufers durch zehn neue ersetzen (erfordert eine `aal2`-Sitzung) |

Die administrative Benutzer- und Rollenverwaltung ist eine **separate Schnittstelle**, die unter `/api/admin/` statt unter `/api/auth/` bereitgestellt wird. Für das Lesen ist der Scope `users:read` erforderlich, für Änderungen `users:write`, mit Ausnahme des unten beschriebenen eingeschränkten Lesens des User-Pickers. Ein Admin und der Service-Key besitzen beide; ebenso eine Rolle, die sie deklariert. Niemand darf ein Konto ändern, das über mehr Berechtigungen verfügt als man selbst. Siehe [Rollen und Scopes](/docs/backend/roles-and-scopes/).

| Methode | Pfad | Beschreibung |
|--------|------|-------------|
| `GET` | `/api/admin/users` | Benutzer auflisten (paginiert). `?search=` gleicht einen Teil der E-Mail oder des Anzeigenamens ohne Berücksichtigung der Groß-/Kleinschreibung ab. Es gleicht auch jede Rolle ab, die der Benutzer besitzt, sowie die UID |
| `GET` | `/api/admin/users/pick` | Das Lesen des User-Pickers: `uid`, `displayName`, `email` und `photoURL` pro Benutzer, sonst nichts. Akzeptiert `?search=`, `?limit=` (standardmäßig 25) und `?offset=`, oder `?ids=a,b` für die Benutzer, die ein gespeicherter Wert benennt. Antwortet bei `users:read` sowie für jeden, der eine Collection mit einem [`userSelect`](/docs/collections/properties/)-Feld schreiben darf — damit ein Editor dieses ausfüllen kann. Eine als reines SQL geschriebene Regel (`using` / `withCheck`, die das Policy-Modell nicht lesen kann) kann vorab nicht beurteilt werden, weshalb sie hier als Verweigerung gilt: Bei einer solchen Collection können nur Inhaber von `users:read` auswählen. Alle anderen erhalten `403 SCOPE_MISSING` |
| `POST` | `/api/admin/users` | Einen Benutzer erstellen. `invite: false` ohne `password` erstellt ihn ohne Passwort und sendet nichts |
| `POST` | `/api/admin/users/import` | Konten aus einem anderen System importieren und deren IDs beibehalten. Siehe [Konten importieren](#konten-importieren) |
| `GET` | `/api/admin/users/:uid` | Einen Benutzer lesen |
| `PUT` | `/api/admin/users/:uid` | Einen Benutzer aktualisieren. `{ disabled: true }` deaktiviert das Konto, ohne es zu löschen: Jede Anmeldung und Aktualisierung wird verweigert (`ACCOUNT_DISABLED`), seine Sitzungen enden und jedes Token, das es hält, wird verweigert; `false` schaltet es wieder ein |
| `DELETE` | `/api/admin/users/:uid` | Einen Benutzer löschen. Seine Sitzungen enden und jedes Access-Token, das er besitzt, wird ab dieser Anfrage verweigert |
| `POST` | `/api/admin/users/:uid/reset-password` | Das Passwort eines Benutzers ohne dessen aktuelles Passwort zurücksetzen. `rebase auth reset-password` ruft dies auf und schreibt nur dann direkt in die Datenbank, wenn das Backend nicht erreichbar ist; in beiden Fällen enden die Sitzungen des Kontos |
| `DELETE` | `/api/admin/users/:uid/mfa` | Die zweiten Faktoren und Wiederherstellungscodes eines Benutzers entfernen und dessen Sitzungen beenden — für jemanden, der beides verloren hat |
| `GET` | `/api/admin/roles` | `admin` und die Rollen, die die Users-Tabelle deklariert, mit ihren Scopes |
| `POST` | `/api/admin/bootstrap` | Dem am frühesten registrierten Benutzer erlauben, die Admin-Rolle zu beanspruchen, solange keine existiert. In der Produktion verweigert — siehe [First User Bootstrap](/docs/backend/authentication/#first-user-bootstrap) |

Alle Daten-API-Endpunkte erfordern einen gültigen `Authorization: Bearer <token>`-Header, wenn `requireAuth: true` (Standardeinstellung).

### Konten importieren

`POST /api/admin/users/import` erstellt Konten, die bereits in einem anderen System existieren, unter den IDs, die sie dort haben, sodass jede Zeile, die eines davon referenziert, weiterhin dasselbe Konto benennt. Dies erfordert `users:write`, genau wie `POST /api/admin/users`.

```json
{
  "users": [
    { "id": "5b0a3c9e-21f4-4d3b-8a6e-7c1d2e3f4a5b", "email": "ada@example.com", "displayName": "Ada",
      "createdAt": "2024-05-02T08:30:00Z", "emailVerified": true, "roles": ["editor"] }
  ],
  "dryRun": false
}
```

- **`id`** wird beibehalten und ist optional. Eine UUID ist der Regelfall; jede ID aus Buchstaben, Ziffern und `_ - . : |`, die mit einem Buchstaben oder einer Ziffer beginnt und bis zu 128 Zeichen lang ist, passt ebenfalls (Firebase-, Auth0-, Clerk-IDs). `service`, `anonymous`, `anon` und `default` werden abgelehnt, ebenso wie alles andere: `400 INVALID_ID` für dieses Konto. Eine Users-Tabelle, deren `id`-Spalte eine `uuid` ist, akzeptiert nur UUIDs.
- **`email`** ist erforderlich. `displayName`, `photoUrl`, `createdAt` (ISO 8601) und `roles` sind optional; `emailVerified` ist `false`, sofern nicht angegeben. Ein nicht verifiziertes Konto wird durch den ersten Magic-Link oder Reset bestätigt, dem gefolgt wird, und eine Anmeldung über einen Provider ist bis dahin nicht möglich.
- **Kein Passwort, keine E-Mail.** Ein Feld `password` oder `passwordHash` führt zu einem Fehler für dieses Konto, und es wird nichts versendet. Das Konto meldet sich per Magic-Link, E-Mail-Code, Provider oder Passwort-Reset an.
- **Nichts wird aktualisiert.** Ein Konto, dessen ID bereits vergeben ist, wird mit `ID_EXISTS` übersprungen (`skipped`), eines, dessen E-Mail vergeben ist, mit `EMAIL_EXISTS` (einschließlich eines früheren Kontos in derselben Anfrage). Das erneute Ausführen desselben Imports ist sicher.
- **Keine Rolle über der des Aufrufers**, wie bei `POST /api/admin/users`, und `beforeUserCreate` wird für jedes Konto ausgeführt und kann es ablehnen.
- **Höchstens 100 Konten pro Anfrage** (darüber `400 TOO_MANY_USERS`). `dryRun: true` führt alle Prüfungen durch und schreibt nichts.

Die Antwort ist `200` mit einem Ergebnis pro Konto in entsprechender Reihenfolge:

```json
{
  "dryRun": false, "created": 1, "skipped": 1, "failed": 1,
  "results": [
    { "index": 0, "status": "created", "uid": "5b0a3c9e-…", "email": "ada@example.com" },
    { "index": 1, "status": "skipped", "uid": "…", "email": "bob@example.com", "code": "EMAIL_EXISTS", "message": "…" },
    { "index": 2, "status": "failed", "email": "eve@example.com", "code": "INVALID_ID", "message": "…" }
  ]
}
```

`rebase users import <file>` sendet eine CSV- oder JSON-Datei auf diese Weise, jeweils 100 Konten auf einmal, und `client.admin.importUsers(users, { dryRun })` ist der Aufruf des SDKs.

### Passwort-Richtlinie

Ein neues Passwort benötigt mindestens 8 Zeichen, mit einem Großbuchstaben, einem Kleinbuchstaben und einer Ziffer. Registrierung, Reset und Änderung lehnen ein Passwort, das dies nicht erfüllt, mit `400 WEAK_PASSWORD` ab und listen jede verletzte Regel auf. Das Gleiche gilt für Administratoren beim Festlegen eines Passworts: `POST /api/admin/users`, eine Erstellung in der Users-Tabelle über die Daten-API (`POST /api/data/users`, deren `/bulk`, ein Socket- oder MCP-Schreibvorgang), `PUT /api/admin/users/:uid` und `POST /api/admin/users/:uid/reset-password`. Bei einem `/bulk` beginnt die Nachricht mit `Row <n>: ` (gezählt ab 0), wie auch die anderen Zeilenfehler des Bulk-Vorgangs.

Um Konten zu erstellen, deren Passwörter von einem anderen System festgelegt wurden (z. B. bei einem Import), senden Sie `skipPasswordPolicy: true` im Body der Erstellung (in jeder Zeile eines `/bulk`). Der Server berücksichtigt dies nur für Administratoren oder den Service-Key; bei allen anderen wird nichts erlassen, und die Ablehnung weist darauf hin. Es wird niemals gespeichert. Der Import des Admin-Panels sendet dies für jede Zeile, die ein `password` enthält. Bei der Anmeldung wird die Richtlinie nie überprüft, sodass ältere Passwörter weiterhin funktionieren. Um eigene Regeln festzulegen, übergeben Sie `auth.hooks.validatePasswordStrength` aus einem [ausgegliederten (ejected)](/docs/backend/authentication/#configuration) Backend. Für den ersten über `REBASE_ADMIN_PASSWORD` angelegten Admin gilt eine andere Regel: mindestens 12 Zeichen, sonst nichts.

### Antwortformat

Jeder Endpunkt, der eine Sitzung ausstellt, antwortet mit demselben Envelope — `register`, `login`, jeder OAuth-Anbieter, `magic-link/verify`, `otp/verify`, `anonymous`, `anonymous/link` und `mfa/challenge/verify`:

```json
{
  "user": {
    "uid": "8f1c2a6e-…",
    "email": "jane@example.com",
    "displayName": "Jane Doe",
    "photoURL": null,
    "providerId": "password",
    "isAnonymous": false,
    "emailVerified": true,
    "roles": ["editor"],
    "metadata": {}
  },
  "tokens": {
    "accessToken": "eyJhbGciOi…",
    "refreshToken": "9b2e…",
    "accessTokenExpiresAt": 1700000000000
  }
}
```

Senden Sie das Access-Token als `Authorization: Bearer <accessToken>` zurück. `accessTokenExpiresAt` sind Epoch-Millisekunden.

`POST /api/auth/refresh` antwortet mit demselben Envelope, mit der Ausnahme, dass `user` vollständig weggelassen wird, wenn das Konto nicht erneut gelesen werden kann; behandeln Sie es dort also als optional.

`providerId` gibt an, wie die Anmeldung für die Sitzung erfolgte: `password`, `anonymous`, `magic-link`, `otp`, `mfa` (eine mit einem zweiten Faktor abgeschlossene Anmeldung) oder die ID des Anbieters wie z. B. `google`. Es wird bei der Anmeldung mit der Sitzung gespeichert, sodass `refresh` und `GET /api/auth/me` dieselbe Antwort liefern, solange die Sitzung besteht. Eine vor Version 0.24 angemeldete Sitzung liest `password`.

:::caution[Das typisierte SDK flacht diesen Envelope ab — natives HTTP nicht]
Das obige JSON ist das Wire-Format, und genau das gibt `fetch("/api/auth/login")` zurück: Das Token befindet sich unter **`body.tokens.accessToken`**.

Das [typisierte SDK](/docs/sdk/authentication) entpackt `tokens`, bevor es die Sitzung zurückgibt, sodass `auth.signInWithEmail()` stattdessen zu einem abgeflachten **`{ user, accessToken, refreshToken }`** aufgelöst wird.

Beide Strukturen existieren; sie gehören zu zwei verschiedenen Schichten. Das Auslesen der SDK-Struktur aus einem nativen `fetch` liefert `undefined`, was sich als „Anmeldung erfolgreich, aber kein Access-Token vorhanden“ äußert — die Anmeldung war in Ordnung, das Token befand sich nur eine Ebene tiefer.
:::

### Ändern einer E-Mail-Adresse

Ein angemeldeter Benutzer überträgt sein eigenes Konto in zwei Schritten auf eine andere Adresse:

1. `POST /api/auth/change-email { newEmail }` erfasst die Änderung und sendet einen Link, `<frontend>/confirm-email-change?token=…`, an die neue Adresse sowie eine Benachrichtigung ohne Link an die aktuelle. Der Link ist 24 Stunden lang gültig, und eine neue Anfrage ersetzt die vorherige. `GET /api/auth/me` meldet die ausstehende Adresse als `pendingEmail`.
2. `POST /api/auth/confirm-email-change { token }` überträgt das Konto: Die neue Adresse wird verifiziert zur Adresse des Kontos. Jede OAuth-Identität, deren Anbieter für die alte Adresse gebürgt hat, wird getrennt (`removedProviders` nennt diese), da sich sonst jeder, der die alte Adresse kontrolliert, weiterhin darüber anmelden könnte; zudem verliert jeder an die alte Adresse gesendete Reset-Link seine Gültigkeit. Sitzungen bleiben erhalten.

Die neue Adresse wird während der Wartezeit des Links nicht reserviert: Eine Reservierung würde es jedem Konto ermöglichen, fremde Personen an der Registrierung mit ihrer eigenen Adresse zu hindern. Wenn ein anderes Konto die Adresse zu dem Zeitpunkt besitzt, zu dem der Link aufgerufen wird, antwortet der Link mit `409 EMAIL_EXISTS` und nichts wird übertragen; von zwei Konten, die dieselbe Adresse anfordern, erhält sie dasjenige, das seinem Link zuerst folgt. Der Hook `beforeEmailChange` kann eine Adresse ablehnen, genau wie `beforeUserCreate` bei der Registrierung.

Im CMS wird die Adresse unter **Kontoeinstellungen → Profil** geändert, und der Link öffnet die CMS-eigene Ansicht, unabhängig davon, ob man angemeldet ist oder nicht. Ein anderes Frontend stellt eine Seite unter `/confirm-email-change` bereit, die die Route mit dem Token des Links aufruft.

Wenn [`cookieAuth`](/docs/backend/authentication/#refresh-tokens-in-an-httponly-cookie) aktiviert ist (Standardeinstellung), wird das Refresh-Token als `httpOnly`-Cookie übertragen und `tokens.refreshToken` ist eine leere Zeichenkette im Body. Das Access-Token bleibt davon unberührt.

### Multi-Faktor-Authentifizierung (TOTP)

**Ein zweiter Faktor schützt die Anmeldung, nicht nur einzelne Vorgänge.** Sobald ein Konto über einen *verifizierten* TOTP-Faktor verfügt, stellt keine Route eine Sitzung aus, bis ein Code vorgelegt wird — Passwort-Login, jeder OAuth-Anbieter, Magic-Link, E-Mail-Code und Anonymous-Link verweigern allesamt mit `401 MFA_REQUIRED`:

```json
{
  "error": {
    "code": "MFA_REQUIRED",
    "message": "Multi-factor authentication is required to complete sign-in.",
    "details": {
      "mfaToken": "<short-lived pre-auth token>",
      "factors": [{ "id": "…", "factorType": "totp", "friendlyName": "Phone" }]
    }
  }
}
```

`mfaToken` ist **keine Sitzung**: Es ist zweckgebunden, läuft in fünf Minuten ab und wird von jeder authentifizierten Route abgelehnt. Senden Sie es als Bearer-Token an `POST /api/auth/mfa/challenge` (mit einer `factorId`) und anschließend an `POST /api/auth/mfa/challenge/verify` (mit der `challengeId` und dem sechsstelligen Code oder einem Wiederherstellungscode). Dieser letzte Aufruf erzeugt die Access- und Refresh-Tokens mit `aal2`; das Level wird in der Sitzung gespeichert und über `POST /api/auth/refresh` hinweg beibehalten.

Auch die Registrierung (Enrolment) ist abgesichert. Der erste Faktor für ein Konto kann aus einer gewöhnlichen Sitzung registriert werden, aber sobald einer verifiziert ist, erfordern `enroll`, `verify` und `unenroll` allesamt eine `aal2`-Sitzung — andernfalls könnte ein gestohlenes Passwort einen eigenen Faktor registrieren, die Rechte hochstufen und den echten Faktor löschen.

Die Verifizierung ist auf beiden Achsen begrenzt: Eine Challenge verfällt nach fünf Fehlversuchen, jedes Konto ist auf zehn Verifizierungsversuche pro 15 Minuten beschränkt (gezählt pro Benutzer, IP-Rotation hilft also nicht), und ein akzeptierter Code wird für den Faktor vermerkt, sodass er für den Rest seines Zeitfensters von ±1 Schritt nicht erneut verwendet werden kann.

In der CMS-Users-Tabelle werden **Zweistufige Verifizierung zurücksetzen** (`DELETE /api/admin/users/:uid/mfa`) und **Konto deaktivieren oder aktivieren** (`PUT /api/admin/users/:uid { disabled }`) jedem angeboten, der `users:write` besitzt, genau wie bei den Routen; der Schalter wird für das eigene Konto niemals angeboten, und bei einem Konto mit höherem Rang wird die Aktion mit der Begründung des Servers verweigert.

Setzen Sie `MFA_ENCRYPTION_KEY` (mindestens 32 Zufallszeichen), um gespeicherte TOTP-Secrets zu verschlüsseln. Ohne diesen greift der Server auf `JWT_SECRET` zurück und gibt eine Warnung aus. Setzen Sie ihn, **bevor** sich jemand registriert: Gespeicherte Secrets enthalten keine Key-ID, sodass eine nachträgliche Änderung des Schlüssels bestehende Faktoren unentschlüsselbar macht und deren Besitzer Challenges nicht mehr abschließen können.

### Teammitglieder per E-Mail einladen

Einladungs-Workflows müssen eine E-Mail-Adresse in eine Benutzer-ID auflösen, aber die `users`-Tabelle ist gegenüber dem Client durch RLS geschützt. Anstatt eine eigene Admin-Serverfunktion manuell zu schreiben, aktivieren Sie das integrierte Lookup:

```typescript no-verify
await initializeRebaseBackend({
    auth: {
        // ...
        allowUserLookup: true,   // enables POST /api/auth/find-user
    },
});
```

Anschließend vom Client aus:

```typescript
const profile = await client.auth.findUserByEmail("teammate@example.com");
// → { uid, displayName, photoURL } | null   (never email/roles/metadata)
if (profile) {
    await client.data.team_members.create({ team_id, user_id: profile.uid });
}
```

Der Endpunkt erfordert **zwingend eine Authentifizierung** und gibt nur `uid`, `displayName` und `photoURL` zurück — niemals die E-Mail-Adresse, Rollen oder Metadaten des gesuchten Benutzers. Er ist **standardmäßig deaktiviert**, da er es jedem angemeldeten Benutzer ermöglichen würde zu prüfen, für welche E-Mail-Adressen Konten existieren; aktivieren Sie ihn nur, wenn Ihre Einladungs-UX dies erfordert.

## Datenbankkontext für Row-Level Security (RLS)

Rebase leitet die Authentifizierung von Anfragen direkt an die PostgreSQL Row-Level Security (RLS) weiter. Jede Datenbankabfrage, die über einen benutzerbezogenen Treiber ausgeführt wird, läuft innerhalb einer Datenbanktransaktion (`db.transaction()`), die transaktionslokale Konfigurationsparameter setzt:

*   `app.uid` — Die eindeutige ID (`uid`) des authentifizierten Benutzers. Standardmäßig `'anonymous'` bei unauthentifizierten Anfragen. Das frühere `app.user_id` wird weiterhin parallel dazu geschrieben, für Policies, die vor der Umbenennung kompiliert wurden.
*   `app.user_roles` — Eine kommagetrennte Zeichenkette, die die zugewiesenen Rollen des Benutzers auflistet.
*   `app.is_anonymous` — `'true'` für eine Gastsitzung (anonyme Anmeldung), andernfalls `'false'`.
*   `app.jwt` — Eine JSON-Zeichenkette mit den benutzerdefinierten Claims des Tokens sowie `sub`, `roles` und `is_anonymous` (`{"sub": "<uid>", "roles": [...], "is_anonymous": false, …}`).

Diese Parameter werden für die Dauer der Transaktion lokal über Postgres' `set_config`-Funktion konfiguriert:
```sql
SELECT 
    set_config('app.uid', $1, true),
    set_config('app.user_id', $1, true),
    set_config('app.user_roles', $2, true),
    set_config('app.is_anonymous', $3, true),
    set_config('app.jwt', $4, true);
```

### PostgreSQL Policy-Hilfsfunktionen

Um das Schreiben von Row-Level-Security-Policies zu vereinfachen, erstellt Rebase beim Bootstrap der Datenbank Hilfsfunktionen unter dem `rebase`-Schema:

*   **`rebase.uid()`** — Gibt die ID des authentifizierten Benutzers als `text` zurück oder `NULL`, falls nicht gesetzt:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.uid() RETURNS text AS $$
        SELECT COALESCE(
            NULLIF(current_setting('app.uid', true), ''),
            NULLIF(current_setting('app.user_id', true), '')
        );
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.roles()`** — Gibt den kommagetrennten Rollen-String zurück:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.roles() RETURNS text AS $$
        SELECT COALESCE(NULLIF(current_setting('app.user_roles', true), ''), '');
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.jwt()`** — Gibt die vollständige JWT-Payload als `jsonb`-Objekt zurück:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.jwt() RETURNS jsonb AS $$
        SELECT COALESCE(NULLIF(current_setting('app.jwt', true), ''), '{}')::jsonb;
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.is_anonymous()`** — Gibt als `boolean` an, ob der Aufrufer ein Gast ist (`false`, wenn nicht gesetzt), sodass eine Policy `NOT rebase.is_anonymous()` verwenden kann.

Sie können diese Hilfsfunktionen direkt in Ihren benutzerdefinierten Sicherheitsregeln oder Datenbankmigrationen verwenden:
```sql
CREATE POLICY owner_access ON posts
    FOR ALL
    TO public
    USING (author_id = rebase.uid() OR string_to_array(rebase.roles(), ',') && ARRAY['admin']);
```

## Asymmetrische Token und JWKS

Standardmäßig werden Access-Tokens mit `jwtSecret` (HS256) signiert. Das funktioniert, bedeutet aber, dass alles, was ein Token *verifizieren* muss, auch den Schlüssel besitzen muss, der es *erstellt* — sodass ein Gateway oder ein Edge-Worker, der eine Sitzung prüft, diese auch fälschen könnte — und eine Änderung des Secrets meldet alle Benutzer auf einmal ab.

Konfigurieren Sie einen Signaturschlüssel und Rebase signiert Access-Tokens stattdessen asymmetrisch, wobei der öffentliche Teil unter **`/.well-known/jwks.json`** veröffentlicht wird, damit jeder dagegen verifizieren kann:

```typescript no-verify
auth: {
    jwtSecret: process.env.JWT_SECRET,
    signingKeys: [
        { kid: "2026-08", privateKey: process.env.JWT_PRIVATE_KEY! }
    ]
}
```

Oder über die Umgebungsvariablen für einen einzelnen Schlüssel:

```bash
JWT_PRIVATE_KEY="$(cat jwt-key.pem)"
JWT_KEY_ID=2026-08
```

Generieren Sie einen Schlüssel mit:

```bash
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out jwt-key.pem
```

RSA-Schlüssel funktionieren ebenfalls und signieren mit `RS256`; EC-P-256-Schlüssel signieren mit `ES256`. Es wird nur der private Schlüssel konfiguriert — die öffentliche Hälfte wird daraus abgeleitet, sodass das Paar niemals falsch zusammenpassen kann. `jwtSecret` bleibt in jedem Fall erforderlich: Es signiert weiterhin die zweckgebundenen Tokens (Download-Links, ausstehende MFA, Passwort-Reset), die ausschließlich von diesem Server gelesen werden.

### Schlüssel rotieren

Setzen Sie den neuen Schlüssel an die erste Stelle und belassen Sie den alten in der Liste. Neue Token werden mit dem neuen Schlüssel signiert; bereits im Umlauf befindliche Token werden bis zu ihrem Ablauf weiterhin gegen den alten geprüft, sodass niemand abgemeldet wird.

```typescript no-verify
signingKeys: [
    { kid: "2026-09", privateKey: process.env.JWT_PRIVATE_KEY_NEW! },
    { kid: "2026-08", privateKey: process.env.JWT_PRIVATE_KEY_OLD! }
]
```

Sobald die längste Access-Token-Lebensdauer verstrichen ist, entfernen Sie den alten Eintrag. Verwenden Sie `activeKid`, wenn Sie einen Schlüssel veröffentlichen möchten, bevor Sie damit signieren.

### An anderer Stelle verifizieren

Token enthalten die `kid` des Signaturschlüssels in ihrem Header; darüber wählt ein Verifier den richtigen Schlüssel aus dem JWKS aus und erkennt, wann nach einer Rotation ein erneuter Abruf erforderlich ist. Jede Standardbibliothek übernimmt dies für Sie — zum Beispiel mit `jose`:

```typescript no-verify
import { createRemoteJWKSet, jwtVerify } from "jose";

const jwks = createRemoteJWKSet(new URL("https://api.example.com/.well-known/jwks.json"));
const { payload } = await jwtVerify(token, jwks);
```

:::note
Wenn keine `signingKeys` konfiguriert sind, antwortet `/.well-known/jwks.json` mit `{"keys":[]}` und Token bleiben bei HS256. Nichts ändert sich, bis Sie einen Schlüssel hinzufügen.
:::

## Service-Key-Authentifizierung

Für die Server-zu-Server-Kommunikation (z. B. Cron-Jobs, externe Dienste) konfigurieren Sie einen statischen Service-Key:

```typescript
auth: {
    serviceKey: process.env.REBASE_SERVICE_KEY,
    // ...
}
```

Clients authentifizieren sich über den Header `Authorization: Bearer <service-key>`. 

### Interner Per-Boot-Schlüssel

Wird `REBASE_SERVICE_KEY` in Ihrer Konfiguration nicht angegeben, generiert Rebase automatisch einen zufälligen **internen Per-Boot-Schlüssel**. 

Dieser Schlüssel wird niemals protokolliert und verlässt den Prozess nicht. Er wird vom `rebase`-Singleton verwendet, um sich gegenüber den servereigenen Control-Plane-APIs (Auth, Storage usw.) zu authentifizieren. Dadurch wird sichergestellt, dass administrative Aufgaben (wie das Versenden einer Willkommens-E-Mail oder das Erstellen einer Storage-URL) in Entwicklung und Produktion stets ohne manuelle Schlüsselverwaltung funktionieren.

### Schutz vor Timing-Angriffen & Schlüsselanforderungen

Um Timing-Angriffe zu verhindern, validiert Rebase sowohl den benutzerdefinierten Service-Key als auch den internen Schlüssel mithilfe eines zeitkonstanten Zeichenkettenvergleichs (`safeCompare`). Der benutzerdefinierte Service-Key **muss mindestens 32 Zeichen lang sein**; wird ein Schlüssel mit weniger als 32 Zeichen konfiguriert, löst Rebase beim Start einen Konfigurationsfehler aus und bricht sicher ab (Fail-Closed).

## Nächste Schritte

- **[Authentifizierung](/docs/backend/authentication/)** — die Konfiguration, aus der diese Routen stammen
- **[Eigene Auth-Adapter](/docs/backend/auth-adapters/)** — Ersetzen des dahinterstehenden Anbieters
- **[Sicherheitsregeln (RLS)](/docs/collections/security-rules/)** — was eine Policy mit `rebase.uid()` macht
- **[Authentifizierung im typisierten SDK](/docs/sdk/authentication/)** — Aufrufen dieser Routen über das SDK
