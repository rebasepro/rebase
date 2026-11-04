---
sourceHash: 448871502e7447b5
slug: pt/docs/compatibility
title: Compatibilidade
description: O que o Rebase promete entre versões e o que não promete — os seis contratos versionados, como cada um falha e o que ainda pode mudar em uma versão minor.
---

O que o Rebase promete entre versões e o que não promete.

Este é o documento a ser lido antes de alterar qualquer coisa da qual um projeto
implantado ou um tenant em execução no Rebase Cloud já dependa. É também a resposta
honesta para "se eu construir sobre o Rebase hoje, o que vai quebrar sob meus pés mais tarde?"

## O que "beta" significa aqui

O Rebase está em beta público. A maioria dos projetos usa essa palavra para dizer que
"qualquer coisa pode quebrar", o que não diz nada com o qual o leitor possa se planejar.
Portanto, aqui está o limite que este projeto realmente estabelece:

> **A API contra a qual você escreve pode mudar em uma versão minor, com uma entrada no changelog.
> Seus dados não podem quebrar silenciosamente.**

A primeira metade é o comportamento comum da versão `0.x` e é descrita abaixo. A segunda
metade é a parte que vale a pena verificar, porque é uma afirmação sobre mecanismos e não
sobre intenções: os contratos versionados na próxima seção são, cada um, gravados em um
artefato ou banco de dados, cada um é verificado na inicialização ou no recebimento, e cada um
**falha ruidosamente e de forma específica** em vez de degradar. Um envio de esquema (schema push)
que removeria uma coluna é recusado por um gate destrutivo
(`packages/server-postgres/test/e2e/db-push-safety.test.ts`), e o próprio caminho
de atualização é um teste: `upgrade-e2e.test.ts` restaura bancos de dados como versões
anteriores os deixaram, executa o caminho de migração atual sobre cada um deles e valida
que as linhas sobrevivem — não apenas que a inicialização ocorreu.

O que beta realmente significa: recursos ainda estão ausentes, alguns subsistemas são mais novos
que outros, e a forma de uma aresta áspera é algo ausente ou incômodo, não algo que corrompa
dados silenciosamente. Quais subsistemas são quais é algo publicado e datado em vez de ser
deixado para ser descoberto — a tabela abaixo é essa publicação.

## Prontidão por subsistema

**Última revisão em 14 de setembro de 2026, referente à 0.21.0.** Releia a cada versão minor; uma
avaliação que não mudou em três lançamentos ou está consolidada ou foi esquecida, e esta nota
está aqui para que a diferença seja verificada.

As três classificações significam:

- **Stable** — o formato está consolidado e coberto por um gate no CI. Ainda pode
  receber recursos; não será redesenhado sob seus pés durante a 0.x, e qualquer alteração
  que possa quebrá-lo será anunciada no changelog.
- **Beta** — funciona e é usado em produção, mas sabe-se que algo nele ainda é
  áspero: um limite que você pode atingir, uma aresta incômoda, uma decisão de design
  ainda não tomada. A parte áspera é detalhada nas notas, porque "beta" por si só
  não diz nada com o que você possa se planejar.
- **Experimental** — lançado para que possa ser usado e reportado. Espere encontrar
  partes pelas quais ninguém passou ainda.

| Subsistema | Classificação | Em que a classificação se apoia |
|---|---|---|
| REST API + SDK gerado | Stable | O contrato de rede (wire contract) é versionado e validado por gate; `client-sdk-e2e` conduz registro → login → leituras com escopo de RLS → atualização de token (refresh) → armazenamento → realtime ponta a ponta |
| Auth — e-mail/senha, OAuth, OIDC, magic link, código único | Stable | Doze provedores OAuth inclusos. O esquema de autenticação é um contrato versionado, gravado e verificado na inicialização |
| Auth — MFA (TOTP) | Beta | Registro, verificação e recuperação funcionam e são testados. A rotação de chaves está implementada para a chave de criptografia; não há interface administrativa para redefinir o fator de um usuário bloqueado |
| Row-level security (RLS) | Stable | O ponto central do produto. `pnpm rls:check` audita um banco de dados ativo contra quinze verificações, e a suíte e2e de RLS roda a cada push |
| Storage | Stable | Local, S3 e GCS. Negação por padrão (default-deny) em produção desde 0.17.0, e o scaffold fornece um hook de autorização |
| Realtime | **Beta** | As assinaturas são correspondidas apenas pelo caminho da coleção, portanto N assinantes em uma coleção custam N buscas adicionais (refetches) no escopo de RLS por escrita. Isso limita uma implantação a poucas centenas de assinantes simultâneos. Correto em qualquer escala; custoso além dessa |
| Busca vetorial (pgvector) | Beta | Cada coluna de vetor recebe um índice HNSW para distância de cosseno por padrão, ajustável por propriedade via `VectorIndexConfig` (método, distâncias, parâmetros de construção) ou desativável, o que resulta em uma varredura exata. O pgvector não pode indexar colunas com mais de 2.000 dimensões, portanto essas ficam sem índice e realizam varredura |
| Sincronização offline | Beta | Mutações contêm chaves de idempotência que o servidor respeita, e os defeitos de perda de dados encontrados na auditoria de julho foram corrigidos. O modelo de conflito é last-write-wins sem mesclagem por campo |
| Histórico de entidades | Stable | Baseado em snapshots, protegido por sua própria suíte de testes |
| Functions e crons | Stable | O ponto de entrada portátil (`@rebasepro/server/functions`) é um contrato versionado com sua própria seção de superfície de API |
| Servidor MCP + habilidades de agente | Beta | `@rebasepro/mcp` roda sobre stdio: cinquenta e três ferramentas, autenticação bearer por projeto, ferramentas destrutivas recusam alvos não locais a menos que explicitamente configuradas. Desde a 0.21, o servidor também pode montar um endpoint remoto `/mcp` — OAuth 2.1, nove ferramentas de dados, cada chamada sob o próprio RLS da pessoa autenticada — desativado a menos que `REBASE_MCP_ENABLED=true`, e apenas para Postgres |
| Studio (SQL, esquema, RLS, explorador de API) | Beta | Usado diariamente em projetos reais. O suporte a branches está presente no pacote OSS e deliberadamente não foi exposto no Rebase Cloud, pois mover uma implantação em execução para um branch ainda não tem uma solução definida |
| CMS + painel administrativo | Beta | Completo para CRUD, relações, campos de armazenamento e funções (roles). **A tabela de dados não possui semântica de grade** — sem `role`, sem `aria-rowindex`, `tabIndex` removido — de modo que usuários de teclado e leitores de tela não conseguem operar a visualização principal. Sem rascunhos, sem conteúdo por localidade, sem rich-text em blocos |
| Banco de dados de desenvolvimento gerenciado PGlite | Beta | `rebase dev` sem configuração e sem Docker. Uma sessão por vez, portanto as requisições são serializadas e a concorrência não pode ser reproduzida nele; comandos baseados em Atlas (`db push`, `generate`, `migrate`) planejam contra um segundo PGlite temporário iniciado para o comando (na 0.24 eles recusam o banco gerenciado); `db branch` não funciona nele e informa isso explicitamente |
| Helm chart | Beta | Renderiza a topologia de processos separados e é publicado no registro OCI a cada versão. O padrão continua sendo um único contêiner |
| `@rebasepro/server-mongo` | **Experimental** | Um driver funcional com realtime via change-streams e histórico por snapshots. **Sem row-level security** — todo o modelo de isolamento acima não se aplica a ele — e sem relações. Change-streams exigem um replica set: em um `mongod` standalone nada os substitui, de forma que uma assinatura enxerga escritas feitas através daquele processo do Rebase e perde todas as outras. Sem MFA: o registro responde 501, e as verificações respondem "sem fator", então o login nunca solicita um. A agregação administrativa não pode ter uma coleção como alvo — ela lê o nome de um estágio `$from` que o MongoDB não tem — então não retorna nada |
| `@rebasepro/firebase` | Experimental | Executa o painel administrativo e o SDK contra o Firestore. Sem RLS, sem interface SQL; o conjunto de recursos do Postgres não é transferido. O driver do Firestore ignora grupos de filtros `or(...)`/`and(...)`, portanto uma consulta que use um deles lê todas as linhas permitidas pelos seus filtros simples |
| Rebase Cloud | **Private beta** | Ativo, executando tenants reais, liberado em lotes. Não é self-serve |

Duas entradas acima são o custo honesto de publicar esta tabela: o refetch
do realtime e a acessibilidade da tabela de dados são defeitos em aberto, não itens
de roadmap, e ambos estão listados em vez de serem deixados para o leitor descobrir.

Esta tabela representa o que existe. O que ainda não existe está no
[roadmap](https://rebase.pro/roadmap), uma entrada por issue do GitHub, com o
subconjunto necessário para a versão 1.0 demarcado.

## A promessa da versão 0.x

O Rebase está na versão `0.x`. Esta seção foi escrita para valer para todas as versões 0.x,
em vez de apenas para uma delas, para que não fique desatualizada a cada corte. **Mudanças significativas
(breaking changes) na API TypeScript escrita pelo usuário ainda são permitidas em versões minor**, e o changelog
é onde elas são anunciadas. O que *não* tem permissão para quebrar silenciosamente é o conjunto de contratos
versionados abaixo: cada um é gravado em um artefato ou banco de dados, cada um é verificado na inicialização
ou no recebimento, e cada um falha **ruidosamente e de forma específica** em vez de degradar.

Essa distinção é toda a promessa. Um export renomeado custa a você um erro de compilação
e cinco minutos. Um bundle que inicializa com o runtime errado e serve dados sutilmente
incorretos custa um incidente a você, e os contratos existem para que a segunda categoria
não ocorra silenciosamente.

O Rebase Cloud consome exatamente esses contratos e nada mais. Qualquer coisa não listada
aqui é um detalhe de implementação do qual a plataforma não depende.

### Badges de versão e canaries

A documentação é publicada a partir da branch `main`, portanto uma página pode descrever algo
que nenhuma versão estável possui ainda. Um badge *Since* indica a primeira versão estável
que traz o recurso, e o texto ao lado informa o que a versão anterior faz.

Um canary é uma compilação da `main` numerada de acordo com a versão para a qual está caminhando:
`0.25.0-canary.g<commit>` é a `main` naquele commit, após a 0.24.0 e antes da 0.25.0, e
`rebase upgrade --to canary` instala a mais recente. Ele contém tudo o que havia chegado
à `main` quando foi construído, portanto um badge indicando sua versão (Since 0.25) se aplica
a você, e a nota sobre a versão anterior (on 0.24) descreve a versão estável da qual você veio.
Canaries anteriores a 0.25.0 eram numerados após o último lançamento: `0.24.1-canary.g<commit>`
também é uma prévia da 0.25.

## Os contratos versionados

Os valores abaixo são lidos diretamente do código-fonte; considere as referências de arquivos
como a verdade e esta tabela como o mapa.

```bash
grep -rn "BUNDLE_FORMAT_VERSION =\|RUNTIME_CONTRACT_VERSION =" packages/types/src/types/project_manifest.ts
grep -n "AUTH_SCHEMA_VERSION =" packages/server-postgres/src/auth/schema-version.ts
```

| # | Contrato | Declarado em | Verificado em | Direção de compatibilidade |
|---|---|---|---|---|
| 1 | intervalo `rebase` em `rebase.json` | projeto do usuário | CLI no build | o projeto declara quais runtimes aceita |
| 2 | `BUNDLE_FORMAT_VERSION` | `packages/types/src/types/project_manifest.ts` | `packages/server/src/boot/bundle.ts` | **compatível com versões anteriores** — novo runtime lê bundles antigos |
| 3 | `RUNTIME_CONTRACT_VERSION` | mesmo arquivo | mesmo arquivo | **correspondência exata, ambas as direções** |
| 4 | `AUTH_SCHEMA_VERSION` | `packages/server-postgres/src/auth/schema-version.ts` | na inicialização, contra `rebase.schema_meta` | **apenas progressivo (forward only)** — novo runtime migra bancos de dados antigos |
| 5 | `manifest.schemaVersion` | emitido por `rebase build` | enviado pelo SDK como `x-rebase-schema` quando configurado | consultivo — identifica contra qual esquema um cliente foi construído |
| 6 | Identificadores derivados de banco de dados | `contracts/derived-names.txt` | `pnpm check:derived-names` | **congelado** — um nome emitido por uma versão nunca é re-derivado |

### 1 — `rebase` em `rebase.json`

Um intervalo semver, lido como `engines` em um `package.json`: quais versões de runtime
este projeto aceita. Nomeado como `rebase` em vez de `runtime` deliberadamente, porque
`runtime` já significa *quem é o proprietário do processo* (`managed` | `custom`) em uma aplicação.

### 2 — `BUNDLE_FORMAT_VERSION` (atualmente 2)

O layout em disco de um bundle compilado. Um runtime aceita qualquer bundle cujo formato
seja **menor ou igual** ao seu próprio, o que permite que a camada gerenciada mova um
tenant para uma nova imagem sem que ninguém precise reconstruir seu projeto.

- **1** — `mode: "cms" | "baas" | "static"`, `entry.static` um diretório único,
  `entry.admin` para um painel administrativo empacotado.
- **2** — `kind: "backend" | "static"`, `entry.static` uma lista, `entry.admin`
  removido. O formato 1 ainda é lido, via `upgradeLegacyManifest`.

**Incremente quando** o layout mudar de tal forma que um runtime mais antigo interpretaria
incorretamente um bundle mais novo. O incremento é o que converte "inicializa e não serve nada"
em uma recusa de inicialização.

### 3 — `RUNTIME_CONTRACT_VERSION` (atualmente 1)

A versão major do contrato bundle↔runtime. Distinta da versão do pacote `@rebasepro/server`,
que pode lançar qualquer número de versões minor e patch enquanto este permanece fixo.

**Leia isto antes de mexer aqui.** A verificação é `!==`, não `>`:

> um bundle voltado para o contrato *N* executa **apenas** em um runtime que implementa *N*

portanto, incrementá-lo invalida **todos os bundles já construídos**, todos de uma vez,
até que cada um seja reconstruído. Essa é a severidade pretendida — é a alavanca de
"nada antigo pode rodar aqui" — mas significa que um incremento é uma migração em toda a frota,
não apenas uma nota de lançamento. Para a camada gerenciada, deve ser sequenciado com a
reconstrução do bundle de cada tenant.

Se uma alteração for *aditiva* e bundles antigos ainda funcionarem corretamente, ela deve
usar `BUNDLE_FORMAT_VERSION` (ou nada), e não este.

### 4 — `AUTH_SCHEMA_VERSION` (atualmente 2)

Gravado em `rebase.schema_meta` e comparado na inicialização. Um runtime **recusa-se a
iniciar** contra um banco de dados migrado por uma versão mais recente do framework, em vez
de operar sobre uma estrutura que não compreende — durante um deploy gradual (rolling deploy),
essa é a diferença entre metade da frota apresentar erros e metade da frota corromper dados.

A migração progressiva é automática: `ensureAuthTablesExist` atualiza um banco de dados mais antigo.
Observe que este bloco de migração é deliberadamente envolvido em `try/catch` e registra logs
em vez de lançar exceções — uma inicialização capenga é melhor que um loop de travamento (crash loop) — portanto,
**"inicializou" não prova nada**. Cada asserção na suíte de atualização lê o catálogo ou os dados.

**Incremente quando** uma migração não puder ser ignorada por um runtime mais antigo. Não
incremente para uma coluna aditiva e retrocompatível; há um exemplo prático desse julgamento
em `packages/server-postgres/src/auth/ensure-tables.ts`.

### 5 — `manifest.schemaVersion`

Um hash das definições de coleções compiladas, emitido no manifesto do bundle
e reproduzido por um SDK gerado no cabeçalho `x-rebase-schema` (`SCHEMA_VERSION_HEADER`).
Ele existe para que a plataforma possa dizer "esta aplicação foi construída contra um
esquema mais antigo" em vez de falhar misteriosamente na primeira requisição.

`rebase generate-sdk` grava o valor em `schema.meta.ts`; passe-o ao cliente para enviá-lo:

```typescript
import { SCHEMA_VERSION } from "./generated/sdk/schema.meta";

const rebase = createRebaseClient<Database>({
    baseUrl: "http://localhost:3001",
    collections: collectionsDictionary,
    schemaVersion: SCHEMA_VERSION,
});
```

O backend lê esse cabeçalho em cada requisição de dados. A divergência (drift) nunca recusa
uma chamada — um SDK com um esquema defasado geralmente ainda é compatível, e lançar o backend
antes do frontend é a ordem normal de implantação —, mas quando uma requisição falha com um 400
ou 404, o erro traz a divergência como sua causa:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Unknown field \"authorName\" on collection \"posts\"",
    "cause": {
      "code": "SCHEMA_DRIFT",
      "clientSchema": "v1:0e1c…",
      "serverSchema": "v1:9ab4…",
      "message": "This client was generated against schema v1:0e1c…; this backend serves v1:9ab4…"
    }
  }
}
```

Dessa forma, uma coluna renomeada é interpretada como "seu SDK está desatualizado, gere-o novamente"
em vez de um campo que seus próprios tipos insistem que existe. Uma requisição bem-sucedida nunca é notificada.

Cobre **apenas coleções**. A edição de um hook ou função não altera o contrato do cliente
e não deve invalidar todos os SDKs gerados.

### Quem está chamando

Mais dois sinais de identificação, nenhum dos quais impõe restrições por conta própria:

- **`GET /api/meta/schema-version`** não é autenticado e responde com o `schemaVersion`
  do projeto *e* seu `runtime` (`version` e `contract`). Um job de CI comparando seu
  SDK gerado contra um projeto ativo não precisa de credenciais, assim como um cliente
  perguntando com qual runtime está se comunicando.
- **`User-Agent: rebase-cli/<version>`** vai em cada requisição do `rebase cloud`.
  O formato de rede do control plane evolui mais rápido do que o publicado no npm, por
  isso ele precisa ser capaz de responder a um cliente antigo com `CLI_TOO_OLD` e a
  versão mínima — o que só pode fazer para um chamador que declara quem é.

### 6 — Identificadores derivados de banco de dados

Cada nome que este framework descobre sozinho em vez de ser explicitamente informado: uma coluna
de chave estrangeira, uma restrição de chave estrangeira, uma tabela de junção e suas duas colunas
de chave, um tipo enum, um nome de política, a coluna `snake_case` de uma propriedade em `camelCase`.

> **Um identificador derivado é congelado no momento em que uma versão o emite.**

Não "congelado até a próxima versão major" — congelado. O raciocínio é diferente dos
outros cinco contratos, e mais forte. Aqueles são versionados, então uma incompatibilidade
pode ser *detectada* e recusada. Este não pode: o nome é gravado no banco de dados do
cliente no dia da implantação, e não há carimbo de versão em uma coluna. Cada banco de dados
provisionado por cada versão já lançada carrega o que quer que tenha sido derivado, e nenhum
código neste repositório pode alcançar e renomear todos eles.

A 0.13 é o exemplo prático. `generateForeignKeyName` aprendeu a singularizar corretamente —
`categorie_id` → `category_id`, `addres_id` → `address_id` — o que é inequivocamente a melhor
derivação, e isso quebrou todos os bancos de dados antigos que tinham um plural irregular.
O boot-ensure migrou a coluna, de modo que os dados sobreviveram; o `schema.generated.ts`
commitado do projeto não o fez, e a inicialização morreu em uma coluna que existia.
Três commits, um novo teste de junção e uma entrada permanente nas notas de atualização, em troca
de um nome de coluna visualmente melhor sobre o qual ninguém havia perguntado.

**Se uma derivação estiver genuinamente incorreta**, ela muda para coleções criadas
*posteriormente*, sob uma estratégia de nomenclatura registrada no projeto — nunca
retroativamente, e nunca como efeito colateral do aprimoramento da função subjacente.

**A única substituição legítima** é uma alteração que faz o código concordar com um nome
que o banco de dados *já possui*. O exemplo prático é o truncamento de identificadores:
o Postgres corta silenciosamente um identificador para 63 bytes, portanto um nome de restrição
derivado mais longo nunca foi o nome no catálogo — a derivação estava descrevendo um objeto
que não existia sob aquela grafia, e o boot-ensure reemitia `ADD CONSTRAINT` a cada inicialização
porque sua comparação nunca correspondia. Truncar na construção altera o que este repositório
*deriva* e não muda nada sobre o que qualquer banco de dados implantado *contém*. Esse é o
teste a ser aplicado: não "o novo nome é melhor", mas "algum banco de dados existente precisa mudar".

O outro caso em que um nome pode mudar é um conjunto de nomes que nunca poderiam existir
simultaneamente. Uma regra que abrange várias operações em uma tabela de 42 bytes ou mais
derivou `<table>_default_admin_write_insert`, `_update` e `_delete`, e todas as três foram cortadas
para os mesmos 63 bytes. O Postgres armazenou uma política, DELETE, e recusou todos os INSERT e
UPDATE administrativos. Apenas quando os nomes de uma regra colidem dessa forma eles são derivados
com o sufixo primeiro, como `<head>_<hash8>_<op>`. Todo nome que funciona hoje mantém sua grafia.
A próxima inicialização ou push remove a política truncada e cria uma política para cada operação.

A única coisa que é sempre segura é *reconhecer* um nome antigo para migrá-lo:
`legacyForeignKeyName` existe para ser detectado, nunca para ser gerado, e a linha de base
também fixa essas detecções. Remover uma delas reverte silenciosamente a migração de qualquer
banco de dados que ainda carregue essa grafia.

**O gate.** `tooling/scripts/derived-names.mts` executa uma fixture de estresse de nomenclatura —
plurais irregulares, terminação em `ss`, uma sigla, uma junção a partir de um slug no plural,
substituições explícitas, um slug longo o suficiente para truncar — através de ambos os produtores
de DDL de esquema e renderiza cada identificador que qualquer um deles nomeia:

```bash
pnpm check:derived-names
```

Uma linha alterada ou removida falha como uma quebra de contrato, com a grafia antiga e a nova
lado a lado. Uma alteração puramente aditiva também falha, mas com a mensagem "regenerate" — para
que a linha de base não sofra desvios despercebidos.

Isso também garante que o `rebase db push` e o boot-ensure do runtime gerenciado derivem
os *mesmos* nomes, o que é um segundo contrato oculto dentro do primeiro: eles compilam
as mesmas coleções por meio de códigos diferentes, e um projeto enviado uma vez e inicializado
mais tarde não deve terminar com dois esquemas.

## O que *não* está congelado

Dito claramente, para que ninguém deduza uma promessa que nunca foi feita:

- A API TypeScript escrita pelo usuário — configuração de coleção, opções de
  `initializeRebaseBackend`, props de admin, nomes de métodos do SDK. Mudanças importantes (breaking changes)
  chegam em versões minor e são anunciadas no changelog.
- `@rebasepro/studio`, `@rebasepro/mcp`, `@rebasepro/inference`,
  `@rebasepro/plugin-*` — estes evoluem mais rapidamente e têm o menor número de consumidores.
- Qualquer coisa sob o `src/` de um pacote que não seja reexportada a partir de seu barrel.
  `packages/client/src/index.ts` traz uma nota explicando que sua lista de exportação é
  curada precisamente para que um export interno não se torne público por acidente.
- O esquema de banco de dados das *suas* coleções. Isso é seu; o Rebase é dono apenas do
  esquema `rebase` (e, em um banco de dados provisionado antes da 0.13, do antigo esquema `auth`
  até que a inicialização o desative).

## Os gates que garantem isso

Nada do que foi dito acima é convenção — cada item tem um teste que falha quando é quebrado:

| Gate | O que ele valida |
|---|---|
| `pnpm verify:corpus` | cada formato de bundle já lançado, inicializado no runtime de hoje. Fixtures em `tests/fixtures/bundles/` são **escritas à mão e congeladas** — uma fixture que o builder regenera muda sempre que o builder muda |
| `pnpm verify:selfhost` | um bundle real construído, empacotado, inicializado e requisitado como um navegador faria |
| `upgrade-e2e.test.ts` | esquemas de bancos de dados antigos (`schema-snapshots/`) encontrados pelo runtime atual |
| `tests/e2e/tests/cli-init-e2e.ts` | um projeto criado via scaffold instalado a partir de **tarballs reais**, não de links de workspace |
| `tests/e2e/tests/client-sdk-e2e.ts` | o caminho do usuário final: registro → login → leituras no escopo de RLS → atualização de token (refresh) → armazenamento → realtime |
| `pnpm check:derived-names` | cada coluna, restrição, junção, enum e nome de política que o framework deriva — e que a inicialização e o `db push` os derivam de forma idêntica |
| `pnpm rls:check` | as políticas do esquema gerado |
| `pnpm check:api-surface` | cada export, e seus membros, dos cinco pacotes fornecidos pela imagem — `@rebasepro/server`, `types`, `client`, `common`, `utils` — além do ponto de entrada `@rebasepro/server/functions`, contra as seis seções de `contracts/server.api.txt`. Estes são os pacotes que `infra/docker/entrypoint.mjs` vincula via symlink sobre as próprias cópias de um bundle implantado, portanto remover um export de um deles não é um erro de compilação para ninguém — é uma falha de inicialização em toda a frota, durante um rollout que ninguém pediu |
| `pnpm test:gates` | os testes dos próprios gates, sobre fixtures — quarenta e sete arquivos, entre eles `check:api-surface` e a verificação de release-bump abaixo — para que um gate que pare de enxergar o que protege falhe aqui. `check:api-surface` passou toda a sua vida incapaz de ver um membro desaparecer de `const rebase` |
| `node tooling/scripts/check-release-bump.mjs` | valida se o nível de incremento sob o qual uma versão é lançada corresponde ao que o lançamento fez com as linhas de base acima — executado por `publish.yml` antes do changelog ser registrado |
| CI do saas | o control plane construído contra a `main` deste repositório, em seus próprios pushes e nightly |

**Grave uma fixture de bundle e um snapshot de esquema uma vez por versão.** O valor de
ambos os corpora reside inteiramente em quão antigo é o mais velho deles, e nenhum deles pode
ser preenchido retroativamente após o fato.

### Ainda não validado por gates

A tabela acima é o que está garantido. Estas são as partes da política que nada garante
ainda, listadas para que ninguém infira promessas a partir delas:

- **Sem janela de depreciação ou suporte.** Enquanto o Rebase for `0.x`, não há regra
  escrita para quanto tempo um export depreciado sobrevive antes da remoção, ou por quanto
  tempo uma versão minor anterior recebe correções. Correções de segurança chegam apenas na minor mais recente.
- **O formato de rede HTTP não possui gate.** Nenhum script `check:*` compara os formatos
  de requisição e resposta contra uma linha de base da maneira que `check:api-surface` faz com
  exports; uma alteração no formato de resposta só é capturada por uma suíte e2e que por acaso a leia.
- **Flags de CLI não possuem linha de base de compatibilidade.** O verificador da documentação
  falha quando uma flag usada por skills, exemplos ou site de marketing desaparece; nada
  percebe qualquer outra flag sumindo ou mudando de significado.
- **Um release de CI não grava nenhum dos dois corpora.** O fluxo de publicação não grava
  nenhuma fixture de bundle e nenhum snapshot de esquema; apenas o script de lançamento local
  tenta fazer isso, e ele emite avisos em vez de parar quando não consegue. As versões 0.18 a
  0.21 não têm snapshots de projeto gravados.
- **A superfície de exportação é um gate, não um contrato.** Se os exports públicos dos
  pacotes fornecidos pelo runtime se tornarão um sétimo contrato numerado — declarado como
  a linha de base de `check:api-surface`, compatível aditivamente dentro de uma versão major do contrato —
  é uma decisão em aberto.

## Alterando um contrato

1. Decida qual dos seis ele é. A maioria das alterações não é nenhum deles — mas "nenhum
   dos seis" não significa "inconteste". Remover ou renomear um export de `@rebasepro/server`,
   ou um membro dele, não é nenhum dos seis e é a alteração mais perigosa em todo o repositório,
   porque o código que ela quebra já está construído e não será recompilado. `pnpm check:api-surface`
   é o que mantém essa linha; se ele se tornará um sétimo contrato numerado é uma decisão em aberto
   (veja *Ainda não validado por gates*, acima).
2. Adicione uma fixture ou snapshot para o formato **antigo** primeiro e observe-o passar.
3. Faça a alteração e incremente a constante.
4. Confirme se a fixture antiga ainda passa, ou se agora ela falha *com a mensagem
   de que um usuário precisaria*. Ambos são resultados válidos; silêncio não é.
5. Para o contrato 3, planeje a reconstrução de cada bundle implantado antes de fazer o merge.
6. O contrato 6 é a exceção aos passos 3 e 4: não há constante para incrementar e
   nenhuma versão para recusar, porque uma coluna não carrega carimbo de versão. O passo
   que os substitui é decidir não fazer a alteração — veja a seção acima para entender
   como é a alternativa.

## Relacionado

- [Atualização](/docs/upgrading/) — o que realmente quebrou, versão por versão
- [Changelog](/docs/changelog/) — cada alteração, incluindo as que não quebraram nada
- [Runtime & Bundles](/docs/architecture/runtime-and-bundles/) — contrato 3 — o formato de bundle contra o qual um projeto implantado já está construído
