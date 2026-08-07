---
title: Deploying Rebase on Hetzner Cloud
description: Learn how to deploy Rebase on Hetzner Cloud using Docker Compose for excellent EU-based performance and data sovereignty.
sidebar_label: Hetzner Cloud
---

Hetzner Cloud is widely recognized for offering incredible performance-to-price ratios and is a top choice for projects requiring strict European data sovereignty and GDPR compliance (with datacenters in Nuremberg, Falkenstein, and Helsinki).

Deploying Rebase on Hetzner is easiest via Docker Compose on a standard Ubuntu cloud instance.

## 1. Provision a Server

1. Log into your Hetzner Cloud Console.
2. Click **Add Server**.
3. Choose your preferred Location (e.g., **Falkenstein** or **Nuremberg**).
4. Choose an Image: Select **Ubuntu 24.04** or **App -> Docker CE** (this pre-installs Docker for you).
5. Choose a Type: A `CPX21` (3 cores, 4GB RAM) or `CX32` (4 cores, 8GB RAM) provides excellent baseline compute for running Rebase + Postgres.
6. Add your SSH key and hit **Create**.

## 2. SSH and Setup

Once your server is provisioned, grab the public IP address.

```bash
ssh root@<your-server-ip>
```

If you didn't choose the Docker image, install Docker and Docker Compose explicitly:

```bash
apt update && apt install docker.io docker-compose-v2 -y
```

## 3. Clone and Configure Rebase

Clone your Rebase project directly onto the server instance. 

```bash
git clone https://github.com/your-username/your-rebase-repo.git /opt/rebase
cd /opt/rebase
```

Rebase provides a `docker-compose.yml` out of the box. You'll need to define your production environment variables. Create a `.env.production` file:

```bash
nano .env.production
```

Add your secrets:

```env
DATABASE_URL=postgresql://rebase_app:your_secure_db_password@postgres:5432/rebase
JWT_SECRET=generate_a_very_long_secure_random_string_here
REBASE_SERVICE_KEY=generate_another_very_long_secure_random_string
NODE_ENV=production
CORS_ORIGINS=https://admin.yourdomain.com
FRONTEND_URL=https://admin.yourdomain.com
ALLOW_REGISTRATION=false
```

*Be sure to update `docker-compose.yml` if you want to pull the Postgres password from an environment variable.*

## 4. Run the Stack

Bring the stack online using detached mode:

```bash
docker compose --env-file .env.production up -d --build
```

Docker will build your Node.js backend from the local `Dockerfile` and spin up the Postgres container. Once completed, your app will be running on `http://localhost:3001` (internal to the server).

## 5. Expose via Caddy or Nginx

You should never expose port 3001 directly to the internet without SSL. We recommend placing **Caddy** in front of your Rebase instance to automatically provision Let's Encrypt certificates.

Install Caddy:
```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

Edit your Caddyfile:
```bash
nano /etc/caddy/Caddyfile
```

Add the following (replace with your domain, which should have its A-Record pointing to this Hetzner IP):

```caddyfile
admin.yourdomain.com {
    reverse_proxy localhost:3001
}
```

Restart Caddy:
```bash
systemctl restart caddy
```

That's it! Your Rebase platform is securely hosted entirely within the EU.

## 6. Create the Database Schema

The stack is running, but Rebase only auto-creates the **auth** tables on boot — the tables for your own collections are **not** created automatically. Run this once against the production database, or every collection returns a "missing table" error. From your project checkout on the server (with dependencies installed), point `DATABASE_URL` at the Postgres container and push the schema:

```bash
pnpm run db:push
```

For versioned migrations, commit migration files with `pnpm run db:generate` and run `pnpm run db:migrate` instead. On startup the server logs a boxed warning naming exactly which tables are missing and the command to run.
