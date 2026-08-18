---
title: Répartir sur plusieurs processus
sidebar_label: Processus séparés
description: "Exécutez un bundle sous forme de plusieurs processus coopérants — une API, une couche de fonctions, un worker — depuis la même image de runtime publiée, afin qu'une fonction personnalisée lourde cesse de concurrencer l'API de données."
---

## Vue d'ensemble

Un déploiement Rebase est normalement un seul processus qui sert tout : l'API de
données, l'authentification, le stockage, vos fonctions personnalisées, le cron
et la file de tâches. C'est la bonne forme pour presque tous les déploiements, et
elle reste celle par défaut.

Quand ce n'est plus le cas — une fonction personnalisée qui bloque la boucle
d'événements, ou une couche de fonctions qui devrait monter en charge ou
redémarrer indépendamment de l'API — vous pouvez démarrer **la même image et le
même bundle** plusieurs fois et faire en sorte que chaque processus serve une
partie différente du projet. Il n'y a rien de nouveau à construire et rien que le
client doive savoir : les URL ne changent pas.

Une variable d'environnement décide de ce qu'est un processus :

```bash
REBASE_ROLE=api        # data, auth, admin, storage, meta — everything but functions
REBASE_ROLE=functions  # custom functions only
REBASE_ROLE=worker     # no HTTP surface: cron and the job queue
REBASE_ROLE=all        # the default: everything, one process
```

## Ce que sert chaque rôle

| | `all` | `api` | `functions` | `worker` |
| --- | :---: | :---: | :---: | :---: |
| `/api/auth`, `/api/data`, `/api/storage`, `/api/meta` | ✅ | ✅ | — | — |
| `/api/admin`, `/api/logs`, l'éditeur de schéma | ✅ | ✅ | — | — |
| `/api/functions/*` | ✅ | transmet (voir plus bas) | ✅ | — |
| `/api/cron` (la surface d'administration) | ✅ | ✅ | — | — |
| `/health`, `/livez`, `/metrics` | ✅ | ✅ | ✅ | ✅ |
| Sert les websockets, consomme les événements de changement | ✅ | ✅ | — | — |
| Crée le schéma au démarrage | ✅ | ✅ | — | — |
| Exécute le planificateur cron | ✅ | ✅ | — | ✅ |
| Exécute les workers de la file de tâches | ✅ | ✅ | — | ✅ |

Le health et les métriques sont présents sur tous les rôles, sans exception. Un
processus qu'un orchestrateur ne peut pas sonder est un processus qu'il ne peut
pas déployer.

Le temps réel figure dans la liste parce qu'il coûte quelque chose que quelqu'un
s'en serve ou non : un processus qui consomme les événements de changement garde
une connexion `LISTEN` hors du pool pendant toute sa durée de vie, et installe
les triggers de capture au démarrage. Seul un processus qui sert des websockets a
quelqu'un à qui livrer — les deux rôles qui n'en servent aucun ne font donc ni
l'un ni l'autre. **Les écritures faites par ces processus sont toujours
entendues** : la capture repose sur des triggers de base de données, un
changement est donc publié par la base et non par le processus qui l'a fait. Une
fonction qui écrit une ligne réveille toujours tous les abonnés de l'`api`.

## Docker Compose

Deux services depuis une image, un bundle et une base de données :

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

Les deux processus ont besoin du même `DATABASE_URL`, du même `JWT_SECRET` et de
la même `REBASE_SERVICE_KEY` : ils forment un seul déploiement, et un jeton émis
par l'un doit être accepté par l'autre.

## Conserver les mêmes URL

`REBASE_FUNCTIONS_UPSTREAM` indique au processus `api` de transmettre
`/api/functions/*` au processus de fonctions au lieu de le servir. Les clients,
les SDK générés et les clés d'API voient exactement la surface qu'ils voyaient
avant la répartition : aucun code applicatif ne change, et il n'est pas
nécessaire de mettre en place un reverse proxy pour l'essayer.

Un déploiement de production peut préférer router ce chemin au niveau de son
ingress ; dans ce cas, laissez `REBASE_FUNCTIONS_UPSTREAM` non définie — le
processus `api` répondra alors 404 sur ces chemins et le proxy en amont décidera
de leur destination.

### Sauts de proxy

Lorsque l'API transmet, elle ajoute l'adresse de l'appelant à `X-Forwarded-For`.
Cela place le processus de fonctions derrière **un saut de proxy de plus** que
l'API, et il faut le lui indiquer :

```bash
# api behind one ingress            → TRUSTED_PROXY_HOPS=1
# functions behind that ingress AND the api → TRUSTED_PROXY_HOPS=2
```

`TRUSTED_PROXY_HOPS` est le nombre de reverse proxies réellement présents devant
un processus. Chacun ajoute à `X-Forwarded-For` l'adresse qu'il a vue, si bien
que le vrai client est la N-ième entrée en partant de la droite ; tout ce qui se
trouve plus à gauche est fourni par le client et ignoré — c'est ce qui empêche un
appelant de falsifier l'en-tête pour changer de clé de limitation. La valeur par
défaut est `0` : aucun proxy n'est de confiance.

Si vous vous trompez ici, rien ne casse visiblement : les limiteurs du processus
de fonctions rattachent chaque requête à l'adresse du conteneur de l'API, donc
tous vos appelants partagent un même seau, et l'IP enregistrée sur chaque
événement d'authentification est toujours la même.

## Un seul processus possède le schéma

Un seul processus d'un déploiement réparti crée les tables et applique les
politiques RLS au démarrage : c'est celui en `api` (ou en `all`). Tous les autres
doivent définir :

```bash
REBASE_MIGRATE_ON_BOOT=none
```

C'est **obligatoire**, pas un conseil : un processus `functions` ou `worker`
laissé sur la valeur par défaut refuse de démarrer, et le dit. `CREATE … IF NOT
EXISTS` lit le catalogue puis y écrit en deux étapes distinctes, donc des
processus qui démarrent ensemble entrent bel et bien en collision — et un
déploiement où plusieurs d'entre eux se disputent la création du même schéma
n'est pas un déploiement conçu par quelqu'un.

## Servir une fonction par processus

Un processus peut servir un sous-ensemble nommé : c'est ainsi qu'une fonction
coûteuse obtient son propre nombre de réplicas sans que son code bouge.

```bash
REBASE_FUNCTIONS_ONLY=send-invoice
REBASE_FUNCTIONS_EXCLUDE=debug-tools
```

Les noms sont les noms de fichiers sans l'extension — le même nom sous lequel la
fonction est montée. Un nom absent du bundle **fait échouer le démarrage**, et
l'erreur énumère les noms présents. Un processus configuré pour une fonction
existe pour cette fonction : une faute de frappe qui servirait silencieusement
rien serait le pire résultat possible.

## Cron et tâches de fond

Les deux sont déjà sûrs sur plusieurs processus : le planificateur cron
revendique chaque paire `(job, slot)` dans la base, et la file de tâches
revendique ses lignes avec `FOR UPDATE SKIP LOCKED`. C'est pourquoi `api`
continue d'exécuter les deux par défaut, et une répartition en deux services est
complète sans troisième conteneur.

Ajoutez un processus `worker` si vous voulez sortir le travail planifié du chemin
des requêtes, et désactivez-le sur l'API :

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

Un processus `functions` n'exécute jamais ni l'un ni l'autre. Il monte en charge
selon le trafic et peut être remplacé à tout moment ; lui confier du travail
planifié donnerait à son nombre de réplicas un sens qu'il ne doit pas avoir.

Notez que `rebase.jobs.enqueue` continue de fonctionner partout, y compris sur un
processus qui n'exécute aucun worker : mettre en file est une écriture, exécuter
est une boucle de scrutation, et seule la seconde est ce qu'un rôle désactive.

## Ce que la répartition n'apporte pas

**Des limites de débit partagées.** Le stockage du limiteur est par processus par
défaut, donc N processus multiplient par N le budget de chaque appelant. Mettez
`REBASE_RATE_LIMIT_STORE=sql` sur chaque processus qui sert du HTTP : le comptage
se fait dans Postgres, donc la limite est la limite quel que soit le nombre de
réplicas. (Le chart Helm le règle pour vous et refuse de rendre une topologie
multi-processus qui le laisse sur `memory`.)

**Des canaux inter-instances.** Le broadcast et la présence utilisent par défaut
un bus en mémoire, qui ne franchit pas les processus. C'est une question de
*nombre de réplicas* plutôt que de répartition — c'est tout aussi vrai d'un
déploiement à rôle unique mis à l'échelle sur trois — alors définissez
`REALTIME_CHANNEL_BUS=postgres` (ou `realtime.bus` dans la configuration) dès que
plus d'un processus sert des websockets.

**La mise à l'échelle à zéro.** Rien ici ne réduit un processus à néant ni n'en
démarre un à la demande. C'est une capacité de la plateforme, pas du runtime.

## Publier une unité pour elle-même

Tout ce qui précède répartit *où* le travail s'exécute. Le tout se publie
toujours comme une seule build : une image, un bundle, déployés ensemble. C'est
la valeur par défaut correcte, et la plupart des déploiements devraient s'y
tenir.

Une unité peut aussi être tenue sur une build à elle — un correctif de fonction
qui ne redémarre pas l'API :

```yaml
# values.yaml
split: true
functions:
  enabled: true
  image:
    tag: "0.16.0"     # cette unité seulement ; le reste garde le tag du release
```

En général seul le tag vaut la peine d'être épinglé : le dépôt est hérité, donc
c'est un projet et une image dont une unité a bougé. `bundleUrl` fait la même
chose avec `bundle.mode: url`.

### La règle

Deux unités sur des builds différentes, ce sont deux jeux de collections face à
**une seule** base de données, et une seule unité la provisionne. Donc :

> **L'unité qui possède le schéma se déploie en premier. Une unité peut être en
> retard ; elle ne doit jamais être en avance.**

C'est le Job de migration, ou l'`api` quand le Job est désactivé. Une unité *en
avance* sur le schéma interroge des colonnes qui n'existent pas encore et repose
sur des politiques RLS que personne n'a appliquées — la première est une erreur
SQL sur une route, la seconde un résultat vide avec un 200. Une unité *en retard*
est l'état ordinaire de tout déploiement en cours.

### Ce qui le vérifie

Le processus qui provisionne enregistre dans la base la version de schéma qu'il a
appliquée. Tout autre processus calcule la sienne à partir des collections
chargées et compare. En cas de désaccord, il le dit et nomme les deux :

```
⚠️ [schema] The database was last provisioned from a different set of collections
   than this process was built from (database v1:6f2a…, this process v1:91cd…).
```

Il avertit et sert, car pendant un déploiement ce désaccord est *correct* : les
unités pas encore déployées sont censées être en retard. Mettez
`REBASE_REQUIRE_SCHEMA_MATCH=true` (ou `sharedState.requireSchemaMatch` dans le
chart) pour refuser le démarrage à la place, sur un déploiement qui préfère ne
pas servir plutôt que servir faux.

Les deux côtés de cette comparaison sont **calculés**, jamais lus dans un
manifeste. Une version qu'une build affirme sur elle-même ne prouve pas que la
base est d'accord.

Rien ne vérifie le *sens* — une version de schéma est un hachage : elle peut dire
que les deux diffèrent, jamais laquelle est en avance. C'est pourquoi l'ordre de
déploiement est une règle que vous suivez, pas une que le runtime peut imposer.

## Mise à jour

Inchangée : chaque processus exécute la même image publiée, donc une mise à jour
est le même changement de tag sur chacun d'eux. Mettez `api` à jour en dernier si
vous voulez que le provisionnement du schéma se fasse d'abord contre la nouvelle
version — même si en pratique l'ordre n'a pas d'importance, car l'étape de schéma
est additive et idempotente.
