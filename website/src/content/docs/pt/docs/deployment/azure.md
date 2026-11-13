---
sourceHash: 80f640adab500773
title: Fazendo o deploy do Rebase no Microsoft Azure
description: Faça o deploy da sua instância do Rebase com segurança no Azure usando o Azure Database for PostgreSQL e o Azure Container Apps.
sidebar_label: Azure
---

O Microsoft Azure oferece integrações sólidas e conformidade empresarial. A arquitetura ideal para executar o Rebase no Azure utiliza o **Azure Database for PostgreSQL – Flexible Server** para a camada de dados e o **Azure Container Apps** para o runtime.

Para atender à conformidade de dados europeia e obter tempos de resposta locais rápidos, provisione seus recursos em regiões como **West Europe (Amsterdam)**, **North Europe (Ireland)** ou **France Central (Paris)**.

Nada nesta página é específico do Azure em relação ao seu projeto. Um deploy do Rebase é composto por duas partes separáveis — a imagem de runtime publicada e o **bundle** que o `rebase build` produz — e o mesmo bundle é executado no Docker Compose em um laptop, no Rebase Cloud, através do [Helm chart](/docs/deployment/kubernetes) e aqui.

## 1. Provisionar o PostgreSQL Flexible Server

1. No Portal do Azure, pesquise e selecione **Azure Database for PostgreSQL servers**.
2. Clique em **Create** e selecione **Flexible Server**.
3. Escolha seu Resource Group e defina sua região preferida da UE.
4. Selecione o tamanho de computação (por exemplo, General Purpose ou Burstable `B2s` para implantações menores).
5. Configure a aba **Authentication** com um nome de usuário administrador e uma senha segura.
6. Em **Networking**, certifique-se de que "Allow public access from any Azure service within Azure to this server" esteja marcado para que seu Container App possa se conectar, ou configure uma VNet segura.
7. Anote o nome do servidor e monte a URI de conexão:
   `postgresql://your_admin:YOUR_PASSWORD@your-server-name.postgres.database.azure.com:5432/postgres`

Se suas tabelas declararem uma coluna `col.vector()`, habilite a extensão uma vez: o Azure a restringe por meio do parâmetro de servidor `azure.extensions`, depois execute `CREATE EXTENSION vector;`.

## 2. Compilar o bundle e incluí-lo em uma imagem

Não há **nenhuma imagem de aplicação para compilar a partir do seu código-fonte**. O `rebase build` produz um diretório `dist-bundle` com suas tabelas, funções, crons compilados e — caso seu projeto declare um app estático — seu frontend compilado. A imagem de runtime publicada o executa:

```bash
rebase build
```

O Container Apps faz o pull a partir de um registry, portanto, inclua o bundle em uma imagem derivada. Três linhas, e isso fixa exatamente o que é executado:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.30.1
COPY dist-bundle /bundle
```

1. Crie um **Container Registry** na região da UE escolhida.
2. Faça login a partir da sua CLI:
   ```bash
   az acr login --name YourRegistryName
   ```
3. Faça o build e o push, a partir da raiz do projeto:
   ```bash
   docker build -t yourregistryname.azurecr.io/rebase-backend:latest .
   docker push yourregistryname.azurecr.io/rebase-backend:latest
   ```

Atualizar o Rebase posteriormente se resume a alterar essa linha `FROM`. Seu bundle permanece intocado.

## 3. Fazer o deploy do Container App

O Azure Container Apps fornece um ambiente de contêineres serverless com ingress HTTPS integrado.

1. Pesquise por **Container Apps** no portal e clique em **Create**.
2. Crie um novo Container Apps Environment na sua região da UE.
3. Na aba **Container**, aponte para o seu registro ACR e selecione a imagem `rebase-backend:latest`.
4. Defina as **Variáveis de ambiente**:

| Nome | Valor |
|------|-------|
| `DATABASE_URL` | Sua string de conexão do Azure Postgres |
| `JWT_SECRET` | Uma string aleatória e segura de mais de 32 caracteres |
| `REBASE_SERVICE_KEY` | Uma string aleatória e segura de mais de 32 caracteres |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | O domínio do seu frontend (por exemplo, `https://yourdomain.com`) |
| `FRONTEND_URL` | A URL do seu frontend (usada para links de e-mail e fallback de CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | O endereço do primeiro administrador, definido **antes da primeira inicialização** |
| `REBASE_ADMIN_PASSWORD` | Pelo menos 12 caracteres |

As últimas três são a forma como este deploy obtém um administrador: em produção, a primeira conta a se registrar não é promovida, portanto, nada mais criará o primeiro usuário autenticado. Consulte [Seu primeiro administrador](/docs/getting-started/deployment/#your-first-admin). Armazene os segredos como Container Apps secrets e faça referência a eles, em vez de mantê-los como valores simples de ambiente.

5. Na aba **Ingress**, habilite o ingress.
6. Defina a Target Port como **8080** — a porta que a imagem de runtime escuta, a menos que `PORT` defina o contrário.
7. Aponte o health probe para `/livez`. Não para `/health`: este último realiza um ciclo completo até o banco de dados, então uma liveness probe configurada nele reiniciará um contêiner saudável durante uma breve oscilação no banco de dados.
8. Conclua a criação. O Azure provisiona o contêiner e fornece uma Application URL protegida com TLS.

## 4. O schema

<span class="since-badge" data-since="0.31">Desde 0.31</span>

**O runtime cria tabelas ausentes na inicialização, incluindo as que o `backend/schema` declara.** O valor padrão de `REBASE_MIGRATE_ON_BOOT` é `ensure`, que é aditivo em todo o schema — ele cria tabelas, colunas e tipos enum ausentes e aplica suas políticas de segurança em nível de linha — para que a primeira inicialização em um servidor vazio já suba atendendo às suas coleções.

O que o `ensure` nunca faz é alterar algo que já existe: ele não modifica o tipo de uma coluna, não remove nada e não edita os rótulos de um enum existente, pois a reinicialização de um contêiner não deve remodelar um schema como efeito colateral de um deploy.

Portanto, uma coisa ainda requer a CLI, executada a partir de um checkout ou de um job de CI com a `DATABASE_URL` apontada para o seu Flexible Server (adicione uma regra de firewall permitindo o IP do seu cliente, se necessário):

```bash
rebase db push
```

Qualquer alteração que não seja puramente aditiva — uma coluna renomeada, um tipo mais restrito, um campo removido.

A imagem de runtime é distribuída sem a CLI, portanto isso nunca é executado dentro do contêiner. Para migrações versionadas, faça commit dos arquivos de migração com `rebase db generate` e execute `rebase db migrate` como uma etapa de release.

## Armazenamento de arquivos

As réplicas do Container Apps não têm disco durável, portanto o armazenamento de arquivos local resulta em perda silenciosa de dados e o runtime o recusa em produção. O Azure Blob Storage não é compatível com a API do S3; portanto, use um bucket compatível com S3 na mesma região com `STORAGE_TYPE=s3` e seu respectivo `S3_ENDPOINT` — consulte [Armazenamento](/docs/backend/storage).

## Próximos passos

- [Deployment](/docs/getting-started/deployment) — o checklist de produção e as regras para o primeiro administrador comuns a todas as plataformas.
- [Configuration](/docs/getting-started/configuration) — todas as variáveis de ambiente que o runtime lê.
