---
title: Windows
sidebar_label: Windows
description: Install a Rebase project and use its database commands on Windows.
---

Rebase projects run on Windows. The scaffold installs Ptah Compat, including
its Windows executable, through the package manager. You do not need to
download a database migration tool separately.

## Create a project

Install Node.js 22.22+ and pnpm, then run:

```bash
pnpm dlx @rebasepro/cli init my-app
cd my-app
pnpm dev
```

The database commands use the installed Ptah Compat package:

```bash
pnpm run db:push
pnpm run db:generate
pnpm run db:migrate
```

The package provides native executables for Windows x64 and Arm64. If
[`rebase doctor`](/docs/cli/#rebase-doctor) reports a missing executable,
reinstall the project's dependencies with optional dependencies enabled.

## Upgrade an older project

Projects created before the Ptah integration may still depend on
`@ariga/atlas`. Run `rebase upgrade` when moving to a Rebase release that
uses Ptah Compat. The upgrade replaces that dependency with
`@stokaro/ptah-compat`. Run `pnpm install` afterward.

## WSL2

[WSL2](https://learn.microsoft.com/windows/wsl/install) is an alternative
if you prefer a Linux development environment. Keep the project in the
Linux filesystem (`~/code/my-app`) for faster installs and file watching.

Continue with the [Quickstart](/docs/getting-started/quickstart/) or the
[database command guide](/docs/cli/database/).
