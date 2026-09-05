---
title: Deploying Rebase on Railway
description: Deploy Rebase effortlessly with Railway natively supported Dockerfile parsing. Maintain EU focus.
sidebar_label: Railway
---

Railway is an incredibly popular modern PaaS (Platform as a Service) that takes the pain out of DevOps. It will automatically detect the Rebase Node framework and build it seamlessly. 

Additionally, Railway fully supports European deployment regions (Amsterdam), meaning you still enjoy strict regional hosting compliance.

## 1. Create a Project & EU Region
1. Login to your [Railway Account](https://railway.app/).
2. Click **New Project**.
3. Go to **Settings -> Default Region**, and explicitly set it to **Europe (Amsterdam)**. (If you do this *after* creating services, you may need to manually migrate them).

## 2. Provision PostgreSQL
1. Inside your project, click **New** -> **Database** -> **Add PostgreSQL**.
2. Wait a few seconds for the database to provision.
3. By default, Railway provides an internal `DATABASE_URL` variable. Click on the Postgres widget -> **Variables** to locate this connection string.

## 3. Deploy Rebase Code
1. Click **New** -> **GitHub Repo**.
2. Select your Rebase repository.
3. Railway will immediately detect the repository and look for a `Dockerfile`. Wait for the initial build to begin.

:::caution[Point Railway at the backend Dockerfile]
The scaffold's Dockerfile lives at `backend/Dockerfile`, not the repo root, and its build context must be the **repo root** (it copies `pnpm-workspace.yaml`, `backend/`, and `config/`). In the service's **Settings → Build**, set the **Dockerfile Path** to `backend/Dockerfile` and leave the **Root Directory** at the repository root. Otherwise Railway won't find a Dockerfile — or will build with the wrong context and fail.
:::

## 4. Set Environment Variables
The initial build might fail because it is entirely missing configuration. Let's fix that.

1. Click on the new Rebase GitHub service card.
2. Go to the **Variables** tab. 
3. Click **New Variable** and add:
   - `JWT_SECRET`: Generate a secure 32+ character random string.
   - `REBASE_SERVICE_KEY`: Generate another secure 32+ character random string.
   - `NODE_ENV`: Set to `production`
   - `CORS_ORIGINS`: Your frontend domain (e.g., `https://your-app.up.railway.app`)
   - `FRONTEND_URL`: Same as CORS_ORIGINS
   - `DISABLE_SELF_REGISTRATION`: `true`
   - `REBASE_ADMIN_EMAIL`: the first administrator's address
   - `REBASE_ADMIN_PASSWORD`: at least 12 characters

   The last three are how this service gets an administrator at all: in
   production the first account to register is not promoted, so nothing else
   produces the first signed-in caller. Set them before the service first
   serves traffic — see [Your first
   admin](/docs/getting-started/deployment/#your-first-admin).
4. Click **Reference Variable** and select `DATABASE_URL` from the PostgreSQL service you provisioned. Railway will securely inject the internal Postgres URL at runtime.

## 5. Expose the Domain
1. In the Rebase service card, navigate to the **Settings** tab.
2. Scroll down to **Networking**.
3. Under **Public Networking**, click **Generate Domain**. Railway will provide a `.up.railway.app` testing URL. You can also securely attach a Custom Domain here.

Railway will automatically rebuild safely. Your EU-hosted platform is now entirely live!

## 6. Create the Database Schema

The app is running, but Rebase only auto-creates the **auth** tables on boot — the tables for your own collections are **not** created automatically. Run this once against the production database, or every collection returns a "missing table" error:

```bash
pnpm run db:push
```

Run it from a checkout of your project (or your CI job) with `DATABASE_URL` set to your Postgres service's **public** connection string (found under the Postgres widget → **Connect**; the referenced internal `DATABASE_URL` is only reachable from inside Railway). The deployed image doesn't include the CLI, so this doesn't run inside the container. For versioned migrations, commit migration files with `pnpm run db:generate` and run `pnpm run db:migrate` instead.
