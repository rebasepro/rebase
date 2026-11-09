---
sourceHash: 7fb562cfe5127bcf
title: Environnement et configuration
sidebar_label: Configuration
description: Toutes les variables d'environnement et options de configuration pour les projets Rebase.
---

## Variables d'environnement

Toute la configuration s'effectue via des variables d'environnement dans votre fichier `.env` situé à la racine du projet.

> **Important** : Rebase valide les variables d'environnement avec **Zod** au démarrage. Si
> un élément requis est manquant ou mal formé (une URL qui n'est pas une URL, un port qui
> n'est pas un nombre), le serveur refuse de démarrer et indique la variable en cause.
>
> L'emplacement du schéma dépend de la manière dont vous exécutez le backend. Un projet démarré par
> le runtime — `rebase dev`, `rebase start`, l'image publiée — utilise le
> schéma appartenant au runtime (`loadBootEnv` dans `@rebasepro/server`), qui est
> l'union de chaque tableau ci-dessous. Un projet ayant exécuté [`rebase eject`](/docs/cli)
> possède un fichier `backend/src/env.ts` appelant `loadEnv({ extend })`, et peut y ajouter ses propres
> variables typées.

### Requises

| Variable | Description | Exemple |
|----------|-------------|---------|
| `DATABASE_URL` | Chaîne de connexion PostgreSQL. **Facultatif en développement** — non défini, `rebase dev` exécute un PostgreSQL géré pour le projet, avec ses données sous `.rebase/`. Requis partout ailleurs. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Clé secrète pour signer les jetons JWT. Utilisez une chaîne aléatoire robuste (min 32 caractères). **Requis en production** (généré automatiquement en développement). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` est une syntaxe propre à node-postgres, pas à libpq.**
>
> Rebase et le pilote Node l'acceptent — ils chiffrent, mais ne vérifient pas le
> certificat. `psql`, `pg_dump`, `pg_restore` et Atlas ne l'acceptent pas et ne se dégradent
> pas gracieusement : ils refusent de démarrer avec `invalid sslmode value: "no-verify"`.
>
> Les commandes propres à Rebase (`rebase db push`, `rebase db backup`, `rebase db
> restore`) la réécrivent en son équivalent `sslmode=require` avant d'appeler le shell,
> de sorte qu'elles fonctionnent avec l'URL telle que configurée. Lancer `psql` manuellement
> ne le fait pas — remplacez-la par `sslmode=require`, qui chiffre sans vérification
> exactement de la même manière.

### Frontend

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `VITE_API_URL` | URL de l'API backend pour le SDK typé. **À définir uniquement en développement** — voir ci-dessous. | origine de la page |
| `VITE_GOOGLE_CLIENT_ID` | ID client Google OAuth. Active « Se connecter avec Google ». | — |

> **Laissez `VITE_API_URL` non défini dans les builds de production.**
>
> En développement, le frontend et le backend ont des origines distinctes, le serveur
> de dev injecte donc cette variable. En production, le backend Rebase sert la SPA,
> l'API est donc la propre origine de la page et le client la résout ainsi de lui-même.
>
> Figer une URL absolue dans un bundle de production fonctionne jusqu'à ce qu'un deuxième
> nom d'hôte pointe vers la même application : un domaine personnalisé charge alors la page depuis
> `example.com` et appelle l'API sur `example.rebase.website`, ce qui est cross-origin,
> entraînant l'échec du preflight de chaque requête. Autoriser l'origine dans CORS
> ne résout **pas** le problème non plus — le cookie de rafraîchissement est en `SameSite=Lax` et n'est
> pas envoyé en cross-site ; vous élimineriez donc les erreurs de console tout en conservant une authentification
> brisée. Lorsqu'elle n'est pas définie, chaque domaine pointant vers l'application fonctionne sans aucune
> configuration CORS.

### Backend

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `PORT` | Port du serveur HTTP backend. Lu par `rebase start`. `rebase dev` le lit **depuis l'environnement shell uniquement** — un `PORT` dans `.env` n'y est pas lu car le port est résolu avant le chargement de ce fichier — et lie sinon un port dérivé du chemin du projet, afin que plusieurs projets puissent s'exécuter en même temps. `rebase dev --port` a la priorité sur les deux, et la bannière de démarrage indique le palier utilisé. | `3001` |
| `LOG_LEVEL` | Niveau de verbosité des logs : `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Affiche le SQL derrière une ligne `Failed query: [redacted]`. Chaque instruction en échec est caviardée par défaut, car une requête échouée transporte ses paramètres liés — un e-mail, un hash de mot de passe. Définissez-le à `true` lors du diagnostic d'une panne DDL, RLS ou de capture de modifications. Ignoré lorsque `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Environnement : `development`, `production`, ou `test` | `development` |
| `CORS_ORIGINS` | Liste d'origines autorisées séparées par des virgules. **Requis en production** sauf si `FRONTEND_URL` est défini : un démarrage en production sans l'un ni l'autre refusera de se lancer. En développement, il est *ajouté à* localhost — voir ci-dessous. | — |
| `FRONTEND_URL` | URL de l'application frontend. Utilisé comme alternative à CORS_ORIGINS, dans les deux environnements. | — |
| `ADMIN_CONNECTION_STRING` | Chaîne de connexion à la base de données avec privilèges administrateur (utilisée pour l'introspection du schéma et les opérations d'administration). La base de données désignée n'est pas celle que la console SQL considère comme active, ni celle qu'une nouvelle branche copie par défaut : il s'agit dans les deux cas de la base sur laquelle la propre connexion de l'application se trouve (voir `REBASE_BRANCH_PARENT_DATABASE` pour un serveur sur une branche). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Désactive le changement de rôle PostgreSQL dans l'éditeur SQL (utile pour l'authentification personnalisée où les rôles DB ne sont pas mappés). La console SQL de Studio indique alors que les lignes ont été lues en tant que propriétaire de la connexion, le nomme, et grise son sélecteur de rôle. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | La base de données à partir de laquelle la branche sur laquelle ce serveur tourne a été copiée. `rebase dev` la définit sur un checkout [basculé sur une branche](/docs/backend/branching/#cli-integration). Un serveur disposant de cette variable conserve le registre de branches sur cette base de données et copie par défaut les nouvelles branches depuis celle-ci, de sorte que le panneau Branches de Studio affiche les branches de la base principale. | — |

#### CORS en développement

Le développement autorise **localhost, ainsi que tout ce que `CORS_ORIGINS` (ou `FRONTEND_URL`)
désigne** — la même liste que la production utilise, avec localhost ajouté plutôt que
substitué. La variable fonctionne donc de la même manière dans les deux environnements, et les
cas nécessitant son utilisation en développement sont les cas classiques :

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Une origine qui n'est ni localhost ni listée est refusée, et le refus est
journalisé **une fois par origine** avec la ligne exacte qui permettrait de l'autoriser. Refuser
n'est pas une précaution gratuite : l'API transmettant des identifiants (credentials), refléter un
`Origin` arbitraire permettrait à n'importe quel site visité par le développeur d'effectuer
des requêtes authentifiées auprès du serveur de dev avec sa session et d'en lire
les réponses.

### Authentification

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `JWT_SECRET` | Secret pour la signature JWT (requis en production, généré automatiquement en développement) | — |
| `JWT_PRIVATE_KEY` | Clé privée PEM pour signer les jetons d'accès de manière asymétrique (RS256), afin que toute entité détenant le JWKS puisse vérifier une session sans pouvoir en forger une. Accepte un PEM avec de vrais sauts de ligne, un PEM avec des échappements `\n`, ou l'intégralité du PEM encodé en base64. Sans cette variable, les jetons restent en HS256. | — |
| `JWT_KEY_ID` | Identifie la clé `JWT_PRIVATE_KEY` dans l'en-tête du jeton et dans le JWKS. Modifiez-le chaque fois que la clé change — la rotation nécessite que l'ancienne et la nouvelle soient différentiables. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Durée de validité du jeton d'accès | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Durée de validité du jeton de rafraîchissement. Glissante — chaque rotation la renouvelle, cela régit donc la durée de survie d'une session à l'**inactivité**. Définissez `400d` pour les sessions qui doivent survivre à une longue absence ; les navigateurs plafonnent le cookie de rafraîchissement à cette valeur. | `30d` |
| `ALLOW_REGISTRATION` | Autoriser les nouveaux utilisateurs à s'inscrire (`true`/`false`). Hors production, le **premier** utilisateur peut toujours s'inscrire, quelle que soit cette valeur — une table d'utilisateurs vide doit bien accepter quelqu'un, et ce quelqu'un devient administrateur. En production (`NODE_ENV=production`), cette fenêtre est fermée : une table vide refuse l'inscription d'amorçage avec `SETUP_REQUIRED`, un premier compte créé via l'inscription ouverte est un compte ordinaire, et l'administrateur est désigné via `REBASE_ADMIN_EMAIL` ci-dessous ou assigné avec la clé de service. Le fichier `.env.example` du scaffold le définit à `true` ; la valeur par défaut du framework est désactivée. | `false` |
| `DISABLE_SELF_REGISTRATION` | Coupe-circuit d'urgence. Ferme la fenêtre d'amorçage du premier utilisateur que `ALLOW_REGISTRATION=false` laisse délibérément ouverte hors production, fermant ainsi l'inscription même sur une base de données vide. À associer avec `REBASE_ADMIN_EMAIL` ci-dessous, sans quoi le déploiement n'aura aucun moyen de produire son premier utilisateur connecté. Chaque artefact de déploiement distribué le définit. | — |
| `REBASE_ADMIN_EMAIL` | Adresse e-mail du premier compte administrateur, créé au démarrage **tant que la table des utilisateurs est encore vide** et jamais par la suite. C'est ainsi qu'un déploiement de production obtient son admin : l'opérateur désigne le premier compte au lieu de faire la course avec Internet. Le démarrage émet un avertissement lorsque la table est vide en production et que cette variable n'est pas définie. | — |
| `REBASE_ADMIN_PASSWORD` | Mot de passe de ce compte. Au moins 12 caractères, sinon il est refusé et le compte n'est pas créé. Modifiez-le après la première connexion. | — |
| `MFA_ENCRYPTION_KEY` | Chiffre chaque secret TOTP stocké. Non défini, les secrets sont chiffrés avec `JWT_SECRET` à la place et le démarrage émet un avertissement unique — ainsi, la rotation de `JWT_SECRET` déconnecterait tout le monde *et* rendrait indéchiffrable chaque méthode d'authentification enregistrée. Définissez une clé dédiée (32+ caractères aléatoires) avant toute inscription d'utilisateurs. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | L'ancienne clé lors d'une rotation. Définissez les deux pendant une rotation : les nouveaux secrets sont écrits avec `MFA_ENCRYPTION_KEY` et les existants restent lisibles, évitant ainsi de bloquer quiconque hors de son compte en pleine rotation. Supprimez-la une fois que chaque secret a été ré-encrypté. | — |
| `ALLOW_ANONYMOUS` | Active la connexion anonyme (`POST /api/auth/anonymous`). Sur inscription volontaire (opt-in), et délibérément non conditionné par `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Exige l'authentification pour l'API de données. Définir à `false` pour une surface de lecture entièrement publique — le RLS continue de s'appliquer. | `true` |
| `AUTH_DEFAULT_ROLE` | Rôle attribué à un utilisateur nouvellement inscrit lorsqu'aucun n'est spécifié. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Monte `POST /api/auth/find-user`, qui résout un e-mail en un profil public minimal (`uid`, `displayName`, `photoURL`) pour les flux d'invitation par e-mail. Utilisateurs authentifiés uniquement, et ne renvoie jamais l'e-mail, les rôles ou les métadonnées de l'utilisateur trouvé. Désactivé par défaut : il s'agit d'une surface d'énumération. | `false` |
| `AUTH_COOKIE_SAME_SITE` | Attribut `SameSite` sur le cookie de rafraîchissement : `Strict`, `Lax` ou `None`. `None` requiert HTTPS et est réservé à un frontend véritablement cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | Attribut `Secure` sur le cookie de rafraîchissement. Sécurisé par défaut ; `AUTH_COOKIE_SECURE=false` pour du simple HTTP — par exemple un déploiement sur une adresse LAN où le navigateur rejetterait autrement le cookie et où la session mourrait à l'expiration du jeton d'accès sans erreur. Un avertissement est émis au démarrage. `http://localhost` n'en a pas besoin. | `true` |
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
| `APPLE_CLIENT_ID` | Services ID Apple, pour la connexion web. Il est public et est publié dans `GET /auth/config`. Apple n'a pas de secret client statique, car Rebase signe un JWT ES256 à courte durée de vie pour chaque échange de jetons. Apple requiert donc `APPLE_TEAM_ID`, `APPLE_KEY_ID` et `APPLE_PRIVATE_KEY`, en plus de cette variable ou de `APPLE_BUNDLE_IDS`, et ne configure rien sans eux. | — |
| `APPLE_BUNDLE_IDS` | Identifiants de bundle (séparés par des virgules) des applications natives iOS/macOS dont les codes Sign in with Apple sont acceptés. | — |
| `APPLE_TEAM_ID` | ID de l'équipe de développement Apple (Team ID), émetteur du JWT. | — |
| `APPLE_KEY_ID` | Key ID de la clé privée enregistrée auprès d'Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenu du fichier de clé privée `.p8`, sauts de ligne inclus (les échappements `\n` sont acceptés). | — |
| `REBASE_SERVICE_KEY` | Clé d'API administrateur statique. Contourne l'authentification JWT classique pour les appels de serveur à serveur lorsqu'elle est transmise via `Authorization: Bearer <key>`. (Générée automatiquement en développement). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Clé publique de la plateforme d'hébergement (PEM, EC P-256) utilisée pour valider les jetons de plateforme `rpt_` ; plusieurs blocs PEM lors d'une rotation de clés. La plateforme la définit lors du déploiement, et elle ne contient aucun secret. Conjointement avec `REBASE_PLATFORM_TOKEN_AUDIENCE`, elle permet au portail d'administration d'accepter un jeton de plateforme pour `cron:read`, et pour rien d'autre. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | L'identifiant de projet auquel l'`aud` d'un jeton de plateforme doit correspondre, évitant ainsi qu'un jeton créé pour un autre projet ne soit accepté. Si une seule des deux variables est définie, le serveur démarre, consigne un avertissement et répond à chaque jeton `rpt_` par un `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_RATE_LIMIT_STORE` | Emplacement de stockage des compteurs de limitation de débit (rate limit) d'authentification : `memory` (par processus) ou `sql` (partagé entre les réplicas). Un processus ne pouvant pas voir le nombre de ses réplicas, un déploiement avec plusieurs nœuds doit le spécifier — trois réplicas avec la configuration par défaut appliqueraient trois fois la limite. Toute autre valeur **refuse de démarrer** plutôt que de basculer sur une valeur par défaut, `postgres` inclus. | `memory` |
| `AUTH_MAGIC_LINK` | Monte le flux de lien de connexion sans mot de passe (magic link). Nécessite un service d'e-mail configuré, sans quoi le lien n'a aucune destination. | `false` |
| `AUTH_EMAIL_OTP` | Monte la connexion sans mot de passe avec un code à six chiffres envoyé par e-mail. Même exigence d'e-mail que ci-dessus. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Inscription sans mot de passe : une demande de lien magique ou de code par e-mail pour une adresse inconnue crée le compte, tant que l'inscription est ouverte. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Action effectuée lorsqu'un jeton de rafraîchissement est rejoué après sa fenêtre de réutilisation : `reject` (le refuser, conserver la session) ou `revoke-session` (mettre fin à la session). Toute autre valeur fait échouer le démarrage. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Inscription avec confirmation préalable : pas de connexion par mot de passe tant que l'adresse n'est pas vérifiée. Nécessite la configuration de l'e-mail ; le démarrage est refusé sans celle-ci. | `false` |
| `CAPTCHA_PROVIDER` | Active la vérification par captcha sur les routes d'authentification : `turnstile` ou `hcaptcha`. Non défini signifie aucun captcha. | — |
| `CAPTCHA_SECRET` | Secret du fournisseur de captcha, utilisé côté serveur pour vérifier le jeton envoyé par le navigateur. Requis dès lors que `CAPTCHA_PROVIDER` est défini. | — |
| `CAPTCHA_ROUTES` | Routes d'authentification à protéger, séparées par des virgules (par exemple `register,login`). Non défini protège l'ensemble par défaut du fournisseur. | — |

### Stockage

:::caution[Le stockage ne dispose pas de sécurité au niveau des lignes (RLS), il nécessite donc un modèle d'accès]
Les collections sont protégées par le RLS de Postgres. Le stockage d'objets n'a pas d'équivalent —
les clés partagent un espace de noms plat unique — ainsi, avec un bucket configuré et aucun modèle d'accès,
le serveur **refuse de démarrer en production**. Remplissez cette condition avec exactement l'un des éléments suivants :
un hook `storageAuthorize` exporté depuis `config/index.ts` (ce que fournit le scaffold),
`STORAGE_PUBLIC_READ`, ou `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `STORAGE_TYPE` | Backend de stockage : `local`, `s3` ou `gcs`. En production, `local` désactive le stockage sauf si `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Chemin de base pour le stockage local. Un chemin relatif est lu depuis le répertoire dans lequel le serveur tourne : la racine du projet sous `rebase dev`, `backend/` dans un serveur généré par `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Autorise le stockage local en production — uniquement avec un volume persistant hébergeant `STORAGE_PATH` et les répertoires `<STORAGE_PATH>__<key>` des buckets locaux nommés à ses côtés | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Durée en secondes pendant laquelle l'URL de téléchargement d'un fichier privé fonctionne — le jeton que `getSignedUrl()` y insère. Au maximum `604800` (une semaine) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Taille maximale de fichier acceptée par la source, en octets, sur chaque chemin d'upload — `__<KEY>` pour une source nommée. Une valeur qui n'est pas un nombre entier d'octets refuse le démarrage | `52428800` (50 Mo) |
| `S3_BUCKET` | Nom du bucket S3 (lorsque `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Région AWS | — |
| `S3_ACCESS_KEY_ID` | Clé d'accès AWS | — |
| `S3_SECRET_ACCESS_KEY` | Clé secrète AWS | — |
| `S3_ENDPOINT` | Point de terminaison S3 personnalisé (pour MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Force les URL de type "path-style" pour le bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nom du bucket GCS (lorsque `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Projet GCP. Généralement déduit des identifiants. | — |
| `GCS_KEY_FILENAME` | Chemin vers un fichier de clé de compte de service. À omettre sur GCP, où Workload Identity fournit les identifiants. | — |
| `STORAGE_PUBLIC_READ` | Sert chaque objet à tout le monde, sans jeton. Réservé à un bucket qui agit véritablement comme un CDN public. L'une des trois manières de satisfaire la vérification au démarrage ci-dessous. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permet à tout utilisateur connecté de lire, écrire, lister et supprimer chaque objet. Nommé `INSECURE` dans l'objet de configuration pour une bonne raison : ce n'est défendable que dans une application mono-tenant où chaque compte est digne de confiance pour chaque fichier. | `false` |
| `STORAGE_RENDITION_CACHE` | Met en cache les rendus d'images générés (redimensionnements, conversions de formats) au lieu de les produire à chaque requête. | `false` |

### E-mail (facultatif)

| Variable | Description |
|----------|-------------|
| `SMTP_HOST` | Hôte du serveur SMTP |
| `SMTP_PORT` | Port du serveur SMTP |
| `SMTP_SECURE` | Activer la connexion sécurisée (`true`/`false`) |
| `SMTP_USER` | Nom d'utilisateur SMTP |
| `SMTP_PASS` | Mot de passe SMTP |
| `SMTP_FROM` | Adresse d'expéditeur pour les e-mails système |
| `SMTP_NAME` | Nom affiché sur l'adresse de l'expéditeur |
| `APP_NAME` | Nom du produit utilisé dans les objets et corps d'e-mails (par défaut : `Rebase`) |
| `EMAIL_LOGO_URL` | Logo affiché au-dessus des modèles d'e-mails par défaut. URL PNG ou JPG absolue en `http(s)` — les clients de messagerie suppriment les SVG et bloquent les URI `data:`. Non défini, une application toujours nommée `Rebase` reçoit le logo Rebase, et une application renommée n'en reçoit aucun |

### Pool de connexions à la base de données

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `DB_POOL_MAX` | Nombre maximal de connexions dans le pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Millisecondes pendant lesquelles une connexion inactive est conservée | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Millisecondes d'attente pour une connexion | `10000` |
| `DATABASE_DIRECT_URL` | Connexion directe (sans pool). Le [Realtime](/docs/backend/realtime) en a besoin : `LISTEN`/`NOTIFY` ne survit pas à un pooler en mode transactionnel comme PgBouncer, et sans cela les notifications de changements sont désactivées avec un avertissement au lieu d'être silencieusement perdues. Le [job worker](/docs/backend/jobs) y maintient également son `LISTEN` de réveil. Remplit la valeur `directConnectionString` de l'adaptateur Postgres lorsque celle-ci n'est pas définie. | — |
| `DATABASE_READ_URL` | Réplica de lecture, tel qu'un hot standby. Lorsqu'il désigne un autre serveur, les lectures authentifiées (listes, lignes individuelles, totaux, agrégats) y sont servies sous le même contrôle d'accès au niveau des lignes (RLS) ; les écritures, connexions, le temps réel, les tâches cron, les jobs, la console SQL et `rebase.sql` restent sur la base primaire. Un utilisateur venant d'écrire lira depuis le primaire pendant `REBASE_READ_STICKY_MS`, et tout le monde le fera tant que le réplica a plus de `REBASE_READ_MAX_LAG_MS` de retard ou est en échec. Remplit `readConnectionString` de l'adaptateur Postgres lorsque celle-ci n'est pas définie ; jusqu'à la version 0.28 incluse, le pool du réplica était ouvert et jamais utilisé en lecture. | — |
| `REBASE_READ_STICKY_MS` | Après une écriture, durée pendant laquelle les lectures du même utilisateur vont vers le primaire, de sorte qu'une sauvegarde suivie d'un affichage de liste reflète bien la sauvegarde. Par instance de serveur. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Retard maximal du réplica au-delà duquel toutes les lectures basculent sur le primaire. | `1000` |
| `DATABASE_POOLED` | `true` lorsque `DATABASE_URL` passe par un pooler en mode transaction comme PgBouncer. Le pool n'envoie alors aucun `search_path` ou `statement_timeout` à la connexion (le pooler les refuserait ou les ignorerait) et applique les deux dans chaque transaction ; le démarrage attribue au rôle de base de données un `search_path` par défaut fixé à `public` pour les requêtes hors transaction. `DATABASE_DIRECT_URL` devient requis, et le temps réel, le réveil du job worker, la création d'index, le branching et la console SQL l'utilisent tous. L'URL du réplica est également considérée comme utilisant un pool. `DATABASE_POOLED__<KEY>` pour une autre source de données. | — |
| `REBASE_DB_POOL_MAX` | Plafond global appliqué à chaque pool du processus, quelle que soit la demande formulée par chacun d'entre eux. Chiffres bruts uniquement : une valeur mal formée est ignorée plutôt que de forcer silencieusement le serveur à sérialiser ses accès. | — |

### Comportement du runtime

Lu par le runtime — `rebase dev`, `rebase start` et l'image de serveur publiée.
Un projet qui a été éjecté prend ces décisions directement dans son propre code.

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `REBASE_RLS_AUDIT` | `true` exécute l'[audit de sécurité au niveau des lignes](/docs/rls-check#running-it-on-a-schedule) planifié, qui signale les tables servies sans politiques RLS. Le projet doit déclarer `@rebasepro/rls-check` parmi ses dépendances : le runtime n'en fournit aucune copie, et sans ce paquet, le démarrage est refusé en mentionnant son nom. `false` désactive le scan sur ce processus. | — |
| `REBASE_RLS_REQUEST_ROLE` | Le rôle Postgres sous lequel s'exécutent les requêtes authentifiées et anonymes. Donnez à chaque projet d'un cluster partagé le sien. Une base de données enregistre le rôle sous lequel elle s'exécute, et un démarrage configuré pour un autre rôle refuse de se lancer tant que `rebase db request-role migrate` ne l'a pas migrée. Voir [Exécuter sur une base de données existante ou partagée](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` crée le rôle des requêtes et permet à la connexion d'y basculer ; `never` vous laisse les deux et se contente de les vérifier. | `auto` |
| `REBASE_RLS_GRANTS` | Ce que Rebase accorde au rôle des requêtes : `schema` (toutes les tables des schémas qu'il sert, plus les privilèges par défaut), `managed` (uniquement les tables qu'il sert) ou `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` restreint les politiques permissives de Rebase au(x) rôle(s) des requêtes, de sorte que les autres rôles lisant les mêmes tables n'en obtiennent rien. | `public` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` supprime de chaque collection la politique de base serveur-ou-admin. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` définit aussi `request.jwt.claims` et `request.jwt.claim.*`, afin que les politiques écrites avec `auth.uid()` voient l'appelant. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | Ce que fait un démarrage lorsqu'une autre connexion (login) peut basculer vers le rôle des requêtes : `warn`, `refuse` ou `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Chemin de base pour toutes les routes d'API. Le client doit être configuré à l'identique — voir [Modification de `basePath`](#modification-de-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Sert les ressources statiques et administratives du bundle depuis ce processus. Désactivez-le lorsqu'un CDN est placé en frontal. | `true` |
| `REBASE_HISTORY` | Enregistre l'[historique des modifications d'entités](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Active la compression gzip/brotli des réponses. | `true` |
| `REBASE_MAX_BODY_SIZE` | Taille maximale du corps de la requête, **en octets** (`10485760`, pas `10MB` — une valeur qui n'est pas un nombre refuse le démarrage plutôt que de supprimer silencieusement la limite). `0` désactive la limite. | `10485760` (10 Mio) |
| `REBASE_ENABLE_SWAGGER` | L'interface OpenAPI. Valeur à trois états : non défini signifie activé en développement, désactivé en production ; `false` désactive les deux partout. Notez que `true` en production sert la **spécification** sur `/api/docs` mais pas l'**interface utilisateur** Swagger sur `/api/swagger` — l'UI dépend de `NODE_ENV` de manière distincte. | — |
| `REBASE_METRICS` | Expose les métriques Prometheus sur `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Ajoute `includeSubDomains` à l'en-tête `Strict-Transport-Security`, obligeant les navigateurs à refuser le HTTP simple sur tous les sous-domaines de l'hôte pendant six mois — y compris les hôtes non servis par ce processus. Ne l'activez que si chaque sous-domaine du domaine est exclusivement en HTTPS. Toute valeur autre que `true`/`false` refuse le démarrage. Voir les [En-têtes de sécurité](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Jeton Bearer protégeant `/metrics`. Non défini laisse le endpoint ouvert à quiconque peut atteindre le port — sans risque sur un réseau privé, déconseillé sur un réseau public, ce que signalent les logs de démarrage. | — |
| `REBASE_MIGRATE_ON_BOOT` | Ce que le runtime est autorisé à appliquer au schéma de collections au démarrage. `ensure` (valeur par défaut, partout — y compris en production) effectue la passe **additive** : crée les tables, colonnes et types enum manquants, sans jamais en supprimer ni en réécrire un. `none` ne touche pas au schéma de collections, mais les tables propres au framework (authentification, clés d'API, jobs, cron) restent créées et tenues à jour ; `REBASE_PROVISION=false` désactive également ces dernières. L'image publiée n'accepte que ces deux valeurs et **refuse de démarrer avec `push`**. Dans un [déploiement fractionné](/docs/deployment/split-processes), un seul processus a le droit de provisionner, tous les autres rôles doivent donc définir `none` sous peine de refuser de démarrer. | `ensure` |
| `REBASE_PROVISION` | `false` empêche le runtime de modifier quoi que ce soit dans sa base de données : aucune table, colonne, index, fonction, déclencheur, politique, rôle ou privilège, au démarrage ou ultérieurement, y compris ceux propres au framework. Il consigne plutôt par leur nom les éléments manquants. Conçu pour une base de données que seul votre processus de gestion de changements a le droit de modifier. Voir [Quand seul votre processus de changement peut modifier la base de données](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Seuls `true` et `false` sont acceptés. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Refuse le démarrage lorsque la base de données a été provisionnée pour la dernière fois à partir d'un jeu de collections différent de celui avec lequel ce processus a été construit. Non défini (ou toute valeur autre que `true`/`1`) émet un avertissement à la place. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Refuse le démarrage lorsqu'un fichier de fonction ou de tâche cron lève une exception ou ne s'analyse pas lors de l'import, en indiquant chaque fichier et la raison, afin qu'un déploiement progressif (rolling deploy) laisse l'ancienne version en service. Un redémarrage est également soumis à cette règle. Non défini (ou toute valeur autre que `true`) ignore le fichier et sert le reste. Un fichier qui s'importe proprement et n'exporte aucune fonction ou job est toujours ignoré, et non refusé. | skip |
| `REALTIME_CDC` | Capture des changements au niveau de la base de données : `auto` (activé lorsque la connexion le prend en charge, bascule silencieusement sinon), `trigger` (le force, avertit si impossible), `wal` (lit les modifications depuis le journal de transactions write-ahead log au lieu de déclencheurs ; nécessite `wal_level=logical` et un rôle autorisé à répliquer, bascule sur `trigger` sinon), `off`. Voir [Temps réel](/docs/backend/realtime-cdc/). Prioritaire sur `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Transport inter-instances pour les canaux de diffusion (broadcast) et la présence : `memory` ou `postgres`. Ignoré si `realtime.bus` a reçu une instance de transport personnalisée. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Nombre maximal d'abonnements qu'un socket temps réel peut détenir ; le suivant est rejeté avec `TOO_MANY_SUBSCRIPTIONS`. Un entier strictement positif — toute autre valeur interrompt le serveur au démarrage. Prioritaire sur `realtime.maxSubscriptionsPerSocket`. Voir [Temps réel](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Nombre maximal de sockets temps réel qu'un utilisateur, ou une clé d'API, peut maintenir ouverts sur une même instance de serveur. Les sockets d'usurpation d'identité d'un administrateur sont imputés à l'administrateur. La connexion du socket suivant est refusée avec `TOO_MANY_SOCKETS` et le socket est fermé (4002) ; le SDK réessaye continuellement et se connecte dès qu'un autre se ferme. Un entier strictement positif — toute autre valeur interrompt le serveur au démarrage. Prioritaire sur `realtime.maxSocketsPerUser`. | Sans plafond |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Durée maximale d'attente d'un changement avant le rafraîchissement qui le transmet aux abonnés actifs, en ms. Un rafraîchissement attend 300 ms en l'absence de modification, et au maximum cette durée lors d'un flux continu d'écritures. Un entier strictement positif — toute autre valeur interrompt le serveur au démarrage. Prioritaire sur `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Durée maximale de réutilisation du total calculé pour une souscription à une grande liste avant recomptage, en ms ; les frames qui le réutilisent incluent `meta.totalAsOf`. Non défini, chaque frame recompte. Prioritaire sur `realtime.recountIntervalMs`. | Non défini |
| `REALTIME_RECOUNT_MIN_ROWS` | Plus petit total précédent auquel `REALTIME_RECOUNT_INTERVAL_MS` s'applique ; les listes plus petites sont recomptées à chaque frame. Prioritaire sur `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Autorise les valeurs `localhost`/boucle locale sous `NODE_ENV=production`. Désactivé par défaut, pour qu'un démarrage en production échoue explicitement au lieu de tenter de se connecter à une base de données absente. | `false` |
| `REBASE_STRICT_COLLECTION_CONFIG` | Action au démarrage face à une clé de vos collections que cette version ne reconnaît pas : `warn`, `error` (refuse de démarrer — utile à activer en CI), ou `off`. Ne concerne que les clés non *reconnues*, qui sont généralement des fautes de frappe et parfois des métadonnées délibérées ; une clé reconnue comme ayant changé d'emplacement est toujours fatale, car la fonctionnalité correspondante serait silencieusement absente sinon. | `warn` |
| `REBASE_PROVISION_ONLY` | `1`/`true` exécute la passe de schéma puis s'arrête sans ouvrir de socket — idéal pour un Job de migration, à partir de la même image et du même bundle que le serveur qui suivra. Il crée également les tables qu'un processus servant les requêtes créerait autrement à la première utilisation, et ne démarre aucun planificateur cron ni file de jobs. Une valeur vide est considérée comme *non définie*, de sorte qu'un `${SOMETHING}` non substitué dans un fichier compose ne transforme pas un déploiement standard en processus de migration refusant de servir les requêtes. Refusé en combinaison avec `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Un chemin de fichier. Une exécution de provisionnement (`REBASE_PROVISION_ONLY=true`) y écrit toutes les modifications de schéma effectuées, dans l'ordre, sous la forme d'un script SQL à examiner et appliquer avec `psql`. Les lignes insérées n'y figurent pas. Refusé sur un processus servant les requêtes. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permet à une machine — un agent, un job CI — d'*appliquer* une modification de schéma via `/api/admin/schema`, et pas seulement d'en planifier une. Désactivé par défaut : le secret permettant d'effectuer une telle modification est celui qui a le plus de risques de figurer dans une variable CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Durée maximale d'exécution d'une fonction personnalisée avant abandon de sa requête. Même réglage que l'option `functionsTimeoutMs`. `0` désactive la limite. | `30000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` fait en sorte qu'un rejet de promesse non géré mette fin au processus au lieu de simplement consigner une erreur. À activer sous un orchestrateur chargé de redémarrer le conteneur ; à désactiver lorsqu'un redémarrage est pire qu'une fuite de ressources. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Masque l'avertissement de démarrage sur une plateforme détectée par le runtime comme réduisant les instances à zéro (scale-to-zero), où un déclencheur planifié sur une instance inactive ne s'exécutera sur aucune instance. Ne modifie rien d'autre : à définir si vous maintenez au moins une instance active en continu. | — |
| `TRUSTED_PROXY_HOPS` | Nombre de proxys placés devant ce serveur, pour que le limiteur de débit puisse lire la véritable adresse client depuis `X-Forwarded-For`. Valeur par défaut sécurisée à `0` : sans proxy, faire confiance à cet en-tête permettrait à n'importe quel client d'usurper une identité. | `0` |

:::note[Le provisionnement au démarrage est additif et n'est pas un outil de migration]
La passe de démarrage s'exécute de manière automatisée sans relecture humaine d'un diff ; elle ne supprimera
donc jamais une colonne, ne réduira jamais un type et ne réécrira jamais une table. C'est également pourquoi l'image refuse
`REBASE_MIGRATE_ON_BOOT=push` : un push complet calcule un diff et n'hésitera pas à faire un
`DROP COLUMN`, or un redémarrage de conteneur ne doit jamais détruire une
colonne de production suite à un simple réordonnancement d'instances.

Les modifications destructives ou structurelles restent cantonnées aux outils permettant une revue : `rebase db
generate` + `rebase db migrate`, ou `rebase db push` depuis un checkout local ou la CI,
qui simule la modification, refuse les changements destructifs sans confirmation et
peut effectuer une sauvegarde préalable.
:::

### Déploiements fractionnés (split deployments)

Une même image et un même bundle peuvent être démarrés plusieurs fois, chacun servant une
partie différente du projet. Une ligne résume chaque variable ici, cette page répertoriant
toutes les variables disponibles ; le détail de ce que chaque combinaison *monte et prend en charge* — ainsi que
les combinaisons refusées au démarrage — est documenté sur
**[Processus fractionnés](/docs/deployment/split-processes)**.

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `REBASE_ROLE` | Partie servie par ce processus : `all`, `api`, `functions` ou `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Définit explicitement si *ce* processus exécute les tâches planifiées cron. Non défini se conforme au rôle. | — |
| `REBASE_JOB_WORKERS` | Définit explicitement si ce processus exécute les workers de la file de jobs. Non défini se conforme au rôle. | — |
| `REBASE_FUNCTIONS_ONLY` | Ne sert que les fonctions personnalisées désignées dans ce processus. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Sert toutes les fonctions personnalisées à l'exception de celles désignées. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Emplacement vers lequel le processus API redirige une requête de fonction qu'il ne sert pas lui-même. Sur un `worker`, destination de ses propres appels `rebase.functions`. Une URL en `http(s)`. | — |

### Surface MCP

Un point de terminaison optionnel basé sur le protocole Model Context Protocol (MCP) à l'adresse `/mcp`, permettant à un client d'IA de lire
et d'écrire sur ce projet **en tant qu'utilisateur connecté**. Désactivé par défaut, et — contrairement
aux autres surfaces — aucun `REBASE_ROLE` ne l'active implicitement : les rôles décrivent la structure
d'un processus, tandis que cette activation consiste à confier des identifiants à des logiciels
tiers, décision qui doit être prise par un opérateur humain plutôt qu'héritée du
rôle assigné à un conteneur.

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `REBASE_MCP_ENABLED` | Monte la surface MCP. Nécessite `REBASE_PUBLIC_URL` ; sans elle, la surface refuse de se monter et le signale dans les logs de démarrage. | `false` |
| `REBASE_PUBLIC_URL` | Origine accessible publiquement de ce déploiement, ex. `https://app.example.com`. La surface MCP ne peut pas la déduire — extraire l'origine de l'en-tête `Host` transformerait l'identité de l'émetteur, ainsi que l'audience de validation de ses propres jetons, en une valeur contrôlée par l'appelant. | — |
| `REBASE_MCP_VIEW` | Chemin vers la vue d'application MCP propre au projet (`rebase-view.html`, généré par `rebaseMcpViewPlugin()`), servie à Claude à la place de la vue générique pour qu'il affiche vos vues, champs et actions personnalisés. Sans cela, le backend cherche à côté du frontend qu'il sert. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Autorise l'enregistrement dynamique de clients OAuth (RFC 7591), permettant à un client de s'enregistrer de lui-même. Définir à `false` pour exiger un pré-enregistrement des clients. | `true` |

### Édition de schéma en direct depuis un bundle

Désactivé sauf si `REBASE_LIVE_SCHEMA_REPOSITORY` est défini. Un bundle compilé ne disposant
pas des sources des collections pour les modifier, l'éditeur de collections de l'administration
lit la source depuis le dépôt avec ces variables, commite chaque modification,
et applique son DDL sur cette base de données. Réservé aux administrateurs, et appliqué par
un humain sauf si `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` indique le contraire. Un dépôt configuré
sans identifiants exploitables refuse de démarrer. Voir
l'[Édition de schéma en direct](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Dépôt GitHub sur lequel commiter les changements de schéma, au format `owner/name`. Définir cette variable active la fonctionnalité. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | Branche sur laquelle le commit est appliqué. | `main` |
| `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH` | Emplacement des sources des collections dans ce dépôt, relatif à la racine du dépôt. | `config/collections` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Jeton d'accès affiné (fine-grained token) avec accès en lecture et écriture au contenu du dépôt. Définissez soit cette variable, soit les trois variables `_GITHUB_APP_*`, mais pas les deux. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | Identifiant d'une GitHub App, pour commiter sous son identité plutôt qu'avec un jeton personnel. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | Identifiant d'installation de l'application sur le dépôt. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | Clé privée de l'application : PEM, PEM avec retours à la ligne échappés, ou base64. | — |

### Sauvegardes

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `BACKUP_SCHEDULE` | Expression cron pour les sauvegardes planifiées. Non défini désactive les sauvegardes planifiées. | — |
| `BACKUP_DESTINATION` | Chemin local, ou URL au format `s3://bucket/prefix` / `gs://bucket/prefix`. Requis avec `BACKUP_SCHEDULE`, qui refuse de s'exécuter sans cela. `rebase db backup` se rabat sur `./backups` là où la commande a été lancée. | — |
| `BACKUP_RETENTION_DAYS` | Supprime les sauvegardes antérieures à N jours. Non défini ou `0` conserve l'ensemble des sauvegardes. | — |
| `BACKUP_KEEP_MINIMUM` | Conserve toujours au moins N sauvegardes parmi les plus récentes, quelle que soit la durée de rétention. | — |
| `PG_DUMP_PATH` | Remplace le binaire `pg_dump` — il doit correspondre à la version majeure du serveur ou être plus récent. | — |
| `PG_RESTORE_PATH` | Remplace le binaire `pg_restore`. | — |
| `PSQL_PATH` | Remplace le binaire `psql` exécuté par `rebase db restore --clean` pour faire de la restauration une transaction unique. | — |
| `PG_DUMPALL_PATH` | Emplacement de `pg_dumpall`, lorsqu'il n'est pas présent dans le `PATH`. Sans lui — et sans les outils clients PostgreSQL installés — une sauvegarde globale échoue en désignant cette variable. | — |

L'image de runtime officielle (`rebasepro/server`) intègre les outils clients
PostgreSQL 18, une sauvegarde planifiée y fonctionne donc face à tout serveur jusqu'à Postgres 18.
En dehors de cette image, installez-les vous-même (`apt-get install postgresql-client-18`,
`brew install libpq`).

Les sauvegardes contiennent des secrets et des données personnelles (PII). Utilisez une destination privée avec
chiffrement au repos.

### Livraison de bundle

Un déploiement managé n'embarque pas son code dans l'image : le runtime télécharge un
bundle au démarrage. Ces variables déterminent lequel et comment.

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `REBASE_BUNDLE` | Chemin vers un répertoire de bundle déjà extrait. Ce que `rebase start` définit localement. | — |
| `REBASE_BUNDLE_URL` | Emplacement où télécharger l'archive du bundle en l'absence de bundle local. | — |
| `REBASE_BUNDLE_TOKEN` | Identifiant Bearer pour ce téléchargement. Traitez-le comme un secret : c'est ce qui autorise un tenant à télécharger son propre code. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Répertoire d'extraction d'un bundle téléchargé. Doit être accessible en écriture et persister entre le téléchargement et le démarrage. | — |
| `REBASE_RUNTIME_MODULES` | Modules supplémentaires fournis par l'image de runtime au bundle, au-delà de ceux qu'il déclare lui-même. | — |

### Liaisons de ressources

Chaque base de données, bucket et topic déclaré par un projet dans `config/resources.ts` est
lié via des variables d'environnement basées sur son nom. Les noms de base sont listés ci-dessous ; une
ressource non par défaut y accole `__` suivi de sa clé en majuscules, ainsi un bucket nommé
`media` lit `S3_BUCKET__MEDIA`. `rebase status`
affiche, par ressource,
la variable exacte lue et son état de définition.

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `REBASE_DRIVER` | Paquet npm implémentant le pilote d'une source de données, lorsque ce n'est pas le pilote Postgres par défaut. Suffixé par source : `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | Chaîne de connexion pour un topic déclaré. Suffixé par topic. | — |

### Environnement propre au CLI

Lu par `rebase`, pas par le serveur. Rien ici n'affecte un déploiement.

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `REBASE_BASE_URL` | Destination à laquelle `rebase api-keys`, `rebase storage` et `rebase auth reset-password` transmettent la clé de service, dans le shell ou dans `.env`. À renseigner lorsque le serveur fonctionne autrement que via `rebase dev` dans ce projet : `rebase start`, un conteneur, un autre hôte. Non défini, les commandes utilisent le serveur enregistré par `rebase dev` tant qu'il tourne, et n'envoient rien s'il est arrêté. | — |
| `REBASE_SERVICE_KEY` | Clé de service avec laquelle ces commandes s'authentifient, lue depuis `.env` : la même variable que celle lue par le serveur (voir plus haut). | — |
| `SERVICE_KEY` | Ancienne appellation de cette clé. Si elle est définie dans `.env`, `rebase api-keys` et `rebase storage` la lisent à la place de `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Fichier `.env` que le CLI lit et modifie, lorsqu'il ne s'agit pas de celui du projet. | — |
| `REBASE_ROOT_RULES` | `0` empêche `rebase init` et `rebase skills install` d'écrire les règles du projet dans les fichiers `CLAUDE.md` et `AGENTS.md` à la racine du dépôt, pour les racines dont vous maintenez les fichiers d'agents manuellement. | on |
| `REBASE_CLOUD_URL` | Plan de contrôle avec lequel `rebase cloud` communique. | — |
| `REBASE_CLOUD_EMAIL` | Compte avec lequel `rebase cloud login` se connecte, évitant la saisie interactive. | — |
| `REBASE_CLOUD_PASSWORD` | Mot de passe associé, pour qu'un gestionnaire de secrets puisse le transmettre sans qu'il apparaisse dans l'historique du shell. | — |
| `REBASE_TOKEN` | Jeton généré par `rebase cloud tokens create`. S'il est défini, chaque commande `rebase cloud` s'authentifie avec lui à la place de la session `rebase cloud login`, et ne lit ni n'écrit jamais la session stockée. Dans un répertoire lié par `rebase cloud init --claim`, il est ignoré au profit du jeton propre à ce projet s'il ne possède aucun droit sur celui-ci. Il s'agit du mode recommandé pour exécuter `rebase cloud` en CI — voir [CI et agents](/docs/deployment/cloud/#ci-and-agents). Le [serveur MCP](/docs/ai/mcp/) le transmet au CLI invoqué par ses outils cloud, et ne l'envoie jamais à l'application : définissez `REBASE_API_TOKEN` pour cela. | — |
| `REBASE_DEBUG` | `1` affiche l'erreur sous-jacente et le détail des requêtes au lieu du message abrégé. La première option à activer lorsqu'une commande `rebase cloud` échoue sans explication claire. | — |
| `REBASE_ATLAS_DEV_URL` | La base de données vide sur laquelle `rebase db push`, `db generate` et `db migrate` planifient leurs changements, au lieu de la base `<db>_dev_diff` qu'ils créent à côté de `DATABASE_URL`. Rebase ne crée ni ne supprime aucune base mentionnée ici, et refuse une base identique à `DATABASE_URL`. Sur la base de données de développement gérée, le CLI la fait pointer vers son propre PGlite éphémère en mémoire. À définir lorsque le privilège `CREATE DATABASE` n'est pas accordé. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` ne démarre aucune base de données et ne provisionne rien — vous devez fournir la vôtre. Identique à `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fixe le port du serveur de développement frontend, que `rebase dev` déduit autrement à partir du chemin du projet. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Durée maximale d'attente par `rebase dev` du signal de disponibilité du backend avant d'indiquer qu'il n'a pas démarré. `0` désactive ce contrôle. | `30000` |
| `DATABASE_PASSWORD` | Mot de passe inséré par `rebase dev --docker` dans la chaîne de connexion qu'il génère à partir de `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | Convention standard multi-outils. Si défini à toute valeur autre que `0`, le CLI n'envoie aucune télémétrie. | — |
| `REBASE_TELEMETRY_DISABLED` | Équivalent, spécifique à Rebase. Ne requiert aucun fichier, ce qui en fait le choix idéal en CI et dans une image de conteneur. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Destination d'envoi de la télémétrie, pour un collecteur auto-hébergé. | — |

## Secrets en développement

`JWT_SECRET` est requis en production. Cette variable et `REBASE_SERVICE_KEY` sont
générées pour vous hors production, afin que vous puissiez démarrer sans configuration préalable.

Ces valeurs générées sont mises en cache dans `.rebase-dev-secrets.json`, aux côtés de
`.rebase-dev-port` et `.rebase-dev-url`, et ignorées par git avec ces derniers. Auparavant, elles
étaient régénérées à chaque démarrage — ainsi, redémarrer le serveur de dev vous déconnectait de
votre propre application et invalidait toute clé d'API créée juste avant.

- Définissez l'une de ces variables explicitement et votre valeur sera utilisée ; rien ne sera mis en cache ni lu.
- Déplacez le cache vers un autre emplacement avec `REBASE_DEV_SECRETS_FILE` — un chemin de fichier, et la
  seule variable de cette section que vous pourriez avoir intérêt à définir délibérément.
- Supprimez le fichier pour effectuer une rotation des deux secrets. Le démarrage suivant en écrira un nouveau.
- Si le fichier ne peut pas être écrit — par exemple dans un conteneur en lecture seule —, le serveur démarre
  malgré tout avec un secret éphémère, exactement comme auparavant.

Rien n'est mis en cache en production, ni sous un exécuteur de tests. En production, rien
n'est généré non plus : un démarrage sans `JWT_SECRET` échoue en désignant la variable,
ce comportement restant inchangé :

```
The environment is not valid:
  JWT_SECRET: is required
```

## Objet de configuration du backend

L'objet `RebaseBackendConfig` transmis à `initializeRebaseBackend()` offre un contrôle programmatique :

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
sans `app`, `server` et `basePath` et avec un `provision` obligatoire, permettent de construire un
backend qui ne sert rien jusqu'à ce que vous le montiez : `createRebaseBackend`. Voir
[Intégration d'un serveur personnalisé](/docs/backend/custom-server/).

### Modification de `basePath`

`basePath` déplace chaque route d'API, le client doit donc en être informé à l'identique —
faute de quoi il continuera d'appeler `/api/...` et obtiendra des erreurs 404 sur chaque requête :

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

Le panneau d'administration récupère ce paramètre auprès du client qui lui est fourni ; rien d'autre n'a besoin
d'être configuré. Si vous construisez une URL de requête manuellement, concaténez-la à partir du client plutôt
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

* **Symptômes :** Les requêtes personnalisées exécutées dans l'éditeur SQL de Rebase Studio échouent avec `cause: error: permission denied for table <name>`, alors même que la vue CMS en tableau charge les données sans problème.
* **Cause :** Par défaut, Rebase tente d'exécuter les requêtes de l'éditeur SQL en basculant temporairement de rôle de base de données pour correspondre au rôle applicatif de l'utilisateur actif (par ex. `SET LOCAL ROLE "admin"`). Si vous utilisez une authentification personnalisée où les rôles existent uniquement dans des tables de base de données plutôt qu'en tant que rôles PostgreSQL réels, le basculement de rôle échoue ou les privilèges de base de données manquent. La vue CMS en tableau s'exécute sous l'utilisateur propriétaire de la connexion par défaut et contourne cette contrainte.
* **Solution :** Ajoutez `DISABLE_DB_ROLE_SWITCHING=true` à votre configuration `.env` backend. Cela force Rebase à exécuter les requêtes de l'éditeur SQL avec les privilèges du propriétaire de la connexion (généralement un superuser/owner). L'éditeur SQL affiche alors au-dessus des résultats qu'ils ont été lus en tant que propriétaire de la connexion, et grise son sélecteur de rôle.

### Échec de récupération du schéma dans l'éditeur SQL (`Cross-database execution requires adminConnectionString`)

* **Symptômes :** Studio ne parvient pas à charger l'arborescence des schémas, ou l'éditeur SQL renvoie `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Cause :** Rebase nécessite des privilèges administratifs pour interroger les catalogues système de la base de données et exécuter des commandes d'administration. Si `adminConnectionString` n'est pas fourni au bootstrapper, ou si `getAdmin()` est surchargé pour renvoyer `undefined`, ces opérations échouent.
* **Solution :** Assurez-vous que `adminConnectionString` est bien configuré lors de l'initialisation du bootstrapper backend :
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Prochaines étapes

- **[Déploiement](/docs/getting-started/deployment)** — Guide de déploiement en production
- **[Vue d'ensemble du backend](/docs/backend)** — Référence complète de configuration backend
