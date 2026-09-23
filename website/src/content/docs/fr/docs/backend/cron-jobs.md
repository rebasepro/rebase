---
sourceHash: 63794b5b1f8c0af6
title: Tâches Cron
sidebar_label: Tâches Cron
description: Planifiez des tâches d'arrière-plan récurrentes grâce au système intégré de tâches cron de Rebase. Définissez des tâches sous forme de fichiers TypeScript, surveillez-les dans Studio et gérez-les via l'API REST.
---

## Vue d'ensemble

Rebase inclut un **planificateur de tâches cron intégré** pour exécuter des tâches d'arrière-plan récurrentes : nettoyage de données, génération de rapports, vérifications de santé (health checks), synchronisations avec des API externes, et bien plus encore.

Les tâches cron suivent le même modèle de **découverte basée sur les fichiers** que les fonctions personnalisées : déposez un fichier TypeScript dans votre répertoire `crons/`, et Rebase l'enregistre et le planifie automatiquement.

- **Zéro dépendance** — Aucune bibliothèque externe de planification requise
- **API d'administration** — Points de terminaison REST pour lister, déclencher, activer/désactiver et consulter les journaux
- **Tableau de bord Studio** — Surveillez toutes les tâches, consultez l'historique d'exécution et déclenchez des exécutions manuellement
- **Persistance en base de données** — Journaux d'exécution stockés dans PostgreSQL, survivant aux redémarrages
- **Cache en mémoire** — Mémoire tampon circulaire rapide (50 dernières exécutions) pour le tableau de bord, adossée à la base de données

## Définir une tâche cron

Créez un fichier dans votre répertoire `backend/crons/` qui exporte par défaut une définition cron. Utilisez le helper `defineCron` d'`@rebasepro/server` pour l'inférence de types et l'autocomplétion :

```typescript
// backend/crons/health-check.ts
import { defineCron } from "@rebasepro/server";

export default defineCron({
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
});
```

`rebase dev` surveille le répertoire des crons, ainsi une tâche ajoutée pendant son exécution est
enregistrée au rechargement suivant — sans redémarrage. (Il doit être notifié : le répertoire est
scanné plutôt qu'importé, le watcher ne peut donc pas l'inférer.)

:::note
`defineCron` est une fonction identité — elle renvoie le même objet que vous lui passez. Un simple objet `CronJobDefinition` exporté par défaut fonctionne de manière identique ; `defineCron` fournit simplement la vérification des types à la compilation et l'autocomplétion dans l'éditeur.
:::

Le **nom de fichier** (sans extension) devient l'identifiant unique de la tâche — par exemple, `health-check`.


## Configuration

:::note[Où cela se place]
**Runtime managé** — placez les fichiers dans `backend/crons/` ; le runtime découvre ce répertoire de lui-même, et `entry.crons` dans `rebase.json` n'est nécessaire que si vous l'avez déplacé. `REBASE_CRON_SCHEDULER` dans `.env` détermine si *ce* processus exécute les timers.

**Éjecté (Ejected)** — `cronsDir` sur `initializeRebaseBackend({ … })`, comme ci-dessous.

La correspondance complète se trouve dans [Vue d'ensemble du Backend](/docs/backend/#where-each-option-lives).
:::

Activez les tâches cron en ajoutant `cronsDir` à la configuration de votre backend :

```typescript no-verify
const instance = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),
    cronsDir: path.resolve(__dirname, "../crons"),  // ← add this
});
```

C'est tout. Rebase va :

1. Scanner le répertoire à la recherche de fichiers `.ts` / `.js`
2. Enregistrer chaque export par défaut en tant que tâche cron
3. Créer automatiquement la table `rebase.cron_logs` dans PostgreSQL (si le pilote prend en charge le SQL)
4. Démarrer le planificateur et initialiser les compteurs à partir des journaux existants en base de données
5. Monter les routes REST d'administration sur `/api/admin/cron`

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
|------------|---------------|
| `* * * * *` | Chaque minute |
| `0 * * * *` | Chaque heure |
| `0 3 * * *` | Tous les jours à 3h00 |
| `0 0 * * 1` | Chaque lundi à minuit |
| `0 9 1 * *` | Le premier jour de chaque mois à 9h00 |
| `0,30 * * * *` | Toutes les 30 minutes (à :00 et :30) |
| `0 9-17 * * 1-5` | Toutes les heures, de 9h à 17h, du lundi au vendredi uniquement |

Les pas (`*/n`), les plages (`a-b`) et les listes (`a,b,c`) sont tous pris en charge.

Une planification est comparée à l'heure locale de son fuseau. Lors d'un changement d'heure, cela signifie qu'une tâche à heure fixe dans l'heure répétée (`30 2 * * *` là où les horloges reculent à 03:00) s'exécute lors des deux passages de cette heure, et qu'une tâche dans l'heure sautée, quand les horloges avancent, ne s'exécute pas ce jour-là.

## Référence de CronJobDefinition

`timezone` est nouveau — sur la version 0.17.3, une planification est toujours interprétée dans le
fuseau horaire propre de l'hôte. Tout le reste sur cette interface est déjà déployé.

```typescript
interface CronJobDefinition {
    // Cron schedule expression (5-field format)
    schedule: string;

    // IANA zone the schedule is read in, e.g. "Europe/Madrid". Without it the
    // schedule is read in the host's own zone — UTC in nearly every container,
    // yours on a laptop — so name it. An unknown zone is refused when the job
    // loads rather than read as local time.
    timezone?: string;

    // Human-readable name shown in Studio
    name: string;

    // Optional description shown in Studio
    description?: string;

    // Whether the job starts enabled (default: true)
    enabled?: boolean;

    // Max execution time in seconds (default: 300). Infinity means no
    // timeout; 0, a negative number or NaN is refused when the job loads.
    timeoutSeconds?: number;

    // How far back to look on startup for a slot that elapsed while no
    // instance was ticking (default: off). See "Recovering Missed Slots".
    catchUpWindowSeconds?: number;

    // The function to run on each tick
    handler: (ctx: CronJobContext) => Promise<unknown> | unknown;
}
```

## Contexte du gestionnaire (Handler Context)

Chaque gestionnaire reçoit un `CronJobContext` contenant des méthodes utilitaires et l'instance du client Rebase :

```typescript no-verify
interface CronJobContext {
    // The job's unique ID (derived from filename)
    jobId: string;

    // The scheduled tick timestamp
    scheduledAt: Date;

    // Logger — captured lines appear in Studio and the logs API
    log: (...args: unknown[]) => void;

    // Aborted when the run exceeds `timeoutSeconds`, or when a shutdown's
    // wait for it runs out
    signal: AbortSignal;

    // The server-side Rebase singleton — the same object `import { rebase }
    // from "@rebasepro/server"` returns, and the same one `defineFunction`
    // hands its callback.
    rebase: RebaseServerClient;
}
```

Utilisez `ctx.log()` pour émettre une sortie structurée. Ces lignes sont capturées dans le journal d'exécution et visibles dans Studio ainsi que via l'API REST.

### `ctx.signal` — interrompre le travail lorsque l'exécution s'arrête

Le timeout met fin à l'*exécution* : le planificateur cesse d'attendre et enregistre un échec.
Il n'arrête pas le gestionnaire. Passez `ctx.signal` à tout ce qui en accepte un, et
le travail s'arrêtera avec lui :

```typescript no-verify
export default defineCron({
    name: "Sync inventory",
    schedule: "*/15 * * * *",
    timeoutSeconds: 60,
    async handler({ signal, log }) {
        const res = await fetch("https://supplier.example.com/stock", { signal });
        log(`fetched ${res.status}`);
    }
});
```

Sans cela, une tâche dont le timeout correspond à son intervalle laisse fuiter une requête abandonnée
à chaque déclenchement — invisible, car chaque exécution est déjà enregistrée comme échouée.

:::note[`ctx.client` a été supprimé]
C'était un deuxième nom pour `ctx.rebase`, et son type réexposait `client.data` —
l'alias que `RebaseServerClient` omet délibérément pour que le plan privilégié
ait exactement un seul nom. Un développeur ayant découvert `client.data` ici le transportait dans un
callback de collection, où `context.data` représente le plan *au périmètre utilisateur* : même
syntaxe, privilèges opposés. Utilisez `ctx.rebase.dataAsAdmin`.
:::

### Interagir avec la base de données et les services via `ctx.rebase`

`ctx.rebase.dataAsAdmin` est le plan de données au périmètre administrateur. Un cron ne disposant
d'aucun utilisateur par requête, il n'existe pas d'alternative au périmètre utilisateur ici — appliquez
vous-même les filtres de périmètre sur chaque requête.

:::caution[Le périmètre administrateur ne contourne pas le RLS]
`dataAsAdmin` est défini une seule fois, au démarrage, en tant que `{ uid: "service", roles: ["admin"] }`.
Chaque lecture et écriture s'exécute toujours dans une transaction ayant appliqué `SET LOCAL ROLE
rebase_user` avec `app.uid = 'service'`, et **vos politiques de sécurité sont évaluées** —
par rapport à cette identité. Cela valide les politiques par défaut intégrées via leur
branche `rolesOverlap(['admin'])`, c'est pourquoi la différence se remarque rarement. Elle
se remarque lorsque vous écrivez les vôtres : `policy.serverContext()` se compile en
`rebase.uid() IS NULL` et est par conséquent **faux** ici, de sorte qu'une collection avec
`disableDefaultPolicies: true` dont la seule règle est `serverContext()` refusera ces
écritures et renverra zéro ligne — HTTP 200, vide — pour ces lectures.

`rebase.sql()` est *en revanche* un contournement inconditionnel : connexion propriétaire, aucune politique.
:::

```typescript
// backend/crons/expire-users.ts
import { defineCron } from "@rebasepro/server";

export default defineCron({
    schedule: "0 0 * * *", // Daily at midnight
    name: "Expire Inactive Accounts",
    
    async handler(ctx) {
        ctx.log("Checking for expired trial users...");

        // Fetch using the pre-initialized data driver. `collection<Row>(slug)`
        // gives the query builder the row type — `where` keys are checked
        // against it. Every filter is an `[operator, value]` tuple; a bare
        // value is passed straight through and builds a malformed query.
        const users = ctx.rebase.dataAsAdmin.collection<{
            id: string;
            email: string;
            trial_status: string;
            trial_ends_at: string;
            status: string;
        }>("users");

        const { data: trials } = await users.find({
            where: {
                trial_status: ["==", "active"],
                trial_ends_at: ["<", new Date().toISOString()]
            }
        });

        ctx.log(`Found ${trials.length} users with expired trials.`);

        for (const user of trials) {
            await users.update(user.id, {
                trial_status: "expired",
                status: "disabled"
            });
            
            // Send email notification using the Rebase email service
            await ctx.rebase.email.send({
                to: user.email,
                subject: "Your trial has expired",
                html: "<p>Please upgrade your subscription to continue.</p>"
            });
        }
    }
});
```

:::tip
Le gestionnaire peut renvoyer n'importe quelle valeur sérialisable en JSON. Elle sera stockée dans l'entrée du journal sous la clé `result` et affichée dans l'historique d'exécution de Studio.
:::

## API REST

Toutes les routes cron nécessitent une **authentification administrateur** (`requireAuth` + `requireAdmin`).

| Méthode | Chemin | Description |
|---------|--------|-------------|
| `GET` | `/api/admin/cron` | Lister toutes les tâches cron enregistrées |
| `GET` | `/api/admin/cron/:id` | Obtenir le statut d'une tâche individuelle |
| `POST` | `/api/admin/cron/:id/trigger` | Déclencher manuellement une tâche |
| `GET` | `/api/admin/cron/:id/logs` | Obtenir l'historique d'exécution (`?limit=N`) |
| `PUT` | `/api/admin/cron/:id` | Activer/désactiver une tâche (`{ "enabled": true }`) |

### Exemple : Lister toutes les tâches

`$TOKEN` est un jeton d'accès administrateur : connectez-vous et utilisez l'`accessToken` renvoyé
par la réponse de connexion. `$API_URL` correspond à ce que `rebase dev` a affiché — le port étant dérivé
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
    "note": "1 cron file(s) failed to load and 1 job(s) have an invalid schedule — NOT scheduled. See `rejected` for the reason; the server log has the rest."
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

## SDK Client

Le SDK client Rebase expose un espace de noms `cron` pour toutes les opérations :

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: import.meta.env.VITE_API_URL });

// List all jobs
const { jobs } = await client.cron.listJobs();

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

## Tableau de bord Studio

Lorsque des tâches cron sont configurées, un outil **Cron Jobs** apparaît dans Rebase Studio sous la section **Compute**, à côté de la console JS. Le tableau de bord propose :

- **Liste des tâches** — Toutes les tâches enregistrées avec des indicateurs d'état en direct
- **Panneau de détails** — Planification, prochaine/dernière exécution, durée et informations sur les erreurs
- **Historique d'exécution** — Entrées de journal extensibles avec les sorties capturées et les résultats
- **Déclenchement manuel** — Exécutez n'importe quelle tâche à la demande en un clic
- **Activer/Désactiver** — Mettez en pause et reprenez les tâches sans redémarrer le serveur

Le tableau de bord s'actualise automatiquement toutes les 15 secondes.

## Validation des planifications et parsing AST

Lors de l'initialisation du backend, Rebase analyse toutes les planifications cron enregistrées à l'aide d'un expandeur cron en JS sans dépendance externe :
- **Vérification de syntaxe** : Vérifie que la chaîne contient exactement 5 champs séparés par des espaces (`minute`, `hour`, `day of month`, `month`, `day of week`).
- **Développement des plages** : Déconstruit les pas (`*/15`), les plages (`9-17`) et les listes séparées par des virgules (`0,30`) en tableaux explicites d'entiers valides associés à leurs limites respectives (ex. minutes `0-59`, heures `0-23`, mois `1-12`).
- Si une expression cron échoue à la validation, Rebase rejette la définition, consigne une erreur au démarrage et refuse d'enregistrer la tâche afin d'éviter les échecs d'exécution au runtime.

---

## Sous le capot : Correction de la dérive de l'horloge (Clock-Drift)

Les planificateurs standards basés sur des intervalles (tels que `setInterval`) dérivent au fil du temps et provoquent d'importants pics d'utilisation CPU en raison des délais d'ordonnancement de la boucle d'événements au niveau de l'OS. Pour garantir la précision d'exécution, Rebase implémente une **boucle de calcul dynamique de l'heure cible** :
1. **Calcul du candidat** : Dès la fin d'une tâche ou au démarrage du planificateur, Rebase calcule le timestamp exact de la *prochaine* minute candidate correspondante.
2. **Sommeil dynamique** : Il calcule la différence en millisecondes (`nextRun.getTime() - now.getTime()`) et planifie un unique `setTimeout`.
3. **Seuil de sécurité anti-dérive** : Un tampon de sommeil minimal (`MIN_SCHEDULE_INTERVAL_MS`) de **5 000 ms** est appliqué. Si un cycle du planificateur se termine extrêmement rapidement, ce seuil empêche un double déclenchement quasi instantané.
4. **Fermeture propre** : Les identifiants de timers sont explicitement détachés de la boucle d'événements Node.js via `timer.unref()`, garantissant que les planificateurs cron en arrière-plan ne bloquent pas l'arrêt propre des processus lors des déploiements.

---

## Récupération des créneaux manqués

Comme le planificateur calcule le prochain créneau à partir de l'instant présent (*now*) à chaque démarrage, un créneau ne s'exécute que si une instance était active et opérationnelle lorsqu'il s'est présenté. Tout ce qui remplace le processus pendant un créneau — un déploiement progressif (rolling deploy), un crash, le recyclage du conteneur par la plateforme — ignore cette exécution, et le processus de remplacement planifie le créneau *suivant*. Aucune erreur n'est levée ; l'exécution n'a simplement jamais lieu.

Ce n'est **pas** seulement un problème lié au scale-to-zero. Un service assigné à une instance active continue de perdre des exécutions, car une plateforme est libre de retirer l'instance hébergeant le timer et d'en démarrer une nouvelle.

Définissez `catchUpWindowSeconds` sur une fenêtre largement supérieure à un redémarrage, et le démarrage exécutera un créneau qu'il trouvera non réclamé dans cette fenêtre :

```typescript
export default defineCron({
    schedule: "0 6 * * *",       // daily at 06:00
    name: "Scrape Listings",
    catchUpWindowSeconds: 3600,  // tolerate an hour of downtime around 06:00
    handler: async (ctx) => { /* … */ }
});
```

Trois points à retenir :

- **Désactivé par défaut.** Sans `catchUpWindowSeconds`, le comportement reste inchangé.
- **Seul le créneau manqué le plus récent est exécuté.** Un démarrage après six heures d'interruption rattrape une tâche horaire une seule fois, pas six. Le rattrapage évite qu'une exécution disparaisse ; il ne rejoue pas l'historique.
- **Un magasin supportant les réservations (claims) est requis.** Le rattrapage réserve le créneau via la même clé `(job_id, slot)` que le parcours planifié utilise, ce qui est la seule chose distinguant « ce créneau n'a jamais tourné » de « ce créneau a déjà tourné sur l'instance en cours de remplacement ». Sans magasin connecté, le rattrapage est ignoré et un avertissement est consigné — sinon, une instance recyclée toutes les 30 minutes réexécuterait la même tâche horaire à chaque démarrage.

Dans le cas habituel — un redémarrage quelques minutes après qu'un créneau s'est exécuté normalement — le créneau le plus récent est déjà réclamé, donc le rattrapage ne coûte qu'une vérification de réservation par tâche par démarrage et ne fait rien de plus.

Au démarrage, les réservations de plus de sept jours sont supprimées, mais la plus récente de chaque tâche est toujours conservée, quel que soit son âge. Cette réservation est la preuve que le créneau a déjà tourné : une tâche mensuelle avec une fenêtre de rattrapage d'un mois n'est donc pas réexécutée par un déploiement le 10.

Une exécution récupérée constitue une entrée normale dans `cron_logs` (`manual` vaut `false`), avec une première ligne de journal indiquant le créneau récupéré et son retard :

```
⏰ Catch-up run for missed slot 2026-07-29T06:00:00.000Z (612s late)
```

---

## Gestion de la concurrence

Pour garantir la stabilité lors de l'exécution d'opérations gourmandes en ressources, Rebase implémente un **verrou d'exécution à concurrence unique** strict par identifiant de tâche :
- **Chevauchements planifiés** : Si le déclenchement planifié d'une tâche survient alors que l'exécution précédente est toujours en cours, le planificateur ignore le déclenchement et planifie immédiatement la prochaine exécution candidate.
- **Collisions avec déclenchement manuel** : Si un opérateur déclenche manuellement une tâche en cours d'exécution via Rebase Studio ou l'API REST, la requête répond immédiatement avec une charge utile indiquant qu'elle a été ignorée, protégeant ainsi le worker actif.

Dans les deux cas, une ligne est écrite dans `rebase.cron_logs`, de sorte que l'omission apparaît dans l'historique
d'exécution plutôt que seulement dans le journal du processus :

```json
{
  "jobId": "expire-users",
  "success": true,
  "result": { "skipped": true, "reason": "already_executing" },
  "logs": ["Skipped: the previous run has not finished"]
}
```

`success: true` car rien n'a échoué — c'est `result.skipped` qui le signale. Une
série de ces enregistrements d'affilée est la signature d'une tâche devenue trop longue pour sa fréquence,
et c'est un schéma qu'il est impossible de repérer si ces omissions ne sont pas enregistrées.

---

## Délais d'expiration (Timeouts) et isolation des erreurs

- **Course de timeout forcé** : Les blocs d'exécution sont enveloppés dans un `Promise.race` face à un timer d'expiration dérivé de `timeoutSeconds` (par défaut : `300` secondes / 5 minutes ; `Infinity` pour aucun timeout). Si le gestionnaire reste bloqué au-delà de ce seuil, `ctx.signal` est annulé et la promesse est rejetée, levant l'erreur :
  `Error: Cron job "<id>" timed out after <N>ms`
  L'annulation est la partie qui interrompt le *travail* ; le rejet empêche seulement le planificateur de continuer à attendre. Un gestionnaire qui ignore `ctx.signal` continue de tourner au-delà de sa propre exécution.
- **Arrêt** : `backend.shutdown()` attend une exécution en cours, dans le même budget que la file de jobs (les deux tiers du timeout d'arrêt). Si l'exécution tourne encore quand il est épuisé, `ctx.signal` est annulé et elle est enregistrée comme échouée, avec la raison. Son créneau reste réservé, donc aucune autre instance ne la réexécute.
- **Try/Catch sécurisé** : Chaque gestionnaire de tâche s'exécute au sein d'une enveloppe isolée. Toute exception non interceptée est capturée, formatant la trace d'erreur en une chaîne, définissant le statut de la tâche sur `"error"` et mettant à jour les compteurs d'échecs de `rebase.cron_logs`. Un plantage au sein d'une tâche cron individuelle ne fera jamais planter la boucle du planificateur ni le serveur web HTTP principal sous Hono.
- **Mémoire tampon circulaire en mémoire** : Le planificateur maintient un ring buffer contenant les **50 dernières exécutions** par tâche. Cette mémoire tampon est conservée en mémoire vive pour permettre des lectures quasi instantanées depuis Rebase Studio.

---

## Schéma de persistance en base de données

Lorsque des adaptateurs de base de données prenant en charge le SQL (ex. PostgreSQL) sont actifs, Rebase configure la table `rebase.cron_logs` :

```sql
CREATE SCHEMA IF NOT EXISTS rebase;

CREATE TABLE IF NOT EXISTS rebase.cron_logs (
    id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    job_id       TEXT NOT NULL,
    started_at   TIMESTAMPTZ NOT NULL,
    finished_at  TIMESTAMPTZ NOT NULL,
    duration_ms  INTEGER NOT NULL,
    success      BOOLEAN NOT NULL DEFAULT true,
    error        TEXT,                                 -- Stack trace or error message
    result       JSONB,                                -- Return value of handler
    logs         JSONB,                                -- Ring buffer array of ctx.log outputs
    manual       BOOLEAN NOT NULL DEFAULT false        -- True if triggered from Studio/REST
);

CREATE INDEX IF NOT EXISTS idx_cron_logs_job ON rebase.cron_logs(job_id, started_at DESC);
```

Au démarrage, le planificateur lit les statistiques de cette table via des requêtes d'agrégation (`COUNT(*)`, `SUM(CASE WHEN success = false THEN 1 ELSE 0 END)`) pour renseigner l'historique de `totalRuns` et `totalFailures`. Les insertions de journaux sont exécutées lors d'un passage asynchrone non bloquant ; si une écriture en base échoue, le planificateur enregistre l'erreur et poursuit son exécution normale en utilisant la mémoire tampon circulaire en mémoire comme solution de repli.

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

        // Admin-scoped data access — see `ctx.rebase` above.
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const expired = await ctx.rebase.dataAsAdmin.sessions.findAll({
            where: { last_seen_at: ["<", cutoff] }
        });
        for (const session of expired) {
            await ctx.rebase.dataAsAdmin.sessions.delete(session.id as string);
        }

        ctx.log(`Cleaned up ${expired.length} expired sessions`);

        return { deletedSessions: expired.length };
    },
};

export default job;
```

## Les crons dans le graphe de ressources

Chaque fichier cron constitue également une déclaration. `rebase resources` le liste sous le
nom du fichier — le même identifiant sous lequel le planificateur l'exécute et que Studio affiche —
avec sa planification et son fuseau horaire, de sorte qu'un hôte lit les planifications d'un projet avant de
lancer quoi que ce soit. Un cron ne dépend d'aucune variable d'environnement ; `rebase status`
l'affiche en vert sans rien à configurer.

Lire la planification implique d'importer le fichier, et `rebase resources` est une étape
de build : aucun `.env`, aucun secret. Veillez donc à ce que la **portée du module** d'un cron ne contienne rien
qui lise la configuration au moment de l'import — un client de base de données initialisé au début d'un
helper, un fichier `env.ts` qui valide `DATABASE_URL`. Importez plutôt ce code à l'intérieur du
gestionnaire :

```ts
async handler({ log }) {
    const { runSeed } = await import("../src/seed.js");
    await runSeed();
    log("done");
}
```

Le gestionnaire s'exécute au sein du déploiement, là où ces variables existent. Un import de premier
niveau de ce même module rend le graphe calculable uniquement sur une machine disposant
par hasard d'un fichier `.env` — et cela charge l'intégralité de la dépendance à chaque démarrage qui
se contente d'enregistrer la tâche.

## Prochaines étapes

- **[Vue d'ensemble du Backend](/docs/backend)** — Référence complète de la configuration du backend
- **[Callbacks d'entités](/docs/collections/callbacks)** — Exécuter de la logique lors des modifications de données
- **[Intégration de Webhooks](/docs/recipes/webhooks)** — Envoyer des notifications sur des événements
