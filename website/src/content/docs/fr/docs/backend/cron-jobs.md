---
sourceHash: 9df2202ffe55b40c
title: Tâches Cron
sidebar_label: Tâches Cron
description: Planifiez des tâches d'arrière-plan récurrentes avec le système de tâches cron intégré de Rebase. Définissez les tâches comme des fichiers TypeScript, surveillez-les dans Studio et gérez-les via l'API REST.
---

## Aperçu

Rebase inclut un **planificateur de tâches cron** intégré pour l'exécution de tâches d'arrière-plan récurrentes — nettoyage de données, génération de rapports, vérifications de santé, synchronisations d'API externes, et plus encore.

Les tâches cron suivent le même modèle de **découverte basée sur les fichiers** que les fonctions personnalisées : déposez un fichier TypeScript dans votre répertoire `crons/`, et Rebase l'enregistre et le planifie automatiquement.

- **Zéro dépendance** — Aucune bibliothèque de planificateur externe requise
- **API d'administration** — Points de terminaison REST pour lister, déclencher, activer/désactiver et visualiser les journaux
- **Tableau de bord Studio** — Surveiller toutes les tâches, visualiser l'historique d'exécution et déclencher des exécutions manuellement
- **Persistance de la base de données** — Journaux d'exécution stockés dans PostgreSQL, survivant aux redémarrages
- **Cache en mémoire** — Buffer circulaire rapide (50 dernières exécutions) pour le tableau de bord, supporté par la BD

## Définir une tâche Cron

Créez un fichier dans votre répertoire `backend/crons/` qui exporte par défaut une `CronJobDefinition` :

```typescript
// backend/crons/health-check.ts
import type { CronJobDefinition } from "@rebasepro/types";

const job: CronJobDefinition = {
    schedule: "*/5 * * * *",     // every 5 minutes
    name: "System Health Check",
    description: "Monitors uptime and memory usage",

    async handler(ctx) {
        ctx.log("Running health check...");

        const uptime = process.uptime();
        const mem = process.memoryUsage();

        ctx.log(`Uptime: ${Math.round(uptime)}s`);
        ctx.log(`Heap: ${Math.round(mem.heapUsed / 1024 / 1024)}MB`);

        return {
            uptimeSeconds: Math.round(uptime),
            heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        };
    },
};

export default job;
```

Le **nom du fichier** (sans extension) devient l'ID unique de la tâche — par exemple, `health-check`.

## Configuration

Activez les tâches cron en ajoutant `cronsDir` à votre configuration de backend :

```typescript no-verify
const instance = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),
    cronsDir: path.resolve(__dirname, "../crons"),  // ← add this
});
```

C'est tout. Rebase va :

1. Analyser le répertoire pour les fichiers `.ts` / `.js`
2. Enregistrer chaque exportation par défaut comme une tâche cron
3. Créer automatiquement la table `rebase.cron_logs` dans PostgreSQL (si le pilote supporte SQL)
4. Démarrer le planificateur et initialiser les compteurs à partir des journaux de BD existants
5. Monter les routes REST d'administration à `/api/admin/cron`

## Syntaxe de planification

Les expressions cron utilisent le **format standard à 5 champs** :

```
┌───────────── minute (0–59)
│ ┌─────────── hour (0–23)
│ │ ┌───────── day of month (1–31)
│ │ │ ┌─────── month (1–12)
│ │ │ │ ┌───── day of week (0–6, Sunday = 0)
│ │ │ │ │
* * * * *
```

| Expression | Signification |
|------------|---------|
| `* * * * *` | Chaque minute |
| `0 * * * *` | Chaque heure |
| `0 3 * * *` | Tous les jours à 3h00 du matin |
| `0 0 * * 1` | Tous les lundis à minuit |
| `0 9 1 * *` | Premier jour de chaque mois à 9h00 du matin |
| `0,30 * * * *` | Toutes les 30 minutes (aux :00 et :30) |
| `0 9-17 * * 1-5` | Toutes les heures, de 9h à 17h, uniquement les jours de semaine |

Les valeurs de pas (`*/n`), les plages (`a-b`) et les listes (`a,b,c`) sont toutes supportées.

## Référence de CronJobDefinition

`timezone` est nouveau <span class="since-badge" data-since="0.18">Since 0.18</span> — en 0.17.3, un planning est toujours lu dans le
fuseau de l'hôte. Tout le reste de cette interface est déjà livré.

```typescript
interface CronJobDefinition {
    // Cron schedule expression (5-field format)
    schedule: string;

    // Human-readable name shown in Studio
    name: string;

    // Optional description shown in Studio
    description?: string;

    // Whether the job starts enabled (default: true)
    enabled?: boolean;

    // Max execution time in seconds (default: 300)
    timeoutSeconds?: number;

    // The function to run on each tick
    handler: (ctx: CronJobContext) => Promise<unknown> | unknown;
}
```

## Contexte du gestionnaire

Chaque gestionnaire reçoit un `CronJobContext` :

```typescript
interface CronJobContext {
    // The job's unique ID (derived from filename)
    jobId: string;

    // The scheduled tick timestamp
    scheduledAt: Date;

    // Logger — captured lines appear in Studio and the logs API
    log: (...args: unknown[]) => void;
}
```

Utilisez `ctx.log()` pour émettre une sortie structurée. Ces lignes sont capturées dans le journal d'exécution et visibles dans Studio et via l'API REST.

:::tip
Le gestionnaire peut retourner toute valeur sérialisable en JSON. Elle sera stockée dans l'entrée de journal comme `result` et affichée dans l'historique d'exécution de Studio.
:::

## API REST

Toutes les routes cron nécessitent une **authentification administrateur** (`requireAuth` + `requireAdmin`).

| Méthode | Chemin | Description |
|--------|------|-------------|
| `GET` | `/api/admin/cron` | Lister toutes les tâches cron enregistrées |
| `GET` | `/api/admin/cron/:id` | Obtenir le statut d'une tâche unique |
| `POST` | `/api/admin/cron/:id/trigger` | Déclencher manuellement une tâche |
| `GET` | `/api/admin/cron/:id/logs` | Obtenir l'historique d'exécution (`?limit=N`) |
| `PUT` | `/api/admin/cron/:id` | Activer/désactiver une tâche (`{ "enabled": true }`) |

### Exemple : Lister toutes les tâches

`$TOKEN` est un jeton d'accès administrateur : connectez-vous et utilisez l'`accessToken` renvoyé par la réponse de connexion. `$API_URL` est l'URL affichée par `rebase dev` — le port est dérivé du projet et n'est pas fixe.

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

### Exemple : Déclencher une tâche manuellement

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
    "$API_URL/api/admin/cron/health-check/trigger"
```

## SDK Client

Le SDK client Rebase expose un espace de noms `cron` pour toutes les opérations :

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: import.meta.env.VITE_API_URL });

// Lister toutes les tâches
const { jobs } = await client.cron.listJobs();

// Obtenir une tâche unique
const { job } = await client.cron.getJob("health-check");

// Déclencher manuellement
const { log, job: updated } = await client.cron.triggerJob("health-check");

// Voir l'historique d'exécution
const { logs } = await client.cron.getJobLogs("health-check", { limit: 10 });

// Activer ou désactiver
await client.cron.toggleJob("health-check", false); // pause
await client.cron.toggleJob("health-check", true);  // reprendre
```

## Tableau de bord Studio

Lorsque les tâches cron sont configurées, un outil **Tâches Cron** apparaît dans Rebase Studio sous la section **Automatisation**. Le tableau de bord offre :

- **Liste des tâches** — Toutes les tâches enregistrées avec des indicateurs de statut en direct
- **Panneau de détails** — Planification, prochaine/dernière exécution, durée et informations d'erreur
- **Historique d'exécution** — Entrées de journal extensibles avec sortie capturée et résultats
- **Déclenchement manuel** — Exécuter n'importe quelle tâche à la demande en un seul clic
- **Activer/désactiver** — Mettre en pause et reprendre des tâches sans redémarrer le serveur

Le tableau de bord se rafraîchit automatiquement toutes les 15 secondes.

## Persistance

Lorsque le pilote de base de données prend en charge SQL (par exemple, PostgreSQL), les journaux d'exécution sont **automatiquement persistés** dans une table `rebase.cron_logs`. Cela signifie :

- L'historique d'exécution **survit aux redémarrages** du serveur et aux déploiements
- Les compteurs `totalRuns` et `totalFailures` sont **initialisés à partir de la base de données** au démarrage
- Le point de terminaison `/api/admin/cron/:id/logs` interroge la base de données, pas seulement la mémoire
- Plusieurs instances de serveur partagent le même historique d'exécution

La table est créée automatiquement lors du premier démarrage — aucune migration n'est nécessaire.

:::tip
La persistance est non bloquante. Si une écriture dans la base de données échoue, le planificateur continue de fonctionner et le tampon de journaux en mémoire est toujours disponible comme solution de repli.
:::

## Gestion des erreurs et délais d'attente

- Si un gestionnaire **lève une erreur**, l'erreur est capturée dans l'entrée du journal et l'état de la tâche est défini sur `"error"`. Le planificateur continue de fonctionner — le prochain déclenchement planifié aura toujours lieu.
- Si un gestionnaire dépasse `timeoutSeconds` (par défaut : 300), il est terminé avec une erreur de dépassement de délai.
- Toutes les métriques d'exécution (nombre de succès, nombre d'échecs, dernière erreur) sont suivies par tâche et accessibles via l'API.
- Les échecs d'écriture persistante sont journalisés mais ne font jamais planter le planificateur.

## Exemple : Tâche de nettoyage quotidien

```typescript
// backend/crons/cleanup-sessions.ts
import type { CronJobDefinition } from "@rebasepro/types";
import { rebase } from "@rebasepro/server";

const job: CronJobDefinition = {
    schedule: "0 3 * * *",  // daily at 3 AM
    name: "Cleanup Expired Sessions",
    description: "Removes user sessions older than 30 days",

    async handler(ctx) {
        ctx.log("Starting session cleanup...");

        // Use the rebase singleton for admin-level database access
        const count = Math.floor(Math.random() * 50); // placeholder

        ctx.log(`Cleaned up ${count} expired sessions`);

        return { deletedSessions: count };
    },
};

export default job;
```

## Prochaines étapes

- **[Aperçu du backend](/docs/backend)** — Référence complète de la configuration du backend
- **[Callbacks d'entité](/docs/collections/callbacks)** — Exécuter une logique sur les changements de données
- **[Intégration de Webhooks](/docs/recipes/webhooks)** — Envoyer des notifications sur les événements

---
