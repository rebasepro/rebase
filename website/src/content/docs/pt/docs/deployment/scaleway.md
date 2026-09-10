---
sourceHash: c543c4d920d4a2f9
title: Implantando o Rebase na Scaleway
description: Saiba como implantar o Rebase na Scaleway para uma infraestrutura de nuvem segura sediada na França usando Serverless Containers.
sidebar_label: Scaleway
---

A Scaleway é uma provedora de nuvem europeia sediada na França, com datacenters em Paris, Amsterdã e Varsóvia — uma excelente escolha para organizações que priorizam a soberania de dados na UE.

Use o **Managed Database** da Scaleway para o Postgres e o **Serverless Containers** para o runtime.

Nada nesta página é específico da Scaleway em relação ao seu projeto. Uma implantação do Rebase é composta por duas partes separáveis — a imagem de runtime publicada e o **bundle** que o comando `rebase build` produz — e o mesmo bundle é executado no Docker Compose em um laptop, no Rebase Cloud, sob o [Helm chart](/docs/deployment/kubernetes) e aqui.

## 1. Criar um banco de dados Postgres gerenciado

1. No Console da Scaleway, vá para **PostgreSQL**.
2. Clique em **Create a Database Instance**.
3. Escolha uma região (por exemplo, Paris — `PAR1`).
4. Selecione um tipo de nó (**Play2-Pico** ou **Pro2-XXS** funcionam bem).
5. Adicione um nome de banco de dados (`rebase_db`) e uma senha forte para o usuário.
6. Assim que for implantado, anote a **Connection string** (URI) no painel:
   `postgres://user:password@ip:port/rebase_db`

Se as suas coleções declararem uma propriedade `vector`, habilite a extensão uma vez: `CREATE EXTENSION vector;` no banco de dados.

## 2. Compilar o bundle e incorporá-lo a uma imagem

Não há **nenhuma imagem de aplicação para construir a partir do seu código-fonte**. O comando `rebase build` produz um diretório `dist-bundle` com suas coleções, funções, crons compilados e — se o seu projeto declarar um app estático — seu frontend compilado. A imagem de runtime publicada o executa:

```bash
rebase build
```

O Serverless Containers faz o pull a partir de um registro, portanto incorpore o bundle em uma imagem derivada. Três linhas, e isso fixa exatamente o que é executado:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.20.0
COPY dist-bundle /bundle
```

1. Vá para **Container Registry** no Console da Scaleway e crie um namespace (por exemplo, `rebase-apps`).
2. Faça login no registro a partir do seu terminal usando as instruções exibidas.
3. Construa a imagem e faça o push a partir da raiz do projeto:

```bash
docker build -t rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest .
docker push rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest
```

Atualizar o Rebase posteriormente se resume a alterar essa linha `FROM`. O seu bundle permanece intocado.

## 3. Implantar o Serverless Container

1. Navegue até **Serverless Containers**.
2. Clique em **Create a Container**.
3. Escolha a imagem que você acabou de enviar.
4. Defina a porta como **8080** — a porta em que a imagem de runtime escuta, a menos que `PORT` especifique o contrário.
5. Em Environment Variables, adicione:

| Chave | Valor |
|-----|-------|
| `DATABASE_URL` | A URI do passo do Managed Postgres |
| `JWT_SECRET` | Uma string aleatória segura de mais de 32 caracteres para assinar tokens de autenticação |
| `REBASE_SERVICE_KEY` | Uma string aleatória segura de mais de 32 caracteres |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | O domínio do seu frontend (por exemplo, `https://yourdomain.com`) |
| `FRONTEND_URL` | A URL do seu frontend (usada para links de e-mail e fallback do CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | O endereço do primeiro administrador, definido **antes da primeira inicialização** |
| `REBASE_ADMIN_PASSWORD` | Pelo menos 12 caracteres |

As três últimas são a forma como essa implantação obtém um administrador: em produção, a primeira conta a se registrar não é promovida, portanto, nada mais cria o primeiro usuário autenticado. Consulte [Seu primeiro administrador](/docs/getting-started/deployment/#your-first-admin). Marque os segredos como variáveis de ambiente secretas em vez de variáveis comuns.

6. Aponte o health check para `/livez`. Não para `/health`: esse último realiza uma viagem de ida e volta (round-trip) ao banco de dados, fazendo com que uma liveness probe reinicie um contêiner saudável durante uma breve oscilação do banco de dados.
7. Clique em **Deploy Container**.

A Scaleway provisiona o contêiner e fornece um endpoint público (por exemplo, `https://rebase-backend-xxxx.functions.fnc.fr-par.scw.cloud`).

*Para uma conformidade de dados rigorosa, verifique se os detalhes da sua Organização na Scaleway refletem sua entidade corporativa europeia.*

## 4. O schema

**O runtime cria tabelas ausentes na inicialização, incluindo as das suas coleções.** `REBASE_MIGRATE_ON_BOOT` tem como padrão `ensure`, que é aditivo em todo o schema — ele cria tabelas, colunas e tipos enum ausentes e aplica a segurança a nível de linha (RLS) correspondente — de modo que a primeira inicialização em um banco de dados vazio já começa servindo suas coleções.

O que o `ensure` nunca faz é alterar algo que já existe: ele não altera o tipo de uma coluna, não exclui nada nem edita os rótulos de um enum existente, pois o reinício de um contêiner não deve remodelar um schema como efeito colateral de um deploy.

Portanto, duas coisas ainda exigem a CLI, executada a partir de um checkout local ou de um job de CI com a `DATABASE_URL` apontada para o seu Managed Database:

```bash
rebase db push
```

- **RLS de tabelas de junção** para relações muitos-para-muitos.
- **Qualquer alteração que não seja puramente aditiva** — uma coluna renomeada, um tipo mais restrito, um campo removido.

A imagem de runtime é distribuída sem a CLI, portanto isso nunca é executado dentro do contêiner. Para migrações versionadas, faça commit dos arquivos de migração com `rebase db generate` e execute `rebase db migrate` como uma etapa de release.

## Armazenamento de arquivos

Os Serverless Containers não possuem disco durável, portanto o armazenamento de arquivos local resulta em perda silenciosa de dados e o runtime o recusa em produção. O Scaleway Object Storage é compatível com S3 e está localizado nos mesmos datacenters:

```env
STORAGE_TYPE=s3
S3_BUCKET=my-uploads
S3_ENDPOINT=https://s3.fr-par.scw.cloud
S3_REGION=fr-par
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Consulte [Armazenamento](/docs/backend/storage) para obter todos os detalhes.

## Próximos passos

- [Implantação](/docs/getting-started/deployment) — a lista de verificação de produção e as regras de primeiro administrador compartilhadas por todas as plataformas.
- [Configuração](/docs/getting-started/configuration) — todas as variáveis de ambiente lidas pelo runtime.

---
