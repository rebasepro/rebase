---
sourceHash: ce9b9cd9e35c5c3d
title: Windows
sidebar_label: Windows
description: Installa un progetto Rebase e usa i comandi del database su Windows.
---

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

## Aggiorna un progetto precedente

I progetti creati prima dell'integrazione di Ptah potrebbero ancora dipendere
da `@ariga/atlas`. Quando passi a una versione di Rebase che usa Ptah Compat,
esegui `rebase upgrade`. L'aggiornamento sostituisce quella dipendenza con
`@stokaro/ptah-compat`. Esegui poi `pnpm install`.

## WSL2

[WSL2](https://learn.microsoft.com/windows/wsl/install) è un'alternativa
se preferisci sviluppare in Linux. Tieni il progetto nel file system Linux
(`~/code/my-app`) per velocizzare installazione e controllo dei file.

Continua con la [guida rapida](/docs/getting-started/quickstart/) o con la
[guida ai comandi del database](/docs/cli/database/).
