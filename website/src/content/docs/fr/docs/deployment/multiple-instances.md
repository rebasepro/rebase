---
sourceHash: 079933126e9be226
title: Exécuter plusieurs instances
sidebar_label: Plusieurs instances
description: Chaque élément d'état qu'un processus Rebase conserve pour lui-même et le paramètre permettant de le partager — ce qu'il faut configurer avant qu'un second réplica, un déploiement progressif ou un déploiement scindé ne reçoive du trafic.
---

## Vue d'ensemble

La majeure partie d'un déploiement Rebase réside déjà dans la base de données : lignes, utilisateurs et sessions, clés d'API, file d'attente de tâches, réservations de cron, clés d'idempotence, historique des enregistrements, jetons du serveur OAuth MCP. Un second processus pointant vers la même base de données a accès à l'ensemble de ces données.

Quelques éléments font exception. Chacun est spécifique à un processus par défaut, car un processus unique constitue le déploiement par défaut et le partage a un coût — une table, une écriture dans un bucket, une connexion à la base de données. Exécuter deux processus derrière un équilibreur de charge, dépasser une instance via l'autoscaling, ou effectuer un déploiement progressif (rolling deploy) qui fait coexister brièvement l'ancienne et la nouvelle version vous amène sur cette page. Il en va de même pour un [déploiement scindé](/docs/deployment/split-processes/), qui implique plusieurs processus par définition.

Passez en revue la liste ci-dessous avant que la seconde instance ne commence à recevoir du trafic. Aucun de ces points n'échoue de manière explicite : chaque élément se manifeste par une limite appliquée trois fois de trop, un événement que certains clients ne reçoivent jamais, ou une page affichant des logs différents à chaque rafraîchissement.

## Liste de vérification

| Élément | Par défaut par processus | Ce qui le partage |
| --- | --- | --- |
| Clés secrètes de signature | Générées par processus en développement | `JWT_SECRET` et `REBASE_SERVICE_KEY`, définies explicitement et **identiques** partout |
| Compteurs de limitation de débit | En mémoire | `REBASE_RATE_LIMIT_STORE=sql` |
| Adresse client derrière un proxy | `TRUSTED_PROXY_HOPS=0` | Le nombre de proxys en amont, identique partout |
| Abonnements aux tables | Partagés via la base de données lorsque le CDC est activé | `REALTIME_CDC=auto` (valeur par défaut) |
| Canaux de diffusion et présence | En mémoire | `REALTIME_CHANNEL_BUS=postgres` |
| Fichiers téléversés, `STORAGE_TYPE=local` | Le propre disque de l'instance | S3 ou GCS, ou un volume partagé sur le parent de `STORAGE_PATH` |
| Téléversements reprenables (TUS) en cours | Le disque de l'instance, sous `STORAGE_PATH/.tus-uploads` | Un volume partagé au niveau de `STORAGE_PATH`, ou sessions persistantes |
| Transformations d'images | Un cache interne au processus | `STORAGE_RENDITION_CACHE=true` |
| Vue Logs de Studio | Un tampon circulaire des 10 000 dernières lignes | Rien — envoyez stdout vers un agrégateur de logs |
| Minuteurs cron | Chaque processus qui exécute le planificateur | Revendiqués dans la base de données : une exécution par créneau. `REBASE_CRON_SCHEDULER` définit où résident les minuteurs |
| Audit RLS planifié | Chaque processus qui en est responsable | `REBASE_RLS_AUDIT=false` sur tous sauf un |
| Le fichier `index.html` d'une application statique | Lu une seule fois par processus | Redémarrer chaque instance lorsque le build change |
| `/metrics` | Chaque processus comptabilise les siennes | Scraper chaque instance |

Les sections ci-dessous détaillent le comportement de chacun de ces éléments lorsqu'il reste configuré par processus.

## Clés secrètes de signature

`JWT_SECRET` signe chaque session et `REBASE_SERVICE_KEY` authentifie les appels de serveur à serveur. En développement, chaque processus génère ses propres clés lorsqu'elles ne sont pas définies ; ainsi, un jeton émis par un processus est refusé par le suivant. La production refuse déjà de démarrer sans `JWT_SECRET` (sans `REBASE_SERVICE_KEY`, elle démarre sans aucune clé de service) ; ce qui importe avec plusieurs processus, c'est que chacun reçoive les **mêmes** valeurs — issues d'un unique secret, et non d'un secret propre à chaque réplica.

## Limites de débit et adresse client

Les limiteurs de débit — le quota par appelant sur les API de données, de stockage et de fonctions, ainsi que les limiteurs d'authentification sur la connexion, la réinitialisation de mot de passe, les codes à usage unique et les tentatives MFA — comptent par défaut en mémoire. Un processus ne peut pas savoir combien de pairs il possède ; ainsi, trois réplicas conservant le réglage par défaut appliquent chaque limite trois fois. Définissez `REBASE_RATE_LIMIT_STORE=sql` pour que les compteurs soient stockés dans la base de données à la place.

Derrière un équilibreur de charge, le limiteur a également besoin de la véritable adresse du client, fournie dans `X-Forwarded-For`. `TRUSTED_PROXY_HOPS` indique le nombre de proxys à ignorer ; avec la valeur par défaut `0`, chaque requête semble provenir de l'équilibreur de charge et tous les clients partagent le même quota. Consultez la [Configuration](/docs/getting-started/configuration/#runtime-behaviour).

## Temps réel (Realtime)

Les **abonnements aux tables** fonctionnent entre les instances lorsque la capture des modifications au niveau de la base de données (CDC) est activée, ce qui est le cas par défaut (`REALTIME_CDC=auto`) : le journal de transactions WAL (lorsque la base autorise le décodage logique) ou un trigger signale chaque écriture validée, et le listener de chaque instance effectue une nouvelle récupération pour ses propres abonnés. Les instances utilisant la capture WAL laissent les triggers en place tant qu'une instance continue d'écouter dessus, de sorte qu'un réplica ayant basculé sur les triggers ne se retrouve jamais isolé. Si le CDC est désactivé, ou si le mode `auto` n'a pas pu le provisionner (le log de démarrage l'indique), un abonnement ne voit que les écritures effectuées via l'instance à laquelle son socket est connecté. Consultez [Temps réel](/docs/backend/realtime-cdc/).

Les **canaux de diffusion et la présence** restent internes au processus à moins qu'un bus ne les véhicule : deux clients connectés à des instances différentes dans le même canal ne s'entendent pas, et chaque instance répond « qui est présent ? » avec sa propre moitié d'informations. Définissez `REALTIME_CHANNEL_BUS=postgres`. Le bus écoute sur la base de données, ce qui nécessite une connexion directe plutôt qu'un pooler de transactions — définissez `DATABASE_DIRECT_URL` lorsque `DATABASE_URL` passe par pgBouncer. Consultez [Canaux et présence entre les instances](/docs/backend/realtime-transports/#channels-and-presence-across-instances).

## Fichiers

Avec `STORAGE_TYPE=local`, les téléversements sont des fichiers stockés sur le disque de l'instance qui les a reçus, et une autre instance répondra par une erreur 404 pour ces mêmes fichiers. Utilisez S3 ou GCS, ou montez un volume unique sur chaque instance, sur le répertoire parent de `STORAGE_PATH`, afin qu'il contienne également le répertoire `<STORAGE_PATH>__<key>` de chaque bucket local nommé. Consultez [Auto-hébergement : stockage de fichiers](/docs/deployment/self-hosting/#file-storage).

Les **téléversements reprenables** (le point de terminaison TUS) conservent le fichier partiel de chaque téléversement, ainsi qu'un enregistrement associé, sur le disque de l'instance qui l'a créé, sous `STORAGE_PATH/.tus-uploads` — même lorsque les fichiers finalisés sont envoyés vers S3 ou GCS. Montez un volume unique sur `STORAGE_PATH` sur chaque instance et n'importe quelle instance pourra traiter n'importe quel téléversement ; un redémarrage ou un déploiement progressif reprendra alors un téléversement là où il s'était arrêté. Sans volume partagé, un segment (chunk) qui arrive sur une autre instance reçoit une réponse 404 : routez les requêtes de téléversement d'un client vers une seule instance (sessions persistantes / sticky sessions sur l'équilibreur de charge). Le SDK et le panneau d'administration, qui utilisent ce point de terminaison pour les fichiers de plus de 8 Mio, envoient ensuite le fichier via `POST /upload` à la place, et continuent de le faire pour le reste de la session. Les téléversements classiques via `POST /upload` s'effectuent en une seule requête et ne sont pas affectés.

Les **transformations d'images** (`?width=400&format=webp`) sont mises en cache en mémoire ; chaque instance calcule donc chaque variante une fois, et une nouvelle instance démarre à froid. Définissez `STORAGE_RENDITION_CACHE=true` pour réécrire chaque rendu dans le bucket d'origine, où chaque instance pourra le retrouver. Cela implique qu'une requête `GET` déclenche une écriture dans votre bucket, raison pour laquelle cette option est désactivée par défaut. Consultez [Stockage](/docs/backend/storage/).

## Vue Logs de Studio

La vue Logs de Studio lit un tampon circulaire des 10 000 dernières lignes de log conservées par le processus qui traite la requête. Derrière un équilibreur de charge, chaque rafraîchissement peut afficher les lignes d'une instance différente, et aucune d'entre elles ne montre l'ensemble du déploiement. L'explorateur indique le nom de l'instance qu'il affiche.
Aucun paramètre ne permet de partager ce tampon circulaire : le runtime écrit une ligne JSON par événement sur stdout en production, et c'est ce flux qu'il convient de collecter — via le service de logs de votre plateforme, Loki, ou tout outil lisant la sortie des conteneurs.

## Cron et la file d'attente de tâches

Chaque processus exécutant le planificateur cron arme ses propres minuteurs, et l'exécution est d'abord réservée dans la base de données, de sorte qu'un créneau s'exécute **une seule fois**, quel que soit le nombre de processus déclenchés. La mise en pause d'une tâche, ainsi que le bail empêchant un déclenchement manuel lors d'une exécution en cours, sont partagés de la même manière. Rien n'est à configurer, tant que la base de données est Postgres. `REBASE_CRON_SCHEDULER` et `REBASE_JOB_WORKERS` déterminent quels processus exécutent les minuteurs et les workers — consultez [Processus scindés](/docs/deployment/split-processes/).

L'audit RLS planifié fait exception : il n'est pas réservé, chaque processus qui en est responsable lance donc l'analyse selon son propre minuteur. C'est redondant plutôt que dangereux ; définissez `REBASE_RLS_AUDIT=false` partout sauf sur une instance.

## Applications statiques

Un processus qui sert le frontend ou le CMS (`REBASE_SERVE_STATIC`, activé par défaut) lit le fichier `index.html` de chaque application une fois et le conserve en mémoire. Remplacer le build sur un volume partagé n'affecte pas un processus en cours d'exécution : il continue de servir l'ancien document, qui référence des segments (chunks) pouvant ne plus exister. Déployez un nouveau build en redémarrant ou en renouvelant progressivement chaque instance — ce qu'une nouvelle image ou un nouveau bundle fait de toute façon. Avec un CDN en amont et `REBASE_SERVE_STATIC=false`, cela ne s'applique pas.

## Métriques

`/metrics` renvoie les métriques du processus qui répond à la requête. Scrapez chaque instance — une tâche de découverte de services Prometheus par pod, et non une cible unique derrière l'équilibreur de charge — et effectuez la somme dans la requête.

## Provisionnement au démarrage

Chaque instance exécute la passe additive de schéma au démarrage (`REBASE_MIGRATE_ON_BOOT=ensure`). Les instances ayant le même rôle peuvent l'exécuter en même temps : le mécanisme est conçu pour tolérer qu'un pair ait créé la même table un instant plus tôt. Dans un déploiement scindé, un seul rôle provisionne et tous les autres sont configurés sur `none` — consultez [Processus scindés](/docs/deployment/split-processes/).
