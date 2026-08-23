---
title: Tâches en arrière-plan
sidebar_label: Tâches en arrière-plan
description: Une file d'attente de tâches durable, basée sur Postgres — des traitements qui survivent à un redémarrage, réessayés avec un backoff, avec conservation des échecs plutôt que leur abandon.
---

## Vue d'ensemble

Un job est une ligne dans `rebase.jobs`. Il est réservé par exactement un worker, réessayé avec un délai croissant si son gestionnaire lève une exception, et conservé dans la table lorsqu'il abandonne finalement afin que quelqu'un puisse l'examiner.

Il n'y a rien à installer et rien à exécuter aux côtés de Postgres. Un job mis en file d'attente au sein d'une transaction qui subit un rollback n'a jamais été mis en file d'attente.

Utilisez-le pour les tâches qui ne doivent pas être perdues et ne doivent pas se dérouler au cours d'une requête : envoi d'e-mails, appel à un service tiers, génération de fichiers, réconciliation avec un système externe.

| | Exécution | Survit à un redémarrage |
|---|---|---|
| [Cron](/docs/backend/cron-jobs) | Selon un calendrier | Oui — le calendrier est dans le code |
| **Jobs** | Une fois, dès qu'un worker est libre | **Oui — le job est une ligne** |
| Un `setTimeout` dans un callback | Une fois, dans ce processus | Non |

## Activation

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

Désactivé par défaut : un worker interroge la base de données en permanence (polling), ce qui n'est pas un comportement par défaut souhaité. Il nécessite un pilote capable d'exécuter du SQL — sur un pilote qui ne le peut pas (MongoDB), la file d'attente est indisponible et vous en êtes informé au démarrage plutôt qu'à la première mise en file d'attente.

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

`idempotencyKey` fusionne un double-clic, une requête réessayée et deux instances réagissant au même événement en un seul job. Sa portée est limitée aux tâches non terminées, de sorte que la clé redevient réutilisable une fois le job terminé — sans quoi « le récapitulatif nocturne pour l'utilisateur 7 » ne pourrait être envoyé qu'une seule fois dans l'absolu. Une mise en file d'attente en doublon renvoie `null` au lieu de lever une exception : la tâche demandée est bien en file d'attente, ce qui correspond au résultat souhaité.

## Échecs

Un gestionnaire échoue en levant une exception. Il n'y a pas de `return false` — un booléen serait ignoré silencieusement par chaque gestionnaire ayant oublié d'en renvoyer un, et l'échec doit être le comportement par défaut.

- **Tentatives restantes** → retour à `pending`, avec `run_at` repoussé par le backoff (1s, 5s, 25s … plafonné à une heure ; surchargeable avec `backoff`).
- **Plus de tentatives** → `failed`, et la ligne *reste*. Une file d'attente qui supprime silencieusement ce qu'elle n'a pas pu traiter est indiscernable d'une file sans aucune tâche à accomplir.

```sql
SELECT task, attempts, last_error, updated_at
FROM rebase.jobs WHERE status = 'failed'
ORDER BY updated_at DESC;
```

Les lignes en échec sont conservées 30 jours ; celles ayant réussi, 3 jours.

## Que se passe-t-il lorsqu'un worker s'arrête brutalement

Un processus interrompu en plein traitement ne peut pas libérer sa réservation ; seul un timeout permettra donc de débloquer la ligne. Les jobs réservés depuis plus longtemps que `visibilityTimeoutMs` (5 minutes par défaut) sont récupérés — retour à `pending` s'il leur reste des tentatives, sinon envoyés en rebut (dead-letter) avec une erreur explicitant ce qui s'est produit.

C'est aussi pourquoi le timeout doit dépasser la durée de votre gestionnaire le plus lent : au-delà, un deuxième worker pourrait démarrer un job que le premier est encore en train d'exécuter.

```typescript no-verify
jobs: {
    enabled: true,
    concurrency: 5,              // jobs at once, per instance
    pollIntervalMs: 2_000,       // when the last look found nothing
    visibilityTimeoutMs: 300_000 // must exceed the slowest handler
}
```

## Plusieurs instances

Sûr par conception. Les workers effectuent leur réservation avec `SELECT … FOR UPDATE SKIP LOCKED`, de sorte que chaque job est attribué à exactement l'un d'entre eux et que les autres passent à la ligne suivante plutôt que d'attendre derrière lui. Nul besoin d'élire un leader.

Lors d'un déploiement progressif (rolling deploy), une instance exécutant une ancienne version du code peut recevoir des jobs dont elle n'implémente pas la tâche. Ceux-ci sont replacés dans la file d'attente plutôt que marqués en échec, afin qu'ils s'exécutent dès qu'une instance mise à jour les prend en charge.

## Webhooks durables

Par défaut, [`WebhookDispatcher`](/docs/recipes/webhooks) met en file d'attente ses envois en mémoire, ce qui signifie qu'un crash ou un déploiement entre la modification et l'envoi entraîne la perte de l'événement. Confiez-lui la file d'attente et chaque envoi devient une ligne :

```typescript no-verify
import { WebhookDispatcher, WEBHOOK_DELIVERY_TASK } from "@rebasepro/server";

const { jobQueue } = await initializeRebaseBackend({ jobs: { enabled: true } });

const dispatcher = new WebhookDispatcher({ jobQueue });
dispatcher.setWebhooks(myWebhooks);

jobQueue?.register(WEBHOOK_DELIVERY_TASK, ctx => dispatcher.deliverQueuedJob(ctx.payload as never));
```

Seul l'**identifiant** du webhook est stocké dans le job, jamais le webhook lui-même — son secret de signature se trouverait sinon en clair dans `rebase.jobs` pendant toute la durée de rétention de la ligne, et un webhook modifié entre la mise en file d'attente et l'envoi doit être transmis avec sa configuration actuelle.

## Arrêt

`shutdown()` empêche le worker de réserver de nouveaux jobs et attend la fin de ceux en cours de traitement, évitant ainsi qu'un déploiement n'exécute deux fois la fin d'un lot. Tout ce qui est encore en cours d'exécution au moment où le processus s'arrête conserve sa réservation et est récupéré par le timeout de visibilité.

## Prochaines étapes

- **[Cron Jobs](/docs/backend/cron-jobs)** — planifier des tâches régulières
- **[Webhooks](/docs/recipes/webhooks)** — notifier d'autres systèmes lors d'une modification

---
