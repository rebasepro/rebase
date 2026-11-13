---
sourceHash: 8d400239df61cbd4
title: Implantando o Rebase no Google Cloud Platform
description: Implante sua instância do Rebase com segurança no GCP usando Cloud SQL e Cloud Run, com foco em regiões de data center da UE.
sidebar_label: Google Cloud
---

O Google Cloud Platform (GCP) oferece uma experiência de desenvolvedor fluida para aplicações em contêineres. Para uma configuração de produção robusta, use o **Cloud SQL** para o banco de dados e o **Cloud Run** para o runtime.

Para manter conformidade rigorosa com os dados europeus, opere inteiramente dentro de uma região da UE, como **europe-west3 (Frankfurt)**, **europe-west9 (Paris)** ou **europe-west1 (Bélgica)**.

Nada nesta página é específico do GCP em relação ao seu projeto. Uma implantação do Rebase é composta por duas partes separáveis — a imagem de runtime publicada e o **bundle** que o `rebase build` produz — e o mesmo bundle é executado sob o Docker Compose em um computador pessoal, no Rebase Cloud, sob o [Helm chart](/docs/deployment/kubernetes) e aqui.

## 1. Provisionar o Cloud SQL (PostgreSQL)

1. Navegue até o console do **Cloud SQL** na sua região preferida da UE.
2. Clique em **Create Instance** e selecione **PostgreSQL**.
3. Defina o ID da sua instância e gere uma senha segura para o usuário `postgres`.
4. Expanda **Configuration Options** para escolher um tipo de máquina (duas vCPUs é um bom começo).
5. Configure um IP privado ou uma rede pública autorizada, dependendo de como o Cloud Run irá acessá-lo.
6. Monte sua URI de conexão:
   `postgresql://postgres:YOUR_PASSWORD@YOUR_IP:5432/postgres`

Se suas tabelas declararem uma coluna `col.vector()`, habilite a extensão uma vez executando `CREATE EXTENSION vector;` no banco de dados.

## 2. Compilar o bundle e integrá-lo a uma imagem

Não há **nenhuma imagem de aplicação para compilar a partir do seu código-fonte**. O `rebase build` produz um diretório `dist-bundle` com suas tabelas, funções e crons compilados e — se o seu projeto declarar um app estático — seu frontend compilado. A imagem de runtime publicada o executa:

```bash
rebase build
```

O Cloud Run baixa imagens de um registro, então embuta o bundle em uma imagem derivada. Três linhas, e isso fixa exatamente o que é executado:

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

Atualizar o Rebase posteriormente se resume a alterar essa linha `FROM`. Seu bundle permanece intacto.

## 3. Implantar no Cloud Run

```bash
gcloud run deploy rebase-backend \
  --image europe-west3-docker.pkg.dev/YOUR_PROJECT_ID/rebase/backend:latest \
  --region europe-west3 \
  --set-env-vars NODE_ENV="production",CORS_ORIGINS="https://yourdomain.com",FRONTEND_URL="https://yourdomain.com",DISABLE_SELF_REGISTRATION="true",REBASE_ADMIN_EMAIL="you@yourdomain.com" \
  --set-secrets DATABASE_URL=rebase-database-url:latest,JWT_SECRET=rebase-jwt-secret:latest,REBASE_SERVICE_KEY=rebase-service-key:latest,REBASE_ADMIN_PASSWORD=rebase-admin-password:latest \
  --allow-unauthenticated
```

O Cloud Run injeta a variável `PORT` e o runtime se vincula a ela, portanto não há porta a ser configurada. Aponte a probe de inicialização (startup probe) para `/livez` em vez de `/health`: a segunda executa uma viagem de ida e volta ao banco de dados, de modo que uma probe de liveness nela reiniciará uma revisão saudável durante uma breve oscilação do banco de dados.

`REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` são a maneira pela qual este serviço obtém um administrador: em produção, a primeira conta a se registrar não é promovida, logo, nada mais cria o primeiro chamador autenticado. Defina-os antes que a primeira revisão comece a receber tráfego — consulte [Seu primeiro administrador](/docs/getting-started/deployment/#your-first-admin).

O parâmetro `--set-env-vars` substitui o bloco **inteiro** de variáveis de ambiente a cada deploy; portanto, um deploy posterior que omita uma variável irá removê-la silenciosamente. Mantenha a lista completa no seu script de deploy.

Acessar uma instância privada do Cloud SQL requer `--add-cloudsql-instances YOUR_PROJECT:REGION:INSTANCE` e uma `DATABASE_URL` no formato de socket; uma instância pública com uma rede autorizada não precisa de nenhum dos dois.

## 4. O schema

<span class="since-badge" data-since="0.31">Desde 0.31</span>

**O runtime cria tabelas ausentes na inicialização, incluindo aquelas que `backend/schema` declara.** O valor padrão de `REBASE_MIGRATE_ON_BOOT` é `ensure`, que é aditivo em todo o schema — ele cria tabelas, colunas e tipos enum ausentes e aplica a segurança a nível de linha (row-level security) deles — de modo que a primeira inicialização em uma instância vazia já fica pronta servindo suas tabelas.

O que o `ensure` nunca faz é alterar algo que já existe: ele não altera o tipo de uma coluna, não remove nada e não edita os rótulos de um enum existente, pois a inicialização de uma revisão não deve remodelar um schema como efeito colateral de um deploy.

Portanto, uma coisa ainda requer a CLI, executada a partir de um checkout ou de um job de CI:

```bash
rebase db push
```

Qualquer alteração que não seja puramente aditiva — uma coluna renomeada, um tipo restringido, um campo removido.

A partir da sua máquina, conecte-se através do [Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy) e aponte a `DATABASE_URL` para `localhost`. A imagem de runtime é distribuída sem a CLI, portanto isso nunca é executado dentro do contêiner do Cloud Run. Para migrações versionadas, faça commit dos arquivos de migração com `rebase db generate` e execute `rebase db migrate` como uma etapa de release.

## Armazenamento de arquivos

As instâncias do Cloud Run são stateless e efêmeras, portanto o armazenamento local de arquivos resulta em perda silenciosa de dados e o runtime o recusa em produção.

1. Crie um bucket privado do Google Cloud Storage na sua região da UE escolhida.
2. Crie uma chave HMAC para uma conta de serviço (service account) que possa usar o bucket (**Cloud Storage → Configurações → Interoperabilidade**) e acesse o bucket através do seu endpoint compatível com S3: `STORAGE_TYPE=s3`, `S3_BUCKET`, `S3_ENDPOINT=https://storage.googleapis.com`, `S3_REGION=auto`, e a chave como `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` — consulte [Armazenamento](/docs/backend/storage). `STORAGE_TYPE=gcs` carrega o pacote `@google-cloud/storage`, que a imagem de runtime não inclui, e uma cópia no seu bundle não fica no caminho de resolução dele.

:::caution
O Cloud Run escala para zero. Se o seu projeto usa assinaturas em tempo real (realtime subscriptions), defina `--min-instances 1` — as conexões WebSocket são encerradas quando uma instância é reduzida a zero.
:::

## Próximos passos

- [Implantação](/docs/getting-started/deployment) — o checklist de produção e as regras de primeiro administrador compartilhadas por todas as plataformas.
- [Configuração](/docs/getting-started/configuration) — todas as variáveis de ambiente lidas pelo runtime.
