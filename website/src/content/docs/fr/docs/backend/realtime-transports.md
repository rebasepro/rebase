---
sourceHash: 1b7c64b3c001f57d
title: Le temps réel entre instances
sidebar_label: Temps réel entre instances
description: "Comment les canaux de diffusion et la présence fonctionnent à travers plusieurs processus serveur : le bus LISTEN/NOTIFY, les responsabilités de chaque instance et l'écriture de votre propre transport."
---

## Diffusion inter-instances et architecture LISTEN/NOTIFY

Pour les environnements de cluster multi-instances (par ex., s'exécutant dans des conteneurs Kubernetes ou Docker derrière un équilibreur de charge), Rebase s'appuie sur le mécanisme `LISTEN/NOTIFY` de PostgreSQL pour synchroniser les **modifications de lignes** entre les instances. Les abonnements aux tables et aux entités s'étendent donc à toutes les instances sans aucune configuration — c'est ce que décrit cette section.

**Les canaux de diffusion et la présence sont distincts**, et fonctionnent par instance tant que vous n'activez pas un bus de canal. Voir [Canaux et présence entre instances](#canaux-et-présence-entre-instances) ci-dessous.

### Contournement des pools pgBouncer

Comme les gestionnaires de pools de connexions tels que **pgBouncer** ne prennent pas en charge le modèle de connexion persistante requis pour les sessions SQL `LISTEN` de longue durée, le superviseur temps réel ouvre un client Postgres dédié et non mutualisé (`PgClient`) directement vers la base de données. Cette connexion directe utilise la variable d'environnement `DATABASE_DIRECT_URL` si elle est configurée, garantissant la stabilité et évitant l'épuisement du pool ou des déconnexions brutales.

### Mécanique des notifications et structure de la charge utile (payload)

Lorsque la [capture des modifications de base de données (CDC)](/docs/backend/realtime-cdc/) est active — ce qui est le cas par défaut dès que le rôle de la base de données peut créer des déclencheurs (triggers) —, chaque instance écoute chaque commit sur le canal `rebase_cdc`, et rien de ce qui suit n'est envoyé. Sans cela, lorsqu'un enregistrement est modifié sur l'Instance A, elle diffuse une notification sur le canal `rebase_entity_changes`. Pour minimiser la charge sur la base de données et la bande passante réseau, la charge utile de la notification est maintenue extrêmement compacte :

```json
{
  "sid": "inst_7a9c1b",
  "p": "posts",
  "eid": "45",
  "db": null
}
```

*Remarque : `sid` représente l'identifiant d'instance aléatoire unique du serveur généré au démarrage, `p` est le slug (chemin) de la table, et `eid` est l'identifiant de l'entité cible.*

Les modifications apportées au même moment — un enregistrement groupé annonce chaque ligne qu'il a écrite — sont envoyées ensemble, dans le moins de notifications possible pour respecter la limite NOTIFY de 8000 octets de Postgres, chacune listant ses modifications sous forme de triplets `[p, eid, db]` :

```json
{
  "sid": "inst_7a9c1b",
  "c": [["posts", "45", null], ["posts", "46", null]]
}
```

Une modification unique conserve la structure ci-dessus, de sorte qu'une instance plus ancienne peut toujours la lire lors d'un déploiement progressif (rolling deploy).

- **Auto-filtrage (Self-Filtering)** : À la réception d'un message, chaque instance lit le `sid`. S'il correspond à son propre identifiant d'instance, le serveur ignore la notification afin d'éviter les boucles de routage infinies.
- **Relais et diffusion (Fan-out)** : Si la notification provient d'une autre instance, le serveur planifie une nouvelle récupération détemporisée (debounced refetch) pour ses abonnés connectés localement à chaque modification. Il ne lit rien à la réception : chaque frame déclenche une nouvelle récupération dans le propre périmètre (scope) de son abonné.
- **Boucle de reconnexion du superviseur** : Si la connexion à la base de données est interrompue, un superviseur de connexion en arrière-plan surveille l'état et déclenche une séquence de reconnexion automatique après un délai fixe de **3 secondes**, restaurant la boucle `LISTEN` sans affecter le cycle de vie principal de l'application Hono. Chaque abonnement actif sur l'instance est ensuite réexécuté, car tout ce qui a été publié pendant l'interruption de la connexion n'a atteint personne. Si la base de données ne peut pas être jointe au démarrage, la connexion est retentée de la même manière.
- **Heartbeat** : Une connexion `LISTEN` est inactive par nature, et un délai d'inactivité (idle-flow timeout) sur un équilibreur de charge ou un NAT peut l'interrompre sans erreur de part et d'autre (connexion semi-ouverte). Elle s'exécute donc avec un keepalive TCP et doit répondre à un `SELECT 1` toutes les 30 secondes en moins de 10 secondes. Une connexion qui ne répond pas à temps est remplacée comme décrit ci-dessus. Pendant que la connexion est interrompue, `/health` la liste sous `cross-instance`, et une fois qu'elle a été interrompue pendant 60 secondes, la vérification échoue.

## Canaux et présence entre instances

Les modifications de lignes traversent les instances de manière autonome (voir ci-dessus). Les canaux de diffusion et la présence ne le font **pas** : par défaut, ils ne sont diffusés qu'aux clients connectés à l'instance qui les a reçus.

Sur une seule instance, ce comportement est parfait et ne coûte rien. Derrière un équilibreur de charge, c'est un bogue que vous ne verrez pas en développement : deux collaborateurs arrivent sur des répliques différentes, rejoignent le même canal, et voient une pièce vide tout en diffusant parfaitement l'un vers l'autre. Aucune erreur n'apparaît.

La solution consiste à utiliser un **bus de canal** — un transport optionnel qui achemine les frames de canal et la présence entre les instances :

```typescript
database: createPostgresAdapter({
    connection: db,
    schema: { tables, enums, relations },
    realtime: {
        bus: { type: "postgres" }
    }
})
```

| Bus          | Quand l'utiliser                                                                                     |
|--------------|--------------------------------------------------------------------------------------------------------|
| `memory`     | **Par défaut.** Instance unique. Pas de distribution inter-instances, aucune surcharge.               |
| `postgres`   | Deux instances ou plus. Utilise `LISTEN/NOTIFY` sur la base de données déjà existante — aucun nouveau service à déployer. |

Le transport peut également être défini par déploiement via
`REALTIME_CHANNEL_BUS=memory|postgres`, ce qui permet de le modifier sans recompilation.
Il écrase une valeur intégrée **nommée** (`bus: { type: "memory" }`), et est
délibérément **ignoré** lorsque `realtime.bus` a reçu une *instance* construite
de `ChannelBus` — la variable ne peut nommer que les transports que ce package
sait construire, donc en tenir compte reviendrait à écarter silencieusement
l'objet fourni par l'application. Ce cas consigne un avertissement nommant les deux, et une
valeur non reconnue bascule vers ce qui a été configuré plutôt que vers memory.

### Pourquoi il n'y a pas d'option Redis intégrée

Rebase se déploie sous la forme Postgres + backend + frontend. Un bus nécessitant un courtier de messages ajouterait un second service avec état dans chaque `docker-compose.yml` généré par la CLI, pour une fonctionnalité que la plupart des applications n'utilisent jamais — la condition pour en ajouter un est donc que la base de données ne puisse réellement pas supporter la charge.

Elle le peut. Mesuré sur deux instances backend reliées à un unique conteneur Postgres, le bus Postgres a délivré **~10 000 messages inter-instances par seconde sans aucune perte**, et est resté stable jusqu'à **huit instances** (14 000 distributions, aucune perte). Vingt personnes déplaçant leur curseur à 60 ips génèrent environ 1 200 messages par seconde — soit environ un huitième de ce volume.

La limite à surveiller n'est pas la capacité, mais le fait que chaque notification est une requête vers votre base de données principale, entrant en concurrence avec les requêtes réelles de votre application. Le bus Postgres **fusionne (coalescing)** donc les frames sortantes (voir ci-dessous), ce qui permet de maintenir ce coût proportionnel au temps écoulé plutôt qu'au nombre de messages.

Par client, le socket accepte jusqu'à **7 200 frames de canal par minute** (120/s — 60 ips de diffusions de curseur plus la mise à jour de présence transportée par chacune), comptabilisées séparément du budget partagé par les requêtes et les abonnements. Les frames au-delà de cette limite sont rejetées avec une erreur `RATE_LIMITED` plutôt que mises en file d'attente.

Le refus arrive sur `channel.onError()`, et non sous la forme d'un `broadcast()` rejeté — voir [Lorsqu'une frame de canal est refusée](/docs/backend/realtime#when-a-channel-frame-is-refused).

Si vous continuez à pousser la limite après cela, limitez la fréquence (throttle) des événements de type curseur sur le client (un état où la dernière écriture l'emporte n'a pas besoin de 60 mises à jour par seconde), et envisagez de router les collaborateurs d'un document vers la même instance avec [`affinity`](/docs/sdk/realtime#keeping-a-group-on-one-instance) — le routage persistant (sticky routing) réduit le trafic inter-instances à presque rien, quel que soit le nombre d'utilisateurs. Ce n'est qu'au-delà de ce stade qu'un autre transport devient pertinent, et la solution est alors un package de transport, et non un fork. Voir [Écrire votre propre transport](#écrire-votre-propre-transport).

### Observer l'activité du bus

Avec `REBASE_METRICS=true`, chaque instance rapporte ce qu'elle transporte sur `/metrics` :

| Métrique | Type | Signification |
|--------|------|---------|
| `rebase_realtime_sockets` | gauge | Sockets ouverts sur cette instance |
| `rebase_realtime_channels` | gauge | Canaux ayant un membre sur cette instance |
| `rebase_realtime_bus_frames_published_total` | counter | Frames envoyées par cette instance au bus, par `kind` : `broadcast`, `broadcast_ref`, `presence_diff`, et `channels`, les instances s'informant mutuellement de ce qu'elles desservent |
| `rebase_realtime_bus_frames_skipped_total` | counter | Diffusions et changements de présence non envoyés car aucune autre instance n'avait de membres dans le canal |

Les compteurs partent de zéro au démarrage d'une instance, et comptent les frames, le bus pouvant en regrouper plusieurs au sein d'une seule notification. Les messages persistés (retained) voyagent toujours, ils ne sont donc jamais ignorés. Sur le bus `memory` par défaut, les deux restent à zéro.

Effectuez le scraping sur chaque instance plutôt que sur un équilibreur de charge placé devant elles : les chiffres sont par processus. Un groupe qui reste sur une seule instance se traduira par une hausse de `skipped` tandis que `broadcast` et `presence_diff` restent stables, et les sockets sont répartis entre les instances. Des diffusions qui augmentent sur chaque instance signifient que les canaux s'étendent sur celles-ci. Sur Rebase Cloud, `rebase cloud metrics` affiche les mêmes totaux par instance.

### Fusion (Coalescing)

Les frames publiées pendant qu'une courte fenêtre est ouverte partent ensemble dans une seule notification. La fenêtre est **à front montant (leading-edge)** : une frame arrivant lorsqu'aucune fenêtre n'est ouverte est envoyée immédiatement, de sorte qu'un canal inactif ne subit aucune latence supplémentaire et que seul un flux continu est regroupé en lot (batch).

Mesuré sur deux instances, 3 000 diffusions, toutes distribuées dans chaque cas :

| Profil de trafic | Fusion désactivée | Fusion activée | Réduction |
|---|---|---|---|
| Rafale (Burst - aussi vite que possible) | 3 000 requêtes | 68 requêtes | **44×** |
| Cadencé (~500 msg/s, espacés) | 3 000 requêtes | 240 requêtes | **12,5×** |

Le cas en rafale s'est également terminé environ 11× plus rapidement en temps réel (wall-clock), car les allers-retours vers la base de données constituaient le goulot d'étranglement plutôt que le travail lui-même.

La fenêtre est définie par défaut à 10 ms et n'est pas un paramètre critique — 5 ms, 10 ms et 20 ms ont produit des nombres de requêtes identiques dans les deux profils, car un lot est limité par le plafond de charge utile de 8 Ko ou par le profil naturel du trafic bien avant que le minuteur n'intervienne. Ne la modifiez que si vous avez une bonne raison :

```typescript
realtime: {
    bus: { type: "postgres", batchWindowMs: 20 }   // 0 désactive la fusion
}
```

Une note sur le déploiement : un lot voyage sous une forme réseau différente d'une frame unique, et une instance exécutant une version plus ancienne ne la comprend pas. Les frames uniques sont toujours envoyées non encapsulées, de sorte qu'un déploiement progressif ne risque des pertes de frames que si le cluster subit une charge soutenue *pendant* le redémarrage — et les canaux persistés se réparent de toute façon grâce au rejeu de l'historique.

## Écrire votre propre transport

`realtime.bus` accepte tout objet implémentant l'interface `ChannelBus`, ce qui permet de distribuer un transport sous la forme de son propre package — `@rebasepro/types` déclare le contrat, et rien d'autre n'est requis pour l'implémenter :

```typescript
import type { ChannelBus, ChannelBusFrame, ChannelBusHandler } from "@rebasepro/types";

export class MyChannelBus implements ChannelBus {
    readonly kind = "my-transport";
    readonly maxFrameBytes = Infinity;

    async start(handler: ChannelBusHandler): Promise<void> {
        // Connect. Reject if you cannot — the caller falls back to in-process
        // delivery, which is far better than a cluster that believes it is
        // connected and silently is not.
    }

    async publish(frame: ChannelBusFrame): Promise<void> {
        // Reach every other instance, or reject.
    }

    async stop(): Promise<void> {
        // Idempotent; release anything holding the event loop open.
    }
}
```

Transmettez l'instance là où un nom intégré irait normalement :

```typescript
database: createPostgresAdapter({
    connection: db,
    schema: { tables, enums, relations },
    realtime: { bus: new MyChannelBus(process.env.MY_TRANSPORT_URL!) }
})
```

**Ce que votre implémentation doit garantir :** `start()` rejette la promesse lorsque le transport est inutilisable ; `publish()` atteint toutes les autres instances ou rejette ; `stop()` est idempotent ; et un message malformé est ignoré et consigné dans les logs plutôt que de lever une exception, afin qu'une mauvaise frame ne puisse pas faire planter le listener.

**Ce qu'elle n'a pas besoin de garantir :** l'ordonnancement (les canaux persistés portent un `seq` et le SDK ordonne selon celui-ci), la durabilité (une frame perdue est une mise à jour en direct manquée, réparée par le rejeu de l'historique du client), ou la distribution unique exacte (les frames persistées sont dédoublonnées par `seq` ; les diffs de présence sont idempotents).

`maxFrameBytes` est la façon dont le framework sait s'il doit envoyer un grand message persisté en ligne ou sous la forme d'un pointeur. Renvoyez `Infinity` lorsque votre transport n'a pas de plafond significatif, afin que le chemin par pointeur ne soit jamais emprunté inutilement.

La distribution aux clients locaux n'est pas de votre ressort — le service temps réel gère les abonnés qui reçoivent une frame. Un transport ne fait que déplacer les frames entre les instances.

### La limite de 8 Ko sur le bus Postgres

`pg_notify` refuse une charge utile de 8000 octets ou plus. Les curseurs et la présence s'y logent largement ; un instantané (snapshot) de document, non. Rebase gère cela de la même manière qu'il gère les modifications d'entités volumineuses — en envoyant une adresse au lieu d'un corps :

- **Sur un canal persisté** (voir [Rétention de canal](/docs/backend/realtime#channel-retention)), le message est déjà stocké avec un numéro de séquence, de sorte que la notification ne transporte que `(channel, seq)` et chaque instance réceptrice relit le corps. Il n'y a aucune limite de taille. Cela vaut pour chaque message persisté, petit ou grand : n'importe quelle connexion à la base de données peut faire un `LISTEN`, de sorte que le corps ne transite jamais dans la notification. Cela coûte une lecture par clé primaire par message sur chaque instance ayant un membre sur le canal.
- **Les diffusions éphémères et la présence** voyagent toujours dans la notification elle-même, de sorte que tout utilisateur connecté à la base de données peut les lire. Placez tout ce qui ne doit pas être lisible de cette manière sur un canal persisté.
- **Sur un canal éphémère**, il n'y a rien vers quoi pointer. La diffusion est distribuée localement, l'expéditeur reçoit une erreur `CHANNEL_BUS_PAYLOAD_TOO_LARGE` sur `channel.onError()`, et un avertissement nomme le canal — plutôt que de voir le message atteindre silencieusement la moitié du cluster.

Si vous diffusez des messages volumineux, appliquez une règle de rétention à ce canal. C'est la solution complète.

### La présence est un état partagé, pas seulement une diffusion

`presence_state` doit pouvoir répondre à "qui est dans ce canal ?" pour l'ensemble du cluster, ce que la mémoire par instance ne peut pas faire. Lorsqu'un bus est actif, Rebase conserve la liste des membres dans `rebase.channel_presence` (créée automatiquement) et répond aux requêtes de présence à partir de celle-ci.

| Colonne       | Contenu                                        |
|---------------|------------------------------------------------|
| `channel`     | Nom du canal                                   |
| `client_id`   | Le client suivi                                |
| `instance_id` | L'instance backend à laquelle il est connecté  |
| `state`       | L'état de présence du client                   |
| `last_seen`   | Actualisé par le heartbeat de présence du SDK  |

Le SDK envoie un heartbeat de présence toutes les ~20 secondes face à un délai d'expiration de 30 secondes. Les lignes qui cessent d'être actualisées sont purgées, et les départs sont annoncés à chaque instance — ce qui sert également de récupération après crash : un pod qui s'arrête brutalement laisse des lignes qui, après une fenêtre de délai d'expiration, ressemblent exactement à tout autre client devenu silencieux. Un arrêt propre supprime ses propres lignes immédiatement, de sorte qu'un déploiement progressif n'affiche aucune période de fantômes.

:::caution[La connexion LISTEN doit contourner votre gestionnaire de pool]
`LISTEN` étant lié à l'état de session, le bus Postgres nécessite une connexion directe — et non pgBouncer ou un gestionnaire de pool en mode transaction. Rebase utilise `DATABASE_DIRECT_URL` lorsqu'elle est définie ; derrière un pooler, faites-la pointer directement vers le service de base de données. Sans URL directe utilisable, le bus consigne un avertissement et reste en mode mémoire.
:::

## Prochaines étapes

- [Temps réel & WebSocket](/docs/backend/realtime/) — abonnements, canaux et présence sur une seule instance
- [Processus séparés](/docs/deployment/split-processes/) — le modèle de déploiement concerné par cette architecture
- [Auto-hébergement](/docs/deployment/self-hosting/) — exécuter le runtime vous-même
