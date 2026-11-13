---
sourceHash: 78888eb91334da42
title: Portabilité du runtime
sidebar_label: Portabilité du runtime
description: Ce qu'importe une fonction personnalisée détermine si elle peut s'exécuter en dehors d'un processus Node — ce qui est portable, ce qui est réservé à Node, et comment rebase build et rebase doctor le signalent.
---

Une fonction personnalisée est une application Hono, et Hono s'exécute sur tous les runtimes JavaScript côté serveur. La possibilité que *votre* fonction puisse s'exécuter ailleurs que dans un processus Node dépend donc de ce que son propre fichier importe et utilise.

Rien ici ne constitue une restriction sur ce que vous pouvez écrire aujourd'hui. Chaque déploiement Rebase est un processus Node, une fonction qui lit un fichier ou ouvre un socket est tout à fait valide, et aucun build ni déploiement n'échoue à cause de cela. Cela est documenté afin que la réponse soit connue dès maintenant plutôt que découverte fichier par fichier plus tard.

**Portable — fonctionne sur tous les runtimes :**

- Tout ce qui est exporté depuis `@rebasepro/server/functions`
- `getDriver(c)` et `rebase.dataAsAdmin` — tous deux transitent par le même canal quel que soit l'endroit où ils s'exécutent
- `rebase.auth`, `rebase.storage`, `rebase.email`
- `fetch`, `Request`/`Response`, `URL`, `crypto.subtle`, `TextEncoder` — la plateforme web
- Toute dépendance qui ne nécessite pas Node

**Réservé à Node :**

- `rebase.sql()` — la connexion propriétaire à la base de données est un socket TCP
- Un client Drizzle ou `pg` directement importé, pour la même raison
- Les modules natifs de Node : `fs`, `path`, `crypto` (le module Node — `globalThis.crypto` est portable), `child_process`, …
- Les paquets basés sur ceux-ci : `jsonwebtoken`, `nodemailer`, `sharp`, `bcrypt`, …

**Bugs latents sur tous les runtimes** — il est recommandé de les corriger dans tous les cas :

- Lecture de `process.env` au niveau du scope du module (voir [Configuration et secrets](/docs/backend/custom-functions/#configuration-and-secrets))
- Promesses sans attente (« fire-and-forget ») au lieu de [`waitUntil`](/docs/backend/custom-functions/#background-work)
- Dépendre du fait qu'un gestionnaire continue de s'exécuter après l'expiration du délai de sa requête. C'est le cas sous Node ; il s'agit d'une propriété du processus, pas d'une promesse faite par le framework

## Vérifier vos propres fonctions

`rebase build` affiche une ligne par résultat exploitable et enregistre le verdict par fonction dans le manifeste du bundle :

```json
{
  "functions": [
    { "name": "hello", "file": "backend/functions/hello.js", "portable": true },
    { "name": "reports", "file": "backend/functions/reports.js", "portable": false,
      "requires": ["imports the Node built-in \"fs\""] }
  ]
}
```

`rebase doctor` signale la même chose sans effectuer de build.

## Si vous avez besoin d'une logique spécifique au runtime

`runtimeKey()` renvoie `"node"`, `"workerd"`, `"deno"`, `"bun"`, `"edge-light"`, `"fastly"` ou `"other"` ; `isNodeRuntime()` est la vérification habituelle. Utilisez-les pour une dégradation gracieuse, pas pour scinder une implémentation — une fonction qui nécessite deux implémentations correspond en réalité à deux fonctions distinctes.

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
