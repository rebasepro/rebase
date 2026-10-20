---
sourceHash: 65ad924b56043f2e
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud est le même Rebase, opéré pour vous. Ce que c'est, comment lier et déployer un projet, et ce que la bêta privée n'inclut pas encore.
---

Rebase Cloud exécute le même Rebase open source que vous hébergeriez vous-même — la même
image publiée `rebasepro/server`, le même bundle, le même Postgres. La
seule différence réside dans la personne qui l'opère.

:::note[Bêta privée]
Rebase Cloud est en **bêta privée**. Il fait tourner de véritables environnements aujourd'hui et s'ouvre par
vagues. [Demander un accès](https://rebase.pro/pricing).

Il n'est pas en libre-service, les commandes ci-dessous nécessitent donc un compte ayant été autorisé.
Tout le reste sur ce site fonctionne sans compte.
:::

## Ce que c'est

Un **projet** Cloud correspond à trois éléments que la plateforme opère pour vous :

| | Ce que vous obtenez |
|---|---|
| **App** | Votre bundle, s'exécutant sur l'image d'exécution publiée. Les déploiements sont un téléversement de bundle, pas une construction de conteneur |
| **Base de données** | Un PostgreSQL managé, avec sauvegardes automatisées et récupération à un instant précis (PITR) |
| **Stockage** | Votre propre bucket, si votre projet utilise le stockage de fichiers |

Chaque élément est provisionné lors de votre premier déploiement, et chacun est facturé en fonction de ce qu'il
réserve plutôt que par utilisateur.

**Rien ne change dans votre projet pour y tourner.** Le même dépôt
s'auto-héberge avec `docker compose`, et la solution de sortie est réelle : `rebase build`
génère un bundle qui démarre partout où l'image d'exécution fonctionne.

## Lier un projet

Depuis le répertoire d'un projet :

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`projects create` ne prend aucun argument positionnel. Le nom et le sous-domaine sont
des options, et tous deux sont requis — ils sont demandés interactivement sur un terminal, et une
exécution non interactive qui omet l'un d'eux quitte avec l'erreur `input_required` plutôt que d'en
inventer un. **Le sous-domaine n'est pas modifiable par la suite :** il s'agit de l'hôte
`<slug>.rebase.website` sur lequel le projet répond, choisissez-le donc avec soin.

`--link` associe ce répertoire au projet au sein du même appel, évitant ainsi
une étape `link` séparée. Cela écrit `.rebase/cloud.json`, qui enregistre l'identifiant et le
slug du projet. Ce fichier n'est pas un secret et ne contient pas vos identifiants — ceux-ci résident
dans `~/.rebase/credentials.json`, généré par `login`.

Il est toutefois versionné avec le code, ce qui permet à un dépôt cloné de désigner n'importe quel
plan de contrôle. Lorsque l'hôte provient uniquement de ce fichier et qu'il ne s'agit ni de celui
de la plateforme ni d'un hôte auquel vous vous êtes connecté auparavant, `login` le nomme et demande
confirmation avant d'y envoyer votre e-mail et votre mot de passe. Sans terminal, ou avec
`--json`, il refuse avec l'erreur `unknown_control_plane` ; passez `--url <host>` (ou définissez
`REBASE_CLOUD_URL`) pour vous y connecter délibérément.

`billing setup` associe une carte bancaire à l'organisation, une seule fois. Cette commande est intentionnellement
la première de la séquence : le premier déploiement d'un projet est refusé sans carte, et
s'en rendre compte après avoir terminé le téléversement d'un bundle est la pire des situations.

Un projet existant se lie sans création préalable :

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Déployer

```bash
rebase cloud deploy
```

Une seule commande, et aucune option à retenir. Le fichier `rebase.json` d'un projet généré déclare
`runtime: "managed"` pour son backend, et `deploy` lit cette déclaration — il
l'indique au passage (`rebase.json declares runtime: managed — deploying a
bundle`), compile l'application dans `dist-bundle`, téléverse le bundle, l'exécute sur
l'image d'exécution publiée, et suit le déploiement jusqu'à son état final. Le code de
sortie faisant foi, la même ligne fonctionne de manière non surveillée en CI.

Il se termine en indiquant où chaque application répond désormais et si la nouvelle version y est en ligne :

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
```

« Live » signifie que l'adresse a répondu après le build : le `/api/health` du backend a renvoyé `ok`, et la page d'une application statique s'est chargée (depuis ce déploiement, quand la plateforme la sert). La vérification attend jusqu'à `--live-timeout` secondes, 60 par défaut ; `0` la désactive. Si une application ne répond pas à temps, le déploiement se termine quand même avec le code zéro, car il a réussi, et la dernière ligne indique quelle application n'a pas répondu et pourquoi. Un déploiement en échec se termine à la place par une ligne qui nomme l'application et la raison, avec `rebase cloud logs` pour le log de build complet.

Les scripts passent `--json` pour obtenir un objet portant les mêmes informations — `apps`, `hosts`, `live`, `liveChecks`, `durationMs` et l'identifiant du déploiement. Contrairement au reste de `rebase cloud`, `deploy` ne passe pas de lui-même en JSON via un pipe.

Pour déployer un artefact compilé plus tôt — par exemple, un job CI qui compile une fois et
déploie deux fois —, pointez vers le répertoire au lieu de recompiler :

Ce que ce runtime autorise — paquets et modules natifs, mémoire et instances, timeouts et tailles de payload, système de fichiers, secrets, stockage et réseau sortant — se trouve sur sa propre page :
[Runtime backend managé](/docs/deployment/managed-runtime/).

Pour déployer un artefact compilé plus tôt — par exemple un job CI qui compile une fois et
déploie deux fois —, pointez vers le répertoire au lieu de recompiler :

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Quitter le runtime managé s'effectue via sa propre option, `--eject`, et rien d'autre ne la
demande : une compilation qui déplacerait un projet managé vers une image de conteneur dont il
devient propriétaire est refusée tant que vous ne l'avez pas explicitement demandé. Auparavant, `--force` avait cette signification,
ce qui plaçait l'action la moins réversible du CLI sous le même terme que « écraser ce
fichier » ; il s'agit désormais d'une option inconnue plutôt que d'un alias, ce qui interrompt
un script qui la contiendrait.

### La vérification de syntaxe avant le téléversement

Les fichiers d'une application statique sont servis tels quels. Lorsque son `build` se contente de copier des scripts écrits à la main dans `output`, personne ne les a analysés, et un fichier contenant une faute de frappe est mis en ligne et empêche la page de se charger. C'est pourquoi, avant tout téléversement, `deploy` analyse chaque fichier `.js`, `.mjs` et `.cjs` du `output` de chaque application statique, ainsi que chaque `<script>` en ligne de ses fichiers `.html`. Cela couvre une application statique déployée seule comme les applications statiques intégrées au bundle du backend. Une erreur de syntaxe arrête le déploiement en indiquant le fichier, la ligne et la colonne :

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Avec `--json`, le `code` de l'erreur est `syntax_error`. Les scripts en ligne qu'un navigateur n'exécute pas comme du JavaScript sont ignorés : JSON, import maps, templates et tout autre `type` non JavaScript, un `<script src>`, ainsi qu'un script qui contient encore du balisage de template non rendu comme `{{ }}`. Un fichier `.js` est accepté s'il s'analyse comme script classique ou comme module, car c'est la page qui en décide. Rien sous `node_modules` n'est lu, pas plus qu'un `--bundle-dir` déjà construit. `--no-verify` désactive la vérification pour un déploiement.

Surveiller le déploiement :

```bash
rebase cloud logs            # le journal de build
rebase cloud logs --runtime  # ce que le conteneur en cours d'exécution affiche
rebase cloud status          # ce que la plateforme perçoit de l'état du projet
```

`status` rapporte `blockedOn` et `nextAction`. Lorsque `blockedOn` vaut `null`, la
plateforme travaille réellement et le polling est la bonne chose à faire ; lorsqu'il indique
une valeur, cette étape est en attente d'une action de votre part.

## Revenir en arrière (Rollback)

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback redirige le projet vers ce qu'un déploiement réussi antérieur a
livré, sans jamais recompiler — tout l'intérêt d'un rollback réside dans le déploiement d'un
artefact qui a déjà tourné avec succès.

Les déploiements éligibles dépendent de la façon dont le projet a été déployé, et les deux approches
fonctionnent :

| Comment il a été déployé | Ce qui est restauré |
|---|---|
| `rebase cloud deploy` (un build depuis les sources) | L'image publiée par ce build |
| `rebase cloud deploy --bundle` (le runtime de la plateforme) | Le bundle livré par ce déploiement, sur la version du runtime exécutée actuellement par le projet |

Les applications statiques intégrées au bundle du backend (un simple `rebase cloud deploy` dans un projet doté d'un backend) font partie de ce bundle et reviennent donc en arrière avec lui.

Une application statique déployée seule (`rebase cloud deploy <app>`) ne peut pas encore faire l'objet d'un rollback. Son déploiement enregistre l'application qu'il a publiée, mais pas de bundle, si bien que le plan de contrôle n'a rien à partir de quoi la restaurer. La solution consiste à redéployer la dernière version correcte, par exemple depuis le commit précédant le commit fautif. Après un tel déploiement, `deploy` le signale au lieu de renvoyer vers `rollback`.

Un rollback nécessite donc un déploiement ayant enregistré l'un des deux, ce qui implique
un projet ayant été déployé avec succès au moins deux fois. `rebase cloud deployments`
signale ceux qui sont éligibles, et `--json` renvoie `rollbackable` pour chaque ligne avec
l'`image` ou le `bundle` qui serait restauré.

Deux types de déploiements sont refusés, et le CLI précise lequel : un déploiement qui n'a pas réussi,
et un déploiement antérieur à l'enregistrement de l'artefact par la plateforme. Il n'y a rien à
deviner dans les deux cas — deviner reviendrait à livrer ce qui a été compilé ou téléversé le
plus récemment tout en prétendant restaurer cette version —, déployez donc plutôt la version souhaitée.

Chaque déploiement réussi se termine en indiquant le chemin du retour (`rebase cloud rollback`), pour qu'il soit sous les yeux au moment où une version défectueuse est repérée.

Un rollback ajoute un nouveau déploiement plutôt que de rembobiner l'historique, et attend
que la version restaurée réponde avant de confirmer le succès. Suivez-le avec
`rebase cloud logs -f`.

## CI et agents

Un job CI ou un agent ne devrait pas détenir votre mot de passe. Donnez-lui plutôt
un jeton : une clé qui agit au nom de votre compte, restreinte à quelques actions sur un
seul projet. Créez-le depuis un terminal authentifié :

```bash
rebase cloud tokens create --project shop --can deploy,logs --expires-in 90
```

Le jeton est affiché une seule fois, sous la forme d'une ligne `export REBASE_TOKEN=rk_live_…`. Lorsque
`REBASE_TOKEN` est défini, chaque commande `rebase cloud` s'authentifie avec celui-ci au lieu de
votre compte, sans jamais lire ni écrire la session stockée. Dans GitHub Actions,
enregistrez-le comme secret de dépôt et exposez-le sous ce nom :

```yaml title=".github/workflows/deploy.yml"
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 11
      - uses: actions/setup-node@v4
        with:
          node-version: 22.x
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec rebase cloud deploy --project shop
        env:
          REBASE_TOKEN: ${{ secrets.REBASE_TOKEN }}
```

`--can` prend une ou plusieurs capacités, séparées par des virgules ou répétées :

| Capacité | Ce que le jeton peut faire |
|---|---|
| `deploy` | Déployer le projet et suivre ses builds : `deploy`, `deployments` |
| `logs` | Lire les logs de build et de runtime, ainsi que les métriques en direct : `logs`, `metrics` |
| `env` | Lire et modifier les variables d'environnement, secrets inclus |
| `database` | `db list`, `db info` et `db connect`, ce qui inclut le mot de passe de la base de données |
| `backups` | Lister, créer, inspecter et télécharger les sauvegardes, et consulter la fenêtre PITR |

Sous le capot, un jeton est une [clé d'API personnelle](/docs/backend/api-keys/#personal-keys)
sur le plan de contrôle. Chaque capacité se traduit par quelques
[scopes](/docs/backend/roles-and-scopes/) : `deploy` sur `shop` détient
`project:deploy:<id>`, avec l'id du projet, ainsi que les scopes de données et de fonctions
appelés par les commandes de déploiement. Le jeton ne dispose jamais de plus de droits que votre compte au moment
de son utilisation ; il perd donc tout ce que votre compte perd.

Deux actions restent réservées à une personne connectée :

- **Gérer les jetons.** `rebase cloud tokens list`, `create` et `revoke <id>` nécessitent
  votre session `rebase cloud login`. Un jeton ne peut pas lister, créer ou révoquer
  des jetons, car un jeton capable d'en générer pourrait générer son propre successeur.
- **Restaurer.** Aucune capacité n'accorde la restauration d'une sauvegarde ou les commandes
  `restore` et `cutover` de point-in-time recovery. Réécrire des données existantes sur une base de données en production reste réservé à
  un propriétaire ou administrateur connecté.

`rebase cloud whoami` exécuté avec un jeton configuré indique ce qu'il est autorisé à faire et sur quel
projet. `rebase cloud tokens revoke <id> --yes` le révoque immédiatement.

## Un backend sans compte

Un agent qui a construit une application peut lui donner un backend en ligne avant que quiconque se soit inscrit, et remettre à la personne pour qui il travaille un lien pour le garder :

```bash
rebase cloud init --claim
```

Cela provisionne un projet sur Rebase Cloud, définit `REBASE_BASE_URL` dans `.env` sur son adresse en ligne, lie le répertoire et déploie les collections locales avec `rebase cloud deploy --bundle`. La commande affiche l'URL en ligne, l'URL du panneau d'administration et une **URL de réclamation**. Quiconque ouvre l'URL de réclamation et se connecte peut déplacer le projet dans l'une de ses organisations. Le lien ne fonctionne qu'une fois. Un projet que personne ne réclame dans les 72 heures est supprimé, base de données comprise. L'outil `rebase_cloud_provision` du serveur MCP exécute la même commande et renvoie les mêmes URL.

Tant qu'il n'est pas réclamé, le projet n'appartient à aucun compte. Son jeton est limité à ce seul projet et à `deploy`, `logs`, `env` et `database`. Il est conservé dans `~/.rebase/credentials.json`, jamais dans le dépôt, et les commandes `rebase cloud` du répertoire lié l'utilisent d'elles-mêmes. Il expire avec le projet.

Une fois que le déploiement a construit l'app, la commande définit aussi `REBASE_API_TOKEN` dans `.env` : une clé créée sur l'app elle-même, que le serveur MCP et le SDK lui envoient. Elle lit et écrit des données (`data:read`, `data:write`) à travers la sécurité au niveau des lignes de l'app, comme un appelant qui n'est ni une personne ni un administrateur. Elle ne détient rien du plan d'administration et expire avec le délai de réclamation. Avec `--no-deploy`, ou si ce premier déploiement échoue, il n'y a pas encore de clé : le prochain `rebase cloud deploy` qui réussit dans le répertoire en demande une, tant que le projet n'est pas réclamé et que `.env` ne définit pas déjà `REBASE_API_TOKEN`. Une fois le projet à vous, créez les clés voulues dans son panneau d'administration.

La réclamation exige une session connectée dans un navigateur, pas un jeton, ainsi qu'un moyen de paiement sur l'organisation qui reçoit le projet. Dès la réclamation, le projet est facturé comme n'importe quel autre. Réclamer révoque aussi le jeton de l'agent : connectez-vous avec `rebase cloud login`, ou créez un nouveau jeton avec `rebase cloud tokens create`.

Le provisionnement sans compte est limité par adresse et au total, et un plan de contrôle qui ne l'a pas activé refuse avec un message qui le dit.

## Compute, et combien cela coûte

Le tarif d'un projet dépend de ce qu'il réserve, et non d'un forfait prédéfini. `compute` affiche
chaque paramètre ainsi que l'estimation détaillée établie par le plan de contrôle. (`rebase cloud
resources` est une commande différente : elle liste les bases de données et buckets déclarés par le code,
et indique si chacun est provisionné — voir la [référence CLI](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Paramètre | Unité, et signification |
|---|---|
| `--cpu`, `--memory` | Ressource demandée par instance de l'application, ex. `500m` et `2Gi`. Vide correspond à la valeur par défaut de la plateforme — `100m` et `384Mi`, avec des pics possibles jusqu'à 2 CPU et `2Gi` |
| `--replicas` | Nombre d'instances permanentes : le plancher de l'autoscaler, et ce qui est facturé au repos pour le projet |
| `--autoscale-max` | 1–16. Le plafond pouvant être atteint, et le montant maximal pouvant être facturé. `--no-autoscale` le désactive |
| `--autoscale-cpu-target` | 10–95. L'utilisation du CPU que l'autoscaler maintient, par rapport à la ressource demandée (request) plutôt qu'à la limite. Vide correspond à 70 |
| `--spot` | `true` ou `false`. Capacité préemptible : moins chère, mais redémarrée sans préavis |
| `--db-instances` | 1–3. `1` est une instance unique sans basculement automatique ; `2` ajoute une instance de secours (standby) automatique |
| `--db-cpu`, `--db-memory`, `--storage` | Par instance de base de données. Vide correspond à `500m`, `2Gi` et au volume par défaut |

Un paramètre laissé vide n'est pas équivalent à un paramètre fixé à la même valeur : un paramètre vide
suit la valeur par défaut de la plateforme et évolue avec elle.

Rien n'est validé par le CLI, à dessein — les limites dépendent du cluster sur lequel
le projet s'exécute, et elles varient selon les fournisseurs. Le plan de contrôle refuse toute
valeur qu'il ne peut honorer et indique le champ concerné. Exécutez `rebase cloud compute` pour voir
le montant en €/mois avant et après ; une modification s'applique immédiatement, au prorata à compter d'aujourd'hui,
sauf celle qui redémarre la base de données, qui attendra une fenêtre de maintenance.

## L'ensemble des commandes

| Groupe de commandes | Ce qu'il couvre |
|---|---|
| `login`, `logout`, `whoami` | Votre session |
| `tokens` | Jetons pour la CI et les agents, chacun restreint à un projet. Voir [CI et agents](#ci-et-agents) |
| `init` | Avec `--claim` : un backend en ligne sans compte, et un lien pour le réclamer. Voir [Un backend sans compte](#un-backend-sans-compte) |
| `link`, `unlink`, `use`, `open` | Lier ce répertoire à un projet, sélectionner une organisation, ouvrir la console |
| `projects` | Créer, lister, inspecter, supprimer |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Déployer et surveiller |
| `start`, `stop`, `restart` | Mettre un projet en pause et le réactiver |
| `status`, `metrics`, `debug` | Ce qu'il fait, et pourquoi il ne le fait pas |
| `cron` | Les tâches cron de l'application déployée et leurs exécutions enregistrées, consultées avec votre session `rebase cloud`. Lecture seule |
| `env` | Variables d'environnement. `list` n'affiche jamais les valeurs ; `--secret` est en écriture seule |
| `domains` | Domaines personnalisés, enregistrements DNS à ajouter, et vérification. Un projet peut répondre sur plusieurs domaines, chacun vérifié indépendamment ; `verify` et `remove` prennent le domaine à traiter, qui ne peut être omis que lorsqu'il n'y en a qu'un seul (pour `verify`, un seul en attente). `list --json` retourne `{ projectId, tenantHost, domains: [...] }` |
| `db` | Associer ou créer une base de données, s'y connecter depuis votre machine, sauvegardes, restauration et récupération PITR |
| `extensions` | La liste d'autorisation des extensions Postgres |
| `storage` | Le bucket du projet |
| `resources` | Les bases de données et buckets gérés par la plateforme, par rapport à ce que le code déclare |
| `compute` | Ce que ce projet réserve, ce qu'il coûte, et comment le modifier |
| `clusters` | Les clusters sur lesquels tournent les projets. Réservé aux administrateurs de la plateforme |
| `settings`, `orgs`, `webhooks`, `billing` | Paramètres du projet, organisations, webhooks de déploiement, facturation |

Chaque groupe de ce tableau répond à `--help` avec sa propre page — une ligne d'utilisation,
ses options et des exemples — et `--help` n'exécute jamais la commande. Un test maintient
l'index de ces pages, de sorte qu'un groupe ajouté sans documentation fait échouer le build au lieu de
répondre avec la table des matières. La commande `verify:docs` aligne le tableau lui-même sur
cet index : chaque groupe géré par le CLI apparaît ici exactement une fois, et un groupe
ajouté sans ligne dédiée fait également échouer le build.

Redirigée via un tube (pipe), `--help` répond en JSON : la même ligne d'utilisation, les options et les exemples
sous forme de structure exploitable plutôt que soixante lignes de séquences d'échappement de terminal.

## Ce que la version bêta n'inclut pas

Indiqué en toute transparence, car s'en rendre compte plus tard est toujours désagréable :

- **Pas de choix de région.** Tout tourne dans une seule région aujourd'hui. Le modèle de placement
  existe dans la plateforme, mais un projet ne peut pas choisir sa région.
  `projects create --provider` et `--region` ne font pas exception malgré les apparences : ils enregistrent
  à quelle cible de déploiement configurée dans le plan de contrôle le projet appartient, et il n'y en a qu'une,
  les deux utilisent donc cette valeur par défaut et aucun ne déplace le projet ailleurs. `rebase cloud projects create --help` indique la même chose.
- **Pas de libre-service.** L'accès est accordé par vagues ; il n'y a pas d'inscription directe avec paiement.
- **Pas de SLA publié**, ni de certification SOC 2. Si vous avez besoin de l'un d'eux, mentionnez-le lors de votre demande
  d'accès plutôt que de le supposer.
- **Pas de déploiements de prévisualisation ou de branche**, et aucune application GitHub officielle. Les hooks de déploiement —
  des URLs secrètes vers lesquelles pointer un webhook de dépôt — constituent l'automatisation prise en charge.
- **Les jetons agissent en tant que personne.** Un [jeton](#ci-et-agents) est généré par un compte
  et agit en son nom ; il n'y a pas encore d'identité machine propre à l'organisation. Si vous
  vous authentifiez depuis une CI, transmettez `REBASE_CLOUD_EMAIL` et `REBASE_CLOUD_PASSWORD`
  depuis un gestionnaire de secrets — `--password` place le mot de passe dans l'historique de votre shell et
  dans la table des processus, et vous en avertit avant de vous connecter. Si le fichier
  `.rebase/cloud.json` du dépôt mentionne un plan de contrôle autre que celui de la plateforme, passez-le
  également avec `--url` : sans terminal, `login` refuse d'envoyer un mot de passe à un
  hôte mentionné uniquement dans le fichier extrait.
- **La récupération à un instant précis (PITR) se fait uniquement via le CLI.** La console affiche les sauvegardes ; le workflow
  PITR guidé est accessible via `rebase cloud db pitr`.
- **Pas de point de terminaison public pour la base de données.** Une base de données managée n'est pas exposée à
  Internet, donc l'hôte affiché par la console correspond à son adresse pour votre backend et
  ne résout rien sur votre machine locale. `rebase cloud db connect` ouvre un port local
  relié à cette base de données, via un tunnel traversant le plan de contrôle, aussi longtemps
  que vous le laissez tourner — mais il n'existe pas de nom d'hôte permanent auquel un service tiers
  peut se connecter. Ce tunnel, ainsi que le mot de passe révélé par
  `rebase cloud db info --reveal`, requièrent tous deux le rôle de propriétaire (owner) ou d'administrateur (admin) de l'organisation :
  le même rôle requis par l'éditeur SQL de Studio, car tous trois aboutissent à une
  session directe sur vos données de production.

## S'auto-héberger à la place

Rien ici ne vous enferme. Le [guide d'auto-hébergement](/docs/deployment/self-hosting/)
exécute l'image et le bundle identiques avec `docker compose`, et le
[guide Kubernetes](/docs/deployment/kubernetes/) déploie la même topologie à partir
du Helm chart.
