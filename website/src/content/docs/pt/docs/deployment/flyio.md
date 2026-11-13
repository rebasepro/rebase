---
sourceHash: 15a0356fd585a797
title: Implantando o Rebase no Fly.io
description: Saiba como implantar o Rebase globalmente ou restringi-lo a data centers europeus usando o Fly.io.
sidebar_label: Fly.io
---

O Fly.io executa contêineres Docker próximos aos seus usuários em uma rede anycast global e é altamente configurável sobre onde os dados residem — uma ótima opção para uma implantação do Rebase com foco estritamente europeu. O Fly possui data centers em **Amsterdã (ams)**, **Frankfurt (fra)**, **Madri (mad)** e **Paris (cdg)**.

Nada nesta página é específico do Fly em relação ao seu projeto. Uma implantação do Rebase consiste em duas partes separáveis — a imagem de runtime publicada e o **bundle** que o `rebase build` produz — e o mesmo bundle é executado no Docker Compose em um laptop, no Rebase Cloud, usando o [Helm chart](/docs/deployment/kubernetes) e aqui.

## 1. Inicialize o aplicativo Fly

Com o `flyctl` instalado, a partir do seu projeto:

```bash
fly launch --no-deploy
```

1. **Nome do app:** `my-rebase-app`
2. **Organização:** pessoal ou a organização da sua empresa.
3. **Região:** escolha um data center europeu — Frankfurt (`fra`) ou Paris (`cdg`).
4. **Banco de dados:** responda **Sim** para um cluster Postgres. O Fly o cria na mesma região e injeta a `DATABASE_URL`.
5. **Redis:** responda **Não**.

`--no-deploy` porque os secrets e o bundle precisam estar configurados primeiro.

Se suas tabelas declararem uma coluna `col.vector()`, habilite a extensão uma vez nesse banco de dados: `CREATE EXTENSION vector;`.

## 2. Gere o bundle e aponte o fly.toml para a imagem de runtime

Não há **nenhuma imagem de aplicação para compilar a partir do seu código-fonte**. O `rebase build` produz um diretório `dist-bundle` com suas tabelas, funções e crons compilados e — se o seu projeto declarar um app estático — seu frontend compilado:

```bash
rebase build
```

Faça o commit de um `Dockerfile` de três linhas na raiz do projeto:

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

`/livez` em vez de `/health`: o segundo realiza uma viagem de ida e volta ao banco de dados, de modo que uma verificação de liveness nele reiniciaria uma máquina saudável durante uma breve oscilação do banco de dados.

Atualizar o Rebase posteriormente se resume a alterar essa linha `FROM`. O seu bundle permanece intocado.

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

Os dois últimos são novos e representam a única forma de este aplicativo ter um administrador: em produção, a primeira conta a se registrar não é promovida, portanto, nada mais cria o primeiro chamador autenticado. Defina-os antes que o primeiro deploy atenda ao tráfego — consulte [Seu primeiro administrador](/docs/getting-started/deployment/#your-first-admin). O `fly secrets list` exibe apenas hashes, portanto, guarde a senha gerada a partir deste comando; não há como lê-la novamente.

## 4. Deploy

```bash
fly deploy
```

Depois, `fly open`.

## 5. O schema

<span class="since-badge" data-since="0.31">A partir da 0.31</span>

**O runtime cria tabelas ausentes na inicialização, incluindo as declaradas por `backend/schema`.** O valor padrão de `REBASE_MIGRATE_ON_BOOT` é `ensure`, que é aditivo em todo o schema — ele cria tabelas, colunas e tipos enum ausentes e aplica a segurança a nível de linha (row-level security) deles —, de modo que a primeira inicialização em um banco de dados vazio já começa servindo suas tabelas.

O que o `ensure` nunca faz é alterar algo que já existe: ele não modifica o tipo de uma coluna, não remove nada e não edita os rótulos de um enum existente, pois a reinicialização de uma máquina não deve remodelar um schema como efeito colateral de um deploy.

Portanto, uma coisa ainda requer a CLI, executada a partir de um checkout ou de um job de CI:

```bash
rebase db push
```

Qualquer alteração que não seja puramente aditiva — uma coluna renomeada, um tipo restringido, um campo removido.

Para um Postgres privado no Fly, abra um túnel com `fly proxy 5432 -a <your-db-app>` e aponte a `DATABASE_URL` para `localhost:5432`. A imagem de runtime é distribuída sem a CLI, portanto isso nunca é executado dentro da máquina e um `release_command` também não pode chamá-lo. Para migrações versionadas, faça commit dos arquivos de migração com `rebase db generate` e execute `rebase db migrate` como uma etapa de release.

## Armazenamento de arquivos

O sistema de arquivos de uma máquina Fly não persiste após um deploy; portanto, o armazenamento local de arquivos causaria perda silenciosa de dados e o runtime o recusa em produção. Conecte um bucket compatível com S3 — o Tigris é o que o Fly provisiona — com `STORAGE_TYPE=s3`. Consulte [Armazenamento](/docs/backend/storage).

## Próximos passos

- [Implantação](/docs/getting-started/deployment) — o checklist de produção e as regras para o primeiro administrador compartilhadas por todas as plataformas.
- [Configuração](/docs/getting-started/configuration) — todas as variáveis de ambiente que o runtime lê.
