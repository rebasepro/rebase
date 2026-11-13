---
sourceHash: 51c0059da14c6fd7
title: Auth-Endpunkte und Token
sidebar_label: Auth-Endpunkte
description: Die Authentifizierungs-Routen, die das Rebase-Backend bereitstellt, ihre Antwortformate, Multi-Faktor-Authentifizierung, der Datenbankkontext für Policies, JWKS und Service-Keys.
---

Die Routen, die [der `auth`-Block](/docs/backend/authentication/) bereitstellt, und die Token, die sie zurückgeben.

## Auth-Endpunkte

Alle Auth-Endpunkte sind unter `/api/auth/` gemountet:

| Methode | Pfad | Beschreibung |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Ein neues Konto erstellen |
| `POST` | `/api/auth/login` | Anmeldung mit E-Mail/Passwort |
| `POST` | `/api/auth/refresh` | Das Access-Token aktualisieren |
| `POST` | `/api/auth/<provider>` | OAuth-Anmeldung (z. B. `/api/auth/google`, `/api/auth/linkedin`) |
| `POST` | `/api/auth/link/<provider>` | Einen OAuth-Anbieter mit dem authentifizierten Konto verknüpfen. Bei einem Gast entspricht dies einer Registrierung: Es erfordert `allowRegistration`, übernimmt die Adresse des Anbieters, wenn dieser dafür bürgt, und antwortet mit einer Sitzung für das Konto, zu dem der Gast wurde |
| `POST` | `/api/auth/logout` | Refresh-Token widerrufen |
| `POST` | `/api/auth/forgot-password` | E-Mail zum Zurücksetzen des Passworts senden |
| `POST` | `/api/auth/reset-password` | Passwort mit Token zurücksetzen |
| `POST` | `/api/auth/find-user` | Eine E-Mail-Adresse in ein minimales öffentliches Profil auflösen (Opt-in — `AUTH_ALLOW_USER_LOOKUP`) |
| `POST` | `/api/auth/change-password` | Eigenes Passwort des Aufrufers ändern (authentifiziert). Beendet jede andere Sitzung und antwortet mit einer neuen für den Aufrufer |
| `GET` | `/api/auth/me` | Das eigene Profil des Aufrufers |
| `PATCH` | `/api/auth/me` | Das eigene Profil des Aufrufers aktualisieren |
| `POST` | `/api/auth/change-email` | `{ newEmail }`: Das eigene Konto des Aufrufers auf eine andere Adresse übertragen. Sendet einen Link an die neue Adresse und eine Benachrichtigung an die alte; nichts ändert sich, bis dem Link gefolgt wird. Erfordert `aal2` bei einem Konto mit zweitem Faktor. `409 EMAIL_EXISTS` oder `UNDELIVERABLE_ADDRESS`, `400 EMAIL_UNCHANGED`, `403 ANONYMOUS_USER` für Gäste – siehe [Ändern einer E-Mail-Adresse](#ändern-einer-e-mail-adresse-changing-an-email-address) |
| `POST` | `/api/auth/confirm-email-change` | `{ token }` aus dem Link. Keine Sitzung erforderlich. Überträgt das Konto verifiziert auf die neue Adresse; `400 INVALID_TOKEN` für einen bereits genutzten, ersetzten oder abgelaufenen Link, `409 EMAIL_EXISTS`, wenn die Adresse in der Zwischenzeit vergeben wurde |
| `GET` | `/api/auth/config` | Was dieses Backend einem Anmeldebildschirm anbietet – `needsSetup`, `registrationEnabled`, `passwordReset`, `emailVerification`, `magicLink`, `anonymousLogin`, `adminPasswordReset`, `enabledProviders` und `storage`, das angibt, ob das Backend Dateispeicher bereitstellt. Unauthentifiziert und aus denselben Prädikaten berechnet, die die Routen durchsetzen, sodass das, was der Bildschirm anzeigt, nicht von dem abweichen kann, was er tun kann |
| `POST` | `/api/auth/send-verification` | Dem Aufrufer einen E-Mail-Verifizierungslink senden |
| `GET` | `/api/auth/verify-email` | Einen Verifizierungslink einlösen (die URL in dieser E-Mail). Behält bei, was eine aktive Sitzung des Kontos nachweist, und entfernt, was niemand nachgewiesen hat – siehe [E-Mail-Verifizierung](/docs/backend/email-verification/) |
| `POST` | `/api/auth/verify-email` | Dasselbe mit `{ token, password?, removeUnproven? }`: Das Passwort behält es bei und meldet an; ohne Nachweis antwortet ein Konto, das einen besitzt, mit `409 PROOF_REQUIRED` |
| `POST` | `/api/auth/magic-link` | Einen Einmal-Anmeldelink per E-Mail senden. `503 EMAIL_NOT_CONFIGURED` ohne SMTP |
| `POST` | `/api/auth/magic-link/verify` | Ein Magic-Link-Token gegen eine Sitzung eintauschen |
| `POST` | `/api/auth/otp` | Einen sechsstelligen Anmeldecode per E-Mail senden. Antwortet identisch, unabhängig davon, ob für die Adresse ein Konto existiert |
| `POST` | `/api/auth/otp/verify` | `{ email, code }` gegen eine Sitzung eintauschen |
| `POST` | `/api/auth/anonymous` | Eine anonyme Sitzung erstellen (Opt-in — `ALLOW_ANONYMOUS`) |
| `POST` | `/api/auth/anonymous/link` | Echte Anmeldedaten an das bereits angemeldete anonyme Konto anhängen. Erfordert sowohl `allowAnonymous` als auch eine offene Registrierung: `403 ANONYMOUS_AUTH_DISABLED`, sobald die anonyme Anmeldung deaktiviert ist, einschließlich zuvor angemeldeter Gäste, und `403 REGISTRATION_DISABLED`, solange die Registrierung geschlossen ist |
| `GET` | `/api/auth/sessions` | Die aktiven Sitzungen des Aufrufers auflisten, eine pro Anmeldung. Die eigene des Aufrufers ist als `isCurrentSession` markiert |
| `DELETE` | `/api/auth/sessions` | Jede Sitzung widerrufen, einschließlich dieser – Remote-Abmeldung auf jedem Gerät |
| `DELETE` | `/api/auth/sessions/:id` | Eine einzelne Sitzung widerrufen: ihr Refresh-Token und das Access-Token, das dieses Gerät besitzt |
| `GET` | `/api/auth/scopes` | Jeder [Scope](/docs/backend/roles-and-scopes/), den dieses Backend kennt, und diejenigen, die der Aufrufer besitzt |
| `GET` | `/api/auth/keys` | Die eigenen [persönlichen API-Schlüssel](/docs/backend/api-keys/#personal-keys) des Aufrufers |
| `POST` | `/api/auth/keys` | Einen persönlichen Schlüssel erstellen. `403 PERSONAL_KEYS_DISABLED`, es sei denn, die Users-Tabelle setzt `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | Einen der eigenen Schlüssel des Aufrufers widerrufen |
| `GET` | `/.well-known/jwks.json` | Die öffentlichen JWKS – im Root gemountet, nicht unter `basePath`, da ein Verifizierer dort sucht. Immer gemountet, wenn das Backend eigene Token ausstellt; ein leeres Schlüsselset, bis [asymmetrisches Signieren](#asymmetrische-token-und-jwks-asymmetric-tokens-and-jwks) konfiguriert ist |
| `POST` | `/api/auth/mfa/enroll` | TOTP-Registrierung starten (gibt das Secret und Wiederherstellungscodes zurück) |
| `POST` | `/api/auth/mfa/verify` | Eine Registrierung mit einem Code aus der Authenticator-App bestätigen |
| `GET` | `/api/auth/mfa/factors` | Die registrierten Faktoren des Aufrufers auflisten |
| `POST` | `/api/auth/mfa/challenge` | Eine Challenge für einen verifizierten Faktor eröffnen |
| `POST` | `/api/auth/mfa/challenge/verify` | Eine Challenge beantworten – dies stellt die Sitzung aus |
| `DELETE` | `/api/auth/mfa/unenroll` | Einen Faktor entfernen (erfordert eine `aal2`-Sitzung, sobald das Konto einen verifizierten Faktor hat) |
| `POST` | `/api/auth/mfa/recovery-codes` | Die Wiederherstellungscodes des Aufrufers durch zehn neue ersetzen (erfordert eine `aal2`-Sitzung) |

Die administrative Benutzer- und Rollenverwaltung ist eine **separate Schnittstelle**, die unter `/api/admin/` statt `/api/auth/` gemountet ist. Das Lesen erfordert den Scope `users:read` und Änderungen erfordern `users:write`, mit Ausnahme des nachfolgenden eingeschränkten Lesevorgangs des User-Pickers. Ein Admin und der Service-Key besitzen beide; ebenso eine Rolle, die sie deklariert. Niemand darf ein Konto ändern, das über mehr Berechtigungen verfügt als man selbst. Siehe [Rollen und Scopes](/docs/backend/roles-and-scopes/).

| Methode | Pfad | Beschreibung |
|--------|------|-------------|
| `GET` | `/api/admin/users` | Benutzer auflisten (paginiert). `?search=` gleicht einen Teil der E-Mail-Adresse oder des Anzeigenamens ohne Berücksichtigung der Groß-/Kleinschreibung ab. Es gleicht auch jede Rolle ab, die der Benutzer besitzt, sowie die uid |
| `GET` | `/api/admin/users/pick` | Der Lesevorgang des User-Pickers: `uid`, `displayName`, `email` und `photoURL` pro Benutzer, sonst nichts. Akzeptiert `?search=`, `?limit=` (standardmäßig 25) und `?offset=`, oder `?ids=a,b` für die Benutzer, die ein gespeicherter Wert benennt. Antwortet auf `users:read` sowie für jeden, der eine Collection mit einem [`userSelect`](/docs/collections/properties/)-Feld beschreiben darf – damit ein Bearbeiter dieses ausfüllen kann. Eine als rohes SQL geschriebene Regel (`using` / `withCheck`, die das Policy-Modell nicht lesen kann) kann nicht im Voraus beurteilt werden und gilt hier als Verweigerung: Bei einer solchen Collection können nur Inhaber von `users:read` auswählen. Jeder andere erhält `403 SCOPE_MISSING` |
| `POST` | `/api/admin/users` | Einen Benutzer erstellen |
| `GET` | `/api/admin/users/:uid` | Einen Benutzer lesen |
| `PUT` | `/api/admin/users/:uid` | Einen Benutzer aktualisieren. `{ disabled: true }` schaltet das Konto ab, ohne es zu löschen: Jede Anmeldung und Aktualisierung wird verweigert (`ACCOUNT_DISABLED`), seine Sitzungen enden und jedes Token, das es besitzt, wird abgewiesen; `false` schaltet es wieder ein |
| `DELETE` | `/api/admin/users/:uid` | Einen Benutzer löschen. Seine Sitzungen enden und jedes Access-Token, das er besitzt, wird ab dieser Anfrage abgewiesen |
| `POST` | `/api/admin/users/:uid/reset-password` | Das Passwort eines Benutzers ohne dessen aktuelles Passwort zurücksetzen. `rebase auth reset-password` ruft dies auf und schreibt nur dann direkt in die Datenbank, wenn das Backend nicht erreichbar ist; in beiden Fällen enden die Sitzungen des Kontos |
| `DELETE` | `/api/admin/users/:uid/mfa` | Die zweiten Faktoren und Wiederherstellungscodes eines Benutzers entfernen und dessen Sitzungen beenden – für Personen, die beides verloren haben |
| `GET` | `/api/admin/roles` | `admin` und die Rollen, die die Users-Tabelle deklariert, mit ihren Scopes |
| `POST` | `/api/admin/bootstrap` | Dem am frühesten registrierten Benutzer erlauben, die Admin-Rolle zu beanspruchen, solange keine existiert. In der Produktion verweigert – siehe [First User Bootstrap](/docs/backend/authentication/#first-user-bootstrap) |

Alle Daten-API-Endpunkte erfordern einen gültigen `Authorization: Bearer <token>`-Header, wenn `requireAuth: true` (Standardeinstellung) gesetzt ist.

### Passwort-Richtlinie

Ein neues Passwort erfordert mindestens 8 Zeichen, darunter einen Großbuchstaben, einen Kleinbuchstaben und eine Ziffer. Registrierung, Zurücksetzen und Ändern lehnen Passwörter, die dies nicht erfüllen, mit `400 WEAK_PASSWORD` ab und listen jede verletzte Regel auf; dasselbe gilt für Administratoren beim Auswählen eines Passworts: `POST /api/admin/users`, eine Erstellung in der Users-Tabelle über die Daten-API (`POST /api/data/users`, deren `/bulk`, ein Socket- oder MCP-Schreibvorgang), `PUT /api/admin/users/:uid` und `POST /api/admin/users/:uid/reset-password`. Bei einem `/bulk` beginnt die Nachricht mit `Row <n>: ` (gezählt ab 0), wie die anderen Zeilenfehler des Bulk-Vorgangs.

Um Konten zu erstellen, deren Passwörter von einem anderen System festgelegt wurden, z. B. bei einem Import, senden Sie `skipPasswordPolicy: true` im Create-Body (in jeder Zeile eines `/bulk`). Der Server berücksichtigt dies nur für Administratoren oder den Service-Key; bei allen anderen wird nichts erlassen, und die Ablehnung weist darauf hin. Dieser Wert wird niemals gespeichert. Der Import des Admin-Panels sendet ihn für jede Zeile, die ein `password` enthält. Die Anmeldung prüft die Richtlinie nie, sodass ältere Passwörter weiterhin funktionieren. Um eigene Regeln festzulegen, übergeben Sie `auth.hooks.validatePasswordStrength` aus einem [ausgehängten (ejected)](/docs/backend/authentication/#configuration) Backend. Für den ersten Administrator, der über `REBASE_ADMIN_PASSWORD` eingerichtet wird, gilt eine andere Regel: mindestens 12 Zeichen, sonst nichts.

### Antwortformat

Jeder Endpunkt, der eine Sitzung ausstellt, antwortet mit demselben Envelope – `register`, `login`, jeder OAuth-Anbieter, `magic-link/verify`, `otp/verify`, `anonymous`, `anonymous/link` und `mfa/challenge/verify`:

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

Senden Sie das Access-Token als `Authorization: Bearer <accessToken>` zurück. `accessTokenExpiresAt` sind Millisekunden seit der Unix-Epoche.

`POST /api/auth/refresh` antwortet mit demselben Envelope, mit der Ausnahme, dass `user` vollständig weggelassen wird, wenn das Konto nicht erneut gelesen werden kann; behandeln Sie es dort also als optional.

`providerId` gibt an, wie die Sitzung angemeldet wurde: `password`, `anonymous`, `magic-link`, `otp`, `mfa` (eine mit einem zweiten Faktor abgeschlossene Anmeldung) oder die ID des Anbieters, wie z. B. `google`. Sie wird bei der Anmeldung mit der Sitzung gespeichert, sodass `refresh` und `GET /api/auth/me` dieselbe Antwort liefern, solange die Sitzung besteht. Eine vor Version 0.24 angemeldete Sitzung liefert `password`.

:::caution[Das typisierte SDK flacht dieses Envelope ab – raw HTTP nicht]
Das obige JSON ist das Übertragungsformat (Wire Format) und entspricht dem, was `fetch("/api/auth/login")` zurückgibt: Das Token befindet sich unter **`body.tokens.accessToken`**.

Das [typisierte SDK](/docs/sdk/authentication) entpackt `tokens`, bevor es die Sitzung zurückgibt, sodass `auth.signInWithEmail()` stattdessen zu einem abgeflachten **`{ user, accessToken, refreshToken }`** aufgelöst wird.

Beide Formate existieren real; sie gehören zu zwei verschiedenen Schichten. Das Auslesen des SDK-Formats aus einem rohen `fetch` ergibt `undefined`, was sich als „Anmeldung erfolgreich, aber kein Access-Token vorhanden“ bemerkbar macht – die Anmeldung war in Ordnung, das Token lag lediglich eine Ebene tiefer.
:::

### Ändern einer E-Mail-Adresse {#changing-an-email-address}

Ein angemeldeter Benutzer überträgt sein eigenes Konto in zwei Schritten auf eine andere Adresse:

1. `POST /api/auth/change-email { newEmail }` erfasst die Änderung und sendet einen Link, `<frontend>/confirm-email-change?token=…`, an die neue Adresse sowie eine Benachrichtigung ohne Link an die aktuelle. Der Link ist 24 Stunden lang gültig, und eine neue Anfrage ersetzt die vorherige. `GET /api/auth/me` meldet die ausstehende Adresse als `pendingEmail`.
2. `POST /api/auth/confirm-email-change { token }` überträgt das Konto: Die neue Adresse wird zur verifizierten Adresse des Kontos. Jede OAuth-Identität, deren Anbieter für die alte Adresse gebürgt hat, wird getrennt (`removedProviders` listet diese auf), da sich sonst jeder, der die alte Adresse kontrolliert, weiterhin darüber anmelden könnte, und jeder an die alte Adresse gesendete Reset-Link verliert seine Gültigkeit. Sitzungen bleiben erhalten.

Die neue Adresse wird nicht reserviert, während der Link aussteht: Eine Reservierung würde es jedem Konto ermöglichen, Fremde daran zu hindern, sich mit ihrer eigenen Adresse zu registrieren. Wenn ein anderes Konto die Adresse übernommen hat, bis dem Link gefolgt wird, antwortet der Link mit `409 EMAIL_EXISTS` und nichts wird übertragen; von zwei Konten, die dieselbe Adresse anfordern, erhält dasjenige den Zuschlag, das seinem Link zuerst folgt. Der Hook `beforeEmailChange` kann eine Adresse ablehnen, genau wie `beforeUserCreate` bei der Registrierung.

Im CMS wird die Adresse unter **Kontoeinstellungen → Profil** geändert, und der Link öffnet die CMS-eigene Ansicht, unabhängig davon, ob man angemeldet ist oder nicht. Ein anderes Frontend stellt eine Seite unter `/confirm-email-change` bereit, die die Route mit dem Token des Links aufruft.

Wenn [`cookieAuth`](/docs/backend/authentication/#refresh-tokens-in-an-httponly-cookie) aktiviert ist (Standardeinstellung), wird das Refresh-Token als `httpOnly`-Cookie übertragen und `tokens.refreshToken` ist eine leere Zeichenkette im Body. Das Access-Token bleibt davon unberührt.

### Multi-Faktor-Authentifizierung (TOTP)

**Ein zweiter Faktor schützt die Anmeldung, nicht nur einzelne Operationen.** Sobald ein Konto über einen *verifizierten* TOTP-Faktor verfügt, stellt keine Route eine Sitzung aus, bis ein Code vorgelegt wird – Passwort-Login, jeder OAuth-Anbieter, Magic Link, E-Mail-Code und Anonymous-Link verweigern den Zugriff allesamt mit `401 MFA_REQUIRED`:

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

`mfaToken` ist **keine Sitzung**: Es ist zweckgebunden, läuft in fünf Minuten ab und wird von jeder authentifizierten Route abgelehnt. Senden Sie es als Bearer-Token an `POST /api/auth/mfa/challenge` (mit einer `factorId`) und anschließend an `POST /api/auth/mfa/challenge/verify` (mit der `challengeId` und dem sechsstelligen Code oder einem Wiederherstellungscode). Dieser letzte Aufruf stellt die Access- und Refresh-Token auf Stufe `aal2` aus; die Stufe wird in der Sitzung gespeichert und über `POST /api/auth/refresh` hinweg beibehalten.

Auch die Registrierung ist geschützt. Der erste Faktor eines Kontos kann aus einer normalen Sitzung heraus registriert werden, aber sobald einer verifiziert ist, erfordern `enroll`, `verify` und `unenroll` allesamt eine `aal2`-Sitzung – andernfalls könnte ein gestohlenes Passwort einen eigenen Faktor registrieren, Berechtigungen hochstufen und den echten Faktor löschen.

Die Verifizierung ist auf beiden Achsen begrenzt: Eine Challenge verfällt nach fünf Fehlversuchen, jedes Konto ist auf zehn Verifizierungsversuche pro 15 Minuten beschränkt (gezählt pro Benutzer, IP-Rotation hilft also nicht), und ein akzeptierter Code wird für den Faktor vermerkt, sodass er für den Rest seines ±1-Schritt-Zeitfensters nicht erneut abgespielt werden kann.

In der CMS-Users-Tabelle werden **Zweistufige Verifizierung zurücksetzen** (`DELETE /api/admin/users/:uid/mfa`) und **Konto deaktivieren oder aktivieren** (`PUT /api/admin/users/:uid { disabled }`) jedem angeboten, der `users:write` besitzt, genau wie die Routen selbst; der Schalter wird für das eigene Konto niemals angeboten, und bei einem Konto mit höherem Rang wird die Aktion mit der Begründung des Servers verweigert.

Setzen Sie `MFA_ENCRYPTION_KEY` (mindestens 32 Zufallszeichen), um gespeicherte TOTP-Secrets zu verschlüsseln. Ohne diesen greift der Server auf `JWT_SECRET` zurück und gibt eine Warnung aus. Setzen Sie ihn, **bevor** sich jemand registriert: Gespeicherte Secrets tragen keine Key-ID, sodass eine nachträgliche Änderung des Schlüssels bestehende Faktoren unentschlüsselbar macht und deren Inhaber keine Challenge mehr abschließen können.

### Teammitglieder per E-Mail einladen

Einladungsabläufe müssen eine E-Mail-Adresse in eine Benutzer-ID umwandeln, aber die Tabelle `users` ist vom Client aus RLS-geschützt. Anstatt eine eigene Admin-Serverfunktion manuell zu erstellen, können Sie das integrierte Lookup aktivieren:

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

Der Endpunkt ist **ausschließlich authentifiziert zugänglich** und gibt lediglich `uid`, `displayName` und `photoURL` zurück – niemals die E-Mail-Adresse, Rollen oder Metadaten des gesuchten Benutzers. Er ist **standardmäßig deaktiviert**, da er es jedem angemeldeten Benutzer ermöglicht zu prüfen, für welche E-Mail-Adressen Konten existieren; aktivieren Sie ihn nur, wenn Ihre Einladungs-UX dies erfordert.

## Row-Level Security (RLS) Datenbankkontext

Rebase verbindet die Anfrage-Authentifizierung direkt mit der PostgreSQL Row-Level Security (RLS). Jede Datenbankabfrage, die über einen benutzerbezogenen Treiber ausgeführt wird, läuft innerhalb einer Datenbanktransaktion (`db.transaction()`), die transaktionslokale Konfigurationsparameter setzt:

*   `app.uid` — Die eindeutige ID (`uid`) des authentifizierten Benutzers. Standardmäßig `'anonymous'` für unauthentifizierte Anfragen. Das frühere `app.user_id` wird weiterhin daneben geschrieben, für Policies, die vor der Umbenennung kompiliert wurden.
*   `app.user_roles` — Eine kommagetrennte Zeichenkette, die die zugewiesenen Rollen des Benutzers auflistet.
*   `app.is_anonymous` — `'true'` für eine Gastsitzung (anonyme Anmeldung), andernfalls `'false'`.
*   `app.jwt` — Ein JSON-String mit den benutzerdefinierten Claims des Tokens plus `sub`, `roles` und `is_anonymous` (`{"sub": "<uid>", "roles": [...], "is_anonymous": false, …}`).

Diese Parameter werden für die Dauer der Transaktion lokal mit der Postgres-Funktion `set_config` konfiguriert:
```sql
SELECT 
    set_config('app.uid', $1, true),
    set_config('app.user_id', $1, true),
    set_config('app.user_roles', $2, true),
    set_config('app.is_anonymous', $3, true),
    set_config('app.jwt', $4, true);
```

### PostgreSQL-Policy-Hilfsfunktionen

Um das Schreiben von Row-Level-Security-Policies zu vereinfachen, erstellt Rebase beim Datenbank-Bootstrapping Hilfsfunktionen unter dem Schema `rebase`:

*   **`rebase.uid()`** — Gibt die ID des authentifizierten Benutzers als `text` zurück, oder `NULL`, falls nicht gesetzt:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.uid() RETURNS text AS $$
        SELECT COALESCE(
            NULLIF(current_setting('app.uid', true), ''),
            NULLIF(current_setting('app.user_id', true), '')
        );
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.roles()`** — Gibt die kommagetrennte Zeichenkette der Rollen zurück:
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

## Asymmetrische Token und JWKS {#asymmetric-tokens-and-jwks}

Standardmäßig werden Access-Token mit `jwtSecret` (HS256) signiert. Das funktioniert zwar, bedeutet aber, dass jede Komponente, die ein Token *verifizieren* muss, auch den Schlüssel besitzen muss, der es *ausstellt* – ein Gateway oder ein Edge-Worker, der eine Sitzung überprüft, könnte somit auch Token fälschen – und das Ändern des Secrets meldet alle Benutzer auf einmal ab.

Konfigurieren Sie einen Signaturschlüssel, signiert Rebase Access-Token stattdessen asymmetrisch und veröffentlicht den öffentlichen Teil unter **`/.well-known/jwks.json`**, damit jeder dagegen verifizieren kann:

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

Erzeugen Sie einen Schlüssel mit:

```bash
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out jwt-key.pem
```

RSA-Schlüssel funktionieren ebenfalls und signieren mit `RS256`; EC P-256-Schlüssel signieren mit `ES256`. Es wird nur der private Schlüssel konfiguriert – der öffentliche Teil wird daraus abgeleitet, sodass das Paar nicht fehlerhaft zugeordnet werden kann. `jwtSecret` bleibt in jedem Fall erforderlich: Es signiert weiterhin die zweckgebundenen Token (Download-Links, ausstehende MFA, Zurücksetzen des Passworts), die ausschließlich dieser Server jemals liest.

### Rotieren eines Schlüssels

Setzen Sie den neuen Schlüssel an die erste Stelle und belassen Sie den alten in der Liste. Neue Token werden mit dem neuen Schlüssel signiert; bereits im Umlauf befindliche Token werden weiterhin gegen den alten verifiziert, bis sie ablaufen, sodass niemand abgemeldet wird.

```typescript no-verify
signingKeys: [
    { kid: "2026-09", privateKey: process.env.JWT_PRIVATE_KEY_NEW! },
    { kid: "2026-08", privateKey: process.env.JWT_PRIVATE_KEY_OLD! }
]
```

Sobald die maximale Lebensdauer von Access-Token verstrichen ist, entfernen Sie den alten Eintrag. Verwenden Sie `activeKid`, wenn Sie einen Schlüssel veröffentlichen möchten, bevor Sie damit signieren.

### An anderer Stelle verifizieren

Token tragen die `kid` des Signaturschlüssels in ihrem Header, wodurch ein Verifizierer den richtigen Schlüssel aus dem JWKS auswählt und weiß, wann nach einer Rotation ein erneuter Abruf erforderlich ist. Jede Standardbibliothek übernimmt dies für Sie – zum Beispiel mit `jose`:

```typescript no-verify
import { createRemoteJWKSet, jwtVerify } from "jose";

const jwks = createRemoteJWKSet(new URL("https://api.example.com/.well-known/jwks.json"));
const { payload } = await jwtVerify(token, jwks);
```

:::note
Wenn keine `signingKeys` konfiguriert sind, antwortet `/.well-known/jwks.json` mit `{"keys":[]}` und Token bleiben HS256. Es ändert sich nichts, bis Sie einen Schlüssel hinzufügen.
:::

## Service-Key-Authentifizierung

Für die Server-zu-Server-Kommunikation (z. B. Cronjobs, externe Dienste) konfigurieren Sie einen statischen Service-Key:

```typescript
auth: {
    serviceKey: process.env.REBASE_SERVICE_KEY,
    // ...
}
```

Clients authentifizieren sich mit dem Header `Authorization: Bearer <service-key>`. 

### Interner Schlüssel pro Bootvorgang

Wenn `REBASE_SERVICE_KEY` in Ihrer Konfiguration nicht angegeben ist, generiert Rebase automatisch einen zufälligen **internen Schlüssel pro Bootvorgang**. 

Dieser Schlüssel wird niemals protokolliert und verlässt den Prozess nie. Er wird vom `rebase`-Singleton verwendet, um sich gegenüber den Control-Plane-APIs des Servers selbst (Auth, Storage usw.) zu authentifizieren. Dies stellt sicher, dass administrative Aufgaben (wie das Senden einer Willkommens-E-Mail oder das Generieren einer Storage-URL) sowohl in der Entwicklung als auch in der Produktion standardmäßig ohne manuelle Schlüsselverwaltung funktionieren.

### Schutz vor Timing-Angriffen & Schlüsselanforderungen

Um Timing-Angriffe zu verhindern, validiert Rebase sowohl den benutzerkonfigurierten Service-Key als auch den internen Schlüssel mittels String-Vergleich mit konstanter Laufzeit (`safeCompare`). Der benutzerkonfigurierte Service-Key **muss mindestens 32 Zeichen lang sein**; wird ein Schlüssel mit weniger als 32 Zeichen konfiguriert, wirft Rebase beim Start einen Konfigurationsfehler und bricht sicherheitshalber ab (fail-closed).

## Nächste Schritte

- **[Authentifizierung](/docs/backend/authentication/)** — die Konfiguration, aus der diese Routen stammen
- **[Eigene Auth-Adapter](/docs/backend/auth-adapters/)** — den Anbieter dahinter austauschen
- **[Sicherheitsregeln (RLS)](/docs/collections/security-rules/)** — was eine Policy mit `rebase.uid()` macht
- **[Typisierte SDK-Authentifizierung](/docs/sdk/authentication/)** — diese Routen über das SDK aufrufen
