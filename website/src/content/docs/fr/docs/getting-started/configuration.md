---
sourceHash: 3346d2728eb8f2e4
title: Environnement et Configuration
sidebar_label: Configuration
description: Toutes les variables d'environnement et options de configuration pour les projets Rebase.
---

## Variables d'environnement

Toute la configuration est effectuée via des variables d'environnement dans votre fichier `.env` à la racine du projet.

> **Important** : Rebase utilise **Zod** pour valider les variables d'environnement au démarrage dans `src/env.ts`. Si des variables requises sont manquantes ou mal formatées (comme des URLs ou des ports), le serveur ne démarrera pas et fournira un message d'erreur clair.

### Requises

| Variable | Description | Exemple |
|----------|-------------|---------|
| `DATABASE_URL` | Chaîne de connexion PostgreSQL | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Clé secrète pour la signature des tokens JWT. Utilisez une chaîne aléatoire forte (min 32 caractères). | `a1b2c3d4e5...` |

### Frontend

| Variable | Description | Défaut |
|----------|-------------|---------|
| `VITE_API_URL` | URL de l'API backend pour le SDK client. **À définir en développement seulement.** | origine de la page |
| `VITE_GOOGLE_CLIENT_ID` | ID client Google OAuth. Active la fonction "Se connecter avec Google". | — |

### Backend

| Variable | Description | Défaut |
|----------|-------------|---------|
| `PORT` | Port du serveur HTTP backend | `3001` |
| `LOG_LEVEL` | Niveau de verbosité des logs : `error`, `warn`, `info`, `debug` | `info` |
| `NODE_ENV` | Environnement : `development` ou `production` | `development` |

### Authentification

| Variable | Description | Défaut |
|----------|-------------|---------|
| `JWT_SECRET` | Secret pour la signature JWT (requis si l'authentification est activée) | — |
| `JWT_ACCESS_EXPIRES_IN` | Durée de vie du token d'accès | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Durée de vie du token de rafraîchissement | `30d` |
| `ALLOW_REGISTRATION` | Permettre aux nouveaux utilisateurs de s'inscrire (`true`/`false`). Le premier utilisateur peut toujours s'inscrire. | `true` |
| `GOOGLE_CLIENT_ID` | ID client Google OAuth (validation backend) | — |

### Stockage

| Variable | Description | Défaut |
|----------|-------------|---------|
| `STORAGE_TYPE` | Backend de stockage : `local` ou `s3` | `local` |
| `STORAGE_PATH` | Chemin de base pour le stockage local | `./uploads` |
| `S3_BUCKET` | Nom du bucket S3 (lorsque `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Région AWS | — |
| `S3_ACCESS_KEY_ID` | Clé d'accès AWS | — |
| `S3_SECRET_ACCESS_KEY` | Clé secrète AWS | — |
| `S3_ENDPOINT` | Endpoint S3 personnalisé (pour MinIO, Cloudflare R2, etc.) | — |

### E-mail (Optionnel)

| Variable | Description |
|----------|-------------|
| `SMTP_HOST` | Hôte du serveur SMTP |
| `SMTP_PORT` | Port du serveur SMTP |
| `SMTP_SECURE` | Enable secure connection (`true`/`false`) |
| `SMTP_USER` | Nom d'utilisateur SMTP |
| `SMTP_PASS` | Mot de passe SMTP |
| `EMAIL_FROM` | Adresse de l'expéditeur pour les e-mails système |

## Objet de Configuration Backend

L'objet `RebaseBackendConfig` passé à `initializeRebaseBackend()` offre un contrôle programmatique :

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";
import { env } from "./env";

await initializeRebaseBackend({
    app,
    server,
    collectionsDir: "./config/collections",
    basePath: "/api",        // Base path for all API routes (default: "/api")

    database: createPostgresAdapter({
        connection: db,
        schema: { tables, enums, relations }
    }),

    auth: {                  // Authentication config
        jwtSecret: env.JWT_SECRET,
        accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
        refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
        requireAuth: true,    // Require auth for data API (default: true)
        allowRegistration: env.ALLOW_REGISTRATION,
        google: env.GOOGLE_CLIENT_ID
            ? {
                clientId: env.GOOGLE_CLIENT_ID,
                clientSecret: env.GOOGLE_CLIENT_SECRET
            }
            : undefined,
        serviceKey: env.REBASE_SERVICE_KEY
    },

    storage: env.STORAGE_TYPE === "s3"
        ? {
            type: "s3",
            bucket: env.S3_BUCKET!,
            region: env.S3_REGION,
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
            endpoint: env.S3_ENDPOINT
        }
        : {
            type: "local",
            basePath: env.STORAGE_PATH || "./uploads"
        },

    history: true,           // Enable entity change history

    enableSwagger: true,     // Enable OpenAPI docs at /api/docs

    logging: {
        level: "info"
    }
});
```

## Prochaines étapes

- **[Déploiement](/docs/getting-started/deployment)** — Guide de déploiement en production
- **[Présentation du Backend](/docs/backend)** — Référence complète de la configuration backend
