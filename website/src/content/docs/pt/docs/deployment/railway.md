---
sourceHash: 27f3eaf8b78d59e8
title: Implantando o Rebase na Railway
description: Implante o Rebase na Railway a partir da imagem de runtime publicada e do bundle do seu projeto. Mantenha o foco na UE.
sidebar_label: Railway
---

A Railway é uma PaaS moderna que elimina as dores do DevOps e oferece suporte a regiões de implantação europeias (Amsterdã), para que você mantenha a conformidade com a hospedagem regional.

Nada nesta página é específico da Railway em relação ao seu projeto. Uma implantação do Rebase é composta por duas partes separáveis — a imagem de runtime publicada e o **bundle** que o `rebase build` produz — e o mesmo bundle é executado no Docker Compose em um laptop, no Rebase Cloud, com o [Helm chart](/docs/deployment/kubernetes) e aqui.

## 1. Criar um projeto e uma região da UE

1. Faça login na sua [conta da Railway](https://railway.app/).
2. Clique em **New Project**.
3. Vá para **Settings → Default Region** e defina como **Europe (Amsterdam)**. Fazer isso *depois* de criar serviços significa ter que migrá-los manualmente.

## 2. Provisionar o PostgreSQL

1. Dentro do seu projeto, clique em **New → Database → Add PostgreSQL**.
2. Aguarde o provisionamento.
3. A Railway expõe uma variável interna `DATABASE_URL` na aba **Variables** do widget do Postgres.

Se suas tabelas declararem uma coluna `col.vector()`, habilite a extensão uma vez nesse banco de dados: `CREATE EXTENSION vector;`.

## 3. Construir o bundle e embuti-lo em uma imagem

Não há **nenhuma imagem de aplicação para construir a partir do seu código-fonte**. O `rebase build` produz um diretório `dist-bundle` com suas tabelas, funções e crons compilados e — se o seu projeto declarar uma aplicação estática — seu frontend construído. A imagem de runtime publicada o executa:

```bash
rebase build
```

Faça o commit de um `Dockerfile` de três linhas na raiz do repositório, para que a etapa de build da Railway seja apenas uma cópia em vez de uma compilação:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

Gere o bundle no CI e faça o commit ou envie-o como parte do seu release, ou execute `rebase build` antes de fazer o push. De qualquer forma, a imagem criada pela Railway não contém toolchain nem código-fonte — atualizar o Rebase mais tarde consiste apenas em alterar essa linha `FROM`, mantendo o seu bundle intocado.

Em seguida: **New → GitHub Repo**, selecione o seu repositório e deixe a Railway detectar o Dockerfile na raiz.

## 4. Configurar variáveis de ambiente

1. Clique no card do serviço.
2. Vá para a aba **Variables**.
3. Adicione:
   - `JWT_SECRET`: uma string aleatória segura com mais de 32 caracteres.
   - `REBASE_SERVICE_KEY`: outra string aleatória segura com mais de 32 caracteres.
   - `NODE_ENV`: `production`
   - `CORS_ORIGINS`: o domínio do seu frontend (ex.: `https://your-app.up.railway.app`)
   - `FRONTEND_URL`: o mesmo que `CORS_ORIGINS`
   - `DISABLE_SELF_REGISTRATION`: `true`
   - `REBASE_ADMIN_EMAIL`: o endereço do primeiro administrador
   - `REBASE_ADMIN_PASSWORD`: no mínimo 12 caracteres

   As três últimas são a forma como este serviço obtém um administrador: em produção, a primeira conta a se registrar não é promovida automaticamente, portanto nada mais gerará o primeiro usuário autenticado. Defina-as antes de o serviço atender ao tráfego pela primeira vez — consulte [Seu primeiro administrador](/docs/getting-started/deployment/#your-first-admin).

4. Clique em **Reference Variable** e selecione `DATABASE_URL` do serviço PostgreSQL. A Railway injeta a URL interna do Postgres em tempo de execução.

A Railway define a variável `PORT` e o runtime vincula-se a ela, portanto não há porta a configurar. Aponte o health check para `/livez` em vez de `/health`: o segundo realiza uma operação de ida e volta (round-trip) ao banco de dados, portanto uma liveness probe nele reiniciará um contêiner íntegro durante uma breve instabilidade no banco de dados.

## 5. Expor o domínio

1. No card do serviço, vá para **Settings → Networking**.
2. Em **Public Networking**, clique em **Generate Domain** para obter uma URL `.up.railway.app`, ou vincule um domínio personalizado.

## 6. O schema

<span class="since-badge" data-since="0.31">Desde 0.31</span>

**O runtime cria tabelas ausentes na inicialização, incluindo aquelas declaradas em `backend/schema`.** `REBASE_MIGRATE_ON_BOOT` tem como padrão `ensure`, que é aditivo em todo o schema — ele cria tabelas, colunas e tipos enum ausentes e aplica sua segurança em nível de linha (row-level security) — portanto, a primeira inicialização em um banco de dados vazio já começa servindo suas tabelas.

O que o `ensure` nunca faz é alterar algo que já existe: ele não altera o tipo de uma coluna, não exclui nada nem edita os rótulos de um enum existente, pois o reinício de um contêiner não deve remodelar um schema como efeito colateral de um deploy.

Portanto, uma coisa ainda requer o CLI, executado a partir de um checkout local ou de um job de CI:

```bash
rebase db push
```

Qualquer alteração que não seja puramente aditiva — uma coluna renomeada, um tipo mais restrito, um campo removido.

Aponte `DATABASE_URL` para a string de conexão **pública** do seu serviço Postgres (widget do Postgres → **Connect**); a URL interna referenciada só é acessível de dentro da Railway. A imagem de runtime é distribuída sem o CLI, portanto isso nunca é executado dentro do contêiner. Para migrações versionadas, faça commit dos arquivos de migração com `rebase db generate` e execute `rebase db migrate` como uma etapa de release.

## Armazenamento de arquivos

Os contêineres da Railway são substituídos a cada deploy, portanto o armazenamento de arquivos local resulta em perda silenciosa de dados e o runtime o recusa em produção. Conecte um bucket compatível com S3 com `STORAGE_TYPE=s3` — consulte [Armazenamento](/docs/backend/storage).

## Próximos passos

- [Implantação](/docs/getting-started/deployment) — o checklist de produção e as regras para o primeiro administrador compartilhadas por todas as plataformas.
- [Configuração](/docs/getting-started/configuration) — todas as variáveis de ambiente que o runtime lê.
