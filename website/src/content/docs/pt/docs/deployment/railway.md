---
sourceHash: fb79807a60cbed9c
title: Deploy do Rebase no Railway
description: Faça o deploy do Rebase no Railway a partir da imagem de runtime publicada e do bundle do seu projeto. Mantenha o foco na UE.
sidebar_label: Railway
---

O Railway é um PaaS moderno que elimina as dores de cabeça do DevOps e oferece suporte a regiões de deploy europeias (Amsterdã), permitindo manter a conformidade de hospedagem regional.

Nada nesta página é específico do Railway em relação ao seu projeto. Um deploy do Rebase é composto por duas partes separáveis — a imagem de runtime publicada e o **bundle** que o `rebase build` produz — e o mesmo bundle roda sob o Docker Compose em um computador local, no Rebase Cloud, sob o [Helm chart](/docs/deployment/kubernetes) e aqui.

## 1. Crie um projeto e uma região da UE

1. Faça login na sua [conta do Railway](https://railway.app/).
2. Clique em **New Project**.
3. Vá para **Settings → Default Region** e defina-a como **Europe (Amsterdam)**. Fazer isso *após* criar os serviços significa ter que migrá-los manualmente.

## 2. Provisione o PostgreSQL

1. Dentro do seu projeto, clique em **New → Database → Add PostgreSQL**.
2. Aguarde o provisionamento.
3. O Railway expõe uma variável interna `DATABASE_URL` na aba **Variables** do widget do Postgres.

Se suas coleções declararem uma propriedade `vector`, habilite a extensão uma vez nesse banco de dados: `CREATE EXTENSION vector;`.

## 3. Gere o bundle e inclua-o em uma imagem

Não há **nenhuma imagem de aplicação para compilar a partir do seu código-fonte**. O `rebase build` produz um diretório `dist-bundle` com suas coleções, funções e crons compilados e — se o seu projeto declarar uma aplicação estática — o frontend compilado. A imagem de runtime publicada o executa:

```bash
rebase build
```

Faça commit de um `Dockerfile` de três linhas na raiz do repositório, para que a etapa de build do Railway seja uma cópia em vez de uma compilação:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.21.1
COPY dist-bundle /bundle
```

Gere o bundle no CI e faça commit ou envie-o como parte do seu release, ou execute `rebase build` antes de fazer o push. De qualquer forma, a imagem que o Railway compila não contém ferramentas de desenvolvimento nem código-fonte — atualizar o Rebase mais tarde requer apenas alterar essa linha `FROM`, mantendo seu bundle intacto.

Em seguida: **New → GitHub Repo**, selecione seu repositório e deixe o Railway detectar o Dockerfile na raiz.

## 4. Configure as variáveis de ambiente

1. Clique no card do serviço.
2. Vá para a aba **Variables**.
3. Adicione:
   - `JWT_SECRET`: uma string aleatória segura com 32+ caracteres.
   - `REBASE_SERVICE_KEY`: outra string aleatória segura com 32+ caracteres.
   - `NODE_ENV`: `production`
   - `CORS_ORIGINS`: o domínio do seu frontend (ex.: `https://your-app.up.railway.app`)
   - `FRONTEND_URL`: o mesmo que `CORS_ORIGINS`
   - `DISABLE_SELF_REGISTRATION`: `true`
   - `REBASE_ADMIN_EMAIL`: o endereço de e-mail do primeiro administrador
   - `REBASE_ADMIN_PASSWORD`: pelo menos 12 caracteres

   As três últimas são a forma como este serviço obtém um administrador: em produção, a primeira conta a se registrar não é promovida automaticamente, portanto, nada mais gerará o primeiro chamador autenticado. Configure-as antes que o serviço atenda tráfego pela primeira vez — consulte [Seu primeiro admin](/docs/getting-started/deployment/#your-first-admin).

4. Clique em **Reference Variable** e selecione `DATABASE_URL` do serviço PostgreSQL. O Railway injeta a URL interna do Postgres em tempo de execução.

O Railway define `PORT` e o runtime vincula-se a ela, portanto não há porta para configurar. Aponte o health check para `/livez` em vez de `/health`: o segundo realiza uma viagem de ida e volta ao banco de dados (round-trip), de modo que uma liveness probe nele reiniciará um contêiner saudável durante uma breve oscilação do banco de dados.

## 5. Exponha o domínio

1. No card do serviço, vá para **Settings → Networking**.
2. Em **Public Networking**, clique em **Generate Domain** para obter uma URL `.up.railway.app` ou vincule um domínio personalizado.

## 6. O schema

**O runtime cria tabelas ausentes na inicialização, incluindo as das suas coleções.** `REBASE_MIGRATE_ON_BOOT` tem como padrão `ensure`, que é aditivo em todo o schema — ele cria tabelas, colunas e tipos enum ausentes e aplica a segurança em nível de linha (row-level security) deles — assim, a primeira inicialização em um banco de dados vazio já começa servindo suas coleções.

O que o `ensure` nunca faz é alterar algo que já existe: ele não altera o tipo de uma coluna, não exclui nada nem edita os rótulos de um enum existente, pois o reinício de um contêiner não deve remodelar um schema como efeito colateral de um deploy.

Portanto, duas coisas ainda exigem a CLI, executada a partir de um checkout ou de um job de CI:

```bash
rebase db push
```

- **RLS em tabelas de junção** para relações muitos-para-muitos.
- **Qualquer alteração que não seja puramente aditiva** — uma coluna renomeada, um tipo restringido, um campo removido.

Aponte `DATABASE_URL` para a string de conexão **pública** do seu serviço Postgres (widget do Postgres → **Connect**); a URL interna referenciada só é acessível de dentro do Railway. A imagem de runtime é distribuída sem a CLI, portanto isso nunca é executado dentro do contêiner. Para migrações versionadas, faça commit dos arquivos de migração com `rebase db generate` e execute `rebase db migrate` como uma etapa de release.

## Armazenamento de arquivos

Os contêineres do Railway são substituídos a cada deploy, portanto o armazenamento local de arquivos resulta em perda silenciosa de dados e o runtime o recusa em produção. Conecte um bucket compatível com S3 com `STORAGE_TYPE=s3` — consulte [Armazenamento](/docs/backend/storage).

## Próximos passos

- [Deployment](/docs/getting-started/deployment) — o checklist de produção e as regras de primeiro administrador compartilhadas por todas as plataformas.
- [Configuration](/docs/getting-started/configuration) — todas as variáveis de ambiente que o runtime lê.
