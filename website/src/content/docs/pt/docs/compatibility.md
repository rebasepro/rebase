---
sourceHash: fb9fac4af8dcfaaf
slug: pt/docs/compatibility
title: Compatibilidade
description: O que o Rebase promete entre versões e o que não promete — os seis contratos versionados, como cada um falha e o que ainda pode mudar em uma versão minor.
---

O que o Rebase promete entre versões e o que não promete.

Este é o documento a ser lido antes de alterar qualquer coisa da qual um projeto
implantado ou um tenant em execução no Rebase Cloud já dependa. É também a resposta
honesta para "se eu construir no Rebase hoje, o que vai quebrar sob meus pés mais tarde?"

## O que "beta" significa aqui

O Rebase está em beta público. A maioria dos projetos usa essa palavra para
significar "qualquer coisa pode quebrar", o que não diz nada com que o leitor possa se
planejar. Portanto, aqui está o limite que este projeto realmente estabelece:

> **A API contra a qual você escreve código pode mudar em uma versão minor, com uma entrada no changelog.
> Seus dados não podem quebrar silenciosamente.**

A primeira metade é o comportamento comum da `0.x` e é descrita abaixo. A segunda
metade é a parte que vale a pena verificar, pois é uma afirmação sobre mecanismos em
vez de intenções: os contratos versionados na próxima seção são carimbados em um
artefato ou banco de dados, cada um é verificado na inicialização (boot) ou na ingestão, e cada um
**falha de forma ruidosa e específica** em vez de se degradar. Um push de schema que
removeria uma coluna é recusado por um gate destrutivo
(`packages/server-postgres/test/e2e/db-push-safety.test.ts`), e o próprio caminho de
upgrade é um teste: `upgrade-e2e.test.ts` restaura bancos de dados como versões anteriores
os deixaram, executa o caminho de migração atual sobre cada um e assegura que as linhas
sobrevivem — não apenas a inicialização.

O que beta de fato significa: recursos ainda estão ausentes, alguns subsistemas são
mais novos que outros, e a forma de uma aresta imperfeita é algo estar ausente ou
estranho, não corromper algo silenciosamente. Quais subsistemas são quais é publicado
e datado em vez de deixado para ser descoberto — a tabela abaixo é essa publicação.

## Prontidão por subsistema

<span class="since-badge" data-since="0.31">Since 0.31</span>

**Última revisão em 14 de setembro de 2026, com base na 0.21.0.** Releia a cada minor;
uma classificação que não mudou em três versões ou está consolidada ou foi esquecida,
e esta nota está aqui para que a diferença seja verificada.

As três classificações significam:

- **Estável (Stable)** — o formato está consolidado e coberto por um gate no CI. Ele ainda
  pode receber recursos; não será reformulado sob você dentro da 0.x, e uma alteração nele
  que quebraria seu código será anunciada no changelog.
- **Beta** — funciona e é usado em produção, e sabe-se que algo nele ainda tem arestas:
  um limite que você pode atingir, um caso de borda desconfortável, uma decisão de design
  ainda não tomada. A parte imperfeita é citada nas notas, porque "beta" por si só não
  diz nada com que você possa planejar.
- **Experimental** — lançado para que possa ser usado e reportado. Espere encontrar as partes
  que ninguém testou ainda.

| Subsistema | Classificação | No que a classificação se apoia |
|---|---|---|
| REST API + generated SDK | Estável | O contrato de rede (wire contract) é versionado e protegido por gates; `client-sdk-e2e` executa registro → login → leituras no escopo de RLS → refresh → storage → realtime de ponta a ponta |
| Auth — email/password, OAuth, OIDC, magic link, one-time code | Estável | Doze provedores OAuth são fornecidos. O schema de autenticação é um contrato versionado, carimbado e verificado na inicialização |
| Auth — MFA (TOTP) | Beta | Inscrição, verificação e recuperação funcionam e são testadas. A rotação de chaves está implementada para a chave de criptografia; não há interface de administração para redefinir o fator de um usuário bloqueado |
| Row-level security | Estável | O diferencial do produto. `pnpm rls:check` audita um banco de dados ativo contra quinze verificações, e a suíte e2e de RLS roda a cada push |
| Storage | Estável | Local, S3 e GCS. Negação por padrão (default-deny) em produção desde 0.17.0, e o scaffold fornece um hook de autorização |
| Realtime | **Beta** | As assinaturas são combinadas apenas pelo caminho da tabela, portanto N assinantes em uma tabela custam N novas buscas (refetches) no escopo de RLS por escrita. Isso limita uma implantação a algumas centenas baixas de assinantes simultâneos. Correto em qualquer escala; caro além dessa marca |
| Vector search (pgvector) | Beta | Toda coluna vetorial recebe um índice HNSW para distância de cosseno por padrão, ajustável por coluna através de `col.vector({ dimensions, index })` (método, distâncias, parâmetros de construção) ou desativado, o que resulta em uma varredura exata. O pgvector não pode indexar uma coluna com mais de 2.000 dimensões, portanto essas ficam sem índice e realizam varredura |
| Offline sync | Beta | As mutações carregam chaves de idempotência que o servidor respeita, e as falhas de perda de dados encontradas na auditoria de julho foram corrigidas. O modelo de conflito é last-write-wins (a última escrita vence) sem mesclagem por campo |
| Entity history | Estável | Baseado em snapshots, protegido por sua própria suíte de testes |
| Functions and crons | Estável | O ponto de entrada portátil (`@rebasepro/server/functions`) é um contrato versionado com sua própria seção de superfície de API |
| MCP server + agent skills | Beta | `@rebasepro/mcp` roda sobre stdio: cinquenta e três ferramentas, autenticação bearer por projeto, ferramentas destrutivas recusam alvos não locais a menos que haja opt-in. Desde a versão 0.21 o servidor também pode montar um endpoint `/mcp` remoto — OAuth 2.1, dezessete ferramentas de dados (as quatro para saved apps são experimentais), cada chamada sob o próprio RLS do usuário autenticado — desativado a menos que `REBASE_MCP_ENABLED=true`, e apenas Postgres |
| Studio (SQL, schema, RLS, API explorer) | Beta | Usado diariamente em projetos reais. O branching está presente no pacote OSS e deliberadamente não exposto no Rebase Cloud, porque mover uma implantação em execução para uma branch ainda não tem suporte definido |
| CMS + admin panel | Beta | Completo para CRUD, relações, campos de storage e permissões/cargos. **A tabela de dados não possui semântica de grid** — sem `role`, sem `aria-rowindex`, `tabIndex` removido — portanto, usuários de teclado e leitores de tela não conseguem operar a visualização principal. Sem rascunhos, sem conteúdo por localidade, sem rich-text em blocos |
| PGlite managed dev database | Beta | `rebase dev` com configuração zero e sem Docker. Uma sessão por vez, portanto as requisições são serializadas e a concorrência não pode ser reproduzida nele; comandos baseados no Atlas (`db push`, `generate`, `migrate`) planejam contra uma segunda instância temporária do PGlite iniciada para o comando; `db branch` não funciona nele e informa isso |
| Helm chart | Beta | Renderiza a topologia de processos divididos e é publicado no registro OCI a cada versão. O padrão continua sendo um único contêiner |
| `@rebasepro/firebase` | Experimental | Firestore como uma fonte que o painel administrativo lê diretamente, ao lado das tabelas do backend: `defineFirestoreCollection` em `frontend/src/cms`, passado como `externalCollections`. Sem RLS, sem interface SQL; o conjunto de recursos do Postgres não se aplica. O driver do Firestore ignora grupos de filtros `or(...)`/`and(...)`, portanto, uma consulta que use um deles lê todas as linhas permitidas pelos seus filtros simples |
| Rebase Cloud | **Private beta** | Em produção, executando tenants reais, liberado em lotes. Sem autoatendimento |

Duas entradas acima são o custo honesto de publicar esta tabela: o refetch do
realtime e a acessibilidade da tabela de dados são defeitos em aberto, não itens de
roadmap, e ambos estão listados em vez de deixados para o leitor descobrir.

Esta tabela é o que existe. O que ainda não existe está no
[roadmap](https://rebase.pro/roadmap), uma entrada por issue do GitHub, com o
subconjunto necessário para a 1.0 destacado.

## A promessa da 0.x

O Rebase está na `0.x`. Esta seção foi escrita para ser válida para todas as versões
0.x, em vez de apenas uma delas, para que não fique desatualizada a cada lançamento.
**Mudanças da API TypeScript escrita pelo usuário (breaking changes) ainda são permitidas em versões minor**,
e o changelog é onde elas são anunciadas. O que *não* tem permissão para quebrar silenciosamente
é o conjunto de contratos versionados abaixo: cada um é carimbado em um artefato ou banco
de dados, cada um é verificado na inicialização ou no recebimento, e cada um falha
**de forma ruidosa e específica** em vez de se degradar.

Essa distinção é toda a promessa. Uma exportação renomeada custa um erro de compilação
e cinco minutos. Um bundle que inicializa contra o runtime errado e serve dados sutilmente
incorretos custa um incidente, e os contratos existem para que a segunda categoria não
aconteça silenciosamente.

O Rebase Cloud consome exatamente esses contratos e nada mais. Qualquer coisa não
listada aqui é um detalhe de implementação do qual a plataforma não depende.

### Badges de versão e canaries

A documentação é publicada a partir de `main`, portanto uma página pode descrever algo
que nenhuma versão estável possui ainda. Uma badge *Since* indica a primeira versão
estável que a contém, e o texto ao lado dela informa o que a versão anterior faz.

Uma versão canary é uma compilação de `main` numerada como a versão para a qual ela se
destina: `0.25.0-canary.g<commit>` é a `main` naquele commit, depois da 0.24.0 e antes da
0.25.0, e `rebase upgrade --to canary` instala a mais recente. Ela contém tudo o que havia
chegado à `main` quando foi gerada, portanto uma badge indicando sua versão se aplica a
você, e a nota sobre a versão anterior descreve a versão estável da qual você veio.

## Os contratos versionados

Os valores abaixo são lidos do código-fonte; trate as referências de arquivos como a verdade
e esta tabela como o mapa.

```bash
grep -rn "BUNDLE_FORMAT_VERSION =\|RUNTIME_CONTRACT_VERSION =" packages/types/src/types/project_manifest.ts
grep -n "AUTH_SCHEMA_VERSION =" packages/server-postgres/src/auth/schema-version.ts
```

| # | Contrato | Declarado em | Verificado em | Direção de compatibilidade |
|---|---|---|---|---|
| 1 | intervalo de `rebase` em `rebase.json` | no projeto do usuário | CLI no build | o projeto declara quais runtimes aceita |
| 2 | `BUNDLE_FORMAT_VERSION` | `packages/types/src/types/project_manifest.ts` | `packages/server/src/boot/bundle.ts` | **retrocompatível** onde a estrutura permite — formato 3 recusa formatos 1 e 2 |
| 3 | `RUNTIME_CONTRACT_VERSION` | mesmo arquivo | mesmo arquivo | **correspondência exata, em ambas as direções** |
| 4 | `AUTH_SCHEMA_VERSION` | `packages/server-postgres/src/auth/schema-version.ts` | no boot, contra `rebase.schema_meta` | **apenas para frente** — runtime novo migra bancos de dados antigos |
| 5 | `manifest.schemaVersion` | emitido por `rebase build` | enviado pelo SDK como `x-rebase-schema` quando configurado | consultivo — identifica contra qual schema um cliente foi construído |
| 6 | Identificadores derivados de banco de dados | `contracts/derived-names.txt` | `pnpm check:derived-names` | **congelado** — um nome emitido por uma versão nunca é derivado novamente |

### 1 — `rebase` em `rebase.json`

Um intervalo de semver, lido como `engines` em um `package.json`: quais versões de
runtime este projeto aceita. Nomeado `rebase` em vez de `runtime` deliberadamente,
porque `runtime` já significa *quem possui o processo* (`managed` | `custom`) em uma aplicação.

### 2 — `BUNDLE_FORMAT_VERSION` (atualmente 3)

<span class="since-badge" data-since="0.31">Since 0.31</span>

O layout em disco de um bundle compilado. Um runtime recusa um bundle cujo formato seja
mais novo do que o seu e lê um mais antigo onde a estrutura permite, o que permite à
camada gerenciada mover um tenant para uma nova imagem sem que ninguém precise
recompilar seu projeto.

- **1** — `mode: "cms" | "baas" | "static"`, `entry.static` um único diretório,
  `entry.admin` para um admin empacotado.
- **2** — `kind: "backend" | "static"`, `entry.static` uma lista, `entry.admin`
  removido.
- **3** (0.31) — o schema é `entry.tables`, o `backend/schema` compilado, ao lado de
  `entry.resources`, `entry.storage` e `entry.hooks`; `entry.config`, `entry.collections`
  e `entry.usersCollection` foram removidos. **Os formatos 1 e 2 são recusados, não
  atualizados**: eles carregam `config/collections`, o que um runtime que lê
  `backend/schema` não tem como interpretar, e inicializar um deles inspecionaria o
  banco de dados e serviria uma API diferente. A recusa menciona
  `rebase migrate collections-to-tables`; migre o código-fonte e recompile. Essa foi a
  única quebra de retrocompatibilidade, assumida junto com o incremento do contrato de
  runtime abaixo.

**Incremente-o quando** o layout mudar de tal forma que um runtime mais antigo
interpretaria incorretamente um bundle mais novo. O incremento é o que converte
"inicializa e não serve nada" em uma recusa de inicialização.

### 3 — `RUNTIME_CONTRACT_VERSION` (atualmente 2)

A versão major do contrato bundle↔runtime. Distinta da versão do pacote `@rebasepro/server`,
que pode lançar qualquer quantidade de minors e patches enquanto esta permanece inalterada.

**Leia isto antes de alterá-lo.** A verificação é `!==`, e não `>`:

> um bundle direcionado ao contrato *N* roda **apenas** em um runtime que implementa *N*

portanto, incrementá-lo invalida **todos os bundles já compilados**, de uma só vez, até
que cada um seja recompilado. Essa é a severidade pretendida — é a alavanca de "nada antigo
pode rodar aqui" —, mas significa que um incremento é uma migração para toda a frota, não
uma mera nota de versão. Para a camada gerenciada, deve ser sincronizado com a recompilação
do bundle de cada tenant.

Se uma mudança for *aditiva* e os bundles antigos continuarem corretos, ela exige o
`BUNDLE_FORMAT_VERSION` (ou nada), e não este. A versão 0.31 o incrementou para 2,
com o formato de bundle 3: o modelo de schema mudou, e o bundle de cada tenant é
recompilado a partir do código-fonte migrado.

### 4 — `AUTH_SCHEMA_VERSION` (atualmente 2)

Carimbado em `rebase.schema_meta` e comparado na inicialização. Um runtime **recusa-se a
iniciar** em um banco de dados migrado por uma versão mais recente do framework, em vez de
operar em uma estrutura que ele não compreende — durante um rolling deploy, essa é a
diferença entre metade da frota apresentar erros e metade da frota corromper dados.

A migração para frente é automática: `ensureAuthTablesExist` atualiza um banco de dados
mais antigo. Observe que este bloco de migração é deliberadamente envolvido em `try/catch`
e registra logs em vez de lançar exceções — uma inicialização capenga é melhor do que um
crash loop —, portanto **"inicializou" não prova nada**. Cada asserção na suíte de upgrade
lê o catálogo ou os dados reais.

**Incremente-o quando** uma migração não puder ser ignorada por um runtime mais antigo.
Não incremente para uma coluna aditiva e retrocompatível; há um exemplo prático desse
julgamento em `packages/server-postgres/src/auth/ensure-tables.ts`.

### 5 — `manifest.schemaVersion`

Um hash dos descritores de tabela compilados (`v2:…` desde 0.31), emitido no manifesto do
bundle e retornado por um SDK gerado no cabeçalho `x-rebase-schema` (`SCHEMA_VERSION_HEADER`).
Ele existe para que a plataforma possa dizer "este app foi construído com base em um schema mais
antigo" em vez de falhar misteriosamente na primeira requisição.

`rebase generate-sdk` grava o valor em `schema.meta.ts`; passe-o para o cliente para enviá-lo:

```typescript
import { SCHEMA_VERSION } from "./generated/sdk/schema.meta";

const rebase = createRebaseClient<Database>({
    baseUrl: "http://localhost:3001",
    tables: tablesDictionary,
    schemaVersion: SCHEMA_VERSION,
});
```

O backend lê esse cabeçalho em cada requisição de dados. A divergência (drift) nunca recusa
uma chamada — um SDK um schema atrás geralmente ainda é compatível, e lançar o backend antes
do frontend é a ordem normal de deploy —, mas quando uma requisição falha com 400 ou 404,
o erro traz a divergência como sua causa:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Unknown field \"authorName\" on table \"posts\"",
    "cause": {
      "code": "SCHEMA_DRIFT",
      "clientSchema": "v2:0e1c…",
      "serverSchema": "v2:9ab4…",
      "message": "This client was generated against schema v2:0e1c…; this backend serves v2:9ab4…"
    }
  }
}
```

Assim, uma coluna renomeada é interpretada como "seu SDK está desatualizado, regenere-o", em
vez de um campo que seus próprios tipos insistem que existe. Uma requisição bem-sucedida
nunca recebe esse aviso.

Cobre **apenas tabelas** — seus descritores compilados, nos quais um hook é apenas uma
flag de presença. O código de um hook ou a edição de uma function não altera o contrato do
cliente e não deve invalidar todos os SDKs gerados. Como a versão 0.31 moveu o hash de coleções
para descritores, todo banco de dados carimbado com `v1:` reporta a alteração uma vez, com
a revalidação do carimbo (inicialize o proprietário do schema, ou execute `rebase db push`),
e todo SDK gerado é lido como desatualizado uma vez.

### Quem está chamando

Mais dois sinais de identificação, nenhum dos quais bloqueia algo por conta própria:

- **`GET /api/meta/schema-version`** não requer autenticação e responde com o `schemaVersion`
  do projeto *e* seu `runtime` (`version` e `contract`). Um job de CI comparando seu SDK
  gerado com um projeto em produção não precisa de credenciais, nem um cliente perguntando
  com qual runtime está se comunicando.
- **`User-Agent: rebase-cli/<version>`** vai em todas as requisições `rebase cloud`. O formato
  de rede do control plane evolui à frente do que é publicado no npm, portanto ele precisa
  ser capaz de responder a um cliente antigo com `CLI_TOO_OLD` e a versão mínima — o que só
  pode fazer para um chamador que identifica quem é.

### 6 — Identificadores derivados de banco de dados

<span class="since-badge" data-since="0.31">Since 0.31</span>

Todo nome que este framework calcula por conta própria em vez de ser informado: uma coluna de
chave estrangeira (foreign key), uma restrição (constraint) de chave estrangeira, uma tabela
de junção e suas duas colunas de chave, um tipo enum, um nome de policy, a coluna em
`snake_case` de uma chave de coluna em `camelCase`. Desde a versão 0.31 as tabelas são
declaradas com `defineTable`, que deriva exatamente os nomes que uma coleção derivava para um
schema equivalente; `rebase migrate collections-to-tables` comprova isso projeto por projeto
comparando o SQL gerado byte a byte.

> **Um identificador derivado é congelado no momento em que uma versão o emite.**

Não "congelado até a próxima versão major" — congelado. O raciocínio é diferente dos outros
cinco contratos, e mais forte. Aqueles são versionados, então uma incompatibilidade pode ser
*detectada* e recusada. Este não pode: o nome é gravado no banco de dados do cliente no dia do
deploy, e não há carimbo de versão em uma coluna. Cada banco de dados provisionado por qualquer
versão já lançada carrega o que quer que tenha sido derivado, e nenhum código neste repositório
pode acessá-los e renomear a todos.

A versão 0.13 é o exemplo prático. `generateForeignKeyName` aprendeu a singularizar corretamente —
`categorie_id` → `category_id`, `addres_id` → `address_id` —, o que é sem dúvida a melhor
derivação, e quebrou todos os bancos de dados antigos que tinham um plural irregular. O
boot-ensure migrou a coluna, então os dados sobreviveram; o `schema.generated.ts` commitado do
projeto não, e a inicialização falhou em uma coluna que já existia. Três commits, um novo teste
de integração (seam test) e uma entrada permanente nas notas de upgrade, em troca de um nome de
coluna mais bonito pelo qual ninguém havia pedido.

**Se uma derivação estiver genuinamente incorreta**, ela muda para as tabelas criadas
*posteriormente*, sob uma estratégia de nomenclatura registrada no projeto — nunca retroativamente,
e nunca como efeito colateral de melhorar a função subjacente.

**A única sobreposição legítima** é uma alteração que faz o código concordar com um nome que o
banco de dados *já possui*. O exemplo prático é o truncamento de identificadores: o Postgres
corta silenciosamente um identificador para 63 bytes, então um nome de restrição derivado mais
longo nunca foi o nome presente no catálogo — a derivação estava descrevendo um objeto que não
existia com aquela grafia, e o boot-ensure reexecutava `ADD CONSTRAINT` a cada inicialização
porque sua comparação nunca coincidia. Truncar na construção altera o que este repositório
*deriva* e não altera nada do que qualquer banco de dados implantado *contém*. Esse é o teste
a ser aplicado: não "o novo nome é melhor", mas "algum banco de dados existente precisa ser
alterado?".

O outro caso em que um nome pode mudar é um conjunto de nomes que nunca poderiam coexistir.
Uma regra cobrindo várias operações em uma tabela de 42 bytes ou mais derivava
`<table>_default_admin_write_insert`, `_update` e `_delete`, e todas as três eram cortadas para
os mesmos 63 bytes. O Postgres armazenava apenas uma policy, DELETE, e recusava todos os INSERT e
UPDATE de admin. Somente quando os nomes de uma regra colidem dessa forma é que eles são derivados
com sufixo primeiro, como `<head>_<hash8>_<op>`. Todo nome que funciona hoje mantém sua grafia.
O próximo boot ou push descarta a política truncada única e cria uma policy para cada operação.

A única coisa que é sempre segura é *reconhecer* um nome antigo para migrá-lo:
`legacyForeignKeyName` existe para ser detectado, nunca para ser gerado, e a linha de base fixa
essas detecções também. Remover uma detecção desfaz silenciosamente a migração de qualquer banco
de dados que ainda carregue essa grafia.

**O gate.** `tooling/scripts/derived-names.mts` executa uma fixture de estresse de nomenclatura —
plurais irregulares, terminação com `ss`, siglas, uma junção a partir de um slug no plural,
sobreposições explícitas, um slug longo o suficiente para truncar — em ambos os geradores de
DDL de schema, e renderiza cada identificador nomeado por qualquer um deles:

```bash
pnpm check:derived-names
```

Uma linha alterada ou removida falha como uma quebra de contrato, com a grafia antiga e a nova
lado a lado. Uma alteração puramente aditiva também falha, mas com "regenerate" — para que a linha
de base não divirja sem que ninguém perceba.

Ele também garante que o `rebase db push` e o boot-ensure do runtime gerenciado derivem os
*mesmos* nomes, o que é um segundo contrato oculto dentro do primeiro: eles compilam as mesmas
tabelas por meio de códigos diferentes, e um projeto enviado com push uma vez e inicializado
mais tarde não pode terminar com dois schemas.

## O que *não* está congelado

<span class="since-badge" data-since="0.31">Since 0.31</span>

Dito claramente, para que ninguém deduza uma promessa que nunca foi feita:

- A API TypeScript de autoria do usuário — `defineTable` e `customizeTable`, opções de
  `initializeRebaseBackend`, props do admin, nomes de métodos do SDK. A versão 0.31 substituiu
  coleções por tabelas em uma versão minor, com um codemod que comprova que o SQL gerado
  permaneceu inalterado. Breaking changes são introduzidas em minors e anunciadas no changelog.
- `@rebasepro/studio`, `@rebasepro/mcp`, `@rebasepro/inference`,
  `@rebasepro/plugin-*` — estes evoluem mais rápido e possuem menos consumidores.
- Qualquer coisa sob o `src/` de um pacote que não seja reexportada a partir do seu barrel.
  `packages/client/src/index.ts` traz uma nota explicando que sua lista de exportações é mantida
  rigorosamente para que uma exportação interna não se torne pública por acidente.
- O schema de banco de dados das *suas* tabelas. Isso pertence a você; o Rebase possui apenas o
  schema `rebase` (e, em um banco provisionado antes da 0.13, o schema antigo `auth` até que o
  boot o desative).

## Os gates que garantem isso

Nada do que foi dito acima é uma convenção — cada item tem um teste que falha quando quebra:

| Gate | O que ele fixa |
|---|---|
| `pnpm verify:corpus` | cada formato de bundle já lançado, inicializado no runtime de hoje. As fixtures em `tests/fixtures/bundles/` são **escritas à mão e congeladas** — uma fixture que o construtor regenera se altera sempre que o construtor é modificado |
| `pnpm verify:selfhost` | um bundle real compilado, empacotado, inicializado e requisitado como um navegador faria |
| `upgrade-e2e.test.ts` | schemas antigos de banco de dados (`schema-snapshots/`) recebidos pelo runtime atual |
| `tests/e2e/tests/cli-init-e2e.ts` | um projeto estruturado (scaffolded) instalado a partir de **tarballs reais**, não de links de workspace |
| `tests/e2e/tests/client-sdk-e2e.ts` | o fluxo do usuário final: registro → login → leituras no escopo de RLS → refresh → storage → realtime |
| `pnpm check:derived-names` | cada nome de coluna, restrição, junção, enum e policy que o framework deriva — e que o boot e o `db push` os derivam identicamente |
| `pnpm rls:check` | as policies do schema gerado |
| `pnpm check:api-surface` | cada exportação, e seus membros, dos cinco pacotes fornecidos pela imagem — `@rebasepro/server`, `types`, `client`, `common`, `utils` — além do ponto de entrada `@rebasepro/server/functions`, contra as seis seções de `contracts/server.api.txt`. Estes são os pacotes que `infra/docker/entrypoint.mjs` conecta via symlink sobre as cópias próprias de um bundle implantado, portanto remover uma exportação de um deles não é um erro de compilação para ninguém — é uma falha de inicialização em toda a frota, durante um rollout que ninguém pediu |
| `pnpm test:gates` | os testes dos próprios gates, sobre fixtures — quarenta e sete arquivos, `check:api-surface` e a verificação de release-bump abaixo entre eles — para que um gate que pare de enxergar o que protege falhe aqui. O `check:api-surface` passou toda a sua vida sem conseguir enxergar um membro desaparecer de `const rebase` |
| `node tooling/scripts/check-release-bump.mjs` | que o nível de bump sob o qual uma versão é lançada corresponde ao que a versão fez nas linhas de base acima — executado por `publish.yml` antes de o changelog ser carimbado |
| CI do SaaS | o control plane compilado contra a `main` deste repositório, em seus próprios pushes e nightly |

**Grave uma fixture de bundle e um snapshot de schema uma vez por versão.** O valor de
ambos os corpora reside inteiramente em quão longe no passado o mais antigo alcança, e nenhum
deles pode ser preenchido retroativamente depois do fato.

### Ainda não protegido por gates

A tabela acima é o que está garantido. Estas são as partes da política que nada garante
ainda, listadas para que ninguém pressuponha promessas nelas:

- **Sem janela de descontinuação (deprecation) ou suporte.** Enquanto o Rebase estiver na
  `0.x`, não há uma regra definida de quanto tempo uma exportação descontinuada sobrevive
  antes da remoção, ou por quanto tempo uma versão minor anterior recebe correções.
  Correções de segurança são lançadas apenas na versão minor mais recente.
- **O formato de rede HTTP não tem gate.** Nenhum script `check:*` compara os formatos de
  requisição e resposta contra uma linha de base da maneira que `check:api-surface` compara
  exportações; uma alteração no formato de resposta só é capturada por uma suíte e2e que por
  acaso a leia.
- **Flags da CLI não possuem linha de base de compatibilidade.** O verificador de documentação
  falha quando uma flag que as skills, os exemplos ou o site de marketing usam desaparece;
  nada nota se qualquer outra flag sumir ou se uma flag mudar de significado.
- **Um release de CI não grava nenhum dos corpora.** O fluxo de trabalho de publicação não
  grava nenhuma fixture de bundle nem snapshot de schema; apenas o script de release local
  tenta fazê-lo, e ele emite um aviso em vez de parar quando não consegue. Da versão 0.18 à
  0.21 não há nenhum snapshot de projeto registrado.
- **A superfície de exportação é um gate, não um contrato.** Se as exportações públicas dos
  pacotes fornecidos pelo runtime se tornarão um sétimo contrato numerado — declarado como
  a linha de base de `check:api-surface`, compatível de forma aditiva dentro de uma major de
  contrato — é uma decisão em aberto.

## Alterando um contrato

1. Decida qual dos seis se trata. A maioria das mudanças não é nenhum deles — mas "nenhum dos
   seis" não significa "incontroverso". Remover ou renomear uma exportação de
   `@rebasepro/server`, ou um membro dela, não é nenhum dos seis e é a alteração mais perigosa
   de todo o repositório, porque o código que ela quebra já está compilado e não será
   recompilado. O `pnpm check:api-surface` é o que sustenta essa linha; se ele se tornará um
   sétimo contrato numerado é uma decisão em aberto (consulte *Ainda não protegido por gates*,
   acima).
2. Adicione primeiro uma fixture ou snapshot para o formato **antigo** e confirme que ela
   passa no teste.
3. Faça a alteração e incremente a constante.
4. Confirme se a fixture antiga ainda passa, ou se agora falha *com a mensagem que um usuário
   precisaria ver*. Ambos são resultados válidos; o silêncio não é.
5. Para o contrato 3, planeje a recompilação de cada bundle implantado antes de fazer o merge.
6. O contrato 6 é a exceção aos passos 3 e 4: não há constante para incrementar nem versão para
   recusar, porque uma coluna não traz carimbo de versão. O passo que os substitui é decidir
   não fazer a alteração — veja a seção acima para entender como é a alternativa.

## Relacionados

- [Atualizando](/docs/upgrading/) — o que realmente quebrou, versão por versão
- [Changelog](/docs/changelog/) — todas as mudanças, incluindo aquelas que não quebraram nada
- [Runtime & Bundles](/docs/architecture/runtime-and-bundles/) — contrato 3 — o formato de bundle contra o qual um projeto implantado já foi compilado
