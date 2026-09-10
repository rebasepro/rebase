---
sourceHash: 263c0ae6a0fac44f
title: Fazendo deploy do Rebase no Fly.io
description: Saiba como fazer deploy do Rebase globalmente ou restringi-lo a data centers europeus usando o Fly.io.
sidebar_label: Fly.io
---

O Fly.io executa contêineres Docker próximos aos seus usuários em uma rede anycast global e é altamente configurável quanto ao local onde os dados residem — uma ótima opção para um deploy do Rebase com foco restrito na Europa. O Fly possui data centers em **Amsterdã (ams)**, **Frankfurt (fra)**, **Madri (mad)** e **Paris (cdg)**.

Nada nesta página é específico do Fly em relação ao seu projeto. Um deploy do Rebase é composto por duas partes separáveis — a imagem de runtime publicada e o **bundle** que o `rebase build` produz — e o mesmo bundle roda sob o Docker Compose em um computador pessoal, no Rebase Cloud, sob o [Helm chart](/docs/deployment/kubernetes) e aqui.

## 1. Inicialize o app Fly

Com o `flyctl` instalado, execute a partir do seu projeto:

```bash
fly launch --no-deploy
```

1. **App name:** `my-rebase-app`
2. **Organization:** pessoal ou a organização da sua empresa.
3. **Region:** escolha um datacenter europeu — Frankfurt (`fra`) ou Paris (`cdg`).
4. **Database:** responda **Yes** para um cluster Postgres. O Fly o cria na mesma região e injeta `DATABASE_URL`.
5. **Redis:** responda **No**.

`--no-deploy` porque os segredos e o bundle precisam estar configurados primeiro.

Se as suas coleções declararem uma propriedade `vector`, habilite a extensão uma vez nesse banco de dados: `CREATE EXTENSION vector;`.

## 2. Crie o bundle e aponte o fly.toml para a imagem de runtime

Não há **nenhuma imagem de aplicação a ser construída a partir do seu código-fonte**. O `rebase build` produz um diretório `dist-bundle` com suas coleções compiladas, funções, crons e — se o seu projeto declarar um app estático — seu frontend compilado:

```bash
rebase build
```

Faça commit de um `Dockerfile` de três linhas na raiz do projeto:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.20.0
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

`/livez` em vez de `/health`: o segundo realiza uma viagem de ida e volta (round-trip) ao banco de dados, de modo que uma verificação de atividade (liveness check) nele reiniciaria uma máquina saudável durante uma breve oscilação do banco de dados.

`DISABLE_SELF_REGISTRATION` é novo: na versão 0.17.3 não existe essa opção, e a primeira conta a se registrar torna-se a administradora.

Atualizar o Rebase posteriormente se resume a alterar essa linha `FROM`. Seu bundle permanece intocado.

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

Os dois últimos são novos e são a forma como este app obtém um administrador: em produção, a primeira conta a se registrar não é promovida, portanto nada mais produz o primeiro usuário autenticado. Defina-os antes que o primeiro deploy atenda ao tráfego — consulte [Seu primeiro administrador](/docs/getting-started/deployment/#your-first-admin). O comando `fly secrets list` exibe apenas resumos criptográficos (digests), então guarde a senha gerada por este comando; não há como recuperá-la depois.

## 4. Deploy

```bash
fly deploy
```

Depois, execute `fly open`.

## 5. O schema

**O runtime cria tabelas ausentes na inicialização, incluindo as das suas coleções.** O valor padrão de `REBASE_MIGRATE_ON_BOOT` é `ensure`, que é aditivo em todo o schema — ele cria tabelas, colunas e tipos enum ausentes e aplica suas políticas de segurança em nível de linha (RLS) — portanto, a primeira inicialização em um banco de dados vazio já começa servindo suas coleções.

O que o `ensure` nunca faz é alterar algo que já existe: ele não altera o tipo de uma coluna, não remove nada nem edita os rótulos de um enum existente, pois uma máquina reiniciando não deve remodelar um schema como efeito colateral de um deploy.

Portanto, duas coisas ainda exigem a CLI, executada a partir de um checkout ou de um job de CI:

```bash
rebase db push
```

- **RLS de tabelas de junção** para relações muitos-para-muitos.
- **Qualquer alteração que não seja puramente aditiva** — uma coluna renomeada, um tipo restringido, um campo removido.

Para um Fly Postgres privado, abra um túnel com `fly proxy 5432 -a <your-db-app>` e aponte `DATABASE_URL` para `localhost:5432`. A imagem de runtime é distribuída sem a CLI, portanto isso nunca roda dentro da máquina e um `release_command` também não pode chamá-la. Para migrações versionadas, faça commit dos arquivos de migração com `rebase db generate` e execute `rebase db migrate` como uma etapa de release.

## Armazenamento de arquivos

O sistema de arquivos de uma máquina Fly não persiste após um deploy, portanto o armazenamento de arquivos local resulta em perda silenciosa de dados e o runtime o recusa em produção. Conecte um bucket compatível com S3 — o Tigris é o provisionado pelo Fly — com `STORAGE_TYPE=s3`. Consulte [Armazenamento](/docs/backend/storage).

## Próximos passos

- [Deploy](/docs/getting-started/deployment) — o checklist de produção e as regras de primeiro administrador compartilhadas por todas as plataformas.
- [Configuração](/docs/getting-started/configuration) — todas as variáveis de ambiente lidas pelo runtime.
