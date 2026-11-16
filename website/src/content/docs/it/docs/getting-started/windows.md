---
sourceHash: 3f66e135e36c529b
title: Windows
sidebar_label: Windows
description: Installa ed esegui un progetto Rebase su Windows — cosa funziona nativamente, l'unico strumento (Atlas) che necessita del proprio binario per Windows per db push, db generate e db migrate, e quando usare invece WSL2.
---

Un progetto Rebase si installa e si esegue su Windows. Un solo strumento richiede un passaggio aggiuntivo:
[Atlas](https://atlasgo.io/), il motore che pianifica le migrazioni dello schema. Il suo
pacchetto npm, `@ariga/atlas`, include solo build per Linux e macOS, quindi su Windows si
installa invece il binario di Windows dedicato di Atlas.

Solo tre comandi utilizzano Atlas: [`rebase db push`, `rebase db generate` e
`rebase db migrate`](/docs/cli/database/#commands). L'esecuzione dell'app non lo richiede. `rebase dev` crea le tabelle
e le colonne mancanti all'avvio senza di esso, consentendoti di iniziare a sviluppare prima di
installarlo.

La CI di Rebase viene eseguita su Linux e macOS. Se desideri che la tua macchina corrisponda
esattamente a un server Linux, usa invece [WSL2](#alternativa-wsl2).

## 1. Prerequisiti

- **Node.js** 22.22+ e **pnpm**, come nella [Quickstart](/docs/getting-started/quickstart/#prerequisites)
- PowerShell, per il passaggio relativo ad Atlas descritto di seguito

## 2. Crea il progetto

```bash
pnpm dlx @rebasepro/cli init my-app
```

L'installazione mostra un errore di `preinstall` per `@ariga/atlas`, con
`Unsupported platform`, e poi termina. Questo comportamento è previsto. Lo scaffold
dichiara `@ariga/atlas` come dipendenza opzionale, quindi su una piattaforma in cui non
può essere installato viene ignorato e l'installazione prosegue.

```bash
cd my-app
pnpm dev
```

Non serve altro. L'app, il pannello di amministrazione e il database di sviluppo
gestito funzionano tutti senza Atlas.

## 3. Installa Atlas per i comandi di schema

Scarica il binario di Atlas per Windows, salvalo come `atlas.exe` e aggiungi la sua cartella
al `PATH` del tuo utente. In PowerShell:

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

## Un progetto creato in precedenza

Un progetto generato con una versione precedente di `@rebasepro/cli` dichiara `@ariga/atlas` sotto
`dependencies`, e la sua installazione fallisce su Windows con
`ELIFECYCLE Command failed with exit code 1`. Spostalo in `optionalDependencies`
in `backend/package.json`:

```json
{
    "optionalDependencies": {
        "@ariga/atlas": "^1.2.3"
    }
}
```

Rimuovilo da `dependencies`, esegui `pnpm install` e quindi segui il
[passaggio 3](#3-installa-atlas-per-i-comandi-di-schema). Su Linux e macOS non cambia
nulla, poiché una dipendenza opzionale in grado di installarsi viene regolarmente installata.
Ciò include la CI e l'immagine di deployment.

## Alternativa: WSL2

[WSL2](https://learn.microsoft.com/windows/wsl/install) esegue una vera
distribuzione Linux, quindi il pacchetto npm si installa normalmente e nessuno dei passaggi
precedenti è necessario. È anche l'ambiente su cui si basa Docker Desktop.

Mantieni il progetto all'interno del filesystem Linux (`~/code/my-app`), non sotto
`/mnt/c/`. La lettura dei file attraverso questo confine rallenta le installazioni e il file watcher.
Apri il progetto da Windows con l'
[estensione WSL di VS Code](https://code.visualstudio.com/docs/remote/wsl) o
tramite `\\wsl$\`.

## Passaggi successivi

- [Quickstart](/docs/getting-started/quickstart/): il resto della prima esecuzione, identico su ogni piattaforma
- [Comandi del database](/docs/cli/database/): cosa fanno nello specifico `db push`, `db generate` e `db migrate`
- [Risoluzione dei problemi](/docs/troubleshooting/): gli errori che impediscono l'avvio del backend e come si presentano
