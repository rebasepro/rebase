---
sourceHash: 0201dc1a9ce575f7
title: Geração de Schema
sidebar_label: Geração de Schema
description: Gere schemas Drizzle ORM a partir das tabelas em backend/schema, crie migrações SQL, faça introspecção de um banco de dados existente em arquivos defineTable e mantenha seu banco de dados sincronizado com a Rebase CLI.
---

## Visão geral

O Rebase usa um pipeline de **schema-as-code** onde as tabelas que você declara com
`defineTable` em `backend/schema/` são a única fonte da verdade. A CLI
as transforma por meio de um pipeline determinístico:

```
Tables (backend/schema) → Drizzle Schema → SQL Migrations → PostgreSQL
```

Esta página aborda todos os comandos da CLI envolvidos nesse pipeline.

## Qual devo usar?

Uma alteração de tabela chega ao PostgreSQL de três maneiras:

- **Boot, por conta própria.** O backend aplica a parte aditiva a cada inicialização (`REBASE_MIGRATE_ON_BOOT=ensure`, o padrão): tabelas ausentes, colunas, tipos enum e políticas de segurança em nível de linha (row-level security). Sob o `rebase dev`, uma tabela ou coluna adicionada não precisa de mais nada. O boot nunca remove (drop), renomeia ou restringe tipos.
- **`rebase db push`, em desenvolvimento.** Sincroniza o schema diretamente com o banco de dados, incluindo remoções e renomeações, protegido por seu [gate de alterações destrutivas](#rebase-db-push). Use-o em um banco de dados no qual você não aplica migrações.
- **`rebase db generate` + `rebase db migrate`, em produção.** Cada alteração é um arquivo SQL revisado no controle de versão, aplicado em ordem.

Mudar um banco de dados que o boot ou o `db push` já configurou para o sistema de migrações requer uma baseline, porque ele já contém as tabelas que a primeira migração cria. O `rebase db migrate` verifica isso antes de executar qualquer coisa, para e exibe o comando `rebase db migrate --baseline <version>` para ser executado com a versão preenchida; consulte [Criando uma baseline de um banco de dados que o Rebase já inicializou](#criando-uma-baseline-de-um-banco-de-dados-que-o-rebase-já-inicializou). No sentido inverso, executar `db push` em um banco de dados que registra migrações avisa isso em uma linha: a próxima migração que fizer a mesma alteração falhará com `already exists`.

## O Pipeline

### 1. Tabelas → Schema Drizzle

As tabelas exportadas por `backend/schema/index.ts` descrevem colunas, tipos, relações,
enums e segurança em nível de linha (RLS). Todos os comandos abaixo as leem por meio do loader
a partir do qual o backend inicializa; portanto, um schema que não compila — uma tabela sem
`rls`, `"inherit"` sem `defaultRls`, um `defineTable` que o index não
exporta — interrompe o comando com um `SchemaDefinitionError` nomeando cada problema,
e nada é gravado. O comando `schema generate` gera um arquivo de schema
Drizzle ORM a partir delas.

Cada comando que lê o schema aceita `--schema-dir <dir>` para projetos
que mantêm suas tabelas em outro local; o padrão é `backend/schema`, ou a
chave `tables` da aplicação backend em `rebase.json`. A flag `--collections` / `-c`,
anterior à versão 0.31, é recusada com uma mensagem indicando o codemod
([`rebase migrate collections-to-tables`](#rebase-migrate)), assim como um
projeto que ainda contenha `config/collections`.

### 2. Schema Drizzle → Migrações

A partir do schema Drizzle gerado, o `db generate` calcula a diferença em relação às migrações já existentes em `backend/drizzle/migrations/`, reproduzidas em um banco de dados temporário, e produz arquivos de migração SQL com carimbo de data/hora. Ele nunca lê o seu banco de dados: uma coluna que o boot ou o `db push` já adicionou ainda será gerada como `ADD COLUMN`.

### 3. Migrações → PostgreSQL

O comando `db migrate` aplica migrações pendentes ao seu banco de dados PostgreSQL.

## Comandos

### `rebase schema generate`

Gera um arquivo de schema Drizzle ORM a partir das suas tabelas:

```bash
rebase schema generate
```

**O que ele faz:**
- Lê as tabelas que `backend/schema/index.ts` exporta
- Gera `backend/src/schema.generated.ts` com definições de tabelas, enums e relações do Drizzle

**Opções:**

| Flag | Descrição |
|------|-----------|
| `--schema-dir` | O diretório do schema (padrão: `backend/schema`); caminhos relativos são resolvidos a partir de onde você executa o comando |
| `--output, -o` | Caminho de saída para o arquivo de schema gerado; caminhos relativos são resolvidos a partir de onde você executa o comando |
| `--watch, -w` | Observa alterações e regenera automaticamente |

O **modo watch** é útil durante o desenvolvimento — edite um arquivo de tabela e o schema é regenerado instantaneamente:

```bash
rebase schema generate --watch
```

### `rebase schema stale`

Verifica se o schema gerado ainda corresponde às tabelas:

```bash
rebase schema stale          # relata e encerra com código 1 se algo estiver desatualizado
rebase schema stale --fix    # regenera o arquivo em vez de apenas relatar
```

**O que ele faz:**
- Renderiza o que as tabelas em `backend/schema/` geram e compara, declaração por declaração, com `backend/src/schema.generated.ts`
- Aponta cada diferença — uma tabela ausente, uma coluna com tipo alterado, um rótulo de enum removido ou chaves estrangeiras nomeadas no padrão derivado por versões anteriores — e encerra com status diferente de zero
- Com `--fix`, regenera o arquivo em vez de apenas emitir o relatório

O comando `rebase dev` mantém o arquivo atualizado por conta própria, portanto esta é a verificação ideal para um build
ou etapa de CI. Ele aceita `--schema-dir` e `--output` da mesma forma que `rebase schema generate`.

### `rebase schema reconcile`

Flexibiliza e remove o que o boot não remove, após você revisar o plano:

```bash
rebase schema reconcile                         # flexibiliza NOT NULL em colunas tornadas anuláveis ou removidas
rebase schema reconcile --drop voice_cache.wav  # e remove uma coluna que nenhuma tabela declara
```

**O que ele faz:**
- Solicita ao backend em execução que planeje as ações contra seu próprio banco de dados. Esse é o banco apontado pelo `.env` do backend e pelo vínculo na nuvem, funcionando portanto no Rebase Cloud, onde nada mais acessa o banco diretamente.
- Planeja `DROP NOT NULL` para cada coluna que uma tabela declara como anulável, mas que o banco de dados ainda exige como obrigatória.
- Lista todas as colunas que nenhuma tabela declara. Uma coluna `NOT NULL` sem valor padrão bloqueia todas as inserções, portanto ela também é flexibilizada e seus dados são mantidos. Ele remove apenas as colunas que você especificar com `--drop <table>.<column>`, e exibe quantas linhas contêm valores em cada uma.
- Aplica as alterações assim que você digita `yes`. O servidor executa o plano apenas se o digest for idêntico ao que você revisou; portanto, se o banco ou as tabelas tiverem mudado nesse intervalo, ele recusa a operação e solicita nova revisão. A flag `--yes` pula a confirmação.

O boot realiza apenas adições; portanto, após remover uma coluna do seu `defineTable`, a coluna permanece no banco de dados com seus dados. Uma coluna `NOT NULL` sem padrão fará com que qualquer inserção falhe, e o log do boot indicará este comando: sem `--drop` para manter os dados, ou com ele para remover a coluna fisicamente. Faça o deploy da alteração da tabela primeiro, pois o reconcile faz o planejamento contra o que o backend está executando. Ele requer `REBASE_SERVICE_KEY` no arquivo `.env`. Localmente, o `rebase db push` cobre o mesmo cenário por meio do seu gate de alterações destrutivas.

### `rebase schema introspect`

Gera arquivos `defineTable` a partir de um banco de dados PostgreSQL existente:

```bash
rebase schema introspect
```

**O que ele faz:**
- Conecta-se ao banco de dados deste projeto, o mesmo exibido por `rebase db url` (o banco gerenciado é iniciado se for o caso); `--database-url` define outro banco, e `--docker` usa o banco do compose
- Lê todas as tabelas, colunas, tipos, chaves estrangeiras e políticas, e grava
  `backend/schema/<table>.ts` — um `defineTable` por tabela — e o
  `backend/schema/index.ts` que as exporta (mesclado ao index se já existir)
- Declara cada coluna com seu tipo Postgres: `col.uuid()`, `col.varchar({ length })`,
  `col.numeric({ precision, scale })`, enums com seus rótulos e nomes reais de tipos
  (um `pgEnum` quando o tipo é compartilhado), arrays como `<item>.array()`,
  `col.vector({ dimensions })`, chaves identity e serial, valores padrão — nomeados conforme
  a convenção do Drizzle. Um tipo não reconhecido por nenhum builder torna-se
  `col.custom({ dataType: "<sql type>" })`, que o Rebase serve da mesma forma que o
  driver o retorna; `db generate` e `db push` o recusam até que o planejador
  possa interpretá-lo
- Declara a coluna de chave estrangeira, o `belongsTo` correspondente e o `hasMany`
  inverso no destino; uma tabela de junção se torna um `manyToMany`, com suas próprias
  colunas atuando como `pivot`
- Lê as políticas de segurança em nível de linha (RLS) de cada tabela para o seu `rls`: nome,
  comando, modo, lista `TO`, `USING` e `WITH CHECK`. As políticas `<table>_default_*`
  adicionadas pelo próprio Rebase são ignoradas, de modo que o `db push` subsequente
  recria cada política como ela era originalmente. Uma tabela com RLS ativado e nenhuma política
  é definida como `rls: "admin-only"`
- Lê todas as expressões (o `USING` de uma política, uma restrição CHECK, o padrão de uma coluna) sob
  o `search_path` usado pelo servidor, `public`, portanto uma função no schema `rebase`
  é escrita como `rebase.roles()`
- Converte uma restrição CHECK legível (`total >= 0`) no `.validate()` da coluna, mantendo a restrição original no banco de dados, onde o próximo push a preserva. Cada CHECK também é listado na seção "Not carried over" com seu respectivo SQL: um push em um banco de dados *novo* criará a validação, não a restrição
- Declara cada índice simples (apenas colunas, btree, gin ou brin, sem predicado) no array `indexes` da tabela. Um índice exclusivo em uma coluna de chave estrangeira é delegado à relação, que o cria automaticamente
- Com `--from supabase`, converte as convenções do Supabase para um banco que você está migrando: o padrão de coluna `auth.uid()` torna-se `.onCreateUser()` (o servidor grava o ID de quem chamou), uma coluna que armazena um ID de usuário Supabase (aquele padrão ou uma chave estrangeira para `auth.users`) torna-se `col.text().userId()`, já que `rebase.users.id` e `rebase.uid()` são do tipo text, e uma política `TO authenticated` / `TO anon` perde o papel (um banco Rebase não tem nenhum dos dois) e passa a exigir um chamador autenticado/anônimo; políticas exclusivas para `service_role` são descartadas. Cada alteração é comentada no topo do arquivo da tabela. Sem a flag, esses itens são mantidos como estão (caso o Rebase opere no mesmo banco paralelamente ao Supabase), e a execução avisa quando os encontra
- Conclui listando o que **não** foi importado: funções, triggers, extensões, CHECKs, índices que a propriedade `indexes` não consegue expressar, chaves estrangeiras compostas por várias colunas ou que apontam para outro schema. O SQL que recria cada elemento que o Postgres consegue exibir é gravado em `backend/sql/_introspected-left-behind.sql` como rascunho: revise-o, garanta que seja seguro para reexecuções e renomeie-o removendo o `_` inicial para que o `rebase db push` e cada deploy o executem sempre que houver alterações
- Lembra que `DATABASE_URL` ainda aponta para o banco lido: em uma migração essa seria a origem, e um `db push` imediato gravaria diretamente nele
- Em projetos headless, substitui o arquivo `ai-instructions.md` gerado pelo scaffold ("o banco de dados é o schema") pelas regras de schema-in-code apenas do backend, desde que o arquivo permaneça exatamente como gerado; caso tenha sido editado, ele não é modificado e o comando informa quais regras não são mais válidas
- Registra detalhes não mapeáveis com precisão em um comentário no início do arquivo da tabela e no terminal — conjuntos fechados de strings em colunas de texto, colunas geradas cuja expressão não pôde ser lida, tipos customizados — juntamente com o efeito que um push teria sobre eles
- Com `--data-inference`, analisa uma amostra de até 100 linhas por tabela e salva configurações de apresentação — títulos, ícones, quadros, ordenações, opções de campos — em
  `frontend/src/cms/<table>.tsx` como um `customizeTable`, quando o frontend
  do projeto depender de `@rebasepro/cms`. Projetos headless não recebem nenhum arquivo
- Se o banco de dados não estiver em execução, exibe a mesma mensagem de erro que o `db push`,
  apenas uma vez, sem criar nada. Mostra o diretório de saída como um
  caminho absoluto

**Opções:**

| Flag | Descrição |
|------|-----------|
| `--schema-dir` | Onde gravar os arquivos de tabela (padrão: `backend/schema`). `--output` foi descontinuado |
| `--schema` | O schema do Postgres a ser lido (padrão: `public`) |
| `--force, -f` | Sobrescreve arquivos de tabela existentes; sem a flag, arquivos existentes são ignorados |
| `--database-url` | Lê este banco de dados em vez do configurado no projeto |
| `--docker` | Lê o banco de dados do compose, iniciando-o se necessário |
| `--from supabase` | Converte convenções do Supabase (padrões `auth.uid()`, chaves estrangeiras para `auth.users`, `TO anon` / `TO authenticated`) para um banco Rebase. Omita se o Rebase for operar no mesmo banco paralelamente ao Supabase |
| `--data-inference` / `--no-data-inference` | Amostra até 100 linhas por tabela para inferir formatos, restrições e ajustes de painel, ou lê somente a estrutura. Sem a flag, o comando pergunta interativamente; fora de um terminal, lê somente a estrutura |
| `--users` | Grava também `users.ts` para `rebase.users`, como um `defineAuthTable` correspondente à tabela criada pela autenticação: o arquivo para adicionar colunas, papéis e hooks à tabela de usuários. Sem isso, `rebase.users` é servida como a tabela de usuários tal como está |

Isso é útil ao adotar o Rebase em um banco de dados existente — faça a introspecção
primeiro e depois ajuste as tabelas geradas. Tabelas sem RLS são
escritas normalmente, contendo sua configuração `rls`; o push ativará o RLS, e a
execução de teste (dry run) alertará sobre isso. Um backend executado sem nenhum `backend/schema`
serve o banco de dados diretamente — consulte [Somente Backend](/docs/getting-started/headless/).
Migrando do Supabase? Veja [Migrando do Supabase](/docs/recipes/migrate-from-supabase/).

### `rebase db push`

Envia alterações de schema diretamente para o banco de dados sem arquivos de migração:

```bash
rebase db push
```

**O que ele faz:**
- Lê o schema Drizzle gerado
- Aplica as alterações diretamente ao banco de dados (CREATE, ALTER, DROP)
- Faz uma simulação prévia (dry run) do plano e para antes de qualquer ação que destrua dados:
  remoção de tabela, coluna, schema, view ou tipo, comandos `TRUNCATE`, ou mudanças
  de tipos de coluna sujeitas a perda de precisão (`timestamptz` → `date`, `numeric` → `integer`),
  bem como alterações de chave primária — mudar `(id)` → `(id, locale)` atribui um novo identificador a cada linha,
  quebrando links, chaves estrangeiras e referências armazenadas externamente.
  Ele também interrompe a execução
  antes da remoção de restrições CHECK ou EXCLUDE presentes no banco: nenhuma linha
  é excluída, mas o banco passará a aceitar dados que antes recusava.
  A confirmação é solicitada no terminal (onde Ctrl-C ou Ctrl-D recusam a ação), e
  a operação é cancelada em ambientes sem terminal interativo; `--allow-destructive` força a aplicação. A flag `--yes` ainda funciona
  nesta versão emitindo um aviso de descontinuação; a partir da próxima versão, ela aprovará
  apenas alterações não destrutivas. Pushes
  interrompidos nesse estágio removem o banco temporário de cálculo `<db>_dev_diff` ao encerrar
- Ativa a segurança em nível de linha (RLS) em todas as tabelas declaradas, inclusive tabelas de junção, logo após a
  alteração de schema e antes de passos passíveis de falha. Dessa forma, caso o push seja interrompido na metade, novas tabelas
  bloquearão todas as requisições em vez de ficarem totalmente expostas
- Aplica as políticas de RLS resultantes da compilação do `rls` das suas tabelas e **remove políticas substituídas por pushes anteriores**
- Com `--prune-policies`, também remove políticas em tabelas declaradas que nenhuma tabela mais define — aquelas que a simulação lista como "mantidas em vigor", como políticas nativas remanescentes após a tabela mudar para `rls: "admin-only"` — na mesma transação que aplica as políticas declaradas. A simulação lista cada uma em "Planned row-level security changes", e o push impõe o mesmo controle que adota para colunas removidas (solicita confirmação no terminal e exige `--allow-destructive` fora dele): remover políticas afeta as permissões de leitura e escrita, e remover uma política `RESTRICTIVE` amplia o acesso. Tabelas não declaradas em `backend/schema` e o schema `rebase` nunca são afetados
- Mantém inalteradas
  todas as restrições CHECK e EXCLUDE em tabelas declaradas. Nenhuma tabela
  pode declarar essas restrições diretamente no código, portanto são consideradas regras próprias do banco, criadas manualmente
  ou herdadas por bancos adotados via `schema introspect`; para eliminá-las, remova-as
  manualmente (`ALTER TABLE … DROP CONSTRAINT …`). Triggers e funções criados por você
  também não são modificados
- Valida com precisão
  o nome de tudo o que ignora, inclusive caracteres como `.`, `[`, `]` ou `*`
- Constrói qualquer
  [índice de chave estrangeira derivado pelo Rebase](/docs/backend/indexes#foreign-keys-are-indexed-for-you)
  que falte em tabelas existentes **antes** de planejar as mudanças, usando
  `CREATE INDEX CONCURRENTLY`, permitindo que escritas na tabela continuem durante o processo;
  o Atlas então o encontra já existente. A flag `--dry-run` lista esses índices sem criá-los
- Registra as
  políticas aplicadas usando a mesma marcação da inicialização do servidor, evitando que o primeiro
  boot após um push recrie desnecessariamente todas as políticas
- A flag `--dry-run`
  lista os ajustes de segurança em nível de linha que o push realizaria, sob "Planned
  row-level security changes": tabelas com RLS a ser ativado e cada
  política que seria criada, substituída ou removida, determinadas conforme
  o algoritmo do próprio push. Exibe "No changes" apenas quando nem o schema nem
  as políticas demandam ajustes. Se a marcação de uma política divergir da sua
  regra, ou se não houver marcação (caso de políticas geradas via `db migrate` ou criadas manualmente),
  a simulação recria a política a partir da regra sob um nome temporário dentro de uma transação revertida
  e compara o resultado gravado pelo Postgres: resultados idênticos contam como
  nenhuma alteração. Assim, regras lidas pelo `schema introspect` não geram alterações no plano,
  nem políticas aplicadas pelo `db migrate`. Políticas que não puderem ser comparadas (por exemplo,
  se o lock da tabela não for obtido em dois segundos) são listadas à parte. O push
  em si imprime uma única linha com a contagem de alterações
- Informa quando há uma instância de `rebase dev` rodando no mesmo banco: ela aplica novas tabelas e colunas conforme você salva o código, portanto "No changes" pode significar que ela já realizou a aplicação
- Exibe apenas uma vez cada
  instrução aplicada pelo Atlas. O Atlas se conecta sem SSL a bancos locais
  nesta máquina (`localhost`, `127.x`, `::1`) cuja URL não especifique `sslmode`, assim como a aplicação
  faz, em vez de falhar com `SSL is not enabled on the server`; conexões que
  especificam `sslmode` ou apontam para outros hosts são respeitadas na íntegra. Falhas do Atlas
  anteriores ao planejamento não deixam bancos residuais `<db>_dev_diff`
- A flag `--dry-run`
  não grava nada no projeto: `src/schema.generated.ts` é mantido inalterado,
  e eventuais cópias de `drizzle/*.sql` versionadas em releases antigos são apontadas,
  mas não excluídas. Apenas as entradas do plano são gravadas em `.rebase/sql/`, diretório ignorado pelo controle de versão
- **Não** cria arquivos de migração

**Tempo de execução.** Praticamente todo o tempo de um push é consumido pelo Atlas calculando o plano: ele
monta o schema desejado em um banco de rascunho temporário e calcula a diferença contra o banco
real. Esse custo cresce em ritmo superior à quantidade de tabelas — em um laptop comum,
são cerca de 0,25 s por plano para 11 tabelas, 0,9 s para 111 e 5,5 s para 411. Um push sem
alterações planeja uma vez; um push com mudanças planeja duas vezes (o dry-run
que valida alterações destrutivas, seguido da aplicação). Logo, pushes em schemas com
400 ou mais tabelas levam dezenas de segundos, podendo demorar mais em ambientes com alta carga.
Esse tempo pertence ao Atlas, não ao seu banco: etapas complementares — geração do
SQL, locks de RLS, busca, triggers, políticas e papéis — levam poucos segundos
nessa escala, utilizando uma única conexão com o banco.

**Arquivos gerados no processo**, armazenados sob `.rebase/sql/` na raiz do backend.
O `db push` e o `db generate` geram todos os cinco a partir das suas tabelas a
cada execução antes de lê-los; portanto, versioná-los seria inútil. O diretório
possui seu próprio `.gitignore` e nunca deve ser commitado.

| Arquivo | Conteúdo |
|---------|----------|
| `schema.sql` | Tabelas, colunas, restrições e índices — o estado desejado pelo Atlas, e a única estrutura comparada por ele |
| `policies.sql` | Políticas de RLS geradas a partir da compilação do `rls` das suas tabelas |
| `search.sql` | Funções de busca textual (full-text search) e colunas geradas para tabelas com bloco `search` |
| `vector.sql` | Extensões pgvector e índices ANN |
| `triggers.sql` | `rebase.set_updated_at()` e os gatilhos `BEFORE UPDATE` que viabilizam `.onUpdateNow()` |

O Atlas gerencia apenas o primeiro arquivo; o `db push` e a rotina de schema
ensure na inicialização aplicam os outros quatro por conta própria. Implantações **baseadas exclusivamente em migrações** — que
usam `db migrate` e nunca `db push` — precisam incluir esses quatro arquivos manualmente em uma
migração; o `db generate` emite um aviso quando detecta alterações não rastreadas pelo Atlas.

Projetos que comitaram esses arquivos em `drizzle/` em versões anteriores terão
essas cópias excluídas na primeira execução, e o comando listará cada uma para que você
possa commitar a exclusão. Ele remove somente arquivos que contenham o cabeçalho
do gerador. Arquivos criados manualmente são preservados, assim como o diretório `drizzle/migrations/`.

:::note[Editar uma regra de segurança renomeia sua política]
Uma regra sem uma propriedade `name` explícita compila para `<table>_<op>_<hash>`, onde o hash encapsula a semântica da regra — portanto, *editar* uma regra (em vez de apenas criar uma nova) gera uma política com novo nome e mantém a anterior intacta.

Antigamente isso era problemático: o Postgres avalia políticas `PERMISSIVE` usando operadores OR lógicos; assim, um antigo `USING (rebase.uid() IS NOT NULL)` continuava permitindo amplo acesso, por mais restritiva que fosse a nova política que o substituiu. O endurecimento da regra não surtia efeito prático, e o push reportava sucesso.

O `db push` agora soluciona esse problema: remove políticas geradas que não correspondam mais a nenhuma regra e aponta — sem remover — políticas com nomes personalizados não descritas nas tabelas, visto que estas não podem ser distinguidas de SQLs intencionalmente criados por humanos.

Para verificar um banco atualizado antes desta implementação, execute `rebase doctor --policies`. O comando serve como validação em pipelines de CI: encerra com código diferente de zero se houver drift, ou caso não consiga executar a checagem — ausência de `DATABASE_URL`, caminho `--schema-dir` inválido, ou permissões insuficientes na role de CI para ler `pg_policies`. Uma validação que não pôde inspecionar os dados não é considerada aprovada.

O `doctor` e o `db push` diferenciam os dois tipos de políticas órfãs. Políticas com nomes gerados automaticamente tornaram-se obsoletas e o próximo push irá removê-las. Nomes manuais ou originados de outras ferramentas continuam em vigor: declare-os no `rls` da respectiva tabela para mantê-los (a interface de RLS do Studio permite importá-los) ou descarte-os usando `rebase db push --prune-policies` caso não sejam mais necessários.
:::

:::caution
O comando `db push` altera o banco de dados diretamente. Utilize-o apenas em ambiente de desenvolvimento. Para produção, adote `db generate` + `db migrate` para gerar arquivos de migração passiveis de revisão.
:::

### `rebase db generate`

Gera arquivos de migração SQL a partir das alterações de schema:

```bash
rebase db generate
```

**O que ele faz:**
- Compara o schema Drizzle contra o estado resultante das migrações contidas em `drizzle/migrations/`, não contra o seu banco de dados
- Produz arquivos de migração SQL com carimbo de data/hora em `backend/drizzle/migrations/`
- Os arquivos podem ser revisados, editados e adicionados ao controle de versão
- Identifica todas
  as instruções na nova migração que impliquem em perda de dados, usando a mesma verificação que o `db push`
  executa antes de aplicar mudanças: tabelas, colunas, schemas, views ou tipos removidos, comandos
  `TRUNCATE`, mudanças de tipo que possam truncar valores, alterações em
  chaves primárias, ou a remoção de restrições CHECK ou EXCLUDE existentes no banco. O arquivo
  é gravado normalmente e o comando retorna código 0, atuando como alerta sem impedir o processo.
- Finaliza indicando
  os próximos passos: `rebase db migrate` e, caso seja a primeira migração do projeto, a instrução
  `--baseline <version>` necessária para bancos que o boot já configurou previamente. Migrações
  posteriores não recebem a sugestão de baseline, pois aplicar baseline em migrações destrutivas
  pularia seus comandos `DROP`; execuções que não geram novas migrações apenas relatam esse fato.

**Restrições CHECK adicionadas manualmente em migrações são removidas pela migração seguinte.** O comando `db generate`
compara seus arquivos de migração e não o banco de dados, e o Atlas não possui mecanismos para desconsiderar
elementos específicos dessa comparação. Desse modo, restrições CHECK ou EXCLUDE adicionadas
manualmente a uma migração — que não possam ser expressas no código das tabelas — serão marcadas como
`ALTER TABLE … DROP CONSTRAINT …` na migração subsequente, mescladas na
mesma instrução da alteração real. O relatório gerado avisa sobre a remoção caso o
banco já possua a restrição; contudo, ele não a retira do
arquivo. Exclua a instrução manualmente antes de executar `rebase db migrate` ou utilize
`rebase db migrate --refuse-destructive` para abortar a aplicação. O `db push`, por outro lado, consulta o
banco diretamente e preserva a restrição.

As migrações geradas são arquivos SQL puros — você pode inspecioná-las e ajustá-las antes da execução.

### `rebase db migrate`

Executa todas as migrações pendentes:

```bash
rebase db migrate
```

**O que ele faz:**
- Varre `drizzle/migrations/` em busca de migrações pendentes
- Aplica-as sequencialmente ao banco de dados
- Registra o histórico das migrações que já foram aplicadas
- Registra as
  políticas de RLS da mesma forma que o `db push` e a inicialização do servidor fazem,
  evitando que o primeiro boot após a migração recrie cada uma desnecessariamente.
  Como a migração foi construída a partir do estado das tabelas em sua respectiva época,
  a política só recebe a marcação se coincidir rigorosamente com a regra atual: o migrate a recria
  temporariamente a partir da regra sob outro nome, em uma transação revertida,
  e compara o que o Postgres armazenou, à semelhança do `db push --dry-run`. Políticas com
  divergências não recebem a marcação e o boot seguinte as reaplica em sua respectiva tabela

A flag `--refuse-destructive`
interrompe o processo em caso de risco. Ela executa uma simulação prévia das migrações pendentes. Se alguma
instrução destruir dados, de acordo com os mesmos critérios de `db push` e `db generate`,
o comando lista essas instruções e finaliza com código 1. Nenhuma alteração é aplicada, nem mesmo
os arquivos anteriores à instrução perigosa. Sem a flag, o `db migrate` adota o comportamento padrão e
aplica todos os arquivos pendentes:

```bash
rebase db migrate --refuse-destructive
```

Uma migração que recria uma coluna de busca textual a remove antes de criá-la novamente, logo esta flag
recusará essa migração. Leia a listagem exibida e execute `rebase db migrate`
sem a flag para aplicar a alteração se estiver de acordo.

#### Criando uma baseline de um banco de dados que o Rebase já inicializou

A cada inicialização, o Rebase assegura o schema necessário, e o comando `rebase db push` o aplica de forma direta. Portanto, qualquer banco de dados que já tenha executado um deles conterá de antemão as tabelas e tipos que a primeira migração criaria. Em bancos sob essa condição e sem histórico prévio de migrações, o `rebase db migrate` não aplica nada: ele lista as tabelas existentes e exibe o comando a ser executado com a versão da migração mais recente preenchida. Ele não grava a baseline por conta própria.

Não há problema algum com a migração — o banco apenas foi provisionado por outro mecanismo. Defina a baseline no ponto em que o banco já se encontra uma única vez; o mesmo comando aplicará as migrações seguintes, e execuções futuras do `rebase db migrate` ocorrerão de forma padrão:

```bash
rebase db migrate --baseline 20260906101530
```

A versão corresponde ao prefixo numérico do arquivo de migração representativo do estado atual do banco *neste momento*. Essa migração e todas as anteriores a ela serão registradas como aplicadas; apenas as posteriores serão executadas. O boot nunca remove nem renomeia colunas; caso uma dessas migrações faça isso, estabeleça a baseline na versão anterior a ela. Em bancos nos quais nenhuma aplicação Rebase jamais foi inicializada, não é necessária baseline — basta executar o migrate diretamente.

A mesma situação pode surgir durante o fluxo rotineiro: ao editar uma tabela com o `rebase dev` em execução, o boot adiciona a coluna antes que o `rebase db generate` crie a migração correspondente; assim, o `rebase db migrate` falhará informando `column … already exists (42701)`. Defina a baseline dessa migração da mesma maneira. A flag `--baseline` opera mesmo em bancos que já possuem histórico de migrações: ela marca todas as migrações até a versão especificada como aplicadas usando `atlas migrate set` e avisa isso, ou informa que não há nada a marcar caso o histórico já tenha alcançado tal versão. Versões inexistentes em `drizzle/migrations` provocam a recusa antes de qualquer execução, exibindo as opções válidas.

### `rebase db branch`

Ramificação de banco de dados (database branching) para desenvolvimento paralelo:

```bash
rebase db branch create feature_auth
rebase db branch switch feature_auth
rebase db branch list
rebase db branch switch --off

rebase db branch info feature_auth
rebase db branch delete feature_auth
```

Os comandos `rebase db branch switch` (e `switch --off`) e `rebase db branch prune`
são novos. `create`, `list`, `info` e `delete` foram introduzidos na versão 0.17.

Cada branch consiste em uma cópia integral do banco criada através de `CREATE DATABASE ... TEMPLATE`,
demandando um servidor PostgreSQL real e ocupando em disco o mesmo espaço da fonte de dados original.

### `rebase doctor`

Identifica divergências (three-way drift) entre as suas tabelas, o schema Drizzle gerado e o banco PostgreSQL em execução:

```bash
rebase doctor
```

**O que ele verifica:**
- Tabelas ↔ Schema gerado — estão em sincronia?
- Schema gerado ↔ Banco de dados — há alterações não aplicadas?
- Tabelas ↔ Banco de dados — existe algum drift inesperado?

Execute o `doctor` sempre que notar qualquer divergência de sincronização. Ele indica exatamente onde está o problema.

A inspeção do banco inclui as mesmas verificações que o boot realiza antes de emitir alertas de divergência entre `schema.generated.ts` e o banco, processadas pelo mesmo código. Assim, qualquer divergência que acione avisos no boot aparecerá no relatório de forma idêntica: colunas configuradas como NOT NULL de um lado e anuláveis do outro, ou colunas mantidas no banco que sumiram do arquivo (o boot nunca remove estruturas; portanto, renomear propriedades mantém a coluna antiga preservada). Todas aparecem como avisos, e a correção sugerida é executar `rebase db push`.

A checagem do banco analisa o banco de dados do projeto, descoberto da mesma forma que `rebase db url` o faz — em um projeto inicial recém-criado, utiliza o banco gerenciado iniciado automaticamente pelo `doctor`. Caso não seja possível identificar o banco, essa verificação é apontada como **ignorada (skipped)** em vez de bem-sucedida, e o comando não finalizará dizendo "All schemas are in sync" — testes não executados não atestam conformidade.

O comando também indica tabelas sem [bloco `search`](/docs/backend/search) que contenham aproximadamente mais de 10.000 linhas. Buscas nesses cenários — através da barra de pesquisa do admin, `.search()`, ou `?searchString=` — executam `ILIKE '%term%'` nas colunas de texto sem apoio de índices, exigindo a leitura completa da tabela e recontagens custosas (cerca de um terço de segundo para 100.000 linhas, crescendo proporcionalmente). O número de linhas vem de estimativas internas do Postgres, dispensando varreduras pesadas. Trata-se de um alerta informativo: não altera o código de saída e nenhum índice é criado automaticamente.

O comando também detecta **junções órfãs (orphaned junctions)**: tabelas no schema `public` com características de tabelas de associação many-to-many que não constam em nenhuma declaração de tabela. O padrão consiste em duas colunas formando a chave primária composta, cada qual referenciando uma tabela declarada. Renomear ou excluir um relacionamento `manyToMany` mantém a tabela de junção anterior no banco, visto que o push e o boot apenas criam tabelas, retendo os vínculos originais. O aviso é meramente informativo e não afeta o código de saída. A sugestão de ajuste exibe a instrução `DROP TABLE`, cabendo ao usuário decidir executá-la.

### `rebase generate-sdk`

Gera um SDK tipado a partir das suas tabelas:

```bash
rebase generate-sdk
```

**O que ele faz:**
- Lê as tabelas que `backend/schema/index.ts` exporta através do mesmo carregador usado na inicialização do backend, assegurando que o SDK descreva fielmente as tabelas disponibilizadas; falhas de compilação no schema abortam a execução
- Gera tipos TypeScript para todas as tabelas em `generated/sdk/`
- Gera um arquivo `database.types.ts` pronto para uso com `createRebaseClient<Database>()`: disponibilizando o tipo `Database`, `TableName` (união de todos os slugs), e `tablesDictionary` / `TablesDictionary`, o mapa entre acessores e slugs

O `rebase dev` executa esse processo automaticamente na inicialização e a cada alteração salva em
`backend/schema/`. Você pode acioná-lo manualmente em rotinas de CI, em repositórios sem
tabelas próprias (verifique `--from` a seguir), ou sempre que o `rebase dev` não estiver rodando.

**Opções:**

| Flag | Descrição |
|------|-----------|
| `--schema-dir` | Diretório do schema (padrão: `backend/schema`, ou a chave `tables` em `rebase.json`); caminhos relativos usam como base o local da execução |
| `-o`, `--output` | Diretório de destino do SDK (padrão: `generated/sdk/`) |
| `--from <link\|url>` | Obtém o schema de um projeto em execução em vez de ler o código local. `link` consulta o projeto associado a este ambiente. |
| `--token` | Token Bearer para autenticação no endpoint de contrato (padrão: `$REBASE_SERVICE_KEY` vindo do shell; arquivos `.env` não são lidos) |
| `--register` | Tipagem para dados server-side: gera as tipagens e declarações `Register` em `backend/generated/`, salvando a preferência em `rebase.json` — consulte [Dados tipados no servidor](/docs/backend/typed-server-data/) |

A flag `--from` viabiliza que repositórios sem declarações de tabelas — frontends
desacoplados, aplicações web secundárias ou apps mobile — criem clientes tipados a partir
do projeto de backend correspondente: ele lê as `tables` expostas em
`/api/meta/contract`. O token `REBASE_SERVICE_KEY` só é encaminhado para o projeto ao qual
este ambiente estiver expressamente vinculado; utilize `--token` para qualquer outro host. Chaves contidas no
`.env` são de uso exclusivo do backend local e nunca são transmitidas externamente.
Mensagens de recusa detalham
o motivo da falha: rejeição de `--token`, falha na chave do shell,
chave omitida para hosts não vinculados, chave presente unicamente no `.env`, ou ausência completa de chave.

**Utilização após a geração:**

```typescript
import { createRebaseClient } from "@rebasepro/client";
import { tablesDictionary, type Database } from "./generated/sdk/database.types";

const client = createRebaseClient<Database>({
    baseUrl: import.meta.env.VITE_API_URL,
    tables: tablesDictionary,
});

// Full type safety and autocomplete
const { data } = await client.data.products.find();
```

Os nomes de campos nos tipos gerados respeitam as definições expostas pela API. A identificação
de tráfego do campo é a chave da sua coluna, e a API adota camelCase integralmente: a introspecção
converte colunas `created_at` em `createdAt: col.timestamp({ withTimezone: true })`, cujo nome SQL
em snake_case é deduzido pela chave, servindo os dados como `row.createdAt`. A coluna
original no banco não é modificada. O *acessor* da tabela é convertido em propriedade
pela mesma regra (`my-notes` → `client.data.myNotes`), sendo esse o mapeamento que o
`tablesDictionary` associa de volta ao slug.

### `rebase migrate`

O comando `rebase migrate collections-to-tables [dir]` move definições de `config/collections` para
`backend/schema` (um `defineTable` por collection, com cada coluna posicionada conforme a
ordem original, na convenção Drizzle, além de `index.ts` com `defaultRls`) e `frontend/src/cms`
(um `customizeTable` para cada collection personalizada, arquivos `defineFirestoreCollection`, `ui-config.json`),
gera `backend/resources.ts`, `backend/storage.ts` e `backend/generated/register.ts`,
insere `rebaseBackendGuard()` no arquivo `vite.config.ts` do scaffold e executa
`rebase migrate sdk-calls`, que converte chamadas `.collection(` em `.table(`, ajusta
outras renomeações do SDK e as origens de regras `existsIn` / `membership` no seu código,
além de migrar importações cujos módulos foram redistribuídos na versão 0.31
([lista completa](/docs/upgrading/0-30-to-0-31-imports/)), inserindo os novos pacotes nas
dependências do projeto ("Dependencies added": execute `pnpm install`). Atualize todos os pacotes `@rebasepro` para a versão 0.31 antes de prosseguir.
Cada execução valida o resultado gerado: todo o SQL produzido — DDL, policies, search,
vector, triggers, views e o schema Drizzle — deve coincidir byte a byte, caso contrário
as mudanças nos arquivos são desfeitas. Incompatibilidades impedem o processo informando arquivo e linha,
e instruções manuais remanescentes são apresentadas em formato de passos numerados, finalizando com
`rebase skills install` caso o projeto utilize agent skills. Seus módulos personalizados em
`config/` continuam preservados; o comando exibe a instrução `git rm` para os recursos migrados. Ele também
acompanha collections de Firestore originadas por funções, aliases de caminhos, painéis instanciados
fora de `App.tsx` e aplicações estáticas desprotegidas ([veja a lista completa](/docs/upgrading/0-30-to-0-31/#108-tables-in-backendschema-replace-configcollections--run-the-codemod-first)).
Concluído o `git rm`, a flag `--check` indicará `already-migrated`.

| Flag | Efeito |
|---|---|
| `--dry-run` | Exibe arquivos, recusas, notas e passos manuais sem salvar alterações. Comece por aqui. |
| `--check` | Em projetos migrados: valida se `backend/schema` gera exatamente o mesmo SQL. Retorna código 1 com a diferença ou se alguma regra alterou de significado. |
| `--accept-rule-changes` | Usado com `--check`: confirma que as regras sob "Review before deploying" foram devidamente revisadas. |
| `--json` / `--force` / `--skip-sdk-calls` | Exibe o relatório em formato JSON (com `ruleChanges`); permite execução com arquivos pendentes no git ou sobre saídas editadas; não altera seu código fonte. |

Analise atentamente duas listagens presentes na saída referente ao SDK: **"Rewritten by name — review"** (receptores sem tipagem, slots de dados, mocks de teste) e **"Left unchanged — check each"**
(renomeie aqueles pertinentes ao SDK; [uma busca](/docs/upgrading/0-30-to-0-31-by-hand/#sdk-calls-no-type-checker-sees) ajuda a localizar os restantes).

A validação de SQL atesta a precisão da conversão técnica, mas não assegura que as regras preservem a
intenção original de negócio. A última etapa da saída, **"Review before deploying: these rules change meaning"**,
aponta todas as regras cujas políticas concedem acessos diferentes dos originais
— um `access: "authenticated"` puro não liberava permissões antes e agora passa a permitir qualquer usuário
autenticado ([consulte os quatro padrões](/docs/upgrading/0-30-to-0-31/#review-before-deploying-these-rules-change-meaning)).
Em seguida, valide com o banco de dados: `rebase db push --dry-run` deverá apresentar "No
changes: the database already matches these tables.", e
`rebase doctor --policies` não deverá acusar drift.

## Fluxo de trabalho de desenvolvimento

O fluxo otimizado para iterações rápidas durante o desenvolvimento:

```bash
# 1. Edite uma tabela em backend/schema/
# 2. Gere o schema Drizzle
rebase schema generate

# 3. Aplique diretamente no banco de desenvolvimento
rebase db push
```

## Fluxo de trabalho de produção

O fluxo seguro e passível de auditoria para ambientes de produção:

```bash
# 1. Edite uma tabela em backend/schema/
# 2. Gere o schema Drizzle
rebase schema generate

# 3. Crie os arquivos de migração SQL
rebase db generate

# 4. Revise o SQL gerado em backend/drizzle/migrations/
# 5. Adicione a migração ao controle de versão
git add backend/drizzle/migrations/

# 6. Aplique em produção
#    Bancos previamente inicializados pelo Rebase necessitam de baseline no primeiro uso —
#    veja "Criando uma baseline de um banco de dados que o Rebase já inicializou" acima.
rebase db migrate
```

## Solução de problemas

| Sintoma | Solução |
|---------|---------|
| `Could not detect an active database plugin` | Instale `@rebasepro/server-postgres` em `backend/package.json` |
| Arquivo de schema não é atualizado | Certifique-se de que `--schema-dir` (ou a chave `tables` em `rebase.json`) aponta para o diretório correto |
| A migração apresenta alterações inesperadas | Execute `rebase doctor` para diagnosticar pontos de drift |
| Falha ao executar `db push` em produção | Utilize `db generate` seguido de `db migrate` para esse fim |
| Migrações em CI ou produção não devem descartar dados | Use `rebase db migrate --refuse-destructive`, que encerra com status 1 sem aplicar nada ao detectar perda potencial de dados |
| `db migrate` para com "already has the tables your migrations create" ou falha com `already exists (42710)` | O boot ou o `db push` já criaram o schema antes — defina a baseline executando o comando `rebase db migrate --baseline <version>` sugerido |
| `db migrate` falha com `column … already exists (42701)` | O `rebase dev` incluiu a coluna durante o boot — defina a baseline dessa migração da mesma forma |
| `db push` no banco de dados gerenciado falha com `Error: EOF` | O Atlas perdeu uma conexão utilizada pela instância ativa do `rebase dev`. Reexecute o comando; persistindo a falha, encerre o `rebase dev` temporariamente |

## Próximos passos

- **[Tabelas](/docs/schema/)** — Defina seu modelo de dados
- **[Referência da CLI](/docs/cli)** — Conheça todos os comandos da CLI
- **[SDK Tipado](/docs/sdk)** — Aprenda a usar o SDK gerado
