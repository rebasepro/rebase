---
sourceHash: 0e3ab3e17db74939
title: Authentification
sidebar_label: Authentification
description: Configurez l'authentification JWT, les fournisseurs OAuth, l'e-mail SMTP, les hooks d'authentification et les adaptateurs d'authentification personnalisés sur le backend.
---

## Vue d'ensemble

Rebase inclut un système d'authentification backend complet :

- **Tokens JWT** — Flux de token d'accès et de rafraîchissement avec expiration configurable
- **Fournisseurs OAuth** — Google, LinkedIn, GitHub, Microsoft, Apple et plus
- **E-mail SMTP** — Flux de réinitialisation de mot de passe et de vérification d'e-mail
- **Hooks d'authentification** — Hooks de cycle de vie pour la création d'utilisateurs et plus
- **Adaptateurs d'authentification personnalisés** — Branchez Firebase Auth, Auth0, Clerk ou tout fournisseur externe
- **Clé de service** — Clé statique pour l'authentification serveur à serveur
- **Auto-bootstrapping** — Le premier utilisateur obtient automatiquement le rôle admin

## Configuration

Le bloc `auth` dans `initializeRebaseBackend` contrôle toute l'authentification backend :

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

:::caution[Les callbacks de collection ne se déclenchent pas pour les utilisateurs d'authentification]
La création et les mises à jour d'utilisateurs via le système d'authentification — inscription, gestion
des utilisateurs par l'admin et OAuth — écrivent **directement** dans le magasin d'utilisateurs et contournent le
pipeline de sauvegarde de collection. Un callback `beforeSave`/`afterSave`/`beforeDelete`/`afterDelete`
sur la collection d'authentification (utilisateurs) ne s'exécutera **pas** pour ces chemins. Pour
les effets de bord comme le provisionnement d'une équipe personnelle à l'inscription, utilisez les hooks de cycle de vie
d'authentification (`afterUserCreate`, `beforeUserCreate`, `afterUserDelete`, …), qui
reçoivent l'enregistrement utilisateur entièrement rempli.
:::

### Fournisseurs OAuth

Chaque fournisseur OAuth est configuré avec au minimum un `clientId`. Certains fournisseurs nécessitent un `clientSecret` :

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

### Liaison de comptes entre méthodes de connexion

Que se passe-t-il lorsqu'une personne s'inscrit avec e-mail/mot de passe sous
`ada@example.com`, puis clique plus tard sur "Se connecter avec Google" avec
un compte Google portant cette même adresse ? Rebase **relie les deux en un
seul compte** — mais uniquement lorsque le fournisseur atteste que l'e-mail est
vérifié. Il ne crée jamais silencieusement un second compte pour la même
adresse.

Sur `POST /api/auth/<provider>`, l'ordre de résolution est le suivant :

1. **Identité de fournisseur déjà connue** — si cette identité exacte s'est déjà
   connectée auparavant, cet utilisateur est renvoyé. L'e-mail n'est pas
   consulté.
2. **Compte existant avec le même e-mail, vérifié par le fournisseur** —
   l'identité est rattachée au compte existant et l'utilisateur y est connecté.
   Un seul compte, deux façons d'y entrer.
3. **Compte existant avec le même e-mail, NON vérifié par le fournisseur** —
   rejet avec `403 EMAIL_NOT_VERIFIED`. Rien n'est créé ni modifié.
4. **Aucun compte avec cet e-mail** — un nouveau compte est créé.

L'étape 3 est le cas critique pour la sécurité. Si un e-mail non vérifié du
fournisseur suffisait à établir la liaison, quiconque parviendrait à faire
émettre par un fournisseur une adresse ne lui appartenant pas pourrait prendre
le contrôle du compte Rebase correspondant. Google atteste toujours
`email_verified` pour les vrais comptes Google : l'étape 2 est donc le chemin
normal de la connexion Google, tandis que l'étape 3 concerne surtout les
fournisseurs qui laissent l'utilisateur saisir une adresse arbitraire non
confirmée.

Ce comportement n'est pas configurable — il n'existe délibérément aucune option
permettant la liaison sur des e-mails non vérifiés.

Pour se remettre d'un rejet à l'étape 3, l'utilisateur se connecte avec sa
méthode existante et appelle l'endpoint de liaison explicite :

```http
POST /api/auth/link/google
Authorization: Bearer <access token>

{ "idToken": "..." }
```

La liaison effectuée en étant authentifié n'exige volontairement **pas**
d'e-mail vérifié, et n'exige pas non plus que les adresses correspondent —
l'adresse Google d'un utilisateur n'est souvent pas son adresse dans
l'application. Cette asymétrie est délibérée : lors de la connexion, l'e-mail du
fournisseur est la seule preuve rattachant l'identité entrante à un compte,
alors qu'ici l'appelant a déjà prouvé qu'il en est le propriétaire en détenant
une session valide. L'endpoint renvoie `409 IDENTITY_ALREADY_LINKED` si cette
identité de fournisseur appartient à un autre utilisateur, et il est idempotent
si elle est déjà liée à l'appelant.

#### Le sens inverse

Un utilisateur inscrit via Google et sans mot de passe :

- **S'inscrire avec le même e-mail** est refusé avec `409 EMAIL_EXISTS`.
- **`POST /api/auth/change-password`** renvoie `400 INVALID_ACCOUNT` — il
  n'existe aucun mot de passe permettant la vérification.
- **`forgot-password` → `reset-password` est la façon prise en charge d'en
  ajouter un.** Cette procédure prouve à nouveau par e-mail la propriété de
  l'adresse, après quoi le compte dispose des deux méthodes de connexion.

## Endpoints d'authentification

Tous les endpoints d'authentification sont montés sous `/api/auth/` :

| Méthode | Chemin | Description |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Créer un nouveau compte |
| `POST` | `/api/auth/login` | Se connecter avec e-mail/mot de passe |
| `POST` | `/api/auth/refresh` | Rafraîchir le token d'accès |
| `POST` | `/api/auth/<provider>` | Connexion OAuth (par ex. `/api/auth/google`, `/api/auth/linkedin`) |
| `POST` | `/api/auth/link/<provider>` | Lier un fournisseur OAuth au compte authentifié |
| `POST` | `/api/auth/logout` | Révoquer le refresh token |
| `POST` | `/api/auth/forgot-password` | Envoyer un e-mail de réinitialisation de mot de passe |
| `POST` | `/api/auth/reset-password` | Réinitialiser le mot de passe avec un token |
| `POST` | `/api/auth/find-user` | Résoudre un e-mail en un profil public minimal (opt-in) |

Tous les endpoints de l'API de données nécessitent un en-tête `Authorization: Bearer <token>` valide lorsque `requireAuth: true` (le défaut).

### Format de la réponse

Tous les endpoints qui émettent une session répondent avec la même enveloppe :
`register`, `login`, chaque fournisseur OAuth, `magic-link/verify`,
`otp/verify`, `anonymous`, `anonymous/link` et `mfa/challenge/verify`.

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

Renvoyez le token d'accès dans `Authorization: Bearer <accessToken>`.
`accessTokenExpiresAt` est exprimé en millisecondes depuis l'epoch.

`POST /api/auth/refresh` répond avec la même enveloppe, à deux réserves près :
`user` est entièrement omis lorsque le compte ne peut pas être relu — traitez-le
donc comme optionnel à cet endroit — et `providerId` vaut toujours `password`,
quelle que soit la méthode de création initiale de la session.

:::caution[Le SDK client aplatit cette enveloppe — pas le HTTP brut]
Le JSON ci-dessus est le format transmis sur le réseau, et c'est ce que renvoie
`fetch("/api/auth/login")` : le token se trouve dans
**`body.tokens.accessToken`**.

Le [SDK client](/docs/sdk/authentication) déballe `tokens` avant de vous rendre
la session, si bien que `auth.signInWithEmail()` résout un
**`{ user, accessToken, refreshToken }`** aplati.

Les deux formes sont réelles ; elles appartiennent à deux couches différentes.
Lire la forme du SDK depuis un `fetch` brut donne `undefined`, ce qui se
manifeste par « la connexion a réussi mais il n'y a pas de token d'accès » : la
connexion allait bien, le token était un niveau plus bas.
:::

Avec `cookieAuth` activé, le token de rafraîchissement voyage dans un cookie
`httpOnly` et `tokens.refreshToken` est une chaîne vide dans le corps. Le token
d'accès n'est pas affecté.

### Inviter des coéquipiers par e-mail

Les flux d'invitation doivent transformer une adresse e-mail en un ID utilisateur, mais la collection `users`
est protégée par RLS vis-à-vis du client. Au lieu de créer à la main une fonction serveur
admin, activez la recherche intégrée :

```typescript no-verify
await initializeRebaseBackend({
    auth: {
        // ...
        allowUserLookup: true,   // enables POST /api/auth/find-user
    },
});
```

Puis, depuis le client :

```typescript
const profile = await client.auth.findUserByEmail("teammate@example.com");
// → { uid, displayName, photoURL } | null   (never email/roles/metadata)
if (profile) {
    await client.data.team_members.create({ team_id, userId: profile.uid });
}
```

L'endpoint est **réservé aux utilisateurs authentifiés** et ne renvoie que `uid`, `displayName`
et `photoURL` — jamais l'e-mail, les rôles ou les métadonnées de l'utilisateur recherché. Il est
**désactivé par défaut** car il permet à tout utilisateur connecté de sonder quels e-mails ont
des comptes ; activez-le uniquement lorsque votre UX d'invitation en a besoin.

## Tables créées automatiquement

Au premier démarrage, Rebase provisionne automatiquement le schéma `auth` et les tables suivantes dans la base de données (liées au schéma défini dans votre collection, par ex. `rebase`) :

- **`rebase.users`** — Comptes utilisateurs avec e-mail, hash de mot de passe, métadonnées et une colonne `roles` text[] (les rôles sont stockés sous forme de tableaux de texte en ligne pour optimiser les requêtes et éviter les jointures).
- **`rebase.refresh_tokens`** — Sessions de longue durée portant des refresh tokens hachés, des user agents et des adresses IP. Inclut un index unique sur `token_hash` et une contrainte unique sur `(userId, user_agent, ip_address)` pour suivre les sessions d'appareils actives.
- **`rebase.password_reset_tokens`** — Tokens à usage unique expirables pour les flux de récupération de mot de passe.
- **`rebase.mfa_factors`** — Méthodes d'authentification multifacteur enregistrées (par ex. secrets TOTP chiffrés avec AES-256).
- **`rebase.mfa_challenges`** — Journaux de vérification suivant les tentatives de vérification MFA actives.
- **`rebase.recovery_codes`** — Codes de secours/récupération multifacteur hachés.
- **`rebase.app_config`** — Magasin clé-valeur pour les configurations système.

## Contexte de base de données de la sécurité au niveau des lignes (RLS)

Rebase relie l'authentification de la requête directement à la sécurité au niveau des lignes (RLS) de PostgreSQL. Chaque requête de base de données exécutée via un driver à portée utilisateur s'exécute dans une transaction de base de données (`db.transaction()`) qui configure des paramètres de configuration locaux à la transaction :

*   `app.userId` — L'ID unique (`uid`) de l'utilisateur authentifié. Par défaut `'anon'` pour les requêtes non authentifiées.
*   `app.user_roles` — Une chaîne séparée par des virgules listant les rôles attribués à l'utilisateur.
*   `app.jwt` — Une chaîne JSON contenant la charge utile complète des claims du JWT (`{"sub": "<uid>", "roles": [...]}`).

Ces paramètres sont configurés localement pour la durée de la transaction à l'aide de la fonction `set_config` de Postgres :
```sql
SELECT 
    set_config('app.userId', $1, true),
    set_config('app.user_roles', $2, true),
    set_config('app.jwt', $3, true);
```

### Fonctions d'aide pour les politiques PostgreSQL

Pour faciliter l'écriture des politiques de sécurité au niveau des lignes, Rebase crée des fonctions d'aide sous le schéma `auth` lors du bootstrapping de la base de données :

*   **`rebase.uid()`** — Renvoie l'ID de l'utilisateur authentifié en tant que `text`, ou `NULL` si non défini :
    ```sql
    CREATE OR REPLACE FUNCTION rebase.uid() RETURNS text AS $$
        SELECT NULLIF(current_setting('app.user_id', true), '');
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.roles()`** — Renvoie la chaîne de rôles séparée par des virgules :
    ```sql
    CREATE OR REPLACE FUNCTION rebase.roles() RETURNS text AS $$
        SELECT COALESCE(NULLIF(current_setting('app.user_roles', true), ''), '');
    $$ LANGUAGE sql STABLE;
    ```
*   **`rebase.jwt()`** — Renvoie la charge utile complète du JWT sous forme d'objet `jsonb` :
    ```sql
    CREATE OR REPLACE FUNCTION rebase.jwt() RETURNS jsonb AS $$
        SELECT COALESCE(NULLIF(current_setting('app.jwt', true), ''), '{}')::jsonb;
    $$ LANGUAGE sql STABLE;
    ```

Vous pouvez utiliser ces aides directement dans vos règles de sécurité personnalisées ou vos migrations de base de données :
```sql
CREATE POLICY owner_access ON posts
    FOR ALL
    TO public
    USING (author_id = rebase.uid() OR string_to_array(rebase.roles(), ',') && ARRAY['admin']);
```

## Bootstrap du premier utilisateur

Lorsqu'aucun utilisateur n'existe dans la base de données, la première personne à s'inscrire devient automatiquement admin. Après cela, l'inscription est contrôlée par le paramètre `allowRegistration`.

Cela garantit que vous pouvez toujours amorcer un nouveau déploiement sans avoir à seeder la base de données manuellement. Pour éviter les exécutions concurrentes et les conditions de course de génération de schéma lors du rechargement à chaud (HMR) ou du démarrage, les opérations de bootstrapping sont synchronisées à l'aide d'un verrou consultatif Postgres :
```sql
SELECT pg_advisory_xact_lock(hashtext('rebase_auth_functions_init'));
```

## Configuration d'authentification au niveau de la collection

Au lieu de vous appuyer uniquement sur les règles d'authentification par défaut de la base de données, vous pouvez marquer n'importe quelle collection Postgres (comme `users.ts` ou une collection personnalisée `members.ts`) comme la collection d'authentification. Ceci est configuré via la propriété `auth` sur la collection elle-même :

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

Lorsque les hooks personnalisés (`onCreateUser`, `onResetPassword`) sont appelés, ils reçoivent une façade `AuthCollectionContext` contenant :
- `hashPassword(password: string): Promise<string>` — Hache le mot de passe à l'aide de l'algorithme de hachage configuré (par ex. scrypt).
- `sendEmail?: (options) => Promise<void>` — Envoie un e-mail (disponible uniquement lorsque le service d'e-mail est configuré).
- `emailConfigured: boolean` — Si le service d'e-mail est configuré.
- `appName: string` — Le nom de l'application issu de la configuration e-mail.
- `resetPasswordUrl: string` — L'URL de base du lien de réinitialisation de mot de passe.

## Authentification par clé de service

Pour la communication serveur à serveur (par ex. tâches cron, services externes), configurez une clé de service statique :

```typescript
auth: {
    serviceKey: process.env.REBASE_SERVICE_KEY,
    // ...
}
```

Les clients s'authentifient avec l'en-tête `Authorization: Bearer <service-key>`. 

### Clé interne par démarrage

Si `REBASE_SERVICE_KEY` n'est pas fourni dans votre configuration, Rebase génère automatiquement une **clé interne par démarrage** aléatoire. 

Cette clé n'est jamais journalisée et ne quitte jamais le processus. Elle est utilisée par le singleton `rebase` pour s'authentifier auprès des propres API du plan de contrôle du serveur (auth, storage, etc.). Cela garantit que les tâches administratives (comme l'envoi d'un e-mail de bienvenue ou la génération d'une URL de stockage) fonctionnent toujours d'emblée en développement et en production sans nécessiter de gestion manuelle des clés.

### Protection contre les attaques temporelles & exigences de la clé

Pour prévenir les attaques temporelles, Rebase valide à la fois la clé de service configurée par l'utilisateur et la clé interne à l'aide d'une comparaison de chaînes à temps constant (`safeCompare`). La clé de service configurée par l'utilisateur **doit comporter au moins 32 caractères** ; si une clé de moins de 32 caractères est configurée, Rebase lèvera une erreur de configuration au démarrage et échouera en mode fermé (fail-closed).


## Adaptateurs d'authentification personnalisés

Rebase permet le remplacement complet du système d'authentification intégré via une architecture d'authentification enfichable. Cela découple la vérification de l'authentification des couches base de données et REST/WebSocket, permettant une intégration transparente avec des fournisseurs externes tels que **Clerk**, **Auth0**, **Firebase Auth** ou des services d'identité JWT personnalisés.

### Le contrat AuthAdapter

Vous pouvez implémenter directement l'interface `AuthAdapter` pour un contrôle complet. La définition de l'interface est la suivante :

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

### La charge utile de l'utilisateur authentifié

Quel que soit le fournisseur d'authentification externe choisi, votre adaptateur doit résoudre les vérifications de token réussies en un objet `AuthenticatedUser` uniforme. Le Rebase RLS Scope Injector mappe ces valeurs directement aux variables de session PostgreSQL à l'intérieur des transactions :

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

### Intégration rapide via `createCustomAuthAdapter`

Pour les scénarios standards (comme la validation de JWTs provenant d'un service tiers), vous pouvez utiliser l'utilitaire `createCustomAuthAdapter`. Cet utilitaire gère les valeurs par défaut des capabilities et implémente la validation de token WebSocket d'emblée en enveloppant votre implémentation de `verifyRequest`.

#### Exemple : intégration avec Clerk

Pour connecter un backend Rebase avec **Clerk**, vous pouvez vérifier les tokens JWT de Clerk à l'aide du JSON Web Key Set (JWKS) de Clerk :

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

#### Exemple : intégration avec Firebase Auth

Pour vérifier les tokens Firebase Auth à l'aide des certificats publics de Firebase :

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

### Monter les routes d'authentification et les actions de l'UI admin

Si votre fournisseur d'authentification personnalisé nécessite de monter des endpoints de redirection (comme des routes de callback OAuth ou des boucles de connexion SAML), implémentez la méthode `createAuthRoutes` sur votre adaptateur :

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

Si vous souhaitez autoriser les opérations CRUD sur les utilisateurs directement dans le Rebase Admin Dashboard, implémentez l'aide `userManagement` dans les options de l'adaptateur, qui fournit des hooks pour `listUsers`, `createUser`, `updateUser` et `deleteUser`.


## Étapes suivantes

- **[Authentification frontend](/docs/frontend/authentication)** — UI de connexion, contrôleur d'authentification, gestion des utilisateurs
- **[Règles de sécurité (RLS)](/docs/collections/security-rules)** — Contrôle d'accès au niveau des lignes
- **[Authentification du SDK client](/docs/sdk/authentication)** — Méthodes d'authentification dans le SDK client
