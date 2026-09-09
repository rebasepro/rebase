---
sourceHash: e902dc7a4aad0fa2
title: Implantando o Rebase na Google Cloud Platform
description: Implante sua instância do Rebase com segurança no GCP usando Cloud SQL e Cloud Run, com foco nas regiões de data center da UE.
sidebar_label: Google Cloud
---

A Google Cloud Platform (GCP) oferece uma experiência de desenvolvimento fluida para aplicações em contêineres. Para uma configuração de produção robusta, use o **Cloud SQL** para o banco de dados e o **Cloud Run** para o runtime.

Para manter uma conformidade rigorosa com os dados europeus, opere inteiramente dentro de uma região da UE, como **europe-west3 (Frankfurt)**, **europe-west9 (Paris)** ou **europe-west1 (Bélgica)**.

Nada nesta página é específico do GCP em relação ao seu projeto. Uma implantação do Rebase é composta por duas partes separáveis — a imagem de runtime publicada e o **bundle** que o `rebase build` produz — e o mesmo bundle é executado no Docker Compose em um laptop, no Rebase Cloud, sob o [Helm chart](/docs/deployment/kubernetes) e aqui.

## 1. Provisionar o Cloud SQL (PostgreSQL)

1. Navegue até o console do **Cloud SQL** na sua região da UE de preferência.
2. Clique em **Create Instance** e selecione **PostgreSQL**.
3. Defina o ID da sua instância e gere uma senha segura para o usuário `postgres`.
4. Expanda **Configuration Options** para escolher um tipo de máquina (duas vCPUs é um bom começo).
5. Configure um IP privado ou uma rede pública autorizada, dependendo de como o Cloud Run irá acessá-lo.
6. Monte sua URI de conexão:
   `postgresql://postgres:YOUR_PASSWORD@YOUR_IP:5432/postgres`

Se suas coleções declararem uma propriedade `vector`, habilite a extensão uma vez: `CREATE EXTENSION vector;` no banco de dados.

## 2. Construir o bundle e incorporá-lo a uma imagem

Não há **nenhuma imagem de aplicação para construir a partir do seu código-fonte**. O `rebase build` produz um diretório `dist-bundle` com suas coleções, funções, crons compilados e — se o seu projeto declarar um app estático — seu frontend compilado. A imagem de runtime publicada o executa:

```bash
rebase build
```

O Cloud Run faz o pull a partir de um registro, portanto, incorpore o bundle em uma imagem derivada. Três linhas, e isso fixa exatamente o que é executado:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.19.1
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

Atualizar o Rebase posteriormente se resume a alterar essa linha `FROM`. Seu bundle permanece intocado.

## 3. Fazer o deploy no Cloud Run

```bash
gcloud run deploy rebase-backend \
  --image europe-west3-docker.pkg.dev/YOUR_PROJECT_ID/rebase/backend:latest \
  --region europe-west3 \
  --set-env-vars NODE_ENV="production",CORS_ORIGINS="https://yourdomain.com",FRONTEND_URL="https://yourdomain.com",DISABLE_SELF_REGISTRATION="true",REBASE_ADMIN_EMAIL="you@yourdomain.com" \
  --set-secrets DATABASE_URL=rebase-database-url:latest,JWT_SECRET=rebase-jwt-secret:latest,REBASE_SERVICE_KEY=rebase-service-key:latest,REBASE_ADMIN_PASSWORD=rebase-admin-password:latest \
  --allow-unauthenticated
```

O Cloud Run injeta a variável `PORT` e o runtime se vincula a ela, portanto não há porta a ser configurada. Aponte a verificação de inicialização (startup probe) para `/livez` em vez de `/health`: a segunda realiza uma viagem de ida e volta ao banco de dados (round-trip), de modo que uma liveness probe nela reiniciaria uma revisão íntegra durante uma breve oscilação do banco de dados.

`REBASE_ADMIN_EMAIL` e `REBASE_ADMIN_PASSWORD` são a forma como este serviço obtém um administrador: em produção, a primeira conta a se registrar não é promovida, portanto, nada mais cria o primeiro chamador autenticado. Defina-os antes que a primeira revisão comece a atender ao tráfego — consulte [Seu primeiro administrador](/docs/getting-started/deployment/#your-first-admin).

O `--set-env-vars` substitui **todo** o bloco de ambiente a cada deploy; portanto, um deploy posterior que omita uma variável irá desativá-la silenciosamente. Mantenha a lista completa no seu script de deploy.

Para alcançar uma instância privada do Cloud SQL, é necessário usar `--add-cloudsql-instances YOUR_PROJECT:REGION:INSTANCE` e uma `DATABASE_URL` no formato de socket; uma instância pública com uma rede autorizada não precisa de nenhum dos dois.

## 4. O schema

**O runtime cria tabelas ausentes na inicialização, incluindo as das suas coleções.** O `REBASE_MIGRATE_ON_BOOT` tem como padrão `ensure`, que é aditivo em todo o schema — ele cria tabelas, colunas e tipos enum ausentes e aplica a segurança em nível de linha (row-level security) a eles — de forma que a primeira inicialização em uma instância vazia já entra em operação atendendo às suas coleções.

O que o `ensure` nunca faz é alterar algo que já existe: ele não altera o tipo de uma coluna, não remove nada e não edita os rótulos de um enum existente, pois uma revisão ao iniciar não deve remodelar o schema como efeito colateral de um deploy.

Portanto, duas coisas ainda requerem a CLI, executada a partir de um checkout local ou de um job de CI:

```bash
rebase db push
```

- **RLS em tabelas de junção** para relações muitos-para-muitos.
- **Qualquer alteração que não seja puramente aditiva** — uma coluna renomeada, um tipo restringido, um campo removido.

A partir da sua máquina, conecte-se através do [Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy) e aponte a `DATABASE_URL` para `localhost`. A imagem de runtime é distribuída sem a CLI, portanto isso nunca é executado dentro do contêiner do Cloud Run. Para migrações versionadas, faça commit dos arquivos de migração com `rebase db generate` e execute `rebase db migrate` como uma etapa de release.

## Armazenamento de arquivos

As instâncias do Cloud Run são stateless e efêmeras, portanto o armazenamento local de arquivos resulta em perda silenciosa de dados, e o runtime o recusa em produção.

1. Crie um bucket privado no Google Cloud Storage na sua região da UE escolhida.
2. Defina `STORAGE_TYPE=gcs` e o respectivo bucket — consulte [Armazenamento](/docs/backend/storage). No Cloud Run, a conta de serviço ambiente fornece as credenciais, portanto não há mais nada a configurar.

:::caution
O Cloud Run escala para zero. Se o seu projeto usa assinaturas em tempo real (realtime subscriptions), defina `--min-instances 1` — conexões WebSocket são encerradas quando uma instância é reduzida na escala.
:::

## Próximos passos

- [Implantação](/docs/getting-started/deployment) — o checklist de produção e as regras de primeiro administrador compartilhadas por todas as plataformas.
- [Configuração](/docs/getting-started/configuration) — todas as variáveis de ambiente lidas pelo runtime.

---
