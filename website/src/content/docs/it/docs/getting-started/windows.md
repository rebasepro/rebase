---
sourceHash: f1a8ff20d10b3dbd
title: Windows
sidebar_label: Windows
description: Installa un progetto Rebase e usa i comandi del database su Windows.
---

**Rebase 0.35+**

I progetti Rebase funzionano su Windows. Lo scaffold installa Ptah Compat,
incluso il suo eseguibile per Windows, tramite il gestore dei pacchetti.
Non serve scaricare separatamente uno strumento per le migrazioni.

## Crea un progetto

Installa Node.js 22.22+ e pnpm, poi esegui:

```bash
pnpm dlx @rebasepro/cli init my-app
cd my-app
pnpm dev
```

I comandi del database usano il pacchetto Ptah Compat installato:

```bash
pnpm run db:push
pnpm run db:generate
pnpm run db:migrate
```

Il pacchetto fornisce eseguibili nativi per Windows x64 e Arm64. Se
[`rebase doctor`](/docs/cli/#rebase-doctor) segnala un eseguibile mancante,
reinstalla le dipendenze del progetto con le dipendenze opzionali abilitate.

## Aggiornare un progetto PostgreSQL a Rebase 0.35

Esegui la CLI di Rebase 0.35 dalla radice del progetto su Linux, macOS o Windows.
Sostituisce `@ariga/atlas` con `@stokaro/ptah-compat` nel backend PostgreSQL.
Mantiene i file di migrazione, `atlas.sum` e le revisioni registrate.

```bash
pnpm dlx @rebasepro/cli@0.35.0 upgrade --to 0.35.0 # version-pin: ignore
```

## Rebase 0.34 e precedenti

```powershell
$dir = "$env:LOCALAPPDATA\Programs\atlas"
New-Item -ItemType Directory -Force $dir | Out-Null
Invoke-WebRequest https://release.ariga.io/atlas/atlas-windows-amd64-v1.2.3.exe -OutFile "$dir\atlas.exe"
[Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path", "User") + ";$dir", "User")
```

Apri un nuovo terminale, in modo che rilevi il nuovo `PATH`, e verificalo:

```powershell
atlas version
```

La versione 1.2.3 è la versione minima accettata dallo scaffold (`"@ariga/atlas": "^1.2.3"`).
Su Linux e macOS l'installazione scarica la versione 1.x più recente, quindi anche qualsiasi versione 1.x
successiva funzionerà qui: basta sostituire la versione nell'URL. È pubblicata solo una build x64;
Windows on Arm la esegue tramite emulazione.

La CLI cerca prima in `node_modules/.bin` e poi interroga Windows (`where atlas`),
quindi una volta che `atlas.exe` si trova nel `PATH`, i tre comandi lo troveranno:

```bash
pnpm run db:push
```

Anche [`rebase doctor`](/docs/cli/#rebase-doctor) esegue questa verifica. Finché `atlas.exe` non si trova nel `PATH`, mostrerà un avviso con un link a questa pagina.

### Se l’installazione di un progetto precedente fallisce

Se l’installazione di un progetto precedente fallisce con `ELIFECYCLE`, sposta
`@ariga/atlas` da `dependencies` a `optionalDependencies` in
`backend/package.json`. Esegui `pnpm install` e installa `atlas.exe` come indicato
sopra.

## WSL2

[WSL2](https://learn.microsoft.com/windows/wsl/install) è un'alternativa
se preferisci sviluppare in Linux. Tieni il progetto nel file system Linux
(`~/code/my-app`) per velocizzare installazione e controllo dei file.

Continua con la [guida rapida](/docs/getting-started/quickstart/) o con la
[guida ai comandi del database](/docs/cli/database/).
