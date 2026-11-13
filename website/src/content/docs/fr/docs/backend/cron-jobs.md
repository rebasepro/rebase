---
sourceHash: d47ac3d32c961db1
title: Tâches Cron
sidebar_label: Tâches Cron
description: Planifiez des tâches d'arrière-plan récurrentes grâce au système de tâches cron intégré de Rebase. Définissez des tâches sous forme de fichiers TypeScript, surveillez-les dans Studio et gérez-les via l'API REST.
---

## Vue d'ensemble

Rebase intègre un **planificateur de tâches cron** pour exécuter des tâches d'arrière-plan récurrentes — nettoyage de données, génération de rapports, vérifications de santé, synchronisations d'API externes, et bien plus encore.

Les tâches cron suivent le même modèle de **découverte basée sur les fichiers** que les fonctions personnalisées : déposez un fichier TypeScript dans votre répertoire `crons/`, et Rebase l'enregistre et le planifie automatiquement.

- **Zéro dépendance** — Aucune bibliothèque de planification externe requise
- **API d'administration** — Points de terminaison REST pour lister, déclencher, activer/désactiver et consulter les journaux
- **Tableau de bord Studio** — Surveillez toutes les tâches, consultez l'historique d'exécution et déclenchez des exécutions manuellement
- **Persistance en base de données** — Journaux d'exécution stockés dans PostgreSQL, conservés après redémarrage
- **Cache en mémoire** — Mémoire tampon circulaire rapide (50 dernières exécutions) pour le tableau de bord, adossée à la base de données

## Définir une tâche cron

Créez un fichier dans votre répertoire `backend/crons/` qui exporte par défaut une définition cron. Utilisez l'utilitaire `defineCron` de `@rebasepro/server` pour l'inférence de types et l'autocomplétion :

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

`rebase dev` surveille le répertoire des crons, de sorte qu'une tâche ajoutée pendant son exécution est
enregistrée au prochain rechargement — sans redémarrage. (Il doit en être informé : le répertoire est
analysé plutôt qu'importé, le watcher ne peut donc pas le déduire lui-même.)

:::note
`defineCron` est une fonction identité — elle renvoie le même objet que celui que vous lui transmettez. Un simple objet `CronJobDefinition` exporté par défaut fonctionne de manière identique ; `defineCron` fournit simplement la vérification de type au moment de la compilation et l'autocomplétion dans l'éditeur.
:::

Le **nom de fichier** (sans extension) devient l'identifiant unique de la tâche — par exemple, `health-check`.


## Configuration

:::note[Où placer ceci]
**Runtime managé** — placez les fichiers dans `backend/crons/` ; le runtime découvre ce répertoire de lui-même, et `entry.crons` dans `rebase.json` n'est nécessaire que si vous l'avez déplacé. `REBASE_CRON_SCHEDULER` dans `.env` détermine si *ce* processus exécute les minuteurs.

**Éjecté (Ejected)** — `cronsDir` sur `initializeRebaseBackend({ … })`, comme ci-dessous, ou `crons` avec les tâches comme valeurs.

La correspondance complète se trouve dans [Présentation du Backend](/docs/backend/#where-each-option-lives).
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

1. Analyser le répertoire à la recherche de fichiers `.ts` / `.js`
2. Enregistrer chaque export par défaut comme une tâche cron
3. Créer automatiquement les tables `rebase.cron_logs`, `rebase.cron_claims` et `rebase.cron_job_state` dans PostgreSQL (si le pilote prend en charge SQL)
4. Démarrer le planificateur et initialiser les compteurs à partir des journaux existants en base de données
5. Monter les routes REST d'administration sous `/api/admin/cron`

### Tâches cron sous forme de valeurs

`crons` accepte les tâches sous la forme d'un objet associant l'identifiant d'une tâche à sa définition, aux côtés de `collections`. Un répertoire est une façon de le construire : `loadCrons(dir)` en lit un exactement selon cette structure.

```typescript
import path from "path";
import { defineCron, initializeRebaseBackend, loadCrons } from "@rebasepro/server";

const nightlyReport = defineCron({
    schedule: "0 3 * * *",
    async handler({ log }) {
        log("building the report");
    }
});

await initializeRebaseBackend({ app, server, crons: { "nightly-report": nightlyReport } });
// the same as cronsDir:
await initializeRebaseBackend({ app, server, crons: await loadCrons(path.resolve(__dirname, "../crons")) });
```

Fournissez `crons` ou `cronsDir`, mais pas les deux : le démarrage refuse la paire. La construction du backend enregistre les tâches ; ce qui démarre leurs minuteurs est `start()`, que `initializeRebaseBackend` appelle pour vous. Avec [`createRebaseBackend`](/docs/backend/custom-server/), vous l'appelez vous-même, dans le processus qui doit les exécuter. `loadCronJobsFromDirectory` et `loadCronJobsWithDiagnostics` fonctionnent toujours, sont dépréciées et émettent un avertissement unique.

## Syntaxe de planification

Les expressions Cron utilisent le format standard à **5 champs** :

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
| `0 9-17 * * 1-5` | Toutes les heures, de 9h à 17h, en semaine uniquement |

Les valeurs de pas (`*/n`), les plages (`a-b`) et les listes (`a,b,c`) sont toutes prises en charge.

Lorsque le jour du mois et le jour de la semaine sont tous deux restreints, un jour qui correspond à l'un ou à l'autre est retenu, comme dans le cron standard : `0 9 1 * 1` s'exécute le 1er de chaque mois et chaque lundi. Lorsque l'un des deux champs commence par `*`, un jour doit correspondre aux deux.

Une planification est évaluée par rapport à l'heure locale de son fuseau horaire. Lors d'un
changement d'heure (heure d'été/d'hiver), cela signifie qu'une tâche à heure fixe située dans l'heure répétée
(`30 2 * * *` lorsque les horloges reculent à 03h00) s'exécute lors des deux passages de cette heure,
et qu'une tâche située dans l'heure sautée, lorsque les horloges avancent, ne s'exécute pas ce
jour-là.

## Référence CronJobDefinition

```typescript
interface CronJobDefinition {
    // Cron schedule expression (5-field format)
    schedule: string;

    // IANA zone the schedule is read in, e.g. "Europe/Madrid". Without it the
    // schedule is read in the host's own zone — UTC in nearly every container,
    // yours on a laptop — so name it. An unknown zone is refused when the job
    // loads rather than read as local time.
    timezone?: string;

    // Human-readable name shown in Studio (default: the job id, the file's name)
    name?: string;

    // Optional description shown in Studio
    description?: string;

    // Whether the job runs (default: true). A pause or a resume from Studio
    // or the admin API overrides it, for every process, until reset.
    enabled?: boolean;

    // Max execution time in seconds (default: 300). Infinity means no
    // timeout; 0, a negative number or NaN is refused when the job loads.
    timeoutSeconds?: number;

    // How far back to look on startup for a slot that elapsed while no
    // instance was ticking (default: off). See "Cron across instances".
    catchUpWindowSeconds?: number;

    // The function to run on each tick
    handler: (ctx: CronJobContext) => Promise<unknown> | unknown;
}
```

## Contexte du handler

Chaque handler reçoit un `CronJobContext` contenant des méthodes utilitaires et l'instance du client Rebase :

```typescript no-verify
interface CronJobContext {
    // The job's unique ID (derived from filename)
    jobId: string;

    // The slot this run fires for: a catch-up run gets the slot it
    // missed, a manual trigger the moment it started
    scheduledAt: Date;

    // Logger — lines appear in Studio, the logs API and the server log
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

Utilisez `ctx.log()` pour émettre une sortie structurée. Ces lignes sont enregistrées dans le journal d'exécution et visibles dans Studio et via l'API REST. Chaque ligne est également écrite dans le journal du serveur au niveau `info` avec un champ `cron` contenant l'ID de la tâche, afin qu'elle apparaisse partout où la sortie de votre conteneur est collectée, y compris dans les journaux de débogage de Rebase Cloud. Cette copie est caviardée de la même manière que les propres lignes de journal du serveur : les valeurs de clés telles que `password` ou `apiKey`, ainsi que le SQL et les paramètres d'une requête échouée, sont remplacés. Le journal d'exécution conserve la ligne sans ce caviardage.

Le journal d'exécution conserve les 500 premières lignes ou 64 Ko d'entre elles pour une exécution, selon la première limite atteinte, puis ajoute une ligne indiquant combien d'autres lignes n'ont pas été conservées : `… 9500 more lines not kept — see the server log`. Le journal du serveur reçoit chaque ligne. Une tâche qui consigne une ligne par élément traité doit s'attendre à ce que son historique ne montre que le début de l'exécution.

### `ctx.signal` — arrêter le travail lorsque l'exécution s'arrête

Le délai d'expiration met fin à l'*exécution* : le planificateur cesse d'attendre et enregistre un échec.
Il n'arrête pas le handler. Transmettez `ctx.signal` à tout ce qui en accepte un, et
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

Sans cela, une tâche dont le délai d'expiration correspond à son intervalle laisse échapper une requête abandonnée
par tick — invisible, car chaque exécution est déjà enregistrée comme échouée.

:::note[`ctx.client` a été supprimé]
Il s'agissait d'un alias pour `ctx.rebase`, et son type réexposait `client.data` —
l'alias que `RebaseServerClient` omet délibérément pour que le plan privilégié
n'ait qu'un seul nom. Un lecteur ayant appris `client.data` ici l'appliquait ensuite dans
un callback de collection, où `context.data` représente le plan *à portée utilisateur* : même
nommage, privilège opposé. Utilisez `ctx.rebase.dataAsAdmin`.
:::

### Interagir avec la base de données et les services via `ctx.rebase`

`ctx.rebase.dataAsAdmin` est le plan de données à portée administrateur. Un cron ne dispose
d'aucun utilisateur par requête, il n'y a donc pas d'alternative à portée utilisateur ici — appliquez vous-même
les filtres de portée à chaque requête.

:::caution[La portée admin ne contourne pas le RLS]
`dataAsAdmin` est défini une seule fois, au démarrage, sous la forme `{ uid: "service", roles: ["admin"] }`.
Chaque lecture et écriture s'exécute toujours dans une transaction ayant effectué `SET LOCAL ROLE
rebase_user` avec `app.uid = 'service'`, et **vos stratégies (policies) sont évaluées** —
par rapport à cette identité. Cela valide les stratégies intégrées par défaut grâce à leur
branche `rolesOverlap(['admin'])`, c'est pourquoi la différence se remarque rarement. Elle
apparaît lorsque vous écrivez les vôtres : `policy.serverContext()` se compile en
`rebase.uid() IS NULL` et est donc **faux** ici ; ainsi, une collection avec
`disableDefaultPolicies: true` dont la seule règle est `serverContext()` refusera ces
écritures et renverra zéro ligne — HTTP 200, vide — pour ces lectures.

`rebase.sql()` est, quant à lui, un contournement inconditionnel : connexion propriétaire (owner), aucune stratégie appliquée.
:::

```typescript
// backend/crons/expire-users.ts
import { defineCron } from "@rebasepro/server";

export default defineCron({
    schedule: "0 0 * * *", // Daily at midnight
    name: "Expire Inactive Accounts",
    
    async handler(ctx) {
        ctx.log("Checking for expired trial users...");

        // Fetch using the pre-initialized data driver. `table<Row>(slug)`
        // gives the query builder the row type — `where` keys are checked
        // against it. Every filter is an `[operator, value]` tuple; a bare
        // value is passed straight through and builds a malformed query.
        const users = ctx.rebase.dataAsAdmin.table<{
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
Le handler peut renvoyer n'importe quelle valeur sérialisable en JSON. Elle sera stockée dans l'entrée de journal sous `result` et affichée dans l'historique d'exécution de Studio.
:::

## API REST

La liste, le déclenchement, la mise en pause et la reprise des tâches via HTTP, ainsi que le SDK typé `client.cron`, sont détaillés dans [API des tâches cron](/docs/backend/cron-jobs-api/).

## Tableau de bord Studio

Lorsque les tâches cron sont configurées, un outil **Tâches Cron** apparaît dans Rebase Studio sous **Compute**, à côté de la console JS. Le tableau de bord fournit :

- **Liste des tâches** — Toutes les tâches enregistrées avec des indicateurs d'état en direct
- **Panneau de détails** — Planification, prochaine/dernière exécution, durée et informations sur les erreurs
- **Historique d'exécution** — Entrées de journal extensibles avec sorties et résultats capturés
- **Déclenchement manuel** — Exécutez n'importe quelle tâche à la demande en un clic. Le panneau attend la fin de l'exécution et affiche son issue : une exécution ayant échoué présente son erreur
- **Activer/désactiver** — Mettez en pause et reprenez des tâches sans redémarrer le serveur, pour chaque processus à la fois ; une pause persiste à travers les redémarrages et les déploiements
- **Tâches non disponibles** — chaque tâche refusée par le planificateur, avec sa planification et la raison, ainsi que le nombre de fichiers cron qui n'ont pas pu être chargés. Aucune d'entre elles n'est planifiée ; voir [Tâches non disponibles](/docs/backend/cron-jobs-api/#jobs-that-are-not-there)

Le tableau de bord s'actualise automatiquement toutes les 15 secondes.

Le panneau affiche la même chose quel que soit le processus qui le sert. Une tâche en cours d'exécution par un autre
processus apparaît comme étant en cours d'exécution.
Sur chaque processus disposant d'un store, le nombre d'exécutions, le nombre d'échecs et la dernière exécution sont lus depuis la base de données, où les exécutions de tous les processus sont comptabilisées. Les compteurs propres à un processus ne conservent que les exécutions qu'il a effectuées : le rôle `api` aux côtés d'un worker n'exécute rien, et sur deux réplicas qui planifient tous les deux, aucun ne voit les créneaux que l'autre a réservés. Ce n'est que lorsque la base de données ne peut pas être lue que la carte se rabat sur les compteurs propres à ce processus, avec un avertissement dans le journal du serveur.

Les décomptes sont cumulés depuis le début ; l'historique couvre les 30 derniers jours. La ligne de chaque exécution dans `rebase.cron_logs` est supprimée 30 jours après son début par un nettoyage horaire, tandis que les compteurs d'exécutions et d'échecs continuent de la comptabiliser. Une exécution ignorée compte comme une exécution, comme cela a toujours été le cas : c'est une ligne de l'historique.

## Validation de la planification et analyse AST

Lors de l'initialisation du backend, Rebase analyse toutes les planifications cron enregistrées à l'aide d'un expanseur cron basé sur JS sans dépendance :
- **Vérification de la syntaxe** : Vérifie que la chaîne contient exactement 5 champs séparés par des espaces (`minute`, `hour`, `day of month`, `month`, `day of week`).
- **Expansion des plages** : Déconstruit les pas (`*/15`), les plages (`9-17`) et les listes séparées par des virgules (`0,30`) en tableaux explicites d'entiers valides associés à leurs limites respectives (par exemple, minutes `0-59`, heures `0-23`, mois `1-12`).
- **Jetons entiers** : Chaque nombre, limite de plage et pas doit être un nombre entier : `5abc`, `*/5x` et `1.5` sont refusés, tout comme une plage inversée (`5-1`).
- Si une expression cron échoue à la validation, Rebase rejette la définition, consigne une erreur au démarrage et refuse d'enregistrer la tâche pour éviter des échecs d'exécution au runtime.

---

## Sous le capot : correction de la dérive de l'horloge

Les planificateurs standards basés sur des intervalles (tels que `setInterval`) dérivent au fil du temps et provoquent d'importants pics d'utilisation du processeur en raison des retards d'ordonnancement de la boucle d'événements au niveau de l'OS. Pour garantir l'exactitude de l'exécution, Rebase implémente une **boucle de calcul dynamique de l'heure cible** :
1. **Calcul du candidat** : Dès qu'une tâche se termine ou que le planificateur démarre, Rebase calcule l'horodatage exact de la *prochaine* minute candidate correspondante.
2. **Sommeil dynamique** : Il calcule la différence en millisecondes (`nextRun.getTime() - now.getTime()`) et planifie un unique `setTimeout`.
3. **Seuil de sécurité contre la dérive** : Une marge de sommeil minimale (`MIN_SCHEDULE_INTERVAL_MS`) de **5 000 ms** est appliquée. Si un tick du planificateur s'achève extrêmement rapidement, ce seuil empêche un double déclenchement quasi instantané.
4. **Prise en charge de l'arrêt propre** : Les descripteurs de minuteurs sont explicitement détachés de la boucle d'événements Node.js à l'aide de `timer.unref()`, garantissant que les planificateurs cron d'arrière-plan ne bloquent pas les arrêts propres de processus lors des déploiements.

---

## Plusieurs processus

Chaque processus dont le planificateur est activé arme les mêmes minuteurs ; la base de données décide
lequel d'entre eux exécute chaque créneau. La façon dont un créneau ne s'exécute qu'une seule fois, dont un créneau abandonné par un redémarrage
est récupéré, dont une pause atteint chaque réplica, et pourquoi un déclenchement manuel ne
s'exécute jamais en parallèle d'une exécution planifiée sont détaillés dans [Cron à travers plusieurs instances](/docs/backend/cron-across-instances).

---

## Délais d'expiration et isolation des erreurs

- **Course d'expiration forcée** : Les blocs d'exécution sont encapsulés dans un `Promise.race` opposé à un minuteur d'expiration dérivé de `timeoutSeconds` (par défaut : `300` secondes / 5 minutes ; `Infinity` pour aucun). Si le handler reste bloqué au-delà de ce seuil, `ctx.signal` est interrompu et la promesse est rejetée, levant :
  `Error: Cron job "<id>" timed out after <N>ms`
  L'interruption (abort) est la moitié qui met fin au *travail* ; le rejet arrête seulement l'attente du planificateur. Un handler qui ignore `ctx.signal` continuera de s'exécuter au-delà de sa propre exécution.
- **Arrêt du serveur (Shutdown)** : `backend.shutdown()` attend une exécution en cours, dans la limite du même budget que la file d'attente de tâches (deux tiers du délai d'arrêt). Une exécution toujours en cours à l'épuisement de ce délai voit son `ctx.signal` interrompu et est enregistrée comme échouée, avec la raison. Son créneau reste réservé, de sorte qu'aucune autre instance ne la réexécute.
- **Try/Catch sécurisé** : Chaque handler de tâche s'exécute dans un wrapper isolé. Toutes les exceptions non interceptées sont captées, enregistrant le message de l'erreur (caviardé) sous forme de chaîne, définissant le statut de la tâche sur `"error"` et incrémentant le compteur d'échecs de la tâche. Un plantage au sein d'une seule tâche cron ne fera jamais planter la boucle du planificateur ni le serveur web HTTP principal Hono.
- **Mémoire tampon circulaire en mémoire** : Le planificateur maintient une mémoire tampon circulaire contenant les **50 dernières exécutions** par tâche. Cette mémoire tampon est conservée en mémoire pour permettre des lectures quasi instantanées depuis Rebase Studio.

---

## Schéma de persistance en base de données

Lorsque des adaptateurs de base de données prenant en charge SQL (par ex. PostgreSQL) sont actifs, Rebase provisionne la table `rebase.cron_logs` :

```sql
CREATE SCHEMA IF NOT EXISTS rebase;

CREATE TABLE IF NOT EXISTS rebase.cron_logs (
    id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    job_id       TEXT NOT NULL,
    started_at   TIMESTAMPTZ NOT NULL,
    finished_at  TIMESTAMPTZ NOT NULL,
    duration_ms  INTEGER NOT NULL,
    success      BOOLEAN NOT NULL DEFAULT true,
    error        TEXT,                                 -- The error's message, redacted
    result       JSONB,                                -- Return value of handler
    logs         JSONB,                                -- Ring buffer array of ctx.log outputs
    manual       BOOLEAN NOT NULL DEFAULT false        -- True if triggered from Studio/REST
);

ALTER TABLE rebase.cron_logs ADD COLUMN IF NOT EXISTS counted BOOLEAN;  -- the run is in the counters below

CREATE INDEX IF NOT EXISTS idx_cron_logs_job ON rebase.cron_logs(job_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_logs_started ON rebase.cron_logs(started_at);
CREATE INDEX IF NOT EXISTS idx_cron_logs_uncounted ON rebase.cron_logs(job_id, started_at DESC) WHERE counted IS NULL;

CREATE TABLE IF NOT EXISTS rebase.cron_job_state (
    job_id            TEXT PRIMARY KEY,
    enabled           BOOLEAN,       -- NULL: follow the job's own `enabled`
    updated_at        TIMESTAMPTZ,   -- when `enabled` was last set, and by whom
    updated_by        TEXT,
    running_until     TIMESTAMPTZ,   -- the run lease: live while in the future
    running_by        TEXT,
    total_runs        BIGINT NOT NULL DEFAULT 0,   -- all-time, skips included
    total_failures    BIGINT NOT NULL DEFAULT 0,
    last_run_at       TIMESTAMPTZ,                 -- the most recently started run
    last_duration_ms  INTEGER,
    last_success      BOOLEAN,
    last_error        TEXT
);
```

Chacune est créée au démarrage si elle est absente, de sorte qu'une base de données antérieure à l'une d'elles en
bénéficie lors de son prochain déploiement. Aucune d'entre elles n'est une collection, et le rôle d'utilisateur final
`rebase_user` n'a aucun privilège sur aucune d'entre elles : une table `cron_job_state` accessible en écriture
permettrait à un utilisateur connecté de mettre en pause une tâche pour tout le monde, ou de conserver son bail pour que rien ne
l'exécute.

La ligne d'une exécution et son décompte sont écrits en une seule instruction : l'insertion dans `cron_logs` et un upsert des compteurs de la tâche dans `cron_job_state`. Une requête de liste lit une ligne de `cron_job_state` par tâche, quelle que soit la longueur de l'historique, et le planificateur fait de même lorsqu'il initialise `totalRuns` et `totalFailures` au démarrage. Les écritures de journaux ne retardent pas l'exécution ; si l'une d'elles échoue, le planificateur consigne l'erreur et poursuit son cours, l'exécution restant toujours présente dans la mémoire tampon circulaire en mémoire.

Une fois par heure, et lors de son démarrage, le planificateur supprime les lignes d'historique de plus de 30 jours et comptabilise toute exécution qui ne l'est pas encore, les deux par lots de 5 000 lignes. Un historique écrit avant la version 0.24 est comptabilisé par le premier de ces nettoyages, en dehors du chemin critique de démarrage. Jusqu'à ce qu'il ait terminé, une liste ajoute les exécutions qu'il n'a pas encore comptabilisées aux compteurs, afin que les chiffres ne changent pas lors d'une mise à niveau. Il en va de même pour une exécution enregistrée par un ancien serveur lors d'un déploiement progressif (rolling deploy).

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
avec sa planification et son fuseau horaire, afin qu'un hôte lise les planifications d'un projet avant
d'exécuter quoi que ce soit. Un cron ne dépend d'aucune variable d'environnement ; `rebase status`
l'affiche en vert avec rien à configurer.

Lire la planification implique d'importer le fichier, et `rebase resources` est une étape de
build : pas de `.env`, pas de secrets. Gardez donc la **portée du module** (module scope) d'un cron exempte de tout
ce qui lit la configuration à l'importation — un client de base de données instancié au sommet d'un
utilitaire, un fichier `env.ts` qui valide `DATABASE_URL`. Importez plutôt ce travail à l'intérieur du
handler :

```ts
async handler({ log }) {
    const { runSeed } = await import("../src/seed.js");
    await runSeed();
    log("done");
}
```

Le handler s'exécute lors du déploiement, là où ces variables existent. Un import
au niveau supérieur du même module rend le graphe calculable uniquement sur une machine qui
possède par hasard un fichier `.env` — et cela charge l'intégralité de la dépendance dans chaque démarrage
qui ne fait que simplement enregistrer la tâche.

Charger un cron
ne déclare rien. Une étape de build qui vous est propre et qui souhaite inclure des crons dans le graphe le
spécifie explicitement avec `declareCrons` :

```ts
import { declareCrons, loadCrons } from "@rebasepro/server";

declareCrons(await loadCrons("./crons", { onSkip: (problem) => console.warn(problem) }));
```

## Prochaines étapes

- **[Présentation du Backend](/docs/backend)** — Référence complète de la configuration backend
- **[Hooks de table](/docs/collections/callbacks)** — Exécutez de la logique lors des modifications de données
- **[Intégration de Webhooks](/docs/recipes/webhooks)** — Envoyez des notifications lors d'événements
- **[Cron à travers plusieurs instances](/docs/backend/cron-across-instances)** — Une exécution par créneau, créneaux manqués, mise en pause globale et exécutions qui se chevauchent
