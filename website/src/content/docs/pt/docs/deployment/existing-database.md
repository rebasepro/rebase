---
sourceHash: 5bab946153902c64
title: Executando em um banco de dados existente ou compartilhado
sidebar_label: Banco de dados existente ou compartilhado
description: Execute o Rebase em um banco de dados PostgreSQL que ele não possui — um cluster compartilhado com outros aplicativos, um segundo projeto Rebase, Supabase ou um banco de dados bloqueado por um DBA — com as configurações de rls, rebase doctor --database e rebase db request-role migrate.
---

## O problema

O Rebase executa cada requisição autenticada e anônima como uma única role restrita
do Postgres, `rebase_user`, e deixa a row-level security decidir quais linhas essa
requisição vê. A role de conexão é proprietária das tabelas e ignora o RLS; cada
requisição alterna para `rebase_user` dentro de sua transação.

Isso funciona em um banco de dados pertencente exclusivamente ao Rebase: Rebase Cloud,
o ambiente Docker estruturado pelo `rebase init`, o banco de dados de desenvolvimento
gerenciado. Isso se baseia em duas premissas:

1. Apenas o servidor deste projeto pode se tornar `rebase_user`.
2. Apenas o `rebase_user` e o proprietário da tabela tocam nas tabelas do Rebase.

Um banco de dados que alguém já opera frequentemente quebra ambas:

- **As roles pertencem ao cluster inteiro, não a um único banco de dados.** Dois
  projetos Rebase em um mesmo cluster compartilham o mesmo `rebase_user`. Por padrão,
  toda role pode se conectar a qualquer banco de dados, e qualquer pessoa pode definir
  as configurações de sessão que as políticas do Rebase leem, de modo que a conexão do
  projeto A pode abrir o banco de dados do projeto B, alternar para `rebase_user` e
  passar pelas políticas de B como administrador de B.
- **As permissões (grants) cobrem esquemas inteiros.** Por padrão, o Rebase concede à
  role de requisição `SELECT, INSERT, UPDATE, DELETE` em todas as tabelas em `public`
  sobre as quais tem permissão para conceder, incluindo tabelas pertencentes a outra
  aplicação.
- **Políticas padrão se aplicam `TO public`.** A política de linha de base que o Rebase
  adiciona a cada tabela permite a entrada de qualquer sessão que nunca definiu a
  identidade do Rebase. É assim que as próprias consultas do servidor passam, e isso
  também permite a entrada de qualquer outra role que possua permissão na tabela, como
  o `anon` do Supabase por meio de sua Data API.
- **Políticas existentes baseadas em roles nunca se aplicam.** Uma política escrita
  com `TO authenticated` não se aplica a `rebase_user`, porque `rebase_user` não herda
  os privilégios de outras roles.
- **Alguns bancos de dados não permitem que a aplicação crie roles de forma alguma.** Um
  DBA cria cada role manualmente, ou as roles são gerenciadas no Terraform.

Cada um desses cenários tem uma configuração. Cada configuração tem como padrão o
comportamento do Rebase sem ela, de modo que um projeto que não define nada se comporta
exatamente como antes.

## Verifique o banco de dados primeiro

```bash
rebase doctor --database
```

Ele lê o catálogo do banco de dados do projeto e não altera nada. Ele relata:

- se cada role de requisição existe, se é restrita e se esta conexão pode alternar para ela;
- outras roles de login que podem alternar para a role de requisição;
- se todas as roles no cluster podem se conectar a este banco de dados;
- tabelas nos esquemas do Rebase que o Rebase não atende;
- outras roles que possuem privilégios nas tabelas do Rebase;
- políticas nas tabelas do Rebase escritas `TO` uma role que a role de requisição não
  herda;
- privilégios padrão que concedem novas tabelas a outras roles.

Cada diagnóstico vem acompanhado do SQL a ser executado como administrador de banco de
dados, da configuração que adapta o Rebase ao banco de dados, ou de ambos. Ele encerra
com código 1 quando um diagnóstico é uma falha, permitindo que sirva de validação para
um deploy. Ele verifica o banco de dados em relação às configurações que consegue visualizar:
as variáveis `REBASE_RLS_*` e, em seguida, as roles de requisição registradas no banco de
dados na inicialização do servidor.

O `npx @rebasepro/rls-check` audita as próprias políticas, em qualquer Postgres. Em um
banco de dados Rebase, ele lê a role de requisição da mesma maneira; especifique-a com
`--request-role` quando ela ainda não estiver registrada.

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

Ou pelo ambiente, que tem precedência sobre a declaração. As variáveis de ambiente são o
ideal para valores que variam entre dois deploys do mesmo código, como o nome da role
quando staging e produção compartilham um cluster.

| Configuração | Variável de ambiente | Padrão | Alternativas |
|---|---|---|---|
| `requestRole` | `REBASE_RLS_REQUEST_ROLE` (um único nome) | `"rebase_user"` | Qualquer nome de role. `{ anonymous, signedIn }` para executar chamadores sem sessão como uma role e chamadores autenticados como outra. No código do driver, uma função da identidade da requisição. |
| `requestRoles` | nenhuma | derivado de `requestRole` | Todas as roles que um `requestRole` com valor de função pode retornar, para que cada uma possa ser provisionada, ter concessões atribuídas e ser verificada. Obrigatório ao usar uma função. |
| `provisionRole` | `REBASE_RLS_PROVISION_ROLE` | `"auto"`: cria a role se estiver ausente e concede a esta conexão o direito de alternar para ela | `"never"`: a role e a associação são de sua responsabilidade. A inicialização verifica ambos e falha exibindo o SQL a ser executado. |
| `grants` | `REBASE_RLS_GRANTS` | `"schema"`: todas as tabelas e sequências nos esquemas atendidos pelo Rebase sobre os quais a conexão pode conceder privilégios, além de privilégios padrão para tabelas criadas posteriormente | `"managed"`: apenas as tabelas atendidas pelo Rebase, e nenhum privilégio padrão. `"none"`: o Rebase não concede nada; uma tabela para a qual você não concedeu privilégios é recusada. |
| `policyTarget` | `REBASE_RLS_POLICY_TARGET` | `"public"` | `"requestRole"`: políticas permissivas se aplicam apenas à(s) role(s) de requisição. Políticas restritivas ainda se aplicam a todos. |
| `adminPolicies` | `REBASE_RLS_ADMIN_POLICIES` | `"adminRole"`: políticas que apenas o contexto do servidor ou um administrador podem satisfazer (a linha de base, `roles: ["admin"]`) são escritas `TO rebase_admin`, e as requisições de admin são executadas como `<request role>_admin` | `"public"`: essas políticas são `TO public` e administradores são executados como a role de requisição, como antes da existência desta configuração. |
| `defaultPolicies` | `REBASE_RLS_DEFAULT_POLICIES` | `true` | `false`: nenhuma tabela recebe a linha de base de servidor-ou-administrador. O `defaultPolicies: false` da própria tabela ainda decide por ela. |
| `required` | nenhuma | `true`: uma tabela declarada que o banco de dados não protege (row-level security desativado, políticas declaradas ausentes) não é atendida quando a inicialização não provisiona nada | `false`: atende as tabelas deste banco de dados mesmo assim, listando seus nomes na inicialização. Para um esquema pertencente a outra ferramenta e uma aplicação que gerencia o acesso por conta própria; veja "Outra ferramenta é proprietária do esquema" abaixo. O `rlsRequired` da própria tabela decide por ela. |
| `inheritRoles` | nenhuma | `[]` | Roles concedidas à role de requisição `WITH INHERIT TRUE`, para que as políticas escritas `TO` elas se apliquem. Com um par `{ anonymous, signedIn }` em request role, apenas a role autenticada as recebe; com uma função, a configuração é recusada. PostgreSQL 16 ou mais recente; recusado no 15 e anteriores. |
| `identity` | `REBASE_RLS_IDENTITY` (formas nomeadas) | `"rebase"`: `app.uid`, `app.user_roles`, `app.is_anonymous`, `app.jwt` | `"supabase"`: também `request.jwt.claims`, `request.jwt.claim.sub` e `request.jwt.claim.role`, para que `auth.uid()` e `auth.jwt()` vejam o chamador. No código do driver, uma função que retorna configurações adicionais. As configurações `app.*` são sempre definidas. |
| `sharedRole` | `REBASE_RLS_SHARED_ROLE` | `"warn"` quando outro login puder alternar para a role de requisição | `"refuse"`: falha a inicialização. `"ignore"`: não exibe nada. |

As formas de função de `requestRole` e `identity` são aceitas apenas no próprio bloco
`rls` do driver, que recebe as mesmas configurações. `policyTarget`, `adminPolicies` e
`defaultPolicies` alteram o SQL de política que o `rebase db generate` escreve, e a CLI
não pode ler o código do driver, portanto, defina-os na declaração ou no ambiente. Uma
inicialização que os encontre apenas no código do driver se recusará a iniciar.

Na inicialização, a linha que relata como as requisições são isoladas lista todas as
configurações que não estão em seu valor padrão. Uma configuração que transfere uma
responsabilidade para você, como `grants: "none"`, informa uma única vez qual é essa
tarefa.

A primeira inicialização com provisionamento registra a(s) role(s) de requisição em
`rebase.schema_meta`. Uma inicialização posterior configurada com uma role diferente se
recusará a iniciar e indicará o comando para migrar o banco de dados, abaixo. Sem essa
verificação, a role antiga manteria suas permissões enquanto uma nova era configurada
ao lado dela.

## Receitas

### Um cluster compartilhado com outros aplicativos ou projetos

Dê a cada projeto, e a cada deploy que compartilha um cluster, uma role própria:

```bash
REBASE_RLS_REQUEST_ROLE=acme_prod_user
```

Um banco de dados que já foi executado como `rebase_user` registra isso, portanto,
primeiro faça a migração:

```bash
rebase db request-role migrate --to acme_prod_user --dry-run
rebase db request-role migrate --to acme_prod_user
```

O comando cria a nova role se ela estiver ausente, reedita apenas neste banco de dados
todas as permissões que a role antiga possui (tabelas, colunas, sequências, esquemas,
funções, os privilégios padrão definidos por esta conexão e associações), redireciona
as políticas que nomeiam a role antiga e registra a nova role. Ele é executado em uma
única transação. A role antiga é mantida como está, pois outro banco de dados no cluster
ainda pode usá-la. Ao finalizar, ele imprime as instruções `REVOKE` que removem as
permissões da role antiga neste banco de dados, para serem executadas quando nada mais
aqui precisar delas. O `--dry-run` imprime as mesmas instruções e não altera nada. Em
um terminal, ele solicita confirmação antes de executar; sem terminal, ele recusa a
execução sem o `--yes`.

Em seguida, defina `REBASE_RLS_REQUEST_ROLE` em cada servidor que usa o banco de dados.

O `rebase doctor --database` também relata se todas as roles no cluster podem se conectar
ao banco de dados, com o comando `REVOKE CONNECT … FROM PUBLIC` para impedir isso. O Rebase
não executa isso por conta própria em um banco de dados que não pertence a ele.

### Supabase

Um esquema existente do Supabase já possui `anon` e `authenticated`, e políticas
escritas para eles com `auth.uid()`. Para que essas políticas se apliquem inalteradas
às requisições do Rebase:

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

- `requestRole` executa chamadores sem sessão como `anon` e todos os autenticados
  (convidados incluídos) como `authenticated`.
- `identity: "supabase"` define as configurações `request.jwt.*` lidas por `auth.uid()`.
  Sem elas, todo teste `auth.uid() = owner_id` falha ou passa quando não deveria.
- `policyTarget: "requestRole"` impede que as políticas do próprio Rebase se apliquem
  a sessões que não sejam requisições do Rebase, como a Data API do Supabase.

Como as requisições são executadas diretamente como `anon` e `authenticated`, as
políticas escritas com `TO anon` ou `TO authenticated` se aplicam como estão, e o
`inheritRoles` não é necessário. Ele é indicado para projetos cujas requisições rodam
sob uma role própria, como `requestRole: "acme_user", inheritRoles: ["authenticated"]`.
Com um par `{ anonymous, signedIn }`, ele é concedido apenas à role autenticada, nunca
à anônima.

Os privilégios padrão originais do Supabase concedem tabelas criadas em `public` para
`anon` e `authenticated`; verifique os do seu projeto. Execute `rebase doctor --database`
e `rls-check` após a primeira inicialização para ver o que essas roles podem acessar.

### Outra ferramenta é proprietária do esquema, e a aplicação gerencia o acesso

Alguns bancos de dados não são de responsabilidade do Rebase para proteção. O Alembic,
Prisma ou um DBA é o proprietário das tabelas, nada ali habilita row-level security,
e a própria aplicação decide quem vê o quê: apenas a equipe pode fazer login, hooks
verificam cada gravação, um escopo controla cada rota. Uma inicialização que não
provisiona nada (`REBASE_PROVISION=false`, `REBASE_MIGRATE_ON_BOOT=none`) retém por
padrão todas essas tabelas (`503 TABLE_WITHHELD`), porque o Postgres entregaria todas
as linhas a qualquer chamador autenticado.

Indique que a aplicação gerencia o acesso por conta própria, para o banco de dados
inteiro:

```ts
// backend/resources.ts
export const main = database({ rls: { required: false } });
```

ou para uma tabela:

```ts
export const invoices = defineTable("invoices", {
    columns: { /* … */ },
    rls: "admin-only",
    rlsRequired: false
});
```

As tabelas são então atendidas independentemente do que o catálogo diz, e a
inicialização lista seus nomes em um aviso. O `rlsRequired: true` de uma tabela a
mantém obrigatória mesmo sob um banco de dados que define `required: false`. Nada muda
no banco de dados: uma inicialização que provisiona ainda habilita row-level security
e grava as políticas declaradas, e o `rebase doctor` continuará reportando as tabelas
como desprotegidas.

Com o row-level security desativado, o `rls` declarado não é aplicado pelo Postgres:
`"admin-only"` não impede um usuário autenticado que não seja administrador. Mantenha
o login, as roles e os hooks fazendo esse papel.

### Um administrador de banco de dados cria as roles

Quando a conexão não tem permissão para criar roles, ou as roles residem no Terraform:

```bash
REBASE_RLS_PROVISION_ROLE=never
```

A inicialização verifica a role e a associação e falha exibindo o SQL a ser executado,
em vez de tentar criá-las. Para entregar esse SQL ao administrador com antecedência:

```bash
rebase db provision --print > request-role.sql
```

Ele imprime, para cada role de requisição, os comandos que a criam
(`NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`), concedem à role de conexão o direito de
alternar para ela (`WITH SET TRUE, INHERIT FALSE` no PostgreSQL 16 e mais recente) e
concedem a ela os esquemas sob `grants: "schema"`. As explicações são escritas como
comentários SQL, permitindo que o arquivo seja executado como está. Ele lê a role de
conexão a partir do banco de dados e não executa mais nada. Todos os comandos podem ser
executados novamente com segurança.

### Requisições de administrador e `rebase_admin`

O Postgres combina as políticas permissivas aplicadas a uma role com OR. Se escritas com
`TO public`, a linha de base que cada tabela possui (`rebase.uid() IS NULL OR` a role
`admin`) também se aplicaria a usuários autenticados, e um OR cujo outro lado é constante
para toda a instrução não pode usar um índice: a listagem ou contagem com escopo de
proprietário de um usuário faria uma varredura completa da tabela (table scan). Portanto,
as políticas que apenas o contexto do servidor ou um administrador podem satisfazer são
escritas com `TO rebase_admin`, e nunca chegam ao plano de consulta de um usuário.

O `rebase_admin` não possui privilégios e não pode fazer login. Um chamador que possui
a role `admin`, incluindo `rebase.dataAsAdmin`, executa como `<request role>_admin`
(`rebase_user_admin` por padrão), que herda a role de requisição e `rebase_admin`. Uma
conexão que está sujeita a row-level security herda `rebase_admin` para o contexto do
servidor. A inicialização cria tudo isso quando a conexão pode criar roles. Sob
`provisionRole: "never"`, crie-as manualmente:

```sql
CREATE ROLE rebase_admin NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE rebase_user_admin NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT rebase_user, rebase_admin TO rebase_user_admin WITH INHERIT TRUE, SET FALSE;
GRANT rebase_user_admin TO <connection role> WITH SET TRUE, INHERIT FALSE;
```

No PostgreSQL 15 e anteriores, crie `rebase_user_admin` com `INHERIT` e omita as opções
`WITH`. Onde `rebase_admin` não puder ser criado de forma alguma, a inicialização e o
`rebase db push` gravam essas políticas `TO public`, como eram antes, e os administradores
continuam executando como a role de requisição. O `rebase doctor --database` relata qual
desses cenários você possui.

#### Leituras de admin usam os índices do proprietário

Uma política que não é uma constante impede o Postgres de usar um índice para um operador
que não seja leakproof, como `&&` em um array, `~` ou um operador jsonb. Sem a etapa
abaixo, o `tags && $1` de um administrador escaneava a tabela inteira, enquanto a mesma
consulta executada pelo proprietário usava o índice GIN. Isso abrangia `rebase.sqlAsAdmin`,
`rebase.dataAsAdmin` e usuários administradores da mesma forma.

Portanto, a inicialização dá a cada política exclusiva para admin que todo administrador
satisfaz uma política complementar (companion) `TO rebase_admin_request USING (true)`,
denominada `<policy>_ar_<hash>`. Para uma requisição de admin, o Postgres reduz as políticas
para `true` e planeja a consulta como faria para o proprietário. As políticas restritivas
continuam se aplicando. Apenas as roles `<request role>_admin` podem possuir
`rebase_admin_request`. A cada inicialização, o Rebase verifica quais roles detêm seus
privilégios. Se qualquer outra role sujeita a row-level security os detiver, a inicialização
não grava companions e remove as que encontrar. As companions exigem PostgreSQL 16 ou
superior, pois no 15 e anteriores a conexão herdaria a role. Apenas a inicialização as
grava. O `policies.sql` e as migrações nunca criam uma, mas removem a companion de cada
política que reescrevem e que não a justifique mais. O `rebase db push` e o `rebase db migrate`
também removem qualquer companion cuja regra tenha sido eliminada. Uma regra de admin
restringida ou removida, portanto, deixa de admitir todos os administradores, mesmo onde a
inicialização não provisiona nada. Sob `provisionRole: "never"`, crie a role manualmente:

```sql
CREATE ROLE rebase_admin_request NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT rebase_admin_request TO rebase_user_admin WITH INHERIT TRUE, SET FALSE;
```

Antes de fazer rollback para uma versão anterior à que introduziu as companions, torne-as
inertes. Um runtime mais antigo não sabe o que elas são e nunca as remove, de modo que uma
regra alterada posteriormente deixaria sua companion admitindo todos os administradores a
todas as linhas. Uma instrução por role de requisição de admin faz com que cada companion
não admita ninguém:

```sql
REVOKE rebase_admin_request FROM rebase_user_admin;
```

Ou remova-as: toda política cujo nome termine em `_ar_` seguido de oito dígitos
hexadecimais e cuja role seja `rebase_admin_request`.

### Um esquema `public` compartilhado

Quando `public` contém tabelas que o Rebase não deve acessar:

```bash
REBASE_RLS_GRANTS=managed
```

O Rebase então concede à role de requisição permissões apenas nas tabelas que ele atende:
tabelas declaradas, tabelas de junção e suas próprias tabelas com segurança em nível de
linha. Ele não define privilégios padrão em esquemas compartilhados e não revoga nada que
já tenha sido concedido. O `rebase doctor --database` lista as tabelas nos esquemas do
Rebase que ele não atende.

Outra alternativa é um esquema próprio do Rebase: defina `schema` em cada `defineTable`.

## Provedores

O que a role de conexão pode fazer varia entre os provedores e determina se o Rebase pode
criar a role de requisição por conta própria. As observações abaixo refletem o que
esperamos; confirme-as com o seu provedor.

| Provedor | Role de conexão habitual | Observações |
|---|---|---|
| Supabase | `postgres` (não é superuser, possui CREATEROLE) | Um banco de dados por projeto. `anon`, `authenticated` e `authenticator` existem, com privilégios padrão em `public`. Veja a receita do Supabase acima. |
| Neon | o proprietário do projeto, membro de `neon_superuser` | As roles pertencem a uma branch, e todos os bancos de dados em uma branch as compartilham. Dois bancos de dados Rebase em um projeto Neon compartilham `rebase_user`, portanto defina `requestRole` por banco de dados. |
| AWS RDS / Aurora | o usuário master, membro de `rds_superuser` | Possui CREATEROLE, mas não é superuser. Instâncias costumam ser compartilhadas entre aplicações. |
| Google Cloud SQL | `postgres`, membro de `cloudsqlsuperuser` | Como o RDS. |
| Azure Flexible Server | o usuário admin, membro de `azure_pg_admin` | Como o RDS. |
| InstaPods | `instapod`; superuser via `sudo -u postgres` | [O guia do InstaPods](/docs/deployment/instapods/) cria a role antecipadamente. |
| Hostman | `gen_user`; CREATE ROLE concedido a partir do painel | Não disponível no menor plano. [O guia do Hostman](/docs/deployment/hostman/) cria a role antecipadamente. |

## Relacionados

- [Comandos de Banco de Dados](/docs/cli/database/): `rebase db request-role` e
  `rebase db provision`
- [Referência da CLI](/docs/cli/#rebase-doctor): `rebase doctor --database`
- [rls-check](/docs/rls-check/): audite as políticas em qualquer Postgres
- [Regras de Segurança (RLS)](/docs/collections/security-rules/): as políticas
  que o Rebase grava para cada tabela
