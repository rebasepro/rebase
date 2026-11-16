---
sourceHash: 717728adb9ef96cc
slug: pt/docs/compatibility
title: Compatibilidade
description: O que o Rebase promete entre versões e o que não promete — os seis contratos versionados, como cada um falha e o que ainda pode mudar em uma versão minor.
---

O que o Rebase promete entre versões e o que não promete.

Este é o documento para ler antes de alterar qualquer coisa da qual um projeto
implantado ou um tenant em execução no Rebase Cloud já dependa. É também a
resposta honesta para "se eu desenvolver no Rebase hoje, o que vai quebrar para
mim mais tarde?"

## O que "beta" significa aqui

O Rebase está em beta público. A maioria dos projetos usa essa palavra para
significar "qualquer coisa pode quebrar", o que não diz ao leitor nada sobre o
que ele possa planejar, então aqui está o limite que este projeto realmente
estabelece:

> **A API com a qual você programa pode mudar em uma versão minor, com uma entrada no changelog.
> Seus dados não podem quebrar silenciosamente.**

A primeira metade é o comportamento comum da `0.x` e é descrita abaixo. A
segunda metade é a parte que vale a pena verificar, pois é uma afirmação sobre
mecanismos e não sobre intenções: os contratos versionados na próxima seção são
carimbados em um artefato ou banco de dados, cada um é verificado na inicialização
(boot) ou na entrada (intake), e cada um **falha de forma ruidosa e específica**
em vez de se degradar. Um envio de schema (schema push) que removeria uma coluna
é recusado por uma barreira destrutiva
(`packages/server-postgres/test/e2e/db-push-safety.test.ts`), e o próprio caminho
de atualização é um teste: o `upgrade-e2e.test.ts` restaura bancos de dados como
versões anteriores os deixaram, executa o caminho de migração atual sobre cada um
e assegura que as linhas sobrevivam — não apenas que a inicialização tenha
ocorrido.

O que beta realmente significa: recursos ainda estão faltando, alguns subsistemas
são mais novos que outros, e o formato de uma aresta imperfeita é que algo está
ausente ou é desajeitado, não que algo corrompa dados silenciosamente. O estado de
cada subsistema é publicado e datado em vez de ser deixado para você descobrir — a
tabela abaixo é essa publicação.

## Prontidão por subsistema

**Última revisão em 14 de setembro de 2026, em relação à 0.21.0.** Releia a cada
minor; uma classificação que não mudou em três lançamentos está consolidada ou foi
esquecida, e esta nota está aqui para que a diferença seja verificada.

As três classificações significam:

- **Estável** — o formato está consolidado e coberto por um gate no CI. Ainda pode
  receber novos recursos; não será redesenhado de surpresa dentro da 0.x, e qualquer
  alteração que possa quebrar algo será anunciada no changelog.
- **Beta** — funciona e é usado em produção, e algo nele é sabidamente imperfeito:
  um limite que você pode atingir, um caso de borda desconfortável, uma decisão de
  design ainda não tomada. A parte imperfeita é nomeada nas notas, porque "beta" por
  si só não informa nada com o que você possa se planejar.
- **Experimental** — lançado para que possa ser usado e reportado. Espere encontrar
  as partes que ninguém usou ainda.

| Subsistema | Classificação | No que a classificação se baseia |
|---|---|---|
| REST API + SDK gerado | Estável | O contrato de transmissão (wire contract) é versionado e validado por gates; o `client-sdk-e2e` conduz o fluxo cadastro → login → leituras no escopo de RLS → atualização de token (refresh) → armazenamento → tempo real (realtime) de ponta a ponta |
| Autenticação — e-mail/senha, OAuth, OIDC, magic link, código de uso único | Estável | Doze provedores OAuth inclusos. O schema de autenticação é um contrato versionado, carimbado e verificado no boot |
| Autenticação — MFA (TOTP) | Beta | Registro, verificação e recuperação funcionam e são testados. A rotação de chaves está implementada para a chave de criptografia; não há interface de administração para redefinir o fator de um usuário bloqueado |
| Row-level security | Estável | A peça fundamental do produto. O comando `pnpm rls:check` audita um banco de dados ativo em relação a quinze verificações, e a suíte de e2e de RLS é executada a cada push |
| Armazenamento (Storage) | Estável | Local, S3 e GCS. Negação por padrão (default-deny) em produção desde a 0.17.0, e o scaffolding inclui um hook de autorização |
| Tempo real (Realtime) | **Beta** | Cada frame é uma leitura sob o próprio escopo RLS de seu assinante. Os sockets de um usuário em uma lista compartilham essa leitura, e uma lista filtrada por uma coluna da linha (`where owner == me`) só é consultada quando uma escrita puder atingi-la: 5.000 usuários, cada um observando suas próprias linhas, custam **uma** leitura por escrita, ~305 ms para entrega (medido, `tooling/scripts/bench-realtime-fanout.mts`). O limite é uma lista que apenas o RLS restringe: uma leitura por usuário distinto por escrita; portanto, 5.000 usuários na mesma lista não filtrada geram 5.000 leituras e ~2,6 s para o fan-out terminar. Correto em qualquer escala; filtre pela coluna que a política lê para manter em uma leitura |
| Busca vetorial (pgvector) | Beta | Toda coluna vetorial recebe um índice HNSW para distância de cosseno por padrão, ajustável por coluna via `col.vector({ dimensions, index })` (método, distâncias, parâmetros de construção) ou desativado, o que mantém uma varredura exata. O pgvector não pode indexar uma coluna com mais de 2.000 dimensões, portanto, essas ficam sem índice e realizam varredura |
| Sincronização offline | Beta | As mutações carregam chaves de idempotência que o servidor respeita, e os defeitos de perda de dados encontrados na auditoria de julho foram corrigidos. O modelo de conflito é last-write-wins (última escrita vence) sem mesclagem por campo |
| Histórico de entidades | Estável | Baseado em snapshots, validado por sua própria suíte de testes |
| Functions e crons | Estável | O ponto de entrada portátil (`@rebasepro/server/functions`) é um contrato versionado com sua própria seção de superfície de API |
| Servidor MCP + agent skills | Beta | O `@rebasepro/mcp` executa via stdio: cinquenta e três ferramentas, autenticação bearer por projeto, ferramentas destrutivas recusam alvos não locais a menos que haja consentimento explícito. Desde a 0.21, o servidor também pode montar um endpoint remoto `/mcp` — OAuth 2.1, dezessete ferramentas de dados (as quatro para apps salvos são experimentais), cada chamada sob o próprio RLS da pessoa autenticada — desativado a menos que `REBASE_MCP_ENABLED=true`, e apenas para Postgres |
| Studio (SQL, schema, RLS, API explorer) | Beta | Usado diariamente em projetos reais. O branching está presente no pacote OSS e foi deliberadamente não exposto no Rebase Cloud, pois mover uma implantação em execução para uma branch ainda não tem um fluxo definido |
| CMS + painel de administração | Beta | Completo para CRUD, relações, campos de armazenamento e funções (roles). **A tabela de dados não possui semântica de grade (grid)** — sem `role`, sem `aria-rowindex`, `tabIndex` removido — de modo que usuários de teclado e leitores de tela não conseguem operar a visualização principal. Sem rascunhos, sem conteúdo por localidade (per-locale), sem rich text em blocos |
| Banco de desenvolvimento gerenciado PGlite | Beta | `rebase dev` com configuração zero, sem Docker. Uma sessão por vez, logo as requisições são serializadas e a concorrência não pode ser reproduzida contra ele; comandos baseados no Atlas (`db push`, `generate`, `migrate`) planejam contra um segundo PGlite descartável iniciado para o comando; o `db branch` não funciona nele e informa isso |
| Helm chart | Beta | Renderiza a topologia de processos divididos e é publicado no registro OCI a cada lançamento. O padrão continua sendo um único contêiner |
| `@rebasepro/firebase` | Experimental | Firestore como uma fonte que o painel de administração lê diretamente, ao lado das tabelas do backend: `defineFirestoreCollection` em `frontend/src/cms`, passado como `externalCollections`. Sem RLS, sem interface SQL; o conjunto de recursos do Postgres não é transferido. O driver do Firestore ignora grupos de filtros `or(...)`/`and(...)`, portanto, uma consulta que use um deles lê todas as linhas permitidas pelos seus filtros simples |
| Rebase Cloud | **Beta privado** | Ativo, executando tenants reais, liberado em lotes. Sem autoatendimento (self-serve) |

Duas entradas acima são o custo honesto de publicar esta tabela: o fan-out em
tempo real para listas restringidas apenas pelo RLS e a acessibilidade da tabela
de dados são limitações abertas, não itens de roadmap, e ambas estão listadas em
vez de serem deixadas para o leitor descobrir.

Esta tabela é o que existe. O que ainda não existe está no
[roadmap](https://rebase.pro/roadmap), uma entrada por issue do GitHub, com o
subconjunto necessário para a versão 1.0 destacado.

## A promessa da 0.x

O Rebase está na versão `0.x`. Esta seção foi escrita para valer para cada versão
0.x em vez de apenas uma delas, para que não fique desatualizada a cada lançamento.
**Breaking changes na API TypeScript criada ainda são permitidas em uma minor**, e
o changelog é onde elas são anunciadas. O que *não* tem permissão para quebrar
silenciosamente é o conjunto de contratos versionados abaixo: cada um é gravado em
um artefato ou banco de dados, cada um é verificado no boot ou na entrada, e cada
um falha **de forma ruidosa e específica** em vez de se degradar.

Essa distinção é toda a promessa. Uma exportação renomeada custa um erro de
compilação e cinco minutos. Um bundle que inicializa com o runtime errado e serve
dados sutilmente incorretos custa um incidente, e os contratos existem para que a
segunda categoria não possa acontecer silenciosamente.

O Rebase Cloud consome exatamente esses contratos e nada mais. Qualquer coisa não
listada aqui é um detalhe de implementação do qual a plataforma não depende.

### Badges de versão e canaries

A documentação é publicada a partir da branch `main`, portanto, uma página pode
descrever algo que nenhuma versão estável possui ainda. Um badge *Since* indica a
primeira versão estável que a inclui, e o texto ao lado informa o que a versão
anterior faz.

Uma versão canary é uma compilação da `main` numerada de acordo com a versão
para a qual ela está caminhando: `0.25.0-canary.g<commit>` é a `main` naquele
commit, após a 0.24.0 e antes da 0.25.0, e o comando `rebase upgrade --to canary`
instala a mais recente. Ela traz tudo o que havia chegado à `main` quando foi
compilada, portanto, um badge indicando sua versão se aplica a você, e a
observação sobre a versão anterior descreve a versão estável da qual você veio.

## Os contratos versionados

Os valores abaixo são lidos diretamente do código-fonte; trate as referências
de arquivos como a verdade e esta tabela como o mapa.

```bash
grep -rn "BUNDLE_FORMAT_VERSION =\|RUNTIME_CONTRACT_VERSION =" packages/types/src/types/project_manifest.ts
grep -n "AUTH_SCHEMA_VERSION =" packages/server-postgres/src/auth/schema-version.ts
```

| # | Contrato | Declarado em | Verificado em | Direção da compatibilidade |
|---|---|---|---|---|
| 1 | intervalo de `rebase` em `rebase.json` | o projeto do usuário | CLI no momento da compilação (build) | o projeto declara quais runtimes ele aceita |
| 2 | `BUNDLE_FORMAT_VERSION` | `packages/types/src/types/project_manifest.ts` | `packages/server/src/boot/bundle.ts` | **compatível com versões anteriores** onde o layout permitir — o formato 3 recusa os formatos 1 e 2 |
| 3 | `RUNTIME_CONTRACT_VERSION` | mesmo arquivo | mesmo arquivo | **correspondência exata, em ambas as direções** |
| 4 | `AUTH_SCHEMA_VERSION` | `packages/server-postgres/src/auth/schema-version.ts` | no boot, contra `rebase.schema_meta` | **somente para a frente (forward only)** — um novo runtime migra bancos de dados antigos |
| 5 | `manifest.schemaVersion` | emitido por `rebase build` | enviado pelo SDK como `x-rebase-schema` quando configurado | consultivo — identifica contra qual schema um cliente foi compilado |
| 6 | Identificadores derivados do banco de dados | `contracts/derived-names.txt` | `pnpm check:derived-names` | **congelado** — um nome que uma versão emitiu nunca é rederivado |

### 1 — `rebase` no `rebase.json`

Um intervalo semver, lido como `engines` em um `package.json`: quais versões de
runtime este projeto aceita. Nomeado deliberadamente como `rebase` em vez de
`runtime`, porque `runtime` já significa *quem possui o processo* (`managed` |
`custom`) em uma aplicação.

### 2 — `BUNDLE_FORMAT_VERSION` (atualmente 3)

O layout em disco de um bundle compilado. Um runtime recusa um bundle cujo
formato seja mais novo que o seu e lê um mais antigo onde o layout permitir, o
que permite à camada gerenciada mover um tenant para uma nova imagem sem que
ninguém precise recompilar seu projeto.

- **1** — `mode: "cms" | "baas" | "static"`, `entry.static` como um diretório
  único, `entry.admin` para um admin empacotado.
- **2** — `kind: "backend" | "static"`, `entry.static` como uma lista,
  `entry.admin` removido.
- **3** (0.31) — o schema é `entry.tables`, o `backend/schema` compilado, ao lado
  de `entry.resources`, `entry.storage` e `entry.hooks`; `entry.config`,
  `entry.collections` e `entry.usersCollection` foram removidos. **Os formatos 1
  e 2 são recusados, não atualizados**: eles contêm `config/collections`, para os
  quais um runtime que lê `backend/schema` não tem como interpretar, e inicializar
  um deles inspecionaria o banco de dados e serviria uma API diferente. A recusa
  menciona `rebase migrate collections-to-tables`; migre o código-fonte e
  recompile. Esta foi a única quebra de compatibilidade com versões anteriores,
  feita junto com o incremento do contrato de runtime abaixo.

**Incremente-o quando** o layout mudar de tal forma que um runtime mais antigo
interprete incorretamente um bundle mais novo. O incremento é o que converte um
"inicializa e não serve nada" em uma recusa de inicialização.

### 3 — `RUNTIME_CONTRACT_VERSION` (atualmente 2)

A versão principal (major) do contrato bundle↔runtime. É distinta da versão do
pacote `@rebasepro/server`, que pode lançar qualquer quantidade de minors e
patches enquanto esta permanece inalterada.

**Leia isto antes de alterá-lo.** A verificação é `!==`, não `>`:

> um bundle direcionado ao contrato *N* executa **apenas** em um runtime que implemente *N*

portanto, incrementá-lo invalida **todos os bundles já compilados**, de uma só vez,
até que cada um seja recompilado. Essa é a severidade intencional — é a alavanca
de "nada antigo pode rodar aqui" —, mas significa que um incremento é uma migração
em toda a frota, não uma nota de lançamento. Para a camada gerenciada, ele deve ser
coordenado com a recompilação do bundle de cada tenant.

Se uma alteração for *aditiva* e os bundles antigos continuarem corretos, ela deve
alterar `BUNDLE_FORMAT_VERSION` (ou nada), e não este. A versão 0.31 o incrementou
para 2, com o formato de bundle 3: o modelo de schema mudou e o bundle de cada
tenant é recompilado a partir do código-fonte migrado.

### 4 — `AUTH_SCHEMA_VERSION` (atualmente 2)

Gravado em `rebase.schema_meta` e comparado no boot. Um runtime **recusa-se a
iniciar** em um banco de dados migrado por uma versão mais recente do framework, em
vez de operar sobre uma estrutura que ele não compreende — durante um rolling
deployment, essa é a diferença entre metade da frota apresentar erros e metade da
frota corromper dados.

A migração para a frente é automática: o `ensureAuthTablesExist` atualiza um banco
de dados mais antigo. Observe que este bloco de migração é deliberadamente
envolvido em `try/catch` e registra logs em vez de lançar exceções — uma
inicialização claudicante é melhor que um crash loop —, portanto **"ele
inicializou" não prova nada**. Cada asserção na suíte de upgrade lê o catálogo ou
os dados reais.

**Incremente-o quando** uma migração não puder ser ignorada por um runtime mais
antigo. Não incremente para uma coluna aditiva e compatível com versões anteriores;
há um exemplo prático desse critério em
`packages/server-postgres/src/auth/ensure-tables.ts`.

### 5 — `manifest.schemaVersion`

Um hash dos descritores de tabelas compilados (`v2:…` desde a 0.31), emitido no
manifesto do bundle e replicado por um SDK gerado no cabeçalho `x-rebase-schema`
(`SCHEMA_VERSION_HEADER`). Ele existe para que a plataforma possa dizer "esta
aplicação foi compilada contra um schema mais antigo" em vez de falhar
misteriosamente na primeira requisição.

O comando `rebase generate-sdk` grava o valor em `schema.meta.ts`; passe-o para o
cliente enviá-lo:

```typescript
import { SCHEMA_VERSION } from "./generated/sdk/schema.meta";

const rebase = createRebaseClient<Database>({
    baseUrl: "http://localhost:3001",
    tables: tablesDictionary,
    schemaVersion: SCHEMA_VERSION,
});
```

O backend lê esse cabeçalho a cada requisição de dados. O descompasso (drift)
nunca recusa uma chamada — um SDK com uma versão de schema defasada geralmente
ainda é compatível, e implantar o backend antes do frontend é a ordem normal de
deploy —, mas quando uma requisição falha com um 400 ou 404, o erro carrega o
drift como sua causa:

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

Assim, uma coluna renomeada é interpretada como "seu SDK está desatualizado, gere-o
novamente", em vez de um campo que seus próprios tipos insistem que existe. Uma
requisição bem-sucedida nunca recebe esse aviso.

Ele cobre **apenas tabelas** — seus descritores compilados, nos quais um hook é
uma flag de presença. O código de um hook ou a edição de uma função não altera o
contrato do cliente e não deve invalidar todos os SDKs gerados. Como a versão 0.31
mudou o hash de coleções para descritores, todo banco de dados carimbado com `v1:`
relata a alteração uma vez, com a revalidação da marcação (ao inicializar o schema
owner ou executar `rebase db push`), e todo SDK gerado é interpretado como
desatualizado uma vez.

### Quem está chamando

Mais dois sinais de identificação, nenhum dos quais funciona como barreira (gate)
por si só:

- **`GET /api/meta/schema-version`** não exige autenticação e responde com a
  `schemaVersion` do projeto *e* seu `runtime` (`version` e `contract`). Um job de
  CI comparando seu SDK gerado com um projeto em execução não precisa de
  credenciais, assim como um cliente perguntando com qual runtime está se
  comunicando.
- **`User-Agent: rebase-cli/<version>`** é incluído em cada requisição para `rebase cloud`.
  O formato de rede do plano de controle evolui à frente do que é publicado no
  npm, portanto, ele precisa ser capaz de responder a um cliente antigo com
  `CLI_TOO_OLD` e a versão mínima — o que só pode fazer para um chamador que se
  identifica.

### 6 — Identificadores derivados do banco de dados

Todo nome que este framework infere por conta própria em vez de receber
explicitamente: uma coluna de chave estrangeira, uma restrição (constraint) de
chave estrangeira, uma tabela de junção e suas duas colunas de chave, um tipo enum,
um nome de política, a coluna em `snake_case` correspondente a uma chave de coluna
em `camelCase`. Desde a 0.31, as tabelas são declaradas com `defineTable`, que
deriva exatamente os mesmos nomes que uma collection derivava para um schema
equivalente; o comando `rebase migrate collections-to-tables` comprova isso por
projeto, comparando o SQL gerado byte a byte.

> **Um identificador derivado fica congelado no momento em que uma versão o emite.**

Não "congelado até a próxima major" — congelado. O motivo é diferente dos outros
cinco contratos e mais rígido. Aqueles são versionados, então uma incompatibilidade
pode ser *detectada* e recusada. Este não pode: o nome é gravado no banco de dados do
cliente no dia em que ele faz o deploy, e não há marcação de versão em uma coluna.
Todo banco de dados provisionado por qualquer versão já lançada carrega o que quer
que ela tenha derivado, e nenhum código neste repositório pode intervir e renomear
todos eles.

A 0.13 é o exemplo prático. A função `generateForeignKeyName` aprendeu a
singularizar corretamente — `categorie_id` → `category_id`, `addres_id` →
`address_id` —, o que é sem dúvida uma derivação melhor, e isso quebrou todos os
bancos de dados mais antigos que possuíam plurais irregulares. O processo de
boot-ensure migrou a coluna, de modo que os dados sobreviveram; mas o
`schema.generated.ts` versionado no repositório do projeto não sobreviveu, e o
boot falhou devido a uma coluna que existia. Três commits, um novo teste de
integração (seam test) e uma entrada permanente nas notas de atualização, tudo em
troca de um nome de coluna mais bonito pelo qual ninguém havia perguntado.

**Se uma derivação estiver genuinamente errada**, ela é alterada para tabelas
criadas *posteriormente*, resguardada por uma estratégia de nomenclatura registrada
no projeto — nunca retroativamente, e nunca como efeito colateral do aprimoramento
da função subjacente.

**A única substituição legítima** é uma alteração que faça o código concordar com
um nome que o banco de dados *já possui*. O exemplo prático é o truncamento de
identificadores: o Postgres trunca silenciosamente identificadores para 63 bytes,
portanto, um nome de constraint derivado mais longo nunca foi o nome presente no
catálogo — a derivação estava descrevendo um objeto que não existia com aquela
grafia, e o boot-ensure reemitia o `ADD CONSTRAINT` a cada inicialização porque sua
comparação nunca coincidia. Truncar no momento da construção altera o que este
repositório *deriva* e não altera nada do que qualquer banco de dados implantado
*contém*. Esse é o teste a ser aplicado: não "o novo nome é melhor?", mas "algum
banco de dados existente precisa ser alterado?".

O outro caso em que um nome pode mudar é um conjunto de nomes que nunca poderiam
coexistir. Uma regra abrangendo várias operações em uma tabela com 42 bytes ou mais
derivava `<table>_default_admin_write_insert`, `_update` e `_delete`, e os três eram
truncados para os mesmos 63 bytes. O Postgres armazenava apenas uma política,
DELETE, e recusava todos os INSERTs e UPDATEs de administradores. Somente quando os
nomes de uma regra colidem dessa forma é que eles são derivados com o sufixo
priorizado, como `<head>_<hash8>_<op>`. Todo nome que funciona hoje mantém sua grafia.
O próximo boot ou push descarta a política truncada e cria uma política para cada
operação.

A única coisa sempre segura é *reconhecer* um nome antigo para migrá-lo:
`legacyForeignKeyName` existe para ser detectado, nunca para ser gerado, e a linha
de base (baseline) fixa essas detecções também. Remover uma detecção
silenciosamente reverte a migração de qualquer banco de dados que ainda carregue
essa grafia.

**O gate.** `tooling/scripts/derived-names.mts` executa uma fixture de teste de
estresse de nomenclatura — plurais irregulares, terminação em `ss`, um acrônimo, uma
junção a partir de um slug no plural, substituições explícitas, um slug longo o
suficiente para ser truncado — através de ambos os produtores de DDL de schema, e
renderiza cada identificador nomeado por qualquer um deles:

```bash
pnpm check:derived-names
```

Uma linha alterada ou removida falha como quebra de contrato, exibindo a grafia
antiga e a nova lado a lado. Uma alteração puramente aditiva também falha, mas com
a mensagem "regenerate" — para que a linha de base não sofra desvios sem que
ninguém perceba.

Ele também garante que o `rebase db push` e o boot-ensure do runtime gerenciado
derivem os *mesmos* nomes, o que é um segundo contrato oculto dentro do primeiro:
eles compilam as mesmas tabelas por meio de códigos diferentes, e um projeto
enviado via push uma vez e inicializado posteriormente não deve acabar com dois
schemas.

## O que *não* está congelado

Dito claramente, para que ninguém deduza uma promessa que nunca foi feita:

- A API TypeScript escrita pelo desenvolvedor — `defineTable` e `customizeTable`,
  opções de `initializeRebaseBackend`, propriedades do admin, nomes de métodos do
  SDK. A versão 0.31 substituiu collections por tables em uma minor, com um
  codemod que comprova que o SQL gerado não foi alterado. Breaking changes chegam
  em minors e são anunciadas no changelog.
- `@rebasepro/studio`, `@rebasepro/mcp`, `@rebasepro/inference`,
  `@rebasepro/plugin-*` — estes avançam mais rápido e têm menos consumidores.
- Qualquer coisa sob o diretório `src/` de um pacote que não seja reexportada a
  partir de seu barrel. O arquivo `packages/client/src/index.ts` traz uma nota
  explicando que sua lista de exportações é cuidadosamente selecionada justamente
  para que uma exportação interna não se torne pública por acidente.
- O schema de banco de dados das *suas* tabelas. Isso pertence a você; o Rebase é
  proprietário apenas do schema `rebase` (e, em um banco de dados provisionado
  antes da 0.13, do antigo schema `auth` até que o boot o desative).

## Os gates que garantem isso

Nada do que foi dito acima é convenção — cada item possui um teste que falha
quando é quebrado:

| Gate | O que ele garante |
|---|---|
| `pnpm verify:corpus` | todos os formatos de bundle já lançados, inicializados no runtime de hoje. As fixtures em `tests/fixtures/bundles/` são **escritas à mão e congeladas** — uma fixture que o builder regenera muda sempre que o builder muda |
| `pnpm verify:selfhost` | um bundle real compilado, empacotado, inicializado e consumido como um navegador faria |
| `upgrade-e2e.test.ts` | schemas antigos de banco de dados (`schema-snapshots/`) encontrados pelo runtime atual |
| `tests/e2e/tests/cli-init-e2e.ts` | um projeto com scaffolding instalado a partir de **tarballs reais**, não de links de workspace |
| `tests/e2e/tests/client-sdk-e2e.ts` | o fluxo do usuário final: registro → login → leituras no escopo de RLS → atualização de token (refresh) → armazenamento → tempo real |
| `pnpm check:derived-names` | cada nome de coluna, restrição, junção, enum e política que o framework deriva — e que o boot e o `db push` os derivem de forma idêntica |
| `pnpm rls:check` | as políticas do schema gerado |
| `pnpm check:api-surface` | cada exportação, e seus membros, dos cinco pacotes que a imagem fornece — `@rebasepro/server`, `types`, `client`, `common`, `utils` — além do ponto de entrada `@rebasepro/server/functions`, em relação às seis seções de `contracts/server.api.txt`. Estes são os pacotes sobre os quais `infra/docker/entrypoint.mjs` cria symlinks por cima das próprias cópias de um bundle implantado, portanto, remover uma exportação de um deles não gera erro de compilação para ninguém — gera uma falha de inicialização em toda a frota, durante um rollout que ninguém pediu |
| `pnpm test:gates` | os próprios testes dos gates, sobre fixtures — quarenta e sete arquivos, incluindo `check:api-surface` e a verificação de release-bump abaixo — para que um gate que deixe de enxergar o que protege falhe aqui. O `check:api-surface` passou toda a sua vida incapaz de notar um membro desaparecer de `const rebase` |
| `node tooling/scripts/check-release-bump.mjs` | que o nível de incremento sob o qual uma versão é lançada corresponda ao que o lançamento fez com as linhas de base acima — executado pelo `publish.yml` antes do changelog ser carimbado |
| saas CI | o plano de controle construído contra a branch `main` deste repositório, em seus próprios pushes e execuções noturnas (nightly) |

**Grave uma fixture de bundle e um snapshot de schema uma vez por lançamento.** O
valor de ambos os corpora reside inteiramente em quão longe no passado o mais
antigo deles alcança, e nenhum deles pode ser preenchido retroativamente depois.

### Ainda não cobertos por gates

A tabela acima é o que está garantido. Estas são as partes da política que nada
garante ainda, listadas para que ninguém veja nelas uma promessa:

- **Sem janela de depreciação ou suporte.** Enquanto o Rebase estiver na `0.x`, não
  há uma regra definida sobre quanto tempo uma exportação depreciada sobrevive
  antes da remoção, ou por quanto tempo uma versão minor mais antiga recebe
  correções. Correções de segurança são aplicadas apenas na minor mais recente.
- **O formato de transmissão HTTP não possui gate.** Nenhum script `check:*`
  compara os formatos de requisição e resposta com uma linha de base da maneira que
  o `check:api-surface` faz com as exportações; uma alteração no formato da
  resposta só é detectada por uma suíte de e2e que por acaso a leia.
- **As flags da CLI não possuem linha de base de compatibilidade.** O verificador da
  documentação falha quando uma flag usada pelas skills, pelos exemplos ou pelo
  site de marketing desaparece; nada detecta se qualquer outra flag sumir ou se uma
  flag mudar de significado.
- **Um lançamento no CI não registra nenhum dos dois corpora.** O fluxo de
  publicação não grava nenhuma fixture de bundle nem snapshot de schema; apenas o
  script de lançamento local tenta fazer isso, e ele emite um aviso em vez de parar
  quando não consegue. As versões 0.18 a 0.21 não possuem nenhum snapshot de
  projeto registrado.
- **A superfície de exportações é um gate, não um contrato.** Definir se as
  exportações públicas dos pacotes fornecidos pelo runtime se tornarão um sétimo
  contrato numerado — declarado como a linha de base de `check:api-surface`,
  compatível de forma aditiva dentro de uma major de contrato — é uma decisão em
  aberto.

## Alterando um contrato

1. Decida qual dos seis contratos é afetado. A maioria das alterações não se
   enquadra em nenhum deles — mas "nenhum dos seis" não significa "isento de
   controvérsias". Remover ou renomear uma exportação de `@rebasepro/server`, ou um
   membro de uma delas, não afeta nenhum dos seis e é a alteração mais perigosa em
   todo o repositório, pois o código que ela quebra já está compilado e não será
   recompilado. `pnpm check:api-surface` é o que garante essa barreira; definir se
   isso se tornará um sétimo contrato numerado é uma decisão em aberto (consulte
   *Ainda não cobertos por gates*, acima).
2. Adicione primeiro uma fixture ou snapshot para o formato **antigo** e confirme
   que ela passa.
3. Faça a alteração e incremente a constante.
4. Confirme que a fixture antiga continua passando, ou que agora falha *com a
   mensagem de que o usuário precisaria*. Ambos são resultados válidos; o silêncio
   não é.
5. Para o contrato 3, planeje a recompilação de cada bundle implantado antes de
   fazer o merge.
6. O contrato 6 é a exceção aos passos 3 e 4: não há constante para incrementar e
   não há versão para recusar, pois uma coluna não traz marcação de versão. O passo
   que os substitui é decidir não fazer a alteração — consulte a seção acima para
   entender como é a alternativa.

## Relacionado

- [Atualizando](/docs/upgrading/) — o que realmente quebrou, lançamento a lançamento
- [Changelog](/docs/changelog/) — todas as alterações, incluindo as que não quebraram nada
- [Runtime e Bundles](/docs/architecture/runtime-and-bundles/) — contrato 3 — o formato de bundle contra o qual um projeto implantado já foi compilado
