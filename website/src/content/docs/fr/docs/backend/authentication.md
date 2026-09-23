---
sourceHash: 3c10e2e8a92e2f64
title: Authentification
sidebar_label: Authentification
description: Configurez l'authentification JWT, les fournisseurs OAuth, les e-mails SMTP, la protection contre les bots et la collection d'utilisateurs sur le backend Rebase.
---

L'authentification s'étend sur trois pages, car elle correspond à trois tâches. Celle-ci traite de la **configuration** : ce qui se place dans le bloc `auth` et dans l'environnement.

- [Endpoints and tokens](/docs/backend/auth-endpoints/) — les routes montées par le backend, les formats de réponse, le MFA, le contexte de base de données vu par une policy, les JWKS et les clés de service.
- [Custom auth adapters](/docs/backend/auth-adapters/) — remplacer le fournisseur intégré par Clerk, Firebase Auth ou le vôtre.

## Vue d'ensemble

Rebase intègre un système complet d'authentification backend :

- **Jetons JWT** — Flux de jetons d'accès et de rafraîchissement avec expiration configurable
- **Fournisseurs OAuth** — Google, LinkedIn, GitHub, Microsoft, Apple et plus encore
- **E-mails SMTP** — Flux de réinitialisation de mot de passe et de vérification d'e-mail
- **Hooks d'authentification** — Hooks de cycle de vie pour la création d'utilisateurs et plus
- **Adaptateurs d'authentification personnalisés** — Intégrez Firebase Auth, Auth0, Clerk ou n'importe quel fournisseur externe
- **Clé de service** — Clé statique pour l'authentification de serveur à serveur
- **Auto-bootstrapping** — En dehors de la production, le premier utilisateur obtient automatiquement le rôle d'administrateur ; un déploiement en production désigne son administrateur avec `REBASE_ADMIN_EMAIL` / `REBASE_ADMIN_PASSWORD`

## Configuration

:::note[Où cela se configure]
**Runtime managé :** environnement — `JWT_SECRET`, `AUTH_*`, `SMTP_*`, `CAPTCHA_*` et les paires `*_CLIENT_ID` / `*_CLIENT_SECRET` des fournisseurs, une pour chacun des douze fournisseurs ([leur dénomination](#la-dénomination-dans-les-variables-denvironnement) ; Apple nécessite quatre clés et non une paire). La collection des utilisateurs est celle désignée par le bundle (`collections/users` par convention).
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

### Le bloc `auth`, en détail

| Clé | Type | Défaut | Description |
|-----|------|---------|--------------|
| `collection` | `CollectionConfig` | — | La collection d'utilisateurs. Voir [Configuration de l'authentification au niveau de la collection](#configuration-de-lauthentification-au-niveau-de-la-collection) |
| `jwtSecret` | `string` | — | Secret de signature HS256. Requis en production |
| `signingKeys` | `JwtSigningKeyConfig[]` | — | Clés de signature asymétriques — voir [Jetons asymétriques et JWKS](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) |
| `activeKid` | `string` | première clé | Clé parmi `signingKeys` utilisée pour générer de nouveaux jetons |
| `accessExpiresIn` | `string` | `1h` | Durée de vie du jeton d'accès |
| `refreshExpiresIn` | `string` | `30d` | Durée de vie du jeton de rafraîchissement. Glissante : chaque rotation la renouvelle. Le runtime transmet `JWT_REFRESH_EXPIRES_IN`, dont la valeur par défaut est de `400d` |
| `requireAuth` | `boolean` | `true` | Exiger une session pour l'API de données |
| `allowRegistration` | `boolean` | `false` | Ouvrir `POST /api/auth/register`. Hors production, le premier utilisateur sur une table vide est admis dans les deux cas ; en production, l'administrateur est défini avec `REBASE_ADMIN_EMAIL` |
| `disableSelfRegistration` | `boolean` | `false` | Coupe-circuit : ferme également la fenêtre de bootstrap du premier utilisateur laissée ouverte par `allowRegistration: false` |
| `allowAnonymous` | `boolean` | `false` | Activer `POST /api/auth/anonymous`. Délibérément non conditionné par `allowRegistration` — une application publique principalement en lecture peut nécessiter des sessions sans comptes |
| `allowUserLookup` | `boolean` | `false` | Monter `POST /api/auth/find-user` pour les flux d'invitation par e-mail |
| `defaultRole` | `string` | — | Rôle attribué à un utilisateur nouvellement inscrit lorsqu'aucun n'est spécifié |
| `serviceKey` | `string` | — | Clé statique pour les appels de serveur à serveur — voir [Authentification par clé de service](/docs/backend/auth-endpoints/#service-key-authentication) |
| `email` | `EmailConfig` | — | SMTP, pour la réinitialisation de mot de passe, la vérification, les invitations et les liens magiques |
| `magicLink` | `boolean` | `false` | Activer la connexion sans mot de passe par e-mail. Nécessite la configuration d'`email` ; sinon, les routes répondent `503 EMAIL_NOT_CONFIGURED` |
| `emailOtp` | `boolean` | `false` | Activer les codes de connexion à six chiffres par e-mail — voir [Codes à usage unique](#codes-à-usage-unique-par-e-mail). Même prérequis concernant l'e-mail |
| `cookieAuth` | `CookieAuthConfig` | — | Délivrer le jeton de rafraîchissement sous forme de cookie `httpOnly` `Secure` `SameSite` plutôt que dans le corps JSON — voir ci-dessous |
| `providers` | `OAuthProvider[]` | `[]` | Tableau OAuth canonique ; les champs de fournisseurs nommés s'y résolvent |
| `allowedRedirectUris` | `string[]` | — | Restreindre les URI de redirection acceptées par les routes OAuth |
| `hooks` | `AuthHooks` | — | `beforeUserCreate`, `afterUserCreate`, `afterUserDelete`, … |

#### Jetons de rafraîchissement dans un cookie `httpOnly`

```typescript no-verify
auth: { cookieAuth: { sameSite: "Lax" } }
```

Le jeton de rafraîchissement est l'identifiant à longue durée de vie, et dans le mode par défaut avec corps JSON, toute faille XSS sur la page peut le lire. `cookieAuth` le déplace dans un cookie auquel le JavaScript de la page ne peut pas accéder. Le jeton d'**accès** reste dans le corps JSON, car le client doit l'inclure dans un en-tête `Authorization`.

Deux exigences doivent être respectées, sous peine de bloquer la connexion au lieu d'une dégradation gracieuse : les requêtes fetch du client vers les endpoints d'authentification nécessitent `credentials: "include"`, et CORS doit autoriser les informations d'identification (credentials) — ce qui impose une liste d'origines explicite, et jamais `origin: "*"`. `AUTH_COOKIE_SAME_SITE` est l'équivalent dans l'environnement de `sameSite`, et `AUTH_COOKIE_SECURE` de `secure`.

Le cookie porte le flag `Secure` à moins que vous ne le désactiviez, et rien dans la requête ne peut le changer : auparavant, cet indicateur était déduit du protocole de la requête, qui est `http` derrière tout proxy terminant le TLS, ce qui faisait transiter le jeton de rafraîchissement en clair dans la topologie de production la plus courante. `AUTH_COOKIE_SECURE=false` est la seule échappatoire pour un déploiement réellement servi en simple http — une adresse LAN, une appliance — et émet un avertissement au démarrage. `http://localhost` n'en a pas besoin : les navigateurs le considèrent comme une origine de confiance et y acceptent les cookies `Secure`.

| Clé | Défaut | |
|-----|---------|--|
| `cookieName` | `__rb_refresh` | |
| `domain` | domaine actuel | |
| `path` | `/` | |
| `sameSite` | `Lax` | `None` est réservé uniquement aux frontends véritablement cross-site |
| `secure` | `true` | Sécurisé par défaut ; `AUTH_COOKIE_SECURE=false` pour le http brut |

:::caution[Les callbacks de collection ne se déclenchent pas pour les utilisateurs auth]
La création et les mises à jour d'utilisateurs via le système d'authentification — inscription, gestion des utilisateurs par un administrateur et OAuth — écrivent **directement** dans le magasin d'utilisateurs et contournent le pipeline d'enregistrement de la collection. Un callback `beforeSave`/`afterSave`/`beforeDelete`/`afterDelete` sur la collection auth (utilisateurs) ne s'exécutera **pas** pour ces opérations. Pour des effets de bord tels que le provisionnement d'une équipe personnelle à l'inscription, utilisez les hooks de cycle de vie de l'authentification (`afterUserCreate`, `beforeUserCreate`, `afterUserDelete`, …), qui reçoivent l'enregistrement utilisateur entièrement renseigné.

OAuth en exécute moins que l'inscription standard. La connexion via un fournisseur déclenche `afterUserCreate` lors de la création du compte, et aucun autre hook de cycle de vie : `beforeUserCreate`, `beforeLogin` et `onAuthenticated` ne s'exécutent pas sur la route OAuth, de sorte qu'une vérification ou une piste d'audit liée à ces hooks ne verra jamais un utilisateur OAuth.
:::

### Protection contre les bots

La limitation de débit (rate limiting) restreint un appelant donné. Mille adresses distinctes envoyant chacune une seule requête n'atteindront jamais une fenêtre par IP — et `/auth/register`, `/auth/forgot-password` ainsi que `/auth/magic-link` envoient tous des e-mails, ce qui signifie que l'addition d'un formulaire non protégé se paie sur la réputation de votre domaine d'envoi.

```ts
auth: {
    captcha: {
        enabled: true,
        provider: "turnstile",              // or "hcaptcha"
        secret: process.env.CAPTCHA_SECRET
    }
}
```

Ou depuis l'environnement, ce qui correspond à un déploiement managé :

```bash
CAPTCHA_PROVIDER=turnstile
CAPTCHA_SECRET=...
CAPTCHA_ROUTES=register,forgotPassword,magicLink,emailOtp   # optional; this is the default
```

Le client envoie le jeton du widget sous la clé `captchaToken` dans le corps JSON, ou dans l'en-tête propre au widget `cf-turnstile-response` / `h-captcha-response`. Les deux sont acceptés ; définissez `tokenField` pour utiliser une autre clé dans le corps.

**`login` n'est pas protégé par défaut.** Imposer un challenge à chaque connexion pénalise chaque utilisateur légitime, et le bourrage d'identifiants (credential stuffing) est déjà pris en charge par le limiteur de débit et le verrouillage de compte. Ajoutez-le à `routes` si vous le souhaitez.

`POST /auth/anonymous/link`, où un invité obtient une adresse e-mail et un mot de passe, compte comme une inscription : il exige le challenge `register` et exécute `beforeUserCreate`, comme `/auth/register`. La connexion en tant qu'invité elle-même (`POST /auth/anonymous`) n'exige aucun challenge.

#### Échec en mode fermé (fail-closed)

Si le fournisseur ne peut pas être joint, la vérification échoue et la requête est refusée. Un attaquant capable de provoquer cette panne pourrait autrement désactiver la protection, ce qu'un mécanisme de challenge ne doit en aucun cas permettre.

La contrepartie est qu'une panne du fournisseur bloque les inscriptions. Cela est manifeste, visible, et réversible en supprimant une seule clé de configuration — un meilleur type de panne qu'une défaillance silencieuse constatée lorsque le domaine d'envoi se retrouve sur liste noire.

#### Une mauvaise configuration empêche le démarrage

`enabled: true` sans fournisseur, avec un fournisseur inconnu ou sans secret refusera systématiquement de démarrer. Un challenge silencieusement absent alors que la configuration indique qu'il est actif est l'anomalie absolue à éviter.

L'appelant est uniquement informé de l'échec du challenge — jamais de savoir si le jeton était absent, malformé, déjà utilisé ou invérifiable. La raison exacte est consignée dans les logs, car informer un script reviendrait à lui indiquer comment s'ajuster.

### E-mails en développement

Sans `SMTP_HOST`, les e-mails d'authentification n'ont aucune destination. Plutôt que de rejeter la requête, un serveur de développement intercepte le message et affiche ses liens :

```
⚠️  No SMTP is configured, so auth email is being captured here instead of sent.
ℹ️  [email] Sign in to Acme → you@example.com
             http://localhost:5173/auth/magic-link?token=…
```

Suivez le lien et le flux se termine. Rien ne change concernant le jeton — il est généré, stocké et validé exactement comme il le serait depuis une véritable boîte de réception ; seule la distribution diffère.

Ce comportement est actif dès lors que ces trois conditions sont réunies, et aucun paramètre ne peut les modifier :

- `SMTP_HOST` n'est pas défini — un serveur de messagerie configuré est toujours prioritaire ;
- `NODE_ENV` n'est pas `production`. Un e-mail de réinitialisation de mot de passe intercepté contient un jeton de réinitialisation valide, le tampon d'interception constitue donc un magasin d'identifiants et ne doit pas exister en production ;
- `FRONTEND_URL` est une URL `http(s)` absolue, faute de quoi le lien envoyé par e-mail n'a pas d'URL de base et serait inutilisable dès sa réception.

Si l'une de ces conditions n'est pas remplie, `POST /auth/magic-link` et `POST /auth/forgot-password` renvoient `503 EMAIL_NOT_CONFIGURED` comme auparavant. En production, définissez `SMTP_HOST` (ou `auth.email.sendEmail`) pour envoyer de véritables e-mails.

#### Consulter les e-mails interceptés sans terminal

Les logs ne sont utiles que pour qui les surveille. Un serveur dans Docker, une deuxième fenêtre ou une ligne qui a défilé laissent un lien affiché impossible à retrouver — ainsi, la même interception est servie via HTTP :

```
GET    /api/admin/dev/emails      → { enabled: true, messages: [ … ] }
DELETE /api/admin/dev/emails      → empties the mailbox
```

Chaque message comprend `to`, `subject`, `at`, les contenus `html` et `text`, ainsi que `links` — les URL absolues trouvées dans le corps du message, dans l'ordre du document, ce qui représente l'information véritablement recherchée.

Cet accès est réservé aux administrateurs, via la même barrière de sécurité que celle des crons, des logs et des sauvegardes, et il répond `501 DEV_MAILBOX_UNAVAILABLE` lorsqu'il n'y a rien à servir — avec SMTP configuré, le courrier est distribué plutôt que retenu. `NODE_ENV=production` le refuse quelles que soient les autres configurations : le contenu de ces messages permet une connexion directe.

### Codes à usage unique par e-mail

Un lien magique ouvre la session sur l'appareil qui héberge la boîte de réception. C'est l'appareil approprié sur un ordinateur portable, mais le mauvais partout ailleurs — une télévision, un terminal, un second navigateur, une borne interactive. Un code comble cet écart, car une personne le transmet elle-même.

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

L'adresse est envoyée à nouveau avec le code, et ce n'est pas par simple commodité. Ce qui est stocké est un hash de l'adresse *et* du code combinés, de sorte qu'une tentative de devinette ne vise qu'un seul compte désigné — et non l'ensemble des comptes de la table en même temps, ce qui serait le cas avec une recherche basée uniquement sur le code parmi un million de possibilités.

Les autres éléments qui rendent six chiffres suffisants :

- **Dix minutes**, et à usage unique.
- **Cinq tentatives de vérification par adresse et par fenêtre**, associées à l'adresse plutôt qu'à l'IP de l'appelant : une IP peut être changée à volonté par l'attaquant, contrairement au compte ciblé. Les compteurs résident là où se trouve le stockage de rate-limiting du déploiement — par réplica par défaut, partagé avec `REBASE_RATE_LIMIT_STORE=sql`.
- **Chiffres uniformes**, issus de `randomInt` plutôt que d'un modulo d'octets aléatoires.
- `POST /auth/otp` répond de manière identique pour une adresse sans compte, empêchant ainsi de savoir si quelqu'un est client ou non.

La lecture d'un code depuis la boîte de réception prouve la possession de l'adresse, une connexion réussie la marque donc comme vérifiée — exactement comme le fait de suivre un lien magique. Sur un compte qui n'était pas encore vérifié, cette première preuve supprime aussi ce que personne n'a prouvé : le mot de passe et chaque identité liée dont le fournisseur n'a pas vérifié l'adresse. Voir [Liaison de comptes](#liaison-de-comptes-entre-méthodes-de-connexion).

### Personnaliser l'image de marque des e-mails par défaut

Les modèles intégrés de réinitialisation de mot de passe, de vérification, d'invitation, de bienvenue et de lien magique affichent un logo au-dessus de la carte. Il provient de `email.logoUrl` :

```ts
email: {
    // …
    appName: "Acme",
    logoUrl: "https://acme.example/logo.png"   // 48×48, absolute https URL
}
```

Il doit s'agir d'un fichier **PNG ou JPG accessible via une URL `http(s)` absolue**. Les clients de messagerie n'affichent pas les SVG et bloquent les URI `data:`, et l'image est récupérée par le client du destinataire plutôt que par votre serveur — par conséquent, un chemin relatif, une URI data ou un fichier local n'affichera aucun logo plutôt qu'une image brisée. `appName` sert de texte alternatif (`alt`), de sorte qu'un client ayant désactivé les images affiche tout de même le nom.

Le mécanisme de repli est délibérément asymétrique. `appName` utilise `Rebase` par défaut, mais le logo ne revient à la marque Rebase que tant que l'installation ne s'est **pas** renommée. Définissez `appName` sur toute autre valeur et vous n'aurez aucun logo jusqu'à ce que vous configuriez `logoUrl` — autrement, les utilisateurs d'Acme recevraient le logo de Rebase dans un e-mail signé par le domaine d'Acme.

Si vous remplacez un modèle via `email.templates`, rien de tout cela ne s'applique : votre fonction gère l'intégralité du corps.

### Fournisseurs OAuth

Chaque fournisseur OAuth est configuré au minimum avec un `clientId`. Certains fournisseurs requièrent un `clientSecret` :

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

`gitlab` accepte également une `baseUrl` optionnelle, pour une instance GitLab auto-hébergée.

#### La dénomination dans les variables d'environnement

Un déploiement managé ou packagé n'a pas de bloc `auth` accessible en code — il configure le serveur entièrement par l'environnement — chaque fournisseur ci-dessus dispose donc d'une paire `<PROVIDER>_CLIENT_ID` / `<PROVIDER>_CLIENT_SECRET`, et les deux parties doivent être définies pour que le fournisseur soit configuré :

```bash
DISCORD_CLIENT_ID=…
DISCORD_CLIENT_SECRET=…
```

`GET /api/auth/config` liste ensuite `discord` dans `enabledProviders`, ce qui permet de vérifier que la paire a bien été prise en compte.

Apple est l'exception : il ne possède pas de secret client statique, car Rebase signe un JWT ES256 à courte durée de vie pour chaque échange de jetons. Il nécessite les quatre variables `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID` et `APPLE_PRIVATE_KEY` — le contenu du fichier `.p8`, sauts de ligne inclus.

Deux options n'ont pas d'équivalent dans les variables d'environnement et requièrent le bloc `auth` (donc un backend éjecté ou configuré par le code) : `microsoft.tenantId`, qui vaut par défaut `common` et signale chaque adresse comme non vérifiée, et `gitlab.baseUrl`, pour une instance auto-hébergée.

Chaque champ nommé est résolu au démarrage dans `auth.providers`, qui est le tableau canonique et le point d'extension pour tout ce que les champs nommés ne couvrent pas. Les entrées sont créées avec les factories `create*Provider`, et les deux formes fusionnent — les champs nommés sont ajoutés après les entrées explicites :

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

Si cette option n'est pas définie, la seule vérification lors d'une redirection OAuth est la correspondance de l'URI enregistrée auprès du fournisseur — ce qui autorise **toutes** les URI enregistrées sur ce client OAuth, y compris l'entrée `localhost` ajoutée pour le développement et l'hôte de staging que personne n'a retiré. Lister les origines que ce backend dessert réellement permet de restreindre la validation à celles-ci. Les URI sont comparées sur l'origine et le chemin ; les paramètres de requête, les fragments et les barres obliques finales (trailing slashes) sont ignorés.

### Liaison de comptes entre méthodes de connexion

Que se passe-t-il lorsque quelqu'un s'inscrit avec e-mail/mot de passe en tant que `ada@example.com`, puis clique plus tard sur « Se connecter avec Google » sur un compte Google associé à cette même adresse ? Rebase **lie les deux en un seul compte** — mais uniquement si le fournisseur certifie que l'e-mail est vérifié *et* que l'adresse du compte lui-même a été vérifiée. Il ne crée jamais silencieusement un deuxième compte pour la même adresse.

Sur `POST /api/auth/<provider>`, l'ordre de résolution est :

1. **Identité de fournisseur connue** — si cette identité exacte de fournisseur s'est déjà connectée auparavant, cet utilisateur est renvoyé. L'e-mail n'est pas consulté.
2. **Compte existant avec le même e-mail, vérifié des deux côtés** — le fournisseur a vérifié l'e-mail, et le compte aussi. L'identité est rattachée au compte existant et l'utilisateur y est connecté. Un seul compte, deux moyens d'accès.
3. **Compte existant avec le même e-mail, un côté non vérifié** — rejeté avec `403 EMAIL_NOT_VERIFIED`. Rien n'est créé ni modifié. `details.reason` indique quel côté : `provider-email-unverified`, ou `local-account-unverified` (le compte a un mot de passe) / `local-account-unverified-passwordless` (il n'en a pas).
4. **Aucun compte avec cet e-mail** — un nouveau compte est créé, vérifié si le fournisseur a vérifié l'e-mail.

L'étape 3 est le cas critique pour la sécurité. Si un e-mail de fournisseur non vérifié suffisait pour lier le compte, quiconque parviendrait à faire émettre par un fournisseur une adresse qui ne lui appartient pas pourrait prendre le contrôle du compte Rebase correspondant. Google affirme toujours `email_verified` pour les vrais comptes Google, l'étape 2 est donc le parcours normal pour la connexion Google ; l'étape 3 intercepte principalement les fournisseurs qui permettent aux utilisateurs de renseigner une adresse non confirmée arbitraire.

Le côté du compte compte pour la même raison. Rien ne vérifie l'adresse que reçoit `POST /auth/register` : n'importe qui peut donc inscrire l'adresse de quelqu'un d'autre avec un mot de passe, ou se connecter avec elle via un fournisseur qui ne la garantit pas, et attendre. Lier la connexion Google du propriétaire à ce compte y laisserait le moyen d'accès de l'autre personne.

Un lien magique, un code par e-mail ou une réinitialisation du mot de passe prouvent l'adresse et vérifient le compte. Sur un compte qui n'était pas encore vérifié, la première de ces preuves supprime le mot de passe (une réinitialisation définit le nouveau) et chaque identité liée dont le fournisseur n'a pas vérifié cette adresse, et met fin à toutes les sessions, avant de marquer le compte comme vérifié. Ensuite, l'étape 2 s'applique. Les comptes créés par un administrateur avec `POST /api/admin/users` sont enregistrés comme vérifiés, de sorte qu'une personne invitée peut utiliser « Se connecter avec Google » immédiatement. <span class="since-badge" data-since="0.23">Depuis la version 0.23</span> Un dépôt d'authentification personnalisé sans `unlinkUserIdentity` refuse une telle preuve avec `409 UNVERIFIED_IDENTITIES` lorsqu'il y a une identité à supprimer.

Ce comportement n'est pas configurable — il n'existe délibérément aucune option pour lier des comptes sur la base d'e-mails non vérifiés.

Pour surmonter un rejet à l'étape 3, l'utilisateur se connecte avec sa méthode existante et appelle le point de terminaison explicite de liaison :

```http
POST /api/auth/link/google
Authorization: Bearer <access token>

{ "idToken": "..." }
```

La liaison en étant authentifié n'exige délibérément **pas** d'e-mail vérifié, et ne nécessite pas non plus que les e-mails correspondent — l'adresse Google d'un utilisateur n'est souvent pas son adresse sur l'application. Cette asymétrie est délibérée : lors de la connexion, l'e-mail du fournisseur est la seule preuve reliant l'identité entrante à un compte, tandis qu'ici, l'appelant a déjà prouvé sa légitimité en détenant une session valide. L'endpoint renvoie `409 IDENTITY_ALREADY_LINKED` si cette identité de fournisseur appartient à un autre utilisateur, et est idempotent si elle est déjà liée à l'appelant.

#### Le cas inverse

Un utilisateur qui s'est inscrit avec Google et n'a pas de mot de passe :

- **L'inscription avec le même e-mail** est refusée avec `409 EMAIL_EXISTS`.
- **`POST /api/auth/change-password`** renvoie `400 INVALID_ACCOUNT` — il n'y a aucun mot de passe existant à vérifier.
- **`forgot-password` → `reset-password` est la méthode prise en charge pour en ajouter un.** Elle prouve à nouveau la propriété de l'adresse par e-mail, après quoi le compte dispose des deux méthodes de connexion.

## Tables créées automatiquement

Lors du premier démarrage, Rebase provisionne automatiquement le schéma `auth` et les tables suivantes dans la base de données (liées au schéma défini dans votre collection, par ex. `rebase`) :

- **`rebase.users`** — Comptes utilisateurs avec e-mail, hash de mot de passe, métadonnées et une colonne `roles` en text[] (les rôles sont stockés sous forme de tableaux de texte inline pour optimiser les requêtes et éviter les jointures).
- **`rebase.refresh_tokens`** — Sessions longue durée contenant les jetons de rafraîchissement hachés, les user-agents et les adresses IP. Comprend un index unique sur `token_hash` et une contrainte d'unicité sur `(user_id, user_agent, ip_address)` pour suivre les sessions actives par appareil.
- **`rebase.password_reset_tokens`** — Jetons à usage unique avec expiration pour les flux de réinitialisation de mot de passe.
- **`rebase.mfa_factors`** — Méthodes d'authentification multifacteur enregistrées (par ex. secrets TOTP chiffrés avec AES-256).
- **`rebase.mfa_challenges`** — Journaux de vérification suivant les tentatives actives de validation MFA.
- **`rebase.recovery_codes`** — Codes de secours/récupération multifacteur hachés.
- **`rebase.app_config`** — Magasin clé-valeur pour les configurations système.

## Amorçage du premier utilisateur (Bootstrap)

Quand aucun utilisateur n'existe dans la base de données et que le serveur n'est **pas** exécuté avec `NODE_ENV=production`, la première personne à s'inscrire devient automatiquement administrateur. Par la suite, l'inscription est contrôlée par le paramètre `allowRegistration`.

En production, cette opportunité est fermée, car un hôte doté d'un nom public est accessible avant même que son exploitant ne se soit inscrit, et le premier arrivé obtiendrait les droits d'administration. Un déploiement en production nomme plutôt son premier administrateur dans l'environnement — via `REBASE_ADMIN_EMAIL` et `REBASE_ADMIN_PASSWORD`, créé au démarrage lorsque la table est encore vide — ou attribue le rôle avec la clé de service. La fenêtre étant fermée, une table vide refuse l'inscription d'amorçage avec `SETUP_REQUIRED` (en l'indiquant clairement), un premier compte créé via une inscription libre est un compte ordinaire, `GET /api/auth/config` ne signale jamais `needsSetup`, `POST /api/admin/bootstrap` refuse la requête, et le journal de démarrage émet un avertissement lorsque la table est vide et qu'aucun administrateur n'est désigné.

Sur une machine de développement, cela signifie que vous pouvez toujours amorcer une base de données vierge sans la remplir manuellement au préalable. Pour éviter les exécutions concurrentes et les conditions de concurrence (race conditions) lors du rechargement à chaud (HMR) ou du démarrage, les opérations d'amorçage sont synchronisées à l'aide d'un verrou consultatif Postgres (advisory lock) :
```sql
SELECT pg_advisory_xact_lock(hashtext('rebase_auth_functions_init'));
```

## Configuration de l'authentification au niveau de la collection

Plutôt que de vous fier uniquement aux règles d'authentification par défaut de la base de données, vous pouvez désigner n'importe quelle collection Postgres (comme `users.ts` ou une collection personnalisée `members.ts`) comme collection d'authentification. Cela se configure via la propriété `auth` sur la collection elle-même :

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
    }
  },
  properties: { ... }
});
```

Un `temporaryPassword` renvoyé par `onResetPassword` devient le mot de passe du compte. Rebase le hache avec l'algorithme configuré, l'enregistre, déconnecte l'utilisateur de toutes ses sessions existantes et l'affiche à l'administrateur pour qu'il le transmette. Le hook ne le stocke pas, et n'a aucun moyen de le faire. Ne renvoyez pas de `temporaryPassword` lorsque le hook envoie plutôt son propre lien de réinitialisation par e-mail : le mot de passe reste alors inchangé jusqu'à ce que l'utilisateur en définisse un nouveau, mais ses sessions prennent tout de même fin.

Lorsque les hooks personnalisés (`onCreateUser`, `onResetPassword`) sont appelés, ils reçoivent une façade `AuthCollectionContext` contenant :
- `hashPassword(password: string): Promise<string>` — Hache le mot de passe à l'aide de l'algorithme de hachage configuré (par ex. scrypt).
- `sendEmail?: (options) => Promise<EmailSendResult>` — Envoie un e-mail (disponible uniquement lorsque le service de messagerie est configuré). Se résout avec les informations renvoyées par le fournisseur — `messageId`, `accepted`, `rejected` — permettant à un hook de stocker l'ID pour y associer ultérieurement une réponse.
- `emailConfigured: boolean` — Indique si le service de messagerie est configuré.
- `appName: string` — Le nom de l'application issu de la configuration de l'e-mail.
- `resetPasswordUrl: string` — L'URL de base du lien de réinitialisation de mot de passe.

## Prochaines étapes

- **[Endpoints and tokens](/docs/backend/auth-endpoints/)** — toutes les routes montées par cette configuration
- **[Custom auth adapters](/docs/backend/auth-adapters/)** — intégrer votre propre fournisseur d'identité
- **[Frontend Authentication](/docs/frontend/authentication/)** — interface de connexion, contrôleur d'authentification, gestion des utilisateurs
- **[Security Rules (RLS)](/docs/collections/security-rules/)** — contrôle d'accès au niveau des lignes
- **[Client SDK Authentication](/docs/sdk/authentication/)** — méthodes d'authentification dans le SDK client
