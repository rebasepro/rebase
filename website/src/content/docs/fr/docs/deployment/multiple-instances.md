---
sourceHash: d7e22a508527032c
title: Exécuter plus d'une instance
sidebar_label: Plus d'une instance
description: Chaque élément d'état qu'un processus Rebase garde pour lui seul, et le réglage qui le partage — ce qu'il faut définir avant qu'une seconde réplique, un déploiement progressif ou un déploiement scindé ne prenne du trafic.
---

## Vue d'ensemble

La majeure partie d'un déploiement Rebase vit déjà dans la base de données : les lignes, les
utilisateurs et les sessions, les clés d'API, la file d'attente de tâches, les réservations de
cron, les clés d'idempotence, l'historique des enregistrements, les tokens du serveur OAuth MCP.
Un second processus pointant vers la même base de données voit tout cela.

Quelques éléments n'y vivent pas. Chacun est propre à son processus par défaut, car un seul
processus est le déploiement par défaut et le partage a un coût — une table, une écriture dans un
bucket, une connexion à la base de données. Exécuter deux processus derrière un équilibreur de
charge, passer à plus d'une instance avec l'autoscaling, ou un déploiement progressif qui fait
tourner brièvement l'ancienne et la nouvelle version côte à côte, vous amènent tous sur cette page.
Un [déploiement scindé](/docs/deployment/split-processes/) aussi, puisqu'il s'agit par définition
de plusieurs processus.

Parcourez la liste ci-dessous avant que le second processus ne prenne du trafic. Rien ici n'échoue
de façon bruyante : chaque élément se manifeste comme une limite appliquée trois fois, un événement
que certains clients ne voient jamais, ou une page qui affiche des logs différents à chaque
actualisation.

## La liste de vérification

| Quoi | Propre au processus par défaut | Ce qui le partage |
| --- | --- | --- |
| Secrets de signature | Générés par processus en développement | `JWT_SECRET` et `REBASE_SERVICE_KEY`, définis explicitement et **identiques** partout |
| Compteurs de limitation de débit | En mémoire | `REBASE_RATE_LIMIT_STORE=sql` |
| Adresse du client derrière un proxy | `TRUSTED_PROXY_HOPS=0` | Le nombre de proxies en amont, identique partout |
| Abonnements aux collections | Partagés via la base de données lorsque la CDC est active | `REALTIME_CDC=auto` (valeur par défaut) |
| Canaux de diffusion et présence | En mémoire | `REALTIME_CHANNEL_BUS=postgres` |
| Fichiers téléversés, `STORAGE_TYPE=local` | Le disque propre à l'instance | S3 ou GCS, ou un volume partagé unique sous `STORAGE_PATH` |
| Téléversements avec reprise (TUS) en cours | La mémoire et le disque de l'instance | Sessions collantes (sticky sessions) ; un redémarrage les perd quand même |
| Transformations d'image | Un cache interne au processus | `STORAGE_RENDITION_CACHE=true` |
| Logs Explorer | Un anneau des 10 000 dernières lignes | Rien — envoyez stdout vers un agrégateur de logs |
| Minuteries cron | Chaque processus qui exécute le planificateur | Réservée en base de données : une exécution par créneau. `REBASE_CRON_SCHEDULER` choisit où vivent les minuteries |
| Audit RLS planifié | Chaque processus qui le possède | `REBASE_RLS_AUDIT=false` sur tous sauf un |
| Le `index.html` d'une application statique | Lu une fois par processus | Redémarrez chaque instance lorsque le build change |
| `/metrics` | Chaque processus compte le sien | Scrapez chaque instance |

Les sections ci-dessous détaillent ce que chacun fait lorsqu'il reste propre au processus.

## Secrets de signature

`JWT_SECRET` signe chaque session et `REBASE_SERVICE_KEY` authentifie les appels de serveur à
serveur. En développement, chaque processus génère le sien lorsqu'ils ne sont pas définis, si bien
qu'un token émis par un processus est refusé par le suivant. La production refuse déjà de démarrer
sans eux ; ce qui compte avec plusieurs processus, c'est que chacun reçoive les **mêmes** valeurs —
issues d'un seul secret, pas d'un secret par réplique.

## Limitation de débit et adresse du client

Les limiteurs de débit — le budget par appelant sur les API de données, de stockage et de
fonctions, et les limiteurs d'authentification sur la connexion, la réinitialisation de mot de
passe, les codes à usage unique et les tentatives MFA — comptent en mémoire par défaut. Un
processus ne peut pas voir combien de pairs il a, donc trois répliques sur la configuration par
défaut appliquent chaque limite trois fois. Définissez `REBASE_RATE_LIMIT_STORE=sql` et les
compteurs vivent alors dans la base de données.

Derrière un équilibreur de charge, le limiteur a aussi besoin de la véritable adresse du client,
qui arrive dans `X-Forwarded-For`. `TRUSTED_PROXY_HOPS` indique combien de proxies ignorer ; à la
valeur par défaut `0`, chaque requête semble provenir de l'équilibreur de charge et chaque client
partage un seul compartiment (bucket). Voir
[Configuration](/docs/getting-started/configuration/#runtime-behaviour).

## Temps réel

**Les abonnements aux collections** fonctionnent entre instances lorsque la capture de
modifications au niveau de la base de données (CDC) est active, ce qui est le cas par défaut
(`REALTIME_CDC=auto`) : un déclencheur annonce chaque écriture validée, et l'écouteur de chaque
instance relit les données pour ses propres abonnés. Si la CDC est désactivée, ou si `auto` n'a pas
pu la provisionner (le journal de démarrage indique lequel des deux), un abonnement ne voit que les
écritures effectuées via l'instance à laquelle son socket est connecté. Voir
[Temps réel](/docs/backend/realtime/#database-level-change-capture-cdc).

**Les canaux de diffusion et la présence** restent internes au processus à moins qu'un bus ne les
relaie : deux clients sur des instances différentes dans le même canal ne s'entendent pas, et
chaque instance répond « qui est présent ? » avec sa propre moitié. Définissez
`REALTIME_CHANNEL_BUS=postgres`. Le bus écoute la base de données, ce qui nécessite une connexion
directe plutôt qu'un pooler transactionnel — définissez `DATABASE_DIRECT_URL` lorsque
`DATABASE_URL` passe par pgBouncer. Voir
[Canaux et présence entre instances](/docs/backend/realtime-transports/#channels-and-presence-across-instances).

## Fichiers

Avec `STORAGE_TYPE=local`, les téléversements sont des fichiers sur le disque de l'instance qui
les a reçus, et une autre instance leur répond 404. Utilisez S3 ou GCS, ou montez un volume unique
sous `STORAGE_PATH` sur chaque instance. Voir
[Auto-hébergement : stockage de fichiers](/docs/deployment/self-hosting/#file-storage).

**Les téléversements avec reprise** (le point de terminaison TUS) conservent le fichier partiel de
chaque téléversement et son état sur le disque local de l'instance qui l'a créé, sous
`STORAGE_PATH/.tus-uploads` — même lorsque les fichiers terminés partent vers S3 ou GCS. Un
fragment qui atterrit sur une autre instance reçoit une 404 et le client recommence. Routez les
requêtes de téléversement d'un client vers une seule instance (sessions collantes sur
l'équilibreur de charge). Un volume partagé sous `STORAGE_PATH` partage les fichiers partiels mais
pas encore l'état du téléversement, qui est conservé dans la mémoire du processus — un redémarrage
ou un déploiement progressif renvoie donc aussi un téléversement en cours à l'octet 0. Les
téléversements ordinaires via `POST /upload` tiennent en une seule requête et ne sont pas
concernés.

**Les transformations d'image** (`?width=400&format=webp`) sont mises en cache en mémoire, donc
chaque instance calcule chaque variante une fois, et une nouvelle instance démarre à froid.
Définissez `STORAGE_RENDITION_CACHE=true` pour réécrire chaque rendu dans le bucket d'où il
provient, où chaque instance le retrouve. Cela fait qu'un `GET` écrit dans votre bucket, ce qui
explique que ce soit désactivé par défaut. Voir [Stockage](/docs/backend/storage/).

## Logs Explorer

Le Logs Explorer de Studio lit un anneau des 10 000 dernières lignes de log conservées par le
processus qui sert la requête. Derrière un équilibreur de charge, chaque actualisation peut
afficher les lignes d'une instance différente, et aucune d'elles ne montre l'ensemble du
déploiement.
L'explorateur nomme l'instance qu'il affiche.
Il n'existe aucun réglage pour partager l'anneau : le runtime écrit une ligne JSON par
événement sur stdout en production, et c'est cela qu'il faut collecter — le service de logs de
votre plateforme, Loki, ou tout ce qui lit la sortie du conteneur.

## Cron et la file d'attente de tâches

Chaque processus qui exécute le planificateur cron arme ses propres minuteries, et l'exécution est
d'abord réservée dans la base de données, si bien qu'un créneau s'exécute **une seule fois** quel
que soit le nombre de processus qui le déclenchent. La mise en pause d'une tâche, et le bail qui
empêche un déclenchement manuel de percuter une exécution en cours, sont partagés de la même
manière. Rien à définir, pour peu que la base de données soit Postgres. `REBASE_CRON_SCHEDULER` et
`REBASE_JOB_WORKERS` décident lesquels des processus exécutent des minuteries et des workers — voir
[Processus séparés](/docs/deployment/split-processes/).

L'audit RLS planifié est l'exception : il n'est pas réservé, donc chaque processus qui le possède
analyse sur sa propre minuterie. C'est redondant plutôt que dangereux ; définissez
`REBASE_RLS_AUDIT=false` partout sauf sur un.

## Applications statiques

Un processus qui sert le frontend ou le CMS (`REBASE_SERVE_STATIC`, actif par défaut) lit une fois
le `index.html` de chaque application et le conserve. Remplacer le build sur un volume partagé
n'atteint pas un processus en cours d'exécution : il continue de servir l'ancien document, qui
nomme des chunks qui n'existent peut-être plus. Livrez un nouveau build en redémarrant ou en
déployant progressivement chaque instance — ce qu'une nouvelle image ou un nouveau bundle fait de
toute façon. Avec un CDN en amont et `REBASE_SERVE_STATIC=false`, ceci ne s'applique pas.

## Métriques

`/metrics` rend compte du processus qui y répond. Scrapez chaque instance — un job de
service-discovery Prometheus par pod, pas une seule cible derrière l'équilibreur de charge — et
faites la somme dans la requête.

## Provisionnement au démarrage

Chaque instance exécute la passe de schéma additive au démarrage
(`REBASE_MIGRATE_ON_BOOT=ensure`). Des instances du même rôle peuvent l'exécuter en même temps :
elle est conçue pour tolérer qu'un pair ait créé la même table un instant plus tôt. Dans un
déploiement scindé, un seul rôle provisionne et tous les autres définissent `none` — voir
[Processus séparés](/docs/deployment/split-processes/).
