---
sourceHash: 3f66e135e36c529b
title: Windows
sidebar_label: Windows
description: Instale e execute um projeto Rebase no Windows — o que funciona nativamente, a única ferramenta (Atlas) que precisa de seu próprio binário do Windows para db push, db generate e db migrate, e quando usar o WSL2 em vez disso.
---

Um projeto Rebase pode ser instalado e executado no Windows. Uma ferramenta precisa de uma etapa extra: o [Atlas](https://atlasgo.io/), o motor que planeja as migrações de schema. Seu pacote npm, `@ariga/atlas`, inclui compilações apenas para Linux e macOS, portanto, no Windows, você deve instalar o próprio binário do Atlas para Windows.

Apenas três comandos usam o Atlas: [`rebase db push`, `rebase db generate` e `rebase db migrate`](/docs/cli/database/#commands). A execução do aplicativo não o utiliza. O `rebase dev` cria tabelas e colunas ausentes na inicialização sem ele, permitindo que você comece a desenvolver antes de instalá-lo.

A CI do Rebase roda em Linux e macOS. Se você quiser que sua máquina corresponda exatamente a um servidor Linux, use o [WSL2](#alternativa-wsl2).

## 1. Pré-requisitos

- **Node.js** 22.22+ e **pnpm**, como no [Quickstart](/docs/getting-started/quickstart/#prerequisites)
- PowerShell, para a etapa do Atlas abaixo

## 2. Criar o projeto

```bash
pnpm dlx @rebasepro/cli init my-app
```

A instalação exibirá uma falha no `preinstall` para `@ariga/atlas`, com `Unsupported platform`, e depois será concluída. Isso é esperado. O scaffold declara `@ariga/atlas` como uma dependência opcional, portanto, em uma plataforma onde ele não pode ser instalado, ele é ignorado e a instalação continua.

```bash
cd my-app
pnpm dev
```

Não é necessário mais nada. O aplicativo, o painel de administração e o banco de dados de desenvolvimento gerenciado funcionam sem o Atlas.

## 3. Instalar o Atlas para os comandos de schema

Baixe o binário do Windows do Atlas, salve-o como `atlas.exe` e adicione sua pasta ao `PATH` do usuário. No PowerShell:

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

## Um projeto criado anteriormente

Um projeto gerado por uma versão mais antiga do `@rebasepro/cli` declara `@ariga/atlas` em `dependencies`, e sua instalação falha no Windows com `ELIFECYCLE Command failed with exit code 1`. Mova-o para `optionalDependencies` em `backend/package.json`:

```json
{
    "optionalDependencies": {
        "@ariga/atlas": "^1.2.3"
    }
}
```

Remova-o de `dependencies`, execute `pnpm install` e siga o [passo 3](#3-instalar-o-atlas-para-os-comandos-de-schema). No Linux e macOS nada muda, pois uma dependência opcional que pode ser instalada será instalada. Isso inclui a CI e a imagem de deploy.

## Alternativa: WSL2

O [WSL2](https://learn.microsoft.com/windows/wsl/install) executa uma distribuição Linux real, de modo que o pacote npm é instalado normalmente e nenhuma das etapas acima se aplica. É também sobre ele que o Docker Desktop roda.

Mantenha o projeto dentro do sistema de arquivos do Linux (`~/code/my-app`), e não em `/mnt/c/`. Ler arquivos através dessa fronteira torna as instalações e o observador de arquivos lentos. Abra o projeto no Windows com a [extensão do WSL para o VS Code](https://code.visualstudio.com/docs/remote/wsl) ou através de `\\wsl$\`.

## Próximos passos

- [Quickstart](/docs/getting-started/quickstart/): o restante de uma primeira execução, igual em todas as plataformas
- [Comandos de banco de dados](/docs/cli/database/): o que `db push`, `db generate` e `db migrate` fazem individualmente
- [Solução de problemas](/docs/troubleshooting/): as falhas que impedem a inicialização do backend e como cada uma se apresenta
