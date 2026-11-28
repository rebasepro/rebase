---
sourceHash: dae0d9a7e36f01c4
title: Environnement & Configuration
sidebar_label: Configuration
description: Toutes les variables d'environnement et options de configuration pour les projets Rebase.
---

## Variables d'environnement

Toute la configuration s'effectue via des variables d'environnement dans votre fichier `.env` situé à la racine du projet.

> **Important** : Rebase valide les variables d'environnement avec **Zod** au démarrage. Si
> un élément requis est manquant ou mal formé (une URL qui n'est pas une URL, un port qui
> n'est pas un nombre), le serveur refuse de démarrer et indique la variable concernée.
>
> L'emplacement du schéma dépend de la façon dont vous exécutez le backend. Un projet démarré par
> le runtime — `rebase dev`, `rebase start`, l'image publiée — utilise le
> schéma détenu par le runtime (`loadBootEnv` dans `@rebasepro/server`), qui correspond à
> l'union de chaque tableau ci-dessous. Un projet ayant exécuté [`rebase eject`](/docs/cli)
> possède un fichier `backend/src/env.ts` appelant `loadEnv({ extend })`, et peut y ajouter ses
> propres variables typées.

### Requis

| Variable | Description | Exemple |
|----------|-------------|---------|
| `DATABASE_URL` | Chaîne de connexion PostgreSQL. **Optionnel en développement** — si non défini, `rebase dev` exécute un PostgreSQL géré pour le projet, avec ses données sous `.rebase/`. Requis partout ailleurs. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Clé secrète pour signer les jetons JWT. Utilisez une chaîne aléatoire robuste (min 32 caractères). **Requis en production** (généré automatiquement en développement). | `a1b2c3d4e5...` |

> **Sur une base de données managée, `sslmode=require` peut ne pas signifier ce qu'il indique.**
>
> Pour `psql` et tous les outils libpq, `require` signifie « chiffré, certificat non
> vérifié ». Le pilote Node sur lequel fonctionne Rebase l'interprète comme `verify-full`, ainsi une
> base de données dont le certificat n'a été signé par aucune autorité publique — courant sur Postgres
> managé — rejette le runtime avec `self-signed certificate`, alors que `psql`
> se connecte avec la même URL. Le runtime et les commandes `rebase db` s'arrêtent avec un
> message indiquant cela.
>
> Choisissez l'une des options suivantes :
>
> - **`sslmode=no-verify`** — chiffré, non vérifié : ce que `require` signifie pour
>   libpq. Il s'agit d'une syntaxe propre à node-postgres que libpq ne possède pas, donc `psql`, `pg_dump`
>   et Atlas la refusent avec `invalid sslmode value: "no-verify"`. Les commandes propres à Rebase
>   (`rebase db push`, `rebase db backup`, `rebase db restore`) la leur transmettent sous la forme
>   `sslmode=require`, afin qu'elles fonctionnent avec l'URL telle que configurée ; pour
>   `psql` manuellement, remplacez par `sslmode=require`.
> - **`sslmode=verify-full&sslrootcert=/path/to/ca.pem`** — vérifié par rapport au
>   certificat CA du fournisseur. Identique pour chaque outil.
>
> `uselibpqcompat=true&sslmode=require`, suggéré par l'avertissement du pilote Node
> lui-même, fonctionne également pour le runtime ; les commandes de Rebase retirent `uselibpqcompat`
> avant de transmettre l'URL aux outils libpq, qui le rejettent.

### Frontend

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `VITE_API_URL` | URL de l'API backend pour le SDK typé. **Définissez ceci uniquement en développement** — voir ci-dessous. | origine de la page |
| `VITE_GOOGLE_CLIENT_ID` | Identifiant client Google OAuth. Active « Se connecter avec Google ». | — |


> **Laissez `VITE_API_URL` non défini dans les builds de production.**
>
> En développement, le frontend et le backend ont des origines distinctes, le serveur de développement
> injecte donc ceci. En production, le backend Rebase sert la SPA, l'API correspond
> donc à l'origine même de la page et le client la résout de cette façon de manière autonome.
>
> Intégrer en dur une URL absolue dans un bundle de production fonctionne jusqu'au moment où un second
> nom d'hôte pointe vers la même application : un domaine personnalisé charge alors la page depuis
> `example.com` et appelle l'API sur `example.rebase.website`, ce qui est
> cross-origin, faisant échouer chaque requête au preflight. Autoriser l'origine dans CORS
> ne résout **pas** le problème non plus — le cookie de rafraîchissement est en `SameSite=Lax` et n'est
> pas envoyé cross-site, vous supprimeriez donc les erreurs de console tout en conservant une
> authentification cassée. Si la variable n'est pas définie, chaque domaine pointant vers l'application fonctionne sans
> aucune configuration CORS.

### Backend

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `PORT` | Port pour le serveur HTTP backend. Lu par `rebase start`. `rebase dev` le lit **depuis l'environnement du shell uniquement** — un `PORT` dans `.env` n'y est pas lu, car le port est résolu avant que ce fichier ne soit chargé — et associe sinon un port dérivé du chemin du projet, afin que plusieurs projets puissent tourner en même temps. `rebase dev --port` est prioritaire sur les deux, et la bannière de démarrage indique le niveau utilisé. | `3001` |
| `LOG_LEVEL` | Niveau de verbosité des logs : `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Affiche le SQL derrière une ligne `Failed query: [redacted]`. Chaque instruction en échec est masquée par défaut, car une requête échouée transporte ses paramètres liés — un email, un hash de mot de passe. Définissez-le à `true` lors du diagnostic d'une panne de DDL, de RLS ou de capture de changements. Ignoré lorsque `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Environnement : `development`, `production`, ou `test` | `development` |
| `CORS_ORIGINS` | Liste séparée par des virgules des origines autorisées. **Requis en production** à moins que `FRONTEND_URL` ne soit défini : un démarrage en production sans l'un ni l'autre refuse de démarrer. En développement, il est *ajouté à* localhost — voir ci-dessous. | — |
| `FRONTEND_URL` | URL de l'application frontend. Utilisé comme alternative à CORS_ORIGINS, dans les deux environnements. | — |
| `ADMIN_CONNECTION_STRING` | Chaîne de connexion à la base de données avec privilèges administrateur (utilisée pour l'introspection du schéma et les opérations d'administration). La base de données désignée n'est pas celle que la console SQL qualifie d'actuelle, ni celle qu'une nouvelle branche copie par défaut : les deux correspondent à la base sur laquelle se trouve la connexion propre à l'application (voir `REBASE_BRANCH_PARENT_DATABASE` pour un serveur sur une branche). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Désactive le changement de rôle PostgreSQL dans l'éditeur SQL (utile pour l'authentification personnalisée où les rôles DB ne sont pas mappés). La console SQL de Studio indique alors que les lignes ont été lues en tant que propriétaire de la connexion, le nomme, et grise son sélecteur de rôle. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | La base de données depuis laquelle la branche sur laquelle ce serveur tourne a été copiée. `rebase dev` la définit sur un checkout [basculé sur une branche](/docs/backend/branching/#cli-integration). Un serveur disposant de cette variable conserve le registre de branches sur cette base de données et copie de nouvelles branches à partir d'elle par défaut, afin que le volet Branches de Studio affiche les branches de la base principale. | — |

#### CORS en développement

Le développement autorise **localhost, en plus de tout ce que `CORS_ORIGINS` (ou `FRONTEND_URL`)
désigne** — la même liste que celle utilisée en production, avec localhost ajouté plutôt que
substitué. La variable fonctionne donc de la même manière dans les deux environnements, et les
cas nécessitant son usage en développement sont classiques :

```bash
# Un téléphone sur le réseau local, la machine d'un collègue, un tunnel ngrok,
# un port Codespaces redirigé — toutes les origines non-localhost.
CORS_ORIGINS=http://192.168.1.5:5173
```

Une origine qui n'est ni localhost ni listée est refusée, et le refus est
journalisé **une seule fois par origine** avec la ligne exacte qui permettrait de l'autoriser. Ce refus
n'est pas une précaution superflue : l'API transmet des identifiants (credentials), refléter
un `Origin` arbitraire permettrait donc à n'importe quel site visité par le développeur d'effectuer
des requêtes authentifiées contre le serveur de dev avec sa session et d'en lire
les réponses.

### Authentification

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `JWT_SECRET` | Secret pour la signature JWT (requis en production, auto-généré en développement) | — |
| `JWT_PRIVATE_KEY` | Clé privée PEM pour signer les jetons d'accès de manière asymétrique (RS256), afin que toute entité détenant les JWKS puisse vérifier une session sans pouvoir en générer une. Accepte un PEM avec de vrais sauts de ligne, un PEM avec des échappements `\n`, ou le PEM complet en base64. Sans cela, les jetons restent en HS256. | — |
| `JWT_KEY_ID` | Identifie `JWT_PRIVATE_KEY` dans l'en-tête du jeton et dans les JWKS. Modifiez-le chaque fois que la clé change — la rotation nécessite que l'ancienne et la nouvelle soient différentiables. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Durée de vie du jeton d'accès | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Durée de vie du jeton de rafraîchissement. Glissante — chaque rotation la renouvelle, cela régit donc la durée de survie d'une session face à **l'inactivité**. Définissez `400d` pour les sessions devant survivre à une longue absence ; les navigateurs plafonnent le cookie de rafraîchissement à cette valeur. | `30d` |
| `ALLOW_REGISTRATION` | Autorise les nouveaux utilisateurs à s'inscrire (`true`/`false`). Hors production, le **premier** utilisateur peut toujours s'inscrire, quelle que soit cette valeur — une table d'utilisateurs vide doit admettre quelqu'un, et ce quelqu'un devient administrateur. En production (`NODE_ENV=production`), cette fenêtre est fermée : une table vide refuse l'inscription d'amorçage avec `SETUP_REQUIRED`, un premier compte créé via l'inscription ouverte est un compte ordinaire, et l'administrateur est défini via `REBASE_ADMIN_EMAIL` ci-dessous ou assigné via la clé de service. Le fichier `.env.example` du scaffold la définit à `true` ; la valeur par défaut du framework est désactivée. | `false` |
| `DISABLE_SELF_REGISTRATION` | Interrupteur d'urgence. Ferme la fenêtre d'amorçage du premier utilisateur que `ALLOW_REGISTRATION=false` laisse délibérément ouverte hors production, rendant l'inscription fermée même sur une base de données vide. À associer avec `REBASE_ADMIN_EMAIL` ci-dessous, sinon le déploiement n'aura aucun moyen de produire son premier appelant authentifié. Tout artefact de déploiement livré le définit. | — |
| `REBASE_ADMIN_EMAIL` | Adresse email du premier compte administrateur, créé au démarrage **tant que la table des utilisateurs est encore vide** et jamais par la suite. C'est ainsi qu'un déploiement de production obtient son admin : l'opérateur désigne le premier compte au lieu de faire la course avec Internet. Le démarrage émet un avertissement si la table est vide en production et que cette variable n'est pas définie. | — |
| `REBASE_ADMIN_PASSWORD` | Mot de passe de ce compte. Au moins 12 caractères, sinon il est refusé et le compte n'est pas créé. Modifiez-le après la première connexion. | — |
| `MFA_ENCRYPTION_KEY` | Chiffre chaque secret TOTP stocké. Si non défini, les secrets sont chiffrés avec `JWT_SECRET` à la place et le démarrage émet un avertissement unique — ainsi, la rotation de `JWT_SECRET` déconnecte tout le monde *et* rend tout authentificateur enregistré indéchiffrable. Définissez une clé dédiée (32+ caractères aléatoires) avant toute inscription d'utilisateur. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | L'ancienne clé lors d'une rotation. Définissez les deux pendant une rotation : les nouveaux secrets sont écrits avec `MFA_ENCRYPTION_KEY` et les existants restent lisibles, afin que personne ne soit bloqué hors de son compte pendant la rotation. Supprimez-la une fois que chaque secret a été ré-encrypté. | — |
| `ALLOW_ANONYMOUS` | Active la connexion anonyme (`POST /api/auth/anonymous`). Optionnel (opt-in), et délibérément non conditionné par `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Exige une authentification pour l'API de données. Définissez à `false` pour une surface de lecture totalement publique — la RLS s'applique toujours. | `true` |
| `AUTH_DEFAULT_ROLE` | Rôle attribué à un utilisateur nouvellement inscrit si aucun n'est fourni. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Monte la route `POST /api/auth/find-user`, qui résout un email en un profil public minimal (`uid`, `displayName`, `photoURL`) pour les flux d'invitation par email. Appelants authentifiés uniquement, et ne renvoie jamais l'email, les rôles ou les métadonnées de l'utilisateur trouvé. Désactivé par défaut : il s'agit d'une surface d'énumération. | `false` |
| `AUTH_COOKIE_SAME_SITE` | `SameSite` sur le cookie de rafraîchissement : `Strict`, `Lax` ou `None`. `None` requiert HTTPS et s'adresse uniquement à un frontend véritablement cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | `Secure` sur le cookie de rafraîchissement. Sécurisé par défaut ; `AUTH_COOKIE_SECURE=false` pour le http simple — un déploiement sur une adresse de réseau local où le navigateur abandonnerait sinon le cookie et où la session expirerait à l'échéance du jeton d'accès sans erreur. Émet un avertissement au démarrage. `http://localhost` n'en a pas besoin. | `true` |
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
| `APPLE_CLIENT_ID` | Apple Services ID, pour la connexion web. Il est public et exposé dans `GET /auth/config`. Apple n'a pas de secret client statique, car Rebase signe un JWT ES256 à courte durée de vie pour chaque échange de jetons. Apple requiert donc `APPLE_TEAM_ID`, `APPLE_KEY_ID` et `APPLE_PRIVATE_KEY`, en plus de cette variable ou de `APPLE_BUNDLE_IDS`, et ne configure rien sans elles. | — |
| `APPLE_BUNDLE_IDS` | Liste séparée par des virgules des identifiants de bundle des applications natives iOS/macOS dont les codes de connexion Sign in with Apple sont acceptés. | — |
| `APPLE_TEAM_ID` | Team ID Apple Developer, l'émetteur du JWT. | — |
| `APPLE_KEY_ID` | Identifiant de clé (Key ID) de la clé privée enregistrée auprès d'Apple. | — |
| `APPLE_PRIVATE_KEY` | Contenu du fichier de clé privée `.p8`, sauts de ligne compris (les échappements `\n` sont acceptés). | — |
| `REBASE_SERVICE_KEY` | Clé d'API d'administration statique. Contourne l'authentification JWT classique pour les appels serveur à serveur lorsqu'elle est transmise sous la forme `Authorization: Bearer <key>`. (Générée automatiquement en développement). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Clé publique de la plateforme d'hébergement (PEM, EC P-256) utilisée pour vérifier les jetons de plateforme `rpt_` ; plusieurs blocs PEM lors d'une rotation de clé. La plateforme la définit lors du déploiement, et elle ne contient aucun secret. Associée à `REBASE_PLATFORM_TOKEN_AUDIENCE`, elle permet au portail d'administration d'accepter un jeton de plateforme pour `cron:read`, et pour rien d'autre. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | L'identifiant de projet auquel le champ `aud` d'un jeton de plateforme doit correspondre, de sorte qu'un jeton généré pour un autre projet soit refusé. Si une seule des deux variables est définie, le serveur démarre, consigne un avertissement et répond à chaque jeton `rpt_` par un `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_PLATFORM_SIGNIN_URL` | Destination du bouton **Continue with Rebase Cloud** du panneau d'administration : la page du projet dans la console de la plateforme, qui connecte les propriétaires du projet et revient. La plateforme la définit au déploiement avec les deux précédentes ; grâce à elles, `POST /api/auth/platform-signin` accepte le jeton d'une minute `auth:admin-signin` de la plateforme et ouvre une session administrateur. Sans elle, l'accès fonctionne toujours depuis le bouton **Open CMS** de la console, et l'écran de connexion se contente de l'expliquer. | — |
| `REBASE_RATE_LIMIT_STORE` | Emplacement de stockage des compteurs de limitation de débit (rate limit), pour les routes d'authentification et pour `rateLimit` dans les fonctions personnalisées : `memory` (par processus) ou `sql` (partagé entre les répliques). Un processus ne pouvant pas voir le nombre de ses répliques, un déploiement avec plusieurs pairs doit le spécifier — trois répliques sur la valeur par défaut appliquent trois fois la limite. Toute autre valeur **refuse de démarrer** au lieu d'utiliser une solution de repli, y compris `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Monte le flux de lien de connexion sans mot de passe (magic link). Nécessite un service d'email configuré, sans quoi le lien ne peut être envoyé. | `false` |
| `AUTH_EMAIL_OTP` | Monte la connexion sans mot de passe via un code à six chiffres envoyé par email. Même prérequis d'email que ci-dessus. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Inscription sans mot de passe : une demande de magic link ou de code email pour une adresse inconnue crée le compte, tant que les inscriptions sont ouvertes. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Action lorsqu'un jeton de rafraîchissement est rejoué après sa fenêtre de réutilisation : `reject` (le refuser, conserver la session) ou `revoke-session` (mettre fin à la session). Toute autre valeur fait échouer le démarrage. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Inscription avec confirmation préalable : aucune connexion par mot de passe tant que l'adresse n'est pas vérifiée. Nécessite l'email ; le démarrage le refuse sans cela. | `false` |
| `CAPTCHA_PROVIDER` | Active la vérification par captcha sur les routes d'authentification : `turnstile` ou `hcaptcha`. Non défini signifie aucun captcha. | — |
| `CAPTCHA_SECRET` | Secret du fournisseur, utilisé côté serveur pour vérifier le jeton envoyé par le navigateur. Requis dès que `CAPTCHA_PROVIDER` est défini. | — |
| `CAPTCHA_ROUTES` | Liste séparée par des virgules des routes d'authentification à protéger (par exemple `register,login`). Non défini protège l'ensemble par défaut du fournisseur. | — |

### Stockage (Storage)

:::caution[Le stockage n'a pas de sécurité au niveau des lignes (RLS), il nécessite donc un modèle d'accès]
Les tables sont protégées par la RLS de Postgres. Le stockage d'objets n'a pas d'équivalent —
les clés partagent un espace de noms plat unique — ainsi, avec un bucket configuré sans modèle d'accès,
le serveur **refuse de démarrer en production**. Remplissez cette condition avec exactement l'un des éléments suivants :
un hook `storageAuthorize` exporté depuis `backend/storage.ts` (ce que fournit le scaffold),
`STORAGE_POLICIES`, `STORAGE_PUBLIC_READ`, ou `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `STORAGE_TYPE` | Backend de stockage : `local`, `s3`, `gcs`, ou `platform` (fichiers dans un préfixe détenu par la plateforme d'hébergement, transférés via des URL signées par son broker de stockage ; défini par la plateforme). En production, `local` désactive le stockage sauf si `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Chemin de base pour le stockage local. Un chemin relatif est lu à partir du répertoire dans lequel le serveur s'exécute : la racine du projet sous `rebase dev`, `backend/` dans un serveur généré par `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Autorise le stockage local en production — uniquement avec un volume persistant contenant `STORAGE_PATH` et les répertoires `<STORAGE_PATH>__<key>` des buckets locaux nommés à ses côtés | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Durée en secondes pendant laquelle l'URL de téléchargement d'un fichier privé est valide — le jeton que `getSignedUrl()` y insère. Au maximum `604800` (une semaine) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Taille maximale de fichier acceptée par la source, en octets, sur chaque chemin d'upload — `__<KEY>` pour une source nommée. Une valeur qui n'est pas un nombre entier d'octets refuse le démarrage | `52428800` (50 Mo) |
| `S3_BUCKET` | Nom du bucket S3 (quand `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Région AWS | — |
| `S3_ACCESS_KEY_ID` | Clé d'accès AWS | — |
| `S3_SECRET_ACCESS_KEY` | Clé secrète AWS | — |
| `S3_ENDPOINT` | Point de terminaison (endpoint) S3 personnalisé (pour MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Force les URL de type path-style pour le bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nom du bucket GCS (quand `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Projet GCP. Généralement déduit des identifiants. | — |
| `GCS_KEY_FILENAME` | Chemin vers un fichier de clé de compte de service. À omettre sur GCP, où Workload Identity fournit les identifiants. | — |
| `STORAGE_PUBLIC_READ` | Sert chaque objet à tout le monde, sans jeton. Uniquement pour un bucket qui sert véritablement de CDN public. L'une des façons de satisfaire la vérification au démarrage mentionnée ci-dessus. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permet à tout appelant connecté de lire, écrire, lister et supprimer chaque objet. Nommé `INSECURE` dans l'objet de configuration pour une bonne raison : cela n'est défendable que dans une application mono-tenant où chaque compte a accès à l'ensemble des fichiers. | `false` |
| `STORAGE_POLICIES` | Règles d'accès au stockage en JSON : `[{ "path", "operations"?, "allow" }]`, `allow` étant `"public"`, `"authenticated"`, `"owner"` ou `{ "roles": [...] }`. Refuse par défaut, et satisfait le garde-fou au démarrage. Une liste invalide refuse le démarrage. Voir [Autorisation du stockage](/docs/backend/storage-authorization/#as-data-storage_policies). | — |
| `STORAGE_BROKER_URL` | Le broker de stockage de la plateforme, pour `STORAGE_TYPE=platform`. Défini par la plateforme qui exécute le broker. | — |
| `STORAGE_BROKER_PROJECT` | L'identifiant de projet auquel le broker restreint les fichiers de ce déploiement, pour `STORAGE_TYPE=platform`. Défini par la plateforme. | — |
| `STORAGE_RENDITION_CACHE` | Met en cache les rendus d'images générés (redimensionnements, conversions de format) au lieu de les produire à chaque requête. | `false` |

### Email (Optionnel)
`MAGIC_LINK_URL`.

| Variable | Description |
|----------|-------------|
| `SMTP_HOST` | Hôte du serveur SMTP |
| `SMTP_PORT` | Port du serveur SMTP |
| `SMTP_SECURE` | Active la connexion sécurisée (`true`/`false`) |
| `SMTP_USER` | Nom d'utilisateur SMTP |
| `SMTP_PASS` | Mot de passe SMTP |
| `SMTP_FROM` | Adresse d'expédition pour les emails système |
| `SMTP_NAME` | Nom d'affichage de l'adresse d'expédition |
| `APP_NAME` | Nom du produit utilisé dans les objets et corps d'emails (par défaut : `Rebase`) |
| `EMAIL_LOGO_URL` | Logo affiché en haut des modèles d'email par défaut. PNG ou JPG absolu en `http(s)` — les clients de messagerie suppriment les SVG et bloquent les URI `data:`. Si non défini, une application encore nommée `Rebase` reçoit le logo Rebase et une application renommée n'en reçoit aucun |
| `MAGIC_LINK_URL` | Destination d'un lien magique envoyé par email. Une base se voit ajouter `/auth/magic-link?token=…` ; une URL contenant `{token}` représente le lien complet, pour un frontend qui ne dessert pas `/auth/magic-link`. Mettez-la entre guillemets dans `.env`, où un `#` non cité commence un commentaire : `MAGIC_LINK_URL="https://app.example.com/app.html#ml={token}"`. Une valeur contenant un hash ou un chemin de fichier et aucun `{token}` fait l'objet d'un avertissement au démarrage. Si non défini, la base est `FRONTEND_URL` |

### Pool de connexions à la base de données

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `DB_POOL_MAX` | Nombre maximal de connexions dans le pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Durée en millisecondes de conservation d'une connexion inactive | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Durée en millisecondes d'attente pour une connexion | `10000` |
| `DATABASE_DIRECT_URL` | Connexion directe (hors pool). Le [temps réel](/docs/backend/realtime) en a besoin : `LISTEN`/`NOTIFY` ne survit pas à un pooler en mode transactionnel tel que PgBouncer, et sans cela les notifications de changement sont désactivées avec un avertissement plutôt que perdues silencieusement. Le [worker de tâches](/docs/backend/jobs) y maintient également son `LISTEN` de réveil. Remplit le `directConnectionString` de l'adaptateur Postgres lorsque celui-ci n'est pas défini. | — |
| `DATABASE_READ_URL` | Réplique en lecture, comme un hot standby. Lorsqu'elle désigne un autre serveur, les lectures authentifiées (listes, lignes individuelles, décomptes, agrégats) y sont servies sous la même sécurité au niveau des lignes ; les écritures, l'authentification, le temps réel, les tâches cron, les jobs, la console SQL et `rebase.sql` restent sur le primaire. Un lecteur venant d'écrire lit depuis le primaire pendant `REBASE_READ_STICKY_MS`, et tout le monde le fait tant que la réplique a un retard supérieur à `REBASE_READ_MAX_LAG_MS` ou est en échec. Remplit le `readConnectionString` de l'adaptateur Postgres s'il n'est pas défini ; jusqu'à la version 0.28 incluse, le pool de la réplique était ouvert mais jamais utilisé pour la lecture. | — |
| `REBASE_READ_STICKY_MS` | Après une écriture, durée pendant laquelle les lectures du même utilisateur vont au primaire, de sorte qu'une sauvegarde suivie d'une liste affiche la modification. Par instance de serveur. | `5000` |
| `REBASE_READ_MAX_LAG_MS` | Retard maximal de la réplique au-delà duquel chaque lecture est dirigée vers le primaire. | `1000` |
| `DATABASE_POOLED` | `true` lorsque `DATABASE_URL` passe par un pooler en mode transactionnel comme PgBouncer. Le pool n'envoie alors aucun `search_path` ou `statement_timeout` à la connexion (le pooler les refuserait ou les ignorerait) et applique les deux dans chaque transaction ; le démarrage attribue au rôle de base de données un `search_path` par défaut fixé à `public` pour les instructions hors transaction. `DATABASE_DIRECT_URL` devient requis, et le temps réel, le réveil du job worker, la création d'index, les branches et la console SQL l'utilisent tous. L'URL de la réplique est également considérée comme utilisant un pool. Utilisez `DATABASE_POOLED__<KEY>` pour une autre source de données. | — |
| `REBASE_DB_POOL_MAX` | Plafond s'appliquant à chaque pool du processus, quelle que soit la valeur demandée par chacun d'eux. Chiffres uniquement : une valeur mal formée est ignorée plutôt que de sérialiser silencieusement le serveur. | — |

### Comportement du runtime

Lu par le runtime — `rebase dev`, `rebase start` et l'image serveur publiée.
Un projet éjecté prend ces décisions dans son propre code.

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `REBASE_RLS_AUDIT` | `true` exécute l'[audit de sécurité au niveau des lignes](/docs/rls-check#running-it-on-a-schedule) planifié, qui signale les tables exposées sans politiques de sécurité. Le projet doit déclarer `@rebasepro/rls-check` parmi ses dépendances : le runtime n'en intègre aucune copie, et sans ce paquet le démarrage est refusé, en le nommant. `false` désactive le scan sur ce processus. | — |
| `REBASE_RLS_REQUEST_ROLE` | Le rôle Postgres sous lequel s'exécutent les requêtes authentifiées et anonymes. Attribuez un rôle distinct à chaque projet sur un cluster partagé. Une base de données enregistre le rôle sous lequel elle s'exécute, et un démarrage configuré pour un autre rôle refuse de se lancer tant que `rebase db request-role migrate` ne l'a pas déplacé. Voir [Exécution sur une base de données existante ou partagée](/docs/deployment/existing-database/). | `rebase_user` |
| `REBASE_RLS_PROVISION_ROLE` | `auto` crée le rôle de requête et permet à la connexion d'y basculer ; `never` vous laisse gérer les deux et se contente de les vérifier. | `auto` |
| `REBASE_RLS_GRANTS` | Ce que Rebase accorde au rôle de requête : `schema` (chaque table dans les schémas qu'il sert, plus les privilèges par défaut), `managed` (uniquement les tables qu'il sert) ou `none`. | `schema` |
| `REBASE_RLS_POLICY_TARGET` | `requestRole` restreint les politiques permissives de Rebase au(x) rôle(s) de requête, de sorte que les autres rôles lisant les mêmes tables ne reçoivent rien de celles-ci. | `public` |
| `REBASE_RLS_ADMIN_POLICIES` | `public` écrit les politiques que seul le contexte serveur ou un administrateur peut franchir sous la forme `TO public`, et exécute les admins sous le rôle de requête. Par défaut, elles sont configurées sur `TO rebase_admin`, afin que les lectures des utilisateurs connectés limitées au propriétaire puissent utiliser l'index de propriétaire. Voir [Requêtes d'administration et `rebase_admin`](/docs/deployment/existing-database/#admin-requests-and-rebase_admin). | `adminRole` |
| `REBASE_RLS_DEFAULT_POLICIES` | `false` supprime la politique de base serveur-ou-admin de chaque table. | `true` |
| `REBASE_RLS_IDENTITY` | `supabase` définit également `request.jwt.claims` et `request.jwt.claim.*`, de sorte que les politiques écrites avec `auth.uid()` voient l'appelant. | `rebase` |
| `REBASE_RLS_SHARED_ROLE` | Comportement au démarrage lorsqu'un autre identifiant peut basculer vers le rôle de requête : `warn`, `refuse` ou `ignore`. | `warn` |
| `REBASE_BASE_PATH` | Chemin de base pour chaque route d'API. Le client doit être informé de la même valeur — voir [Modification de `basePath`](#modification-de-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Sert les assets statiques/d'administration du bundle depuis ce processus. Désactivez-le lorsqu'un CDN est placé devant. | `true` |
| `REBASE_STUDIO` | Sert le panneau d'administration intégré sur `/_studio` lorsque son bundle statique est disponible : les tables d'un projet sous forme de collections, ses utilisateurs et ses rôles parmi elles, ainsi que le Studio. C'est l'outil avec lequel un projet sans code est administré. Définissez à `false` pour désactiver. | `true` |
| `REBASE_STUDIO_DIR` | Répertoire contenant le panneau d'administration précompilé servi sur `/_studio`. Vaut par défaut `/studio` dans l'image de conteneur. | `/studio` |
| `REBASE_HISTORY` | Enregistre l'[historique des modifications d'entités](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Réponses compressées en gzip/brotli. | `true` |
| `REBASE_PUSH` | `true` active les [notifications push](/docs/backend/push-notifications/) : les routes `/api/push`, la table `rebase.push_subscriptions` et `rebase.push`. | `false` |
| `REBASE_VAPID_PUBLIC_KEY`, `REBASE_VAPID_PRIVATE_KEY` | La paire de clés VAPID avec laquelle les messages push sont signés. Hors production, une paire est générée et conservée dans `.rebase-dev-secrets.json` si elle n'est pas définie ; en production, le push reste désactivé sans elles. | — |
| `REBASE_VAPID_SUBJECT` | Une adresse `mailto:` ou une URL `https://` que les services de push peuvent contacter. Vaut par défaut l'origine d'un `REBASE_PUBLIC_URL` en `https`. | — |
| `REBASE_MAX_BODY_SIZE` | Taille maximale du corps de la requête, **en octets** (`10485760`, pas `10MB` — une valeur qui n'est pas un nombre refuse de démarrer plutôt que de supprimer silencieusement la limite). `0` désactive la limite. | `10485760` (10 Mio) |
| `REBASE_ENABLE_SWAGGER` | L'interface OpenAPI. Trois états possibles. Si non défini, dans chaque environnement : `/api/docs` est servi aux appelants auxquels `GET /api/schema/tables` décrit les tables, chacun recevant le document des tables qui lui sont décrites, et il n'y a pas d'interface utilisateur Swagger. `true` publie l'ensemble du document pour tout le monde, avec l'**UI** Swagger à `/api/swagger` hors production (jamais en production). `false` garde le document protégé par l'accès admin. | — |
| `REBASE_DEPLOYMENT_ID` | Le déploiement exécuté par ce processus, tel que nommé par la plateforme ; mentionné sur la ligne indiquant que le runtime est à l'écoute. Rebase Cloud le définit. | — |
| `REBASE_METRICS` | Expose les métriques Prometheus sur `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Ajoute `includeSubDomains` à l'en-tête `Strict-Transport-Security`, de sorte que les navigateurs refusent le HTTP simple sur chaque sous-domaine de l'hôte pendant six mois — y compris les hôtes que ce processus ne dessert pas. À n'activer que si chaque sous-domaine du domaine est exclusivement en HTTPS. Toute valeur autre que `true`/`false` refuse de démarrer. Voir [En-têtes de sécurité](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Jeton Bearer protégeant `/metrics`. Laisser non défini rend le point de terminaison ouvert à tout ce qui peut atteindre le port — acceptable sur un réseau privé, non sur un réseau public, ce que précisent les logs de démarrage. | — |
| `REBASE_MIGRATE_ON_BOOT` | Ce que le runtime est autorisé à faire sur le schéma des tables au démarrage. `ensure` (la valeur par défaut, partout — production comprise) exécute la passe **additive** : créer les tables, colonnes et types enum manquants, sans jamais en supprimer ni en réécrire un. `none` laisse intact le schéma des tables déclarées, mais les tables propres au framework (authentification, clés d'API, jobs, cron) sont toujours créées et tenues à jour ; `REBASE_PROVISION=false` désactive également ces dernières. L'image publiée n'accepte que ces deux options et **refuse de démarrer sur `push`**. Dans un [déploiement fractionné](/docs/deployment/split-processes), un seul processus peut effectuer le provisionnement, chaque autre rôle doit donc définir `none` sous peine de refuser de démarrer. | `ensure` |
| `REBASE_PROVISION` | `false` fait en sorte que le runtime ne modifie rien dans sa base de données : aucune table, colonne, index, fonction, trigger, politique, rôle ou droit, au démarrage ou ultérieurement, y compris ceux propres au framework. Il signale en retour ce qui manque par son nom. Prévu pour une base de données que seul votre processus de gestion des changements peut modifier. Voir [Quand seul votre processus de changement peut modifier la base de données](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Seuls `true` et `false` sont acceptés. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Refuse de démarrer lorsque la base de données a été provisionnée pour la dernière fois à partir d'un ensemble de tables différent de celui à partir duquel ce processus a été compilé. Non défini (ou toute valeur autre que `true`/`1`) émet un avertissement à la place. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Refuse de démarrer lorsqu'un fichier de fonction ou de cron lève une exception ou échoue au parsing lors de l'import, en indiquant chaque fichier et la raison, afin qu'un déploiement progressif (rolling deploy) maintienne l'ancienne version en service. Un redémarrage y est également soumis. Non défini (ou toute valeur autre que `true`) ignore le fichier et sert le reste. Un fichier qui s'importe correctement et n'exporte aucune fonction ni tâche est toujours ignoré, non refusé. | skip |
| `REALTIME_CDC` | Capture de données de changement (CDC) au niveau de la base : `auto` (lit les changements depuis le WAL lorsque la base le permet, sinon utilise des triggers, sinon bascule au niveau applicatif, en loguant chaque repli en niveau info), `trigger` (le force, avertit si impossible), `wal` (lit les changements depuis le journal de réécriture WAL au lieu des triggers ; requiert `wal_level=logical` et un rôle autorisé à répliquer, bascule sur `trigger` dans le cas contraire), `off`. Voir [Realtime](/docs/backend/realtime-cdc/). Prioritaire sur `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Transport inter-instances pour les canaux de diffusion (broadcast) et la présence : `memory` ou `postgres`. Ignoré lorsque `realtime.bus` reçoit un transport déjà instancié. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Nombre maximal d'abonnements qu'un socket temps réel peut maintenir ; le suivant est refusé avec `TOO_MANY_SUBSCRIPTIONS`. Un entier positif — toute autre valeur interrompt le serveur au démarrage. Prioritaire sur `realtime.maxSubscriptionsPerSocket`. Voir [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Nombre maximal de sockets temps réel qu'un utilisateur, ou une clé d'API, peut maintenir ouverts sur une instance de serveur. Les sockets d'usurpation d'un administrateur sont décomptés de l'administrateur. La connexion du suivant est refusée avec `TOO_MANY_SOCKETS` et le socket est fermé (4002) ; le SDK réessaye en continu, il parvient donc à se connecter lorsqu'un autre se ferme. Un entier positif — toute autre valeur arrête le serveur au démarrage. Prioritaire sur `realtime.maxSocketsPerUser`. | Aucune limite |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Temps maximal, en ms, pendant lequel une modification attend la réévaluation (refetch) qui la transmet aux abonnés actifs. Un refetch attend 300 ms en l'absence de changement, et au plus cette durée sous un flux continu d'écritures. Un entier positif — toute autre valeur arrête le serveur au démarrage. Prioritaire sur `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Durée pendant laquelle le total d'un abonnement à une grande liste peut être réutilisé avant d'être recompté, en ms ; les trames qui le réutilisent portent `meta.totalAsOf`. Non défini, chaque trame recompte. Prioritaire sur `realtime.recountIntervalMs`. | Non défini |
| `REALTIME_RECOUNT_MIN_ROWS` | Le plus petit total précédent auquel `REALTIME_RECOUNT_INTERVAL_MS` s'applique ; les listes plus petites sont comptées à chaque trame. Prioritaire sur `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Autorise les valeurs `localhost`/boucle locale sous `NODE_ENV=production`. Désactivé par défaut, de sorte qu'un démarrage en production échoue explicitement plutôt que de se connecter à une base de données absente. | `false` |
| `REBASE_PROVISION_ONLY` | `1`/`true` exécute la passe de schéma et se termine sans ouvrir de socket — la configuration attendue pour un Job de migration, à partir de la même image et du même bundle que le serveur qui lui succède. Il crée également les tables qu'un processus en service créerait autrement à la première utilisation, et ne lance aucun cron ni file de tâches. Une valeur vide est considérée comme *non définie*, de sorte qu'un `${SOMETHING}` non substitué dans un fichier compose ne transforme pas un déploiement ordinaire en un déploiement qui migre et refuse de servir. Refusé en combinaison avec `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Un chemin de fichier. Une passe de provisionnement (`REBASE_PROVISION_ONLY=true`) y écrit chaque modification de schéma effectuée, dans l'ordre, sous la forme d'un script SQL à examiner et appliquer avec `psql`. Les lignes qu'elle a écrites ne sont pas incluses. Refusé sur un processus qui sert du trafic. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permet à une machine — un agent, un job CI — d'*appliquer* une modification de schéma via `/api/admin/schema`, et non pas seulement d'en planifier une. Désactivé sauf demande explicite : l'identifiant qui permettrait une telle modification est celui qui a le plus de chances de se trouver dans une variable CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Durée maximale d'exécution d'une fonction personnalisée avant que sa requête ne soit interrompue. Même paramètre que l'option `functionsTimeoutMs`. `0` le désactive. Une fonction qui déclare son propre timeout (`defineFunction(…, { timeoutMs })`) utilise ce dernier à la place. | `30000` |
| `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` | Le délai d'expiration le plus long qu'une fonction peut déclarer pour elle-même avec `defineFunction(…, { timeoutMs })`, en ms ; une fonction demandant davantage recevra cette valeur. Un nombre positif ; toute autre valeur est interprétée comme non définie. | `300000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` fait en sorte qu'un rejet de promesse non géré termine le processus au lieu de simplement le journaliser. Activé sous un orchestrateur qui assure le redémarrage ; désactivé là où un redémarrage est pire qu'une fuite. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Masque l'avertissement de démarrage sur une plateforme que le runtime détecte comme étant à dimensionnement à zéro (scale-to-zero), où un timer qui se déclenche dans une instance inactive ne s'exécute dans aucune instance. Cela ne change rien d'autre : activez-le lorsque vous maintenez au moins une instance en fonctionnement continu. | — |
| `TRUSTED_PROXY_HOPS` | Nombre de proxys en amont de ce serveur, pour que le limiteur de débit puisse lire la véritable adresse client dans `X-Forwarded-For`. Valeur par défaut sécurisée à `0` : sans proxy, faire confiance à l'en-tête permettrait à tout appelant d'usurper une identité. | `0` |

:::note[Le provisionnement au démarrage est additif et n'est pas un outil de migration]
La passe de démarrage s'exécute de manière automatisée sans relecture humaine d'un diff, elle ne supprimera donc jamais
de colonne, ne réduira pas un type et ne réécrira pas une table. C'est également pourquoi l'image refuse
`REBASE_MIGRATE_ON_BOOT=push` : un push complet calcule un diff et effectuera volontiers
un `DROP COLUMN`, et le redémarrage d'un conteneur ne doit jamais être en mesure de détruire
une colonne en production comme effet secondaire d'un réordonnancement d'instances.

Les modifications destructives ou structurelles restent cantonnées là où elles peuvent être vérifiées : `rebase db
generate` + `rebase db migrate`, ou `rebase db push` depuis un checkout ou la CI,
qui teste les modifications à blanc (dry-run), refuse les opérations destructives sans confirmation, et
peut réaliser une sauvegarde préalable.
:::

### Déploiements fractionnés (Split deployments)

Une même image et un même bundle peuvent être démarrés plusieurs fois, chacun prenant en charge
une partie différente du projet. Une ligne pour chacun ici, car cette page a pour but de
lister chaque variable ; la documentation sur ce que chaque combinaison *monte et prend en charge* — ainsi que les
combinaisons qui refusent de démarrer — se trouve sur
**[Processus fractionnés](/docs/deployment/split-processes)**.

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `REBASE_ROLE` | La partie prise en charge par ce processus : `all`, `api`, `functions` ou `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Force ou désactive l'exécution des planificateurs cron sur *ce* processus. Si non défini, s'aligne sur le rôle. | — |
| `REBASE_JOB_WORKERS` | Force ou désactive l'exécution des workers de files de tâches sur ce processus. Si non défini, s'aligne sur le rôle. | — |
| `REBASE_FUNCTIONS_ONLY` | Ne dessert que les fonctions personnalisées nommées dans ce processus. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Dessert toutes les fonctions personnalisées sauf celles mentionnées. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Emplacement vers lequel le processus API redirige une requête de fonction qu'il ne dessert pas lui-même. Sur un `worker`, destination de ses propres appels à `rebase.functions`. Une URL `http(s)`. | — |

### Surface MCP

Un point de terminaison optionnel Model Context Protocol sur `/mcp`, permettant à un client d'IA de lire
et modifier ce projet **sous l'identité de l'utilisateur connecté**. Désactivé par défaut, et — à la différence
des autres surfaces — aucun `REBASE_ROLE` ne l'active : les autres décrivent une
forme de processus, tandis que celle-ci est une décision de transmettre des identifiants à un logiciel
tiers, décision qui doit être prise par un être humain plutôt qu'héritée du rôle
d'un conteneur.

`rebase dev` définit `REBASE_MCP_ENABLED=true` pour le backend qu'il démarre, sauf si
le shell ou le fichier `.env` contient déjà une ligne à ce sujet, et ce backend déclare son propre
`http://localhost:<port>` comme URL publique lorsque `REBASE_PUBLIC_URL` n'est pas défini.
Rien d'autre ne le fait : un processus de production a besoin des deux variables.

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `REBASE_MCP_ENABLED` | Monte la surface MCP. Nécessite `REBASE_PUBLIC_URL` ; sans cela, la surface refuse de se monter et le signale dans le log de démarrage. | `false` |
| `REBASE_PUBLIC_URL` | Origine accessible de l'extérieur pour ce déploiement, par ex. `https://app.example.com`. La surface MCP ne peut pas la déduire — récupérer l'origine depuis l'en-tête `Host` ferait de l'identité de l'émetteur, et du public auquel ses propres jetons sont comparés, une valeur fournie par l'appelant. | — |
| `REBASE_MCP_VIEW` | Chemin vers la vue MCP App propre au projet (`rebase-view.html`, générée par `rebaseMcpViewPlugin()`), servie à Claude à la place de la vue générique pour qu'il affiche vos vues, champs et actions personnalisés. Sans cela, le backend cherche à côté du frontend qu'il sert. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Autorise l'enregistrement dynamique de clients OAuth (RFC 7591), permettant à un client de s'enregistrer de lui-même. Définissez à `false` pour exiger que les clients soient enregistrés à l'avance. | `true` |

### Édition directe du schéma depuis un bundle (Live schema editing)

Désactivé à moins que `REBASE_LIVE_SCHEMA_REPOSITORY` ne soit défini. Un bundle compilé ne possède pas
de source `backend/schema` à modifier ; avec ces options configurées, l'éditeur de schéma lit
la source depuis le dépôt, commite chaque changement en retour, et exécute son DDL sur
cette base de données. Réservé aux administrateurs, et appliqué par un humain sauf si
`REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` en dispose autrement. Un dépôt désigné sans
identifiant exploitable refuse de démarrer. Voir
[Édition directe du schéma](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Le dépôt GitHub sur lequel commiter les changements de schéma, sous la forme `propriétaire/nom`. Définir cette variable active la fonctionnalité. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | La branche sur laquelle le commit est effectué. | `main` |
| `REBASE_LIVE_SCHEMA_PATH` | Emplacement de `backend/schema` dans ce dépôt, relatif à celui-ci. Un chemin qui sort du dépôt refuse de démarrer, tout comme l'ancienne variable supprimée `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH`. | `backend/schema` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Un token d'accès fin (fine-grained) avec droits de lecture et écriture sur le contenu du dépôt. Définissez ceci ou les trois variables `_GITHUB_APP_*`, mais pas les deux. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | L'ID d'une GitHub App, pour commiter en tant qu'application plutôt qu'avec un token. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | L'installation de l'application sur le dépôt. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | La clé privée de l'application : PEM, PEM avec retours à la ligne échappés, ou base64. | — |

### Sauvegardes

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `BACKUP_SCHEDULE` | Expression cron pour les sauvegardes planifiées. Non défini signifie que les sauvegardes automatiques sont désactivées. | — |
| `BACKUP_DESTINATION` | Chemin local, ou une URL `s3://bucket/prefix` / `gs://bucket/prefix`. Requis avec `BACKUP_SCHEDULE`, qui refuse de s'exécuter sans lui. `rebase db backup` utilise par défaut `./backups` à l'endroit où il a été exécuté. | — |
| `BACKUP_RETENTION_DAYS` | Supprime les sauvegardes de plus de N jours. Laisser non défini ou `0` conserve l'ensemble. | — |
| `BACKUP_KEEP_MINIMUM` | Conserve toujours au moins N sauvegardes parmi les plus récentes, quelle que soit la durée de rétention. | — |
| `PG_DUMP_PATH` | Remplace le binaire `pg_dump` — il doit correspondre à la version majeure du serveur ou être plus récent. | — |
| `PG_RESTORE_PATH` | Remplace le binaire `pg_restore`. | — |
| `PSQL_PATH` | Remplace le binaire `psql` exécuté par `rebase db restore --clean` pour faire de la restauration une transaction unique. | — |
| `PG_DUMPALL_PATH` | Emplacement de `pg_dumpall`, lorsqu'il n'est pas dans le `PATH`. Sans cela — et sans les outils clients PostgreSQL installés —, une sauvegarde des données globales échoue avec une erreur mentionnant cette variable. | — |

L'image de runtime officielle (`rebasepro/server`) intègre les outils clients
PostgreSQL 18, une sauvegarde planifiée y tourne donc contre tout serveur jusqu'à Postgres 18.
Hors de l'image, installez-les vous-même (`apt-get install postgresql-client-18`,
`brew install libpq`).

Les sauvegardes contiennent des secrets et des données personnelles (PII). Utilisez une destination privée avec
chiffrement au repos.

### Livraison de bundles

Un déploiement managé n'embarque pas son code dans l'image : le runtime récupère un
bundle au démarrage. Ces variables déterminent lequel et comment.

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `REBASE_BUNDLE` | Chemin vers un répertoire de bundle déjà extrait. Ce que `rebase start` définit localement. | — |
| `REBASE_BUNDLE_URL` | Emplacement depuis lequel récupérer l'archive du bundle en l'absence de bundle local. | — |
| `REBASE_BUNDLE_TOKEN` | L'identifiant Bearer autorisant ce téléchargement. À traiter comme un secret : il permet à un tenant de télécharger son propre code. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Emplacement où un bundle téléchargé est extrait. Doit être accessible en écriture et persister entre la récupération et le démarrage. | — |
| `REBASE_RUNTIME_MODULES` | Modules supplémentaires fournis par l'image de runtime au bundle, au-delà de ceux qu'il déclare lui-même. | — |

### Liaisons de ressources (Resource bindings)

Chaque base de données, bucket et topic déclaré par un projet dans `backend/resources.ts` est
lié par des variables d'environnement nommées d'après lui. Les noms de base sont listés ci-dessous ; une
ressource non définie par défaut ajoute `__` suivi de sa clé en majuscules, ainsi un bucket appelé
`media` lira `S3_BUCKET__MEDIA`. La commande `rebase status`
affiche, pour chaque ressource,
la variable exacte lue et si elle est définie ou non.

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `REBASE_DRIVER` | Le package npm implémentant le pilote d'une source de données lorsqu'il ne s'agit pas de celui par défaut de Postgres. Suffixé par source : `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | La chaîne de connexion pour un topic déclaré. Suffixé par topic. | — |

### L'environnement propre au CLI

Lu par `rebase`, et non par le serveur. Rien ici n'affecte un déploiement.

| Variable | Description | Par défaut |
|----------|-------------|------------|
| `REBASE_BASE_URL` | Destination où `rebase api-keys`, `rebase storage` et `rebase auth reset-password` envoient la clé de service, dans le shell ou dans `.env`. Définissez-la lorsque le serveur tourne autrement que par `rebase dev` dans ce projet : `rebase start`, un conteneur, un autre hôte. Si non définie, elles utilisent le serveur enregistré par `rebase dev` pendant son exécution, et n'envoient rien s'il ne tourne pas. | — |
| `REBASE_SERVICE_KEY` | La clé de service avec laquelle ces commandes s'authentifient, lue depuis `.env` : la même variable que celle lue par le serveur (voir plus haut). | — |
| `SERVICE_KEY` | Une ancienne désignation pour cette clé. Lorsque `.env` la contient, `rebase api-keys` et `rebase storage` la lisent à la place de `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Le fichier `.env` que le CLI lit et modifie, s'il ne s'agit pas de celui du projet. | — |
| `REBASE_ROOT_RULES` | `0` empêche `rebase init` et `rebase skills install` d'écrire les règles du projet dans les fichiers `CLAUDE.md` et `AGENTS.md` à la racine du dépôt, pour les racines dont vous gérez manuellement les fichiers d'agents. | on |
| `REBASE_CLOUD_URL` | Le plan de contrôle avec lequel `rebase cloud` communique. | — |
| `REBASE_CLOUD_EMAIL` | Le compte utilisé pour s'authentifier lors de `rebase cloud login`, au lieu d'afficher une invite. | — |
| `REBASE_CLOUD_PASSWORD` | Son mot de passe, afin qu'un gestionnaire de secrets puisse le transmettre sans qu'il n'apparaisse dans l'historique du shell. | — |
| `REBASE_TOKEN` | Un jeton issu de `rebase cloud tokens create`. S'il est défini, chaque commande `rebase cloud` s'authentifie avec celui-ci au lieu de la session de `rebase cloud login`, et ne lit ni n'écrit jamais la session stockée. Dans un répertoire lié par `rebase cloud init --claim`, il est ignoré au profit du jeton propre à ce projet s'il ne dispose d'aucun scope sur le projet. Le moyen recommandé pour exécuter `rebase cloud` en CI — voir [CI et agents](/docs/deployment/cloud/#ci-and-agents). Le [serveur MCP](/docs/ai/mcp/) le transmet au CLI lancé par ses outils cloud, et ne l'envoie jamais à l'application : définissez `REBASE_API_TOKEN` pour cela. | — |
| `REBASE_DEBUG` | `1` affiche l'erreur sous-jacente et les détails de la requête au lieu d'un message concis. La première chose à activer lorsqu'une commande `rebase cloud` échoue sans explications claires. | — |
| `REBASE_ATLAS_DEV_URL` | La base de données vide sur laquelle `rebase db push`, `db generate` et `db migrate` planifient leurs modifications, au lieu de la base `<db>_dev_diff` qu'ils créent à côté de `DATABASE_URL`. Rebase ne crée ni ne supprime aucune base mentionnée ici, et refuse une base identique à `DATABASE_URL`. Sur la base de développement managée, le CLI la configure sur une instance PGlite temporaire en mémoire de son cru. Définissez-la lorsque le privilège `CREATE DATABASE` n'est pas accordé. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` ne démarre aucune base de données et ne provisionne rien — vous devez fournir la vôtre. Identique à `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fixe le port du serveur de développement frontend, que `rebase dev` dérive sinon du chemin du projet. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Temps d'attente de `rebase dev` pour que le backend se signale avant d'indiquer qu'il n'a pas démarré. `0` désactive ce signalement. | `30000` |
| `DATABASE_PASSWORD` | Le mot de passe que `rebase dev --docker` injecte dans la chaîne de connexion dérivée de `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | La convention multi-outils standard. Définie à toute valeur autre que `0`, le CLI n'envoie aucune télémétrie. | — |
| `REBASE_TELEMETRY_DISABLED` | Identique, spécifique à Rebase. Ne nécessite aucun fichier, c'est pourquoi elle est recommandée en CI et au sein d'une image. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Destination d'envoi de la télémétrie, pour un collecteur auto-hébergé. | — |
| `REBASE_NO_UPDATE_CHECK` | `1` empêche le CLI de vérifier sur le registre npm (ou `npm_config_registry`), une fois par jour en tâche de fond, les dist-tags de `@rebasepro/cli`, et masque la ligne « Rebase X is out; this CLI is Y » que chaque commande sauf `rebase upgrade` affiche en sortie d'erreur stderr. La réponse est conservée dans `~/.rebase/release-check.json`, et la requête n'envoie rien d'autre. Déjà désactivé en CI ; `NO_UPDATE_NOTIFIER` a le même effet. | — |
| `REBASE_RELEASE_NOTICE_SHOWN` | Défini par le CLI pour les processus qu'il démarre, afin qu'une commande réexécutant le CLI n'affiche la ligne « Rebase X is out » qu'une seule fois. La définir vous-même masque la ligne pour ce processus, à l'image de `REBASE_NO_UPDATE_CHECK`. | — |

## Secrets en développement

`JWT_SECRET` est obligatoire en production. Cette variable ainsi que `REBASE_SERVICE_KEY` sont
générées pour vous en dehors de la production, vous permettant de démarrer sans configuration préalable.

Ces valeurs générées sont mises en cache dans `.rebase-dev-secrets.json`, aux côtés de
`.rebase-dev-port` et `.rebase-dev-url` et ignorées par git avec eux. Auparavant, elles
étaient régénérées à chaque démarrage — ainsi, redémarrer le serveur de développement vous déconnectait
de votre propre application et invalidait toute clé d'API venant d'être créée.

- Définissez l'une ou l'autre explicitement et votre valeur sera utilisée ; rien ne sera mis en cache ni lu.
- Modifiez l'emplacement du cache avec `REBASE_DEV_SECRETS_FILE` — un chemin, et la
  seule variable de cette section que vous auriez un intérêt à définir volontairement.
- Supprimez le fichier pour renouveler les deux secrets. Le démarrage suivant en écrira un nouveau.
- Si le fichier ne peut pas être écrit — par exemple dans un conteneur en lecture seule —, le serveur démarre
  tout de même avec un secret éphémère, exactement comme auparavant.

Rien n'est mis en cache en production, ni sous un exécuteur de tests. En production, rien
n'est généré non plus : un démarrage sans `JWT_SECRET` échoue en indiquant le nom de la variable,
ce comportement restant inchangé :

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
sans `app`, `server` et `basePath` et avec un paramètre obligatoire `provision`, permettent de construire un
backend qui ne sert aucun trafic tant que vous ne le montez pas : `createRebaseBackend`. Voir
[Intégration d'un serveur personnalisé](/docs/backend/custom-server/).

### Modification de `basePath`

`basePath` déplace chaque route d'API, le client doit donc être configuré à l'identique —
dans le cas contraire, il continuera d'appeler `/api/...` et obtiendra des erreurs 404 sur tout :

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

Le panneau d'administration récupère cette information à partir du client qui lui est fourni ; aucune autre
configuration n'est nécessaire. Si vous construisez une URL de requête manuellement, concaténez-la à partir du client plutôt
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
* **Cause :** Par défaut, Rebase tente d'exécuter les requêtes de l'éditeur SQL en basculant temporairement de rôle de base de données pour correspondre au rôle applicatif de l'utilisateur actif (par ex. `SET LOCAL ROLE "admin"`). Si vous utilisez une authentification personnalisée où les rôles n'existent que dans des tables de base de données et non comme de véritables rôles PostgreSQL, le changement de rôle échoue ou les privilèges de base de données sont manquants. La vue CMS en tableau s'exécute sous l'utilisateur propriétaire par défaut de la connexion et contourne ce mécanisme.
* **Solution :** Ajoutez `DISABLE_DB_ROLE_SWITCHING=true` à la configuration `.env` de votre backend. Cela force Rebase à exécuter les requêtes de l'éditeur SQL avec les privilèges du propriétaire de la connexion (généralement un superuser/owner). L'éditeur SQL affiche alors, au-dessus des résultats, qu'ils ont été lus en tant que propriétaire de la connexion, et grise son sélecteur de rôle.

### Échec de récupération du schéma dans l'éditeur SQL (`Cross-database execution requires adminConnectionString`)

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
- **[Vue d'ensemble du Backend](/docs/backend)** — Référence complète de configuration du backend
