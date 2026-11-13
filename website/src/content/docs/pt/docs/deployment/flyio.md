---
sourceHash: 10c8baa5ed2e63bf
title: Implantando o Rebase no Fly.io
description: Saiba como implantar o Rebase globalmente ou restringi-lo a data centers europeus usando o Fly.io.
sidebar_label: Fly.io
---

O Fly.io executa contêineres Docker próximos aos seus usuários em uma rede anycast global e é altamente configurável quanto ao local onde os dados residem — uma ótima opção para uma implantação do Rebase com foco estritamente europeu. O Fly possui data centers em **Amsterdã (ams)**, **Frankfurt (fra)**, **Madri (mad)** e **Paris (cdg)**.

Nada nesta página é específico do Fly em relação ao seu projeto. Uma implantação do Rebase consiste em duas partes separáveis — a imagem de runtime publicada e o **bundle** que o `rebase build` produz — e o mesmo bundle é executado no Docker Compose em um computador, no Rebase Cloud, sob o [Helm chart](/docs/deployment/kubernetes) e aqui.

## 1. Inicialize o aplicativo Fly

Com o `flyctl` instalado, a partir do seu projeto:

```bash
fly launch --no-deploy
```

1. **Nome do app:** `my-rebase-app`
2. **Organização:** pessoal ou a organização da sua empresa.
3. **Região:** escolha um data center europeu — Frankfurt (`fra`) ou Paris (`cdg`).
4. **Banco de dados:** responda **Yes** para um cluster Postgres. O Fly o cria na mesma região e injeta a `DATABASE_URL`.
5. **Redis:** responda **No**.

`--no-deploy` porque os segredos e o bundle precisam estar configurados primeiro.

Se as suas tabelas declararem uma coluna `col.vector()`, habilite a extensão uma vez nesse banco de dados: `CREATE EXTENSION vector;`.

## 2. Compile o bundle e aponte o fly.toml para a imagem de runtime

Não há **nenhuma imagem de aplicação para compilar a partir do seu código-fonte**. O `rebase build` produz um diretório `dist-bundle` com suas tabelas, funções, crons compilados e — se o seu projeto declarar um app estático — o seu frontend compilado:

```bash
rebase build
```

Faça commit de um `Dockerfile` de três linhas na raiz do projeto:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

E aponte o `fly.toml` para ele:

```toml title="fly.toml"
app = "my-rebase-app"
primary_region = "fra"

[build]
  dockerfile = "Dockerfile"

[env]
  NODE_ENV = "production"
  DISABLE_SELF_REGISTRATION = "true"

[http_service]
  internal_port = 8080          # the port the runtime image listens on
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 1      # realtime subscriptions need a machine to stay up

[[http_service.checks]]
  path = "/livez"
```

`/livez` em vez de `/health`: a segunda opção realiza uma comunicação de ida e volta (round-trip) com o banco de dados, fazendo com que uma verificação de liveness nela reinicie uma máquina saudável durante uma breve instabilidade no banco de dados.

Atualizar o Rebase posteriormente se resume a alterar essa linha `FROM`. O seu bundle permanece intocado.

## 3. Configure os segredos de produção

```bash
fly secrets set \
  JWT_SECRET=your_super_long_randomly_generated_secure_string \
  REBASE_SERVICE_KEY=another_super_long_randomly_generated_secure_string \
  CORS_ORIGINS=https://my-rebase-app.fly.dev \
  FRONTEND_URL=https://my-rebase-app.fly.dev \
  REBASE_ADMIN_EMAIL=you@example.com \
  REBASE_ADMIN_PASSWORD=$(openssl rand -hex 12) \
  -a my-rebase-app
```

Os dois últimos são novos e definem como este app obtém um administrador: em produção, a primeira conta a se registrar não é promovida, portanto nada mais gera o primeiro usuário autenticado. Defina-os antes que o primeiro deploy atenda ao tráfego — consulte [Seu primeiro admin](/docs/getting-started/deployment/#your-first-admin). O `fly secrets list` exibe apenas digests, portanto guarde a senha gerada por este comando; não há como recuperá-la depois.

## 4. Faça o deploy

```bash
fly deploy
```

Em seguida, execute `fly open`.

## 5. O schema

<span class="since-badge" data-since="0.31">Desde 0.31</span>

**O runtime cria as tabelas ausentes na inicialização, incluindo aquelas declaradas em `backend/schema`.** A variável `REBASE_MIGRATE_ON_BOOT` tem como padrão `ensure`, que é aditiva em todo o schema — ela cria tabelas, colunas e tipos enum ausentes e aplica suas políticas de row-level security — de modo que a primeira inicialização em um banco de dados vazio já começa servindo suas coleções.

O que o `ensure` nunca faz é alterar algo que já existe: ele não altera o tipo de uma coluna, não remove nada nem edita os rótulos de um enum existente, pois uma máquina sendo reiniciada não deve remodelar um schema como efeito colateral de um deploy.

Portanto, uma coisa ainda requer a CLI, executada a partir de um checkout ou de um job de CI:

```bash
rebase db push
```

Qualquer alteração que não seja puramente aditiva — uma coluna renomeada, um tipo mais restrito, um campo removido.

Para um Fly Postgres privado, abra um túnel com `fly proxy 5432 -a <your-db-app>` e aponte a `DATABASE_URL` para `localhost:5432`. A imagem de runtime é distribuída sem a CLI, portanto isso nunca é executado dentro da máquina e um `release_command` também não pode chamá-la. Para migrações versionadas, faça commit dos arquivos de migração com `rebase db generate` e execute `rebase db migrate` como uma etapa de release em vez disso.

## Armazenamento de arquivos

O sistema de arquivos de uma máquina Fly não persiste após um deploy; portanto, o armazenamento local de arquivos resulta em perda silenciosa de dados e o runtime o recusa em produção. Conecte um bucket compatível com S3 — o Tigris é o que o Fly provisiona — com `STORAGE_TYPE=s3`. Consulte [Armazenamento](/docs/backend/storage).

## Próximos passos

- [Implantação](/docs/getting-started/deployment) — o checklist de produção e as regras do primeiro administrador compartilhadas por todas as plataformas.
- [Configuração](/docs/getting-started/configuration) — todas as variáveis de ambiente que o runtime lê.
