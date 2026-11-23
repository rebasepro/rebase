---
sourceHash: 14ada28ef46dc73c
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
> schéma détenu par le runtime (`loadBootEnv` dans `@rebasepro/server`), qui correspond à
> l'union de chaque tableau ci-dessous. Un projet ayant exécuté [`rebase eject`](/docs/cli)
> possède un fichier `backend/src/env.ts` appelant `loadEnv({ extend })`, et peut y ajouter ses propres
> variables typées.

### Requises

| Variable | Description | Exemple |
|----------|-------------|---------|
| `DATABASE_URL` | Chaîne de connexion PostgreSQL. **Optionnelle en développement** — non définie, `rebase dev` exécute un PostgreSQL géré pour le projet, avec ses données sous `.rebase/`. Requise partout ailleurs. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Clé secrète pour signer les jetons JWT. Utilisez une chaîne aléatoire robuste (min. 32 caractères). **Requise en production** (générée automatiquement en développement). | `a1b2c3d4e5...` |

> **Sur une base de données managée, `sslmode=require` peut ne pas signifier ce qu'il indique.**
>
> Pour `psql` et tous les outils libpq, `require` signifie « chiffré, certificat non
> vérifié ». Le pilote Node sur lequel fonctionne Rebase l'interprète comme `verify-full`, ainsi une
> base de données dont le certificat n'a été signé par aucune autorité publique — fréquent sur les
> Postgres managés — rejette le runtime avec `self-signed certificate`, alors que `psql`
> se connecte avec la même URL. Le runtime et les commandes `rebase db` s'arrêtent avec un
> message le précisant.
>
> Choisissez l'une de ces options :
>
> - **`sslmode=no-verify`** — chiffré, non vérifié : la signification de `require` pour
>   libpq. Il s'agit d'une syntaxe propre à node-postgres absente de libpq, donc `psql`, `pg_dump`
>   et Atlas la refusent avec `invalid sslmode value: "no-verify"`. Les commandes propres à Rebase
>   (`rebase db push`, `rebase db backup`, `rebase db restore`) la transmettent
>   sous la forme `sslmode=require`, fonctionnant ainsi avec l'URL telle que configurée ; pour
>   `psql` exécuté manuellement, remplacez par `sslmode=require`.
> - **`sslmode=verify-full&sslrootcert=/path/to/ca.pem`** — vérifié auprès du
>   certificat CA du fournisseur. Identique pour chaque outil.
>
> `uselibpqcompat=true&sslmode=require`, suggéré par l'avertissement du pilote Node lui-même,
> fonctionne également pour le runtime ; les commandes Rebase suppriment `uselibpqcompat`
> avant de passer l'URL aux outils libpq, qui la rejettent.

### Frontend

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `VITE_API_URL` | URL de l'API backend pour le SDK typé. **À définir uniquement en développement** — voir ci-dessous. | origine de la page |
| `VITE_GOOGLE_CLIENT_ID` | Identifiant client Google OAuth. Active « Se connecter avec Google ». | — |


> **Laissez `VITE_API_URL` non définie dans les builds de production.**
>
> En développement, le frontend et le backend ont des origines distinctes, le serveur de développement
> injecte donc cette variable. En production, le backend Rebase sert la SPA, l'API est
> donc l'origine même de la page et le client la résout ainsi de manière autonome.
>
> Intégrer en dur une URL absolue dans un bundle de production fonctionne jusqu'à ce qu'un deuxième
> nom d'hôte pointe vers la même application : un domaine personnalisé charge alors la page depuis
> `example.com` et appelle l'API sur `example.rebase.website`, ce qui est
> cross-origin, et chaque requête échoue lors du preflight. Autoriser l'origine dans CORS
> ne résout **pas** non plus le problème — le cookie de rafraîchissement est `SameSite=Lax` et n'est pas
> envoyé en cross-site, vous supprimeriez donc les erreurs de console tout en conservant une
> authentification cassée. Lorsqu'elle n'est pas définie, chaque domaine pointant vers l'application fonctionne sans
> aucune configuration CORS.

### Backend

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `PORT` | Port pour le serveur HTTP backend. Lu par `rebase start`. `rebase dev` le lit **uniquement depuis l'environnement du shell** — un `PORT` dans `.env` n'y est pas lu, car le port est résolu avant le chargement de ce fichier — et lie sinon un port dérivé du chemin du projet, afin que plusieurs projets puissent s'exécuter en même temps. `rebase dev --port` a la priorité sur les deux, et la bannière de démarrage indique le palier utilisé. | `3001` |
| `LOG_LEVEL` | Niveau de verbosité des logs : `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Affiche le SQL derrière une ligne `Failed query: [redacted]`. Chaque instruction en échec est caviardée par défaut, car une requête échouée transporte ses paramètres liés — un e-mail, un hash de mot de passe. Définissez-la sur `true` lors du diagnostic d'une panne DDL, RLS ou de capture de modifications. Ignoré lorsque `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Environnement : `development`, `production` ou `test` | `development` |
| `CORS_ORIGINS` | Liste séparée par des virgules des origines autorisées. **Requise en production** sauf si `FRONTEND_URL` est défini : un démarrage en production sans l'un ou l'autre refuse de démarrer. En développement, elle est *ajoutée à* localhost — voir ci-dessous. | — |
| `FRONTEND_URL` | URL de l'application frontend. Utilisée comme alternative à CORS_ORIGINS, dans les deux environnements. | — |
| `ADMIN_CONNECTION_STRING` | Chaîne de connexion à la base de données de niveau administrateur (utilisée pour l'introspection de schéma et les opérations d'administration). La base de données qu'elle désigne n'est pas celle que la console SQL considère comme actuelle, ni celle qu'une nouvelle branche copie par défaut : les deux correspondent à la base de données sur laquelle se trouve la propre connexion de l'application (voir `REBASE_BRANCH_PARENT_DATABASE` pour un serveur sur une branche). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Désactive le changement de rôle PostgreSQL dans l'éditeur SQL (utile pour l'authentification personnalisée où les rôles DB ne sont pas mappés). La console SQL de Studio indique alors que les lignes ont été lues en tant que propriétaire de la connexion, le nomme, et grise son sélecteur de rôle. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | La base de données depuis laquelle la branche sur laquelle ce serveur s'exécute a été copiée. `rebase dev` la définit sur un checkout [basculé sur une branche](/docs/backend/branching/#cli-integration). Un serveur disposant de cette variable conserve le registre de branches sur cette base de données et copie par défaut les nouvelles branches depuis celle-ci, de sorte que le volet Branches de Studio affiche les branches de la base principale. | — |

#### CORS en développement

Le développement autorise **localhost, plus tout ce que `CORS_ORIGINS` (ou `FRONTEND_URL`)
désigne** — la même liste que celle utilisée en production, avec localhost ajouté plutôt que
substitué. Ainsi, la variable fonctionne de la même manière dans les deux environnements, et les
cas nécessitant son utilisation en développement sont les cas habituels :

```bash
# Un téléphone sur le LAN, la machine d'un collègue, un tunnel ngrok,
# un port Codespaces transféré — toutes des origines non-localhost.
CORS_ORIGINS=http://192.168.1.5:5173
```

Une origine qui n'est ni localhost ni répertoriée est refusée, et le refus est
journalisé **une fois par origine** avec la ligne exacte qui permettrait de l'autoriser. Le refus n'est
pas une prudence gratuite : l'API transmet des identifiants (credentials), renvoyer une
valeur d'en-tête `Origin` arbitraire permettrait donc à n'importe quel site visité par le développeur d'effectuer
des requêtes authentifiées auprès du serveur de développement avec sa session et d'en lire
les réponses.

### Authentification

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `JWT_SECRET` | Secret pour la signature JWT (requis en production, auto-généré en développement) | — |
| `JWT_PRIVATE_KEY` | Clé privée PEM pour signer les jetons d'accès de manière asymétrique (RS256), afin que toute entité détenant le JWKS puisse vérifier une session sans pouvoir en fabriquer une. Accepte un PEM avec de vrais sauts de ligne, un PEM avec des échappements `\n`, ou le PEM complet en base64. Sans elle, les jetons restent en HS256. | — |
| `JWT_KEY_ID` | Identifie `JWT_PRIVATE_KEY` dans l'en-tête du jeton et dans le JWKS. Modifiez-la chaque fois que la clé change — la rotation dépend de la capacité à distinguer l'ancienne clé de la nouvelle. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Durée de vie du jeton d'accès | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Durée de vie du jeton de rafraîchissement. Glissante — chaque rotation la renouvelle, ceci régit donc la durée de survie d'une session à **l'inactivité**. Définissez `400d` pour des sessions survivant à une longue absence ; les navigateurs plafonnent le cookie de rafraîchissement à cette valeur. | `30d` |
| `ALLOW_REGISTRATION` | Autoriser de nouveaux utilisateurs à s'inscrire (`true`/`false`). Hors production, le **premier** utilisateur peut toujours s'inscrire, quelle que soit cette valeur — une table d'utilisateurs vide doit accepter quelqu'un, et cette personne devient administrateur. En production (`NODE_ENV=production`), cette fenêtre est fermée : une table vide refuse l'inscription bootstrap avec `SETUP_REQUIRED`, un premier compte créé via une inscription ouverte est un compte ordinaire, et l'administrateur est désigné via `REBASE_ADMIN_EMAIL` ci-dessous ou assigné avec la clé de service. Le fichier `.env.example` du scaffold la définit sur `true` ; la valeur par défaut du framework est désactivée. | `false` |
| `DISABLE_SELF_REGISTRATION` | Coupe-circuit. Ferme la fenêtre de bootstrap du premier utilisateur que `ALLOW_REGISTRATION=false` laisse délibérément ouverte hors production, rendant ainsi l'inscription impossible même face à une base vide. À combiner avec `REBASE_ADMIN_EMAIL` ci-dessous, sous peine pour le déploiement de ne pas pouvoir produire son premier appelant authentifié. Tous les artefacts de déploiement fournis la définissent. | — |
| `REBASE_ADMIN_EMAIL` | Adresse e-mail du premier compte administrateur, créé au démarrage **pendant que la table des utilisateurs est encore vide** et jamais après. C'est ainsi qu'un déploiement de production obtient son administrateur : l'opérateur désigne le premier compte au lieu de faire la course contre Internet. Le démarrage émet un avertissement lorsque la table est vide en production et que cette variable n'est pas définie. | — |
| `REBASE_ADMIN_PASSWORD` | Mot de passe de ce compte. Au moins 12 caractères, sous peine d'être refusé et que le compte ne soit pas créé. Modifiez-le après la première connexion. | — |
| `MFA_ENCRYPTION_KEY` | Chiffre chaque secret TOTP stocké. Non défini, les secrets sont chiffrés avec `JWT_SECRET` à la place et le démarrage avertit une fois — la rotation de `JWT_SECRET` déconnecte donc tout le monde *et* rend impossible le déchiffrement de chaque authentificateur enregistré. Définissez une clé dédiée (32+ caractères aléatoires) avant toute inscription. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | L'ancienne clé dont on s'écarte lors d'une rotation. Définissez les deux lors d'une rotation : les nouveaux secrets sont écrits avec `MFA_ENCRYPTION_KEY` et les existants restent lisibles, de sorte que personne ne soit exclu de son propre compte en pleine rotation. Supprimez-la une fois que chaque secret a été rechiffré. | — |
| `ALLOW_ANONYMOUS` | Active la connexion anonyme (`POST /api/auth/anonymous`). Optionnelle (opt-in), et délibérément non conditionnée par `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Exiger une authentification pour l'API de données. Définissez à `false` pour une surface de lecture entièrement publique — le RLS s'applique toujours. | `true` |
| `AUTH_DEFAULT_ROLE` | Rôle attribué à un nouvel utilisateur enregistré lorsqu'aucun n'est spécifié. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Monte `POST /api/auth/find-user`, qui résout une adresse e-mail vers un profil public minimal (`uid`, `displayName`, `photoURL`) pour les flux d'invitation par e-mail. Appelants authentifiés uniquement, et ne renvoie jamais l'e-mail, les rôles ou les métadonnées de l'utilisateur trouvé. Désactivé par défaut : il s'agit d'une surface d'énumération. | `false` |
| `AUTH_COOKIE_SAME_SITE` | Attribut `SameSite` sur le cookie de rafraîchissement : `Strict`, `Lax` ou `None`. `None` requiert HTTPS et est réservé à un frontend véritablement cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | Attribut `Secure` sur le cookie de rafraîchissement. Sécurisé par défaut ; `AUTH_COOKIE_SECURE=false` pour le http ordinaire — un déploiement sur une adresse LAN où le navigateur rejetterait autrement le cookie et la session mourrait à l'expiration du jeton d'accès sans erreur. Émet un avertissement au démarrage. `http://localhost` n'en a pas besoin. | `true` |
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
| `APPLE_CLIENT_ID` | Identifiant Apple Services ID, pour la connexion web. Il est public et exposé dans `GET /auth/config`. Apple n'a pas de secret client statique, car Rebase signe un JWT ES256 à courte durée de vie pour chaque échange de jeton. Apple a donc besoin de `APPLE_TEAM_ID`, `APPLE_KEY_ID` et `APPLE_PRIVATE_KEY`, en plus de cette variable ou de `APPLE_BUNDLE_IDS`, et ne configure rien sans eux. | — |
| `APPLE_BUNDLE_IDS` | Identifiants d'application (bundle ids) séparés par des virgules des applications natives iOS/macOS dont les codes Sign in with Apple sont acceptés. | — |
| `APPLE_TEAM_ID` | Apple Developer Team ID, l'émetteur du JWT. | — |
| `APPLE_KEY_ID` | Key ID de la clé privée enregistrée auprès d'Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenu du fichier de clé privée `.p8`, sauts de ligne inclus (les échappements `\n` sont acceptés). | — |
| `REBASE_SERVICE_KEY` | Clé d'API administrateur statique. Contourne l'authentification JWT normale pour les appels de serveur à serveur lorsqu'elle est transmise sous forme `Authorization: Bearer <key>`. (Auto-générée en développement). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Clé publique de la plateforme d'hébergement (PEM, EC P-256) utilisée pour vérifier les jetons de plateforme `rpt_` ; plusieurs blocs PEM lors d'une rotation de clé. La plateforme la définit lors du déploiement, et elle ne contient rien de secret. Conjointement avec `REBASE_PLATFORM_TOKEN_AUDIENCE`, elle permet au portail d'administration d'accepter un jeton de plateforme pour `cron:read`, et pour rien d'autre. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | L'identifiant du projet auquel l'`aud` d'un jeton de plateforme doit correspondre, évitant ainsi qu'un jeton émis pour un autre projet ne soit accepté. Si une seule des deux variables est définie, le serveur démarre, consigne un avertissement et répond à chaque jeton `rpt_` par un code `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_PLATFORM_SIGNIN_URL` | Destination du bouton **Continue with Rebase Cloud** du panneau d'administration : la page du projet sur la console de la plateforme, qui connecte les propriétaires du projet et revient. La plateforme la définit lors du déploiement avec les deux précédentes ; grâce à elles, `POST /api/auth/platform-signin` accepte le jeton d'une minute `auth:admin-signin` de la plateforme et ouvre une session d'administration. Sans elle, l'accès fonctionne toujours depuis le bouton **Open CMS** de la console, et l'écran de connexion ne fait que l'expliquer. | — |
| `REBASE_RATE_LIMIT_STORE` | Emplacement des compteurs de limitation de débit (rate limit), pour les routes d'authentification et pour `rateLimit` dans les fonctions personnalisées : `memory` (par processus) ou `sql` (partagé entre les réplicas). Un processus ne peut pas voir son propre nombre de réplicas, un déploiement avec des pairs doit donc le déclarer — trois réplicas sur la valeur par défaut appliquent trois fois la limite. Toute autre valeur **refuse de démarrer** plutôt que de se rabattre sur une alternative, y compris `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Monter le flux de lien de connexion sans mot de passe (magic link). Nécessite un service d'e-mail configuré, sinon le lien n'a nulle part où être envoyé. | `false` |
| `AUTH_EMAIL_OTP` | Monter la connexion sans mot de passe avec un code à six chiffres envoyé par e-mail. Même exigence d'e-mail que ci-dessus. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Inscription sans mot de passe : une demande de magic link ou de code par e-mail pour une adresse inconnue crée le compte, tant que les inscriptions sont ouvertes. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Action effectuée lorsqu'un jeton de rafraîchissement est rejoué après sa fenêtre de réutilisation : `reject` (le refuser, conserver la session) ou `revoke-session` (mettre fin à la session). Toute autre valeur fait échouer le démarrage. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Inscription avec confirmation préalable : pas de connexion par mot de passe tant que l'adresse n'est pas vérifiée. Nécessite les e-mails ; le démarrage échoue sans cela. | `false` |
| `CAPTCHA_PROVIDER` | Activer la vérification par captcha sur les routes d'authentification : `turnstile` ou `hcaptcha`. Non défini signifie aucun captcha. | — |
| `CAPTCHA_SECRET` | Secret du fournisseur, utilisé côté serveur pour vérifier le jeton envoyé par le navigateur. Requis dès lors que `CAPTCHA_PROVIDER` est défini. | — |
| `CAPTCHA_ROUTES` | Routes d'authentification à protéger séparées par des virgules (par exemple `register,login`). Non défini protège l'ensemble par défaut du fournisseur. | — |

### Stockage (Storage)

<span class="since-badge" data-since="0.35">Depuis 0.35</span>

:::caution[Le stockage n'a pas de sécurité au niveau des lignes (RLS), il nécessite donc un modèle d'accès]
Les tables sont protégées par le RLS de Postgres. Le stockage d'objets n'a pas d'équivalent —
les clés partagent un espace de noms plat unique — ainsi, avec un bucket configuré et aucun modèle d'accès,
le serveur **refuse de démarrer en production**. Remplissez cette condition avec exactement l'un des éléments suivants :
un hook `storageAuthorize` exporté depuis `backend/storage.ts` (ce que fournit le scaffold),
`STORAGE_POLICIES`, `STORAGE_PUBLIC_READ` ou `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `STORAGE_TYPE` | Backend de stockage : `local`, `s3`, `gcs` ou `platform` (fichiers dans un préfixe appartenant à la plateforme d'hébergement, transférés via des URL signées par son broker de stockage ; défini par la plateforme). En production, `local` désactive le stockage à moins que `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Chemin de base pour le stockage local. Un chemin relatif est lu à partir du répertoire dans lequel le serveur s'exécute : la racine du projet sous `rebase dev`, `backend/` dans un serveur généré par `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Autoriser le stockage local en production — uniquement avec un volume persistant contenant `STORAGE_PATH` et les répertoires `<STORAGE_PATH>__<key>` des buckets locaux nommés à ses côtés | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Durée en secondes pendant laquelle l'URL de téléchargement d'un fichier privé fonctionne — le jeton que `getSignedUrl()` y insère. Au maximum `604800` (une semaine) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Plus grand fichier accepté par la source, en octets, sur chaque chemin de téléversement — `__<KEY>` pour une source nommée. Une valeur qui n'est pas un nombre entier d'octets refuse le démarrage | `52428800` (50 Mo) |
| `S3_BUCKET` | Nom du bucket S3 (lorsque `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Région AWS | — |
| `S3_ACCESS_KEY_ID` | Clé d'accès AWS | — |
| `S3_SECRET_ACCESS_KEY` | Clé secrète AWS | — |
| `S3_ENDPOINT` | Point de terminaison S3 personnalisé (pour MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Forcer les URL de type path-style pour le bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nom du bucket GCS (lorsque `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Projet GCP. Généralement déduit des identifiants. | — |
| `GCS_KEY_FILENAME` | Chemin vers un fichier de clé de compte de service. À omettre sur GCP, où Workload Identity fournit les identifiants. | — |
| `STORAGE_PUBLIC_READ` | Servir chaque objet à n'importe qui, sans jeton. Uniquement pour un bucket qui fait réellement office de CDN public. L'un des moyens de satisfaire la protection de démarrage ci-dessus. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permettre à tout appelant authentifié de lire, écrire, lister et supprimer chaque objet. Nommé `INSECURE` dans l'objet de configuration pour une bonne raison : cela n'est défendable que dans une application mono-tenant où chaque compte est digne de confiance pour chaque fichier. | `false` |
| `STORAGE_POLICIES` | Règles d'accès au stockage en JSON : `[{ "path", "operations"?, "allow" }]`, `allow` étant `"public"`, `"authenticated"`, `"owner"` ou `{ "roles": [...] }`. Refus par défaut, et satisfait la protection au démarrage. Une liste invalide refuse le démarrage. Voir [Autorisation du stockage](/docs/backend/storage-authorization/#as-data-storage_policies). | — |
| `STORAGE_BROKER_URL` | Le broker de stockage de la plateforme, pour `STORAGE_TYPE=platform`. Défini par la plateforme exécutant le broker. | — |
| `STORAGE_BROKER_PROJECT` | L'identifiant de projet auquel le broker restreint les fichiers de ce déploiement, pour `STORAGE_TYPE=platform`. Défini par la plateforme. | — |
| `STORAGE_RENDITION_CACHE` | Mettre en cache les déclinaisons d'images générées (redimensionnements, conversions de format) au lieu de les produire à chaque requête. | `false` |

### E-mail (Optionnel)
`MAGIC_LINK_URL`.

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
| `EMAIL_LOGO_URL` | Logo affiché en tête des modèles d'e-mails par défaut. PNG ou JPG absolu en `http(s)` — les clients de messagerie suppriment le SVG et bloquent les URI `data:`. Non défini, une application toujours nommée `Rebase` reçoit le logo Rebase et une application renommée n'en reçoit aucun |
| `MAGIC_LINK_URL` | Destination d'un lien magique envoyé par e-mail. Une base se voit ajouter `/auth/magic-link?token=…` ; une URL contenant `{token}` représente le lien complet, pour un frontend qui ne dessert pas `/auth/magic-link`. Mettez-la entre guillemets dans `.env`, où un `#` non échappé commence un commentaire : `MAGIC_LINK_URL="https://app.example.com/app.html#ml={token}"`. Une valeur contenant un hash ou un chemin de fichier sans `{token}` déclenche un avertissement au démarrage. Non définie, la base est `FRONTEND_URL` |

### Pool de connexions à la base de données

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `DB_POOL_MAX` | Nombre maximal de connexions dans le pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Millisecondes pendant lesquelles une connexion inactive est conservée | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Millisecondes à attendre pour obtenir une connexion | `10000` |
| `DATABASE_DIRECT_URL` | Connexion directe (sans pooler). [Realtime](/docs/backend/realtime) en nécessite une : `LISTEN`/`NOTIFY` ne fonctionne pas à travers un pooler en mode transaction tel que PgBouncer, et sans elle, les notifications de changement sont désactivées avec un avertissement plutôt que d'être perdues silencieusement. Le [worker de tâches](/docs/backend/jobs) y maintient également son écoute `LISTEN` de réveil. Remplit `directConnectionString` de l'adaptateur Postgres lorsque celle-ci n'est pas définie. | — |
| `DATABASE_READ_URL` | Réplica de lecture, tel qu'un hot standby. Lorsqu'il désigne un autre serveur, les lectures authentifiées (listes, lignes individuelles, comptages, agrégats) y sont servies sous la même sécurité au niveau des lignes ; les écritures, la connexion, le temps réel, les tâches cron, les jobs, la console SQL et `rebase.sql` restent sur le primaire. Un lecteur venant d'effectuer une écriture lit sur le primaire pendant `REBASE_READ_STICKY_MS`, et tout le monde le fait tant que le réplica a plus de `REBASE_READ_MAX_LAG_MS` de retard ou est en échec. Remplit `readConnectionString` de l'adaptateur Postgres lorsque celle-ci n'est pas définie ; jusqu'à la version 0.28 incluse, le pool du réplica était ouvert sans jamais être sollicité en lecture. | — |
| `REBASE_READ_STICKY_MS` | Après une écriture, durée pendant laquelle les lectures du même utilisateur vont au primaire, de sorte qu'un enregistrement suivi d'une liste affiche l'enregistrement. Par instance de serveur. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Retard maximal du réplica au-delà duquel toutes les lectures basculent sur le primaire. | `1000` |
| `DATABASE_POOLED` | `true` lorsque `DATABASE_URL` passe par un pooler en mode transactionnel comme PgBouncer. Le pool n'envoie alors aucun `search_path` ou `statement_timeout` à la connexion (le pooler les refuserait ou les ignorerait) et applique les deux dans chaque transaction ; le démarrage attribue au rôle de base de données un `search_path` par défaut de `public` pour les instructions hors transaction. `DATABASE_DIRECT_URL` devient requis, et le temps réel, le réveil du worker de tâches, la création d'index, le branching et la console SQL l'utilisent tous. L'URL du réplica est considérée comme passant également par un pooler. `DATABASE_POOLED__<KEY>` pour une autre source de données. | — |
| `REBASE_DB_POOL_MAX` | Plafond pour chaque pool du processus, appliqué indépendamment de ce que chacun demandait. Chiffres bruts uniquement : une valeur malformée est ignorée au lieu de sérialiser silencieusement le serveur. | — |

### Comportement du runtime

Lu par le runtime — `rebase dev`, `rebase start` et l'image de serveur publiée.
Un projet qui s'est éjecté gère ces décisions dans son propre code.

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `REBASE_RLS_AUDIT` | `true` exécute l'[audit de sécurité au niveau des lignes](/docs/rls-check#running-it-on-a-schedule) planifié, qui signale les tables servies sans politiques. Le projet doit déclarer `@rebasepro/rls-check` parmi ses dépendances : le runtime n'en fournit pas de copie, et sans le paquet le démarrage refuse en le nommant. `false` maintient l'analyse désactivée sur ce processus. | — |
| `REBASE_RLS_REQUEST_ROLE` | Le rôle Postgres sous lequel s'exécutent les requêtes authentifiées et anonymes. Donnez-en un propre à chaque projet sur un cluster partagé. Une base de données enregistre le rôle sous lequel elle s'exécute, et un démarrage configuré pour un autre refuse de se lancer jusqu'à ce que `rebase db request-role migrate` l'ait déplacé. Voir [Exécution sur une base de données existante ou partagée](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` crée le rôle de requête et permet à la connexion d'y basculer ; `never` vous laisse la gestion des deux et se contente de les vérifier. | `auto` |
| `REBASE_RLS_GRANTS` | Ce que Rebase accorde au rôle de requête : `schema` (chaque table dans les schémas qu'il sert, plus les privilèges par défaut), `managed` (uniquement les tables qu'il sert) ou `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` restreint les politiques permissives de Rebase au(x) rôle(s) de requête, ainsi les autres rôles lisant les mêmes tables n'obtiennent rien d'elles. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` écrit les politiques que seul le contexte du serveur ou un administrateur peut valider `TO public`, et exécute les administrateurs en tant que rôle de requête. Par défaut, elles sont `TO rebase_admin`, de sorte que les lectures délimitées au propriétaire des utilisateurs connectés puissent utiliser l'index du propriétaire. Voir [Requêtes d'administration et `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` supprime la politique de base serveur-ou-administrateur de chaque table. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` définit également `request.jwt.claims` et `request.jwt.claim.*`, de sorte que les politiques écrites avec `auth.uid()` voient l'appelant. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | Action effectuée au démarrage lorsqu'un autre identifiant peut basculer vers le rôle de requête : `warn`, `refuse` ou `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Chemin de base pour chaque route d'API. Le client doit être configuré à l'identique — voir [Modifier `basePath`](#modifier-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Servir les ressources statiques/d'administration du bundle depuis ce processus. Désactivez-le lorsqu'un CDN est placé devant. | `true` |
| `REBASE_STUDIO` | Servir la console autonome intégrée Rebase Studio à l'adresse `/_studio` lorsqu'un bundle statique Studio est disponible. Définissez sur `false` pour désactiver. | `true` |
| `REBASE_STUDIO_DIR` | Répertoire contenant la SPA autonome Rebase Studio précompilée servie à l'adresse `/_studio`. La valeur par défaut est `/studio` dans l'image de conteneur. | `/studio` |
| `REBASE_HISTORY` | Enregistrer l'[historique des modifications d'entités](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Compresser les réponses en gzip/brotli. | `true` |
| `REBASE_PUSH` | `true` active les [notifications push](/docs/backend/push-notifications/) : les routes `/api/push`, la table `rebase.push_subscriptions` et `rebase.push`. | `false` |
| `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` | La paire de clés VAPID avec laquelle les messages push sont signés. Hors production, une paire est générée et conservée dans `.rebase-dev-secrets.json` lorsqu'elle n'est pas définie ; en production, le push reste désactivé sans elles. | — |
| `REBASE_VAPID_SUBJECT` | Une adresse `mailto:` ou une URL `https://` que les services push peuvent contacter. Par défaut, l'origine d'un `REBASE_PUBLIC_URL` en `https`. | — |
| `REBASE_MAX_BODY_SIZE` | Taille maximale du corps de requête, **en octets** (`10485760`, et non `10MB` — une valeur qui n'est pas un nombre refuse de démarrer au lieu de supprimer silencieusement la limite). `0` désactive la limite. | `10485760` (10 Mio) |
| `REBASE_ENABLE_SWAGGER` | L'exposition OpenAPI. À trois états. Non défini, dans chaque environnement : `/api/docs` est servi aux appelants auxquels `GET /api/schema/tables` décrit les tables, chacun recevant le document des tables qui lui sont décrites, et il n'y a pas d'interface Swagger UI. `true` publie l'intégralité du document à tout le monde, avec l'**interface** Swagger UI à `/api/swagger` hors production (jamais en production). `false` maintient le document derrière le contrôle d'accès administrateur. | — |
| `REBASE_METRICS` | Exposer les métriques Prometheus à `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Ajoute `includeSubDomains` à l'en-tête `Strict-Transport-Security`, de sorte que les navigateurs refusent le HTTP simple sur chaque sous-domaine de l'hôte pendant six mois — y compris les hôtes non servis par ce processus. Ne l'activez que si chaque sous-domaine du domaine est exclusivement en HTTPS. Toute valeur autre que `true`/`false` refuse de démarrer. Voir [En-têtes de sécurité](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Jeton Bearer protégeant `/metrics`. Non défini laisse le point de terminaison ouvert à tout ce qui peut joindre le port — acceptable sur un réseau privé, pas sur un réseau public, et les logs de démarrage le signalent. | — |
| `REBASE_MIGRATE_ON_BOOT` | Ce que le runtime peut faire sur le schéma des tables au démarrage. `ensure` (valeur par défaut partout — production comprise) exécute la passe **additive** : créer les tables, colonnes et types enum manquants, sans jamais en supprimer ou en réécrire. `none` ne touche pas au schéma des tables déclarées, mais les tables propres au framework (authentification, clés d'API, tâches, cron) sont toujours créées et tenues à jour ; `REBASE_PROVISION=false` désactive également ces dernières. L'image publiée n'accepte que ces deux valeurs et **refuse de démarrer sur `push`**. Dans un [déploiement scindé](/docs/deployment/split-processes), exactement un processus peut provisionner, chaque autre rôle doit donc définir `none` sous peine de refuser de démarrer. | `ensure` |
| `REBASE_PROVISION` | `false` empêche le runtime de modifier quoi que ce soit dans sa base de données : aucune table, colonne, index, fonction, déclencheur, politique, rôle ou droit, au démarrage ou ultérieurement, y compris ceux propres au framework. Il signale plutôt ce qui manque par son nom. Prévu pour une base de données que seul votre processus de gestion des changements peut modifier. Voir [Lorsque seul votre processus de changement peut modifier la base de données](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Seuls `true` et `false` sont acceptés. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Refuser de démarrer lorsque la base de données a été provisionnée pour la dernière fois à partir d'un ensemble de tables différent de celui à partir duquel ce processus a été construit. Non défini (ou toute autre valeur que `true`/`1`) émet un simple avertissement. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Refuser de démarrer lorsqu'un fichier de fonction ou de tâche cron lève une exception ou ne parvient pas à être analysé lors de l'importation, en nommant chaque fichier et la raison, afin qu'un déploiement progressif (rolling deploy) laisse l'ancienne version en service. Un redémarrage y est également soumis. Non défini (ou toute autre valeur que `true`) ignore le fichier et sert le reste. Un fichier qui s'importe correctement sans exporter de fonction ni de job est toujours ignoré, pas refusé. | skip |
| `REALTIME_CDC` | Capture de données modifiées (CDC) au niveau de la base de données : `auto` (lit les modifications depuis le WAL lorsque la base le permet, sinon utilise des triggers, sinon se rabat sur le niveau applicatif, en loguant chaque repli au niveau info), `trigger` (le force, avertit si impossible), `wal` (lit les modifications depuis le journal de transactions WAL au lieu des triggers ; nécessite `wal_level=logical` et un rôle autorisé à répliquer, se rabat sur `trigger` sinon), `off`. Voir [Realtime](/docs/backend/realtime-cdc/). Prévaut sur `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Transport inter-instances pour les canaux de diffusion et la présence : `memory` ou `postgres`. Ignoré lorsque `realtime.bus` a reçu un transport instancié. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Nombre d'abonnements qu'une socket temps réel peut détenir ; le suivant est refusé avec `TOO_MANY_SUBSCRIPTIONS`. Un entier strictement positif — toute autre valeur interrompt le serveur au démarrage. Prévaut sur `realtime.maxSubscriptionsPerSocket`. Voir [Temps réel](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Nombre de sockets temps réel qu'un utilisateur, ou une clé d'API, peut maintenir ouvertes sur une instance de serveur. Les sockets d'usurpation d'identité d'un administrateur sont décomptées pour cet administrateur. La connexion de la socket suivante est refusée avec `TOO_MANY_SOCKETS` et la socket est fermée (4002) ; le SDK réessaye continuellement, elle parvient donc à se connecter dès qu'une autre se ferme. Un nombre entier positif — toute autre valeur interrompt le serveur au démarrage. Prévaut sur `realtime.maxSocketsPerUser`. | Sans plafond |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Durée maximale d'attente d'une modification avant le rafraîchissement qui la distribue aux abonnés actifs, en ms. Un rafraîchissement attend 300 ms sans modification, et au maximum cette durée sous un flux régulier d'écritures. Un entier strictement positif — toute autre valeur interrompt le serveur au démarrage. Prévaut sur `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Durée pendant laquelle le total d'un abonnement à une grande liste peut être réutilisé avant d'être recompté, en ms ; les trames qui le réutilisent portent `meta.totalAsOf`. Non défini, chaque trame effectue le décompte. Prévaut sur `realtime.recountIntervalMs`. | Non défini |
| `REALTIME_RECOUNT_MIN_ROWS` | Le plus petit total précédent auquel `REALTIME_RECOUNT_INTERVAL_MS` s'applique ; les listes plus petites sont recomptées à chaque trame. Prévaut sur `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Autoriser les valeurs `localhost`/loopback sous `NODE_ENV=production`. Désactivé par défaut, afin qu'un démarrage en production échoue explicitement au lieu de se connecter à une base de données inexistante. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` exécute la passe de schéma et s'arrête sans ouvrir de socket — le format adapté à un Job de migration, à partir de la même image et du même bundle que le serveur qui le suit. Crée également les tables qu'un processus en production créerait autrement à la première utilisation, et ne démarre aucun cron ni file de tâches. Une valeur vide est considérée comme *non définie*, évitant qu'un `${SOMETHING}` non substitué dans un fichier compose ne transforme un déploiement ordinaire en un déploiement qui migre et refuse de servir. Refusé conjointement avec `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Un chemin de fichier. Une exécution de provisionnement (`REBASE_PROVISION_ONLY=true`) y consigne chaque modification de schéma effectuée, dans l'ordre, sous la forme d'un script SQL à examiner et appliquer avec `psql`. Les lignes écrites ne sont pas incluses. Refusé sur un processus en service actif. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` autorise une machine — un agent, un job CI — à *appliquer* une modification de schéma via `/api/admin/schema`, et pas seulement à en planifier une. Désactivé par défaut : l'identifiant permettant une telle modification est le plus susceptible de figurer dans une variable CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Durée maximale d'exécution d'une fonction personnalisée avant l'interruption de sa requête. Identique à l'option `functionsTimeoutMs`. `0` la désactive. Une fonction déclarant son propre délai (`defineFunction(…, { timeoutMs })`) utilise ce dernier à la place. | `30000` |
| `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` | Délai d'expiration maximal qu'une fonction peut s'attribuer via `defineFunction(…, { timeoutMs })`, en ms ; une fonction en demandant davantage recevra cette valeur. Nombre positif ; toute autre valeur est interprétée comme non définie. | `300000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` fait en sorte qu'un rejet de promesse non intercepté termine le processus au lieu de simplement le consigner. À activer sous un orchestrateur qui gérera le redémarrage ; à désactiver lorsqu'un redémarrage est plus préjudiciable qu'une fuite. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Coupe l'avertissement de démarrage sur une plateforme détectée par le runtime comme scale-to-zero (mise à l'échelle à zéro), où une minuterie se déclenchant dans une instance inactive ne se déclenche dans aucune instance. Ne modifie rien d'autre : activez-le lorsque vous maintenez au moins une instance en cours d'exécution. | — |
| `TRUSTED_PROXY_HOPS` | Nombre de proxys en amont de ce serveur, afin que le limiteur de débit puisse lire la véritable adresse client depuis `X-Forwarded-For`. Valeur par défaut sécurisée `0` : sans proxy, faire confiance à l'en-tête permettrait à tout appelant d'usurper son identité. | `0` |

:::note[Le provisionnement au démarrage est additif et n'est pas un outil de migration]
La passe de démarrage s'exécute de façon autonome sans intervention humaine pour analyser un diff ; elle ne supprimera donc jamais une colonne, ne réduira pas un type et ne réécrira pas une table. C'est également pour cette raison que l'image refuse `REBASE_MIGRATE_ON_BOOT=push` : un push complet calcule un diff et exécutera sans retenue `DROP COLUMN`, et le redémarrage d'un conteneur ne doit jamais pouvoir anéantir une colonne de production lors d'un réordonnancement.

Les modifications destructives ou de restructuration restent là où elles peuvent être vérifiées : `rebase db generate` + `rebase db migrate`, ou `rebase db push` depuis un checkout ou une CI, qui simule la modification, refuse les opérations destructives sans confirmation, et peut effectuer une sauvegarde préalable.
:::

### Déploiements scindés (Split deployments)

Une même image et un même bundle peuvent être démarrés plusieurs fois, chacun prenant en charge une partie distincte du projet. Une seule ligne par variable ici, car cette page a pour vocation de lister l'ensemble des variables ; le détail de ce que chaque combinaison *monte et possède* — ainsi que les combinaisons qui refusent de démarrer — se trouve sur **[Processus scindés](/docs/deployment/split-processes)**.

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `REBASE_ROLE` | Partie assurée par ce processus : `all`, `api`, `functions` ou `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Remplacer la décision de faire exécuter ou non les tâches cron par *ce* processus. Non défini suit le rôle. | — |
| `REBASE_JOB_WORKERS` | Remplacer la décision de faire exécuter ou non les workers de file de tâches par ce processus. Non défini suit le rôle. | — |
| `REBASE_FUNCTIONS_ONLY` | Ne servir que les fonctions personnalisées spécifiées dans ce processus. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Servir toutes les fonctions personnalisées à l'exception de celles spécifiées. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Emplacement vers lequel le processus API redirige une requête de fonction qu'il ne sert pas lui-même. Sur un `worker`, destination de ses propres appels `rebase.functions`. Une URL en `http(s)`. | — |

### Surface MCP

Un point de terminaison Model Context Protocol optionnel à `/mcp`, permettant à un client IA de lire et d'écrire sur ce projet **en tant qu'utilisateur connecté**. Désactivé par défaut, et — contrairement à toute autre surface — aucun `REBASE_ROLE` ne l'active : les autres décrivent une typologie de processus, tandis que celle-ci relève d'une décision délibérée de confier des identifiants à un logiciel tiers, qui doit être prise par une personne plutôt qu'héritée du rôle d'un conteneur.

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `REBASE_MCP_ENABLED` | Monter la surface MCP. Requiert `REBASE_PUBLIC_URL` ; sans elle, la surface refuse de se monter et le signale dans le log de démarrage. | `false` |
| `REBASE_PUBLIC_URL` | Origine accessible de l'extérieur pour ce déploiement, par ex. `https://app.example.com`. La surface MCP ne peut pas la déduire — extraire l'origine de l'en-tête `Host` transformerait l'identité de l'émetteur, ainsi que l'audience de validation de ses propres jetons, en une valeur fournie par l'appelant. | — |
| `REBASE_MCP_VIEW` | Chemin vers la vue MCP App propre au projet (`rebase-view.html`, générée par `rebaseMcpViewPlugin()`), servie à Claude à la place de la vue générique pour qu'il affiche vos vues, champs et actions personnalisés. Sans elle, le backend cherche à côté du frontend qu'il dessert. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Autoriser l'enregistrement dynamique de clients OAuth (RFC 7591), afin qu'un client puisse s'enregistrer de lui-même. Définissez sur `false` pour exiger que les clients soient enregistrés au préalable. | `true` |

### Édition de schéma en direct depuis un bundle

Désactivé sauf si `REBASE_LIVE_SCHEMA_REPOSITORY` est défini. Un bundle compilé ne dispose pas des sources `backend/schema` à éditer ; avec ces variables définies, l'éditeur de schéma lit les sources depuis le dépôt, commite chaque modification, et applique son DDL sur cette base de données. Réservé aux administrateurs, et appliqué par un humain sauf si `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` indique le contraire. Un dépôt désigné sans identifiant valide refuse de démarrer. Voir [Édition de schéma en direct](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Le dépôt GitHub sur lequel commiter les modifications de schéma, sous la forme `owner/name`. Définir cette variable active la fonctionnalité. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | La branche sur laquelle le commit est appliqué. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | Emplacement de `backend/schema` dans ce dépôt, relatif à celui-ci. Un chemin sortant du dépôt refuse de démarrer, tout comme l'ancienne variable supprimée `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Jeton d'accès précis (fine-grained token) avec accès en lecture et écriture au contenu du dépôt. Définissez soit cette variable, soit les trois variables `_GITHUB_APP_*`, mais pas les deux. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | Identifiant d'une application GitHub App, pour commiter au nom de l'application plutôt qu'avec un jeton. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | L'identifiant d'installation de l'application sur le dépôt. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | La clé privée de l'application : PEM, PEM avec retours à la ligne échappés, ou base64. | — |

### Sauvegardes

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `BACKUP_SCHEDULE` | Expression cron pour les sauvegardes planifiées. Non défini signifie que les sauvegardes automatiques sont désactivées. | — |
| `BACKUP_DESTINATION` | Chemin local, ou une URL `s3://bucket/prefix` / `gs://bucket/prefix`. Requis avec `BACKUP_SCHEDULE`, qui refuse de s'exécuter sans cela. `rebase db backup` se rabat sur `./backups` à l'endroit où elle a été lancée. | — |
| `BACKUP_RETENTION_DAYS` | Supprimer les sauvegardes datant de plus de N jours. Non défini ou `0` conserve l'ensemble. | — |
| `BACKUP_KEEP_MINIMUM` | Toujours conserver au moins N sauvegardes parmi les plus récentes, indépendamment de la rétention configurée. | — |
| `PG_DUMP_PATH` | Remplacer le binaire `pg_dump` — il doit correspondre à la version majeure du serveur ou être plus récent. | — |
| `PG_RESTORE_PATH` | Remplacer le binaire `pg_restore`. | — |
| `PSQL_PATH` | Remplacer le binaire `psql` que `rebase db restore --clean` exécute pour faire de la restauration une transaction unique. | — |
| `PG_DUMPALL_PATH` | Emplacement de `pg_dumpall`, lorsqu'il n'est pas dans le `PATH`. Sans lui — et sans les outils clients PostgreSQL installés — une sauvegarde des éléments globaux échoue avec une erreur mentionnant cette variable. | — |

L'image officielle du runtime (`rebasepro/server`) intègre les outils clients PostgreSQL 18, une sauvegarde planifiée peut donc s'y exécuter sur n'importe quel serveur jusqu'à Postgres 18. Hors de l'image, installez-les vous-même (`apt-get install postgresql-client-18`, `brew install libpq`).

Les sauvegardes contiennent des secrets et des données personnelles (PII). Utilisez une destination privée bénéficiant d'un chiffrement au repos.

### Livraison de bundle

Un déploiement géré n'embarque pas son code dans l'image : le runtime récupère un bundle au démarrage. Ces variables déterminent lequel et de quelle façon.

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `REBASE_BUNDLE` | Chemin vers un répertoire de bundle déjà extrait. Ce que `rebase start` définit localement. | — |
| `REBASE_BUNDLE_URL` | Emplacement d'où récupérer l'archive du bundle en l'absence de bundle local. | — |
| `REBASE_BUNDLE_TOKEN` | L'identifiant Bearer pour cette récupération. À traiter comme un secret : c'est ce qui autorise un tenant à télécharger son propre code. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Répertoire où un bundle récupéré est extrait. Doit être accessible en écriture et persister entre la récupération et le démarrage. | — |
| `REBASE_RUNTIME_MODULES` | Modules supplémentaires fournis par l'image de runtime au bundle, au-delà de ceux déclarés par le bundle lui-même. | — |

### Liaisons de ressources (Resource bindings)

Chaque base de données, bucket et topic déclaré par un projet dans `backend/resources.ts` est lié par des variables d'environnement nommées d'après lui. Les noms de base figurent ci-dessous ; une ressource qui n'est pas celle par défaut ajoute `__` suivi de sa clé en majuscules, ainsi un bucket nommé `media` lira `S3_BUCKET__MEDIA`. La commande `rebase status` affiche, pour chaque ressource, la variable exacte en cours de lecture et si celle-ci est définie.

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `REBASE_DRIVER` | Le paquet npm implémentant le pilote d'une source de données, lorsqu'il ne s'agit pas de celui par défaut de Postgres. Suffixé par source : `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | La chaîne de connexion pour un topic déclaré. Suffixé par topic. | — |

### L'environnement propre au CLI

Lu par `rebase`, et non par le serveur. Rien ici n'affecte un déploiement.

| Variable | Description | Valeur par défaut |
|----------|-------------|-------------------|
| `REBASE_BASE_URL` | Emplacement où `rebase api-keys`, `rebase storage` et `rebase auth reset-password` envoient la clé de service, dans le shell ou dans `.env`. Définissez-la lorsque le serveur s'exécute autrement que par `rebase dev` dans ce projet : `rebase start`, un conteneur, un autre hôte. Non définie, ces commandes utilisent le serveur enregistré par `rebase dev` pendant son exécution, et n'envoient rien s'il ne fonctionne pas. | — |
| `REBASE_SERVICE_KEY` | La clé de service avec laquelle ces commandes s'authentifient, lue depuis `.env` : la même variable que celle lue par le serveur (voir plus haut). | — |
| `SERVICE_KEY` | Un ancien nom pour cette clé. Lorsque `.env` la définit, `rebase api-keys` et `rebase storage` la lisent à la place de `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Fichier `.env` que le CLI lit et écrit lorsqu'il ne s'agit pas de celui du projet. | — |
| `REBASE_ROOT_RULES` | `0` empêche `rebase init` et `rebase skills install` d'écrire les règles du projet dans `CLAUDE.md` et `AGENTS.md` à la racine du dépôt, utile pour une racine dont vous gérez les fichiers d'agents manuellement. | on |
| `REBASE_CLOUD_URL` | Le plan de contrôle avec lequel `rebase cloud` communique. | — |
| `REBASE_CLOUD_EMAIL` | Le compte utilisé pour s'authentifier lors de `rebase cloud login`, au lieu d'une invite interactive. | — |
| `REBASE_CLOUD_PASSWORD` | Son mot de passe, permettant à un gestionnaire de secrets de le transmettre sans qu'il apparaisse dans l'historique du shell. | — |
| `REBASE_TOKEN` | Un jeton issu de `rebase cloud tokens create`. Défini, chaque commande `rebase cloud` s'authentifie avec celui-ci au lieu de la session de `rebase cloud login`, et ne lit ni n'écrit jamais la session stockée. Dans un répertoire lié par `rebase cloud init --claim`, il est ignoré au profit du propre jeton de ce projet s'il ne détient aucun scope sur le projet. La méthode appropriée pour exécuter `rebase cloud` en CI — voir [CI et agents](/docs/deployment/cloud/#ci-and-agents). Le [serveur MCP](/docs/ai/mcp/) le transmet au CLI engendré par ses outils cloud, et ne l'envoie jamais à l'application : définissez `REBASE_API_TOKEN` pour cela. | — |
| `REBASE_DEBUG` | `1` affiche l'erreur sous-jacente et les détails de la requête au lieu d'un message court. La première variable à définir lorsqu'une commande `rebase cloud` échoue sans explications claires. | — |
| `REBASE_ATLAS_DEV_URL` | La base de données vide sur laquelle `rebase db push`, `db generate` et `db migrate` planifient leurs modifications, au lieu de la base `<db>_dev_diff` qu'ils créent à côté de `DATABASE_URL`. Rebase ne crée ni ne supprime aucune base nommée ici, et refuse une base identique à `DATABASE_URL`. Sur la base de données de développement gérée, le CLI lui assigne une instance PGlite éphémère en mémoire lui appartenant. Définissez-la lorsque `CREATE DATABASE` n'est pas accordé. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` ne démarre aucune base de données et ne provisionne rien — vous devez fournir la vôtre. Identique à `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fixe le port du serveur de développement frontend, que `rebase dev` dérive sinon du chemin du projet. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Durée pendant laquelle `rebase dev` attend que le backend s'annonce avant d'indiquer qu'il n'a pas démarré. `0` désactive le rapport. | `30000` |
| `DATABASE_PASSWORD` | Le mot de passe que `rebase dev --docker` injecte dans la chaîne de connexion dérivée de `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | La convention standard multi-outils. Définie sur toute valeur autre que `0`, le CLI n'envoie aucune télémétrie. | — |
| `REBASE_TELEMETRY_DISABLED` | Identique, spécifique à Rebase. Ne requiert aucun fichier, c'est pourquoi elle est recommandée en CI et dans une image. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Destination d'envoi de la télémétrie, pour un collecteur auto-hébergé. | — |
| `REBASE_NO_UPDATE_CHECK` | `1` empêche le CLI d'interroger le registre npm (ou `npm_config_registry`), une fois par jour dans un processus d'arrière-plan, au sujet des dist-tags de `@rebasepro/cli`, et masque la ligne « Rebase X is out; this CLI is Y » que chaque commande hormis `rebase upgrade` affiche sur stderr. La réponse est conservée dans `~/.rebase/release-check.json`, et la requête ne transmet rien d'autre. Déjà désactivé en CI ; `NO_UPDATE_NOTIFIER` produit le même effet. | — |
| `REBASE_RELEASE_NOTICE_SHOWN` | Définie par le CLI pour les processus qu'il démarre, afin qu'une commande réexécutant le CLI n'affiche la ligne « Rebase X is out » qu'une seule fois. La définir vous-même masque la ligne pour ce processus, à l'instar de `REBASE_NO_UPDATE_CHECK`. | — |

## Secrets en développement

`JWT_SECRET` est requis en production. Cette variable ainsi que `REBASE_SERVICE_KEY`
sont générées automatiquement pour vous en dehors de la production, vous permettant de démarrer sans configuration préalable.

Ces valeurs générées sont mises en cache dans `.rebase-dev-secrets.json`, aux côtés de
`.rebase-dev-port` et `.rebase-dev-url`, et sont ignorées par git avec eux. Auparavant, elles
étaient régénérées à chaque démarrage — redémarrer le serveur de développement vous déconnectait
donc de votre propre application et invalidait toute clé d'API venant d'être créée.

- Définissez l'une ou l'autre explicitement et votre valeur sera utilisée ; rien ne sera mis en cache ni lu.
- Pointez le cache vers un autre emplacement avec `REBASE_DEV_SECRETS_FILE` — un chemin de fichier, et la
  seule variable de cette section qu'il y a lieu de définir délibérément.
- Supprimez le fichier pour renouveler les deux secrets. Le démarrage suivant en écrira un nouveau.
- Si le fichier ne peut pas être écrit — par exemple dans un conteneur en lecture seule — le serveur démarre
  malgré tout avec un secret éphémère, exactement comme auparavant.

Rien n'est mis en cache en production, ni sous un exécuteur de tests. En production, rien
n'est généré non plus : un démarrage sans `JWT_SECRET` échoue en nommant la variable, et
ce comportement reste inchangé :

```
The environment is not valid:
  JWT_SECRET: is required
```

## Objet de configuration du backend

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
sans `app`, `server` et `basePath` et avec un paramètre obligatoire `provision`, permettent de construire un
backend qui ne sert rien tant que vous ne le montez pas : `createRebaseBackend`. Voir
[Intégration d'un serveur personnalisé](/docs/backend/custom-server/).

### Modifier `basePath`

`basePath` déplace chaque route d'API, le client doit donc être configuré avec la même valeur —
faute de quoi il continuera de requêter `/api/...` et obtiendra des erreurs 404 sur chaque appel :

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

Le panneau d'administration récupère cette information depuis le client qui lui est fourni ; aucune autre
configuration n'est requise. Si vous construisez une URL de requête manuellement, concaténez-la à partir du client plutôt
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

* **Symptômes :** Les requêtes personnalisées exécutées dans l'éditeur SQL de Rebase Studio échouent avec l'erreur `cause: error: permission denied for table <name>`, alors même que la vue CMS en tableur charge les données correctement.
* **Cause :** Par défaut, Rebase tente d'exécuter les requêtes de l'éditeur SQL en basculant temporairement de rôle de base de données pour correspondre au rôle applicatif de l'utilisateur actif (par ex., `SET LOCAL ROLE "admin"`). Si vous utilisez une authentification personnalisée où les rôles n'existent que dans des tables de base de données et non comme de véritables rôles PostgreSQL, le changement de rôle échoue ou les privilèges de base de données manquent. La vue tableur du CMS s'exécute sous l'utilisateur propriétaire de la connexion par défaut et contourne ce mécanisme.
* **Solution :** Ajoutez `DISABLE_DB_ROLE_SWITCHING=true` dans la configuration de votre `.env` backend. Cela force Rebase à exécuter les requêtes de l'éditeur SQL avec les privilèges du propriétaire de la connexion (généralement un superuser/owner). L'éditeur SQL indique alors, au-dessus des résultats, qu'ils ont été lus en tant que propriétaire de la connexion, et grise son sélecteur de rôle.

### Échec de récupération du schéma dans l'éditeur SQL (`Cross-database execution requires adminConnectionString`)

* **Symptômes :** Studio ne parvient pas à charger l'arborescence des schémas, ou l'éditeur SQL renvoie l'erreur `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Cause :** Rebase requiert des privilèges administratifs pour interroger les catalogues système de la base de données et exécuter des commandes d'administration. Si `adminConnectionString` n'est pas fourni au bootstrapper, ou si `getAdmin()` est surchargé pour renvoyer `undefined`, ces opérations échouent.
* **Solution :** Assurez-vous que `adminConnectionString` est configuré lors de l'initialisation du bootstrapper du backend :
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Étapes suivantes

- **[Déploiement](/docs/getting-started/deployment)** — Guide de déploiement en production
- **[Vue d'ensemble du backend](/docs/backend)** — Référence complète de configuration du backend
