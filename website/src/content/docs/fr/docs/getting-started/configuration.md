---
sourceHash: ec6f07e74d4a291d
title: Environnement & Configuration
sidebar_label: Configuration
description: Toutes les variables d'environnement et options de configuration pour les projets Rebase.
---

## Variables d'environnement

Toute la configuration s'effectue via des variables d'environnement dans votre fichier `.env` à la racine du projet.

> **Important** : Rebase valide les variables d'environnement avec **Zod** au démarrage. Si
> un élément requis est manquant ou mal formé (une URL qui n'est pas une URL, un port qui
> n'est pas un nombre), le serveur refuse de démarrer et nomme la variable en cause.
>
> L'emplacement du schéma dépend de la manière dont vous exécutez le backend. Un projet démarré
> par le runtime — `rebase dev`, `rebase start`, l'image publiée — utilise le
> schéma détenu par le runtime (`loadBootEnv` dans `@rebasepro/server`), qui est
> l'union de tous les tableaux ci-dessous. Un projet ayant exécuté [`rebase eject`](/docs/cli)
> possède un fichier `backend/src/env.ts` appelant `loadEnv({ extend })`, et peut y ajouter ses
> propres variables typées.

### Requises

| Variable | Description | Exemple |
|----------|-------------|---------|
| `DATABASE_URL` | Chaîne de connexion PostgreSQL. **Facultative en développement** — si elle n'est pas définie, `rebase dev` exécute une instance PostgreSQL gérée pour le projet, avec ses données sous `.rebase/`. Requise partout ailleurs. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Clé secrète pour signer les jetons JWT. Utilisez une chaîne aléatoire robuste (min 32 caractères). **Requise en production** (générée automatiquement en développement). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` est une syntaxe propre à node-postgres, et non à libpq.**
>
> Rebase et le pilote Node l'acceptent — chiffrer, mais sans vérifier le
> certificat. `psql`, `pg_dump`, `pg_restore` et Atlas ne l'acceptent pas, et ils ne
> dégradent pas le comportement : ils refusent de démarrer avec l'erreur `invalid sslmode value: "no-verify"`.
>
> Les commandes propres à Rebase (`rebase db push`, `rebase db backup`, `rebase db
> restore`) la réécrivent sous la forme équivalente `sslmode=require` avant d'exécuter les commandes shell,
> de sorte qu'elles fonctionnent avec l'URL telle que configurée. Lancer `psql` manuellement ne le fait
> pas — remplacez-y la valeur par `sslmode=require`, qui chiffre sans vérification
> exactement de la même manière.

### Frontend

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `VITE_API_URL` | URL de l'API backend pour le SDK typé. **À définir uniquement en développement** — voir ci-dessous. | origine de la page |
| `VITE_GOOGLE_CLIENT_ID` | Identifiant client Google OAuth. Active « Se connecter avec Google ». | — |


> **Laissez `VITE_API_URL` non définie dans les builds de production.**
>
> En développement, le frontend et le backend sont sur des origines distinctes, donc le serveur de
> développement injecte cette variable. En production, le backend Rebase sert la SPA, donc
> l'API correspond à la propre origine de la page et le client la résout ainsi automatiquement.
>
> Intégrer en dur une URL absolue dans un bundle de production fonctionne jusqu'à ce qu'un second
> nom d'hôte pointe vers la même application : un domaine personnalisé charge alors la page depuis
> `example.com` et appelle l'API sur `example.rebase.website`, ce qui est considéré comme
> cross-origin, et chaque requête échoue dès le preflight. Autoriser l'origine dans CORS ne résout
> **pas** non plus le problème — le cookie de rafraîchissement est en `SameSite=Lax` et n'est pas
> envoyé cross-site, vous supprimeriez donc les erreurs dans la console tout en conservant une
> authentification cassée. Non définie, chaque domaine pointant vers l'application fonctionne sans
> aucune configuration CORS.

### Backend

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `PORT` | Port pour le serveur HTTP backend. Lu par `rebase start`. `rebase dev` le lit **uniquement depuis l'environnement du shell** — un `PORT` dans `.env` n'y est pas pris en compte, car le port est résolu avant le chargement de ce fichier — et lie sinon un port dérivé du chemin du projet, afin que plusieurs projets puissent s'exécuter en même temps. `rebase dev --port` a la priorité sur les deux, et la bannière de démarrage indique le niveau utilisé. | `3001` |
| `LOG_LEVEL` | Niveau de verbosité des logs : `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Affiche le SQL sous-jacent à une ligne `Failed query: [redacted]`. Chaque instruction en échec est caviardée par défaut, car une requête échouée contient ses paramètres liés — un e-mail, un hash de mot de passe. Définissez-la à `true` lors du diagnostic d'un échec DDL, RLS ou de capture de modifications. Ignorée lorsque `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Environnement : `development`, `production` ou `test` | `development` |
| `CORS_ORIGINS` | Liste séparée par des virgules des origines autorisées. **Requise en production** sauf si `FRONTEND_URL` est définie : un démarrage en production sans l'une ni l'autre refusera de s'exécuter. En développement, elle est *ajoutée à* localhost — voir ci-dessous. | — |
| `FRONTEND_URL` | URL de l'application frontend. Utilisée comme alternative à CORS_ORIGINS, dans les deux environnements. | — |
| `ADMIN_CONNECTION_STRING` | Chaîne de connexion à la base de données avec privilèges d'administrateur (utilisée pour l'introspection du schéma et les opérations d'administration). La base de données qu'elle cible n'est pas celle que la console SQL considère comme courante, ni celle qu'une nouvelle branche copie par défaut : ces deux dernières correspondent à la base de données sur laquelle la connexion propre de l'application est établie (voir `REBASE_BRANCH_PARENT_DATABASE` pour un serveur sur une branche). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Désactive le changement de rôle PostgreSQL dans l'éditeur SQL (utile pour l'authentification personnalisée où les rôles DB ne sont pas mappés). La console SQL de Studio indique alors que les lignes ont été lues en tant que propriétaire de la connexion, le nomme, et grise son sélecteur de rôle. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | La base de données depuis laquelle la branche sur laquelle s'exécute ce serveur a été copiée. `rebase dev` la définit sur un checkout [basculé sur une branche](/docs/backend/branching/#cli-integration). Un serveur disposant de cette variable conserve le registre des branches sur cette base de données et copie par défaut les nouvelles branches à partir d'elle, de sorte que le volet Branches de Studio affiche les branches de la base principale. | — |

#### CORS en développement

Le développement autorise **localhost, plus tout ce que `CORS_ORIGINS` (ou `FRONTEND_URL`)
mentionne** — la même liste que celle utilisée en production, avec localhost ajouté plutôt que
substitué. La variable fonctionne donc de la même manière dans les deux environnements, et les
cas qui la nécessitent en développement sont les cas usuels :

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Une origine qui n'est ni localhost ni listée est refusée, et le refus est
consigné dans les logs **une fois par origine** avec la ligne exacte qui permettrait de l'autoriser. Ce refus
n'est pas une précaution gratuite : l'API transmettant des identifiants (credentials), renvoyer une
origine arbitraire `Origin` permettrait à n'importe quel site visité par le développeur d'effectuer des
requêtes authentifiées contre le serveur de développement avec sa session et d'en lire les
réponses.

### Authentification

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `JWT_SECRET` | Secret pour la signature JWT (requis en production, généré automatiquement en développement) | — |
| `JWT_PRIVATE_KEY` | Clé privée PEM pour signer les jetons d'accès de manière asymétrique (RS256), afin que toute entité détenant le JWKS puisse vérifier une session sans pouvoir en forger une. Accepte un PEM avec de véritables sauts de ligne, un PEM avec des échappements `\n`, ou le PEM complet en base64. Sans cette variable, les jetons restent en HS256. | — |
| `JWT_KEY_ID` | Identifie `JWT_PRIVATE_KEY` dans l'en-tête du jeton et dans le JWKS. Modifiez-le chaque fois que la clé change — la rotation nécessite de pouvoir distinguer l'ancienne clé de la nouvelle. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Durée de vie du jeton d'accès | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Durée de vie du jeton de rafraîchissement. Glissante — chaque rotation la renouvelle, elle régit donc la durée de survie d'une session à l'**inactivité**. Définissez `400d` pour des sessions survivant à une longue absence ; les navigateurs plafonnent le cookie de rafraîchissement à cette valeur. | `30d` |
| `ALLOW_REGISTRATION` | Autoriser les nouveaux utilisateurs à s'inscrire (`true`/`false`). Hors production, le **premier** utilisateur peut toujours s'inscrire, quelle que soit cette valeur — une table d'utilisateurs vide doit bien accepter quelqu'un, et ce quelqu'un devient administrateur. En production (`NODE_ENV=production`), cette fenêtre est fermée : une table vide refuse l'inscription d'amorçage avec `SETUP_REQUIRED`, un premier compte créé via l'inscription ouverte est un compte ordinaire, et l'administrateur est désigné via `REBASE_ADMIN_EMAIL` ci-dessous ou assigné avec la clé de service. Le fichier `.env.example` du scaffold la définit à `true` ; la valeur par défaut du framework est désactivée (`false`). | `false` |
| `DISABLE_SELF_REGISTRATION` | Coupe-circuit. Ferme la fenêtre d'amorçage du premier utilisateur que `ALLOW_REGISTRATION=false` laisse délibérément ouverte hors production, de sorte que l'inscription soit fermée même face à une base de données vide. À associer à `REBASE_ADMIN_EMAIL` ci-dessous, sans quoi le déploiement n'aura aucun moyen de produire son premier appelant connecté. Chaque artefact de déploiement livré la définit. | — |
| `REBASE_ADMIN_EMAIL` | Adresse e-mail du premier compte administrateur, créé au démarrage **pendant que la table des utilisateurs est encore vide** et jamais par la suite. C'est ainsi qu'un déploiement de production obtient son administrateur : l'opérateur désigne le premier compte au lieu de faire la course avec Internet. Le démarrage émet un avertissement lorsque la table est vide en production et que cette variable n'est pas définie. | — |
| `REBASE_ADMIN_PASSWORD` | Mot de passe de ce compte. Au moins 12 caractères, sous peine d'être refusé et que le compte ne soit pas créé. Changez-le après la première connexion. | — |
| `MFA_ENCRYPTION_KEY` | Chiffre chaque secret TOTP stocké. Si non définie, les secrets sont chiffrés avec `JWT_SECRET` à la place et le démarrage émet un avertissement unique — ainsi, la rotation de `JWT_SECRET` déconnecterait tout le monde *et* rendrait indéchiffrable chaque authentificateur enregistré. Définissez une clé dédiée (32+ caractères aléatoires) avant toute inscription. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | L'ancienne clé dont on effectue la *rotation*. Définissez les deux lors d'une rotation : les nouveaux secrets sont écrits avec `MFA_ENCRYPTION_KEY` et les secrets existants restent lisibles, afin que personne ne soit bloqué hors de son compte en pleine rotation. Supprimez-la une fois que tous les secrets ont été ré-encodés. | — |
| `ALLOW_ANONYMOUS` | Active la connexion anonyme (`POST /api/auth/anonymous`). Optionnelle (opt-in), et délibérément non conditionnée par `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Exiger une authentification pour l'API de données. Définissez à `false` pour une surface de lecture entièrement publique — le RLS continue de s'appliquer. | `true` |
| `AUTH_DEFAULT_ROLE` | Rôle attribué à un utilisateur nouvellement inscrit lorsqu'aucun n'est spécifié. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Monte `POST /api/auth/find-user`, qui résout un e-mail en un profil public minimal (`uid`, `displayName`, `photoURL`) pour les flux d'invitation par e-mail. Réservé aux appelants authentifiés, et ne retourne jamais l'e-mail, les rôles ou les métadonnées de l'utilisateur trouvé. Désactivé par défaut : il s'agit d'une surface d'énumération. | `false` |
| `AUTH_COOKIE_SAME_SITE` | Directive `SameSite` sur le cookie de rafraîchissement : `Strict`, `Lax` ou `None`. `None` requiert HTTPS et n'est destiné qu'à un frontend véritablement cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | Directive `Secure` sur le cookie de rafraîchissement. Sécurisé par défaut ; `AUTH_COOKIE_SECURE=false` pour du HTTP simple — un déploiement sur une adresse LAN où le navigateur ignorerait sinon le cookie et où la session s'arrêterait à l'expiration du jeton d'accès sans aucune erreur. Avertit au démarrage. `http://localhost` n'en a pas besoin. | `true` |
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
| `GITLAB_CLIENT_ID` | Identifiant client GitLab OAuth. La `baseUrl` d'une instance auto-hébergée n'a pas d'équivalent en variable d'environnement — configurez GitLab dans le bloc `auth` pour cela. | — |
| `GITLAB_CLIENT_SECRET` | Secret client GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | Identifiant client Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Secret client Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | Identifiant client Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Secret client Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | Identifiant client Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Secret client Spotify OAuth | — |
| `APPLE_CLIENT_ID` | Apple Services ID. Apple n'a pas de secret client statique — Rebase signe un JWT ES256 à courte durée de vie par échange de jeton — elle nécessite donc les quatre valeurs `APPLE_*`, et ne configure rien sans elles. | — |
| `APPLE_TEAM_ID` | Apple Developer Team ID, l'émetteur du JWT. | — |
| `APPLE_KEY_ID` | Identifiant de clé de la clé privée enregistrée auprès d'Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenu du fichier de clé privée `.p8`, avec les sauts de ligne (les séquences d'échappement `\n` sont acceptées). | — |
| `REBASE_SERVICE_KEY` | Clé d'API administrateur statique. Contourne l'authentification JWT normale pour les appels de serveur à serveur lorsqu'elle est transmise via `Authorization: Bearer <key>`. (Générée automatiquement en développement). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Clé publique de la plateforme d'hébergement (PEM, EC P-256) par rapport à laquelle les jetons de plateforme `rpt_` sont vérifiés ; plusieurs blocs PEM lors d'une rotation de clé. La plateforme la définit lors du déploiement, et elle ne contient rien de secret. Conjointement avec `REBASE_PLATFORM_TOKEN_AUDIENCE`, elle permet au portail d'administration d'accepter un jeton de plateforme pour `cron:read`, et pour rien d'autre. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | L'identifiant de projet auquel l'`aud` d'un jeton de plateforme doit être égal, de sorte qu'un jeton généré pour un autre projet soit refusé. Si une seule des deux variables est définie, le serveur démarre, consigne un avertissement et répond à chaque jeton `rpt_` par `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_RATE_LIMIT_STORE` | Emplacement de stockage des compteurs de limitation de débit (rate-limit) d'authentification : `memory` (par processus) ou `sql` (partagé entre les réplicas). Un processus ne peut pas voir son propre nombre de réplicas, un déploiement avec plusieurs nœuds doit donc l'indiquer — trois réplicas sur la valeur par défaut appliquent trois fois la limite. Toute autre valeur **refuse de démarrer** plutôt que de se rabattre sur une alternative, `postgres` y compris. | `memory` |
| `AUTH_MAGIC_LINK` | Monte le flux de lien de connexion sans mot de passe. Nécessite un service d'e-mail configuré, sinon le lien n'a aucune destination. | `false` |
| `AUTH_EMAIL_OTP` | Monte la connexion sans mot de passe avec un code à six chiffres envoyé par e-mail. Même exigence d'e-mail que ci-dessus. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Inscription sans mot de passe : une requête de lien magique ou de code par e-mail pour une adresse inconnue crée le compte, tant que l'inscription est ouverte. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Action lorsqu'un jeton de rafraîchissement est rejoué après sa fenêtre de réutilisation : `reject` (le refuser, conserver la session) ou `revoke-session` (mettre fin à la session). Toute autre valeur fait échouer le démarrage. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Inscription avec confirmation préalable : pas de connexion par mot de passe tant que l'adresse n'est pas vérifiée. Nécessite la configuration des e-mails ; le démarrage la refuse sans cela. | `false` |
| `CAPTCHA_PROVIDER` | Active la vérification par captcha sur les routes d'authentification : `turnstile` ou `hcaptcha`. Non définie signifie aucun captcha. | — |
| `CAPTCHA_SECRET` | Le secret du fournisseur, utilisé côté serveur pour vérifier le jeton envoyé par le navigateur. Requis dès que `CAPTCHA_PROVIDER` est défini. | — |
| `CAPTCHA_ROUTES` | Routes d'authentification à protéger, séparées par des virgules (par exemple `register,login`). Si non définie, protège l'ensemble par défaut du fournisseur. | — |

### Stockage

:::caution[Le stockage ne dispose pas de sécurité au niveau des lignes (RLS), il nécessite donc un modèle d'accès]
Les collections sont protégées par le RLS de Postgres. Le stockage d'objets n'a pas d'équivalent —
les clés partagent un espace de noms plat unique — ainsi, avec un bucket configuré et aucun modèle d'accès,
le serveur **refuse de démarrer en production**. Vous devez satisfaire cette exigence avec exactement l'un des éléments suivants :
un hook `storageAuthorize` exporté depuis `config/index.ts` (ce que fournit le scaffold),
`STORAGE_PUBLIC_READ`, ou `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `STORAGE_TYPE` | Backend de stockage : `local`, `s3` ou `gcs`. En production, `local` désactive le stockage sauf si `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Chemin de base pour le stockage local. Un chemin relatif est lu depuis le répertoire dans lequel le serveur s'exécute : la racine du projet sous `rebase dev`, `backend/` dans un serveur généré par `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Autorise le stockage local en production — uniquement avec un volume persistant contenant `STORAGE_PATH` et les répertoires `<STORAGE_PATH>__<key>` des buckets locaux nommés à ses côtés | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Nombre de secondes pendant lesquelles l'URL de téléchargement d'un fichier privé fonctionne — le jeton que `getSignedUrl()` y insère. Au maximum `604800` (une semaine) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Taille maximale de fichier acceptée par la source, en octets, sur chaque chemin d'upload — `__<KEY>` pour une source nommée. Une valeur qui n'est pas un nombre entier d'octets refuse le démarrage | `52428800` (50 Mo) |
| `S3_BUCKET` | Nom du bucket S3 (lorsque `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Région AWS | — |
| `S3_ACCESS_KEY_ID` | Clé d'accès AWS | — |
| `S3_SECRET_ACCESS_KEY` | Clé secrète AWS | — |
| `S3_ENDPOINT` | Point de terminaison S3 personnalisé (pour MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Forcer les URL de type chemin pour le bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nom du bucket GCS (lorsque `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Projet GCP. Généralement déduit des identifiants. | — |
| `GCS_KEY_FILENAME` | Chemin vers un fichier de clé de compte de service. À omettre sur GCP, où Workload Identity fournit les identifiants. | — |
| `STORAGE_PUBLIC_READ` | Servir tous les objets à tout le monde, sans jeton. Destiné uniquement à un bucket qui fait véritablement office de CDN public. L'un des trois moyens de satisfaire la vérification au démarrage ci-dessous. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permet à tout appelant connecté de lire, écrire, lister et supprimer chaque objet. Nommé `INSECURE` dans l'objet de configuration pour une bonne raison : cela n'est justifiable que dans une application mono-tenant où chaque compte est de confiance pour chaque fichier. | `false` |
| `STORAGE_RENDITION_CACHE` | Met en cache les rendus d'images générés (redimensionnements, conversions de format) au lieu de les produire à chaque requête. | `false` |

### E-mail (Facultatif)

| Variable | Description |
|----------|-------------|
| `SMTP_HOST` | Hôte du serveur SMTP |
| `SMTP_PORT` | Port du serveur SMTP |
| `SMTP_SECURE` | Activer la connexion sécurisée (`true`/`false`) |
| `SMTP_USER` | Nom d'utilisateur SMTP |
| `SMTP_PASS` | Mot de passe SMTP |
| `SMTP_FROM` | Adresse d'expédition pour les e-mails système |
| `SMTP_NAME` | Nom d'affichage de l'adresse d'expédition |
| `APP_NAME` | Nom du produit utilisé dans les objets et corps d'e-mails (par défaut : `Rebase`) |
| `EMAIL_LOGO_URL` | Logo affiché en haut des modèles d'e-mails par défaut. URL PNG ou JPG absolue en `http(s)` — les clients de messagerie suppriment le SVG et bloquent les URI `data:`. Si non définie, une application toujours nommée `Rebase` reçoit le logo Rebase et une application renommée n'en reçoit aucun |

### Pool de connexions à la base de données

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `DB_POOL_MAX` | Nombre maximal de connexions dans le pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Nombre de millisecondes pendant lesquelles une connexion inactive est conservée | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Nombre de millisecondes à attendre pour obtenir une connexion | `10000` |
| `DATABASE_DIRECT_URL` | Connexion directe (sans pool). Nécessaire pour [Realtime](/docs/backend/realtime) : `LISTEN`/`NOTIFY` ne survit pas à un pooler de transactions tel que PgBouncer, et sans cette variable, les notifications de changement sont désactivées avec un avertissement plutôt que perdues silencieusement. Le [gestionnaire de tâches (job worker)](/docs/backend/jobs) y maintient également son `LISTEN` de réveil. Remplit la directive `directConnectionString` de l'adaptateur Postgres lorsque celle-ci n'est pas définie. | — |
| `DATABASE_READ_URL` | Réplica de lecture. Les lectures y sont envoyées lorsqu'elle est définie et différente de `DATABASE_URL` ; si la connexion échoue, tout bascule sur le primaire avec un avertissement. Remplit la directive `readConnectionString` de l'adaptateur Postgres lorsque celle-ci n'est pas définie ; sur la version 0.24, cette option est ignorée. | — |
| `REBASE_DB_POOL_MAX` | Un plafond sur chaque pool du processus, appliqué indépendamment de ce que chacun demandait. Chiffres uniquement : une valeur mal formée est ignorée plutôt que de sérialiser silencieusement le serveur. | — |

### Comportement du runtime

Lu par le runtime — `rebase dev`, `rebase start` et l'image de serveur publiée.
Un projet qui a effectué un eject gère ces décisions directement dans son propre code.

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `REBASE_RLS_AUDIT` | `true` exécute l'audit planifié de [sécurité au niveau des lignes (RLS)](/docs/rls-check#running-it-on-a-schedule), qui signale les tables exposées sans politiques. Le projet doit déclarer `@rebasepro/rls-check` parmi ses dépendances : le runtime n'en embarque aucune copie, et sans ce paquet, le démarrage est refusé en mentionnant son nom. `false` désactive l'analyse pour ce processus. | — |
| `REBASE_BASE_PATH` | Chemin de base pour chaque route de l'API. Le client doit être configuré avec la même valeur — voir [Modifier `basePath`](#modifier-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Sert les assets statiques/admin du bundle depuis ce processus. Désactivez-le lorsqu'un CDN est placé devant. | `true` |
| `REBASE_HISTORY` | Enregistre l'[historique des modifications d'entités](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Active les réponses compressées gzip/brotli. | `true` |
| `REBASE_MAX_BODY_SIZE` | Taille maximale du corps de requête, **en octets** (`10485760`, et non `10MB` — une valeur qui n'est pas un nombre refuse de démarrer au lieu de supprimer silencieusement la limite). `0` désactive la limite. | `10485760` (10 Mio) |
| `REBASE_ENABLE_SWAGGER` | L'interface OpenAPI. Tri-état : non définie signifie activée en développement, désactivée en production ; `false` désactive les deux partout. Notez que `true` en production sert la **spécification** sur `/api/docs` mais pas l'**interface UI** Swagger sur `/api/swagger` — l'UI est conditionnée séparément par `NODE_ENV`. | — |
| `REBASE_METRICS` | Expose les métriques Prometheus sur `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Ajoute `includeSubDomains` à l'en-tête `Strict-Transport-Security`, de sorte que les navigateurs refusent le HTTP simple sur tous les sous-domaines de l'hôte pendant six mois — y compris les hôtes que ce processus ne sert pas. Ne l'activez que si chaque sous-domaine du domaine est exclusivement en HTTPS. Toute valeur autre que `true`/`false` refuse de démarrer. Voir [En-têtes de sécurité](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Jeton Bearer protégeant `/metrics`. Si non définie, l'endpoint reste accessible à quiconque peut joindre le port — acceptable sur un réseau privé, non sécurisé sur un réseau public, ce que précisent les logs de démarrage. | — |
| `REBASE_MIGRATE_ON_BOOT` | Ce que le runtime est autorisé à effectuer sur le schéma des collections au démarrage. `ensure` (la valeur par défaut, partout — production incluse) exécute la passe **additive** : créer les tables, colonnes et types enum manquants, sans jamais en supprimer ni en réécrire un seul. `none` ne touche pas au schéma des collections, mais les tables propres au framework (authentification, clés d'API, tâches, cron) sont toujours créées et tenues à jour ; `REBASE_PROVISION=false` désactive également ces dernières. L'image publiée n'accepte que ces deux valeurs et **refuse de démarrer sur `push`**. Dans un [déploiement scindé](/docs/deployment/split-processes), un seul processus exactement peut provisionner, donc chaque autre rôle doit définir `none` sous peine de refuser de démarrer. | `ensure` |
| `REBASE_PROVISION` | `false` indique au runtime de ne rien modifier dans sa base de données : aucune table, colonne, index, fonction, déclencheur (trigger), politique, rôle ou droit (grant), que ce soit au démarrage ou ultérieurement, y compris ceux propres au framework. Il signale en retour ce qui manque par son nom. Pratique pour une base de données que seul votre processus de gestion des modifications a le droit d'altérer. Voir [Quand seul votre processus de modification peut altérer la base de données](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Seules les valeurs `true` et `false` sont acceptées. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Refuse de démarrer lorsque la base de données a été provisionnée pour la dernière fois à partir d'un ensemble de collections différent de celui avec lequel ce processus a été construit. Si non définie (ou toute valeur autre que `true`/`1`), émet un avertissement à la place. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Refuse de démarrer lorsqu'un fichier de fonction ou de cron lève une exception ou ne parvient pas à être analysé lors de l'import, en indiquant chaque fichier et la raison de l'échec, afin qu'un déploiement progressif (rolling deploy) conserve l'ancienne version en service. Un redémarrage est également soumis à cette règle. Si non définie (ou toute valeur autre que `true`), ignore le fichier et sert le reste. Un fichier qui s'importe proprement et n'exporte aucune fonction ni tâche est toujours ignoré, pas refusé. | skip |
| `REALTIME_CDC` | Capture de modifications au niveau base de données (CDC) : `auto` (activée là où la connexion le supporte, repli silencieux sinon), `trigger` (forcée, avertissement si impossible), `wal` (se dégrade en `trigger` actuellement), `off`. Voir [Realtime](/docs/backend/realtime-cdc/). Prévaut sur `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Transport inter-instances pour les canaux de diffusion (broadcast) et la présence : `memory` ou `postgres`. Ignoré lorsque `realtime.bus` a reçu un transport instancié. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Nombre d'abonnements qu'un socket temps réel peut maintenir ; l'abonnement suivant est refusé avec `TOO_MANY_SUBSCRIPTIONS`. Un entier strictement positif — toute autre valeur interrompt le serveur au démarrage. Prévaut sur `realtime.maxSubscriptionsPerSocket`. Voir [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Nombre de sockets temps réel qu'un utilisateur, ou une clé d'API, peut maintenir ouverts sur une même instance de serveur. Les sockets d'usurpation d'un administrateur sont décomptés de cet administrateur. La connexion du socket suivant est refusée avec `TOO_MANY_SOCKETS` et le socket est fermé (4002) ; le SDK continuant d'essayer, il se connectera dès qu'un autre se fermera. Un entier strictement positif — toute autre valeur interrompt le serveur au démarrage. Prévaut sur `realtime.maxSocketsPerUser`. | Sans plafond |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Temps d'attente maximal d'une modification avant le réapprovisionnement (refetch) qui la distribue aux abonnés actifs, en ms. Un refetch attend 300 ms sans modification, et au maximum cette durée sous un flux continu d'écritures. Un entier strictement positif — toute autre valeur interrompt le serveur au démarrage. Prévaut sur `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Durée pendant laquelle le total d'un abonnement à une grande liste peut être réutilisé avant d'être recalculé, en ms ; les frames qui le réutilisent portent `meta.totalAsOf`. Si non définie, chaque frame recalcule. Prévaut sur `realtime.recountIntervalMs`. | Non définie |
| `REALTIME_RECOUNT_MIN_ROWS` | Le plus petit total précédent auquel `REALTIME_RECOUNT_INTERVAL_MS` s'applique ; les listes plus petites sont comptées à chaque frame. Prévaut sur `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Autorise les valeurs `localhost`/loopback sous `NODE_ENV=production`. Désactivée par défaut, afin qu'un démarrage en production échoue explicitement plutôt que de se connecter à une base de données inexistante. | `false` |
| `REBASE_STRICT_COLLECTION_CONFIG` | Ce que le démarrage fait d'une clé dans vos collections que cette version ne lit pas : `warn`, `error` (refuse de démarrer — utile à activer en CI), ou `off`. Ne régit que les clés qu'il ne *reconnaît* pas, qui sont généralement une faute de frappe et occasionnellement des métadonnées délibérées ; une clé qu'il sait avoir été déplacée est toujours fatale, car la fonctionnalité configurée serait sinon silencieusement absente. | `warn` |
| `REBASE_PROVISION_ONLY` | `1`/`true` exécute la passe de schéma et se termine sans ouvrir de socket — la configuration attendue pour un Job de migration, à partir de la même image et du même bundle que le serveur qui le suit. Crée également les tables qu'un processus servant créerait autrement à la première utilisation, et ne démarre aucun planificateur cron ni file de tâches. Une valeur vide est considérée comme *non définie*, de sorte qu'un `${SOMETHING}` non substitué dans un fichier compose ne puisse pas transformer un déploiement ordinaire en un processus qui migre et refuse de servir. Refusée conjointement avec `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Un chemin de fichier. Une exécution de provisionnement (`REBASE_PROVISION_ONLY=true`) y écrit chaque modification de schéma effectuée, dans l'ordre, sous la forme d'un script SQL à examiner et appliquer avec `psql`. Les lignes écrites ne sont pas incluses. Refusée sur un processus qui sert l'application. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permet à une machine — un agent, un job CI — d'*appliquer* une modification de schéma via `/api/admin/schema`, et pas seulement d'en planifier une. Désactivée sauf demande explicite : l'identifiant qui permettrait un tel changement est celui le plus susceptible de se trouver dans une variable de CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Durée maximale d'exécution d'une fonction personnalisée avant que sa requête ne soit interrompue. Même paramètre que l'option `functionsTimeoutMs`. `0` la désactive. | `30000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` fait en sorte qu'un rejet de promesse non géré mette fin au processus au lieu de simplement le consigner. À activer sous un orchestrateur qui gère le redémarrage ; à désactiver lorsqu'un redémarrage est pire qu'une fuite. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Maintient le planificateur cron actif sur une plateforme que le runtime détecterait autrement comme étant à mise à l'échelle vers zéro (scale-to-zero), où un timer déclenché dans une instance inactive ne se déclencherait dans aucune instance. | — |
| `TRUSTED_PROXY_HOPS` | Nombre de proxys en amont de ce serveur, pour que le limiteur de débit puisse lire la véritable adresse client depuis `X-Forwarded-For`. Valeur par défaut sécurisée à `0` : sans proxy, faire confiance à cet en-tête permettrait à n'importe quel appelant d'usurper une identité. | `0` |

:::note[Le provisionnement au démarrage est additif, ce n'est pas un outil de migration]
La passe de démarrage s'exécute sans intervention humaine et sans examen d'un diff ; elle ne supprimera donc jamais
de colonne, ne réduira jamais un type et ne réécrira jamais une table. C'est également la raison pour laquelle l'image refuse
`REBASE_MIGRATE_ON_BOOT=push` : un push complet calcule un diff et exécutera volontiers
`DROP COLUMN`, et un redémarrage de conteneur ne doit jamais pouvoir détruire une
colonne de production suite à un simple réordonnancement d'instances.

Les modifications destructives ou structurelles restent là où elles peuvent être vérifiées : `rebase db
generate` + `rebase db migrate`, ou `rebase db push` depuis un environnement de travail local ou de CI,
qui simule le changement à blanc, refuse les actions destructives sans confirmation, et
peut effectuer une sauvegarde au préalable.
:::

### Déploiements scindés (split deployments)

Une même image et un même bundle peuvent être démarrés plusieurs fois, chacun servant
une partie distincte du projet. Une seule ligne par variable ici, car cette page a pour vocation
de recenser toutes les variables ; le détail de ce que chaque combinaison *monte et détient* — et les
combinaisons qui refusent de démarrer — se trouve sur
**[Processus scindés](/docs/deployment/split-processes)**.

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `REBASE_ROLE` | Quelle partie ce processus sert : `all`, `api`, `functions` ou `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Révaut pour définir si *ce* processus exécute les timers cron. Si non définie, suit le rôle. | — |
| `REBASE_JOB_WORKERS` | Révaut pour définir si ce processus exécute les workers de file de tâches. Si non définie, suit le rôle. | — |
| `REBASE_FUNCTIONS_ONLY` | Sert uniquement les fonctions personnalisées nommées dans ce processus. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Sert toutes les fonctions personnalisées sauf celles nommées. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Emplacement vers lequel le processus API relaie une requête de fonction qu'il ne sert pas lui-même. Sur un `worker`, endroit où ses propres appels à `rebase.functions` sont dirigés. Une URL en `http(s)`. | — |

### Surface MCP

Un point de terminaison Model Context Protocol optionnel sur `/mcp`, permettant à un client IA de lire
et d'écrire sur ce projet **en tant qu'utilisateur connecté**. Désactivé sauf configuration explicite, et — contrairement
à toutes les autres surfaces — aucun `REBASE_ROLE` ne l'active : les autres définissent la
structure d'un processus, tandis que celle-ci relève d'une décision de confier des identifiants à un logiciel
tiers, décision qui doit être prise par une personne plutôt qu'héritée du rôle d'un
conteneur.

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `REBASE_MCP_ENABLED` | Monte la surface MCP. Requiert `REBASE_PUBLIC_URL` ; sans elle, la surface refuse de se monter et le signale dans le log de démarrage. | `false` |
| `REBASE_PUBLIC_URL` | L'origine externe accessible de ce déploiement, par exemple `https://app.example.com`. La surface MCP ne peut pas la déduire — récupérer l'origine depuis l'en-tête `Host` ferait de l'identité de l'émetteur, ainsi que de l'audience par rapport à laquelle ses propres jetons sont vérifiés, une valeur fournie par l'appelant. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Autorise l'enregistrement dynamique de clients OAuth (RFC 7591), permettant à un client de s'enregistrer de lui-même. Définissez à `false` pour exiger que les clients soient enregistrés au préalable. | `true` |

### Édition de schéma en direct depuis un bundle

Désactivée sauf si `REBASE_LIVE_SCHEMA_REPOSITORY` est définie. Un bundle compilé n'a pas
de source de collection à modifier ; lorsque ces variables sont définies, l'éditeur de collections de
l'administration lit la source depuis le dépôt, commite chaque modification, et exécute son DDL sur
cette base de données. Réservé aux administrateurs, et appliqué par une personne sauf si
`REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` en dispose autrement. Un dépôt désigné sans
identifiant valide refuse de démarrer. Voir
[Édition de schéma en direct](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Le dépôt GitHub sur lequel commiter les modifications de schéma, au format `owner/name`. Définir cette variable active la fonctionnalité. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | La branche sur laquelle le commit est appliqué. | `main` |
| `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH` | Emplacement du code source des collections dans ce dépôt, relatif à la racine du dépôt. | `config/collections` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Un jeton d'accès affiné (fine-grained token) avec accès en lecture et écriture au contenu du dépôt. Définissez soit cette variable, soit les trois variables `_GITHUB_APP_*`, mais pas les deux. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | Identifiant d'une application GitHub, pour commiter en tant qu'application au lieu d'utiliser un jeton. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | Identifiant d'installation de l'application sur le dépôt. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | Clé privée de l'application : PEM, PEM avec retours à la ligne échappés, ou base64. | — |

### Sauvegardes

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `BACKUP_SCHEDULE` | Expression cron pour les sauvegardes planifiées. Si non définie, les sauvegardes planifiées sont désactivées. | — |
| `BACKUP_DESTINATION` | Chemin local, ou URL au format `s3://bucket/prefix` / `gs://bucket/prefix`. | `./backups` |
| `BACKUP_RETENTION_DAYS` | Supprime les sauvegardes de plus de N jours. Si non définie ou `0`, tout est conservé. | — |
| `BACKUP_KEEP_MINIMUM` | Conserve toujours au moins N sauvegardes parmi les plus récentes, quelle que soit la politique de rétention. | — |
| `PG_DUMP_PATH` | Remplace le binaire `pg_dump` — il doit correspondre à la version majeure du serveur ou à une version plus récente. | — |
| `PG_RESTORE_PATH` | Remplace le binaire `pg_restore`. | — |
| `PSQL_PATH` | Remplace le binaire `psql` que `rebase db restore --clean` exécute pour faire de la restauration une transaction unique. | — |
| `PG_DUMPALL_PATH` | Emplacement de `pg_dumpall`, lorsqu'il n'est pas présent dans le `PATH`. Sans lui — et sans les outils clients PostgreSQL installés —, une sauvegarde des données globales échoue avec une erreur mentionnant cette variable. | — |

L'image officielle du runtime (`rebasepro/server`) intègre les outils clients
PostgreSQL 18, de sorte qu'une sauvegarde planifiée y fonctionne avec n'importe quel serveur jusqu'à Postgres 18.
En dehors de l'image, installez-les vous-même (`apt-get install postgresql-client-18`,
`brew install libpq`).

Les sauvegardes contiennent des secrets et des données personnelles (PII). Utilisez une destination privée avec
chiffrement au repos.

### Livraison de bundles

Un déploiement managé n'embarque pas son code dans l'image : le runtime récupère un
bundle au démarrage. Ces variables déterminent lequel et comment.

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `REBASE_BUNDLE` | Chemin vers un répertoire de bundle déjà extrait. Ce que `rebase start` définit localement. | — |
| `REBASE_BUNDLE_URL` | Emplacement depuis lequel télécharger l'archive du bundle, lorsqu'il n'y en a pas en local. | — |
| `REBASE_BUNDLE_TOKEN` | L'identifiant Bearer pour ce téléchargement. Traitez-le comme un secret : c'est ce qui autorise un tenant à télécharger son propre code. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Répertoire où le bundle téléchargé est extrait. Doit être accessible en écriture et persister entre le téléchargement et le démarrage. | — |
| `REBASE_RUNTIME_MODULES` | Modules supplémentaires fournis par l'image de runtime au bundle, au-delà de ceux qu'il déclare lui-même. | — |

### Liaisons de ressources (Resource bindings)

Chaque base de données, bucket et topic déclaré par un projet dans `config/resources.ts` est
lié par des variables d'environnement nommées d'après lui. Les noms de base figurent ci-dessous ; une
ressource non définie par défaut ajoute `__` suivi de sa clé en majuscules, de sorte qu'un bucket nommé
`media` lira `S3_BUCKET__MEDIA`. `rebase status` affiche, pour chaque ressource,
la variable exacte lue et si elle est définie ou non.

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `REBASE_DRIVER` | Le package npm implémentant le driver d'une source de données, lorsqu'il ne s'agit pas de celui par défaut de Postgres. Suffixé par source : `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | La chaîne de connexion pour un topic déclaré. Suffixée par topic. | — |

### Environnement propre à la CLI

Lu par `rebase`, et non par le serveur. Aucun élément ici n'affecte un déploiement.

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `REBASE_BASE_URL` | Endroit où `rebase api-keys`, `rebase storage` et `rebase auth reset-password` envoient la clé de service, dans le shell ou dans le fichier `.env`. À définir lorsque le serveur s'exécute autrement que par `rebase dev` dans ce projet : `rebase start`, un conteneur, un autre hôte. Si non définie, ils utilisent le serveur consigné par `rebase dev` pendant que ce dernier est en cours d'exécution, et n'envoient rien s'il ne l'est pas. | — |
| `REBASE_SERVICE_KEY` | La clé de service avec laquelle ces commandes s'authentifient, lue depuis `.env` : la même variable que celle lue par le serveur (voir plus haut). | — |
| `SERVICE_KEY` | Ancienne appellation de cette clé. Lorsque `.env` la définit, `rebase api-keys` et `rebase storage` la lisent à la place de `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Quel fichier `.env` la CLI lit et écrit, s'il ne s'agit pas de celui du projet. | — |
| `REBASE_CLOUD_URL` | Le plan de contrôle (control plane) avec lequel `rebase cloud` communique. | — |
| `REBASE_CLOUD_EMAIL` | Le compte sous lequel `rebase cloud login` se connecte, évitant la saisie interactive. | — |
| `REBASE_CLOUD_PASSWORD` | Son mot de passe, permettant à un gestionnaire de secrets de le fournir sans qu'il n'apparaisse dans l'historique du shell. | — |
| `REBASE_TOKEN` | Un jeton issu de `rebase cloud tokens create`. S'il est défini, chaque commande `rebase cloud` s'authentifie avec lui au lieu de la session `rebase cloud login`, et ne lit ni n'écrit jamais la session stockée. Dans un répertoire lié par `rebase cloud init --claim`, il est ignoré au profit du jeton propre à ce projet lorsqu'il ne détient aucun scope sur le projet. Méthode préconisée pour exécuter `rebase cloud` en CI — voir [CI et agents](/docs/deployment/cloud/#ci-and-agents). Le [serveur MCP](/docs/ai/mcp/) le transmet à la CLI instanciée par ses outils cloud, et ne l'envoie jamais à l'application : définissez `REBASE_API_TOKEN` pour cela. | — |
| `REBASE_DEBUG` | `1` affiche l'erreur sous-jacente et le détail des requêtes au lieu du message succinct. Le premier paramètre à activer lorsqu'une commande `rebase cloud` échoue sans explication claire. | — |
| `REBASE_ATLAS_DEV_URL` | La base de données vide par rapport à laquelle `rebase db push`, `db generate` et `db migrate` planifient leurs modifications, au lieu de la base `<db>_dev_diff` qu'elles créent à côté de `DATABASE_URL`. Rebase ne crée ni ne supprime aucune base de données nommée ici, et en refuse une égale à `DATABASE_URL`. Sur la base de données de développement gérée, la CLI la définit sur une instance PGlite éphémère en mémoire propre à elle-même. À définir lorsque le privilège `CREATE DATABASE` n'est pas accordé. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` ne démarre aucune base de données et ne provisionne rien — vous apportez la vôtre. Équivalent à `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fixe le port du serveur de développement frontend, que `rebase dev` dérive sinon du chemin du projet. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Durée maximale pendant laquelle `rebase dev` attend que le backend s'annonce avant d'indiquer qu'il n'a pas démarré. `0` désactive ce rapport. | `30000` |
| `DATABASE_PASSWORD` | Mot de passe que `rebase dev --docker` insère dans la chaîne de connexion qu'il dérive de `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | Convention standard inter-outils. Définie à toute valeur autre que `0`, la CLI n'envoie aucune télémétrie. | — |
| `REBASE_TELEMETRY_DISABLED` | Même comportement, spécifique à Rebase. Ne requiert aucun fichier, c'est pourquoi elle est idéale en CI et dans une image de conteneur. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Point de terminaison vers lequel la télémétrie est envoyée, pour un collecteur auto-hébergé. | — |

## Secrets en développement

`JWT_SECRET` est requise en production. Cette variable ainsi que `REBASE_SERVICE_KEY` sont
générées pour vous en dehors de la production, afin que vous puissiez démarrer sans rien configurer.

Ces valeurs générées sont mises en cache dans `.rebase-dev-secrets.json`, aux côtés de
`.rebase-dev-port` et `.rebase-dev-url`, et sont ignorées par git avec ces dernières. Auparavant, elles
étaient régénérées à chaque démarrage — ainsi, redémarrer le serveur de développement vous déconnectait
de votre propre application et invalidait toute clé d'API venant d'être créée.

- Définissez l'une ou l'autre de ces variables explicitement et votre valeur sera utilisée ; rien ne sera mis en cache ni lu.
- Pointez le cache vers un autre emplacement avec `REBASE_DEV_SECRETS_FILE` — un chemin de fichier, et la
  seule variable de cette section que vous auriez vocation à définir délibérément.
- Supprimez le fichier pour renouveler les deux secrets. Le démarrage suivant en écrira un nouveau.
- Si le fichier ne peut pas être écrit — par exemple dans un conteneur en lecture seule —, le serveur démarre
  malgré tout avec un secret éphémère, exactement comme auparavant.

Rien n'est mis en cache en production, ni sous un exécuteur de tests. En production, rien
n'est généré non plus : un démarrage sans `JWT_SECRET` échoue en indiquant le nom de la variable, et
ce comportement reste inchangé :

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
    collectionsDir: "./config/collections",
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

    enableSwagger: true,     // Enable OpenAPI docs at /api/docs

    logging: {
        level: "info"
    }
});
```

Les mêmes options,
sans `app`, `server` et `basePath` et avec une propriété `provision` obligatoire, construisent un
backend qui ne sert rien tant que vous ne le montez pas : `createRebaseBackend`. Voir
[Intégration d'un serveur personnalisé](/docs/backend/custom-server/).

### Modifier `basePath`

`basePath` déplace toutes les routes de l'API, le client doit donc être configuré avec la même valeur —
faute de quoi il continuera d'appeler `/api/...` et obtiendra des erreurs 404 sur tout :

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

Le panneau d'administration récupère cette information depuis le client qui lui est fourni ; rien d'autre n'a
besoin d'être configuré. Si vous construisez manuellement une URL de requête, concaténez-la à partir du client plutôt
que d'écrire vous-même `/api` :

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Dépannage

### Erreur de permission dans l'éditeur SQL (`permission denied for table <name>`)

* **Symptômes :** Les requêtes personnalisées exécutées dans l'éditeur SQL de Rebase Studio échouent avec l'erreur `cause: error: permission denied for table <name>`, alors que la vue tableur du CMS charge les données sans problème.
* **Cause :** Par défaut, Rebase tente d'exécuter les requêtes de l'éditeur SQL en basculant temporairement les rôles de base de données pour correspondre au rôle applicatif de l'utilisateur actif (par exemple, `SET LOCAL ROLE "admin"`). Si vous utilisez une authentification personnalisée où les rôles n'existent que dans des tables applicatives et non comme rôles PostgreSQL réels, le changement de rôle échoue ou les privilèges de base de données sont manquants. La vue tableur du CMS s'exécute sous l'utilisateur propriétaire de la connexion par défaut et contourne ce mécanisme.
* **Solution :** Ajoutez `DISABLE_DB_ROLE_SWITCHING=true` à la configuration `.env` de votre backend. Cela force Rebase à exécuter les requêtes de l'éditeur SQL avec les privilèges du propriétaire de la connexion (généralement un superuser/owner). L'éditeur SQL affiche alors, au-dessus des résultats, qu'ils ont été lus en tant que propriétaire de la connexion, et grise son sélecteur de rôle.

### Échec de récupération du schéma dans l'éditeur SQL (`Cross-database execution requires adminConnectionString`)

* **Symptômes :** Studio ne parvient pas à charger l'arborescence du schéma, ou l'éditeur SQL renvoie `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Cause :** Rebase a besoin de privilèges d'administration pour interroger les catalogues système de la base de données et exécuter des commandes d'administration. Si `adminConnectionString` n'est pas fourni au bootstrapper, ou si `getAdmin()` est surchargé pour renvoyer `undefined`, ces opérations échouent.
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
- **[Aperçu du Backend](/docs/backend)** — Référence complète de configuration du backend
