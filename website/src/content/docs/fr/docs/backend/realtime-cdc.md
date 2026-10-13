---
sourceHash: f9db2c304fc55386
title: "Capture des modifications de la base de données"
sidebar_label: "Capture des modifications de la base de données"
description: "Des événements en temps réel pour chaque écriture validée, quelle que soit sa provenance : les déclencheurs de capture, le paramètre REALTIME_CDC et ce qu'ils exigent."
---

**Le Change Data Capture (CDC) est activé par défaut.** Rebase capture les modifications au niveau de la base de données et émet des événements en temps réel pour **chaque écriture validée (commit), quelle que soit sa provenance** — REST, SDK, Studio, `psql`, une tâche cron dans un autre service, Drizzle/SQL brut, ou l'**éditeur SQL** de Studio. Il s'agit du même modèle que Supabase Realtime suivant le journal de réécriture (WAL).

Aucune configuration n'est requise. Sur une connexion de base de données qui le prend en charge, le CDC s'auto-provisionne au démarrage ; sur une connexion qui ne le permet pas (par exemple, un rôle restreint qui ne peut pas créer de déclencheurs), Rebase bascule silencieusement sur le temps réel au niveau applicatif — rien à activer, aucun dysfonctionnement.

## Configuration

Le CDC est contrôlé par la variable d'environnement `REALTIME_CDC` :

| Valeur | Comportement |
| --- | --- |
| `auto` *(par défaut)* | Activer la capture au niveau de la base de données lorsque la connexion le permet ; **basculer silencieusement** sur le temps réel au niveau applicatif dans le cas contraire. Zéro configuration. |
| `trigger` | Forcer la capture basée sur les déclencheurs (triggers). Fonctionne sur tout PostgreSQL, y compris les instances managées sans réplication logique. Émet un avertissement (au lieu de basculer silencieusement) si le provisionnement échoue. |
| `wal` | Préférer la réplication logique WAL. Pas encore inclus — se rabat sur `trigger` et journalise le mode actif. |
| `off` | Temps réel au niveau applicatif uniquement. À utiliser pour éviter la surcharge liée aux déclencheurs sur les charges de travail à forte intensité d'écriture. Un démarrage avec `off` qui possède le schéma **retire** aussi les déclencheurs et fonctions de capture qu'un démarrage antérieur a installés, et journalise combien il en a retiré ; retirez `off` et le démarrage suivant les réinstalle. |

<span class="since-badge" data-since="0.25">Depuis 0.25</span> Ce même paramètre est
l'option `realtime.cdc` de l'adaptateur Postgres, pour un serveur qui le configure dans
le code. `REALTIME_CDC`, lorsqu'elle est définie, l'emporte.

Au démarrage, vous verrez une ligne de log indiquant le mode actif, par ex. :

```
📡 [CDC] Realtime source = database-level change capture (mode: trigger).
   All writes now emit realtime events regardless of origin.
```

Si la connexion ne le prend pas en charge, `auto` consigne une ligne d'information à la place et poursuit avec le temps réel au niveau applicatif :

```
ℹ️ [CDC] Database-level change capture unavailable (likely insufficient
   privileges to create triggers…) — using app-level realtime.
```

## Fonctionnement

1. **Auto-provisionnement** — Au démarrage (contexte serveur/propriétaire), Rebase installe des déclencheurs idempotents `AFTER INSERT/UPDATE/DELETE/TRUNCATE` sur chaque table managée. Ils se déclenchent une fois par instruction et émettent sur le canal `rebase_cdc` des notifications de modification qui nomment les lignes modifiées par leur clé — la clé primaire, plus les deux colonnes d'id pour une table de jonction plusieurs-à-plusieurs — et ne portent **aucune autre colonne**. Une instruction qui a modifié beaucoup de lignes les nomme par lots d'environ mille clés : un `UPDATE` de 1 M de lignes envoie donc environ 1 000 notifications plutôt qu'un million ; une instruction qui a modifié une ligne envoie une notification, et celle qui n'en a modifié aucune n'en envoie aucune. Un `TRUNCATE` est annoncé comme un changement sur chaque ligne de la collection. Une table partitionnée conserve un déclencheur par ligne, car PostgreSQL copie un déclencheur de ligne sur chaque partition et une écriture faite directement sur une partition est tout de même vue. PostgreSQL n'impose aucun privilège sur `LISTEN`, si bien que tout rôle capable de se connecter à la base de données peut lire ce canal ; il apprend quelles clés ont changé, jamais ce qu'elles contiennent. Une clé trop grande pour la limite de 8&nbsp;Ko de `NOTIFY` dans PostgreSQL est envoyée comme absence de clé (un changement sur la collection entière, que chaque abonnement à une liste ou à une ligne unique sur celle-ci relit), de sorte que le CDC ne puisse jamais interrompre l'écriture déclencheuse. Les fonctions sont remplacées à chaque démarrage qui provisionne, si bien qu'une base de données instrumentée par une version plus ancienne — dont le déclencheur envoyait des lignes entières — est mise à jour par le démarrage suivant ; un démarrage avec `REALTIME_CDC=off` les retire à la place.

   <span class="since-badge" data-since="0.25">Depuis 0.25</span> **Mise à niveau.** Une base de données instrumentée par une version antérieure au traitement par lots a un déclencheur par ligne ; le premier démarrage d'une version plus récente le remplace par les déclencheurs par instruction. Pendant les 24 heures qui suivent, les nouveaux déclencheurs envoient encore une notification par ligne, comme le faisaient les anciens, de sorte que les instances de la version antérieure encore en cours pendant un déploiement progressif (ou après un retour arrière) entendent chaque ligne. Passé ce délai, ils regroupent. Toute version qui regroupe lit les deux formes.
2. **Capture** — Un client `LISTEN` dédié et hors pool par instance consomme `rebase_cdc`, associe la table modifiée à sa collection correspondante, et transmet la modification au même pipeline `RealtimeService` que celui utilisé par les mutations d'API. Tout comme le récepteur multi-instances, il privilégie `DATABASE_DIRECT_URL` et se reconnecte automatiquement.
3. **Livraison sécurisée avec RLS** — La ligne brute provenant du flux de modifications n'est **jamais** transmise aux abonnés. La modification est marquée comme invalidée, et chaque abonnement relit la ligne sous son **propre** contexte d'authentification. Le filtrage s'effectue donc par abonné, jamais par émetteur : un client ne reçoit jamais que les lignes permises par ses politiques RLS.
4. **Multi-instances** — Étant donné que chaque instance observe chaque commit via le flux de modifications, le CDC *est* également le canal inter-instances ; l'ancienne diffusion par mutation `rebase_entity_changes` n'est pas utilisée tant que le CDC est actif.
5. **Déduplication** — Une mutation effectuée via l'API Rebase est livrée localement dès sa validation (commit) et est également répercutée en écho via le flux de modifications. L'instance d'origine supprime un écho qui arrive dans la fenêtre de temporisation de la nouvelle requête (via un enregistrement éphémère de ses propres émissions), de sorte qu'une écriture API produit normalement une seule trame. Un écho qui arrive plus tard déclenche une nouvelle requête de plus, qui livre à nouveau les mêmes lignes : sans danger, mais un abonné peut voir deux fois une trame identique.

## Prérequis & Remarques

<span class="since-badge" data-since="0.25">Depuis 0.25</span> `directConnectionString` est l'option de l'adaptateur ; en 0.24, utilisez `DATABASE_DIRECT_URL`.

- Le CDC nécessite une chaîne de connexion directe (`DATABASE_DIRECT_URL`, le `directConnectionString` de l'adaptateur, ou la connexion principale) pour le client `LISTEN` — les gestionnaires de pools de connexions (connection poolers) en mode transaction ne prennent pas en charge les sessions `LISTEN` de longue durée.
- Les déclencheurs ne sont installés que sur les tables adossées à une collection enregistrée. Les écritures sur des tables non associées sont ignorées.
- Une collection dont la table n'a pas encore fait l'objet d'une migration est ignorée avec un avertissement au lieu de bloquer le CDC pour le reste.
- Le streaming natif par réplication logique WAL (`wal2json`/`pgoutput`) est prévu ; aujourd'hui, `REALTIME_CDC=wal` se rabat sur la méthode basée sur les déclencheurs, qui fournit une couverture équivalente au niveau de la base de données.

## Prochaines étapes

- [Temps réel & WebSocket](/docs/backend/realtime) — abonnements, canaux et présence, que ces événements alimentent.
- [Temps réel entre instances](/docs/backend/realtime-transports) — le bus qui transporte les modifications entre les processus serveur.
