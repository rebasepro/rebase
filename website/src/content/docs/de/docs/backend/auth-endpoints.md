---
sourceHash: 26d38afcbfd02569
title: Auth-Endpunkte und Token
sidebar_label: Auth-Endpunkte
description: Die Authentifizierungs-Routen, die das Rebase-Backend bereitstellt, ihre Antwortformate, Multi-Faktor-Authentifizierung, der Datenbankkontext für Richtlinien, JWKS und Service-Schlüssel.
---

Die Routen, die [der `auth`-Block](/docs/backend/authentication/) bereitstellt, und die Token, die sie zurückgeben.

## Auth-Endpunkte

Alle Auth-Endpunkte werden unter `/api/auth/` bereitgestellt:

| Methode | Pfad | Beschreibung |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Neues Konto erstellen |
| `POST` | `/api/auth/login` | Anmeldung mit E-Mail/Passwort |
| `POST` | `/api/auth/refresh` | Access-Token erneuern |
| `POST` | `/api/auth/<provider>` | OAuth-Anmeldung (z. B. `/api/auth/google`, `/api/auth/linkedin`) |
| `POST` | `/api/auth/link/<provider>` | Verknüpft einen OAuth-Anbieter mit dem authentifizierten Konto. Bei einem Gast entspricht dies einer Registrierung: Es erfordert `allowRegistration`, übernimmt die Adresse des Anbieters, wenn dieser dafür bürgt, und antwortet mit einer Sitzung für das Konto, zu dem der Gast geworden ist |
| `POST` | `/api/auth/logout` | Refresh-Token widerrufen |
| `POST` | `/api/auth/forgot-password` | E-Mail zum Zurücksetzen des Passworts senden |
| `POST` | `/api/auth/reset-password` | Passwort mit Token zurücksetzen |
| `POST` | `/api/auth/find-user` | Löst eine E-Mail zu einem minimalen öffentlichen Profil auf (Opt-in — `AUTH_ALLOW_USER_LOOKUP`) |
| `POST` | `/api/auth/change-password` | Ändert das eigene Passwort des Aufrufers (authentifiziert). Beendet jede andere Sitzung und antwortet mit einer neuen für den Aufrufer |
| `GET` | `/api/auth/me` | Das eigene Profil des Aufrufers |
| `PATCH` | `/api/auth/me` | Das eigene Profil des Aufrufers aktualisieren |
| `POST` | `/api/auth/change-email` | `{ newEmail }`: Überträgt das eigene Konto des Aufrufers auf eine andere Adresse. Sendet einen Link an die neue Adresse und eine Benachrichtigung an die alte; nichts ändert sich, bis dem Link gefolgt wird. Erfordert `aal2` bei einem Konto mit einem zweiten Faktor. `409 EMAIL_EXISTS` oder `UNDELIVERABLE_ADDRESS`, `400 EMAIL_UNCHANGED`, `403 ANONYMOUS_USER` für Gäste — siehe [E-Mail-Adresse ändern](#e-mail-adresse-ändern) |
| `POST` | `/api/auth/confirm-email-change` | `{ token }` aus dem Link. Keine Sitzung erforderlich. Überträgt das Konto verifiziert auf die neue Adresse; `400 INVALID_TOKEN` für einen verbrauchten, ersetzten oder abgelaufenen Link, `409 EMAIL_EXISTS`, wenn die Adresse in der Zwischenzeit vergeben wurde |
| `GET` | `/api/auth/config` | Was dieses Backend einem Anmeldebildschirm zur Verfügung stellt — `needsSetup`, `registrationEnabled`, `passwordReset`, `emailVerification`, `magicLink`, `anonymousLogin`, `adminPasswordReset`, `enabledProviders` und `storage`, welches angibt, ob das Backend Dateispeicherung unterstützt. Nicht authentifiziert und anhand derselben Prädikate berechnet, die die Routen erzwingen, sodass die Anzeige auf dem Bildschirm nicht von den tatsächlichen Fähigkeiten abweichen kann |
| `POST` | `/api/auth/send-verification` | Sendet dem Aufrufer einen Link zur E-Mail-Verifizierung |
| `GET` | `/api/auth/verify-email` | Löst einen Verifizierungslink ein (die URL in dieser E-Mail). Behält bei, was eine aktive Sitzung des Kontos nachweist, und entfernt, was niemand nachgewiesen hat — siehe [E-Mail-Verifizierung](/docs/backend/email-verification/) |
| `POST` | `/api/auth/verify-email` | Dasselbe mit `{ token, password?, removeUnproven? }`: Das Passwort behält es bei und meldet an; ohne einen der beiden Nachweise antwortet ein Konto, das einen besitzt, mit `409 PROOF_REQUIRED` |
| `POST` | `/api/auth/magic-link` | Sendet einen einmaligen Anmeldelink per E-Mail. `503 EMAIL_NOT_CONFIGURED` ohne SMTP |
| `POST` | `/api/auth/magic-link/verify` | Tauscht ein Magic-Link-Token gegen eine Sitzung ein |
| `POST` | `/api/auth/otp` | Sendet einen sechsstelligen Anmeldecode per E-Mail. Antwortet identisch, unabhängig davon, ob für die Adresse ein Konto existiert |
| `POST` | `/api/auth/otp/verify` | Tauscht `{ email, code }` gegen eine Sitzung ein |
| `POST` | `/api/auth/anonymous` | Erstellt eine anonyme Sitzung (Opt-in — `ALLOW_ANONYMOUS`) |
| `POST` | `/api/auth/anonymous/link` | Verknüpft echte Anmeldedaten mit dem bereits angemeldeten anonymen Konto. Erfordert sowohl `allowAnonymous` als auch eine offene Registrierung: `403 ANONYMOUS_AUTH_DISABLED`, sobald die anonyme Anmeldung deaktiviert ist (einschließlich zuvor angemeldeter Gäste), und `403 REGISTRATION_DISABLED`, solange die Registrierung geschlossen ist |
| `GET` | `/api/auth/sessions` | Listet die aktiven Sitzungen des Aufrufers auf, eine pro Anmeldung. Die eigene Sitzung des Aufrufers ist mit `isCurrentSession` markiert |
| `DELETE` | `/api/auth/sessions` | Widerruft jede Sitzung, einschließlich dieser — Remote-Abmeldung auf allen Geräten |
| `DELETE` | `/api/auth/sessions/:id` | Widerruft eine einzelne Sitzung: ihr Refresh-Token und das Access-Token, das dieses Gerät hält |
| `GET` | `/api/auth/scopes` | Jeder [Scope](/docs/backend/roles-and-scopes/), den dieses Backend kennt, sowie diejenigen, die der Aufrufer besitzt |
| `GET` | `/api/auth/keys` | Die eigenen [persönlichen API-Schlüssel](/docs/backend/api-keys/#personal-keys) des Aufrufers |
| `POST` | `/api/auth/keys` | Erstellt einen persönlichen Schlüssel. `403 PERSONAL_KEYS_DISABLED`, es sei denn, die Users-Collection setzt `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | Widerruft einen der eigenen Schlüssel des Aufrufers |
| `GET` | `/.well-known/jwks.json` | Das öffentliche JWKS — im Root gemountet, nicht unter `basePath`, da ein Verifizierer dort sucht. Wird immer dann bereitgestellt, wenn das Backend eigene Token ausstellt; ein leeres Schlüsselset, bis [asymmetrisches Signieren](#asymmetrische-token-und-jwks) konfiguriert ist |
| `POST` | `/api/auth/mfa/enroll` | Startet die TOTP-Registrierung (gibt das Secret und Recovery-Codes zurück) |
| `POST` | `/api/auth/mfa/verify` | Bestätigt eine Registrierung mit einem Code aus der Authenticator-App |
| `GET` | `/api/auth/mfa/factors` | Listet die registrierten Faktoren des Aufrufers auf |
| `POST` | `/api/auth/mfa/challenge` | Eröffnet eine Challenge für einen verifizierten Faktor |
| `POST` | `/api/auth/mfa/challenge/verify` | Beantwortet eine Challenge — hierbei wird die Sitzung ausgestellt |
| `DELETE` | `/api/auth/mfa/unenroll` | Entfernt einen Faktor (erfordert eine `aal2`-Sitzung, sobald das Konto über einen verifizierten Faktor verfügt) |
| `POST` | `/api/auth/mfa/recovery-codes` | Ersetzt die Recovery-Codes des Aufrufers durch zehn neue (erfordert eine `aal2`-Sitzung) |

Die administrative Benutzer- und Rollenverwaltung ist eine **separate Schnittstelle**, die unter `/api/admin/` statt unter `/api/auth/` bereitgestellt wird. Für den Lesezugriff ist der Scope `users:read` erforderlich, für Änderungen `users:write`, mit Ausnahme des unten beschriebenen eingeschränkten Lesezugriffs der Benutzerauswahl. Ein Administrator und der Service-Schlüssel besitzen beide; ebenso eine Rolle, die sie deklariert. Niemand darf ein Konto ändern, das über mehr Berechtigungen verfügt als man selbst. Siehe [Rollen und Scopes](/docs/backend/roles-and-scopes/).

| Methode | Pfad | Beschreibung |
|--------|------|-------------|
| `GET` | `/api/admin/users` | Benutzer auflisten (paginiert). `?search=` gleicht ohne Berücksichtigung der Groß-/Kleinschreibung einen Teil der E-Mail-Adresse oder des Anzeigenamens ab. Es gleicht auch jede Rolle ab, die der Benutzer innehat, sowie die `uid` |
| `GET` | `/api/admin/users/pick` | Der Lesezugriff der Benutzerauswahl: `uid`, `displayName`, `email` und `photoURL` pro Benutzer, sonst nichts. Akzeptiert `?search=`, `?limit=` (standardmäßig 25) und `?offset=` oder `?ids=a,b` für die Benutzer, die ein gespeicherter Wert benennt. Antwortet bei `users:read` sowie für jeden, der in eine Collection mit einem [`userSelect`](/docs/collections/properties/)-Feld schreiben darf — damit ein Editor dieses ausfüllen kann. Eine als rohes SQL verfasste Regel (`using` / `withCheck`, die das Richtlinienmodell nicht lesen kann) kann vorab nicht beurteilt werden und gilt hier als Ablehnung: In einer solchen Collection können nur Inhaber von `users:read` eine Auswahl treffen. Alle anderen erhalten `403 SCOPE_MISSING` |
| `POST` | `/api/admin/users` | Benutzer erstellen |
| `GET` | `/api/admin/users/:uid` | Einen Benutzer lesen |
| `PUT` | `/api/admin/users/:uid` | Einen Benutzer aktualisieren. `{ disabled: true }` schaltet das Konto ab, ohne es zu löschen: Jede Anmeldung und Aktualisierung wird abgewiesen (`ACCOUNT_DISABLED`), seine Sitzungen enden und jedes Token, das es hält, wird abgelehnt; `false` schaltet es wieder ein |
| `DELETE` | `/api/admin/users/:uid` | Einen Benutzer löschen. Seine Sitzungen enden und jedes Access-Token, das er besitzt, wird ab dieser Anfrage abgewiesen |
| `POST` | `/api/admin/users/:uid/reset-password` | Setzt das Passwort eines Benutzers ohne dessen aktuelles Passwort zurück. `rebase auth reset-password` ruft dies auf und schreibt nur dann direkt in die Datenbank, wenn das Backend nicht erreichbar ist; in beiden Fällen enden die Sitzungen des Kontos |
| `DELETE` | `/api/admin/users/:uid/mfa` | Entfernt die zweiten Faktoren und Recovery-Codes eines Benutzers und beendet seine Sitzungen — für jemanden, der beides verloren hat |
| `GET` | `/api/admin/roles` | `admin` und die Rollen, die die Users-Collection deklariert, mit ihren Scopes |
| `POST` | `/api/admin/bootstrap` | Erlaubt dem am frühesten registrierten Benutzer, die Admin-Rolle zu beanspruchen, solange keine existiert. In der Produktion abgewiesen — siehe [First User Bootstrap](/docs/backend/authentication/#first-user-bootstrap) |

Alle Daten-API-Endpunkte erfordern einen gültigen `Authorization: Bearer <token>`-Header, wenn `requireAuth: true` gesetzt ist (Standardeinstellung).

### Passwortrichtlinie

Ein neues Passwort erfordert mindestens 8 Zeichen mit einem Großbuchstaben, einem Kleinbuchstaben und einer Ziffer. Registrierung, Zurücksetzen und Ändern lehnen Passwörter, die dies nicht erfüllen, mit `400 WEAK_PASSWORD` ab und listen jede verletzte Regel auf. Dasselbe gilt, wenn ein Administrator ein Passwort vergibt: `POST /api/admin/users`, eine Erstellung in der Users-Collection über die Daten-API (`POST /api/data/users`, dessen `/bulk`, ein Socket- oder MCP-Schreibvorgang), `PUT /api/admin/users/:uid` und `POST /api/admin/users/:uid/reset-password`. Bei einem `/bulk` beginnt die Nachricht mit `Row <n>: ` (gezählt ab 0), wie die anderen Zeilenfehler des Bulk-Vorgangs.

Um Konten zu erstellen, deren Passwörter von einem anderen System festgelegt wurden (z. B. bei einem Import), senden Sie `skipPasswordPolicy: true` im Body der Erstellungsanfrage (in jeder Zeile eines `/bulk`). Der Server berücksichtigt dies nur für einen Administrator oder den Service-Schlüssel; bei allen anderen wird keine Ausnahme gewährt, und die Ablehnung weist darauf hin. Der Wert wird niemals gespeichert. Der Import des Admin-Panels sendet ihn für jede Zeile, die ein `password` enthält. Bei der Anmeldung wird die Richtlinie nie überprüft, sodass ältere Passwörter weiterhin funktionieren. Um eigene Regeln festzulegen, übergeben Sie `auth.hooks.validatePasswordStrength` aus einem [ejected](/docs/backend/authentication/#configuration) Backend. Für den ersten Administrator, der über `REBASE_ADMIN_PASSWORD` initialisiert wird, gilt eine andere Regel: mindestens 12 Zeichen und sonst nichts.

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

Senden Sie das Access-Token als `Authorization: Bearer <accessToken>` zurück.
`accessTokenExpiresAt` sind Millisekunden seit der Unix-Epoche.

`POST /api/auth/refresh` antwortet mit demselben Envelope, mit der Ausnahme, dass `user` vollständig weggelassen wird, wenn das Konto nicht erneut gelesen werden kann; behandeln Sie es dort daher als optional.

`providerId` gibt an, wie die Sitzung angemeldet wurde: `password`, `anonymous`, `magic-link`, `otp`, `mfa` (eine mit einem zweiten Faktor abgeschlossene Anmeldung) oder die ID des Anbieters, wie z. B. `google`. Dies wird beim Anmelden mit der Sitzung gespeichert, sodass `refresh` und `GET /api/auth/me` dieselbe Antwort liefern, solange die Sitzung besteht. Eine vor 0.24 angemeldete Sitzung liefert `password`.

:::caution[Das typisierte SDK flacht diesen Envelope ab — raw HTTP nicht]
Das obige JSON ist das Übertragungsformat (Wire Format) und entspricht dem, was `fetch("/api/auth/login")` zurückgibt: Das Token befindet sich unter **`body.tokens.accessToken`**.

Das [typisierte SDK](/docs/sdk/authentication) entpackt `tokens`, bevor es die Sitzung zurückgibt, sodass `auth.signInWithEmail()` stattdessen zu einem abgeflachten **`{ user, accessToken, refreshToken }`** aufgelöst wird.

Beide Strukturen sind real; sie gehören zu zwei unterschiedlichen Schichten. Der Versuch, die Struktur des SDKs direkt aus einem rohen `fetch` zu lesen, führt zu `undefined`, was sich als „Anmeldung erfolgreich, aber kein Access-Token vorhanden“ äußert — die Anmeldung war in Ordnung, das Token befand sich lediglich eine Ebene tiefer.
:::

### E-Mail-Adresse ändern

Ein angemeldeter Benutzer überträgt das eigene Konto in zwei Schritten auf eine andere Adresse:

1. `POST /api/auth/change-email { newEmail }` erfasst die Änderung und sendet einen Link, `<frontend>/confirm-email-change?token=…`, an die neue Adresse sowie eine Benachrichtigung ohne Link an die aktuelle Adresse. Der Link ist 24 Stunden gültig, und eine neue Anfrage ersetzt die vorherige. `GET /api/auth/me` gibt die ausstehende Adresse als `pendingEmail` an.
2. `POST /api/auth/confirm-email-change { token }` überträgt das Konto: Die neue Adresse wird zur verifizierten Adresse des Kontos. Jede OAuth-Identität, deren Anbieter für die alte Adresse gebürgt hat, wird getrennt (`removedProviders` benennt diese), da sich sonst jeder, der die alte Adresse kontrolliert, weiterhin darüber anmelden könnte; zudem wird jeder an die alte Adresse gesendete Reset-Link ungültig. Sitzungen bleiben erhalten.

Die neue Adresse wird nicht reserviert, während der Link aussteht: Eine Reservierung würde es jedem Konto ermöglichen, Fremde daran zu hindern, sich mit ihrer eigenen Adresse zu registrieren. Wenn ein anderes Konto die Adresse bereits übernommen hat, sobald dem Link gefolgt wird, antwortet der Link mit `409 EMAIL_EXISTS` und es wird nichts übertragen; von zwei Konten, die dieselbe Adresse anfordern, erhält dasjenige den Zuschlag, das seinem Link zuerst folgt. Der `beforeEmailChange`-Hook kann eine Adresse ablehnen, genau wie `beforeUserCreate` bei der Registrierung.

Im CMS wird die Adresse unter **Account settings → Profile** geändert, und der Link öffnet die CMS-eigene Ansicht, unabhängig davon, ob man angemeldet ist oder nicht. Ein anderes Frontend stellt eine Seite unter `/confirm-email-change` bereit, die die Route mit dem Token des Links aufruft.

Wenn [`cookieAuth`](/docs/backend/authentication/#refresh-tokens-in-an-httponly-cookie) aktiviert ist (Standardeinstellung), wird das Refresh-Token als `httpOnly`-Cookie übertragen und `tokens.refreshToken` ist ein leerer String im Body. Das Access-Token bleibt davon unberührt.

### Multi-Faktor-Authentifizierung (TOTP)

**Ein zweiter Faktor sichert die gesamte Anmeldung ab, nicht nur einzelne Aktionen.** Sobald ein Konto über einen *verifizierten* TOTP-Faktor verfügt, stellt keine Route eine Sitzung aus, bevor ein Code vorgelegt wird — Passwort-Login, jeder OAuth-Anbieter, Magic-Link, E-Mail-Code und Anonymous-Link lehnen alle mit `401 MFA_REQUIRED` ab:

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

`mfaToken` ist **keine Sitzung**: Es ist zweckgebunden, läuft nach fünf Minuten ab und wird von jeder authentifizierten Route abgewiesen. Senden Sie es als Bearer-Token an `POST /api/auth/mfa/challenge` (mit einer `factorId`) und anschließend an `POST /api/auth/mfa/challenge/verify` (mit der `challengeId` und dem sechsstelligen Code oder einem Recovery-Code). Dieser letzte Aufruf erzeugt die Access- und Refresh-Tokens mit der Stufe `aal2`; diese Stufe wird in der Sitzung gespeichert und über `POST /api/auth/refresh` hinweg beibehalten.

Auch die Registrierung von Faktoren ist geschützt. Der erste Faktor eines Kontos kann aus einer regulären Sitzung heraus registriert werden, sobald jedoch einer verifiziert ist, erfordern `enroll`, `verify` und `unenroll` allesamt eine `aal2`-Sitzung — andernfalls könnte ein gestohlenes Passwort einen eigenen Faktor registrieren, die Rechte damit hochstufen und den echten Faktor löschen.

Die Verifizierung ist in zweierlei Hinsicht begrenzt: Eine Challenge verfällt nach fünf Fehlversuchen, jedes Konto ist auf zehn Verifizierungsversuche pro 15 Minuten limitiert (pro Benutzer gezählt, rotierende IPs helfen also nicht), und ein akzeptierter Code wird für den Faktor vermerkt, damit er für den Rest seines ±1-Schritt-Zeitfensters nicht erneut abgespielt werden kann.

In der Benutzertabelle des CMS werden **Zweistufige Verifizierung zurücksetzen** (`DELETE /api/admin/users/:uid/mfa`) und **Konto deaktivieren oder aktivieren** (`PUT /api/admin/users/:uid { disabled }`) jedem angeboten, der über `users:write` verfügt, analog zu den Routen; der Schalter wird niemals für das eigene Konto angeboten, und Aktionen gegen ein Konto mit höherem Rang werden mit der Begründung des Servers abgelehnt.

Setzen Sie `MFA_ENCRYPTION_KEY` (mindestens 32 Zufallszeichen), um gespeicherte TOTP-Secrets zu verschlüsseln. Ohne diesen greift der Server auf `JWT_SECRET` zurück und gibt eine Warnung aus. Setzen Sie ihn, **bevor** jemand Faktoren registriert: Gespeicherte Secrets enthalten keine Schlüssel-ID, sodass eine spätere Änderung des Schlüssels bestehende Faktoren unentschlüsselbar macht und deren Besitzer Challenges nicht mehr abschließen können.

### Teammitglieder per E-Mail einladen

Einladungsabläufe müssen eine E-Mail-Adresse in eine Benutzer-ID auflösen, die `users`-Collection ist jedoch clientseitig durch RLS geschützt. Anstatt eine eigene Admin-Serverfunktion zu schreiben, können Sie die integrierte Suchfunktion aktivieren:

```typescript no-verify
await initializeRebaseBackend({
    auth: {
        // ...
        allowUserLookup: true,   // enables POST /api/auth/find-user
    },
});
```

Dann vom Client aus:

```typescript
const profile = await client.auth.findUserByEmail("teammate@example.com");
// → { uid, displayName, photoURL } | null   (never email/roles/metadata)
if (profile) {
    await client.data.team_members.create({ team_id, user_id: profile.uid });
}
```

Der Endpunkt ist **ausschließlich für authentifizierte Benutzer** zugänglich und gibt lediglich `uid`, `displayName` und `photoURL` zurück — niemals die E-Mail-Adresse, Rollen oder Metadaten des gesuchten Benutzers. Er ist **standardmäßig deaktiviert**, da er es jedem angemeldeten Benutzer ermöglichen würde zu prüfen, welche E-Mail-Adressen ein Konto besitzen; aktivieren Sie ihn nur, wenn Ihre Einladungs-Benutzererfahrung dies erfordert.

## Row-Level Security (RLS) Datenbankkontext

Rebase leitet die Authentifizierung von Anfragen direkt an die PostgreSQL Row-Level Security (RLS) weiter. Jede Datenbankabfrage, die über einen benutzerspezifischen Treiber ausgeführt wird, läuft innerhalb einer Datenbanktransaktion (`db.transaction()`), die transaktionslokale Konfigurationsparameter setzt:

*   `app.uid` — Die eindeutige ID (`uid`) des authentifizierten Benutzers. Standardmäßig `'anonymous'` für nicht authentifizierte Anfragen. Das frühere `app.user_id` wird weiterhin parallel dazu geschrieben, für Richtlinien, die vor der Umbenennung kompiliert wurden.
*   `app.user_roles` — Ein kommagetrennter String, der die zugewiesenen Rollen des Benutzers auflistet.
*   `app.is_anonymous` — `'true'` für eine Gastsitzung (anonyme Anmeldung), andernfalls `'false'`.
*   `app.jwt` — Ein JSON-String mit den benutzerdefinierten Claims des Tokens plus `sub`, `roles` und `is_anonymous` (`{"sub": "<uid>", "roles": [...], "is_anonymous": false, …}`).

Diese Parameter werden für die Dauer der Transaktion lokal mithilfe der Postgres-Funktion `set_config` konfiguriert:
```sql
SELECT 
    set_config('app.uid', $1, true),
    set_config('app.user_id', $1, true),
    set_config('app.user_roles', $2, true),
    set_config('app.is_anonymous', $3, true),
    set_config('app.jwt', $4, true);
```

### PostgreSQL-Hilfsfunktionen für Richtlinien

Um das Schreiben von Row-Level-Security-Richtlinien zu vereinfachen, erstellt Rebase beim Bootstrapping der Datenbank Hilfsfunktionen im Schema `rebase`:

*   **`rebase.uid()`** — Gibt die ID des authentifizierten Benutzers als `text` zurück, oder `NULL`, falls nicht gesetzt:
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
*   **`rebase.is_anonymous()`** — Gibt als `boolean` an, ob der Aufrufer ein Gast ist (`false`, wenn nicht gesetzt), sodass eine Richtlinie `NOT rebase.is_anonymous()` verwenden kann.

Sie können diese Hilfsfunktionen direkt in Ihren benutzerdefinierten Sicherheitsregeln oder Datenbankmigrationen verwenden:
```sql
CREATE POLICY owner_access ON posts
    FOR ALL
    TO public
    USING (author_id = rebase.uid() OR string_to_array(rebase.roles(), ',') && ARRAY['admin']);
```

## Asymmetrische Token und JWKS

Standardmäßig werden Access-Tokens mit `jwtSecret` (HS256) signiert. Das funktioniert, bedeutet jedoch, dass jede Komponente, die ein Token *verifizieren* muss, auch den Schlüssel besitzen muss, der es *erzeugt* — ein Gateway oder ein Edge-Worker, der eine Sitzung prüft, könnte somit auch eines fälschen — und eine Änderung des Secrets meldet alle Benutzer auf einmal ab.

Wenn Sie einen Signierschlüssel konfigurieren, signiert Rebase Access-Tokens stattdessen asymmetrisch und veröffentlicht den öffentlichen Teil unter **`/.well-known/jwks.json`**, sodass jeder ihn zur Verifizierung nutzen kann:

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

RSA-Schlüssel funktionieren ebenfalls und signieren mit `RS256`; EC P-256-Schlüssel signieren mit `ES256`. Es wird nur der private Schlüssel konfiguriert — der öffentliche Teil wird davon abgeleitet, sodass Schlüsselpaare nicht versehentlich unpassend kombiniert werden können. `jwtSecret` bleibt in jedem Fall erforderlich: Es signiert weiterhin die zweckgebundenen Token (Download-Links, ausstehende MFA, Passwort-Resets), die ausschließlich dieser Server liest.

### Einen Schlüssel rotieren

Platzieren Sie den neuen Schlüssel an erster Stelle und belassen Sie den alten in der Liste. Neue Token werden mit dem neuen Schlüssel signiert; bereits im Umlauf befindliche Token werden bis zu ihrem Ablauf weiterhin gegen den alten geprüft, sodass niemand abgemeldet wird.

```typescript no-verify
signingKeys: [
    { kid: "2026-09", privateKey: process.env.JWT_PRIVATE_KEY_NEW! },
    { kid: "2026-08", privateKey: process.env.JWT_PRIVATE_KEY_OLD! }
]
```

Sobald die maximale Lebensdauer von Access-Tokens verstrichen ist, entfernen Sie den alten Eintrag. Verwenden Sie `activeKid`, wenn Sie einen Schlüssel veröffentlichen möchten, bevor Sie damit signieren.

### An anderer Stelle verifizieren

Token tragen die `kid` des Signierschlüssels in ihrem Header. Dadurch wählt ein Verifizierer den richtigen Schlüssel aus dem JWKS aus und erkennt, wann nach einer Rotation ein erneuter Abruf nötig ist. Jede Standardbibliothek übernimmt dies für Sie — beispielsweise mit `jose`:

```typescript no-verify
import { createRemoteJWKSet, jwtVerify } from "jose";

const jwks = createRemoteJWKSet(new URL("https://api.example.com/.well-known/jwks.json"));
const { payload } = await jwtVerify(token, jwks);
```

:::note
Wenn keine `signingKeys` konfiguriert sind, antwortet `/.well-known/jwks.json` mit `{"keys":[]}` und Token bleiben HS256. Es ändert sich nichts, bis Sie einen Schlüssel hinzufügen.
:::

## Service-Schlüssel-Authentifizierung

Für die Server-zu-Server-Kommunikation (z. B. Cron-Jobs, externe Dienste) konfigurieren Sie einen statischen Service-Schlüssel:

```typescript
auth: {
    serviceKey: process.env.REBASE_SERVICE_KEY,
    // ...
}
```

Clients authentifizieren sich mit dem Header `Authorization: Bearer <service-key>`.

### Interner Schlüssel pro Serverstart

Wenn `REBASE_SERVICE_KEY` nicht in Ihrer Konfiguration angegeben ist, generiert Rebase automatisch einen zufälligen **internen Schlüssel pro Serverstart**.

Dieser Schlüssel wird niemals protokolliert und verlässt den Prozess zu keinem Zeitpunkt. Er wird vom `rebase`-Singleton verwendet, um sich gegenüber den servereigenen Control-Plane-APIs (Auth, Storage usw.) zu authentifizieren. Dadurch wird sichergestellt, dass administrative Aufgaben (wie das Versenden einer Willkommens-E-Mail oder das Generieren einer Storage-URL) sowohl in der Entwicklung als auch in der Produktion standardmäßig ohne manuelle Schlüsselverwaltung funktionieren.

### Schutz vor Timing-Angriffen und Schlüsselanforderungen

Um Timing-Angriffe zu verhindern, validiert Rebase sowohl den benutzerdefinierten Service-Schlüssel als auch den internen Schlüssel mithilfe eines zeitkonstanten String-Vergleichs (`safeCompare`). Der benutzerdefinierte Service-Schlüssel **muss mindestens 32 Zeichen lang sein**; wird ein Schlüssel mit weniger als 32 Zeichen konfiguriert, löst Rebase beim Start einen Konfigurationsfehler aus und bricht den Startvorgang sicherheitshalber ab (Fail-Closed).

## Nächste Schritte

- **[Authentifizierung](/docs/backend/authentication/)** — die Konfiguration, aus der diese Routen stammen
- **[Benutzerdefinierte Auth-Adapter](/docs/backend/auth-adapters/)** — den Provider dahinter austauschen
- **[Sicherheitsregeln (RLS)](/docs/collections/security-rules/)** — was eine Richtlinie mit `rebase.uid()` macht
- **[Typisierte SDK-Authentifizierung](/docs/sdk/authentication/)** — Aufrufen dieser Routen über das SDK
