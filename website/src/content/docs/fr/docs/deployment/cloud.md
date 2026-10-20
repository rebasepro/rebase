---
sourceHash: a32dc82ba7002b52
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud est le même Rebase, opéré pour vous. Ce que c'est, comment lier et déployer un projet, et ce que la bêta privée n'inclut pas encore.
---

Rebase Cloud exécute le même Rebase open source que vous auto-hébergeriez — la même image `rebasepro/server` publiée, le même bundle, le même Postgres. La différence réside dans qui l'opère.

:::note[Bêta privée]
Rebase Cloud est en **bêta privée**. Il fait tourner de véritables tenants aujourd'hui et s'ouvre par vagues. [Demander l'accès](https://rebase.pro/pricing).

Il n'est pas en libre-service, les commandes ci-dessous nécessitent donc un compte autorisé. Tout le reste sur ce site fonctionne sans compte.
:::

## Ce que c'est

Un **projet** Cloud correspond à trois éléments que la plateforme gère pour vous :

| | Ce que vous obtenez |
|---|---|
| **App** | Votre bundle, exécuté sur l'image de runtime publiée. Les déploiements sont un téléversement de bundle, pas un build de conteneur |
| **Database** | Un PostgreSQL managé, avec sauvegardes automatisées et restauration à un instant précis (point-in-time recovery) |
| **Storage** | Votre propre bucket, si votre projet utilise le stockage de fichiers |

Chacun est provisionné lors de votre premier déploiement, et chacun est facturé en fonction de ce qu'il réserve plutôt qu'au siège.

**Rien ne change dans votre projet pour tourner dessus.** Le même dépôt s'auto-héberge avec `docker compose`, et la porte de sortie est bien réelle : `rebase build` produit un bundle qui démarre partout où l'image de runtime s'exécute.

## Lier un projet

Depuis le répertoire d'un projet :

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`projects create` ne prend aucun argument positionnel. Le nom et le sous-domaine sont des options (flags), et tous deux sont requis — dans un terminal, ils sont demandés de manière interactive, et une exécution sans terminal (headless) omettant l'un d'eux se termine avec `input_required` plutôt que d'en inventer un. **Le sous-domaine n'est pas modifiable par la suite :** il s'agit de l'hôte `<slug>.rebase.website` sur lequel le projet répond, choisissez-le donc avec soin.

`--link` lie ce répertoire au projet dans le même appel, il n'y a donc pas d'étape `link` distincte. Cela écrit `.rebase/cloud.json`, qui enregistre l'identifiant et le slug du projet. Ce fichier n'est pas secret et ne constitue pas vos identifiants — ceux-ci résident dans `~/.rebase/credentials.json`, généré par `login`.

Il est cependant commité avec le code, de sorte qu'un dépôt cloné peut désigner n'importe quel plan de contrôle (control plane). Lorsque l'hôte provient uniquement de ce fichier, et qu'il ne s'agit ni de celui de la plateforme ni d'un hôte auquel vous vous êtes connecté auparavant, `login` l'indique et demande confirmation avant d'y envoyer votre e-mail et votre mot de passe. Sans terminal, ou avec `--json`, il refuse avec `unknown_control_plane` ; passez `--url <host>` (ou définissez `REBASE_CLOUD_URL`) pour vous y connecter délibérément.

`billing setup` associe une carte bancaire à l'organisation, une seule fois. Cette commande est intentionnellement placée en premier dans la séquence : le premier déploiement d'un projet est refusé sans carte, et s'en rendre compte après que le bundle a fini d'être téléversé est bien pire.

Un projet existant se lie sans en créer un nouveau :

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Déployer

```bash
rebase cloud deploy
```

Une seule commande, et aucun flag à retenir. Le fichier `rebase.json` d'un projet généré déclare `runtime: "managed"` pour son backend, et `deploy` lit cette déclaration — il le signale au passage (`rebase.json declares runtime: managed — deploying a bundle`), compile l'application dans `dist-bundle`, téléverse le bundle, l'exécute sur l'image de runtime publiée, et suit le déploiement jusqu'à un état final. Le code de sortie fait foi, cette même ligne fonctionne donc de manière automatisée en CI.

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

Pour livrer un artefact compilé plus tôt — par exemple un job CI qui compile une fois et déploie deux fois — pointez vers le répertoire au lieu de recompiler :

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Quitter le runtime managé nécessite son propre flag, `--eject`, et rien d'autre ne le demande : un build qui basculerait un projet managé sur une image conteneur qu'il posséderait alors est refusé tant que vous ne l'avez pas explicitement demandé. Auparavant, `--force` avait cette signification, ce qui plaçait l'action la moins réversible de la CLI sous le même mot que « écraser ce fichier » ; c'est désormais une option inconnue plutôt qu'un alias, de sorte qu'un script qui la contient s'arrête net.

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
rebase cloud logs            # the build log
rebase cloud logs --runtime  # what the running container is printing
rebase cloud status          # what the platform thinks the project is doing
```

`status` indique `blockedOn` et `nextAction`. Lorsque `blockedOn` est `null`, la plateforme travaille activement et scruter l'état (polling) est le comportement attendu ; lorsqu'il mentionne quelque chose, cette chose attend votre intervention.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback réoriente le projet vers ce qu'un déploiement réussi précédent a livré, et ne recompile jamais — tout l'intérêt d'un rollback est de livrer un artefact qui a déjà tourné avec succès.

L'éligibilité des déploiements dépend de la manière dont le projet se déploie, et les deux approches fonctionnent :

| Mode de déploiement | Ce qui est restauré |
|---|---|
| `rebase cloud deploy` (un build depuis les sources) | L'image publiée par ce build |
| `rebase cloud deploy --bundle` (le runtime de la plateforme) | Le bundle livré par ce déploiement, sur la version du runtime actuellement exécutée par le projet |

Les applications statiques intégrées au bundle du backend (un simple `rebase cloud deploy` dans un projet doté d'un backend) font partie de ce bundle et reviennent donc en arrière avec lui.

Une application statique déployée seule (`rebase cloud deploy <app>`) ne peut pas encore faire l'objet d'un rollback. Son déploiement enregistre l'application qu'il a publiée, mais pas de bundle, si bien que le plan de contrôle n'a rien à partir de quoi la restaurer. La solution consiste à redéployer la dernière version correcte, par exemple depuis le commit précédant le commit fautif. Après un tel déploiement, `deploy` le signale au lieu de renvoyer vers `rollback`.

Un rollback nécessite donc un déploiement ayant enregistré l'un des deux, ce qui implique
un projet ayant été déployé avec succès au moins deux fois. `rebase cloud deployments`
signale ceux qui sont éligibles, et `--json` renvoie `rollbackable` pour chaque ligne avec
l'`image` ou le `bundle` qui serait restauré.

Deux types de déploiements sont refusés, et la CLI précise lequel : un qui n'a pas réussi, et un antérieur à l'enregistrement des artefacts par la plateforme. Il n'y a rien à deviner dans les deux cas — deviner reviendrait à livrer ce qui a été compilé ou téléversé le plus récemment tout en prétendant restaurer celui-ci — déployez donc plutôt la version souhaitée.

Chaque déploiement réussi se termine en indiquant le chemin du retour (`rebase cloud rollback`), pour qu'il soit sous les yeux au moment où une version défectueuse est repérée.

Un rollback ajoute un nouveau déploiement plutôt que de rembobiner l'historique, et attend
que la version restaurée réponde avant de confirmer le succès. Suivez-le avec
`rebase cloud logs -f`.

## CI et agents

Un job CI ou un agent ne devrait pas détenir votre mot de passe. Donnez-lui plutôt un token : une clé qui agit au nom de votre compte, restreinte à quelques actions sur un seul projet. Créez-le depuis un terminal connecté :

```bash
rebase cloud tokens create --project shop --can deploy,logs --expires-in 90
```

Le token n'est affiché qu'une seule fois, sous la forme d'une ligne `export REBASE_TOKEN=rk_live_…`. Lorsque `REBASE_TOKEN` est défini, chaque commande `rebase cloud` s'authentifie avec celui-ci plutôt qu'avec votre session, et ne lit ni n'écrit jamais la session enregistrée. Dans GitHub Actions, stockez-le comme secret de dépôt et exposez-le sous ce nom :

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

`--can` accepte une ou plusieurs capacités, séparées par des virgules ou répétées :

| Capacité | Ce que le token peut faire |
|---|---|
| `deploy` | Déployer le projet et suivre ses builds : `deploy`, `deployments` |
| `logs` | Lire les logs de build et de runtime, ainsi que les métriques en direct : `logs`, `metrics` |
| `env` | Lire et modifier les variables d'environnement, secrets inclus |
| `database` | `db list`, `db info` et `db connect`, ce qui inclut le mot de passe de la base de données |
| `backups` | Lister, créer, inspecter et télécharger des sauvegardes, et consulter la fenêtre de restauration à un instant précis |

Sous le capot, un token est une [clé d'API personnelle](/docs/backend/api-keys/#personal-keys) sur le control plane. Chaque capacité se traduit en quelques [scopes](/docs/backend/roles-and-scopes/) : `deploy` sur `shop` détient `project:deploy:<id>`, avec l'id du projet, ainsi que les scopes de données et de fonctions appelés par les commandes de déploiement. Le token ne détient jamais plus de droits que votre compte au moment où il est utilisé ; il perd donc tout ce que votre compte perd.

Deux opérations restent réservées à une personne physique connectée :

- **La gestion des tokens.** `rebase cloud tokens list`, `create` et `revoke <id>` requièrent votre session `rebase cloud login`. Un token ne peut pas lister, créer ou révoquer des tokens, car un token capable de générer des tokens pourrait générer son propre successeur.
- **La restauration.** Aucune capacité n'autorise la restauration d'une sauvegarde ou une opération de `restore` et `cutover` à un instant précis. Écraser une base de données en production avec des données anciennes reste l'apanage d'un propriétaire ou d'un administrateur connecté.

`rebase cloud whoami` avec un token défini indique ce qu'il a le droit de faire, et sur quel projet. `rebase cloud tokens revoke <id> --yes` le révoque immédiatement.

## Ressources de calcul et coûts

Le prix d'un projet dépend de ce qu'il réserve, et non d'un forfait. `compute` affiche chaque curseur de réglage ainsi que le devis détaillé établi par le control plane. (`rebase cloud resources` est différent : ce sont les bases de données et buckets déclarés par le code, et l'état de provisionnement de chacun — voir la [référence de la CLI](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Réglage | Unité et signification |
|---|---|
| `--cpu`, `--memory` | Requête de l'application par instance, ex. `500m` et `2Gi`. Laisser vide applique la valeur par défaut de la plateforme — `250m` et `512Mi` |
| `--replicas` | Instances existant en permanence : le plancher de l'autoscaler, et ce pour quoi le projet est facturé au repos |
| `--autoscale-max` | 1–16. Le plafond qu'il peut atteindre, et le scénario maximal facturé. `--no-autoscale` le désactive |
| `--autoscale-cpu-target` | 10–95. L'utilisation CPU visée par l'autoscaler, calculée par rapport à la requête plutôt qu'à la limite. Laisser vide équivaut à 70 |
| `--spot` | `true` ou `false`. Capacité préemptible : moins chère, mais redémarrée sans préavis |
| `--scale-to-zero` | `true` ou `false`. Calcul facturé à la requête qui s'arrête lorsqu'inactif, au prix d'un démarrage à froid |
| `--db-instances` | 1–3. `1` est une instance unique sans basculement ; `2` ajoute un standby automatique |
| `--db-cpu`, `--db-memory`, `--storage` | Par instance de base de données. Laisser vide équivaut à `500m`, `2Gi` et au volume par défaut |

Un réglage laissé vide n'est pas identique à un réglage fixé à la même valeur : un réglage vide suit la valeur par défaut de la plateforme et évolue avec elle.

Rien n'est validé par la CLI, à dessein — les limites dépendent du cluster sur lequel tourne le projet, et elles diffèrent selon les fournisseurs. Le control plane refuse toute valeur qu'il ne peut satisfaire et indique le champ concerné. Exécutez `rebase cloud compute` pour voir le montant en €/mois avant et après ; une modification s'applique immédiatement, au prorata à compter d'aujourd'hui, sauf celle qui redémarre la base de données, qui attend une fenêtre de maintenance.

## Le reste des commandes

| Groupe de commandes | Ce que cela couvre |
|---|---|
| `login`, `logout`, `whoami` | Votre session |
| `tokens` | Tokens pour la CI et les agents, chacun restreint à un projet. Voir [CI et agents](#ci-et-agents) |
| `link`, `unlink`, `use`, `open` | Liaison de ce répertoire à un projet, sélection d'une organisation, ouverture de la console |
| `projects` | Créer, lister, inspecter, supprimer |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Déploiement et surveillance |
| `start`, `stop`, `restart` | Mettre un projet en pause et le réactiver |
| `status`, `metrics`, `debug` | Ce qu'il fait, et pourquoi il ne le fait pas |
| `cron` | Les tâches cron de l'application déployée et leurs exécutions enregistrées, lues avec votre session `rebase cloud`. En lecture seule |
| `env` | Variables d'environnement. `list` n'affiche jamais les valeurs ; `--secret` est en écriture seule |
| `domains` | Domaines personnalisés, enregistrements DNS à ajouter et vérification. Un projet peut répondre sur plusieurs domaines, chacun vérifié individuellement ; `verify` et `remove` prennent le domaine concerné, qui ne peut être omis que s'il n'y en a qu'un seul (pour `verify`, un seul encore en attente). `list --json` retourne `{ projectId, tenantHost, domains: [...] }` |
| `db` | Rattacher ou créer une base de données, s'y connecter depuis votre machine, sauvegardes, restauration et récupération à un instant précis (PITR) |
| `extensions` | La liste d'autorisation des extensions Postgres |
| `storage` | Le bucket du projet |
| `resources` | Quelles bases de données et quels buckets la plateforme héberge, par rapport à ce que le code déclare |
| `compute` | Ce que ce projet réserve, ce qu'il coûte et comment le modifier |
| `clusters` | Les clusters sur lesquels tournent les tenants. Réservé aux administrateurs de la plateforme |
| `settings`, `orgs`, `webhooks`, `billing` | Paramètres du projet, organisations, webhooks de déploiement, facturation |

Chaque groupe de ce tableau répond à `--help` par une page dédiée — une ligne d'utilisation, ses flags et des exemples — et `--help` n'exécute jamais la commande. Un test vérifie l'index de ces pages, de sorte qu'un groupe ajouté sans page dédiée fait échouer le build au lieu de renvoyer vers la table des matières. `verify:docs` aligne le tableau lui-même sur cet index : chaque groupe géré par la CLI apparaît ici exactement une fois, de sorte qu'un groupe ajouté sans ligne dédiée fait également échouer le build.

Lorsqu'il est redirigé dans un pipe, `--help` répond en JSON : la même ligne d'utilisation, les mêmes flags et exemples sous forme d'une structure lisible plutôt que soixante lignes de séquences d'échappement de terminal.

## Ce que la bêta n'inclut pas

Exposé clairement, car le découvrir plus tard est bien pire :

- **Pas de choix de région.** Tout s'exécute dans une seule région aujourd'hui. Le modèle de placement existe sur la plateforme, mais un projet ne peut pas choisir de région. `projects create --provider` et `--region` ne font pas exception contrairement aux apparences : ils enregistrent à quelle cible de déploiement enregistrée du control plane un projet appartient, et il n'y en a qu'une seule, de sorte que les deux adoptent cette valeur par défaut et qu'aucun ne déplace un projet ailleurs. `rebase cloud projects create --help` indique la même chose.
- **Pas de libre-service.** L'accès est accordé par vagues ; il n'y a pas d'inscription avec paiement direct.
- **Aucun SLA publié**, ni SOC 2. Si vous avez besoin de l'un ou de l'autre, mentionnez-le lors de votre demande d'accès plutôt que de le présumer.
- **Pas de déploiements de prévisualisation (preview) ou par branche**, et pas de GitHub App officielle. Les deploy hooks — des URL secrètes vers lesquelles vous pointez un webhook de dépôt — constituent l'automatisation prise en charge.
- **Les tokens agissent en tant que personne.** Un [token](#ci-et-agents) est généré par un compte et agit en son nom ; il n'y a pas encore d'identité machine appartenant à une organisation. Si vous vous connectez depuis la CI, passez plutôt `REBASE_CLOUD_EMAIL` et `REBASE_CLOUD_PASSWORD` depuis un gestionnaire de secrets — `--password` inscrit le mot de passe dans l'historique de votre shell et dans la table des processus, et vous en avertit avant de vous connecter. Si le fichier `.rebase/cloud.json` du dépôt mentionne un control plane autre que celui de la plateforme, passez-le également via `--url` : sans terminal, `login` refuse d'envoyer un mot de passe à un hôte qui n'a été spécifié que dans le fichier extrait du dépôt.
- **La restauration à un instant précis (PITR) se fait uniquement via la CLI.** La console affiche les sauvegardes ; le workflow par étapes de PITR s'effectue via `rebase cloud db pitr`.
- **Pas de point de terminaison public pour la base de données.** Une base de données managée n'est pas exposée à Internet, ainsi l'hôte affiché par la console est l'adresse utilisée par votre backend et ne résout rien sur votre machine locale. `rebase cloud db connect` ouvre un port local qui correspond à cette base de données, tunnelisée via le control plane, aussi longtemps que vous le laissez tourner — mais il n'existe aucun nom d'hôte permanent auquel un service tiers puisse se connecter. Ce tunnel, tout comme le mot de passe révélé par `rebase cloud db info --reveal`, nécessitent tous deux le rôle d'administrateur ou de propriétaire de l'organisation : le même que requiert l'éditeur SQL de Studio, car tous trois débouchent sur une session sur vos données de production.

## S'auto-héberger à la place

Rien ici n'impose de verrouillage propriétaire. Le [guide d'auto-hébergement](/docs/deployment/self-hosting/) exécute l'image et le bundle à l'identique avec `docker compose`, et le [guide Kubernetes](/docs/deployment/kubernetes/) déploie la même topologie à partir du chart Helm.
