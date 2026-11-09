---
sourceHash: 137350d3f13ed7f5
title: Tâches d'arrière-plan
sidebar_label: Tâches d'arrière-plan
description: "Exécuter du travail après la réponse d'une fonction personnalisée : waitUntil, ce que l'hôte en fait à l'arrêt, et ce qui est perdu sans lui."
---

Le travail qui doit survivre à la réponse s'effectue dans `waitUntil` :

```typescript
import { defineFunction, requireAuth, waitUntil } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.post("/orders", requireAuth, async (c) => {
        const order = await c.req.json();
        // The caller does not wait for this, but shutdown does.
        waitUntil(c, rebase.email.send({
            to: "warehouse@example.com",
            subject: "New order",
            html: "<p>Pick and pack</p>"
        }));
        return c.json({ received: true });
    });
});
```

Une promesse sans `await` semble équivalente mais ne l'est pas. `waitUntil` apporte deux avantages :

- **Sur Node**, la promesse est suivie, de sorte qu'un arrêt propre (graceful shutdown) l'attend au lieu que le processus ne se termine brutalement au milieu de l'envoi d'un webhook. Une promesse flottante lors d'un `SIGTERM` est tout simplement perdue.
- **Sur un hébergeur basé sur des isolats (isolates)**, l'hébergeur est invité à maintenir l'isolat actif jusqu'à ce que la promesse soit résolue. Sans cela, le travail est interrompu dès que la réponse est résolue — silencieusement, avec un code 200 impeccable dans les logs.

Un rejet est consigné dans les logs plutôt que d'être laissé au gestionnaire d'erreurs non interceptées, ce qui permet à l'échec de mentionner la route dont il provient.

Le code qui s'exécute en dehors de toute requête n'a pas de `c` à transmettre : un initialiseur au niveau du module, un helper partagé entre routes et crons, ou du travail qu'une exécution de cron démarre sans l'attendre. Passez uniquement le travail à `waitUntil` :

```typescript no-verify
import { waitUntil } from "@rebasepro/server/functions";

let ready: Promise<void> | undefined;

export function ensureCatalogue(): Promise<void> {
    ready ??= loadCatalogue().then(() => {
        // No request to attach it to, but shutdown still waits for it.
        waitUntil(rateNewSongs());
    });
    return ready;
}
```

Le travail est suivi pour un arrêt propre et les rejets sont journalisés, comme avec `c`. Ce qu'il ne peut pas faire, c'est maintenir un isolat en vie, car celui-ci dépend du contexte d'exécution de la requête : transmettez `c` dès qu'une requête existe. Le travail qu'une exécution de tâche cron, un job ou un gestionnaire de file d'attente peut simplement attendre avec `await` devrait être attendu à la place ; c'est cette exécution que l'arrêt attend, et son résultat est enregistré avec elle.

L'arrêt attend au maximum 5 secondes pour ce travail. Le travail qui prend plusieurs minutes a sa place dans une [tâche cron](/docs/backend/cron-jobs/) ou un [job](/docs/backend/jobs/), qui sont journalisés et redémarrables. Une tâche cron s'exécute également [une seule fois à la fois sur l'ensemble des instances](/docs/backend/cron-across-instances/#concurrency-guarding), qu'elle ait été démarrée par la planification ou par un déclencheur manuel.
