---
sourceHash: 71a134ba2ec7ae97
title: Authentification
sidebar_label: Authentification
description: Configurez l'authentification JWT, les fournisseurs OAuth, les e-mails SMTP, la protection contre les bots et la table des utilisateurs sur le backend Rebase.
---

L'authentification s'étend sur trois pages, car elle comprend trois tâches distinctes. Celle-ci concerne la **configuration** : ce qui se trouve dans le bloc `auth` et dans l'environnement.

- [Points de terminaison et jetons](/docs/backend/auth-endpoints/) — les routes montées par le backend, la structure des réponses, le MFA, le contexte de base de données vu par une policy, les clés JWKS et de service.
- [Adaptateurs d'authentification personnalisés](/docs/backend/auth-adapters/) — remplacer le fournisseur intégré par Clerk, Firebase Auth ou votre propre solution.

## Vue d'ensemble

Rebase inclut un système d'authentification backend complet :

- **Jetons JWT** — Flux de jetons d'accès et d'actualisation avec expiration configurable
- **Fournisseurs OAuth** — Google, LinkedIn, GitHub, Microsoft, Apple, et plus encore
- **E-mail SMTP** — Flux de réinitialisation de mot de passe et de vérification d'e-mail
- **Hooks d'authentification** — Hooks de cycle de vie pour la création d'utilisateurs et plus encore
- **Adaptateurs d'authentification personnalisés** — Intégrez Firebase Auth, Auth0, Clerk ou tout fournisseur externe
- **Clé de service** — Clé statique pour l'authentification de serveur à serveur
- **Auto-bootstrapping** — Hors production, le premier utilisateur obtient automatiquement le rôle admin ; un déploiement en production désigne son administrateur avec `REBASE_ADMIN_EMAIL` / `REBASE_ADMIN_PASSWORD`

## Configuration

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

:::note[Où cela se configure]
**Runtime géré :** environnement — `JWT_SECRET`, `AUTH_*`, `SMTP_*`, `CAPTCHA_*` et les paires `*_CLIENT_ID` / `*_CLIENT_SECRET` des fournisseurs, une pour chacun des douze fournisseurs ([les syntaxes](#syntaxes-des-variables-denvironnement) ; celle d'Apple compte quatre clés, pas une paire). La table des utilisateurs est le [`defineAuthTable`](#la-table-des-utilisateurs) exporté depuis `backend/schema/index.ts`.
**Pas de route managée :** `auth.hooks`. Ce sont des fonctions ; éjectez pour les passer.
**Éjecté :** `initializeRebaseBackend({ auth })` dans `backend/src/index.ts`.
:::

Le bloc `auth` dans `initializeRebaseBackend` contrôle l'ensemble de l'authentification backend :

```typescript no-verify
const backend = await initializeRebaseBackend({
    // ...
    auth: {
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
                    timeoutMs: 30_000,                 // Connect, greeting and silence limit (the default)
                },
                appName: env.APP_NAME,
                logoUrl: env.EMAIL_LOGO_URL,           // Logo shown atop the default templates
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

### Le bloc `auth` au complet

| Clé | Type | Valeur par défaut | Description |
|-----|------|-------------------|-------------|
| `jwtSecret` | `string` | — | Clé secrète de signature HS256. Requise en production |
| `signingKeys` | `JwtSigningKeyConfig[]` | — | Clés de signature asymétriques — voir [Jetons asymétriques et JWKS](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) |
| `activeKid` | `string` | première clé | Laquelle des clés de `signingKeys` émet les nouveaux jetons |
| `accessExpiresIn` | `string` | `1h` | Durée de vie du jeton d'accès |
| `refreshExpiresIn` | `string` | `30d` | Durée de vie du jeton d'actualisation. Glissante : chaque rotation la renouvelle, c'est donc la durée pendant laquelle une session survit à l'**inactivité**. Le runtime transmet `JWT_REFRESH_EXPIRES_IN`, qui vaut également `30d` par défaut. Les navigateurs limitent le cookie d'actualisation à 400 jours, une valeur plus longue n'apporte donc rien en mode cookie |
| `refreshTokenReuseIntervalSeconds` | `number` | `10` | Durée pendant laquelle un jeton d'actualisation ayant subi une rotation peut encore émettre une session sœur, afin qu'un client ayant perdu la réponse d'actualisation ne soit pas déconnecté |
| `refreshTokenReuse` | `"reject" \| "revoke-session"` | `"reject"` | Ce que fait un jeton d'actualisation présenté après cette fenêtre. `"reject"` le refuse (`TOKEN_ALREADY_USED`) et le journalise, et la session subsiste : il ne s'agit pas d'une détection de réutilisation, puisque celui qui a actualisé en premier conserve la session. `"revoke-session"` met fin à toute la connexion lors d'un tel rejeu (`SESSION_REVOKED`), comme le fait GoTrue, et le propriétaire doit se reconnecter. `AUTH_REFRESH_TOKEN_REUSE` |
| `requireAuth` | `boolean` | `true` | Exiger une session pour l'API de données |
| `allowRegistration` | `boolean` | `false` | Ouvre `POST /api/auth/register`. Hors production, le premier utilisateur sur une table vide est admis dans les deux cas ; en production, l'administrateur est désigné avec `REBASE_ADMIN_EMAIL` |
| `disableSelfRegistration` | `boolean` | `false` | Coupe-circuit : ferme également la fenêtre de bootstrap du premier utilisateur que `allowRegistration: false` laisse ouverte |
| `allowAnonymous` | `boolean` | `false` | Active `POST /api/auth/anonymous`. Délibérément non conditionné par `allowRegistration` — une application publique principalement en lecture peut vouloir des sessions sans comptes. Transformer un invité en compte (`POST /api/auth/anonymous/link`) constitue une inscription et nécessite également `allowRegistration` — ainsi qu'`allowAnonymous` toujours actif : une fois désactivé, il refuse également les invités déjà connectés, de sorte qu'aucun ne peut devenir un compte (`403 ANONYMOUS_AUTH_DISABLED`) |
| `allowUserLookup` | `boolean` | `false` | Monte `POST /api/auth/find-user` pour les flux d'invitation par e-mail |
| `captcha` | `CaptchaConfig` | — | Protection anti-bot sur les routes qui envoient des e-mails — voir [Protection contre les bots](#protection-contre-les-bots) |
| `defaultRole` | `string` | — | Rôle attribué à un utilisateur nouvellement inscrit lorsqu'aucun n'est spécifié. Il ne peut s'agir de `admin`, ni d'un rôle déclaré détenant un scope du plan d'administration : le démarrage refuse les deux |
| `serviceKey` | `string` | — | Clé statique pour les appels de serveur à serveur — voir [Authentification par clé de service](/docs/backend/auth-endpoints/#service-key-authentication) |
| `email` | `EmailConfig` | — | SMTP, pour la réinitialisation de mot de passe, la vérification, les invitations et les liens magiques |
| `magicLink` | `boolean` | `false` | Active la connexion par e-mail sans mot de passe. Nécessite que `email` soit configuré ; sans cela, les routes répondent `503 EMAIL_NOT_CONFIGURED` |
| `emailOtp` | `boolean` | `false` | Active les codes de connexion à six chiffres par e-mail — voir [Codes à usage unique](#codes-à-usage-unique-par-e-mail). Même prérequis d'e-mail |
| `deviceLogin` | `{ verificationUrl: string }` | — | Permet à un terminal ou à un autre appareil sans navigateur de se connecter via un navigateur — voir [Connexion d'appareil](/docs/backend/device-sign-in/). Nécessite une base de données SQL |
| `magicLinkCreatesUsers` | `boolean` | `false` | Inscription sans mot de passe : une demande de lien magique ou de code par e-mail pour une adresse sans compte en crée un (sans mot de passe, non vérifié jusqu'à l'utilisation du lien ou du code), tant que `allowRegistration` est activé. Exécute `beforeUserCreate` et applique le rôle par défaut. Désactivé, ces requêtes ne créent rien et répondent à une adresse inconnue de la même manière qu'à une adresse connue. `AUTH_MAGIC_LINK_CREATES_USERS` |
| `requireEmailVerification` | `boolean` | `false` | Refuse la connexion par mot de passe tant que l'adresse n'est pas vérifiée, et procède à une inscription avec confirmation préalable — voir [Vérification d'e-mail](/docs/backend/email-verification/). Nécessite `email` ; le démarrage est refusé sans lui |
| `cookieAuth` | `CookieAuthConfig \| false` | activé | Délivre le jeton d'actualisation sous forme de cookie `httpOnly` `Secure` `SameSite` au lieu du corps JSON ; `false` le renvoie dans le corps — voir ci-dessous |
| `providers` | `OAuthProvider[]` | `[]` | Le tableau OAuth canonique ; les champs de fournisseurs nommés s'y résolvent |
| `allowedRedirectUris` | `string[]` | — | Restreint les URI de redirection acceptées par les routes OAuth |
| `hooks` | `AuthHooks` | — | `beforeUserCreate`, `afterUserCreate`, `afterUserDelete`, … |

#### Jetons d'actualisation dans un cookie `httpOnly`

```typescript no-verify
auth: { cookieAuth: { sameSite: "Lax" } }
```

Le jeton d'actualisation est l'identifiant à longue durée de vie, et dans le corps de la requête, toute faille XSS sur la page peut le lire. `cookieAuth` le conserve dans un cookie auquel les scripts de la page ne peuvent pas accéder : activé par défaut à moins que vous ne le désactiviez, toujours dans le runtime et depuis la version 0.30 dans `initializeRebaseBackend`. Le jeton **d'accès** reste dans le corps, pour l'en-tête `Authorization`. Une requête avec `x-rebase-auth-flow: json` reçoit le jeton d'actualisation dans le corps ; avec `cookieAuth: false`, chaque requête le reçoit, et un client navigateur nécessite `authFlowMode: "json"`.

Deux points doivent impérativement être respectés, sous peine de bloquer la connexion plutôt que de la dégrader : les appels `fetch` du client vers les points de terminaison d'authentification nécessitent `credentials: "include"`, et CORS doit autoriser les informations d'authentification (credentials) — ce qui implique une liste d'origines explicite, jamais `origin: "*"`. `AUTH_COOKIE_SAME_SITE` est la syntaxe d'environnement pour `sameSite`, et `AUTH_COOKIE_SECURE` pour `secure`.

Le cookie porte l'attribut `Secure` à moins que vous ne le désactiviez, et rien dans la requête ne peut modifier cela : lu depuis le protocole de la requête, qui est `http` derrière tout proxy de terminaison TLS, le jeton serait envoyé en clair. `AUTH_COOKIE_SECURE=false` est la seule issue pour un déploiement servi en HTTP brut (une adresse LAN, un boîtier matériel/appliance), et un avertissement est émis au démarrage. `http://localhost` n'en a pas besoin.

| Clé | Valeur par défaut | |
|-----|-------------------|--|
| `cookieName` | `__rb_refresh` | |
| `domain` | domaine actuel | |
| `path` | `/` | |
| `sameSite` | `Lax` | `None` s'applique uniquement à un frontend véritablement cross-site |
| `secure` | `true` | Sécurisé par défaut ; `AUTH_COOKIE_SECURE=false` pour le HTTP brut |

:::caution[Les hooks de table ne se déclenchent pas pour les utilisateurs d'authentification]
La création et les mises à jour d'utilisateurs via le système d'authentification — inscription, gestion des utilisateurs par un administrateur et OAuth — écrivent **directement** dans le magasin d'utilisateurs et contournent le pipeline de sauvegarde de la table. Un hook `beforeSave`/`afterSave`/`beforeDelete`/`afterDelete` sur la table des utilisateurs ne s'exécutera **pas** pour ces chemins. Pour les effets secondaires tels que le provisionnement d'une équipe personnelle lors de l'inscription, utilisez les hooks de cycle de vie d'authentification (`afterUserCreate`, `beforeUserCreate`, `afterUserDelete`, …), qui reçoivent l'enregistrement utilisateur complet.

OAuth exécute les mêmes hooks que les autres connexions : `beforeLogin` (avec l'adresse du fournisseur et `"oauth"`), `beforeUserCreate` lorsque la connexion crée le compte, `afterUserCreate`, et `onAuthenticated`. `onAuthenticated` se déclenche également lors d'un rafraîchissement de jeton (`"refresh"`), d'une réinitialisation de mot de passe (`"password-reset"`) et d'un second facteur (`"mfa"`). `beforeLogin` ne s'exécute pas lors d'un rafraîchissement, qui n'est pas une connexion. Pour bloquer un compte déjà connecté, désactivez-le avec `PUT /api/admin/users/:uid { disabled: true }` : cela refuse chaque connexion et rafraîchissement et met fin à chaque session et jeton qu'il détient.

`beforeEmailChange(user, newEmail)` s'exécute lorsqu'un utilisateur connecté demande à transférer son compte vers une autre adresse. Une règle d'adresse que vous appliquez à l'inscription dans `beforeUserCreate` (uniquement votre propre domaine, par exemple) a également sa place ici, sans quoi un membre pourrait s'inscrire avec une adresse autorisée puis basculer vers n'importe quelle autre.

Un hook qui refuse (`beforeUserCreate`, `beforeLogin`, `beforeUserDelete`, `beforeEmailChange`) lève une exception (`throw`). L'appelant reçoit `400 HOOK_REJECTED` avec le message d'erreur, ou le statut porté par l'erreur : une `ApiError`, ou toute erreur avec un `status` 4xx.
:::

### Protection contre les bots

La limitation de débit (rate limiting) restreint un seul appelant. Un millier d'adresses envoyant une seule requête chacune n'atteindront jamais une fenêtre par IP — et `/auth/register`, `/auth/forgot-password` ainsi que `/auth/magic-link` envoient tous des e-mails, de sorte que le prix d'un formulaire non protégé se paie en réputation sur votre domaine d'envoi.

```ts
auth: {
    captcha: {
        enabled: true,
        provider: "turnstile",              // or "hcaptcha"
        secret: process.env.CAPTCHA_SECRET
    }
}
```

Ou depuis l'environnement, ce qui correspond à un déploiement géré :

```bash
CAPTCHA_PROVIDER=turnstile
CAPTCHA_SECRET=...
CAPTCHA_ROUTES=register,forgotPassword,magicLink,emailOtp   # optional; this is the default
```

Le client envoie le jeton du widget sous forme de `captchaToken` dans le corps JSON, ou dans l'en-tête propre au widget `cf-turnstile-response` / `h-captcha-response`. Les deux sont acceptés ; définissez `tokenField` pour utiliser une clé de corps différente.

**`login` n'est pas protégé par défaut.** Un challenge à chaque connexion pénalise chaque utilisateur légitime, et le bourrage d'identifiants (credential stuffing) est précisément ce que le limiteur de débit et le verrouillage de compte gèrent. Ajoutez-le à `routes` si vous le souhaitez.

`POST /auth/anonymous/link`, où un invité obtient un e-mail et un mot de passe, compte comme une inscription : il prend le challenge `register` et exécute `beforeUserCreate`, tout comme le fait `/auth/register`. La connexion invité elle-même (`POST /auth/anonymous`) ne requiert aucun challenge.

#### Comportement « fail-closed »

Si le fournisseur ne peut pas être joint, la vérification échoue et la requête est refusée. Un attaquant capable de provoquer cette panne pourrait autrement désactiver la protection, ce qui est la chose précise qu'un challenge ne doit pas permettre.

Le coût est qu'une panne du fournisseur bloque les inscriptions. C'est bruyant, visible, et réversible en supprimant une seule clé de configuration — un meilleur échec qu'un échec silencieux découvert lorsque le domaine de messagerie se retrouve sur liste noire.

#### Une mauvaise configuration empêche le démarrage

`enabled: true` sans fournisseur, avec un fournisseur inconnu ou sans secret refuse systématiquement de démarrer. Un challenge silencieusement absent alors que la configuration indique sa présence est la seule défaillance inadmissible ici.

L'appelant est uniquement informé que le challenge a échoué — jamais si le jeton était absent, mal formé, déjà utilisé ou invérifiable. La cause exacte est consignée dans les logs, car renseigner un script lui indiquerait comment affiner son attaque.

### E-mails en développement

Sans `SMTP_HOST`, les e-mails d'authentification n'ont nulle part où aller. Plutôt que de refuser la requête, un serveur de développement capture le message et affiche ses liens :

```
⚠️  No SMTP is configured, so auth email is being captured here instead of sent.
ℹ️  [email] Sign in to Acme → you@example.com
             http://localhost:5173/auth/magic-link?token=…
```

Suivez le lien et le flux se termine, quelle que soit la page qui dessert ce chemin : le CMS sert `/reset-password`, `/verify-email`, `/confirm-email-change` et le `/auth/magic-link` d'un lien magique ; un autre frontend nécessite sa propre page pour chacun (voir [Magic Links](/docs/sdk/authentication/#magic-links) du SDK). Rien ne change concernant le jeton — il est généré, stocké et validé exactement comme il le serait depuis une véritable boîte de réception ; seule la distribution diffère.

Cela est actif dès lors que ces trois conditions sont réunies, et aucun paramètre ne les modifie :

- `SMTP_HOST` n'est pas défini — un serveur de messagerie configuré est toujours prioritaire ;
- `NODE_ENV` n'est pas `production`. Un e-mail de réinitialisation de mot de passe capturé transporte un jeton de réinitialisation fonctionnel, le tampon de capture est donc un magasin d'identifiants et ne doit pas exister en production ;
- `FRONTEND_URL` est une URL `http(s)` absolue, faute de quoi le lien envoyé par e-mail n'a pas de base et serait inopérant à la réception.

Si l'une de ces conditions n'est pas remplie, `POST /auth/magic-link` et `POST /auth/forgot-password` répondent `503 EMAIL_NOT_CONFIGURED` comme auparavant. En production, définissez `SMTP_HOST` (ou `auth.email.sendEmail`) pour envoyer réellement des e-mails.

#### Lire les e-mails capturés sans terminal

Les logs ne sont utiles qu'à la personne qui les regarde. Un serveur dans Docker, une seconde fenêtre ou une ligne qui défile hors champ laissent un lien affiché mais introuvable — la même capture est donc servie via HTTP :

```
GET    /api/admin/dev/emails      → { enabled: true, messages: [ … ] }
DELETE /api/admin/dev/emails      → empties the mailbox
```

Chaque message comporte `to`, `subject`, `at`, les parties `html` et `text`, ainsi que `links` — les URL absolues trouvées dans le corps, dans l'ordre du document, ce qui est la partie recherchée.

Cela nécessite le scope `users:write`, via la même barrière que celle utilisée par cron, les logs et les sauvegardes, et répond `501 DEV_MAILBOX_UNAVAILABLE` lorsqu'il n'y a rien à servir — avec SMTP configuré, l'e-mail a été remis plutôt que retenu. `NODE_ENV=production` le refuse quoi qu'il arrive : ce que ces messages contiennent est un accès fonctionnel.

### Codes à usage unique par e-mail

Un lien magique ouvre la session sur l'appareil qui détient la boîte de réception. C'est le bon appareil sur un ordinateur portable, mais le mauvais partout ailleurs — un téléviseur, un terminal, un second navigateur, une borne interactive. Un code comble cet écart, car une personne peut le recopier d'un appareil à l'autre.

```ts
auth: {
    emailOtp: true,   // or AUTH_EMAIL_OTP=true
    email: { /* … */ }
}
```

```ts
await rebase.auth.sendEmailOtp("someone@example.com");
// …the person reads six digits out of their inbox…
const { user } = await rebase.auth.verifyEmailOtp("someone@example.com", "384102");
```

L'adresse est envoyée à nouveau avec le code, et ce n'est pas une simple commodité. Ce qui est stocké est un hachage de l'adresse *et* du code réunis, de sorte qu'une tentative de devinette cible un seul compte précis — et non chaque compte de la table simultanément, ce qu'une recherche par code seul permettrait à partir d'un million de possibilités.

Le reste de ce qui rend six chiffres suffisants :

- **Dix minutes**, et à usage unique.
- **Cinq tentatives de vérification par adresse et par fenêtre**, basées sur l'adresse plutôt que sur l'IP de l'appelant : l'attaquant peut faire tourner ses adresses IP, mais pas le compte attaqué. Les compteurs résident là où se trouve le stockage de limitation de débit du déploiement — par réplica par défaut, partagés avec `REBASE_RATE_LIMIT_STORE=sql`.
- **Chiffres uniformes**, issus de `randomInt` plutôt que d'un modulo d'octets aléatoires.
- `POST /auth/otp` répond de manière identique pour une adresse sans compte, afin de ne pas pouvoir être utilisé pour déterminer si quelqu'un est client.

La lecture d'un code dans la boîte de réception prouve l'adresse, de sorte qu'une connexion réussie la marque comme vérifiée — exactement comme le fait un clic sur un lien magique. Sur un compte qui n'était pas encore vérifié, cette première preuve supprime également ce que personne n'a prouvé : le mot de passe et chaque identité liée dont le fournisseur n'a pas vérifié l'adresse. Voir [Liaison de comptes entre méthodes de connexion](#liaison-de-comptes-entre-méthodes-de-connexion).

### Personnalisation visuelle des e-mails par défaut

Les modèles intégrés de réinitialisation de mot de passe, de vérification, d'invitation, de bienvenue, de lien magique et de changement d'e-mail affichent un logo au-dessus de la carte. Il provient de `email.logoUrl` :

```ts
email: {
    // …
    appName: "Acme",
    logoUrl: "https://acme.example/logo.png"   // 48×48, absolute https URL
}
```

Il doit s'agir d'un fichier **PNG ou JPG sur une URL `http(s)` absolue**. Les clients de messagerie ne prennent pas en charge le SVG et bloquent les URI `data:`, et l'image est récupérée par le client du destinataire plutôt que par votre serveur — ainsi, un chemin relatif, une URI data ou un fichier local n'affiche aucun logo au lieu d'une image brisée. `appName` est utilisé comme texte `alt`, de sorte qu'un client ayant désactivé les images affiche tout de même le nom.

La valeur de repli est délibérément asymétrique. `appName` se rabat sur `Rebase`, mais le logo ne se rabat sur la marque Rebase que tant que l'installation ne s'est **pas** renommée. Définissez `appName` sur n'importe quoi d'autre et vous n'aurez aucun logo jusqu'à ce que vous définissiez `logoUrl` — autrement, les utilisateurs d'Acme recevraient une marque Rebase dans un e-mail signé par le domaine d'Acme.

Si vous remplacez un modèle via `email.templates`, rien de tout cela ne s'applique : votre fonction prend en charge l'intégralité du corps. `templates.emailChange(confirmUrl, user, newEmail)` est le lien envoyé à la nouvelle adresse lorsqu'un utilisateur modifie la sienne, et `templates.emailChangeNotice(user, newEmail)` est la notification envoyée à l'ancienne ; `user.email` correspond à l'adresse actuelle dans les deux cas.

### Fournisseurs OAuth

Chaque fournisseur OAuth est configuré au minimum avec un `clientId`. Certains fournisseurs requièrent un `clientSecret` :

```typescript
auth: {
    google:    { clientId: "..." },
    linkedin:  { clientId: "...", clientSecret: "..." },
    github:    { clientId: "...", clientSecret: "..." },
    microsoft: { clientId: "...", clientSecret: "...", tenantId: "..." },
    apple:     { clientId: "...", bundleIds: ["..."], teamId: "...", keyId: "...", privateKey: "..." },
    facebook:  { clientId: "...", clientSecret: "..." },
    twitter:   { clientId: "...", clientSecret: "..." },
    discord:   { clientId: "...", clientSecret: "..." },
    gitlab:    { clientId: "...", clientSecret: "..." },
    bitbucket: { clientId: "...", clientSecret: "..." },
    slack:     { clientId: "...", clientSecret: "..." },
    spotify:   { clientId: "...", clientSecret: "..." },
}
```

`gitlab` accepte également une `baseUrl` facultative, pour une instance GitLab auto-hébergée.

#### Syntaxes des variables d'environnement

Un déploiement géré ou packagé (bundle) ne dispose d'aucun bloc `auth` modifiable — il configure le serveur entièrement via l'environnement — chaque fournisseur ci-dessus possède donc une paire `<PROVIDER>_CLIENT_ID` / `<PROVIDER>_CLIENT_SECRET`, et les deux moitiés doivent être définies pour que le fournisseur soit configuré :

```bash
DISCORD_CLIENT_ID=…
DISCORD_CLIENT_SECRET=…
```

`GET /api/auth/config` liste ensuite `discord` dans `enabledProviders`, ce qui permet de vérifier que la paire a bien été prise en compte.

Google se configure avec `GOOGLE_CLIENT_ID` seul : son flux d'ID token ne nécessite aucun secret, `GOOGLE_CLIENT_SECRET` est donc optionnel.

Apple ne possède pas de secret client : Rebase signe un JWT ES256 à chaque échange. Il nécessite `APPLE_TEAM_ID`, `APPLE_KEY_ID` et `APPLE_PRIVATE_KEY` (le contenu du fichier `.p8`, retours à la ligne inclus), plus `APPLE_CLIENT_ID` (le Services ID, pour le Web), `APPLE_BUNDLE_IDS` (les identifiants séparés par des virgules de vos applications natives iOS et macOS), ou les deux. Le Services ID est public, `/auth/config` le publie donc pour le **Sign in with Apple** de l'administration.

Deux options n'ont pas d'équivalent en variable d'environnement et nécessitent le bloc `auth` (donc un backend éjecté ou configuré par le code) : `microsoft.tenantId`, qui par défaut vaut `common` et accepte tous les tenants Entra (quel que soit le tenant, une adresse n'est considérée comme vérifiée que lorsque l'enregistrement de l'application émet la revendication `xms_edov`), et `gitlab.baseUrl`, pour une instance auto-hébergée.

Chaque champ nommé est résolu au démarrage dans `auth.providers`, qui est le tableau canonique et le point d'extension pour tout ce que les champs nommés ne couvrent pas. Les entrées sont créées avec les fabriques `create*Provider`, et les deux formes fusionnent — les champs nommés sont ajoutés après les entrées explicites :

```typescript no-verify
import { createGoogleProvider, createGitHubProvider } from "@rebasepro/server";

auth: {
    providers: [
        createGoogleProvider({ clientId: "…", clientSecret: "…" }),
        createGitHubProvider({ clientId: "…", clientSecret: "…" })
    ]
}
```

#### Restreindre les URI de redirection

```typescript no-verify
auth: { allowedRedirectUris: ["https://admin.example.com/"] }
```

S'il n'est pas défini, la seule vérification effectuée sur une redirection OAuth est la correspondance de l'URI enregistrée par le fournisseur lui-même — ce qui autorise **toutes** les URI enregistrées sur ce client OAuth, y compris l'entrée `localhost` ajoutée pour le développement et l'hôte de staging que personne n'a supprimé. Lister les origines que ce backend dessert réellement restreint les redirections à celles-ci. Les URI sont comparées sur l'origine et le chemin ; la requête (query), le fragment et la barre oblique finale (trailing slash) sont ignorés.

### Liaison de comptes entre méthodes de connexion

Que se passe-t-il lorsque quelqu'un s'inscrit avec e-mail/mot de passe sous `ada@example.com`, puis clique plus tard sur « Sign in with Google » avec un compte Google utilisant cette même adresse ? Rebase **lie les deux en un seul compte**, mais uniquement lorsque le fournisseur certifie que l'e-mail est vérifié. Il ne crée jamais silencieusement un second compte pour la même adresse.

Sur `POST /api/auth/<provider>`, l'ordre de résolution est le suivant :

1. **Identité de fournisseur connue** : si cette identité exacte de fournisseur s'est déjà connectée auparavant, cet utilisateur est renvoyé. L'e-mail n'est pas consulté.
2. **Compte existant avec le même e-mail, fournisseur ayant vérifié l'e-mail** : l'identité est rattachée et l'utilisateur est connecté à ce compte. Un seul compte, deux points d'entrée. Un compte non vérifié est d'abord vérifié (voir ci-dessous).
3. **Compte existant avec le même e-mail, fournisseur ne l'ayant pas vérifié** : rejeté avec `403 EMAIL_NOT_VERIFIED` et `details.reason` valant `provider-email-unverified`. Rien n'est créé ni modifié.
4. **Aucun compte avec cet e-mail** : un nouveau compte est créé, vérifié si le fournisseur a vérifié l'e-mail.

L'étape 3 est le cas critique pour la sécurité. Si un e-mail de fournisseur non vérifié suffisait pour lier un compte, quiconque parviendrait à faire émettre par un fournisseur une adresse dont il n'est pas propriétaire pourrait prendre le contrôle du compte Rebase correspondant. Google certifie toujours `email_verified` pour les vrais comptes Google, l'étape 2 est donc le chemin habituel pour la connexion Google ; l'étape 3 intercepte principalement les fournisseurs qui permettent aux utilisateurs de fournir une adresse arbitraire non confirmée.

La situation du compte compte également. Rien ne vérifie l'adresse fournie à `POST /auth/register`, de sorte que n'importe qui peut enregistrer l'adresse d'un tiers avec un mot de passe, ou se connecter sous cette adresse via un fournisseur qui ne la garantit pas, et attendre. Associer la connexion Google du véritable propriétaire à ce compte ne doit pas laisser l'accès de l'autre personne ouvert.

Un fournisseur ayant vérifié l'adresse, un lien de vérification, un lien magique, un code par e-mail ou une réinitialisation de mot de passe prouvent tous l'adresse et vérifient le compte. Sur un compte qui n'était pas encore vérifié, la première preuve de ce type supprime le mot de passe (une réinitialisation définit le nouveau) ainsi que chaque identité liée dont le fournisseur n'a pas vérifié cette adresse, et met fin à chaque session, avant de marquer le compte comme vérifié : un mot de passe que personne n'a vérifié disparaît ainsi après la première connexion avec Google.

Un lien de vérification conserve ce que la personne qui le suit prouve également : une session active du compte, ou son mot de passe. Voir [Vérification d'e-mail](/docs/backend/email-verification/). Les comptes créés par un administrateur avec `POST /api/admin/users` sont stockés comme vérifiés, de sorte qu'une personne invitée peut immédiatement utiliser « Sign in with Google ». Un référentiel d'authentification personnalisé dépourvu de `unlinkUserIdentity` refuse une telle preuve avec `409 UNVERIFIED_IDENTITIES` lorsqu'il y a une identité à supprimer.

Ce comportement n'est pas configurable — il n'y a délibérément aucune option pour lier des comptes sur la base d'e-mails non vérifiés.

### Vérification d'e-mail

L'inscription envoie par e-mail un lien de vérification au nouveau compte, et le suivre ne conserve que ce que la personne qui le suit prouve également. `requireEmailVerification` impose une confirmation préalable lors de l'inscription. Voir [Vérification d'e-mail](/docs/backend/email-verification/).

## Tables créées automatiquement

Lors du premier démarrage, Rebase provisionne automatiquement le schéma `rebase` et les tables suivantes dans la base de données :

- **`rebase.users`** — Comptes utilisateurs avec e-mail, hachage de mot de passe, métadonnées et une colonne `roles` text[] (les rôles sont stockés sous forme de tableaux de texte inline pour optimiser les requêtes et éviter les jointures).
- **`rebase.user_identities`** — Les identités OAuth liées à chaque compte, à raison d'une ligne par identité de fournisseur.
- **`rebase.refresh_tokens`** — Sessions à longue durée de vie contenant les jetons d'actualisation hachés, les agents utilisateurs et les adresses IP. Inclut un index unique sur `token_hash`. Une connexion correspond à un `session_id`, partagé par chaque jeton issu de sa rotation ; il n'y a pas de contrainte par appareil, donc deux navigateurs derrière une même adresse constituent deux sessions. Chaque jeton d'une session porte également son niveau d'assurance (`aal`) et son mode de connexion (`method`, indiqué par `providerId`).
- **`rebase.password_reset_tokens`** — Jetons expirables à usage unique pour les flux de récupération de mot de passe.
- **`rebase.magic_link_tokens`** — Jetons expirables à usage unique pour la connexion par lien magique.
- **`rebase.mfa_factors`** — Méthodes d'authentification multifacteur enregistrées (par ex. secrets TOTP chiffrés avec AES-256).
- **`rebase.mfa_challenges`** — Journaux de vérification suivant les tentatives actives de vérification MFA.
- **`rebase.recovery_codes`** — Codes de secours/récupération multifacteur hachés.
- **`rebase.app_config`** — Magasin clé-valeur pour les configurations système.

Les jetons qui expirent — liens de réinitialisation, liens magiques et codes par e-mail, jetons d'actualisation, challenges MFA — sont supprimés une fois par heure après leur expiration. Ce nettoyage s'exécute sur les processus détenteurs des minuteurs (tous les rôles sauf `functions` dans un déploiement scindé, à moins que `REBASE_CRON_SCHEDULER=false` ne les retire de l'`api`) et sur une seule instance de la flotte : chaque heure est réservée dans `rebase.cron_claims` sous l'ID de tâche `rebase:auth:expired-tokens`, tout comme un créneau cron. Avec `cronPersistence: false`, il n'y a pas de table de réservation, et chaque instance de ce type effectue le nettoyage. Un jeton expiré est refusé lorsqu'il est présenté, que le nettoyage ait eu lieu ou non ; le nettoyage sert uniquement à empêcher la croissance indéfinie des tables.

## Initialisation du premier utilisateur (Bootstrap)

Lorsqu'aucun utilisateur n'existe dans la base de données et que le serveur ne s'exécute **pas** avec `NODE_ENV=production`, la première personne à s'inscrire devient automatiquement administrateur. Par la suite, l'inscription est régie par le paramètre `allowRegistration`.

En production, cette fenêtre est fermée, car un hôte doté d'un nom de domaine public est accessible avant que son opérateur ne se soit inscrit, et le premier arrivé en deviendrait le propriétaire. Un déploiement en production désigne plutôt son premier administrateur dans l'environnement — `REBASE_ADMIN_EMAIL` et `REBASE_ADMIN_PASSWORD`, créés au démarrage tant que la table est encore vide — ou attribue le rôle à l'aide de la clé de service. Lorsque cette fenêtre est fermée, une table vide refuse l'inscription de bootstrap avec `SETUP_REQUIRED` (et l'indique explicitement), un premier compte créé via l'inscription ouverte est un compte ordinaire, `GET /api/auth/config` ne signale jamais `needsSetup`, `POST /api/admin/bootstrap` refuse l'opération, et les logs de démarrage émettent un avertissement lorsque la table est vide et qu'aucun administrateur n'est désigné.

Sur un ordinateur de développement, cela signifie que vous pouvez toujours initialiser une base de données vierge sans la pré-remplir manuellement. Pour éviter les exécutions concurrentes et les conditions de concurrence lors de la génération du schéma au rechargement à chaud (HMR) ou au démarrage, les opérations d'initialisation sont synchronisées à l'aide d'un verrou consultatif Postgres (advisory lock) :
```sql
SELECT pg_advisory_xact_lock(hashtext('rebase_auth_functions_init'));
```

## La table des utilisateurs

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Les utilisateurs sont stockés dans la table déclarée avec `defineAuthTable` dans `backend/schema`. Il s'agit d'une table ordinaire à laquelle s'ajoutent les colonnes requises par l'authentification, une policy permettant à chaque utilisateur de lire sa propre ligne, et un contrôle d'accès réservé aux administrateurs sur la colonne `roles`. Son bloc `auth` déclare les rôles, les scopes de l'application, les clés d'API personnelles et les hooks qui s'exécutent lorsqu'un administrateur crée un utilisateur ou réinitialise un mot de passe :

```ts
import { defineAuthTable, col } from "@rebasepro/server/schema";

export const users = defineAuthTable("users", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().unique(),
    },
    rls: "admin-only",
    auth: {
        roles: { support: { name: "Support", scopes: ["users:read", "users:write", "logs:read"] } },
        personalKeys: true,
    },
});
```

[La table des utilisateurs](/docs/schema/auth-table/) détaille les colonnes, les policies injectées, `onCreateUser` et `onResetPassword` ; [Rôles et scopes](/docs/backend/roles-and-scopes/) détaille ce que chaque rôle et scope accorde.

## Prochaines étapes

- **[Points de terminaison et jetons](/docs/backend/auth-endpoints/)** — chaque route montée par cette configuration
- **[Rôles et scopes](/docs/backend/roles-and-scopes/)** — ce que chaque rôle peut faire, et comment les clés et jetons peuvent le restreindre
- **[Adaptateurs d'authentification personnalisés](/docs/backend/auth-adapters/)** — intégrer votre propre fournisseur d'identité
- **[Authentification Frontend](/docs/frontend/authentication/)** — interface de connexion, contrôleur d'authentification, gestion des utilisateurs
- **[Sécurité au niveau des lignes](/docs/collections/security-rules/)** — contrôle d'accès au niveau des lignes
- **[Authentification avec le SDK typé](/docs/sdk/authentication/)** — méthodes d'authentification dans le SDK typé
