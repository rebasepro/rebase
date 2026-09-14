---
sourceHash: 11eb4597bacc7658
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: Rebase Cloud est le même Rebase, opéré pour vous. De quoi il s'agit, comment lier et déployer un projet, et ce que la bêta privée n'inclut pas encore.
---

Rebase Cloud exécute le même Rebase open source que vous hébergeriez vous-même — la même image publiée `rebasepro/server`, le même bundle, le même Postgres. La différence réside dans qui l'opère.

:::note[Bêta privée]
Rebase Cloud est en **bêta privée**. Il héberge de véritables tenants aujourd'hui et s'ouvre par vagues. [Demander un accès](https://rebase.pro/pricing).

Il n'est pas en libre-service, les commandes ci-dessous nécessitent donc un compte autorisé. Tout le reste sur ce site fonctionne sans compte.
:::

## Ce que c'est

Un **projet** Cloud correspond à trois éléments que la plateforme gère pour vous :

| | Ce que vous obtenez |
|---|---|
| **App** | Votre bundle, tournant sur l'image de runtime publiée. Les déploiements sont un upload de bundle, pas un build de conteneur |
| **Database** | Un PostgreSQL managé, avec sauvegardes automatisées et restauration à un instant précis (point-in-time recovery) |
| **Storage** | Votre propre bucket, si votre projet utilise le stockage de fichiers |

Chacun est provisionné lors de votre premier déploiement, et chacun est facturé en fonction de ce qu'il réserve plutôt que par utilisateur.

**Rien ne change dans votre projet pour s'y exécuter.** Le même dépôt s'auto-héberge avec `docker compose`, et la porte de sortie est réelle : `rebase build` produit un bundle qui démarre partout où s'exécute l'image de runtime.

## Lier un projet

Depuis le répertoire d'un projet :

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`projects create` ne prend aucun argument positionnel. Le nom et le sous-domaine sont des flags, et tous deux sont obligatoires — dans un terminal, ils vous sont demandés, et une exécution non interactive (headless) qui omet l'un d'eux se termine avec `input_required` au lieu d'en inventer un. **Le sous-domaine n'est pas modifiable par la suite :** c'est l'hôte `<slug>.rebase.website` sur lequel le projet répond, alors choisissez-le soigneusement.

`--link` associe ce répertoire au projet au sein du même appel, évitant ainsi une étape `link` distincte. Il écrit `.rebase/cloud.json`, qui enregistre l'id et le slug du projet. Ce fichier n'est pas un secret et ne contient pas vos identifiants — ceux-ci résident dans `~/.rebase/credentials.json`, écrit par `login`.

`billing setup` associe une carte bancaire à l'organisation, une seule fois. Cette commande est placée en premier dans la séquence à dessein : le premier déploiement d'un projet est refusé sans carte, et s'en apercevoir après la fin du téléversement du bundle est le pire scénario.

Lier un projet existant sans en créer un :

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Déployer

```bash
rebase cloud deploy
```

Une seule commande, et aucun flag à mémoriser. Le `rebase.json` d'un scaffold déclare `runtime: "managed"` pour son backend, et `deploy` lit cette déclaration — il l'indique au passage (`rebase.json declares runtime: managed — deploying a bundle`), compile l'application dans `dist-bundle`, téléverse le bundle, l'exécute sur l'image de runtime publiée, et suit le déploiement jusqu'à un état final. Le code de sortie fait foi, cette même ligne fonctionne donc sans intervention humaine dans une CI.

Pour déployer un artefact compilé précédemment — par exemple un job CI qui compile une fois et déploie deux fois —, pointez vers le répertoire au lieu de recompiler :

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Quitter le runtime managé se fait via son propre flag, `--eject`, et rien d'autre ne le demande : un build qui transférerait un projet managé vers une image de conteneur qu'il possède alors est refusé tant que vous ne le confirmez pas explicitement. `--force` avait autrefois cette signification, ce qui plaçait l'action la moins réversible de la CLI sous le même terme que « écraser ce fichier » ; il s'agit désormais d'une option inconnue plutôt que d'un alias, de sorte qu'un script qui la contiendrait s'arrête net.

Pour le suivre :

```bash
rebase cloud logs            # the build log
rebase cloud logs --runtime  # what the running container is printing
rebase cloud status          # what the platform thinks the project is doing
```

`status` indique `blockedOn` et `nextAction`. Lorsque `blockedOn` est `null`, la plateforme est réellement en train de travailler et faire du polling est la bonne chose à faire ; lorsqu'il mentionne quelque chose, c'est que ce quelque chose vous attend.

## Rollback

```bash
rebase cloud deployments
rebase cloud rollback
```

Un rollback redirige le projet vers ce qu'un déploiement réussi précédent avait livré, et ne recompile jamais — l'intérêt d'un rollback est qu'il déploie un artefact qui a déjà tourné.

Les déploiements éligibles dépendent de la manière dont le projet est déployé, et les deux cas fonctionnent :

| Comment il a été déployé | Ce qui est restauré |
|---|---|
| `rebase cloud deploy` (un build depuis les sources) | L'image publiée par ce build |
| `rebase cloud deploy --bundle` (le runtime de la plateforme) | Le bundle livré par ce déploiement, sur la version de runtime actuellement utilisée par le projet |

Un rollback nécessite donc un déploiement ayant enregistré l'un des deux, ce qui implique un projet ayant été déployé avec succès au moins deux fois. `rebase cloud deployments` marque ceux qui sont éligibles, et `--json` indique `rollbackable` par ligne ainsi que l'élément `image` ou `bundle` qu'il restaurerait.

Deux types de déploiements sont refusés, et la CLI précise lequel : un qui n'a pas abouti, et un datant d'avant que la plateforme n'enregistre son artefact. Il n'y a rien à deviner dans les deux cas — deviner reviendrait à livrer ce qui a été compilé ou téléversé le plus récemment tout en prétendant restaurer celui-ci — déployez donc plutôt la version souhaitée.

Un rollback ajoute un nouveau déploiement plutôt que de remonter l'historique, et attend que la version restaurée soit prête à répondre avant de signaler le succès. Suivez-le avec `rebase cloud logs -f`.

## Compute, et ce que cela coûte

Le prix d'un projet est calculé à partir de ce qu'il réserve, et non d'un forfait. `compute` affiche chaque curseur de configuration et le devis détaillé établi par le plan de contrôle. (`rebase cloud resources` est une commande différente : les bases de données et les buckets déclarés par le code, et si chacun est provisionné ou non — voir la [référence CLI](/docs/cli/#rebase-cloud).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Curseur | Unité et signification |
|---|---|
| `--cpu`, `--memory` | Demande (request) de l'application par instance, ex. `500m` et `2Gi`. Vide correspond à la valeur par défaut de la plateforme — `250m` et `512Mi` |
| `--replicas` | Instances existant en permanence : le plancher de l'autoscaler, et ce qui est facturé au projet au repos |
| `--autoscale-max` | 1–16. Le plafond qu'il peut atteindre, et le pire scénario de facturation. `--no-autoscale` le désactive |
| `--autoscale-cpu-target` | 10–95. L'utilisation CPU maintenue par l'autoscaler, par rapport à la demande (request) plutôt qu'à la limite. Vide signifie 70 |
| `--spot` | `true` ou `false`. Capacité préemptible : moins chère, et redémarrée sans préavis |
| `--scale-to-zero` | `true` ou `false`. Calcul facturé à la requête qui s'arrête en cas d'inactivité, au prix d'un démarrage à froid (cold start) |
| `--db-instances` | 1–3. `1` est une instance unique sans basculement (failover) ; `2` ajoute une instance de secours (standby) automatique |
| `--db-cpu`, `--db-memory`, `--storage` | Par instance de base de données. Vide signifie `500m`, `2Gi` et le volume par défaut |

Un curseur vide n'est pas identique à un curseur fixé à la même valeur : un curseur vide suit la valeur par défaut de la plateforme et évolue avec elle.

Rien n'est validé par la CLI, délibérément — les limites appartiennent au cluster sur lequel s'exécute le projet, et elles diffèrent d'un fournisseur à l'autre. Le plan de contrôle refuse toute valeur qu'il ne peut honorer et indique le champ concerné. Exécutez `rebase cloud compute` pour voir les €/mois avant et après ; une modification s'applique immédiatement, au prorata à compter d'aujourd'hui, sauf celle redémarrant la base de données, qui attend une fenêtre de maintenance.

## Le reste des commandes

| Groupe de commandes | Ce qu'il couvre |
|---|---|
| `login`, `logout`, `whoami` | Votre session |
| `link`, `unlink`, `use`, `open` | Lier ce répertoire à un projet, sélectionner une organisation, ouvrir la console |
| `projects` | Créer, lister, inspecter, supprimer |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Déployer et observer |
| `start`, `stop`, `restart` | Mettre en pause un projet et le relancer |
| `status`, `metrics`, `debug` | Ce qu'il fait, et pourquoi il ne le fait pas |
| `env` | Variables d'environnement. `list` n'affiche jamais les valeurs ; `--secret` est en écriture seule |
| `domains` | Domaines personnalisés, enregistrements DNS à ajouter et vérification |
| `db` | Attacher ou créer une base de données, s'y connecter depuis votre machine, sauvegardes, restauration et restauration à un instant précis (point-in-time recovery) |
| `extensions` | Liste d'autorisations (allowlist) des extensions Postgres |
| `storage` | Le bucket du projet |
| `resources` | Quelles bases de données et buckets la plateforme gère, comparé à ce que le code déclare |
| `compute` | Ce que ce projet réserve, ce qu'il coûte et comment le modifier |
| `clusters` | Les clusters sur lesquels tournent les tenants. Réservé aux administrateurs de la plateforme |
| `settings`, `orgs`, `webhooks`, `billing` | Paramètres du projet, organisations, hooks de déploiement, paiement |

Chaque groupe de ce tableau répond à `--help` par sa propre page — une ligne d'utilisation, ses flags et des exemples — et `--help` n'exécute jamais la commande. Un test vérifie l'index de ces pages, de sorte qu'un groupe ajouté sans page fait échouer le build au lieu de renvoyer la table des matières. `verify:docs` compare le tableau lui-même à cet index : chaque groupe géré par la CLI apparaît ici exactement une fois, donc un groupe ajouté sans ligne dédiée fait également échouer le build.

Dans un pipe, `--help` répond en JSON : la même ligne d'utilisation, les flags et les exemples sous forme de structure lisible plutôt que soixante lignes de séquences d'échappement de terminal.

## Ce que la bêta n'inclut pas

Énoncé clairement, car le découvrir plus tard est bien pire :

- **Pas de choix de région.** Tout tourne dans une seule région aujourd'hui. Le modèle de placement existe dans la plateforme, mais un projet ne peut pas choisir de région. `projects create --provider` et `--region` ne constituent pas l'exception qu'ils semblent être : ils enregistrent simplement à quelle cible de déploiement enregistrée du plan de contrôle appartient un projet, et il n'y en a qu'une, donc les deux prennent cette valeur par défaut et aucun ne déplacera le projet ailleurs. `rebase cloud projects create --help` précise la même chose.
- **Pas d'accès en libre-service.** L'accès est accordé par vagues ; il n'y a pas d'inscription directe avec paiement.
- **Pas de SLA publié**, et pas de SOC 2. Si vous avez besoin de l'un ou l'autre, mentionnez-le lors de votre demande d'accès au lieu de le présumer.
- **Pas de déploiements de prévisualisation ou de branches**, et pas d'application GitHub officielle. Les hooks de déploiement — des URL secrètes vers lesquelles vous pointez un webhook de dépôt — constituent l'automatisation prise en charge.
- **La CI nécessite les identifiants d'un humain.** Il n'existe pas encore de jeton machine ; `rebase cloud login` requiert un e-mail et un mot de passe. Transmettez-les via `REBASE_CLOUD_EMAIL` et `REBASE_CLOUD_PASSWORD` depuis un gestionnaire de secrets — `--password` place le mot de passe dans l'historique de votre shell et dans la table des processus, et vous en avertit avant de vous connecter.
- **La récupération à un instant précis (point-in-time recovery) se fait uniquement via la CLI.** La console affiche les sauvegardes ; le workflow PITR par étapes s'effectue avec `rebase cloud db pitr`.
- **Pas de point de terminaison de base de données public.** Une base de données managée n'est pas exposée à Internet, l'hôte affiché dans la console est donc l'adresse utilisée par votre backend et ne résout rien depuis votre machine. `rebase cloud db connect` ouvre un port local correspondant à cette base de données, tunnelisé via le plan de contrôle, aussi longtemps que vous le laissez tourner — mais il n'existe aucun nom d'hôte permanent auquel un service tiers puisse se connecter. Ce tunnel, ainsi que le mot de passe révélé par `rebase cloud db info --reveal`, nécessitent tous deux le rôle de propriétaire (owner) ou d'administrateur (admin) de l'organisation : le même que requiert l'éditeur SQL de Studio, car les trois débouchent sur une session active sur vos données de production.

## S'auto-héberger à la place

Rien ici ne vous enferme (aucun lock-in). Le [guide d'auto-hébergement](/docs/deployment/self-hosting/) utilise l'image et le bundle identiques avec `docker compose`, et le [guide Kubernetes](/docs/deployment/kubernetes/) génère la même topologie à partir du chart Helm.

---
