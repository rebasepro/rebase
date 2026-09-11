---
sourceHash: 535999d55c2b1a7c
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud est le même Rebase, opéré pour vous. Ce que c'est, comment un projet se lie et se déploie, et ce que la version bêta privée n'inclut pas encore.
---

Rebase Cloud exécute le même Rebase open-source que vous hébergeriez vous-même — la même
image `rebasepro/server` publiée, le même bundle, le même Postgres. La
différence réside dans la personne qui l'opère.

:::note[Bêta privée]
Rebase Cloud est en **bêta privée**. La plateforme héberge de vrais locataires aujourd'hui et ouvre ses accès
par vagues. [Demander l'accès](https://rebase.pro/pricing).

Ce n'est pas en libre-service, donc les commandes ci-dessous nécessitent un compte ayant été autorisé.
Tout le reste sur ce site fonctionne sans compte.
:::

## Ce que c'est

Un **projet** Cloud correspond à trois éléments que la plateforme gère pour vous :

| | Ce que vous obtenez |
|---|---|
| **App** | Votre bundle, s'exécutant sur l'image de runtime publiée. Les déploiements sont un téléversement de bundle, pas un build de conteneur |
| **Base de données** | Un PostgreSQL managé, avec sauvegardes automatisées et restauration à un instant précis (point-in-time recovery) |
| **Stockage** | Votre propre compartiment (bucket), si votre projet utilise le stockage de fichiers |

Chaque élément est provisionné lors de votre premier déploiement, et chacun est facturé selon ce qu'il
réserve plutôt que par utilisateur.

**Rien ne change dans votre projet pour y fonctionner.** Le même dépôt
s'auto-héberge avec `docker compose`, et la porte de sortie existe bel et bien : `rebase build`
produit un bundle qui démarre partout où l'image de runtime fonctionne.

## Lier un projet

Depuis le répertoire d'un projet :

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`projects create` ne prend aucun argument positionnel. Le nom et le sous-domaine sont
des drapeaux (flags), et tous deux sont requis — dans un terminal, ils vous sont demandés, et une
exécution sans interface interactive qui omet l'un ou l'autre se termine avec `input_required` au lieu d'en
inventer un. **Le sous-domaine ne peut plus être modifié par la suite :** il s'agit de
l'hôte `<slug>.rebase.website` sur lequel le projet répond, choisissez-le donc méticuleusement.

`--link` associe ce répertoire au projet dans le même appel, il n'y a donc pas
d'étape `link` distincte. Cela écrit `.rebase/cloud.json`, qui enregistre l'identifiant et
le slug du projet. Ce fichier n'est pas un secret et ne contient pas vos identifiants — ceux-ci résident
dans `~/.rebase/credentials.json`, écrit par `login`.

`billing setup` associe une carte bancaire à l'organisation, une seule fois. Cette commande est intentionnellement
placée en premier dans la séquence : le premier déploiement d'un projet est refusé sans carte, et
s'en rendre compte une fois le bundle entièrement téléversé est bien plus frustrant.

Un projet existant peut être lié sans en créer un nouveau :

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Déployer

```bash
rebase cloud deploy
```

Une seule commande, et aucun drapeau à mémoriser. Le fichier `rebase.json` d'un projet généré déclare
`runtime: "managed"` pour son backend, et `deploy` lit cette déclaration — il
l'indique au passage (`rebase.json declares runtime: managed — deploying a
bundle`), compile l'application dans `dist-bundle`, téléverse le bundle, l'exécute sur
l'image de runtime publiée, et suit le déploiement jusqu'à un état terminal. Le code
de sortie sert de verdict, la même ligne fonctionne donc de façon autonome dans la CI.

Pour déployer un artefact compilé plus tôt — par exemple, un job CI qui compile une fois et
déploie deux fois —, pointez vers le répertoire au lieu de recompiler :

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Quitter le runtime managé nécessite un drapeau spécifique, `--eject`, et rien d'autre ne
le demandera : un build qui transférerait un projet managé vers une image de conteneur dont
il deviendrait responsable est refusé tant que vous ne l'avez pas explicitement demandé. `--force` servait autrefois à cela, ce qui plaçait
l'action la moins réversible que la CLI puisse accomplir sous le même terme que "écraser ce
fichier" ; il s'agit désormais d'une option inconnue plutôt que d'un alias, de sorte qu'un script qui l'utilise
s'arrête immédiatement.

Suivre le statut :

```bash
rebase cloud logs            # le journal de build
rebase cloud logs --runtime  # ce que le conteneur en cours d'exécution affiche
rebase cloud status          # ce que la plateforme pense que le projet est en train de faire
```

`status` rapporte `blockedOn` et `nextAction`. Lorsque `blockedOn` est `null`, la
plateforme est véritablement en train de travailler et interroger son statut est la bonne chose à faire ; lorsqu'il mentionne
quelque chose, c'est que ce quelque chose attend votre action.

## Restaurer une version antérieure (Roll back)

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback fait pointer à nouveau le projet vers ce qu'un déploiement antérieur réussi
avait mis en production, et ne recompile jamais — l'intérêt d'un rollback est qu'il déploie un
artefact qui a déjà fonctionné.

L'éligibilité des déploiements dépend de la manière dont le projet est déployé, et les deux approches
fonctionnent :

| Comment il a été déployé | Ce qui est restauré |
|---|---|
| `rebase cloud deploy` (un build source) | L'image publiée par ce build |
| `rebase cloud deploy --bundle` (le runtime de la plateforme) | Le bundle livré par ce déploiement, sur la version de runtime actuellement utilisée par le projet |

Un rollback nécessite donc un déploiement ayant enregistré l'un des deux, ce qui implique
un projet qui s'est déployé avec succès au moins deux fois. `rebase cloud deployments`
indique ceux qui sont éligibles, et `--json` renvoie `rollbackable` par ligne ainsi
que l'`image` ou le `bundle` qui serait restauré.

Deux types de déploiements sont refusés, et la CLI précise lesquels : un qui n'a pas abouti,
et un datant d'avant que la plateforme n'enregistre son artefact. Il n'y a pas de place pour la devinette
dans un cas comme dans l'autre — deviner reviendrait à livrer ce qui a été compilé ou téléversé le plus
récemment tout en prétendant restaurer celui-ci — déployez donc plutôt la version souhaitée.

Un rollback ajoute un nouveau déploiement plutôt que de réécrire l'historique, et attend que
la version restaurée soit en service avant d'indiquer le succès. Suivez-le avec
`rebase cloud logs -f`.

## Le calcul (Compute) et ses coûts

Le prix d'un projet dépend de ce qu'il réserve, pas d'un forfait. `compute` affiche
chaque curseur ainsi que le devis détaillé établi par le plan de contrôle pour ceux-ci. (`rebase cloud
resources` est une commande différente : les bases de données et compartiments déclarés par le code,
et le statut de provisionnement de chacun — consultez la [référence de la CLI](/docs/cli/#rebase-cloud).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Curseur | Unité et signification |
|---|---|
| `--cpu`, `--memory` | Demande (request) de l'app par instance, ex. `500m` et `2Gi`. Une valeur vide correspond au défaut de la plateforme — `250m` et `512Mi` |
| `--replicas` | Instances existant en permanence : le plancher de l'autoscaler, et ce qui est facturé au repos pour le projet |
| `--autoscale-max` | 1–16. Le plafond pouvant être atteint, et le scénario maximal pouvant être facturé. `--no-autoscale` le désactive |
| `--autoscale-cpu-target` | 10–95. L'utilisation CPU maintenue par l'autoscaler, par rapport à la demande (request) plutôt qu'à la limite. Une valeur vide correspond à 70 |
| `--spot` | `true` ou `false`. Capacité préemptible : moins chère, mais redémarrée sans préavis |
| `--scale-to-zero` | `true` ou `false`. Calcul facturé à la requête qui s'arrête en cas d'inactivité, au prix d'un démarrage à froid |
| `--db-mode` | `shared` (le cluster mutualisé) ou `dedicated` (un cluster dédié au projet) |
| `--db-instances` | 1–3. `1` est une instance unique sans basculement (failover) ; `2` ajoute une instance de secours automatique |
| `--db-cpu`, `--db-memory`, `--storage` | Par instance de base de données. Vide signifie `500m`, `2Gi` et le volume par défaut |

Un curseur vide n'est pas équivalent à un curseur fixé au même montant : un curseur vide
suit la valeur par défaut de la plateforme et évolue en même temps qu'elle.

Rien n'est validé par la CLI, délibérément — les limites dépendent du cluster sur
lequel tourne un projet, et elles diffèrent d'un fournisseur à l'autre. Le plan de contrôle refuse
toute valeur qu'il ne peut pas honorer et nomme le champ concerné. Exécutez `rebase cloud compute` pour voir
les €/mois avant et après ; une modification s'applique immédiatement, au prorata à partir d'aujourd'hui,
sauf celle qui redémarre la base de données, qui attendra une fenêtre de maintenance.

## Les autres commandes

| Groupe de commandes | Ce qu'il couvre |
|---|---|
| `login`, `logout`, `whoami` | Votre session |
| `link`, `unlink`, `use`, `open` | Lier ce répertoire à un projet, sélectionner une organisation, ouvrir la console |
| `projects` | Créer, lister, inspecter, supprimer |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Déployer et surveiller |
| `start`, `stop`, `restart` | Mettre en pause un projet et le réactiver |
| `status`, `metrics`, `debug` | Ce qu'il fait, et pourquoi il ne le fait pas |
| `env` | Variables d'environnement. `list` n'affiche jamais les valeurs ; `--secret` est en écriture seule |
| `domains` | Domaines personnalisés, enregistrements DNS à ajouter, et vérification |
| `db` | Attacher ou créer une base de données, s'y connecter depuis votre machine, sauvegardes, restauration et récupération à un instant précis (PITR) |
| `extensions` | La liste d'autorisations des extensions Postgres |
| `storage` | Le compartiment (bucket) du projet |
| `resources` | Les bases de données et compartiments détenus par la plateforme, par rapport à ce que le code déclare |
| `compute` | Ce que ce projet réserve, ce qu'il coûte et comment le modifier |
| `clusters` | Les clusters sur lesquels tournent les locataires. Administrateurs de la plateforme uniquement |
| `settings`, `orgs`, `webhooks`, `billing` | Paramètres du projet, organisations, webhooks de déploiement, facturation |

Chaque groupe dans ce tableau répond à `--help` par une page dédiée — une ligne d'utilisation,
ses drapeaux et des exemples — et `--help` n'exécute jamais la commande. Un test vérifie
l'index des pages, de sorte qu'un groupe ajouté sans page fait échouer le build au lieu de
répondre par la table des matières. `verify:docs` soumet le tableau lui-même à
cet index : chaque groupe géré par la CLI apparaît ici exactement une fois, ainsi un groupe
ajouté sans sa ligne fait également échouer le build.

Redirigé dans un pipe, `--help` répond en JSON : la même ligne d'utilisation, les mêmes drapeaux et exemples
sous forme de structure exploitable plutôt que sous la forme de soixante lignes de séquences d'échappement pour terminal.

## Ce que la bêta n'inclut pas

Énoncé clairement, car l'apprendre sur le tard est bien plus fâcheux :

- **Aucun choix de région.** Tout s'exécute dans une seule région actuellement. Le modèle de
  placement existe au sein de la plateforme, mais un projet ne peut pas choisir sa région.
  `projects create --provider` et `--region` ne sont pas l'exception qu'ils paraissent être :
  ils enregistrent à laquelle des cibles de déploiement enregistrées par le plan de contrôle appartient un
  projet, et il n'y en a qu'une seule ; les deux prennent donc cette valeur par défaut et aucun ne déplace
  le projet ailleurs. `rebase cloud projects create --help` précise la même chose.
- **Pas de libre-service.** Les accès sont accordés par vagues ; il n'y a pas d'inscription directe avec paiement.
- **Aucun SLA publié**, et pas de SOC 2. Si vous avez besoin de l'un ou de l'autre, mentionnez-le lors de votre
  demande d'accès plutôt que de le présupposer.
- **Pas de déploiements de prévisualisation ou de branche**, et pas d'application GitHub native. Les webhooks de déploiement —
  des URL secrètes vers lesquelles pointer le webhook d'un dépôt — constituent l'automatisation prise en charge.
- **La CI a besoin des identifiants d'un utilisateur humain.** Il n'y a pas encore de jeton machine ;
  `rebase cloud login` requiert un e-mail et un mot de passe. Transmettez-les sous forme de
  `REBASE_CLOUD_EMAIL` et `REBASE_CLOUD_PASSWORD` depuis un gestionnaire de secrets —
  `--password` enregistre le mot de passe dans l'historique de votre shell et dans la table des processus,
  et vous en avertit avant de vous connecter.
- **La récupération à un instant précis (PITR) se fait uniquement en CLI.** La console affiche les sauvegardes ; le workflow
  de PITR par étapes correspond à `rebase cloud db pitr`.
- **Aucun point de terminaison de base de données public.** Une base de données managée n'est pas exposée à
  Internet, l'hôte que la console affiche est donc son adresse destinée à votre backend et
  ne résoudra rien sur votre machine. `rebase cloud db connect` ouvre un port local
  correspondant à cette base de données, tunnelisé via le plan de contrôle, tant que
  vous le laissez ouvert — mais il n'existe pas de nom d'hôte permanent auquel un service
  tiers peut se connecter.

## Préférer l'auto-hébergement

Rien ici ne vous enferme. Le [guide d'auto-hébergement](/docs/deployment/self-hosting/)
exécute l'image et le bundle identiques avec `docker compose`, et le
[guide Kubernetes](/docs/deployment/kubernetes/) reproduit la même topologie à partir
du chart Helm.

---
