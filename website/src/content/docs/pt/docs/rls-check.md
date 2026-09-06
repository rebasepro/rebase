---
sourceHash: 3e7cee199ce0ba69
slug: pt/docs/rls-check
title: rls-check
description: Audite a segurança em nível de linha (RLS) em qualquer banco de dados PostgreSQL — Supabase, Neon, RDS ou seu próprio servidor. Somente leitura, sem cadastro, sem necessidade do Rebase.
---

# rls-check

O `rls-check` lê o catálogo de um banco de dados PostgreSQL e relata o que realmente está exposto:
tabelas disponibilizadas com segurança em nível de linha desativada, políticas que avaliam como verdadeiras para
todos, views que leem ignorando o RLS em suas tabelas base, e tabelas de junção (join tables)
que foram esquecidas enquanto ambas as suas extremidades foram bloqueadas.

Ele funciona em **qualquer** Postgres — Supabase, Neon, RDS, Cloud SQL ou em um servidor que você mesmo
execute. Ele não requer o Rebase e é útil independentemente de você adotá-lo ou não.

```bash
npx @rebasepro/rls-check
```

Execute-o no diretório do seu projeto e ele encontra o banco de dados sozinho: `DATABASE_URL`, depois
`POSTGRES_URL`, depois um `.env` ao lado. Passe a string de conexão como argumento apenas quando não
for possível — o npm imprime a linha de comando antes de o programa iniciar, e o seu shell a registra,
então uma senha em um argumento acaba em dois lugares que o `rls-check` não consegue ocultar.
`$DATABASE_URL` não é mais seguro ali: o shell o expande antes mesmo de o npm o ver.

Ele é somente leitura por definição: abre uma transação somente leitura e executa consultas de
catálogo. Não escreve nada e não envia nada para lugar nenhum — não há telemetria e nenhuma
chamada de rede além daquela para o seu banco de dados.

## Executando

```bash
# From the environment — DATABASE_URL, then POSTGRES_URL, then a .env in the cwd
npx @rebasepro/rls-check

# For a database that is not the one in your environment
DATABASE_URL="postgres://user:pass@host:5432/dbname" npx @rebasepro/rls-check

# As an argument. Works, but see the warning above about where the password lands
npx @rebasepro/rls-check "postgres://user:pass@host:5432/dbname"
```

Se sua senha contiver `@`, `:`, `/`, `?` ou `#`, codifique-a em percent-encode. Essa é, de longe, a
causa mais comum de falhas de autenticação aqui, e o `rls-check` informará isso em vez de
deixar você adivinhar.

### Opções

| Opção | Significado |
| --- | --- |
| `--json` | Saída legível por máquina no stdout, e nada mais no stdout |
| `--html <caminho>` | Também escreve um relatório HTML autocontido nesse caminho. Um arquivo, sem requisições de rede |
| `--schema <name>` | Restringe a verificação a um schema. Repetível ou separado por vírgulas |
| `--role <name>` | Trata esta role como uma pela qual um chamador não confiável chega, além de `anon`, `authenticated`, `web_anon` e `rebase_user`. Repetível ou separado por vírgulas |
| `--fail-on <severity>` | Encerra com código 1 nesta severidade ou acima dela. Padrão `high`; `none` nunca falha |
| `--only <id>` | Executa apenas estas verificações. Repetível ou separado por vírgulas |
| `--skip <id>` | Ignora estas verificações. Repetível ou separado por vírgulas |
| `--list-checks` | Imprime o catálogo e encerra |
| `--timeout <ms>` | Timeout da instrução em milissegundos, padrão 15000 |
| `--quiet` | Apenas achados (findings) — sem banner, sem resumo |
| `--no-color` | Desativa cores ANSI (também respeita `NO_COLOR` e stdout sem TTY) |

Um ID desconhecido passado para `--only` ou `--skip` é um erro em vez de uma operação nula silenciosa, pois
um erro de digitação ali enfraquece silenciosamente a verificação. Uma `--role` que não está em `pg_roles` é
um erro pelo mesmo motivo: toda verificação depende de um privilégio concedido a uma role exposta, portanto um
nome que não corresponde a nada remove cobertura sem avisar.

O cabeçalho do relatório nomeia as roles que a execução tratou como expostas, para que você veja de relance se
`No findings` cobriu a role com a qual sua aplicação se conecta:

```
Exposed   PUBLIC, anon, authenticated (add yours with --role)
```

Quando a verificação se conecta com uma role que a row-level security *consegue* restringir — nem superusuário,
nem proprietário, sem `BYPASSRLS` — essa role é adicionada ao conjunto e o relatório diz isso. Verificar com a
role da sua própria aplicação é o mais próximo de perguntar ao banco de dados o que a sua API enxerga.

### Códigos de saída

| Código | Significado |
| --- | --- |
| `0` | Nenhum achado igual ou superior ao limite `--fail-on` |
| `1` | Pelo menos um achado igual ou superior ao limite |
| `2` | A verificação não pôde ser executada — argumentos inválidos, conexão recusada, falha de autenticação, timeout |

`1` e `2` são deliberadamente distintos: uma conexão quebrada nunca deve parecer um banco de
dados limpo.

### No CI

```yaml
- name: Audit RLS
  run: npx @rebasepro/rls-check --fail-on high
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

### Saída JSON

`--json` emite um objeto estável: `scannedAt`, `database` (apenas host e nome — nunca
credenciais), `serverVersion`, `platform`, `scannerIsPrivileged`, `exposedRoles`, `stats`,
`findings` e `diagnostics`. Cada achado contém `id`, `severity`, `title`, `target`, `detail`,
`impact`, `fix`, `docs` e `confidence`.

`exposedRoles` e `diagnostics` fazem parte do contrato, não são extras: toda verificação depende
do conjunto de roles expostas, e `diagnostics.degraded` é o que permite distinguir "nada estava
errado" de "a verificação não conseguiu olhar".

## Como ler o relatório

**Achados confirmados vêm primeiro; os heurísticos estão em uma seção separada "worth checking"
(vale a pena verificar).** Uma verificação heurística não consegue ver a intenção — uma tabela de
junção que você deixou aberta de propósito não é um bug — portanto, elas são formuladas como
perguntas e nunca misturadas com as certezas.

**Atenção à nota de privilégio.** Se a verificação se conectar como superusuário, proprietário da tabela
ou uma função (role) com `BYPASSRLS`, ela avisará. Essa função vê o catálogo real, o que torna a
auditoria possível, mas também significa que nada no relatório descreve o que *essa* conexão
vivencia. Os achados são sobre o que as outras funções recebem.

## As verificações

As severidades abaixo são os padrões; várias verificações ajustam sua própria severidade com base no que
encontram, e o relatório sempre informa o motivo.

### rls-disabled

**Tabela exposta sem segurança em nível de linha.** Crítica.

A tabela tem o RLS desativado *e* concede `SELECT`/`INSERT`/`UPDATE`/`DELETE` a uma função que um
chamador não confiável pode alcançar (`anon`, `PUBLIC`, `web_anon`, `rebase_user`). O Postgres não
aplica nenhum filtro por linha, portanto as políticas — se existirem — nunca são consultadas.

Uma tabela com RLS desativado, mas sem concessão para uma função exposta *não* é relatada. Ela não é
alcançável e sinalizá-la seria ruído.

```sql
ALTER TABLE "public"."your_table" ENABLE ROW LEVEL SECURITY;
```

Ativar o RLS sem políticas nega todas as linhas para todos, exceto para o proprietário; portanto, adicione a política
pretendida na mesma migração — caso contrário, você terá trocado uma exposição por uma interrupção
silenciosa. Veja [rls-enabled-no-policies](#rls-enabled-no-policies).

### policy-always-true

**Política concede acesso incondicional.** Crítica.

Uma política permissiva cuja expressão `USING` ou `WITH CHECK` é uma verdade constante — `true`,
`(true)`, `1 = 1`. Políticas permissivas são combinadas com OR, portanto uma única dessas políticas satisfaz
o filtro de linha da tabela, independentemente de quão estrita seja qualquer outra política.

Se uma política `RESTRICTIVE` cobrir o mesmo comando, esta é rebaixada para média e relatada como
algo a ser verificado em vez de uma certeza, porque políticas restritivas aplicam AND após o OR das permissivas.

```sql
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());
```

### policy-anonymous-tautology

**Política apenas verifica se um ID de chamador existe.** A severidade depende da plataforma.

A expressão tem o formato `rebase.uid() IS NOT NULL` (ou `auth.uid()` no Supabase, e em um banco de
dados Rebase provisionado antes da versão 1.0): ela separa chamadores autenticados de não autenticados, mas
não limita o escopo de nenhuma linha. Todo usuário autenticado alcança todas as linhas que a política cobre.

A severidade depende da plataforma, e essa distinção importa:

- **No Supabase**, `auth.uid()` retorna `NULL` para chamadores anônimos, portanto esta é uma verificação
  funcional apenas para autenticados. Relatada como **baixa** — uma lacuna no escopo de dados entre usuários
  autenticados, não uma brecha de acesso anônimo.
- **No Rebase ou PostgREST**, onde um ID de chamador em branco é convertido para o sentinela `'anonymous'`,
  a expressão é *verdadeira também para chamadores não autenticados*. Relatada como **crítica**.
- **Em uma plataforma não reconhecida**, relatada como **média**, pois a existência de uma brecha
  depende se sua pilha utiliza ou não tal sentinela.

```sql
-- Scope to the row's owner rather than to the existence of an id
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (user_id = rebase.uid());

-- Or, if "any signed-in user" really is the intent, reject the sentinel explicitly
--     USING (rebase.uid() IS NOT NULL AND rebase.uid() <> 'anonymous');
```

O SQL sugerido é impresso com a função de ID do chamador que seu banco de dados realmente possui:
`rebase.uid()` em um banco de dados Rebase, `auth.uid()` no Supabase e PostgREST. Ambas as
grafias são reconhecidas ao ler políticas, portanto um banco de dados Rebase em fase de migração do
schema `auth` anterior à 1.0 ainda é verificado.

### view-bypasses-rls

**View lê ignorando o RLS de sua tabela base.** Crítica.

Uma view concedida a uma função não confiável que faz seleção a partir de uma tabela protegida por RLS sem
`security_invoker = true`. A view é executada com os privilégios do seu **proprietário**, portanto ela lê a
tabela base como proprietário e as políticas do chamador nunca se aplicam. Essa é a maneira mais comum de
vazar dados de uma tabela cuidadosamente protegida.

```sql
ALTER VIEW "public"."your_view" SET (security_invoker = true);
```

No PostgreSQL anterior à versão 15, essa opção simplesmente não existe, portanto toda view desse tipo se
comporta dessa maneira. Ali, o achado é relatado como heurístico, e a solução é mover a lógica para uma
função ou fazer o upgrade.

### matview-bypasses-rls

**Materialized view expõe dados protegidos por RLS.** Alta.

Views materializadas não podem ter segurança em nível de linha, e os dados nelas são um snapshot
armazenado tirado por quem a atualizou. Se uma for concedida a uma função não confiável e sua consulta
de definição ler uma tabela protegida por RLS, nenhuma política poderá ajudar — revogue a concessão
ou mova a matview para um schema que funções não confiáveis não possam alcançar.

```sql
REVOKE ALL ON "public"."your_matview" FROM "anon";
```

### anonymous-write-allowed

**Chamadores não autenticados podem escrever.** Alta.

Uma política permissiva de `INSERT`/`UPDATE`/`DELETE`/`ALL` alcançável sem autenticação cuja
expressão de verificação aceita qualquer linha, respaldada por uma concessão correspondente.

A condição "aceita qualquer linha" é essencial e deliberadamente restrita. O Supabase concede a `anon`
e `authenticated` DML completo por padrão, portanto uma política direcionada a essas funções não é por si só
um problema — um caso clássico `FOR INSERT TO public WITH CHECK (userId = auth.uid())` está correto
e não é relatado.

### unqualified-column-in-subquery

**Coluna não qualificada dentro de uma subconsulta de política.** Alta, heurística.

Um nome de coluna simples dentro de uma subconsulta `EXISTS`/`IN` que existe em *ambas* as relações: na relação
interna e na própria tabela da política. O Postgres a vincula à tabela **interna**, de modo que a correlação com
a linha externa que você pretendia escrever desaparece silenciosamente e o predicado se torna trivialmente
satisfazível — ou trivialmente insatisfazível, negando cada linha para todos.

```sql
-- The bug: `id` binds to memberships, not organizations
USING (EXISTS (SELECT 1 FROM memberships WHERE id = organizations.id ...))

-- Qualify it
USING (EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = organizations.id ...))
```

**A ausência deste achado não é prova de segurança.** `pg_policies.qual` é a própria re-renderização
do Postgres da árvore de parse e geralmente re-qualifica as referências de coluna — portanto, o nome simples
original frequentemente não é mais visível quando o catálogo é lido. Quando essa verificação é disparada, é
uma evidência forte; quando não é, nada provou.

### junction-table-unprotected

**Tabela de junção muitos-para-muitos sem RLS.** Alta, heurística.

Uma tabela que é essencialmente apenas os dois pontos de extremidade de duas chaves estrangeiras, ambas
apontando para tabelas que *possuem* RLS, sem nenhuma segurança em nível de linha própria. Ambos os lados
da relação estão bloqueados e a conexão entre eles está aberta — o que é suficiente para enumerar a
relação mesmo quando nenhum dos pontos de extremidade pode ser lido.

Heurística porque uma tabela de junção é inferida pela sua forma. Se a sua for deliberadamente pública,
use `--skip junction-table-unprotected`.

### rls-enabled-not-forced

**RLS ativado, mas não forçado para o proprietário da tabela.** Média ou alta.

Sem `FORCE`, o proprietário da tabela fica isento de suas próprias políticas. Isso é inofensivo quando o
proprietário é uma função de provisionamento à qual nada se conecta, e grave quando sua aplicação se
conecta como o proprietário — portanto, isto é **alta** quando a função proprietária pode fazer login e **média**
caso contrário.

Se o proprietário for um superusuário ou tiver `BYPASSRLS`, permanece como média e informa isso: `FORCE`
não pode restringir tal função, e sugerir o contrário seria enganoso.

```sql
ALTER TABLE "public"."your_table" FORCE ROW LEVEL SECURITY;
```

### rls-enabled-no-policies

**RLS ativado sem políticas.** Média.

Não é uma brecha de segurança — é o oposto. RLS ativado sem políticas nega todas as linhas para todos,
exceto para o proprietário. É relatado porque é uma falha *invisível*: a API retorna `[]`, e uma tabela vazia é
indistinguível de uma tabela filtrada. Essa configuração já serviu silenciosamente coleções vazias em
produção por semanas seguidas.

### policy-role-unreachable

**Políticas direcionam para funções (roles) às quais nada se conecta.** Média.

Todas as políticas na tabela nomeiam funções que não existem, não podem fazer login e que nenhuma
função de login herda transitivamente. As políticas parecem corretas e não se aplicam a ninguém, portanto a
tabela é lida como vazia.

O caso clássico são políticas escritas com `TO authenticated` — um nome de função do Supabase — em um
banco de dados cujas requisições realmente chegam como alguma outra função.

### grant-to-public

**Privilégios da tabela concedidos a PUBLIC.** Média.

Um privilégio DML concedido a `PUBLIC`. Mesmo com o RLS ativado, isso amplia *para quem* as políticas
são avaliadas, e quase nunca é intencional.

```sql
REVOKE ALL ON "public"."your_table" FROM PUBLIC;
```

### security-definer-mutable-search-path

**Rotina SECURITY DEFINER com um search_path mutável.** Média.

A rotina é executada como seu proprietário — frequentemente um superusuário — enquanto o chamador controla
como seus identificadores são resolvidos. Esse é o formato padrão de elevação de privilégios, e qualquer coisa
que a rotina toque é lida com os direitos do proprietário, ignorando o RLS.

```sql
ALTER FUNCTION "public"."your_function"() SET search_path = pg_catalog, public;
```

### current-setting-throws

**Política chama `current_setting()` sem `missing_ok`.** Baixa, heurística.

`current_setting('app.tenant_id')` com um único argumento *gera um erro* quando a configuração não está
definida, em vez de retornar `NULL`. Assim, em vez de negar a linha, a requisição falha — o chamador vê
um erro 500 em vez de um resultado vazio, e o middleware que tenta novamente requisições 5xx tentará novamente
uma requisição que nunca poderá ter sucesso.

```sql
ALTER POLICY "your_policy" ON "public"."your_table"
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

## O que esta ferramenta não faz

Ser claro sobre os limites é o objetivo — uma ferramenta de segurança que superestima sua cobertura é
pior do que nenhuma.

- **É uma auditoria estática de catálogo.** Ela lê `pg_class`, `pg_policies`, `pg_depend` e similares.
  Ela não se conecta como sua função `anon` para tentar ler seus dados, portanto não pode confirmar que
  uma exposição é alcançável por meio da sua API.
- **Ela não pode provar que uma política está correta.** Ela encontra padrões que sabidamente estão
  incorretos. Uma política que passa por todas as verificações aqui ainda pode expressar a regra de negócio
  errada.
- **Um relatório sem achados não é uma certificação de segurança.** Em particular, veja a nota sobre
  [unqualified-column-in-subquery](#unqualified-column-in-subquery): o Postgres reescreve expressões
  de política, portanto alguns bugs deixam de ser visíveis no catálogo.
- **Ela não verifica autorização em nível de aplicação**, chaves de API, exposição de rede, manipulação
  de segredos ou qualquer coisa fora do banco de dados.

## Relacionados

- [Regras de Segurança (RLS)](/docs/collections/security-rules) — definindo a segurança em nível de linha
  em coleções do Rebase, que são compiladas nas políticas que esta ferramenta audita.

---
