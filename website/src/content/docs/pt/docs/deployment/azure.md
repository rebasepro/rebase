---
sourceHash: b2acba62de849f55
title: Implantando o Rebase no Microsoft Azure
description: Implante sua instância do Rebase com segurança no Azure usando o Azure Database for PostgreSQL e o Azure Container Apps.
sidebar_label: Azure
---

O Microsoft Azure oferece integrações sólidas e conformidade empresarial. A arquitetura ideal para executar o Rebase no Azure usa o **Azure Database for PostgreSQL – Flexible Server** para a camada de dados e o **Azure Container Apps** para o runtime.

Para cumprir a conformidade de dados europeia e obter tempos de resposta locais rápidos, provisione seus recursos em regiões como **West Europe (Amsterdã)**, **North Europe (Irlanda)** ou **France Central (Paris)**.

Nada nesta página é específico do Azure em relação ao seu projeto. Uma implantação do Rebase é composta por duas partes separáveis — a imagem de runtime publicada e o **bundle** que o `rebase build` produz — e o mesmo bundle é executado no Docker Compose em um laptop, no Rebase Cloud, sob o [Helm chart](/docs/deployment/kubernetes) e aqui.

## 1. Provisionar o PostgreSQL Flexible Server

1. No Portal do Azure, pesquise e selecione **Azure Database for PostgreSQL servers**.
2. Clique em **Create** e selecione **Flexible Server**.
3. Escolha seu Resource Group e defina sua região da UE de preferência.
4. Selecione o tamanho de computação (por exemplo, General Purpose ou Burstable `B2s` para implantações menores).
5. Configure a aba **Authentication** com um nome de usuário de administrador e uma senha segura.
6. Em **Networking**, certifique-se de que "Allow public access from any Azure service within Azure to this server" esteja marcado para que o seu Container App possa se conectar, ou configure uma VNet segura.
7. Anote o nome do seu servidor e monte o URI de conexão:
   `postgresql://your_admin:YOUR_PASSWORD@your-server-name.postgres.database.azure.com:5432/postgres`

Se suas collections declararem uma propriedade `vector`, habilite a extensão uma vez: o Azure a restringe por meio do parâmetro de servidor `azure.extensions`, depois execute `CREATE EXTENSION vector;`.

## 2. Compilar o bundle e incorporá-lo a uma imagem

Não há **nenhuma imagem de aplicação para compilar a partir do seu código-fonte**. O `rebase build` produz um diretório `dist-bundle` com suas collections, funções, crons compilados e — se o seu projeto declarar um app estático — seu frontend compilado. A imagem de runtime publicada o executa:

```bash
rebase build
```

O Container Apps baixa de um registro, portanto, incorpore o bundle em uma imagem derivada. Três linhas, e ela fixa exatamente o que é executado:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.20.0
COPY dist-bundle /bundle
```

1. Crie um **Container Registry** na região da UE escolhida.
2. Faça login a partir da sua CLI:
   ```bash
   az acr login --name YourRegistryName
   ```
3. Compile e envie (push), a partir da raiz do projeto:
   ```bash
   docker build -t yourregistryname.azurecr.io/rebase-backend:latest .
   docker push yourregistryname.azurecr.io/rebase-backend:latest
   ```

Atualizar o Rebase posteriormente requer apenas alterar aquela linha `FROM`. Seu bundle permanece intocado.

## 3. Implantar o Container App

O Azure Container Apps oferece um ambiente de contêiner serverless com ingress HTTPS integrado.

1. Pesquise por **Container Apps** no portal e clique em **Create**.
2. Crie um novo Container Apps Environment na sua região da UE.
3. Na aba **Container**, aponte para o seu registro ACR e selecione a imagem `rebase-backend:latest`.
4. Defina as **Variáveis de ambiente**:

| Nome | Valor |
|------|-------|
| `DATABASE_URL` | Sua string de conexão do Azure Postgres |
| `JWT_SECRET` | Uma string aleatória segura com mais de 32 caracteres |
| `REBASE_SERVICE_KEY` | Uma string aleatória segura com mais de 32 caracteres |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | O domínio do seu frontend (ex.: `https://yourdomain.com`) |
| `FRONTEND_URL` | A URL do seu frontend (usada para links de e-mail e fallback de CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | O endereço do primeiro administrador, definido **antes da primeira inicialização** |
| `REBASE_ADMIN_PASSWORD` | Pelo menos 12 caracteres |

As três últimas são a forma como esta implantação obtém um administrador: em produção, a primeira conta a se registrar não é promovida, portanto, nada mais cria o primeiro chamador autenticado. Consulte [Your first admin](/docs/getting-started/deployment/#your-first-admin). Armazene os segredos como segredos do Container Apps e faça referência a eles, em vez de inseri-los como valores de ambiente simples.

5. Na aba **Ingress**, habilite o ingress.
6. Defina o Target Port como **8080** — a porta em que a imagem de runtime escuta, a menos que `PORT` especifique o contrário.
7. Aponte a sonda de integridade (health probe) para `/livez`. Não `/health`: essa realiza uma viagem de ida e volta ao banco de dados, portanto, uma liveness probe nela reiniciará um contêiner íntegro durante uma breve oscilação no banco de dados.
8. Conclua a criação. O Azure provisiona o contêiner e fornece uma URL de aplicação protegida por TLS.

## 4. O schema

**O runtime cria tabelas ausentes na inicialização, incluindo as das suas collections.** `REBASE_MIGRATE_ON_BOOT` tem como padrão `ensure`, que é aditivo em todo o schema — ele cria tabelas, colunas e tipos enum ausentes e aplica a segurança em nível de linha (RLS) correspondente — para que a primeira inicialização em um servidor vazio comece a servir suas collections.

O que `ensure` nunca faz é alterar algo que já existe: ele não altera o tipo de uma coluna, não descarta nada nem edita os rótulos de um enum existente, pois a reinicialização de um contêiner não deve remodelar o schema como efeito colateral de um deploy.

Portanto, duas coisas ainda precisam da CLI, executada a partir de um checkout ou de um job de CI com `DATABASE_URL` apontando para o seu Flexible Server (adicione uma regra de firewall permitindo o IP do seu cliente, se necessário):

```bash
rebase db push
```

- **RLS de tabelas de junção (junction-table)** para relações muitos-para-muitos.
- **Qualquer alteração que não seja puramente aditiva** — uma coluna renomeada, um tipo restringido, um campo removido.

A imagem de runtime é distribuída sem a CLI, portanto, isso nunca é executado dentro do contêiner. Para migrações versionadas, faça commit dos arquivos de migração com `rebase db generate` e execute `rebase db migrate` como uma etapa de release.

## Armazenamento de arquivos

As réplicas do Container Apps não têm disco durável, portanto, o armazenamento local de arquivos resulta em perda silenciosa de dados e o runtime o recusa em produção. Crie uma conta do Azure Storage e use sua interface compatível com S3, ou um bucket compatível com S3 na mesma região, com `STORAGE_TYPE=s3` — consulte [Storage](/docs/backend/storage).

## Próximos passos

- [Deployment](/docs/getting-started/deployment) — o checklist de produção e as regras para o primeiro administrador que todas as plataformas compartilham.
- [Configuration](/docs/getting-started/configuration) — todas as variáveis de ambiente lidas pelo runtime.

---
