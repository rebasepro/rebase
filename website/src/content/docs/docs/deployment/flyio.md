---
title: Deploying Rebase on Fly.io
description: Learn how to deploy Rebase globally or restrict it to European data centers using Fly.io.
sidebar_label: Fly.io
---

Fly.io allows you to host Docker containers close to your users via their global anycast network. Fly is highly configurable regarding data routing, making it an excellent choice for deploying Rebase applications with a strict European data focus.

Fly.io features data centers in **Amsterdam (ams)**, **Frankfurt (fra)**, **Madrid (mad)**, and **Paris (cdg)**. 

## 1. Initialize the Fly App
From your local Rebase repository, after ensuring the Fly CLI (`flyctl`) is installed, run:

```bash
fly launch
```

1. **App Name:** `my-rebase-app`
2. **Organization:** Personal or your corporate Org.
3. **Region:** When prompted for a region, explicitly choose a European datacenter such as **Frankfurt (fra)** or **Paris (cdg)**.
4. **Database:** When prompted to setup a Postgres database, say **Yes**. Fly will automatically create a Postgres cluster in the *same region* and securely inject the `DATABASE_URL` into your app.
5. **Redis:** Say **No**.

*Do not deploy just yet when prompted.* We need to set a critical environment variable first.

## 2. Set Production Secrets
Before your application spins up in production, you must inject the required secrets and configuration.

Run the following command locally:
```bash
fly secrets set \
  JWT_SECRET=your_super_long_randomly_generated_secure_string \
  REBASE_SERVICE_KEY=another_super_long_randomly_generated_secure_string \
  CORS_ORIGINS=https://my-rebase-app.fly.dev \
  FRONTEND_URL=https://my-rebase-app.fly.dev \
  ALLOW_REGISTRATION=false \
  -a my-rebase-app
```

## 3. Validate Internal Configuration
Fly will have generated a `fly.toml` file at the root of your project. Verify that the internal port explicitly aligns with the Rebase default configuration (`3001`):

```toml
# fly.toml
app = "my-rebase-app"
primary_region = "fra"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 3001 # Make sure this matches your Hono app port
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 1
```

## 4. Deploy

Your data is localized, your database is provisioned, and your secrets are injected. Start the deployment:

```bash
fly deploy
```

Once parsing and uploading completes, your application will come online automatically. Run `fly open` to view your deployed app in the browser!
