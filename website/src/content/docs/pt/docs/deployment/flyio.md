---
sourceHash: 96c2cde2b2f611cc
title: Implantando o Rebase no Fly.io
description: Aprenda como implantar o Rebase globalmente ou restringi-lo a data centers europeus usando o Fly.io.
sidebar_label: Fly.io
---

O Fly.io executa contêineres Docker próximos aos seus usuários em uma rede anycast global e é altamente configurável quanto ao local onde os dados residem — uma excelente opção para uma implantação do Rebase com foco estritamente europeu. O Fly possui data centers em **Amsterdã (ams)**, **Frankfurt (fra)**, **Madri (mad)** e **Paris (cdg)**.

Nada nesta página sobre o seu projeto é específico do Fly. Uma implantação do Rebase é composta por duas partes separáveis — a imagem de runtime publicada e o **bundle** que o `rebase build` produz —, e o mesmo bundle roda no Docker Compose em um laptop, no Rebase Cloud, no [Helm chart](/docs/deployment/kubernetes) e aqui.

## 1. Inicialize o app Fly

Com o `flyctl` instalado, a partir do seu projeto:

```bash
fly launch --no-deploy
```

1. **App name:** `my-rebase-app`
2. **Organization:** pessoal ou a organização da sua empresa.
3. **Region:** escolha um data center europeu — Frankfurt (`fra`) ou Paris (`cdg`).
4. **Database:** selecione **Yes** para um cluster Postgres. O Fly o cria na mesma região e injeta `DATABASE_URL`.
5. **Redis:** selecione **No**.

`--no-deploy` porque os secrets e o bundle precisam estar configurados primeiro.

Se suas coleções declararem uma propriedade `vector`, habilite a extensão uma vez nesse banco de dados: `CREATE EXTENSION vector;`.

## 2. Gere o bundle e aponte o fly.toml para a imagem de runtime

Não há **nenhuma imagem de aplicação para construir a partir do seu código-fonte**. O comando `rebase build` gera um diretório `dist-bundle` com suas coleções compiladas, funções, crons e — se o seu projeto declarar um app estático — seu frontend compilado:

```bash
rebase build
```

Faça commit de um `Dockerfile` de três linhas na raiz do projeto:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.22.0
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

`/livez` em vez de `/health`: o segundo realiza uma viagem de ida e volta ao banco de dados, portanto uma verificação de liveness nele reiniciaria uma máquina saudável durante uma breve oscilação do banco de dados.

`DISABLE_SELF_REGISTRATION` é novo: na versão 0.17.3 não existe essa opção, e a primeira conta a se registrar torna-se o administrador.

Atualizar o Rebase posteriormente consiste apenas em alterar essa linha `FROM`. Seu bundle permanece intocado.

## 3. Configure os secrets de produção

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

Os dois últimos são novos e definem como este app obtém um administrador: em produção, a primeira conta registrada não é promovida, portanto nada mais produz o primeiro chamador autenticado. Configure-os antes que o primeiro deploy atenda ao tráfego — consulte [Seu primeiro administrador](/docs/getting-started/deployment/#your-first-admin). O comando `fly secrets list` exibe apenas hashes, portanto guarde a senha gerada por este comando; não há como recuperá-la depois.

## 4. Deploy

```bash
fly deploy
```

Em seguida, `fly open`.

## 5. O schema

**O runtime cria tabelas ausentes na inicialização, incluindo as das suas coleções.** `REBASE_MIGRATE_ON_BOOT` tem como padrão `ensure`, que é aditivo em todo o schema — ele cria tabelas, colunas e tipos enum ausentes e aplica o row-level security correspondente —, de forma que a primeira inicialização em um banco de dados vazio já começa atendendo às suas coleções.

O que o `ensure` nunca faz é alterar algo que já existe: ele não modifica o tipo de uma coluna, não remove nada nem edita os valores de um enum existente, pois o reinício de uma máquina não deve alterar a estrutura de um schema como efeito colateral de um deploy.

Portanto, duas coisas ainda exigem a CLI, executada a partir de um checkout local ou de um job de CI:

```bash
rebase db push
```

- **RLS em tabelas de junção** para relações muitos-para-muitos.
- **Qualquer alteração que não seja puramente aditiva** — uma coluna renomeada, um tipo restringido, um campo removido.

Para um Fly Postgres privado, abra um túnel com `fly proxy 5432 -a <your-db-app>` e aponte `DATABASE_URL` para `localhost:5432`. A imagem de runtime é distribuída sem a CLI, portanto isso nunca roda dentro da máquina e um `release_command` também não pode chamá-la. Para migrações versionadas, faça commit dos arquivos de migração com `rebase db generate` e execute `rebase db migrate` como uma etapa de release.

## Armazenamento de arquivos

O sistema de arquivos de uma máquina Fly não persiste após um deploy, portanto o armazenamento de arquivos local causará perda silenciosa de dados e o runtime o recusa em produção. Conecte um bucket compatível com S3 — o Tigris é o provisionado pelo Fly — com `STORAGE_TYPE=s3`. Consulte [Armazenamento](/docs/backend/storage).

## Próximos passos

- [Implantação](/docs/getting-started/deployment) — o checklist de produção e as regras de primeiro admin que todas as plataformas compartilham.
- [Configuração](/docs/getting-started/configuration) — todas as variáveis de ambiente que o runtime lê.
