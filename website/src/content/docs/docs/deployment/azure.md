---
title: Deploying Rebase on Microsoft Azure
description: Deploy your Rebase instance securely on Azure using Azure Database for PostgreSQL and Azure Container Apps.
sidebar_label: Azure
---

Microsoft Azure offers tight integrations and enterprise compliance. The optimal architecture for running Rebase on Azure uses **Azure Database for PostgreSQL – Flexible Server** for the data layer and **Azure Container Apps** for the runtime.

To adhere to European data compliance and fast local response times, provision your resources in regions like **West Europe (Amsterdam)**, **North Europe (Ireland)**, or **France Central (Paris)**.

Nothing on this page is Azure-specific about your project. A Rebase deployment is two separable pieces — the published runtime image, and the **bundle** that `rebase build` produces — and the same bundle runs under Docker Compose on a laptop, on Rebase Cloud, under the [Helm chart](/docs/deployment/kubernetes) and here.

## 1. Provision PostgreSQL Flexible Server

1. From the Azure Portal, search for and select **Azure Database for PostgreSQL servers**.
2. Click **Create** and select **Flexible Server**.
3. Choose your Resource Group and set your preferred EU Region.
4. Select your Compute size (e.g., General Purpose, or Burstable `B2s` for smaller deployments).
5. Set up the **Authentication** tab with an admin username and a secure password.
6. Under **Networking**, ensure "Allow public access from any Azure service within Azure to this server" is checked so your Container App can connect, or configure a secure VNet.
7. Note your server name and assemble the connection URI:
   `postgresql://your_admin:YOUR_PASSWORD@your-server-name.postgres.database.azure.com:5432/postgres`

If your collections declare a `vector` property, enable the extension once: Azure gates it behind the server parameter `azure.extensions`, then `CREATE EXTENSION vector;`.

## 2. Build the bundle and bake it into an image

There is **no application image to build from your source**. `rebase build` produces a `dist-bundle` directory with your compiled collections, functions, crons and — if your project declares a static app — your built frontend. The published runtime image runs it:

```bash
rebase build
```

Container Apps pulls from a registry, so bake the bundle into a derived image. Three lines, and it pins exactly what runs:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.17.3
COPY dist-bundle /bundle
```

1. Create a **Container Registry** in your chosen EU region.
2. Log in from your CLI:
   ```bash
   az acr login --name YourRegistryName
   ```
3. Build and push, from the project root:
   ```bash
   docker build -t yourregistryname.azurecr.io/rebase-backend:latest .
   docker push yourregistryname.azurecr.io/rebase-backend:latest
   ```

Upgrading Rebase later is a change to that `FROM` line. Your bundle is untouched.

## 3. Deploy the Container App

Azure Container Apps provides a serverless container environment with built-in HTTPS ingress.

1. Search the portal for **Container Apps** and click **Create**.
2. Create a new Container Apps Environment in your EU region.
3. In the **Container** tab, point to your ACR registry and select the `rebase-backend:latest` image.
4. Set the **Environment variables**:

| Name | Value |
|------|-------|
| `DATABASE_URL` | Your Azure Postgres connection string |
| `JWT_SECRET` | A secure random 32+ character string |
| `REBASE_SERVICE_KEY` | A secure random 32+ character string |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | Your frontend domain (e.g., `https://yourdomain.com`) |
| `FRONTEND_URL` | Your frontend URL (used for email links and CORS fallback) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | The first administrator's address, set **before the first boot** |
| `REBASE_ADMIN_PASSWORD` | At least 12 characters |

The last three are how this deployment gets an administrator at all: in production the first account to register is not promoted, so nothing else produces the first signed-in caller. See [Your first admin](/docs/getting-started/deployment/#your-first-admin). Store the secrets as Container Apps secrets and reference them, rather than as plain environment values.

5. Under the **Ingress** tab, enable ingress.
6. Set the Target Port to **8080** — the port the runtime image listens on unless `PORT` says otherwise.
7. Point the health probe at `/livez`. Not `/health`: that one performs a database round-trip, so a liveness probe on it restarts a healthy container during a brief database hiccup.
8. Complete the creation. Azure provisions the container and gives you an Application URL secured with TLS.

## 4. The schema

**The runtime creates missing tables at boot, including your collections'.** `REBASE_MIGRATE_ON_BOOT` defaults to `ensure`, which is additive across the whole schema — it creates missing tables, columns and enum types and applies their row-level security — so the first start against an empty server comes up serving your collections.

What `ensure` never does is change something that already exists: it does not alter a column type, drop anything, or edit an existing enum's labels, because a container restart must not reshape a schema as a side effect of a deploy.

Two things therefore still need the CLI, run from a checkout or a CI job with `DATABASE_URL` pointed at your Flexible Server (add a firewall rule allowing your client IP if needed):

```bash
rebase db push
```

- **Junction-table RLS** for many-to-many relations.
- **Any change that is not purely additive** — a renamed column, a narrowed type, a removed field.

The runtime image ships without the CLI, so this never runs inside the container. For versioned migrations, commit migration files with `rebase db generate` and run `rebase db migrate` as a release step instead.

## File storage

Container Apps replicas have no durable disk, so local file storage is silent data loss and the runtime refuses it in production. Create an Azure Storage account and use its S3-compatible surface, or an S3-compatible bucket in the same region, with `STORAGE_TYPE=s3` — see [Storage](/docs/backend/storage).

## Next steps

- [Deployment](/docs/getting-started/deployment) — the production checklist, and the first-admin rules every platform shares.
- [Configuration](/docs/getting-started/configuration) — every environment variable the runtime reads.
