---
title: Deploying Rebase on Microsoft Azure
description: Deploy your Rebase instance securely on Azure using Azure Database for PostgreSQL and Azure Container Apps.
sidebar_label: Azure
---

Microsoft Azure offers tight integrations and enterprise compliance. The optimal architecture for running Rebase on Azure involves using **Azure Database for PostgreSQL - Flexible Server** for the data layer and **Azure Container Apps** for hosting the backend container.

To adhere to European data compliance and fast local response times, provision your resources in regions like **West Europe (Amsterdam)**, **North Europe (Ireland)**, or **France Central (Paris)**.

## 1. Provision PostgreSQL Flexible Server

1. From the Azure Portal, search for and select **Azure Database for PostgreSQL servers**.
2. Click **Create** and select **Flexible Server**.
3. Choose your Resource Group and set your preferred EU Region.
4. Select your Compute size (e.g., General Purpose or Burstable `B2s` for smaller deployments).
5. Setup the **Authentication** tab with an Admin username and a secure password.
6. Under **Networking**, ensure "Allow public access from any Azure service within Azure to this server" is checked so your Container App can connect, or configure a secure VNet.
7. Note down your server name and assemble the connection URI:
   `postgresql://your_admin:YOUR_PASSWORD@your-server-name.postgres.database.azure.com:5432/postgres`

## 2. Build and Push to Azure Container Registry (ACR)

Azure Container Apps will pull your Docker image from ACR.
1. Create a new **Container Registry** in your chosen EU region.
2. Login from your CLI:
   ```bash
   az acr login --name YourRegistryName
   ```
3. Build and push the Rebase image from your local repository:
   ```bash
   docker build -t yourregistryname.azurecr.io/rebase-backend:latest ./backend
   docker push yourregistryname.azurecr.io/rebase-backend:latest
   ```

## 3. Deploy Azure Container App

Azure Container Apps provides a serverless container environment with built-in HTTPS ingress.

1. Search the portal for **Container Apps** and click **Create**.
2. Create a new Container Apps Environment in your EU region.
3. In the **Container** tab, point to your ACR registry and select the `rebase-backend:latest` image.
4. Set the **Environment variables**:

| Name | Value |
|------|-------|
| `DATABASE_URL` | Your Azure Postgres connection string |
| `JWT_SECRET` | A Secure random 32+ character string |
| `NODE_ENV` | `production` |

5. Under the **Ingress** tab, explicitly Enable Ingress.
6. Set the Target Port to **3001**.
7. Complete the creation. Azure will automatically provision the container and provide you an Application URL secured with TLS!
