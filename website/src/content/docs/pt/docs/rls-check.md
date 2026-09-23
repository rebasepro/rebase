---
sourceHash: 3165c5299e4bc1f3
slug: pt/docs/rls-check
title: rls-check
description: Audite a segurança em nível de linha (RLS) em qualquer banco de dados PostgreSQL — Supabase, Neon, RDS ou seu próprio servidor. Somente leitura, sem cadastro, sem necessidade de Rebase.
---

# rls-check

O `rls-check` lê o catálogo de um banco de dados PostgreSQL e relata o que está realmente exposto:
tabelas disponibilizadas com segurança em nível de linha (row-level security) desativada, políticas avaliadas como verdadeiras
para todos, views que ignoram o RLS de suas tabelas base e tabelas de junção
esquecidas enquanto ambas as suas pontas foram protegidas.

Funciona em **qualquer** Postgres — Supabase, Neon, RDS, Cloud SQL ou em um servidor gerenciado por
você. Não requer o Rebase e é útil independentemente de você adotá-lo ou não.

```bash
npx @rebasepro/rls-check
```

Execute-o no diretório do seu projeto e ele encontrará o banco de dados sozinho: `DATABASE_URL`,
depois `POSTGRES_URL`, e depois um `.env` no diretório atual. Passe a string de conexão como
argumento apenas quando não puder fazer isso — o npm exibe a linha de comando antes do
programa iniciar e o seu shell a registra, portanto uma senha passada em um argumento vai parar em
dois lugares que o `rls-check` não consegue ocultar. O `$DATABASE_URL` não é mais seguro nesse caso: o shell
o expande antes mesmo do npm vê-lo.

Ele é somente leitura por concepção: abre uma transação somente leitura e executa consultas ao
catálogo. Não escreve nada e não envia nada para lugar algum — não há telemetria nem
chamadas de rede além daquela direcionada ao seu banco de dados.

## Como executar

```bash
# From the environment — DATABASE_URL, then POSTGRES_URL, then a .env in the cwd
npx @rebasepro/rls-check

# For a database that is not the one in your environment
DATABASE_URL="postgres://user:pass@host:5432/dbname" npx @rebasepro/rls-check

# As an argument. Works, but see the warning above about where the password lands
npx @rebasepro/rls-check "postgres://user:pass@host:5432/dbname"
```

Se a sua senha contiver `/`, `?` ou `#`, aplique percent-encoding. Esses três caracteres encerram a
seção de autoridade da URL, fazendo com que a divisão ocorra dentro da credencial — em vez de exibir fragmentos de
uma senha, o `rls-check` rejeita a string e informa o motivo.

`@` e `:` não precisam de codificação: as informações do usuário são divididas no **último** `@` e o usuário no
**primeiro** `:`, que é o que o `pg` também faz; portanto, `postgres://user:pa@ss@host:5432/db` conecta-se
a `host` com a senha `pa@ss`. Codificá-los mesmo assim nunca é um erro.

### Opções

| Opção | Significado |
| --- | --- |
| `--json` | Saída legível por máquina no stdout, e nada mais no stdout |
| `--html <path>` | Também grava um relatório HTML independente nesse caminho. Um único arquivo, sem requisições de rede |
| `--schema <name>` | Restringe a verificação a um schema. Repetível ou separado por vírgulas |
| `--role <name>` | Trata esta role como uma com a qual um chamador não confiável chega, além de `anon`, `authenticated`, `web_anon` e `rebase_user`. Repetível ou separado por vírgulas |
| `--fail-on <severity>` | Encerra com código 1 nesta severidade ou acima. Padrão `high`; `none` nunca falha |
| `--only <id>` | Executa apenas estas verificações. Repetível ou separado por vírgulas |
| `--skip <id>` | Pula estas verificações. Repetível ou separado por vírgulas |
| `--list-checks` | Imprime o catálogo e sai |
| `--timeout <ms>` | Timeout do comando (statement timeout), padrão 15000 |
| `--quiet` | Apenas os achados — sem banner, sem resumo |
| `--no-color` | Desativa cores ANSI (também respeita `NO_COLOR` e saídas stdout não-TTY) |

Um id desconhecido passado para `--only` ou `--skip` gera um erro em vez de ser ignorado
silenciosamente, pois um erro de digitação enfraqueceria silenciosamente a varredura. Uma `--role`
que não esteja em `pg_roles` é um erro pelo mesmo motivo: cada verificação depende de uma concessão
(grant) a uma role exposta, portanto um nome que não corresponda a nada removeria a cobertura sem
aviso. O mesmo vale para um `--schema` que não nomeia nenhum schema, que de outra forma não varreria
nada e relataria isso como limpo. Nomes de schema diferenciam maiúsculas de minúsculas: `Public` não
é `public`.

O cabeçalho do relatório lista as roles que a execução tratou como expostas, para que você possa ver rapidamente
se `No findings` cobriu a role com a qual sua aplicação se conecta:

```
Exposed   PUBLIC, anon, authenticated (add yours with --role)
```

Quando a varredura se conecta como uma role que a segurança em nível de linha *pode* restringir — não um superusuário, não
um proprietário (owner), sem `BYPASSRLS` — essa role é adicionada ao conjunto e o relatório informa isso. Varrer utilizando
a própria role da sua aplicação é o mais próximo de perguntar ao banco de dados o que a sua API realmente vê.

### Códigos de saída

| Código | Significado |
| --- | --- |
| `0` | Nenhum achado no nível de limite `--fail-on` ou acima |
| `1` | Pelo menos um achado no nível de limite ou acima |
| `2` | A varredura não pôde ser executada — argumentos inválidos, conexão recusada, falha de autenticação, timeout |

`1` e `2` são deliberadamente distintos: uma conexão com falha nunca deve parecer com um banco de dados
limpo.

### No CI

```yaml
- name: Audit RLS
  run: npx @rebasepro/rls-check --fail-on high
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

**Um novo projeto Rebase não passa nessa verificação no primeiro dia, e não é para passar.** As
`defaultSecurityRules` do scaffold liberam a leitura para todos — `{ operation: "select", access:
"public" }` em `config/collections/index.ts` — logo, `posts`, `authors` e `tags` relatam, cada um, um
alerta crítico de `policy-always-true`. `access: "public"` diz respeito a *linhas*, não a quem pode chamar a
API: uma requisição sem token ainda receberá 401 enquanto `AUTH_REQUIRE` estiver ativo. O achado está
correto mesmo assim, porque essa regra é a única barreira à frente dos dados.

Decida qual das duas situações se aplica antes de integrar isso ao CI:

- **as regras são apenas provisórias (placeholder)** — substitua-as pelas que seus dados realmente precisam
  ([regras de segurança](/docs/collections/security-rules)), e os achados desaparecerão;
- **as linhas realmente devem ser visíveis para todos** — defina isso explicitamente com
  `npx @rebasepro/rls-check --fail-on high --skip policy-always-true`, e esteja ciente do que você abriu
  mão: `--skip` desativa a verificação em todos os lugares, incluindo na tabela que você adicionar no próximo mês.

### Saída em JSON

`--json` emite um objeto estável: `scannedAt`, `database` (apenas host e nome — nunca
credenciais), `serverVersion`, `platform`, `scannerIsPrivileged`, `exposedRoles`, `stats`,
`findings` e `diagnostics`. Cada achado contém `id`, `severity`, `title`, `target`,
`detail`, `impact`, `fix`, `docs` e `confidence`.

`exposedRoles` e `diagnostics` fazem parte do contrato, não são extras: cada verificação é restrita pelo
conjunto de roles expostas, e `diagnostics.degraded` é como um consumidor diferencia "não havia nada de errado" de
"a varredura não conseguiu verificar". Ler `findings: []` sem ambos é ver apenas metade da resposta.

## Executando em agendamento

Uma verificação da qual você precisa se lembrar de rodar é uma verificação que relata um banco de dados
limpo exatamente até o dia em que um problema acontece. O backend pode executar isso para você e
disponibilizar o resultado no painel de administração:

```ts
import { scan } from "@rebasepro/rls-check";
import type { RebaseBackendConfig } from "@rebasepro/server";

const rlsAudit: RebaseBackendConfig["rlsAudit"] = {
    enabled: true,
    scan,
    intervalMs: 24 * 60 * 60 * 1000,  // the default
    warnAtSeverity: "high"            // the default
};
```

Passe isso como `rlsAudit` no objeto fornecido para `initializeRebaseBackend`.

O resultado é disponibilizado em `GET /api/admin/rls-audit`, protegido por acesso de administrador como qualquer outra
área administrativa, e cada execução registra uma linha no log — com nível `warn` quando um achado atinge
`warnAtSeverity`, e `info` caso contrário:

```
⚠️  [rls-audit] RLS audit found 3 issue(s) — 1 critical, 2 medium. 1 table(s)
    without RLS. Read the detail at GET /api/admin/rls-audit.
```

### Por que você passa o `scan`

O `@rebasepro/server` não possui driver de banco de dados — é isso que o mantém compatível tanto com
Postgres quanto com Mongo e Firebase. O `@rebasepro/rls-check` traz o `pg`, porque
se conecta ao Postgres. Importá-lo dentro do pacote do servidor colocaria um driver
Postgres em todas as instalações, para um recurso que apenas algumas usam; por isso,
você passa a função manualmente.

### Em um deploy distribuído

A auditoria é um singleton *com proprietário* (owned singleton), como o agendador de cron. Todo processo que
o possui executa sua própria varredura, que é somente leitura e inofensiva, mas redundante — atribua-a
a apenas um processo:

```ts
ownership: { rlsAudit: false }   // on every process but one
```

ou, para um ambiente configurado por variáveis de ambiente:

```bash
REBASE_RLS_AUDIT=false
```

A role `functions` já o possui como `false` — esse processo não executa nenhum temporizador.
Definir uma substituição de propriedade nunca altera outra: desativar o cron não afeta
a auditoria, e vice-versa.

Um processo que serve a interface administrativa sem possuir a varredura responderá ao
endpoint de forma transparente, informando que a varredura não é executada ali.

### É uma rede de segurança, não um monitor

O intervalo padrão é de um dia, pois o que está sendo observado é um schema:
ele muda nos deploys, não no tráfego. Uma varredura com falha é registrada nos logs e gravada
no status — nunca lançada como exceção. Transformar uma verificação de segurança em uma nova forma
de derrubar o servidor seria uma péssima ideia em qualquer cenário.

## Como ler o relatório

**Achados confirmados vêm primeiro; os heurísticos ficam em uma seção separada "vale a pena verificar"
(worth checking).** Uma verificação heurística não consegue deduzir intenção — uma tabela de junção que você deixou
aberta deliberadamente não é um bug — portanto, esses itens são formulados como perguntas e nunca misturados com as
certezas.

**Atenção à nota sobre privilégios.** Se a varredura se conectar como superusuário, proprietário da tabela ou uma
role com `BYPASSRLS`, isso será informado. Essa role enxerga o catálogo real, que é o que torna a
auditoria possível, mas também significa que nada no relatório descreve o que *essa* conexão
específica experiencia. Os achados dizem respeito ao que as outras roles recebem.

### Em um banco de dados Rebase, altere a regra, não a policy

Toda policy em uma implantação do Rebase é compilada a partir das `securityRules` de uma collection, e o
runtime **as reaplica a cada inicialização**: ele descarta cada policy gerada e a recria
com base na configuração. Portanto, um `ALTER POLICY` executado diretamente contra uma delas sobrevive exatamente
até a próxima reinicialização, e o achado retornará com ela — logo após você tê-lo visto sumir.

O `rls-check` reconhece essas policies (com o nome no padrão `<table>_<operation>_<hash>` ou uma chamada para
`rebase.uid()` / `rebase.roles()` na expressão) e recomenda a alteração na regra em vez de SQL.
Quando você vir uma correção sugerindo isso:

1. localize a collection da tabela indicada, em `config/collections/`;
2. altere suas `securityRules` — consulte [regras de segurança](/docs/collections/security-rules);
3. se a collection não declarar regras próprias, ela herdará as `defaultSecurityRules` de
   `config/collections/index.ts`, e esse será o arquivo a ser editado;
4. faça o deploy novamente — a inicialização reaplica as policies — ou execute `rebase db push`.

Uma policy criada manualmente em uma migration não é afetada por isso, e sua correção
continuará sendo o comando SQL a ser executado.

## As verificações

As severidades abaixo são os padrões; várias verificações ajustam sua própria severidade com base no que
encontram, e o relatório sempre indica o motivo.

### rls-disabled

**Tabela exposta sem segurança em nível de linha.** Crítico.

A tabela está com o RLS desativado *e* concede `SELECT`/`INSERT`/`UPDATE`/`DELETE` a uma role que um
chamador não confiável pode alcançar (`anon`, `PUBLIC`, `web_anon`, `rebase_user`). O Postgres não aplica
filtro por linha algum, portanto as policies — se houver alguma — nunca são consultadas.

Uma foreign table com uma concessão assim também é relatada. O Postgres não consegue ativar o RLS
nela, então a concessão entrega tudo o que o servidor remoto retornar, e a correção sugerida revoga
a concessão em vez disso.

Uma tabela com o RLS desativado, mas sem concessões a uma role exposta, *não* é relatada. Ela não está acessível
e sinalizá-la seria apenas ruído.

```sql
ALTER TABLE "public"."your_table" ENABLE ROW LEVEL SECURITY;
```

Habilitar o RLS sem nenhuma policy nega o acesso a todas as linhas para todos, exceto para o proprietário, portanto adicione a policy
desejada na mesma migration — caso contrário, você terá trocado uma exposição por uma indisponibilidade
silenciosa. Consulte [rls-enabled-no-policies](#rls-enabled-no-policies).

### policy-always-true

**Policy concede acesso incondicional.** Crítico.

Uma policy permissiva cuja expressão `USING` ou `WITH CHECK` é uma verdade constante — `true`,
`(true)`, `1 = 1`. As policies permissivas são combinadas com o operador OR, portanto basta uma delas para satisfazer
o filtro de linhas da tabela, não importa quão restritivas sejam todas as outras policies.

Se policies `RESTRICTIVE` no mesmo comando (`ALL` para um `ALL` permissivo) se aplicarem a cada role
exposta que a policy permissiva alcança, a severidade é reduzida para média e relatada como algo a
verificar em vez de uma certeza, porque as policies restritivas aplicam AND após as permissivas
aplicarem OR. Uma policy restritiva que protege outras roles ou outro comando não conta: ela deixa a
permissiva aberta para todos que não cobre.

```sql
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());
```

Em um banco de dados Rebase, a correção é a regra da collection em vez desse comando — consulte
[altere a regra, não a policy](#em-um-banco-de-dados-rebase-altere-a-regra-não-a-policy). O
scaffold padrão relata essa verificação em `posts`, `authors` e `tags` por definição.

### policy-anonymous-tautology

**Policy apenas verifica se o ID do chamador existe.** A severidade depende da plataforma.

A expressão tem o formato de `rebase.uid() IS NOT NULL` (ou `auth.uid()` no Supabase e em bancos de dados
Rebase provisionados antes da versão 1.0): ela separa chamadores autenticados de não autenticados, mas
não delimita o escopo de nenhuma linha. Todo usuário autenticado acessa todas as linhas que a policy cobre.

A severidade depende da plataforma, e essa distinção é importante:

- **No Supabase**, `auth.uid()` retorna `NULL` para chamadores anônimos, portanto essa é uma verificação funcional de
  apenas autenticados. É relatada como **baixa** (low) — uma lacuna de delimitação de dados entre usuários
  autenticados, e não uma brecha de acesso anônimo.
- **No Rebase ou PostgREST**, onde um ID de chamador vazio é convertido para a sentinela `'anonymous'`,
  a expressão é *verdadeira também para chamadores não autenticados*. Relatada como **crítica** (critical).
- **Em uma plataforma não reconhecida**, relatada como **média** (medium), pois o fato de ser ou não uma brecha
  depende de sua stack utilizar tal sentinela.

```sql
-- Scope to the row's owner rather than to the existence of an id
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());

-- Or, if "any signed-in user" really is the intent, reject the sentinel explicitly
--     USING (rebase.uid() IS NOT NULL AND rebase.uid() <> 'anonymous');
```

O SQL sugerido é exibido com a função de ID do chamador que seu banco de dados realmente possui:
`rebase.uid()` em um banco Rebase, `auth.uid()` no Supabase e PostgREST. Ambas as grafias
são reconhecidas na leitura das policies, portanto um banco de dados Rebase em processo de migração do
schema `auth` pré-1.0 ainda é verificado.

### policy-authenticated-tautology

**Policy permite que qualquer chamador autenticado acesse todas as linhas.** Alta.

A forma corrigida da verificação acima — `rebase.uid() IS NOT NULL AND rebase.uid() <>
'anonymous'` — e onde as pessoas costumam parar. Ela realmente exclui chamadores não autenticados. O que ela não
faz é delimitar o escopo das linhas: o que resta é que *qualquer conta registrada pode ler todas as linhas
desta tabela*, o que é uma afirmação bem diferente daquela pretendida originalmente.

Esse é o padrão que transforma uma tabela de `users` em um diretório de todos os endereços da
plataforma, legível por qualquer um que se cadastrar — e onde o cadastro é aberto, "qualquer um
cadastrado" significa qualquer pessoa. Esse caso é relatado separadamente do formato anônimo porque a
correção é diferente, a severidade também, e você pode querer legitimamente silenciar
um e não o outro.

```sql
-- Scope to the row
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());

-- Or, where members of a shared group really may see each other's rows, say which group
--     USING (EXISTS (SELECT 1 FROM memberships m
--                    WHERE m.org_id = your_table.org_id AND m.user_id = rebase.uid()));
```

Se a tabela realmente deve ser legível por todas as contas — uma tabela de preços compartilhada, uma lista de
países — mantenha a policy e silencie o achado com
`rls-check --skip policy-authenticated-tautology`.

### view-bypasses-rls

**View ignora o RLS da sua tabela base.** Crítico.

Uma view concedida a uma role não confiável que faz consultas em uma tabela protegida por RLS sem
`security_invoker = true`. A view é executada com os privilégios do seu **proprietário** (owner), portanto ela lê a
tabela base como o proprietário e as policies do chamador nunca são aplicadas. Essa é a forma mais comum
pela qual uma tabela cuidadosamente protegida vaza dados.

```sql
ALTER VIEW "public"."your_view" SET (security_invoker = true);
```

No PostgreSQL anterior à versão 15, essa opção nem sequer existe, logo todas as views desse tipo se comportam
dessa forma. Nesses casos, o achado é relatado como heurístico, e a solução é mover a lógica para uma
função ou atualizar o PostgreSQL.

### matview-bypasses-rls

**Materialized view expõe dados protegidos por RLS.** Alta.

Materialized views não podem ter segurança em nível de linha, e os dados nelas são um snapshot
armazenado tirado por quem quer que o tenha atualizado (refresh). Se uma delas for concedida a uma role não confiável e sua
consulta de definição ler uma tabela protegida por RLS, nenhuma policy poderá ajudar — revogue a concessão (grant) ou mova
a matview para um schema que roles não confiáveis não consigam acessar.

```sql
REVOKE ALL ON "public"."your_matview" FROM "anon";
```

### anonymous-write-allowed

**Chamadores não autenticados podem gravar.** Alta.

Uma policy permissiva de `INSERT`/`UPDATE`/`DELETE`/`ALL` acessível sem autenticação cuja
expressão de checagem aceita qualquer linha, respaldada por uma concessão (grant) correspondente.

A condição "aceita qualquer linha" é essencial e deliberadamente restrita. O Supabase concede DML completo
para `anon` e `authenticated` por padrão, portanto uma policy direcionada a essas roles não é, por si só,
um problema — um clássico `FOR INSERT TO public WITH CHECK (user_id = auth.uid())` está correto
e não é relatado.

### unqualified-column-in-subquery

**Coluna não qualificada dentro de subquery de policy.** Alta, heurística.

Um nome de coluna não qualificado dentro de uma subquery `EXISTS`/`IN` que existe em *ambas* as relações (na
interna e na própria tabela da policy). O Postgres a associa à tabela **interna**, de forma que a correlação com
a linha externa que você pretendia escrever desaparece silenciosamente e o predicado torna-se trivialmente
satisfatível — ou trivialmente insatisfatível, negando todas as linhas a todos.

```sql
-- The bug: `id` binds to memberships, not organizations
USING (EXISTS (SELECT 1 FROM memberships WHERE id = organizations.id ...))

-- Qualify it
USING (EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = organizations.id ...))
```

**A ausência desse achado não é garantia de segurança.** `pg_policies.qual` é a própria
renderização feita pelo Postgres da árvore sintática (parse tree), e ele geralmente requalifica as referências de coluna — portanto, o
nome original sem qualificação frequentemente já não fica visível quando o catálogo é lido. Quando
essa verificação dispara, é um indício forte; quando não dispara, nada foi comprovado.

### junction-table-unprotected

**Tabela de junção muitos-para-muitos sem RLS.** Alta, heurística.

Uma tabela que consiste basicamente nos dois pontos finais de duas chaves estrangeiras, ambas apontando para
tabelas que *possuem* RLS, mas sem segurança em nível de linha própria. Ambos os lados da relação
estão protegidos e a ligação entre eles está aberta — o que é suficiente para enumerar a relação
mesmo quando nenhum dos lados puder ser lido.

Heurística porque uma tabela de junção é inferida com base na sua estrutura. Se a sua for deliberadamente
pública, utilize `--skip junction-table-unprotected`.

### rls-enabled-not-forced

**RLS ativado, mas não forçado para o proprietário da tabela.** Média, alta ou crítica.

Sem `FORCE`, o proprietário da tabela está isento de suas próprias policies, assim como todo membro
da role proprietária. Isso é inofensivo quando o proprietário é uma role de provisionamento que nada
utiliza para se conectar, e sério quando sua aplicação se conecta como o proprietário — por isso, é
classificado como **crítica** quando uma role com a qual chega um chamador não confiável é dona da
tabela ou é membro da role proprietária, **alta** quando a role proprietária pode fazer login ou uma
role que pode é membro dela, e **média** caso contrário.

Se o proprietário for um superusuário ou tiver `BYPASSRLS`, permanece como média e informa isso: o `FORCE` não consegue
restringir tal role, e sugerir o contrário seria enganoso.

```sql
ALTER TABLE "public"."your_table" FORCE ROW LEVEL SECURITY;
```

### rls-enabled-no-policies

**RLS ativado sem policies.** Média.

Não se trata de uma falha de segurança — é o oposto. O RLS ativado com zero policies nega todas as linhas a todos,
exceto ao proprietário. É relatado por ser uma falha *invisível*: a API retorna `[]`, e
uma tabela vazia é indistinguível de uma tabela filtrada. Essa configuração já chegou a disponibilizar
collections vazias silenciosamente em produção durante semanas a fio.

### policy-role-unreachable

**Policies direcionadas a roles que ninguém utiliza para conectar.** Média.

Todas as policies da tabela referenciam roles que não existem, não podem fazer login e que nenhuma
role de login herda transitivamente. As policies parecem corretas e não se aplicam a ninguém, logo a tabela sempre
é lida como vazia.

O caso clássico são policies escritas como `TO authenticated` — o nome de uma role do Supabase — em um banco de dados
cujas requisições chegam, na verdade, com outra role.

### grant-to-public

**Privilégios da tabela concedidos a PUBLIC.** Média.

Um privilégio de DML concedido a `PUBLIC`, em uma tabela ou foreign table. Mesmo com o RLS ativado,
isso amplia *para quem* as policies são avaliadas, e isso quase nunca é intencional.

```sql
REVOKE ALL ON "public"."your_table" FROM PUBLIC;
```

### security-definer-mutable-search-path

**Rotina SECURITY DEFINER com search_path mutável.** Média.

A rotina é executada como seu proprietário — frequentemente um superusuário — enquanto o chamador controla como seus
identificadores são resolvidos. Esse é o padrão clássico de escalonamento de privilégios, e tudo o que a
rotina acessa é lido com os privilégios do proprietário, ignorando o RLS.

```sql
ALTER FUNCTION "public"."your_function"() SET search_path = pg_catalog, public;
```

### current-setting-throws

**Policy chama `current_setting()` sem `missing_ok`.** Baixa, heurística.

`current_setting('app.tenant_id')` com um único argumento *lança um erro* quando a configuração não está definida,
em vez de retornar `NULL`. Assim, em vez de negar a linha, a requisição falha — o chamador
recebe um erro 500 em vez de um resultado vazio, e middlewares que realizam novas tentativas em erros 5xx tentarão reenviar
uma requisição que nunca terá sucesso.

```sql
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

## O que esta ferramenta não faz

Ter clareza sobre os limites é fundamental — uma ferramenta de segurança que superestima sua cobertura é
pior do que não ter nenhuma.

- **É uma auditoria estática de catálogo.** Ela lê `pg_class`, `pg_policies`, `pg_depend` e
  similares. Ela não se conecta como sua role `anon` para tentar ler seus dados, portanto não pode
  confirmar se uma exposição está acessível por meio da sua API.
- **Ela não pode comprovar que uma policy está correta.** Ela identifica padrões que se sabe estarem incorretos. Uma
  policy que passa em todas as verificações aqui ainda pode expressar uma regra de negócio errada.
- **Um relatório sem achados não é uma certificação de segurança.** Em especial, veja a nota sobre
  [unqualified-column-in-subquery](#unqualified-column-in-subquery): o Postgres reescreve
  expressões de policy, portanto alguns bugs simplesmente não ficam mais visíveis no catálogo.
- **Ela não verifica autorização no nível da aplicação**, chaves de API, exposição de rede,
  manipulação de segredos ou qualquer coisa fora do banco de dados.

## Relacionados

- [Regras de segurança (RLS)](/docs/collections/security-rules) — definindo segurança em nível de linha em
  collections do Rebase, compiladas para as policies auditadas por esta ferramenta.
- [Apenas backend](/docs/getting-started/headless/) — por que uma tabela sem policies não é
  disponibilizada em um projeto headless.
- [API REST](/docs/backend/api/) — a superfície que uma policy permissiva expõe.
