---
sourceHash: a6ecab532bd0be01
title: Environnement et configuration
sidebar_label: Configuration
description: Toutes les variables d'environnement et options de configuration pour les projets Rebase.
---

## Variables d'environnement

Toute la configuration s'effectue via des variables d'environnement dans votre fichier `.env` à la racine du projet.

> **Important** : Rebase valide les variables d'environnement avec **Zod** au démarrage. Si
> un élément requis est manquant ou malformé (une URL qui n'en est pas une, un port qui
> n'est pas un nombre), le serveur refuse de démarrer et nomme la variable en cause.
>
> L'emplacement du schéma dépend de la manière dont vous exécutez le backend. Un projet démarré par
> le runtime — `rebase dev`, `rebase start`, l'image publiée — utilise le
> schéma appartenant au runtime (`loadBootEnv` dans `@rebasepro/server`), qui correspond à l'union
> de chaque tableau ci-dessous. Un projet qui a exécuté [`rebase eject`](/docs/cli)
> possède un fichier `backend/src/env.ts` appelant `loadEnv({ extend })`, et peut y ajouter ses propres
> variables typées.

### Requises

| Variable | Description | Exemple |
|----------|-------------|---------|
| `DATABASE_URL` | Chaîne de connexion PostgreSQL. **Optionnelle en développement** — si non définie, `rebase dev` exécute un PostgreSQL géré pour le projet, avec ses données sous `.rebase/`. Requise partout ailleurs. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Clé secrète pour signer les jetons JWT. Utilisez une chaîne aléatoire robuste (min 32 caractères). **Requise en production** (générée automatiquement en développement). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` est une syntaxe propre à node-postgres, pas à libpq.**
>
> Rebase et le pilote Node l'acceptent — chiffrer, mais ne pas vérifier le
> certificat. `psql`, `pg_dump`, `pg_restore` et Atlas ne l'acceptent pas, et ils ne se
> dégradent pas gracieusement : ils refusent de démarrer avec `invalid sslmode value: "no-verify"`.
>
> Les commandes propres à Rebase (`rebase db push`, `rebase db backup`, `rebase db
> restore`) la réécrivent en son équivalent `sslmode=require` avant d'invoquer le shell,
> fonctionnant ainsi avec l'URL telle que configurée. L'utilisation manuelle de `psql` ne le fait
> pas — remplacez-la par `sslmode=require` dans ce cas, ce qui chiffre sans vérifier
> exactement de la même manière.

### Frontend

| Variable | Description | Valeur par défaut |
|----------|-------------|---------|
| `VITE_API_URL` | URL de l'API backend pour le SDK client. **À définir uniquement en développement** — voir ci-dessous. | origine de la page |
| `VITE_GOOGLE_CLIENT_ID` | Identifiant client Google OAuth. Active « Se connecter avec Google ». | — |


> **Laissez `VITE_API_URL` non définie dans les builds de production.**
>
> En développement, le frontend et le backend sont des origines distinctes, le serveur
> de dev injecte donc cette variable. En production, le backend Rebase sert la SPA, l'API
> est donc la propre origine de la page et le client la résout de cette manière par lui-même.
>
> Intégrer en dur une URL absolue dans un bundle de production fonctionne jusqu'à ce qu'un
> deuxième nom d'hôte pointe vers la même application : un domaine personnalisé charge alors la page depuis
> `example.com` et appelle l'API sur `example.rebase.website`, ce qui est
> cross-origin, faisant échouer le preflight de chaque requête. Autoriser l'origine dans CORS
> ne résout **pas** le problème non plus — le cookie de rafraîchissement est en `SameSite=Lax` et n'est
> pas envoyé en cross-site ; vous élimineriez les erreurs de console tout en conservant une
> authentification défaillante. Si elle n'est pas définie, chaque domaine pointant vers l'application fonctionne sans aucune configuration CORS.

### Backend

| Variable | Description | Valeur par défaut |
|----------|-------------|---------|
| `PORT` | Port pour le serveur HTTP backend. Lu par `rebase start`. `rebase dev` le lit **uniquement depuis l'environnement du shell** — un `PORT` dans `.env` n'y est pas lu, car le port est résolu avant le chargement de ce fichier — et lie sinon un port dérivé du chemin du projet, permettant à plusieurs projets de s'exécuter en même temps. `rebase dev --port` a la priorité sur les deux, et la bannière de démarrage indique le niveau utilisé. | `3001` |
| `LOG_LEVEL` | Verbosité des logs : `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Affiche le SQL derrière une ligne `Failed query: [redacted]`. Chaque instruction en échec est masquée par défaut, car une requête échouée transporte ses paramètres liés — un e-mail, un hash de mot de passe. Définissez-la sur `true` lors du diagnostic d'une panne DDL, RLS ou de capture des modifications. Ignoré lorsque `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Environnement : `development`, `production` ou `test` | `development` |
| `CORS_ORIGINS` | Liste des origines autorisées, séparées par des virgules. **Requise en production** si différente du domaine backend. En développement, elle est *ajoutée à* localhost — voir ci-dessous. | — |
| `FRONTEND_URL` | URL de l'application frontend. Utilisée comme alternative à CORS_ORIGINS, dans les deux environnements. | — |
| `ADMIN_CONNECTION_STRING` | Chaîne de connexion à la base de données de niveau administrateur (utilisée pour l'introspection du schéma et les opérations d'administration). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Désactive le changement de rôle PostgreSQL dans l'éditeur SQL (utile pour l'authentification personnalisée où les rôles DB ne sont pas mappés). | `false` |

#### CORS en développement

Le développement autorise **localhost, ainsi que tout ce que `CORS_ORIGINS` (ou `FRONTEND_URL`)
spécifie** — la même liste que celle utilisée en production, avec localhost ajouté plutôt que
substitué. Ainsi, la variable fonctionne de la même manière dans les deux environnements, et les
cas qui la requièrent en développement sont les cas classiques :

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Une origine qui n'est ni localhost ni répertoriée est refusée, et le refus est
consigné dans les logs **une fois par origine** avec la ligne exacte qui permettrait de l'autoriser. Ce
refus n'est pas de la prudence gratuite : l'API transmet des identifiants, donc refléter un
`Origin` arbitraire permettrait à n'importe quel site visité par le développeur d'effectuer
des requêtes authentifiées auprès du serveur de développement avec sa session et d'en lire les
réponses.

### Authentification

| Variable | Description | Valeur par défaut |
|----------|-------------|---------|
| `JWT_SECRET` | Secret pour la signature des JWT (requis en production, généré automatiquement en développement) | — |
| `JWT_PRIVATE_KEY` | Clé privée PEM pour signer les jetons d'accès de manière asymétrique (RS256), afin que toute entité détenant le JWKS puisse vérifier une session sans pouvoir en forger une. Accepte un PEM avec de vrais sauts de ligne, un PEM avec des échappements `\n` ou le base64 du PEM complet. Sans elle, les jetons restent en HS256. | — |
| `JWT_KEY_ID` | Nomme la `JWT_PRIVATE_KEY` dans l'en-tête du jeton et dans le JWKS. Modifiez-le à chaque changement de clé — la rotation dépend de la distinction entre l'ancienne et la nouvelle clé. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Durée de validité du jeton d'accès | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Durée de validité du jeton de rafraîchissement. Glissante — chaque rotation la renouvelle, cela régit donc la durée de survie d'une session face à **l'inactivité**. | `400d` |
| `ALLOW_REGISTRATION` | Autoriser de nouveaux utilisateurs à s'inscrire (`true`/`false`). En dehors de la production, le **premier** utilisateur peut toujours s'inscrire, quelle que soit cette valeur — une table d'utilisateurs vide doit bien accepter quelqu'un, et ce quelqu'un devient l'administrateur. En production (`NODE_ENV=production`), cette fenêtre est fermée : une table vide refuse l'inscription d'amorçage avec `SETUP_REQUIRED`, un premier compte créé via une inscription libre est un compte ordinaire, et l'administrateur est désigné via `REBASE_ADMIN_EMAIL` ci-dessous ou attribué avec la clé de service. Le fichier `.env.example` du scaffold la définit sur `true` ; la valeur par défaut du framework est désactivée. | `false` |
| `DISABLE_SELF_REGISTRATION` | Interrupteur d'urgence. Ferme la fenêtre d'amorçage du premier utilisateur que `ALLOW_REGISTRATION=false` laisse délibérément ouverte hors production, de sorte que l'inscription soit fermée même face à une base de données vide. Associez-le à `REBASE_ADMIN_EMAIL` ci-dessous, sinon le déploiement n'aura aucun moyen de produire son premier appelant connecté. Chaque artefact de déploiement livré le définit. | — |
| `REBASE_ADMIN_EMAIL` | E-mail du premier compte administrateur, créé au démarrage **tant que la table des utilisateurs est encore vide** et jamais par la suite. C'est ainsi qu'un déploiement en production obtient son administrateur : l'opérateur désigne le premier compte au lieu d'entrer dans une course de vitesse avec Internet. Le démarrage émet un avertissement lorsque la table est vide en production et que cette variable n'est pas définie. | — |
| `REBASE_ADMIN_PASSWORD` | Mot de passe pour ce compte. Au moins 12 caractères, sinon il est refusé et le compte n'est pas créé. Modifiez-le après la première connexion. | — |
| `MFA_ENCRYPTION_KEY` | Chiffre chaque secret TOTP stocké. Si non définie, les secrets sont chiffrés avec `JWT_SECRET` à la place et le démarrage avertit une fois — faire pivoter `JWT_SECRET` déconnecte donc tout le monde *et* rend tout authentificateur inscrit indéchiffrable. Définissez une clé dédiée (32+ caractères aléatoires) avant que quiconque ne s'inscrive. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | La clé en cours de remplacement lors d'une rotation. Définissez les deux pendant une rotation : les nouveaux secrets sont écrits avec `MFA_ENCRYPTION_KEY` et les secrets existants restent lisibles, afin que personne ne soit bloqué hors de son propre compte en pleine rotation. Supprimez-la une fois que chaque secret a été rechiffré. | — |
| `ALLOW_ANONYMOUS` | Active la connexion anonyme (`POST /api/auth/anonymous`). Optionnel (opt-in), et délibérément non conditionné par `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Exiger l'authentification pour l'API de données. Définissez sur `false` pour une surface de lecture totalement publique — le RLS s'applique toujours. | `true` |
| `AUTH_DEFAULT_ROLE` | Rôle attribué à un utilisateur nouvellement inscrit lorsqu'aucun n'est spécifié. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Monte `POST /api/auth/find-user`, qui résout un e-mail en un profil public minimal (`uid`, `displayName`, `photoURL`) pour les flux d'invitation par e-mail. Appelants authentifiés uniquement, et ne renvoie jamais l'e-mail, les rôles ou les métadonnées de l'utilisateur trouvé. Désactivé par défaut : il s'agit d'une surface d'énumération. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` sur le cookie de rafraîchissement : `Strict`, `Lax` ou `None`. `None` requiert HTTPS et est réservé à un frontend véritablement cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure` sur le cookie de rafraîchissement. Sécurisé par défaut ; `AUTH_COOKIE_SECURE=false` pour le HTTP brut — un déploiement sur une adresse LAN où le navigateur rejetterait sinon le cookie et où la session mourrait à l'expiration du jeton d'accès sans aucune erreur. Avertit au démarrage. `http://localhost` n'en a pas besoin. | `true` |
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
| `APPLE_CLIENT_ID` | Apple Services ID. Apple n'a pas de secret client statique — Rebase signe un JWT ES256 de courte durée par échange de jeton — il nécessite donc les quatre valeurs `APPLE_*`, et ne configure rien sans elles. | — |
| `APPLE_TEAM_ID` | Apple Developer Team ID, l'émetteur du JWT. | — |
| `APPLE_KEY_ID` | Key ID de la clé privée enregistrée auprès d'Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenu du fichier de clé privée `.p8`, avec les sauts de ligne (les séquences d'échappement `\n` sont acceptées). | — |
| `REBASE_SERVICE_KEY` | Clé d'API administrateur statique. Contourne l'authentification JWT normale pour les appels de serveur à serveur lorsqu'elle est transmise sous la forme `Authorization: Bearer <clé>`. (Générée automatiquement en développement). | — |
| `REBASE_RATE_LIMIT_STORE` | Emplacement des compteurs de limitation de débit (rate limit) d'authentification : `memory` (par processus) ou `sql` (partagé entre les réplicas). Un processus ne peut pas connaître son nombre de réplicas, donc un déploiement avec des pairs doit le spécifier — trois réplicas sur la valeur par défaut appliquent trois fois la limite. Toute autre valeur **refuse de démarrer** plutôt que d'utiliser un repli, y compris `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Monte le flux de lien de connexion sans mot de passe (magic link). Nécessite un service d'e-mail configuré, sinon le lien n'a nulle part où aller. | `false` |
| `AUTH_EMAIL_OTP` | Monte la connexion sans mot de passe avec un code à six chiffres envoyé par e-mail. Même exigence d'e-mail que ci-dessus. | `false` |
| `CAPTCHA_PROVIDER` | Active la vérification captcha sur les routes d'authentification : `turnstile` ou `hcaptcha`. Non défini signifie aucun captcha. | — |
| `CAPTCHA_SECRET` | Le secret du fournisseur, utilisé côté serveur pour vérifier le jeton envoyé par le navigateur. Requis dès lors que `CAPTCHA_PROVIDER` est défini. | — |
| `CAPTCHA_ROUTES` | Routes d'authentification à protéger séparées par des virgules (par exemple `register,login`). Non défini protège l'ensemble par défaut du fournisseur. | — |

### Stockage

:::caution[Le stockage ne dispose pas de sécurité au niveau des lignes, il nécessite donc un modèle d'accès]
Les collections sont protégées par le RLS de Postgres. Le stockage d'objets n'a pas d'équivalent —
les clés partagent un unique espace de noms plat — ainsi, avec un bucket configuré et aucun modèle d'accès,
le serveur **refuse de démarrer en production**. Répondez à cette exigence avec exactement l'un des éléments suivants :
un hook `storageAuthorize` exporté depuis `config/index.ts` (ce que fournit le scaffold),
`STORAGE_PUBLIC_READ` ou `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Description | Valeur par défaut |
|----------|-------------|---------|
| `STORAGE_TYPE` | Backend de stockage : `local`, `s3` ou `gcs`. En production, `local` désactive le stockage sauf si `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Chemin de base pour le stockage local | `./uploads` |
| `FORCE_LOCAL_STORAGE` | Autorise le stockage local en production — uniquement avec un volume persistant monté sur `STORAGE_PATH` | `false` |
| `S3_BUCKET` | Nom du bucket S3 (lorsque `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Région AWS | — |
| `S3_ACCESS_KEY_ID` | Clé d'accès AWS | — |
| `S3_SECRET_ACCESS_KEY` | Clé secrète AWS | — |
| `S3_ENDPOINT` | Endpoint S3 personnalisé (pour MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Forcer les URL de type path-style pour le bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nom du bucket GCS (lorsque `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Projet GCP. Généralement déduit des identifiants. | — |
| `GCS_KEY_FILENAME` | Chemin vers un fichier de clé de compte de service. À omettre sur GCP, où Workload Identity fournit les identifiants. | — |
| `STORAGE_PUBLIC_READ` | Sert chaque objet à n'importe qui, sans jeton. Uniquement pour un bucket qui fait véritablement office de CDN public. L'une des trois manières de satisfaire la protection au démarrage ci-dessous. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permet à tout appelant connecté de lire, écrire, lister et supprimer chaque objet. Nommé `INSECURE` dans l'objet de configuration pour une bonne raison : ce n'est défendable que dans une application mono-tenant où chaque compte a accès en toute confiance à tous les fichiers. | `false` |
| `STORAGE_RENDITION_CACHE` | Met en cache les rendus d'images générés (redimensionnements, conversions de format) au lieu de les produire à chaque requête. | `false` |

### E-mail (Optionnel)

| Variable | Description |
|----------|-------------|
| `SMTP_HOST` | Hôte du serveur SMTP |
| `SMTP_PORT` | Port du serveur SMTP |
| `SMTP_SECURE` | Activer la connexion sécurisée (`true`/`false`) |
| `SMTP_USER` | Nom d'utilisateur SMTP |
| `SMTP_PASS` | Mot de passe SMTP |
| `SMTP_FROM` | Adresse d'expéditeur pour les e-mails système |
| `SMTP_NAME` | Nom d'affichage pour l'adresse d'expéditeur |
| `APP_NAME` | Nom du produit utilisé dans les objets et corps d'e-mails (par défaut : `Rebase`) |
| `EMAIL_LOGO_URL` | Logo affiché en tête des modèles d'e-mail par défaut. PNG ou JPG `http(s)` absolu — les clients suppriment les SVG et bloquent les URI `data:`. Non défini, une application toujours nommée `Rebase` reçoit l'emblème Rebase et une application renommée n'en reçoit aucun |

### Pool de connexions à la base de données

| Variable | Description | Valeur par défaut |
|----------|-------------|---------|
| `DB_POOL_MAX` | Nombre maximum de connexions dans le pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Millisecondes pendant lesquelles une connexion inactive est conservée | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Millisecondes à attendre pour obtenir une connexion | `10000` |
| `DATABASE_DIRECT_URL` | Connexion directe (sans pool). [Realtime](/docs/backend/realtime) en a besoin : `LISTEN`/`NOTIFY` ne survit pas à un gestionnaire de pool de transactions tel que PgBouncer, et sans cela, les notifications de modification sont désactivées avec un avertissement plutôt que perdues silencieusement. | — |
| `DATABASE_READ_URL` | Réplica de lecture. Les lectures s'y effectuent lorsqu'il est défini et diffère de `DATABASE_URL` ; si la connexion échoue, tout bascule sur le primaire avec un avertissement. | — |
| `REBASE_DB_POOL_MAX` | Plafond sur chaque pool du processus, appliqué indépendamment de ce que chacun a demandé. Chiffres simples uniquement : une valeur malformée est ignorée plutôt que de sérialiser silencieusement le serveur. | — |

### Comportement du runtime

Lu par le runtime — `rebase dev`, `rebase start` et l'image de serveur
publiée. Un projet ayant été éjecté prend lui-même ces décisions dans son propre code.

| Variable | Description | Valeur par défaut |
|----------|-------------|---------|
| `REBASE_RLS_AUDIT` | Exécute l'audit de sécurité au niveau des lignes (RLS) au démarrage et monte son endpoint, qui signale les tables servies sans stratégies. | — |
| `REBASE_BASE_PATH` | Chemin de base pour chaque route d'API. Le client doit être configuré de la même manière — voir [Modifier `basePath`](#changing-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Sert les ressources statiques/d'administration du bundle depuis ce processus. Désactivez-le lorsqu'un CDN est placé en amont. | `true` |
| `REBASE_HISTORY` | Enregistre [l'historique des modifications d'entités](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Réponses gzip/brotli. | `true` |
| `REBASE_MAX_BODY_SIZE` | Taille maximale du corps de requête, **en octets** (`10485760`, et non `10MB` — une valeur qui n'est pas un nombre refuse de démarrer au lieu de supprimer silencieusement la limite). | — |
| `REBASE_ENABLE_SWAGGER` | La surface OpenAPI. Tri-state : non défini signifie activé en développement, désactivé en production ; `false` désactive les deux partout. Notez que `true` en production sert la **spécification** à `/api/docs` mais pas l'**interface utilisateur** Swagger à `/api/swagger` — l'UI dépend de `NODE_ENV` séparément. | — |
| `REBASE_METRICS` | Expose les métriques Prometheus sur `/metrics`. | `false` |
| `REBASE_METRICS_TOKEN` | Jeton Bearer protégeant `/metrics`. S'il n'est pas défini, l'endpoint reste ouvert à tout ce qui peut atteindre le port — sans problème sur un réseau privé, mais pas sur un réseau public, ce que précisent les logs de démarrage. | — |
| `REBASE_MIGRATE_ON_BOOT` | Ce que le runtime peut faire au schéma au démarrage. `ensure` (la valeur par défaut, partout — y compris en production) exécute la passe **additive** : crée les tables, colonnes et types enum manquants, sans jamais en supprimer ni en réécrire. `none` ne touche à rien. L'image publiée n'accepte que ces deux-là et **refuse de démarrer sur `push`**. Dans un [déploiement scindé](/docs/deployment/split-processes), exactement un processus peut provisionner, donc chaque autre rôle doit définir `none` ou refusera de démarrer. | `ensure` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Refuse de démarrer lorsque la base de données a été provisionnée pour la dernière fois à partir d'un ensemble de collections différent de celui avec lequel ce processus a été compilé. Non défini (ou toute valeur autre que `true`/`1`) émet un avertissement à la place. | warn |
| `REALTIME_CDC` | Capture des modifications au niveau de la base de données : `auto` (activé lorsque la connexion le prend en charge, repli silencieux sinon), `trigger` (le force, avertit si impossible), `wal` (se dégrade en `trigger` actuellement), `off`. Voir [Realtime](/docs/backend/realtime#database-level-change-capture-cdc). | `auto` |
| `REALTIME_CHANNEL_BUS` | Transport inter-instances pour les canaux de diffusion et la présence : `memory` ou `postgres`. Ignoré lorsque `realtime.bus` a reçu un transport construit. | `memory` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Autoriser les valeurs `localhost`/loopback sous `NODE_ENV=production`. Désactivé, de sorte qu'un démarrage en production échoue explicitement plutôt que de se connecter à une base de données inexistante. | `false` |
| `REBASE_STRICT_COLLECTION_CONFIG` | Ce que fait le démarrage avec une clé dans vos collections que cette version ne lit pas : `warn`, `error` (refuse de démarrer — utile à activer en CI), ou `off`. Ne régit que les clés qu'il ne *reconnaît* pas, qui sont généralement une faute de frappe et parfois des métadonnées délibérées ; une clé qu'il sait avoir été déplacée est toujours fatale, car la fonctionnalité qu'elle configurait est sinon silencieusement absente. | `warn` |
| `REBASE_PROVISION_ONLY` | `1`/`true` exécute la passe de schéma et se termine sans ouvrir de socket — la forme souhaitée pour un Job de migration, à partir de la même image et du même bundle que le serveur qui suit. Une valeur vide est considérée comme *non définie*, de sorte qu'un `${SOMETHING}` non substitué dans un fichier compose ne puisse pas transformer un déploiement ordinaire en un déploiement qui migre et refuse de servir. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permet à une machine — un agent, un job CI — d'*appliquer* une modification de schéma via `/api/admin/schema`, et pas seulement d'en planifier une. Désactivé sauf indication contraire : l'identifiant qui effectuerait une telle modification est le plus susceptible de se trouver dans une variable CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Durée pendant laquelle une fonction personnalisée peut s'exécuter avant que sa requête ne soit interrompue. Même paramètre que l'option `functionsTimeoutMs`. | — |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` fait en sorte qu'un rejet de promesse non géré mette fin au processus au lieu de simplement le journaliser. Activé sous un orchestrateur qui vous redémarrera ; désactivé là où un redémarrage est pire qu'une fuite. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Maintient le planificateur cron en cours d'exécution sur une plateforme que le runtime détecte autrement comme « scale-to-zero », où un minuteur qui se déclenche dans une instance inactive se déclenche dans le vide. | — |
| `TRUSTED_PROXY_HOPS` | Nombre de proxys situés devant ce serveur, afin que le limiteur de débit puisse lire la véritable adresse client dans `X-Forwarded-For`. Valeur par défaut sécurisée `0` : sans proxy, faire confiance à l'en-tête permettrait à n'importe quel appelant d'usurper une identité. | `0` |

:::note[Le provisionnement au démarrage est additif et n'est pas un outil de migration]
La passe de démarrage s'exécute sans surveillance et sans personne pour lire un diff ; elle ne supprimera donc jamais
une colonne, ne réduira jamais un type et ne réécrira jamais une table. C'est également la raison pour laquelle l'image refuse
`REBASE_MIGRATE_ON_BOOT=push` : un push complet calcule un diff et exécutera volontiers un
`DROP COLUMN`, et un redémarrage de conteneur ne doit jamais pouvoir détruire une
colonne de production par effet secondaire d'un réordonnancement.

Les modifications destructrices ou structurelles restent là où elles peuvent être vérifiées : `rebase db
generate` + `rebase db migrate`, ou `rebase db push` depuis un checkout ou une CI,
qui simule la modification à vide, refuse les modifications destructrices sans confirmation et
peut effectuer une sauvegarde au préalable.
:::

### Déploiements scindés

Une seule image et un seul bundle peuvent être démarrés plusieurs fois, chacun
desservant une partie différente du projet. Une ligne chacun ici, car cette page a pour but de
lister chaque variable ; ce que chaque combinaison *monte et possède* — et quelles
combinaisons refusent de démarrer — se trouve sur
**[Processus scindés](/docs/deployment/split-processes)**.

| Variable | Description | Valeur par défaut |
|----------|-------------|---------|
| `REBASE_ROLE` | Quelle partie ce processus sert : `all`, `api`, `functions` ou `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Remplacer le fait que *ce* processus exécute ou non les minuteurs cron. Si non défini, suit le rôle. | — |
| `REBASE_JOB_WORKERS` | Remplacer le fait que ce processus exécute ou non les workers de la file d'attente de jobs. Si non défini, suit le rôle. | — |
| `REBASE_FUNCTIONS_ONLY` | Servir uniquement les fonctions personnalisées spécifiées dans ce processus. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Servir toutes les fonctions personnalisées sauf celles spécifiées. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Où le processus API transfère une requête de fonction qu'il ne sert pas lui-même. | — |

### Surface MCP

Un endpoint Model Context Protocol optionnel à `/mcp`, afin qu'un client IA puisse lire
et écrire dans ce projet **en tant qu'utilisateur connecté**. Désactivé sauf indication contraire, et —
contrairement à toute autre surface — aucun `REBASE_ROLE` ne l'active : les autres décrivent une
configuration de processus, tandis que celle-ci est une décision de confier des identifiants à un logiciel tiers,
et elle doit être prise par une personne plutôt qu'héritée du
rôle d'un conteneur.

| Variable | Description | Valeur par défaut |
|----------|-------------|---------|
| `REBASE_MCP_ENABLED` | Monte la surface MCP. Requiert `REBASE_PUBLIC_URL` ; sans cela, la surface refuse de se monter et le signale dans le log de démarrage. | `false` |
| `REBASE_PUBLIC_URL` | Origine accessible de l'extérieur de ce déploiement, par exemple `https://app.example.com`. La surface MCP ne peut pas la déduire — extraire l'origine de l'en-tête `Host` ferait de l'identité de l'émetteur, et de l'audience par rapport à laquelle ses propres jetons sont vérifiés, une valeur fournie par l'appelant. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Autorise l'enregistrement dynamique de client OAuth (RFC 7591), afin qu'un client puisse s'inscrire lui-même. Définissez sur `false` pour exiger que les clients soient enregistrés à l'avance. | `true` |

### Sauvegardes

| Variable | Description | Valeur par défaut |
|----------|-------------|---------|
| `BACKUP_SCHEDULE` | Expression Cron pour les sauvegardes planifiées. Non défini signifie que les sauvegardes planifiées sont désactivées. | — |
| `BACKUP_DESTINATION` | Chemin local, ou une URL `s3://bucket/prefix` / `gs://bucket/prefix`. | `./backups` |
| `BACKUP_RETENTION_DAYS` | Supprimer les sauvegardes de plus de N jours. Non défini ou `0` conserve tout. | — |
| `BACKUP_KEEP_MINIMUM` | Conserver toujours au moins N sauvegardes parmi les plus récentes, quelle que soit la rétention. | — |
| `PG_DUMP_PATH` | Remplacer le binaire `pg_dump` — il doit correspondre à la version majeure du serveur. | — |
| `PG_RESTORE_PATH` | Remplacer le binaire `pg_restore`. | — |

Les sauvegardes contiennent des secrets et des données personnelles (PII). Utilisez une destination privée avec
chiffrement au repos.
| `PG_DUMPALL_PATH` | Emplacement de `pg_dumpall`, lorsqu'il n'est pas dans le `PATH`. Sans lui — et sans les outils clients PostgreSQL installés — une sauvegarde des globales échoue avec une erreur nommant cette variable. | — |

### Livraison de bundle

Un déploiement managé n'embarque pas son code dans l'image : le runtime récupère un
bundle au démarrage. Celles-ci déterminent lequel et comment.

| Variable | Description | Valeur par défaut |
|----------|-------------|---------|
| `REBASE_BUNDLE` | Chemin vers un répertoire de bundle déjà extrait. Ce que `rebase start` définit localement. | — |
| `REBASE_BUNDLE_URL` | Emplacement à partir duquel récupérer l'archive du bundle, lorsqu'il n'y en a pas en local. | — |
| `REBASE_BUNDLE_TOKEN` | Identifiant Bearer pour cette récupération. Traitez-le comme un secret : c'est ce qui autorise un tenant à télécharger son propre code. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Emplacement où un bundle récupéré est extrait. Doit être accessible en écriture et persister entre la récupération et le démarrage. | — |
| `REBASE_RUNTIME_MODULES` | Modules supplémentaires fournis par l'image de runtime au bundle, au-delà de ceux qu'il déclare lui-même. | — |

### Liaisons de ressources

Chaque base de données, bucket et topic déclaré par un projet dans `config/resources.ts` est
lié par des variables d'environnement nommées d'après celui-ci. Les noms de base sont indiqués ci-dessous ; une
ressource non définie par défaut ajoute `__` et sa clé en majuscules, ainsi un bucket appelé
`media` lit `S3_BUCKET__MEDIA`. `rebase status` affiche, par ressource,
la variable exacte qu'il lit et indique si elle est définie.

| Variable | Description | Valeur par défaut |
|----------|-------------|---------|
| `REBASE_DRIVER` | Le paquet npm implémentant le pilote d'une source de données, lorsqu'il ne s'agit pas de celui par défaut de Postgres. Suffixé par source : `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | La chaîne de connexion pour un topic déclaré. Suffixé par topic. | — |

### L'environnement propre au CLI

Lu par `rebase`, et non par le serveur. Rien ici n'affecte un déploiement.

| Variable | Description | Valeur par défaut |
|----------|-------------|---------|
| `REBASE_BASE_URL` | Le backend avec lequel `rebase auth` et `rebase api-keys` communiquent, au lieu de le déduire du projet. | — |
| `REBASE_PORT` | Le port que ces commandes supposent lors de la déduction de cette URL. | — |
| `SERVICE_KEY` | La clé de service avec laquelle elles s'authentifient, au lieu d'inviter à la saisir. | — |
| `REBASE_ENV_FILE_PATH` | Quel fichier `.env` le CLI lit et écrit, lorsqu'il ne s'agit pas de celui du projet. | — |
| `REBASE_CLOUD_URL` | Le plan de contrôle avec lequel `rebase cloud` communique. | — |
| `REBASE_CLOUD_EMAIL` | Le compte sous lequel `rebase cloud login` se connecte, au lieu d'inviter à le saisir. | — |
| `REBASE_CLOUD_PASSWORD` | Son mot de passe, afin qu'un gestionnaire de secrets puisse le transmettre sans qu'il n'apparaisse dans l'historique du shell. | — |
| `REBASE_DEBUG` | `1` affiche l'erreur sous-jacente et les détails de la requête au lieu du message court. La première chose à définir lorsqu'une commande `rebase cloud` échoue sans explication utile. | — |
| `REBASE_DEV_NO_DB` | `rebase dev` ne démarre aucune base de données et ne provisionne rien — vous fournissez la vôtre. Identique à `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fixe le port du serveur de dev frontend, que `rebase dev` déduit autrement du chemin du projet. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Durée pendant laquelle `rebase dev` attend que le backend se signale avant d'indiquer qu'il n'a pas démarré. `0` désactive le rapport. | `30000` |
| `DATABASE_PASSWORD` | Le mot de passe que `rebase dev --docker` insère dans la chaîne de connexion qu'il déduit de `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | La convention inter-outils. Définie sur toute valeur autre que `0`, le CLI n'envoie aucune télémétrie. | — |
| `REBASE_TELEMETRY_DISABLED` | La même chose, spécifiquement pour Rebase. Ne nécessite aucun fichier, c'est pourquoi c'est celle à utiliser en CI et dans une image. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Où la télémétrie est envoyée, pour un collecteur auto-hébergé. | — |

## Secrets en développement

`JWT_SECRET` et `REBASE_SERVICE_KEY` sont requis en production et générés
pour vous en dehors de celle-ci, afin que vous puissiez démarrer sans rien configurer.

Ces valeurs générées sont mises en cache dans `.rebase-dev-secrets.json`, aux côtés de
`.rebase-dev-port` et `.rebase-dev-url`, et ignorées par git avec ceux-ci. Auparavant, elles
étaient régénérées à chaque démarrage — redémarrer le serveur de dev vous déconnectait donc de
votre propre application et invalidait toute clé d'API que vous veniez de créer.

- Définissez l'une ou l'autre variable explicitement et la vôtre sera utilisée ; rien n'est mis en cache ni lu.
- Pointez le cache ailleurs avec `REBASE_DEV_SECRETS_FILE` — un chemin, et la
  seule variable de cette section que vous définiriez délibérément.
- Supprimez le fichier pour renouveler les deux secrets. Le prochain démarrage en écrira un nouveau.
- Si le fichier ne peut pas être écrit — un conteneur en lecture seule, par exemple —, le serveur démarre
  quand même avec un secret éphémère, exactement comme auparavant.

Rien n'est mis en cache en production, ni sous un exécuteur de tests. En production, un démarrage
qui devrait générer l'un ou l'autre secret échoue toujours en nommant la variable, et cela reste
inchangé :

```
JWT_SECRET must be explicitly set in production.
Do not rely on auto-generated secrets outside development.
```

## Objet de configuration du backend

Le `RebaseBackendConfig` transmis à `initializeRebaseBackend()` offre un contrôle programmatique :

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

### Modifier `basePath`

`basePath` déplace chaque route d'API, le client doit donc en être informé —
sinon, il continue de demander `/api/...` et obtient une erreur 404 pour tout :

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

Le panneau d'administration le récupère depuis le client qui lui est fourni ; rien d'autre n'a
besoin d'être configuré. Si vous construisez une URL de requête à la main, assemblez-la à partir du client plutôt
que d'écrire `/api` vous-même :

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Dépannage

### Erreur de permission refusée dans l'éditeur SQL (`permission denied for table <name>`)

* **Symptômes :** Les requêtes personnalisées exécutées dans l'éditeur SQL de Rebase Studio échouent avec `cause: error: permission denied for table <name>`, bien que la vue tableur du CMS charge les données avec succès.
* **Cause :** Par défaut, Rebase tente d'exécuter les requêtes de l'éditeur SQL en changeant temporairement de rôle de base de données pour correspondre au rôle applicatif de l'utilisateur actif (par ex. `SET LOCAL ROLE "admin"`). Si vous utilisez une authentification personnalisée où les rôles existent uniquement dans les tables de base de données plutôt que sous forme de véritables rôles PostgreSQL, le changement de rôle échoue ou les privilèges de base de données sont manquants. La vue tableur du CMS s'exécute sous l'utilisateur propriétaire de la connexion par défaut et contourne ce problème.
* **Solution :** Ajoutez `DISABLE_DB_ROLE_SWITCHING=true` à la configuration `.env` de votre backend. Cela force Rebase à exécuter les requêtes de l'éditeur SQL en utilisant les privilèges du propriétaire de la connexion (généralement un superutilisateur/propriétaire).

### Échec de la récupération du schéma dans l'éditeur SQL (`Cross-database execution requires adminConnectionString`)

* **Symptômes :** Studio ne parvient pas à charger l'arborescence du schéma, ou l'éditeur SQL renvoie `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Cause :** Rebase requiert des privilèges d'administrateur pour interroger les catalogues système de la base de données et exécuter des commandes d'administration. Si `adminConnectionString` n'est pas fourni au bootstrapper, ou si `getAdmin()` est surchargé pour renvoyer `undefined`, ces opérations échouent.
* **Solution :** Assurez-vous que `adminConnectionString` est configuré lors de l'initialisation du bootstrapper du backend :
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Prochaines étapes

- **[Déploiement](/docs/getting-started/deployment)** — Guide de déploiement en production
- **[Vue d'ensemble du backend](/docs/backend)** — Référence complète de la configuration du backend

---
