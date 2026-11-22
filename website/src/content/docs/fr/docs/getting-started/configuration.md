---
sourceHash: df5e0441849e5e57
title: Environnement & Configuration
sidebar_label: Configuration
description: Toutes les variables d'environnement et options de configuration pour les projets Rebase.
---

## Variables d'environnement

Toute la configuration s'effectue via des variables d'environnement dans votre fichier `.env` à la racine du projet.

> **Important** : Rebase valide les variables d'environnement avec **Zod** au démarrage. Si
> un élément requis est manquant ou malformé (une URL qui n'est pas une URL, un port qui
> n'est pas un nombre), le serveur refuse de démarrer et indique le nom de la variable.
>
> L'emplacement du schéma dépend de la manière dont vous exécutez le backend. Un projet démarré par
> le runtime — `rebase dev`, `rebase start`, l'image publiée — utilise le
> schéma géré par le runtime (`loadBootEnv` dans `@rebasepro/server`), qui est l'union
> de chaque tableau ci-dessous. Un projet ayant exécuté [`rebase eject`](/docs/cli)
> possède un fichier `backend/src/env.ts` appelant `loadEnv({ extend })`, et peut y ajouter ses propres
> variables typées.

### Requis

| Variable | Description | Exemple |
|----------|-------------|---------|
| `DATABASE_URL` | Chaîne de connexion PostgreSQL. **Optionnel en développement** — si non défini, `rebase dev` exécute un PostgreSQL géré pour le projet, avec ses données sous `.rebase/`. Requis partout ailleurs. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Clé secrète pour signer les jetons JWT. Utilisez une chaîne aléatoire forte (min 32 caractères). **Requis en production** (généré automatiquement en développement). | `a1b2c3d4e5...` |

> **Sur une base de données gérée, `sslmode=require` peut ne pas signifier ce qu'il indique.**
>
> Pour `psql` et tous les outils libpq, `require` signifie « chiffré, certificat non
> vérifié ». Le pilote Node sur lequel Rebase s'exécute le lit comme `verify-full`, ainsi une
> base de données dont le certificat n'a pas été signé par une autorité publique — fréquent sur les services
> Postgres gérés — rejette le runtime avec `self-signed certificate`, alors que `psql`
> se connecte avec la même URL. Le runtime et les commandes `rebase db` s'arrêtent avec un
> message indiquant ce problème.
>
> Choisissez l'une de ces options :
>
> - **`sslmode=no-verify`** — chiffré, non vérifié : ce que `require` signifie pour
>   libpq. Il s'agit d'une variante propre à node-postgres que libpq ne possède pas, donc `psql`, `pg_dump`
>   et Atlas la refusent avec `invalid sslmode value: "no-verify"`. Les propres commandes
>   de Rebase (`rebase db push`, `rebase db backup`, `rebase db restore`) la transmettent
>   sous la forme `sslmode=require`, ce qui leur permet de fonctionner avec l'URL telle que configurée ; pour
>   un usage manuel avec `psql`, remplacez-la par `sslmode=require`.
> - **`sslmode=verify-full&sslrootcert=/path/to/ca.pem`** — vérifié par rapport au
>   certificat CA du fournisseur. Identique pour tous les outils.
>
> `uselibpqcompat=true&sslmode=require`, suggéré par l'avertissement du pilote Node
> lui-même, fonctionne également pour le runtime ; les commandes de Rebase retirent `uselibpqcompat`
> avant de passer l'URL aux outils libpq, qui le refusent.

### Frontend

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `VITE_API_URL` | URL de l'API backend pour le SDK typé. **À définir uniquement en développement** — voir ci-dessous. | page origin |
| `VITE_GOOGLE_CLIENT_ID` | Identifiant client Google OAuth. Active « Se connecter avec Google ». | — |


> **Laissez `VITE_API_URL` non défini dans les builds de production.**
>
> En développement, le frontend et le backend sont sur des origines distinctes, le serveur de
> développement injecte donc cette variable. En production, le backend Rebase sert la SPA, l'API
> correspond donc à l'origine même de la page et le client la résout de cette manière par lui-même.
>
> Figer une URL absolue dans un bundle de production fonctionne jusqu'à ce qu'un second
> nom d'hôte pointe vers la même application : un domaine personnalisé charge alors la page depuis
> `example.com` et appelle l'API sur `example.rebase.website`, ce qui constitue une requête
> cross-origin, et chaque requête échoue au preflight. Autoriser l'origine dans CORS
> ne résout **pas** non plus le problème — le cookie de rafraîchissement est `SameSite=Lax` et n'est pas
> envoyé cross-site ; les erreurs de console disparaîtraient mais l'authentification
> resterait cassée. Non défini, chaque domaine pointant vers l'application fonctionne sans
> aucune configuration CORS.

### Backend

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `PORT` | Port pour le serveur HTTP backend. Lu par `rebase start`. `rebase dev` le lit **uniquement depuis l'environnement du shell** — une valeur `PORT` dans `.env` n'y est pas lue, car le port est résolu avant le chargement de ce fichier — et lie sinon un port dérivé du chemin du projet, afin que plusieurs projets puissent tourner en même temps. `rebase dev --port` est prioritaire sur les deux, et la bannière de démarrage indique le choix retenu. | `3001` |
| `LOG_LEVEL` | Niveau de verbosité des logs : `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Affiche le SQL sous-jacent d'une ligne `Failed query: [redacted]`. Chaque instruction en échec est caviardée par défaut, car une requête échouée contient ses paramètres liés — un e-mail, un hash de mot de passe. Définissez-le à `true` lors du diagnostic d'une panne DDL, RLS ou de capture de changements. Ignoré quand `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Environnement : `development`, `production`, ou `test` | `development` |
| `CORS_ORIGINS` | Liste séparée par des virgules des origines autorisées. **Requis en production** à moins que `FRONTEND_URL` ne soit défini : un démarrage en production sans aucun des deux refusera de démarrer. En développement, il est *ajouté à* localhost — voir ci-dessous. | — |
| `FRONTEND_URL` | URL de l'application frontend. Utilisé comme alternative à CORS_ORIGINS, dans les deux environnements. | — |
| `ADMIN_CONNECTION_STRING` | Chaîne de connexion à la base de données avec privilèges administrateur (utilisée pour l'introspection du schéma et les opérations d'administration). La base de données qu'elle désigne n'est pas celle que la console SQL considère comme actuelle, ni celle qu'une nouvelle branche copie par défaut : les deux correspondent à la base de données sur laquelle repose la connexion propre de l'application (voir `REBASE_BRANCH_PARENT_DATABASE` pour un serveur sur une branche). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Désactive le changement de rôle PostgreSQL dans l'éditeur SQL (utile pour l'authentification personnalisée où les rôles DB ne sont pas mappés). La console SQL de Studio indique alors que les lignes ont été lues en tant que propriétaire de la connexion, le nomme, et grise son sélecteur de rôle. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | La base de données depuis laquelle la branche sur laquelle ce serveur tourne a été copiée. `rebase dev` la définit sur un clone [basculé sur une branche](/docs/backend/branching/#cli-integration). Un serveur disposant de cette variable conserve le registre des branches sur cette base de données et copie de nouvelles branches depuis celle-ci par défaut, de sorte que le panneau Branches de Studio affiche les branches de la base principale. | — |

#### CORS en développement

Le développement autorise **localhost, plus les origines indiquées dans `CORS_ORIGINS` (ou `FRONTEND_URL`)**
— la même liste que celle utilisée en production, avec localhost ajouté plutôt que
substitué. Ainsi, la variable fonctionne de la même manière dans les deux environnements, et les
cas nécessitant son utilisation en développement sont classiques :

```bash
# Un téléphone sur le réseau local, la machine d'un collègue, un tunnel ngrok,
# un port Codespaces transféré — toutes les origines différentes de localhost.
CORS_ORIGINS=http://192.168.1.5:5173
```

Une origine qui n'est ni localhost ni répertoriée est refusée, et le refus est
journalisé **une fois par origine** avec la ligne exacte qui permettrait de l'autoriser. Ce refus
n'est pas une simple précaution gratuite : l'API transmettant des identifiants d'authentification, refléter une
`Origin` arbitraire permettrait à n'importe quel site visité par le développeur d'effectuer des
requêtes authentifiées contre le serveur de développement avec sa session et d'en lire
les réponses.

### Authentification

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `JWT_SECRET` | Secret pour la signature JWT (requis en production, généré automatiquement en développement) | — |
| `JWT_PRIVATE_KEY` | Clé privée PEM pour signer les jetons d'accès de manière asymétrique (RS256), afin que toute entité détenant le JWKS puisse vérifier une session sans pouvoir en générer une. Accepte un PEM avec de vrais sauts de ligne, un PEM avec des échappements `\n`, ou l'encodage base64 du PEM complet. Sans cela, les jetons restent en HS256. | — |
| `JWT_KEY_ID` | Désigne `JWT_PRIVATE_KEY` dans l'en-tête du jeton et dans le JWKS. Modifiez-le dès que la clé change — la rotation dépend de la capacité à distinguer l'ancienne clé de la nouvelle. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Durée de vie du jeton d'accès | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Durée de vie du jeton de rafraîchissement. Glissante — chaque rotation la renouvelle, ce paramètre régit donc la durée de survie d'une session face à **l'inactivité**. Définissez `400d` pour les sessions qui doivent survivre à une longue absence ; les navigateurs plafonnent le cookie de rafraîchissement à cette valeur. | `30d` |
| `ALLOW_REGISTRATION` | Autorise l'inscription de nouveaux utilisateurs (`true`/`false`). En dehors de la production, le **premier** utilisateur peut toujours s'inscrire, quelle que soit cette valeur — une table d'utilisateurs vide doit bien accepter quelqu'un, et ce premier utilisateur devient l'administrateur. En production (`NODE_ENV=production`), cette fenêtre est fermée : une table vide refuse l'inscription d'amorçage avec `SETUP_REQUIRED`, un premier compte créé via l'inscription ouverte est un compte ordinaire, et l'administrateur est désigné via `REBASE_ADMIN_EMAIL` ci-dessous ou assigné avec la clé de service. Le fichier `.env.example` du scaffold le définit à `true` ; la valeur par défaut du framework est désactivée. | `false` |
| `DISABLE_SELF_REGISTRATION` | Coupe-circuit. Ferme la fenêtre d'amorçage du premier utilisateur que `ALLOW_REGISTRATION=false` laisse délibérément ouverte hors production, rendant ainsi l'inscription impossible même sur une base de données vide. À associer avec `REBASE_ADMIN_EMAIL` ci-dessous, sous peine de ne disposer d'aucun moyen de créer le premier utilisateur connecté lors du déploiement. Chaque artefact de déploiement livré le définit. | — |
| `REBASE_ADMIN_EMAIL` | Adresse e-mail du premier compte administrateur, créé au démarrage **tant que la table des utilisateurs est encore vide** et jamais par la suite. C'est ainsi qu'un déploiement de production obtient son administrateur : l'opérateur désigne le premier compte au lieu d'entrer en concurrence avec le trafic internet. Un avertissement apparaît au démarrage si la table est vide en production et que cette variable n'est pas définie. | — |
| `REBASE_ADMIN_PASSWORD` | Mot de passe pour ce compte. Au moins 12 caractères, sinon il est refusé et le compte n'est pas créé. À modifier après la première connexion. | — |
| `MFA_ENCRYPTION_KEY` | Chiffre chaque secret TOTP stocké. Non défini, les secrets sont chiffrés avec `JWT_SECRET` à la place et le démarrage émet un avertissement unique — ainsi, la rotation de `JWT_SECRET` déconnecterait tout le monde *et* rendrait impossible le déchiffrement de chaque authentificateur enregistré. Définissez une clé dédiée (32+ caractères aléatoires) avant toute inscription. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | La clé *précédente* lors d'une rotation. Définissez les deux pendant une rotation : les nouveaux secrets sont écrits avec `MFA_ENCRYPTION_KEY` et les secrets existants restent lisibles, afin que personne ne soit exclu de son propre compte au milieu de la rotation. Supprimez-la une fois que chaque secret a été ré-encrypté. | — |
| `ALLOW_ANONYMOUS` | Active la connexion anonyme (`POST /api/auth/anonymous`). Optionnelle (opt-in), et délibérément non conditionnée par `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Exige l'authentification pour l'API de données. Définissez à `false` pour une surface de lecture totalement publique — RLS s'applique toujours. | `true` |
| `AUTH_DEFAULT_ROLE` | Rôle attribué à un utilisateur nouvellement inscrit si aucun n'est fourni. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Monte `POST /api/auth/find-user`, qui résout une adresse e-mail en un profil public minimal (`uid`, `displayName`, `photoURL`) pour les flux d'invitation par e-mail. Réservé aux appelants authentifiés, et ne renvoie jamais l'e-mail, les rôles ou les métadonnées de l'utilisateur trouvé. Désactivé par défaut : il s'agit d'une surface d'énumération. | `false` |
| `AUTH_COOKIE_SAME_SITE` | Attribut `SameSite` sur le cookie de rafraîchissement : `Strict`, `Lax` ou `None`. `None` requiert HTTPS et est réservé à un frontend véritablement cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | Attribut `Secure` sur le cookie de rafraîchissement. Sécurisé par défaut ; `AUTH_COOKIE_SECURE=false` pour du HTTP simple — par exemple un déploiement sur une adresse LAN locale où le navigateur ignorerait sinon le cookie et où la session expirerait en même temps que le jeton d'accès sans générer d'erreur. Émet un avertissement au démarrage. `http://localhost` n'en a pas besoin. | `true` |
| `GOOGLE_CLIENT_ID` | Identifiant client Google OAuth (validation backend) | — |
| `GOOGLE_CLIENT_SECRET` | Secret client Google OAuth | — |
| `GITHUB_CLIENT_ID` | Identifiant client GitHub OAuth | — |
| `GITHUB_CLIENT_SECRET` | Secret client GitHub OAuth | — |
| `MICROSOFT_CLIENT_ID` | Identifiant client Microsoft OAuth | — |
| `MICROSOFT_CLIENT_SECRET` | Secret client Microsoft OAuth | — |
| `LINKEDIN_CLIENT_ID` | Identifiant client LinkedIn OAuth | — |
| `LINKEDIN_CLIENT_SECRET` | Secret client LinkedIn OAuth | — |
| `FACEBOOK_CLIENT_ID` | Identifiant client Facebook OAuth | — |
| `FACEBOOK_CLIENT_SECRET` | Secret client Facebook OAuth | — |
| `TWITTER_CLIENT_ID` | Identifiant client X/Twitter OAuth | — |
| `TWITTER_CLIENT_SECRET` | Secret client X/Twitter OAuth | — |
| `DISCORD_CLIENT_ID` | Identifiant client Discord OAuth | — |
| `DISCORD_CLIENT_SECRET` | Secret client Discord OAuth | — |
| `GITLAB_CLIENT_ID` | Identifiant client GitLab OAuth. Le paramètre `baseUrl` d'une instance auto-hébergée n'a pas de variable d'environnement dédiée — configurez GitLab dans le bloc `auth` pour cela. | — |
| `GITLAB_CLIENT_SECRET` | Secret client GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | Identifiant client Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Secret client Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | Identifiant client Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Secret client Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | Identifiant client Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Secret client Spotify OAuth | — |
| `APPLE_CLIENT_ID` | Apple Services ID, pour la connexion web. Il est public et publié dans `GET /auth/config`. Apple n'a pas de secret client statique, car Rebase signe un JWT ES256 à courte durée de vie pour chaque échange de jetons. Apple nécessite donc `APPLE_TEAM_ID`, `APPLE_KEY_ID` et `APPLE_PRIVATE_KEY`, en plus de cette variable ou de `APPLE_BUNDLE_IDS`, et ne configure rien sans eux. | — |
| `APPLE_BUNDLE_IDS` | Identifiants de bundles séparés par des virgules pour les applications natives iOS/macOS dont les codes Sign in with Apple sont acceptés. | — |
| `APPLE_TEAM_ID` | Apple Developer Team ID, émetteur du JWT. | — |
| `APPLE_KEY_ID` | Identifiant de clé de la clé privée enregistrée auprès d'Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenu du fichier de clé privée `.p8`, sauts de ligne inclus (les échappements `\n` sont acceptés). | — |
| `REBASE_SERVICE_KEY` | Clé d'API administrateur statique. Contourne l'authentification JWT standard pour les appels inter-serveurs lorsqu'elle est transmise via `Authorization: Bearer <key>`. (Générée automatiquement en développement). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Clé publique de la plateforme d'hébergement (PEM, EC P-256) avec laquelle les jetons de plateforme `rpt_` sont vérifiés ; accepte plusieurs blocs PEM lors d'une rotation de clés. La plateforme la définit lors du déploiement, et elle ne contient aucun secret. Conjointement avec `REBASE_PLATFORM_TOKEN_AUDIENCE`, elle permet au portail admin d'accepter un jeton de plateforme pour `cron:read`, et pour rien d'autre. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | L'identifiant de projet auquel l'attribut `aud` d'un jeton de plateforme doit correspondre, afin qu'un jeton créé pour un autre projet soit refusé. Si une seule de ces deux variables est définie, le serveur démarre, consigne un avertissement et répond à chaque jeton `rpt_` par un `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_PLATFORM_SIGNIN_URL` | Destination du bouton **Continue with Rebase Cloud** du panneau d'administration : la page du projet dans la console de la plateforme, qui connecte les propriétaires du projet avant de revenir. La plateforme la définit lors du déploiement avec les deux variables ci-dessus ; grâce à elles, `POST /api/auth/platform-signin` accepte le jeton d'une minute `auth:admin-signin` de la plateforme et ouvre une session administrateur. Sans cela, l'accès fonctionne toujours depuis le bouton **Open CMS** de la console, et l'écran de connexion se contente de l'expliquer. | — |
| `REBASE_RATE_LIMIT_STORE` | Emplacement de stockage des compteurs de limitation de débit, pour les routes d'authentification et pour `rateLimit` dans les fonctions personnalisées : `memory` (par processus) ou `sql` (partagé entre les réplicas). Un processus ne pouvant pas déterminer son propre nombre de réplicas, un déploiement avec plusieurs pairs doit le spécifier — trois réplicas avec la valeur par défaut appliquent trois fois la limite. Toute autre valeur **refuse de démarrer** au lieu d'utiliser un repli, `postgres` y compris. | `memory` |
| `AUTH_MAGIC_LINK` | Monte le flux de lien de connexion sans mot de passe (magic link). Nécessite un service d'e-mail configuré, sinon le lien n'a nulle part où aller. | `false` |
| `AUTH_EMAIL_OTP` | Monte la connexion sans mot de passe avec un code à six chiffres envoyé par e-mail. Même exigence d'e-mail que ci-dessus. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Inscription sans mot de passe : une requête de lien magique ou de code e-mail pour une adresse inconnue crée le compte, tant que les inscriptions sont ouvertes. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Comportement lorsqu'un jeton de rafraîchissement est rejoué après sa fenêtre de réutilisation : `reject` (le rejeter, conserver la session) ou `revoke-session` (mettre fin à la connexion). Toute autre valeur empêche le démarrage. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Inscription avec confirmation préalable : aucune connexion par mot de passe n'est permise tant que l'adresse n'a pas été vérifiée. Nécessite le service e-mail ; le démarrage est refusé sans lui. | `false` |
| `CAPTCHA_PROVIDER` | Active la vérification par captcha sur les routes d'authentification : `turnstile` ou `hcaptcha`. Non défini signifie aucun captcha. | — |
| `CAPTCHA_SECRET` | Le secret du fournisseur, utilisé côté serveur pour vérifier le jeton envoyé par le navigateur. Requis dès que `CAPTCHA_PROVIDER` est défini. | — |
| `CAPTCHA_ROUTES` | Routes d'authentification à protéger, séparées par des virgules (par exemple `register,login`). Non défini protège l'ensemble par défaut du fournisseur. | — |

### Stockage (Storage)

<span class="since-badge" data-since="0.35">Depuis 0.35</span>

:::caution[Le stockage n'a pas de sécurité au niveau des lignes (RLS), il nécessite donc un modèle d'accès]
Les tables sont protégées par les politiques RLS de Postgres. Le stockage d'objets n'a pas d'équivalent —
les clés partagent un espace de noms plat unique — ainsi, avec un bucket configuré et aucun modèle d'accès,
le serveur **refuse de démarrer en production**. Répondez à cette exigence avec exactement l'une des options suivantes :
un hook `storageAuthorize` exporté depuis `backend/storage.ts` (ce que fournit le scaffold),
`STORAGE_POLICIES`, `STORAGE_PUBLIC_READ`, ou `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `STORAGE_TYPE` | Backend de stockage : `local`, `s3`, `gcs`, ou `platform` (fichiers dans un préfixe appartenant à la plateforme d'hébergement, transmis via des URLs signées par son broker de stockage ; défini par la plateforme). En production, `local` désactive le stockage sauf si `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Chemin de base pour le stockage local. Un chemin relatif est lu depuis le répertoire d'exécution du serveur : la racine du projet sous `rebase dev`, `backend/` dans un serveur généré par `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Autorise le stockage local en production — uniquement avec un volume persistant contenant `STORAGE_PATH` et les répertoires `<STORAGE_PATH>__<key>` des buckets locaux nommés à ses côtés | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Durée en secondes pendant laquelle l'URL de téléchargement d'un fichier privé est valide — le jeton que `getSignedUrl()` y insère. Au maximum `604800` (une semaine) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Taille maximale de fichier acceptée par la source, en octets, sur chaque chemin d'upload — `__<KEY>` pour une source nommée. Une valeur qui n'est pas un nombre entier d'octets refuse le démarrage | `52428800` (50 Mo) |
| `S3_BUCKET` | Nom du bucket S3 (lorsque `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Région AWS | — |
| `S3_ACCESS_KEY_ID` | Clé d'accès AWS | — |
| `S3_SECRET_ACCESS_KEY` | Clé secrète AWS | — |
| `S3_ENDPOINT` | Point de terminaison S3 personnalisé (pour MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Force les URL de type path-style pour le bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nom du bucket GCS (lorsque `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Projet GCP. Généralement déduit des identifiants. | — |
| `GCS_KEY_FILENAME` | Chemin vers un fichier de clé de compte de service. À omettre sur GCP, où Workload Identity fournit les identifiants. | — |
| `STORAGE_PUBLIC_READ` | Sert chaque objet à tout le monde, sans jeton. Uniquement pour un bucket faisant véritablement office de CDN public. L'une des façons de satisfaire la vérification au démarrage ci-dessus. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permet à tout utilisateur connecté de lire, écrire, lister et supprimer tous les objets. Intitulé `INSECURE` dans l'objet de configuration pour une bonne raison : cela n'est défendable que dans une application mono-tenant où chaque compte a accès à l'ensemble des fichiers. | `false` |
| `STORAGE_POLICIES` | Règles d'accès au stockage au format JSON : `[{ "path", "operations"?, "allow" }]`, `allow` étant `"public"`, `"authenticated"`, `"owner"` ou `{ "roles": [...] }`. Refus par défaut, et satisfait la vérification de démarrage. Une liste invalide bloque le démarrage. Voir [Autorisation du stockage](/docs/backend/storage-authorization/#as-data-storage_policies). | — |
| `STORAGE_BROKER_URL` | Broker de stockage de la plateforme, pour `STORAGE_TYPE=platform`. Défini par la plateforme qui exécute le broker. | — |
| `STORAGE_BROKER_PROJECT` | L'identifiant de projet auquel le broker restreint les fichiers de ce déploiement, pour `STORAGE_TYPE=platform`. Défini par la plateforme. | — |
| `STORAGE_RENDITION_CACHE` | Met en cache les rendus d'images générés (redimensionnements, conversions de formats) au lieu de les produire à chaque requête. | `false` |

### E-mail (Optionnel)
`MAGIC_LINK_URL`.

| Variable | Description |
|----------|-------------|
| `SMTP_HOST` | Hôte du serveur SMTP |
| `SMTP_PORT` | Port du serveur SMTP |
| `SMTP_SECURE` | Active la connexion sécurisée (`true`/`false`) |
| `SMTP_USER` | Nom d'utilisateur SMTP |
| `SMTP_PASS` | Mot de passe SMTP |
| `SMTP_FROM` | Adresse d'expédition pour les e-mails système |
| `SMTP_NAME` | Nom affiché sur l'adresse d'expédition |
| `APP_NAME` | Nom du produit utilisé dans les objets et corps des e-mails (par défaut : `Rebase`) |
| `EMAIL_LOGO_URL` | Logo affiché en haut des modèles d'e-mail par défaut. URL PNG ou JPG absolue en `http(s)` — les clients de messagerie suppriment le SVG et bloquent les URI `data:`. Non défini, une application toujours nommée `Rebase` reçoit le logo Rebase et une application renommée n'en reçoit aucun |
| `MAGIC_LINK_URL` | Destination du lien magique envoyé par e-mail. Une URL de base se voit ajouter `/auth/magic-link?token=…` ; une URL contenant `{token}` représente le lien complet, pour un frontend qui ne dessert pas `/auth/magic-link`. Mettez-la entre guillemets dans `.env`, où un `#` non échappé débute un commentaire : `MAGIC_LINK_URL="https://app.example.com/app.html#ml={token}"`. Une valeur contenant un hash ou un chemin de fichier sans `{token}` génère un avertissement au démarrage. Non défini, la base est `FRONTEND_URL` |

### Pool de connexions à la base de données

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `DB_POOL_MAX` | Nombre maximal de connexions dans le pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Temps en millisecondes pendant lequel une connexion inactive est conservée | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Temps d'attente en millisecondes pour obtenir une connexion | `10000` |
| `DATABASE_DIRECT_URL` | Connexion directe (sans pooling). [Le temps réel](/docs/backend/realtime) en a besoin : `LISTEN`/`NOTIFY` ne survit pas à un pooler de transactions tel que PgBouncer, et sans cela, les notifications de changement sont désactivées avec un avertissement plutôt que perdues silencieusement. Le [worker de jobs](/docs/backend/jobs) y maintient également son `LISTEN` de réveil. Remplit la valeur `directConnectionString` de l'adaptateur Postgres lorsque celle-ci n'est pas définie. | — |
| `DATABASE_READ_URL` | Réplica de lecture, tel qu'un hot standby. Lorsqu'il désigne un autre serveur, les lectures authentifiées (listes, lignes individuelles, totaux, agrégats) y sont traitées sous la même sécurité au niveau des lignes (RLS) ; les écritures, l'authentification, le temps réel, les tâches cron, les jobs, la console SQL et `rebase.sql` restent sur le nœud primaire. Un lecteur venant d'écrire lit sur le nœud primaire pendant `REBASE_READ_STICKY_MS`, et tout le monde fait de même tant que le réplica a plus de `REBASE_READ_MAX_LAG_MS` de retard ou est en échec. Remplit `readConnectionString` de l'adaptateur Postgres si non défini ; jusqu'à la version 0.28 incluse, le pool du réplica était ouvert sans jamais être sollicité. | — |
| `REBASE_READ_STICKY_MS` | Après une écriture, durée pendant laquelle les lectures du même utilisateur sont dirigées vers le nœud primaire, afin qu'une sauvegarde suivie d'un affichage de liste reflète cette sauvegarde. Par instance de serveur. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Délai de réplication au-delà duquel toutes les lectures basculent sur le nœud primaire. | `1000` |
| `DATABASE_POOLED` | `true` lorsque `DATABASE_URL` passe par un pooler en mode transaction comme PgBouncer. Le pool n'envoie alors aucun `search_path` ni `statement_timeout` lors de la connexion (le pooler les refuserait ou les ignorerait) et applique les deux dans chaque transaction ; au démarrage, le rôle de base de données reçoit un `search_path` par défaut de `public` pour les requêtes hors transaction. `DATABASE_DIRECT_URL` devient requis, et le temps réel, le réveil du worker de jobs, la construction des index, le branching et la console SQL l'utilisent tous. L'URL du réplica est également considérée comme utilisant un pool. Utilisez `DATABASE_POOLED__<KEY>` pour une autre source de données. | — |
| `REBASE_DB_POOL_MAX` | Plafond pour chaque pool du processus, appliqué quelle que soit la valeur demandée par chacun. Chiffres bruts uniquement : une valeur malformée est ignorée au lieu de bloquer silencieusement le serveur en mode séquentiel. | — |

### Comportement du runtime

Lu par le runtime — `rebase dev`, `rebase start` et l'image de serveur publiée.
Un projet qui a été éjecté (ejected) gère ces choix dans son propre code.

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `REBASE_RLS_AUDIT` | `true` exécute l'audit planifié de la [sécurité au niveau des lignes](/docs/rls-check#running-it-on-a-schedule), qui signale les tables exposées sans politiques. Le projet doit déclarer `@rebasepro/rls-check` parmi ses dépendances : le runtime n'en fournit pas de copie, et sans ce paquet, le démarrage échoue en le nommant. `false` désactive l'analyse pour ce processus. | — |
| `REBASE_RLS_REQUEST_ROLE` | Le rôle Postgres utilisé pour exécuter les requêtes connectées et anonymes. Attribuez un rôle distinct à chaque projet sur un cluster partagé. Une base de données enregistre le rôle avec lequel elle s'exécute, et un démarrage configuré pour un autre rôle refuse de démarrer jusqu'à ce que `rebase db request-role migrate` l'applique. Voir [Exécution sur une base de données existante ou partagée](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` crée le rôle de requête et autorise la connexion à basculer vers lui ; `never` vous laisse gérer les deux et se contente de les vérifier. | `auto` |
| `REBASE_RLS_GRANTS` | Ce que Rebase accorde au rôle de requête : `schema` (toutes les tables dans les schémas qu'il dessert, plus les privilèges par défaut), `managed` (uniquement les tables qu'il dessert) ou `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` restreint les politiques permissives de Rebase au(x) rôle(s) de requête, de sorte que les autres rôles lisant les mêmes tables n'en bénéficient pas. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` écrit les politiques que seuls le contexte serveur ou un administrateur peuvent valider `TO public`, et exécute les administrateurs avec le rôle de requête. Par défaut, elles sont `TO rebase_admin`, afin que les lectures limitées au propriétaire d'un utilisateur connecté puissent utiliser l'index de propriétaire. Voir [Requêtes admin et `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` supprime la politique de base serveur-ou-admin de chaque table. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` définit également `request.jwt.claims` et `request.jwt.claim.*`, afin que les politiques écrites avec `auth.uid()` voient l'appelant. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | Comportement au démarrage lorsqu'un autre identifiant peut adopter le rôle de requête : `warn`, `refuse` ou `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Chemin de base pour toutes les routes API. Le client doit être configuré à l'identique — voir [Modifier `basePath`](#modifier-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Sert les assets statiques/admin du bundle depuis ce processus. À désactiver si un CDN est placé devant. | `true` |
| `REBASE_STUDIO` | Sert la console Rebase Studio intégrée et autonome sur `/_studio` lorsqu'un bundle statique Studio est disponible. Définissez à `false` pour désactiver. | `true` |
| `REBASE_STUDIO_DIR` | Répertoire contenant la SPA Rebase Studio autonome pré-compilée servie sur `/_studio`. Par défaut `/studio` dans l'image du conteneur. | `/studio` |
| `REBASE_HISTORY` | Enregistre l'[historique des modifications d'entités](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Compresse les réponses en gzip/brotli. | `true` |
| `REBASE_PUSH` | `true` active les [notifications push](/docs/backend/push-notifications/) : les routes `/api/push`, la table `rebase.push_subscriptions` et `rebase.push`. | `false` |
| `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` | La paire de clés VAPID avec laquelle les messages push sont signés. Hors production, une paire est générée et conservée dans `.rebase-dev-secrets.json` si elle n'est pas définie ; en production, le push reste désactivé sans elles. | — |
| `REBASE_VAPID_SUBJECT` | Une adresse `mailto:` ou une URL `https://` que les services de push peuvent contacter. Par défaut, l'origine d'un `REBASE_PUBLIC_URL` en `https`. | — |
| `REBASE_MAX_BODY_SIZE` | Taille maximale du corps de requête, **en octets** (`10485760`, pas `10MB` — une valeur non numérique refuse de démarrer plutôt que de supprimer silencieusement la limite). `0` désactive la limite. | `10485760` (10 Mio) |
| `REBASE_ENABLE_SWAGGER` | La surface OpenAPI. Trois états possibles. Non défini, dans chaque environnement : `/api/docs` est servi aux appelants auxquels `GET /api/schema/tables` décrit les tables, chacun recevant le document des tables qui lui sont présentées, et il n'y a pas d'interface Swagger UI. `true` publie l'ensemble du document pour tout le monde, avec l'**interface** Swagger sur `/api/swagger` hors production (jamais en production). `false` restreint le document derrière l'accès administrateur. | — |
| `REBASE_METRICS` | Expose les métriques Prometheus sur `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Ajoute `includeSubDomains` à l'en-tête `Strict-Transport-Security`, de sorte que les navigateurs refusent le HTTP classique sur chaque sous-domaine de l'hôte pendant six mois — y compris les hôtes que ce processus ne dessert pas. À n'activer que si chaque sous-domaine du domaine est exclusivement en HTTPS. Toute valeur autre que `true`/`false` refuse le démarrage. Voir [En-têtes de sécurité](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Jeton Bearer protégeant `/metrics`. Non défini, le point de terminaison reste ouvert à tout ce qui peut joindre le port — acceptable sur un réseau privé, non recommandé sur un réseau public, comme l'indiquent les journaux de démarrage. | — |
| `REBASE_MIGRATE_ON_BOOT` | Ce que le runtime est autorisé à appliquer au schéma des tables au démarrage. `ensure` (valeur par défaut partout — production comprise) applique la passe **additive** : création des tables, colonnes et types enum manquants, sans jamais en supprimer ni en réécrire. `none` laisse intact le schéma des tables déclarées, mais les tables propres au framework (authentification, clés API, jobs, cron) sont tout de même créées et maintenues à jour ; `REBASE_PROVISION=false` désactive aussi ces dernières. L'image publiée n'accepte que ces deux valeurs et **refuse de démarrer sur `push`**. Dans un [déploiement scindé](/docs/deployment/split-processes), un seul processus a le droit de provisionner, tous les autres rôles doivent donc être configurés sur `none` sous peine de refuser le démarrage. | `ensure` |
| `REBASE_PROVISION` | `false` empêche le runtime de modifier quoi que ce soit dans sa base de données : aucune table, colonne, index, fonction, trigger, politique, rôle ou droit, au démarrage ou après, y compris ceux du framework. Il indique à la place le nom des éléments manquants. Destiné aux bases de données modifiables uniquement par votre propre processus de migration. Voir [Quand seul votre processus de changement peut modifier la base de données](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Seuls `true` et `false` sont acceptés. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Refuse de démarrer si la base de données a été provisionnée pour la dernière fois à partir d'un ensemble de tables différent de celui avec lequel ce processus a été construit. Non défini (ou toute valeur autre que `true`/`1`) émet un simple avertissement. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Refuse de démarrer si un fichier de fonction ou de cron lève une exception ou échoue à l'analyse lors de l'import, en indiquant chaque fichier et la cause, afin qu'un déploiement progressif (rolling deploy) conserve l'ancienne version active. Un redémarrage y est également soumis. Non défini (ou toute valeur autre que `true`) ignore le fichier et sert le reste. Un fichier importé correctement et n'exportant aucune fonction ni job est toujours ignoré sans refus. | skip |
| `REALTIME_CDC` | Capture de changements au niveau base de données : `auto` (lit les changements depuis le WAL si la base le permet, sinon utilise des triggers, sinon bascule au niveau applicatif, en loguant chaque repli au niveau info), `trigger` (le force, avertit si impossible), `wal` (lit les changements depuis le journal write-ahead au lieu des triggers ; requiert `wal_level=logical` et un rôle autorisé à répliquer, bascule sur `trigger` sinon), `off`. Voir [Realtime](/docs/backend/realtime-cdc/). Prévaut sur `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Transport inter-instances pour les canaux de diffusion et la présence : `memory` ou `postgres`. Ignoré si `realtime.bus` a reçu une instance de transport configurée. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Nombre maximal d'abonnements qu'un socket temps réel peut maintenir ; le suivant est rejeté avec `TOO_MANY_SUBSCRIPTIONS`. Doit être un entier positif — toute autre valeur bloque le serveur au démarrage. Prévaut sur `realtime.maxSubscriptionsPerSocket`. Voir [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Nombre maximal de sockets temps réel qu'un utilisateur, ou une clé d'API, peut maintenir ouverts sur une même instance de serveur. Les sockets d'usurpation d'un administrateur sont décomptés de cet administrateur. La connexion suivante est refusée avec `TOO_MANY_SOCKETS` et le socket est fermé (4002) ; le SDK réessaye, ce qui lui permet d'entrer dès qu'un autre se ferme. Doit être un entier positif — toute autre valeur bloque le serveur au démarrage. Prévaut sur `realtime.maxSocketsPerUser`. | Aucune limite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Temps maximal, en ms, pendant lequel une modification attend la réévaluation (refetch) qui la transmet aux abonnés actifs. Une réévaluation attend 300 ms sans changement, et au plus cette durée sous un flux continu d'écritures. Entier positif obligatoire — toute autre valeur arrête le serveur au boot. Prévaut sur `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Durée pendant laquelle le total d'un abonnement à une grande liste peut être réutilisé avant d'être recalculé, en ms ; les frames qui le réutilisent portent `meta.totalAsOf`. Non défini, chaque frame déclenche un recalcul. Prévaut sur `realtime.recountIntervalMs`. | Non défini |
| `REALTIME_RECOUNT_MIN_ROWS` | Le total précédent minimal auquel `REALTIME_RECOUNT_INTERVAL_MS` s'applique ; les listes plus petites sont recalculées à chaque frame. Prévaut sur `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Autorise les valeurs `localhost`/boucle locale sous `NODE_ENV=production`. Désactivé par défaut, afin qu'un démarrage en production échoue explicitement plutôt que de chercher à joindre une base de données inexistante. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` exécute la passe de schéma et s'arrête sans ouvrir de socket — le format adapté à un Job de migration, issu de la même image et du même bundle que le serveur qui le suit. Il crée également les tables qu'un processus de service créerait à la première utilisation, et ne démarre aucun cron ni file d'attente de jobs. Une valeur vide est considérée comme *non définie*, de sorte qu'un `${SOMETHING}` non substitué dans un fichier compose ne puisse pas transformer un déploiement ordinaire en un processus qui migre et refuse de servir. Refusé si combiné avec `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Un chemin de fichier. Une passe de provisionnement (`REBASE_PROVISION_ONLY=true`) y écrit chaque modification de schéma effectuée, dans l'ordre, sous la forme d'un script SQL à examiner et appliquer avec `psql`. Les lignes créées n'y sont pas incluses. Refusé sur un processus en mode serveur. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permet à une machine — un agent, un job CI — d'*appliquer* une modification de schéma via `/api/admin/schema`, et pas seulement d'en planifier une. Désactivé sauf demande explicite : l'identifiant permettant un tel changement est celui le plus susceptible de se trouver dans une variable CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Durée d'exécution maximale d'une fonction personnalisée avant que sa requête ne soit interrompue. Même paramètre que l'option `functionsTimeoutMs`. `0` le désactive. Une fonction déclarant son propre délai (`defineFunction(…, { timeoutMs })`) utilise ce dernier à la place. | `30000` |
| `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` | Délai maximal qu'une fonction peut s'attribuer avec `defineFunction(…, { timeoutMs })`, en ms ; une fonction demandant davantage recevra cette valeur. Nombre positif ; toute autre valeur est interprétée comme non définie. | `300000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` fait en sorte qu'un rejet de promesse non géré termine le processus au lieu de simplement le journaliser. Activé sous un orchestrateur capable de redémarrer le conteneur ; désactivé là où un redémarrage est plus préjudiciable qu'une fuite. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Coupe l'avertissement de démarrage sur une plateforme détectée par le runtime comme scale-to-zero, où un timer se déclenchant sur une instance inactive ne s'exécute sur aucune instance. Ne change rien d'autre : activez-le dès que vous conservez au moins une instance active en continu. | — |
| `TRUSTED_PROXY_HOPS` | Nombre de proxys en amont de ce serveur, permettant au limiteur de débit d'extraire la véritable adresse client depuis `X-Forwarded-For`. Valeur sécurisée par défaut `0` : sans proxy, faire confiance à l'en-tête permettrait à tout appelant d'usurper une identité. | `0` |

:::note[Le provisionnement au démarrage est additif, et n'est pas un outil de migration]
La passe de démarrage s'exécute sans surveillance et sans personne pour relire un diff, elle ne supprimera donc jamais
de colonne, ne réduira pas un type et ne réécrira aucune table. C'est également pour cela que l'image refuse
`REBASE_MIGRATE_ON_BOOT=push` : un push complet calcule un diff et n'hésitera pas à exécuter `DROP COLUMN`,
or le redémarrage d'un conteneur ne doit en aucun cas pouvoir détruire une
colonne de production suite à un simple réordonnancement de conteneurs.

Les modifications destructives ou structurelles restent confinées aux processus supervisés : `rebase db
generate` + `rebase db migrate`, ou `rebase db push` depuis un clone local ou la CI,
qui prévisualise le changement (dry-run), refuse les opérations destructives sans confirmation, et
peut générer une sauvegarde au préalable.
:::

### Déploiements scindés (Split deployments)

Une même image et un même bundle peuvent être démarrés plusieurs fois, chacun prenant en charge
une partie différente du projet. Une seule ligne résume chacun ici, car cette page a pour vocation
de lister chaque variable ; le détail de ce que chaque combinaison *monte et prend en charge* — et quelles
combinaisons refusent de démarrer — se trouve sur
**[Processus scindés](/docs/deployment/split-processes)**.

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `REBASE_ROLE` | Partie assurée par ce processus : `all`, `api`, `functions` ou `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Force l'exécution ou non des tâches planifiées cron sur *ce* processus. Non défini suit le rôle. | — |
| `REBASE_JOB_WORKERS` | Force l'exécution ou non des workers de files de jobs sur ce processus. Non défini suit le rôle. | — |
| `REBASE_FUNCTIONS_ONLY` | Exécute uniquement les fonctions personnalisées mentionnées dans ce processus. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Exécute toutes les fonctions personnalisées sauf celles mentionnées. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Emplacement vers lequel le processus API relaie une requête de fonction qu'il ne traite pas lui-même. Sur un `worker`, destination de ses propres appels `rebase.functions`. Une URL en `http(s)`. | — |

### Surface MCP

Un point de terminaison optionnel (opt-in) Model Context Protocol sur `/mcp`, permettant à un client IA de lire
et écrire dans ce projet **en tant qu'utilisateur connecté**. Désactivé sauf indication contraire, et — contrairement
à toutes les autres surfaces — aucun `REBASE_ROLE` ne l'active : les autres décrivent une
forme de processus, alors que celui-ci relève d'une décision de confier des identifiants à un logiciel
tiers, décision qui doit revenir à un humain plutôt que d'être héritée du rôle attribué à un conteneur.

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `REBASE_MCP_ENABLED` | Active la surface MCP. Nécessite `REBASE_PUBLIC_URL` ; sans elle, la surface refuse de se monter et le signale dans les journaux de démarrage. | `false` |
| `REBASE_PUBLIC_URL` | Origine joignable de l'extérieur pour ce déploiement, ex. `https://app.example.com`. La surface MCP ne peut pas la déduire — extraire l'origine de l'en-tête `Host` transformerait l'identité de l'émetteur, ainsi que l'audience de validation de ses propres jetons, en une valeur fournie par l'appelant. | — |
| `REBASE_MCP_VIEW` | Chemin vers la vue MCP App personnalisée du projet (`rebase-view.html`, générée par `rebaseMcpViewPlugin()`), fournie à Claude à la place de la vue générique pour afficher vos vues, champs et actions personnalisés. Sans cela, le backend cherche aux côtés du frontend qu'il dessert. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Autorise l'enregistrement dynamique de clients OAuth (RFC 7591), afin qu'un client puisse s'enregistrer lui-même. Définissez à `false` pour imposer un enregistrement préalable des clients. | `true` |

### Édition de schéma en direct depuis un bundle

Désactivé sauf si `REBASE_LIVE_SCHEMA_REPOSITORY` est défini. Un bundle compilé ne possède pas
de sources dans `backend/schema` à éditer ; avec ces variables définies, l'éditeur de schéma lit
les sources depuis le dépôt, y committe chaque modification, et exécute son DDL sur
cette base de données. Réservé aux administrateurs, et appliqué par une personne physique sauf si
`REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` indique le contraire. Un dépôt configuré sans
identifiant valide refuse de démarrer. Voir
[Édition de schéma en direct](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Le dépôt GitHub sur lequel committer les changements de schéma, au format `owner/name`. Définir cette variable active la fonctionnalité. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | La branche sur laquelle le commit est effectué. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | Emplacement de `backend/schema` dans ce dépôt, relatif à la racine du dépôt. Un chemin sortant du dépôt empêche le démarrage, tout comme l'ancienne variable supprimée `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Jeton d'accès affiné (fine-grained) avec droits de lecture et d'écriture sur le contenu du dépôt. Définissez cette variable ou les trois variables `_GITHUB_APP_*`, mais pas les deux. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | Identifiant d'une GitHub App, pour committer en tant qu'application plutôt qu'avec un jeton personnel. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | Identifiant d'installation de l'application sur le dépôt. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | Clé privée de l'application : PEM, PEM avec retours à la ligne échappés, ou base64. | — |

### Sauvegardes (Backups)

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `BACKUP_SCHEDULE` | Expression cron pour les sauvegardes planifiées. Non défini signifie que les sauvegardes planifiées sont désactivées. | — |
| `BACKUP_DESTINATION` | Chemin local, ou URL `s3://bucket/prefix` / `gs://bucket/prefix`. Requis avec `BACKUP_SCHEDULE`, qui refuse de s'exécuter sans cela. `rebase db backup` se rabat sur `./backups` à l'endroit où la commande a été exécutée. | — |
| `BACKUP_RETENTION_DAYS` | Supprime les sauvegardes de plus de N jours. Non défini ou `0` conserve tout. | — |
| `BACKUP_KEEP_MINIMUM` | Conserve toujours au moins N sauvegardes parmi les plus récentes, quelle que soit la règle de rétention. | — |
| `PG_DUMP_PATH` | Remplace le binaire `pg_dump` — il doit correspondre à la version majeure du serveur ou être plus récent. | — |
| `PG_RESTORE_PATH` | Remplace le binaire `pg_restore`. | — |
| `PSQL_PATH` | Remplace le binaire `psql` exécuté par `rebase db restore --clean` pour effectuer la restauration en une seule transaction. | — |
| `PG_DUMPALL_PATH` | Emplacement de `pg_dumpall`, lorsqu'il n'est pas présent dans le `PATH`. Sans cela — et sans les outils clients PostgreSQL installés — une sauvegarde globale échoue avec une erreur mentionnant cette variable. | — |

L'image officielle du runtime (`rebasepro/server`) intègre les outils clients
PostgreSQL 18, une sauvegarde planifiée y fonctionne donc avec tout serveur jusqu'à Postgres 18.
En dehors de l'image, installez-les vous-même (`apt-get install postgresql-client-18`,
`brew install libpq`).

Les sauvegardes contiennent des secrets et des données personnelles (PII). Utilisez une destination privée avec
chiffrement au repos.

### Livraison de bundle (Bundle delivery)

Un déploiement managé n'embarque pas son code dans l'image : le runtime télécharge un
bundle au démarrage. Ces variables contrôlent lequel et comment.

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `REBASE_BUNDLE` | Chemin vers un répertoire de bundle déjà extrait. Ce que `rebase start` configure localement. | — |
| `REBASE_BUNDLE_URL` | Emplacement où récupérer l'archive du bundle, en l'absence de bundle local. | — |
| `REBASE_BUNDLE_TOKEN` | Identifiant Bearer pour ce téléchargement. À traiter comme un secret : c'est ce qui autorise un tenant à télécharger son propre code. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Emplacement où le bundle récupéré est extrait. Doit être accessible en écriture et persister entre le téléchargement et le démarrage. | — |
| `REBASE_RUNTIME_MODULES` | Modules supplémentaires fournis par l'image du runtime au bundle, au-delà de ceux déclarés par ce dernier. | — |

### Liaisons de ressources (Resource bindings)

Chaque base de données, bucket ou topic déclaré par un projet dans `backend/resources.ts` est
lié par des variables d'environnement nommées d'après lui. Les noms de base sont listés ci-dessous ; une
ressource non définie par défaut ajoute `__` suivi de sa clé en majuscules, ainsi un bucket nommé
`media` lira `S3_BUCKET__MEDIA`. La commande `rebase status`
affiche, par ressource,
la variable exacte lue et son état de définition.

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `REBASE_DRIVER` | Le package npm fournissant le pilote de la source de données, lorsqu'il ne s'agit pas de celui par défaut pour Postgres. Suffixé par source : `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | La chaîne de connexion pour un topic déclaré. Suffixé par topic. | — |

### Environnement propre au CLI

Lu par la commande `rebase`, pas par le serveur. Aucun élément ici n'impacte un déploiement.

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `REBASE_BASE_URL` | Adresse à laquelle `rebase api-keys`, `rebase storage` et `rebase auth reset-password` transmettent la clé de service, dans le shell ou dans `.env`. À renseigner lorsque le serveur fonctionne autrement que via `rebase dev` sur ce projet : `rebase start`, un conteneur, un autre hôte. Non défini, les commandes ciblent le serveur enregistré par `rebase dev` tant qu'il tourne, et n'envoient rien s'il est arrêté. | — |
| `REBASE_SERVICE_KEY` | La clé de service avec laquelle ces commandes s'authentifient, lue depuis le fichier `.env` : la même variable que celle lue par le serveur (voir plus haut). | — |
| `SERVICE_KEY` | Ancienne appellation de cette clé. Si `.env` la contient, `rebase api-keys` et `rebase storage` la liront à la place de `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Fichier `.env` spécifique lu et écrit par le CLI, s'il diffère de celui du projet. | — |
| `REBASE_ROOT_RULES` | `0` empêche `rebase init` et `rebase skills install` d'écrire les règles du projet dans les fichiers `CLAUDE.md` et `AGENTS.md` à la racine du dépôt, utile si vous gérez manuellement ces fichiers d'agents à la racine. | on |
| `REBASE_CLOUD_URL` | Plan de contrôle avec lequel `rebase cloud` communique. | — |
| `REBASE_CLOUD_EMAIL` | Compte avec lequel `rebase cloud login` s'authentifie, évitant l'invite de commande. | — |
| `REBASE_CLOUD_PASSWORD` | Son mot de passe, permettant à un gestionnaire de secrets de le fournir sans laisser de traces dans l'historique du shell. | — |
| `REBASE_TOKEN` | Jeton issu de `rebase cloud tokens create`. S'il est défini, chaque commande `rebase cloud` s'authentifie avec lui au lieu d'utiliser la session `rebase cloud login`, sans lire ni modifier la session enregistrée. Dans un dossier lié par `rebase cloud init --claim`, il est ignoré au profit du token dédié au projet s'il n'a pas de droits sur ce dernier. La méthode recommandée pour lancer `rebase cloud` en CI — voir [CI et agents](/docs/deployment/cloud/#ci-and-agents). Le [serveur MCP](/docs/ai/mcp/) le transmet au CLI invoqué par ses outils cloud, sans jamais l'envoyer à l'application : utilisez `REBASE_API_TOKEN` pour cela. | — |
| `REBASE_DEBUG` | `1` affiche l'erreur sous-jacente et les détails de la requête au lieu du message succinct. La première variable à activer lorsqu'une commande `rebase cloud` échoue sans explication claire. | — |
| `REBASE_ATLAS_DEV_URL` | Base de données vide utilisée pour calculer les plans de `rebase db push`, `db generate` et `db migrate`, en remplacement de la base `<db>_dev_diff` générée à côté de `DATABASE_URL`. Rebase ne crée ni ne supprime la base indiquée ici, et refuse une valeur identique à `DATABASE_URL`. Sur la base de développement managée, le CLI configure une instance PGlite volatile en mémoire qui lui est propre. Utile lorsque `CREATE DATABASE` n'est pas autorisé. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` ne démarre aucune base de données et ne provisionne rien — vous devez fournir la vôtre. Équivalent à `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fixe le port du serveur de développement frontend, qui est sinon calculé par `rebase dev` d'après le chemin du projet. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Durée maximale d'attente de `rebase dev` pour que le backend se signale prêt avant d'indiquer qu'il n'a pas démarré. `0` désactive ce signalement. | `30000` |
| `DATABASE_PASSWORD` | Mot de passe injecté par `rebase dev --docker` dans la chaîne de connexion déduite de `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | Convention standard inter-outils. Si défini sur une valeur autre que `0`, le CLI n'envoie aucune télémétrie. | — |
| `REBASE_TELEMETRY_DISABLED` | Identique, spécifique à Rebase. Ne requiert aucun fichier particulier, idéal pour la CI ou au sein d'une image conteneurisée. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Point de terminaison vers lequel envoyer la télémétrie, pour un collecteur auto-hébergé. | — |

## Secrets en développement

`JWT_SECRET` est obligatoire en production. Cette variable ainsi que `REBASE_SERVICE_KEY`
sont générées automatiquement hors production, vous permettant de démarrer sans configuration initiale.

Ces valeurs générées sont mises en cache dans `.rebase-dev-secrets.json`, aux côtés de
`.rebase-dev-port` et `.rebase-dev-url`, et sont ignorées par git avec eux. Auparavant, elles
étaient régénérées à chaque démarrage — redémarrer le serveur de développement déconnectait donc
votre session et invalidait toute clé d'API créée juste avant.

- Définissez l'une ou l'autre variable explicitement pour utiliser la vôtre ; rien n'est alors mis en cache ni relu.
- Redirigez l'emplacement du cache avec `REBASE_DEV_SECRETS_FILE` — un chemin, qui constitue la
  seule variable de cette section que vous pourriez avoir besoin de définir volontairement.
- Supprimez le fichier pour renouveler les deux secrets. Le démarrage suivant en générera un nouveau.
- Si le fichier ne peut pas être écrit — par exemple dans un conteneur en lecture seule — le serveur démarre
  tout de même avec un secret éphémère, exactement comme auparavant.

Aucune mise en cache n'a lieu en production, ni sous un exécuteur de tests. En production, rien
n'est généré automatiquement : un démarrage sans `JWT_SECRET` échoue en indiquant la variable manquante,
conformément au fonctionnement attendu :

```
The environment is not valid:
  JWT_SECRET: is required
```

## Objet de configuration Backend

Le `RebaseBackendConfig` passé à `initializeRebaseBackend()` offre un contrôle programmatique :

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";
import { env } from "./env";

await initializeRebaseBackend({
    app,
    server,
    schemaDir: "./schema",     // The backend/schema directory: the tables, and what the schema editor writes
    basePath: "/api",        // Base path for all API routes (default: "/api")

    database: createPostgresAdapter({
        connection: db,
        schema: { tables, enums, relations }
    }),

    auth: {                  // Authentication config
        jwtSecret: env.JWT_SECRET,
        accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
        refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
        requireAuth: true,    // Require auth for data API (default: true)
        allowRegistration: env.ALLOW_REGISTRATION,
        google: env.GOOGLE_CLIENT_ID
            ? {
                clientId: env.GOOGLE_CLIENT_ID,
                clientSecret: env.GOOGLE_CLIENT_SECRET
            }
            : undefined,
        serviceKey: env.REBASE_SERVICE_KEY
    },

    // No bucket configured in production means storage is off, not local:
    // uploads answer 501 rather than landing on a filesystem that is erased
    // on the next redeploy.
    storage: env.STORAGE_TYPE === "s3"
        ? {
            type: "s3",
            bucket: env.S3_BUCKET!,
            region: env.S3_REGION,
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
            endpoint: env.S3_ENDPOINT
        }
        : env.STORAGE_TYPE === "gcs"
            ? {
                type: "gcs",
                bucket: env.GCS_BUCKET!,
                projectId: env.GCS_PROJECT_ID,
                keyFilename: env.GCS_KEY_FILENAME
            }
            : isProduction && !env.FORCE_LOCAL_STORAGE
                ? undefined
                : {
                    type: "local",
                    basePath: env.STORAGE_PATH || "./uploads"
                },

    history: true,           // Enable entity change history

    enableSwagger: true,     // Publish the whole OpenAPI document at /api/docs to everyone

    logging: {
        level: "info"
    }
});
```

Les mêmes options,
sans `app`, `server` et `basePath` et avec une propriété `provision` requise, créent un
backend qui ne sert rien tant que vous ne l'avez pas monté : `createRebaseBackend`. Voir
[Intégration d'un serveur personnalisé](/docs/backend/custom-server/).

### Modifier `basePath`

`basePath` déplace chaque route de l'API, le client doit donc en être informé de la même façon —
faute de quoi il continuera d'appeler `/api/...` et obtiendra des erreurs 404 partout :

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

Le panneau d'administration récupère ce réglage depuis le client qui lui est fourni ; aucun autre paramètre
n'est requis. Si vous composez une URL de requête manuellement, concaténez-la depuis le client plutôt
que d'écrire `/api` en dur :

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Dépannage

### Permission refusée dans l'éditeur SQL (`permission denied for table <name>`)

* **Symptômes :** Les requêtes personnalisées exécutées dans l'éditeur SQL de Rebase Studio échouent avec `cause: error: permission denied for table <name>`, bien que la vue tableur du CMS parvienne à charger les données.
* **Cause :** Par défaut, Rebase essaie d'exécuter les requêtes de l'éditeur SQL en basculant temporairement de rôle de base de données pour correspondre au rôle applicatif de l'utilisateur actif (par ex. `SET LOCAL ROLE "admin"`). Si vous utilisez un système d'authentification sur mesure où les rôles n'existent que dans les tables de la base de données et non comme rôles PostgreSQL réels, le changement de rôle échoue ou les privilèges de base de données sont manquants. La vue tableur du CMS s'exécute avec l'utilisateur propriétaire de la connexion par défaut et contourne cette restriction.
* **Solution :** Ajoutez `DISABLE_DB_ROLE_SWITCHING=true` à votre configuration `.env` backend. Cela force Rebase à exécuter les requêtes de l'éditeur SQL avec les privilèges du propriétaire de la connexion (généralement un superuser/owner). L'éditeur SQL affiche alors, au-dessus des résultats, qu'ils ont été lus en tant que propriétaire de la connexion, et grise son sélecteur de rôle.

### Échec de récupération du schéma dans l'éditeur SQL (`Cross-database execution requires adminConnectionString`)

* **Symptômes :** Studio ne parvient pas à charger l'arborescence du schéma, ou l'éditeur SQL renvoie `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Cause :** Rebase nécessite des privilèges d'administration pour inspecter les catalogues système de la base de données et exécuter les commandes d'administration. Si `adminConnectionString` n'est pas fourni au bootstrapper, ou si `getAdmin()` est surchargé pour renvoyer `undefined`, ces opérations échouent.
* **Solution :** Assurez-vous que `adminConnectionString` est configuré lors de l'initialisation du bootstrapper backend :
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Étapes suivantes

- **[Déploiement](/docs/getting-started/deployment)** — Guide de déploiement en production
- **[Aperçu du Backend](/docs/backend)** — Référence complète de la configuration backend
