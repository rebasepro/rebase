---
sourceHash: cf61934167f91e79
title: Environnement & Configuration
sidebar_label: Configuration
description: Toutes les variables d'environnement et options de configuration pour les projets Rebase.
---

## Variables d'environnement

Toute la configuration s'effectue via des variables d'environnement dans votre fichier `.env` à la racine du projet.

> **Important** : Rebase valide les variables d'environnement avec **Zod** au démarrage. Si
> un élément requis est manquant ou mal formé (une URL qui n'est pas une URL, un port qui
> n'est pas un nombre), le serveur refuse de démarrer et indique la variable en cause.
>
> L'emplacement du schéma dépend de la manière dont vous exécutez le backend. Un projet démarré par
> le runtime — `rebase dev`, `rebase start`, l'image publiée — utilise le
> schéma détenu par le runtime (`loadBootEnv` dans `@rebasepro/server`), qui est l'union
> de tous les tableaux ci-dessous. Un projet ayant exécuté [`rebase eject`](/docs/cli)
> possède un fichier `backend/src/env.ts` appelant `loadEnv({ extend })`, et peut y ajouter
> ses propres variables typées.

### Requises

| Variable | Description | Exemple |
|----------|-------------|---------|
| `DATABASE_URL` | Chaîne de connexion PostgreSQL. **Optionnelle en développement** — si non définie, `rebase dev` exécute un PostgreSQL géré pour le projet, avec ses données sous `.rebase/`. Requise partout ailleurs. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Clé secrète pour signer les jetons JWT. Utilisez une chaîne aléatoire robuste (min. 32 caractères). **Requise en production** (générée automatiquement en développement). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` est une syntaxe propre à node-postgres, pas à libpq.**
>
> Rebase et le pilote Node l'acceptent — chiffrent, mais ne vérifient pas le
> certificat. `psql`, `pg_dump`, `pg_restore` et Atlas ne l'acceptent pas et ne
> se dégradent pas gracieusement : ils refusent de démarrer avec `invalid sslmode value: "no-verify"`.
>
> Les commandes propres à Rebase (`rebase db push`, `rebase db backup`, `rebase db
> restore`) la réécrivent en son équivalent `sslmode=require` avant d'appeler les sous-processus,
> afin qu'elles fonctionnent avec l'URL configurée. L'utilisation directe de `psql` manuellement
> ne le fait pas — remplacez-la par `sslmode=require`, qui chiffre sans vérifier exactement
> de la même manière.

### Frontend

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `VITE_API_URL` | URL de l'API backend pour le SDK typé. **À définir uniquement en développement** — voir ci-dessous. | origine de la page |
| `VITE_GOOGLE_CLIENT_ID` | Identifiant client Google OAuth. Active "Se connecter avec Google". | — |

> **Laissez `VITE_API_URL` non définie dans les builds de production.**
>
> En développement, le frontend et le backend sont sur des origines distinctes, le serveur
> de dev injecte donc ceci. En production, le backend Rebase sert la SPA, l'API est donc
> la propre origine de la page et le client la résout ainsi de lui-même.
>
> Figer une URL absolue dans un bundle de production fonctionne jusqu'à ce qu'un second
> nom d'hôte pointe vers la même application : un domaine personnalisé charge alors la page depuis
> `example.com` et appelle l'API sur `example.rebase.website`, ce qui est cross-origin,
> et chaque requête échoue donc au preflight. Autoriser l'origine dans CORS ne résout **pas**
> non plus le problème — le cookie de rafraîchissement est en `SameSite=Lax` et n'est pas envoyé
> en cross-site, vous effaceriez donc les erreurs de console tout en ayant une authentification
> cassée. Si elle n'est pas définie, chaque domaine pointant vers l'application fonctionne sans
> aucune configuration CORS.

### Backend

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `PORT` | Port du serveur HTTP backend. Lu par `rebase start`. `rebase dev` le lit **uniquement depuis l'environnement du shell** — un `PORT` dans `.env` n'y est pas lu, car le port est résolu avant le chargement de ce fichier — et lie sinon un port dérivé du chemin du projet, afin que plusieurs projets puissent s'exécuter simultanément. `rebase dev --port` a la priorité sur les deux, et la bannière de démarrage indique le palier utilisé. | `3001` |
| `LOG_LEVEL` | Niveau de détail des logs : `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Affiche le SQL derrière une ligne `Failed query: [redacted]`. Chaque instruction en échec est masquée par défaut, car une requête échouée transporte ses paramètres liés — un e-mail, un hash de mot de passe. Définissez-la sur `true` lors du diagnostic d'une panne de DDL, de RLS ou de capture de modifications. Ignorée lorsque `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Environnement : `development`, `production`, ou `test` | `development` |
| `CORS_ORIGINS` | Liste d'origines autorisées séparées par des virgules. **Requise en production** sauf si `FRONTEND_URL` est définie : un démarrage en production sans l'une ni l'autre refusera de se lancer. En développement, elle est *ajoutée à* localhost — voir ci-dessous. | — |
| `FRONTEND_URL` | URL de l'application frontend. Utilisée comme alternative à CORS_ORIGINS, dans les deux environnements. | — |
| `ADMIN_CONNECTION_STRING` | Chaîne de connexion à la base de données de niveau administrateur (utilisée pour l'introspection de schéma et les opérations d'administration). La base de données qu'elle désigne n'est pas celle que la console SQL qualifie d'actuelle, ni celle qu'une nouvelle branche copie par défaut : les deux sont la base de données sur laquelle la connexion propre de l'application se trouve (voir `REBASE_BRANCH_PARENT_DATABASE` pour un serveur sur une branche). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Désactive le changement de rôle PostgreSQL dans l'éditeur SQL (utile pour l'authentification personnalisée où les rôles de base de données ne sont pas mappés). La console SQL de Studio indique alors que les lignes ont été lues en tant que propriétaire de la connexion, le nomme, et grise son sélecteur de rôle. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | La base de données depuis laquelle la branche sur laquelle ce serveur s'exécute a été copiée. `rebase dev` la définit sur un checkout [basculé sur une branche](/docs/backend/branching/#cli-integration). Un serveur disposant de cette variable conserve le registre des branches sur cette base de données et copie les nouvelles branches depuis celle-ci par défaut, afin que le panneau Branches de Studio affiche les branches de la base de données principale. | — |

#### CORS en développement

Le développement autorise **localhost, plus tout ce que désigne `CORS_ORIGINS` (ou `FRONTEND_URL`)** — la même liste que la production utilise, avec localhost ajouté plutôt que substitué. La variable fonctionne donc de la même manière dans les deux environnements, et les cas qui en ont besoin en développement sont classiques :

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Une origine qui n'est ni localhost ni répertoriée est refusée, et le refus est
journalisé **une fois par origine** avec la ligne exacte qui permettrait de l'autoriser. Le refus n'est
pas une prudence gratuite : l'API transmettant des identifiants, refléter une
`Origin` arbitraire permettrait à n'importe quel site visité par le développeur d'effectuer
des requêtes authentifiées contre le serveur de dev avec sa session et d'en lire
les réponses.

### Authentification

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `JWT_SECRET` | Secret pour la signature JWT (requis en production, auto-généré en développement) | — |
| `JWT_PRIVATE_KEY` | Clé privée PEM pour signer les jetons d'accès de manière asymétrique (RS256), afin que toute entité détenant le JWKS puisse vérifier une session sans pouvoir en forger une. Accepte un PEM avec de vrais sauts de ligne, un PEM avec des échappements `\n`, ou l'encodage base64 du PEM complet. Sans cela, les jetons restent en HS256. | — |
| `JWT_KEY_ID` | Identifie `JWT_PRIVATE_KEY` dans l'en-tête du jeton et dans le JWKS. Modifiez-le à chaque changement de clé — la rotation repose sur la distinction entre l'ancienne et la nouvelle clé. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Durée de vie du jeton d'accès | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Durée de vie du jeton de rafraîchissement. Glissante — chaque rotation la renouvelle, cela régit donc combien de temps une session survit à **l'inactivité**. Définissez `400d` pour les sessions devant survivre à une longue absence ; les navigateurs plafonnent le cookie de rafraîchissement à cette valeur. | `30d` |
| `ALLOW_REGISTRATION` | Autorise les nouveaux utilisateurs à s'inscrire (`true`/`false`). Hors production, le **premier** utilisateur peut toujours s'inscrire, quelle que soit cette valeur — une table d'utilisateurs vide doit bien accepter quelqu'un, et cette personne devient administrateur. En production (`NODE_ENV=production`), cette fenêtre est fermée : une table vide refuse l'inscription d'amorçage avec `SETUP_REQUIRED`, un premier compte créé via l'inscription ouverte est un compte ordinaire, et l'administrateur est défini via `REBASE_ADMIN_EMAIL` ci-dessous ou assigné avec la clé de service. Le fichier `.env.example` du scaffold la définit à `true` ; la valeur par défaut du framework est désactivée. | `false` |
| `DISABLE_SELF_REGISTRATION` | Coupe-circuit. Ferme la fenêtre d'amorçage du premier utilisateur que `ALLOW_REGISTRATION=false` laisse délibérément ouverte hors production, de sorte que l'inscription soit fermée même sur une base de données vide. Associez-la à `REBASE_ADMIN_EMAIL` ci-dessous, sinon le déploiement n'aura aucun moyen de créer son premier utilisateur authentifié. Chaque artefact de déploiement livré la définit. | — |
| `REBASE_ADMIN_EMAIL` | Adresse e-mail du premier compte administrateur, créé au démarrage **pendant que la table des utilisateurs est encore vide** et jamais après. C'est ainsi qu'un déploiement de production obtient son administrateur : l'opérateur désigne le premier compte au lieu de faire la course avec Internet. Le démarrage émet un avertissement si la table est vide en production et que cette variable n'est pas définie. | — |
| `REBASE_ADMIN_PASSWORD` | Mot de passe pour ce compte. Au moins 12 caractères, sinon il est refusé et le compte n'est pas créé. Modifiez-le après la première connexion. | — |
| `MFA_ENCRYPTION_KEY` | Chiffre chaque secret TOTP stocké. Si non définie, les secrets sont chiffrés avec `JWT_SECRET` à la place et le démarrage émet un avertissement — faire tourner `JWT_SECRET` déconnecterait alors tout le monde *et* rendrait impossible le déchiffrement de chaque authentificateur enregistré. Définissez une clé dédiée (32+ caractères aléatoires) avant que quiconque ne s'inscrive. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | L'ancienne clé dont on effectue la *rotation*. Définissez les deux lors d'une rotation : les nouveaux secrets sont écrits avec `MFA_ENCRYPTION_KEY` et les existants restent lisibles, de sorte que personne ne soit bloqué hors de son propre compte en cours de rotation. Supprimez-la une fois que chaque secret a été ré-encrypté. | — |
| `ALLOW_ANONYMOUS` | Active la connexion anonyme (`POST /api/auth/anonymous`). Optionnelle (opt-in), et délibérément non conditionnée par `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Exige l'authentification pour l'API de données. Définissez sur `false` pour une surface de lecture entièrement publique — la RLS s'applique toujours. | `true` |
| `AUTH_DEFAULT_ROLE` | Rôle attribué à un utilisateur nouvellement inscrit lorsqu'aucun n'est spécifié. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Monte `POST /api/auth/find-user`, qui résout un e-mail en un profil public minimal (`uid`, `displayName`, `photoURL`) pour les flux d'invitation par e-mail. Réservé aux appelants authentifiés, et ne renvoie jamais l'e-mail, les rôles ou les métadonnées de l'utilisateur trouvé. Désactivé par défaut : il s'agit d'une surface d'énumération. | `false` |
| `AUTH_COOKIE_SAME_SITE` | Attribut `SameSite` sur le cookie de rafraîchissement : `Strict`, `Lax` ou `None`. `None` nécessite HTTPS et est réservé à un frontend véritablement cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | Attribut `Secure` sur le cookie de rafraîchissement. Sécurisé par défaut ; `AUTH_COOKIE_SECURE=false` pour le HTTP simple — un déploiement sur une adresse de réseau local où le navigateur abandonnerait autrement le cookie et où la session mourrait à l'expiration du jeton d'accès sans erreur. Émet un avertissement au démarrage. `http://localhost` n'en a pas besoin. | `true` |
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
| `GITLAB_CLIENT_ID` | Identifiant client GitLab OAuth. Le `baseUrl` d'une instance auto-hébergée n'a pas d'équivalent en variable d'environnement — configurez GitLab dans le bloc `auth` pour cela. | — |
| `GITLAB_CLIENT_SECRET` | Secret client GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | Identifiant client Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Secret client Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | Identifiant client Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Secret client Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | Identifiant client Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Secret client Spotify OAuth | — |
| `APPLE_CLIENT_ID` | Identifiant de services Apple (Services ID), pour la connexion web. Il est public et publié dans `GET /auth/config`. Apple n'a pas de secret client statique, car Rebase signe un JWT ES256 à courte durée de vie pour chaque échange de jetons. Apple nécessite donc `APPLE_TEAM_ID`, `APPLE_KEY_ID` et `APPLE_PRIVATE_KEY`, plus cette variable ou `APPLE_BUNDLE_IDS`, et ne configure rien sans elles. | — |
| `APPLE_BUNDLE_IDS` | Identifiants de bundle (séparés par des virgules) des applications natives iOS/macOS dont les codes Sign in with Apple sont acceptés. | — |
| `APPLE_TEAM_ID` | Apple Developer Team ID, l'émetteur du JWT. | — |
| `APPLE_KEY_ID` | Identifiant de clé (Key ID) de la clé privée enregistrée auprès d'Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenu du fichier de clé privée `.p8`, sauts de ligne inclus (les échappements `\n` sont acceptés). | — |
| `REBASE_SERVICE_KEY` | Clé d'API d'administration statique. Contourne l'authentification JWT normale pour les appels de serveur à serveur lorsqu'elle est transmise via `Authorization: Bearer <key>`. (Auto-générée en développement). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Clé publique de la plateforme d'hébergement (PEM, EC P-256) par rapport à laquelle les jetons de plateforme `rpt_` sont vérifiés ; plusieurs blocs PEM lors d'une rotation de clé. La plateforme la définit lors du déploiement, et elle ne contient aucun secret. Conjointement avec `REBASE_PLATFORM_TOKEN_AUDIENCE`, elle permet au portail administrateur d'accepter un jeton de plateforme pour `cron:read`, et pour rien d'autre. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | L'identifiant de projet auquel l'`aud` d'un jeton de plateforme doit être égal, afin qu'un jeton créé pour un autre projet soit refusé. Si une seule des deux variables est définie, le serveur démarre, consigne un avertissement et répond à chaque jeton `rpt_` par `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_RATE_LIMIT_STORE` | Emplacement de stockage des compteurs de limitation de débit (rate limit), pour les routes d'authentification et pour `rateLimit` dans les fonctions personnalisées : `memory` (par processus) ou `sql` (partagé entre les répliques). Un processus ne pouvant pas voir le nombre de ses répliques, un déploiement avec des pairs doit l'indiquer — trois répliques sur la valeur par défaut appliquent trois fois la limite. Toute autre valeur **refuse de démarrer** plutôt que de se rabattre, y compris `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Monte le flux de lien de connexion sans mot de passe (magic link). Nécessite la configuration d'un service d'e-mail, sinon le lien n'a nulle part où aller. | `false` |
| `AUTH_EMAIL_OTP` | Monte la connexion sans mot de passe avec un code à six chiffres envoyé par e-mail. Même exigence d'e-mail que ci-dessus. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Inscription sans mot de passe : une demande de lien magique ou de code par e-mail pour une adresse inconnue crée le compte, tant que les inscriptions sont ouvertes. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Comportement lorsqu'un jeton de rafraîchissement est rejoué après sa fenêtre de réutilisation : `reject` (le refuser, conserver la session) ou `revoke-session` (mettre fin à la connexion). Toute autre valeur fait échouer le démarrage. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Inscription avec confirmation préalable : aucune connexion par mot de passe avant que l'adresse ne soit vérifiée. Nécessite l'e-mail ; le démarrage le refuse sans cela. | `false` |
| `CAPTCHA_PROVIDER` | Active la vérification par captcha sur les routes d'authentification : `turnstile` ou `hcaptcha`. Non défini signifie aucun captcha. | — |
| `CAPTCHA_SECRET` | Secret du fournisseur, utilisé côté serveur pour vérifier le jeton envoyé par le navigateur. Requis dès lors que `CAPTCHA_PROVIDER` est défini. | — |
| `CAPTCHA_ROUTES` | Routes d'authentification séparées par des virgules à protéger (par exemple `register,login`). Non défini protège l'ensemble par défaut du fournisseur. | — |

### Stockage (Storage)

:::caution[Le stockage ne dispose pas de sécurité au niveau des lignes, il nécessite donc un modèle d'accès]
Les tables sont protégées par la RLS Postgres. Le stockage d'objets n'a pas d'équivalent —
les clés partagent un espace de noms plat unique — ainsi, avec un bucket configuré et aucun modèle d'accès,
le serveur **refuse de démarrer en production**. Remplissez cette condition avec exactement l'un des éléments suivants :
un hook `storageAuthorize` exporté depuis `backend/storage.ts` (ce que fournit le scaffold),
`STORAGE_PUBLIC_READ`, ou `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `STORAGE_TYPE` | Backend de stockage : `local`, `s3` ou `gcs`. En production, `local` désactive le stockage sauf si `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Chemin de base pour le stockage local. Un chemin relatif est lu depuis le répertoire dans lequel le serveur s'exécute : la racine du projet sous `rebase dev`, `backend/` dans un serveur généré par `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Autorise le stockage local en production — uniquement avec un volume persistant contenant `STORAGE_PATH` et les répertoires `<STORAGE_PATH>__<key>` des buckets locaux nommés à côté | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Nombre de secondes pendant lesquelles l'URL de téléchargement d'un fichier privé reste valide — le jeton que `getSignedUrl()` y insère. Au maximum `604800` (une semaine) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Taille maximale acceptée pour un fichier par la source, en octets, sur chaque chemin d'upload — `__<KEY>` pour une source nommée. Une valeur qui n'est pas un nombre entier d'octets refuse le démarrage | `52428800` (50 Mo) |
| `S3_BUCKET` | Nom du bucket S3 (lorsque `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Région AWS | — |
| `S3_ACCESS_KEY_ID` | Clé d'accès AWS | — |
| `S3_SECRET_ACCESS_KEY` | Clé secrète AWS | — |
| `S3_ENDPOINT` | Point de terminaison S3 personnalisé (pour MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Force les URL de style chemin pour le bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nom du bucket GCS (lorsque `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Projet GCP. Généralement déduit des identifiants. | — |
| `GCS_KEY_FILENAME` | Chemin vers un fichier de clé de compte de service. À omettre sur GCP, où Workload Identity fournit les identifiants. | — |
| `STORAGE_PUBLIC_READ` | Sert chaque objet à n'importe qui, sans jeton. Uniquement pour un bucket qui est véritablement un CDN public. L'une des trois manières de satisfaire la vérification au démarrage ci-dessous. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permet à tout appelant authentifié de lire, écrire, lister et supprimer chaque objet. Nommé `INSECURE` dans l'objet de configuration pour une bonne raison : ce n'est défendable que dans une application mono-tenant où chaque compte a accès à chaque fichier en toute confiance. | `false` |
| `STORAGE_RENDITION_CACHE` | Met en cache les rendus d'images générés (redimensionnements, conversions de format) au lieu de les produire à chaque requête. | `false` |

### E-mail (Optionnel)

| Variable | Description |
|----------|-------------|
| `SMTP_HOST` | Hôte du serveur SMTP |
| `SMTP_PORT` | Port du serveur SMTP |
| `SMTP_SECURE` | Active la connexion sécurisée (`true`/`false`) |
| `SMTP_USER` | Nom d'utilisateur SMTP |
| `SMTP_PASS` | Mot de passe SMTP |
| `SMTP_FROM` | Adresse d'expédition pour les e-mails système |
| `SMTP_NAME` | Nom affiché sur l'adresse d'expédition |
| `APP_NAME` | Nom du produit utilisé dans les objets et corps d'e-mails (par défaut : `Rebase`) |
| `EMAIL_LOGO_URL` | Logo affiché en tête des modèles d'e-mails par défaut. PNG ou JPG absolu en `http(s)` — les clients de messagerie suppriment le SVG et bloquent les URI `data:`. Si non défini, une application toujours nommée `Rebase` reçoit le logo Rebase et une application renommée n'en reçoit aucun |

### Pool de connexions à la base de données

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `DB_POOL_MAX` | Nombre maximal de connexions dans le pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Millisecondes pendant lesquelles une connexion inactive est conservée | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Millisecondes d'attente pour obtenir une connexion | `10000` |
| `DATABASE_DIRECT_URL` | Connexion directe (hors pool). Le [Temps réel](/docs/backend/realtime) en a besoin : `LISTEN`/`NOTIFY` ne survit pas à un pooler en mode transaction comme PgBouncer, et sans cela, les notifications de modifications sont désactivées avec un avertissement plutôt que perdues silencieusement. Le [worker de jobs](/docs/backend/jobs) y maintient également son `LISTEN` de réveil. Remplit la variable `directConnectionString` de l'adaptateur Postgres lorsque celle-ci n'est pas définie. | — |
| `DATABASE_READ_URL` | Réplique de lecture, telle qu'un hot standby. Lorsqu'elle désigne un autre serveur, les lectures authentifiées (listes, lignes uniques, comptages, agrégats) y sont servies sous la même sécurité au niveau des lignes ; les écritures, l'authentification, le temps réel, les tâches cron, les jobs, la console SQL et `rebase.sql` restent sur le primaire. Un lecteur qui vient d'écrire lit sur le primaire pendant `REBASE_READ_STICKY_MS`, et tout le monde fait de même tant que la réplique a plus de `REBASE_READ_MAX_LAG_MS` de retard ou est en échec. Remplit `readConnectionString` de l'adaptateur Postgres lorsque celle-ci n'est pas définie ; jusqu'à la version 0.28 incluse, le pool de la réplique était ouvert sans jamais être lu. | — |
| `REBASE_READ_STICKY_MS` | Après une écriture, durée pendant laquelle les lectures du même utilisateur vont vers le primaire, de sorte qu'un enregistrement suivi d'un listage affiche la mise à jour. Par instance de serveur. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Retard de la réplique au-delà duquel chaque lecture est dirigée vers le primaire. | `1000` |
| `DATABASE_POOLED` | `true` lorsque `DATABASE_URL` passe par un pooler en mode transaction tel que PgBouncer. Le pool n'envoie alors aucun `search_path` ou `statement_timeout` à la connexion (le pooler les refuserait ou les ignorerait) et définit les deux dans chaque transaction ; le démarrage attribue au rôle de base de données un `search_path` par défaut de `public` pour les instructions hors transaction. `DATABASE_DIRECT_URL` devient requise, et le temps réel, le réveil du worker de jobs, la construction d'index, le branching et la console SQL l'utilisent tous. L'URL de la réplique est également considérée comme utilisant un pool. `DATABASE_POOLED__<KEY>` pour une autre source de données. | — |
| `REBASE_DB_POOL_MAX` | Plafond sur chaque pool du processus, appliqué indépendamment de ce que chacun demandait. Chiffres bruts uniquement : une valeur mal formée est ignorée plutôt que de sérialiser silencieusement le serveur. | — |

### Comportement du runtime

Lu par le runtime — `rebase dev`, `rebase start` et l'image de serveur publiée. Un projet ayant fait l'objet d'un eject gère ces décisions dans son propre code.

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `REBASE_RLS_AUDIT` | `true` exécute l'audit planifié de [sécurité au niveau des lignes (RLS)](/docs/rls-check#running-it-on-a-schedule), qui signale les tables servies sans politiques. Le projet doit déclarer `@rebasepro/rls-check` parmi ses dépendances : le runtime n'en fournit pas de copie, et sans le paquet, le démarrage refuse de s'exécuter en le nommant. `false` désactive le scan sur ce processus. | — |
| `REBASE_RLS_REQUEST_ROLE` | Le rôle Postgres sous lequel les requêtes authentifiées et anonymes s'exécutent. Donnez à chaque projet sur un cluster partagé son propre rôle. Une base de données enregistre le rôle sous lequel elle s'exécute, et un démarrage configuré pour un autre refuse de démarrer jusqu'à ce que `rebase db request-role migrate` le déplace. Voir [Exécution sur une base de données existante ou partagée](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` crée le rôle de requête et permet à la connexion d'y basculer ; `never` vous laisse gérer les deux et se contente de les vérifier. | `auto` |
| `REBASE_RLS_GRANTS` | Ce que Rebase accorde au rôle de requête : `schema` (chaque table dans les schémas qu'il sert, plus les privilèges par défaut), `managed` (uniquement les tables qu'il sert) ou `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` restreint les politiques permissives de Rebase au(x) rôle(s) de requête, de sorte que les autres rôles lisant les mêmes tables n'en retirent rien. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` écrit les politiques que seuls le contexte du serveur ou un administrateur peuvent valider `TO public`, et exécute les administrateurs sous le rôle de requête. Par défaut, elles sont `TO rebase_admin`, afin que les lectures limitées au propriétaire faites par les utilisateurs connectés puissent utiliser l'index propriétaire. Voir [Requêtes administrateur et `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` supprime la politique de base serveur-ou-administrateur de chaque table. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` définit également `request.jwt.claims` et `request.jwt.claim.*`, de sorte que les politiques écrites avec `auth.uid()` voient l'appelant. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | Ce que fait le démarrage lorsqu'un autre identifiant de connexion peut basculer vers le rôle de requête : `warn`, `refuse` ou `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Chemin de base pour chaque route d'API. Le client doit être configuré de la même manière — voir [Modification de `basePath`](#modification-de-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Sert les ressources statiques/d'administration du bundle depuis ce processus. Désactivez-le lorsqu'un CDN est placé devant. | `true` |
| `REBASE_HISTORY` | Enregistre l'[historique des modifications d'entités](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Compresse les réponses en gzip/brotli. | `true` |
| `REBASE_PUSH` | `true` active les [notifications push](/docs/backend/push-notifications/) : les routes `/api/push`, la table `rebase.push_subscriptions` et `rebase.push`. | `false` |
| `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` | La paire de clés VAPID avec laquelle les messages push sont signés. Hors production, une paire est générée et conservée dans `.rebase-dev-secrets.json` si elle n'est pas définie ; en production, le push reste désactivé sans elles. | — |
| `REBASE_VAPID_SUBJECT` | Une adresse `mailto:` ou une URL `https://` que les services push peuvent contacter. Par défaut, correspond à l'origine d'un `REBASE_PUBLIC_URL` en `https`. | — |
| `REBASE_MAX_BODY_SIZE` | Taille maximale du corps de la requête, **en octets** (`10485760`, pas `10MB` — une valeur qui n'est pas un nombre refuse de démarrer au lieu de supprimer silencieusement la limite). `0` désactive la limite. | `10485760` (10 Mio) |
| `REBASE_ENABLE_SWAGGER` | La surface OpenAPI. Trois états possibles. Si non définie, dans tous les environnements : `/api/docs` est servi aux appelants auxquels `GET /api/schema/tables` décrit les tables, chacun recevant le document des tables qui lui sont décrites, et il n'y a pas d'interface utilisateur Swagger UI. `true` publie l'intégralité du document à tout le monde, avec l'interface **Swagger UI** sur `/api/swagger` hors production (jamais en production). `false` garde le document protégé derrière l'accès administrateur. | — |
| `REBASE_METRICS` | Expose les métriques Prometheus sur `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Ajoute `includeSubDomains` à l'en-tête `Strict-Transport-Security`, afin que les navigateurs refusent le HTTP simple sur chaque sous-domaine de l'hôte pendant six mois — y compris les hôtes non servis par ce processus. Ne l'activez que si chaque sous-domaine du domaine est exclusivement en HTTPS. Toute valeur autre que `true`/`false` refuse de démarrer. Voir [En-têtes de sécurité](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Jeton Bearer protégeant `/metrics`. Non défini laisse le endpoint ouvert à quiconque peut atteindre le port — acceptable sur un réseau privé, pas sur un réseau public, et les logs de démarrage le signalent. | — |
| `REBASE_MIGRATE_ON_BOOT` | Ce que le runtime peut appliquer au schéma des tables au démarrage. `ensure` (la valeur par défaut, partout — production incluse) exécute la passe **additive** : crée les tables, colonnes et types enum manquants, ne supprime ni ne réécrit jamais rien. `none` laisse le schéma des tables déclarées intact, mais les tables propres au framework (authentification, clés d'API, jobs, cron) sont toujours créées et maintenues à jour ; `REBASE_PROVISION=false` désactive également ces dernières. L'image publiée n'accepte que ces deux valeurs et **refuse de démarrer sur `push`**. Dans un [déploiement fractionné](/docs/deployment/split-processes), exactement un seul processus peut provisionner, donc chaque autre rôle doit définir `none` sous peine de refuser de démarrer. | `ensure` |
| `REBASE_PROVISION` | `false` fait en sorte que le runtime ne modifie rien dans sa base de données : aucune table, colonne, index, fonction, déclencheur, politique, rôle ou privilège, au démarrage ou ultérieurement, y compris ceux propres au framework. Il signale plutôt ce qui manque par son nom. Pour une base de données que seul votre processus de gestion des modifications peut modifier. Voir [Quand seul votre processus de modification peut modifier la base de données](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Seuls `true` et `false` sont acceptés. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Refuse de démarrer lorsque la base de données a été provisionnée pour la dernière fois à partir d'un ensemble de tables différent de celui pour lequel ce processus a été compilé. Non défini (ou toute valeur autre que `true`/`1`) émet un avertissement à la place. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Refuse de démarrer lorsqu'un fichier de fonction ou de cron lève une exception ou ne s'analyse pas lors de l'importation, en nommant chaque fichier et la raison, afin qu'un déploiement progressif laisse l'ancienne version en service. Un redémarrage y est également soumis. Non défini (ou toute valeur autre que `true`) ignore le fichier et sert le reste. Un fichier qui s'importe sans encombre et n'exporte aucune fonction ou job est toujours ignoré, pas refusé. | skip |
| `REALTIME_CDC` | Capture de données modifiées (CDC) au niveau base de données : `auto` (lit les modifications depuis le WAL là où la base de données le permet, sinon utilise des triggers, sinon se rabat au niveau applicatif, en consignant chaque repli en info), `trigger` (l'impose, avertit si impossible), `wal` (lit les modifications depuis le journal de réécriture WAL au lieu des triggers ; nécessite `wal_level=logical` et un rôle autorisé à répliquer, se rabat sur `trigger` sinon), `off`. Voir [Temps réel](/docs/backend/realtime-cdc/). Prioritaire sur `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Transport inter-instances pour les canaux de diffusion (broadcast) et la présence : `memory` ou `postgres`. Ignoré si `realtime.bus` a reçu un transport instancié. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Nombre de souscriptions qu'un socket temps réel peut maintenir ; la suivante est refusée avec `TOO_MANY_SUBSCRIPTIONS`. Un entier positif — toute autre valeur arrête le serveur au démarrage. Prioritaire sur `realtime.maxSubscriptionsPerSocket`. Voir [Temps réel](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Nombre de sockets temps réel qu'un utilisateur, ou une clé d'API, peut maintenir ouverts sur une instance de serveur. Les sockets d'usurpation d'identité d'un administrateur sont décomptés de l'administrateur. La connexion du socket suivant est refusée avec `TOO_MANY_SOCKETS` et le socket est fermé (4002) ; le SDK continue de réessayer, il se connectera donc dès qu'un autre se fermera. Un entier positif — toute autre valeur arrête le serveur au démarrage. Prioritaire sur `realtime.maxSocketsPerUser`. | Aucune limite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Durée maximale pendant laquelle une modification attend la nouvelle récupération qui la transmettra aux abonnés actifs, en ms. Un refetch attend 300 ms sans modification, et au maximum cette durée sous un flux continu d'écritures. Un entier positif — toute autre valeur arrête le serveur au démarrage. Prioritaire sur `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Durée pendant laquelle le total d'une souscription à une grande liste peut être réutilisé avant d'être recompté, en ms ; les frames qui le réutilisent portent la mention `meta.totalAsOf`. Si non défini, chaque frame est recompté. Prioritaire sur `realtime.recountIntervalMs`. | Non défini |
| `REALTIME_RECOUNT_MIN_ROWS` | Le plus petit total précédent auquel s'applique `REALTIME_RECOUNT_INTERVAL_MS` ; les listes plus petites sont comptées sur chaque frame. Prioritaire sur `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Autorise les valeurs `localhost`/loopback sous `NODE_ENV=production`. Désactivé, pour qu'un démarrage en production échoue explicitement plutôt que de se connecter à une base de données inexistante. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` exécute la passe de schéma et se termine sans ouvrir de socket — la configuration attendue par un Job de migration, à partir de la même image et du même bundle que le serveur qui lui succède. Il crée également les tables qu'un processus de service créerait autrement à la première utilisation, et ne démarre aucun cron ni file d'attente de jobs. Une valeur vide est considérée comme *non définie*, de sorte qu'un `${QUELQUE_CHOSE}` non substitué dans un fichier compose ne puisse pas transformer un déploiement ordinaire en un déploiement qui migre et refuse de servir. Refusé conjointement avec `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Un chemin de fichier. Une exécution de provisionnement (`REBASE_PROVISION_ONLY=true`) y écrit chaque modification de schéma effectuée, dans l'ordre, sous forme de script SQL à relire et appliquer avec `psql`. Les lignes écrites ne sont pas incluses. Refusé sur un processus qui sert du trafic. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permet à une machine — un agent, un job CI — d'*appliquer* une modification de schéma via `/api/admin/schema`, et pas seulement d'en planifier une. Désactivé sauf si explicitement demandé : l'identifiant qui permettrait une telle modification est celui le plus susceptible de se trouver dans une variable de CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Durée maximale d'exécution d'une fonction personnalisée avant que sa requête ne soit interrompue. Même réglage que l'option `functionsTimeoutMs`. `0` le désactive. | `30000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` fait en sorte qu'un rejet de promesse non géré mette fin au processus au lieu de simplement le consigner dans les logs. Activé sous un orchestrateur qui effectuera un redémarrage ; désactivé là où un redémarrage est pire qu'une fuite. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Masque l'avertissement de démarrage sur une plateforme que le runtime détecte comme passant à zéro instance (scale-to-zero), où un timer qui se déclenche dans une instance inactive ne se déclenche dans aucune instance. Ne change rien d'autre : définissez-le lorsque vous maintenez au moins une instance active en permanence. | — |
| `TRUSTED_PROXY_HOPS` | Nombre de proxys placés devant ce serveur, afin que le rate limiter puisse lire la véritable adresse client depuis `X-Forwarded-For`. Valeur par défaut sécurisée à `0` : sans proxy, faire confiance à l'en-tête permettrait à tout appelant d'usurper une identité. | `0` |

:::note[Le provisionnement au démarrage est additif et n'est pas un outil de migration]
La passe de démarrage s'exécute sans surveillance et sans personne pour relire un diff, elle ne supprimera donc jamais
de colonne, ne réduira jamais un type et ne réécrira jamais une table. C'est également pourquoi l'image refuse
`REBASE_MIGRATE_ON_BOOT=push` : un push complet calcule un diff et exécutera volontiers
`DROP COLUMN`, et un redémarrage de conteneur ne doit jamais pouvoir détruire une
colonne de production suite à un réordonnancement.

Les modifications destructives ou structurelles restent là où elles peuvent être vérifiées : `rebase db
generate` + `rebase db migrate`, ou `rebase db push` depuis un checkout ou la CI,
qui teste la modification à blanc, refuse les changements destructifs sans confirmation, et
peut effectuer une sauvegarde au préalable.
:::

### Déploiements fractionnés (Split deployments)

Une même image et un même bundle peuvent être démarrés plusieurs fois, chacun servant une
partie différente du projet. Une ligne chacun ici, car cette page a pour vocation de
lister chaque variable ; ce que chaque combinaison *monte et possède* — et quelles
combinaisons refusent de démarrer — est détaillé sur
**[Processus fractionnés](/docs/deployment/split-processes)**.

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `REBASE_ROLE` | Quelle partie ce processus sert : `all`, `api`, `functions` ou `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Force l'exécution ou non des planificateurs cron par *ce* processus. Si non défini, suit le rôle. | — |
| `REBASE_JOB_WORKERS` | Force l'exécution ou non des workers de files d'attente de jobs par ce processus. Si non défini, suit le rôle. | — |
| `REBASE_FUNCTIONS_ONLY` | Ne sert que les fonctions personnalisées désignées dans ce processus. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Sert toutes les fonctions personnalisées sauf celles désignées. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Emplacement vers lequel le processus API relaie une requête de fonction qu'il ne sert pas lui-même. Sur un `worker`, destination de ses propres appels `rebase.functions`. Une URL `http(s)`. | — |

### Surface MCP

Un point de terminaison Model Context Protocol optionnel sur `/mcp`, permettant à un client IA de lire
et d'écrire sur ce projet **en tant qu'utilisateur connecté**. Désactivé sauf s'il est configuré, et — à
la différence de toutes les autres surfaces — aucun `REBASE_ROLE` ne l'active : les autres décrivent
la forme d'un processus, tandis que celui-ci relève d'une décision de transmettre des identifiants à un
logiciel tiers, et doit être pris par une personne plutôt qu'hérité du rôle attribué à un conteneur.

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `REBASE_MCP_ENABLED` | Monte la surface MCP. Nécessite `REBASE_PUBLIC_URL` ; sans cela, la surface refuse de monter et l'indique dans le log de démarrage. | `false` |
| `REBASE_PUBLIC_URL` | L'origine accessible de l'extérieur pour ce déploiement, par ex. `https://app.example.com`. La surface MCP ne peut pas la déduire — extraire l'origine de l'en-tête `Host` ferait de l'identité de l'émetteur, et du public cible vis-à-vis duquel ses propres jetons sont vérifiés, une valeur fournie par l'appelant. | — |
| `REBASE_MCP_VIEW` | Chemin vers la vue MCP App propre au projet (`rebase-view.html`, générée par `rebaseMcpViewPlugin()`), servie à Claude à la place de la vue générique afin que vos vues, champs et actions personnalisés soient ceux qu'il restitue. Sans cela, le backend cherche à côté du frontend qu'il sert. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Autorise l'enregistrement dynamique de clients OAuth (RFC 7591), afin qu'un client puisse s'enregistrer lui-même. Définissez à `false` pour exiger que les clients soient enregistrés à l'avance. | `true` |

### Édition de schéma en direct depuis un bundle

Désactivée sauf si `REBASE_LIVE_SCHEMA_REPOSITORY` est défini. Un bundle compilé ne possède pas
de source `backend/schema` à éditer ; une fois ces variables configurées, l'éditeur de schéma lit
la source depuis le dépôt, commite chaque modification en retour et applique son DDL sur
cette base de données. Réservé aux administrateurs, et appliqué par une personne sauf si
`REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` en dispose autrement. Un dépôt désigné sans
identifiant exploitable refusera de démarrer. Voir
[Édition de schéma en direct](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Le dépôt GitHub sur lequel commiter les modifications de schéma, sous la forme `propriétaire/nom`. Définir cette variable est ce qui active la fonctionnalité. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | La branche sur laquelle le commit est appliqué. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | Emplacement de `backend/schema` dans ce dépôt, relatif au dépôt. Un chemin sortant du dépôt refusera de démarrer, tout comme l'ancienne variable supprimée `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Un jeton à granularité fine avec accès en lecture et écriture au contenu du dépôt. Définissez soit cette variable, soit les trois variables `_GITHUB_APP_*`, mais pas les deux. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | Identifiant d'une application GitHub, pour commiter en tant qu'application plutôt qu'avec un jeton. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | L'installation de l'application sur le dépôt. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | La clé privée de l'application : PEM, PEM avec retours à la ligne échappés, ou base64. | — |

### Sauvegardes

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `BACKUP_SCHEDULE` | Expression cron pour les sauvegardes planifiées. Non défini signifie que les sauvegardes automatiques sont désactivées. | — |
| `BACKUP_DESTINATION` | Chemin local, ou URL `s3://bucket/prefix` / `gs://bucket/prefix`. Requis avec `BACKUP_SCHEDULE`, qui refuse de s'exécuter sans cela. `rebase db backup` se rabat sur `./backups` là où il a été exécuté. | — |
| `BACKUP_RETENTION_DAYS` | Supprime les sauvegardes antérieures à N jours. Non défini ou `0` conserve tout. | — |
| `BACKUP_KEEP_MINIMUM` | Conserve toujours au moins N sauvegardes parmi les plus récentes, indépendamment de la règle de rétention. | — |
| `PG_DUMP_PATH` | Remplacement de l'exécutable `pg_dump` — il doit correspondre à la version majeure du serveur ou être plus récent. | — |
| `PG_RESTORE_PATH` | Remplacement de l'exécutable `pg_restore`. | — |
| `PSQL_PATH` | Remplacement de l'exécutable `psql` exécuté par `rebase db restore --clean` pour faire de la restauration une transaction unique. | — |
| `PG_DUMPALL_PATH` | Emplacement de `pg_dumpall`, lorsqu'il n'est pas dans le `PATH`. Sans lui — et sans les outils clients PostgreSQL installés — une sauvegarde globale échoue avec une erreur mentionnant cette variable. | — |

L'image d'exécution officielle (`rebasepro/server`) intègre les outils clients
PostgreSQL 18, de sorte qu'une sauvegarde planifiée s'y exécute sur n'importe quel serveur jusqu'à Postgres 18.
En dehors de l'image, installez-les vous-même (`apt-get install postgresql-client-18`,
`brew install libpq`).

Les sauvegardes contiennent des secrets et des données personnelles (PII). Utilisez une destination privée avec
chiffrement au repos.

### Livraison du bundle

Un déploiement managé n'embarque pas son code dans l'image : le runtime récupère un
bundle au démarrage. Ces variables déterminent lequel et comment.

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `REBASE_BUNDLE` | Chemin vers un répertoire de bundle déjà extrait. Ce que `rebase start` définit localement. | — |
| `REBASE_BUNDLE_URL` | Emplacement de récupération de l'archive du bundle, lorsqu'il n'y en a pas localement. | — |
| `REBASE_BUNDLE_TOKEN` | L'identifiant Bearer pour cette récupération. Traitez-le comme un secret : c'est ce qui autorise un tenant à télécharger son propre code. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Répertoire d'extraction d'un bundle récupéré. Doit être accessible en écriture et persister entre la récupération et le démarrage. | — |
| `REBASE_RUNTIME_MODULES` | Modules supplémentaires fournis par l'image de runtime au bundle, au-delà de ceux qu'elle déclare elle-même. | — |

### Liaisons de ressources (Resource bindings)

Chaque base de données, bucket et topic déclaré par un projet dans `backend/resources.ts` est
lié par des variables d'environnement nommées d'après lui. Les noms de base figurent ci-dessous ; une
ressource personnalisée ajoute `__` suivi de sa clé en majuscules, ainsi un bucket appelé
`media` lira `S3_BUCKET__MEDIA`. `rebase status`
affiche, par ressource,
la variable exacte lue et si elle est définie ou non.

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `REBASE_DRIVER` | Le paquet npm implémentant le driver d'une source de données, s'il ne s'agit pas de celui par défaut pour Postgres. Suffixé par source : `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | La chaîne de connexion pour un topic déclaré. Suffixée par topic. | — |

### Environnement propre au CLI

Lu par `rebase`, pas par le serveur. Rien ici n'affecte un déploiement.

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `REBASE_BASE_URL` | Emplacement où `rebase api-keys`, `rebase storage` et `rebase auth reset-password` envoient la clé de service, dans le shell ou dans le fichier `.env`. Définissez-la lorsque le serveur s'exécute autrement que par `rebase dev` dans ce projet : `rebase start`, un conteneur, un autre hôte. Si non définie, elles utilisent le serveur enregistré par `rebase dev` pendant que celui-ci s'exécute, et n'envoient rien s'il ne tourne pas. | — |
| `REBASE_SERVICE_KEY` | La clé de service avec laquelle ces commandes s'authentifient, lue depuis `.env` : la même variable que celle lue par le serveur (voir ci-dessus). | — |
| `SERVICE_KEY` | Une ancienne dénomination pour cette clé. Lorsque `.env` la définit, `rebase api-keys` et `rebase storage` la lisent à la place de `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Le fichier `.env` que le CLI lit et écrit, s'il ne s'agit pas de celui du projet. | — |
| `REBASE_ROOT_RULES` | `0` empêche `rebase init` et `rebase skills install` d'écrire les règles du projet dans les fichiers `CLAUDE.md` et `AGENTS.md` de la racine du dépôt, pour une racine dont vous gérez les fichiers d'agents manuellement. | on |
| `REBASE_CLOUD_URL` | Le plan de contrôle (control plane) avec lequel `rebase cloud` communique. | — |
| `REBASE_CLOUD_EMAIL` | Le compte sous lequel `rebase cloud login` se connecte, au lieu de demander la saisie. | — |
| `REBASE_CLOUD_PASSWORD` | Son mot de passe, afin qu'un gestionnaire de secrets puisse le transmettre sans qu'il n'atteigne l'historique du shell. | — |
| `REBASE_TOKEN` | Un jeton issu de `rebase cloud tokens create`. S'il est défini, chaque commande `rebase cloud` s'authentifie avec lui plutôt qu'avec la session de `rebase cloud login`, et ne lit ni n'écrit jamais la session stockée. Dans un répertoire lié par `rebase cloud init --claim`, il est mis de côté au profit du jeton propre à ce projet s'il ne dispose d'aucun scope sur le projet. La méthode recommandée pour exécuter `rebase cloud` en CI — voir [CI et agents](/docs/deployment/cloud/#ci-and-agents). Le [serveur MCP](/docs/ai/mcp/) le transmet au CLI généré par ses outils cloud, et ne l'envoie jamais à l'application : définissez `REBASE_API_TOKEN` pour cela. | — |
| `REBASE_DEBUG` | `1` affiche l'erreur sous-jacente et le détail de la requête au lieu du message succinct. Le premier réflexe à avoir lorsqu'une commande `rebase cloud` échoue sans donner de détails utiles. | — |
| `REBASE_ATLAS_DEV_URL` | La base de données vide par rapport à laquelle `rebase db push`, `db generate` et `db migrate` planifient leurs actions, au lieu de la base `<db>_dev_diff` qu'ils créent à côté de `DATABASE_URL`. Rebase ne crée ni ne supprime de base de données spécifiée ici, et refuse une base identique à `DATABASE_URL`. Sur la base de données de développement gérée, le CLI la configure sur un PGlite temporaire en mémoire qui lui est propre. Définissez-la si `CREATE DATABASE` n'est pas accordé. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` ne démarre aucune base de données et ne provisionne rien — vous fournissez la vôtre. Identique à `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fixe le port du serveur de dev frontend, que `rebase dev` déduit sinon du chemin du projet. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Temps d'attente de `rebase dev` pour que le backend s'annonce avant d'indiquer qu'il n'a pas démarré. `0` désactive ce signalement. | `30000` |
| `DATABASE_PASSWORD` | Le mot de passe que `rebase dev --docker` injecte dans la chaîne de connexion qu'il déduit de `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | La convention standard entre outils. Si définie à une valeur autre que `0`, le CLI n'envoie aucune télémétrie. | — |
| `REBASE_TELEMETRY_DISABLED` | Identique, spécifiquement pour Rebase. Ne requiert aucun fichier, c'est pourquoi il convient de l'utiliser en CI et dans une image. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Emplacement d'envoi de la télémétrie, pour un collecteur auto-hébergé. | — |

## Secrets en développement

`JWT_SECRET` est requis en production. Cette variable et `REBASE_SERVICE_KEY` sont
générées pour vous en dehors de celle-ci, afin que vous puissiez démarrer sans rien configurer.

Ces valeurs générées sont mises en cache dans `.rebase-dev-secrets.json`, aux côtés de
`.rebase-dev-port` et `.rebase-dev-url` et ignorées par git avec eux. Auparavant, elles
étaient régénérées à chaque démarrage — ainsi, redémarrer le serveur de développement vous déconnectait
de votre propre application et invalidait toute clé d'API venant d'être créée.

- Définissez l'une ou l'autre de ces variables explicitement et votre valeur sera utilisée ; rien ne sera mis en cache ni lu.
- Pointez le cache ailleurs avec `REBASE_DEV_SECRETS_FILE` — un chemin, et la
  seule variable de cette section que vous pourriez vouloir définir délibérément.
- Supprimez le fichier pour renouveler les deux secrets. Le prochain démarrage en réécrira un nouveau.
- Si le fichier ne peut pas être écrit — par exemple dans un conteneur en lecture seule — le serveur démarre
  tout de même avec un secret éphémère, exactement comme auparavant.

Rien n'est mis en cache en production, ni sous un exécuteur de tests. En production, rien
n'est généré non plus : un démarrage sans `JWT_SECRET` échoue en indiquant la variable,
ce comportement reste inchangé :

```
The environment is not valid:
  JWT_SECRET: is required
```

## Objet de configuration Backend

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
backend qui ne sert rien tant que vous ne le montez pas : `createRebaseBackend`. Voir
[Intégration d'un serveur personnalisé](/docs/backend/custom-server/).

### Modification de `basePath`

`basePath` déplace chaque route d'API, le client doit donc être configuré de manière identique —
sinon il continuera d'appeler `/api/...` et obtiendra des erreurs 404 sur tout :

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

Le panneau d'administration récupère automatiquement ce paramètre auprès du client qui lui est fourni ; rien d'autre n'a
besoin d'être configuré. Si vous construisez une URL de requête à la main, concaténez-la à partir du client plutôt
que d'écrire `/api` vous-même :

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Dépannage

### Erreur d'autorisation dans l'éditeur SQL (`permission denied for table <name>`)

* **Symptômes :** Les requêtes personnalisées exécutées dans l'éditeur SQL de Rebase Studio échouent avec `cause: error: permission denied for table <name>`, alors même que la vue CMS tableur charge les données correctement.
* **Cause :** Par défaut, Rebase tente d'exécuter les requêtes de l'éditeur SQL en changeant temporairement de rôle de base de données pour correspondre au rôle applicatif de l'utilisateur actif (par ex. `SET LOCAL ROLE "admin"`). Si vous utilisez une authentification personnalisée où les rôles n'existent que dans des tables de base de données plutôt qu'en tant que véritables rôles PostgreSQL, le changement de rôle échoue ou les privilèges de base de données manquent. La vue tableur du CMS s'exécute sous l'utilisateur propriétaire de la connexion par défaut et contourne ce problème.
* **Solution :** Ajoutez `DISABLE_DB_ROLE_SWITCHING=true` à la configuration `.env` de votre backend. Cela force Rebase à exécuter les requêtes de l'éditeur SQL en utilisant les privilèges du propriétaire de la connexion (généralement un superutilisateur/owner). L'éditeur SQL affiche alors, au-dessus des résultats, qu'ils ont été lus en tant que propriétaire de la connexion, et grise son sélecteur de rôle.

### Échec de récupération du schéma dans l'éditeur SQL (`Cross-database execution requires adminConnectionString`)

* **Symptômes :** Studio ne parvient pas à charger l'arborescence du schéma, ou l'éditeur SQL renvoie `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Cause :** Rebase nécessite des privilèges administratifs pour interroger les catalogues système de la base de données et exécuter des commandes d'administration. Si `adminConnectionString` n'est pas fourni au bootstrapper, ou si `getAdmin()` est surchargé pour renvoyer `undefined`, ces opérations échouent.
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
- **[Aperçu du backend](/docs/backend)** — Référence complète de la configuration du backend
