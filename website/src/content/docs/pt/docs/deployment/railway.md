---
sourceHash: 7ec305359558821f
title: Fazendo o deploy do Rebase no Railway
description: Faça o deploy do Rebase no Railway a partir da imagem de runtime publicada e do bundle do seu projeto. Mantenha o foco na UE.
sidebar_label: Railway
---

O Railway é um PaaS moderno que elimina as dores do DevOps e oferece suporte a regiões de implantação europeias (Amsterdã), para que você mantenha a conformidade com a hospedagem regional.

Nada nesta página é específico do Railway em relação ao seu projeto. Uma implantação do Rebase é composta por duas partes separáveis — a imagem de runtime publicada e o **bundle** que o `rebase build` produz — e o mesmo bundle é executado no Docker Compose em um laptop, no Rebase Cloud, sob o [Helm chart](/docs/deployment/kubernetes) e aqui.

## 1. Criar um projeto e uma região da UE

1. Faça login na sua [conta do Railway](https://railway.app/).
2. Clique em **New Project**.
3. Vá para **Settings → Default Region** e defina-a como **Europe (Amsterdam)**. Fazer isso *depois* de criar os serviços significa ter que migrá-los manualmente.

## 2. Provisionar o PostgreSQL

1. Dentro do seu projeto, clique em **New → Database → Add PostgreSQL**.
2. Aguarde a conclusão do provisionamento.
3. O Railway disponibiliza uma variável `DATABASE_URL` interna na aba **Variables** do widget do Postgres.

Se as suas tabelas declararem uma coluna `col.vector()`, ative a extensão uma vez nesse banco de dados: `CREATE EXTENSION vector;`.

## 3. Gerar o bundle e empacotá-lo em uma imagem

Não há **nenhuma imagem de aplicação para construir a partir do seu código-fonte**. O `rebase build` produz um diretório `dist-bundle` com suas tabelas compiladas, funções, crons e — se o seu projeto declarar um app estático — seu frontend compilado. A imagem de runtime publicada o executa:

```bash
rebase build
```

Faça commit de um `Dockerfile` de três linhas na raiz do repositório, para que a etapa de build do Railway seja apenas uma cópia em vez de uma compilação:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

Gere o bundle no CI e faça commit ou upload dele como parte da sua release, ou execute `rebase build` antes de fazer o push. De qualquer forma, a imagem construída pelo Railway não contém toolchains nem código-fonte — atualizar o Rebase mais tarde é apenas alterar essa linha `FROM`, mantendo o seu bundle intocado.

Depois: **New → GitHub Repo**, selecione seu repositório e deixe o Railway detectar o Dockerfile na raiz.

## 4. Definir variáveis de ambiente

1. Clique no card do serviço.
2. Vá para a aba **Variables**.
3. Adicione:
   - `JWT_SECRET`: uma string aleatória segura com mais de 32 caracteres.
   - `REBASE_SERVICE_KEY`: outra string aleatória segura com mais de 32 caracteres.
   - `NODE_ENV`: `production`
   - `CORS_ORIGINS`: o domínio do seu frontend (por exemplo, `https://your-app.up.railway.app`)
   - `FRONTEND_URL`: o mesmo que `CORS_ORIGINS`
   - `DISABLE_SELF_REGISTRATION`: `true`
   - `REBASE_ADMIN_EMAIL`: o endereço do primeiro administrador
   - `REBASE_ADMIN_PASSWORD`: pelo menos 12 caracteres

   As três últimas variáveis são a forma pela qual este serviço obtém um administrador: em produção, a primeira conta a se registrar não é promovida, portanto nada mais gera o primeiro chamador autenticado. Defina-as antes de o serviço receber tráfego pela primeira vez — consulte [Seu primeiro administrador](/docs/getting-started/deployment/#your-first-admin).

4. Clique em **Reference Variable** e selecione `DATABASE_URL` do serviço PostgreSQL. O Railway injeta a URL interna do Postgres em tempo de execução.

O Railway define a variável `PORT` e o runtime faz o bind nela, portanto não há porta a ser configurada. Aponte o health check para `/livez` em vez de `/health`: a segunda opção realiza uma operação de ida e volta ao banco de dados (round-trip), de modo que uma liveness probe apontada para ela reiniciará um contêiner saudável durante uma breve oscilação do banco de dados.

## 5. Expor o domínio

1. No card do serviço, vá para **Settings → Networking**.
2. Em **Public Networking**, clique em **Generate Domain** para obter uma URL `.up.railway.app` ou vincule um domínio personalizado.

## 6. O schema

<span class="since-badge" data-since="0.31">Desde 0.31</span>

**O runtime cria as tabelas ausentes na inicialização, incluindo aquelas declaradas por `backend/schema`.** O valor padrão de `REBASE_MIGRATE_ON_BOOT` é `ensure`, que é aditivo em todo o schema — ele cria tabelas, colunas e tipos enum ausentes e aplica a segurança em nível de linha (row-level security) deles — para que a primeira inicialização em um banco de dados vazio já comece servindo suas coleções.

O que o `ensure` nunca faz é alterar algo que já existe: ele não altera o tipo de uma coluna, não remove nada nem edita os rótulos de um enum existente, pois a reinicialização de um contêiner não deve remodelar um schema como efeito colateral de um deploy.

Portanto, uma coisa ainda exige a CLI, executada a partir de um checkout ou de um job de CI:

```bash
rebase db push
```

Qualquer alteração que não seja puramente aditiva — uma coluna renomeada, um tipo restrito, um campo removido.

Aponte a `DATABASE_URL` para a string de conexão **pública** do seu serviço Postgres (widget do Postgres → **Connect**); a URL interna referenciada só é acessível de dentro do Railway. A imagem de runtime é distribuída sem a CLI, portanto isso nunca é executado dentro do contêiner. Para migrações versionadas, faça commit dos arquivos de migração com `rebase db generate` e execute `rebase db migrate` como uma etapa de release.

## Armazenamento de arquivos

Os contêineres do Railway são substituídos a cada deploy, portanto o armazenamento de arquivos local causará perda silenciosa de dados e o runtime o recusa em produção. Conecte um bucket compatível com S3 com `STORAGE_TYPE=s3` — consulte [Armazenamento](/docs/backend/storage).

## Próximos passos

- [Implantação](/docs/getting-started/deployment) — o checklist de produção e as regras para o primeiro administrador comuns a todas as plataformas.
- [Configuração](/docs/getting-started/configuration) — todas as variáveis de ambiente que o runtime lê.
