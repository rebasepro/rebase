---
sourceHash: 4107937aed2a477c
title: Executando em um banco de dados existente ou compartilhado
sidebar_label: Banco de dados existente ou compartilhado
description: Execute o Rebase em um banco de dados PostgreSQL que ele não possui — um cluster compartilhado com outros aplicativos, um segundo projeto Rebase, Supabase ou um banco de dados bloqueado por um DBA — com as configurações de rls, rebase doctor --database e rebase db request-role migrate.
---

## O problema

O Rebase executa cada requisição autenticada e anônima como uma única role restrita
do Postgres, `rebase_user`, e deixa a segurança em nível de linha (row-level security - RLS)
decidir quais linhas essa requisição vê. A role de conexão é proprietária das
tabelas e ignora o RLS; cada requisição alterna para `rebase_user` dentro de sua transação.

Isso funciona em um banco de dados pertencente inteiramente ao Rebase: Rebase Cloud,
a configuração do Docker estruturada pelo `rebase init`, o banco de dados de desenvolvimento
gerenciado. Ele se baseia em duas premissas:

1. Apenas o servidor deste projeto pode se tornar `rebase_user`.
2. Apenas `rebase_user` e o proprietário da tabela acessam as tabelas do Rebase.

Um banco de dados que alguém já administra frequentemente quebra ambas:

- **As roles pertencem a todo o cluster, não a um único banco de dados.** Dois
  projetos Rebase em um mesmo cluster compartilham o mesmo `rebase_user`. Por
  padrão, qualquer role pode se conectar a qualquer banco de dados, e qualquer
  pessoa pode definir as configurações de sessão que as políticas do Rebase leem;
  portanto, a conexão do projeto A pode abrir o banco de dados do projeto B, alternar
  para `rebase_user` e passar pelas políticas de B como administrador de B.
- **As concessões (grants) abrangem esquemas inteiros.** Por padrão, o Rebase
  concede à role de requisição `SELECT, INSERT, UPDATE, DELETE` em todas as
  tabelas em `public` sobre as quais ele pode conceder permissões, incluindo
  tabelas pertencentes a outra aplicação.
- **Políticas padrão se aplicam `TO public`.** A política de linha de base que
  o Rebase adiciona a cada tabela permite qualquer sessão que nunca tenha
  definido a identidade do Rebase. É assim que as próprias consultas do servidor
  passam, e isso também permite qualquer outra role que possua uma concessão na
  tabela, como a `anon` do Supabase por meio de sua Data API.
- **Políticas existentes baseadas em roles nunca se aplicam.** Uma política
  escrita com `TO authenticated` não se aplica a `rebase_user`, porque
  `rebase_user` não herda privilégios de outras roles.
- **Alguns bancos de dados não permitem que a aplicação crie roles de forma alguma.**
  Um DBA cria cada role manualmente, ou as roles são gerenciadas no Terraform.

Cada uma dessas situações possui uma configuração. O padrão de cada configuração
é o que o Rebase já faz sem ela, portanto, um projeto que não define nada se
comporta exatamente como antes.

## Verifique o banco de dados primeiro

```bash
rebase doctor --database
```

Ele lê o catálogo do banco de dados do projeto e não altera nada. Ele relata:

- se cada role de requisição existe, se é restrita e se esta conexão pode
  alternar para ela;
- outras roles de login que podem alternar para a role de requisição;
- se todas as roles do cluster podem se conectar a este banco de dados;
- tabelas nos esquemas do Rebase que o Rebase não atende;
- outras roles que possuem privilégios nas tabelas do Rebase;
- políticas nas tabelas do Rebase escritas `TO` uma role que a role de
  requisição não herda;
- privilégios padrão que concedem novas tabelas a outras roles.

Cada apontamento vem acompanhado do SQL a ser executado como administrador do
banco de dados, da configuração que adapta o Rebase ao banco de dados, ou de
ambos. Ele sai com código 1 quando um apontamento for uma falha, para que possa
bloquear uma implantação (deployment). Ele verifica o banco de dados em relação
às configurações visíveis: as variáveis `REBASE_RLS_*` e, em seguida, as roles de
requisição registradas no banco de dados na inicialização do servidor.

O `npx @rebasepro/rls-check` audita as próprias políticas, em qualquer Postgres.
Em um banco de dados Rebase, ele lê a role de requisição da mesma forma;
especifique-a com `--request-role` quando ela ainda não estiver registrada.

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

Ou a partir do ambiente, que tem precedência sobre a declaração. O ambiente é
ideal para valores que variam entre duas implantações do mesmo código, como o
nome da role quando staging e produção compartilham um cluster.

| Configuração | Variável de ambiente | Padrão | Alternativas |
|---|---|---|---|
| `requestRole` | `REBASE_RLS_REQUEST_ROLE` (um único nome) | `"rebase_user"` | Qualquer nome de role. `{ anonymous, signedIn }` para executar chamadores sem sessão como uma role e chamadores autenticados como outra. No código do driver, uma função da identidade da requisição. |
| `requestRoles` | nenhum | derivado de `requestRole` | Todas as roles que um `requestRole` baseado em função pode retornar, para que cada uma possa ser provisionada, concedida e verificada. Obrigatório ao usar uma função. |
| `provisionRole` | `REBASE_RLS_PROVISION_ROLE` | `"auto"`: cria a role se estiver ausente e concede a esta conexão o direito de alternar para ela | `"never"`: a role e a associação pertencem a você. A inicialização verifica ambos e falha indicando o SQL a ser executado. |
| `grants` | `REBASE_RLS_GRANTS` | `"schema"`: todas as tabelas e sequências nos esquemas que o Rebase atende sobre as quais a conexão pode conceder permissões, além de privilégios padrão para tabelas criadas posteriormente | `"managed"`: apenas as tabelas que o Rebase atende, e nenhum privilégio padrão. `"none"`: o Rebase não concede nada; uma tabela para a qual você não concedeu permissão é recusada. |
| `policyTarget` | `REBASE_RLS_POLICY_TARGET` | `"public"` | `"requestRole"`: políticas permissivas se aplicam apenas à(s) role(s) de requisição. Políticas restritivas ainda se aplicam a todos. |
| `adminPolicies` | `REBASE_RLS_ADMIN_POLICIES` | `"adminRole"`: políticas que apenas o contexto do servidor ou um administrador podem passar (a linha de base, `roles: ["admin"]`) são escritas `TO rebase_admin`, e requisições de admin são executadas como `<request role>_admin` | `"public"`: essas políticas são `TO public` e administradores executam como a role de requisição, como antes da existência desta configuração. |
| `defaultPolicies` | `REBASE_RLS_DEFAULT_POLICIES` | `true` | `false`: nenhuma tabela recebe a linha de base de servidor ou administrador. O próprio `defaultPolicies: false` de uma tabela ainda decide individualmente por ela. |
| `required` | nenhum | `true`: uma tabela declarada que o banco de dados não protege (segurança em nível de linha desativada, suas políticas declaradas ausentes) não é atendida quando a inicialização não provisiona nada | `false`: atende as tabelas deste banco de dados mesmo assim e as lista na inicialização. Para um esquema pertencente a outra ferramenta e uma aplicação que gerencia o acesso por conta própria; consulte "Outra ferramenta é proprietária do esquema" abaixo. O próprio `rlsRequired` de uma tabela decide individualmente por ela. |
| `inheritRoles` | nenhum | `[]` | Roles concedidas à role de requisição `WITH INHERIT TRUE`, para que políticas escritas `TO` elas se apliquem. Com um par `{ anonymous, signedIn }` de roles de requisição, apenas a autenticada as recebe; com uma função, a configuração é recusada. PostgreSQL 16 ou mais recente; recusado no 15 e anteriores. |
| `identity` | `REBASE_RLS_IDENTITY` (formas nomeadas) | `"rebase"`: `app.uid`, `app.user_roles`, `app.is_anonymous`, `app.jwt` | `"supabase"`: também `request.jwt.claims`, `request.jwt.claim.sub` e `request.jwt.claim.role`, para que `auth.uid()` e `auth.jwt()` vejam o chamador. No código do driver, uma função que retorna configurações adicionais. As configurações `app.*` são sempre definidas. |
| `sharedRole` | `REBASE_RLS_SHARED_ROLE` | `"warn"` quando outro login puder alternar para a role de requisição | `"refuse"`: falha a inicialização. `"ignore"`: não exibe avisos. |

As formas de função de `requestRole` e `identity` são aceitas apenas no próprio
bloco `rls` do driver, que recebe as mesmas configurações. `policyTarget`,
`adminPolicies` e `defaultPolicies` alteram o SQL de política que o `rebase db
generate` escreve, e a CLI não pode ler o código do driver; portanto, defina-os
na declaração ou no ambiente. Uma inicialização que os encontre apenas no código
do driver se recusará a iniciar.

Na inicialização, a linha que relata como as requisições são isoladas lista
todas as configurações que não estão em seus valores padrão. Uma configuração que
transfere uma tarefa para você, como `grants: "none"`, indica uma vez qual é
essa tarefa.

A primeira inicialização com provisionamento registra a(s) role(s) de requisição
em `rebase.schema_meta`. Uma inicialização posterior configurada com uma role
diferente se recusa a iniciar e indica o comando para migrar o banco de dados,
abaixo. Sem essa verificação, a role antiga manteria suas concessões enquanto
uma nova estaria configurada ao lado dela.

## Receitas

### Um cluster compartilhado com outros aplicativos ou projetos

Atribua a cada projeto, e a cada implantação que compartilha um cluster, uma
role própria:

```bash
REBASE_RLS_REQUEST_ROLE=acme_prod_user
```

Um banco de dados que já foi executado como `rebase_user` registra isso, portanto,
migre-o primeiro:

```bash
rebase db request-role migrate --to acme_prod_user --dry-run
rebase db request-role migrate --to acme_prod_user
```

O comando cria a nova role se ela estiver ausente, reedita apenas neste banco
de dados todas as concessões que a role antiga possui (tabelas, colunas, sequências,
esquemas, funções, os privilégios padrão definidos por esta conexão e associações),
reaponta políticas que nomeiam a role antiga e registra a nova role. Ele é
executado em uma única transação. A role antiga é mantida como está, porque
outro banco de dados no cluster ainda pode usá-la. Quando termina, ele imprime
os comandos `REVOKE` que removem as concessões da role antiga neste banco de
dados, para serem executados quando nada mais aqui precisar delas. `--dry-run`
imprime os mesmos comandos e não altera nada. Em um terminal, ele solicita
confirmação antes de executar; sem terminal, ele recusa a execução sem `--yes`.

Em seguida, defina `REBASE_RLS_REQUEST_ROLE` em cada servidor que utiliza o
banco de dados.

O `rebase doctor --database` também relata se todas as roles do cluster podem
se conectar ao banco de dados, indicando o comando `REVOKE CONNECT … FROM PUBLIC`
para impedir isso. O Rebase não executa isso por conta própria em um banco de
dados que não gerencia integralmente.

### Supabase

Um esquema Supabase existente já possui `anon` e `authenticated`, além de
políticas escritas para elas usando `auth.uid()`. Para que essas políticas se
apliquem às requisições do Rebase sem alterações:

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
  (incluindo convidados) como `authenticated`.
- `identity: "supabase"` define as configurações `request.jwt.*` que `auth.uid()`
  lê. Sem elas, qualquer verificação `auth.uid() = owner_id` falha, ou passa
  quando não deveria.
- `policyTarget: "requestRole"` impede que as próprias políticas do Rebase se
  apliquem a sessões que não sejam requisições do Rebase, como a Data API do
  Supabase.

Como as requisições são executadas diretamente como `anon` e `authenticated`,
as políticas escritas com `TO anon` ou `TO authenticated` se aplicam como estão,
e o `inheritRoles` não é necessário. Ele é destinado a projetos cujas
requisições são executadas como uma role própria, como
`requestRole: "acme_user", inheritRoles: ["authenticated"]`. Com um par
`{ anonymous, signedIn }`, ele é concedido apenas à role autenticada, nunca à
anônima.

Os privilégios padrão originais do Supabase concedem as tabelas criadas em
`public` para `anon` e `authenticated`; verifique o seu projeto. Execute
`rebase doctor --database` e `rls-check` após a primeira inicialização para
verificar o que essas roles podem acessar.

### Outra ferramenta é proprietária do esquema, e a aplicação gerencia o acesso

Alguns bancos de dados não cabem ao Rebase proteger. Alembic, Prisma ou um DBA
são os proprietários das tabelas, nada ativa a segurança em nível de linha e a
própria aplicação decide quem vê o quê: apenas a equipe pode fazer login, hooks
verificam cada gravação, um escopo controla o acesso a cada rota.

Declare essa postura diretamente na tabela:

```ts
export const invoices = defineTable("invoices", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), total: col.numeric() },
    rls: "unmanaged"
});
```

Ou para todo o projeto via `defaultRls = "unmanaged"` em
`backend/schema/index.ts` em conjunto com `rls: "inherit"` em cada tabela.
O Rebase não emite nenhum DDL de `ENABLE ROW LEVEL SECURITY` ou de políticas
para tabelas `"unmanaged"` (no `db push` ou em inicializações com provisionamento),
atende-as sem restrições e as lista uma vez na inicialização. Mantenha login,
roles, escopos e hooks aplicando o controle de acesso.

Se o Postgres **de fato** aplicar segurança em nível de linha nessas tabelas,
com políticas criadas em migrações SQL, no Supabase ou no Terraform em vez do
Rebase, use `rls: "external"` em vez disso:

```ts
export const invoices = defineTable("invoices", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), total: col.numeric() },
    rls: "external"
});
```

O Rebase não emite nenhum DDL de RLS ou de políticas para tabelas `"external"`
e nunca remove suas políticas (`--prune-policies`), enquanto a inicialização e o
`rebase doctor` ainda verificam se `ENABLE ROW LEVEL SECURITY` está ativo na
tabela no Postgres.

Para tabelas que ainda declaram regras do Rebase em um banco de dados pertencente
a outra ferramenta, `rlsRequired: false` (ou `database({ rls: { required: false } })`
para todo o banco de dados) atende-as em uma inicialização sem provisionamento
mesmo quando as políticas declaradas não estiverem presentes, listando-as em um
único aviso:

```ts
// backend/resources.ts
export const main = database({ rls: { required: false } });
```

O `rlsRequired: true` de uma tabela mantém-na como obrigatória sob um banco de
dados que define `required: false`. Com a segurança em nível de linha desativada,
uma regra declarada não é aplicada pelo Postgres: mantenha o login, roles e hooks
desempenhando esse papel.

### Um administrador de banco de dados cria as roles

Quando a conexão não tem permissão para criar roles, ou as roles residem no
Terraform:

```bash
REBASE_RLS_PROVISION_ROLE=never
```

A inicialização então verifica a role e a associação e falha indicando o SQL a
ser executado, em vez de tentar criá-las. Para fornecer esse SQL ao administrador
com antecedência:

```bash
rebase db provision --print > request-role.sql
```

Ele imprime, para cada role de requisição, os comandos que a criam
(`NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`), concedem à role de conexão o
direito de alternar para ela (`WITH SET TRUE, INHERIT FALSE` no PostgreSQL 16
ou mais recente) e concedem a ela os esquemas sob `grants: "schema"`. A
explicação é escrita como comentários SQL, para que o arquivo possa ser executado
como está. Ele lê a role de conexão do banco de dados e não executa mais nada.
Cada comando pode ser executado novamente com segurança.

### Requisições de admin e `rebase_admin`

O Postgres combina as políticas permissivas que se aplicam a uma role com OR.
Se escrita com `TO public`, a linha de base que cada tabela possui
(`rebase.uid() IS NULL OR` a role `admin`) se aplicaria também aos usuários
autenticados, e um OR cujo outro lado é constante para toda a instrução não pode
usar um índice: a listagem ou contagem com escopo de proprietário de um usuário
realizaria uma varredura completa na tabela (table scan). Portanto, as políticas
que apenas o contexto do servidor ou um admin podem passar são escritas
`TO rebase_admin`, e nunca entram no plano de consulta de um usuário.

A tabela de usuários é a exceção. A autenticação a lê e grava no contexto do
servidor sob a própria role da conexão, que não é alternada para `rebase_admin`,
portanto, suas políticas permanecem como `TO public` independentemente da
configuração: por trás de uma role de conexão que não é proprietária da tabela,
o cadastro e o login funcionam da mesma forma.

`rebase_admin` não possui privilégios e não pode fazer login. Um chamador com
a role `admin`, incluindo `rebase.dataAsAdmin`, é executado como
`<request role>_admin` (`rebase_user_admin` por padrão), que herda a role de
requisição e `rebase_admin`. Uma conexão que está sujeita à segurança em nível
de linha herda `rebase_admin` para o contexto do servidor. A inicialização cria
tudo isso quando a conexão tem permissão para criar roles. Com
`provisionRole: "never"`, crie-as manualmente:

```sql
CREATE ROLE rebase_admin NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE rebase_user_admin NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT rebase_user, rebase_admin TO rebase_user_admin WITH INHERIT TRUE, SET FALSE;
GRANT rebase_user_admin TO <connection role> WITH SET TRUE, INHERIT FALSE;
```

No PostgreSQL 15 e versões anteriores, crie `rebase_user_admin` com `INHERIT`
e omita as opções `WITH`. Onde `rebase_admin` não puder ser criado de forma alguma,
a inicialização e o `rebase db push` escrevem essas políticas `TO public`, como
eram antes, e os admins continuam sendo executados como a role de requisição.
O `rebase doctor --database` relata qual desses cenários você possui.

#### Leituras de admin usam os índices do proprietário

Uma política que não seja uma constante impede o Postgres de usar um índice
para um operador que não seja leakproof, como `&&` em um array, `~` ou um
operador jsonb. Sem a etapa abaixo, uma consulta de admin como `tags && $1`
realizava uma varredura completa na tabela, enquanto a mesma consulta executada
pelo proprietário utilizava o índice GIN. Isso afetava `rebase.sqlAsAdmin`,
`rebase.dataAsAdmin` e usuários administradores da mesma forma.

Portanto, a inicialização fornece a cada política exclusiva para administradores
que todo admin passa uma política complementar `TO rebase_admin_request USING (true)`,
nomeada `<policy>_ar_<hash>`. Para uma requisição de admin, o Postgres simplifica
as políticas para `true` e planeja a consulta como faria para o proprietário.
Políticas restritivas ainda se aplicam. Apenas as roles `<request role>_admin`
podem possuir `rebase_admin_request`. A cada inicialização, o Rebase verifica
quais roles detêm seus privilégios. Se qualquer outra role sujeita à segurança
em nível de linha os detiver, a inicialização não escreve complementares e remove
qualquer uma que encontrar. Políticas complementares exigem PostgreSQL 16 ou
superior, pois no 15 e anteriores a conexão herdaria a role. Apenas a
inicialização as escreve. O `policies.sql` e as migrações nunca criam uma, mas
removem a complementar de cada política reescrita que não precise mais dela.
`rebase db push` e `rebase db migrate` também removem qualquer complementar cuja
regra foi excluída. Uma regra de admin restrita ou removida, portanto, deixa de
admitir todos os admins, mesmo onde a inicialização não provisiona nada. Com
`provisionRole: "never"`, crie a role manualmente:

```sql
CREATE ROLE rebase_admin_request NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT rebase_admin_request TO rebase_user_admin WITH INHERIT TRUE, SET FALSE;
```

Antes de reverter para uma versão anterior à que introduziu as complementares,
desative-as. Um runtime mais antigo não sabe o que elas são e nunca as remove,
de modo que uma regra alterada posteriormente deixaria sua complementar admitindo
qualquer admin em todas as linhas. Uma instrução por role de requisição de admin
faz com que todas as complementares não admitam ninguém:

```sql
REVOKE rebase_admin_request FROM rebase_user_admin;
```

Ou remova-as: cada política cujo nome termine em `_ar_` seguido por oito
dígitos hexadecimais e cuja role seja `rebase_admin_request`.

### Um esquema `public` compartilhado

Quando `public` contém tabelas que o Rebase não deve acessar:

```bash
REBASE_RLS_GRANTS=managed
```

O Rebase então concede à role de requisição apenas as tabelas que ele atende:
tabelas declaradas, tabelas de junção e suas próprias tabelas com segurança em
nível de linha. Ele não define privilégios padrão em esquemas compartilhados e
não revoga nada que já tenha sido concedido. O `rebase doctor --database` lista
as tabelas nos esquemas do Rebase que ele não atende.

Outra alternativa é usar um esquema próprio do Rebase: defina `schema` em
cada `defineTable`.

## Provedores

O que a role de conexão pode fazer varia entre os provedores e determina se o
Rebase pode criar a role de requisição por conta própria. As notas abaixo são o
que esperamos; verifique-as com seu provedor.

| Provedor | Role de conexão habitual | Observações |
|---|---|---|
| Supabase | `postgres` (não é superusuário, possui CREATEROLE) | Um banco de dados por projeto. `anon`, `authenticated` e `authenticator` existem, com privilégios padrão em `public`. Consulte a receita do Supabase acima. |
| Neon | o proprietário do projeto, membro de `neon_superuser` | As roles pertencem a uma branch, e todos os bancos de dados em uma branch as compartilham. Dois bancos de dados Rebase em um projeto Neon compartilham `rebase_user`; portanto, defina `requestRole` por banco de dados. |
| AWS RDS / Aurora | o usuário master, membro de `rds_superuser` | Possui CREATEROLE, mas não é superusuário. As instâncias frequentemente são compartilhadas entre aplicações. |
| Google Cloud SQL | `postgres`, membro de `cloudsqlsuperuser` | Como o RDS. |
| Azure Flexible Server | o usuário administrador, membro de `azure_pg_admin` | Como o RDS. |
| InstaPods | `instapod`; superusuário via `sudo -u postgres` | [O guia do InstaPods](/docs/deployment/instapods/) cria a role previamente. |
| Hostman | `gen_user`; CREATE ROLE concedido pelo painel | Não disponível no plano mais básico. [O guia do Hostman](/docs/deployment/hostman/) cria a role previamente. |

## Relacionados

- [Comandos de banco de dados](/docs/cli/database/): `rebase db request-role` e
  `rebase db provision`
- [Referência da CLI](/docs/cli/#rebase-doctor): `rebase doctor --database`
- [rls-check](/docs/rls-check/): audite as políticas em qualquer Postgres
- [Regras de segurança (RLS)](/docs/collections/security-rules/): as políticas
  que o Rebase escreve para cada tabela
