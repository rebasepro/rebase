---
sourceHash: 0e3ab3e17db74939
title: Authentifizierung
sidebar_label: Authentifizierung
description: Konfigurieren Sie JWT-Authentifizierung, OAuth-Anbieter, SMTP-E-Mail, Auth-Hooks und benutzerdefinierte Auth-Adapter im Backend.
---

## Überblick

Rebase enthält ein vollständiges Backend-Authentifizierungssystem:

- **JWT-Tokens** — Access- und Refresh-Token-Flow mit konfigurierbarer Ablaufzeit
- **OAuth-Anbieter** — Google, LinkedIn, GitHub, Microsoft, Apple und mehr
- **SMTP-E-Mail** — Flows für Passwort-Zurücksetzung und E-Mail-Verifizierung
- **Auth-Hooks** — Lifecycle-Hooks für die Benutzererstellung und mehr
- **Benutzerdefinierte Auth-Adapter** — Firebase Auth, Auth0, Clerk oder jeden externen Anbieter einbinden
- **Service-Key** — Statischer Schlüssel für Server-zu-Server-Authentifizierung
- **Auto-Bootstrapping** — Der erste Benutzer erhält automatisch die Admin-Rolle

## Konfiguration

Der `auth`-Block in `initializeRebaseBackend` steuert die gesamte Backend-Authentifizierung:

```typescript no-verify
const backend = await initializeRebaseBackend({
    // ...
    auth: {
        collection: usersCollection,         // Your users collection definition
        jwtSecret: env.JWT_SECRET,           // Required — signing secret
        accessExpiresIn: "1h",               // Access token lifetime (default: 1h)
        refreshExpiresIn: "30d",             // Refresh token lifetime (default: 30d)
        serviceKey: env.REBASE_SERVICE_KEY,  // Optional — for server-to-server calls
        allowRegistration: true,             // Allow new signups (default: false)

        // OAuth providers
        google: env.GOOGLE_CLIENT_ID
            ? { clientId: env.GOOGLE_CLIENT_ID }
            : undefined,

        // SMTP email (for password reset, email verification)
        email: env.SMTP_HOST
            ? {
                from: env.SMTP_FROM || `${env.APP_NAME} <noreply@example.com>`,
                smtp: {
                    host: env.SMTP_HOST,
                    port: env.SMTP_PORT,              // 587 for TLS, 465 for SSL
                    secure: env.SMTP_SECURE,           // true for port 465
                    auth: env.SMTP_USER
                        ? { user: env.SMTP_USER, pass: env.SMTP_PASS! }
                        : undefined,
                    name: env.SMTP_NAME,               // Optional EHLO/HELO hostname
                },
                appName: env.APP_NAME,
                resetPasswordUrl: env.FRONTEND_URL,    // URL for password reset page
            }
            : undefined,

        // Lifecycle hooks
        hooks: {
            afterUserCreate: async (user) => {
                console.log(`New user registered: ${user.email}`);
            }
        }
    }
});
```

:::caution[Collection-Callbacks werden für Auth-Benutzer nicht ausgelöst]
Benutzererstellung und -aktualisierungen über das Auth-System — Registrierung, Admin-
Benutzerverwaltung und OAuth — schreiben **direkt** in den User-Store und umgehen die
Collection-Save-Pipeline. Ein `beforeSave`/`afterSave`/`beforeDelete`/`afterDelete`-
Callback auf der Auth-Collection (Benutzer) wird für diese Pfade **nicht** ausgeführt. Für
Seiteneffekte wie das Bereitstellen eines persönlichen Teams bei der Registrierung verwenden Sie die Auth-Lifecycle-
Hooks (`afterUserCreate`, `beforeUserCreate`, `afterUserDelete`, …), die
den vollständig befüllten Benutzerdatensatz erhalten.
:::

### OAuth-Anbieter

Jeder OAuth-Anbieter wird mit mindestens einer `clientId` konfiguriert. Einige Anbieter erfordern ein `clientSecret`:

```typescript
auth: {
    google:    { clientId: "..." },
    linkedin:  { clientId: "...", clientSecret: "..." },
    github:    { clientId: "...", clientSecret: "..." },
    microsoft: { clientId: "...", clientSecret: "...", tenantId: "..." },
    apple:     { clientId: "...", teamId: "...", keyId: "...", privateKey: "..." },
    facebook:  { clientId: "...", clientSecret: "..." },
    twitter:   { clientId: "...", clientSecret: "..." },
    discord:   { clientId: "...", clientSecret: "..." },
    gitlab:    { clientId: "...", clientSecret: "..." },
    bitbucket: { clientId: "...", clientSecret: "..." },
    slack:     { clientId: "...", clientSecret: "..." },
    spotify:   { clientId: "...", clientSecret: "..." },
}
```

### Kontoverknüpfung über Anmeldemethoden hinweg

Was passiert, wenn sich jemand mit E-Mail/Passwort als `ada@example.com`
registriert und später "Mit Google anmelden" mit einem Google-Konto derselben
Adresse anklickt? Rebase **verknüpft beide zu einem Konto** — aber nur dann,
wenn der Anbieter die E-Mail-Adresse als verifiziert bestätigt. Es wird niemals
stillschweigend ein zweites Konto für dieselbe Adresse angelegt.

Bei `POST /api/auth/<provider>` gilt folgende Auflösungsreihenfolge:

1. **Bereits bekannte Anbieter-Identität** — hat sich genau diese
   Anbieter-Identität schon einmal angemeldet, wird dieser Benutzer
   zurückgegeben. Die E-Mail-Adresse wird nicht herangezogen.
2. **Bestehendes Konto mit derselben E-Mail-Adresse, vom Anbieter verifiziert**
   — die Identität wird dem bestehenden Konto zugeordnet und der Benutzer wird
   darin angemeldet. Ein Konto, zwei Zugangswege.
3. **Bestehendes Konto mit derselben E-Mail-Adresse, vom Anbieter NICHT
   verifiziert** — abgelehnt mit `403 EMAIL_NOT_VERIFIED`. Es wird nichts
   erstellt und nichts geändert.
4. **Kein Konto mit dieser E-Mail-Adresse** — ein neues Konto wird erstellt.

Schritt 3 ist der sicherheitskritische Fall. Würde eine unverifizierte
Anbieter-E-Mail zum Verknüpfen genügen, könnte jeder, der einen Anbieter dazu
bringt, eine ihm nicht gehörende Adresse auszugeben, das passende
Rebase-Konto übernehmen. Google bestätigt für echte Google-Konten immer
`email_verified`, weshalb Schritt 2 der Normalfall bei der Google-Anmeldung ist;
Schritt 3 betrifft vor allem Anbieter, bei denen Benutzer eine beliebige,
unbestätigte Adresse angeben können.

Dieses Verhalten ist nicht konfigurierbar — es gibt bewusst keine Option, bei
unverifizierten E-Mail-Adressen zu verknüpfen.

Um eine Ablehnung aus Schritt 3 zu beheben, meldet sich der Benutzer mit seiner
bestehenden Methode an und ruft den expliziten Verknüpfungs-Endpunkt auf:

```http
POST /api/auth/link/google
Authorization: Bearer <access token>

{ "idToken": "..." }
```

Das Verknüpfen im angemeldeten Zustand erfordert bewusst **keine** verifizierte
E-Mail-Adresse und verlangt auch nicht, dass die Adressen übereinstimmen — die
Google-Adresse eines Benutzers ist oft nicht seine Adresse in der Anwendung. Die
Asymmetrie ist beabsichtigt: Bei der Anmeldung ist die E-Mail-Adresse des
Anbieters der einzige Beleg, der die eingehende Identität mit einem Konto
verbindet, während der Aufrufer hier den Besitz bereits durch eine gültige
Sitzung nachgewiesen hat. Der Endpunkt gibt `409 IDENTITY_ALREADY_LINKED`
zurück, wenn diese Anbieter-Identität einem anderen Benutzer gehört, und ist
idempotent, wenn sie bereits mit dem Aufrufer verknüpft ist.

#### Die umgekehrte Richtung

Ein Benutzer, der sich mit Google registriert hat und kein Passwort besitzt:

- **Eine Registrierung mit derselben E-Mail-Adresse** wird mit
  `409 EMAIL_EXISTS` abgelehnt.
- **`POST /api/auth/change-password`** gibt `400 INVALID_ACCOUNT` zurück — es
  existiert kein bisheriges Passwort, gegen das geprüft werden könnte.
- **`forgot-password` → `reset-password` ist der vorgesehene Weg, eines
  hinzuzufügen.** Damit wird der Besitz der Adresse erneut per E-Mail
  nachgewiesen; danach verfügt das Konto über beide Anmeldemethoden.

## Auth-Endpunkte

Alle Auth-Endpunkte sind unter `/api/auth/` eingebunden:

| Methode | Pfad | Beschreibung |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Ein neues Konto erstellen |
| `POST` | `/api/auth/login` | Mit E-Mail/Passwort anmelden |
| `POST` | `/api/auth/refresh` | Das Access-Token aktualisieren |
| `POST` | `/api/auth/<provider>` | OAuth-Anmeldung (z. B. `/api/auth/google`, `/api/auth/linkedin`) |
| `POST` | `/api/auth/link/<provider>` | Einen OAuth-Anbieter mit dem angemeldeten Konto verknüpfen |
| `POST` | `/api/auth/logout` | Refresh-Token widerrufen |
| `POST` | `/api/auth/forgot-password` | E-Mail zur Passwort-Zurücksetzung senden |
| `POST` | `/api/auth/reset-password` | Passwort mit Token zurücksetzen |
| `POST` | `/api/auth/find-user` | Eine E-Mail zu einem minimalen öffentlichen Profil auflösen (Opt-in) |

Alle Daten-API-Endpunkte erfordern einen gültigen `Authorization: Bearer <token>`-Header, wenn `requireAuth: true` (der Standard).

### Antwortformat

Jeder Endpunkt, der eine Sitzung ausstellt, antwortet mit derselben Hülle:
`register`, `login`, jeder OAuth-Anbieter, `magic-link/verify`, `otp/verify`,
`anonymous`, `anonymous/link` und `mfa/challenge/verify`.

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

Sende das Access-Token als `Authorization: Bearer <accessToken>` zurück.
`accessTokenExpiresAt` ist in Millisekunden seit der Epoche angegeben.

`POST /api/auth/refresh` antwortet mit derselben Hülle, mit zwei Einschränkungen:
`user` entfällt vollständig, wenn das Konto nicht erneut gelesen werden kann —
behandle es dort also als optional — und `providerId` ist immer `password`,
gleich womit die Sitzung ursprünglich erstellt wurde.

:::caution[Das Client-SDK flacht diese Hülle ab — rohes HTTP nicht]
Das JSON oben ist das Format auf der Leitung und das, was
`fetch("/api/auth/login")` zurückgibt: Das Token liegt unter
**`body.tokens.accessToken`**.

Das [Client-SDK](/docs/sdk/authentication) packt `tokens` aus, bevor es die
Sitzung zurückgibt, sodass `auth.signInWithEmail()` stattdessen ein abgeflachtes
**`{ user, accessToken, refreshToken }`** liefert.

Beide Formen sind echt; sie gehören zu zwei verschiedenen Schichten. Die
SDK-Form aus einem rohen `fetch` zu lesen ergibt `undefined`, was sich als
„Anmeldung erfolgreich, aber kein Access-Token“ zeigt: Die Anmeldung war in
Ordnung, das Token lag eine Ebene tiefer.
:::

Mit aktiviertem `cookieAuth` reist das Refresh-Token als `httpOnly`-Cookie und
`tokens.refreshToken` ist im Body eine leere Zeichenkette. Das Access-Token ist
davon nicht betroffen.

### Teamkollegen per E-Mail einladen

Einladungs-Flows müssen eine E-Mail-Adresse in eine Benutzer-ID umwandeln, aber die `users`-
Collection ist gegenüber dem Client RLS-geschützt. Anstatt eine Admin-Server-Funktion von Hand
zu erstellen, aktivieren Sie die integrierte Suche:

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
    await client.data.team_members.create({ team_id, userId: profile.uid });
}
```

Der Endpunkt ist **nur für authentifizierte Benutzer** und gibt nur `uid`, `displayName`
und `photoURL` zurück — niemals die E-Mail, Rollen oder Metadaten des gesuchten Benutzers. Er ist
**standardmäßig deaktiviert**, da er jedem angemeldeten Benutzer erlaubt, zu prüfen, welche E-Mails
Konten haben; aktivieren Sie ihn nur, wenn Ihre Einladungs-UX ihn benötigt.

## Automatisch erstellte Tabellen

Beim ersten Start provisioniert Rebase automatisch das `auth`-Schema und die folgenden Tabellen in der Datenbank (an das in Ihrer Collection definierte Schema gebunden, z. B. `rebase`):

- **`rebase.users`** — Benutzerkonten mit E-Mail, Passwort-Hash, Metadaten und einer `roles` text[]-Spalte (Rollen werden als Inline-Text-Arrays gespeichert, um Abfragen zu optimieren und Joins zu vermeiden).
- **`rebase.refresh_tokens`** — Langlebige Sitzungen, die gehashte Refresh-Tokens, User-Agents und IP-Adressen tragen. Enthält einen eindeutigen Index auf `token_hash` und eine eindeutige Einschränkung auf `(userId, user_agent, ip_address)`, um aktive Gerätesitzungen zu verfolgen.
- **`rebase.password_reset_tokens`** — Ablaufbare Einmal-Tokens für Passwort-Wiederherstellungs-Flows.
- **`rebase.mfa_factors`** — Registrierte Multi-Faktor-Authentifizierungsmethoden (z. B. mit AES-256 verschlüsselte TOTP-Secrets).
- **`rebase.mfa_challenges`** — Verifizierungsprotokolle, die aktive MFA-Verifizierungsversuche verfolgen.
- **`rebase.recovery_codes`** — Gehashte Multi-Faktor-Backup-/Wiederherstellungscodes.
- **`rebase.app_config`** — Key-Value-Store für Systemkonfigurationen.

## Datenbankkontext der Row-Level Security (RLS)

Rebase überbrückt die Anfrage-Authentifizierung direkt bis hinunter zur PostgreSQL Row-Level Security (RLS). Jede Datenbankabfrage, die über einen benutzergebundenen Driver ausgeführt wird, läuft innerhalb einer Datenbanktransaktion (`db.transaction()`), die transaktionslokale Konfigurationsparameter setzt:

*   `app.userId` — Die eindeutige ID (`uid`) des authentifizierten Benutzers. Standardmäßig `'anon'` für nicht authentifizierte Anfragen.
*   `app.user_roles` — Eine kommagetrennte Zeichenkette, die die zugewiesenen Rollen des Benutzers auflistet.
*   `app.jwt` — Eine JSON-Zeichenkette, die die vollständige JWT-Claims-Payload enthält (`{"sub": "<uid>", "roles": [...]}`).

Diese Parameter werden für die Dauer der Transaktion lokal mit der `set_config`-Funktion von Postgres konfiguriert:
```sql
SELECT 
    set_config('app.userId', $1, true),
    set_config('app.user_roles', $2, true),
    set_config('app.jwt', $3, true);
```

### PostgreSQL-Richtlinien-Hilfsfunktionen

Um das Schreiben von Row-Level-Security-Richtlinien einfach zu machen, erstellt Rebase während des Datenbank-Bootstrappings Hilfsfunktionen unter dem `auth`-Schema:

*   **`rebase.uid()`** — Gibt die ID des authentifizierten Benutzers als `text` zurück oder `NULL`, wenn nicht gesetzt:
    ```sql
    CREATE OR REPLACE FUNCTION rebase.uid() RETURNS text AS $$
        SELECT NULLIF(current_setting('app.user_id', true), '');
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.roles()`** — Gibt die kommagetrennte Rollen-Zeichenkette zurück:
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

## Bootstrap des ersten Benutzers

Wenn keine Benutzer in der Datenbank existieren, wird die erste Person, die sich registriert, automatisch zum Admin. Danach wird die Registrierung durch die Einstellung `allowRegistration` gesteuert.

Dies stellt sicher, dass Sie eine neue Bereitstellung immer bootstrappen können, ohne die Datenbank manuell seeden zu müssen. Um gleichzeitige Läufe und Race Conditions bei der Schemagenerierung während des Hot Reloadings (HMR) oder des Starts zu verhindern, werden Bootstrapping-Operationen mit einem Postgres-Advisory-Lock synchronisiert:
```sql
SELECT pg_advisory_xact_lock(hashtext('rebase_auth_functions_init'));
```

## Auth-Konfiguration auf Collection-Ebene

Anstatt sich ausschließlich auf die Standard-Datenbank-Auth-Regeln zu verlassen, können Sie jede Postgres-Collection (wie `users.ts` oder eine benutzerdefinierte `members.ts`-Collection) als Authentifizierungs-Collection markieren. Dies wird über die `auth`-Property auf der Collection selbst konfiguriert:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const membersCollection = defineCollection({
  name: "Members",
  slug: "members",
  table: "members",
  auth: {
    enabled: true,
    
    // Customize what happens when an admin creates a user via the REST API
    onCreateUser: async (values, ctx) => {
      const hash = await ctx.hashPassword("welcome123");
      return {
        values: { ...values, passwordHash: hash, emailVerified: true },
        temporaryPassword: "welcome123"
      };
    },

    // Customize what happens when an admin resets a user's password in the admin panel
    onResetPassword: async (userId, ctx) => {
      const tempPassword = "reset_" + Math.random().toString(36).substring(2, 8);
      return {
        temporaryPassword: tempPassword,
        invitationSent: false
      };
    },

    // Inject/override auth-specific actions (e.g. show/hide the reset password button)
    actions: {
      resetPassword: true // Or false to disable, or a custom EntityAction
    }
  },
  properties: { ... }
});
```

Wenn die benutzerdefinierten Hooks (`onCreateUser`, `onResetPassword`) aufgerufen werden, erhalten sie eine `AuthCollectionContext`-Fassade, die Folgendes enthält:
- `hashPassword(password: string): Promise<string>` — Hasht das Passwort mit dem konfigurierten Hashing-Algorithmus (z. B. scrypt).
- `sendEmail?: (options) => Promise<void>` — Sendet eine E-Mail (nur verfügbar, wenn der E-Mail-Dienst konfiguriert ist).
- `emailConfigured: boolean` — Ob der E-Mail-Dienst konfiguriert ist.
- `appName: string` — Der App-Name aus der E-Mail-Konfiguration.
- `resetPasswordUrl: string` — Die Basis-URL des Passwort-Zurücksetzungs-Links.

## Service-Key-Authentifizierung

Für die Server-zu-Server-Kommunikation (z. B. Cron-Jobs, externe Dienste) konfigurieren Sie einen statischen Service-Key:

```typescript
auth: {
    serviceKey: process.env.REBASE_SERVICE_KEY,
    // ...
}
```

Clients authentifizieren sich mit dem Header `Authorization: Bearer <service-key>`. 

### Interner Per-Boot-Key

Wenn `REBASE_SERVICE_KEY` in Ihrer Konfiguration nicht angegeben ist, generiert Rebase automatisch einen zufälligen **internen Per-Boot-Key**. 

Dieser Schlüssel wird niemals geloggt und verlässt niemals den Prozess. Er wird vom `rebase`-Singleton verwendet, um sich gegenüber den eigenen Control-Plane-APIs des Servers (Auth, Storage usw.) zu authentifizieren. Dies stellt sicher, dass administrative Aufgaben (wie das Senden einer Willkommens-E-Mail oder das Generieren einer Storage-URL) in Entwicklung und Produktion immer sofort funktionieren, ohne dass eine manuelle Schlüsselverwaltung erforderlich ist.

### Timing-Angriffsschutz & Schlüsselanforderungen

Um Timing-Angriffe zu verhindern, validiert Rebase sowohl den vom Benutzer konfigurierten Service-Key als auch den internen Schlüssel mit einem Zeichenkettenvergleich in konstanter Zeit (`safeCompare`). Der vom Benutzer konfigurierte Service-Key **muss mindestens 32 Zeichen lang sein**; wird ein Schlüssel mit weniger als 32 Zeichen konfiguriert, wirft Rebase beim Start einen Konfigurationsfehler und schlägt fail-closed fehl.


## Benutzerdefinierte Auth-Adapter

Rebase ermöglicht den vollständigen Austausch des integrierten Authentifizierungssystems über eine steckbare Authentifizierungsarchitektur. Dies entkoppelt die Authentifizierungsprüfung von der Datenbank- und der REST-/WebSocket-Schicht und ermöglicht eine nahtlose Integration mit externen Anbietern wie **Clerk**, **Auth0**, **Firebase Auth** oder benutzerdefinierten JWT-Identitätsdiensten.

### Der AuthAdapter-Vertrag

Sie können die `AuthAdapter`-Schnittstelle direkt implementieren, um vollständige Kontrolle zu erhalten. Die Schnittstellendefinition lautet wie folgt:

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";
import { AuthenticatedUser, AuthAdapterCapabilities, UserManagementAdapter, UserCreationPrepareResult, UserCreationFinalizeResult } from "@rebasepro/types";

export interface AuthAdapter {
  /** Unique identifier for this auth adapter (e.g., "clerk", "custom") */
  readonly id: string;

  /**
   * Verifies an incoming HTTP request and returns the authenticated user payload.
   * Called by Hono authentication middleware on every REST endpoint.
   */
  verifyRequest(request: Request): Promise<AuthenticatedUser | null>;

  /**
   * Verifies a raw token string (e.g. for WebSocket connection handshake phase 1).
   * If omitted, a synthetic request is automatically constructed.
   */
  verifyToken?(token: string): Promise<AuthenticatedUser | null>;

  /** Optional user management operations (CRUD) for the Admin Dashboard panel */
  userManagement?: UserManagementAdapter;

  /** Optional: Mount adapter-specific custom public routes (e.g. callback paths) */
  createAuthRoutes?(): Hono<any, any, any> | undefined;

  /** Optional: Mount adapter-specific admin-only routes */
  createAdminRoutes?(): Hono<any, any, any> | undefined;

  /** Advertise supported capabilities (to customize Admin Dashboard UI visibility) */
  getCapabilities(): AuthAdapterCapabilities | Promise<AuthAdapterCapabilities>;

  /** Lifecycle hooks called during backend start and graceful shutdown */
  initialize?(): Promise<void>;
  destroy?(): Promise<void>;

  /** Custom user lifecycle hooks (e.g., hash passwords before collection writes) */
  prepareUserCreation?(
    values: Record<string, unknown>,
    collectionAuth?: unknown
  ): Promise<UserCreationPrepareResult>;

  finalizeUserCreation?(
    entity: { id: string; values: Record<string, unknown> },
    clearPassword?: string
  ): Promise<UserCreationFinalizeResult>;

  /** Static service key to bypass checks for server-to-server calls */
  serviceKey?: string;
}
```

### Die Payload des authentifizierten Benutzers

Unabhängig vom gewählten externen Authentifizierungsanbieter muss Ihr Adapter erfolgreiche Token-Verifizierungen zu einem einheitlichen `AuthenticatedUser`-Objekt auflösen. Der Rebase-RLS-Scope-Injector ordnet diese Werte innerhalb von Transaktionen direkt PostgreSQL-Sitzungsvariablen zu:

```typescript
export interface AuthenticatedUser {
  uid: string;                    // Maps to pg local 'app.userId' -> rebase.uid()
  email: string;                  // User email address
  displayName?: string | null;    // Optional display name
  photoUrl?: string | null;        // Optional avatar URL
  roles: string[];                // Maps to pg local 'app.user_roles' -> rebase.roles()
  isAdmin: boolean;               // Grants global superuser privileges if true
  rawToken?: string;              // The original token string (for downstream forwarding)
  claims?: Record<string, any>;   // Custom claims/metadata (available in rebase.jwt())
}
```

---

### Schnelle Integration über `createCustomAuthAdapter`

Für Standardszenarien (wie das Validieren von JWTs von einem Drittanbieterdienst) können Sie das Hilfsprogramm `createCustomAuthAdapter` verwenden. Dieses Hilfsprogramm übernimmt die Standardwerte für Capabilities und implementiert die WebSocket-Token-Validierung sofort, indem es Ihre `verifyRequest`-Implementierung umschließt.

#### Beispiel: Integration mit Clerk

Um ein Rebase-Backend mit **Clerk** zu verbinden, können Sie Clerk-JWT-Tokens mit dem JSON Web Key Set (JWKS) von Clerk verifizieren:

```typescript no-verify
import { initializeRebaseBackend } from "@rebasepro/server";
import { createCustomAuthAdapter } from "@rebasepro/server";
import { createRemoteJWKSet, jwtVerify } from "jose";

// Clerk JWKS URL
const CLERK_JWKS_URL = "https://clerk.your-domain.com/.well-known/jwks.json";
const JWKS = createRemoteJWKSet(new URL(CLERK_JWKS_URL));

const clerkAuthAdapter = createCustomAuthAdapter({
    serviceKey: process.env.REBASE_SERVICE_KEY,
    verifyRequest: async (request) => {
        const authHeader = request.headers.get("Authorization");
        const token = authHeader?.replace("Bearer ", "");
        if (!token) return null;

        try {
            // Verify Clerk JWT token against JWKS
            const { payload } = await jwtVerify(token, JWKS);
            
            const metadata = payload.metadata as Record<string, unknown> | undefined;
            const roles = Array.isArray(metadata?.roles) ? metadata.roles as string[] : [];
            
            return {
                uid: payload.sub!,
                email: (payload as Record<string, unknown>).email as string || "",
                displayName: (payload as Record<string, unknown>).name as string || null,
                roles: roles,
                isAdmin: roles.includes("admin"),
                claims: payload as Record<string, unknown>
            };
        } catch (error) {
            console.error("Clerk token verification failed:", error);
            return null; // Fail-closed
        }
    },
    capabilities: {
        hasBuiltInAuthRoutes: false, // Login is managed by Clerk UI
        emailPasswordLogin: false,
        registrationEnabled: false,
        passwordReset: false,
        profileUpdate: false,
        sessionManagement: false
    }
});

const backend = await initializeRebaseBackend({
    auth: clerkAuthAdapter,
    // ...
});
```

#### Beispiel: Integration mit Firebase Auth

Um Firebase-Auth-Tokens mit den öffentlichen Zertifikaten von Firebase zu verifizieren:

```typescript no-verify
import { initializeRebaseBackend } from "@rebasepro/server";
import { createCustomAuthAdapter } from "@rebasepro/server";
import { createRemoteJWKSet, jwtVerify } from "jose";

const FIREBASE_JWKS_URL = "https://www.googleapis.com/robot/v1/metadata/jwk/securetoken@system.gserviceaccount.com";
const JWKS = createRemoteJWKSet(new URL(FIREBASE_JWKS_URL));
const FIREBASE_PROJECT_ID = "my-firebase-project-id";

const firebaseAuthAdapter = createCustomAuthAdapter({
    serviceKey: process.env.REBASE_SERVICE_KEY,
    verifyRequest: async (request) => {
        const authHeader = request.headers.get("Authorization");
        const token = authHeader?.replace("Bearer ", "");
        if (!token) return null;

        try {
            const { payload } = await jwtVerify(token, JWKS, {
                issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
                audience: FIREBASE_PROJECT_ID
            });

            const roles = Array.isArray((payload as Record<string, unknown>).roles) ? (payload as Record<string, unknown>).roles as string[] : [];

            return {
                uid: payload.sub!,
                email: (payload as Record<string, unknown>).email as string || "",
                displayName: (payload as Record<string, unknown>).name as string || null,
                photoUrl: (payload as Record<string, unknown>).picture as string || null,
                roles: roles,
                isAdmin: roles.includes("admin"),
                claims: payload as Record<string, unknown>
            };
        } catch (error) {
            console.error("Firebase token verification failed:", error);
            return null;
        }
    }
});

const backend = await initializeRebaseBackend({
    auth: firebaseAuthAdapter,
    // ...
});
```

---

### Auth-Routen und Admin-UI-Aktionen einbinden

Wenn Ihr benutzerdefinierter Auth-Anbieter das Einbinden von Weiterleitungs-Endpunkten erfordert (wie OAuth-Callback-Routen oder SAML-Login-Schleifen), implementieren Sie die Methode `createAuthRoutes` auf Ihrem Adapter:

```typescript
const myOauthAdapter: AuthAdapter = {
    id: "custom-oauth",
    verifyRequest: async (req) => ({
        // validate the token, then return the caller
        uid: "…",
        email: "user@example.com",
        roles: [],
        isAdmin: false
    }),
    getCapabilities: () => ({
        hasBuiltInAuthRoutes: true,
        emailPasswordLogin: false,
        registrationEnabled: false,
        passwordReset: false,
        adminPasswordReset: false,
        sessionManagement: false,
        profileUpdate: false,
        emailVerification: false,
        magicLink: false,
        anonymousLogin: false,
        enabledProviders: []
    }),
    createAuthRoutes: () => {
        const app = new Hono<HonoEnv>();
        
        // Mounted automatically under /api/auth/callback
        app.get("/callback", async (c) => {
            const code = c.req.query("code");
            // Exchange code for provider tokens and set cookies/redirect
            return c.redirect("/dashboard");
        });
        
        return app;
    }
};
```

Wenn Sie CRUD-Operationen für Benutzer direkt im Rebase Admin Dashboard erlauben möchten, implementieren Sie den `userManagement`-Helfer innerhalb der Adapter-Optionen, der Hooks für `listUsers`, `createUser`, `updateUser` und `deleteUser` bereitstellt.


## Nächste Schritte

- **[Frontend-Authentifizierung](/docs/frontend/authentication)** — Login-UI, Auth-Controller, Benutzerverwaltung
- **[Sicherheitsregeln (RLS)](/docs/collections/security-rules)** — Zugriffssteuerung auf Zeilenebene
- **[Client-SDK-Authentifizierung](/docs/sdk/authentication)** — Auth-Methoden im Client-SDK
