---
sourceHash: d1312f112637705d
title: Implantando o Rebase na AWS
description: Implante sua instância do Rebase com segurança na Amazon Web Services utilizando RDS e AWS App Runner com um forte foco europeu.
sidebar_label: AWS
---

A Amazon Web Services (AWS) oferece uma escala incrível e segurança de nível empresarial. Para uma implantação do Rebase em produção, recomendamos desacoplar a arquitetura utilizando o **Amazon RDS** para o banco de dados PostgreSQL e o **AWS App Runner** (ou ECS Fargate) para executar o runtime.

Para manter uma conformidade estrita com os dados europeus, certifique-se de operar inteiramente dentro de uma região da UE, como **eu-central-1 (Frankfurt)**, **eu-west-1 (Irlanda)** ou **eu-west-3 (Paris)**.

Nada nesta página é específico da AWS em relação ao seu projeto. Uma implantação do Rebase é composta por duas partes separáveis — a imagem de runtime publicada e o **bundle** que o `rebase build` produz — e o mesmo bundle é executado sob Docker Compose em um computador, no Rebase Cloud, sob o [Helm chart](/docs/deployment/kubernetes) e aqui. Mover-se entre eles é uma mudança de infraestrutura, não de aplicação.

## 1. Provisionar o Amazon RDS (PostgreSQL)

1. Navegue até o console do **RDS** na sua região selecionada da UE.
2. Clique em **Create database** e selecione **Standard create**.
3. Escolha o mecanismo **PostgreSQL**.
4. Em Templates, escolha **Production** ou **Free tier/Dev** dependendo da sua carga.
5. Crie um Master Username (ex.: `rebase_admin`) e gere uma Master Password com segurança.
6. Em Connectivity, certifique-se de que o banco de dados esteja posicionado dentro de uma **VPC** que sua futura instância do App Runner possa acessar com segurança (ou torne-o publicamente acessível caso controle rigorosamente os intervalos de IP de entrada).
7. Depois de provisionado, anote o **Endpoint address** e monte sua URI:
   `postgresql://rebase_admin:YOUR_PASSWORD@YOUR_ENDPOINT:5432/postgres`

Se suas coleções declararem uma propriedade `vector`, a instância precisará da extensão `pgvector` — o RDS a disponibiliza, mas ela precisa ser habilitada: execute `CREATE EXTENSION vector;` no banco de dados uma única vez.

## 2. Compilar o bundle e incorporá-lo a uma imagem

Não há **nenhuma imagem de aplicação a ser construída a partir do seu código-fonte**. O comando `rebase build` produz um diretório `dist-bundle` com suas coleções compiladas, funções, crons e — se o seu projeto declarar uma aplicação estática — seu frontend compilado. A imagem de runtime publicada o executa:

```bash
rebase build
```

Para o App Runner, que realiza o pull a partir de um registro, incorpore o bundle em uma imagem derivada. São apenas três linhas e isso fixa exatamente o que é executado:

```dockerfile title="Dockerfile"
FROM rebasepro/server:0.20.0
COPY dist-bundle /bundle
```

1. Navegue até o **Elastic Container Registry** e crie um repositório privado chamado `rebase-backend`.
2. Obtenha os comandos de push que a AWS exibe no console — eles cuidam da autenticação do Docker.
3. Construa e envie (push), a partir da raiz do projeto:
   ```bash
   docker build -t rebase-backend .
   ```
4. Adicione a tag e envie para o seu repositório ECR.

Atualizar o Rebase posteriormente é apenas uma alteração nessa linha `FROM`. Seu bundle permanece intocado e nada em seu projeto é reconstruído.

## 3. Implantar via AWS App Runner

O App Runner é a forma mais simples de executar contêineres na AWS sem gerenciar orquestradores.

1. Navegue até o **AWS App Runner** e clique em **Create service**.
2. Selecione **Container registry** e escolha **Amazon ECR**.
3. Navegue e selecione sua imagem `rebase-backend`.
4. Em **Service settings**, defina a porta (Port) como **8080** — a porta em que a imagem do runtime escuta, a menos que a variável `PORT` determine o contrário.
5. Defina o caminho da **verificação de integridade (health check)** para `/livez`. Não use `/health`: ela realiza uma ida e volta (round-trip) até o banco de dados, portanto, uma liveness probe nela reiniciaria um serviço perfeitamente saudável durante uma breve instabilidade no banco de dados.
6. Adicione as variáveis de ambiente:

| Chave | Valor |
|-----|-------|
| `DATABASE_URL` | Sua string de conexão do RDS |
| `JWT_SECRET` | Uma string segura gerada aleatoriamente (32+ caracteres) |
| `REBASE_SERVICE_KEY` | Uma string segura gerada aleatoriamente (32+ caracteres) |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | O domínio do seu frontend (ex.: `https://yourdomain.com`) |
| `FRONTEND_URL` | A URL do seu frontend (usada para links de e-mail e fallback de CORS) |
| `DISABLE_SELF_REGISTRATION` | `true` |
| `REBASE_ADMIN_EMAIL` | O endereço do primeiro administrador, definido **antes da primeira inicialização** |
| `REBASE_ADMIN_PASSWORD` | Pelo menos 12 caracteres |

As últimas três variáveis são a forma pela qual essa implantação obtém um administrador: em produção, a primeira conta registrada não é promovida automaticamente, portanto, nada mais gerará o primeiro usuário autenticado. Consulte [Seu primeiro administrador](/docs/getting-started/deployment/#your-first-admin). Armazene os segredos no AWS Secrets Manager e referencie-os em vez de digitá-los no formulário do console.

7. (Opcional) Se sua instância do RDS for estritamente privada, configure a rede com **Custom VPC** no App Runner para que o contêiner possa alcançar o banco de dados.
8. Clique em **Create & deploy**.

A AWS cuida do encerramento de TLS (TLS termination), fornecendo a você uma URL `https` pronta para uso.

## 4. O schema

**O runtime cria tabelas ausentes durante a inicialização, incluindo as de suas coleções.** O valor padrão de `REBASE_MIGRATE_ON_BOOT` é `ensure`, que é aditivo em todo o schema — ele cria tabelas, colunas e tipos enum ausentes e aplica sua segurança a nível de linha (row-level security) — portanto, a primeira inicialização em uma instância vazia do RDS já começará servindo suas coleções.

O que o `ensure` nunca faz é alterar algo que já existe: ele não altera o tipo de uma coluna, não remove nada nem edita os rótulos de um enum existente, pois a reinicialização de um contêiner não deve remodelar um schema como efeito colateral de um deploy.

Portanto, duas coisas ainda exigem a CLI, executada a partir de um checkout ou de um job de CI com a `DATABASE_URL` apontando para o RDS:

```bash
rebase db push
```

- **RLS em tabelas de junção (junction-table)** para relações muitos-para-muitos.
- **Qualquer alteração que não seja puramente aditiva** — uma coluna renomeada, um tipo restringido, um campo removido.

Se a instância for privada, execute-o a partir do CI ou de um bastion host dentro da mesma VPC. A imagem de runtime é distribuída sem a CLI, portanto isso nunca roda dentro do contêiner do App Runner. Para migrações versionadas, faça commit dos arquivos de migração com `rebase db generate` e execute `rebase db migrate` como uma etapa de release.

## Armazenamento de arquivos

As instâncias do App Runner não possuem disco persistente, portanto o armazenamento local de arquivos resulta em perda silenciosa de dados e o runtime o recusa em produção. Crie um bucket S3 na mesma região e defina `STORAGE_TYPE=s3` com o respectivo bucket e credenciais — consulte [Armazenamento](/docs/backend/storage).

## Próximos passos

- [Implantação](/docs/getting-started/deployment) — o checklist de produção e as regras de primeiro administrador compartilhadas por todas as plataformas.
- [Configuração](/docs/getting-started/configuration) — todas as variáveis de ambiente lidas pelo runtime.
