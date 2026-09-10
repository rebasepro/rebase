---
sourceHash: 10ade706e21556d1
title: Fazendo deploy do Rebase na Railway
description: Faça deploy do Rebase na Railway a partir da imagem de runtime publicada e do bundle do seu projeto. Mantenha o foco na UE.
sidebar_label: Railway
---

A Railway é uma PaaS moderna que simplifica o DevOps e oferece suporte a regiões de implantação europeias (Amsterdã), permitindo que você mantenha a conformidade de hospedagem regional.

Nada nesta página sobre o seu projeto é específico da Railway. Um deploy do Rebase é composto por duas partes separáveis — a imagem de runtime publicada e o **bundle** gerado pelo `rebase build` — e o mesmo bundle roda com Docker Compose em um computador local, no Rebase Cloud, no [Helm chart](/docs/deployment/kubernetes) e aqui.

## 1. Criar um projeto e uma região na UE

1. Faça login na sua [conta da Railway](https://railway.app/).
2. Clique em **New Project**.
3. Vá para **Settings → Default Region** e defina como **Europe (Amsterdam)**. Fazer isso *depois* de criar os serviços significa ter que migrá-los manualmente.

## 2. Provisionar o PostgreSQL

1. Dentro do seu projeto, clique em **New → Database → Add PostgreSQL**.
2. Aguarde o provisionamento.
3. A Railway expõe uma variável interna `DATABASE_URL` na aba **Variables** do widget do Postgres.

Se suas collections declararem uma propriedade `vector`, ative a extensão uma vez no banco de dados: `CREATE EXTENSION vector;`.

## 3. Gerar o bundle e incluí-lo em uma imagem

Não há **nenhuma imagem de aplicação para compilar a partir do seu código-fonte**. O `rebase build` gera um diretório `dist-bundle` com suas collections, functions, crons compilados e — se o seu projeto declarar um app estático — seu frontend compilado. A imagem de runtime publicada o executa:

```bash
rebase build
```

Faça commit de um `Dockerfile` de três linhas na raiz do repositório, para que a etapa de build da Railway seja apenas uma cópia em vez de uma compilação:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.20.0
COPY dist-bundle /bundle
```

Gere o bundle no CI e faça commit ou upload dele como parte da sua release, ou execute `rebase build` antes de dar push. De qualquer forma, a imagem criada pela Railway não conterá toolchain nem código-fonte — atualizar o Rebase mais tarde é apenas alterar essa linha `FROM`, mantendo seu bundle intacto.

Em seguida: **New → GitHub Repo**, selecione seu repositório e deixe a Railway detectar o Dockerfile na raiz.

## 4. Definir variáveis de ambiente

1. Clique no card do serviço.
2. Vá para a aba **Variables**.
3. Adicione:
   - `JWT_SECRET`: uma string aleatória e segura com 32+ caracteres.
   - `REBASE_SERVICE_KEY`: outra string aleatória e segura com 32+ caracteres.
   - `NODE_ENV`: `production`
   - `CORS_ORIGINS`: o domínio do seu frontend (ex.: `https://your-app.up.railway.app`)
   - `FRONTEND_URL`: o mesmo que `CORS_ORIGINS`
   - `DISABLE_SELF_REGISTRATION`: `true`
   - `REBASE_ADMIN_EMAIL`: o endereço do primeiro administrador
   - `REBASE_ADMIN_PASSWORD`: pelo menos 12 caracteres

   As últimas três são a forma como esse serviço obtém um administrador: em produção, a primeira conta registrada não é promovida automaticamente, portanto, nada mais cria o primeiro usuário autenticado. Defina-as antes de o serviço começar a atender tráfego — consulte [Seu primeiro admin](/docs/getting-started/deployment/#your-first-admin).

4. Clique em **Reference Variable** e selecione `DATABASE_URL` do serviço PostgreSQL. A Railway injeta a URL interna do Postgres em tempo de execução.

A Railway define `PORT` e o runtime vincula-se a ela, portanto, não há porta a ser configurada. Aponte o health check para `/livez` em vez de `/health`: o segundo realiza uma viagem de ida e volta ao banco de dados (round-trip), de modo que uma verificação de liveness nele reiniciaria um contêiner saudável durante uma breve oscilação do banco.

## 5. Expor o domínio

1. No card do serviço, vá para **Settings → Networking**.
2. Em **Public Networking**, clique em **Generate Domain** para obter uma URL `.up.railway.app`, ou associe um domínio personalizado.

## 6. O schema

**O runtime cria as tabelas ausentes na inicialização, incluindo as das suas collections.** `REBASE_MIGRATE_ON_BOOT` tem como padrão `ensure`, que é cumulativo em todo o schema — ele cria tabelas, colunas e tipos enum ausentes e aplica o row-level security (RLS) a eles — assim, a primeira inicialização em um banco de dados vazio já começa servindo suas collections.

O que o `ensure` nunca faz é alterar algo que já existe: ele não altera o tipo de uma coluna, não exclui nada nem edita os rótulos de um enum existente, pois a reinicialização de um contêiner não deve remodelar o schema como efeito colateral de um deploy.

Portanto, duas coisas ainda exigem a CLI, executada a partir de um checkout local ou de um job de CI:

```bash
rebase db push
```

- **RLS de tabelas de junção (junction tables)** para relações muitos-para-muitos.
- **Qualquer alteração que não seja puramente cumulativa** — uma coluna renomeada, um tipo restringido, um campo removido.

Aponte `DATABASE_URL` para a string de conexão **pública** do seu serviço Postgres (widget do Postgres → **Connect**); a URL interna referenciada só é acessível a partir de dentro da Railway. A imagem de runtime é distribuída sem a CLI, portanto, isso nunca é executado dentro do contêiner. Para migrações versionadas, faça commit dos arquivos de migração com `rebase db generate` e execute `rebase db migrate` como uma etapa de release.

## Armazenamento de arquivos

Os contêineres da Railway são substituídos a cada deploy, portanto, o armazenamento local de arquivos resulta em perda silenciosa de dados e o runtime o recusa em produção. Conecte um bucket compatível com S3 usando `STORAGE_TYPE=s3` — consulte [Armazenamento](/docs/backend/storage).

## Próximos passos

- [Deploy](/docs/getting-started/deployment) — o checklist de produção e as regras de primeiro admin compartilhadas por todas as plataformas.
- [Configuração](/docs/getting-started/configuration) — todas as variáveis de ambiente lidas pelo runtime.
