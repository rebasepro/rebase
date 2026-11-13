---
sourceHash: 5f05a6b3c8a0e4b3
title: Capture des modifications de base de données
sidebar_label: Capture des modifications de base de données
description: "Événements en temps réel pour chaque écriture validée, quelle que soit son origine : les déclencheurs de capture, le paramètre REALTIME_CDC et leurs prérequis."
---

**Le Change Data Capture est activé par défaut.** Rebase capture les modifications au niveau de la base de données et émet des événements en temps réel pour **chaque écriture validée, quelle que soit la manière dont elle a été effectuée** — REST, SDK, Studio, `psql`, une tâche cron dans un autre service, du Drizzle/SQL brut, ou l'**éditeur SQL** de Studio. C'est le même modèle que Supabase Realtime qui suit le journal de transactions (write-ahead log).

Aucune configuration n'est requise. Sur une connexion à la base de données qui le prend en charge, le CDC s'auto-provisionne au démarrage ; sur une connexion qui ne le permet pas (par ex. un rôle restreint ne pouvant pas créer de déclencheurs), Rebase bascule silencieusement sur le temps réel au niveau applicatif — rien à activer, rien qui ne casse.

## Configuration

Le CDC est contrôlé par la variable d'environnement `REALTIME_CDC` :

| Valeur | Comportement |
| --- | --- |
| `auto` *(par défaut)* | Active la capture au niveau de la base de données là où la connexion le permet ; **bascule silencieusement** sur le temps réel au niveau applicatif dans le cas contraire. Sans configuration. |
| `trigger` | Force la capture basée sur des déclencheurs (triggers). Fonctionne sur n'importe quel PostgreSQL, y compris les instances managées sans réplication logique. Avertit (plutôt que de basculer silencieusement) s'il ne peut pas être provisionné. |
| `wal` | Lit les modifications depuis le journal de transactions (write-ahead log) via la réplication logique au lieu des déclencheurs, de sorte qu'une écriture n'exécute aucun déclencheur et n'envoie aucun `NOTIFY`. Nécessite `wal_level=logical` et un rôle autorisé à répliquer ; bascule sur `trigger`, avec un avertissement, lorsqu'un élément manque. Voir [Capture depuis le WAL](#capture-depuis-le-wal). |
| `off` | Temps réel au niveau applicatif uniquement. Utilisez ceci pour éviter la surcharge des déclencheurs par écriture sur les charges de travail à forte écriture. Un démarrage avec `off` propriétaire du schéma **supprime** également les déclencheurs et fonctions de capture installés par un démarrage antérieur, et consigne le nombre de suppressions effectuées ; désactivez-le et le démarrage suivant les réinstallera. |

Le même paramètre correspond à l'option `realtime.cdc` de l'adaptateur Postgres, pour un serveur qui le configure dans le code. `REALTIME_CDC`, lorsqu'il est défini, est prioritaire.

Au démarrage, vous verrez une ligne de log indiquant le mode actif, par ex. :

```
📡 [CDC] Realtime source = database-level change capture (mode: trigger).
   All writes now emit realtime events regardless of origin.
```

Si la connexion ne peut pas le prendre en charge, `auto` consigne une ligne d'information à la place et poursuit avec le temps réel au niveau applicatif :

```
ℹ️ [CDC] Database-level change capture unavailable (likely insufficient
   privileges to create triggers…) — using app-level realtime.
```

## Fonctionnement

1. **Auto-provisionnement** — Au démarrage (contexte serveur/propriétaire), Rebase installe des déclencheurs idempotents `AFTER INSERT/UPDATE/DELETE/TRUNCATE` sur chaque table gérée. Ils se déclenchent une fois par instruction et émettent des notifications de changement sur le canal `rebase_cdc` qui désignent les lignes modifiées par leur clé — la clé primaire, plus les deux colonnes d'identifiant pour une table de jonction many-to-many — et ne transmettent **aucune autre colonne**. Une instruction qui a modifié de nombreuses lignes les désigne par lots d'environ un millier de clés, de sorte qu'un `UPDATE` de 1 million de lignes envoie environ 1 000 notifications plutôt qu'un million ; une instruction ayant modifié une seule ligne envoie une seule notification, et celle qui n'en a modifié aucune n'envoie rien. Un `TRUNCATE` est annoncé comme une modification apportée à chaque ligne de la table. Une table partitionnée conserve un déclencheur par ligne, car PostgreSQL copie un déclencheur par ligne sur chaque partition, et une écriture effectuée directement sur une partition reste ainsi visible. PostgreSQL n'impose aucun privilège particulier sur `LISTEN`, de sorte que tout rôle pouvant se connecter à la base de données peut lire ce canal ; il apprend quelles clés ont changé, jamais ce qu'elles contiennent. Une clé trop volumineuse pour la limite de 8&nbsp;Ko de `NOTIFY` de PostgreSQL est envoyée sans clé (une modification sur l'ensemble de la table, que chaque souscription de liste ou de ligne unique recharge), de sorte que le CDC ne peut jamais faire échouer l'écriture déclenchante. Les fonctions sont remplacées à chaque démarrage assurant le provisionnement, de sorte qu'une base de données instrumentée par une version antérieure — dont le déclencheur envoyait des lignes complètes — est mise à niveau au démarrage suivant ; un démarrage avec `REALTIME_CDC=off` les supprime au contraire.

   **Mise à niveau.** Une base de données instrumentée par une version antérieure au traitement par lots possède un déclencheur par ligne ; le premier démarrage d'une version plus récente le remplace par les déclencheurs par instruction. Pendant les 24 heures qui suivent, les nouveaux déclencheurs continuent d'envoyer une notification par ligne, comme le faisaient les anciens, afin que les instances de l'ancienne version encore en cours d'exécution pendant un déploiement progressif (ou après un retour arrière) reçoivent chaque ligne. Une fois ce délai passé, ils passent au traitement par lots. Chaque version prenant en charge le traitement par lots lit les deux formats.
2. **Capture** — Un client `LISTEN` dédié et non mutualisé par instance consomme `rebase_cdc`, fait correspondre la table modifiée à la table qu'il dessert, et injecte la modification dans le même pipeline `RealtimeService` que celui utilisé par les mutations d'API. Tout comme le listener inter-instances, il privilégie `DATABASE_DIRECT_URL` et se reconnecte automatiquement.
3. **Distribution sécurisée vis-à-vis des RLS** — La ligne brute issue du flux de modifications n'est **jamais** transmise aux abonnés. La modification est marquée comme invalidée, et chaque souscription relit la ligne sous son **propre** contexte d'authentification. Le filtrage s'effectue donc par abonné, jamais par émetteur : un client ne reçoit que les lignes autorisées par ses politiques RLS.
4. **Inter-instances** — Étant donné que chaque instance observe chaque validation via le flux de modifications, le CDC constitue également le canal inter-instances en soi ; l'ancienne diffusion `rebase_entity_changes` par mutation n'est pas utilisée lorsque le CDC est actif.
5. **Déduplication** — Une mutation effectuée via l'API Rebase planifie un nouveau chargement pour les abonnés locaux dès qu'elle est validée, et est également répercutée via le flux de modifications. L'instance d'origine supprime un écho qui arrive pendant la fenêtre d'anti-rebond de rechargement (un enregistrement éphémère de ses propres émissions), de sorte qu'une écriture via l'API ne produit normalement qu'une seule trame. Un écho qui arrive au-delà de cette fenêtre déclenche un rechargement supplémentaire, qui renvoie à nouveau les mêmes lignes : sans conséquence, mais un abonné peut voir deux fois une trame identique.

## Capture depuis le WAL

`REALTIME_CDC=wal` lit les modifications à partir du journal de transactions de PostgreSQL via la réplication logique (le plugin intégré `pgoutput`) au lieu des déclencheurs. Une écriture n'exécute alors aucun déclencheur et n'émet aucun `NOTIFY`, ce qui est crucial dès que les écritures sont concurrentes : une transaction ayant appelé `NOTIFY` acquiert un verrou pour l'ensemble du serveur au moment du commit et le maintient pendant l'écriture sur disque, de sorte qu'avec la capture par déclencheurs, ces validations se font une par une. Mesurée sur PostgreSQL 18 avec 32 rédacteurs simultanés et un vidage sur disque de 1&nbsp;ms, la capture par déclencheurs a plafonné les insertions à environ un dixième du débit atteint par la capture WAL.

Prérequis :

- `wal_level = logical` sur le serveur, ce qui nécessite un redémarrage. Sur Amazon RDS, définissez `rds.logical_replication = 1` ; sur Cloud SQL, `cloudsql.logical_decoding = on`.
- Un rôle autorisé à répliquer : `ALTER ROLE <role> REPLICATION`, ou l'équivalent de l'hébergeur (sur RDS, l'appartenance à `rds_replication`).
- Un slot de réplication et un WAL sender disponibles par instance de serveur (`max_replication_slots` et `max_wal_senders`, tous deux fixés à 10 par défaut).
- Une connexion directe (`DATABASE_DIRECT_URL`) : un gestionnaire de connexions ne prend pas en charge le protocole de réplication.

Lorsqu'un de ces éléments est manquant, le démarrage consigne la raison dans les logs et utilise la capture par déclencheurs à la place.

Ce que fait le démarrage :

- Il crée une publication nommée `rebase_cdc` et y ajoute chaque table desservie ainsi que chaque table de jonction many-to-many. Les tables sont uniquement ajoutées, de sorte qu'une version plus ancienne encore en cours d'exécution pendant un déploiement progressif ne peut pas retirer la table d'une version plus récente.
- Une table sans clé primaire, ou avec `REPLICA IDENTITY NOTHING`, est ignorée avec un avertissement : PostgreSQL refuse les `UPDATE` et `DELETE` sur une table publiée qui ne peut pas identifier la ligne modifiée. Les écritures qui y sont effectuées en dehors de Rebase ne sont pas capturées.
- Chaque instance lit le flux de la publication via son propre slot de réplication **temporaire**, que PostgreSQL supprime à la fermeture de la connexion, de sorte qu'une instance qui plante ne peut pas laisser derrière elle un slot retenant les journaux WAL jusqu'à saturation du disque. Une reconnexion initialise un nouveau slot, et chaque souscription recharge les données, car ce qui a été validé durant l'interruption n'est pas rejoué.
- Une fois son flux ouvert, un démarrage qui à la fois provisionne et consomme supprime les déclencheurs de capture, tout comme le fait `off`. Lors d'un déploiement progressif abandonnant la capture par déclencheurs, les instances qui l'exécutent encore cessent de recevoir les écritures effectuées ailleurs jusqu'à leur remplacement ; leurs propres écritures continuent de parvenir à leurs abonnés. Un processus qui se contente de provisionner, comme le travail de migration d'un [déploiement fractionné](/docs/deployment/split-processes/), conserve les déclencheurs pour les consommateurs qui ne peuvent pas lire les flux et basculent sur eux.

Les processus d'écriture conservent toute leur vitesse lors d'un pic de charge, mais un seul WAL sender décode chaque slot, de sorte qu'au-delà de plusieurs milliers d'écritures soutenues par seconde, les événements peuvent arriver avec du retard. Un rôle disposant de `REPLICATION` peut lire chaque ligne d'une table publiée via son propre slot ; le flux reste confiné au serveur, et les abonnés relisent toujours chaque ligne selon leurs propres règles RLS.

## Prérequis et remarques

- Le CDC requiert une chaîne de connexion directe (`DATABASE_DIRECT_URL`, le paramètre `directConnectionString` de l'adaptateur ou la connexion principale) pour le client `LISTEN` — les gestionnaires de connexions en mode transaction ne prennent pas en charge les sessions `LISTEN` de longue durée.
- Les déclencheurs ne sont installés que sur les tables que le backend dessert, ainsi que sur les tables de jonction de leurs relations many-to-many. Les écritures sur des tables non mappées sont ignorées.
- Une table desservie qui n'a pas encore été créée est ignorée avec un avertissement plutôt que de bloquer le CDC pour le reste.

## Prochaines étapes

- [Temps réel et WebSocket](/docs/backend/realtime) — abonnements, canaux et présence, alimentés par ces événements.
- [Temps réel inter-instances](/docs/backend/realtime-transports) — le bus qui achemine les modifications entre les processus serveur.
