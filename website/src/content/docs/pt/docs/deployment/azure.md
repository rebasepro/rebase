---
sourceHash: fcd75234f992e56c
title: Fazendo o deploy do Rebase no Microsoft Azure
description: Faça o deploy da sua instância do Rebase com segurança no Azure usando o Azure Database for PostgreSQL e o Azure Container Apps.
sidebar_label: Azure
---

O Microsoft Azure oferece integrações robustas e conformidade empresarial. A arquitetura ideal para executar o Rebase no Azure usa o **Azure Database for PostgreSQL – Flexible Server** para a camada de dados e o **Azure Container Apps** para o runtime.

Para cumprir a conformidade de dados europeia e obter tempos de resposta locais rápidos, provisione seus recursos em regiões como **West Europe (Amsterdã)**, **North Europe (Irlanda)** ou **France Central (Paris)**.

Nada nesta página é específico do Azure em relação ao seu projeto. Uma implantação do Rebase é composta por duas partes separáveis — a imagem de runtime publicada e o **bundle** que o `rebase build` produz — e o mesmo bundle é executado sob o Docker Compose em um laptop, no Rebase Cloud, sob o [Helm chart](/docs/deployment/kubernetes) e aqui.

## 1. Provisionar o PostgreSQL Flexible Server

1. No Portal do Azure, pesquise e selecione **Azure Database for PostgreSQL servers**.
2. Clique em **Create** e selecione **Flexible Server**.
3. Escolha seu Resource Group e defina sua região da UE preferida.
4. Selecione o tamanho de computação (por exemplo, General Purpose ou Burstable `B2s` para implantações menores).
5. Configure a aba **Authentication** com um nome de usuário administrador e uma senha segura.
6. Em **Networking**, certifique-se de que a opção "Allow public access from any Azure service within Azure to this server" esteja marcada para que seu Container App possa se conectar, ou configure uma VNet segura.
7. Anote o nome do seu servidor e monte a URI de conexão:
   `postgresql://your_admin:YOUR_PASSWORD@your-server-name.postgres.database.azure.com:5432/postgres`

Se suas coleções declararem uma propriedade `vector`, habilite a extensão uma vez: o Azure a restringe atrás do parâmetro de servidor `azure.extensions`, depois execute `CREATE EXTENSION vector;`.

## 2. Construir o bundle e embuti-lo em uma imagem

**Não há imagem de aplicação a ser construída a partir do seu código-fonte**. O `rebase build` produz um diretório `dist-bundle` com suas coleções compiladas, funções, crons e — se o seu projeto declarar um app estático — seu frontend construído. A imagem de runtime publicada o executa:

```bash
rebase build
```

O Container Apps faz pull de um registry, portanto embute o bundle em uma imagem derivada. Três linhas e ele fixa exatamente o que é executado:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.19.1
COPY dist-bundle /bundle
```

1. Crie um **Container Registry** na sua região da UE escolhida.
2. Faça login a partir da sua CLI:
   ```bash
   az acr login --name YourRegistryName
   ```
3. Faça o build e o push, a partir da raiz do projeto:
   ```bash
   docker build -t yourregistryname.azurecr.io/rebase-backend:latest .
   docker push yourregistryname.azurecr.io/rebase-backend:latest
   ```

Atualizar o Rebase posteriormente resume-se a alterar essa linha `FROM`. Seu bundle permanece intacto.

## 3. Fazer o deploy do Container App

O Azure Container Apps fornece um ambiente de contêineres serverless com ingress HTTPS integrado.

1. Pesquise no portal por **Container Apps** e clique em **Create**.
2. Crie um novo Container Apps Environment na sua região da UE.
3. Na aba **Container**, aponte para o seu registro ACR e selecione a imagem `rebase-backend:latest`.
4. Defina as **Variáveis de ambiente**:

| Nome | Valor |
|------|-------|
| `DATABASE_URL` | Sua string de conexão do Azure Postgres |
| `JWT_SECRET` | Uma string aleatória segura de mais de 32 caracteres |
| `REBASE_SERVICE_KEY` | Uma string aleatória segura de mais de 32 caracteres |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | O domínio do seu frontend (ex.: `https://yourdomain.com`) |
| `FRONTEND_URL` | A URL do seu frontend (usada para links de e-mail e fallback de CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | O endereço do primeiro administrador, definido **antes da primeira inicialização** |
| `REBASE_ADMIN_PASSWORD` | Pelo menos 12 caracteres |

Os três últimos são como esta implantação obtém um administrador: em produção, a primeira conta a se registrar não é promovida, portanto, nada mais cria o primeiro usuário autenticado. Consulte [Seu primeiro administrador](/docs/getting-started/deployment/#your-first-admin). Armazene os segredos como segredos do Container Apps e faça referência a eles, em vez de valores de ambiente em texto simples.

5. Na aba **Ingress**, habilite o ingress.
6. Defina a Porta de Destino (Target Port) como **8080** — a porta na qual a imagem de runtime escuta, a menos que `PORT` determine o contrário.
7. Aponte a sonda de integridade (health probe) para `/livez`. Não para `/health`: esta realiza uma viagem de ida e volta ao banco de dados (round-trip), de modo que uma liveness probe nela reiniciará um contêiner saudável durante uma breve oscilação do banco de dados.
8. Conclua a criação. O Azure provisiona o contêiner e fornece uma URL de aplicação protegida por TLS.

## 4. O schema

**O runtime cria tabelas ausentes na inicialização, incluindo as das suas coleções.** `REBASE_MIGRATE_ON_BOOT` tem como padrão `ensure`, que é aditivo em todo o schema — ele cria tabelas, colunas e tipos enum ausentes e aplica a segurança em nível de linha (RLS) a eles — de modo que a primeira inicialização em um servidor vazio já começa servindo suas coleções.

O que o `ensure` nunca faz é alterar algo que já existe: ele não altera o tipo de uma coluna, não remove nada nem edita os rótulos de um enum existente, pois o reinício de um contêiner não deve remodelar um schema como efeito colateral de um deploy.

Portanto, duas coisas ainda necessitam da CLI, executada a partir de um checkout local ou de um job de CI com o `DATABASE_URL` apontado para o seu Flexible Server (adicione uma regra de firewall permitindo o IP do seu cliente, se necessário):

```bash
rebase db push
```

- **RLS de tabelas de junção** para relações muitos-para-muitos.
- **Qualquer alteração que não seja puramente aditiva** — uma coluna renomeada, um tipo restringido, um campo removido.

A imagem de runtime é distribuída sem a CLI, portanto isso nunca é executado dentro do contêiner. Para migrações versionadas, faça commit dos arquivos de migração com `rebase db generate` e execute `rebase db migrate` como uma etapa de release.

## Armazenamento de arquivos

As réplicas do Container Apps não possuem disco persistente, portanto o armazenamento de arquivos local resulta em perda silenciosa de dados e o runtime o recusa em produção. Crie uma conta do Azure Storage e use sua interface compatível com S3, ou um bucket compatível com S3 na mesma região, com `STORAGE_TYPE=s3` — consulte [Armazenamento](/docs/backend/storage).

## Próximos passos

- [Implantação](/docs/getting-started/deployment) — o checklist de produção e as regras do primeiro administrador que toda plataforma compartilha.
- [Configuração](/docs/getting-started/configuration) — todas as variáveis de ambiente lidas pelo runtime.

---
