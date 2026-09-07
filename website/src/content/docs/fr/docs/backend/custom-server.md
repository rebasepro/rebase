---
sourceHash: aeb69aa6164eafbc
title: Intégration d'un Serveur Personnalisé
sidebar_label: Serveur Personnalisé (Express)
description: Comment intégrer les services Rebase Database et Realtime dans votre propre backend Node.js sans utiliser Hono ou le coordinateur Rebase.
---

# Intégration d'un Serveur Personnalisé

Rebase a été conçu pour être entièrement modulaire. Bien que le coordinateur `initializeRebaseBackend` fournisse un backend complet intégrant Hono, vous pouvez l'éviter entièrement et intégrer directement l'**Adaptateur de Base de Données** central et les **WebSockets Temps Réel** dans votre propre application Node.js (telle qu'Express, Fastify ou HTTP standard Node.js).

Le package `@rebasepro/server-postgres` est entièrement indépendant de tout framework. Il dépend uniquement de Drizzle ORM et du serveur `http.Server` standard de Node.js.

## Configuration de l'Environnement

Rebase fournit un utilitaire centralisé `loadEnv()` dans `@rebasepro/server` qui valide vos variables d'environnement par rapport à un schéma strict Zod. Appelez-le **après** avoir chargé votre fichier `.env` :

```typescript
import dotenv from "dotenv";
import { loadEnv } from "@rebasepro/server";

dotenv.config({ path: "../../.env" });

// Basique — uniquement les variables d'environnement de Rebase :
export const env = loadEnv();

// Étendu — ajoutez vos propres variables typées :
import { z } from "@rebasepro/server";
export const env = loadEnv({
    extend: z.object({
        SMTP_HOST: z.string().optional(),
        SMTP_PORT: z.string().default("587").transform(Number),
        STRIPE_SECRET_KEY: z.string(),
    })
});
// env.SMTP_HOST  → string | undefined  (entièrement typé)
// env.STRIPE_SECRET_KEY → string        (validé, requis)
```

Importer `z` depuis `@rebasepro/server` est nouveau <span class="since-badge" data-since="0.18">Since 0.18</span>. En 0.17
et avant, le paquet n'exportait aucun `z` : importez-le depuis `zod`, en
reprenant la version majeure utilisée par le runtime, et laissez votre bundler
dédupliquer les deux copies.

**Comportements clés :**
- Génère automatiquement des secrets temporaires `JWT_SECRET` et `REBASE_SERVICE_KEY` en développement pour vous permettre de démarrer sans configuration manuelle.
- Bloque les secrets générés automatiquement en production — vous devez les configurer explicitement.
- Valide que `CORS_ORIGINS` ou `FRONTEND_URL` est configuré en production.

Consultez `.env.example` dans l'application générée pour voir la liste complète des variables prises en charge.

## Utilisation de Rebase avec Express

Voici un exemple complet montrant comment initialiser l'adaptateur PostgreSQL de Rebase et les WebSockets temps réel au sein d'une application Express standard.

### 1. Installer les Dépendances

Vous aurez besoin du package du serveur Postgres ainsi que d'Express :

```bash
npm install @rebasepro/server-postgres @rebasepro/types express
```

### 2. Exemple d'Initialisation

```typescript
import express from 'express';
import { createServer } from 'http';
import { createPostgresBootstrapper } from '@rebasepro/server-postgres';

async function startServer() {
    const app = express();
    
    // 1. Vous DEVEZ créer le serveur HTTP Node brut pour que le serveur WebSocket puisse s'y lier
    const server = createServer(app);

    // 2. Initialiser directement le Postgres Bootstrapper
    const bootstrapper = createPostgresBootstrapper({
        connectionString: process.env.DATABASE_URL,
        // Optionnel : définissez n'importe quel schéma Drizzle ici si vous souhaitez des relations/requêtes typées
        // schema: { tables: { ... } } 
    });

    // 3. Initialiser le pilote (se connecte à la DB, démarre les écouteurs de réplication logique)
    const { driver, realtimeProvider } = await bootstrapper.initializeDriver({
        collections: [] // Passez vos collections Rebase ici si vous les utilisez
    });

    // 4. Attacher les WebSockets Rebase à votre serveur HTTP
    await bootstrapper.initializeWebsockets(
        server, 
        realtimeProvider, 
        driver
    );

    // --- Routes Express ---
    app.use(express.json());

    app.get('/', (req, res) => {
        res.send('Serveur Express en cours d\'exécution avec Rebase intégré !');
    });

    // Vous pouvez interagir directement avec le pilote Rebase n'importe où dans vos routes Express
    app.post('/custom-data', async (req, res) => {
        try {
            // Utiliser le pilote de base de données Rebase brut
            const result = await driver.save({
                collection: 'products',
                entity: req.body
            });
            res.json({ success: true, data: result });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // 5. Commencer l'écoute en utilisant l'instance de serveur brut (PAS app.listen)
    server.listen(3000, () => {
        console.log('Express et Rebase Realtime actifs sur le port 3000');
    });
}

startServer();
```

## Concepts Clés

### Serveur HTTP Natif
Étant donné que les WebSockets requièrent une requête HTTP `Upgrade`, vous **devez** lier Rebase à l'instance native `http.Server` de Node.js. Si vous appelez simplement `app.listen(3000)` dans Express, vous n'aurez pas accès à l'objet serveur sous-jacent nécessaire pour `initializeWebsockets()`.

### Contournement de Hono
En invoquant directement `createPostgresBootstrapper()` et en appelant manuellement `initializeDriver()` et `initializeWebsockets()`, vous contournez entièrement le coordinateur Rebase (`initializeRebaseBackend`). Cela signifie qu'aucune dépendance Hono n'est chargée, et que les API REST générées automatiquement, les routes d'interface utilisateur d'administration et les points de terminaison d'authentification ne sont pas montés.

Cela vous offre un contrôle complet sur votre interface d'API tout en profitant du puissant moteur WebSocket de réplication logique de Rebase et du pilote optimisé par Drizzle.
