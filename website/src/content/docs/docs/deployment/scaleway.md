---
title: Deploying Rebase on Scaleway
description: Learn how to deploy Rebase on Scaleway for secure, French-based cloud infrastructure using Serverless Containers.
sidebar_label: Scaleway
---

Scaleway is a premier European cloud provider based in France with datacenters in Paris, Amsterdam, and Warsaw. It's an excellent choice for organizations prioritizing EU data sovereignty. 

We recommend utilizing Scaleway's **Managed Database** for reliable Postgres backing and **Serverless Containers** to dynamically scale the Rebase Node.js application.

## 1. Create a Managed Postgres Database

Scaleway's Managed Databases offer automatic backups and high availability.

1. In the Scaleway Console, go to **PostgreSQL**.
2. Click **Create a Database Instance**.
3. Choose a Region (e.g., Paris - `PAR1`).
4. Select a Node Type (a standard **Play2-Pico** or **Pro2-XXS** works well).
5. Add a database name (`rebase_db`) and define an incredibly secure user password.
6. Once deployed, note down the **Connection string** (URI) from the dashboard. It will look like: 
   `postgres://user:password@ip:port/rebase_db`

## 2. Build and Push the Container

Scaleway Serverless Containers run standard Docker images. First, build the Rebase backend locally and push it to the Scaleway Container Registry.

1. Go to **Container Registry** in the Scaleway Console and create a Namespace (e.g., `rebase-apps`).
2. Log in to the registry from your local terminal using the provided instructions.
3. Build your Rebase app using the generated `Dockerfile`, **from the project root** — the backend Dockerfile needs the whole workspace as its build context (it copies `pnpm-workspace.yaml`, `backend/`, and `config/`), so `./backend` as the context will fail:

```bash
docker build -t rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest -f backend/Dockerfile .
```

4. Push the image:

```bash
docker push rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest
```

## 3. Deploy Serverless Container

Now deploy the image completely serverless without managing infrastructure.

1. Navigate to **Serverless Containers**.
2. Click **Create a Container**.
3. Choose the image you just pushed from the Container Registry.
4. Set the Port to **3001**.
5. Under Environment Variables, add the following securely:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | The URI from your Managed Postgres step |
| `JWT_SECRET` | A secure 32+ character random string for signing auth tokens |
| `REBASE_SERVICE_KEY` | A secure 32+ character random string |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Your frontend domain (e.g., `https://yourdomain.com`) |
| `FRONTEND_URL` | Your frontend URL (used for email links and CORS fallback) |
| `ALLOW_REGISTRATION` | `false` (set to `true` only during initial setup) |

6. Click **Deploy Container**.

Scaleway will immediately provision the container and provide you with a public endpoint URL (e.g., `https://rebase-backend-xxxx.functions.fnc.fr-par.scw.cloud`). 

*Note: For strict data compliance, verify that your Scaleway Organization details reflect your European corporate entity.*

## 4. Create the Database Schema

The container is running, but Rebase only auto-creates the **auth** tables on boot — the tables for your own collections are **not** created automatically. Run this once against the production database, or every collection returns a "missing table" error:

```bash
pnpm run db:push
```

Run it from a checkout of your project (or your CI job) with `DATABASE_URL` set to your Scaleway Managed Database connection string. The deployed image doesn't include the CLI, so this doesn't run inside the container. For versioned migrations, commit migration files with `pnpm run db:generate` and run `pnpm run db:migrate` instead.

## Related

- [Deployment Guide](/docs/getting-started/deployment/) — the build, the artifacts and the boot sequence every platform shares
- [Environment & Configuration](/docs/getting-started/configuration/) — every variable the runtime reads, and which ones production refuses to start without
- [Self-Hosting](/docs/deployment/self-hosting/) — running it on a machine you own
