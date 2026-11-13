---
sourceHash: ecae5803328dcd65
title: Implantando o Rebase no InstaPods
description: Leve um projeto recém-criado com rebase init para uma URL HTTPS ativa em um pod do InstaPods — Node, PostgreSQL e upload de arquivos na mesma máquina, sem Docker.
sidebar_label: InstaPods
---

O [InstaPods](https://instapods.com) executa seu aplicativo em um contêiner persistente — um *pod* — com Node.js, um serviço PostgreSQL opcional em `localhost`, HTTPS automático e deploys a partir de um repositório GitHub. O backend do Rebase é composto por um processo Node e um Postgres, então tudo cabe em um único pod: a API, autenticação, realtime, cron, o painel de administração e o armazenamento de arquivos.

Esta página leva um projeto recém-criado com `rebase init` até uma URL ativa. Tudo roda no próprio pod; não há imagem Docker e nada mais para provisionar.

**O upload de arquivos pode começar no próprio disco do pod.** O sistema de arquivos de um pod sobrevive a reinicializações e novos deploys, portanto, o armazenamento local é seguro lá, e você pode migrar para um bucket compatível com S3 mais tarde sem alterar o código. Consulte [Armazenamento de arquivos](#armazenamento-de-arquivos).

## O que você precisa

- O plano **Build** ou superior (US$ 7/mês: 2 vCPUs, 2 GB de RAM, 25 GB de disco). O plano Launch não pode executar o serviço PostgreSQL.
- Um repositório GitHub para o projeto.
- A [CLI do InstaPods](https://docs.instapods.com/), para as etapas do banco de dados e de ambiente. O painel (dashboard) faz as mesmas coisas.

## 1. Crie o projeto e faça o push

```bash
pnpm dlx @rebasepro/cli init my-app
cd my-app
```

Faça o commit e envie-o para um repositório GitHub. O `.env` está no gitignore e deve continuar assim: o pod recebe seus próprios valores na etapa 4.

## 2. Crie o pod

No painel do InstaPods, crie um pod com o preset **Node.js** no plano **Build**.

O scaffold declara Node `>=22.22.0` e recusa a instalação em qualquer versão anterior. Verifique a versão do pod e mude-o para o Node 24 se o seu Node 22 estiver desatualizado:

```bash
instapods exec my-app -- node -v
instapods pods node-version my-app 24 --wait
```

## 3. Adicione o PostgreSQL

```bash
instapods services add my-app -s postgresql -w
instapods services creds my-app -s postgresql
```

O segundo comando exibe as credenciais: host `localhost`, porta `5432`, usuário e banco de dados `instapod` e uma senha gerada. Sua string de conexão é:

```
postgresql://instapod:<password>@localhost:5432/instapod
```

Em seguida, crie a role sob a qual o Rebase executa as requisições autenticadas. O Rebase impõe segurança em nível de linha (row-level security) alternando cada requisição para uma role restrita, `rebase_user`, e o usuário `instapod` precisa de permissão para alternar para ela. Crie-a uma vez como superusuário do Postgres, antes do primeiro deploy:

```bash
instapods ssh my-app
sudo -u postgres psql -d instapod -c "CREATE ROLE rebase_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;" -c "GRANT rebase_user TO instapod;"
exit
```

O runtime faz o resto na primeira inicialização: as permissões (grants) e políticas em suas tabelas pertencem ao `instapod`, que é o proprietário do seu banco de dados.

Faça isso mesmo que o runtime pudesse criar a role por conta própria. No PostgreSQL 16 e mais recentes, um usuário com permissão para criar roles, mas que não seja um superusuário, obtém uma associação na role criada que não lhe permite alternar para ela. A inicialização é bem-sucedida, mas todas as requisições autenticadas falham com `DB_PERMISSION_DENIED`. Se isso já aconteceu, execute `GRANT rebase_user TO instapod WITH SET TRUE;` da mesma forma e reinicie o aplicativo.

## 4. Configure o ambiente

Gere os dois segredos com `openssl rand -hex 32` (uma vez para cada) e defina tudo em uma única chamada:

```bash
instapods env set my-app \
  DATABASE_URL='postgresql://instapod:<password>@localhost:5432/instapod' \
  ALLOW_LOCALHOST_IN_PRODUCTION=true \
  JWT_SECRET=<first-secret> \
  REBASE_SERVICE_KEY=<second-secret> \
  CORS_ORIGINS=https://my-app.nbg1-1.instapods.app \
  FRONTEND_URL=https://my-app.nbg1-1.instapods.app \
  DISABLE_SELF_REGISTRATION=true \
  REBASE_ADMIN_EMAIL=you@example.com \
  REBASE_ADMIN_PASSWORD=<at-least-12-characters> \
  STORAGE_TYPE=local \
  STORAGE_PATH=/home/instapod/app/uploads \
  FORCE_LOCAL_STORAGE=true
```

Use a URL do próprio pod para `CORS_ORIGINS` e `FRONTEND_URL`: o painel a exibe, e esse é o endereço no qual você abrirá o painel de administração. Adicione um domínio personalizado mais tarde e coloque-o em ambos.

Para que servem as linhas menos óbvias:

- **`ALLOW_LOCALHOST_IN_PRODUCTION=true`.** Em produção, o runtime recusa uma `DATABASE_URL` que aponte para `localhost`, porque dentro de um contêiner esse endereço geralmente é um engano. Em um pod, o banco de dados realmente está na mesma máquina, e esta linha confirma isso.
- **`REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD`.** Em produção, a primeira conta registrada não é definida como administradora, portanto, estas variáveis definem a primeira. O runtime cria a conta uma única vez, enquanto a tabela de usuários estiver vazia. Faça login com ela e altere a senha. Consulte [Seu primeiro administrador](/docs/getting-started/deployment/#your-first-admin).
- **As três linhas de armazenamento.** Explicadas em [Armazenamento de arquivos](#armazenamento-de-arquivos).

O comando `instapods env set` grava em `/home/instapod/app/.env`, que é o arquivo lido pelo `rebase start`. O InstaPods define a variável `PORT` automaticamente, e o runtime se vincula a ela.

## 5. Conecte o repositório

Na aba **Git** do pod, conecte o repositório e a branch, e defina os comandos:

| Campo | Valor |
| --- | --- |
| Install | `npx -y pnpm@11 install --frozen-lockfile --prod=false` |
| Build | `npx -y pnpm@11 run build` |
| Release | *(deixe em branco)* |
| Start | `env NODE_ENV=production node_modules/.bin/rebase start` |

Por que cada um é configurado dessa forma:

- **Install** executa o pnpm via `npx`, pois o projeto inclui um `pnpm-lock.yaml` e o pod pode não ter o pnpm instalado. `--prod=false` mantém as dependências de desenvolvimento — a CLI do Rebase e o TypeScript, necessários para o build —, mesmo que `NODE_ENV` já seja `production` durante a instalação.
- **Build** executa `rebase build`. Ele compila suas tabelas, funções e crons em `dist-bundle/`, e compila o painel de administração no mesmo bundle. Ele atinge um pico de cerca de 1 GB de memória.
- **Start** executa o bundle compilado. `NODE_ENV=production` é definido no próprio comando, para que o runtime nunca inicie no modo de desenvolvimento — onde a primeira pessoa estranha a se registrar se tornaria administradora.

Faça o deploy. Cada push posterior para a branch realizará um novo deploy.

## 6. Acesse a aplicação

Abra a URL do pod. Um único processo serve o painel de administração em `/` e a API em `/api`. Faça login com `REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD`.

A primeira inicialização cria todas as tabelas necessárias, incluindo as suas tabelas, juntamente com as políticas de segurança em nível de linha. Não há migração prévia a ser executada.

Se os logs exibirem `Failed to create the "rebase_user" role`, a etapa no final de [Adicione o PostgreSQL](#3-adicione-o-postgresql) foi ignorada: execute-a e, em seguida, rode `instapods pods restart my-app`.

## Armazenamento de arquivos

Os uploads são armazenados no disco do pod em `/home/instapod/app/uploads`, um diretório que o `.gitignore` do scaffold já exclui do repositório.

Em produção, o runtime recusa o armazenamento local a menos que você informe que o disco é permanente, porque na maioria das plataformas de contêineres ele não é: o sistema de arquivos é substituído a cada deploy, e todos os arquivos enviados são perdidos. Um pod é diferente, pois seus arquivos persistem entre reinicializações e deploys. `FORCE_LOCAL_STORAGE=true` informa isso ao runtime.

Manter o diretório dentro de `/home/instapod/app` também o inclui no backup diário do pod realizado pelo InstaPods, que cobre esse diretório e faz o dump do banco de dados juntamente com ele.

O que o armazenamento local não faz:

- **Servir a partir de mais de uma máquina.** Os arquivos existem apenas neste pod. Uma segunda instância, ou uma CDN à frente dos arquivos, precisa de um bucket.
- **Crescer além do disco do plano.** Os uploads compartilham os 25 GB com o banco de dados e a aplicação.

Quando você ultrapassar essa capacidade, conecte qualquer bucket compatível com S3 e remova as três linhas de configuração local:

```bash
instapods env unset my-app STORAGE_PATH FORCE_LOCAL_STORAGE
instapods env set my-app STORAGE_TYPE=s3 S3_BUCKET=my-uploads S3_REGION=... \
  S3_ENDPOINT=https://... S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=...
```

Os arquivos que já estão no pod não são movidos automaticamente: copie-os para o bucket, mantendo suas chaves. Quem pode ler, gravar e listar arquivos é determinado por `storageAuthorize` em `backend/storage.ts`, independentemente de qual backend os armazena. Consulte [Armazenamento](/docs/backend/storage).

## O schema

<span class="since-badge" data-since="0.31">A partir de 0.31</span>

**O runtime cria tabelas ausentes na inicialização, incluindo as declaradas em `backend/schema`.** O valor padrão de `REBASE_MIGRATE_ON_BOOT` é `ensure`, que é aditivo em todo o schema. Ele cria tabelas, colunas e tipos enum ausentes e aplica suas políticas de segurança em nível de linha, para que uma nova collection entre em produção no próximo deploy.

O `ensure` nunca altera nada que já exista. Ele não altera o tipo de uma coluna, não remove nada nem edita os rótulos de um enum existente, pois um deploy não deve reestruturar um schema como efeito colateral.

Qualquer alteração que não seja puramente aditiva — uma coluna renomeada, um tipo restringido, um campo removido — precisa do `rebase db push`, executado a partir da sua máquina.

O `db push` planeja cada alteração em uma cópia temporária do schema, em um banco de dados com o mesmo nome do seu acrescido de `_dev_diff` no final, e o usuário `instapod` não tem permissão para criar bancos de dados. Crie-o uma vez como superusuário:

```bash
instapods ssh my-app
sudo -u postgres psql -c "CREATE DATABASE instapod_dev_diff OWNER instapod;"
exit
```

O Postgres do pod escuta apenas em `localhost`, portanto, acesse-o por meio de um túnel SSH e, em seguida, faça o push:

```bash
ssh -N -L 5433:localhost:5432 instapod@<pod-host> -p <ssh-port>
pnpm exec rebase db push --dry-run --database-url 'postgresql://instapod:<password>@localhost:5433/instapod'
```

Analise o SQL exibido pelo dry run e execute-o novamente sem `--dry-run`. Uma alteração que exclua dados também precisa de `--allow-destructive`.

Para migrações versionadas, faça commit dos arquivos de migração com `rebase db generate` e coloque `node_modules/.bin/rebase db migrate` no campo **Release**, que o InstaPods executa a cada deploy.

Se as suas tabelas declararem uma coluna `col.vector()`, o Postgres do pod precisará da extensão pgvector: instalada no pod e depois criada pelo superusuário com `sudo -u postgres psql -d instapod -c "CREATE EXTENSION vector;"`. O scaffold não declara nenhuma.

## Próximos passos

- [Implantação](/docs/getting-started/deployment) — o checklist de produção e as regras para o primeiro administrador comuns a todas as plataformas.
- [Configuração](/docs/getting-started/configuration) — todas as variáveis de ambiente que o runtime lê.
- [Armazenamento](/docs/backend/storage) — buckets, regras de acesso e várias fontes de armazenamento simultâneas.
