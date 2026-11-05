---
sourceHash: 088ee76c9513e196
title: Portabilité du runtime
sidebar_label: Portabilité du runtime
description: Ce qu'une fonction personnalisée importe décide si elle pourrait s'exécuter hors d'un processus Node — ce qui est portable, ce qui est réservé à Node, et comment rebase build et rebase doctor le signalent.
---

Une fonction personnalisée est une application Hono, et Hono fonctionne sur tous les runtimes de serveurs JavaScript. La capacité de *votre* fonction à s'exécuter ailleurs que sur un processus Node dépend donc de ce que son propre fichier importe et utilise.

Rien de tout cela ne constitue une restriction sur ce que vous pouvez écrire aujourd'hui. Chaque déploiement Rebase est un processus Node, une fonction qui lit un fichier ou ouvre un socket est une fonction tout à fait valable, et aucun build ni déploiement n'échoue à cause de ces éléments. Cela est documenté afin que la réponse soit connue dès maintenant plutôt que découverte fichier par fichier plus tard.

**Portable — fonctionne sur tous les runtimes :**

- Tout ce qui est exporté depuis `@rebasepro/server/functions`
- `getDriver(c)` et `rebase.dataAsAdmin` — tous deux transitent par le même canal quel que soit l'environnement
- `rebase.auth`, `rebase.storage`, `rebase.email`
- `fetch`, `Request`/`Response`, `URL`, `crypto.subtle`, `TextEncoder` — la plateforme web
- Toute dépendance ne nécessitant pas Node

**Réservé à Node :**

- `rebase.sql()` — la connexion propriétaire à la base de données est un socket TCP
- Un client Drizzle/`pg`/`mongodb` importé directement, pour la même raison
- Les modules natifs de Node : `fs`, `path`, `crypto` (le module Node — `globalThis.crypto` est portable), `child_process`, …
- Les packages basés sur ceux-ci : `jsonwebtoken`, `nodemailer`, `sharp`, `bcrypt`, …

**Bugs latents sur tous les runtimes** — il est recommandé de les corriger dans tous les cas :

- Lecture de `process.env` au niveau du module (voir [Configuration et secrets](/docs/backend/custom-functions/#configuration-and-secrets))
- Promesses sans attente ("fire-and-forget") au lieu de [`waitUntil`](/docs/backend/custom-functions/#background-work)
- Compter sur le fait qu'un gestionnaire continue de s'exécuter après l'expiration du délai de sa requête. Sur Node, c'est le cas ; c'est une caractéristique du processus, et non une garantie offerte par le framework

## Vérifier vos propres fonctions

`rebase build` affiche une ligne par observation nécessitant une action et consigne le verdict pour chaque fonction dans le manifeste du bundle :

```json
{
  "functions": [
    { "name": "hello", "file": "backend/functions/hello.js", "portable": true },
    { "name": "reports", "file": "backend/functions/reports.js", "portable": false,
      "requires": ["imports the Node built-in \"fs\""] }
  ]
}
```

`rebase doctor` signale la même chose sans nécessiter de build.

## Si vous avez besoin d'une branche spécifique à un runtime

`runtimeKey()` renvoie `"node"`, `"workerd"`, `"deno"`, `"bun"`, `"edge-light"`, `"fastly"` ou `"other"` ; `isNodeRuntime()` est la vérification standard. Utilisez-les pour dégrader gracieusement, non pour dupliquer une implémentation — une fonction qui nécessite deux implémentations distinctes correspond à deux fonctions.

```typescript
import { defineFunction, isNodeRuntime } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.get("/stats", async (c) => {
        if (!isNodeRuntime()) return c.json({ error: "Not available here" }, 501);
        const rows = await rebase.sql("SELECT count(*) AS total FROM jobs");
        return c.json({ totalJobs: Number(rows[0]?.total ?? 0) });
    });
});
```
