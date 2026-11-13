---
sourceHash: 3bff62ceb5aceb62
title: Executando em um banco de dados existente ou compartilhado
sidebar_label: Banco de dados existente ou compartilhado
description: Execute o Rebase em um banco de dados PostgreSQL do qual ele não é proprietário — um cluster compartilhado com outros apps, um segundo projeto Rebase, Supabase ou um banco de dados restrito por um DBA — com as configurações de rls, rebase doctor --database e rebase db request-role migrate.
---

## O problema

O Rebase executa cada requisição autenticada e anônima como uma role restrita do Postgres,
`rebase_user`, e deixa a segurança em nível de linha (row-level security - RLS) decidir quais
linhas essa requisição vê. A role de conexão é a proprietária das tabelas e ignora o RLS; cada
requisição alterna para `rebase_user` dentro de sua transação.

Isso funciona em um banco de dados do qual o Rebase é proprietário direto: Rebase Cloud, o setup
Docker gerado pelo `rebase init`, o banco de dados de desenvolvimento gerenciado. Isso se baseia
em duas premissas:

1. Apenas o servidor deste projeto pode se tornar `rebase_user`.
2. Apenas `rebase_user` e o proprietário da tabela acessam as tabelas do Rebase.

Um banco de dados que alguém já administra frequentemente quebra ambas:

- **As roles pertencem a todo o cluster, não a um único banco de dados.** Dois projetos Rebase
  em um cluster compartilham o mesmo `rebase_user`. Por padrão, toda role pode se conectar a qualquer
  banco de dados, e qualquer pessoa pode definir as configurações de sessão que as políticas do
  Rebase leem, de modo que a conexão do projeto A pode abrir o banco de dados do projeto B, alternar
  para `rebase_user` e passar pelas políticas de B como admin de B.
- **As permissões (grants) cobrem esquemas inteiros.** Por padrão, o Rebase concede à role de requisição
  `SELECT, INSERT, UPDATE, DELETE` em todas as tabelas em `public` nas quais tem permissão para conceder,
  incluindo tabelas pertencentes a outra aplicação.
- **Políticas padrão se aplicam `TO public`.** A política base que o Rebase adiciona a cada tabela
  permite qualquer sessão que nunca definiu a identidade do Rebase. É assim que as próprias consultas
  do servidor passam, e também permite qualquer outra role que possua privilégios na tabela, como
  o `anon` do Supabase por meio de sua Data API.
- **Políticas existentes baseadas em roles nunca se aplicam.** Uma política escrita como `TO authenticated`
  não se aplica a `rebase_user`, porque `rebase_user` não herda os privilégios de outras roles.
- **Alguns bancos de dados não permitem que a aplicação crie roles de forma alguma.** Um DBA cria cada
  role manualmente, ou as roles são gerenciadas no Terraform.

Cada um desses casos possui uma configuração. Cada configuração tem como padrão o comportamento
do Rebase sem ela, portanto, um projeto que não define nada se comporta exatamente como antes.

## Verifique o banco de dados primeiro

```bash
rebase doctor --database
```

Ele lê o catálogo do banco de dados do projeto e não altera nada. Ele relata:

- se cada role de requisição existe, se é restrita e se esta conexão pode alternar para ela;
- outras roles de login que podem alternar para a role de requisição;
- se todas as roles no cluster podem se conectar a este banco de dados;
- tabelas nos esquemas do Rebase que o Rebase não atende;
- outras roles com privilégios nas tabelas do Rebase;
- políticas nas tabelas do Rebase escritas `TO` uma role que a role de requisição não herda;
- privilégios padrão que concedem novas tabelas a outras roles.

Cada apontamento vem com o SQL para executar como administrador do banco de dados, a configuração
que adapta o Rebase ao banco de dados em vez disso, ou ambos. Ele encerra com código 1 quando um
apontamento for uma falha, para que possa bloquear um deploy. Ele verifica o banco de dados contra
as configurações que consegue ver: as variáveis `REBASE_RLS_*`, e depois as roles de requisição
registradas no banco de dados pela inicialização de um servidor.

`npx @rebasepro/rls-check` audita as políticas em si, em qualquer Postgres. Em um banco de dados
Rebase, ele lê a role de requisição da mesma forma; especifique-a com `--request-role` quando ela
ainda não estiver registrada.

## As configurações

Defina-as na declaração do banco de dados em `backend/resources.ts`:

```ts
import { database } from "@rebasepro/types";

export const main = database({
    rls: {
        requestRole: "acme_prod_user",
        grants: "managed"
    }
});
```

Ou a partir do ambiente, que tem precedência sobre a declaração. As variáveis de ambiente são o
que você deseja para um valor que varia entre dois deploys do mesmo código, como o nome da role
quando staging e produção compartilham um cluster.

| Configuração | Variável de ambiente | Padrão | Alternativas |
|---|---|---|---|
| `requestRole` | `REBASE_RLS_REQUEST_ROLE` (um único nome) | `"rebase_user"` | Qualquer nome de role. `{ anonymous, signedIn }` para executar chamadores sem sessão como uma role e chamadores autenticados como outra. No código do driver, uma função da identidade da requisição. |
| `requestRoles` | nenhuma | derivado de `requestRole` | Todas as roles que um `requestRole` baseado em função pode retornar, para que cada uma possa ser provisionada, concedida e verificada. Obrigatório com uma função. |
| `provisionRole` | `REBASE_RLS_PROVISION_ROLE` | `"auto"`: cria a role se estiver ausente e concede a esta conexão o direito de alternar para ela | `"never"`: a role e a associação (membership) são suas. A inicialização verifica ambos e falha com o SQL a ser executado. |
| `grants` | `REBASE_RLS_GRANTS` | `"schema"`: cada tabela e sequência nos esquemas atendidos pelo Rebase nas quais a conexão pode conceder privilégios, além de privilégios padrão para tabelas criadas posteriormente | `"managed"`: apenas as tabelas atendidas pelo Rebase, e sem privilégios padrão. `"none"`: o Rebase não concede nada; uma tabela para a qual você não concedeu privilégios é recusada. |
| `policyTarget` | `REBASE_RLS_POLICY_TARGET` | `"public"` | `"requestRole"`: políticas permissivas se aplicam apenas à(s) role(s) de requisição. Políticas restritivas ainda se aplicam a todos. |
| `adminPolicies` | `REBASE_RLS_ADMIN_POLICIES` | `"adminRole"`: políticas que apenas o contexto do servidor ou um administrador podem passar (a linha de base, `roles: ["admin"]`) são escritas `TO rebase_admin`, e requisições de administrador são executadas como `<request role>_admin` | `"public"`: essas políticas são `TO public` e administradores rodam como a role de requisição, como antes de esta configuração existir. |
| `defaultPolicies` | `REBASE_RLS_DEFAULT_POLICIES` | `true` | `false`: nenhuma tabela recebe a linha de base de servidor ou admin. O `defaultPolicies: false` da própria tabela ainda decide por ela. |
| `inheritRoles` | nenhuma | `[]` | Roles concedidas à role de requisição `WITH INHERIT TRUE`, para que políticas escritas `TO` elas se apliquem. Com uma role de requisição `{ anonymous, signedIn }`, apenas a autenticada as recebe; com uma função, a configuração é recusada. PostgreSQL 16 e mais recente; recusada no 15 e anteriores. |
| `identity` | `REBASE_RLS_IDENTITY` (formas nomeadas) | `"rebase"`: `app.uid`, `app.user_roles`, `app.is_anonymous`, `app.jwt` | `"supabase"`: também `request.jwt.claims`, `request.jwt.claim.sub` e `request.jwt.claim.role`, para que `auth.uid()` e `auth.jwt()` vejam o chamador. No código do driver, uma função que retorna configurações extras. As configurações `app.*` são sempre definidas. |
| `sharedRole` | `REBASE_RLS_SHARED_ROLE` | `"warn"` quando outro login pode alternar para a role de requisição | `"refuse"`: falha a inicialização. `"ignore"`: não diz nada. |

As formas em função de `requestRole` e `identity` são aceitas apenas no próprio bloco `rls` do driver,
que aceita as mesmas configurações. `policyTarget`, `adminPolicies` e `defaultPolicies` alteram o SQL
de política que o `rebase db generate` grava, e a CLI não pode ler o código do driver, portanto,
defina-as na declaração ou no ambiente. Uma inicialização que as encontrar apenas no código do driver
se recusará a iniciar.

Na inicialização, a linha que relata como as requisições são isoladas lista cada configuração que
não está em seu valor padrão. Uma configuração que transfere uma tarefa para você, como `grants: "none"`,
informa uma vez qual é essa tarefa.

A primeira inicialização de provisionamento registra a(s) role(s) de requisição em `rebase.schema_meta`.
Uma inicialização posterior configurada com uma role diferente se recusa a iniciar e indica o comando
que migra o banco de dados, abaixo. Sem essa verificação, a role antiga manteria suas permissões
enquanto uma nova estaria sendo configurada ao lado dela.

## Receitas

### Um cluster compartilhado com outros apps ou projetos

Dê a cada projeto, e a cada deploy que compartilha um cluster, uma role própria:

```bash
REBASE_RLS_REQUEST_ROLE=acme_prod_user
```

Um banco de dados que já foi executado como `rebase_user` registra isso, então primeiro migre-o:

```bash
rebase db request-role migrate --to acme_prod_user --dry-run
rebase db request-role migrate --to acme_prod_user
```

O comando cria a nova role se ela estiver ausente, reemite apenas neste banco de dados todas as
concessões (grants) que a role antiga possui (tabelas, colunas, sequências, esquemas, funções, os
privilégios padrão definidos por esta conexão e associações), reaponta as políticas que mencionam a
role antiga e registra a nova role. Ele é executado em uma única transação. A role antiga é deixada
como está, pois outro banco de dados no cluster ainda pode usá-la. Quando termina, ele imprime os
comandos `REVOKE` que revogam as concessões da role antiga neste banco de dados, para serem executados
assim que nada mais aqui precisar deles. `--dry-run` imprime os mesmos comandos e não altera nada.
Em um terminal, ele solicita confirmação antes de executar; sem terminal, ele recusa a execução
sem `--yes`.

Em seguida, defina `REBASE_RLS_REQUEST_ROLE` em cada servidor que utiliza o banco de dados.

O `rebase doctor --database` também relata se todas as roles no cluster podem se conectar ao banco
de dados, indicando o `REVOKE CONNECT … FROM PUBLIC` para impedir isso. O Rebase não executa isso
por conta própria em um banco de dados do qual não é proprietário.

### Supabase

Um esquema existente do Supabase já possui `anon` e `authenticated`, e políticas escritas para
eles com `auth.uid()`. Para fazer com que essas políticas se apliquem às requisições do Rebase sem
alterações:

```ts
import { database } from "@rebasepro/types";

export const main = database({
    rls: {
        requestRole: { anonymous: "anon", signedIn: "authenticated" },
        identity: "supabase",
        policyTarget: "requestRole"
    }
});
```

- `requestRole` executa chamadores sem sessão como `anon` e todos os autenticados (convidados
  incluídos) como `authenticated`.
- `identity: "supabase"` define as configurações `request.jwt.*` que o `auth.uid()` lê. Sem elas,
  toda verificação `auth.uid() = owner_id` falha, ou passa quando não deveria.
- `policyTarget: "requestRole"` impede que as próprias políticas do Rebase se apliquem a sessões
  que não sejam requisições do Rebase, como a Data API do Supabase.

Como as requisições rodam diretamente como `anon` e `authenticated`, as políticas escritas
`TO anon` ou `TO authenticated` se aplicam como estão, e `inheritRoles` não é necessário. Ele serve
para um projeto cujas requisições rodam como uma role própria, como `requestRole: "acme_user",
inheritRoles: ["authenticated"]`. Com um par `{ anonymous, signedIn }`, ela é concedida apenas à
role autenticada, nunca à anônima.

Os privilégios padrão do Supabase concederam tabelas criadas em `public` para `anon` e `authenticated`;
verifique os do seu projeto. Execute `rebase doctor --database` e `rls-check` após a primeira inicialização
para ver o que essas roles podem acessar.

### Um administrador de banco de dados cria as roles

Quando a conexão não tem permissão para criar roles, ou as roles residem no Terraform:

```bash
REBASE_RLS_PROVISION_ROLE=never
```

A inicialização então verifica a role e a associação (membership) e falha com o SQL a ser executado,
em vez de tentar criá-las. Para fornecer esse SQL ao administrador com antecedência:

```bash
rebase db provision --print > request-role.sql
```

Ele imprime, para cada role de requisição, os comandos que a criam (`NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`),
concedem à role de conexão o direito de alternar para ela (`WITH SET TRUE, INHERIT FALSE` no
PostgreSQL 16 e mais recente) e concedem a ela os esquemas sob `grants: "schema"`. A explicação é
escrita como comentários SQL, para que o arquivo possa ser executado como está. Ele lê a role de conexão
do banco de dados e não executa mais nada. Cada comando é seguro para ser executado novamente.

### Requisições de admin e `rebase_admin`

O Postgres combina as políticas permissivas que se aplicam a uma role com OR. Escrita como
`TO public`, a linha de base que cada tabela possui (`rebase.uid() IS NULL OR` a role `admin`)
se aplicaria a usuários autenticados também, e um OR cujo outro lado é constante para toda a
instrução não pode usar um índice: a listagem ou contagem com escopo de proprietário de um usuário
faria uma varredura completa (scan) na tabela. Portanto, as políticas que apenas o contexto do
servidor ou um administrador podem passar são escritas `TO rebase_admin`, e nunca chegam ao plano
de consulta de um usuário.

`rebase_admin` não possui privilégios e não pode fazer login. Um chamador que possui a role `admin`,
incluindo `rebase.dataAsAdmin`, é executado como `<request role>_admin` (`rebase_user_admin` por padrão),
que herda a role de requisição e `rebase_admin`. Uma conexão que está sujeita à segurança em nível
de linha herda `rebase_admin` para o contexto do servidor. A inicialização cria tudo isso quando a
conexão tem permissão para criar roles. Sob `provisionRole: "never"`, crie-as você mesmo:

```sql
CREATE ROLE rebase_admin NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE rebase_user_admin NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT rebase_user, rebase_admin TO rebase_user_admin WITH INHERIT TRUE, SET FALSE;
GRANT rebase_user_admin TO <connection role> WITH SET TRUE, INHERIT FALSE;
```

No PostgreSQL 15 e anteriores, crie `rebase_user_admin` com `INHERIT` e omita as opções `WITH`.
Onde `rebase_admin` não puder ser criado de forma alguma, a inicialização e o `rebase db push`
gravam essas políticas `TO public`, como eram antes, e os administradores continuam executando
como a role de requisição. O `rebase doctor --database` relata qual desses cenários você possui.

#### Leituras de admin usam os índices do proprietário

Uma política que não seja uma constante impede que o Postgres use um índice para um operador que não
seja leakproof, como `&&` em um array, `~` ou um operador jsonb. Sem a etapa abaixo, uma consulta
de admin com `tags && $1` escaneava a tabela inteira, onde a mesma consulta como proprietário usava
o índice GIN. Isso cobria `rebase.sqlAsAdmin`, `rebase.dataAsAdmin` e usuários administradores da
mesma forma.

Assim, a inicialização dá a cada política exclusiva de admin que todo admin atende uma companheira
`TO rebase_admin_request USING (true)`, nomeada `<policy>_ar_<hash>`. Para uma requisição de admin,
o Postgres reduz as políticas para `true` e planeja a consulta como faria para o proprietário.
Políticas restritivas ainda se aplicam. Apenas as roles `<request role>_admin` podem deter
`rebase_admin_request`. A cada inicialização, o Rebase verifica quais roles possuem seus privilégios.
Se qualquer outra role sujeita à segurança em nível de linha os possuir, a inicialização não cria
companheiras e remove as que encontrar. As companheiras requerem PostgreSQL 16 ou superior, pois
no 15 e anteriores a conexão herdaria a role. Apenas a inicialização as cria. `policies.sql` e
migrações nunca criam uma, mas removem a companheira de cada política que reescrevem e que não
precisa mais de uma. `rebase db push` e `rebase db migrate` também removem qualquer companheira
cuja regra tenha desaparecido. Portanto, uma regra de admin restringida ou removida deixa de admitir
todos os admins mesmo onde a inicialização não provisiona nada. Sob `provisionRole: "never"`,
crie a role você mesmo:

```sql
CREATE ROLE rebase_admin_request NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT rebase_admin_request TO rebase_user_admin WITH INHERIT TRUE, SET FALSE;
```

Antes de reverter para uma versão anterior àquela que introduziu as companheiras, torne-as inertes.
Um runtime mais antigo não sabe o que elas são e nunca as remove, portanto uma regra que você alterar
mais tarde deixaria sua companheira admitindo todos os admins para todas as linhas. Um comando por
role de requisição de admin faz com que todas as companheiras não admitam ninguém:

```sql
REVOKE rebase_admin_request FROM rebase_user_admin;
```

Ou remova-as: toda política cujo nome termina em `_ar_` e oito dígitos hexadecimais, e cuja role
seja `rebase_admin_request`.

### Um esquema `public` compartilhado

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Quando `public` contém tabelas que o Rebase não deve acessar:

```bash
REBASE_RLS_GRANTS=managed
```

O Rebase então concede à role de requisição acesso apenas às tabelas que atende: tabelas declaradas,
tabelas de junção e suas próprias tabelas protegidas por linha. Ele não define privilégios padrão
em esquemas compartilhados e não revoga nada que já tenha sido concedido. O `rebase doctor --database`
lista as tabelas nos esquemas do Rebase que ele não atende.

Outra alternativa é um esquema próprio do Rebase: defina `schema` em cada `defineTable`.

## Provedores

O que a role de conexão pode fazer varia entre os provedores e decide se o Rebase pode criar a
role de requisição por conta própria. As observações abaixo representam o que esperamos; confirme-as
com o seu provedor.

| Provedor | Role de conexão habitual | Observações |
|---|---|---|
| Supabase | `postgres` (não é superusuário, possui CREATEROLE) | Um banco de dados por projeto. `anon`, `authenticated` e `authenticator` existem, com privilégios padrão em `public`. Consulte a receita do Supabase acima. |
| Neon | o proprietário do projeto, um membro de `neon_superuser` | As roles pertencem a uma branch, e todos os bancos de dados em uma branch as compartilham. Dois bancos de dados Rebase em um projeto Neon compartilham `rebase_user`, portanto defina `requestRole` por banco de dados. |
| AWS RDS / Aurora | o usuário master, um membro de `rds_superuser` | Possui CREATEROLE, mas não é superusuário. As instâncias são frequentemente compartilhadas entre aplicações. |
| Google Cloud SQL | `postgres`, um membro de `cloudsqlsuperuser` | Como o RDS. |
| Azure Flexible Server | o usuário admin, um membro de `azure_pg_admin` | Como o RDS. |
| InstaPods | `instapod`; superusuário via `sudo -u postgres` | [O guia do InstaPods](/docs/deployment/instapods/) cria a role antecipadamente. |
| Hostman | `gen_user`; CREATE ROLE concedido a partir do painel | Indisponível no menor plano. [O guia do Hostman](/docs/deployment/hostman/) cria a role antecipadamente. |

## Relacionados

- [Comandos de banco de dados](/docs/cli/database/): `rebase db request-role` e
  `rebase db provision`
- [Referência da CLI](/docs/cli/#rebase-doctor): `rebase doctor --database`
- [rls-check](/docs/rls-check/): audite as políticas em qualquer Postgres
- [Regras de segurança (RLS)](/docs/collections/security-rules/): as políticas
  que o Rebase cria para cada tabela
