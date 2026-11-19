---
sourceHash: f1a8ff20d10b3dbd
title: Windows
sidebar_label: Windows
description: Instale um projeto Rebase e use seus comandos de banco de dados no Windows.
---

**Rebase 0.35+**

Projetos Rebase funcionam no Windows. O scaffold instala o Ptah Compat,
incluindo seu executável para Windows, pelo gerenciador de pacotes. Não é
necessário baixar outra ferramenta de migração.

## Crie um projeto

Instale Node.js 22.22+ e pnpm. Depois execute:

```bash
pnpm dlx @rebasepro/cli init my-app
cd my-app
pnpm dev
```

Os comandos de banco de dados usam o pacote Ptah Compat instalado:

```bash
pnpm run db:push
pnpm run db:generate
pnpm run db:migrate
```

O pacote oferece executáveis nativos para Windows x64 e Arm64. Se
[`rebase doctor`](/docs/cli/#rebase-doctor) informar que falta o executável,
reinstale as dependências do projeto com as dependências opcionais ativadas.

## Atualizar um projeto PostgreSQL para o Rebase 0.35

Execute a CLI do Rebase 0.35 na raiz do projeto no Linux, macOS ou Windows. Ela
substitui `@ariga/atlas` por `@stokaro/ptah-compat` no backend PostgreSQL. Os
arquivos de migração, o `atlas.sum` e as revisões registradas são preservados.

```bash
pnpm dlx @rebasepro/cli@0.35.0 upgrade --to 0.35.0 # version-pin: ignore
```

## Rebase 0.34 e anteriores

```powershell
$dir = "$env:LOCALAPPDATA\Programs\atlas"
New-Item -ItemType Directory -Force $dir | Out-Null
Invoke-WebRequest https://release.ariga.io/atlas/atlas-windows-amd64-v1.2.3.exe -OutFile "$dir\atlas.exe"
[Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path", "User") + ";$dir", "User")
```

Abra um novo terminal para que ele reconheça o novo `PATH` e verifique:

```powershell
atlas version
```

A versão 1.2.3 é a versão mais antiga que o scaffold aceita (`"@ariga/atlas": "^1.2.3"`). No Linux e macOS, a instalação obtém a versão 1.x mais recente, portanto, qualquer versão 1.x posterior também funcionará aqui: basta alterar a versão na URL. Apenas uma compilação x64 é publicada; o Windows on Arm a executa por meio de emulação.

A CLI procura primeiro em `node_modules/.bin` e depois consulta o Windows (`where atlas`), portanto, assim que `atlas.exe` estiver no `PATH`, os três comandos irão encontrá-lo:

```bash
pnpm run db:push
```

O [`rebase doctor`](/docs/cli/#rebase-doctor) também verifica isso. Enquanto o `atlas.exe` não estiver no `PATH`, ele emitirá um aviso com um link para esta página.

### Se a instalação de um projeto antigo falhar

Se a instalação de um projeto antigo falhar com `ELIFECYCLE`, mova `@ariga/atlas`
de `dependencies` para `optionalDependencies` em `backend/package.json`. Execute
`pnpm install` e instale o `atlas.exe` conforme as etapas acima.

## WSL2

[WSL2](https://learn.microsoft.com/windows/wsl/install) é uma alternativa
se você prefere desenvolver no Linux. Mantenha o projeto no sistema de
arquivos do Linux (`~/code/my-app`) para acelerar instalações e a observação
de arquivos.

Continue pelo [início rápido](/docs/getting-started/quickstart/) ou pelo
[guia de comandos de banco de dados](/docs/cli/database/).
