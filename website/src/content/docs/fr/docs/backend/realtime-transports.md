---
sourceHash: 18c4ff1205a910b2
title: Le temps réel entre instances
sidebar_label: Temps réel entre instances
description:"\"Comment les canaux de diffusion et la présence survivent à plusieurs processus serveur : le bus LISTEN/NOTIFY, ce que possède chaque instance, et l'écriture de votre propre transport.\""
---

## Diffusion entre instances et architecture LISTEN/NOTIFY

Pour les environnements de cluster multi-instances (par ex., exécutés dans Kubernetes ou des conteneurs Docker derrière un répartiteur de charge), Rebase s'appuie sur le `LISTEN/NOTIFY` de PostgreSQL pour synchroniser les **modifications de lignes** entre les instances. Les abonnements aux collections et aux entités s'étendent donc à travers les instances sans aucune configuration — c'est ce que décrit cette section.

**Les canaux de diffusion (broadcast) et la présence sont distincts**, et fonctionnent par instance tant que vous n'activez pas de bus de canaux. Voir [Canaux et présence entre instances](#canaux-et-présence-entre-instances) ci-dessous.

### Contourner les pools pgBouncer

Parce que les gestionnaires de pools de connexions comme **pgBouncer** ne prennent pas en charge le modèle de connexion persistante requis pour les sessions SQL `LISTEN` de longue durée, le superviseur temps réel ouvre un client Postgres dédié, hors pool (`PgClient`), directement vers la base de données. Cette connexion directe utilise la variable d'environnement `DATABASE_DIRECT_URL` si elle est configurée, garantissant la stabilité et évitant l'épuisement du pool ou les déconnexions brutales.

### Mécanismes de notification et structure de la charge utile

Lorsque la [capture des modifications de base de données](/docs/backend/realtime-cdc/) est active — par défaut dès lors que le rôle de base de données peut créer des déclencheurs (triggers) — chaque instance écoute chaque commit sur le canal `rebase_cdc`, et rien de ce qui suit n'est envoyé. Sans cela, lorsqu'un enregistrement est modifié sur l'Instance A, elle diffuse une notification sur le canal `rebase_entity_changes`. Pour minimiser la charge sur la base de données et la bande passante réseau, la charge utile (payload) de la notification reste extrêmement compacte :

```json
{
  "sid": "inst_7a9c1b",
  "p": "posts",
  "eid": "45",
  "db": null
}
```

*Remarque : `sid` représente l'ID d'instance aléatoire et unique du serveur généré au démarrage, `p` est le slug (chemin) de la collection, et `eid` est l'ID de l'entité ciblée.*

Les modifications apportées au même moment — un enregistrement en masse annonce chaque ligne qu'il a écrite — sont envoyées ensemble, dans le plus petit nombre possible de notifications respectant la limite de 8000 octets de NOTIFY dans Postgres, chacune listant ses modifications sous forme de triplets `[p, eid, db]` :

```json
{
  "sid": "inst_7a9c1b",
  "c": [["posts", "45", null], ["posts", "46", null]]
}
```

Une modification unique conserve la structure ci-dessus, de sorte qu'une instance plus ancienne puisse toujours la lire lors d'un déploiement progressif (rolling deploy).

- **Auto-filtrage** : Dès réception d'un message, chaque instance lit le `sid`. S'il correspond à son propre ID d'instance, le serveur ignore la notification afin d'éviter les boucles de routage infinies.
- **Relais et diffusion (Fan-out)** : Si la notification provient d'une autre instance, le serveur planifie un rafraîchissement (refetch) avec anti-rebond (debounce) de chaque modification pour ses abonnés connectés localement. Il ne lit rien à la réception : chaque trame déclenche un rafraîchissement sous la propre portée (scope) de son abonné.
- **Boucle de reconnexion du superviseur** : Si la connexion à la base de données est interrompue, un superviseur de connexion en arrière-plan surveille l'état et déclenche une séquence de reconnexion automatique après un délai fixe de **3 secondes**, restaurant la boucle `LISTEN` sans affecter le cycle de vie principal de l'application Hono. Chaque abonnement actif sur l'instance est ensuite rafraîchi, car tout ce qui a été publié pendant l'interruption n'a touché personne. Si la base de données est inaccessible au démarrage, la reconnexion est tentée de la même manière.
- **Heartbeat (battement de cœur)** : Une connexion `LISTEN` est inactive par nature, et un délai d'inactivité (idle timeout) sur un répartiteur de charge ou un NAT peut la fermer sans erreur d'aucun côté (connexion semi-ouverte). Elle s'exécute donc avec le keepalive TCP et doit répondre à un `SELECT 1` toutes les 30 secondes en moins de 10 secondes. Une connexion qui le manque est remplacée comme décrit ci-dessus. Tant que la connexion est interrompue, `/health` la répertorie comme `cross-instance`, et une fois interrompue pendant 60 secondes, la vérification échoue.

## Canaux et présence entre instances

Les modifications de lignes traversent les instances d'elles-mêmes (voir ci-dessus). Les canaux de diffusion et la présence ne le font **pas** : par défaut, ils ne sont diffusés qu'aux clients connectés à l'instance qui les a reçus.

Sur une seule instance, c'est tout à fait adapté et ne coûte rien. Derrière un répartiteur de charge, c'est un bogue que vous ne verrez pas en développement : deux collaborateurs arrivent sur des répliques différentes, rejoignent le même canal et voient une salle vide tout en diffusant parfaitement l'un vers l'autre. Aucune erreur n'apparaît.

La solution est un **bus de canaux (channel bus)** — un transport optionnel qui achemine les trames de canaux et la présence entre les instances :

```typescript
database: createPostgresAdapter({
    connection: db,
    schema: { tables, enums, relations },
    realtime: {
        bus: { type: "postgres" }
    }
})
```

| Bus          | Quand l'utiliser                                                                                              |
|--------------|---------------------------------------------------------------------------------------------------------------|
| `memory`     | **Par défaut.** Instance unique. Aucune distribution entre instances, aucune surcharge.                     |
| `postgres`   | Deux instances ou plus. Utilise `LISTEN/NOTIFY` sur la base de données existante — aucun nouveau service à déployer. |

Le transport peut également être défini par déploiement avec `REALTIME_CHANNEL_BUS=memory|postgres`, afin de pouvoir être modifié sans recompilation. Il prévaut sur une option intégrée **nommée** (`bus: { type: "memory" }`), et est délibérément **ignoré** lorsque `realtime.bus` a reçu une *instance* construite de `ChannelBus` — la variable ne pouvant désigner que des transports que ce package sait construire, en tenir compte ici reviendrait à rejeter silencieusement l'objet fourni par l'application. Ce cas consigne un avertissement mentionnant les deux, et une valeur non reconnue revient à ce qui a été configuré plutôt qu'à la mémoire.

### Pourquoi il n'y a pas d'option Redis intégrée

Rebase se déploie sous forme de Postgres + backend + frontend. Un bus nécessitant un courtier de messages (message broker) ajouterait un deuxième service avec état dans chaque `docker-compose.yml` généré par le CLI, pour une fonctionnalité que la plupart des applications n'utilisent jamais — la condition pour en ajouter un est donc que la base de données ne puisse réellement pas supporter la charge.

Elle le peut. Mesuré sur deux instances backend connectées à un seul conteneur Postgres, le bus Postgres a délivré **~10 000 messages inter-instances par seconde sans aucune perte**, et est resté stable jusqu'à **huit instances** (14 000 distributions, aucune perte). Vingt personnes déplaçant des curseurs à 60 fps génèrent environ 1 200 messages par seconde — soit environ un huitième de ce volume.

La limite à surveiller n'est pas la capacité, mais le fait que chaque notification est une requête sur votre base de données principale, en concurrence avec les requêtes réelles de votre application. Le bus Postgres **fusionne (coalescing)** donc les trames sortantes (voir ci-dessous), ce qui maintient ce coût proportionnel au temps écoulé plutôt qu'au nombre de messages.

Par client, la socket accepte jusqu'à **7 200 trames de canal par minute** (120/s — 60 fps de diffusion de curseur plus la mise à jour de présence transportée par chacune), comptabilisées séparément du budget partagé par les requêtes et les abonnements. Les trames au-delà sont refusées avec une erreur `RATE_LIMITED` au lieu d'être mises en file d'attente.

Le refus arrive sur `channel.onError()`, et non comme un `broadcast()` rejeté — voir [Lorsqu'une trame de canal est refusée](/docs/backend/realtime#when-a-channel-frame-is-refused).

Si vous atteignez encore les limites après cela, réduisez la fréquence des événements de type curseur côté client (un état du type « last-write-wins » n'a pas besoin de 60 mises à jour par seconde), et envisagez de router les collaborateurs d'un même document vers la même instance avec [`affinity`](/docs/sdk/realtime#keeping-a-group-on-one-instance) — le routage persistant (sticky routing) réduit le trafic entre instances à presque rien, quel que soit le nombre d'utilisateurs. Ce n'est qu'au-delà de ce point qu'un autre transport devient pertinent, et la solution est alors un package de transport, pas un fork. Voir [Écrire votre propre transport](#écrire-votre-propre-transport).

### Observer l'activité du bus

Avec `REBASE_METRICS=true`, chaque instance rapporte ce qu'elle traite sur `/metrics` :

| Métrique | Type | Signification |
|----------|------|---------------|
| `rebase_realtime_sockets` | jauge (gauge) | Sockets ouvertes sur cette instance |
| `rebase_realtime_channels` | jauge (gauge) | Canaux ayant un membre sur cette instance |
| `rebase_realtime_bus_frames_published_total` | compteur (counter) | Trames envoyées par cette instance au bus, par `kind` : `broadcast`, `broadcast_ref`, `presence_diff` et `channels`, les instances s'informant mutuellement de ce qu'elles desservent |
| `rebase_realtime_bus_frames_skipped_total` | compteur (counter) | Diffusions et changements de présence non envoyés car aucune autre instance n'avait de membres dans le canal |

Les compteurs partent de zéro au démarrage de l'instance et comptent les trames, parmi lesquelles le bus peut en regrouper plusieurs dans une seule notification. Les messages conservés (retained) voyagent toujours, ils ne sont donc jamais ignorés. Sur le bus `memory` par défaut, les deux restent à zéro.

Collectez les métriques (scrape) de chaque instance plutôt que depuis un répartiteur de charge placé devant elles : les chiffres sont par processus. Un groupe qui reste sur une seule instance se traduit par une hausse de `skipped` tandis que `broadcast` et `presence_diff` restent stables, et les sockets sont réparties sur les instances. Des diffusions qui augmentent sur chaque instance signifient que les canaux les traversent. Sur Rebase Cloud, `rebase cloud metrics` affiche les mêmes valeurs par instance.

### Fusion (Coalescing)

Les trames publiées pendant qu'une courte fenêtre est ouverte partent ensemble dans une seule notification. La fenêtre fonctionne sur **front montant (leading-edge)** : une trame arrivant lorsqu'aucune fenêtre n'est ouverte est envoyée immédiatement, de sorte qu'un canal inactif ne subit aucune latence supplémentaire et que seul un flux soutenu fait l'objet d'un traitement par lots (batching).

Mesuré sur deux instances, 3 000 diffusions, toutes délivrées dans chaque cas :

| Profil de trafic | Fusion désactivée | Fusion activée | Réduction |
|---|---|---|---|
| Rafale (au plus vite) | 3 000 requêtes | 68 requêtes | **44×** |
| Régulé (~500 msg/s, étalé) | 3 000 requêtes | 240 requêtes | **12,5×** |

Le cas en rafale s'est également terminé environ 11 fois plus vite en temps réel (wall-clock), car les allers-retours vers la base de données constituaient le goulot d'étranglement plutôt que le travail lui-même.

La fenêtre est définie par défaut à 10 ms et n'est pas un paramètre sensible — 5 ms, 10 ms et 20 ms ont produit des nombres de requêtes identiques dans les deux profils, car un lot est limité par le plafond de 8 Ko de charge utile ou par la dynamique naturelle du trafic bien avant que le minuteur n'intervienne. Ne la modifiez que si vous avez une raison précise :

```typescript
realtime: {
    bus: { type: "postgres", batchWindowMs: 20 }   // 0 disables coalescing
}
```

Une note sur le déploiement : un lot circule sous un format réseau (wire shape) différent de celui d'une trame individuelle, et une instance exécutant une version plus ancienne ne le comprend pas. Les trames uniques sont toujours envoyées non enveloppées, de sorte qu'un déploiement progressif ne risque des pertes de trames que si le cluster est sous charge soutenue *pendant* le redémarrage — et les canaux persistants (retained) se réparent d'eux-mêmes grâce au rejeu de l'historique dans tous les cas.

## Écrire votre propre transport

`realtime.bus` accepte tout objet implémentant l'interface `ChannelBus`, ce qui permet à un transport d'être distribué sous la forme de son propre package — `@rebasepro/types` déclare le contrat, et rien d'autre n'est requis pour l'implémenter :

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

Passez l'instance là où un nom intégré serait utilisé :

```typescript
database: createPostgresAdapter({
    connection: db,
    schema: { tables, enums, relations },
    realtime: { bus: new MyChannelBus(process.env.MY_TRANSPORT_URL!) }
})
```

**Ce que votre implémentation doit garantir :** `start()` rejette une promesse lorsque le transport est inutilisable ; `publish()` atteint toutes les autres instances ou rejette ; `stop()` est idempotent ; et un message mal formé est ignoré et journalisé plutôt que de lever une exception, afin qu'une trame défectueuse ne puisse pas faire planter l'écouteur.

**Ce qu'elle n'a pas besoin de garantir :** l'ordonnancement (les canaux conservés portent `seq` et le SDK effectue le tri grâce à cela), la durabilité (une trame perdue est une mise à jour en direct manquée, réparée par le rejeu d'historique du client), ou la distribution unique et exacte (les trames conservées sont dédupliquées par `seq` ; les diffs de présence sont idempotents).

`maxFrameBytes` est la manière dont le framework sait s'il doit envoyer un grand message conservé en ligne (inline) ou sous forme de pointeur. Retournez `Infinity` lorsque votre transport n'a pas de limite significative, afin que le chemin du pointeur ne soit jamais emprunté inutilement.

La distribution aux clients locaux n'est pas de votre ressort — le service temps réel gère les abonnés qui reçoivent une trame. Un transport se contente de déplacer des trames entre les instances.

### La limite de 8 Ko sur le bus Postgres

`pg_notify` refuse toute charge utile de 8000 octets ou plus. Les curseurs et la présence y logent largement ; un instantané (snapshot) de document, non. Rebase gère cela de la même manière qu'il gère les modifications d'entités volumineuses — en envoyant une adresse au lieu d'un corps de message :

- **Sur un canal conservé** (voir [Rétention des canaux](/docs/backend/realtime#channel-retention)), le message est déjà stocké avec un numéro de séquence, de sorte que la notification ne transporte que `(channel, seq)` et chaque instance réceptrice relit le corps du message. Il n'y a absolument aucune limite de taille. Cela s'applique à chaque message conservé, petit ou grand : n'importe quelle connexion à la base de données peut faire un `LISTEN`, de sorte que le corps ne circule jamais dans la notification. Cela coûte une lecture par clé primaire par message sur chaque instance ayant un membre dans le canal.
- **Les diffusions éphémères et la présence** circulent toujours dans la notification elle-même, de sorte que tout identifiant de connexion à la base de données peut les lire. Placez tout ce qui ne doit pas être lisible de cette façon sur un canal conservé.
- **Sur un canal éphémère**, il n'y a rien vers quoi pointer. La diffusion est distribuée localement, l'émetteur reçoit une erreur `CHANNEL_BUS_PAYLOAD_TOO_LARGE` sur `channel.onError()`, et un avertissement mentionne le canal — évitant ainsi que le message n'atteigne silencieusement que la moitié du cluster.

Si vous diffusez des messages volumineux, attribuez une règle de rétention à ce canal. C'est la solution complète.

### La présence est un état partagé, pas seulement une diffusion

`presence_state` doit répondre à la question « qui est dans ce canal ? » pour l'ensemble du cluster, ce que la mémoire par instance ne peut pas faire. Lorsqu'un bus est actif, Rebase conserve la liste des membres dans `rebase.channel_presence` (créée automatiquement) et répond aux requêtes de liste à partir de celle-ci.

| Colonne       | Contenu                                        |
|---------------|------------------------------------------------|
| `channel`     | Nom du canal                                   |
| `client_id`   | Le client suivi                                |
| `instance_id` | L'instance backend à laquelle il est connecté  |
| `state`       | L'état de présence du client                   |
| `last_seen`   | Rafraîchi par le heartbeat de présence du SDK  |

Le SDK envoie un heartbeat de présence toutes les ~20 secondes par rapport à un délai d'expiration de 30 secondes. Les lignes qui cessent d'être rafraîchies sont purgées, et les départs sont annoncés à chaque instance — ce qui sert également de récupération après crash : un pod qui s'arrête brutalement laisse des lignes qui ressemblent, après une fenêtre d'expiration, exactement à n'importe quel autre client devenu inactif. Un arrêt propre (graceful shutdown) nettoie immédiatement ses propres lignes, évitant ainsi l'apparition d'un intervalle de « fantômes » lors d'un déploiement progressif.

:::caution[La connexion LISTEN doit contourner votre gestionnaire de pool]
`LISTEN` est un état de session, le bus Postgres a donc besoin d'une connexion directe — pas de pgBouncer ni d'aucun pooler en mode transaction. Rebase utilise `DATABASE_DIRECT_URL` lorsqu'elle est définie ; derrière un gestionnaire de pool, faites-la pointer directement vers le service de base de données lui-même. Sans URL directe utilisable, le bus consigne un avertissement et reste en mode mémoire.
:::

## Prochaines étapes

- [Temps réel et WebSocket](/docs/backend/realtime/) — abonnements, canaux et présence sur une seule instance
- [Processus séparés (Split Processes)](/docs/deployment/split-processes/) — le modèle de déploiement concerné
- [Auto-hébergement](/docs/deployment/self-hosting/) — exécuter le runtime vous-même
