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

## 4. Set Environment Variables
The initial build might fail because it is entirely missing configuration. Let's fix that.

1. Click on the new Rebase GitHub service card.
2. Go to the **Variables** tab. 
3. Click **New Variable** and add:
   - `JWT_SECRET`: Generate a secure 32+ character random string.
   - `NODE_ENV`: Set to `production`
4. Click **Reference Variable** and select `DATABASE_URL` from the PostgreSQL service you provisioned. Railway will securely inject the internal Postgres URL at runtime.

## 5. Expose the Domain
1. In the Rebase service card, navigate to the **Settings** tab.
2. Scroll down to **Networking**.
3. Under **Public Networking**, click **Generate Domain**. Railway will provide a `.up.railway.app` testing URL. You can also securely attach a Custom Domain here.

Railway will automatically rebuild safely. Your EU-hosted platform is now entirely live!
