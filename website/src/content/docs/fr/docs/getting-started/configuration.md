---
sourceHash: 11b34d6efd4ef32e
title: Environnement et configuration
sidebar_label: Configuration
description: Toutes les variables d'environnement et options de configuration pour les projets Rebase.
---

## Variables d'environnement

Toute la configuration s'effectue via des variables d'environnement dans votre fichier `.env` à la racine du projet.

> **Important** : Rebase valide les variables d'environnement avec **Zod** au démarrage. Si
> un élément requis est manquant ou mal formé (une URL qui n'est pas une URL, un port qui
> n'est pas un nombre), le serveur refuse de démarrer et indique le nom de la variable.
>
> L'emplacement du schéma dépend de la manière dont vous exécutez le backend. Un projet démarré par
> le runtime — `rebase dev`, `rebase start`, l'image publiée — utilise le
> schéma détenu par le runtime (`loadBootEnv` dans `@rebasepro/server`), qui est l'union
> de chaque tableau ci-dessous. Un projet ayant exécuté [`rebase eject`](/docs/cli)
> possède un fichier `backend/src/env.ts` appelant `loadEnv({ extend })`, et peut y ajouter ses
> propres variables typées.

### Requises

| Variable | Description | Exemple |
|----------|-------------|---------|
| `DATABASE_URL` | Chaîne de connexion PostgreSQL. **Optionnelle en développement** — si non définie, `rebase dev` exécute un PostgreSQL géré pour le projet, avec ses données sous `.rebase/`. Requise partout ailleurs. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Clé secrète pour signer les jetons JWT. Utilisez une chaîne aléatoire robuste (min. 32 caractères). **Requise en production** (générée automatiquement en développement). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` est une syntaxe propre à node-postgres, pas à libpq.**
>
> Rebase et le pilote Node l'acceptent — chiffrent, mais ne vérifient pas le
> certificat. `psql`, `pg_dump`, `pg_restore` et Atlas ne l'acceptent pas, et ils ne
> se dégradent pas : ils refusent de démarrer avec `invalid sslmode value: "no-verify"`.
>
> Les commandes propres à Rebase (`rebase db push`, `rebase db backup`, `rebase db
> restore`) la réécrivent en son équivalent `sslmode=require` avant d'exécuter la commande shell,
> afin qu'elles fonctionnent avec l'URL telle que configurée. L'utilisation manuelle de `psql` ne le fait
> pas — remplacez-la par `sslmode=require`, qui chiffre sans vérifier exactement de la
> même manière.

### Frontend

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `VITE_API_URL` | URL de l'API backend pour le SDK client. **À définir en développement uniquement** — voir ci-dessous. | origine de la page |
| `VITE_GOOGLE_CLIENT_ID` | ID client Google OAuth. Active « Se connecter avec Google ». | — |


> **Laissez `VITE_API_URL` non définie dans les builds de production.**
>
> En développement, le frontend et le backend ont des origines distinctes, le serveur
> de dev injecte donc ceci. En production, le backend Rebase sert la SPA, l'API
> correspond donc à la propre origine de la page et le client la résout ainsi de lui-même.
>
> Intégrer en dur une URL absolue dans un bundle de production fonctionne jusqu'à ce qu'un second
> nom d'hôte pointe vers la même application : un domaine personnalisé charge alors la page depuis
> `example.com` et appelle l'API sur `example.rebase.website`, ce qui est
> cross-origin, faisant échouer chaque requête au preflight. Autoriser l'origine dans CORS
> ne résout **pas** le problème non plus — le cookie de rafraîchissement est en `SameSite=Lax` et n'est
> pas envoyé cross-site, vous supprimeriez donc les erreurs de console tout en ayant une
> authentification cassée. Non définie, chaque domaine pointant vers l'application fonctionne sans aucune
> configuration CORS.

### Backend

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `PORT` | Port pour le serveur HTTP backend. Lu par `rebase start`. `rebase dev` le lit **uniquement depuis l'environnement shell** — un `PORT` dans `.env` n'y est pas lu, car le port est résolu avant le chargement de ce fichier — et lie sinon un port dérivé du chemin du projet, afin que plusieurs projets puissent s'exécuter en même temps. `rebase dev --port` a la priorité sur les deux, et la bannière de démarrage indique le palier utilisé. | `3001` |
| `LOG_LEVEL` | Niveau de verbosité des journaux : `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Affiche le SQL derrière une ligne `Failed query: [redacted]`. Chaque instruction en échec est caviardée par défaut, car une requête échouée transporte ses paramètres liés — un e-mail, un hash de mot de passe. Définissez-le sur `true` lors du diagnostic d'un échec DDL, RLS ou de capture de changements. Ignoré lorsque `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Environnement : `development`, `production` ou `test` | `development` |
| `CORS_ORIGINS` | Liste d'origines autorisées séparées par des virgules. **Requis en production** si différent du domaine du backend. En développement, il est *ajouté à* localhost — voir ci-dessous. | — |
| `FRONTEND_URL` | URL de l'application frontend. Utilisé comme alternative à CORS_ORIGINS, dans les deux environnements. | — |
| `ADMIN_CONNECTION_STRING` | Chaîne de connexion à la base de données de niveau administrateur (utilisée pour l'introspection de schéma et les opérations d'administration). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Désactive le changement de rôle PostgreSQL dans l'éditeur SQL (utile pour l'authentification personnalisée où les rôles de base de données ne sont pas mappés). | `false` |

#### CORS en développement

Le développement autorise **localhost, ainsi que tout ce que `CORS_ORIGINS` (ou `FRONTEND_URL`)
mentionne** — la même liste que la production utilise, avec localhost ajouté plutôt que
remplacé. La variable fonctionne donc de la même manière dans les deux environnements, et les
cas qui en ont besoin en développement sont les cas ordinaires :

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Une origine qui n'est ni localhost ni répertoriée est refusée, et le refus est
journalisé **une fois par origine** avec la ligne exacte qui permettrait de l'autoriser. Refuser
n'est pas une précaution gratuite : l'API envoie des identifiants (credentials), donc refléter un
`Origin` arbitraire permettrait à n'importe quel site visité par le développeur d'effectuer des
requêtes authentifiées contre le serveur de dev avec sa session et d'en lire les
réponses.

### Authentification

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `JWT_SECRET` | Secret pour la signature JWT (requis en production, généré automatiquement en développement) | — |
| `JWT_PRIVATE_KEY` | Clé privée PEM pour signer les jetons d'accès de manière asymétrique (RS256), afin que toute entité détenant le JWKS puisse vérifier une session sans pouvoir en forger une. Accepte un PEM avec de vrais sauts de ligne, un PEM avec des échappements `\n`, ou l'encodage base64 de l'ensemble du PEM. Sans cela, les jetons restent en HS256. | — |
| `JWT_KEY_ID` | Nomme la clé `JWT_PRIVATE_KEY` dans l'en-tête du jeton et dans le JWKS. Modifiez-le chaque fois que la clé change — la rotation dépend de la possibilité de distinguer l'ancienne clé de la nouvelle. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Durée de vie du jeton d'accès | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Durée de vie du jeton de rafraîchissement. Glissante — chaque rotation la renouvelle, ce paramètre régit donc la durée de survie d'une session face à l'**inactivité**. | `400d` |
| `ALLOW_REGISTRATION` | Autoriser les nouveaux utilisateurs à s'inscrire (`true`/`false`). Hors production, le **premier** utilisateur peut toujours s'inscrire, quelle que soit cette valeur — une table d'utilisateurs vide doit admettre quelqu'un, et ce quelqu'un devient l'administrateur. En production (`NODE_ENV=production`), cette fenêtre est fermée : une table vide refuse l'inscription d'amorçage avec `SETUP_REQUIRED`, un premier compte créé via l'inscription ouverte est un compte ordinaire, et l'administrateur est désigné avec `REBASE_ADMIN_EMAIL` ci-dessous ou assigné avec la clé de service. Le fichier `.env.example` du scaffold le définit sur `true` ; la valeur par défaut du framework est désactivée. | `false` |
| `DISABLE_SELF_REGISTRATION` | Coupe-circuit. Ferme la fenêtre d'amorçage du premier utilisateur que `ALLOW_REGISTRATION=false` laisse délibérément ouverte hors production, de sorte que l'inscription est fermée même face à une base de données vide. À associer avec `REBASE_ADMIN_EMAIL` ci-dessous, sinon le déploiement n'a aucun moyen de produire son premier appelant connecté. Chaque artefact de déploiement livré le définit. | — |
| `REBASE_ADMIN_EMAIL` | Adresse e-mail du premier compte administrateur, créé au démarrage **tant que la table des utilisateurs est encore vide** et jamais par la suite. C'est ainsi qu'un déploiement de production obtient son administrateur : l'opérateur désigne le premier compte au lieu d'entrer en concurrence avec Internet. Le démarrage émet un avertissement lorsque la table est vide en production et que cette variable n'est pas définie. | — |
| `REBASE_ADMIN_PASSWORD` | Mot de passe de ce compte. Au moins 12 caractères, sinon il est refusé et le compte n'est pas créé. Modifiez-le après la première connexion. | — |
| `MFA_ENCRYPTION_KEY` | Chiffre chaque secret TOTP stocké. Si non défini, les secrets sont chiffrés avec `JWT_SECRET` à la place et le démarrage émet un avertissement — faire tourner `JWT_SECRET` déconnecte donc tout le monde *et* rend chaque authentificateur configuré indéchiffrable. Définissez une clé dédiée (32+ caractères aléatoires) avant que quiconque ne s'enrôle. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | La clé depuis laquelle s'effectue la rotation. Définissez les deux lors d'une rotation : les nouveaux secrets sont écrits avec `MFA_ENCRYPTION_KEY` et les existants restent lisibles, afin que personne ne soit exclu de son propre compte au milieu d'une rotation. Supprimez-la une fois que chaque secret a été rechiffré. | — |
| `ALLOW_ANONYMOUS` | Active la connexion anonyme (`POST /api/auth/anonymous`). Optionnel (opt-in), et délibérément non conditionné par `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Exiger une authentification pour l'API de données. Définissez sur `false` pour une surface de lecture entièrement publique — le RLS s'applique toujours. | `true` |
| `AUTH_DEFAULT_ROLE` | Rôle assigné à un utilisateur nouvellement inscrit lorsqu'aucun rôle n'est spécifié. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Monte `POST /api/auth/find-user`, qui résout un e-mail en un profil public minimal (`uid`, `displayName`, `photoURL`) pour les flux d'invitation par e-mail. Appelants authentifiés uniquement, et ne renvoie jamais l'e-mail, les rôles ou les métadonnées de l'utilisateur trouvé. Désactivé par défaut : il s'agit d'une surface d'énumération. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` sur le cookie de rafraîchissement : `Strict`, `Lax` ou `None`. `None` nécessite HTTPS et est uniquement destiné à un frontend réellement cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure` sur le cookie de rafraîchissement. Sécurisé par défaut ; `AUTH_COOKIE_SECURE=false` pour le http simple — un déploiement sur une adresse LAN où le navigateur rejetterait sinon le cookie et où la session mourrait à l'expiration du jeton d'accès sans erreur. Un avertissement est émis au démarrage. `http://localhost` n'en a pas besoin. | `true` |
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
| `GITLAB_CLIENT_ID` | ID client GitLab OAuth. Le `baseUrl` d'une instance auto-hébergée n'a pas de syntaxe d'environnement — configurez GitLab dans le bloc `auth` pour cela. | — |
| `GITLAB_CLIENT_SECRET` | Secret client GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | ID client Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Secret client Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | ID client Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Secret client Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | ID client Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Secret client Spotify OAuth | — |
| `APPLE_CLIENT_ID` | Services ID Apple. Apple n'a pas de secret client statique — Rebase signe un JWT ES256 à courte durée de vie par échange de jetons — il a donc besoin des quatre valeurs `APPLE_*` et ne configure rien sans elles. | — |
| `APPLE_TEAM_ID` | Team ID Développeur Apple, l'émetteur du JWT. | — |
| `APPLE_KEY_ID` | ID de clé de la clé privée enregistrée auprès d'Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenu du fichier de clé privée `.p8`, avec tous ses sauts de ligne (les échappements `\n` sont acceptés). | — |
| `REBASE_SERVICE_KEY` | Clé d'API administrateur statique. Contourne l'authentification JWT normale pour les appels de serveur à serveur lorsqu'elle est transmise sous la forme `Authorization: Bearer <clé>`. (Générée automatiquement en développement). | — |
| `REBASE_RATE_LIMIT_STORE` | Emplacement des compteurs de limitation de débit d'authentification : `memory` (par processus) ou `sql` (partagé entre les réplicas). Un processus ne peut pas voir son propre nombre de réplicas, donc un déploiement avec des pairs doit le spécifier — trois réplicas sur la valeur par défaut appliquent trois fois la limite. Toute autre valeur **refuse de démarrer** plutôt que de se rabattre, y compris `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Monte le flux de lien de connexion sans mot de passe. Nécessite un service d'e-mail configuré, sinon le lien n'a nulle part où aller. | `false` |
| `AUTH_EMAIL_OTP` | Monte la connexion sans mot de passe avec un code à six chiffres envoyé par e-mail. Même exigence d'e-mail que ci-dessus. | `false` |
| `CAPTCHA_PROVIDER` | Active la vérification par captcha sur les routes d'authentification : `turnstile` ou `hcaptcha`. Non défini signifie aucun captcha. | — |
| `CAPTCHA_SECRET` | Le secret du fournisseur, utilisé côté serveur pour vérifier le jeton envoyé par le navigateur. Requis une fois que `CAPTCHA_PROVIDER` est défini. | — |
| `CAPTCHA_ROUTES` | Routes d'authentification à protéger, séparées par des virgules (par exemple `register,login`). Non défini protège l'ensemble par défaut du fournisseur. | — |

### Stockage

:::caution[Le stockage ne dispose pas de sécurité au niveau des lignes, il nécessite donc un modèle d'accès]
Les collections sont protégées par le RLS de Postgres. Le stockage d'objets n'a pas d'équivalent —
les clés partagent un espace de noms plat unique — donc avec un bucket configuré et aucun modèle d'accès,
le serveur **refuse de démarrer en production**. Répondez à cette exigence avec exactement l'une des solutions suivantes :
un hook `storageAuthorize` exporté depuis `config/index.ts` (ce que fournit le scaffold),
`STORAGE_PUBLIC_READ`, ou `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `STORAGE_TYPE` | Backend de stockage : `local`, `s3` ou `gcs`. En production, `local` désactive le stockage à moins que `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Chemin de base pour le stockage local | `./uploads` |
| `FORCE_LOCAL_STORAGE` | Autoriser le stockage local en production — uniquement avec un volume persistant monté à l'emplacement `STORAGE_PATH` | `false` |
| `S3_BUCKET` | Nom du bucket S3 (lorsque `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Région AWS | — |
| `S3_ACCESS_KEY_ID` | Clé d'accès AWS | — |
| `S3_SECRET_ACCESS_KEY` | Clé secrète AWS | — |
| `S3_ENDPOINT` | Point de terminaison S3 personnalisé (pour MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Forcer les URL de style chemin (path-style) pour le bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nom du bucket GCS (lorsque `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Projet GCP. Généralement déduit des identifiants. | — |
| `GCS_KEY_FILENAME` | Chemin vers un fichier de clé de compte de service. À omettre sur GCP, où Workload Identity fournit les identifiants. | — |
| `STORAGE_PUBLIC_READ` | Servir chaque objet à n'importe qui, sans jeton. Uniquement pour un bucket qui fait réellement office de CDN public. L'un des trois moyens de satisfaire le garde-fou de démarrage ci-dessous. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permettre à tout appelant connecté de lire, écrire, lister et supprimer chaque objet. Nommé `INSECURE` dans l'objet de configuration pour une raison : il n'est défendable que dans une application à locataire unique (single-tenant) où chaque compte a accès à tous les fichiers de manière sécurisée. | `false` |
| `STORAGE_RENDITION_CACHE` | Mettre en cache les rendus d'images générés (redimensionnements, conversions de format) au lieu de les produire à chaque requête. | `false` |

### E-mail (Optionnel)

| Variable | Description |
|----------|-------------|
| `SMTP_HOST` | Hôte du serveur SMTP |
| `SMTP_PORT` | Port du serveur SMTP |
| `SMTP_SECURE` | Activer la connexion sécurisée (`true`/`false`) |
| `SMTP_USER` | Nom d'utilisateur SMTP |
| `SMTP_PASS` | Mot de passe SMTP |
| `SMTP_FROM` | Adresse d'expéditeur pour les e-mails système |
| `SMTP_NAME` | Nom d'affichage sur l'adresse de l'expéditeur |
| `APP_NAME` | Nom du produit utilisé dans les objets et corps d'e-mails (par défaut : `Rebase`) |
| `EMAIL_LOGO_URL` | Logo affiché au-dessus des modèles d'e-mails par défaut. URL PNG ou JPG absolue en `http(s)` — les clients suppriment les SVG et bloquent les URI `data:`. Si non défini, une application toujours nommée `Rebase` reçoit le logo Rebase et une application renommée n'en reçoit aucun |

### Pool de connexions à la base de données

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `DB_POOL_MAX` | Nombre maximal de connexions dans le pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Millisecondes pendant lesquelles une connexion inactive est conservée | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Millisecondes d'attente pour une connexion | `10000` |
| `DATABASE_DIRECT_URL` | Connexion directe (hors pool). Le [Temps réel](/docs/backend/realtime) en a besoin : `LISTEN`/`NOTIFY` ne survit pas à un gestionnaire de pool transactionnel tel que PgBouncer, et sans cela les notifications de modifications sont désactivées avec un avertissement plutôt que d'être perdues silencieusement. | — |
| `DATABASE_READ_URL` | Réplica de lecture. Les lectures s'y dirigent lorsqu'il est défini et diffère de `DATABASE_URL` ; si la connexion échoue, tout bascule sur le primaire avec un avertissement. | — |
| `REBASE_DB_POOL_MAX` | Un plafond sur chaque pool dans le processus, appliqué quelle que soit la demande de chacun. Chiffres bruts uniquement : une valeur mal formée est ignorée plutôt que de sérialiser silencieusement le serveur. | — |

### Comportement du runtime

Lu par le runtime — `rebase dev`, `rebase start` et l'image serveur publiée.
Un projet éjecté prend ces décisions dans son propre code à la place.

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `REBASE_RLS_AUDIT` | Exécute l'audit de sécurité au niveau des lignes au démarrage et monte son point de terminaison, qui signale les tables servies sans politiques. | — |
| `REBASE_BASE_PATH` | Chemin de base pour chaque route d'API. Le client doit être informé de la même valeur — voir [Modifier `basePath`](#modifier-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Sert les ressources statiques/administratives du bundle depuis ce processus. Désactivez-le lorsqu'un CDN est placé devant. | `true` |
| `REBASE_HISTORY` | Enregistre l'[historique des modifications d'entités](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Compression gzip/brotli des réponses. | `true` |
| `REBASE_MAX_BODY_SIZE` | Taille maximale du corps de la requête, **en octets** (`10485760`, et non `10MB` — une valeur qui n'est pas un nombre refuse de démarrer plutôt que de supprimer silencieusement la limite). | — |
| `REBASE_ENABLE_SWAGGER` | La surface OpenAPI. À trois états : non défini signifie actif en développement, inactif en production ; `false` désactive les deux partout. Notez que `true` en production sert la **spécification** sur `/api/docs` mais pas l'**interface utilisateur** Swagger sur `/api/swagger` — l'UI est conditionnée séparément par `NODE_ENV`. | — |
| `REBASE_METRICS` | Expose les métriques Prometheus sur `/metrics`. | `false` |
| `REBASE_METRICS_TOKEN` | Jeton Bearer protégeant `/metrics`. Si non défini, laisse le point de terminaison ouvert à tout ce qui peut atteindre le port — acceptable sur un réseau privé, non acceptable sur un réseau public, et les journaux de démarrage le signalent. | — |
| `REBASE_MIGRATE_ON_BOOT` | Ce que le runtime peut faire au schéma au démarrage. `ensure` (la valeur par défaut, partout — production comprise) exécute la passe **additive** : créer les tables, colonnes et types enum manquants, ne jamais supprimer ni réécrire quoi que ce soit. `none` ne touche à rien. L'image publiée n'accepte que ces deux valeurs et **refuse de démarrer avec `push`**. Dans un [déploiement scindé](/docs/deployment/split-processes), exactement un processus peut provisionner, de sorte que chaque autre rôle doit définir `none` sous peine de refuser de démarrer. | `ensure` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Refuse de démarrer lorsque la base de données a été provisionnée pour la dernière fois à partir d'un ensemble de collections différent de celui à partir duquel ce processus a été compilé. Non défini (ou toute valeur autre que `true`/`1`) émet un avertissement à la place. | warn |
| `REALTIME_CDC` | Capture de données modifiées (CDC) au niveau de la base de données : `auto` (activé si la connexion le prend en charge, repli silencieux sinon), `trigger` (le force, avertit si impossible), `wal` (se dégrade en `trigger` aujourd'hui), `off`. Voir [Temps réel](/docs/backend/realtime#database-level-change-capture-cdc). | `auto` |
| `REALTIME_CHANNEL_BUS` | Transport inter-instances pour les canaux de diffusion et la présence : `memory` ou `postgres`. Ignoré lorsque `realtime.bus` a reçu un transport construit. | `memory` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Autorise les valeurs `localhost`/bouclage sous `NODE_ENV=production`. Désactivé, de sorte qu'un démarrage en production échoue bruyamment plutôt que de se connecter à une base de données inexistante. | `false` |
| `REBASE_STRICT_COLLECTION_CONFIG` | Ce que le démarrage fait avec une clé dans vos collections que cette version ne lit pas : `warn`, `error` (refuse de démarrer — utile à activer en CI), ou `off`. Ne régit que les clés qu'il ne *reconnaît* pas, qui sont généralement une faute de frappe et parfois des métadonnées délibérées ; une clé qu'il sait avoir été déplacée est toujours fatale, car la fonctionnalité configurée est sinon silencieusement absente. | `warn` |
| `REBASE_PROVISION_ONLY` | `1`/`true` exécute la passe de schéma et se termine sans ouvrir de socket — la forme attendue par un Job de migration, à partir de la même image et du même bundle que le serveur qui le suit. Une valeur vide est considérée comme *non définie*, de sorte qu'un `${SOMETHING}` non substitué dans un fichier compose ne peut pas transformer un déploiement ordinaire en un déploiement qui migre et refuse de servir. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permet à une machine — un agent, un job CI — d'*appliquer* une modification de schéma via `/api/admin/schema`, et pas seulement d'en planifier une. Désactivé sauf sur demande explicite : l'identifiant qui permettrait une telle modification est le plus susceptible de se trouver dans une variable de CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Durée maximale pendant laquelle une fonction personnalisée peut s'exécuter avant que sa requête ne soit interrompue. Même paramètre que l'option `functionsTimeoutMs`. | — |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` fait en sorte qu'un rejet de promesse non géré termine le processus au lieu de le consigner. À activer sous un orchestrateur qui effectuera un redémarrage ; à désactiver lorsqu'un redémarrage est pire qu'une fuite. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Maintient le planificateur cron en cours d'exécution sur une plateforme que le runtime détecte sinon comme réduisant à zéro (scale-to-zero), où un minuteur qui se déclenche dans une instance inactive se déclenche dans le vide. | — |
| `TRUSTED_PROXY_HOPS` | Nombre de proxys placés devant ce serveur, afin que le limiteur de débit puisse lire la véritable adresse client depuis `X-Forwarded-For`. Valeur par défaut à sécurité intégrée `0` : sans proxy, faire confiance à l'en-tête permettrait à tout appelant de falsifier une identité. | `0` |

:::note[Le provisionnement au démarrage est additif et n'est pas un outil de migration]
La passe de démarrage s'exécute sans surveillance et sans personne pour relire un diff ; elle ne
supprimera donc jamais une colonne, ne réduira pas un type et ne réécrira pas une table. C'est
également la raison pour laquelle l'image refuse `REBASE_MIGRATE_ON_BOOT=push` : un push complet
calcule un diff et exécutera volontiers `DROP COLUMN`, or le redémarrage d'un conteneur ne doit jamais
pouvoir détruire une colonne de production comme effet secondaire d'un réordonnancement.

Les modifications destructives ou structurelles restent là où elles peuvent être examinées :
`rebase db generate` + `rebase db migrate`, ou `rebase db push` depuis un clone local ou la CI,
qui effectue une simulation des changements, refuse les opérations destructives sans confirmation,
et peut d'abord effectuer une sauvegarde.
:::

### Déploiements scindés

Une même image et un même bundle peuvent être démarrés plusieurs fois, chacun
desservant une partie différente du projet. Une ligne pour chacun ici, car cette
page a pour vocation de lister chaque variable ; ce que chaque combinaison *monte et possède* —
et quelles combinaisons refusent de démarrer — se trouve sur
**[Processus scindés](/docs/deployment/split-processes)**.

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `REBASE_ROLE` | Quelle partie ce processus dessert : `all`, `api`, `functions` ou `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Remplace la décision de savoir si *ce* processus exécute les minuteurs cron. Si non défini, suit le rôle. | — |
| `REBASE_JOB_WORKERS` | Remplace la décision de savoir si ce processus exécute les workers de file d'attente de jobs. Si non défini, suit le rôle. | — |
| `REBASE_FUNCTIONS_ONLY` | Ne sert que les fonctions personnalisées spécifiées dans ce processus. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Sert toutes les fonctions personnalisées sauf celles spécifiées. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Où le processus API transfère une requête de fonction qu'il ne sert pas lui-même. | — |

### Surface MCP

Un point de terminaison Model Context Protocol optionnel sur `/mcp`, afin qu'un client IA
puisse lire et écrire sur ce projet **en tant qu'utilisateur connecté**. Désactivé sauf si configuré,
et — contrairement à toute autre surface — aucun `REBASE_ROLE` ne l'active : les autres décrivent
la forme d'un processus, tandis que celui-ci relève d'une décision de confier des identifiants
à un logiciel tiers, qui doit être prise par une personne plutôt qu'héritée du rôle d'un conteneur.

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `REBASE_MCP_ENABLED` | Monte la surface MCP. Nécessite `REBASE_PUBLIC_URL` ; sans elle, la surface refuse de monter et l'indique dans le journal de démarrage. | `false` |
| `REBASE_PUBLIC_URL` | Origine accessible de l'extérieur de ce déploiement, par exemple `https://app.example.com`. La surface MCP ne peut pas la déduire — extraire l'origine de l'en-tête `Host` ferait de l'identité de l'émetteur, et de l'audience par rapport à laquelle ses propres jetons sont vérifiés, une valeur fournie par l'appelant. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Autorise l'enregistrement dynamique des clients OAuth (RFC 7591), afin qu'un client puisse s'enregistrer lui-même. Définissez sur `false` pour exiger que les clients soient enregistrés à l'avance. | `true` |

### Sauvegardes

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `BACKUP_SCHEDULE` | Expression cron pour les sauvegardes planifiées. Non défini signifie que les sauvegardes planifiées sont désactivées. | — |
| `BACKUP_DESTINATION` | Chemin local, ou une URL `s3://bucket/prefix` / `gs://bucket/prefix`. | `./backups` |
| `BACKUP_RETENTION_DAYS` | Supprime les sauvegardes datant de plus de N jours. Non défini ou `0` conserve tout. | — |
| `BACKUP_KEEP_MINIMUM` | Conserve toujours au moins N sauvegardes parmi les plus récentes, indépendamment de la rétention. | — |
| `PG_DUMP_PATH` | Remplace le binaire `pg_dump` — il doit correspondre à la version majeure du serveur. | — |
| `PG_RESTORE_PATH` | Remplace le binaire `pg_restore`. | — |

Les sauvegardes contiennent des secrets et des données personnelles identifiables (PII). Utilisez une destination privée avec chiffrement au repos.
| `PG_DUMPALL_PATH` | Emplacement de `pg_dumpall`, lorsqu'il n'est pas dans le `PATH`. Sans lui — et sans les outils clients PostgreSQL installés — une sauvegarde des données globales échoue avec une erreur mentionnant cette variable. | — |

### Distribution de bundle

Un déploiement géré ne transporte pas son code dans l'image : le runtime récupère un
bundle au démarrage. Ces variables déterminent lequel et comment.

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `REBASE_BUNDLE` | Chemin vers un répertoire de bundle déjà extrait. Ce que `rebase start` définit localement. | — |
| `REBASE_BUNDLE_URL` | Emplacement d'où récupérer l'archive du bundle, lorsqu'il n'y en a pas localement. | — |
| `REBASE_BUNDLE_TOKEN` | L'identifiant Bearer pour cette récupération. Traitez-le comme un secret : c'est ce qui autorise un locataire à télécharger son propre code. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Emplacement où un bundle récupéré est extrait. Doit être accessible en écriture et doit persister entre la récupération et le démarrage. | — |
| `REBASE_RUNTIME_MODULES` | Modules supplémentaires que l'image de runtime fournit au bundle, au-delà de ceux qu'elle déclare elle-même. | — |

### Liaisons de ressources

Chaque base de données, bucket et topic déclaré par un projet dans `config/resources.ts`
est lié par des variables d'environnement nommées d'après lui. Les noms de base figurent ci-dessous ;
une ressource non définie par défaut ajoute `__` et sa clé en majuscules, de sorte qu'un bucket nommé
`media` lit `S3_BUCKET__MEDIA`. `rebase status`
affiche, par ressource,
la variable exacte qu'il lit et si elle est définie.

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `REBASE_DRIVER` | Le package npm implémentant le pilote d'une source de données, lorsqu'il ne s'agit pas de celui par défaut de Postgres. Suffixé par source : `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | La chaîne de connexion pour un topic déclaré. Suffixé par topic. | — |

### L'environnement propre au CLI

Lu par `rebase`, et non par le serveur. Rien ici n'affecte un déploiement.

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `REBASE_BASE_URL` | Le backend avec lequel `rebase auth` et `rebase api-keys` communiquent, au lieu de le déduire du projet. | — |
| `REBASE_PORT` | Le port que ces commandes supposent lors de la déduction de cette URL. | — |
| `SERVICE_KEY` | La clé de service avec laquelle elles s'authentifient, au lieu de la demander via une invite. | — |
| `REBASE_ENV_FILE_PATH` | Le fichier `.env` que le CLI lit et écrit, lorsqu'il ne s'agit pas de celui du projet. | — |
| `REBASE_CLOUD_URL` | Le plan de contrôle avec lequel `rebase cloud` communique. | — |
| `REBASE_CLOUD_EMAIL` | Le compte sous lequel `rebase cloud login` se connecte, au lieu d'afficher une invite. | — |
| `REBASE_CLOUD_PASSWORD` | Son mot de passe, afin qu'un gestionnaire de secrets puisse le transmettre sans qu'il n'atteigne l'historique du shell. | — |
| `REBASE_DEBUG` | `1` affiche l'erreur sous-jacente et les détails de la requête au lieu du message court. La première chose à définir lorsqu'une commande `rebase cloud` échoue sans fournir d'aide. | — |
| `REBASE_DEV_NO_DB` | `rebase dev` ne démarre aucune base de données et ne provisionne rien — vous fournissez la vôtre. Identique à `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fixe le port du serveur de développement frontend, que `rebase dev` déduit autrement du chemin du projet. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Durée pendant laquelle `rebase dev` attend que le backend s'annonce avant de signaler qu'il n'a pas démarré. `0` désactive le rapport. | `30000` |
| `DATABASE_PASSWORD` | Le mot de passe que `rebase dev --docker` insère dans la chaîne de connexion qu'il déduit de `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | La convention inter-outils. Définissez sur toute valeur autre que `0` et le CLI n'envoie aucune télémétrie. | — |
| `REBASE_TELEMETRY_DISABLED` | La même chose, spécifiquement pour Rebase. Ne nécessite aucun fichier, c'est pourquoi il est recommandé de l'utiliser en CI et dans une image. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Emplacement où la télémétrie est envoyée, pour un collecteur auto-hébergé. | — |

## Secrets en développement

`JWT_SECRET` et `REBASE_SERVICE_KEY` sont requis en production et générés
pour vous en dehors de celle-ci, afin que vous puissiez démarrer sans rien configurer.

Ces valeurs générées sont mises en cache dans `.rebase-dev-secrets.json`, aux côtés de
`.rebase-dev-port` et `.rebase-dev-url` et ignorées par git avec eux. Auparavant, elles
étaient régénérées à chaque démarrage — redémarrer le serveur de développement vous déconnectait
donc de votre propre application et invalidait toute clé d'API que vous veniez de créer.

- Définissez l'une ou l'autre variable explicitement et la vôtre sera utilisée ; rien n'est mis en cache ni lu.
- Pointez le cache ailleurs avec `REBASE_DEV_SECRETS_FILE` — un chemin, et la
  seule variable de cette section que vous définiriez délibérément.
- Supprimez le fichier pour renouveler les deux secrets. Le prochain démarrage en écrira un nouveau.
- Si le fichier ne peut pas être écrit — un conteneur en lecture seule, par exemple — le serveur démarre
  quand même avec un secret éphémère, exactement comme auparavant.

Rien n'est mis en cache en production, ni sous un exécuteur de tests. En production, un démarrage
qui devrait générer l'un ou l'autre secret échoue toujours en indiquant le nom de la variable, et cela
reste inchangé :

```
JWT_SECRET must be explicitly set in production.
Do not rely on auto-generated secrets outside development.
```

## Objet de configuration backend

Le `RebaseBackendConfig` passé à `initializeRebaseBackend()` fournit un contrôle programmatique :

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

`basePath` déplace chaque route d'API, le client doit donc être configuré de la même manière —
sinon, il continue de demander `/api/...` et reçoit un code 404 pour chaque requête :

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

Le panneau d'administration récupère ceci à partir du client qui lui est fourni ; rien d'autre n'a besoin
d'être configuré. Si vous construisez une URL de requête manuellement, concaténez-la à partir du client plutôt
que d'écrire `/api` vous-même :

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Dépannage

### Permission refusée dans l'éditeur SQL (`permission denied for table <name>`)

* **Symptômes :** Les requêtes personnalisées exécutées dans l'éditeur SQL de Rebase Studio échouent avec `cause: error: permission denied for table <name>`, même si la vue feuille de calcul du CMS charge les données avec succès.
* **Cause :** Par défaut, Rebase tente d'exécuter les requêtes de l'éditeur SQL en basculant temporairement de rôle de base de données pour correspondre au rôle applicatif de l'utilisateur actif (par exemple, `SET LOCAL ROLE "admin"`). Si vous utilisez une authentification personnalisée où les rôles existent uniquement dans les tables de la base de données plutôt que sous forme de véritables rôles PostgreSQL, le changement de rôle échoue ou les privilèges de base de données sont manquants. La vue feuille de calcul du CMS s'exécute sous l'utilisateur propriétaire de la connexion par défaut et contourne ce mécanisme.
* **Solution :** Ajoutez `DISABLE_DB_ROLE_SWITCHING=true` à la configuration `.env` de votre backend. Cela force Rebase à exécuter les requêtes de l'éditeur SQL en utilisant les privilèges du propriétaire de la connexion (généralement un superutilisateur/propriétaire).

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
- **[Présentation du backend](/docs/backend)** — Référence complète de la configuration du backend
