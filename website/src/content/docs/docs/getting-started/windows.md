---
title: Windows
sidebar_label: Windows
description: Install a Rebase project and use its database commands on Windows.
---

Rebase projects run on Windows. Since Rebase 0.34, the scaffold installs Ptah Compat, including
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

See [Upgrade a PostgreSQL project to Rebase 0.34](/docs/cli/#upgrade-a-postgresql-project-to-rebase-034) for the package switch.

## Rebase 0.33 and earlier

### 3. Install Atlas for the schema commands

Install Atlas for the schema commands while your PostgreSQL driver still uses it.

Download Atlas's Windows binary, save it as `atlas.exe` and put its folder on
your user `PATH`. In PowerShell:

```powershell
$dir = "$env:LOCALAPPDATA\Programs\atlas"
New-Item -ItemType Directory -Force $dir | Out-Null
Invoke-WebRequest https://release.ariga.io/atlas/atlas-windows-amd64-v1.2.3.exe -OutFile "$dir\atlas.exe"
[Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path", "User") + ";$dir", "User")
```

Open a new terminal, so it picks up the new `PATH`, and check it:

```powershell
atlas version
```

Version 1.2.3 is the oldest release the scaffold accepts (`"@ariga/atlas": "^1.2.3"`).
On Linux and macOS the install takes the newest 1.x, so any later 1.x release
works here too: swap the version in the URL. Only an x64 build is published;
Windows on Arm runs it under emulation.

The CLI looks in `node_modules/.bin` first and then asks Windows (`where atlas`),
so once `atlas.exe` is on `PATH` the three commands find it:

```bash
pnpm run db:push
```

[`rebase doctor`](/docs/cli/#rebase-doctor) checks it too. Until `atlas.exe` is on `PATH` it warns, and links
back to this page.

### If an older scaffold fails to install

A project scaffolded by an older `@rebasepro/cli` declares `@ariga/atlas` under
`dependencies`, and its install fails on Windows with
`ELIFECYCLE Command failed with exit code 1`. Move it to `optionalDependencies`
in `backend/package.json`:

```json
{
    "optionalDependencies": {
        "@ariga/atlas": "^1.2.3"
    }
}
```

Remove it from `dependencies`, run `pnpm install`, and then follow
the Atlas installation above. On Linux and macOS nothing
changes, because an optional dependency that can install is installed. That
includes CI and the deploy image.

## WSL2

[WSL2](https://learn.microsoft.com/windows/wsl/install) is an alternative
if you prefer a Linux development environment. Keep the project in the
Linux filesystem (`~/code/my-app`) for faster installs and file watching.

Continue with the [Quickstart](/docs/getting-started/quickstart/) or the
[database command guide](/docs/cli/database/).
