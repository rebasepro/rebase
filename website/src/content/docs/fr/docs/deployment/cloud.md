---
sourceHash: 11eb4597bacc7658
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud est le même Rebase, géré pour vous. De quoi il s'agit, comment lier et déployer un projet, et ce que la bêta privée n'inclut pas encore.
---

Rebase Cloud exécute le même Rebase open source que vous hébergeriez vous-même — la même
image publiée `rebasepro/server`, le même bundle, le même Postgres. La
différence réside dans qui l'exploite.

:::note[Bêta privée]
Rebase Cloud est en **bêta privée**. Il héberge de véritables tenants aujourd'hui et ouvre par
vagues. [Demander l'accès](https://rebase.pro/pricing).

Il n'est pas en libre-service, les commandes ci-dessous nécessitent donc un compte ayant été accepté.
Tout le reste sur ce site fonctionne sans compte.
:::

## De quoi s'agit-il

Un **projet** Cloud correspond à trois éléments que la plateforme gère pour vous :

| | Ce que vous obtenez |
|---|---|
| **App** | Votre bundle, s'exécutant sur l'image de runtime publiée. Les déploiements sont un téléversement de bundle, pas un build de conteneur |
| **Base de données** | Un PostgreSQL infogéré, avec sauvegardes automatisées et récupération à un point dans le temps (PITR) |
| **Stockage** | Votre propre bucket, si votre projet utilise le stockage de fichiers |

Chacun est provisionné lors de votre premier déploiement, et chacun est facturé en fonction
de ce qu'il réserve plutôt que par utilisateur.

**Rien ne change dans votre projet pour y fonctionner.** Le même dépôt s'auto-héberge
avec `docker compose`, et la porte de sortie est réelle : `rebase build`
produit un bundle qui démarre partout où l'image de runtime s'exécute.

## Lier un projet

Depuis le répertoire d'un projet :

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`projects create` ne prend aucun argument positionnel. Le nom et le sous-domaine sont
des options, et tous deux sont obligatoires — ils sont demandés dans un terminal, et une
exécution sans interface qui omet l'un ou l'autre se termine avec `input_required` plutôt que d'en
inventer un. **Le sous-domaine n'est pas modifiable par la suite :** il s'agit de l'hôte
`<slug>.rebase.website` sur lequel le projet répond, choisissez-le donc avec soin.

`--link` associe ce répertoire au projet dans le même appel, il n'y a donc pas d'étape
`link` distincte. Il écrit `.rebase/cloud.json`, qui enregistre l'identifiant et le slug du projet.
Ce fichier n'est pas un secret et ne contient pas vos identifiants — ceux-ci résident
dans `~/.rebase/credentials.json`, écrit par `login`.

`billing setup` associe une carte bancaire à l'organisation, une seule fois. Cette commande est
intentionnellement placée en premier dans la séquence : le premier déploiement d'un projet est refusé sans carte, et
s'en rendre compte après avoir terminé le téléversement d'un bundle est le pire scénario.

Un projet existant peut être lié sans en créer un nouveau :

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Déployer

```bash
rebase cloud deploy
```

Une seule commande, et aucune option à retenir. Le fichier `rebase.json` d'un scaffold déclare
`runtime: "managed"` pour son backend, et `deploy` lit cette déclaration — il
l'indique au passage (`rebase.json declares runtime: managed — deploying a
bundle`), compile l'application dans `dist-bundle`, téléverse le bundle, l'exécute sur
l'image de runtime publiée et suit le déploiement jusqu'à son état final. Le code de
sortie constitue le verdict, ce qui permet à la même ligne de fonctionner de manière autonome dans une CI.

Pour déployer un artefact compilé plus tôt — par exemple, un job CI qui compile une fois et
déploie deux fois —, pointez vers le répertoire au lieu de recompiler :

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Quitter le runtime géré possède sa propre option, `--eject`, et rien d'autre ne le
demande : un build qui transférerait un projet managé vers une image de conteneur dont il
devient propriétaire est refusé tant que vous ne l'avez pas demandé. `--force` avait auparavant
cette signification, ce qui plaçait l'action la moins réversible de la CLI sous le même terme
que « écraser ce fichier » ; il s'agit désormais d'une option inconnue plutôt que d'un alias,
de sorte qu'un script qui l'utilise s'arrête immédiatement.

Surveiller le déploiement :

```bash
rebase cloud logs            # the build log
rebase cloud logs --runtime  # what the running container is printing
rebase cloud status          # what the platform thinks the project is doing
```

`status` indique `blockedOn` et `nextAction`. Lorsque `blockedOn` est à `null`, la
plateforme travaille véritablement et l'interrogation régulière est la bonne chose à faire ;
lorsqu'il mentionne un élément, cet élément attend une action de votre part.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback redirige le projet vers ce qu'un déploiement réussi précédent avait
livré, et ne recompile jamais — l'intérêt d'un rollback est de livrer un
artefact qui a déjà fonctionné.

Les déploiements éligibles dépendent de la méthode de déploiement du projet, et les deux types
fonctionnent :

| Méthode de déploiement | Ce qui est restauré |
|---|---|
| `rebase cloud deploy` (un build source) | L'image publiée par ce build |
| `rebase cloud deploy --bundle` (le runtime de la plateforme) | Le bundle livré par ce déploiement, sur la version du runtime que le projet utilise actuellement |

Un rollback nécessite donc un déploiement ayant enregistré l'un des deux, ce qui implique
un projet ayant été déployé avec succès au moins deux fois. `rebase cloud deployments`
signale ceux qui sont éligibles, et `--json` renvoie `rollbackable` pour chaque ligne avec
l'`image` ou le `bundle` qui serait restauré.

Deux types de déploiements sont refusés, et la CLI précise lesquels : un déploiement qui n'a pas
réussi, et un déploiement antérieur à l'enregistrement des artefacts par la plateforme. Il n'y a rien à deviner
dans les deux cas — faire des suppositions reviendrait à déployer ce qui a été compilé ou téléversé le
plus récemment tout en prétendant restaurer cette version-ci — déployez donc plutôt la version souhaitée.

Un rollback ajoute un nouveau déploiement plutôt que de rembobiner l'historique, et attend
que la version restaurée réponde avant de confirmer le succès. Suivez-le avec
`rebase cloud logs -f`.

## Ressources de calcul et coûts

Le prix d'un projet est basé sur ce qu'il réserve, et non sur un palier forfaitaire. `compute` affiche
chaque paramètre ainsi que le devis détaillé établi par le plan de contrôle. (`rebase cloud
resources` est une commande différente : elle concerne les bases de données et buckets déclarés par le code,
et indique si chacun est provisionné — consultez la [référence de la CLI](/docs/cli/#rebase-cloud).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Paramètre | Unité et signification |
|---|---|
| `--cpu`, `--memory` | Demande (request) de l'application par instance, ex. `500m` et `2Gi`. Laisser vide applique la valeur par défaut de la plateforme — `250m` et `512Mi` |
| `--replicas` | Instances existant en permanence : le plancher de l'autoscaler, et ce qui est facturé au projet au repos |
| `--autoscale-max` | 1–16. Le plafond qu'il peut atteindre, et le montant maximal qui peut être facturé. `--no-autoscale` le désactive |
| `--autoscale-cpu-target` | 10–95. L'utilisation CPU visée par l'autoscaler, par rapport à la demande (request) plutôt qu'à la limite. Vide signifie 70 |
| `--spot` | `true` ou `false`. Capacité préemptible : moins chère, et redémarrée sans préavis |
| `--scale-to-zero` | `true` ou `false`. Calcul facturé à la requête qui s'arrête lorsqu'il est inactif, au prix d'un démarrage à froid |
| `--db-instances` | 1–3. `1` est une instance unique sans basculement ; `2` ajoute une instance de secours automatique |
| `--db-cpu`, `--db-memory`, `--storage` | Par instance de base de données. Laisser vide applique `500m`, `2Gi` et le volume par défaut |

Un paramètre laissé vide n'est pas identique à un paramètre fixé à la même valeur : un paramètre vide
suit les valeurs par défaut de la plateforme et évolue en même temps qu'elles.

Rien n'est validé par la CLI, délibérément — les limites dépendent du cluster sur lequel tourne le
projet, et elles diffèrent d'un fournisseur à l'autre. Le plan de contrôle refuse une
valeur qu'il ne peut pas honorer et nomme le champ concerné. Exécutez `rebase cloud compute` pour afficher
les €/mois avant et après ; une modification s'applique immédiatement, au prorata à compter d'aujourd'hui,
sauf celle qui redémarre la base de données, qui attend une fenêtre de maintenance.

## Le reste des fonctionnalités

| Groupe de commandes | Ce qu'il couvre |
|---|---|
| `login`, `logout`, `whoami` | Votre session |
| `link`, `unlink`, `use`, `open` | Associer ce répertoire à un projet, sélectionner une organisation, ouvrir la console |
| `projects` | Créer, lister, inspecter, supprimer |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Déploiement et surveillance |
| `start`, `stop`, `restart` | Mettre un projet en pause et le relancer |
| `status`, `metrics`, `debug` | Ce qu'il fait, et pourquoi il ne le fait pas |
| `env` | Variables d'environnement. `list` n'affiche jamais les valeurs ; `--secret` est en écriture seule |
| `domains` | Domaines personnalisés, enregistrements DNS à ajouter et vérification |
| `db` | Rattacher ou créer une base de données, s'y connecter depuis votre machine, sauvegardes, restauration et récupération à un point dans le temps |
| `extensions` | La liste d'autorisation des extensions Postgres |
| `storage` | Le bucket du projet |
| `resources` | Les bases de données et buckets gérés par la plateforme, par rapport à ce que le code déclare |
| `compute` | Ce que ce projet réserve, ce qu'il coûte et comment le modifier |
| `clusters` | Les clusters sur lesquels les tenants s'exécutent. Réservé aux administrateurs de la plateforme |
| `settings`, `orgs`, `webhooks`, `billing` | Paramètres du projet, organisations, webhooks de déploiement, facturation |

Chaque groupe de ce tableau répond à `--help` avec sa propre page — une ligne d'utilisation,
ses options et des exemples — et `--help` n'exécute jamais la commande. Un test contrôle
l'index des pages, ainsi un groupe ajouté sans page fait échouer le build plutôt que de
répondre avec la table des matières. `verify:docs` aligne la table elle-même sur cet index :
chaque groupe géré par la CLI apparaît ici exactement une fois, de sorte qu'un groupe
ajouté sans ligne dédiée fait également échouer le build.

Utilisé dans un pipe, `--help` répond en JSON : la même ligne d'utilisation, les options et
exemples sous forme de structure à lire plutôt que soixante lignes de séquences d'échappement de terminal.

## Ce que la bêta n'inclut pas

Exposé clairement, car le découvrir plus tard est bien pire :

- **Aucun choix de région.** Tout s'exécute dans une seule région aujourd'hui. Le modèle de placement
  existe dans la plateforme, mais un projet ne peut pas choisir de région.
  `projects create --provider` et `--region` ne sont pas l'exception qu'ils semblent
  être : ils enregistrent à quelle cible de déploiement enregistrée du plan de contrôle un
  projet appartient, et il n'y en a qu'une, donc les deux utilisent celle-ci par défaut et aucun ne déplace
  le projet ailleurs. `rebase cloud projects create --help` indique la même chose.
- **Pas de libre-service.** L'accès est accordé par vagues ; il n'y a pas d'inscription avec paiement direct.
- **Aucun SLA publié**, et pas de SOC 2. Si vous avez besoin de l'un ou de l'autre, mentionnez-le
  lors de votre demande d'accès plutôt que de le supposer.
- **Pas de déploiements de prévisualisation ou de branche**, et pas d'application GitHub officielle. Les hooks de déploiement —
  des URL secrètes vers lesquelles vous pointez un webhook de dépôt — constituent l'automatisation prise en charge.
- **La CI nécessite les identifiants d'un utilisateur humain.** Il n'existe pas encore de jeton machine ;
  `rebase cloud login` prend une adresse e-mail et un mot de passe. Transmettez-les via
  `REBASE_CLOUD_EMAIL` et `REBASE_CLOUD_PASSWORD` depuis un gestionnaire de secrets —
  `--password` place le mot de passe dans l'historique de votre shell et dans la table des processus,
  et vous en avertit avant de vous connecter.
- **La récupération à un point dans le temps (PITR) se fait uniquement via la CLI.** La console affiche les sauvegardes ; le flux de
  travail PITR par étapes s'effectue avec `rebase cloud db pitr`.
- **Aucun point de terminaison de base de données public.** Une base de données managée n'est pas exposée à
  Internet, donc l'hôte affiché par la console est l'adresse utilisée par votre backend et ne
  résout rien sur votre machine. `rebase cloud db connect` ouvre un port local qui correspond à cette base de données,
  tunnelé à travers le plan de contrôle, aussi longtemps que vous le laissez tourner — mais il n'existe aucun nom
  d'hôte permanent auquel un service tiers peut se connecter. Ce tunnel, ainsi que le mot de passe révélé par
  `rebase cloud db info --reveal`, nécessitent tous deux le rôle propriétaire ou administrateur
  de l'organisation : le même que celui exigé par l'éditeur SQL de Studio, car les trois débouchent sur
  une session accédant à vos données de production.

## Choisir l'auto-hébergement

Rien ici ne vous enferme. Le [guide d'auto-hébergement](/docs/deployment/self-hosting/)
exécute la même image et le même bundle avec `docker compose`, et le
[guide Kubernetes](/docs/deployment/kubernetes/) déploie la même topologie à partir
du Helm chart.
