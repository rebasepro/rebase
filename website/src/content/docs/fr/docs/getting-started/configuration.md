---
sourceHash: f6312cfcb6187cea
title: Environnement et Configuration
sidebar_label: Configuration
description: Toutes les variables d'environnement et options de configuration pour les projets Rebase.
---

## Variables d'environnement

Toute la configuration est effectuée via des variables d'environnement dans votre fichier `.env` à la racine du projet.

> **Important** : Rebase valide les variables d'environnement avec **Zod** au
> démarrage. S'il manque quelque chose d'obligatoire ou qu'une valeur est mal
> formée (une URL qui n'en est pas une, un port qui n'est pas un nombre), le
> serveur refuse de démarrer et nomme la variable.
>
> L'emplacement du schéma dépend de la façon dont vous exécutez le backend. Un
> projet démarré par le runtime — `rebase dev`, `rebase start`, l'image publiée —
> utilise le schéma que le runtime possède (`loadBootEnv` dans
> `@rebasepro/server`), l'union de toutes les tables ci-dessous. Un projet ayant
> exécuté [`rebase eject`](/docs/cli) possède son propre `backend/src/env.ts`
> appelant `loadEnv({ extend })`, et peut y ajouter ses variables typées.

### Requises

| Variable | Description | Exemple |
|----------|-------------|---------|
| `DATABASE_URL` | Chaîne de connexion PostgreSQL. **Optionnelle en développement** — non définie, `rebase dev` fait tourner une PostgreSQL gérée pour le projet, dont les données vivent sous `.rebase/`. Requise partout ailleurs. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Clé secrète pour la signature des tokens JWT. Utilisez une chaîne aléatoire forte (min 32 caractères). **Requise en production** (générée automatiquement en développement). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` est une graphie node-postgres, pas une graphie libpq.**
>
> Rebase et le pilote Node l'acceptent — chiffrer, mais ne pas vérifier le
> certificat. `psql`, `pg_dump`, `pg_restore` et Atlas non, et ils ne dégradent
> pas : ils refusent de démarrer avec `invalid sslmode value: "no-verify"`.
>
> Les commandes propres à Rebase (`rebase db push`, `rebase db backup`, `rebase
> db restore`) la réécrivent en l'équivalent `sslmode=require` avant l'appel
> externe : elles fonctionnent donc avec l'URL telle qu'elle est configurée.
> Lancer `psql` à la main, non — remplacez-y par `sslmode=require`, qui chiffre
> sans vérifier exactement de la même façon.

### Frontend

| Variable | Description | Défaut |
|----------|-------------|---------|
| `VITE_API_URL` | URL de l'API backend pour le SDK client. **À définir en développement seulement** — voir ci-dessous. | origine de la page |
| `VITE_GOOGLE_CLIENT_ID` | ID client Google OAuth. Active la fonction "Se connecter avec Google". | — |


> **Laissez `VITE_API_URL` non définie dans les builds de production.**
>
> En développement, le frontend et le backend sont des origines distinctes : le
> serveur de développement l'injecte donc. En production, le backend Rebase sert
> la SPA, l'API est donc l'origine de la page elle-même et le client la résout
> ainsi tout seul.
>
> Cuire une URL absolue dans un bundle de production fonctionne jusqu'au moment
> où un second nom d'hôte pointe sur la même app : un domaine personnalisé charge
> alors la page depuis `example.com` et appelle l'API sur
> `example.rebase.website`, ce qui est cross-origin — chaque requête échoue donc
> au preflight. Autoriser l'origine en CORS **ne** corrige rien non plus : le
> cookie de rafraîchissement est `SameSite=Lax` et n'est pas envoyé entre sites ;
> vous auriez nettoyé les erreurs de console et gardé une authentification
> cassée. Non définie, tout domaine pointant sur l'app fonctionne sans aucune
> configuration CORS.

### Backend

| Variable | Description | Défaut |
|----------|-------------|---------|
| `PORT` | Port du serveur HTTP backend. Lu par `rebase start`. `rebase dev` ne le lit **que depuis l'environnement du shell** — un `PORT` dans `.env` n'y est pas lu, car le port est résolu avant le chargement de ce fichier — et utilise sinon un port dérivé du chemin du projet, afin que plusieurs projets puissent tourner en même temps. `rebase dev --port` l'emporte sur les deux, et la bannière de démarrage indique le niveau utilisé. | `3001` |
| `LOG_LEVEL` | Niveau de verbosité des logs : `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Affiche le SQL derrière une ligne `Failed query: [redacted]`. Toute instruction en échec est expurgée par défaut, car une requête en échec emporte ses paramètres liés — une adresse e-mail, un hash de mot de passe. À mettre à `true` le temps de diagnostiquer un échec DDL, RLS ou de capture de changements. Ignoré lorsque `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Environnement : `development`, `production` ou `test` | `development` |
| `CORS_ORIGINS` | Liste d'origines autorisées, séparées par des virgules. **Requise en production** si elle diffère du domaine du backend. En développement, elle est *ajoutée à* localhost — voir ci-dessous. | — |
| `FRONTEND_URL` | URL de l'app frontend. Utilisée comme alternative à `CORS_ORIGINS`, dans les deux environnements. | — |
| `ADMIN_CONNECTION_STRING` | Chaîne de connexion à la base de données de niveau administrateur (pour l'introspection du schéma et les opérations d'administration). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Désactive le changement de rôle PostgreSQL dans l'éditeur SQL (utile avec une authentification maison où les rôles de la base ne sont pas mappés). | `false` |

#### CORS en développement

Le développement autorise **localhost, plus ce que nomme `CORS_ORIGINS` (ou
`FRONTEND_URL`)** — la même liste que la production, localhost étant ajouté
plutôt que substitué. La variable se comporte donc de la même façon dans les deux
environnements, et les cas qui en ont besoin en développement sont les cas
ordinaires :

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Une origine qui n'est ni localhost ni listée est refusée, et le refus est
journalisé **une fois par origine**, avec la ligne exacte qui l'autoriserait.
Refuser n'est pas de la prudence pour elle-même : l'API envoie des identifiants,
donc renvoyer en écho une `Origin` arbitraire laisserait n'importe quel site que
la développeuse visite faire des requêtes authentifiées contre le serveur de
développement avec sa session et en lire les réponses.

### Authentification

| Variable | Description | Défaut |
|----------|-------------|---------|
| `JWT_SECRET` | Secret pour la signature JWT (requis en production, généré automatiquement en développement) | — |
| `JWT_PRIVATE_KEY` | Clé privée PEM pour signer les tokens d'accès de façon asymétrique (RS256), afin que tout ce qui détient le JWKS puisse vérifier une session sans pouvoir en émettre une. Accepte un PEM avec de vrais retours à la ligne, un PEM avec des échappements `\n`, ou le base64 du PEM entier. Sans elle, les tokens restent en HS256. | — |
| `JWT_KEY_ID` | Nomme `JWT_PRIVATE_KEY` dans l'en-tête du token et dans le JWKS. Changez-le chaque fois que la clé change — la rotation suppose que l'ancienne et la nouvelle soient distinguables. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Durée de vie du token d'accès | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Durée de vie du token de rafraîchissement. Glissante — chaque rotation la relance, elle régit donc combien de temps une session survit à l'**inactivité**. | `400d` |
| `ALLOW_REGISTRATION` | Permettre aux nouveaux utilisateurs de s'inscrire (`true`/`false`). Hors production, le **premier** utilisateur peut toujours s'inscrire, quoi que dise ce réglage — une table d'utilisateurs vide doit bien admettre quelqu'un, et ce quelqu'un devient l'administrateur. En production (`NODE_ENV=production`) cette fenêtre est fermée : une table vide refuse l'inscription d'amorçage avec `SETUP_REQUIRED`, un premier compte créé par inscription ouverte est un compte ordinaire, et l'administrateur est nommé avec `REBASE_ADMIN_EMAIL` ci-dessous ou attribué avec la clé de service. Le `.env.example` du scaffold la met à `true` ; la valeur par défaut du framework est désactivée. | `false` |
| `DISABLE_SELF_REGISTRATION` <span class="since-badge" data-since="0.18">Since 0.18</span> | Coupe-circuit. Ferme la fenêtre d'amorçage du premier utilisateur que `ALLOW_REGISTRATION=false` laisse délibérément ouverte hors production : l'inscription est alors fermée même face à une base vide. Associez-la à `REBASE_ADMIN_EMAIL` ci-dessous, sinon le déploiement n'a aucun moyen de produire son premier appelant authentifié. Tous les artefacts de déploiement livrés la définissent. | — |
| `REBASE_ADMIN_EMAIL` <span class="since-badge" data-since="0.18">Since 0.18</span> | E-mail du premier compte administrateur, créé au démarrage **tant que la table des utilisateurs est encore vide** et jamais ensuite. C'est ainsi qu'un déploiement de production obtient son administrateur : l'exploitant nomme le premier compte au lieu de le disputer à internet. Le démarrage avertit quand la table est vide en production et que ceci n'est pas défini. | — |
| `REBASE_ADMIN_PASSWORD` <span class="since-badge" data-since="0.18">Since 0.18</span> | Mot de passe de ce compte. Au moins 12 caractères, sinon il est refusé et le compte n'est pas créé. Changez-le après la première connexion. | — |
| `MFA_ENCRYPTION_KEY` | Chiffre chaque secret TOTP stocké. Non définie, les secrets sont chiffrés avec `JWT_SECRET` et le démarrage avertit une fois — faire tourner `JWT_SECRET` déconnecte donc tout le monde *et* rend indéchiffrable chaque authentificateur enrôlé. Définissez une clé dédiée (32+ caractères aléatoires) avant que quiconque ne s'enrôle. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | La clé que l'on *quitte* lors d'une rotation. Définissez les deux pendant une rotation : les nouveaux secrets sont écrits avec `MFA_ENCRYPTION_KEY` et les existants restent lisibles, si bien que personne n'est enfermé dehors de son propre compte en cours de route. Retirez-la une fois chaque secret rechiffré. | — |
| `ALLOW_ANONYMOUS` | Active la connexion anonyme (`POST /api/auth/anonymous`). Opt-in, et délibérément non conditionnée par `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Exige l'authentification pour l'API de données. Mettez `false` pour une surface de lecture entièrement publique — la RLS s'applique toujours. | `true` |
| `AUTH_DEFAULT_ROLE` | Rôle attribué à un utilisateur nouvellement inscrit quand aucun n'est donné. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Monte `POST /api/auth/find-user`, qui résout une adresse e-mail vers un profil public minimal (`uid`, `displayName`, `photoURL`) pour les flux d'invitation par e-mail. Réservé aux appelants authentifiés, et ne renvoie jamais l'e-mail, les rôles ou les métadonnées de l'utilisateur trouvé. Désactivé par défaut : c'est une surface d'énumération. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` sur le cookie de rafraîchissement : `Strict`, `Lax` ou `None`. `None` exige HTTPS et n'est destiné qu'à un frontend véritablement cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure` sur le cookie de rafraîchissement. Activé par défaut ; `AUTH_COOKIE_SECURE=false` pour du http en clair — un déploiement sur une adresse de réseau local, où le navigateur abandonnerait sinon le cookie et où la session meurt à l'expiration du jeton d'accès, sans aucune erreur. Le démarrage émet un avertissement. `http://localhost` n'en a pas besoin. | `true` |
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
| `GITLAB_CLIENT_ID` | ID client GitLab OAuth. La `baseUrl` d'une instance auto-hébergée n'a pas de graphie en variable d'environnement — configurez GitLab dans le bloc `auth` pour cela. | — |
| `GITLAB_CLIENT_SECRET` | Secret client GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | ID client Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Secret client Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | ID client Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Secret client Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | ID client Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Secret client Spotify OAuth | — |
| `APPLE_CLIENT_ID` | Services ID Apple. Apple n'a pas de secret client statique — Rebase signe un JWT ES256 de courte durée à chaque échange de token — il lui faut donc les quatre valeurs `APPLE_*`, et sans elles il ne configure rien. | — |
| `APPLE_TEAM_ID` | Team ID Apple Developer, l'émetteur du JWT. | — |
| `APPLE_KEY_ID` | Key ID de la clé privée enregistrée auprès d'Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenu du fichier de clé privée `.p8`, retours à la ligne compris (les échappements `\n` sont acceptés). | — |
| `REBASE_SERVICE_KEY` | Clé d'API d'administration statique. Contourne l'authentification JWT normale pour les appels serveur à serveur lorsqu'elle est passée en `Authorization: Bearer <key>`. (Générée automatiquement en développement.) | — |
| `REBASE_RATE_LIMIT_STORE` | Où vivent les compteurs de limitation de débit de l'authentification : `memory` (par processus) ou `sql` (partagés entre réplicas). Un processus ne peut pas connaître son propre nombre de réplicas : un déploiement avec des pairs doit donc le dire — trois réplicas sur la valeur par défaut appliquent trois fois la limite. Toute autre valeur **refuse de démarrer** au lieu de se rabattre, `postgres` compris. | `memory` |
| `AUTH_MAGIC_LINK` | Monte le flux de connexion sans mot de passe par lien. Nécessite un service d'e-mail configuré, sinon le lien n'a nulle part où aller. | `false` |
| `AUTH_EMAIL_OTP` | Monte la connexion sans mot de passe avec un code à six chiffres envoyé par e-mail. Même exigence d'e-mail que ci-dessus. | `false` |
| `CAPTCHA_PROVIDER` | Active la vérification captcha sur les routes d'authentification : `turnstile` ou `hcaptcha`. Non définie signifie pas de captcha. | — |
| `CAPTCHA_SECRET` | Le secret du fournisseur, utilisé côté serveur pour vérifier le token envoyé par le navigateur. Requis dès que `CAPTCHA_PROVIDER` est défini. | — |
| `CAPTCHA_ROUTES` | Routes d'authentification à protéger, séparées par des virgules (par exemple `register,login`). Non définie protège l'ensemble par défaut du fournisseur. | — |

### Stockage

:::caution[Le stockage n'a pas de sécurité au niveau des lignes : il lui faut donc un modèle d'accès]
Les collections sont protégées par la RLS de Postgres. Le stockage d'objets n'a
pas d'équivalent — les clés partagent un espace de noms plat — donc, avec un
bucket configuré et aucun modèle d'accès, le serveur **refuse de démarrer en
production**. Satisfaites-le avec exactement l'un de : un hook
`storageAuthorize` exporté depuis `config/index.ts` (ce que livre le scaffold),
`STORAGE_PUBLIC_READ`, ou `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Description | Défaut |
|----------|-------------|---------|
| `STORAGE_TYPE` | Backend de stockage : `local`, `s3` ou `gcs`. En production, `local` désactive le stockage sauf si `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Chemin de base pour le stockage local | `./uploads` |
| `FORCE_LOCAL_STORAGE` | Autorise le stockage local en production — uniquement avec un volume durable monté sur `STORAGE_PATH` | `false` |
| `S3_BUCKET` | Nom du bucket S3 (lorsque `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Région AWS | — |
| `S3_ACCESS_KEY_ID` | Clé d'accès AWS | — |
| `S3_SECRET_ACCESS_KEY` | Clé secrète AWS | — |
| `S3_ENDPOINT` | Endpoint S3 personnalisé (pour MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Force les URLs de style chemin pour le bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nom du bucket GCS (lorsque `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Projet GCP. Généralement déduit des identifiants. | — |
| `GCS_KEY_FILENAME` | Chemin vers un fichier de clé de compte de service. À omettre sur GCP, où Workload Identity fournit les identifiants. | — |
| `STORAGE_PUBLIC_READ` | Sert chaque objet à quiconque, sans token. Uniquement pour un bucket qui est réellement un CDN public. L'une des trois façons de satisfaire le garde-fou de démarrage ci-dessus. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Laisse tout appelant connecté lire, écrire, lister et supprimer chaque objet. Nommé `INSECURE` dans l'objet de configuration pour une raison : ce n'est défendable que dans une app mono-tenant où chaque compte est digne de confiance pour chaque fichier. | `false` |
| `STORAGE_RENDITION_CACHE` | Met en cache les rendus d'images générés (redimensionnements, conversions de format) au lieu de les produire à chaque requête. | `false` |

### E-mail (Optionnel)

| Variable | Description |
|----------|-------------|
| `SMTP_HOST` | Hôte du serveur SMTP |
| `SMTP_PORT` | Port du serveur SMTP |
| `SMTP_SECURE` | Activer la connexion sécurisée (`true`/`false`) |
| `SMTP_USER` | Nom d'utilisateur SMTP |
| `SMTP_PASS` | Mot de passe SMTP |
| `SMTP_FROM` | Adresse de l'expéditeur pour les e-mails système |
| `SMTP_NAME` | Nom affiché sur l'adresse de l'expéditeur |
| `APP_NAME` | Nom de produit utilisé dans les objets et les corps des e-mails (défaut : `Rebase`) |
| `EMAIL_LOGO_URL` | Logo affiché en tête des modèles d'e-mail par défaut. PNG ou JPG `http(s)` absolu — les clients suppriment le SVG et bloquent les URI `data:`. Non définie, une app encore nommée `Rebase` reçoit la marque Rebase, une app renommée n'en reçoit aucune |

### Pool de connexions à la base de données

| Variable | Description | Défaut |
|----------|-------------|---------|
| `DB_POOL_MAX` | Nombre maximal de connexions dans le pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Millisecondes pendant lesquelles une connexion inactive est conservée | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Millisecondes d'attente d'une connexion | `10000` |
| `DATABASE_DIRECT_URL` | Connexion directe (non poolée). [Realtime](/docs/backend/realtime) en a besoin : `LISTEN`/`NOTIFY` ne survit pas à un pooler de transactions comme PgBouncer, et sans elle les notifications de changement sont désactivées avec un avertissement plutôt que perdues en silence. | — |
| `DATABASE_READ_URL` | Réplica de lecture. Les lectures y vont quand elle est définie et diffère de `DATABASE_URL` ; si la connexion échoue, tout se rabat sur le primaire avec un avertissement. | — |
| `REBASE_DB_POOL_MAX` | Un plafond sur chaque pool du processus, appliqué quoi qu'ait demandé chacun. Chiffres uniquement : une valeur mal formée est ignorée plutôt que de sérialiser le serveur en silence. | — |

### Comportement du runtime

Lu par le runtime — `rebase dev`, `rebase start` et l'image serveur publiée. Un
projet ayant fait un eject possède ces décisions dans son propre code.

| Variable | Description | Défaut |
|----------|-------------|---------|
| `REBASE_RLS_AUDIT` | Exécute l'audit de sécurité au niveau des lignes au démarrage et monte son endpoint, qui signale les tables servies sans politiques. | — |
| `REBASE_BASE_PATH` | Chemin de base de toutes les routes de l'API. Il faut dire la même chose au client — voir [Changer `basePath`](#changer-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Sert les assets statiques/d'administration du bundle depuis ce processus. À désactiver quand un CDN se trouve devant. | `true` |
| `REBASE_HISTORY` | Enregistre l'[historique des changements d'entités](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Réponses en gzip/brotli. | `true` |
| `REBASE_MAX_BODY_SIZE` | Corps de requête maximal, **en octets** (`10485760`, pas `10MB` — une valeur qui n'est pas un nombre refuse de démarrer plutôt que de supprimer la limite en silence). | — |
| `REBASE_ENABLE_SWAGGER` | La surface OpenAPI. Tri-état : non définie signifie activée en développement, désactivée en production ; `false` coupe les deux partout. Notez que `true` en production sert la **spécification** sur `/api/docs` mais pas l'**UI** Swagger sur `/api/swagger` — l'UI dépend de `NODE_ENV` séparément. | — |
| `REBASE_METRICS` | Expose les métriques Prometheus sur `/metrics`. | `false` |
| `REBASE_METRICS_TOKEN` | Token bearer protégeant `/metrics`. Non défini, l'endpoint reste ouvert à tout ce qui atteint le port — acceptable sur un réseau privé, pas sur un réseau public, et les logs de démarrage le disent. | — |
| `REBASE_MIGRATE_ON_BOOT` | Ce que le runtime a le droit de faire au schéma au démarrage. `ensure` (le défaut, partout — production comprise) exécute la passe **additive** : créer les tables, colonnes et types enum manquants, jamais en supprimer ou en réécrire un. `none` ne touche à rien. L'image publiée n'accepte que ces deux valeurs et **refuse de démarrer sur `push`**. Dans un [déploiement scindé](/docs/deployment/split-processes), exactement un processus peut provisionner : tout autre rôle doit donc mettre `none` ou refuser de démarrer. | `ensure` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Refuse de démarrer quand la base a été provisionnée pour la dernière fois à partir d'un jeu de collections différent de celui avec lequel ce processus a été construit. Non définie (ou toute valeur autre que `true`/`1`) avertit à la place. | avertit |
| `REALTIME_CDC` | Capture de changements au niveau de la base : `auto` (activer là où la connexion le permet, se rabattre silencieusement sinon), `trigger` (forcer, avertir si impossible), `wal` (se dégrade en `trigger` aujourd'hui), `off`. Voir [Realtime](/docs/backend/realtime#database-level-change-capture-cdc). | `auto` |
| `REALTIME_CHANNEL_BUS` | Transport inter-instances pour les canaux de diffusion et la présence : `memory` ou `postgres`. Ignoré lorsqu'un transport construit a été donné à `realtime.bus`. | `memory` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Autorise les valeurs `localhost`/loopback sous `NODE_ENV=production`. Désactivé, pour qu'un démarrage de production échoue bruyamment plutôt que de se connecter à une base qui n'est pas là. | `false` |
| `REBASE_STRICT_COLLECTION_CONFIG` | Ce que le démarrage fait d'une clé de vos collections que cette version ne lit pas : `warn`, `error` (refuser de démarrer — à activer en CI) ou `off`. Ne régit que les clés qu'il ne *reconnaît* pas, qui sont généralement une faute de frappe et parfois des métadonnées délibérées ; une clé dont il sait qu'elle a déménagé est toujours fatale, car la fonctionnalité qu'elle configurait est sinon silencieusement absente. | `warn` |
| `REBASE_PROVISION_ONLY` | `1`/`true` exécute la passe de schéma et sort sans ouvrir de socket — la forme que veut un Job de migration, depuis la même image et le même bundle que le serveur qui suit. Une valeur vide compte comme *non définie*, afin qu'un `${SOMETHING}` non substitué dans un fichier compose ne puisse pas transformer un déploiement ordinaire en un déploiement qui migre et refuse de servir. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` laisse une machine — un agent, un job CI — *appliquer* un changement de schéma via `/api/admin/schema`, et pas seulement le planifier. Désactivé sauf demande explicite : l'identifiant qui ferait un tel changement est celui qui a le plus de chances de traîner dans une variable CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Combien de temps une fonction personnalisée peut s'exécuter avant que sa requête soit abandonnée. Le même bouton que l'option `functionsTimeoutMs`. | — |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` fait qu'un rejet de promesse non géré termine le processus au lieu d'être journalisé. Activé sous un orchestrateur qui vous redémarrera ; désactivé là où un redémarrage est pire qu'une fuite. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Maintient le planificateur cron en marche sur une plateforme que le runtime détecterait sinon comme scale-to-zero, où un minuteur qui se déclenche dans une instance inactive ne se déclenche dans aucune instance. | — |
| `TRUSTED_PROXY_HOPS` | Combien de proxys se trouvent devant ce serveur, afin que le limiteur de débit puisse lire la vraie adresse client dans `X-Forwarded-For`. Défaut sûr `0` : sans proxy, faire confiance à l'en-tête laisserait n'importe quel appelant forger une identité. | `0` |

:::note[Le provisionnement au démarrage est additif, et n'est pas un outil de migration]
La passe de démarrage tourne sans surveillance, personne ne lisant de diff : elle
ne supprimera donc jamais une colonne, ne rétrécira pas un type et ne réécrira
pas une table. C'est aussi pourquoi l'image refuse
`REBASE_MIGRATE_ON_BOOT=push` : un push complet calcule un diff et fera
volontiers un `DROP COLUMN`, et le redémarrage d'un conteneur ne doit jamais
pouvoir détruire une colonne de production comme effet de bord d'une
replanification.

Les changements destructifs ou remodelants restent là où ils peuvent être
relus : `rebase db generate` + `rebase db migrate`, ou `rebase db push` depuis un
checkout ou la CI, qui simule le changement, refuse les changements destructifs
sans confirmation et peut prendre une sauvegarde au préalable.
:::

### Déploiements scindés

Une image et un bundle peuvent être démarrés plusieurs fois, chacun servant une
partie différente du projet. Une ligne pour chacune ici, car cette page prétend
lister toutes les variables ; ce que chaque combinaison *monte et possède* — et
quelles combinaisons refusent de démarrer — se trouve sur
**[Processus scindés](/docs/deployment/split-processes)**.

| Variable | Description | Défaut |
|----------|-------------|---------|
| `REBASE_ROLE` | Quelle partie ce processus sert : `all`, `api`, `functions` ou `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Force si *ce* processus exécute les minuteurs cron. Non définie, suit le rôle. | — |
| `REBASE_JOB_WORKERS` | Force si ce processus exécute les workers de la file de tâches. Non définie, suit le rôle. | — |
| `REBASE_FUNCTIONS_ONLY` | Ne sert dans ce processus que les fonctions personnalisées nommées. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Sert toutes les fonctions personnalisées sauf celles nommées. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Où le processus API transfère une requête de fonction qu'il ne sert pas lui-même. | — |

### Sauvegardes

| Variable | Description | Défaut |
|----------|-------------|---------|
| `BACKUP_SCHEDULE` | Expression cron pour les sauvegardes planifiées. Non définie signifie que les sauvegardes planifiées sont désactivées. | — |
| `BACKUP_DESTINATION` | Chemin local, ou une URL `s3://bucket/prefix` / `gs://bucket/prefix`. | `./backups` |
| `BACKUP_RETENTION_DAYS` | Supprime les sauvegardes de plus de N jours. Non définie ou `0` conserve tout. | — |
| `BACKUP_KEEP_MINIMUM` | Conserve toujours au moins N des sauvegardes les plus récentes, quoi que dise la rétention. | — |
| `PG_DUMP_PATH` | Remplace le binaire `pg_dump` — il doit correspondre à la version majeure du serveur. | — |
| `PG_RESTORE_PATH` | Remplace le binaire `pg_restore`. | — |

Les sauvegardes contiennent des secrets et des données personnelles. Utilisez une
destination privée avec chiffrement au repos.
| `PG_DUMPALL_PATH` | Où se trouve `pg_dumpall`, quand il n'est pas dans le `PATH`. Sans lui — et sans les outils client PostgreSQL installés — une sauvegarde des globals échoue avec une erreur nommant cette variable. | — |

### Livraison du bundle

Un déploiement managé ne porte pas son code dans l'image : le runtime va chercher
un bundle au démarrage. Ces variables décident lequel et comment.

| Variable | Description | Défaut |
|----------|-------------|---------|
| `REBASE_BUNDLE` | Chemin vers un répertoire de bundle déjà extrait. Ce que `rebase start` définit en local. | — |
| `REBASE_BUNDLE_URL` | D'où récupérer l'archive du bundle, quand il n'y en a pas en local. | — |
| `REBASE_BUNDLE_TOKEN` | L'identifiant bearer de cette récupération. Traitez-le comme un secret : c'est lui qui autorise un locataire à télécharger son propre code. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Où un bundle récupéré est extrait. Doit être accessible en écriture et survivre entre la récupération et le démarrage. | — |
| `REBASE_RUNTIME_MODULES` | Modules supplémentaires que l'image du runtime fournit au bundle, au-delà de ceux qu'elle déclare elle-même. | — |

### Liaisons de ressources

Chaque base de données, bucket et topic qu'un projet déclare dans
`config/resources.ts` est lié par des variables d'environnement nommées d'après
lui. Les noms de base sont ci-dessous ; une ressource non par défaut ajoute `__`
et sa clé en majuscules, si bien qu'un bucket nommé `media` lit
`S3_BUCKET__MEDIA`. `rebase status`
<span class="since-badge" data-since="0.18">Since 0.18</span> affiche, par
ressource, la variable exacte qu'il lit et si elle est définie.

| Variable | Description | Défaut |
|----------|-------------|---------|
| `REBASE_DRIVER` | Le paquet npm qui implémente le pilote d'une source de données, quand ce n'est pas celui de Postgres par défaut. Suffixé par source : `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | La chaîne de connexion d'un topic déclaré. Suffixée par topic. | — |

### L'environnement propre à la CLI

Lu par `rebase`, pas par le serveur. Rien ici n'affecte un déploiement.

| Variable | Description | Défaut |
|----------|-------------|---------|
| `REBASE_BASE_URL` | Le backend auquel `rebase auth` et `rebase api-keys` parlent, au lieu de le déduire du projet. | — |
| `REBASE_PORT` | Le port que ces commandes supposent en déduisant cette URL. | — |
| `SERVICE_KEY` | La clé de service avec laquelle elles s'authentifient, au lieu de demander. | — |
| `REBASE_ENV_FILE_PATH` | Quel `.env` la CLI lit et écrit, quand ce n'est pas celui du projet. | — |
| `REBASE_CLOUD_URL` | Le plan de contrôle auquel `rebase cloud` parle. | — |
| `REBASE_CLOUD_EMAIL` | Le compte avec lequel `rebase cloud login` se connecte, au lieu de demander. | — |
| `REBASE_CLOUD_PASSWORD` | Son mot de passe, pour qu'un coffre à secrets puisse le fournir sans qu'il atteigne l'historique du shell. | — |
| `REBASE_DEBUG` | `1` affiche l'erreur sous-jacente et le détail de la requête au lieu du message court. La première chose à définir quand une commande `rebase cloud` échoue sans aider. | — |
| `REBASE_DEV_NO_DB` | `rebase dev` ne démarre aucune base et ne provisionne rien — vous apportez la vôtre. Comme `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fixe le port du serveur de développement du frontend, que `rebase dev` déduit sinon du chemin du projet. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Combien de temps `rebase dev` attend que le backend s'annonce avant de dire qu'il n'a pas démarré. `0` désactive le rapport. | `30000` |
| `DATABASE_PASSWORD` | Le mot de passe que `rebase dev --docker` met dans la chaîne de connexion qu'il déduit de `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | La convention inter-outils. Mise à autre chose que `0`, la CLI n'envoie aucune télémétrie. | — |
| `REBASE_TELEMETRY_DISABLED` | La même chose, pour Rebase en particulier. Ne nécessite aucun fichier, ce qui en fait la bonne variable en CI et dans une image. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Où la télémétrie est envoyée, pour un collecteur auto-hébergé. | — |

## Secrets en développement

`JWT_SECRET` et `REBASE_SERVICE_KEY` sont requis en production et générés pour
vous en dehors, si bien que vous pouvez démarrer sans rien configurer.

Ces valeurs générées sont mises en cache dans `.rebase-dev-secrets.json`, à côté
de `.rebase-dev-port` et `.rebase-dev-url` et gitignorées avec eux. Auparavant,
elles étaient régénérées à chaque démarrage — redémarrer le serveur de
développement vous déconnectait donc de votre propre app et invalidait toute clé
d'API que vous veniez de créer.

- Définissez l'une ou l'autre explicitement et c'est la vôtre qui est utilisée ;
  rien n'est mis en cache ni lu.
- Placez le cache ailleurs avec `REBASE_DEV_SECRETS_FILE` — un chemin, et la
  seule variable de cette section que vous définiriez délibérément.
- Supprimez le fichier pour faire tourner les deux secrets. Le démarrage suivant
  en écrit un neuf.
- Si le fichier ne peut pas être écrit — un conteneur en lecture seule, par
  exemple — le serveur démarre quand même avec un secret éphémère, exactement
  comme avant.

Rien n'est mis en cache en production, ni sous un lanceur de tests. En
production, un démarrage qui a dû générer l'un des deux secrets échoue toujours
en nommant la variable, et cela n'a pas changé :

```
JWT_SECRET must be explicitly set in production.
Do not rely on auto-generated secrets outside development.
```

## Objet de Configuration Backend

L'objet `RebaseBackendConfig` passé à `initializeRebaseBackend()` offre un contrôle programmatique :

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

### Changer `basePath`

`basePath` déplace toutes les routes de l'API : il faut donc dire la même chose
au client — sinon il continue de demander `/api/...` et reçoit un 404 pour tout :

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

Le panneau d'administration le reprend du client qu'on lui donne ; rien d'autre
n'a besoin d'être configuré. Si vous construisez une URL de requête à la main,
assemblez-la à partir du client plutôt que d'écrire `/api` vous-même :

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Dépannage

### Permission refusée dans l'éditeur SQL (`permission denied for table <name>`)

* **Symptômes :** Les requêtes personnalisées exécutées dans l'éditeur SQL de Rebase Studio échouent avec `cause: error: permission denied for table <name>`, alors que la vue tableur du CMS charge les données sans problème.
* **Cause :** Par défaut, Rebase tente d'exécuter les requêtes de l'éditeur SQL en changeant temporairement de rôle de base de données pour correspondre au rôle applicatif de l'utilisateur actif (par exemple `SET LOCAL ROLE "admin"`). Si vous utilisez une authentification maison où les rôles n'existent que dans des tables et non comme de vrais rôles PostgreSQL, le changement de rôle échoue ou les privilèges manquent. La vue tableur du CMS s'exécute sous le propriétaire de la connexion et contourne cela.
* **Solution :** Ajoutez `DISABLE_DB_ROLE_SWITCHING=true` à la configuration `.env` de votre backend. Cela force Rebase à exécuter les requêtes de l'éditeur SQL avec les privilèges du propriétaire de la connexion (généralement un superutilisateur/propriétaire).

### Échec de récupération du schéma dans l'éditeur SQL (`Cross-database execution requires adminConnectionString`)

* **Symptômes :** Studio ne charge pas l'arbre du schéma, ou l'éditeur SQL lève `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Cause :** Rebase a besoin de privilèges d'administration pour interroger les catalogues système de la base et exécuter des commandes d'administration. Si `adminConnectionString` n'est pas fourni au bootstrapper, ou si `getAdmin()` est surchargé pour renvoyer `undefined`, ces opérations échouent.
* **Solution :** Assurez-vous que `adminConnectionString` est configuré à l'initialisation du bootstrapper backend :
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Prochaines étapes

- **[Déploiement](/docs/getting-started/deployment)** — Guide de déploiement en production
- **[Présentation du Backend](/docs/backend)** — Référence complète de la configuration backend
