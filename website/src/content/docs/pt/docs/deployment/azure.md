---
sourceHash: 509568aa9395a6f7
title: Fazendo deploy do Rebase no Microsoft Azure
description: Faça o deploy da sua instância do Rebase com segurança no Azure usando o Azure Database for PostgreSQL e o Azure Container Apps.
sidebar_label: Azure
---

O Microsoft Azure oferece integrações sólidas e conformidade empresarial. A arquitetura ideal para executar o Rebase no Azure usa o **Azure Database for PostgreSQL – Flexible Server** para a camada de dados e o **Azure Container Apps** para o ambiente de execução (runtime).

Para cumprir as normas europeias de conformidade de dados e garantir tempos de resposta locais rápidos, provisione seus recursos em regiões como **West Europe (Amsterdam)**, **North Europe (Ireland)** ou **France Central (Paris)**.

Nada nesta página é específico do Azure em relação ao seu projeto. Uma implantação do Rebase consiste em duas partes separadas — a imagem de runtime publicada e o **bundle** gerado pelo `rebase build` — e o mesmo bundle roda sob o Docker Compose em um laptop, no Rebase Cloud, com o [Helm chart](/docs/deployment/kubernetes) e aqui.

## 1. Provisionar o PostgreSQL Flexible Server

1. No Portal do Azure, pesquise e selecione **Azure Database for PostgreSQL servers**.
2. Clique em **Create** e selecione **Flexible Server**.
3. Escolha seu Resource Group e defina sua região preferida da UE.
4. Selecione o tamanho de computação (Compute size, por exemplo, General Purpose ou Burstable `B2s` para implantações menores).
5. Configure a aba **Authentication** com um nome de usuário administrador e uma senha segura.
6. Em **Networking**, certifique-se de que "Allow public access from any Azure service within Azure to this server" esteja marcado para que o seu Container App possa se conectar, ou configure uma VNet segura.
7. Anote o nome do seu servidor e monte a URI de conexão:
   `postgresql://your_admin:YOUR_PASSWORD@your-server-name.postgres.database.azure.com:5432/postgres`

Se as suas collections declararem uma propriedade `vector`, habilite a extensão uma vez: o Azure a restringe atrás do parâmetro de servidor `azure.extensions`, e depois execute `CREATE EXTENSION vector;`.

## 2. Gerar o bundle e incluí-lo em uma imagem

Não há **nenhuma imagem de aplicação para compilar a partir do seu código-fonte**. O `rebase build` produz um diretório `dist-bundle` com suas collections, functions, crons compiladas e — se o seu projeto declarar um app estático — seu frontend compilado. A imagem de runtime publicada o executa:

```bash
rebase build
```

O Container Apps faz pull a partir de um registro (registry), portanto, inclua o bundle em uma imagem derivada. Apenas três linhas, e isso fixa exatamente o que é executado:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.21.0
COPY dist-bundle /bundle
```

1. Crie um **Container Registry** na região da UE escolhida.
2. Faça login a partir da sua CLI:
   ```bash
   az acr login --name YourRegistryName
   ```
3. Faça o build e o push a partir da raiz do projeto:
   ```bash
   docker build -t yourregistryname.azurecr.io/rebase-backend:latest .
   docker push yourregistryname.azurecr.io/rebase-backend:latest
   ```

Atualizar o Rebase posteriormente se resume a alterar essa linha `FROM`. Seu bundle permanece intacto.

## 3. Fazer o deploy do Container App

O Azure Container Apps fornece um ambiente de contêineres serverless com ingress HTTPS integrado.

1. Pesquise no portal por **Container Apps** e clique em **Create**.
2. Crie um novo Container Apps Environment na sua região da UE.
3. Na aba **Container**, aponte para o seu registro ACR e selecione a imagem `rebase-backend:latest`.
4. Configure as **variáveis de ambiente** (Environment variables):

| Nome | Valor |
|------|-------|
| `DATABASE_URL` | A string de conexão do seu Azure Postgres |
| `JWT_SECRET` | Uma string aleatória e segura com mais de 32 caracteres |
| `REBASE_SERVICE_KEY` | Uma string aleatória e segura com mais de 32 caracteres |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | O domínio do seu frontend (ex.: `https://yourdomain.com`) |
| `FRONTEND_URL` | A URL do seu frontend (usada para links de e-mail e fallback de CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | O endereço do primeiro administrador, configurado **antes da primeira inicialização** |
| `REBASE_ADMIN_PASSWORD` | Pelo menos 12 caracteres |

As últimas três são a forma como esta implantação obtém um administrador: em produção, a primeira conta registrada não é promovida, portanto nada mais criará o primeiro chamador autenticado. Consulte [Your first admin](/docs/getting-started/deployment/#your-first-admin). Armazene os segredos como segredos do Container Apps e faça referência a eles, em vez de deixá-los como valores de ambiente em texto simples.

5. Na aba **Ingress**, habilite o ingress.
6. Defina a Target Port para **8080** — a porta em que a imagem de runtime escuta, a menos que `PORT` especifique o contrário.
7. Aponte a sonda de integridade (health probe) para `/livez`. Não para `/health`: esta última realiza uma comunicação de ida e volta (round-trip) com o banco de dados, fazendo com que uma liveness probe nela reinicie um contêiner saudável durante uma breve oscilação do banco de dados.
8. Conclua a criação. O Azure provisionará o contêiner e fornecerá uma Application URL protegida com TLS.

## 4. O schema

**O runtime cria tabelas ausentes na inicialização, incluindo as das suas collections.** `REBASE_MIGRATE_ON_BOOT` tem como padrão `ensure`, que é aditivo em todo o schema — ele cria tabelas, colunas e tipos enum ausentes e aplica suas políticas de segurança em nível de linha (row-level security) — portanto, a primeira inicialização em um servidor vazio já passa a disponibilizar suas collections.

O que o `ensure` nunca faz é alterar algo que já existe: ele não altera o tipo de uma coluna, não exclui nada nem edita os rótulos de um enum existente, pois o reinício de um contêiner não deve remodelar um schema como efeito colateral de um deploy.

Portanto, duas coisas ainda exigem a CLI, executada a partir de um checkout local ou de um job de CI com `DATABASE_URL` apontando para o seu Flexible Server (adicione uma regra de firewall permitindo o IP do seu cliente, se necessário):

```bash
rebase db push
```

- **RLS de tabelas intermediárias (junction tables)** para relações muitos-para-muitos.
- **Qualquer alteração que não seja puramente aditiva** — uma coluna renomeada, um tipo restringido, um campo removido.

A imagem de runtime é distribuída sem a CLI, portanto isso nunca é executado dentro do contêiner. Para migrações versionadas, faça commit dos arquivos de migração com `rebase db generate` e execute `rebase db migrate` como uma etapa de release.

## Armazenamento de arquivos

As réplicas do Container Apps não têm disco persistente, portanto o armazenamento de arquivos local causará perda silenciosa de dados e o runtime o recusa em produção. Crie uma conta de Azure Storage e use sua interface compatível com S3, ou um bucket compatível com S3 na mesma região, com `STORAGE_TYPE=s3` — consulte [Storage](/docs/backend/storage).

## Próximos passos

- [Deployment](/docs/getting-started/deployment) — o checklist de produção e as regras de primeiro administrador compartilhadas por todas as plataformas.
- [Configuration](/docs/getting-started/configuration) — todas as variáveis de ambiente que o runtime lê.
