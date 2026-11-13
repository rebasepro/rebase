---
sourceHash: 313f8530404811bc
slug: pt/docs/rls-check
title: rls-check
description: Audite a segurança em nível de linha (RLS) em qualquer banco de dados PostgreSQL — Supabase, Neon, RDS ou seu próprio servidor. Somente leitura, sem necessidade de cadastro ou do Rebase.
---

# rls-check

O `rls-check` lê o catálogo de um banco de dados PostgreSQL e relata o que está realmente exposto:
tabelas servidas com a segurança em nível de linha (RLS) desativada, políticas que avaliam como verdadeiras para
qualquer um, visualizações (views) que leem ignorando o RLS de suas tabelas base, e tabelas de junção
que foram esquecidas enquanto ambas as suas pontas estavam protegidas.

Ele funciona em **qualquer** Postgres — Supabase, Neon, RDS, Cloud SQL ou em um servidor gerenciado por você mesmo. Ele não requer o Rebase e é útil independentemente de você adotá-lo ou não.

```bash
npx @rebasepro/rls-check
```

Execute-o no diretório do seu projeto e ele encontrará o banco de dados sozinho: `DATABASE_URL`,
depois `POSTGRES_URL`, e depois um arquivo `.env` no local. Passe a string de conexão como um
argumento apenas quando não puder fazer isso — o npm replica a linha de comando antes de o
programa iniciar, e o seu shell a registra, de modo que uma senha em um argumento vai parar em
dois lugares que o `rls-check` não consegue ocultar. `$DATABASE_URL` não é mais seguro ali: o shell
o expande antes que o npm chegue a vê-lo.

Ele é somente leitura por concepção: ele abre uma transação somente leitura e executa consultas
ao catálogo. Ele não escreve nada e não envia nada para lugar nenhum — não há telemetria e nenhuma
chamada de rede além daquela direcionada ao seu banco de dados.

## Executando

```bash
# A partir do ambiente — DATABASE_URL, depois POSTGRES_URL, depois um .env no diretório atual
npx @rebasepro/rls-check

# Para um banco de dados que não seja o do seu ambiente
DATABASE_URL="postgres://user:pass@host:5432/dbname" npx @rebasepro/rls-check

# Como um argumento. Funciona, mas veja o aviso acima sobre onde a senha vai parar
npx @rebasepro/rls-check "postgres://user:pass@host:5432/dbname"
```

Se a sua senha contiver `/`, `?` ou `#`, codifique-a no formato percent-encode. Esses três caracteres encerram a
seção de autoridade da URL, fazendo com que a divisão caia dentro da credencial — em vez de imprimir fragmentos de
uma senha, o `rls-check` rejeita a string e informa o motivo.

`@` e `:` não precisam de codificação: as informações do usuário são divididas no **último** `@` e o usuário no
**primeiro** `:`, que é o que o `pg` também faz; assim, `postgres://user:pa@ss@host:5432/db` conecta-se
ao `host` com a senha `pa@ss`. Codificá-los de qualquer forma nunca é errado.

### Opções

| Opção | Significado |
| --- | --- |
| `--json` | Saída legível por máquina no stdout, e nada mais no stdout |
| `--format <name>` | `text` (padrão), `json` (igual a `--json`) ou `agent`: um documento JSON para um agente de código, onde cada ocorrência traz a tabela e a política com falha, o SQL que a corrige e as `securityRules` equivalentes do Rebase |
| `--html <path>` | Também grava um relatório HTML autocontido no caminho indicado. Um único arquivo, sem requisições de rede |
| `--schema <name>` | Restringe a varredura a um schema. Repetível ou separado por vírgulas |
| `--role <name>` | Trata essa role como uma que um chamador não confiável pode assumir, além de `anon`, `authenticated`, `web_anon` e `rebase_user`. Repetível ou separado por vírgulas |
| `--request-role <name>` | A role com a qual um aplicativo Rebase neste banco de dados executa requisições, no lugar de `rebase_user` (a configuração `rls.requestRole`). Sem ela, as roles que o banco registrou em `rebase.schema_meta` são usadas, seguidas por `rebase_user`. Repetível ou separado por vírgulas |
| `--fail-on <severity>` | Encerra com código 1 nesta severidade ou acima. Padrão `high`; `none` nunca falha |
| `--only <id>` | Executa apenas estas verificações. Repetível ou separado por vírgulas |
| `--skip <id>` | Pula estas verificações. Repetível ou separado por vírgulas |
| `--list-checks` | Imprime o catálogo e encerra |
| `--timeout <ms>` | Timeout de instrução, padrão 15000 |
| `--quiet` | Apenas ocorrências — sem cabeçalho/banner, sem resumo |
| `--no-color` | Desativa cores ANSI (também respeita `NO_COLOR` e saídas stdout que não sejam TTY) |

Um ID desconhecido passado para `--only` ou `--skip` gera um erro em vez de uma operação silenciosa nula, pois
um erro de digitação ali enfraqueceria a varredura sem aviso. Uma `--role` ou `--request-role` que não esteja em `pg_roles`
é um erro pelo mesmo motivo: cada verificação depende de um grant para uma role exposta; portanto, um nome que não
corresponde a nada remove a cobertura silenciosamente. O mesmo vale para um `--schema` que não aponte para nenhum schema,
o que, de outra forma, não verificaria nada e reportaria como limpo. Nomes de schema diferenciam maiúsculas de minúsculas.

O cabeçalho do relatório lista as roles que a execução tratou como expostas, para que você possa ver num relance
se `No findings` (nenhuma ocorrência) cobriu a role com a qual o seu aplicativo se conecta:

```
Exposed   PUBLIC, anon, authenticated (add yours with --role)
```

Quando a varredura se conecta como uma role que a segurança em nível de linha *pode* restringir — que não seja um superusuário,
nem proprietário, sem `BYPASSRLS` — essa role é adicionada ao conjunto e o relatório informa isso. Varrer com a
própria role da sua aplicação é a coisa mais próxima de perguntar ao banco de dados o que a sua API realmente vê.

### Códigos de saída (Exit codes)

| Código | Significado |
| --- | --- |
| `0` | Nenhuma ocorrência no limite de `--fail-on` ou acima dele |
| `1` | Ao menos uma ocorrência no limite ou acima dele |
| `2` | A varredura não pôde ser executada — argumentos incorretos, conexão recusada, falha de autenticação, timeout — ou foi incompleta: a leitura do catálogo falhou ou uma verificação travou (`diagnostics.degraded`). Isso se mantém mesmo com `--fail-on none` |

`1` e `2` são deliberadamente distintos: uma conexão com falha nunca deve parecer um banco
de dados limpo.

### No CI

```yaml
- name: Audit RLS
  run: npx @rebasepro/rls-check --fail-on high
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

**Um novo projeto Rebase não passa nessa verificação no primeiro dia, e não é suposto passar.** O
`defaultRls` do scaffold inicial abre leituras para todos — `{ operation: "select", access:
"public" }` em `backend/schema/index.ts`, o qual `authors` e `tags` utilizam com
`rls: "inherit"` — portanto, cada um relata um erro crítico de `policy-always-true`. (`posts` declara suas próprias regras e lê apenas linhas publicadas.) `access: "public"` diz respeito a *linhas*, não a quem pode chamar a
API: uma requisição sem token ainda recebe resposta 401 enquanto `AUTH_REQUIRE` estiver ativado. A ocorrência é
correta ainda assim, porque essa é a única proteção diante dos dados.

Decida qual dessas duas situações se aplica antes de conectar isso ao CI:

- **as regras são um placeholder** — substitua-as por aquelas de que seus dados realmente precisam
  ([segurança em nível de linha](/docs/collections/security-rules)), e as ocorrências desaparecerão;
- **as linhas são realmente de leitura pública** — declare isso explicitamente uma vez, com
  `npx @rebasepro/rls-check --fail-on high --skip policy-always-true`, e saiba o que você abriu
  mão: `--skip` desativa a verificação em todo lugar, incluindo na tabela que você adicionar no próximo mês.

### Saída JSON

`--json` emite um objeto estável: `scannedAt`, `database` (apenas host e nome — nunca
credenciais), `serverVersion`, `platform`, `scannerIsPrivileged`, `exposedRoles`, `stats`,
`findings` e `diagnostics`. Cada ocorrência traz `id`, `severity`, `title`, `target`,
`detail`, `impact`, `fix`, `docs` e `confidence`.

`exposedRoles` e `diagnostics` fazem parte do contrato, não são extras: cada verificação depende
do conjunto exposto, e `diagnostics.degraded` é como o consumidor diferencia "nada estava errado" de
"a varredura não conseguiu verificar". Ler `findings: []` sem ambos é ver apenas metade da resposta.

### Saída para agentes (Agent output)

`--format agent` imprime um documento JSON voltado a um agente de código para que ele corrija o que encontrar. Toda
ocorrência indica seu check id e o objeto com falha (`target.table`, `target.policy`, …) e traz
uma `remediation`: `apply` (`sql`; `rebase-config` quando o Rebase recria a política a partir do
`rls` de uma tabela a cada inicialização; ou `manual`), um `sql` executável escrito por verificação, os
`placeholders` para preencher primeiro, e `rebase` — a mesma correção no formato de `rls` da tabela, com um
trecho de `defineTable(…, { rls })` para `backend/schema/`, ou a explicação do porquê as regras não podem expressá-la. Desde
a versão 0.31, essa chave é `rebase.rls` (antes era `rebase.securityRules`) e a versão do formato do documento é 2. A
`key` de cada ocorrência é estável entre execuções; assim, uma nova execução mostra o que foi resolvido. O `--json` permanece inalterado.

## Executando de forma agendada

Uma verificação que você precisa se lembrar de rodar é uma verificação que reportará um banco de dados limpo
até o exato dia em que o problema ocorrer. O backend pode executar essa verificação para você e
fornecer o resultado para o painel de administração:

```ts
import { scan } from "@rebasepro/rls-check";
import type { RebaseBackendConfig } from "@rebasepro/server";

const rlsAudit: RebaseBackendConfig["rlsAudit"] = {
    enabled: true,
    scan,
    intervalMs: 24 * 60 * 60 * 1000,  // o padrão
    warnAtSeverity: "high"            // o padrão
};
```

Passe isso como `rlsAudit` no objeto fornecido para `initializeRebaseBackend`.

No runtime — `rebase dev`, `rebase start` e a imagem de servidor publicada —
não há tal objeto para passar; portanto, defina `REBASE_RLS_AUDIT=true`,
com o intervalo e limite padrões. O scanner ainda precisa vir do seu
projeto: adicione `@rebasepro/rls-check` às dependências dele para que o bundle o inclua.
O runtime não traz uma cópia própria, e uma inicialização que solicite a auditoria sem
o pacote será recusada antes de abrir uma conexão, informando o pacote a ser adicionado.

O resultado é servido em `GET /api/admin/rls-audit`, restrito ao escopo
`schema:read`, e cada execução registra uma única linha no log — como `warn` quando uma ocorrência atinge
`warnAtSeverity`, ou como `info` caso contrário:

```
⚠️  [rls-audit] RLS audit found 3 issue(s) — 1 critical, 2 medium. 1 table(s)
    without RLS. Read the detail at GET /api/admin/rls-audit, or run
    `npx @rebasepro/rls-check` for the full report.
```

### Por que você passa a função `scan`

`@rebasepro/server` não possui um driver de banco de dados próprio; o `@rebasepro/rls-check`
traz o `pg`, pois conecta-se ao Postgres. Importá-lo dentro do pacote do servidor
colocaria um segundo driver Postgres em todas as instalações, para um recurso que apenas
algumas utilizam; por isso, você passa a função externamente.

### Em um deployment distribuído (split deployment)

A auditoria é um singleton com *propriedade* (owned singleton), assim como o agendador do cron. Todo processo que
a possui executa sua própria varredura, o que é somente leitura e inofensivo, mas redundante — atribua-a
a apenas um processo:

```ts
ownership: { rlsAudit: false }   // em todos os processos, exceto um
```

ou, para um runtime configurado por variáveis de ambiente:

```bash
REBASE_RLS_AUDIT=false
```

A role `functions` já a possui como `false` por padrão — esse processo não executa nenhum temporizador.
Declarar a substituição de propriedade de um serviço nunca altera o outro: desativar o cron não afeta
a auditoria, e vice-versa.

Um processo que serve a interface administrativa sem deter a execução da varredura responde ao
endpoint adequadamente, informando que a verificação não é executada ali.

### É uma rede de segurança, não um monitor

O intervalo padrão é de um dia, porque o que está sendo monitorado é um schema:
ele muda com deploys, não com o tráfego. Uma varredura com falha é registrada nos logs e incluída
no status — nunca lançada como erro fatal. Transformar uma verificação de segurança em uma nova forma de
derrubar o servidor seria uma má escolha em qualquer cenário.

## Como ler o relatório

**Ocorrências confirmadas vêm primeiro; as heurísticas ficam em uma seção separada de "vale a pena verificar".** Uma verificação heurística não tem como deduzir intenção — uma tabela de junção deixada
aberta deliberadamente não é um bug — portanto, essas são formuladas como perguntas e nunca misturadas com as
certezas.

**Fique atento à observação sobre privilégios.** Se a varredura se conectar como um superusuário, proprietário da tabela ou uma
role com `BYPASSRLS`, isso será informado. Essa role enxerga o catálogo real, que é o que torna a
auditoria possível, mas também significa que nada no relatório descreve o que *essa* conexão
específica vivencia. As ocorrências dizem respeito ao que as outras roles conseguem acessar.

### Em um banco de dados Rebase, altere a regra, não a policy

Cada policy em um ambiente Rebase é compilada a partir do `rls` de uma tabela, e o
runtime **as verifica a cada inicialização**: cada policy gerada carrega um carimbo (um
comentário `rebase:<hash>`) com o que foi compilado e o que o Postgres armazenou, e uma tabela cujas
policies deixam de corresponder a isso é reaplicada a partir da configuração. Um `ALTER POLICY` executado contra uma
delas sobrevive, portanto, exatamente até a próxima reinicialização, e a ocorrência volta junto com
ela — logo depois de você vê-la sumir.

O `rls-check` reconhece essas policies (com o nome `<table>_<operation>_<hash>`, ou chamadas a
`rebase.uid()` / `rebase.roles()` na expressão) e prescreve a regra em vez do SQL.
Quando você vir uma correção com essa instrução:

1. localize a tabela indicada, em `backend/schema/`;
2. altere seu `rls` — consulte [segurança em nível de linha](/docs/collections/security-rules);
3. se a tabela contiver `rls: "inherit"`, ela herda de `defaultRls` em
   `backend/schema/index.ts`, e esse é o arquivo que deve ser editado;
4. faça o redeploy — a inicialização reaplica as policies — ou execute `rebase db push`.

Uma policy escrita manualmente por você, em uma migration, não é afetada por nada disso, e sua correção
continua sendo a instrução SQL a ser executada.

## As verificações

As severidades abaixo são os padrões; várias verificações ajustam a própria severidade com base no que
encontram, e o relatório sempre detalha o motivo.

### rls-disabled

**Tabela exposta sem segurança em nível de linha.** Crítico.

A tabela está com o RLS desativado *e* concede privilégios de `SELECT`/`INSERT`/`UPDATE`/`DELETE` a uma role que um
chamador não confiável pode alcançar (`anon`, `PUBLIC`, `web_anon`, `rebase_user`). O Postgres não aplica
filtro algum por linha; portanto, as policies — caso existam — nunca são consultadas.

Uma tabela estrangeira (foreign table) com tal permissão também é reportada. O Postgres não pode ativar RLS em uma delas, logo o
grant entrega tudo o que o servidor remoto retornar, e a correção sugerida é revogar a
permissão em vez de tentar aplicar a policy.

Uma tabela com RLS desativado, mas sem nenhum grant para uma role exposta, *não* é reportada, e nem mesmo uma em
um schema no qual essa role não possua permissão de `USAGE` — o Postgres responde com "permission denied for schema" antes
mesmo de avaliar a tabela. Ela não é alcançável e apontá-la seria apenas ruído.

```sql
ALTER TABLE "public"."your_table" ENABLE ROW LEVEL SECURITY;
```

Ativar o RLS sem nenhuma policy nega todas as linhas a todos, exceto ao proprietário; portanto, adicione a policy
desejada na mesma migration — caso contrário, você trocará uma exposição por uma
indisponibilidade silenciosa. Consulte [rls-enabled-no-policies](#rls-enabled-no-policies).

### policy-always-true

**A policy concede acesso incondicional.** Crítico.

Uma policy permissiva cuja expressão de `USING` ou `WITH CHECK` é uma verdade constante: `true`,
`(true)`, `1 = 1`, `1 > 0`, `NOT false`, `true OR <anything>`, ou uma constante comparada com
ela mesma por meio de um cast. Policies permissivas são combinadas via operador OR; assim, uma única dessas condições satisfaz
o filtro de linhas da tabela, não importa quão restritas sejam as outras policies.

Como toda verificação, ela só relata uma exposição quando a role à qual ela se aplica consegue alcançar a tabela:
possuindo o privilégio exigido pelo comando e permissão de `USAGE` no schema. `USING (true) TO anon` em uma
tabela sobre a qual `anon` não possui permissões recebe "permission denied" antes que a policy seja consultada.
Essa policy é reportada como **info**, com o título *latente*: nada alcança a tabela por meio dela
hoje, mas um único `GRANT` a transformaria em uma exposição crítica sem nenhuma alteração na policy. A severidade "info" fica
abaixo de qualquer configuração de `--fail-on`, exceto `info`, portanto nunca faz uma execução padrão falhar.

Quando apenas o `WITH CHECK` de uma policy de `UPDATE` for constante — `USING (user_id = rebase.uid())
WITH CHECK (true)` — o nível é **high**: o `USING` ainda decide quais linhas podem ser manipuladas, mas o
check permite que a linha afetada se torne qualquer coisa, inclusive pertença a outro usuário. Em uma policy `FOR ALL`, esse
mesmo check também permite qualquer `INSERT`, permanecendo classificado como crítico.

Se policies do tipo `RESTRICTIVE` para o mesmo comando (`ALL` no caso de um `ALL` permissivo) se aplicarem a todas as
roles expostas que a policy permissiva alcança, isso é rebaixado para medium e reportado como
algo a ser verificado em vez de uma certeza, porque policies restritivas operam com AND após a
aplicação com OR das permissivas. Uma policy restritiva que filtre outras roles ou outro comando não
é considerada: ela mantém a permissiva aberta a todos os que ela não cobre.

```sql
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());
```

Em um banco de dados Rebase, a correção é feita na regra da tabela e não por meio desse comando SQL — veja
[altere a regra, não a policy](#em-um-banco-de-dados-rebase-altere-a-regra-não-a-policy). Um
scaffold padrão reporta essa verificação em `posts`, `authors` e `tags` propositalmente.

### policy-anonymous-tautology

**A policy apenas verifica se o ID do chamador existe.** A severidade depende da plataforma.

A expressão tem o formato de `rebase.uid() IS NOT NULL` (ou `auth.uid()` no Supabase e em bancos
Rebase provisionados antes da versão 1.0): ela separa chamadores autenticados de não autenticados, mas
não restringe nenhuma linha. Qualquer usuário autenticado tem acesso a todas as linhas cobertas pela policy.

A severidade depende da plataforma, e essa distinção é importante:

- **No Supabase**, `auth.uid()` retorna `NULL` para chamadores anônimos, logo essa é uma verificação funcional
  de que o usuário é autenticado. Reportado como **low** — uma falha de escopo de dados entre usuários
  autenticados, e não uma brecha de acesso anônimo. Isso se aplica apenas a `auth.uid()` (e à claim `sub` que ele
  lê): uma requisição sem autenticação ainda carrega a chave anônima do projeto, de modo que `auth.role()`
  é `'anon'` e `auth.jwt()` contém as claims dessa chave. Esse mesmo formato construído em torno de qualquer um deles
  será *verdadeiro para chamadores não autenticados*, sendo reportado como **crítico**.
- **No Rebase ou no PostgREST**, onde um ID de chamador em branco é forçado para o valor sentinela
  `'anonymous'`, a expressão torna-se *verdadeira para chamadores não autenticados também*. Reportado como **crítico**.
- **Em uma plataforma não reconhecida**, reportado como **medium**, já que a existência da brecha
  depende de a sua stack utilizar ou não tal valor sentinela.

Um banco de dados é considerado Rebase quando possui o schema `rebase`. A role `rebase_user`
não determina isso, porque as roles pertencem ao servidor como um todo, e um servidor que hospeda
uma aplicação Rebase pode conter outros bancos de dados.

```sql
-- Restrinja ao proprietário da linha em vez de apenas verificar a existência de um ID
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());

-- Ou, se o objetivo for realmente permitir "qualquer usuário autenticado", rejeite o valor sentinela explicitamente
--     USING (rebase.uid() IS NOT NULL AND rebase.uid() <> 'anonymous');
```

O SQL sugerido é exibido com a função de ID de chamador que o seu banco realmente possui:
`rebase.uid()` em um banco Rebase, `auth.uid()` no Supabase e PostgREST. Ambas as
sintaxes são reconhecidas durante a leitura das policies, portanto um banco Rebase no meio da migração
do schema `auth` anterior à versão 1.0 continuará sendo analisado corretamente.

### policy-authenticated-tautology

**A policy permite que qualquer chamador autenticado acerte todas as linhas.** Alto; crítico para a forma de teste de role descrita abaixo.

A forma corrigida da verificação acima — `rebase.uid() IS NOT NULL AND rebase.uid() <>
'anonymous'` — e onde a maioria das pessoas para. Ela de fato exclui chamadores não autenticados. O que ela
não faz é delimitar linhas: o que resta é *qualquer conta registrada pode ler todas as linhas
desta tabela*, o que tem um significado bem diferente do pretendido na maioria dos casos. Em um
projeto Rebase, essa é uma regra cuja `condition` é apenas `policy.authenticated()`,
armazenada no banco como `rebase.uid() <> ALL (ARRAY['anonymous', 'anon'])`.
Uma regra cuja condição seja
apenas `policy.registered()` também é reportada: o trecho extra `NOT rebase.is_anonymous()` impede
convidados mas também não restringe linhas, fazendo com que qualquer conta que não seja convidada leia
todas as linhas. Com a opção padrão `--fail-on high`, uma execução de CI que encontrar essa policy agora falhará.

Uma policy cuja expressão apenas
testa a role do chamador — `auth.role() = 'authenticated'`, `(auth.jwt() ->> 'role') =
'authenticated'`, em qualquer ordem — também é reportada sob este ID. Trata-se de `TO authenticated
USING (true)` escrito como uma expressão; portanto, recebe a severidade que
[`policy-always-true`](#policy-always-true) atribui: crítico, ou alto quando apenas o
`WITH CHECK` de uma policy de `UPDATE` for o teste de role.

Esse é o padrão que transforma uma tabela `users` em um diretório com todos os endereços da
plataforma, acessível a qualquer um que tenha se cadastrado — e, se o cadastro for aberto, "qualquer um que
se cadastrou" significa literalmente qualquer pessoa. Isso é reportado separadamente da variante anônima porque
a correção é diferente, a severidade também, e você pode ter motivos válidos para silenciar
uma e não a outra.

```sql
-- Restrinja à linha correspondente
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());

-- Ou, onde membros de um mesmo grupo realmente possam ver as linhas uns dos outros, declare qual grupo
--     USING (EXISTS (SELECT 1 FROM memberships m
--                    WHERE m.org_id = your_table.org_id AND m.user_id = rebase.uid()));
```

Se a tabela for genuinamente legível por qualquer conta — uma lista de preços pública, uma lista de
países — mantenha a policy e silencie a ocorrência com
`rls-check --skip policy-authenticated-tautology`.

### view-bypasses-rls

**A visualização (view) lê ignorando o RLS de sua tabela base.** Crítico.

Uma view com grant para uma role não confiável que faz select em uma tabela protegida por RLS sem a opção
`security_invoker = true`. A view executa com os privilégios do seu **proprietário**, lendo a
tabela base como proprietário e ignorando as policies do chamador. Essa é a maneira mais comum de
uma tabela cuidadosamente protegida vazar dados.

```sql
ALTER VIEW "public"."your_view" SET (security_invoker = true);
```

No PostgreSQL anterior à versão 15 essa opção sequer existe, de modo que toda view desse tipo opera
dessa forma. Nesses ambientes, a ocorrência é reportada como heurística, e a solução é mover a lógica para
uma função ou atualizar a versão do banco.

O proprietário normalmente é isento das policies da tabela base, mas nem sempre. Quando o proprietário
da view não é um superusuário, não possui `BYPASSRLS` e não é o proprietário da tabela base (ou é o dono,
mas ela possui `FORCE ROW LEVEL SECURITY`), as policies se aplicam ao proprietário. A view passa então a retornar as
linhas que essas policies concedem ao proprietário, igualmente para todos os chamadores. Isso pode representar menos linhas do que o
chamador deveria ver, ou mais. O achado ainda é reportado, pois as linhas não dependem de
quem pergunta, mas como heurístico em vez de certeza. A correção é a mesma.

### matview-bypasses-rls

**A view materializada expõe dados protegidos por RLS.** Alto.

Views materializadas não suportam segurança em nível de linha, e os dados contidos nelas são um snapshot
armazenado capturado por quem quer que as tenha atualizado (refresh). Se houver concessão de acesso a uma role não confiável e sua
query de definição ler uma tabela protegida por RLS, nenhuma policy resolverá — revogue o grant ou mova
a view materializada para um schema inacessível a roles não confiáveis. A correção sugerida revoga todos os
grants que alcançam uma role não confiável, a partir da role explicitada em cada concessão: um grant para uma role que
`anon` herda não é removido com `REVOKE … FROM anon`.

```sql
REVOKE ALL ON "public"."your_matview" FROM "anon";
```

### anonymous-write-allowed

**Chamadores não autenticados podem realizar escritas.** Alto.

Uma policy permissiva de `INSERT`/`UPDATE`/`DELETE`/`ALL` acessível sem autenticação cuja
expressão de validação aceita qualquer linha, respaldada por um grant compatível.

A condição "aceita qualquer linha" é essencial e deliberadamente restrita. O Supabase concede a `anon`
e `authenticated` permissão total de DML por padrão, logo uma policy direcionada a essas roles não é, por
si só, um problema — uma policy clássica como `FOR INSERT TO public WITH CHECK (user_id = auth.uid())` está correta
e não é reportada.

Uma policy atinge um chamador não autenticado por meio de `TO public`, por meio de uma role chamada
`anon` ou `web_anon`, ou por meio de uma role da qual uma dessas seja membro: `TO app_writer`
é considerada se `anon` herdar `app_writer`.

No Rebase não existe a role `anon`. Toda requisição roda como `rebase_user`, incluindo as
não autenticadas quando a API permite (`AUTH_REQUIRE=false` ou `auth.requireAuth: false`)
e todas as contas de convidados originadas de login anônimo. O banco de dados não tem visibilidade dessa configuração; assim, no
Rebase, uma escrita que apenas o `rebase_user` alcança é reportada como heurística. Com a proteção da API ativada
e o login de convidados desativado, apenas usuários autenticados alcançam a policy, mas eles ainda conseguirão escrever qualquer
linha. Delimite a regra de escrita da tabela ao chamador (um `ownerField`) ou a `roles`.

### unqualified-column-in-subquery

**Coluna não qualificada dentro de uma subquery de policy.** Alto, heurístico.

Um nome de coluna simples (bare column name) dentro de uma subquery `EXISTS`/`IN` que existe em *ambas* as tabelas: na relação
interna e na própria tabela da policy. O Postgres a vincula à tabela **interna**, de modo que a correlação com
a linha externa que você pretendia fazer desaparece silenciosamente e o predicado torna-se trivialmente
satisfeito — ou trivialmente não satisfeito, negando todas as linhas para todo mundo.

```sql
-- O bug: `id` vincula-se a memberships, não a organizations
USING (EXISTS (SELECT 1 FROM memberships WHERE id = organizations.id ...))

-- Qualifique-a
USING (EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = organizations.id ...))
```

**O que o catálogo exibe não é o que você escreveu.** O campo `pg_policies.qual` é a representação reconstruída
pelo Postgres da parse tree e, dentro de uma subquery, ele sempre qualifica as
referências de coluna; portanto, o nome isolado nunca fica visível no momento em que o catálogo é lido. O que
resta é o seu efeito: a coluna desqualificada `org_id` foi vinculada à tabela interna, e o predicado
armazenado compara a coluna daquela tabela consigo mesma —
`m.org_id = m.org_id`. Essa autocomparação é o que essa verificação busca em um banco de dados ativo.

**A ausência dessa ocorrência não garante segurança.** Um nome isolado comparado com uma
coluna interna *diferente* (`organization_id = id`) é armazenado como `m.organization_id = m.id`,
o que se parece exatamente com uma comparação intencional. Quando essa verificação dispara, é um forte
indício; quando não dispara, não há garantia absoluta comprovada.

### junction-table-unprotected

**Tabela de relacionamento muitos-para-muitos (junction table) sem RLS.** Alto, heurístico.

Uma tabela que consiste essencialmente nos dois lados de duas chaves estrangeiras (foreign keys), ambas apontando para
tabelas que *possuem* RLS, sem segurança em nível de linha própria — e legível ou editável
por uma role acessível a chamadores não confiáveis. Ambos os lados da relação
estão protegidos, mas o elo de ligação entre eles está aberto — o que basta para enumerar o relacionamento
mesmo sem conseguir ler nenhum dos lados finais.

Trata-se de uma análise heurística pois a tabela de junção é deduzida pelo seu formato. Se a sua for deliberadamente
pública, utilize `--skip junction-table-unprotected`.

### rls-enabled-not-forced

**RLS ativado, mas não forçado para o proprietário da tabela.** Médio, alto ou crítico.

Sem `FORCE`, o proprietário da tabela fica isento de suas próprias policies, assim como qualquer membro
da role proprietária. Isso é inofensivo quando o proprietário é uma role de infraestrutura que nunca
se conecta, mas torna-se sério se a sua aplicação se conecta como proprietária — logo, isso é **crítico** quando uma
role que um chamador não confiável pode assumir é dona da tabela ou membro da role proprietária,
**alto** quando a role proprietária puder fazer login (ou uma role com login for membro dela), e
**médio** nos demais casos.

Se o proprietário for um superusuário ou possuir `BYPASSRLS`, o status permanece médio e isso é explicado: `FORCE` não
pode restringir tais roles, e sugerir o contrário seria enganoso.

```sql
ALTER TABLE "public"."your_table" FORCE ROW LEVEL SECURITY;
```

### rls-enabled-no-policies

**RLS ativado sem policies definidas.** Médio.

Não é uma brecha de segurança — pelo contrário. RLS ativado com zero policies nega qualquer linha para qualquer um,
exceto o proprietário. Isso é reportado por se tratar de uma falha *invisível*: a API retorna `[]`, e
uma tabela vazia é indistinguível de uma tabela filtrada. Essa configuração já causou a entrega silenciosa
de tabelas vazias em produção por semanas a fio.

### policy-role-unreachable

**Policies direcionadas a roles que nunca realizam conexão.** Médio.

Todas as policies na tabela referenciam roles que não existem, não possuem permissão de login e que nenhuma role
com login herda transitivamente. As policies parecem corretas, mas não se aplicam a ninguém; logo, a tabela parece vazia.

O caso clássico são policies escritas como `TO authenticated` — nome de role do Supabase — em um banco de dados
cujas requisições chegam, na verdade, com outra role.

### grant-to-public

**Privilégios da tabela concedidos a PUBLIC.** Médio.

Um privilégio DML concedido a `PUBLIC`, em uma tabela comum ou estrangeira. Mesmo com o RLS ativado, isso
amplia para *quem* as policies serão avaliadas, e isso quase nunca é intencional.

```sql
REVOKE ALL ON "public"."your_table" FROM PUBLIC;
```

### security-definer-mutable-search-path

**Rotina SECURITY DEFINER com search_path mutável.** Médio.

A rotina é executada com os privilégios do seu proprietário — frequentemente um superusuário —, enquanto o chamador controla a forma como
os identificadores são resolvidos. Esse é o formato clássico de escalada de privilégios, e tudo o que a
rotina acessa é lido com os direitos do proprietário, contornando o RLS.

```sql
ALTER FUNCTION "public"."your_function"() SET search_path = pg_catalog, public;
```

### current-setting-throws

**A policy chama `current_setting()` sem `missing_ok`.** Baixo, heurístico.

`current_setting('app.tenant_id')` com um único argumento *dispara uma exceção* se a configuração não estiver definida,
em vez de retornar `NULL`. Dessa forma, em vez de simplesmente negar a linha, a requisição resulta em erro — o chamador
recebe um erro 500 em vez de um resultado vazio, e middlewares que realizam retentativas para erros 5xx tentarão reenviar
uma requisição fadada ao fracasso.

```sql
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

## O que esta ferramenta não faz

Deixar os limites claros é fundamental — uma ferramenta de segurança que promete mais cobertura do que realmente tem é
pior do que não ter ferramenta alguma.

- **É uma auditoria estática de catálogo.** Ela lê `pg_class`, `pg_policies`, `pg_depend` e
  estruturas similares. Ela não se conecta com a sua role `anon` para tentar ler os seus dados; portanto, ela não pode
  confirmar empiricamente que uma exposição é acessível via API.
- **Ela não prova que uma policy está correta.** Ela apenas detecta padrões que comprovadamente estão errados. Uma
  policy aprovada em todas as verificações deste utilitário ainda pode conter uma regra de negócio inadequada.
- **Um relatório sem ocorrências não é um certificado de segurança.** Em especial, veja a nota sobre
  [unqualified-column-in-subquery](#unqualified-column-in-subquery): o Postgres reescreve expressões
  de policies, portanto certos bugs simplesmente não ficam visíveis no catálogo.
- **Ela não analisa autorização no nível da aplicação**, chaves de API, exposição de rede,
  gestão de segredos ou qualquer item externo ao banco de dados.

## Conteúdo relacionado

- [Segurança em nível de linha](/docs/collections/security-rules) — o `rls` de uma tabela Rebase, que
  é compilado nas policies auditadas por esta ferramenta.
- [Backend only](/docs/getting-started/headless/) — por que uma tabela sem policy não é
  exposta de forma alguma em um projeto headless.
- [REST API](/docs/backend/api/) — a superfície de ataque que uma policy permissiva expõe.
