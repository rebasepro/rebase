---
sourceHash: 3c34341487182d4a
title: Authentification
sidebar_label: Authentification
description: Configurez l'authentification JWT, les fournisseurs OAuth, l'e-mail SMTP, la protection contre les bots et la collection d'utilisateurs sur le backend Rebase.
---

L'authentification se compose de trois pages, car elle implique trois tâches distinctes. Celle-ci traite de la **configuration** : ce qui se place dans le bloc `auth` et dans l'environnement.

- [Points de terminaison et jetons](/docs/backend/auth-endpoints/) — les routes montées par le backend, la structure des réponses, le MFA, le contexte de base de données vu par une stratégie, le JWKS et les clés de service.
- [Adaptateurs d'authentification personnalisés](/docs/backend/auth-adapters/) — remplacer le fournisseur intégré par Clerk, Firebase Auth ou votre propre solution.

## Vue d'ensemble

Rebase comprend un système d'authentification backend complet :

- **Jetons JWT** — Flux de jetons d'accès et d'actualisation avec expiration configurable
- **Fournisseurs OAuth** — Google, LinkedIn, GitHub, Microsoft, Apple, et bien d'autres
- **E-mail SMTP** — Flux de réinitialisation de mot de passe et de vérification d'adresse e-mail
- **Hooks d'authentification** — Hooks de cycle de vie pour la création d'utilisateurs, etc.
- **Adaptateurs d'authentification personnalisés** — Intégrez Firebase Auth, Auth0, Clerk ou n'importe quel fournisseur externe
- **Clé de service** — Clé statique pour l'authentification de serveur à serveur
- **Amorçage automatique** — Hors production, le premier utilisateur reçoit automatiquement le rôle d'administrateur ; un déploiement de production désigne son administrateur via `REBASE_ADMIN_EMAIL` / `REBASE_ADMIN_PASSWORD`

## Configuration

:::note[Où placer ceci]
**Runtime managé :** environnement — `JWT_SECRET`, `AUTH_*`, `SMTP_*`, `CAPTCHA_*` et les paires de fournisseurs `*_CLIENT_ID` / `*_CLIENT_SECRET`, une pour chacun des douze fournisseurs ([les syntaxes](#variables-denvironnement-correspondantes) ; celle d'Apple comporte quatre clés et non une paire). La collection d'utilisateurs correspond à celle désignée par le bundle (`collections/users` par convention).
**Pas de route managée :** `auth.hooks`. Ce sont des fonctions ; éjectez pour les transmettre.
**Éjecté :** `initializeRebaseBackend({ auth })` dans `backend/src/index.ts`.
:::

Le bloc `auth` dans `initializeRebaseBackend` contrôle l'ensemble de l'authentification backend :

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

### Le bloc `auth`, au complet

| Clé | Type | Par défaut | Description |
|-----|------|------------|-------------|
| `collection` | `CollectionConfig` | — | La collection des utilisateurs. Voir [Configuration de l'authentification au niveau de la collection](#configuration-de-lauthentification-au-niveau-de-la-collection) |
| `jwtSecret` | `string` | — | Secret de signature HS256. Requis en production |
| `signingKeys` | `JwtSigningKeyConfig[]` | — | Clés de signature asymétriques — voir [Jetons asymétriques et JWKS](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) |
| `activeKid` | `string` | première clé | Indique laquelle des clés de `signingKeys` émet de nouveaux jetons |
| `accessExpiresIn` | `string` | `1h` | Durée de vie du jeton d'accès |
| `refreshExpiresIn` | `string` | `30d` | Durée de vie du jeton d'actualisation. Glissante : chaque rotation la renouvelle, représentant ainsi le temps de survie d'une session à l'**inactivité**. Le runtime transmet `JWT_REFRESH_EXPIRES_IN`, qui vaut également `30d` par défaut. Les navigateurs limitent le cookie d'actualisation à 400 jours ; une valeur supérieure n'apporte donc rien en mode cookie |
| `refreshTokenReuseIntervalSeconds` | `number` | `10` | Période pendant laquelle un jeton d'actualisation déjà renouvelé peut encore générer un clone de sa session, afin qu'un client ayant perdu une réponse de rafraîchissement ne soit pas déconnecté |
| `refreshTokenReuse` | `"reject" \| "revoke-session"` | `"reject"` | Comportement lorsqu'un jeton d'actualisation est présenté après ce délai. `"reject"` le refuse (`TOKEN_ALREADY_USED`), l'enregistre dans les logs et maintient la session : ce n'est pas une détection de réutilisation, car la première entité à avoir rafraîchi conserve la session. `"revoke-session"` met fin à toute la session lors d'un tel rejeu (`SESSION_REVOKED`), comme le fait GoTrue, et le propriétaire doit se reconnecter. `AUTH_REFRESH_TOKEN_REUSE` |
| `requireAuth` | `boolean` | `true` | Exiger une session pour l'API de données |
| `allowRegistration` | `boolean` | `false` | Ouvre `POST /api/auth/register`. En dehors de la production, le premier utilisateur sur une table vide est admis dans les deux cas ; en production, l'administrateur est défini via `REBASE_ADMIN_EMAIL` |
| `disableSelfRegistration` | `boolean` | `false` | Coupe-circuit : ferme également la fenêtre d'amorçage du premier utilisateur laissée ouverte par `allowRegistration: false` |
| `allowAnonymous` | `boolean` | `false` | Active `POST /api/auth/anonymous`. Délibérément non conditionné par `allowRegistration` — une application publique principalement en lecture peut nécessiter des sessions sans comptes. Transformer un invité en compte (`POST /api/auth/anonymous/link`) constitue une inscription et requiert également `allowRegistration` — avec `allowAnonymous` toujours actif : une fois désactivé, il refuse également les invités déjà connectés, empêchant ainsi leur conversion en compte (`403 ANONYMOUS_AUTH_DISABLED`) |
| `allowUserLookup` | `boolean` | `false` | Monte `POST /api/auth/find-user` pour les flux d'invitation par e-mail |
| `captcha` | `CaptchaConfig` | — | Protection contre les bots sur les routes qui envoient des e-mails — voir [Protection contre les bots](#protection-contre-les-bots) |
| `defaultRole` | `string` | — | Rôle attribué à un utilisateur nouvellement inscrit lorsqu'aucun n'est spécifié. Il ne peut pas s'agir de `admin`, ni d'un rôle déclaré détenant un scope du plan d'administration : le démarrage refusera les deux |
| `serviceKey` | `string` | — | Clé statique pour les appels de serveur à serveur — voir [Authentification par clé de service](/docs/backend/auth-endpoints/#service-key-authentication) |
| `email` | `EmailConfig` | — | SMTP, pour la réinitialisation de mot de passe, la vérification, les invitations et les liens magiques |
| `magicLink` | `boolean` | `false` | Active la connexion par e-mail sans mot de passe. Nécessite la configuration de `email` ; sans cela, les routes renvoient `503 EMAIL_NOT_CONFIGURED` |
| `emailOtp` | `boolean` | `false` | Active les codes de connexion à six chiffres par e-mail — voir [Codes à usage unique](#codes-à-usage-unique-par-e-mail). Même prérequis e-mail |
| `deviceLogin` | `{ verificationUrl: string }` | — | Permet à un terminal ou à un autre appareil sans navigateur de se connecter via un autre écran — voir [Connexion d'appareil](/docs/backend/device-sign-in/). Nécessite une base de données SQL |
| `magicLinkCreatesUsers` | `boolean` | `false` | Inscription sans mot de passe : une demande de lien magique ou de code e-mail pour une adresse sans compte en crée un (sans mot de passe, non vérifié jusqu'à l'utilisation du lien ou du code), tant que `allowRegistration` est actif. Exécute `beforeUserCreate` et applique le rôle par défaut. Désactivé, ces requêtes ne créent rien et répondent à une adresse inconnue exactement comme à une adresse connue. `AUTH_MAGIC_LINK_CREATES_USERS` |
| `requireEmailVerification` | `boolean` | `false` | Refuse la connexion par mot de passe tant que l'adresse n'est pas vérifiée, et impose une inscription avec confirmation préalable — voir [Vérification d'e-mail](/docs/backend/email-verification/). Nécessite `email` ; le démarrage échouera sans |
| `cookieAuth` | `CookieAuthConfig \| false` | activé | Délivre le jeton d'actualisation sous forme de cookie `httpOnly` `Secure` `SameSite` plutôt que dans le corps JSON ; `false` le renvoie dans le corps — voir ci-dessous |
| `providers` | `OAuthProvider[]` | `[]` | Le tableau OAuth canonique ; les champs de fournisseurs nommés y sont résolus |
| `allowedRedirectUris` | `string[]` | — | Restreint les URI de redirection acceptées par les routes OAuth |
| `hooks` | `AuthHooks` | — | `beforeUserCreate`, `afterUserCreate`, `afterUserDelete`, … |

#### Jetons d'actualisation dans un cookie `httpOnly`

```typescript no-verify
auth: { cookieAuth: { sameSite: "Lax" } }
```

Le jeton d'actualisation est l'identifiant à longue durée de vie, et dans le corps, n'importe quel XSS présent sur la page pourrait le lire. `cookieAuth` le conserve dans un cookie auquel les scripts de la page ne peuvent pas accéder : activé par défaut à moins d'être configuré autrement, toujours présent dans le runtime et depuis la version 0.30 dans `initializeRebaseBackend`.
Le jeton d'**accès** reste dans le corps de la réponse, pour l'en-tête `Authorization`. Une requête avec `x-rebase-auth-flow: json` reçoit le jeton d'actualisation dans le corps ; avec `cookieAuth: false`, chaque requête le reçoit ainsi, et un client de navigation nécessite `authFlowMode: "json"`.

Deux conditions doivent être respectées sous peine de casser la connexion plutôt que de la dégrader : les appels clients vers les points de terminaison d'authentification nécessitent `credentials: "include"`, et CORS doit autoriser les informations d'identification (credentials) — ce qui implique une liste d'origines explicite, et jamais `origin: "*"`.
`AUTH_COOKIE_SAME_SITE` est la variable d'environnement pour `sameSite`, et `AUTH_COOKIE_SECURE` pour `secure`.

Le cookie porte l'attribut `Secure` à moins que vous ne le désactiviez, et aucun élément de la requête ne peut contourner cela : s'il était déterminé par le protocole de la requête, qui est `http` derrière n'importe quel proxy de terminaison TLS, le jeton serait envoyé en clair. `AUTH_COOKIE_SECURE=false` est la seule issue pour un déploiement servi en simple HTTP (une adresse LAN, une appliance), et déclenche un avertissement au démarrage. `http://localhost` n'en a pas besoin.

| Clé | Par défaut | |
|-----|------------|--|
| `cookieName` | `__rb_refresh` | |
| `domain` | domaine actuel | |
| `path` | `/` | |
| `sameSite` | `Lax` | `None` est réservé aux frontends réellement inter-domaines (cross-site) |
| `secure` | `true` | Sécurisé par défaut ; `AUTH_COOKIE_SECURE=false` pour le HTTP simple |

:::caution[Les callbacks de collection ne se déclenchent pas pour les utilisateurs d'authentification]
La création et les mises à jour d'utilisateurs via le système d'authentification — inscription, gestion des utilisateurs par un administrateur et OAuth — écrivent **directement** dans le stockage des utilisateurs et contournent le pipeline d'enregistrement de la collection. Un callback `beforeSave`/`afterSave`/`beforeDelete`/`afterDelete` sur la collection d'authentification (users) ne s'exécutera **pas** pour ces opérations. Pour des effets secondaires tels que l'attribution d'une équipe personnelle lors de l'inscription, utilisez les hooks de cycle de vie d'authentification (`afterUserCreate`, `beforeUserCreate`, `afterUserDelete`, …), qui reçoivent l'enregistrement utilisateur complet.

OAuth exécute les mêmes hooks que les autres méthodes de connexion : `beforeLogin` (avec l'adresse fournie par le fournisseur et `"oauth"`), `beforeUserCreate` lorsque la connexion crée le compte, `afterUserCreate`, et `onAuthenticated`. `onAuthenticated` se déclenche également lors du rafraîchissement d'un jeton (`"refresh"`), d'une réinitialisation de mot de passe (`"password-reset"`) et de la validation d'un second facteur (`"mfa"`). `beforeLogin` ne s'exécute pas lors d'un rafraîchissement, qui n'est pas une connexion. Pour suspendre un compte déjà connecté, désactivez-le avec `PUT /api/admin/users/:uid { disabled: true }` : cela refusera chaque tentative de connexion et de rafraîchissement, et révoquera l'ensemble de ses sessions et jetons actifs.

`beforeEmailChange(user, newEmail)` s'exécute lorsqu'un utilisateur connecté demande à transférer son compte vers une autre adresse. Une règle sur les adresses appliquée lors de l'inscription dans `beforeUserCreate` (restreindre au domaine de l'entreprise, par exemple) doit également être définie ici, sinon un membre pourrait s'inscrire avec une adresse autorisée puis basculer vers n'importe quelle autre.

Un hook qui refuse une action (`beforeUserCreate`, `beforeLogin`, `beforeUserDelete`, `beforeEmailChange`) lève une exception. L'appelant reçoit l'erreur `400 HOOK_REJECTED` accompagnée du message de l'erreur, ou le statut porté par l'erreur : une `ApiError`, ou toute erreur comportant un `status` 4xx.
:::

### Protection contre les bots

La limitation de débit (rate limiting) restreint un seul appelant. Un millier d'adresses envoyant une seule requête chacune n'atteindront jamais une limite définie par IP — or `/auth/register`, `/auth/forgot-password` et `/auth/magic-link` envoient tous des e-mails : le coût d'un formulaire non protégé se paie donc sur la réputation de votre domaine d'expédition.

```ts
auth: {
    captcha: {
        enabled: true,
        provider: "turnstile",              // or "hcaptcha"
        secret: process.env.CAPTCHA_SECRET
    }
}
```

Ou via l'environnement, ce qui correspond à la configuration d'un déploiement managé :

```bash
CAPTCHA_PROVIDER=turnstile
CAPTCHA_SECRET=...
CAPTCHA_ROUTES=register,forgotPassword,magicLink,emailOtp   # optional; this is the default
```

Le client envoie le jeton du widget en tant que `captchaToken` dans le corps JSON, ou via l'en-tête propre au widget `cf-turnstile-response` / `h-captcha-response`. Les deux sont acceptés ; définissez `tokenField` pour utiliser une autre clé dans le corps de la requête.

**`login` n'est pas protégé par défaut.** Imposer un test à chaque connexion pénalise tous les utilisateurs réels, et la protection contre le bourrage d'identifiants (credential stuffing) est précisément le rôle du limiteur de débit et du verrouillage de compte. Ajoutez-le à `routes` si vous le souhaitez.

`POST /auth/anonymous/link`, où un invité associe un e-mail et un mot de passe, équivaut à une inscription : il prend en compte le test de `register` et exécute `beforeUserCreate`, tout comme `/auth/register`. La connexion d'un invité elle-même (`POST /auth/anonymous`) ne nécessite aucun test.

#### Mode sécurisé par défaut (fail-closed)

Si le fournisseur ne peut pas être joint, la vérification échoue et la requête est refusée. Un attaquant capable de provoquer une telle panne pourrait autrement désactiver la protection, ce qu'un test de sécurité ne doit en aucun cas autoriser.

La contrepartie est qu'une interruption de service du fournisseur bloque les inscriptions. Il s'agit d'un problème flagrant, visible et réversible en supprimant une seule clé de configuration — une panne bien préférable à une défaillance silencieuse constatée lorsque le domaine d'envoi est placé sur liste noire.

#### Une mauvaise configuration empêche le démarrage

Définir `enabled: true` sans fournisseur, avec un fournisseur inconnu ou sans secret empêche l'application de démarrer. Un test absent silencieusement alors que la configuration affirme qu'il est en place est l'erreur absolue à éviter.

L'appelant est uniquement informé de l'échec de la validation — jamais de la cause exacte (jeton absent, malformé, déjà utilisé ou invérifiable). La raison précise est inscrite dans les logs, car donner ces détails à un script lui apprendrait à affiner son attaque.

### E-mails en développement

Sans `SMTP_HOST`, les e-mails d'authentification ne peuvent être acheminés. Plutôt que de rejeter la requête, un serveur de développement intercepte le message et affiche ses liens dans la console :

```
⚠️  No SMTP is configured, so auth email is being captured here instead of sent.
ℹ️  [email] Sign in to Acme → you@example.com
             http://localhost:5173/auth/magic-link?token=…
```

En suivant le lien, le flux se poursuit sur la page gérant ce chemin : le CMS prend en charge `/reset-password`, `/verify-email`, `/confirm-email-change` et le chemin `/auth/magic-link` d'un lien magique ; un autre frontend devra disposer de ses propres pages pour chacun de ces chemins (voir [Liens magiques](/docs/sdk/authentication/#magic-links) dans le SDK). Le fonctionnement du jeton reste identique — il est généré, stocké et validé exactement comme il le serait depuis une véritable boîte de réception ; seule la distribution diffère.

Ce mécanisme est actif dès lors que ces trois conditions sont remplies (aucun paramètre ne permet de déroger à cette règle) :

- `SMTP_HOST` n'est pas défini — un serveur de messagerie configuré est toujours prioritaire ;
- `NODE_ENV` n'est pas `production`. Un e-mail de réinitialisation de mot de passe intercepté contient un jeton de réinitialisation fonctionnel : la mémoire tampon de capture est donc un magasin d'identifiants et ne doit pas exister en production ;
- `FRONTEND_URL` est une URL absolue en `http(s)`, sinon le lien envoyé par e-mail n'a pas de base d'URL et serait inopérant dès réception.

Si l'une de ces conditions n'est pas satisfaite, `POST /auth/magic-link` et `POST /auth/forgot-password` renvoient l'erreur `503 EMAIL_NOT_CONFIGURED` comme d'habitude. En production, définissez `SMTP_HOST` (ou `auth.email.sendEmail`) pour assurer le véritable envoi des e-mails.

#### Lire les e-mails capturés sans terminal

La console n'est utile qu'à celui qui la consulte en direct. Un serveur exécuté sous Docker, une deuxième fenêtre ou une ligne balayée par le défilement rendent le lien affiché difficile à retrouver — ainsi, la même capture est accessible via HTTP :

```
GET    /api/admin/dev/emails      → { enabled: true, messages: [ … ] }
DELETE /api/admin/dev/emails      → vide la boîte de réception
```

Chaque message contient `to`, `subject`, `at`, les sections `html` et `text`, ainsi que `links` — les URL absolues identifiées dans le corps du texte dans l'ordre du document, ce qui constitue l'information réellement recherchée.

Cette route nécessite le scope `users:write`, via le même mécanisme de contrôle que celui utilisé par les tâches cron, les logs et les sauvegardes, et renvoie `501 DEV_MAILBOX_UNAVAILABLE` lorsqu'il n'y a rien à servir — si le SMTP est configuré, les e-mails sont directement envoyés au lieu d'être retenus. `NODE_ENV=production` refuse cet appel dans tous les cas : les messages interceptés contiennent des accès fonctionnels directs.

### Codes à usage unique par e-mail

Un lien magique ouvre la session sur l'appareil qui détient la boîte de réception. Cela convient parfaitement sur un ordinateur portable, mais devient inadapté partout ailleurs : un téléviseur, un terminal, un navigateur secondaire, une borne. Un code permet de franchir cet obstacle, car l'utilisateur peut le recopier d'un appareil à l'autre.

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

L'adresse est renvoyée avec le code, ce qui n'est pas une simple commodité. L'élément stocké est un hachage associant l'adresse *et* le code ensemble : une tentative de devinette ne vise donc qu'un compte spécifique — et non l'ensemble des comptes de la table simultanément, ce qui affaiblirait grandement la sécurité face à un million de possibilités dans une recherche par code seul.

Les mesures complémentaires assurant la robustesse de six chiffres :

- **Dix minutes**, et à usage unique.
- **Cinq tentatives de vérification par adresse et par fenêtre**, associées à l'adresse et non à l'IP de l'appelant : l'attaquant peut alterner les adresses IP, tandis que le compte ciblé reste fixe. Les compteurs sont stockés là où se trouve le stockage de limitation de débit du déploiement — par réplica par défaut, partagé avec `REBASE_RATE_LIMIT_STORE=sql`.
- **Chiffres uniformes**, issus de `randomInt` plutôt que d'un modulo d'octets aléatoires.
- `POST /auth/otp` répond de façon identique pour une adresse ne correspondant à aucun compte, évitant ainsi d'être utilisé pour sonder la présence de clients.

La lecture d'un code reçu dans la boîte de réception prouve la possession de l'adresse : une connexion réussie marque donc l'adresse comme vérifiée — exactement comme le fait un lien magique. Sur un compte qui n'avait pas encore été vérifié, cette première preuve supprime également ce qui n'a jamais été validé : le mot de passe et toute identité liée dont le fournisseur n'a pas vérifié l'adresse. Voir [Liaison de comptes](#liaison-de-comptes-entre-méthodes-de-connexion).

### Personnalisation des e-mails par défaut

Les modèles intégrés de réinitialisation de mot de passe, de vérification, d'invitation, de bienvenue, de lien magique et de changement d'e-mail affichent un logo au-dessus du bloc principal. Il est défini par `email.logoUrl` :

```ts
email: {
    // …
    appName: "Acme",
    logoUrl: "https://acme.example/logo.png"   // 48×48, absolute https URL
}
```

Il doit s'agir d'un fichier **PNG ou JPG accessible via une URL absolue `http(s)`**. Les clients de messagerie ne gèrent pas le format SVG et bloquent les URI `data:`. De plus, l'image est récupérée directement par le client du destinataire et non par votre serveur — un chemin relatif, une URI data ou un fichier local n'affichera donc aucun logo plutôt qu'une image brisée. `appName` est utilisé comme texte `alt`, de sorte qu'un client avec chargement d'images désactivé affiche tout de même le nom.

La valeur de secours (fallback) est volontairement asymétrique. `appName` utilise `Rebase` par défaut, mais le logo ne prend l'emblème Rebase que tant que l'installation n'a **pas** été renommée. Si vous personnalisez `appName` sans définir `logoUrl`, aucun logo n'apparaîtra — ce qui évite que les utilisateurs d'Acme ne reçoivent le visuel de Rebase dans un e-mail signé par le domaine d'Acme.

Si vous remplacez un modèle via `email.templates`, ces règles ne s'appliquent pas : votre fonction gère l'intégralité du corps du message. `templates.emailChange(confirmUrl, user, newEmail)` génère le lien envoyé à la nouvelle adresse lorsqu'un utilisateur la modifie, et `templates.emailChangeNotice(user, newEmail)` produit la notification envoyée à l'ancienne adresse ; `user.email` représente l'adresse actuelle dans les deux cas.

### Fournisseurs OAuth

Chaque fournisseur OAuth se configure au minimum avec un `clientId`. Certains fournisseurs requièrent également un `clientSecret` :

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

`gitlab` accepte également un `baseUrl` optionnel, pour une instance GitLab auto-hébergée.

#### Variables d'environnement correspondantes

Un déploiement managé ou par bundle ne dispose pas de bloc `auth` modifiable dans le code — il configure le serveur exclusivement via des variables d'environnement. Chaque fournisseur ci-dessus possède donc une paire `<FOURNISSEUR>_CLIENT_ID` / `<FOURNISSEUR>_CLIENT_SECRET`, et ces deux variables doivent être définies pour que le fournisseur soit actif :

```bash
DISCORD_CLIENT_ID=…
DISCORD_CLIENT_SECRET=…
```

`GET /api/auth/config` liste ensuite `discord` dans `enabledProviders`, ce qui permet de confirmer la prise en compte de la paire.

Google est configuré uniquement avec `GOOGLE_CLIENT_ID` : son flux basé sur l'ID-token ne requiert aucun secret ; `GOOGLE_CLIENT_SECRET` est donc optionnel.

Apple n'utilise aucun secret client : Rebase signe un JWT ES256 à chaque échange. Il requiert `APPLE_TEAM_ID`, `APPLE_KEY_ID` et `APPLE_PRIVATE_KEY` (le contenu complet du fichier `.p8`, retours à la ligne inclus), ainsi que `APPLE_CLIENT_ID` (le Services ID, pour le web), `APPLE_BUNDLE_IDS` (identifiants séparés par des virgules pour vos applications natives iOS et macOS), ou les deux. L'identifiant de service étant public, `/auth/config` le diffuse pour le bouton **Se connecter avec Apple** de l'espace d'administration.

Deux options n'ont pas d'équivalent en variables d'environnement et nécessitent le bloc `auth` (c'est-à-dire un backend éjecté ou configuré par le code) : `microsoft.tenantId`, qui utilise sinon `common` par défaut et accepte tous les tenants Entra (quel que soit le tenant, une adresse n'est considérée comme vérifiée que si l'enregistrement de l'application émet le claim `xms_edov`), et `gitlab.baseUrl`, pour une instance auto-hébergée.

Chaque champ nommé est converti au démarrage dans `auth.providers`, qui représente le tableau canonique et le point d'extension pour tout ce que les champs nommés ne prennent pas en compte. Les entrées sont générées à l'aide des fabriques `create*Provider`, et les deux approches fusionnent — les champs nommés sont ajoutés après les entrées explicites :

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

Si ce paramètre n'est pas défini, la seule vérification sur une redirection OAuth repose sur la concordance des URI enregistrées chez le fournisseur — ce qui autorise **toutes** les URI enregistrées pour ce client OAuth, y compris l'entrée `localhost` ajoutée pour le développement et l'hôte de préproduction oublié. Énumérer les origines que ce backend dessert réellement permet de restreindre strictement la validation à celles-ci. Les URI sont comparées sur l'origine plus le chemin d'accès ; les paramètres de requête, les fragments et les barres obliques finales sont ignorés.

### Liaison de comptes entre méthodes de connexion

Que se passe-t-il lorsqu'un utilisateur s'inscrit par e-mail/mot de passe avec `ada@example.com`, puis clique plus tard sur "Se connecter avec Google" en utilisant un compte Google possédant cette même adresse ? Rebase **associe les deux méthodes au sein d'un même compte**, mais uniquement si le fournisseur certifie que l'adresse e-mail est vérifiée. Il ne crée jamais silencieusement un second compte pour la même adresse.

Lors d'un appel à `POST /api/auth/<provider>`, l'ordre de résolution est le suivant :

1. **Identité de fournisseur connue** : si cette identité précise de fournisseur s'est déjà connectée auparavant, cet utilisateur est renvoyé. L'adresse e-mail n'est pas examinée.
2. **Compte existant avec le même e-mail, e-mail vérifié par le fournisseur** : l'identité est rattachée et l'utilisateur est connecté à ce compte. Un seul compte, deux voies d'accès. Un compte non vérifié est d'abord marqué comme vérifié (voir ci-dessous).
3. **Compte existant avec le même e-mail, e-mail non vérifié par le fournisseur** : la requête est rejetée avec `403 EMAIL_NOT_VERIFIED` et la raison `details.reason` fixée à `provider-email-unverified`. Rien n'est créé ni modifié.
4. **Aucun compte associé à cet e-mail** : un nouveau compte est créé, marqué comme vérifié si le fournisseur a lui-même vérifié l'e-mail.

L'étape 3 constitue un point critique pour la sécurité. Si une adresse e-mail non vérifiée par un fournisseur suffisait à déclencher la liaison, quiconque parviendrait à faire émettre par un fournisseur une adresse dont il n'est pas propriétaire pourrait prendre le contrôle du compte Rebase correspondant. Google certifie systématiquement `email_verified` pour les vrais comptes Google, l'étape 2 représente donc le parcours normal pour la connexion Google ; l'étape 3 bloque essentiellement les fournisseurs qui autorisent les utilisateurs à renseigner une adresse arbitraire non confirmée.

La sécurité du compte d'origine compte tout autant. Rien ne valide l'adresse transmise à `POST /auth/register` : n'importe qui peut donc enregistrer l'adresse d'un tiers avec un mot de passe, ou se connecter sous cette identité via un fournisseur qui ne la garantit pas, puis attendre. Lier ensuite la connexion Google du propriétaire légitime à ce compte ne doit en aucun cas laisser l'accès de l'autre personne ouvert.

Un fournisseur ayant vérifié l'adresse, un lien de vérification, un lien magique, un code envoyé par e-mail ou une réinitialisation de mot de passe constituent tous des preuves de propriété de l'adresse et valident le compte. Sur un compte qui n'avait pas encore été vérifié, la première de ces preuves supprime le mot de passe (une réinitialisation définit le nouveau) ainsi que toute identité liée dont le fournisseur n'avait pas vérifié cette adresse, puis révoque toutes les sessions existantes avant de marquer le compte comme vérifié : un mot de passe que personne n'a validé disparaît après la première connexion Google.

Un lien de vérification conserve ce que la personne qui le consulte valide également : une session active du compte, ou son mot de passe. Voir [Vérification d'e-mail](/docs/backend/email-verification/). Les comptes créés par un administrateur via `POST /api/admin/users` sont enregistrés comme directement vérifiés, permettant à un invité d'utiliser "Se connecter avec Google" sans délai. Un dépôt d'authentification personnalisé dépourvu de `unlinkUserIdentity` refusera une telle validation avec l'erreur `409 UNVERIFIED_IDENTITIES` lorsqu'une identité doit être supprimée.

Ce comportement n'est pas configurable — il n'existe délibérément aucune option permettant d'associer des comptes sur la base d'adresses e-mail non vérifiées.

### Vérification d'e-mail

L'inscription envoie au nouveau compte un lien de vérification, et l'ouverture de ce lien ne préserve que les éléments validés par la personne qui le suit. `requireEmailVerification` impose la confirmation préalable lors de l'inscription. Voir [Vérification d'e-mail](/docs/backend/email-verification/).

## Tables créées automatiquement

Lors du premier démarrage, Rebase provisionne automatiquement le schéma `rebase` ainsi que les tables suivantes dans la base de données (rattachées au schéma défini dans votre collection, par exemple `rebase`) :

- **`rebase.users`** — Comptes d'utilisateurs avec e-mail, hachage de mot de passe, métadonnées, et une colonne `roles` en text[] (les rôles sont stockés sous forme de tableaux de texte intégrés afin d'optimiser les requêtes et d'éviter les jointures).
- **`rebase.user_identities`** — Les identités OAuth liées à chaque compte, à raison d'une ligne par identité de fournisseur.
- **`rebase.refresh_tokens`** — Sessions persistantes contenant les jetons d'actualisation hachés, les agents utilisateurs et les adresses IP. Comporte un index unique sur `token_hash`. Une connexion correspond à un `session_id`, partagé par chaque jeton issu de ses rotations successives ; il n'y a pas de contrainte par appareil, donc deux navigateurs derrière une même adresse représentent deux sessions distinctes. Chaque jeton d'une session conserve également son niveau d'assurance (`aal`) et son mode de connexion (`method`, indiqué par `providerId`).
- **`rebase.password_reset_tokens`** — Jetons à usage unique avec expiration pour les flux de récupération de mot de passe.
- **`rebase.magic_link_tokens`** — Jetons à usage unique avec expiration pour la connexion par lien magique.
- **`rebase.mfa_factors`** — Méthodes d'authentification multifacteur configurées (par exemple, des secrets TOTP chiffrés en AES-256).
- **`rebase.mfa_challenges`** — Journaux de vérification assurant le suivi des tentatives actives de validation MFA.
- **`rebase.recovery_codes`** — Codes de secours/récupération multifacteur hachés.
- **`rebase.app_config`** — Magasin clé-valeur pour les configurations système.

Les jetons soumis à expiration — liens de réinitialisation, liens magiques, codes e-mail, jetons d'actualisation, challenges MFA — sont supprimés une fois par heure après leur expiration. Ce nettoyage s'exécute sur les processus gérant les timers (tous les rôles sauf `functions` dans un déploiement scindé, à moins que `REBASE_CRON_SCHEDULER=false` ne les désactive sur l'`api`) et sur une seule instance du cluster : chaque heure fait l'objet d'un verrou dans `rebase.cron_claims` sous l'identifiant de tâche `rebase:auth:expired-tokens`, à la manière d'un créneau cron. Avec `cronPersistence: false`, il n'y a pas de table de verrous et chaque instance effectue le nettoyage. Un jeton expiré est refusé dès sa présentation, que le nettoyage ait tourné ou non ; ce processus a pour seul but d'empêcher les tables de grossir indéfiniment.

## Amorçage du premier utilisateur (Bootstrap)

Lorsqu'aucun utilisateur n'existe dans la base de données et que le serveur n'est **pas** exécuté avec `NODE_ENV=production`, la première personne qui s'inscrit devient automatiquement administratrice. Par la suite, l'accès aux inscriptions est régi par le paramètre `allowRegistration`.

En production, cette fenêtre est fermée, car un hôte disposant d'un nom de domaine public est accessible avant même que son opérateur n'ait pu s'inscrire, et le premier arrivé obtiendrait le contrôle absolu. Un déploiement de production désigne donc son premier administrateur via l'environnement — `REBASE_ADMIN_EMAIL` et `REBASE_ADMIN_PASSWORD`, créés au démarrage tant que la table est encore vide — ou lui attribue ce rôle via la clé de service. La fenêtre étant fermée, une table vide refuse l'inscription d'amorçage avec `SETUP_REQUIRED` (en l'indiquant explicitement), un premier compte créé via une inscription ouverte devient un compte ordinaire, `GET /api/auth/config` ne renvoie jamais `needsSetup`, `POST /api/admin/bootstrap` est rejeté, et le journal de démarrage émet un avertissement lorsque la table est vide et qu'aucun administrateur n'est spécifié.

Sur une machine de développement locale, cela garantit la possibilité d'amorcer une nouvelle base de données sans injection manuelle de données. Pour éviter les exécutions concurrentes et les conflits de génération de schéma lors du rechargement à chaud (HMR) ou du démarrage, les opérations d'amorçage sont synchronisées à l'aide d'un verrou consultatif (advisory lock) Postgres :
```sql
SELECT pg_advisory_xact_lock(hashtext('rebase_auth_functions_init'));
```

## Configuration de l'authentification au niveau de la collection

Plutôt que de dépendre exclusivement des règles d'authentification par défaut de la base de données, vous pouvez désigner n'importe quelle collection Postgres (comme `users.ts` ou une collection personnalisée `members.ts`) comme étant la collection d'authentification. Cela se configure via la propriété `auth` sur la définition de la collection elle-même :

```typescript
import { randomBytes } from "node:crypto";
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
      const tempPassword = randomBytes(12).toString("base64url");
      return {
        temporaryPassword: tempPassword, // saved as the new password, then shown to the admin
        invitationSent: false
      };
    },

    // Inject/override auth-specific actions (e.g. show/hide the reset password button)
    actions: {
      resetPassword: true // Or false to disable, or a custom EntityAction
    },

    // What each role may do beyond its rows, the app's own scopes,
    // and whether accounts may create personal API keys
    roles: {
      support: { name: "Support", scopes: ["users:read", "users:write", "logs:read"] }
    },
    scopes: {
      "project:deploy": { label: "Deploy projects", target: "project" }
    },
    personalKeys: true
  },
  properties: { ... }
});
```

`roles`, `scopes` et `personalKeys` définissent le modèle d'accès : les scopes du plan d'administration détenus par chaque rôle, les scopes propres à l'application pour ses opérations, et l'autorisation pour chaque compte de créer des [clés d'API personnelles](/docs/backend/api-keys/#personal-keys).
Voir [Rôles et scopes](/docs/backend/roles-and-scopes/).

Une valeur `temporaryPassword` renvoyée par `onResetPassword` devient le mot de passe du compte. Rebase le hache selon l'algorithme configuré, l'enregistre, déconnecte l'utilisateur de l'ensemble de ses sessions existantes et affiche le mot de passe à l'administrateur pour qu'il le transmette. Le hook ne stocke pas ce mot de passe et n'en a pas la possibilité. Ne retournez aucun `temporaryPassword` si le hook envoie lui-même son propre lien de réinitialisation par e-mail : le mot de passe reste alors inchangé jusqu'à ce que l'utilisateur en définisse un nouveau, bien que ses sessions en cours soient tout de même interrompues.

Lorsque des hooks personnalisés (`onCreateUser`, `onResetPassword`) sont appelés, ils reçoivent une interface `AuthCollectionContext` comprenant :
- `hashPassword(password: string): Promise<string>` — Hache le mot de passe selon l'algorithme de hachage configuré (ex. scrypt).
- `sendEmail?: (options) => Promise<EmailSendResult>` — Envoie un e-mail (uniquement disponible si le service e-mail est configuré). Se résout avec le retour d'information fourni par le service — `messageId`, `accepted`, `rejected` — ce qui permet à un hook de mémoriser l'identifiant pour y rattacher ultérieurement une réponse.
- `emailConfigured: boolean` — Indique si le service d'e-mail est configuré.
- `appName: string` — Le nom de l'application défini dans la configuration e-mail.
- `resetPasswordUrl: string` — L'URL de base pour les liens de réinitialisation de mot de passe.

## Étapes suivantes

- **[Points de terminaison et jetons](/docs/backend/auth-endpoints/)** — l'ensemble des routes montées par cette configuration
- **[Rôles et scopes](/docs/backend/roles-and-scopes/)** — les autorisations de chaque rôle, et leur restriction par les clés et les jetons
- **[Adaptateurs d'authentification personnalisés](/docs/backend/auth-adapters/)** — intégrer votre propre fournisseur d'identité
- **[Authentification Frontend](/docs/frontend/authentication/)** — interface de connexion, contrôleur d'authentification, gestion des utilisateurs
- **[Règles de sécurité (RLS)](/docs/collections/security-rules/)** — contrôle d'accès au niveau des lignes
- **[Authentification avec le SDK typé](/docs/sdk/authentication/)** — méthodes d'authentification dans le SDK typé
