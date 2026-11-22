---
sourceHash: 21a2078200ddc8c0
title: Environnement et configuration
sidebar_label: Configuration
description: Toutes les variables d'environnement et options de configuration pour les projets Rebase.
---

## Variables d'environnement

Toute la configuration s'effectue via des variables d'environnement dans votre fichier `.env` situé à la racine du projet.

> **Important** : Rebase valide les variables d'environnement avec **Zod** au démarrage. Si
> un élément requis est manquant ou mal formé (une URL qui n'est pas une URL, un port qui
> n'est pas un nombre), le serveur refuse de démarrer et indique la variable concernée.
>
> L'emplacement du schéma dépend de la manière dont vous exécutez le backend. Un projet démarré par
> le runtime — `rebase dev`, `rebase start`, l'image publiée — utilise le
> schéma appartenant au runtime (`loadBootEnv` dans `@rebasepro/server`), qui est l'union
> de chaque tableau ci-dessous. Un projet ayant exécuté [`rebase eject`](/docs/cli)
> possède un fichier `backend/src/env.ts` appelant `loadEnv({ extend })`, et peut y ajouter ses propres
> variables typées.

### Requises

| Variable | Description | Exemple |
|----------|-------------|---------|
| `DATABASE_URL` | Chaîne de connexion PostgreSQL. **Facultatif en développement** — non définie, `rebase dev` exécute un PostgreSQL géré pour le projet, avec ses données sous `.rebase/`. Requise partout ailleurs. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Clé secrète pour signer les jetons JWT. Utilisez une chaîne aléatoire robuste (min. 32 caractères). **Requise en production** (générée automatiquement en développement). | `a1b2c3d4e5...` |

> **Sur une base de données gérée, `sslmode=require` ne signifie pas toujours ce qu'il paraît.**
>
> Pour `psql` et tous les outils libpq, `require` signifie « chiffré, certificat non
> vérifié ». Le pilote Node sur lequel fonctionne Rebase l'interprète comme `verify-full`, de sorte qu'une
> base de données dont le certificat n'a été signé par aucune autorité publique — courant sur les instances
> Postgres gérées — rejette le runtime avec `self-signed certificate`, tandis que `psql`
> se connecte avec la même URL. Le runtime et les commandes `rebase db` s'arrêtent avec un
> message explicatif.
>
> Choisissez une option :
>
> - **`sslmode=no-verify`** — chiffré, non vérifié : ce que `require` signifie pour
>   libpq. C'est une syntaxe spécifique à node-postgres que libpq ne possède pas, donc `psql`, `pg_dump`
>   et Atlas la rejettent avec `invalid sslmode value: "no-verify"`. Les propres
>   commandes de Rebase (`rebase db push`, `rebase db backup`, `rebase db restore`) la leur
>   transmettent sous la forme `sslmode=require`, fonctionnant ainsi avec l'URL telle que configurée ; pour
>   `psql` manuellement, remplacez-la par `sslmode=require`.
> - **`sslmode=verify-full&sslrootcert=/path/to/ca.pem`** — vérifié par rapport au
>   certificat de l'autorité de certification (CA) du fournisseur. Identique pour chaque outil.
>
> `uselibpqcompat=true&sslmode=require`, suggéré par l'avertissement du pilote
> Node lui-même, fonctionne également pour le runtime ; les commandes de Rebase retirent `uselibpqcompat`
> avant de transmettre l'URL aux outils libpq, qui le rejetteraient.

### Frontend

| Variable | Description | Valeur par défaut |
|----------|-------------|---------|
| `VITE_API_URL` | URL de l'API backend pour le SDK typé. **À définir uniquement en développement** — voir ci-dessous. | origine de la page |
| `VITE_GOOGLE_CLIENT_ID` | ID client Google OAuth. Active « Se connecter avec Google ». | — |


> **Laissez `VITE_API_URL` non défini dans les builds de production.**
>
> En développement, le frontend et le backend sont des origines distinctes, le serveur
> de dev injecte donc cette variable. En production, le backend Rebase sert la SPA, de sorte que
> l'API correspond à l'origine même de la page et le client la résout automatiquement ainsi.
>
> Intégrer une URL absolue dans un bundle de production fonctionne jusqu'à ce qu'un second
> nom d'hôte pointe vers la même application : un domaine personnalisé charge alors la page depuis
> `example.com` et appelle l'API sur `example.rebase.website`, ce qui est
> cross-origin, et chaque requête échoue donc au preflight. Autoriser l'origine dans CORS
> ne résout **pas** le problème non plus — le cookie de rafraîchissement est en `SameSite=Lax` et n'est
> pas envoyé en cross-site, vous supprimeriez donc les erreurs de la console tout en ayant toujours une
> authentification défaillante. Non définie, chaque domaine pointant vers l'application fonctionne sans aucune
> configuration CORS.

### Backend

| Variable | Description | Valeur par défaut |
|----------|-------------|---------|
| `PORT` | Port du serveur HTTP backend. Lu par `rebase start`. `rebase dev` le lit **uniquement depuis l'environnement du shell** — un `PORT` dans `.env` n'y est pas lu, car le port est résolu avant le chargement de ce fichier — et lie sinon un port dérivé du chemin du projet, permettant à plusieurs projets de s'exécuter simultanément. `rebase dev --port` a la priorité sur les deux, et la bannière de démarrage indique le palier utilisé. | `3001` |
| `LOG_LEVEL` | Verbosité des logs : `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Affiche le SQL derrière une ligne `Failed query: [redacted]`. Chaque instruction en échec est caviardée par défaut, car une requête échouée contient ses paramètres liés — un e-mail, un hash de mot de passe. Définissez-la à `true` lors du diagnostic d'une panne de DDL, de RLS ou de capture de changements. Ignoré lorsque `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Environnement : `development`, `production` ou `test` | `development` |
| `CORS_ORIGINS` | Liste d'origines autorisées séparées par des virgules. **Requis en production** à moins que `FRONTEND_URL` ne soit défini : un démarrage en production sans l'un ni l'autre refusera de se lancer. En développement, il est *ajouté à* localhost — voir ci-dessous. | — |
| `FRONTEND_URL` | URL de l'application frontend. Utilisé comme alternative à CORS_ORIGINS, dans les deux environnements. | — |
| `ADMIN_CONNECTION_STRING` | Chaîne de connexion à la base de données avec privilèges d'administration (utilisée pour l'introspection de schéma et les opérations d'administration). La base de données qu'elle désigne n'est ni celle que la console SQL considère comme actuelle, ni celle qu'une nouvelle branche copie par défaut : les deux correspondent à la base de données sur laquelle repose la propre connexion de l'application (voir `REBASE_BRANCH_PARENT_DATABASE` pour un serveur sur une branche). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Désactive le changement de rôle PostgreSQL dans l'éditeur SQL (utile pour l'authentification personnalisée où les rôles de base de données ne sont pas mappés). La console SQL de Studio indique alors que les lignes ont été lues en tant que propriétaire de la connexion, le nomme, et grise son sélecteur de rôle. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | La base de données à partir de laquelle la branche sur laquelle ce serveur s'exécute a été copiée. `rebase dev` la définit sur un checkout [basculé sur une branche](/docs/backend/branching/#cli-integration). Un serveur qui en dispose conserve le registre des branches sur cette base de données et copie les nouvelles branches à partir de celle-ci par défaut, de sorte que le volet Branches de Studio affiche les branches de la base de données principale. | — |

#### CORS en développement

Le développement autorise **localhost, plus tout ce que `CORS_ORIGINS` (ou `FRONTEND_URL`)
désigne** — la même liste que la production utilise, avec localhost ajouté plutôt que
substitué. La variable fonctionne donc de la même manière dans les deux environnements, et les
cas qui la nécessitent en développement sont les cas habituels :

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Une origine qui n'est ni localhost ni listée est refusée, et le refus est
consigné **une seule fois par origine** avec la ligne exacte qui l'autoriserait. Ce refus n'est
pas une simple prudence excessive : l'API transmettant des identifiants (credentials), renvoyer un
`Origin` arbitraire permettrait à n'importe quel site visité par le développeur d'effectuer des
requêtes authentifiées contre le serveur de dev avec sa session et d'en lire les
réponses.

### Authentification

| Variable | Description | Valeur par défaut |
|----------|-------------|---------|
| `JWT_SECRET` | Secret pour la signature JWT (requis en production, généré automatiquement en développement) | — |
| `JWT_PRIVATE_KEY` | Clé privée PEM pour signer les jetons d'accès de manière asymétrique (RS256), afin que toute entité détenant le JWKS puisse vérifier une session sans pouvoir en forger une. Accepte un PEM avec de vrais sauts de ligne, un PEM avec des échappements `\n`, ou la totalité du PEM en base64. Sans cela, les jetons restent en HS256. | — |
| `JWT_KEY_ID` | Nomme `JWT_PRIVATE_KEY` dans l'en-tête du jeton et dans le JWKS. Modifiez-le chaque fois que la clé change — la rotation dépend de la capacité à distinguer l'ancienne clé de la nouvelle. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Durée de vie du jeton d'accès | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Durée de vie du jeton de rafraîchissement. Glissante — chaque rotation la prolonge, cela régit donc la durée de survie d'une session à l'**inactivité**. Définissez `400d` pour des sessions qui survivent à une longue absence ; les navigateurs plafonnent le cookie de rafraîchissement à cette valeur. | `30d` |
| `ALLOW_REGISTRATION` | Autoriser de nouveaux utilisateurs à s'inscrire (`true`/`false`). Hors production, le **premier** utilisateur peut toujours s'inscrire, quoi qu'il soit indiqué ici — une table d'utilisateurs vide doit accepter quelqu'un, et cette personne devient administrateur. En production (`NODE_ENV=production`), cette fenêtre est fermée : une table vide refuse l'inscription d'amorçage avec `SETUP_REQUIRED`, un premier compte créé via l'inscription ouverte est un compte ordinaire, et l'administrateur est désigné par `REBASE_ADMIN_EMAIL` ci-dessous ou assigné via la clé de service. Le fichier `.env.example` du scaffold le définit à `true` ; la valeur par défaut du framework est désactivée. | `false` |
| `DISABLE_SELF_REGISTRATION` | Coupe-circuit. Ferme la fenêtre d'amorçage du premier utilisateur que `ALLOW_REGISTRATION=false` laisse délibérément ouverte hors production, de sorte que l'inscription reste fermée même face à une base de données vide. À associer avec `REBASE_ADMIN_EMAIL` ci-dessous, faute de quoi le déploiement n'aura aucun moyen de créer son premier appelant authentifié. Tous les artefacts de déploiement livrés le définissent. | — |
| `REBASE_ADMIN_EMAIL` | Adresse e-mail du premier compte administrateur, créé au démarrage **pendant que la table des utilisateurs est encore vide** et jamais par la suite. C'est ainsi qu'un déploiement de production obtient son administrateur : l'opérateur désigne le premier compte au lieu de faire la course contre Internet. Le démarrage émet un avertissement lorsque la table est vide en production et que cette variable n'est pas définie. | — |
| `REBASE_ADMIN_PASSWORD` | Mot de passe de ce compte. Au moins 12 caractères, sinon il est refusé et le compte n'est pas créé. Modifiez-le après la première connexion. | — |
| `MFA_ENCRYPTION_KEY` | Chiffre chaque secret TOTP stocké. Non définie, les secrets sont chiffrés avec `JWT_SECRET` à la place et le démarrage émet un avertissement unique — ainsi, la rotation de `JWT_SECRET` déconnecte tout le monde *et* rend impossible le déchiffrement de chaque authentificateur enregistré. Définissez une clé dédiée (32+ caractères aléatoires) avant toute inscription. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | La clé dont on s'éloigne lors d'une rotation. Définissez les deux lors d'une rotation : les nouveaux secrets sont écrits avec `MFA_ENCRYPTION_KEY` et les secrets existants restent lisibles, afin que personne ne soit exclu de son propre compte en pleine rotation. Supprimez-la une fois que chaque secret a été rechiffré. | — |
| `ALLOW_ANONYMOUS` | Activer la connexion anonyme (`POST /api/auth/anonymous`). Optionnel (opt-in), et délibérément non conditionné par `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Exiger une authentification pour l'API de données. Définissez à `false` pour une surface de lecture entièrement publique — la RLS continue de s'appliquer. | `true` |
| `AUTH_DEFAULT_ROLE` | Rôle attribué à un utilisateur nouvellement inscrit lorsqu'aucun n'est spécifié. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Monte `POST /api/auth/find-user`, qui résout un e-mail en un profil public minimal (`uid`, `displayName`, `photoURL`) pour les flux d'invitation par e-mail. Appelants authentifiés uniquement, et ne renvoie jamais l'e-mail, les rôles ou les métadonnées de l'utilisateur trouvé. Désactivé par défaut : il s'agit d'une surface d'énumération. | `false` |
| `AUTH_COOKIE_SAME_SITE` | Directive `SameSite` sur le cookie de rafraîchissement : `Strict`, `Lax` ou `None`. `None` requiert HTTPS et est réservé à un frontend véritablement cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | Directive `Secure` sur le cookie de rafraîchissement. Sécurisé par défaut ; `AUTH_COOKIE_SECURE=false` pour du simple HTTP — un déploiement sur une adresse réseau local où le navigateur rejetterait sinon le cookie et où la session s'éteindrait à l'expiration du jeton d'accès sans erreur. Émet un avertissement au démarrage. `http://localhost` n'en a pas besoin. | `true` |
| `GOOGLE_CLIENT_ID` | ID client Google OAuth (validation backend) | — |
| `GOOGLE_CLIENT_SECRET` | Secret client Google OAuth | — |
| `GITHUB_CLIENT_ID` | ID client GitHub OAuth | — |
| `GITHUB_CLIENT_SECRET` | Secret client GitHub OAuth | — |
| `MICROSOFT_CLIENT_ID` | ID client Microsoft OAuth | — |
| `MICROSOFT_CLIENT_SECRET` | Secret client Microsoft OAuth | — |
| `LINKEDIN_CLIENT_ID` | ID client LinkedIn OAuth | — |
| `LINKEDIN_CLIENT_SECRET` | Secret client LinkedIn OAuth | — |
| `FACEBOOK_CLIENT_ID` | ID client Facebook OAuth | — |
| `FACEBOOK_CLIENT_SECRET` | Secret client Facebook OAuth | — |
| `TWITTER_CLIENT_ID` | ID client X/Twitter OAuth | — |
| `TWITTER_CLIENT_SECRET` | Secret client X/Twitter OAuth | — |
| `DISCORD_CLIENT_ID` | ID client Discord OAuth | — |
| `DISCORD_CLIENT_SECRET` | Secret client Discord OAuth | — |
| `GITLAB_CLIENT_ID` | ID client GitLab OAuth. Le `baseUrl` d'une instance auto-hébergée n'a pas d'équivalent en variable d'environnement — configurez GitLab dans le bloc `auth` pour cela. | — |
| `GITLAB_CLIENT_SECRET` | Secret client GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | ID client Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Secret client Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | ID client Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Secret client Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | ID client Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Secret client Spotify OAuth | — |
| `APPLE_CLIENT_ID` | Apple Services ID, pour la connexion web. Il est public et publié dans `GET /auth/config`. Apple n'a pas de secret client statique, car Rebase signe un JWT ES256 à courte durée de vie pour chaque échange de jetons. Apple requiert donc `APPLE_TEAM_ID`, `APPLE_KEY_ID` et `APPLE_PRIVATE_KEY`, en plus de celle-ci ou de `APPLE_BUNDLE_IDS`, et ne configure rien sans elles. | — |
| `APPLE_BUNDLE_IDS` | Identifiants de bundle séparés par des virgules pour les applications natives iOS/macOS dont les codes de Sign in with Apple sont acceptés. | — |
| `APPLE_TEAM_ID` | ID de l'équipe de développement Apple (Team ID), émetteur du JWT. | — |
| `APPLE_KEY_ID` | ID de la clé privée enregistrée auprès d'Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenu du fichier de clé privée `.p8`, avec retours à la ligne inclus (les échappements `\n` sont acceptés). | — |
| `REBASE_SERVICE_KEY` | Clé d'API d'administration statique. Contourne l'authentification JWT habituelle pour les appels de serveur à serveur lorsqu'elle est transmise via `Authorization: Bearer <key>`. (Générée automatiquement en développement). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Clé publique de la plateforme d'hébergement (PEM, EC P-256) contre laquelle les jetons de plateforme `rpt_` sont vérifiés ; plusieurs blocs PEM lors d'une rotation de clé. La plateforme la définit lors du déploiement, et elle ne contient rien de secret. Conjointement avec `REBASE_PLATFORM_TOKEN_AUDIENCE`, elle permet au portail d'administration d'accepter un jeton de plateforme pour `cron:read`, et pour rien d'autre. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | L'ID de projet auquel le champ `aud` d'un jeton de plateforme doit être égal, afin qu'un jeton créé pour un autre projet soit refusé. Si une seule des deux variables est définie, le serveur démarre, consigne un avertissement et répond à chaque jeton `rpt_` par `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_PLATFORM_SIGNIN_URL` | Destination de l'action **Continue with Rebase Cloud** du panneau d'administration : la page du projet dans la console de la plateforme, qui authentifie les propriétaires du projet avant de revenir. La plateforme la définit au déploiement avec les deux ci-dessus ; grâce à elles, `POST /api/auth/platform-signin` accepte le jeton d'une minute `auth:admin-signin` de la plateforme et ouvre une session d'administration. Sans elle, l'accès fonctionne toujours depuis le bouton **Open CMS** de la console, et l'écran de connexion se contente de l'expliquer. | — |
| `REBASE_RATE_LIMIT_STORE` | Emplacement des compteurs de limitation de débit, pour les routes d'authentification et pour `rateLimit` dans les fonctions personnalisées : `memory` (par processus) ou `sql` (partagé entre les réplicas). Un processus ne pouvant pas connaître son propre nombre de réplicas, un déploiement avec plusieurs pairs doit le préciser — trois réplicas avec la valeur par défaut appliquent trois fois la limite. Toute autre valeur **refuse de démarrer** au lieu d'utiliser une solution de secours, y compris `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Monter le flux de lien de connexion sans mot de passe (magic link). Nécessite un service d'e-mail configuré, sinon le lien n'a nulle part où aller. | `false` |
| `AUTH_EMAIL_OTP` | Monter la connexion sans mot de passe avec un code à six chiffres envoyé par e-mail. Même exigence d'e-mail que ci-dessus. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Inscription sans mot de passe : une requête de lien magique ou de code par e-mail pour une adresse inconnue crée le compte, tant que l'inscription est ouverte. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Action lors du rejeu d'un jeton de rafraîchissement au-delà de sa fenêtre de réutilisation : `reject` (le refuser, conserver la session) ou `revoke-session` (mettre fin à la session). Toute autre valeur fait échouer le démarrage. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Inscription avec confirmation préalable : aucune connexion par mot de passe avant que l'adresse ne soit vérifiée. Requiert l'e-mail ; le démarrage est refusé sans lui. | `false` |
| `CAPTCHA_PROVIDER` | Activer la vérification captcha sur les routes d'authentification : `turnstile` ou `hcaptcha`. Non défini signifie aucun captcha. | — |
| `CAPTCHA_SECRET` | Secret du fournisseur, utilisé côté serveur pour vérifier le jeton envoyé par le navigateur. Requis dès que `CAPTCHA_PROVIDER` est défini. | — |
| `CAPTCHA_ROUTES` | Routes d'authentification à protéger séparées par des virgules (par exemple `register,login`). Non défini protège l'ensemble par défaut du fournisseur. | — |

### Stockage

:::caution[Le stockage n'a pas de sécurité au niveau des lignes, il nécessite donc un modèle d'accès]
Les tables sont protégées par la RLS Postgres. Le stockage d'objets n'a pas d'équivalent —
les clés partagent un espace de noms plat unique — ainsi, avec un bucket configuré et aucun modèle d'accès,
le serveur **refuse de démarrer en production**. Remplissez cette condition avec exactement l'un des éléments suivants :
un hook `storageAuthorize` exporté depuis `backend/storage.ts` (fourni par le scaffold),
`STORAGE_PUBLIC_READ`, ou `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Description | Valeur par défaut |
|----------|-------------|---------|
| `STORAGE_TYPE` | Backend de stockage : `local`, `s3` ou `gcs`. En production, `local` désactive le stockage à moins que `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Chemin de base pour le stockage local. Un chemin relatif est lu depuis le répertoire dans lequel le serveur s'exécute : la racine du projet sous `rebase dev`, `backend/` dans un serveur généré par `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Autoriser le stockage local en production — uniquement avec un volume persistant contenant `STORAGE_PATH` et les répertoires `<STORAGE_PATH>__<key>` des buckets locaux nommés à côté | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Durée en secondes pendant laquelle l'URL de téléchargement d'un fichier privé fonctionne — le jeton que `getSignedUrl()` y insère. Au maximum `604800` (une semaine) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Taille maximale de fichier acceptée par la source, en octets, sur chaque chemin d'upload — `__<KEY>` pour une source nommée. Un nombre non entier d'octets refuse le démarrage | `52428800` (50 Mo) |
| `S3_BUCKET` | Nom du bucket S3 (lorsque `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Région AWS | — |
| `S3_ACCESS_KEY_ID` | Clé d'accès AWS | — |
| `S3_SECRET_ACCESS_KEY` | Clé secrète AWS | — |
| `S3_ENDPOINT` | Point de terminaison S3 personnalisé (pour MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Forcer les URL de style chemin pour le bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nom du bucket GCS (lorsque `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Projet GCP. Généralement déduit des identifiants. | — |
| `GCS_KEY_FILENAME` | Chemin d'accès au fichier de clé du compte de service. À omettre sur GCP, où Workload Identity fournit les identifiants. | — |
| `STORAGE_PUBLIC_READ` | Servir chaque objet à tout le monde, sans jeton. Uniquement pour un bucket qui fait réellement office de CDN public. L'une des trois manières de satisfaire la vérification au démarrage ci-dessous. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permettre à tout appelant connecté de lire, écrire, lister et supprimer chaque objet. Nommé `INSECURE` dans l'objet de configuration pour une bonne raison : cela n'est défendable que dans une application mono-tenant où chaque compte a accès à chaque fichier. | `false` |
| `STORAGE_RENDITION_CACHE` | Mettre en cache les rendus d'images générés (redimensionnements, conversions de format) au lieu de les produire à chaque requête. | `false` |

### E-mail (Facultatif)
`MAGIC_LINK_URL`.

| Variable | Description |
|----------|-------------|
| `SMTP_HOST` | Hôte du serveur SMTP |
| `SMTP_PORT` | Port du serveur SMTP |
| `SMTP_SECURE` | Activer la connexion sécurisée (`true`/`false`) |
| `SMTP_USER` | Nom d'utilisateur SMTP |
| `SMTP_PASS` | Mot de passe SMTP |
| `SMTP_FROM` | Adresse de l'expéditeur pour les e-mails système |
| `SMTP_NAME` | Nom d'affichage de l'adresse de l'expéditeur |
| `APP_NAME` | Nom du produit utilisé dans l'objet et le corps des e-mails (par défaut : `Rebase`) |
| `EMAIL_LOGO_URL` | Logo affiché au-dessus des modèles d'e-mails par défaut. URL PNG ou JPG absolue en `http(s)` — les clients de messagerie suppriment le SVG et bloquent les URI `data:`. Si non défini, une application toujours nommée `Rebase` reçoit le logo Rebase et une application renommée n'en reçoit aucun |
| `MAGIC_LINK_URL` | Destination vers laquelle pointe un lien magique envoyé par e-mail. Une URL de base se voit ajouter `/auth/magic-link?token=…` ; une URL contenant `{token}` représente le lien complet, pour un frontend qui ne dessert pas `/auth/magic-link`. Mettez-la entre guillemets dans `.env`, où un `#` non cité démarre un commentaire : `MAGIC_LINK_URL="https://app.example.com/app.html#ml={token}"`. Une valeur contenant un dièse ou un chemin de fichier sans `{token}` déclenche un avertissement au démarrage. Non définie, la base est `FRONTEND_URL` |

### Pool de connexions à la base de données

| Variable | Description | Valeur par défaut |
|----------|-------------|---------|
| `DB_POOL_MAX` | Nombre maximum de connexions dans le pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Millisecondes pendant lesquelles une connexion inactive est conservée | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Millisecondes d'attente pour une connexion | `10000` |
| `DATABASE_DIRECT_URL` | Connexion directe (non mutualisée/sans pooler). [Realtime](/docs/backend/realtime) en a besoin : `LISTEN`/`NOTIFY` ne survit pas à un gestionnaire de pool en mode transaction comme PgBouncer, et sans cela les notifications de changement sont désactivées avec un avertissement plutôt que perdues silencieusement. Le [worker de tâches](/docs/backend/jobs) maintient également son `LISTEN` de réveil dessus. Remplit le `directConnectionString` de l'adaptateur Postgres lorsque celui-ci n'est pas défini. | — |
| `DATABASE_READ_URL` | Réplica de lecture, tel qu'un serveur de secours actif (hot standby). Lorsqu'il désigne un autre serveur, les lectures authentifiées (listes, lignes individuelles, décomptes, agrégats) y sont servies sous la même sécurité au niveau des lignes ; les écritures, connexions, realtime, crons, jobs, la console SQL et `rebase.sql` restent sur le primaire. Un lecteur venant d'écrire lit depuis le primaire pendant `REBASE_READ_STICKY_MS`, et tout le monde le fait tant que le réplica a plus de `REBASE_READ_MAX_LAG_MS` de retard ou est en échec. Remplit le `readConnectionString` de l'adaptateur Postgres lorsque celui-ci n'est pas défini ; jusqu'à la version 0.28 incluse, le pool du réplica était ouvert et jamais lu. | — |
| `REBASE_READ_STICKY_MS` | Après une écriture, durée pendant laquelle les lectures du même utilisateur sont dirigées vers le primaire, afin qu'un enregistrement suivi d'une liste affiche la modification. Par instance de serveur. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Retard du réplica au-delà duquel toutes les lectures sont dirigées vers le primaire. | `1000` |
| `DATABASE_POOLED` | `true` lorsque `DATABASE_URL` passe par un pooler en mode transaction comme PgBouncer. Le pool n'envoie alors aucun `search_path` ou `statement_timeout` à la connexion (le pooler les refuserait ou les ignorerait) et définit les deux dans chaque transaction ; le démarrage attribue au rôle de la base de données un `search_path` par défaut de `public` pour les instructions hors transaction. `DATABASE_DIRECT_URL` devient requis, et le temps réel, le réveil du worker de jobs, la création d'index, le branchement et la console SQL l'utilisent tous. L'URL du réplica est également considérée comme utilisant un pool. `DATABASE_POOLED__<KEY>` pour une autre source de données. | — |
| `REBASE_DB_POOL_MAX` | Plafond pour chaque pool du processus, appliqué indépendamment de ce que chacun demandait. Chiffres uniquement : une valeur malformée est ignorée plutôt que de sérialiser silencieusement le serveur. | — |

### Comportement du runtime

Lu par le runtime — `rebase dev`, `rebase start` et l'image de serveur
publiée. Un projet ayant fait un éject gère ces décisions directement dans son propre code.

| Variable | Description | Valeur par défaut |
|----------|-------------|---------|
| `REBASE_RLS_AUDIT` | `true` exécute l'[audit de sécurité au niveau des lignes (RLS)](/docs/rls-check#running-it-on-a-schedule) planifié, qui signale les tables servies sans politiques. Le projet doit déclarer `@rebasepro/rls-check` parmi ses dépendances : le runtime n'en fournit aucune copie, et sans le paquet le démarrage est refusé en le nommant. `false` désactive le scan sur ce processus. | — |
| `REBASE_RLS_REQUEST_ROLE` | Le rôle Postgres sous lequel s'exécutent les requêtes authentifiées et anonymes. Donnez-en un distinct à chaque projet sur un cluster partagé. Une base de données enregistre le rôle sous lequel elle s'exécute, et un démarrage configuré pour un autre refuse de se lancer jusqu'à ce que `rebase db request-role migrate` le déplace. Voir [Exécution sur une base de données existante ou partagée](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` crée le rôle de requête et autorise la connexion à basculer vers celui-ci ; `never` vous laisse la gestion des deux et se contente de les vérifier. | `auto` |
| `REBASE_RLS_GRANTS` | Ce que Rebase accorde au rôle de requête : `schema` (chaque table dans les schémas qu'il dessert, plus les privilèges par défaut), `managed` (uniquement les tables qu'il dessert) ou `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` restreint les politiques permissives de Rebase au(x) rôle(s) de requête, de sorte que les autres rôles lisant les mêmes tables n'en tirent rien. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` écrit les politiques que seuls le contexte du serveur ou un administrateur peuvent franchir `TO public`, et exécute les administrateurs en tant que rôle de requête. Par défaut, elles sont `TO rebase_admin`, de sorte que les lectures ciblées sur le propriétaire par des utilisateurs connectés peuvent utiliser l'index propriétaire. Voir [Requêtes d'administration et `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` supprime la politique de base serveur-ou-admin de chaque table. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` définit également `request.jwt.claims` et `request.jwt.claim.*`, de sorte que les politiques écrites avec `auth.uid()` voient l'appelant. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | Ce que fait le démarrage lorsqu'un autre identifiant de connexion peut basculer vers le rôle de requête : `warn`, `refuse` ou `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Chemin de base pour chaque route d'API. Le client doit être configuré de la même manière — voir [Modifier `basePath`](#modifier-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Servir les ressources statiques/admin du bundle depuis ce processus. Désactivez-le lorsqu'un CDN est placé devant. | `true` |
| `REBASE_STUDIO` | Servir la console autonome intégrée Rebase Studio sur `/_studio` lorsqu'un bundle statique Studio est disponible. Définir à `false` pour désactiver. | `true` |
| `REBASE_STUDIO_DIR` | Répertoire contenant la SPA Rebase Studio autonome précompilée servie sur `/_studio`. Par défaut `/studio` dans l'image de conteneur. | `/studio` |
| `REBASE_HISTORY` | Enregistrer l'[historique des modifications d'entités](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Réponses gzip/brotli. | `true` |
| `REBASE_PUSH` | `true` active les [notifications push](/docs/backend/push-notifications/) : les routes `/api/push`, la table `rebase.push_subscriptions` et `rebase.push`. | `false` |
| `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` | La paire de clés VAPID avec laquelle les messages push sont signés. Hors production, une paire est générée et conservée dans `.rebase-dev-secrets.json` si elle n'est pas définie ; en production, le push reste désactivé sans elles. | — |
| `REBASE_VAPID_SUBJECT` | Une adresse `mailto:` ou une URL `https://` que les services de push peuvent contacter. Par défaut, l'origine d'un `REBASE_PUBLIC_URL` en `https`. | — |
| `REBASE_MAX_BODY_SIZE` | Corps de requête maximal, **en octets** (`10485760`, et non `10MB` — une valeur qui n'est pas un nombre refuse de démarrer au lieu de supprimer silencieusement la limite). `0` désactive la limite. | `10485760` (10 Mio) |
| `REBASE_ENABLE_SWAGGER` | La surface OpenAPI. À trois états. Non définie, dans tous les environnements : `/api/docs` est servi aux appelants auxquels `GET /api/schema/tables` décrit les tables, chacun recevant le document des tables qui lui sont décrites, et il n'y a pas d'interface utilisateur Swagger. `true` publie l'intégralité du document à tout le monde, avec l'**interface graphique** Swagger sur `/api/swagger` hors production (jamais en production). `false` maintient le document derrière le portail d'administration. | — |
| `REBASE_METRICS` | Exposer les métriques Prometheus sur `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Ajoute `includeSubDomains` à l'en-tête `Strict-Transport-Security`, de sorte que les navigateurs refusent le HTTP simple sur tous les sous-domaines de l'hôte pendant six mois — y compris les hôtes que ce processus ne dessert pas. À n'activer que si chaque sous-domaine du domaine est exclusivement en HTTPS. Toute valeur autre que `true`/`false` refuse de démarrer. Voir [En-têtes de sécurité](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Jeton Bearer protégeant `/metrics`. Non défini laisse le point de terminaison ouvert à tout ce qui peut atteindre le port — acceptable sur un réseau privé, pas sur un réseau public, et les logs de démarrage le signalent. | — |
| `REBASE_MIGRATE_ON_BOOT` | Ce que le runtime peut faire au schéma des tables au démarrage. `ensure` (la valeur par défaut, partout — production comprise) exécute la passe **additive** : crée les tables, colonnes et types enum manquants, sans jamais en supprimer ni en réécrire aucun. `none` laisse le schéma des tables déclarées intact, mais les tables propres au framework (auth, clés API, jobs, cron) sont toujours créées et maintenues à jour ; `REBASE_PROVISION=false` désactive également celles-ci. L'image publiée n'accepte que ces deux valeurs et **refuse de démarrer sur `push`**. Dans un [déploiement fractionné](/docs/deployment/split-processes), exactement un processus peut provisionner, donc chaque autre rôle doit définir `none` sous peine de refuser de démarrer. | `ensure` |
| `REBASE_PROVISION` | `false` fait en sorte que le runtime ne modifie rien dans sa base de données : aucune table, colonne, index, fonction, déclencheur, politique, rôle ou privilège, au démarrage ou ultérieurement, y compris ceux propres au framework. Il signale plutôt ce qui manque par son nom. Pour une base de données que seul votre processus de gestion des changements peut modifier. Voir [Quand seul votre processus de changement peut modifier la base de données](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Seuls `true` et `false` sont acceptés. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Refuser de démarrer lorsque la base de données a été provisionnée pour la dernière fois à partir d'un ensemble de tables différent de celui à partir duquel ce processus a été compilé. Non défini (ou toute valeur autre que `true`/`1`) émet un avertissement à la place. | avertissement |
| `REBASE_REQUIRE_FILES_LOADED` | Refuser de démarrer lorsqu'un fichier de fonction ou de cron lève une exception ou échoue à l'analyse lors de l'importation, en nommant chaque fichier et la raison, afin qu'un déploiement progressif laisse l'ancienne version en service. Un redémarrage y est également soumis. Non défini (ou toute valeur autre que `true`) ignore le fichier et dessert le reste. Un fichier qui s'importe proprement et n'exporte aucune fonction ni job est toujours ignoré, pas refusé. | ignorer |
| `REALTIME_CDC` | Capture de données modifiées (CDC) au niveau de la base de données : `auto` (lit les modifications depuis le WAL lorsque la base de données le permet, sinon utilise des déclencheurs, sinon bascule au niveau applicatif, en consignant chaque repli en info), `trigger` (le force, avertit si impossible), `wal` (lit les modifications depuis le journal de réécriture au lieu des déclencheurs ; nécessite `wal_level=logical` et un rôle autorisé à répliquer, bascule sur `trigger` sinon), `off`. Voir [Realtime](/docs/backend/realtime-cdc/). Prévaut sur `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Transport inter-instances pour les canaux de diffusion et la présence : `memory` ou `postgres`. Ignoré lorsque `realtime.bus` a reçu un transport instancié. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Nombre d'abonnements qu'un socket realtime peut maintenir ; le suivant est refusé avec `TOO_MANY_SUBSCRIPTIONS`. Un nombre entier positif — toute autre valeur interrompt le serveur au démarrage. Prévaut sur `realtime.maxSubscriptionsPerSocket`. Voir [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Nombre de sockets realtime qu'un utilisateur, ou une clé d'API, peut maintenir ouverts sur une instance de serveur. Les sockets d'usurpation d'identité d'un administrateur sont décomptés de l'administrateur. La connexion du suivant est refusée avec `TOO_MANY_SOCKETS` et le socket est fermé (4002) ; le SDK continue de réessayer, il entre donc lorsqu'un autre se ferme. Un nombre entier positif — toute autre valeur interrompt le serveur au démarrage. Prévaut sur `realtime.maxSocketsPerUser`. | Sans plafond |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Durée maximale pendant laquelle une modification attend la réévaluation qui la distribue aux abonnés en direct, en ms. Une réévaluation attend 300 ms sans modification, et au maximum cette durée sous un flux continu d'écritures. Un nombre entier positif — toute autre valeur interrompt le serveur au démarrage. Prévaut sur `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Durée pendant laquelle le total d'un abonnement à une grande liste peut être réutilisé avant d'être recalculé, en ms ; les trames qui le réutilisent comportent `meta.totalAsOf`. Non défini, chaque trame recompte. Prévaut sur `realtime.recountIntervalMs`. | Non défini |
| `REALTIME_RECOUNT_MIN_ROWS` | Le plus petit total précédent auquel `REALTIME_RECOUNT_INTERVAL_MS` s'applique ; les listes plus petites sont recomptées à chaque trame. Prévaut sur `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Autoriser les valeurs `localhost`/boucle locale sous `NODE_ENV=production`. Désactivé, afin qu'un démarrage en production échoue explicitement au lieu de se connecter à une base de données inexistante. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` exécute la passe de schéma et se termine sans ouvrir de socket — le format attendu par un Job de migration, à partir de la même image et du même bundle que le serveur qui le suit. Il crée également les tables qu'un processus en service créerait sinon à la première utilisation, et ne démarre aucun cron ni file d'attente de jobs. Une valeur vide est considérée comme *non définie*, de sorte qu'un `${SOMETHING}` non substitué dans un fichier compose ne peut pas transformer un déploiement ordinaire en un processus qui migre et refuse de servir. Refusé conjointement avec `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Un chemin de fichier. Une exécution de provisionnement (`REBASE_PROVISION_ONLY=true`) y écrit chaque modification de schéma effectuée, dans l'ordre, sous la forme d'un script SQL à examiner et appliquer avec `psql`. Les lignes écrites ne sont pas incluses. Refusé sur un processus qui dessert du trafic. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permet à une machine — un agent, un job CI — d'*appliquer* une modification de schéma via `/api/admin/schema`, et pas seulement d'en planifier une. Désactivé sauf demande explicite : l'identifiant qui permettrait une telle modification est celui le plus susceptible de se trouver dans une variable de CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Durée pendant laquelle une fonction personnalisée peut s'exécuter avant que sa requête ne soit interrompue. Même paramètre que l'option `functionsTimeoutMs`. `0` le désactive. Une fonction qui déclare le sien (`defineFunction(…, { timeoutMs })`) utilise ce dernier à la place. | `30000` |
| `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` | Délai d'expiration maximal qu'une fonction peut déclarer pour elle-même avec `defineFunction(…, { timeoutMs })`, en ms ; une fonction qui en demande davantage reçoit cette valeur. Un nombre positif ; toute autre valeur est interprétée comme non définie. | `300000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` fait en sorte qu'un rejet de promesse non géré termine le processus au lieu de simplement le journaliser. Activé sous un orchestrateur qui vous redémarrera ; désactivé là où un redémarrage est pire qu'une fuite. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Coupe l'avertissement de démarrage sur une plateforme que le runtime détecte comme pouvant être mise à l'échelle à zéro, où un timer qui se déclenche dans une instance inactive ne se déclenche dans aucune instance. Ne change rien d'autre : définissez-le lorsque vous maintenez au moins une instance active. | — |
| `TRUSTED_PROXY_HOPS` | Nombre de proxys placés devant ce serveur, afin que le limiteur de débit puisse lire la véritable adresse client depuis `X-Forwarded-For`. Valeur de sécurité par défaut `0` : sans proxy, faire confiance à l'en-tête permettrait à tout appelant d'usurper une identité. | `0` |

:::note[Le provisionnement au démarrage est additif, et n'est pas un outil de migration]
La passe de démarrage s'exécute sans surveillance, sans personne pour lire un diff, elle ne
supprimera donc jamais de colonne, ne réduira jamais un type et ne réécrira jamais une table.
C'est également pourquoi l'image refuse `REBASE_MIGRATE_ON_BOOT=push` : un push complet
calcule un diff et effectuera volontiers un `DROP COLUMN`, et le redémarrage d'un conteneur
ne doit jamais pouvoir détruire une colonne en production comme effet secondaire d'un réordonnancement.

Les modifications destructrices ou de restructuration restent là où elles peuvent être
examinées : `rebase db generate` + `rebase db migrate`, ou `rebase db push` depuis un checkout
ou un CI, qui effectue un test à blanc (dry-run) de la modification, refuse les actions destructrices
sans confirmation, et peut effectuer une sauvegarde préalable.
:::

### Déploiements fractionnés

Une seule image et un seul bundle peuvent être démarrés plusieurs fois, chacun
desservant une partie différente du projet. Une ligne pour chaque ici, car cette
page a pour vocation de lister toutes les variables ; ce que chaque combinaison
*monte et possède* — et quelles combinaisons refusent de démarrer — se trouve sur
**[Processus fractionnés](/docs/deployment/split-processes)**.

| Variable | Description | Valeur par défaut |
|----------|-------------|---------|
| `REBASE_ROLE` | Quelle partie ce processus dessert : `all`, `api`, `functions` ou `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Remplacer le fait que *ce* processus exécute ou non les timers cron. Non défini suit le rôle. | — |
| `REBASE_JOB_WORKERS` | Remplacer le fait que ce processus exécute ou non les workers de file de jobs. Non défini suit le rôle. | — |
| `REBASE_FUNCTIONS_ONLY` | Ne servir que les fonctions personnalisées spécifiées dans ce processus. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Servir toutes les fonctions personnalisées sauf celles spécifiées. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Emplacement vers lequel le processus API relaie une requête de fonction qu'il ne dessert pas lui-même. Sur un `worker`, destination de ses propres appels à `rebase.functions`. Une URL `http(s)`. | — |

### Surface MCP

Un point de terminaison Model Context Protocol optionnel sur `/mcp`, afin qu'un client IA
puisse lire et écrire dans ce projet **en tant qu'utilisateur connecté**. Désactivé sauf configuration
explicite, et — contrairement à toute autre surface — aucun `REBASE_ROLE` ne l'active : les autres
décrivent la structure d'un processus, tandis que celle-ci est une décision de confier des identifiants
à un logiciel tiers, qui doit être prise par une personne plutôt qu'héritée du rôle d'un conteneur.

| Variable | Description | Valeur par défaut |
|----------|-------------|---------|
| `REBASE_MCP_ENABLED` | Monter la surface MCP. Nécessite `REBASE_PUBLIC_URL` ; sans elle, la surface refuse de se monter et l'indique dans le log de démarrage. | `false` |
| `REBASE_PUBLIC_URL` | L'origine accessible de l'extérieur pour ce déploiement, par ex. `https://app.example.com`. La surface MCP ne peut pas la déduire — extraire l'origine de l'en-tête `Host` ferait de l'identité de l'émetteur, et de l'audience par rapport à laquelle ses propres jetons sont vérifiés, une valeur fournie par l'appelant. | — |
| `REBASE_MCP_VIEW` | Chemin vers la vue d'application MCP propre au projet (`rebase-view.html`, générée par `rebaseMcpViewPlugin()`), servie à Claude à la place de la vue générique afin que ce soient vos vues, champs et actions personnalisés qui soient affichés. Sans cela, le backend cherche à côté du frontend qu'il dessert. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Autoriser l'enregistrement dynamique de clients OAuth (RFC 7591), permettant à un client de s'enregistrer lui-même. Définir à `false` pour exiger que les clients soient enregistrés au préalable. | `true` |

### Modification de schéma en direct depuis un bundle

Désactivé sauf si `REBASE_LIVE_SCHEMA_REPOSITORY` est défini. Un bundle compilé n'a pas de
source `backend/schema` à modifier ; avec ces variables définies, l'éditeur de schéma lit
la source depuis le dépôt, commite chaque modification en retour, et exécute son DDL sur
cette base de données. Réservé aux administrateurs, et appliqué par une personne sauf si
`REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` indique le contraire. Un dépôt désigné sans
identifiant utilisable refuse de démarrer. Voir
[Modification de schéma en direct](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variable | Description | Valeur par défaut |
|----------|-------------|---------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Le dépôt GitHub sur lequel commiter les modifications de schéma, sous la forme `owner/name`. Le définir active la fonctionnalité. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | La branche sur laquelle le commit est effectué. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | Emplacement de `backend/schema` dans ce dépôt, relatif au dépôt. Un chemin sortant du dépôt refuse de démarrer, tout comme la variable supprimée `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Un jeton à granularité fine avec accès en lecture et en écriture au contenu du dépôt. Définissez soit ceci, soit les trois variables `_GITHUB_APP_*`, mais pas les deux. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | L'ID d'une GitHub App, pour commiter en tant qu'application au lieu d'utiliser un jeton. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | L'installation de l'application sur le dépôt. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | La clé privée de l'application : PEM, PEM avec retours à la ligne échappés, ou base64. | — |

### Sauvegardes

| Variable | Description | Valeur par défaut |
|----------|-------------|---------|
| `BACKUP_SCHEDULE` | Expression cron pour les sauvegardes planifiées. Non défini signifie que les sauvegardes planifiées sont désactivées. | — |
| `BACKUP_DESTINATION` | Chemin local, ou URL `s3://bucket/prefix` / `gs://bucket/prefix`. Requis avec `BACKUP_SCHEDULE`, qui refuse de s'exécuter sans cela. `rebase db backup` se rabat sur `./backups` à l'endroit où il a été exécuté. | — |
| `BACKUP_RETENTION_DAYS` | Supprimer les sauvegardes de plus de N jours. Non défini ou `0` conserve tout. | — |
| `BACKUP_KEEP_MINIMUM` | Conserver toujours au moins N sauvegardes les plus récentes, quelle que soit la durée de rétention. | — |
| `PG_DUMP_PATH` | Remplacer le binaire `pg_dump` — il doit correspondre à la version majeure du serveur ou être plus récent. | — |
| `PG_RESTORE_PATH` | Remplacer le binaire `pg_restore`. | — |
| `PSQL_PATH` | Remplacer le binaire `psql` que `rebase db restore --clean` exécute pour faire de la restauration une seule transaction. | — |
| `PG_DUMPALL_PATH` | Emplacement de `pg_dumpall`, lorsqu'il n'est pas dans le `PATH`. Sans lui — et sans les outils clients PostgreSQL installés — une sauvegarde globale échoue avec une erreur nommant cette variable. | — |

L'image runtime officielle (`rebasepro/server`) intègre les outils clients de
PostgreSQL 18, de sorte qu'une sauvegarde planifiée y fonctionne contre n'importe quel serveur jusqu'à Postgres 18.
En dehors de l'image, installez-les vous-même (`apt-get install postgresql-client-18`,
`brew install libpq`).

Les sauvegardes contiennent des secrets et des DCP (données à caractère personnel). Utilisez une destination privée avec
chiffrement au repos.

### Livraison de bundle

Un déploiement géré n'embarque pas son code dans l'image : le runtime récupère un
bundle au démarrage. Ces variables déterminent lequel et comment.

| Variable | Description | Valeur par défaut |
|----------|-------------|---------|
| `REBASE_BUNDLE` | Chemin vers un répertoire de bundle déjà extrait. Ce que `rebase start` définit localement. | — |
| `REBASE_BUNDLE_URL` | Emplacement d'où récupérer l'archive du bundle lorsqu'il n'y en a pas localement. | — |
| `REBASE_BUNDLE_TOKEN` | L'identifiant Bearer pour cette récupération. Traitez-le comme un secret : c'est ce qui autorise un tenant à télécharger son propre code. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Emplacement où un bundle récupéré est extrait. Doit être accessible en écriture et subsister entre la récupération et le démarrage. | — |
| `REBASE_RUNTIME_MODULES` | Modules supplémentaires fournis par l'image runtime au bundle, au-delà de ceux qu'elle déclare elle-même. | — |

### Liaisons de ressources

Chaque base de données, bucket et topic déclaré par un projet dans `backend/resources.ts` est
lié par des variables d'environnement nommées d'après lui. Les noms de base sont ci-dessous ; une
ressource non définie par défaut ajoute `__` et sa clé en majuscules, de sorte qu'un bucket nommé
`media` lit `S3_BUCKET__MEDIA`. `rebase status`
affiche, par ressource,
la variable exacte qu'il lit et si elle est définie.

| Variable | Description | Valeur par défaut |
|----------|-------------|---------|
| `REBASE_DRIVER` | Le paquet npm implémentant le pilote d'une source de données, lorsqu'il ne s'agit pas de celui par défaut de Postgres. Suffixé par source : `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | La chaîne de connexion pour un topic déclaré. Suffixé par topic. | — |

### L'environnement propre au CLI

Lu par `rebase`, non par le serveur. Rien ici n'affecte un déploiement.

| Variable | Description | Valeur par défaut |
|----------|-------------|---------|
| `REBASE_BASE_URL` | Destination où `rebase api-keys`, `rebase storage` et `rebase auth reset-password` envoient la clé de service, dans le shell ou dans `.env`. Définissez-la lorsque le serveur s'exécute d'une autre manière que `rebase dev` dans ce projet : `rebase start`, un conteneur, un autre hôte. Non définie, elles utilisent le serveur que `rebase dev` a enregistré pendant que ce serveur est en cours d'exécution, et n'envoient rien lorsqu'il ne l'est pas. | — |
| `REBASE_SERVICE_KEY` | La clé de service avec laquelle ces commandes s'authentifient, lue depuis `.env` : la même variable que celle lue par le serveur (voir ci-dessus). | — |
| `SERVICE_KEY` | Un ancien nom pour cette clé. Lorsque `.env` la définit, `rebase api-keys` et `rebase storage` la lisent à la place de `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Fichier `.env` lu et écrit par le CLI, lorsqu'il ne s'agit pas de celui du projet. | — |
| `REBASE_ROOT_RULES` | `0` empêche `rebase init` et `rebase skills install` d'écrire les règles du projet dans les fichiers `CLAUDE.md` et `AGENTS.md` à la racine du dépôt, pour une racine dont vous gérez les fichiers d'agents manuellement. | on |
| `REBASE_CLOUD_URL` | Le plan de contrôle avec lequel `rebase cloud` communique. | — |
| `REBASE_CLOUD_EMAIL` | Le compte avec lequel `rebase cloud login` se connecte, au lieu de demander une saisie interactive. | — |
| `REBASE_CLOUD_PASSWORD` | Son mot de passe, afin qu'un gestionnaire de secrets puisse le transmettre sans qu'il atteigne l'historique du shell. | — |
| `REBASE_TOKEN` | Un jeton issu de `rebase cloud tokens create`. Défini, chaque commande `rebase cloud` s'authentifie avec lui au lieu de la session `rebase cloud login`, et ne lit ni n'écrit jamais la session stockée. Dans un répertoire lié par `rebase cloud init --claim`, il est mis de côté au profit du propre jeton de ce projet lorsqu'il ne détient aucune portée sur le projet. La méthode pour exécuter `rebase cloud` en CI — voir [CI et agents](/docs/deployment/cloud/#ci-and-agents). Le [serveur MCP](/docs/ai/mcp/) le transmet au CLI que ses outils cloud génèrent, et ne l'envoie jamais à l'application : définissez `REBASE_API_TOKEN` pour cela. | — |
| `REBASE_DEBUG` | `1` affiche l'erreur sous-jacente et les détails de la requête au lieu du message court. La première chose à définir lorsqu'une commande `rebase cloud` échoue sans explication utile. | — |
| `REBASE_ATLAS_DEV_URL` | La base de données vide par rapport à laquelle `rebase db push`, `db generate` et `db migrate` planifient les modifications, au lieu de la base `<db>_dev_diff` qu'elles créent à côté de `DATABASE_URL`. Rebase ne crée ni ne supprime aucune base de données nommée ici, et en refuse une identique à `DATABASE_URL`. Sur la base de données de développement gérée, le CLI la définit sur une instance PGlite éphémère en mémoire qui lui est propre. À définir là où `CREATE DATABASE` n'est pas accordé. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` ne démarre aucune base de données et ne provisionne rien — vous fournissez la vôtre. Identique à `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fixe le port du serveur de dev frontend, que `rebase dev` déduit autrement du chemin du projet. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Temps pendant lequel `rebase dev` attend que le backend s'annonce avant d'indiquer qu'il n'a pas démarré. `0` désactive le rapport. | `30000` |
| `DATABASE_PASSWORD` | Le mot de passe que `rebase dev --docker` insère dans la chaîne de connexion qu'il déduit de `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | La convention multi-outils. Défini à toute valeur autre que `0`, le CLI n'envoie aucune télémétrie. | — |
| `REBASE_TELEMETRY_DISABLED` | Identique, spécifiquement pour Rebase. Ne nécessite aucun fichier, ce qui en fait l'option privilégiée en CI et dans une image. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Emplacement où la télémétrie est envoyée, pour un collecteur auto-hébergé. | — |

## Secrets en développement

`JWT_SECRET` est requis en production. Cette variable ainsi que `REBASE_SERVICE_KEY` sont
générées pour vous hors production, afin que vous puissiez démarrer sans rien configurer.

Ces valeurs générées sont mises en cache dans `.rebase-dev-secrets.json`, aux côtés de
`.rebase-dev-port` et `.rebase-dev-url`, et sont ignorées par git avec eux. Auparavant, elles
étaient régénérées à chaque démarrage — ainsi, redémarrer le serveur de développement vous déconnectait de
votre propre application et invalidait toute clé d'API que vous veniez de créer.

- Définissez l'une ou l'autre de ces variables explicitement et votre valeur sera utilisée ; rien n'est mis en cache ni lu.
- Pointez le cache ailleurs avec `REBASE_DEV_SECRETS_FILE` — un chemin, et la
  seule variable de cette section que vous définiriez délibérément.
- Supprimez le fichier pour renouveler les deux secrets. Le démarrage suivant en écrira un nouveau.
- Si le fichier ne peut pas être écrit — par exemple dans un conteneur en lecture seule —, le serveur démarre
  tout de même avec un secret éphémère, exactement comme auparavant.

Rien n'est mis en cache en production, ni sous un exécuteur de tests. En production, rien
n'est généré non plus : un démarrage sans `JWT_SECRET` échoue en indiquant la variable, et
cela reste inchangé :

```
The environment is not valid:
  JWT_SECRET: is required
```

## Objet de configuration backend

L'objet `RebaseBackendConfig` transmis à `initializeRebaseBackend()` offre un contrôle programmatique :

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
sans `app`, `server` et `basePath` et avec un `provision` obligatoire, permettent de construire un
backend qui ne dessert rien tant que vous ne le montez pas : `createRebaseBackend`. Voir
[Intégration d'un serveur personnalisé](/docs/backend/custom-server/).

### Modifier `basePath`

`basePath` déplace chaque route d'API, le client doit donc être configuré de la même manière —
sinon il continuera de demander `/api/...` et recevra une 404 pour chaque requête :

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

Le panneau d'administration récupère cette information à partir du client qui lui est fourni ; rien d'autre n'a
besoin d'être configuré. Si vous construisez manuellement une URL de requête, concaténez-la à partir du client plutôt
que d'écrire `/api` vous-même :

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Dépannage

### Erreur de permission dans l'éditeur SQL (`permission denied for table <name>`)

* **Symptômes :** Les requêtes personnalisées exécutées dans l'éditeur SQL de Rebase Studio échouent avec `cause: error: permission denied for table <name>`, alors même que la vue tableur du CMS charge les données correctement.
* **Cause :** Par défaut, Rebase tente d'exécuter les requêtes de l'éditeur SQL en basculant temporairement de rôle de base de données pour correspondre au rôle applicatif de l'utilisateur actif (par ex., `SET LOCAL ROLE "admin"`). Si vous utilisez une authentification personnalisée où les rôles existent uniquement dans les tables de la base de données plutôt que sous forme de véritables rôles PostgreSQL, le changement de rôle échoue ou les privilèges de base de données sont manquants. La vue tableur du CMS s'exécute sous l'utilisateur propriétaire de la connexion par défaut et contourne ce mécanisme.
* **Solution :** Ajoutez `DISABLE_DB_ROLE_SWITCHING=true` à votre fichier `.env` backend. Cela force Rebase à exécuter les requêtes de l'éditeur SQL en utilisant les privilèges du propriétaire de la connexion (généralement un superutilisateur/propriétaire). L'éditeur SQL indique alors, au-dessus des résultats, qu'ils ont été lus en tant que propriétaire de la connexion, et grise son sélecteur de rôle.

### Échec de la récupération du schéma dans l'éditeur SQL (`Cross-database execution requires adminConnectionString`)

* **Symptômes :** Studio ne parvient pas à charger l'arborescence du schéma, ou l'éditeur SQL renvoie `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Cause :** Rebase nécessite des privilèges d'administration pour interroger les catalogues système de la base de données et exécuter des commandes administratives. Si `adminConnectionString` n'est pas fourni au bootstrapper, ou si `getAdmin()` est surchargé pour renvoyer `undefined`, ces opérations échouent.
* **Solution :** Assurez-vous que `adminConnectionString` est configuré lors de l'initialisation du bootstrapper backend :
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Prochaines étapes

- **[Déploiement](/docs/getting-started/deployment)** — Guide de déploiement en production
- **[Vue d'ensemble du backend](/docs/backend)** — Référence complète de configuration du backend
