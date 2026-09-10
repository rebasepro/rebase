---
sourceHash: 32d97963eacb9f50
title: Deploy do Rebase na Railway
description: Faça o deploy do Rebase na Railway a partir da imagem de runtime publicada e do bundle do seu projeto. Mantenha a conformidade na UE.
sidebar_label: Railway
---

A Railway é uma PaaS moderna que elimina a complexidade do DevOps e oferece suporte a regiões de implantação europeias (Amsterdã), mantendo a conformidade de hospedagem regional.

Nada nesta página sobre o seu projeto é específico da Railway. Um deploy do Rebase é composto por duas partes separáveis — a imagem de runtime publicada e o **bundle** que o `rebase build` produz — e o mesmo bundle pode ser executado via Docker Compose em um laptop, no Rebase Cloud, através do [Helm chart](/docs/deployment/kubernetes) ou aqui.

## 1. Crie um projeto e uma região na UE

1. Faça login na sua [conta da Railway](https://railway.app/).
2. Clique em **New Project**.
3. Vá em **Settings → Default Region** e defina como **Europe (Amsterdam)**. Fazer isso *após* criar os serviços exigirá migrá-los manualmente.

## 2. Provisione o PostgreSQL

1. Dentro do seu projeto, clique em **New → Database → Add PostgreSQL**.
2. Aguarde o provisionamento.
3. A Railway expõe uma variável interna `DATABASE_URL` na aba **Variables** do widget do Postgres.

Se as suas collections declararem uma propriedade `vector`, ative a extensão uma única vez nesse banco de dados: `CREATE EXTENSION vector;`.

## 3. Gere o bundle e inclua-o em uma imagem

**Não há imagem de aplicação a ser construída a partir do seu código-fonte**. O comando `rebase build` gera um diretório `dist-bundle` com suas collections compiladas, functions, crons e — se o seu projeto declarar uma aplicação estática — o seu frontend compilado. A imagem de runtime publicada executa tudo isso:

```bash
rebase build
```

Faça commit de um `Dockerfile` de três linhas na raiz do repositório, para que a etapa de build da Railway seja apenas uma cópia em vez de uma compilação:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.20.0
COPY dist-bundle /bundle
```

Gere o bundle no CI e faça o commit ou upload dele como parte da sua release, ou execute `rebase build` antes de enviar o push. De qualquer forma, a imagem que a Railway compila não contém ferramentas de build (toolchain) nem código-fonte — atualizar o Rebase no futuro exige apenas alterar a linha `FROM`, deixando o seu bundle intacto.

Em seguida: vá em **New → GitHub Repo**, selecione o seu repositório e deixe a Railway detectar o Dockerfile na raiz.

## 4. Defina as variáveis de ambiente

1. Clique no card do serviço.
2. Vá para a aba **Variables**.
3. Adicione:
   - `JWT_SECRET`: uma string aleatória e segura com mais de 32 caracteres.
   - `REBASE_SERVICE_KEY`: outra string aleatória e segura com mais de 32 caracteres.
   - `NODE_ENV`: `production`
   - `CORS_ORIGINS`: o domínio do seu frontend (ex.: `https://your-app.up.railway.app`)
   - `FRONTEND_URL`: o mesmo valor de `CORS_ORIGINS`
   - `DISABLE_SELF_REGISTRATION`: `true`
   - `REBASE_ADMIN_EMAIL`: o endereço do primeiro administrador
   - `REBASE_ADMIN_PASSWORD`: no mínimo 12 caracteres

   As três últimas são essenciais para que este serviço tenha um administrador: em produção, a primeira conta a se registrar não é promovida automaticamente, portanto nada mais criará o primeiro usuário autenticado. Defina essas variáveis antes que o serviço receba tráfego pela primeira vez — consulte [Seu primeiro admin](/docs/getting-started/deployment/#your-first-admin).

4. Clique em **Reference Variable** e selecione `DATABASE_URL` do serviço PostgreSQL. A Railway injetará a URL interna do Postgres em tempo de execução.

A Railway define a variável `PORT` e o runtime se vincula a ela, portanto não há porta a ser configurada. Aponte o health check para `/livez` em vez de `/health`: a segunda opção realiza uma consulta de ida e volta ao banco de dados, o que faria uma verificação de liveness reiniciar um contêiner saudável durante uma oscilação momentânea do banco.

## 5. Exponha o domínio

1. No card do serviço, vá em **Settings → Networking**.
2. Em **Public Networking**, clique em **Generate Domain** para obter uma URL `.up.railway.app`, ou associe um domínio personalizado.

## 6. O schema

**O runtime cria as tabelas ausentes na inicialização, incluindo as das suas collections.** O valor padrão de `REBASE_MIGRATE_ON_BOOT` é `ensure`, que é puramente aditivo em todo o schema — ele cria tabelas, colunas e tipos enum ausentes e aplica a segurança em nível de linha (RLS) a eles — de modo que a primeira inicialização em um banco de dados vazio já começa atendendo às suas collections.

O que o `ensure` nunca faz é alterar algo que já existe: ele não altera o tipo de uma coluna, não remove nada nem edita os valores de um enum existente, pois a reinicialização de um contêiner não deve remodelar o schema como efeito colateral de um deploy.

Portanto, duas situações ainda exigem o uso da CLI, executada a partir de um checkout local ou de um job de CI:

```bash
rebase db push
```

- **RLS em tabelas de junção** para relações muitos-para-muitos (many-to-many).
- **Qualquer alteração que não seja puramente aditiva** — uma coluna renomeada, um tipo com restrição mais estrita, um campo removido.

Aponte `DATABASE_URL` para a string de conexão **pública** do seu serviço Postgres (widget do Postgres → **Connect**); a URL interna referenciada só é acessível dentro da Railway. A imagem de runtime é fornecida sem a CLI, portanto isso nunca é executado dentro do contêiner. Para migrações versionadas, faça commit dos arquivos de migração com `rebase db generate` e execute `rebase db migrate` como uma etapa de release.

## Armazenamento de arquivos

Os contêineres da Railway são substituídos a cada deploy, portanto o armazenamento de arquivos local causará perda silenciosa de dados e o runtime o recusa em produção. Conecte um bucket compatível com S3 usando `STORAGE_TYPE=s3` — consulte [Armazenamento](/docs/backend/storage).

## Próximos passos

- [Deploy](/docs/getting-started/deployment) — o checklist de produção e as regras para o primeiro administrador comuns a todas as plataformas.
- [Configuração](/docs/getting-started/configuration) — todas as variáveis de ambiente lidas pelo runtime.

---
