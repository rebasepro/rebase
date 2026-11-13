---
sourceHash: 9e21b0515cf58869
title: Tâches en arrière-plan
sidebar_label: Tâches en arrière-plan
description: Une file d'attente de tâches durable basée sur Postgres — des traitements qui survivent à un redémarrage, réessayés avec backoff, avec conservation des échecs plutôt que leur abandon.
---

## Vue d'ensemble

Une tâche est une ligne dans `rebase.jobs`. Elle est réservée par exactement un worker, réessayée avec un délai croissant si son gestionnaire lève une exception, et conservée dans la table lorsqu'elle abandonne définitivement afin que quelqu'un puisse l'examiner.

Il n'y a rien à installer et rien à exécuter en parallèle de Postgres. Une tâche mise en file d'attente au sein d'une transaction qui fait l'objet d'un rollback n'a jamais été mise en file d'attente.

Utilisez-le pour les tâches qui ne doivent pas être perdues et ne doivent pas s'exécuter au sein d'une requête : envoi d'e-mails, appel à un tiers, génération d'un fichier, réconciliation avec un système externe.

| | Exécution | Survit à un redémarrage |
|---|---|---|
| [Cron](/docs/backend/cron-jobs) | Selon un calendrier | Oui — la planification est dans le code |
| **Tâches** | Une seule fois, dès qu'un worker est libre | **Oui — la tâche est une ligne** |
| Un `setTimeout` dans un callback | Une fois, dans ce processus | Non |

## Activation

:::note[Emplacement de cette configuration]
**Runtime managé** — nulle part. `jobs` prend des *fonctions* de gestionnaires, ce qu'aucune variable d'environnement ni aucun export de `backend/storage.ts` ou `backend/hooks.ts` ne peut véhiculer, de sorte qu'un projet généré par scaffolding ne peut pas activer la file d'attente. Exécutez `rebase eject` (ou écrivez un [serveur personnalisé](/docs/backend/custom-server/)) pour y accéder. `REBASE_JOB_WORKERS` dans `.env` détermine uniquement si les workers d'une file d'attente déjà activée s'exécutent dans *ce* processus.

**Éjecté** — le bloc `jobs` sur `initializeRebaseBackend({ … })`, comme ci-dessous.

La vue d'ensemble complète se trouve dans [Vue d'ensemble du backend](/docs/backend/#where-each-option-lives).
:::

```typescript no-verify
await initializeRebaseBackend({
    jobs: {
        enabled: true,
        tasks: {
            "send-welcome": async ({ payload }) => {
                await sendEmail((payload as { email: string }).email);
            }
        }
    }
});
```

Désactivé sauf si vous le demandez : un worker continue de chercher du travail tant que le processus est actif, ce qui n'est pas un comportement par défaut souhaité sans configuration explicite. Il nécessite un pilote capable d'exécuter du SQL — sur un pilote qui ne le peut pas, la file d'attente n'est pas disponible et vous en êtes informé au démarrage plutôt qu'à la première mise en file d'attente.

Un worker inactif ne fait pas de scrutation (polling) toutes les deux secondes. Chaque mise en file d'attente envoie un `NOTIFY` sur le canal `rebase_jobs` lors de son commit, et un worker maintenant un `LISTEN` dessus la réserve immédiatement — une tâche mise en file d'attente par un autre processus (le rôle `api`, un autre réplica) démarre en quelques millisecondes, et une tâche différée dès son échéance. En arrière-plan, il effectue de toute façon une vérification toutes les 30 secondes. Une tâche mise en file d'attente par ce processus, une nouvelle tentative qu'il a planifiée et une tâche qu'il a récupérée le réveillent sans notification.

Le `LISTEN` a besoin de sa propre connexion, trouvée de la même manière que pour le temps réel : `DATABASE_DIRECT_URL` s'il est défini, sinon `DATABASE_URL`. Derrière un pooler en mode transaction comme PgBouncer, définissez `DATABASE_DIRECT_URL` : un pooler ne maintient pas de `LISTEN`, et les tâches provenant d'autres processus devraient alors attendre la vérification des 30 secondes. Lorsqu'il n'y a aucune connexion de ce type (la base de données de développement intégrée au processus), un worker inactif applique plutôt un backoff : il vérifie après `pollIntervalMs` (2 secondes), puis deux fois plus longtemps après chaque vérification infructueuse, jusqu'à 30 secondes, et recommence dès qu'il trouve du travail. Un worker inactif effectue environ 2 900 tentatives de réservation par jour au lieu de 43 200.

## Mise en file d'attente

```typescript no-verify
const { jobQueue } = await initializeRebaseBackend({ jobs: { enabled: true, tasks } });

await jobQueue?.enqueue("send-welcome", { email: "ada@example.com" });
```

### Options

```typescript no-verify
await jobQueue?.enqueue("send-digest", { userId: "u7" }, {
    delayMs: 60_000,               // not before a minute from now
    maxAttempts: 5,                // default 3
    idempotencyKey: "digest:u7"    // at most one *unfinished* job with this key
});
```

`idempotencyKey` regroupe un double-clic, une requête réessayée et deux instances réagissant au même événement en une seule tâche. Sa portée est limitée aux travaux non terminés, de sorte que la clé redevient réutilisable une fois la tâche terminée — sinon « le récapitulatif nocturne pour l'utilisateur 7 » ne pourrait être envoyé qu'une seule fois dans toute l'histoire. Une mise en file d'attente en doublon renvoie `null` plutôt que de lever une exception : le travail demandé est bien dans la file d'attente, ce qui correspond au résultat souhaité.

## Gestion des échecs

Un gestionnaire échoue en levant une exception. Il n'y a pas de `return false` — un booléen serait ignoré silencieusement par chaque gestionnaire qui oublierait d'en retourner un, et l'échec doit être le comportement par défaut en cas d'erreur.

- **Tentatives restantes** → retour à l'état `pending`, avec `run_at` repoussé par le backoff (1s, 5s, 25s… plafonné à une heure ; surchargeable avec `backoff`).
- **Plus de tentatives** → `failed`, et la ligne *reste*. Une file d'attente qui supprime silencieusement ce qu'elle n'a pas pu traiter ne peut être distinguée d'une file d'attente qui n'a rien à faire.
- **Un échec qu'aucune nouvelle tentative ne peut corriger** → levez `PermanentJobError`, issu de `@rebasepro/server` : la tâche passe à `failed` dès cette tentative, avec le message renseigné dans son `last_error`, au lieu d'épuiser inutilement ses tentatives restantes.

```sql
SELECT task, attempts, last_error, updated_at
FROM rebase.jobs WHERE status = 'failed'
ORDER BY updated_at DESC;
```

Les lignes en échec sont conservées 30 jours ; celles ayant réussi, 3 jours. Chaque worker supprime les lignes expirées lors de son démarrage puis toutes les heures, par lots, en dehors du chemin critique des requêtes.

## Que se passe-t-il lorsqu'un worker meurt

Un processus interrompu en pleine tâche ne peut pas libérer sa réservation, de sorte que seul un délai d'expiration (timeout) permettra de libérer la ligne. Pendant qu'un gestionnaire s'exécute, son worker renouvelle la réservation tous les tiers de `visibilityTimeoutMs` (par défaut 5 minutes). Une réservation qui dure depuis aussi longtemps sans être renouvelée est réclamée de nouveau — retour à `pending` s'il reste des tentatives pour la tâche, ou envoyée en dead-letter avec une erreur indiquant ce qui s'est produit.

Ainsi, un gestionnaire lent sur un worker actif conserve sa tâche, peu importe le temps nécessaire, et le timeout détermine uniquement la rapidité avec laquelle les tâches d'un worker mort sont remises en jeu. Une tentative qui a perdu sa réservation ne peut pas non plus écraser le résultat de la tâche : son succès ou son échec est consigné dans les logs et ignoré, et seule la tentative qui détient la réservation tranche.

```typescript no-verify
jobs: {
    enabled: true,
    concurrency: 5,              // jobs at once, per instance
    pollIntervalMs: 2_000,       // the first wait after a look that found nothing; it doubles up to 30 s
    visibilityTimeoutMs: 300_000 // how long an unrenewed claim holds
}
```

### Un gestionnaire qui ne se termine jamais

Le revers de la médaille : un gestionnaire qui attend un `fetch` sans réponse monopolise son emplacement de worker et sa réservation tant que le processus vit — avec cinq blocages de ce type, le worker n'exécute plus rien d'autre, alors que `/health` reste au vert.
`timeoutMs` limite la durée d'une tentative. À l'échéance, la tentative échoue — réessayée tant qu'il reste des tentatives, comme pour toute exception — son emplacement est libéré et le `signal` du gestionnaire est annulé. Transmettez ce signal pour que le traitement s'interrompe également ; un gestionnaire qui l'ignore continuera de s'exécuter en arrière-plan sans que rien n'enregistre son résultat.

S'il est omis, la valeur par défaut est de 15 minutes (`900_000`), et le worker le signale dans une ligne de log au démarrage. Une tâche qui s'exécute légitimement plus longtemps peut définir sa propre valeur, et `timeoutMs: 0` supprime la limite.

```typescript no-verify
jobs: {
    enabled: true,
    timeoutMs: 120_000,          // one attempt; 15 minutes when left out, 0 for no limit
    tasks: {
        "sync-crm": async ({ payload, signal }) => {
            await fetch(crmUrl, { method: "POST", body: JSON.stringify(payload), signal });
        }
    }
}
```

Les gestionnaires de files d'attente et les abonnements aux topics reçoivent le même `signal` dans leur contexte.

## Plusieurs instances

Sûr par conception. Les workers effectuent leurs réservations avec `SELECT … FOR UPDATE SKIP LOCKED`, de sorte que chaque tâche est attribuée à exactement l'un d'eux tandis que les autres passent à la ligne suivante au lieu de faire la queue derrière elle. Aucune élection de leader n'est nécessaire.

Une instance ne réserve que les tâches pour lesquelles elle dispose d'un gestionnaire. Lors d'un déploiement progressif (rolling deploy), une instance exécutant l'ancien code ne touche pas aux tâches dont le traitement n'est implémenté que par le nouveau code : elles restent `pending`, leurs compteurs de tentatives intacts, jusqu'à ce qu'un pair mis à jour les réserve. Une tâche qu'aucune instance n'implémente reste également `pending`, plutôt que d'être envoyée en dead-letter.

## Scans des orphelins de stockage

`rebase storage orphans` s'exécute sur cette file d'attente lorsqu'elle est activée : chaque scan, et chaque suppression issue d'un scan, est une tâche `storage.orphans`, avec une seule tentative. Le backend enregistre lui-même le gestionnaire, dans chaque processus où le stockage est configuré, et seuls les processus dont les workers de tâches sont activés l'exécutent. Un scan est soumis à `timeoutMs` comme n'importe quelle tâche ; par conséquent, une source trop volumineuse pour être analysée en 15 minutes nécessite un `timeoutMs` plus élevé, ou 0. Sans la file d'attente, le serveur exécute le scan au sein de son propre processus. Voir [la CLI](/docs/cli/#rebase-storage).

## Webhooks durables

[`WebhookDispatcher`](/docs/recipes/webhooks) met par défaut ses envois en file d'attente en mémoire, ce qui signifie qu'un plantage ou un déploiement survenant entre la modification et l'envoi entraîne la perte de l'événement. Associez-lui la file d'attente et chaque livraison devient une ligne dans la base :

```typescript no-verify
import { WebhookDispatcher, WEBHOOK_DELIVERY_TASK } from "@rebasepro/server";

const { jobQueue } = await initializeRebaseBackend({ jobs: { enabled: true } });

const dispatcher = new WebhookDispatcher({ jobQueue });
dispatcher.setWebhooks(myWebhooks);

jobQueue?.register(WEBHOOK_DELIVERY_TASK, ctx => dispatcher.deliverQueuedJob(ctx.payload as never, ctx));
```

Seul l'**identifiant** du webhook est stocké sur la tâche, jamais le webhook lui-même — son secret de signature se trouverait sinon en clair dans `rebase.jobs` tant que la durée de rétention conserve la ligne, et un webhook modifié entre la mise en file d'attente et l'envoi doit être expédié dans son état actuel. Passer `ctx` comme second argument permet à chaque tentative d'envoyer son propre `X-Webhook-Attempt` ; toutes les tentatives d'un même envoi transmettent le même `X-Webhook-Delivery`, permettant au récepteur de dédupliquer les relances.

Un envoi que le dispatcher refuse d'expédier (une destination loopback, link-local, privée ou non-`http(s)`), ou auquel le récepteur répond par une redirection, échouera de la même manière à chaque fois. Il est placé en dead-letter après une seule tentative, avec la cause indiquée dans `last_error`. Tout autre échec fait l'objet de nouvelles tentatives comme n'importe quelle tâche.

## Arrêt

`shutdown()` empêche le worker de réserver de nouvelles tâches et attend la fin de celles en cours de traitement, afin qu'un déploiement n'exécute pas deux fois la fin d'un lot. L'attente est plafonnée aux deux tiers du délai d'expiration de l'arrêt (10 secondes sur les 15 par défaut), de sorte qu'un gestionnaire qui ne se termine jamais ne puisse pas bloquer l'arrêt. Une tâche toujours en cours après ce délai conserve sa réservation et est récupérée par le timeout de visibilité.

## Prochaines étapes

- **[Tâches Cron](/docs/backend/cron-jobs)** — planifier des tâches régulières
- **[Webhooks](/docs/recipes/webhooks)** — notifier d'autres systèmes lors d'un changement
