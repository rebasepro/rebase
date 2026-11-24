---
sourceHash: 6d4a5f8b72b38f97
title: Auth-Endpunkte und Tokens
sidebar_label: Auth-Endpunkte
description: Die Authentifizierungs-Routen, die das Rebase-Backend bereitstellt, ihre Antwortformate, Multi-Faktor-Authentifizierung, der Datenbankkontext für Policies, JWKS und Service-Keys.
---

Die Routen, die [der `auth`-Block](/docs/backend/authentication/) bereitstellt, und die Tokens, die sie zurückgeben.

## Auth-Endpunkte

Alle Auth-Endpunkte werden unter `/api/auth/` bereitgestellt:

| Methode | Pfad | Beschreibung |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Neues Konto erstellen |
| `POST` | `/api/auth/login` | Anmeldung mit E-Mail/Passwort |
| `POST` | `/api/auth/refresh` | Access-Token aktualisieren |
| `POST` | `/api/auth/<provider>` | OAuth-Anmeldung (z. B. `/api/auth/google`, `/api/auth/linkedin`) |
| `POST` | `/api/auth/link/<provider>` | Verknüpft einen OAuth-Anbieter mit dem authentifizierten Konto. Bei einem Gast entspricht dies einer Registrierung: Es erfordert `allowRegistration`, übernimmt die Adresse des Anbieters, wenn dieser sie bestätigt, und antwortet mit einer Session für das Konto, zu dem der Gast wurde |
| `POST` | `/api/auth/logout` | Refresh-Token widerrufen |
| `POST` | `/api/auth/forgot-password` | E-Mail zum Zurücksetzen des Passworts senden |
| `POST` | `/api/auth/reset-password` | Passwort mit Token zurücksetzen |
| `POST` | `/api/auth/find-user` | Eine E-Mail in ein minimales öffentliches Profil auflösen (Opt-in — `AUTH_ALLOW_USER_LOOKUP`) |
| `POST` | `/api/auth/change-password` | Das eigene Passwort des Aufrufers ändern (authentifiziert). Beendet jede andere Session und antwortet mit einer neuen Session für den Aufrufer |
| `GET` | `/api/auth/me` | Das eigene Profil des Aufrufers |
| `PATCH` | `/api/auth/me` | Das eigene Profil des Aufrufers aktualisieren |
| `POST` | `/api/auth/change-email` | `{ newEmail }`: Das eigene Konto des Aufrufers auf eine andere Adresse umziehen. Sendet einen Link an die neue Adresse und eine Benachrichtigung an die alte; nichts ändert sich, bis dem Link gefolgt wird. Erfordert `aal2` bei einem Konto mit zweitem Faktor. `409 EMAIL_EXISTS` oder `UNDELIVERABLE_ADDRESS`, `400 EMAIL_UNCHANGED`, `403 ANONYMOUS_USER` für Gäste – siehe [Ändern einer E-Mail-Adresse](#ändern-einer-e-mail-adresse) |
| `POST` | `/api/auth/confirm-email-change` | `{ token }` aus dem Link. Keine Session erforderlich. Zieht das Konto verifiziert auf die neue Adresse um; `400 INVALID_TOKEN` für einen bereits genutzten, ersetzten oder abgelaufenen Link, `409 EMAIL_EXISTS`, wenn die Adresse in der Zwischenzeit vergeben wurde |
| `GET` | `/api/auth/config` | Was dieses Backend für einen Anmeldebildschirm bereitstellt – `needsSetup`, `registrationEnabled`, `passwordReset`, `emailVerification`, `magicLink`, `anonymousLogin`, `adminPasswordReset`, `enabledProviders` und `storage`, das angibt, ob das Backend Dateispeicher bereitstellt. Unauthentifiziert und aus denselben Prädikaten berechnet, die die Routen erzwingen, sodass das, was der Bildschirm anzeigt, nicht von dem abweichen kann, was er unterstützt |
| `POST` | `/api/auth/send-verification` | Sendet dem Aufrufer einen Link zur E-Mail-Verifizierung |
| `GET` | `/api/auth/verify-email` | Einen Verifizierungslink einlösen (die URL in dieser E-Mail). Behält bei, was eine aktive Session des Kontos nachweist, und entfernt, was niemand nachgewiesen hat – siehe [E-Mail-Verifizierung](/docs/backend/email-verification/) |
| `POST` | `/api/auth/verify-email` | Dasselbe mit `{ token, password?, removeUnproven? }`: Das Passwort behält es bei und meldet an; ohne jeglichen Nachweis antwortet ein Konto, das einen besitzt, mit `409 PROOF_REQUIRED` |
| `POST` | `/api/auth/magic-link` | Einen Einmal-Anmeldelink per E-Mail senden. `503 EMAIL_NOT_CONFIGURED` ohne SMTP |
| `POST` | `/api/auth/magic-link/verify` | Einen Magic-Link-Token gegen eine Session eintauschen |
| `POST` | `/api/auth/otp` | Einen sechsstelligen Anmeldecode per E-Mail senden. Gibt dieselbe Antwort zurück, unabhängig davon, ob für die Adresse ein Konto existiert |
| `POST` | `/api/auth/otp/verify` | `{ email, code }` gegen eine Session eintauschen |
| `POST` | `/api/auth/anonymous` | Eine anonyme Session erstellen (Opt-in — `ALLOW_ANONYMOUS`) |
| `POST` | `/api/auth/anonymous/link` | Echte Zugangsdaten an das bereits angemeldete anonyme Konto anhängen. Erfordert sowohl `allowAnonymous` als auch eine offene Registrierung: `403 ANONYMOUS_AUTH_DISABLED`, sobald die anonyme Anmeldung deaktiviert ist (inklusive zuvor angemeldeter Gäste), und `403 REGISTRATION_DISABLED`, solange die Registrierung geschlossen ist |
| `GET` | `/api/auth/sessions` | Aktive Sessions des Aufrufers auflisten, eine pro Anmeldung. Die eigene Session des Aufrufers ist als `isCurrentSession` markiert |
| `DELETE` | `/api/auth/sessions` | Alle Sessions widerrufen, einschließlich dieser – Remote-Logout auf jedem Gerät |
| `DELETE` | `/api/auth/sessions/:id` | Eine Session widerrufen: ihren Refresh-Token und den Access-Token, den dieses Gerät hält |
| `GET` | `/api/auth/scopes` | Jeder [Scope](/docs/backend/roles-and-scopes/), den dieses Backend kennt, sowie diejenigen, die der Aufrufer besitzt |
| `GET` | `/api/auth/keys` | Die eigenen [persönlichen API-Schlüssel](/docs/backend/api-keys/#personal-keys) des Aufrufers |
| `POST` | `/api/auth/keys` | Einen persönlichen Schlüssel erstellen. `403 PERSONAL_KEYS_DISABLED`, es sei denn, die users-Tabelle setzt `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | Einen der eigenen Schlüssel des Aufrufers widerrufen |
| `GET` | `/.well-known/jwks.json` | Das öffentliche JWKS – im Root gemountet, nicht unter `basePath`, da ein Verifier dort sucht. Wird immer gemountet, wenn das Backend eigene Tokens ausstellt; ein leeres Key-Set, bis [asymmetrisches Signieren](#asymmetrische-tokens-und-jwks) konfiguriert ist |
| `POST` | `/api/auth/mfa/enroll` | TOTP-Registrierung starten (gibt das Secret und Wiederherstellungscodes zurück) |
| `POST` | `/api/auth/mfa/verify` | Eine Registrierung mit einem Code aus der Authenticator-App bestätigen |
| `GET` | `/api/auth/mfa/factors` | Die registrierten Faktoren des Aufrufers auflisten |
| `POST` | `/api/auth/mfa/challenge` | Eine Challenge für einen verifizierten Faktor öffnen |
| `POST` | `/api/auth/mfa/challenge/verify` | Eine Challenge beantworten – dies stellt die Session aus |
| `DELETE` | `/api/auth/mfa/unenroll` | Einen Faktor entfernen (erfordert eine `aal2`-Session, sobald das Konto einen verifizierten Faktor hat) |
| `POST` | `/api/auth/mfa/recovery-codes` | Die Wiederherstellungscodes des Aufrufers durch zehn neue ersetzen (erfordert eine `aal2`-Session) |

Die administrative Benutzer- und Rollenverwaltung ist eine **separate Schnittstelle**, die unter
`/api/admin/` statt unter `/api/auth/` bereitgestellt wird. Für das Lesen ist der Scope `users:read` erforderlich und
für Änderungen `users:write`, mit Ausnahme des unten beschriebenen eingeschränkten Lesezugriffs der Benutzerauswahl (User Picker). Ein Admin und der Service-Key besitzen beide; ebenso eine
Rolle, die sie deklariert. Niemand darf ein Konto ändern, das über mehr Berechtigungen verfügt als man
selbst. Siehe [Rollen und Scopes](/docs/backend/roles-and-scopes/).

| Methode | Pfad | Beschreibung |
|--------|------|-------------|
| `GET` | `/api/admin/users` | Benutzer auflisten (paginiert). `?search=` gleicht einen Teil der E-Mail oder des Anzeigenamens ohne Berücksichtigung der Groß-/Kleinschreibung ab. Es gleicht auch jede Rolle ab, die der Benutzer innehat, sowie die uid |
| `GET` | `/api/admin/users/pick` | Der Lesezugriff der Benutzerauswahl: `uid`, `displayName`, `email` und `photoURL` pro Benutzer, sonst nichts. Akzeptiert `?search=`, `?limit=` (standardmäßig 25) und `?offset=`, oder `?ids=a,b` für Benutzer, die ein gespeicherter Wert benennt. Antwortet bei `users:read` und auch für jeden, der in eine Collection mit einem [`userSelect`](/docs/collections/properties/)-Feld schreiben darf – damit ein Editor dieses ausfüllen kann. Eine als rohes SQL geschriebene Regel (`using` / `withCheck`, die das Policy-Modell nicht lesen kann) kann nicht im Voraus beurteilt werden und gilt hier als Verweigerung: In einer solchen Collection können nur Inhaber von `users:read` auswählen. Jeder andere erhält `403 SCOPE_MISSING` |
| `POST` | `/api/admin/users` | Einen Benutzer erstellen. `invite: false` ohne `password` erstellt ihn ohne Passwort und sendet nichts |
| `POST` | `/api/admin/users/import` | Konten aus einem anderen System importieren und deren IDs beibehalten. Siehe [Konten importieren](#konten-importieren) |
| `GET` | `/api/admin/users/:uid` | Einen Benutzer lesen |
| `PUT` | `/api/admin/users/:uid` | Einen Benutzer aktualisieren. `{ disabled: true }` deaktiviert das Konto, ohne es zu löschen: Jede Anmeldung und Aktualisierung wird verweigert (`ACCOUNT_DISABLED`), die Sessions enden und jedes gehaltene Token wird abgelehnt; `false` aktiviert es wieder |
| `DELETE` | `/api/admin/users/:uid` | Einen Benutzer löschen. Dessen Sessions enden und jedes gehaltene Access-Token wird ab dieser Anfrage verweigert |
| `POST` | `/api/admin/users/:uid/reset-password` | Das Passwort eines Benutzers ohne dessen aktuelles Passwort zurücksetzen. `rebase auth reset-password` ruft dies auf und schreibt nur dann direkt in die Datenbank, wenn das Backend nicht erreichbar ist; in beiden Fällen enden die Sessions des Kontos |
| `DELETE` | `/api/admin/users/:uid/mfa` | Zweite Faktoren und Wiederherstellungscodes eines Benutzers entfernen und dessen Sessions beenden – für jemanden, der beides verloren hat |
| `GET` | `/api/admin/roles` | `admin` und die von der users-Tabelle deklarierten Rollen mit ihren Scopes |
| `POST` | `/api/admin/bootstrap` | Dem am frühesten registrierten Benutzer erlauben, die Admin-Rolle zu beanspruchen, solange keine existiert. In der Produktion verweigert – siehe [First User Bootstrap](/docs/backend/authentication/#first-user-bootstrap) |

Alle Daten-API-Endpunkte erfordern einen gültigen `Authorization: Bearer <token>`-Header, wenn `requireAuth: true` gesetzt ist (Standard).

### Konten importieren
`POST /api/admin/users/import` erstellt Konten, die bereits in einem anderen
System existieren, unter den IDs, die sie dort haben, sodass jede Zeile, die eine davon
referenziert, weiterhin dasselbe Konto benennt. Es erfordert `users:write`, genau wie `POST /api/admin/users`.

```json
{
  "users": [
    { "id": "5b0a3c9e-21f4-4d3b-8a6e-7c1d2e3f4a5b", "email": "ada@example.com", "displayName": "Ada",
      "createdAt": "2024-05-02T08:30:00Z", "emailVerified": true, "roles": ["editor"] }
  ],
  "dryRun": false
}
```

Mit Passwort-Hashes:

```json
{
  "passwordHashAlgorithm": "bcrypt",
  "users": [
    { "id": "5b0a3c9e-21f4-4d3b-8a6e-7c1d2e3f4a5b", "email": "ada@example.com", "emailVerified": true,
      "passwordHash": "$2a$10$…" }
  ]
}
```

- **`id`** wird beibehalten und ist optional. Eine UUID ist der Regelfall; jede ID aus
  Buchstaben, Ziffern und `_ - . : |`, die mit einem Buchstaben oder einer Ziffer beginnt und bis zu 128
  Zeichen lang ist, ist ebenfalls zulässig (Firebase-, Auth0-, Clerk-IDs). `service`, `anonymous`,
  `anon` und `default` werden abgelehnt, ebenso wie alles andere: `400 INVALID_ID` für
  dieses Konto. Eine users-Tabelle, deren `id`-Spalte eine `uuid` ist, akzeptiert nur UUIDs.
- **`email`** ist erforderlich. `displayName`, `photoUrl`, `createdAt` (ISO 8601) und
  `roles` sind optional; `emailVerified` ist `false`, sofern nicht angegeben. Ein nicht verifiziertes
  Konto wird durch den ersten Magic Link oder Passwort-Reset bestätigt, dem gefolgt wird, und eine
  Anmeldung über einen Provider ist bis dahin nicht möglich.
- **Keine E-Mail und kein Passwort, es sei denn, Sie übergeben den Hash.** Es wird nichts per E-Mail versendet.
  Ein `password`-Feld führt bei diesem Konto zu einem Fehler. Ein Konto ohne `passwordHash`
  meldet sich per Magic Link, E-Mail-Code, Provider oder Passwort-Reset an.
- **`passwordHash`** ist der Hash, den das andere System gespeichert hat, und wird nur übernommen, wenn die
  Anfrage dessen Format in `passwordHashAlgorithm` angibt. Derzeit ist dies
  `"bcrypt"` (`$2a$`, `$2b$` oder `$2y$`): das, was Supabase in
  `auth.users.encrypted_password` speichert und was Auth0, Clerk sowie die meisten Rails-,
  Laravel- und Django-bcrypt-Anwendungen verwenden. Das Konto meldet sich dann mit seinem bisherigen
  Passwort an, und bei der ersten Anmeldung wird der Hash durch das Rebase-eigene
  scrypt ersetzt, ohne andere Sessions zu beenden. Ein Hash ohne `passwordHashAlgorithm`
  oder einer, der nicht diesem Format entspricht, schlägt für dieses Konto fehl (`INVALID_INPUT`,
  `INVALID_PASSWORD_HASH`); der Hash wird niemals zurückgegeben. Ein Projekt mit
  eigenen `hashPassword`- oder `verifyPassword`-Hooks behält den Hash wie importiert bei, und
  dessen `verifyPassword` entscheidet, was akzeptiert wird.
- **Es wird nichts aktualisiert.** Ein Konto, dessen ID bereits vergeben ist, wird mit
  `ID_EXISTS` übersprungen (`skipped`), eines mit bereits vergebener E-Mail mit `EMAIL_EXISTS` (einschließlich eines
  früheren Kontos in derselben Anfrage). Das erneute Ausführen desselben Imports ist sicher.
- **Keine Rolle über der eigenen des Aufrufers**, wie bei `POST /api/admin/users`, und
  `beforeUserCreate` wird für jedes Konto ausgeführt und kann dieses ablehnen.
- **Maximal 100 Konten pro Anfrage** (darüber `400 TOO_MANY_USERS`).
  `dryRun: true` führt alle Prüfungen durch und schreibt nichts.

Die Antwort ist `200` mit einem Ergebnis pro Konto in der entsprechenden Reihenfolge:

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

`rebase users import <file>` sendet eine CSV- oder JSON-Datei auf diese Weise, 100 Konten
auf einmal, und `client.admin.importUsers(users, { dryRun })` ist der Aufruf im SDK.

### Passwort-Richtlinie

Ein neues Passwort erfordert mindestens 8 Zeichen mit einem Großbuchstaben, einem
Kleinbuchstaben und einer Ziffer. Registrierung, Zurücksetzen und Ändern lehnen Passwörter, die dies nicht
erfüllen, mit `400 WEAK_PASSWORD` ab und listen jede verletzte Regel auf. Dasselbe gilt, wenn ein
Administrator ein Passwort festlegt: `POST /api/admin/users`, eine Erstellung in der
users-Tabelle über die Daten-API (`POST /api/data/users`, deren `/bulk`, ein
Socket- oder MCP-Schreibvorgang), `PUT /api/admin/users/:uid` und
`POST /api/admin/users/:uid/reset-password`. Bei einem `/bulk` beginnt die Nachricht mit
`Row <n>: ` (gezählt ab 0), wie die anderen Zeilenfehler des Bulk-Vorgangs.

Um Konten zu erstellen, deren Passwörter von einem anderen System festgelegt wurden (z. B. bei einem Import), senden
Sie `skipPasswordPolicy: true` im Body der Erstellung (in jeder Zeile eines `/bulk`). Der
Server berücksichtigt dies nur für Administratoren oder den Service-Key; von allen anderen wird
nichts erlassen und die Ablehnung weist darauf hin. Es wird niemals gespeichert. Der Import des
Admin-Panels sendet dies für jede Zeile, die ein `password` enthält. Die Anmeldung
prüft die Richtlinie nie, sodass ein älteres Passwort weiterhin funktioniert. Um eigene Regeln festzulegen, übergeben
Sie `auth.hooks.validatePasswordStrength` aus einem [ejected](/docs/backend/authentication/#configuration)
Backend. Für den ersten Administrator, der über `REBASE_ADMIN_PASSWORD` angelegt wird, gilt eine
andere Regel: mindestens 12 Zeichen, sonst nichts.

### Antwortformat

Jeder Endpunkt, der eine Session ausstellt, antwortet mit demselben Envelope – `register`,
`login`, jeder OAuth-Anbieter, `magic-link/verify`, `otp/verify`, `anonymous`,
`anonymous/link` und `mfa/challenge/verify`:

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

Senden Sie das Access-Token als `Authorization: Bearer <accessToken>` zurück.
`accessTokenExpiresAt` sind Millisekunden seit Beginn der Unix-Epoche.

`POST /api/auth/refresh` antwortet mit demselben Envelope, außer dass `user`
vollständig weggelassen wird, wenn das Konto nicht erneut gelesen werden kann; behandeln Sie es
dort daher als optional.

`providerId` gibt an, wie die Session angemeldet wurde: `password`, `anonymous`,
`magic-link`, `otp`, `mfa` (eine mit einem zweiten Faktor abgeschlossene Anmeldung) oder die
ID des Anbieters wie z. B. `google`. Sie wird beim Anmelden mit der Session gespeichert, sodass
`refresh` und `GET /api/auth/me` dieselbe Antwort liefern, solange die
Session besteht. Eine Session, die vor 0.24 angemeldet wurde, liefert `password`.

:::caution[Das typisierte SDK flacht diesen Envelope ab – natives HTTP nicht]
Das obige JSON ist das Übertragungsformat (Wire Format) und entspricht dem, was `fetch("/api/auth/login")`
zurückgibt: Das Token befindet sich unter **`body.tokens.accessToken`**.

Das [typisierte SDK](/docs/sdk/authentication) packt `tokens` aus, bevor es die
Session zurückgibt, sodass `auth.signInWithEmail()` stattdessen zu einem verflachten
**`{ user, accessToken, refreshToken }`** auflöst.

Beide Strukturen existieren; sie gehören zu zwei verschiedenen Schichten. Das Auslesen der Struktur des SDKs
aus einem nativen `fetch` liefert `undefined`, was sich als „Anmeldung erfolgreich, aber kein Access-Token vorhanden“
äußert – die Anmeldung war in Ordnung, das Token befand sich eine Ebene tiefer.
:::

### Ändern einer E-Mail-Adresse
Ein angemeldeter Benutzer
überträgt das eigene Konto in zwei Schritten auf eine andere Adresse:

1. `POST /api/auth/change-email { newEmail }` erfasst die Änderung und sendet einen
   Link, `<frontend>/confirm-email-change?token=…`, an die neue Adresse sowie eine
   Benachrichtigung ohne Link an die bisherige. Der Link ist 24 Stunden gültig, und eine
   neue Anfrage ersetzt die vorherige. `GET /api/auth/me` meldet die ausstehende
   Adresse als `pendingEmail`.
2. `POST /api/auth/confirm-email-change { token }` zieht das Konto um: Die neue
   Adresse wird verifiziert zur primären Adresse. Jede OAuth-Identität, deren Anbieter
   für die alte Adresse gebürgt hat, wird getrennt (`removedProviders` listet diese auf),
   da jeder, der die alte Adresse kontrolliert, sich sonst weiterhin darüber anmelden könnte;
   zudem verliert jeder an die alte Adresse gesendete Reset-Link seine Gültigkeit.
   Sessions bleiben erhalten.

Die neue Adresse wird während der Wartezeit des Links nicht reserviert: Eine Reservierung würde es jedem
Konto ermöglichen, Fremde daran zu hindern, sich mit ihrer eigenen Adresse zu registrieren. Wenn ein anderes
Konto die Adresse übernommen hat, bis dem Link gefolgt wird, antwortet der Link mit
`409 EMAIL_EXISTS` und es wird nichts geändert; von zwei Konten, die dieselbe Adresse anfordern,
erhält dasjenige den Zuschlag, das seinem Link zuerst folgt. Der `beforeEmailChange`-Hook kann
eine Adresse ablehnen, ähnlich wie `beforeUserCreate` bei der Registrierung.

Im CMS wird die Adresse unter **Kontoeinstellungen → Profil** geändert, und der
Link öffnet die CMS-eigene Ansicht, unabhängig davon, ob man angemeldet ist oder nicht. Ein anderes Frontend stellt eine Seite
unter `/confirm-email-change` bereit, die die Route mit dem Token des Links aufruft.

Wenn [`cookieAuth`](/docs/backend/authentication/#refresh-tokens-in-an-httponly-cookie) aktiviert ist (Standard), wird das Refresh-Token
als `httpOnly`-Cookie übertragen und `tokens.refreshToken` ist ein leerer
String im Body. Das Access-Token bleibt davon unberührt.

### Multi-Faktor-Authentifizierung (TOTP)

**Ein zweiter Faktor sichert die gesamte Anmeldung ab, nicht nur einzelne Operationen.** Sobald ein
Konto über einen *verifizierten* TOTP-Faktor verfügt, stellt keine Route eine Session aus, bevor ein
Code vorgelegt wird – Passwort-Login, jeder OAuth-Provider, Magic Link, E-Mail-Code
und Anonymous-Link verweigern den Zugriff mit `401 MFA_REQUIRED`:

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

`mfaToken` ist **keine Session**: Es ist zweckgebunden (purpose-scoped), läuft nach fünf Minuten ab
und wird von jeder authentifizierten Route abgelehnt. Senden Sie es als Bearer-Token an
`POST /api/auth/mfa/challenge` (mit einer `factorId`) und anschließend an
`POST /api/auth/mfa/challenge/verify` (mit der `challengeId` und dem sechsstelligen
Code oder einem Wiederherstellungscode). Dieser letzte Aufruf erzeugt die Access- und Refresh-Tokens
auf Stufe `aal2`; diese Stufe wird in der Session gespeichert und über
`POST /api/auth/refresh` hinweg beibehalten.

Auch die Registrierung (Enrolment) ist abgesichert. Der erste Faktor eines Kontos kann aus einer
regulären Session heraus registriert werden, aber sobald einer verifiziert ist, erfordern `enroll`,
`verify` und `unenroll` allesamt eine `aal2`-Session – andernfalls könnte ein gestohlenes Passwort einen
eigenen Faktor registrieren, die Rechte damit hochstufen und den echten Faktor löschen.

Die Verifizierung ist in zweierlei Hinsicht begrenzt: Eine Challenge verfällt nach fünf Fehlversuchen,
jedes Konto ist auf zehn Verifizierungsversuche pro 15 Minuten beschränkt (pro Benutzer gezählt, rotierende IPs
helfen also nicht) und ein akzeptierter Code wird für den Faktor vermerkt, sodass er für den Rest seines
±1-Schritt-Fensters nicht erneut abgespielt werden kann (Replay-Schutz).

In der CMS-Benutzertabelle werden **Zweistufige Verifizierung zurücksetzen**
(`DELETE /api/admin/users/:uid/mfa`) und **Konto deaktivieren oder aktivieren**
(`PUT /api/admin/users/:uid { disabled }`) jedem angeboten, der über
`users:write` verfügt (analog zu den Routen); die Option wird niemals für das eigene
Konto angeboten, und bei einem Konto mit höherem Rang wird die Aktion mit der Begründung des Servers verweigert.

Setzen Sie `MFA_ENCRYPTION_KEY` (mindestens 32 Zufallszeichen), um gespeicherte TOTP-Secrets
zu verschlüsseln. Ohne diesen greift der Server auf `JWT_SECRET` zurück und gibt eine Warnung aus. Setzen Sie ihn,
**bevor** sich jemand registriert: Gespeicherte Secrets besitzen keine Key-ID; eine spätere Änderung des Schlüssels
führt daher dazu, dass bestehende Faktoren nicht mehr entschlüsselt werden können und deren Besitzer keine
Challenge mehr abschließen können.

### Teammitglieder per E-Mail einladen

Einladungs-Flows müssen eine E-Mail-Adresse in eine Benutzer-ID auflösen, aber die
Tabelle `users` ist clientseitig durch RLS geschützt. Anstatt eine eigene Admin-Serverfunktion
zu schreiben, aktivieren Sie das integrierte Lookup:

```typescript no-verify
await initializeRebaseBackend({
    auth: {
        // ...
        allowUserLookup: true,   // enables POST /api/auth/find-user
    },
});
```

Anschließend über den Client:

```typescript
const profile = await client.auth.findUserByEmail("teammate@example.com");
// → { uid, displayName, photoURL } | null   (never email/roles/metadata)
if (profile) {
    await client.data.team_members.create({ team_id, user_id: profile.uid });
}
```

Der Endpunkt erfordert eine **Authentifizierung** und gibt lediglich `uid`, `displayName`
und `photoURL` zurück – niemals die E-Mail, Rollen oder Metadaten des gesuchten Benutzers. Er
ist **standardmäßig deaktiviert**, da er es jedem angemeldeten Benutzer ermöglichen würde zu prüfen, welche E-Mail-Adressen ein
Konto besitzen; aktivieren Sie ihn nur, wenn Ihr Einladungs-Workflow dies erfordert.

## Datenbankkontext für Row-Level Security (RLS)

Rebase leitet die Authentifizierung von Anfragen direkt an die PostgreSQL Row-Level Security (RLS) weiter. Jede Datenbankabfrage, die über einen benutzerspezifischen Treiber ausgeführt wird, läuft innerhalb einer Datenbanktransaktion (`db.transaction()`), die transaktionslokale Konfigurationsparameter setzt:

*   `app.uid` – Die eindeutige ID des authentifizierten Benutzers (`uid`). Standardmäßig `'anonymous'` für nicht authentifizierte Anfragen. Das frühere `app.user_id` wird weiterhin parallel mitgeschrieben, für Policies, die vor der Umbenennung kompiliert wurden.
*   `app.user_roles` – Ein kommagetrennter String mit den zugewiesenen Rollen des Benutzers.
*   `app.is_anonymous` – `'true'` für eine Gast-Session (anonyme Anmeldung), andernfalls `'false'`.
*   `app.jwt` – Ein JSON-String mit den benutzerdefinierten Claims des Tokens sowie `sub`, `roles` und `is_anonymous` (`{"sub": "<uid>", "roles": [...], "is_anonymous": false, …}`).

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

Um das Schreiben von Row-Level-Security-Policies zu vereinfachen, erstellt Rebase beim Bootstrapping der Datenbank Hilfsfunktionen im Schema `rebase`:

*   **`rebase.uid()`** – Gibt die ID des authentifizierten Benutzers als `text` zurück oder `NULL`, falls nicht gesetzt:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.uid() RETURNS text AS $$
        SELECT COALESCE(
            NULLIF(current_setting('app.uid', true), ''),
            NULLIF(current_setting('app.user_id', true), '')
        );
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.roles()`** – Gibt den kommagetrennten Rollen-String zurück:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.roles() RETURNS text AS $$
        SELECT COALESCE(NULLIF(current_setting('app.user_roles', true), ''), '');
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.jwt()`** – Gibt die vollständige JWT-Payload als `jsonb`-Objekt zurück:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.jwt() RETURNS jsonb AS $$
        SELECT COALESCE(NULLIF(current_setting('app.jwt', true), ''), '{}')::jsonb;
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.is_anonymous()`** – Gibt als `boolean` an, ob der Aufrufer ein Gast ist (`false`, wenn nicht gesetzt), sodass eine Policy `NOT rebase.is_anonymous()` verwenden kann.

Sie können diese Hilfsfunktionen direkt in Ihren benutzerdefinierten Sicherheitsregeln oder Datenbankmigrationen verwenden:
```sql
CREATE POLICY owner_access ON posts
    FOR ALL
    TO public
    USING (author_id = rebase.uid() OR string_to_array(rebase.roles(), ',') && ARRAY['admin']);
```

## Asymmetrische Tokens und JWKS
Standardmäßig werden Access-Tokens mit `jwtSecret` (HS256) signiert. Das funktioniert zwar, bedeutet aber,
dass jede Komponente, die ein Token *verifizieren* muss, auch den Schlüssel besitzen muss, der Tokens *ausstellt* – ein
Gateway oder ein Edge-Worker, der eine Session prüft, könnte somit auch Tokens fälschen – und
eine Änderung des Secrets meldet alle Benutzer gleichzeitig ab.

Wenn Sie einen Signierschlüssel konfigurieren, signiert Rebase Access-Tokens stattdessen asymmetrisch
und veröffentlicht den öffentlichen Teil unter **`/.well-known/jwks.json`**, sodass jeder dagegen verifizieren
kann:

```typescript no-verify
auth: {
    jwtSecret: process.env.JWT_SECRET,
    signingKeys: [
        { kid: "2026-08", privateKey: process.env.JWT_PRIVATE_KEY! }
    ]
}
```

Oder über Umgebungsvariablen für einen einzelnen Schlüssel:

```bash
JWT_PRIVATE_KEY="$(cat jwt-key.pem)"
JWT_KEY_ID=2026-08
```

Generieren Sie einen Schlüssel mit:

```bash
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out jwt-key.pem
```

RSA-Schlüssel funktionieren ebenfalls und signieren mit `RS256`; EC-P-256-Schlüssel signieren mit `ES256`. Es wird
nur der private Schlüssel konfiguriert – der öffentliche Teil wird daraus abgeleitet, sodass das Schlüsselpaar nie
inkonsistent sein kann. `jwtSecret` bleibt in jedem Fall erforderlich: Es signiert weiterhin die
zweckgebundenen Tokens (Download-Links, ausstehende MFA, Passwort-Reset), die ausschließlich
von diesem Server gelesen werden.

### Rotieren eines Schlüssels

Setzen Sie den neuen Schlüssel an die erste Stelle und belassen Sie den alten in der Liste. Neue Tokens werden mit dem
neuen Schlüssel signiert; bereits im Umlauf befindliche Tokens werden weiterhin gegen den alten Schlüssel verifiziert, bis
sie ablaufen, sodass niemand abgemeldet wird.

```typescript no-verify
signingKeys: [
    { kid: "2026-09", privateKey: process.env.JWT_PRIVATE_KEY_NEW! },
    { kid: "2026-08", privateKey: process.env.JWT_PRIVATE_KEY_OLD! }
]
```

Sobald die längste Lebensdauer eines Access-Tokens abgelaufen ist, entfernen Sie den alten Eintrag. Verwenden Sie
`activeKid`, wenn Sie einen Schlüssel veröffentlichen möchten, bevor Sie mit ihm signieren.

### Verifizierung an anderer Stelle

Tokens enthalten die `kid` des Signierschlüssels in ihrem Header. Dadurch wählt ein Verifier den
passenden Schlüssel aus dem JWKS aus und erkennt, wann nach einer Rotation ein erneutes Abrufen
erforderlich ist. Jede gängige Bibliothek übernimmt dies für Sie – zum Beispiel mit `jose`:

```typescript no-verify
import { createRemoteJWKSet, jwtVerify } from "jose";

const jwks = createRemoteJWKSet(new URL("https://api.example.com/.well-known/jwks.json"));
const { payload } = await jwtVerify(token, jwks);
```

:::note
Wenn keine `signingKeys` konfiguriert sind, antwortet `/.well-known/jwks.json` mit
`{"keys":[]}` und Tokens bleiben HS256. Es ändert sich nichts, bis Sie einen Schlüssel hinzufügen.
:::

## Authentifizierung über Service-Keys

Für die Server-zu-Server-Kommunikation (z. B. Cronjobs, externe Dienste) konfigurieren Sie einen statischen Service-Key:

```typescript
auth: {
    serviceKey: process.env.REBASE_SERVICE_KEY,
    // ...
}
```

Clients authentifizieren sich mit dem Header `Authorization: Bearer <service-key>`. 

### Interner Schlüssel pro Serverstart (Per-Boot Key)

Wenn `REBASE_SERVICE_KEY` nicht in Ihrer Konfiguration angegeben ist, generiert Rebase automatisch einen zufälligen **internen Per-Boot-Schlüssel**. 

Dieser Schlüssel wird niemals protokolliert und verlässt den Prozess nicht. Er wird vom `rebase`-Singleton verwendet, um sich gegenüber den servereigenen Control-Plane-APIs (Auth, Storage usw.) zu authentifizieren. Dadurch wird sichergestellt, dass administrative Aufgaben (wie das Versenden einer Willkommens-E-Mail oder das Generieren einer Storage-URL) sowohl in der Entwicklung als auch in der Produktion sofort funktionieren, ohne dass eine manuelle Schlüsselverwaltung erforderlich ist.

### Schutz vor Timing-Angriffen & Schlüsselanforderungen

Um Timing-Angriffe zu verhindern, validiert Rebase sowohl den vom Benutzer konfigurierten Service-Key als auch den internen Schlüssel mittels String-Vergleich in konstanter Laufzeit (`safeCompare`). Der benutzerdefinierte Service-Key **muss mindestens 32 Zeichen lang sein**; wird ein Schlüssel mit weniger als 32 Zeichen konfiguriert, löst Rebase beim Start einen Konfigurationsfehler aus und bricht sicher ab (Fail-Closed).

## Nächste Schritte

- **[Authentifizierung](/docs/backend/authentication/)** – die Konfiguration, auf der diese Routen basieren
- **[Eigene Auth-Adapter](/docs/backend/auth-adapters/)** – den dahinterliegenden Provider austauschen
- **[Sicherheitsregeln (RLS)](/docs/collections/security-rules/)** – was eine Policy mit `rebase.uid()` macht
- **[Typisierte SDK-Authentifizierung](/docs/sdk/authentication/)** – diese Routen über das SDK aufrufen
