<p align="center">
  <a href="https://rebase.pro">
    <img src="https://rebase.pro/img/logo_small.png" width="240px" alt="Rebase logo" />
  </a>
</p>

<h1 align="center">Rebase</h1>
<h3 align="center">The Ultimate Open-Source Backend-as-a-Service & Admin Panel Framework</h3>
<p align="center">
  <strong>Ship production-ready backends and radically extensible back-office apps in minutes.</strong><br/>
  Own your data, own your code. The absolute easiest way to build on PostgreSQL and Firebase.
</p>

<p align="center">
  <a href="https://demo.rebase.pro">Live Demo</a> •
  <a href="https://rebase.pro/docs">Documentation</a> •
  <a href="https://rebase.pro/features">Features</a> •
  <a href="https://github.com/rebasepro/rebase">GitHub</a> •
  <a href="https://discord.gg/fxy7xsQm3m">Discord</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@rebasepro/core"><img src="https://img.shields.io/npm/v/@rebasepro/core.svg?style=flat-square&color=orange" alt="NPM Version" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-purple.svg?style=flat-square" alt="License: MIT" /></a>
  <a href="https://www.npmjs.com/package/@rebasepro/core"><img src="https://img.shields.io/npm/dw/@rebasepro/core?style=flat-square&color=blue" alt="NPM Downloads" /></a>
  <a href="https://discord.gg/fxy7xsQm3m"><img src="https://img.shields.io/discord/1013768502458470442?style=flat-square&logo=discord&logoColor=white&label=Discord" alt="Discord" /></a>
</p>

<br/>

<p align="center">
  <img src="https://rebase.pro/img/demo_products.png" width="800px" alt="Rebase Dashboard" />
</p>

---

## What is Rebase?

Rebase is a **developer-first**, open-source Backend-as-a-Service (BaaS) and admin panel framework built with **React** and **TypeScript**. 
It's designed exclusively for developers who demand complete control and unlimited extensibility over their internal tools and backend infrastructure. By abstracting the heavy lifting of API generation, database synchronization, UI state, and routing, it allows you to deploy a fully-featured backend and robust CRUD panels in minutes—while giving you the freedom to inject any custom React component or serverless logic you need.

### ✨ Key Highlights

- 🔓 **No Vendor Lock-in** — Self-host anywhere. You are entirely in control of your infrastructure, your code, and your database.
- ⚡ **Batteries-Included Docker Deployment** — Spin up a production-ready application locally via a single `docker compose up`.
- 🧩 **Radical Extensibility** — Not constrained to pre-built widgets. If you can build it in React, you can build it in Rebase.
- 🔥 **Native Database Adapters** — Real-time synchronization with Firebase/Firestore, PostgreSQL, and MongoDB right out of the box.
- 🎨 **Component Library** — Uses an incredibly fast, premium design system built on **Tailwind CSS (v4)** and Radix UI.
- 🤖 **AI-powered Automations** — Leverage DataTalk for natural language queries and AI to effortlessly infer and generate schemas from existing data.

---

## ⚡ Quick Start: Zero to Production in 60 Seconds

Scaffold a complete, self-hosted Rebase application connected to your database instantly.

```bash
pnpm dlx rebase init my-rebase-app
```

Configure your database in `.env`, then start everything:
```bash
cd my-rebase-app
pnpm dev
```

You're done! Your admin panel is running at `http://localhost:5173` and the API at `http://localhost:3001`. 

---

## Developer Features

### 🚀 Complete Backend-as-a-Service (BaaS)

Get a production-ready backend out of the box. Includes a strongly-typed ORM, Authentication, Storage, Email Service, and automatic REST API generation. Interact with your entire system anywhere using the global, type-safe `rebase` singleton.

### 🏓 Premium Admin Panel & CMS

An incredibly fast, windowed spreadsheet view to manage your database with inline editing, real-time updates, filtering, sorting, and text search. Switch flawlessly between multiple view modes: **spreadsheet table**, **card grid**, and **Kanban board**.

### 🔒 Typed Schema & Database Migrations

Define your data models using pure TypeScript collections. Rebase automatically generates your Drizzle ORM schema, handles PostgreSQL database migrations, and keeps your live database perfectly in sync using built-in tooling like `rebase doctor`.

### ⚡ Extensible API & Edge Functions

Effortlessly drop custom Hono routes or scheduled tasks into the `functions/` and `crons/` directories. Rebase auto-loads them and automatically injects database access and JWT authentication middleware.

### 📜 Standalone Scripting

Write standalone data manipulation or maintenance scripts effortlessly. Rebase's CLI automatically persists the local dev server URL to `.rebase-dev-url`, enabling zero-config local scripts that connect directly to your running backend using the `@rebasepro/client` SDK.

### 🧩 Custom Views & React Extensibility

Because the Rebase Admin Panel is just a React framework, you can build entirely custom views (dashboards, previews, native charts) and drop them directly into the main navigation or as entity-level tabs. Utilize built-in hooks to interact fluently with Rebase's internal state mechanism.

### 📥📤 Deep File & Data Management

Import data from **CSV, JSON, and Excel** with an intuitive field mapper. Scale seamlessly with full Storage hooks for image resizing, video optimization, and file mapping components built-in to the interface.

### 👮 Roles, Permissions & Security Rules

Deploy granular, role-based access control (RBAC) and context-aware security rules directly from your codebase logic to secure your collections, fields, and serverless functions.

---

## 🛠️ Core Technologies

We don't reinvent the wheel. Rebase is built entirely upon the most modern, battle-tested web standards:

| Technology | What we use it for |
|---|---|
| 💙 **TypeScript 5.x** | End-to-end absolute type safety |
| ⚛️ **React 18+** | Lightning-fast, component-driven UI |
| 🌊 **Tailwind CSS v4** | Premium, utility-first styling |
| 🔌 **WebSockets** | Blazing-fast real-time synchronization |
| 🗄️ **Drizzle ORM** | Type-safe SQL migrations and query building |
| 🧱 **Radix UI** | Unstyled, accessible UI primitives |
| 📝 **TipTap v3** | The ultimate headless rich text editor |

---

## 🎨 Standalone UI Library (`@rebasepro/ui`)

Rebase exposes its premium design engine as a completely independent library. Fully typed, highly accessible, and gorgeously customized via Tailwind CSS v4. Drop it into **any** of your React projects instantly:

```bash
pnpm add @rebasepro/ui
```

---

## Demo

Explore a live interactive sandbox containing all core features — you can modify data freely since instances are routinely restored:

**👉 [demo.rebase.pro](https://demo.rebase.pro)**

---

## 🏗️ Modular Monorepo Architecture

Don't want the whole framework? No problem. Rebase is structured as an ultra-modular monorepo, allowing you to install **only** the layers you strictly need:

| Package | Description |
|---|---|
| `@rebasepro/core` | Core CMS framework, types, hooks, and components |
| `@rebasepro/ui` | Standalone component library (Tailwind + Radix) |
| `@rebasepro/postgresql` | PostgreSQL data source delegate |
| `@rebasepro/firebase` | Firebase/Firestore data source delegate |
| `@rebasepro/mongodb` | MongoDB data source delegate |
| `@rebasepro/editor` | Notion-style rich text editor |
| `@rebasepro/cli` | Developer CLI for deep project configurations and scaffolding |
| `@rebasepro/formex` | High-performance, lightweight React form management |

---

## Support & Community

- 📖 [Documentation](https://rebase.pro/docs)
- 💬 [Discord Community](https://discord.gg/fxy7xsQm3m)
- 🐛 [GitHub Issues](https://github.com/rebasepro/rebase/issues)
- 📝 [Changelog](https://rebase.pro/docs/changelog)

---

## Trusted By

Developers operating enterprise architectures at **Google**, **Microsoft**, **IKEA**, and thousands of open-source teams worldwide.

---

## License

Rebase is proudly open-source and licensed under the **MIT License**.
See the full [License](https://github.com/rebasepro/rebase/blob/main/LICENSE) for details.
