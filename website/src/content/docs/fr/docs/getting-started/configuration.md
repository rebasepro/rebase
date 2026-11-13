---
sourceHash: acc55c3c58895863
title: Environnement et configuration
sidebar_label: Configuration
description: Toutes les variables d'environnement et options de configuration pour les projets Rebase.
---

## Variables d'environnement

Toute la configuration s'effectue via des variables d'environnement dans votre fichier `.env` situé à la racine du projet.

> **Important** : Rebase valide les variables d'environnement avec **Zod** au démarrage. Si
> un élément requis est manquant ou mal formé (une URL qui n'est pas une URL, un port qui
> n'est pas un nombre), le serveur refuse de démarrer et indique le nom de la variable.
>
> L'emplacement du schéma dépend de la manière dont vous exécutez le backend. Un projet démarré
> par le runtime — `rebase dev`, `rebase start`, l'image publiée — utilise le
> schéma détenu par le runtime (`loadBootEnv` dans `@rebasepro/server`), qui est
> l'union de chaque tableau ci-dessous. Un projet ayant exécuté [`rebase eject`](/docs/cli)
> possède un fichier `backend/src/env.ts` appelant `loadEnv({ extend })`, et peut y ajouter
> ses propres variables typées.

### Requises

| Variable | Description | Exemple |
|----------|-------------|---------|
| `DATABASE_URL` | Chaîne de connexion PostgreSQL. **Facultative en développement** — si elle n'est pas définie, `rebase dev` exécute un PostgreSQL géré pour le projet, avec ses données sous `.rebase/`. Requise partout ailleurs. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Clé secrète pour signer les jetons JWT. Utilisez une chaîne aléatoire robuste (min. 32 caractères). **Requise en production** (générée automatiquement en développement). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` est une syntaxe propre à node-postgres, pas à libpq.**
>
> Rebase et le pilote Node l'acceptent — ils chiffrent, mais ne vérifient pas le
> certificat. `psql`, `pg_dump`, `pg_restore` et Atlas ne l'acceptent pas et ne se
> dégradent pas : ils refusent de démarrer avec l'erreur `invalid sslmode value: "no-verify"`.
>
> Les propres commandes de Rebase (`rebase db push`, `rebase db backup`, `rebase db
> restore`) la réécrivent en son équivalent `sslmode=require` avant d'exécuter la commande shell,
> de sorte qu'elles fonctionnent avec l'URL telle qu'elle est configurée. Utiliser `psql` manuellement
> ne le fait pas — remplacez-la par `sslmode=require` à cet endroit, ce qui chiffre sans vérifier
> exactement de la même manière.

### Frontend

| Variable | Description | Par défaut |
|----------|-------------|---------|
| `VITE_API_URL` | URL de l'API backend pour le SDK typé. **À définir uniquement en développement** — voir ci-dessous. | origine de la page |
| `VITE_GOOGLE_CLIENT_ID` | Identifiant client Google OAuth. Active « Se connecter avec Google ». | — |


> **Laissez `VITE_API_URL` non définie dans les builds de production.**
>
> En développement, le frontend et le backend ont des origines distinctes, le serveur
> de dev injecte donc cette variable. En production, le backend Rebase sert la SPA,
> l'API a donc la même origine que la page et le client la résout ainsi automatiquement.
>
> Figer une URL absolue dans un bundle de production fonctionne jusqu'à ce qu'un deuxième
> nom d'hôte pointe vers la même application : un domaine personnalisé charge alors la page depuis
> `example.com` et appelle l'API sur `example.rebase.website`, ce qui est
> cross-origin, et chaque requête échoue lors du preflight. Autoriser l'origine dans CORS
> ne résout **pas** non plus le problème — le cookie de rafraîchissement est en `SameSite=Lax` et n'est
> pas envoyé en cross-site, vous supprimeriez donc les erreurs de console tout en ayant toujours
> une authentification défaillante. Non définie, chaque domaine pointant vers l'application fonctionne
> sans aucune configuration CORS.

### Backend

| Variable | Description | Par défaut |
|----------|-------------|---------|
| `PORT` | Port du serveur HTTP backend. Lu par `rebase start`. `rebase dev` le lit **uniquement depuis l'environnement du shell** — un `PORT` dans `.env` n'y est pas lu, car le port est résolu avant que ce fichier ne soit chargé — et se lie sinon à un port dérivé du chemin du projet, afin que plusieurs projets puissent tourner en même temps. `rebase dev --port` l'emporte sur les deux, et la bannière de démarrage indique le palier utilisé. | `3001` |
| `LOG_LEVEL` | Niveau de détail des logs : `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Affiche le SQL sous-jacent à une ligne `Failed query: [redacted]`. Chaque instruction en échec est caviardée par défaut, car une requête échouée transporte ses paramètres liés — un e-mail, un hash de mot de passe. Définissez-la à `true` lors du diagnostic d'un échec DDL, RLS ou de capture de modifications. Ignorée lorsque `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Environnement : `development`, `production`, ou `test` | `development` |
| `CORS_ORIGINS` | Liste d'origines autorisées séparées par des virgules. **Requise en production** sauf si `FRONTEND_URL` est définie : un démarrage en production sans l'une ou l'autre refuse de se lancer. En développement, elle est *ajoutée à* localhost — voir ci-dessous. | — |
| `FRONTEND_URL` | URL de l'application frontend. Utilisée comme alternative à CORS_ORIGINS, dans les deux environnements. | — |
| `ADMIN_CONNECTION_STRING` | Chaîne de connexion à la base de données de niveau administrateur (utilisée pour l'introspection du schéma et les opérations d'administration). La base de données qu'elle désigne n'est pas celle que la console SQL considère comme courante, ni celle qu'une nouvelle branche copie par défaut : les deux correspondent à la base de données sur laquelle se trouve la propre connexion de l'application (voir `REBASE_BRANCH_PARENT_DATABASE` pour un serveur sur une branche). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Désactive le changement de rôle PostgreSQL dans l'éditeur SQL (utile pour l'authentification personnalisée où les rôles de base de données ne sont pas mappés). La console SQL de Studio indique alors que les lignes ont été lues en tant que propriétaire de la connexion, le nomme, et grise son sélecteur de rôle. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | La base de données à partir de laquelle la branche sur laquelle ce serveur tourne a été copiée. `rebase dev` la définit sur un checkout [basculé sur une branche](/docs/backend/branching/#cli-integration). Un serveur disposant de cette variable conserve le registre des branches sur cette base de données et copie de nouvelles branches à partir de celle-ci par défaut, afin que le volet Branches de Studio affiche les branches de la base de données principale. | — |

#### CORS en développement

Le développement autorise **localhost, ainsi que tout ce que `CORS_ORIGINS` (ou `FRONTEND_URL`)
désigne** — la même liste que celle utilisée par la production, avec localhost ajouté plutôt
que substitué. La variable fonctionne donc de la même manière dans les deux environnements, et les
cas qui en ont besoin en développement sont les cas ordinaires :

```bash
# Un téléphone sur le réseau local, la machine d'un collègue, un tunnel ngrok,
# un port Codespaces transféré — toutes des origines non-localhost.
CORS_ORIGINS=http://192.168.1.5:5173
```

Une origine qui n'est ni localhost ni répertoriée est refusée, et le refus est
journalisé **une fois par origine** avec la ligne exacte qui permettrait de l'autoriser. Le refus
n'est pas une simple prudence gratuite : l'API transmet des identifiants, refléter un
`Origin` arbitraire permettrait donc à n'importe quel site visité par le développeur d'effectuer
des requêtes authentifiées contre le serveur de dev avec sa session et d'en lire
les réponses.

### Authentification

| Variable | Description | Par défaut |
|----------|-------------|---------|
| `JWT_SECRET` | Secret pour la signature JWT (requis en production, généré automatiquement en développement) | — |
| `JWT_PRIVATE_KEY` | Clé privée PEM pour signer les jetons d'accès de manière asymétrique (RS256), afin que toute entité détenant le JWKS puisse vérifier une session sans pouvoir en forger une. Accepte un PEM avec de vrais sauts de ligne, un PEM avec des échappements `\n`, ou le base64 de l'ensemble du PEM. Sans cela, les jetons restent en HS256. | — |
| `JWT_KEY_ID` | Désigne `JWT_PRIVATE_KEY` dans l'en-tête du jeton et dans le JWKS. Modifiez-le chaque fois que la clé change — la rotation dépend de la distinction possible entre l'ancienne et la nouvelle clé. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Durée de vie du jeton d'accès | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Durée de vie du jeton de rafraîchissement. Glissante — chaque rotation le renouvelle, cela régit donc la durée pendant laquelle une session survit à **l'inactivité**. Définissez `400d` pour des sessions qui doivent survivre à une longue absence ; les navigateurs plafonnent le cookie de rafraîchissement à cette valeur. | `30d` |
| `ALLOW_REGISTRATION` | Autoriser les nouveaux utilisateurs à s'inscrire (`true`/`false`). En dehors de la production, le **premier** utilisateur peut toujours s'inscrire, quelle que soit cette valeur — une table d'utilisateurs vide doit bien admettre quelqu'un, et ce quelqu'un devient l'administrateur. En production (`NODE_ENV=production`), cette fenêtre est fermée : une table vide refuse l'inscription d'amorçage avec `SETUP_REQUIRED`, un premier compte créé via l'inscription ouverte est un compte ordinaire, et l'administrateur est désigné avec `REBASE_ADMIN_EMAIL` ci-dessous ou assigné avec la clé de service. Le fichier `.env.example` de base la définit à `true` ; la valeur par défaut du framework est désactivée. | `false` |
| `DISABLE_SELF_REGISTRATION` | Coupe-circuit. Ferme la fenêtre d'amorçage du premier utilisateur que `ALLOW_REGISTRATION=false` laisse délibérément ouverte en dehors de la production, de sorte que l'inscription soit fermée même face à une base de données vide. À associer avec `REBASE_ADMIN_EMAIL` ci-dessous, sinon le déploiement n'a aucun moyen de produire son premier appelant connecté. Chaque artefact de déploiement livré la définit. | — |
| `REBASE_ADMIN_EMAIL` | Adresse e-mail du premier compte administrateur, créé au démarrage **tant que la table des utilisateurs est encore vide** et jamais par la suite. C'est ainsi qu'un déploiement de production obtient son administrateur : l'opérateur désigne le premier compte au lieu de faire la course avec Internet. Le démarrage avertit lorsque la table est vide en production et que cette variable n'est pas définie. | — |
| `REBASE_ADMIN_PASSWORD` | Mot de passe de ce compte. Au moins 12 caractères, sinon il est refusé et le compte n'est pas créé. Modifiez-le après la première connexion. | — |
| `MFA_ENCRYPTION_KEY` | Chiffre chaque secret TOTP stocké. Si elle n'est pas définie, les secrets sont chiffrés avec `JWT_SECRET` à la place et le démarrage émet un avertissement — faire tourner `JWT_SECRET` déconnecte alors tout le monde *et* rend impossible le déchiffrement de chaque authentificateur enregistré. Définissez une clé dédiée (32+ caractères aléatoires) avant que quiconque ne s'inscrive. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | La clé que l'on abandonne lors d'une rotation. Définissez les deux lors d'une rotation : les nouveaux secrets sont écrits avec `MFA_ENCRYPTION_KEY` et les existants restent lisibles, de sorte que personne ne soit exclu de son propre compte en cours de rotation. Supprimez-la une fois que chaque secret a été ré-encrypté. | — |
| `ALLOW_ANONYMOUS` | Active la connexion anonyme (`POST /api/auth/anonymous`). Optionnelle (opt-in), et délibérément non conditionnée par `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Exige l'authentification pour l'API de données. Définissez à `false` pour une surface de lecture entièrement publique — la RLS s'applique toujours. | `true` |
| `AUTH_DEFAULT_ROLE` | Rôle attribué à un utilisateur nouvellement inscrit lorsqu'aucun n'est spécifié. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Monte `POST /api/auth/find-user`, qui résout un e-mail en un profil public minimal (`uid`, `displayName`, `photoURL`) pour les flux d'invitation par e-mail. Réservé aux appelants authentifiés, et ne renvoie jamais l'e-mail, les rôles ou les métadonnées de l'utilisateur trouvé. Désactivé par défaut : il s'agit d'une surface d'énumération. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` sur le cookie de rafraîchissement : `Strict`, `Lax` ou `None`. `None` requiert HTTPS et ne sert que pour un frontend véritablement cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure` sur le cookie de rafraîchissement. Sécurisé par défaut ; `AUTH_COOKIE_SECURE=false` pour du simple HTTP — un déploiement sur une adresse de réseau local où le navigateur rejetterait sinon le cookie et où la session mourrait à l'expiration du jeton d'accès sans erreur. Un avertissement est émis au démarrage. `http://localhost` n'en a pas besoin. | `true` |
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
| `GITLAB_CLIENT_ID` | Identifiant client GitLab OAuth. Le `baseUrl` d'une instance auto-hébergée n'a pas de variable d'environnement dédiée — configurez GitLab dans le bloc `auth` pour cela. | — |
| `GITLAB_CLIENT_SECRET` | Secret client GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | Identifiant client Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Secret client Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | Identifiant client Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Secret client Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | Identifiant client Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Secret client Spotify OAuth | — |
| `APPLE_CLIENT_ID` | Services ID Apple, pour la connexion web. Il est public et est publié dans `GET /auth/config`. Apple n'a pas de secret client statique, car Rebase signe un JWT ES256 à courte durée de vie pour chaque échange de jetons. Apple requiert donc `APPLE_TEAM_ID`, `APPLE_KEY_ID` et `APPLE_PRIVATE_KEY`, en plus de cette variable ou de `APPLE_BUNDLE_IDS`, et ne configure rien sans eux. | — |
| `APPLE_BUNDLE_IDS` | Identifiants de bundle séparés par des virgules pour les applications natives iOS/macOS dont les codes Sign in with Apple sont acceptés. | — |
| `APPLE_TEAM_ID` | Team ID Apple Developer, l'émetteur du JWT. | — |
| `APPLE_KEY_ID` | Key ID de la clé privée enregistrée auprès d'Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenu du fichier de clé privée `.p8`, sauts de ligne compris (les échappements `\n` sont acceptés). | — |
| `REBASE_SERVICE_KEY` | Clé API d'administration statique. Contourne l'authentification JWT normale pour les appels de serveur à serveur lorsqu'elle est transmise sous forme de `Authorization: Bearer <key>`. (Générée automatiquement en développement). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | La clé publique de la plateforme d'hébergement (PEM, EC P-256) par rapport à laquelle les jetons de plateforme `rpt_` sont vérifiés ; plusieurs blocs PEM lors d'une rotation de clés. La plateforme la définit lors du déploiement, et elle ne contient aucun secret. Conjointement avec `REBASE_PLATFORM_TOKEN_AUDIENCE`, elle permet à la barrière admin d'accepter un jeton de plateforme pour `cron:read`, et pour rien d'autre. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | L'identifiant de projet auquel l'`aud` d'un jeton de plateforme doit être égal, afin qu'un jeton forgé pour un autre projet soit refusé. Si une seule des deux variables est définie, le serveur démarre, consigne un avertissement et répond à chaque jeton `rpt_` par un `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_RATE_LIMIT_STORE` | Emplacement des compteurs de limitation de débit d'authentification : `memory` (par processus) ou `sql` (partagé entre les réplicas). Un processus ne peut pas voir le nombre de ses propres réplicas, un déploiement avec des pairs doit donc l'indiquer — trois réplicas avec la valeur par défaut appliquent trois fois la limite. Toute autre valeur **refuse de démarrer** plutôt que de se rabattre sur une valeur par défaut, y compris `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Monte le flux de lien de connexion sans mot de passe (magic link). Nécessite un service d'e-mail configuré, sinon le lien n'a nulle part où aller. | `false` |
| `AUTH_EMAIL_OTP` | Monte la connexion sans mot de passe avec un code à six chiffres envoyé par e-mail. Même exigence d'e-mail que ci-dessus. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Inscription sans mot de passe : une demande de lien magique ou de code e-mail pour une adresse inconnue crée le compte, tant que les inscriptions sont ouvertes. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Comportement lorsqu'un jeton de rafraîchissement est rejoué après sa fenêtre de réutilisation : `reject` (le refuse, conserve la session) ou `revoke-session` (met fin à la connexion). Toute autre valeur fait échouer le démarrage. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Inscription avec confirmation préalable : pas de connexion par mot de passe tant que l'adresse n'est pas vérifiée. Nécessite l'e-mail ; le démarrage le refuse sans cela. | `false` |
| `CAPTCHA_PROVIDER` | Active la vérification par captcha sur les routes d'authentification : `turnstile` ou `hcaptcha`. Non défini signifie aucun captcha. | — |
| `CAPTCHA_SECRET` | Le secret du fournisseur, utilisé côté serveur pour vérifier le jeton envoyé par le navigateur. Requis dès lors que `CAPTCHA_PROVIDER` est défini. | — |
| `CAPTCHA_ROUTES` | Routes d'authentification à protéger séparées par des virgules (par exemple `register,login`). Non défini protège l'ensemble par défaut du fournisseur. | — |

### Stockage (Storage)

:::caution[Le stockage ne dispose pas de sécurité au niveau des lignes (RLS), il nécessite donc un modèle d'accès]
Les tables sont protégées par la RLS de Postgres. Le stockage d'objets n'a pas d'équivalent —
les clés partagent un espace de noms plat unique — ainsi, avec un bucket configuré et aucun modèle d'accès,
le serveur **refuse de démarrer en production**. Remplissez cette condition avec exactement l'une des options suivantes :
un hook `storageAuthorize` exporté depuis `backend/storage.ts` (ce que fournit le scaffold),
`STORAGE_PUBLIC_READ`, ou `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Description | Par défaut |
|----------|-------------|---------|
| `STORAGE_TYPE` | Backend de stockage : `local`, `s3` ou `gcs`. En production, `local` désactive le stockage sauf si `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Chemin de base pour le stockage local. Un chemin relatif est lu depuis le répertoire dans lequel le serveur s'exécute : la racine du projet sous `rebase dev`, `backend/` dans un serveur généré par `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Autorise le stockage local en production — uniquement avec un volume durable contenant `STORAGE_PATH` et les répertoires `<STORAGE_PATH>__<key>` des buckets locaux nommés à côté | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Secondes pendant lesquelles l'URL de téléchargement d'un fichier privé fonctionne — le jeton que `getSignedUrl()` y insère. Au maximum `604800` (une semaine) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Fichier le plus volumineux accepté par la source, en octets, sur chaque chemin de téléversement — `__<KEY>` pour une source nommée. Une valeur qui n'est pas un nombre entier d'octets refuse le démarrage | `52428800` (50 Mo) |
| `S3_BUCKET` | Nom du bucket S3 (lorsque `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Région AWS | — |
| `S3_ACCESS_KEY_ID` | Clé d'accès AWS | — |
| `S3_SECRET_ACCESS_KEY` | Clé secrète AWS | — |
| `S3_ENDPOINT` | Point de terminaison S3 personnalisé (pour MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Force les URL de style chemin pour le bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nom du bucket GCS (lorsque `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Projet GCP. Généralement déduit des identifiants. | — |
| `GCS_KEY_FILENAME` | Chemin vers un fichier de clé de compte de service. À omettre sur GCP, où Workload Identity fournit les identifiants. | — |
| `STORAGE_PUBLIC_READ` | Sert chaque objet à n'importe qui, sans jeton. Uniquement pour un bucket qui est véritablement un CDN public. L'un des trois moyens de satisfaire la protection au démarrage ci-dessous. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permet à tout appelant connecté de lire, écrire, lister et supprimer chaque objet. Nommé `INSECURE` dans l'objet de configuration pour une raison : cela n'est défendable que dans une application mono-tenant où chaque compte a accès à chaque fichier. | `false` |
| `STORAGE_RENDITION_CACHE` | Met en cache les rendus d'images générés (redimensionnements, conversions de format) au lieu de les produire à chaque requête. | `false` |

### E-mail (Facultatif)

| Variable | Description |
|----------|-------------|
| `SMTP_HOST` | Hôte du serveur SMTP |
| `SMTP_PORT` | Port du serveur SMTP |
| `SMTP_SECURE` | Activer la connexion sécurisée (`true`/`false`) |
| `SMTP_USER` | Nom d'utilisateur SMTP |
| `SMTP_PASS` | Mot de passe SMTP |
| `SMTP_FROM` | Adresse d'expéditeur pour les e-mails système |
| `SMTP_NAME` | Nom d'affichage associé à l'adresse d'expéditeur |
| `APP_NAME` | Nom du produit utilisé dans les objets et corps d'e-mails (par défaut : `Rebase`) |
| `EMAIL_LOGO_URL` | Logo affiché en haut des modèles d'e-mails par défaut. PNG ou JPG absolu en `http(s)` — les clients de messagerie suppriment le SVG et bloquent les URI `data:`. Si non défini, une application toujours nommée `Rebase` reçoit le logo Rebase et une application renommée n'en reçoit aucun |

### Pool de connexions à la base de données

| Variable | Description | Par défaut |
|----------|-------------|---------|
| `DB_POOL_MAX` | Nombre maximal de connexions dans le pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Millisecondes pendant lesquelles une connexion inactive est conservée | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Millisecondes d'attente pour obtenir une connexion | `10000` |
| `DATABASE_DIRECT_URL` | Connexion directe (sans pool). Le [temps réel](/docs/backend/realtime) en a besoin : `LISTEN`/`NOTIFY` ne survit pas à un pooler de transactions tel que PgBouncer, et sans lui, les notifications de modifications sont désactivées avec un avertissement plutôt qu'être perdues silencieusement. Le [worker de jobs](/docs/backend/jobs) maintient également son `LISTEN` de réveil dessus. Remplit la variable `directConnectionString` de l'adaptateur Postgres lorsque celle-ci n'est pas définie. | — |
| `DATABASE_READ_URL` | Réplica de lecture, tel qu'un standby chaud. Lorsqu'il désigne un autre serveur, les lectures authentifiées (listes, lignes individuelles, décomptes, agrégats) y sont servies sous la même sécurité au niveau des lignes ; les écritures, la connexion, le temps réel, les tâches cron, les jobs, la console SQL et `rebase.sql` restent sur le primaire. Un lecteur qui vient d'écrire lit depuis le primaire pendant `REBASE_READ_STICKY_MS`, et tout le monde le fait tant que le réplica a plus de `REBASE_READ_MAX_LAG_MS` de retard ou est en échec. Remplit le `readConnectionString` de l'adaptateur Postgres lorsque celui-ci n'est pas défini ; jusqu'à la version 0.28 incluse, le pool du réplica était ouvert et jamais lu. | — |
| `REBASE_READ_STICKY_MS` | Après une écriture, durée pendant laquelle les lectures du même utilisateur vont vers le primaire, de sorte qu'un enregistrement suivi d'une liste affiche la modification. Par instance de serveur. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Retard maximal du réplica au-delà duquel chaque lecture est redirigée vers le primaire. | `1000` |
| `DATABASE_POOLED` | `true` lorsque `DATABASE_URL` passe par un pooler en mode transactionnel tel que PgBouncer. Le pool n'envoie alors aucun `search_path` ou `statement_timeout` à la connexion (le pooler les refuserait ou les ignorerait) et définit les deux dans chaque transaction ; le démarrage attribue au rôle de la base de données un `search_path` par défaut de `public` pour les instructions en dehors d'une transaction. `DATABASE_DIRECT_URL` devient obligatoire, et le temps réel, le réveil du worker de jobs, la construction d'index, le branching et la console SQL l'utilisent tous. L'URL du réplica est également considérée comme utilisant un pool. Utilisez `DATABASE_POOLED__<KEY>` pour une autre source de données. | — |
| `REBASE_DB_POOL_MAX` | Un plafond sur chaque pool du processus, appliqué quelle que soit la demande de chacun. Chiffres bruts uniquement : une valeur mal formée est ignorée plutôt que de sérialiser silencieusement le serveur. | — |

### Comportement du runtime

Lu par le runtime — `rebase dev`, `rebase start` et l'image de serveur publiée.
Un projet qui a été éjecté (ejected) gère ces décisions dans son propre code à la place.

| Variable | Description | Par défaut |
|----------|-------------|---------|
| `REBASE_RLS_AUDIT` | `true` exécute l'[audit de sécurité au niveau des lignes](/docs/rls-check#running-it-on-a-schedule) planifié, qui signale les tables servies sans politiques. Le projet doit déclarer `@rebasepro/rls-check` parmi ses dépendances : le runtime n'en fournit aucune copie, et sans ce paquet, le démarrage refuse de se lancer en le nommant. `false` désactive l'analyse sur ce processus. | — |
| `REBASE_RLS_REQUEST_ROLE` | Le rôle Postgres sous lequel s'exécutent les requêtes authentifiées et anonymes. Donnez à chaque projet sur un cluster partagé son propre rôle. Une base de données enregistre le rôle sous lequel elle s'exécute, et un démarrage configuré pour un autre rôle refuse de se lancer jusqu'à ce que `rebase db request-role migrate` le déplace. Voir [Exécution sur une base de données existante ou partagée](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` crée le rôle de requête et autorise la connexion à basculer dessus ; `never` vous laisse gérer les deux et ne fait que les vérifier. | `auto` |
| `REBASE_RLS_GRANTS` | Ce que Rebase accorde au rôle de requête : `schema` (chaque table dans les schémas qu'il sert, plus les privilèges par défaut), `managed` (uniquement les tables qu'il sert) ou `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` restreint les politiques permissives de Rebase au(x) rôle(s) de requête, de sorte que les autres rôles lisant les mêmes tables n'en tirent rien. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` écrit les politiques que seuls le contexte du serveur ou un administrateur peuvent franchir `TO public`, et exécute les administrateurs sous le rôle de requête. Par défaut, elles sont `TO rebase_admin`, afin que les lectures des utilisateurs connectés limitées au propriétaire puissent utiliser l'index du propriétaire. Voir [Requêtes d'administration et `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` supprime la politique de base serveur-ou-administrateur de chaque table. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` définit également `request.jwt.claims` et `request.jwt.claim.*`, de sorte que les politiques écrites avec `auth.uid()` voient l'appelant. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | Comportement au démarrage lorsqu'une autre connexion peut basculer sur le rôle de requête : `warn`, `refuse` ou `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Chemin de base pour chaque route d'API. Le client doit être configuré à l'identique — voir [Modifier `basePath`](#modifier-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Sert les ressources statiques/administratives du bundle à partir de ce processus. Désactivez-le lorsqu'un CDN est placé devant. | `true` |
| `REBASE_HISTORY` | Enregistre l'[historique des modifications des entités](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Réponses compressées en gzip/brotli. | `true` |
| `REBASE_MAX_BODY_SIZE` | Taille maximale du corps de la requête, **en octets** (`10485760`, et non `10MB` — une valeur qui n'est pas un nombre refuse de démarrer plutôt que de supprimer silencieusement la limite). `0` désactive la limite. | `10485760` (10 Mio) |
| `REBASE_ENABLE_SWAGGER` | La surface OpenAPI. Trois états. <span class="since-badge" data-since="0.31">Depuis 0.31</span> Non défini, dans chaque environnement : `/api/docs` est servi aux appelants auxquels `GET /api/schema/tables` décrit les tables, chacun recevant le document des tables qui lui sont décrites, et il n'y a pas d'interface Swagger UI. `true` publie l'intégralité du document à tout le monde, avec l'**interface** Swagger à `/api/swagger` en dehors de la production (jamais en production). `false` maintient le document derrière le contrôle d'accès administrateur. | — |
| `REBASE_METRICS` | Expose les métriques Prometheus à `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Ajoute `includeSubDomains` à l'en-tête `Strict-Transport-Security`, de sorte que les navigateurs refusent le HTTP simple sur chaque sous-domaine de l'hôte pendant six mois — y compris les hôtes que ce processus ne dessert pas. À n'activer que si chaque sous-domaine du domaine est exclusivement en HTTPS. Toute valeur autre que `true`/`false` refuse de démarrer. Voir [En-têtes de sécurité](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Jeton Bearer protégeant `/metrics`. Non défini laisse le point de terminaison ouvert à quiconque peut atteindre le port — acceptable sur un réseau privé, pas sur un réseau public, et les logs de démarrage le signalent. | — |
| `REBASE_MIGRATE_ON_BOOT` | Ce que le runtime peut faire au schéma des tables au démarrage. `ensure` (la valeur par défaut, partout — production incluse) effectue la passe **additive** : créer les tables, colonnes et types enum manquants, ne jamais supprimer ni réécrire quoi que ce soit. `none` laisse le schéma des tables déclarées intact, mais les tables propres au framework (authentification, clés d'API, jobs, cron) sont toujours créées et maintenues à jour ; `REBASE_PROVISION=false` désactive également ces dernières. L'image publiée n'accepte que ces deux valeurs et **refuse de démarrer avec `push`**. Dans un [déploiement fractionné](/docs/deployment/split-processes), exactement un processus peut provisionner, chaque autre rôle doit donc définir `none` ou refuser de démarrer. | `ensure` |
| `REBASE_PROVISION` | `false` empêche le runtime de modifier quoi que ce soit dans sa base de données : aucune table, colonne, index, fonction, trigger, politique, rôle ou droit, au démarrage ou plus tard, y compris ceux du framework. Il signale ce qui manque par son nom à la place. Pour une base de données que seul votre processus de gestion des changements peut modifier. Voir [Lorsque seul votre processus de changement peut modifier la base de données](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Seuls `true` et `false` sont acceptés. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Refuse de démarrer lorsque la base de données a été provisionnée pour la dernière fois à partir d'un ensemble de tables différent de celui à partir duquel ce processus a été construit. Non défini (ou toute autre valeur que `true`/`1`) émet un avertissement à la place. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Refuse de démarrer lorsqu'un fichier de fonction ou de tâche cron lève une exception ou ne s'analyse pas lors de l'importation, en nommant chaque fichier et la raison, afin qu'un déploiement progressif laisse l'ancienne version active. Un redémarrage y est également soumis. Non défini (ou toute valeur autre que `true`) ignore le fichier et sert le reste. Un fichier qui s'importe proprement et n'exporte aucune fonction ou job est toujours ignoré, pas refusé. | skip |
| `REALTIME_CDC` | Capture de modifications au niveau de la base de données (CDC) : `auto` (active là où la connexion le supporte, se replie silencieusement sinon), `trigger` (le force, avertit si impossible), `wal` (lit les modifications à partir du write-ahead log au lieu des déclencheurs ; nécessite `wal_level=logical` et un rôle autorisé à répliquer, se replie sur `trigger` sinon), `off`. Voir [Temps réel](/docs/backend/realtime-cdc/). L'emporte sur `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Transport inter-instances pour les canaux de diffusion et la présence : `memory` ou `postgres`. Ignoré lorsque `realtime.bus` a reçu un transport construit. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Nombre d'abonnements qu'un socket temps réel peut détenir ; le suivant est refusé avec `TOO_MANY_SUBSCRIPTIONS`. Un entier positif — toute autre valeur arrête le serveur au démarrage. L'emporte sur `realtime.maxSubscriptionsPerSocket`. Voir [Temps réel](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Nombre de sockets temps réel qu'un utilisateur, ou une clé API, peut maintenir ouverts sur une instance de serveur. Les sockets d'usurpation d'identité d'un administrateur sont décomptés de l'administrateur. La connexion suivante est refusée avec `TOO_MANY_SOCKETS` et le socket fermé (4002) ; le SDK continue de réessayer, de sorte qu'il se connecte dès qu'un autre se ferme. Un entier positif — toute autre valeur arrête le serveur au démarrage. L'emporte sur `realtime.maxSocketsPerUser`. | Pas de limite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Temps maximum d'attente d'une modification avant le rafraîchissement qui la délivre aux abonnés actifs, en ms. Un rafraîchissement attend 300 ms sans modification, et au maximum cette durée sous un flux continu d'écritures. Un nombre entier positif — toute autre valeur arrête le serveur au démarrage. L'emporte sur `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Durée pendant laquelle le total d'un abonnement à une grande liste peut être réutilisé avant d'être recalculé, en ms ; les frames qui le réutilisent comportent `meta.totalAsOf`. Non défini, chaque frame est recomptée. L'emporte sur `realtime.recountIntervalMs`. | Non défini |
| `REALTIME_RECOUNT_MIN_ROWS` | Le dernier total minimal auquel s'applique `REALTIME_RECOUNT_INTERVAL_MS` ; les listes plus petites sont comptées à chaque frame. L'emporte sur `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Autorise les valeurs `localhost`/loopback sous `NODE_ENV=production`. Désactivé, de sorte qu'un démarrage en production échoue explicitement plutôt que de se connecter à une base de données inexistante. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` exécute la passe de schéma et quitte sans ouvrir de socket — le format attendu par un Job de migration, à partir de la même image et du même bundle que le serveur qui suit. Il crée également les tables qu'un processus de service créerait autrement lors de la première utilisation, et ne démarre aucun cron ni file d'attente de jobs. Une valeur vide est considérée comme *non définie*, de sorte qu'un `${SOMETHING}` non substitué dans un fichier compose ne puisse pas transformer un déploiement ordinaire en un processus qui migre et refuse de servir. Refusé si combiné avec `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Un chemin de fichier. Une exécution de provisionnement (`REBASE_PROVISION_ONLY=true`) y écrit chaque modification de schéma apportée, dans l'ordre, sous la forme d'un script SQL à examiner et à appliquer avec `psql`. Les lignes écrites ne sont pas incluses. Refusé sur un processus qui sert du trafic. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permet à une machine — un agent, un job CI — d'*appliquer* une modification de schéma via `/api/admin/schema`, et pas seulement d'en planifier une. Désactivé sauf demande explicite : l'identifiant qui apporterait un tel changement est celui le plus susceptible de se trouver dans une variable de CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Durée maximale d'exécution d'une fonction personnalisée avant que sa requête ne soit interrompue. Même paramètre que l'option `functionsTimeoutMs`. `0` le désactive. | `30000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` fait en sorte qu'un rejet de promesse non géré mette fin au processus au lieu de simplement le journaliser. Activé sous un orchestrateur qui vous redémarrera ; désactivé là où un redémarrage est pire qu'une fuite. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Coupe l'avertissement de démarrage sur une plateforme que le runtime détecte comme étant à dimensionnement jusqu'à zéro (scale-to-zero), où un timer qui se déclenche dans une instance inactive ne se déclenche dans aucune instance. Ne change rien d'autre : définissez-le lorsque vous maintenez au moins une instance active en permanence. | — |
| `TRUSTED_PROXY_HOPS` | Nombre de proxys placés devant ce serveur, afin que le limiteur de débit puisse lire la véritable adresse client depuis `X-Forwarded-For`. Valeur de sécurité par défaut à `0` : sans proxy, faire confiance à l'en-tête permettrait à tout appelant de falsifier une identité. | `0` |

:::note[Le provisionnement au démarrage est additif et n'est pas un outil de migration]
La passe de démarrage s'exécute sans surveillance et sans personne pour relire un diff, elle ne supprimera donc jamais
de colonne, ne réduira jamais un type et ne réécrira jamais une table. C'est également la raison pour laquelle l'image refuse
`REBASE_MIGRATE_ON_BOOT=push` : un push complet calcule un diff et effectuera volontiers un
`DROP COLUMN`, et un redémarrage de conteneur ne doit jamais pouvoir détruire une
colonne de production comme effet secondaire d'un réordonnancement.

Les modifications destructives ou structurelles restent là où elles peuvent être examinées : `rebase db
generate` + `rebase db migrate`, ou `rebase db push` depuis un checkout local ou la CI,
qui effectue un galop d'essai (dry-run) de la modification, refuse les opérations destructives sans confirmation, et
peut effectuer une sauvegarde préalable.
:::

### Déploiements fractionnés (Split deployments)

Une même image et un même bundle peuvent être démarrés plusieurs fois, chacun servant une
partie différente du projet. Une ligne chacun ici, car cette page a pour vocation de
lister chaque variable ; ce que chaque combinaison *monte et possède* — et quelles
combinaisons refusent de démarrer — se trouve sur
**[Processus fractionnés](/docs/deployment/split-processes)**.

| Variable | Description | Par défaut |
|----------|-------------|---------|
| `REBASE_ROLE` | Quelle partie ce processus dessert : `all`, `api`, `functions` ou `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Remplace le comportement par défaut pour déterminer si *ce* processus exécute les timers cron. Non défini suit le rôle. | — |
| `REBASE_JOB_WORKERS` | Remplace le comportement par défaut pour déterminer si ce processus exécute les workers de file d'attente de jobs. Non défini suit le rôle. | — |
| `REBASE_FUNCTIONS_ONLY` | Ne sert que les fonctions personnalisées nommées dans ce processus. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Sert toutes les fonctions personnalisées sauf celles nommées. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Emplacement vers lequel le processus API transfère une requête de fonction qu'il ne dessert pas lui-même. Sur un `worker`, endroit où vont ses propres appels à `rebase.functions`. Une URL `http(s)`. | — |

### Surface MCP

Un point de terminaison Model Context Protocol optionnel (opt-in) à `/mcp`, afin qu'un client IA puisse lire
et écrire dans ce projet **en tant qu'utilisateur connecté**. Désactivé par défaut, et — contrairement
à toutes les autres surfaces — aucun `REBASE_ROLE` ne l'active : les autres décrivent une
forme de processus, tandis que celle-ci est une décision de transmettre des identifiants à un logiciel
tiers, et elle doit être prise par un être humain plutôt qu'héritée de la fonction d'un
conteneur.

| Variable | Description | Par défaut |
|----------|-------------|---------|
| `REBASE_MCP_ENABLED` | Monte la surface MCP. Nécessite `REBASE_PUBLIC_URL` ; sans cela, la surface refuse de monter et l'indique dans les logs de démarrage. | `false` |
| `REBASE_PUBLIC_URL` | L'origine accessible de l'extérieur de ce déploiement, par ex. `https://app.example.com`. La surface MCP ne peut pas la déduire — extraire l'origine de l'en-tête `Host` ferait de l'identité de l'émetteur, et de l'audience par rapport à laquelle ses propres jetons sont vérifiés, une valeur fournie par l'appelant. | — |
| `REBASE_MCP_VIEW` | Chemin vers la vue MCP App propre au projet (`rebase-view.html`, généré par `rebaseMcpViewPlugin()`), servie à Claude à la place de la vue générique pour qu'il affiche vos vues, champs et actions personnalisés. Sans cela, le backend cherche à côté du frontend qu'il sert. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Autorise l'enregistrement dynamique de client OAuth (RFC 7591), permettant à un client de s'inscrire lui-même. Définissez à `false` pour exiger que les clients soient enregistrés à l'avance. | `true` |

### Édition de schéma en direct depuis un bundle

Désactivé sauf si `REBASE_LIVE_SCHEMA_REPOSITORY` est défini. Un bundle compilé ne dispose d'aucune
source dans `backend/schema` à éditer, donc avec ces variables définies, l'éditeur de schéma lit
la source depuis le dépôt, commite chaque modification en retour, et exécute son DDL sur
cette base de données. Réservé aux administrateurs, et appliqué par une personne physique sauf si
`REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` en dispose autrement. Un dépôt désigné sans
identifiant utilisable refuse de démarrer. Voir
[Édition de schéma en direct](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variable | Description | Par défaut |
|----------|-------------|---------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Le dépôt GitHub sur lequel commiter les modifications de schéma, sous la forme `owner/name`. Le définir active la fonctionnalité. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | La branche sur laquelle le commit est appliqué. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | <span class="since-badge" data-since="0.31">Depuis 0.31</span> Emplacement de `backend/schema` dans ce dépôt, relatif à la racine du dépôt. Un chemin qui sort du dépôt refuse de démarrer, tout comme l'ancienne variable supprimée `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Un jeton à granularité fine avec accès en lecture et écriture au contenu du dépôt. Définissez soit ceci, soit les trois variables `_GITHUB_APP_*`, mais pas les deux. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | L'identifiant d'une GitHub App, pour commiter en tant qu'application plutôt qu'avec un jeton. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | L'installation de l'application sur le dépôt. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | La clé privée de l'application : PEM, PEM avec retours à la ligne échappés, ou base64. | — |

### Sauvegardes (Backups)

| Variable | Description | Par défaut |
|----------|-------------|---------|
| `BACKUP_SCHEDULE` | Expression cron pour les sauvegardes planifiées. Non défini signifie que les sauvegardes planifiées sont désactivées. | — |
| `BACKUP_DESTINATION` | Chemin local, ou une URL `s3://bucket/prefix` / `gs://bucket/prefix`. Requis avec `BACKUP_SCHEDULE`, qui refuse de s'exécuter sans lui. `rebase db backup` se rabat sur `./backups` là où il a été exécuté. | — |
| `BACKUP_RETENTION_DAYS` | Supprime les sauvegardes de plus de N jours. Non défini ou `0` conserve tout. | — |
| `BACKUP_KEEP_MINIMUM` | Conserve toujours au moins N sauvegardes parmi les plus récentes, quelle que soit la rétention définie. | — |
| `PG_DUMP_PATH` | Remplace le binaire `pg_dump` — il doit être de la version majeure du serveur ou plus récent. | — |
| `PG_RESTORE_PATH` | Remplace le binaire `pg_restore`. | — |
| `PSQL_PATH` | Remplace le binaire `psql` que `rebase db restore --clean` exécute pour faire de la restauration une transaction unique. | — |
| `PG_DUMPALL_PATH` | Emplacement de `pg_dumpall`, lorsqu'il n'est pas dans le `PATH`. Sans cela — et sans les outils clients PostgreSQL installés — une sauvegarde des globaux échoue avec une erreur nommant cette variable. | — |

L'image runtime officielle (`rebasepro/server`) intègre les outils clients
PostgreSQL 18, une sauvegarde planifiée y fonctionne donc contre n'importe quel serveur jusqu'à Postgres 18.
En dehors de l'image, installez-les vous-même (`apt-get install postgresql-client-18`,
`brew install libpq`).

Les sauvegardes contiennent des secrets et des données personnelles (PII). Utilisez une destination privée avec
chiffrement au repos.

### Livraison de bundle

Un déploiement géré ne transporte pas son code dans l'image : le runtime récupère un
bundle au démarrage. Ces variables déterminent lequel et comment.

| Variable | Description | Par défaut |
|----------|-------------|---------|
| `REBASE_BUNDLE` | Chemin vers un répertoire de bundle déjà extrait. Ce que `rebase start` définit localement. | — |
| `REBASE_BUNDLE_URL` | Emplacement depuis lequel récupérer l'archive du bundle, lorsqu'il n'y en a pas de local. | — |
| `REBASE_BUNDLE_TOKEN` | L'identifiant Bearer pour cette récupération. Traitez-le comme un secret : c'est ce qui autorise un tenant à télécharger son propre code. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Répertoire où un bundle récupéré est extrait. Doit être accessible en écriture et survivre entre la récupération et le démarrage. | — |
| `REBASE_RUNTIME_MODULES` | Modules supplémentaires que l'image runtime fournit au bundle, au-delà de ceux qu'il déclare lui-même. | — |

### Liaisons de ressources (Resource bindings)

Chaque base de données, bucket et topic déclaré par un projet dans `backend/resources.ts` est
lié par des variables d'environnement nommées d'après lui. Les noms de base figurent ci-dessous ; une
ressource non définie par défaut ajoute `__` et sa clé en majuscules, de sorte qu'un bucket nommé
`media` lit `S3_BUCKET__MEDIA`. La commande `rebase status`
affiche, par ressource,
la variable exacte qu'elle lit et si elle est définie ou non.

| Variable | Description | Par défaut |
|----------|-------------|---------|
| `REBASE_DRIVER` | Le paquet npm implémentant le pilote d'une source de données, lorsqu'il ne s'agit pas de celui par défaut de Postgres. Suffixé par source : `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | La chaîne de connexion pour un topic déclaré. Suffixé par topic. | — |

### L'environnement propre au CLI

Lu par `rebase`, et non par le serveur. Rien ici n'affecte un déploiement.

| Variable | Description | Par défaut |
|----------|-------------|---------|
| `REBASE_BASE_URL` | Emplacement vers lequel `rebase api-keys`, `rebase storage` et `rebase auth reset-password` envoient la clé de service, dans le shell ou dans `.env`. Définissez-le lorsque le serveur s'exécute autrement que par `rebase dev` dans ce projet : `rebase start`, un conteneur, un autre hôte. Non défini, ils utilisent le serveur que `rebase dev` a enregistré pendant que ce serveur est en cours d'exécution, et n'envoient rien lorsqu'il ne l'est pas. | — |
| `REBASE_SERVICE_KEY` | La clé de service avec laquelle ces commandes s'authentifient, lue depuis `.env` : la même variable que celle lue par le serveur (voir ci-dessus). | — |
| `SERVICE_KEY` | Un ancien nom pour cette clé. Lorsque `.env` le définit, `rebase api-keys` et `rebase storage` le lisent à la place de `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Le fichier `.env` que le CLI lit et écrit, lorsqu'il ne s'agit pas de celui du projet. | — |
| `REBASE_ROOT_RULES` | `0` empêche `rebase init` et `rebase skills install` d'écrire les règles du projet dans les fichiers `CLAUDE.md` et `AGENTS.md` à la racine du dépôt, pour une racine dont vous maintenez les fichiers d'agents manuellement. | on |
| `REBASE_CLOUD_URL` | Le plan de contrôle avec lequel `rebase cloud` communique. | — |
| `REBASE_CLOUD_EMAIL` | Le compte avec lequel `rebase cloud login` se connecte, au lieu de demander une invite. | — |
| `REBASE_CLOUD_PASSWORD` | Son mot de passe, afin qu'un gestionnaire de secrets puisse le transmettre sans qu'il n'atteigne l'historique du shell. | — |
| `REBASE_TOKEN` | Un jeton issu de `rebase cloud tokens create`. S'il est défini, chaque commande `rebase cloud` s'authentifie avec lui au lieu de la session `rebase cloud login`, et ne lit ni n'écrit jamais la session stockée. Dans un répertoire lié par `rebase cloud init --claim`, il est mis de côté au profit du propre jeton de ce projet lorsqu'il ne détient aucune portée sur le projet. Le moyen privilégié d'exécuter `rebase cloud` en CI — voir [CI et agents](/docs/deployment/cloud/#ci-and-agents). Le [serveur MCP](/docs/ai/mcp/) le transmet au CLI que ses outils cloud génèrent, et ne l'envoie jamais à l'application : définissez `REBASE_API_TOKEN` pour cela. | — |
| `REBASE_DEBUG` | `1` affiche l'erreur sous-jacente et le détail de la requête au lieu du message court. La première chose à définir lorsqu'une commande `rebase cloud` échoue de façon peu explicite. | — |
| `REBASE_ATLAS_DEV_URL` | La base de données vide par rapport à laquelle `rebase db push`, `db generate` et `db migrate` planifient, au lieu de la base `<db>_dev_diff` qu'ils créent à côté de `DATABASE_URL`. Rebase ne crée ni ne supprime de base de données nommée ici, et refuse une valeur identique à `DATABASE_URL`. Sur la base de données de développement gérée, le CLI la définit sur une instance PGlite éphémère en mémoire propre à lui. Définissez-la là où le privilège `CREATE DATABASE` n'est pas accordé. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` ne démarre aucune base de données et ne provisionne rien — vous apportez la vôtre. Identique à `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fixe le port du serveur de développement frontend, que `rebase dev` déduit autrement du chemin du projet. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Temps d'attente de `rebase dev` pour que le backend s'annonce avant d'indiquer qu'il n'a pas démarré. `0` désactive le rapport. | `30000` |
| `DATABASE_PASSWORD` | Le mot de passe que `rebase dev --docker` injecte dans la chaîne de connexion qu'il déduit de `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | La convention standard entre outils. Définie à toute valeur autre que `0`, le CLI n'envoie aucune télémétrie. | — |
| `REBASE_TELEMETRY_DISABLED` | La même chose, spécifiquement pour Rebase. Ne requiert aucun fichier, c'est pourquoi elle est recommandée en CI et dans une image. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Emplacement vers lequel la télémétrie est envoyée, pour un collecteur auto-hébergé. | — |

## Secrets en développement

`JWT_SECRET` est requis en production. Cette variable et `REBASE_SERVICE_KEY` sont
générées pour vous en dehors de celle-ci, afin que vous puissiez démarrer sans rien avoir à configurer.

Ces valeurs générées sont mises en cache dans `.rebase-dev-secrets.json`, aux côtés de
`.rebase-dev-port` et `.rebase-dev-url`, et sont ignorées par git avec eux. Auparavant, elles
étaient régénérées à chaque démarrage — redémarrer le serveur de développement vous déconnectait
donc de votre propre application et invalidait toute clé API que vous veniez de créer.

- Définissez l'une ou l'autre variable explicitement et la vôtre sera utilisée ; rien n'est mis en cache ni lu.
- Pointez le cache ailleurs avec `REBASE_DEV_SECRETS_FILE` — un chemin de fichier, et la
  seule variable de cette section que vous définiriez délibérément.
- Supprimez le fichier pour renouveler les deux secrets. Le démarrage suivant en écrira un nouveau.
- Si le fichier ne peut pas être écrit — par exemple dans un conteneur en lecture seule —, le serveur démarre
  malgré tout avec un secret éphémère, exactement comme auparavant.

Rien n'est mis en cache en production, ni sous un exécuteur de tests. En production, rien
n'est généré non plus : un démarrage sans `JWT_SECRET` échoue en nommant la variable, et
ce comportement reste inchangé :

```
The environment is not valid:
  JWT_SECRET: is required
```

## Objet de configuration Backend

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

L'objet `RebaseBackendConfig` passé à `initializeRebaseBackend()` offre un contrôle programmatique :

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";
import { env } from "./env";

await initializeRebaseBackend({
    app,
    server,
    schemaDir: "./schema",     // Le répertoire backend/schema : les tables, et ce que l'éditeur de schéma écrit
    basePath: "/api",        // Chemin de base pour toutes les routes d'API (par défaut : "/api")

    database: createPostgresAdapter({
        connection: db,
        schema: { tables, enums, relations }
    }),

    auth: {                  // Configuration de l'authentification
        jwtSecret: env.JWT_SECRET,
        accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
        refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
        requireAuth: true,    // Exige l'auth pour l'API de données (par défaut : true)
        allowRegistration: env.ALLOW_REGISTRATION,
        google: env.GOOGLE_CLIENT_ID
            ? {
                clientId: env.GOOGLE_CLIENT_ID,
                clientSecret: env.GOOGLE_CLIENT_SECRET
            }
            : undefined,
        serviceKey: env.REBASE_SERVICE_KEY
    },

    // Aucun bucket configuré en production signifie que le stockage est désactivé, et non local :
    // les téléversements répondent 501 plutôt que d'atterrir sur un système de fichiers effacé
    // au prochain redéploiement.
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

    history: true,           // Active l'historique des modifications des entités

    enableSwagger: true,     // Publie l'intégralité du document OpenAPI à /api/docs pour tout le monde

    logging: {
        level: "info"
    }
});
```

Les mêmes options,
sans `app`, `server` et `basePath` et avec un paramètre obligatoire `provision`, créent un
backend qui ne sert rien tant que vous ne le montez pas : `createRebaseBackend`. Voir
[Intégration de serveur personnalisé](/docs/backend/custom-server/).

### Modifier `basePath`

`basePath` déplace chaque route d'API, le client doit donc être configuré de la même manière —
sinon il continue de requêter `/api/...` et obtient des erreurs 404 pour tout :

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // doit correspondre au basePath du backend
});
```

Le panneau d'administration récupère automatiquement ce paramètre à partir du client qui lui est fourni ; rien d'autre n'a besoin
d'être configuré. Si vous construisez une URL de requête manuellement, joignez-la à partir du client plutôt
que d'écrire `/api` vous-même :

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // par ex. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Dépannage

### Erreur de permission refusée dans l'éditeur SQL (`permission denied for table <name>`)

* **Symptômes :** Les requêtes personnalisées exécutées dans l'éditeur SQL de Rebase Studio échouent avec `cause: error: permission denied for table <name>`, alors même que la vue CMS en feuille de calcul charge les données sans problème.
* **Cause :** Par défaut, Rebase tente d'exécuter les requêtes de l'éditeur SQL en basculant temporairement les rôles de base de données pour correspondre au rôle applicatif de l'utilisateur actif (par exemple, `SET LOCAL ROLE "admin"`). Si vous utilisez une authentification personnalisée où les rôles n'existent que dans des tables de base de données et non sous forme de rôles PostgreSQL réels, le changement de rôle échoue ou les privilèges de base de données sont manquants. La vue feuille de calcul du CMS s'exécute sous l'utilisateur propriétaire de la connexion par défaut et contourne ce mécanisme.
* **Solution :** Ajoutez `DISABLE_DB_ROLE_SWITCHING=true` à votre configuration `.env` backend. Cela force Rebase à exécuter les requêtes de l'éditeur SQL avec les privilèges du propriétaire de la connexion (généralement un superuser/owner). L'éditeur SQL indique alors, au-dessus des résultats, qu'ils ont été lus en tant que propriétaire de la connexion, et grise son sélecteur de rôle.

### Échec de récupération du schéma dans l'éditeur SQL (`Cross-database execution requires adminConnectionString`)

* **Symptômes :** Studio ne parvient pas à charger l'arborescence du schéma, ou l'éditeur SQL renvoie `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Cause :** Rebase nécessite des privilèges d'administration pour interroger les catalogues système de la base de données et exécuter des commandes d'administration. Si `adminConnectionString` n'est pas fourni au bootstrapper, ou si `getAdmin()` est surchargé pour renvoyer `undefined`, ces opérations échouent.
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
- **[Aperçu du Backend](/docs/backend)** — Référence complète de configuration du backend
