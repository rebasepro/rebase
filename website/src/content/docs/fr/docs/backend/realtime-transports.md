---
sourceHash: 8b0308f7ee06d77a
title: Temps réel entre plusieurs instances
sidebar_label: Temps réel entre plusieurs instances
description:"\"Comment les canaux de diffusion et la présence fonctionnent sur plusieurs processus serveur : le bus LISTEN/NOTIFY, la gestion par instance et l'écriture de votre propre transport.\""
---

## Diffusion inter-instances et architecture LISTEN/NOTIFY

Pour les environnements de cluster multi-instances (par exemple, s'exécutant dans Kubernetes ou des conteneurs Docker derrière un équilibreur de charge), Rebase s'appuie sur `LISTEN/NOTIFY` de PostgreSQL pour synchroniser les **modifications de lignes** entre les instances. Les abonnements aux collections et aux entités s'étendent ainsi à toutes les instances sans aucune configuration — c'est ce que décrit cette section.

**Les canaux de diffusion et la présence sont distincts**, et sont limités à chaque instance tant que vous n'activez pas un bus de canaux. Voir [Canaux et présence entre plusieurs instances](#channels-and-presence-across-instances) ci-dessous.

### Contourner les pools pgBouncer

Étant donné que les gestionnaires de pools de connexions tels que **pgBouncer** ne prennent pas en charge le modèle de connexion persistante requis pour les sessions SQL `LISTEN` de longue durée, le superviseur temps réel ouvre un client Postgres dédié et sans pool (`PgClient`) directement vers la base de données. Cette connexion directe utilise la variable d'environnement `DATABASE_DIRECT_URL` si elle est configurée, garantissant la stabilité et évitant l'épuisement du pool ou les déconnexions brutales.

### Mécanismes de notification et structure de la charge utile

Lorsqu'un enregistrement est modifié sur l'instance A, celle-ci diffuse une notification sur le canal `rebase_entity_changes`. Pour minimiser la charge sur la base de données et la bande passante réseau, la charge utile (payload) de la notification reste extrêmement compacte :

```json
{
  "sid": "inst_7a9c1b",
  "p": "posts",
  "eid": "45",
  "db": null
}
```

*Remarque : `sid` représente l'identifiant unique et aléatoire d'instance du serveur généré au démarrage, `p` est le slug de la collection (chemin), et `eid` est l'identifiant de l'entité cible.*

- **Auto-filtrage (Self-Filtering)** : À la réception d'un message, chaque instance lit le `sid`. S'il correspond à son propre identifiant d'instance, le serveur ignore la notification afin d'éviter les boucles infinies de routage.
- **Relais et diffusion (Fan-out)** : Si la notification provient d'une autre instance, le serveur planifie une nouvelle récupération temporisée (debounced) et relaie la mise à jour à ses abonnés WebSocket connectés localement.
- **Boucle de reconnexion du superviseur** : En cas d'interruption de la connexion à la base de données, un superviseur de connexion en arrière-plan surveille l'état et déclenche une séquence de reconnexion automatique après un délai fixe de **3 secondes**, rétablissant la boucle `LISTEN` sans affecter le cycle de vie principal de l'application Hono.

## Canaux et présence entre plusieurs instances

Les modifications de lignes traversent les instances de manière autonome (ci-dessus). Les canaux de diffusion et la présence ne le font **pas** : par défaut, ils ne sont diffusés qu'aux clients connectés à l'instance qui les a reçus.

Sur une seule instance, c'est parfaitement adapté et cela ne coûte rien. Derrière un équilibreur de charge, c'est un bogue que vous ne verrez pas en développement : deux collaborateurs arrivent sur des répliques différentes, rejoignent le même canal et voient une salle vide tout en diffusant leurs messages l'un vers l'autre sans problème. Aucune erreur n'est générée.

La solution est un **bus de canaux** (channel bus) — un transport optionnel qui achemine les trames de canaux et la présence entre les instances :

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
| `postgres`   | Deux instances ou plus. Utilise `LISTEN/NOTIFY` sur la base de données existante — aucun nouveau service à déployer. |

Le transport peut également être défini par déploiement avec
`REALTIME_CHANNEL_BUS=memory|postgres`, ce qui permet de le modifier sans recompilation.
Il remplace un mécanisme intégré **nommé** (`bus: { type: "memory" }`), et est
délibérément **ignoré** lorsque `realtime.bus` a reçu une *instance* construite
de `ChannelBus` — la variable ne peut nommer que les transports que ce package
sait construire, donc en tenir compte dans ce cas reviendrait à ignorer silencieusement
l'objet fourni par l'application. Ce cas consigne un avertissement mentionnant les deux, et une
valeur non reconnue revient à ce qui était configuré plutôt qu'à la mémoire.

### Pourquoi il n'y a pas d'option Redis intégrée

Rebase se déploie sous la forme Postgres + backend + frontend. Un bus nécessitant un courtier de messages (message broker) ajouterait un deuxième service avec état dans chaque `docker-compose.yml` généré par la CLI, pour une fonctionnalité que la plupart des applications n'utilisent jamais — la condition pour en ajouter un est donc que la base de données ne puisse véritablement pas supporter la charge.

Elle le peut. Mesuré sur deux instances backend connectées à un seul conteneur Postgres, le bus Postgres a acheminé **~10 000 messages inter-instances par seconde sans aucune perte**, et est resté stable jusqu'à **huit instances** (14 000 distributions, sans perte). Vingt personnes déplaçant leur curseur à 60 fps génèrent environ 1 200 messages par seconde — soit environ un huitième de ce volume.

La limite à surveiller n'est pas la capacité, mais le fait que chaque notification est une requête sur votre base de données principale, entrant en concurrence avec les véritables requêtes de votre application. Le bus Postgres procède donc au **regroupement (coalescing)** des trames sortantes (voir ci-dessous), ce qui maintient ce coût proportionnel au temps écoulé plutôt qu'au nombre de messages.

Par client, le socket accepte jusqu'à **7 200 trames de canaux par minute** (120/s — 60 fps de diffusion de curseur plus la mise à jour de présence associée à chacune), comptabilisées séparément du budget partagé par les requêtes et les abonnements. Les trames au-delà sont refusées avec une erreur `RATE_LIMITED` plutôt que mises en file d'attente.

Le refus survient sur `channel.onError()`, et non sous la forme d'un `broadcast()` rejeté — voir [Lorsqu'une trame de canal est refusée](#when-a-channel-frame-is-refused).

Si vous dépassez encore cette limite après cela, limitez le débit (throttle) des événements de type curseur côté client (un état de type « last-write-wins » n'a pas besoin de 60 mises à jour par seconde), et envisagez de router les collaborateurs d'un même document vers la même instance — le routage persistant (sticky routing) réduit le trafic inter-instances à presque rien, quel que soit le nombre d'utilisateurs. Ce n'est qu'au-delà qu'un autre transport devient pertinent, et la solution réside alors dans un package de transport, et non dans un fork. Voir [Écrire votre propre transport](#writing-your-own-transport).

### Regroupement (Coalescing)

Les trames publiées pendant qu'une courte fenêtre est ouverte partent ensemble dans une seule notification. La fenêtre fonctionne sur **front montant (leading-edge)** : une trame arrivant lorsqu'aucune fenêtre n'est ouverte est envoyée immédiatement, de sorte qu'un canal inactif ne subit aucune latence supplémentaire et que seul un flux soutenu est mis en lot.

Mesuré sur deux instances, 3 000 diffusions, toutes distribuées dans chaque cas :

| Profil de trafic | Regroupement désactivé | Regroupement activé | Réduction |
|---|---|---|---|
| Rafale (aussi rapide que possible) | 3 000 requêtes | 68 requêtes | **44×** |
| Régulier (~500 msg/s, étalé) | 3 000 requêtes | 240 requêtes | **12,5×** |

Le cas en rafale s'est également terminé environ 11× plus rapidement en temps réel (wall-clock), car les allers-retours avec la base de données constituaient le goulot d'étranglement plutôt que le traitement lui-même.

La fenêtre est par défaut de 10 ms et n'est pas un paramètre sensible — 5 ms, 10 ms et 20 ms ont produit des nombres de requêtes identiques dans les deux profils, car un lot est limité par le plafond de charge utile de 8 Ko ou par la forme naturelle du trafic bien avant que le minuteur n'entre en jeu. Ne le modifiez que si vous avez une raison précise :

```typescript
realtime: {
    bus: { type: "postgres", batchWindowMs: 20 }   // 0 disables coalescing
}
```

Une remarque concernant le déploiement : un lot transite sous un format réseau différent d'une trame individuelle, et une instance exécutant une version plus ancienne ne le comprendra pas. Les trames individuelles sont toujours envoyées non encapsulées, de sorte qu'un déploiement progressif ne risque de perdre des trames que si le cluster est soumis à une charge soutenue *pendant* le redémarrage — et les canaux persistants (retained) se réparent de toute façon grâce au rejeu de l'historique.

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

Passez l'instance là où irait un nom intégré :

```typescript
database: createPostgresAdapter({
    connection: db,
    schema: { tables, enums, relations },
    realtime: { bus: new MyChannelBus(process.env.MY_TRANSPORT_URL!) }
})
```

**Ce que votre implémentation doit garantir :** `start()` rejette une promesse lorsque le transport est inutilisable ; `publish()` atteint toutes les autres instances ou rejette ; `stop()` est idempotent ; et un message malformé est ignoré et consigné dans les logs plutôt que de lever une exception, afin qu'une trame corrompue ne fasse pas planter le récepteur.

**Ce qu'elle n'a pas à garantir :** l'ordonnancement (les canaux persistants comportent `seq` et le SDK les ordonne grâce à lui), la durabilité (une trame perdue est une mise à jour en direct manquée, réparée par le rejeu d'historique du client) ou la distribution exactement une fois (« exactly-once » ; les trames persistantes sont dédupliquées par `seq` ; les diffs de présence sont idempotents).

`maxFrameBytes` permet au framework de savoir s'il doit envoyer un message persistant volumineux directement (inline) ou sous forme de pointeur. Renvoyez `Infinity` lorsque votre transport n'a pas de plafond significatif, afin que le chemin par pointeur ne soit jamais emprunté inutilement.

La distribution aux clients locaux n'est pas de votre ressort — le service temps réel gère les abonnés qui reçoivent une trame. Un transport se contente d'acheminer les trames d'une instance à l'autre.

### La limite de 8 Ko sur le bus Postgres

`pg_notify` refuse toute charge utile de 8000 octets ou plus. Les curseurs et la présence s'y intègrent largement ; un instantané de document, non. Rebase gère cela de la même manière qu'il gère les modifications d'entités volumineuses — en envoyant une adresse plutôt qu'un corps :

- **Sur un canal persistant (retained)** (voir [Rétention des canaux](#channel-retention)), le message est déjà stocké avec un numéro de séquence, de sorte que la notification ne contient que `(channel, seq)` et chaque instance réceptrice relit le corps. Il n'y a alors aucune limite de taille.
- **Sur un canal éphémère**, il n'y a rien vers quoi pointer. La diffusion est distribuée localement, l'émetteur reçoit une erreur `CHANNEL_BUS_PAYLOAD_TOO_LARGE` sur `channel.onError()`, et un avertissement mentionne le canal — évitant ainsi que le message n'atteigne silencieusement que la moitié du cluster.

Si vous diffusez des messages volumineux, attribuez une règle de rétention à ce canal. C'est tout ce qu'il y a à faire.

### La présence est un état partagé, pas seulement une diffusion

`presence_state` doit répondre à la question « qui est dans ce canal ? » pour l'ensemble du cluster, ce que la mémoire par instance ne peut pas faire. Lorsqu'un bus est actif, Rebase conserve la liste des présences dans `rebase.channel_presence` (créée automatiquement) et répond aux requêtes de présence à partir de celle-ci.

| Colonne       | Contenu                                        |
|---------------|------------------------------------------------|
| `channel`     | Nom du canal                                   |
| `client_id`   | Le client suivi                                |
| `instance_id` | L'instance backend à laquelle il est connecté  |
| `state`       | L'état de présence du client                   |
| `last_seen`   | Actualisé par le heartbeat de présence du SDK  |

Le SDK envoie un battement de cœur (heartbeat) de présence environ toutes les 20 secondes pour un délai d'expiration (timeout) de 30 secondes. Les lignes qui ne sont plus actualisées sont purgées, et les départs sont annoncés à chaque instance — ce qui fait également office de récupération après incident (crash recovery) : un pod qui s'arrête brutalement laisse des lignes qui ressemblent, après une fenêtre d'expiration, exactement à n'importe quel autre client devenu inactif. Un arrêt propre (graceful shutdown) supprime immédiatement ses propres lignes, évitant ainsi qu'un déploiement progressif n'affiche une fenêtre de clients fantômes.

:::caution[La connexion LISTEN doit contourner votre gestionnaire de pool]
`LISTEN` est un état de session, le bus Postgres a donc besoin d'une connexion directe — sans passer par pgBouncer ou tout autre gestionnaire de pool en mode transactionnel. Rebase utilise `DATABASE_DIRECT_URL` lorsqu'elle est définie ; derrière un pooler, faites-la pointer directement vers le service de base de données. Sans URL directe utilisable, le bus consigne un avertissement et reste en mode mémoire.
:::

## Étapes suivantes

- [Temps réel et WebSocket](/docs/backend/realtime/) — abonnements, canaux et présence sur une seule instance
- [Processus séparés](/docs/deployment/split-processes/) — la configuration de déploiement pour laquelle cela compte
- [Auto-hébergement](/docs/deployment/self-hosting/) — exécuter le runtime vous-même

---
