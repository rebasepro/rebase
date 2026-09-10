---
sourceHash: 1268d4bf9843a74b
title: Fractionnement en plusieurs processus
sidebar_label: Processus fractionnés
description: Exécutez un même bundle sous la forme de plusieurs processus coopératifs — une API, un niveau de fonctions, un worker — à partir de la même image d'exécution publiée, afin qu'une fonction personnalisée lourde ne concurrence plus l'API de données.
---

## Vue d'ensemble

Un déploiement Rebase est normalement constitué d'un seul processus servant tout : l'API de données, l'authentification, le stockage, vos fonctions personnalisées, le cron et la file d'attente des tâches (job queue). C'est la configuration adaptée à presque tous les déploiements et cela reste la valeur par défaut.

Lorsque ce n'est plus la configuration idéale — une fonction personnalisée qui bloque la boucle d'événements (event loop), un niveau de fonctions qui devrait monter en charge ou redémarrer indépendamment de l'API —, vous pouvez démarrer **la même image et le même bundle** plusieurs fois et faire en sorte que chaque processus serve une partie différente du projet. Il n'y a rien de nouveau à construire et rien que le client n'ait besoin de savoir : les URL ne changent pas.

Une variable d'environnement détermine la fonction d'un processus :

```bash
REBASE_ROLE=api        # data, auth, admin, storage, meta — everything but functions
REBASE_ROLE=functions  # custom functions only
REBASE_ROLE=worker     # no HTTP surface: cron and the job queue
REBASE_ROLE=all        # the default: everything, one process
```

## Ce que chaque rôle prend en charge

| | `all` | `api` | `functions` | `worker` |
| --- | :---: | :---: | :---: | :---: |
| `/api/auth`, `/api/data`, `/api/storage`, `/api/meta` | ✅ | ✅ | — | — |
| `/api/admin`, `/api/logs`, l'éditeur de schéma | ✅ | ✅ | — | — |
| `/api/functions/*` | ✅ | redirige (voir ci-dessous) | ✅ | — |
| `/api/cron` (l'interface d'administration) | ✅ | ✅ | — | — |
| `/health`, `/livez`, `/metrics` | ✅ | ✅ | ✅ | ✅ |
| Sert les WebSockets, consomme les événements de modification | ✅ | ✅ | — | — |
| Crée le schéma au démarrage | ✅ | ✅ | — | — |
| Exécute le planificateur cron | ✅ | ✅ | — | ✅ |
| Exécute les workers de la file de tâches | ✅ | ✅ | — | ✅ |

Les vérifications de santé et les métriques sont présentes sur chaque rôle sans exception. Un processus qu'un orchestrateur ne peut pas sonder est un processus qu'il ne peut pas mettre à jour.

Le temps réel figure sur cette liste, car il a un coût que quelqu'un l'utilise ou non : un processus qui consomme des événements de modification maintient une connexion `LISTEN` hors du pool tant qu'il s'exécute, et installe les déclencheurs (triggers) de capture au démarrage. Seul un processus servant des WebSockets a des destinataires à qui livrer les événements ; les deux rôles qui n'en servent aucun ne font donc ni l'un ni l'autre. **Les écritures effectuées par ces processus continuent d'être détectées** — la capture s'effectuant par des déclencheurs en base de données, une modification est publiée par la base plutôt que par le processus qui l'a effectuée. Une fonction qui écrit une ligne réveille toujours chaque abonné sur l'`api`.

## Docker Compose

Deux services issus d'une seule image, d'un seul bundle et d'une seule base de données :

```yaml
services:
  api:
    image: rebasepro/server:latest
    environment:
      REBASE_ROLE: api
      REBASE_FUNCTIONS_UPSTREAM: http://functions:8080
      DATABASE_URL: postgres://rebase:${POSTGRES_PASSWORD}@db:5432/rebase
      JWT_SECRET: ${JWT_SECRET}
      REBASE_SERVICE_KEY: ${REBASE_SERVICE_KEY}
      CORS_ORIGINS: ${CORS_ORIGINS}
    volumes:
      - ./dist-bundle:/bundle
    ports:
      - "8080:8080"

  functions:
    image: rebasepro/server:latest
    environment:
      REBASE_ROLE: functions
      REBASE_MIGRATE_ON_BOOT: none
      TRUSTED_PROXY_HOPS: 1
      DATABASE_URL: postgres://rebase:${POSTGRES_PASSWORD}@db:5432/rebase
      JWT_SECRET: ${JWT_SECRET}
      REBASE_SERVICE_KEY: ${REBASE_SERVICE_KEY}
      CORS_ORIGINS: ${CORS_ORIGINS}
    volumes:
      - ./dist-bundle:/bundle
```

```bash
docker compose up --scale functions=3
```

Les deux processus ont besoin de la même `DATABASE_URL`, du même `JWT_SECRET` et de la même `REBASE_SERVICE_KEY` — ils forment un seul et même déploiement, et un jeton généré par l'un doit être accepté par l'autre.

## Conserver les mêmes URL

`REBASE_FUNCTIONS_UPSTREAM` indique au processus `api` de transférer `/api/functions/*` au processus de fonctions plutôt que de le traiter lui-même. Les clients, les SDK générés et les clés d'API voient exactement la même surface qu'avant la séparation ; aucun code applicatif ne change donc et vous n'avez pas besoin de mettre en place un reverse proxy pour l'essayer.

Un déploiement en production peut préférer router le chemin directement au niveau de son ingress ; dans ce cas, laissez `REBASE_FUNCTIONS_UPSTREAM` non défini — le processus `api` répondra alors 404 pour ces chemins et le proxy situé en amont décidera de leur destination.

### Sauts de proxy (Proxy hops)

Lorsque l'API relaie la requête, elle ajoute l'adresse de l'appelant à `X-Forwarded-For`. De ce fait, le processus de fonctions se trouve derrière **un saut de proxy supplémentaire** par rapport à l'API, et cela doit lui être indiqué :

```bash
# api behind one ingress            → TRUSTED_PROXY_HOPS=1
# functions behind that ingress AND the api → TRUSTED_PROXY_HOPS=2
```

`TRUSTED_PROXY_HOPS` correspond au nombre de reverse proxies que vous exécutez réellement devant un processus. Chacun d'eux ajoute l'adresse qu'il a reçue à `X-Forwarded-For` ; le véritable client est donc la N-ième entrée depuis la droite ; tout ce qui se trouve plus à gauche est fourni par le client et ignoré, ce qui empêche un appelant d'usurper l'en-tête pour contourner les clés de limitation de débit (rate limit). La valeur par défaut est `0` — aucun proxy n'est approuvé.

Si cette configuration est incorrecte, rien ne semblera cassé au premier abord : les limiteurs de débit du processus de fonctions associeront chaque requête à l'adresse du conteneur d'API, de sorte que tous vos appelants partageront le même quota, et l'IP enregistrée pour chaque événement d'authentification sera identique.

## Un seul processus gère le schéma

Exactement un processus dans un déploiement fractionné crée les tables et applique les politiques RLS au démarrage, et il s'agit du processus `api` (ou `all`). Tous les autres processus doivent définir :

```bash
REBASE_MIGRATE_ON_BOOT=none
```

Cela est **obligatoire**, et non optionnel : un processus `functions` ou `worker` conservant la valeur par défaut refusera de démarrer et affichera un message d'erreur. `CREATE … IF NOT EXISTS` lit le catalogue puis y écrit en deux étapes distinctes, de sorte que des processus démarrant simultanément entrent en collision — et un déploiement où plusieurs d'entre eux entrent en concurrence pour provisionner le même schéma n'est souhaitable pour personne.

## Servir une seule fonction par processus

Un processus peut prendre en charge un sous-ensemble nommé, ce qui permet à une fonction gourmande en ressources d'avoir son propre nombre de réplicas sans que son code ne soit déplacé :

```bash
REBASE_FUNCTIONS_ONLY=send-invoice
REBASE_FUNCTIONS_EXCLUDE=debug-tools
```

Les noms correspondent aux noms de fichiers sans l'extension — le même nom sous lequel la fonction est montée. Un nom que le bundle ne contient pas **provoque l'échec du démarrage**, et l'erreur liste les noms qu'il contient. Un processus configuré pour une seule fonction n'existe que pour cette fonction : une faute de frappe qui ne servirait silencieusement rien serait donc le pire scénario possible.

## Cron et tâches en arrière-plan

Les deux peuvent déjà être exécutés en toute sécurité dans plusieurs processus : le planificateur cron réserve chaque paire `(job, slot)` dans la base de données, et la file d'attente des tâches réserve les lignes avec `FOR UPDATE SKIP LOCKED`. L'`api` continue donc d'exécuter les deux par défaut, et une séparation en deux services est complète sans conteneur tiers.

Ajoutez un processus `worker` lorsque vous souhaitez isoler le travail planifié du chemin des requêtes, et désactivez-le sur l'API :

```yaml
  api:
    environment:
      REBASE_CRON_SCHEDULER: "false"
      REBASE_JOB_WORKERS: "false"

  worker:
    environment:
      REBASE_ROLE: worker
      REBASE_MIGRATE_ON_BOOT: none
```

Un processus `functions` n'exécute jamais ni l'un ni l'autre. Son dimensionnement dépend de la charge des requêtes et il peut être remplacé à tout moment ; lui attribuer des tâches planifiées dénaturerait la signification de son nombre de réplicas.

Notez que `rebase.jobs.enqueue` continue de fonctionner partout, y compris sur un processus qui n'exécute aucun worker — l'enfilement est une écriture, l'exécution est une boucle d'interrogation (poll loop), et seul le second aspect est désactivé par le rôle.

## Ce que le fractionnement ne vous apporte pas

**Des limitations de débit partagées, sauf si vous le demandez.** Le stockage par défaut est propre à chaque processus, de sorte que N processus multiplient le quota de chaque appelant par N sans qu'aucun journal (log) ne l'indique. Définissez `REBASE_RATE_LIMIT_STORE=sql` sur chaque processus qui dessert le trafic HTTP — le décompte se fait dans Postgres, ainsi la limite reste la même quel que soit le nombre de réplicas. (Le chart Helm le configure pour vous et refuse de générer une topologie multi-processus laissant cette valeur sur `memory`.)

**Des canaux inter-instances.** La diffusion (broadcast) et la présence utilisent par défaut un bus en mémoire, qui ne traverse pas les processus. Il s'agit d'une question de *nombre de réplicas* plutôt que de fractionnement — cela s'applique tout autant à un déploiement à rôle unique mis à l'échelle sur trois instances — définissez donc `REALTIME_CHANNEL_BUS=postgres` (ou `realtime.bus` dans la configuration) dès lors que plusieurs processus servent des WebSockets.

**Le passage à zéro (Scale to zero).** Rien ici ne réduit un processus à zéro ou n'en démarre un à la demande. Il s'agit d'une fonctionnalité de plateforme d'hébergement, non du moteur d'exécution (runtime).

## Déployer une unité indépendamment

Tout ce qui précède sépare *l'endroit où le travail s'exécute*. L'ensemble est toujours livré comme un seul build : une seule image, un seul bundle, déployés ensemble. C'est le comportement par défaut recommandé, et la plupart des déploiements devraient s'y tenir.

Une unité peut également être maintenue sur son propre build — par exemple pour un correctif de fonction qui ne nécessite pas de redémarrer l'API :

```yaml
# values.yaml
split: true
functions:
  enabled: true
  image:
    tag: "0.20.0"     # this unit only; the rest stay on the release-wide tag
```

Seul le tag vaut généralement la peine d'être verrouillé : le dépôt est hérité, il s'agit donc d'un seul projet et d'une seule image dont une seule unité a changé de version. `bundleUrl` remplit la même fonction lorsque `bundle.mode: url`.

### La règle

Deux unités basées sur des builds différents représentent deux ensembles de collections face à **une seule** base de données, et une seule unité se charge de la provisionner. Par conséquent :

> **L'unité qui gère le schéma est déployée en premier. Une unité peut être en retard ; elle ne doit jamais être en avance.**

Il s'agit du Job de migration, ou de l'`api` lorsque le Job est désactivé. Une unité s'exécutant *en avance* par rapport au schéma interrogera des colonnes qui n'existent pas encore et dépendra de politiques RLS que personne n'a appliquées — le premier cas entraîne une erreur SQL sur une route, le second un résultat vide accompagné d'un code 200. Une unité s'exécutant *en retard* correspond à l'état habituel de tout déploiement progressif.

### Qu'est-ce qui le vérifie

Le processus qui provisionne enregistre la version du schéma qu'il a appliquée dans la base de données. Chaque autre processus calcule la sienne à partir des collections qu'il a chargées et compare. En cas de divergence, il le signale en nommant les deux versions :

```
⚠️ [schema] The database was last provisioned from a different set of collections
   than this process was built from (database v1:6f2a…, this process v1:91cd…).
```

Il émet un avertissement et continue de servir les requêtes, car lors d'un déploiement progressif, cette divergence est *normale* — les unités qui n'ont pas encore été déployées sont censées être en retard. Définissez `REBASE_REQUIRE_SCHEMA_MATCH=true` (ou `sharedState.requireSchemaMatch` dans le chart) pour refuser le démarrage, si vous avez un déploiement qui préfère ne rien servir du tout plutôt que de servir des données incorrectes.

Les deux côtés de cette comparaison sont **calculés**, et jamais lus à partir d'un manifeste. Une version qu'un build déclare pour lui-même ne constitue pas une preuve que la base de données est en accord avec celle-ci.

Rien ne vérifie le *sens* de la divergence — une version de schéma est un hachage, il peut donc indiquer que les deux diffèrent mais jamais laquelle est en avance. C'est pour cette raison que l'ordre de déploiement est une règle que vous devez suivre plutôt qu'une contrainte que l'environnement d'exécution peut appliquer.

## Mise à niveau

Inchangé : chaque processus exécute la même image publiée, une mise à niveau consiste donc à changer le même tag sur chacun d'eux. Déployez l'`api` en dernier si vous souhaitez que le provisionnement du schéma s'effectue d'abord sur la nouvelle version — bien qu'en pratique l'ordre importe peu, car l'étape de schéma est additive et idempotente.

## Voir aussi

- [Guide de déploiement](/docs/getting-started/deployment/) — le déploiement mono-processus que ce guide fractionne
- [Environnement et configuration](/docs/getting-started/configuration/) — `REBASE_ROLE`, `REBASE_CRON_SCHEDULER` et `REBASE_MIGRATE_ON_BOOT`
- [Kubernetes](/docs/deployment/kubernetes/) — un déploiement par rôle
