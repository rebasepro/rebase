---
sourceHash: 9674258588f75748
title: Implantando o Rebase na Scaleway
description: Saiba como implantar o Rebase na Scaleway para obter uma infraestrutura em nuvem segura baseada na França usando Serverless Containers.
sidebar_label: Scaleway
---

A Scaleway é um provedor de nuvem europeu com sede na França, com datacenters em Paris, Amsterdã e Varsóvia — uma excelente escolha para organizações que priorizam a soberania de dados na UE.

Use o **Managed Database** da Scaleway para o Postgres e o **Serverless Containers** para o runtime.

Nada nesta página é específico da Scaleway em relação ao seu projeto. Uma implantação do Rebase consiste em duas partes separáveis — a imagem de runtime publicada e o **bundle** que o `rebase build` produz — e o mesmo bundle pode ser executado via Docker Compose em um computador local, no Rebase Cloud, através do [Helm chart](/docs/deployment/kubernetes) ou aqui.

## 1. Criar um banco de dados Postgres gerenciado

1. No Console da Scaleway, acesse **PostgreSQL**.
2. Clique em **Create a Database Instance**.
3. Escolha uma Região (ex.: Paris — `PAR1`).
4. Selecione um Tipo de Nó (**Play2-Pico** ou **Pro2-XXS** funcionam bem).
5. Adicione um nome de banco de dados (`rebase_db`) e uma senha forte para o usuário.
6. Após a implantação, copie a **Connection string** (URI) exibida no painel:
   `postgres://user:password@ip:port/rebase_db`

Se as suas coleções declararem uma propriedade `vector`, habilite a extensão uma vez executando `CREATE EXTENSION vector;` no banco de dados.

## 2. Fazer o build do bundle e incorporá-lo a uma imagem

**Não há imagem de aplicação a ser compilada a partir do seu código-fonte**. O `rebase build` produz um diretório `dist-bundle` contendo suas coleções compiladas, funções, crons e — se o seu projeto declarar um app estático — o seu frontend já construído. A imagem de runtime publicada se encarrega de executá-lo:

```bash
rebase build
```

Como o Serverless Containers obtém imagens de um registry, incorpore o bundle em uma imagem derivada. São apenas três linhas, e isso fixa com precisão o que será executado:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.22.0
COPY dist-bundle /bundle
```

1. Acesse **Container Registry** no Console da Scaleway e crie um namespace (ex.: `rebase-apps`).
2. Faça login no registry a partir do seu terminal seguindo as instruções fornecidas na tela.
3. Faça o build e o push a partir da raiz do projeto:

```bash
docker build -t rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest .
docker push rg.fr-par.scw.cloud/rebase-apps/rebase-backend:latest
```

Para atualizar o Rebase no futuro, basta alterar a linha `FROM`. O seu bundle permanece intocado.

## 3. Implantar o Serverless Container

1. Navegue até **Serverless Containers**.
2. Clique em **Create a Container**.
3. Selecione a imagem que você acabou de enviar.
4. Defina a Porta como **8080** — a porta padrão em que a imagem de runtime escuta, a menos que a variável `PORT` especifique outro valor.
5. Em Environment Variables, adicione:

| Chave | Valor |
|-----|-------|
| `DATABASE_URL` | A URI obtida na etapa do Postgres gerenciado |
| `JWT_SECRET` | Uma string aleatória e segura com mais de 32 caracteres para assinar tokens de autenticação |
| `REBASE_SERVICE_KEY` | Uma string aleatória e segura com mais de 32 caracteres |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | O domínio do seu frontend (ex.: `https://yourdomain.com`) |
| `FRONTEND_URL` | A URL do seu frontend (usada para links enviados por e-mail e fallback de CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | O endereço do primeiro administrador, configurado **antes da primeira inicialização** |
| `REBASE_ADMIN_PASSWORD` | Pelo menos 12 caracteres |

As três últimas variáveis são o mecanismo pelo qual esta implantação obtém um administrador: em produção, a primeira conta registrada não é promovida automaticamente, portanto, nada mais criará o primeiro usuário com permissões administrativas. Consulte [Seu primeiro administrador](/docs/getting-started/deployment/#your-first-admin). Certifique-se de configurar variáveis com dados confidenciais como segredos (secret environment variables) em vez de variáveis simples.

6. Configure o health check apontando para `/livez`. Não use `/health`: este endpoint realiza uma verificação completa no banco de dados, portanto, um liveness probe associado a ele reiniciará um contêiner saudável durante qualquer oscilação temporária do banco.
7. Clique em **Deploy Container**.

A Scaleway provisionará o contêiner e disponibilizará um endpoint público (ex.: `https://rebase-backend-xxxx.functions.fnc.fr-par.scw.cloud`).

*Para conformidade rigorosa de dados, certifique-se de que os dados da sua Organização na Scaleway representem a sua entidade corporativa europeia.*

## 4. O schema

**O runtime cria as tabelas ausentes na inicialização, incluindo as das suas coleções.** A variável `REBASE_MIGRATE_ON_BOOT` tem o valor padrão `ensure`, que é cumulativo em todo o schema — ela cria tabelas, colunas e tipos enum ausentes e aplica suas respectivas políticas de segurança em nível de linha (RLS) —, garantindo que o primeiro boot em um banco de dados vazio já inicialize atendendo às suas coleções.

O que o `ensure` nunca faz é modificar algo já existente: ele não altera tipos de colunas, não remove nenhum item e não altera os valores de enums já existentes, pois a reinicialização de um contêiner não deve remodelar um schema como efeito colateral de um deploy.

Por esse motivo, duas tarefas ainda exigem o uso da CLI, executada a partir de uma cópia do código ou de um job de CI com a variável `DATABASE_URL` apontando para o seu Managed Database:

```bash
rebase db push
```

- **RLS de tabelas associativas (junction tables)** para relações de muitos-para-muitos.
- **Qualquer alteração que não seja puramente cumulativa** — renomeação de colunas, restrição de tipos ou remoção de campos.

A imagem de runtime é distribuída sem a CLI, portanto, essas operações nunca são executadas dentro do contêiner. Para migrações versionadas, faça o commit dos arquivos de migração com `rebase db generate` e execute `rebase db migrate` como uma etapa da pipeline de release.

## Armazenamento de arquivos

O Serverless Containers não possui disco persistente; portanto, o armazenamento local de arquivos causará perda silenciosa de dados, e o runtime recusa essa configuração em produção. O Scaleway Object Storage é compatível com a API S3 e reside nos mesmos datacenters:

```env
STORAGE_TYPE=s3
S3_BUCKET=my-uploads
S3_ENDPOINT=https://s3.fr-par.scw.cloud
S3_REGION=fr-par
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Consulte [Armazenamento](/docs/backend/storage) para mais detalhes.

## Próximos passos

- [Implantação](/docs/getting-started/deployment) — o checklist de produção e as regras de primeiro administrador comuns a todas as plataformas.
- [Configuração](/docs/getting-started/configuration) — todas as variáveis de ambiente interpretadas pelo runtime.
