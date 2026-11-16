---
title: Windows
sidebar_label: Windows
description: Install and run a Rebase project on Windows — what works natively, the one tool (Atlas) that needs its own Windows binary for db push, db generate and db migrate, and when to use WSL2 instead.
---

A Rebase project installs and runs on Windows. One tool needs an extra step:
[Atlas](https://atlasgo.io/), the engine that plans schema migrations. Its npm
package, `@ariga/atlas`, ships Linux and macOS builds only, so on Windows you
install Atlas's own Windows binary instead.

Only three commands use Atlas: [`rebase db push`, `rebase db generate` and
`rebase db migrate`](/docs/cli/database/#commands). Running the app does not. `rebase dev` creates missing
tables and columns at boot without it, so you can start building before you
install it.

Rebase's CI runs on Linux and macOS. If you want your machine to match a Linux
server exactly, use [WSL2](#alternative-wsl2) instead.

## 1. Prerequisites

- **Node.js** 22.22+ and **pnpm**, as in the [Quickstart](/docs/getting-started/quickstart/#prerequisites)
- PowerShell, for the Atlas step below

## 2. Create the project

```bash
pnpm dlx @rebasepro/cli init my-app
```

The install prints a failed `preinstall` for `@ariga/atlas`, with
`Unsupported platform`, and then finishes. That is expected. The scaffold
declares `@ariga/atlas` as an optional dependency, so a platform it cannot
install on skips it and the install carries on.

```bash
cd my-app
pnpm dev
```

This needs nothing more. The app, the admin panel and the managed development
database all run without Atlas.

## 3. Install Atlas for the schema commands

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

## A project created before this

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
[step 3](#3-install-atlas-for-the-schema-commands). On Linux and macOS nothing
changes, because an optional dependency that can install is installed. That
includes CI and the deploy image.

## Alternative: WSL2

[WSL2](https://learn.microsoft.com/windows/wsl/install) runs a real Linux
distribution, so the npm package installs normally and none of the steps above
apply. It is also what Docker Desktop runs on.

Keep the project inside the Linux filesystem (`~/code/my-app`), not under
`/mnt/c/`. Reading files across that boundary makes installs and the file watcher
slow. Open the project from Windows with the
[VS Code WSL extension](https://code.visualstudio.com/docs/remote/wsl), or
through `\\wsl$\`.

## Where to go next

- [Quickstart](/docs/getting-started/quickstart/): the rest of a first run, the same on every platform
- [Database commands](/docs/cli/database/): what `db push`, `db generate` and `db migrate` each do
- [Troubleshooting](/docs/troubleshooting/): the failures that stop a backend from starting, and what each one looks like
