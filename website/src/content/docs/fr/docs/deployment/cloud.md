---
sourceHash: 9e0f8ddeef2c5dcb
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud est le même Rebase, géré pour vous. Ce que c'est, comment lier et déployer un projet, et ce que la bêta privée n'inclut pas encore.
---

Rebase Cloud exécute le même Rebase open-source que vous auto-hébergeriez — la même
image `rebasepro/server` publiée, le même bundle, le même Postgres. La
différence réside dans la personne qui l'exploite.

:::note[Bêta privée]
Rebase Cloud est en **bêta privée**. Il fait tourner de véritables environnements
aujourd'hui et ouvre par vagues. [Demander un accès](https://rebase.pro/pricing).

Ce n'est pas en libre-service, donc les commandes ci-dessous nécessitent un compte
ayant été autorisé. Tout le reste sur ce site fonctionne sans compte.
:::

## Ce que c'est

Un **projet** Cloud correspond à trois éléments que la plateforme gère pour vous :

| | Ce que vous obtenez |
|---|---|
| **App** | Votre bundle, s'exécutant sur l'image de runtime publiée. Les déploiements sont un téléversement de bundle, pas une construction de conteneur |
| **Database** | Un PostgreSQL managé, avec sauvegardes automatisées et restauration à un instant précis dans le temps (point-in-time recovery) |
| **Storage** | Votre propre bucket, si votre projet utilise le stockage de fichiers |

Chacun est provisionné lors de votre premier déploiement, et chacun est facturé en
fonction de ce qu'il réserve plutôt que par utilisateur.

**Rien ne change dans votre projet pour y fonctionner.** Le même dépôt s'auto-héberge
avec `docker compose`, et la porte de sortie est bien réelle : `rebase build` produit
un bundle qui démarre partout où s'exécute l'image de runtime.

## Lier un projet

Depuis le répertoire d'un projet :

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`projects create` ne prend aucun argument positionnel. Le nom et le sous-domaine
sont des options (flags), et tous deux sont obligatoires — dans un terminal, ils
vous sont demandés, et une exécution non interactive (headless) qui omet l'un ou
l'autre se termine avec `input_required` plutôt que d'en inventer un. **Le
sous-domaine n'est pas modifiable par la suite :** c'est l'hôte `<slug>.rebase.website`
sur lequel le projet répond, choisissez-le donc avec soin.

`--link` associe ce répertoire au projet dans le même appel, il n'y a donc pas
d'étape `link` séparée. Cela écrit `.rebase/cloud.json`, qui enregistre l'identifiant
du projet et son slug. Ce fichier n'est pas un secret et ne contient pas vos
identifiants — ceux-ci résident dans `~/.rebase/credentials.json`, écrit par `login`.

`billing setup` associe une carte bancaire à l'organisation, une seule fois. Elle
apparaît en premier dans la séquence à dessein : le premier déploiement d'un projet
est refusé sans carte, et s'en rendre compte après que le bundle a fini d'être
téléversé est bien plus frustrant.

Un projet existant se lie sans en créer un nouveau :

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Déployer

```bash
rebase cloud deploy
```

Une seule commande, et aucun flag à mémoriser. Le `rebase.json` d'un scaffold déclare
`runtime: "managed"` pour son backend, et `deploy` lit cette déclaration — il l'indique
au passage (`rebase.json declares runtime: managed — deploying a bundle`), compile
l'application dans `dist-bundle`, téléverse le bundle, l'exécute sur l'image de
runtime publiée et suit le déploiement jusqu'à son état final. Le code de sortie fait
foi, cette même ligne fonctionne donc de manière automatisée en CI.

Pour déployer un artefact compilé plus tôt — par exemple un job CI qui compile une
fois et déploie deux fois —, ciblez le répertoire plutôt que de recompiler :

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Quitter le runtime managé nécessite son propre flag, `--eject`, et rien d'autre ne le
déclenche : un build qui transférerait un projet managé vers une image de conteneur
dont il devient propriétaire est refusé tant que vous ne l'indiquez pas explicitement.
Auparavant, `--force` avait cette signification, ce qui plaçait l'action la moins
réversible de la CLI sous le même terme qu'« écraser ce fichier » ; il s'agit
désormais d'une option inconnue plutôt que d'un alias, de sorte qu'un script qui
l'utilise s'arrêtera.

Pour surveiller :

```bash
rebase cloud logs            # the build log
rebase cloud logs --runtime  # what the running container is printing
rebase cloud status          # what the platform thinks the project is doing
```

`status` rapporte `blockedOn` et `nextAction`. Lorsque `blockedOn` est `null`, la
plateforme travaille activement et scruter son état est la bonne chose à faire ;
lorsqu'il mentionne un élément, cet élément vous attend.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback redirige le projet vers ce qu'un déploiement réussi précédent a livré,
et ne recompile jamais — tout l'intérêt d'un rollback est de déployer un artefact
qui a déjà fonctionné.

L'éligibilité des déploiements dépend de la manière dont le projet est déployé, et
les deux approches fonctionnent :

| Méthode de déploiement | Ce qui est restauré |
|---|---|
| `rebase cloud deploy` (un build source) | L'image publiée par ce build |
| `rebase cloud deploy --bundle` (le runtime de la plateforme) | Le bundle livré par ce déploiement, sur la version du runtime que le projet utilise actuellement |

Un rollback nécessite donc un déploiement ayant enregistré l'un des deux, ce qui
implique un projet ayant été déployé avec succès au moins deux fois. `rebase cloud deployments`
signale ceux qui sont éligibles, et `--json` renvoie le champ `rollbackable` pour
chaque ligne ainsi que l'`image` ou le `bundle` qui serait restauré.

Deux types de déploiements sont refusés, et la CLI précise lequel : un qui n'a pas
réussi, et un qui date d'avant l'enregistrement de son artefact par la plateforme.
Il n'y a pas lieu de deviner dans l'un ou l'autre cas — deviner reviendrait à déployer
ce qui a été compilé ou téléversé le plus récemment tout en prétendant restaurer
celui-ci — déployez donc plutôt la version souhaitée.

Un rollback ajoute un nouveau déploiement plutôt que de rembobiner l'historique, et
attend que la version restaurée soit en mesure de répondre aux requêtes avant de
confirmer le succès. Suivez-le avec `rebase cloud logs -f`.

## Puissance de calcul et tarification

Le prix d'un projet est calculé à partir de ce qu'il réserve, et non selon un forfait
(tier). `compute` affiche chaque paramètre ainsi que l'estimation détaillée établie
par le plan de contrôle. (`rebase cloud resources` est une commande différente :
elle concerne les bases de données et buckets déclarés par le code, et indique si
chacun est provisionné — voir la [référence de la CLI](/docs/cli/#rebase-cloud).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Paramètre | Unité et signification |
|---|---|
| `--cpu`, `--memory` | Requête de l'application par instance, ex. `500m` et `2Gi`. Laisser vide applique la valeur par défaut de la plateforme — `250m` et `512Mi` |
| `--replicas` | Instances qui existent en permanence : le plancher de l'autoscaler, et ce pour quoi le projet est facturé au repos |
| `--autoscale-max` | 1–16. Le plafond pouvant être atteint, et le montant maximal pouvant être facturé. `--no-autoscale` le désactive |
| `--autoscale-cpu-target` | 10–95. L'utilisation du processeur que l'autoscaler maintient, par rapport à la requête plutôt qu'à la limite. Laisser vide correspond à 70 |
| `--spot` | `true` ou `false`. Capacité préemptible : moins chère, et redémarrée sans préavis |
| `--scale-to-zero` | `true` ou `false`. Calcul facturé à la requête qui s'interrompt en cas d'inactivité, au prix d'un démarrage à froid |
| `--db-mode` | `shared` (le cluster mutualisé) ou `dedicated` (dédié à ce projet) |
| `--db-instances` | 1–3. `1` est une instance unique sans basculement (failover) ; `2` ajoute une instance de secours automatique |
| `--db-cpu`, `--db-memory`, `--storage` | Par instance de base de données. Laisser vide applique `500m`, `2Gi` et le volume par défaut |

Un paramètre non défini n'équivaut pas à un paramètre fixé à la même valeur : un
paramètre vide suit les valeurs par défaut de la plateforme et évolue avec elles.

Rien n'est validé par la CLI, à dessein — les limites dépendent du cluster sur lequel
tourne le projet, et elles varient selon les fournisseurs. Le plan de contrôle refuse
toute valeur qu'il ne peut satisfaire et indique le champ concerné. Exécutez
`rebase cloud compute` pour afficher les montants en €/mois avant et après ; une
modification s'applique immédiatement, au prorata à compter d'aujourd'hui, sauf si
elle redémarre la base de données, auquel cas elle attend une fenêtre de maintenance.

## Le reste des commandes

| Groupe de commandes | Ce qu'il couvre |
|---|---|
| `login`, `logout`, `whoami` | Votre session |
| `link`, `unlink`, `use`, `open` | Liaison de ce répertoire à un projet, sélection d'une organisation, ouverture de la console |
| `projects` | Création, liste, inspection, suppression |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Déploiement et surveillance |
| `start`, `stop`, `restart` | Mise en pause d'un projet et reprise |
| `status`, `metrics`, `debug` | Ce qu'il fait, et la raison pour laquelle il ne le fait pas |
| `env` | Variables d'environnement. `list` n'affiche jamais les valeurs ; `--secret` est en écriture seule |
| `domains` | Domaines personnalisés, enregistrements DNS à ajouter et vérification |
| `db` | Attacher ou créer une base de données, s'y connecter depuis votre machine, sauvegardes, restauration et récupération à un instant précis (point-in-time recovery) |
| `extensions` | Liste autorisée des extensions Postgres |
| `storage` | Le bucket du projet |
| `resources` | Bases de données et buckets gérés par la plateforme par rapport à ce que le code déclare |
| `compute` | Ce que ce projet réserve, ce qu'il coûte et comment le modifier |
| `clusters` | Les clusters sur lesquels tournent les environnements clients. Réservé aux administrateurs de la plateforme |
| `settings`, `orgs`, `webhooks`, `billing` | Paramètres du projet, organisations, hooks de déploiement, facturation |

Chaque groupe de ce tableau répond à `--help` par sa propre page — une ligne d'utilisation,
ses options et des exemples — et `--help` n'exécute jamais la commande. Un test vérifie
la conformité de l'index des pages, de sorte qu'un groupe ajouté sans page fait échouer
le build au lieu de renvoyer la table des matières. `verify:docs` aligne le tableau lui-même
sur cet index : chaque groupe géré par la CLI apparaît ici exactement une fois, donc un
groupe ajouté sans ligne dédiée fait également échouer le build.

Redirigé via un pipe, `--help` renvoie du JSON : la même ligne d'utilisation, les
mêmes options et exemples sous forme d'une structure lisible plutôt que soixante lignes
de caractères d'échappement de terminal.

## Ce que la bêta n'inclut pas

Énoncé clairement, car l'apprendre plus tard est bien pire :

- **Pas de choix de région.** Tout s'exécute dans une seule région aujourd'hui. Le
  modèle de placement existe dans la plateforme, mais un projet ne peut pas choisir sa
  région. `projects create --provider` et `--region` ne font pas exception malgré les
  apparences : ils enregistrent simplement à quelle cible de déploiement déclarée du
  plan de contrôle appartient le projet, et il n'y en a qu'une, donc les deux prennent
  cette valeur par défaut et aucun des deux ne déplace le projet ailleurs.
  `rebase cloud projects create --help` précise la même chose.
- **Pas de libre-service.** L'accès est accordé par vagues ; il n'y a pas d'inscription
  avec paiement direct.
- **Pas de SLA publié**, ni de conformité SOC 2. Si vous avez besoin de l'un ou de l'autre,
  mentionnez-le lors de votre demande d'accès plutôt que de faire des suppositions.
- **Pas de déploiements de prévisualisation (preview) ni de branche**, et pas d'application
  GitHub officielle. Les hooks de déploiement — des URL secrètes vers lesquelles vous pointez
  un webhook de dépôt — constituent l'automatisation prise en charge.
- **La CI nécessite les identifiants d'un utilisateur humain.** Il n'y a pas encore de token
  machine ; `rebase cloud login` requiert un e-mail et un mot de passe. Transmettez-les via
  `REBASE_CLOUD_EMAIL` et `REBASE_CLOUD_PASSWORD` depuis un gestionnaire de secrets —
  `--password` place le mot de passe dans l'historique de votre shell et dans la table des
  processus, et vous en avertit avant de vous connecter.
- **La restauration à un instant précis (PITR) se fait uniquement en CLI.** La console affiche
  les sauvegardes ; le workflow PITR par étapes s'effectue avec `rebase cloud db pitr`.
- **Pas de point de terminaison public pour la base de données.** Une base de données managée
  n'est pas exposée sur Internet, donc l'hôte affiché dans la console correspond à l'adresse
  utilisée par votre backend et ne résout rien sur votre machine locale. `rebase cloud db connect`
  ouvre un port local relié à cette base de données, tunnelisé via le plan de contrôle, tant que
  vous le laissez tourner — mais il n'existe pas de nom d'hôte permanent auquel un service tiers
  pourrait se connecter. Ce tunnel, ainsi que le mot de passe accessible via
  `rebase cloud db info --reveal`, requièrent tous deux le rôle propriétaire (owner) ou administrateur
  de l'organisation : le même rôle demandé par l'éditeur SQL de Studio, car ces trois accès ouvrent
  une session directe sur vos données de production.

## Choisir l'auto-hébergement

Rien ici ne vous enferme (aucun lock-in). Le [guide d'auto-hébergement](/docs/deployment/self-hosting/)
fait tourner une image et un bundle identiques avec `docker compose`, et le
[guide Kubernetes](/docs/deployment/kubernetes/) applique la même topologie à partir
du chart Helm.

---
