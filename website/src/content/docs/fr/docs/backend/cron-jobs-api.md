---
sourceHash: 9057ef27ebe60995
title: "API des tâches cron"
sidebar_label: "API des tâches cron"
---

## API REST

La lecture exige la portée `cron:read`. Déclencher, mettre en pause et reprendre exigent
`cron:write`. Un administrateur détient les deux. Une personne dont le rôle les déclare aussi, ainsi
qu'une clé API créée avec elles, ce que devrait porter un planificateur externe :

```bash
rebase api-keys create -n "Scheduler" --scopes cron:read,cron:write
```

Voir [Rôles et portées](/docs/backend/roles-and-scopes/).

| Méthode | Chemin | Description |
|---------|--------|-------------|
| `GET` | `/api/admin/cron` | Lister toutes les tâches cron enregistrées |
| `GET` | `/api/admin/cron/:id` | Obtenir le statut d'une tâche individuelle |
| `POST` | `/api/admin/cron/:id/trigger` | Déclencher manuellement une tâche — `409` tant qu'elle est déjà en cours |
| `GET` | `/api/admin/cron/:id/logs` | Obtenir l'historique d'exécution (`?limit=N`), sur les 30 derniers jours. `503` lorsque `rebase.cron_logs` ne peut pas être lu, plutôt qu'un historique vide |
| `PUT` | `/api/admin/cron/:id` | Mettre en pause ou reprendre une tâche partout (`{ "enabled": false }`) ; `null` suit de nouveau le code |

### Exemple : Lister toutes les tâches

`$TOKEN` est un jeton d'accès pour un compte qui détient `cron:read` : connectez-vous et utilisez
l'`accessToken` renvoyé par la réponse de connexion. Une clé API qui détient cette portée fonctionne
de la même façon. `$API_URL` correspond à ce que `rebase dev` a affiché — le port étant dérivé
du chemin du projet, il n'y a pas de port fixe.

```bash
curl -H "Authorization: Bearer $TOKEN" "$API_URL/api/admin/cron"
```

```json
{
    "jobs": [
        {
            "id": "health-check",
            "name": "System Health Check",
            "schedule": "*/5 * * * *",
            "enabled": true,
            "state": "idle",
            "totalRuns": 12,
            "totalFailures": 0,
            "lastRunAt": "2026-04-24T08:15:00.000Z",
            "nextRunAt": "2026-04-24T08:20:00.000Z",
            "lastDurationMs": 3
        }
    ]
}
```

### Les tâches introuvables

Une tâche qui ne se déclenche jamais ne figure pas dans `jobs` — rien ne l'a enregistrée — ainsi « ma tâche cron est
manquante » et « ma tâche cron ne s'exécutera jamais » apparaissent identiques depuis ce point de terminaison, à moins qu'il
n'indique le contraire. Et c'est ce qu'il fait :

```json
{
    "jobs": [],
    "skipped": 2,
    "rejected": [
        {
            "id": "nightly-report",
            "name": "Nightly report",
            "schedule": "0 0 3 * * *",
            "reason": "Expected 5 fields, got 6"
        }
    ],
    "note": "1 cron file(s) failed to load and 1 job(s) were refused — NOT scheduled. See `rejected` for the reason; the server log has the rest."
}
```

`rejected` indique le nom de la tâche et la raison. Un fichier qui a échoué au *chargement* n'a qu'un
compteur : l'échec s'est produit avant qu'il n'y ait une tâche à nommer, la raison se trouve donc dans
les journaux du serveur.

L'entrée la plus fréquente ici est celle ci-dessus — six champs, issus d'une expression
copiée depuis un outil qui prend en charge les secondes. Rebase en accepte cinq ; supprimez le premier
champ. Un `timeoutSeconds` égal à zéro, négatif ou `NaN` y figure aussi.

### Exemple : Déclencher une tâche manuellement

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
    "$API_URL/api/admin/cron/health-check/trigger"
```

Tant que la tâche s'exécute — ici ou dans n'importe quel autre processus —, la
réponse est `409` avec le code `CRON_JOB_ALREADY_EXECUTING` ; voir
[Gestion de la concurrence](/docs/backend/cron-across-instances/#concurrency-guarding).

### Mettre une tâche en pause

Une pause depuis Studio ou via
`PUT /api/admin/cron/:id` s'applique à tous les processus et reste en place après
les redémarrages et les redéploiements ; `{ "enabled": null }` rend la tâche au
`enabled` que déclare son fichier. Comment chaque réplique la lit, et ce qui se
passe quand l'une d'elles ne le peut pas, est décrit dans
[Cron entre plusieurs instances](/docs/backend/cron-across-instances/#pausing-a-job-across-every-process).

## SDK typé

Le SDK typé de Rebase expose un espace de noms `cron` pour toutes les opérations :

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: import.meta.env.VITE_API_URL });

// List all jobs, and the ones that did not register
const { jobs, rejected } = await client.cron.listJobs();

// Get a single job
const { job } = await client.cron.getJob("health-check");

// Trigger manually
const { log, job: updated } = await client.cron.triggerJob("health-check");

// View execution history
const { logs } = await client.cron.getJobLogs("health-check", { limit: 10 });

// Enable or disable
await client.cron.toggleJob("health-check", false); // pause
await client.cron.toggleJob("health-check", true);  // resume
```

`triggerJob()` attend la fin de l'exécution et répond avec son journal. Un proxy placé devant le
serveur peut couper la réponse d'une tâche longue (beaucoup s'arrêtent à 60 secondes) alors que
l'exécution se poursuit. Lisez alors son résultat via `getJobLogs()`.

`listJobs()` est typé `CronJobListing` : `jobs`, plus les champs `skipped`,
`rejected` et `note` décrits sous [Les tâches introuvables](#les-tâches-introuvables).
