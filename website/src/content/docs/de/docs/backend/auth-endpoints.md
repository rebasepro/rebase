---
sourceHash: 3b130367f73c18c5
title: Auth-Endpunkte und Tokens
sidebar_label: Auth-Endpunkte
description: Die Authentifizierungs-Routen, die das Rebase-Backend bereitstellt, ihre Antwortstrukturen, Multi-Faktor-Authentifizierung, der Datenbankkontext für Richtlinien, JWKS und Service-Schlüssel.
---

Die Routen, die [der `auth`-Block](/docs/backend/authentication/) einbindet, und die Tokens, die sie zurückgeben.

## Auth-Endpunkte

Alle Auth-Endpunkte sind unter `/api/auth/` eingebunden:

| Methode | Pfad | Beschreibung |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Neues Konto erstellen |
| `POST` | `/api/auth/login` | Anmelden mit E-Mail/Passwort |
| `POST` | `/api/auth/refresh` | Access-Token aktualisieren |
| `POST` | `/api/auth/<provider>` | OAuth-Anmeldung (z. B. `/api/auth/google`, `/api/auth/linkedin`) |
| `POST` | `/api/auth/link/<provider>` | OAuth-Anbieter mit dem authentifizierten Konto verknüpfen |
| `POST` | `/api/auth/logout` | Refresh-Token widerrufen |
| `POST` | `/api/auth/forgot-password` | E-Mail zum Zurücksetzen des Passworts senden |
| `POST` | `/api/auth/reset-password` | Passwort mit Token zurücksetzen |
| `POST` | `/api/auth/find-user` | E-Mail-Adresse zu einem minimalen öffentlichen Profil auflösen (Opt-in — `AUTH_ALLOW_USER_LOOKUP`) |
| `POST` | `/api/auth/change-password` | Eigenes Passwort des Aufrufers ändern (authentifiziert) |
| `GET` | `/api/auth/me` | Eigenes Profil des Aufrufers |
| `PATCH` | `/api/auth/me` | Eigenes Profil des Aufrufers aktualisieren |
| `GET` | `/api/auth/config` | Was dieses Backend einem Anmeldebildschirm anbietet – `needsSetup`, `registrationEnabled`, `passwordReset`, `emailVerification`, `magicLink`, `anonymousLogin`, `adminPasswordReset`, `enabledProviders`. Unauthentifiziert und basierend auf denselben Prädikaten berechnet, die die Routen erzwingen, sodass das, was der Bildschirm anzeigt, nicht von den tatsächlichen Möglichkeiten abweichen kann |
| `POST` | `/api/auth/send-verification` | Dem Aufrufer einen Link zur E-Mail-Verifizierung senden |
| `GET` | `/api/auth/verify-email` | Verifizierungslink einlösen (die URL in dieser E-Mail) |
| `POST` | `/api/auth/magic-link` | Einmaligen Anmeldelink per E-Mail senden. `503 EMAIL_NOT_CONFIGURED` ohne SMTP |
| `POST` | `/api/auth/magic-link/verify` | Magic-Link-Token gegen eine Sitzung eintauschen |
| `POST` | `/api/auth/otp` | Sechsstelligen Anmeldecode per E-Mail senden. Antwortet unabhängig davon gleich, ob für die Adresse ein Konto existiert |
| `POST` | `/api/auth/otp/verify` | `{ email, code }` gegen eine Sitzung eintauschen |
| `POST` | `/api/auth/anonymous` | Anonyme Sitzung erstellen (Opt-in — `ALLOW_ANONYMOUS`) |
| `POST` | `/api/auth/anonymous/link` | Reale Anmeldedaten mit dem bereits angemeldeten anonymen Konto verknüpfen |
| `GET` | `/api/auth/sessions` | Aktive Sitzungen (Refresh-Tokens) des Aufrufers auflisten |
| `DELETE` | `/api/auth/sessions` | Jede Sitzung widerrufen, einschließlich dieser – Remote-Abmeldung auf jedem Gerät |
| `DELETE` | `/api/auth/sessions/:id` | Eine Sitzung widerrufen |
| `GET` | `/.well-known/jwks.json` | Das öffentliche JWKS – am Root eingebunden, nicht unter `basePath`, da ein Verifizierer dort sucht. Vorhanden, wenn [asymmetrische Signierung](#asymmetric-tokens-and-jwks) konfiguriert ist |
| `POST` | `/api/auth/mfa/enroll` | TOTP-Registrierung starten (gibt das Secret und Wiederherstellungscodes zurück) |
| `POST` | `/api/auth/mfa/verify` | Registrierung mit einem Code aus dem Authentifikator bestätigen |
| `GET` | `/api/auth/mfa/factors` | Registrierte Faktoren des Aufrufers auflisten |
| `POST` | `/api/auth/mfa/challenge` | Challenge für einen verifizierten Faktor eröffnen |
| `POST` | `/api/auth/mfa/challenge/verify` | Challenge beantworten – dies stellt die Sitzung aus |
| `DELETE` | `/api/auth/mfa/unenroll` | Faktor entfernen (erfordert eine `aal2`-Sitzung) |

Die administrative Benutzer- und Rollenverwaltung ist eine **separate Schnittstelle**, die unter `/api/admin/` statt `/api/auth/` eingebunden ist und die `admin`-Rolle oder den Service-Schlüssel erfordert:

| Methode | Pfad | Beschreibung |
|--------|------|-------------|
| `GET` | `/api/admin/users` | Benutzer auflisten (paginiert) |
| `POST` | `/api/admin/users` | Benutzer erstellen |
| `GET` | `/api/admin/users/:uid` | Einzelnen Benutzer abrufen |
| `PUT` | `/api/admin/users/:uid` | Einzelnen Benutzer aktualisieren |
| `DELETE` | `/api/admin/users/:uid` | Einzelnen Benutzer löschen |
| `POST` | `/api/admin/users/:uid/reset-password` | Passwort eines Benutzers ohne dessen aktuelles Passwort zurücksetzen |
| `GET` | `/api/admin/roles` | Rollen auflisten, die diesem Backend bekannt sind |
| `POST` | `/api/admin/bootstrap` | Dem am frühesten registrierten Benutzer erlauben, die Administratorrolle zu beanspruchen, solange keine existiert. In der Produktion abgelehnt – siehe [First User Bootstrap](/docs/backend/authentication/#first-user-bootstrap) |

Alle Daten-API-Endpunkte erfordern einen gültigen `Authorization: Bearer <token>`-Header, wenn `requireAuth: true` gesetzt ist (Standardeinstellung).

### Antwortformat

Jeder Endpunkt, der eine Sitzung ausstellt, antwortet mit demselben Envelope – `register`,
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
`accessTokenExpiresAt` sind Millisekunden seit der Unix-Epoche.

`POST /api/auth/refresh` antwortet mit demselben Envelope, mit zwei Besonderheiten: `user`
wird vollständig weggelassen, wenn das Konto nicht erneut gelesen werden kann, behandeln Sie es dort
also als optional; und `providerId` ist immer `password`, unabhängig davon, wie die Sitzung
ursprünglich erstellt wurde.

:::caution[Das Client-SDK flacht diesen Envelope ab – reines HTTP nicht]
Das obige JSON ist das Übertragungsformat (Wire Format) und entspricht dem, was `fetch("/api/auth/login")`
zurückgibt: Das Token befindet sich unter **`body.tokens.accessToken`**.

Das [Client-SDK](/docs/sdk/authentication) entpackt `tokens`, bevor es die
Sitzung zurückgibt, sodass `auth.signInWithEmail()` stattdessen zu einem abgeflachten
**`{ user, accessToken, refreshToken }`** aufgelöst wird.

Beide Strukturen sind real; sie gehören zu zwei verschiedenen Schichten. Das Lesen der SDK-Struktur
aus einem einfachen `fetch` ergibt `undefined`, was sich als „Anmeldung erfolgreich, aber kein
Access-Token vorhanden“ bemerkbar macht – die Anmeldung war in Ordnung, das Token befand sich lediglich eine Ebene tiefer.
:::

Wenn [`cookieAuth`](/docs/backend/authentication/#refresh-tokens-in-an-httponly-cookie) aktiviert ist, wird das
Refresh-Token als `httpOnly`-Cookie übertragen und `tokens.refreshToken` ist eine leere
Zeichenkette im Body. Das Access-Token ist davon unberührt.

### Multi-Faktor-Authentifizierung (TOTP)

**Ein zweiter Faktor sichert die Anmeldung ab, nicht nur einzelne Operationen.** Sobald ein
Konto über einen *verifizierten* TOTP-Faktor verfügt, stellt keine Route eine Sitzung aus, bis ein
Code vorgelegt wird – Passwort-Anmeldung, jeder OAuth-Anbieter, Magic-Link und
Anonymous-Link verweigern alle den Zugriff mit `401 MFA_REQUIRED`:

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

`mfaToken` ist **keine Sitzung**: Es ist zweckgebunden, läuft nach fünf Minuten ab
und wird von jeder authentifizierten Route abgewiesen. Senden Sie es als Bearer-Token an
`POST /api/auth/mfa/challenge` (mit einer `factorId`) und anschließend an
`POST /api/auth/mfa/challenge/verify` (mit der `challengeId` und dem sechsstelligen
Code oder einem Wiederherstellungscode). Dieser letzte Aufruf erzeugt die Access- und Refresh-Tokens
mit Stufe `aal2`; die Stufe wird in der Sitzung gespeichert und über
`POST /api/auth/refresh` beibehalten.

Die Registrierung ist ebenfalls geschützt. Der erste Faktor eines Kontos kann aus einer
gewöhnlichen Sitzung heraus registriert werden. Sobald jedoch einer verifiziert ist, erfordern `enroll`,
`verify` und `unenroll` allesamt eine `aal2`-Sitzung – andernfalls könnte ein gestohlenes
Passwort einen eigenen Faktor registrieren, die Rechte erweitern und den echten Faktor löschen.

Die Verifizierung ist in zweierlei Hinsicht begrenzt: Eine Challenge verfällt nach fünf Fehlversuchen,
jedes Konto ist auf zehn Verifizierungsversuche pro 15 Minuten beschränkt
(gezählt pro Benutzer, IP-Rotation hilft also nicht), und ein akzeptierter Code wird
für den Faktor vermerkt, sodass er für den Rest seines Zeitfensters von
±1 Schritt nicht erneut verwendet werden kann.

Setzen Sie `MFA_ENCRYPTION_KEY` (mindestens 32 Zufallszeichen), um gespeicherte TOTP-Secrets
zu verschlüsseln. Ohne diesen Schlüssel greift der Server auf `JWT_SECRET` zurück und gibt eine Warnung aus. Setzen Sie ihn,
**bevor** sich jemand registriert: Gespeicherte Secrets enthalten keine Schlüssel-ID, sodass eine nachträgliche Änderung des
Schlüssels bestehende Faktoren unentschlüsselbar macht und deren Besitzer keine
Challenge mehr abschließen können.

### Teammitglieder per E-Mail einladen

Einladungsabläufe müssen eine E-Mail-Adresse in eine Benutzer-ID umwandeln, doch die `users`-Collection
ist clientseitig durch RLS geschützt. Anstatt eine eigene Admin-Serverfunktion
zu schreiben, aktivieren Sie die integrierte Suche:

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

Der Endpunkt ist **ausschließlich authentifiziert zugänglich** und gibt nur `uid`, `displayName`
und `photoURL` zurück – niemals die E-Mail-Adresse, Rollen oder Metadaten des gesuchten Benutzers. Er
ist **standardmäßig deaktiviert**, da er es jedem angemeldeten Benutzer ermöglicht zu prüfen, für welche E-Mail-Adressen
Konten existieren; aktivieren Sie ihn nur, wenn Ihre Einladungs-UX dies erfordert.

## Datenbankkontext für Row-Level Security (RLS)

Rebase leitet die Authentifizierung von Anfragen direkt an die PostgreSQL Row-Level Security (RLS) weiter. Jede Datenbankabfrage, die über einen benutzerspezifischen Treiber ausgeführt wird, läuft innerhalb einer Datenbanktransaktion (`db.transaction()`), die transaktionslokale Konfigurationsparameter setzt:

*   `app.user_id` — Die eindeutige ID des authentifizierten Benutzers (`uid`). Standardmäßig `'anon'` für unauthentifizierte Anfragen.
*   `app.user_roles` — Ein kommagetrennter String, der die zugewiesenen Rollen des Benutzers auflistet.
*   `app.jwt` — Ein JSON-String, der die vollständige JWT-Claims-Payload enthält (`{"sub": "<uid>", "roles": [...]}`).

Diese Parameter werden lokal für die Dauer der Transaktion mithilfe der Postgres-Funktion `set_config` konfiguriert:
```sql
SELECT 
    set_config('app.user_id', $1, true),
    set_config('app.user_roles', $2, true),
    set_config('app.jwt', $3, true);
```

### PostgreSQL-Policy-Hilfsfunktionen

Um das Schreiben von Row-Level-Security-Policies zu vereinfachen, erstellt Rebase beim Bootstrapping der Datenbank Hilfsfunktionen unter dem `auth`-Schema:

*   **`rebase.uid()`** — Gibt die ID des authentifizierten Benutzers als `text` zurück oder `NULL`, falls nicht gesetzt:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.uid() RETURNS text AS $$
        SELECT NULLIF(current_setting('app.user_id', true), '');
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

Sie können diese Helfer direkt in Ihren benutzerdefinierten Sicherheitsregeln oder Datenbankmigrationen verwenden:
```sql
CREATE POLICY owner_access ON posts
    FOR ALL
    TO public
    USING (author_id = rebase.uid() OR string_to_array(rebase.roles(), ',') && ARRAY['admin']);
```

## Asymmetrische Tokens und JWKS

Standardmäßig werden Access-Tokens mit `jwtSecret` (HS256) signiert. Das funktioniert, aber es
bedeutet, dass jede Instanz, die ein Token *verifizieren* muss, auch den Schlüssel besitzen muss, der es
*erstellt* – ein Gateway oder ein Edge-Worker, der eine Sitzung prüft, kann somit auch Tokens fälschen –, und
eine Änderung des Secrets meldet alle Benutzer auf einmal ab.

Konfigurieren Sie einen Signaturschlüssel, signiert Rebase Access-Tokens stattdessen asymmetrisch
und veröffentlicht den öffentlichen Teil unter **`/.well-known/jwks.json`**, damit ihn jeder zur Verifizierung
nutzen kann:

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

RSA-Schlüssel funktionieren ebenfalls und signieren mit `RS256`; EC P-256-Schlüssel signieren mit `ES256`. Es wird nur der
private Schlüssel konfiguriert – der öffentliche Teil wird daraus abgeleitet, sodass das Paar nicht fehlerhaft
zugeordnet werden kann. `jwtSecret` bleibt in jedem Fall erforderlich: Es signiert weiterhin die
zweckgebundenen Tokens (Download-Links, ausstehende MFA, Passwort-Zurücksetzung), die ausschließlich
von diesem Server gelesen werden.

### Schlüssel rotieren

Fügen Sie den neuen Schlüssel an erster Stelle ein und behalten Sie den alten in der Liste. Neue Tokens werden mit dem
neuen Schlüssel signiert; bereits im Umlauf befindliche Tokens werden weiterhin anhand des alten Schlüssels verifiziert, bis
sie ablaufen, sodass niemand abgemeldet wird.

```typescript no-verify
signingKeys: [
    { kid: "2026-09", privateKey: process.env.JWT_PRIVATE_KEY_NEW! },
    { kid: "2026-08", privateKey: process.env.JWT_PRIVATE_KEY_OLD! }
]
```

Sobald die längste Lebensdauer eines Access-Tokens verstrichen ist, entfernen Sie den alten Eintrag. Verwenden Sie
`activeKid`, wenn Sie einen Schlüssel veröffentlichen möchten, bevor Sie ihn zum Signieren einsetzen.

### Verifizierung an anderer Stelle

Tokens tragen die `kid` des Signaturschlüssels in ihrem Header. Dadurch wählt ein Verifizierer
den passenden Schlüssel aus dem JWKS aus und erkennt, wann nach einer Rotation ein
erneuter Abruf erforderlich ist. Jede Standardbibliothek übernimmt dies für Sie – zum Beispiel mit `jose`:

```typescript no-verify
import { createRemoteJWKSet, jwtVerify } from "jose";

const jwks = createRemoteJWKSet(new URL("https://api.example.com/.well-known/jwks.json"));
const { payload } = await jwtVerify(token, jwks);
```

:::note
Wenn keine `signingKeys` konfiguriert sind, antwortet `/.well-known/jwks.json`
mit `{"keys":[]}` und die Tokens bleiben bei HS256. Es ändert sich nichts, bis Sie einen Schlüssel hinzufügen.
:::

## Service-Schlüssel-Authentifizierung

Konfigurieren Sie für die Server-zu-Server-Kommunikation (z. B. Cronjobs, externe Dienste) einen statischen Service-Schlüssel:

```typescript
auth: {
    serviceKey: process.env.REBASE_SERVICE_KEY,
    // ...
}
```

Clients authentifizieren sich mit dem Header `Authorization: Bearer <service-key>`. 

### Interner Boot-Schlüssel

Wenn `REBASE_SERVICE_KEY` in Ihrer Konfiguration nicht angegeben ist, generiert Rebase automatisch einen zufälligen **internen Boot-Schlüssel** (Per-Boot-Key). 

Dieser Schlüssel wird niemals protokolliert und verlässt den Prozess zu keinem Zeitpunkt. Er wird vom `rebase`-Singleton verwendet, um sich gegenüber den eigenen Control-Plane-APIs des Servers (Auth, Storage usw.) zu authentifizieren. Dadurch wird sichergestellt, dass administrative Aufgaben (wie das Versenden einer Willkommens-E-Mail oder das Generieren einer Storage-URL) in der Entwicklung und Produktion stets ohne manuelle Schlüsselverwaltung sofort funktionieren.

### Schutz vor Timing-Angriffen und Schlüsselanforderungen

Um Timing-Angriffe zu verhindern, validiert Rebase sowohl den vom Benutzer konfigurierten Service-Schlüssel als auch den internen Schlüssel mittels eines zeitkonstanten String-Vergleichs (`safeCompare`). Der benutzerdefinierte Service-Schlüssel **muss mindestens 32 Zeichen lang sein**; wird ein Schlüssel mit weniger als 32 Zeichen konfiguriert, wirft Rebase beim Start einen Konfigurationsfehler und schlägt fehl (Fail-Closed).

## Nächste Schritte

- **[Authentifizierung](/docs/backend/authentication/)** — die Konfiguration, aus der diese Routen stammen
- **[Benutzerdefinierte Auth-Adapter](/docs/backend/auth-adapters/)** — Ersetzen des zugrunde liegenden Anbieters
- **[Sicherheitsregeln (RLS)](/docs/collections/security-rules/)** — was eine Policy mit `rebase.uid()` macht
- **[Client-SDK-Authentifizierung](/docs/sdk/authentication/)** — Aufrufen dieser Routen über das SDK

---
