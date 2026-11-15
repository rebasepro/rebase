---
sourceHash: a04d0760ffb715cb
title: Capture des modifications de base de données
sidebar_label: Capture des modifications de base de données
description: "Des événements en temps réel pour chaque écriture validée, peu importe son origine : les déclencheurs de capture, le paramètre REALTIME_CDC et leurs prérequis."
---

**Le Change Data Capture (CDC) est activé par défaut.** Rebase capture les modifications au niveau de la base de données et émet des événements en temps réel pour **chaque écriture validée, peu importe son origine** — REST, SDK, Studio, `psql`, une tâche cron dans un autre service, du Drizzle/SQL brut ou l'**éditeur SQL** de Studio. Il s'agit du même modèle que Supabase Realtime qui suit le journal de transactions (write-ahead log).

Aucune configuration n'est requise. Sur une connexion de base de données qui le prend en charge, le CDC s'auto-provisionne au démarrage ; sur une connexion qui ne le permet pas (par exemple, un rôle restreint qui ne peut pas créer de déclencheurs), Rebase bascule silencieusement sur le temps réel au niveau applicatif — rien à activer, aucun dysfonctionnement.

## Configuration

Le CDC est contrôlé par la variable d'environnement `REALTIME_CDC` :

| Valeur | Comportement |
| --- | --- |
| `auto` *(par défaut)* | Lit les modifications depuis le WAL lorsque la base de données le permet, sinon utilise les déclencheurs de capture, sinon bascule sur le temps réel au niveau applicatif. Chaque basculement génère une ligne de log d'information, et non un avertissement. Zéro configuration. Voir [Capture depuis le WAL](#capture-depuis-le-wal). |
| `trigger` | Force la capture basée sur les déclencheurs. Fonctionne sur n'importe quel PostgreSQL, y compris les instances managées sans réplication logique. Avertit (plutôt que de basculer silencieusement) s'il ne peut pas être provisionné. |
| `wal` | Lit les modifications depuis le journal de transactions (write-ahead log) via la réplication logique au lieu des déclencheurs, de sorte qu'une écriture n'exécute aucun déclencheur et n'envoie aucun `NOTIFY`. Nécessite `wal_level=logical` et un rôle autorisé à répliquer ; bascule sur `trigger`, avec un avertissement, si l'un d'eux est manquant. Voir [Capture depuis le WAL](#capture-depuis-le-wal). |
| `off` | Temps réel au niveau applicatif uniquement. Utilisez ceci pour éviter la surcharge des déclencheurs par écriture sur les charges de travail intensives en écriture. Un démarrage avec `off` qui possède le schéma **supprime** également les déclencheurs et fonctions de capture installés par un démarrage antérieur, et consigne le nombre d'éléments retirés ; retirez cette variable et le démarrage suivant les réinstallera. |

Ce même paramètre correspond à l'option `realtime.cdc` de l'adaptateur Postgres, pour un serveur qui le configure dans le code. `REALTIME_CDC`, lorsqu'il est défini, est prioritaire.

Au démarrage, vous verrez une ligne de log indiquant le mode actif, par exemple :

```
📡 [CDC] Realtime source = database-level change capture (mode: trigger).
   All writes now emit realtime events regardless of origin.
```

Si la connexion ne peut pas le prendre en charge, `auto` consigne plutôt une ligne d'information et poursuit avec le temps réel au niveau applicatif :

```
ℹ️ [CDC] Database-level change capture unavailable (likely insufficient
   privileges to create triggers…) — using app-level realtime.
```

## Fonctionnement

1. **Auto-provisionnement** — Au démarrage (contexte serveur/propriétaire), Rebase installe des déclencheurs idempotents `AFTER INSERT/UPDATE/DELETE/TRUNCATE` sur chaque table gérée. Ils se déclenchent une fois par instruction et émettent des notifications de changement sur le canal `rebase_cdc` qui désignent les lignes modifiées par leur clé — la clé primaire, ainsi que les deux colonnes d'identifiant pour une table de jonction many-to-many — et ne transmettent **aucune autre colonne**. Une instruction ayant modifié plusieurs lignes les désigne par lots d'environ un millier de clés, ainsi un `UPDATE` de 1 million de lignes envoie environ 1 000 notifications au lieu d'un million ; une instruction ayant modifié une ligne envoie une seule notification, et une n'en ayant modifié aucune n'envoie rien. Un `TRUNCATE` est annoncé comme une modification de chaque ligne de la table. Une table partitionnée conserve un déclencheur par ligne, car PostgreSQL copie un déclencheur par ligne sur chaque partition, et une écriture effectuée directement sur une partition est tout de même détectée. PostgreSQL n'impose aucun privilège sur `LISTEN`, de sorte que tout rôle pouvant se connecter à la base de données peut lire ce canal ; il apprend quelles clés ont changé, jamais ce qu'elles contiennent. Une clé trop volumineuse pour la limite de 8&nbsp;Ko de PostgreSQL pour `NOTIFY` est envoyée sans clé (une modification de l'ensemble de la table, que chaque abonnement de liste ou de ligne unique recharge), de sorte que le CDC ne peut jamais annuler l'écriture déclencheuse. Les fonctions sont remplacées à chaque démarrage qui effectue le provisionnement, ainsi une base de données instrumentée par une version plus ancienne — dont le déclencheur envoyait des lignes entières — est mise à niveau au prochain démarrage ; un démarrage avec `REALTIME_CDC=off` les supprime à la place.

   **Mise à niveau.** Une base de données instrumentée par une version antérieure au traitement par lots dispose d'un déclencheur par ligne ; le premier démarrage d'une version plus récente le remplace par les déclencheurs par instruction. Pendant les 24 heures qui suivent, les nouveaux déclencheurs continuent d'envoyer une notification par ligne, comme le faisaient les anciens, afin que les instances de l'ancienne version toujours en cours d'exécution pendant un déploiement progressif (rolling deploy) ou après un rollback reçoivent chaque ligne. Une fois ce délai passé, ils fonctionnent par lots. Chaque version prenant en charge les lots sait lire les deux formats.
2. **Capture** — Un client `LISTEN` dédié et non mutualisé (unpooled) par instance consomme `rebase_cdc`, fait correspondre la table modifiée à la table qu'il dessert, et transmet la modification dans le même pipeline `RealtimeService` que celui utilisé par les mutations d'API. Comme l'écouteur inter-instances, il privilégie `DATABASE_DIRECT_URL` et se reconnecte automatiquement.
3. **Distribution sécurisée avec RLS** — La ligne brute issue du flux de modifications n'est **jamais** transmise aux abonnés. La modification est marquée comme invalidée, et chaque abonnement relit la ligne sous son **propre** contexte d'authentification. Le filtrage s'effectue donc par abonné, jamais par diffuseur : un client ne reçoit jamais que les lignes autorisées par ses politiques RLS.
4. **Inter-instances** — Étant donné que chaque instance observe chaque commit à travers le flux de modifications, le CDC constitue également le canal inter-instances ; l'ancienne diffusion `rebase_entity_changes` par mutation n'est pas utilisée tant que le CDC est actif.
5. **Déduplication** — Une mutation effectuée via l'API Rebase planifie un rechargement pour les abonnés locaux dès qu'elle est validée, et est également renvoyée en écho via le flux de modifications. L'instance d'origine supprime un écho arrivant dans la fenêtre de debounce du rechargement (un enregistrement éphémère de ses propres émissions), de sorte qu'une écriture d'API ne produit normalement qu'une seule trame. Un écho arrivant au-delà de cette fenêtre déclenche un rechargement supplémentaire, qui délivre à nouveau les mêmes lignes : sans danger, mais un abonné peut voir deux fois une trame identique.

## Capture depuis le WAL

`REALTIME_CDC=wal`, ainsi que `auto` partout où la base de données le permet, lit les modifications depuis le journal de transactions (WAL) de PostgreSQL via la réplication logique (le plugin intégré `pgoutput`) au lieu des déclencheurs. Une écriture n'exécute alors aucun déclencheur et n'envoie aucun `NOTIFY`, ce qui prend toute son importance lorsque les écritures sont concurrentes : une transaction ayant appelé `NOTIFY` acquiert un verrou global pour tout le serveur lors du commit et le conserve jusqu'à l'écriture sur disque, de sorte qu'avec la capture par déclencheurs, ces commits se produisent un par un. Mesuré sur PostgreSQL 18 avec 32 rédacteurs simultanés et un vidage disque de 1&nbsp;ms, la capture par déclencheurs a limité les insertions à environ un dixième du débit atteint par la capture WAL.

Prérequis :

- `wal_level = logical` sur le serveur, ce qui nécessite un redémarrage. Sur Amazon RDS, définissez `rds.logical_replication = 1` ; sur Cloud SQL, `cloudsql.logical_decoding = on`.
- Un rôle autorisé à répliquer : `ALTER ROLE <role> REPLICATION`, ou l'équivalent de l'hébergeur (sur RDS, l'appartenance à `rds_replication`).
- Un slot de réplication et un émetteur WAL (WAL sender) disponibles par instance de serveur (`max_replication_slots` et `max_wal_senders`, tous deux fixés à 10 par défaut).
- Une connexion directe (`DATABASE_DIRECT_URL`) : un gestionnaire de pool ne prend pas en charge le protocole de réplication.

Si l'un de ces éléments est manquant, le démarrage en consigne la raison et utilise la capture par déclencheurs à la place : un avertissement sous `wal`, une ligne d'information sous `auto`, car la plupart des bases de données ne sont pas configurées pour le décodage logique et il s'agit alors du comportement attendu.

Ce que fait le démarrage :

- Il crée une publication nommée `rebase_cdc` et y ajoute chaque table desservie ainsi que chaque table de jonction many-to-many. Les tables ne sont jamais retirées, seulement ajoutées, de sorte qu'une ancienne version encore en cours d'exécution lors d'un déploiement progressif ne peut pas retirer la table d'une version plus récente.
- Une table sans clé primaire ou avec `REPLICA IDENTITY NOTHING` est ignorée avec un avertissement : PostgreSQL refuse les commandes `UPDATE` et `DELETE` sur une table publiée incapable d'indiquer quelle ligne a changé. Les écritures effectuées sur celle-ci en dehors de Rebase ne sont pas capturées.
- Chaque instance diffuse la publication via son propre slot de réplication **temporaire**, que PostgreSQL supprime à la fermeture de la connexion ; ainsi, une instance qui plante ne peut pas laisser derrière elle un slot retenant le WAL jusqu'à saturation du disque. Une reconnexion initialise un nouveau slot, et chaque abonnement recharge ses données, car ce qui a été validé durant l'interruption n'est pas rejoué.
- Une fois son flux ouvert, un démarrage qui provisionne et consomme à la fois supprime les déclencheurs de capture, tout comme le fait `off`, mais uniquement lorsqu'aucune autre instance n'est encore en train de les écouter. Dans le cas contraire, une instance ayant basculé sur la capture par déclencheurs (si elle n'a trouvé aucun slot de réplication libre, par exemple) ou une version plus ancienne encore active pendant un déploiement progressif cesserait de recevoir les écritures effectuées ailleurs. Chaque connexion temps réel s'identifie dans `application_name` (`rebase-realtime:<instance>:cdc`, `:wal` ou `:entity`), le démarrage lit donc `pg_stat_activity` pour vérifier qui écoute encore. La connexion d'une ancienne version, qui ne comporte aucun suffixe, est considérée comme étant à l'écoute. Tant que quelqu'un écoute, ou lorsque la vérification est impossible, les déclencheurs restent en place et sont maintenus à jour. Toutes les cinq minutes, l'instance vérifie à nouveau et les supprime dès que plus personne n'écoute. Un processus qui ne fait que provisionner, tel que la tâche de migration d'un [déploiement fractionné](/docs/deployment/split-processes/), conserve les déclencheurs pour les consommateurs qui ne peuvent pas utiliser le flux et doivent se rabattre sur eux.

Les rédacteurs conservent leur pleine vitesse lors d'une charge soudaine, mais un seul émetteur WAL décode chaque slot ; ainsi, au-delà de plusieurs milliers d'écritures soutenues par seconde, les événements peuvent arriver en retard. Un rôle disposant du privilège `REPLICATION` peut lire chaque ligne d'une table publiée via son propre slot ; le flux reste confiné au serveur, et les abonnés relisent toujours chaque ligne sous leurs propres règles RLS.

## Prérequis et remarques

- Le CDC nécessite une chaîne de connexion directe (`DATABASE_DIRECT_URL`, le paramètre `directConnectionString` de l'adaptateur ou la connexion principale) pour le client `LISTEN` — les gestionnaires de pool de connexions en mode transaction ne prennent pas en charge les sessions `LISTEN` de longue durée.
- Les déclencheurs sont installés uniquement sur les tables desservies par le backend, ainsi que sur les tables de jonction de leurs relations many-to-many. Les écritures sur les tables non mappées sont ignorées.
- Une table desservie qui n'a pas encore été créée est ignorée avec un avertissement plutôt que de bloquer le CDC pour les autres.

## Prochaines étapes

- [Temps réel et WebSocket](/docs/backend/realtime) — abonnements, canaux et présence, que ces événements alimentent.
- [Temps réel entre les instances](/docs/backend/realtime-transports) — le bus qui achemine les modifications entre les processus de serveur.
