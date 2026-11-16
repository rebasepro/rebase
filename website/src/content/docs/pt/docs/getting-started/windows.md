---
sourceHash: ce9b9cd9e35c5c3d
title: Windows
sidebar_label: Windows
description: Instale um projeto Rebase e use seus comandos de banco de dados no Windows.
---

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

## Atualize um projeto anterior

Projetos criados antes da integração com Ptah ainda podem depender de
`@ariga/atlas`. Ao migrar para uma versão de Rebase que usa Ptah Compat,
execute `rebase upgrade`. A atualização substitui essa dependência por
`@stokaro/ptah-compat`. Depois execute `pnpm install`.

## WSL2

[WSL2](https://learn.microsoft.com/windows/wsl/install) é uma alternativa
se você prefere desenvolver no Linux. Mantenha o projeto no sistema de
arquivos do Linux (`~/code/my-app`) para acelerar instalações e a observação
de arquivos.

Continue pelo [início rápido](/docs/getting-started/quickstart/) ou pelo
[guia de comandos de banco de dados](/docs/cli/database/).
