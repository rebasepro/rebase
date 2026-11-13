---
sourceHash: 0632063aadcff623
title: Implantando o Rebase no Google Cloud Platform
description: Faça o deploy da sua instância do Rebase com segurança no GCP usando Cloud SQL e Cloud Run, com foco em regiões de data centers da UE.
sidebar_label: Google Cloud
---

O Google Cloud Platform (GCP) oferece uma experiência de desenvolvimento contínua para aplicações conteinerizadas. Para uma configuração de produção robusta, use o **Cloud SQL** para o banco de dados e o **Cloud Run** para o runtime.

Para manter uma estrita conformidade com os regulamentos de dados europeus, opere inteiramente dentro de uma região da UE, como **europe-west3 (Frankfurt)**, **europe-west9 (Paris)** ou **europe-west1 (Bélgica)**.

Nada nesta página sobre o seu projeto é específico para o GCP. Um deploy do Rebase é composto por duas partes separáveis — a imagem de runtime publicada e o **bundle** gerado por `rebase build` — e o mesmo bundle pode ser executado no Docker Compose em um laptop, no Rebase Cloud, com o [Helm chart](/docs/deployment/kubernetes) ou aqui.

## 1. Provisionar o Cloud SQL (PostgreSQL)

1. Navegue até o console do **Cloud SQL** na sua região preferida da UE.
2. Clique em **Criar instância** e selecione **PostgreSQL**.
3. Defina o ID da sua instância e gere uma senha segura para o usuário `postgres`.
4. Expanda **Opções de configuração** para escolher um tipo de máquina (duas vCPUs é um bom começo).
5. Configure um IP privado ou uma rede pública autorizada, dependendo de como o Cloud Run irá acessá-lo.
6. Monte seu URI de conexão:
   `postgresql://postgres:YOUR_PASSWORD@YOUR_IP:5432/postgres`

Se as suas tabelas declararem uma coluna `col.vector()`, habilite a extensão uma vez executando `CREATE EXTENSION vector;` no banco de dados.

## 2. Construir o bundle e incorporá-lo a uma imagem

Não há **nenhuma imagem de aplicação para construir a partir do seu código-fonte**. O comando `rebase build` gera um diretório `dist-bundle` com suas tabelas, funções, crons compilados e — se o seu projeto declarar um app estático — o seu frontend compilado. A imagem de runtime publicada se encarrega de executá-lo:

```bash
rebase build
```

O Cloud Run obtém imagens a partir de um registro, portanto, incorpore o bundle em uma imagem derivada. Três linhas fixam exatamente o que será executado:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

```bash
# Set your active GCP project
gcloud config set project YOUR_PROJECT_ID

# Create an Artifact Registry repository (one-time)
gcloud artifacts repositories create rebase --repository-format=docker --location=europe-west3

# Authenticate Docker to Artifact Registry (one-time)
gcloud auth configure-docker europe-west3-docker.pkg.dev

# Build from the project root and push
docker build -t europe-west3-docker.pkg.dev/YOUR_PROJECT_ID/rebase/backend:latest .
docker push europe-west3-docker.pkg.dev/YOUR_PROJECT_ID/rebase/backend:latest
```

Atualizar o Rebase no futuro se resume a alterar essa linha `FROM`. O seu bundle permanece intocado.

## 3. Fazer o deploy no Cloud Run

```bash
gcloud run deploy rebase-backend \
  --image europe-west3-docker.pkg.dev/YOUR_PROJECT_ID/rebase/backend:latest \
  --region europe-west3 \
  --set-env-vars NODE_ENV="production",CORS_ORIGINS="https://yourdomain.com",FRONTEND_URL="https://yourdomain.com",DISABLE_SELF_REGISTRATION="true",REBASE_ADMIN_EMAIL="you@yourdomain.com" \
  --set-secrets DATABASE_URL=rebase-database-url:latest,JWT_SECRET=rebase-jwt-secret:latest,REBASE_SERVICE_KEY=rebase-service-key:latest,REBASE_ADMIN_PASSWORD=rebase-admin-password:latest \
  --allow-unauthenticated
```

O Cloud Run injeta a variável `PORT` e o runtime vincula-se a ela, portanto não há porta para configurar. Aponte a sonda de inicialização (startup probe) para `/livez` em vez de `/health`: a segunda realiza uma consulta completa de ida e volta ao banco de dados, fazendo com que uma verificação de vivacidade (liveness probe) reinicie uma revisão saudável durante uma breve oscilação do banco de dados.

`REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` são a forma como este serviço obtém um administrador: em produção, a primeira conta a se registrar não é promovida automaticamente, portanto, nada mais cria o primeiro chamador autenticado. Defina-os antes que a primeira revisão comece a receber tráfego — consulte [Seu primeiro admin](/docs/getting-started/deployment/#your-first-admin).

`--set-env-vars` substitui o bloco de variáveis de ambiente **inteiro** a cada deploy; portanto, um deploy posterior que omita uma variável irá removê-la silenciosamente. Mantenha a lista completa no seu script de deploy.

Para acessar uma instância privada do Cloud SQL, é necessário usar `--add-cloudsql-instances YOUR_PROJECT:REGION:INSTANCE` e uma `DATABASE_URL` no formato de socket; uma instância pública com uma rede autorizada não requer nenhum dos dois.

## 4. O schema

<span class="since-badge" data-since="0.31">Desde 0.31</span>

**O runtime cria as tabelas ausentes na inicialização, incluindo aquelas declaradas em `backend/schema`.** `REBASE_MIGRATE_ON_BOOT` tem como padrão `ensure`, que é aditivo em todo o schema — ele cria tabelas, colunas e tipos enum ausentes e aplica a segurança em nível de linha (row-level security) correspondente — de modo que a primeira inicialização em uma instância vazia já entra em operação servindo suas coleções.

O que o `ensure` nunca faz é alterar algo que já existe: ele não modifica o tipo de uma coluna, não exclui nada nem altera os valores de um enum existente, pois a inicialização de uma revisão não deve remodelar o schema como efeito colateral de um deploy.

Portanto, uma tarefa ainda exige o uso da CLI, executada a partir de uma cópia local (checkout) ou de um job de CI:

```bash
rebase db push
```

Qualquer alteração que não seja puramente aditiva — uma coluna renomeada, um tipo restringido ou um campo removido.

Na sua máquina, conecte-se por meio do [Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy) e aponte a `DATABASE_URL` para `localhost`. A imagem de runtime não contém a CLI, portanto isso nunca é executado dentro do container do Cloud Run. Para migrações versionadas, faça commit dos arquivos de migração com `rebase db generate` e execute `rebase db migrate` como uma etapa de release.

## Armazenamento de arquivos

As instâncias do Cloud Run são stateless e efêmeras, portanto o armazenamento de arquivos local resulta em perda silenciosa de dados e é recusado pelo runtime em produção.

1. Crie um bucket privado no Google Cloud Storage na sua região preferida da UE.
2. Crie uma chave HMAC para uma conta de serviço com permissão para usar o bucket (**Cloud Storage → Configurações → Interoperabilidade**) e acesse o bucket por meio de seu endpoint compatível com S3: `STORAGE_TYPE=s3`, `S3_BUCKET`, `S3_ENDPOINT=https://storage.googleapis.com`, `S3_REGION=auto`, e a chave configurada como `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` — consulte [Armazenamento](/docs/backend/storage). `STORAGE_TYPE=gcs` carrega o pacote `@google-cloud/storage`, que não acompanha a imagem de runtime, e uma cópia no seu bundle não estará no caminho de resolução dele.

:::caution
O Cloud Run escala até zero instâncias. Se o seu projeto usa assinaturas em tempo real (realtime), defina `--min-instances 1` — as conexões WebSocket são encerradas quando uma instância é desativada por redução de escala.
:::

## Próximos passos

- [Deploy](/docs/getting-started/deployment) — o checklist de produção e as regras para o primeiro administrador comuns a todas as plataformas.
- [Configuração](/docs/getting-started/configuration) — todas as variáveis de ambiente que o runtime reconhece.
