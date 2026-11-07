---
sourceHash: 1fd0f89847e543c2
slug: pt/docs/compatibility
title: Compatibilidade
description: O que o Rebase promete entre versões e o que não promete — os seis contratos versionados, como cada um falha e o que ainda pode mudar em uma versão minor.
---

O que o Rebase promete entre versões e o que não promete.

Este é o documento a ser lido antes de alterar qualquer coisa da qual um projeto
implantado ou um tenant em execução no Rebase Cloud já dependa. É também a resposta
honesta para "se eu construir no Rebase hoje, o que quebra mais tarde?"

## O que "beta" significa aqui

O Rebase está em beta público. A maioria dos projetos usa essa palavra para significar
"qualquer coisa pode quebrar", o que não dá ao leitor nada com que se planejar, então
aqui está o limite que este projeto realmente define:

> **A API contra a qual você programa pode mudar em uma minor, com uma entrada no changelog.
> Seus dados não podem quebrar silenciosamente.**

A primeira metade é o comportamento comum do `0.x` e é descrita abaixo. A segunda
metade é a parte que vale a pena conferir, pois é uma afirmação sobre mecanismos em vez
de intenções: os contratos versionados na próxima seção são, cada um, carimbados em um
artefato ou banco de dados, cada um é verificado na inicialização (boot) ou no recebimento (intake),
e cada um **falha de forma ruidosa e específica** em vez de degradar. Um envio de esquema (schema push)
que removeria uma coluna é recusado por um gate destrutivo
(`packages/server-postgres/test/e2e/db-push-safety.test.ts`), e o próprio caminho de
atualização é um teste: `upgrade-e2e.test.ts` restaura bancos de dados exatamente como versões
anteriores os deixaram, executa o caminho de migração atual sobre cada um e assegura
que as linhas sobrevivam — não apenas que a inicialização ocorreu.

O que beta realmente significa: recursos ainda estão faltando, alguns subsistemas são
mais novos que outros, e o formato de uma aresta áspera é que algo está ausente ou incômodo,
não que corrompa algo silenciosamente. Quais subsistemas são quais é publicado e datado
em vez de deixado para ser descoberto — a tabela abaixo é essa publicação.

## Prontidão por subsistema

**Última revisão em 14 de setembro de 2026, com base na 0.21.0.** Releia a cada minor;
uma classificação que não mudou em três lançamentos está consolidada ou esquecida,
e esta nota está aqui para que a diferença seja verificada.

As três classificações significam:

- **Estável** — a estrutura está definida e coberta por um gate no CI. Ainda pode
  receber novos recursos; não será redesenhada inesperadamente dentro de 0.x, e uma
  alteração que quebraria seu código é anunciada no changelog.
- **Beta** — funciona e é usado em produção, mas algo nele ainda é considerado
  áspero: um limite que você pode atingir, uma aresta incômoda, uma decisão de design
  ainda não tomada. A parte áspera é descrita nas notas, porque "beta" por si só não
  diz nada com o qual você possa se planejar.
- **Experimental** — lançado para que possa ser usado e reportado. Espere encontrar
  partes pelas quais ninguém passou ainda.

| Subsistema | Classificação | Em que a classificação se apoia |
|---|---|---|
| REST API + SDK gerado | Estável | O contrato de rede (wire contract) é versionado e protegido por gate; `client-sdk-e2e` executa registro → login → leituras com escopo de RLS → atualização (refresh) → storage → realtime de ponta a ponta |
| Autenticação — email/senha, OAuth, OIDC, magic link, código de uso único | Estável | Doze provedores OAuth inclusos. O esquema de autenticação é um contrato versionado, carimbado e verificado no boot |
| Autenticação — MFA (TOTP) | Beta | Registro, verificação e recuperação funcionam e são testados. A rotação de chaves está implementada para a chave de criptografia; não há interface administrativa para redefinir o fator de um usuário bloqueado |
| Row-level security (RLS) | Estável | O pilar central do produto. `pnpm rls:check` audita um banco de dados ativo contra quinze verificações, e a suíte e2e de RLS é executada a cada push |
| Armazenamento (Storage) | Estável | Local, S3 e GCS. Negação por padrão (default-deny) em produção desde a 0.17.0, e o scaffold inclui um hook de autorização |
| Realtime | **Beta** | As inscrições são associadas apenas pelo caminho da coleção, portanto N assinantes em uma coleção custam N buscas adicionais (refetches) no escopo de RLS por escrita. Isso limita uma implantação a poucas centenas de assinantes concorrentes. Correto em qualquer escala; custoso além desse patamar |
| Busca vetorial (pgvector) | Beta | Cada coluna vetorial recebe um índice HNSW para distância de cosseno por padrão, ajustável por propriedade via `VectorIndexConfig` (método, distâncias, parâmetros de build) ou desativado, o que recorre a uma varredura exata. O pgvector não pode indexar colunas com mais de 2.000 dimensões, logo essas ficam sem índice e realizam varredura |
| Sincronização offline | Beta | Mutações carregam chaves de idempotência respeitadas pelo servidor, e os defeitos de perda de dados encontrados na auditoria de julho foram corrigidos. O modelo de conflito é last-write-wins sem mesclagem por campo |
| Histórico de entidades | Estável | Baseado em snapshots, protegido por sua própria suíte de testes |
| Functions e crons | Estável | O ponto de entrada portátil (`@rebasepro/server/functions`) é um contrato versionado com sua própria seção de superfície de API |
| Servidor MCP + agent skills | Beta | `@rebasepro/mcp` executa sobre stdio: cinquenta e três ferramentas, autenticação bearer por projeto, ferramentas destrutivas recusam alvos não locais a menos que haja opt-in. Desde a versão 0.21, o servidor também pode montar um endpoint remoto `/mcp` — OAuth 2.1, onze ferramentas de dados, cada chamada sob o RLS da própria pessoa autenticada — desativado a menos que `REBASE_MCP_ENABLED=true`, e apenas para Postgres |
| Studio (SQL, schema, RLS, explorador de API) | Beta | Usado diariamente em projetos reais. Branching está presente no pacote OSS e deliberadamente não exposto no Rebase Cloud, porque mover uma implantação em execução para uma branch ainda não tem fluxo definido |
| CMS + painel de administração | Beta | Completo para CRUD, relações, campos de armazenamento e funções (roles). **A tabela de dados não tem semântica de grade (grid)** — sem `role`, sem `aria-rowindex`, `tabIndex` removido — portanto usuários de teclado e leitor de tela não conseguem operar a visualização principal. Sem rascunhos, sem conteúdo por localidade, sem rich-text em blocos |
| Banco de dados de dev gerenciado PGlite | Beta | `rebase dev` com configuração zero e sem Docker. Uma sessão por vez, portanto as requisições são serializadas e a concorrência não pode ser reproduzida nele; comandos baseados no Atlas (`db push`, `generate`, `migrate`) planejam contra um segundo PGlite descartável iniciado para o comando (na 0.24 eles recusam o banco gerenciado); `db branch` não funciona nele e informa isso |
| Helm chart | Beta | Renderiza a topologia de processos separados e é publicado no registro OCI a cada lançamento. O padrão continua sendo um único contêiner |
| `@rebasepro/server-mongo` | **Experimental** | Um driver funcional com realtime via change-streams e histórico por snapshots. **Sem row-level security** — todo o modelo de isolamento acima não se aplica a ele — e sem relações. Change streams precisam de um replica set: em um `mongod` standalone nada os substitui, de forma que uma assinatura vê as escritas feitas através daquele processo Rebase e perde todas as outras. Sem MFA: o registro responde 501, e as verificações respondem "sem fator", portanto o login nunca solicita um. O agregador admin não pode mirar uma coleção — ele lê o nome de um estágio `$from` que o MongoDB não possui — retornando nada |
| `@rebasepro/firebase` | Experimental | Executa o painel de administração e o SDK contra o Firestore. Sem RLS, sem interface SQL; o conjunto de recursos do Postgres não é transferido. O driver do Firestore ignora grupos de filtros `or(...)`/`and(...)`, portanto uma consulta que use um lê todas as linhas permitidas pelos seus filtros simples |
| Rebase Cloud | **Beta privado** | Ativo, executando tenants reais, liberado em lotes. Não disponível como autosserviço (self-serve) |

Duas entradas acima são o custo honesto de publicar esta tabela: o refetch
do realtime e a acessibilidade da tabela de dados são defeitos em aberto, não
itens de roadmap, e ambos estão listados em vez de deixados para o leitor descobrir.

Esta tabela representa o que existe. O que ainda não existe está no
[roadmap](https://rebase.pro/roadmap), uma entrada por issue do GitHub, com o
subconjunto necessário para a 1.0 demarcado.

## A promessa do 0.x

O Rebase está em `0.x`. Esta seção foi escrita para ser válida para todas as versões
0.x em vez de apenas uma delas, para não ficar desatualizada a cada release. **Mudanças
que quebram compatibilidade na API TypeScript escrita ainda são permitidas em versões minor**,
e o changelog é onde elas são anunciadas. O que *não* tem permissão para quebrar silenciosamente
é o conjunto de contratos versionados abaixo: cada um é carimbado em um artefato ou banco de
dados, cada um é verificado na inicialização ou no recebimento, e cada um falha
**de forma ruidosa e específica** em vez de degradar.

Essa distinção é toda a promessa. Uma exportação renomeada custa um erro de compilação
e cinco minutos. Um bundle que inicializa com o runtime errado e serve dados sutilmente
incorretos custa um incidente, e os contratos existem para que essa segunda categoria não
aconteça silenciosamente.

O Rebase Cloud consome exatamente esses contratos e nada mais. Qualquer coisa não listada
aqui é um detalhe de implementação do qual a plataforma não depende.

### Badges de versão e canaries

A documentação é publicada a partir de `main`, portanto uma página pode descrever algo
que nenhuma versão estável possui ainda. Um badge *Since* (A partir de) indica a primeira versão
estável que o inclui, e o texto ao lado informa o comportamento da versão anterior.

Um canary é uma compilação de `main` numerada de acordo com o lançamento ao qual se destina:
`0.25.0-canary.g<commit>` é a `main` naquele commit, posterior à 0.24.0 e anterior à 0.25.0,
e `rebase upgrade --to canary` instala o mais recente. Ele contém tudo o que havia chegado
à `main` quando foi compilado, portanto um badge indicando sua versão (Since 0.25) se aplica
a você, e a nota sobre a versão anterior (on 0.24) descreve a versão estável de onde você veio.
Os canaries anteriores a 0.25.0 eram numerados a partir da última versão lançada:
`0.24.1-canary.g<commit>` também é uma prévia da 0.25.

## Os contratos versionados

Os valores abaixo são lidos diretamente do código-fonte; trate as referências aos arquivos
como a verdade e esta tabela como o mapa.

```bash
grep -rn "BUNDLE_FORMAT_VERSION =\|RUNTIME_CONTRACT_VERSION =" packages/types/src/types/project_manifest.ts
grep -n "AUTH_SCHEMA_VERSION =" packages/server-postgres/src/auth/schema-version.ts
```

| # | Contrato | Declarado em | Verificado em | Direção de compatibilidade |
|---|---|---|---|---|
| 1 | intervalo de `rebase` em `rebase.json` | no projeto do usuário | CLI no build | o projeto declara quais runtimes aceita |
| 2 | `BUNDLE_FORMAT_VERSION` | `packages/types/src/types/project_manifest.ts` | `packages/server/src/boot/bundle.ts` | **compatível com versões anteriores** — novo runtime lê bundles antigos |
| 3 | `RUNTIME_CONTRACT_VERSION` | mesmo arquivo | mesmo arquivo | **correspondência exata, em ambas as direções** |
| 4 | `AUTH_SCHEMA_VERSION` | `packages/server-postgres/src/auth/schema-version.ts` | no boot, contra `rebase.schema_meta` | **apenas para frente** — novo runtime migra bancos antigos |
| 5 | `manifest.schemaVersion` | emitido por `rebase build` | enviado pelo SDK como `x-rebase-schema` quando configurado | informativo — identifica contra qual schema o cliente foi compilado |
| 6 | Identificadores derivados de banco de dados | `contracts/derived-names.txt` | `pnpm check:derived-names` | **congelado** — um nome emitido por uma versão nunca é recalculado |

### 1 — `rebase` em `rebase.json`

Um intervalo semver, interpretado como `engines` em um `package.json`: quais versões de
runtime este projeto aceita. Denominado `rebase` em vez de `runtime` deliberadamente,
porque `runtime` já significa *quem é o proprietário do processo* (`managed` | `custom`) em uma aplicação.

### 2 — `BUNDLE_FORMAT_VERSION` (atualmente 2)

O layout em disco de um bundle compilado. Um runtime aceita qualquer bundle cujo formato
seja **menor ou igual** ao seu próprio, o que permite à camada gerenciada mover um tenant
para uma nova imagem sem que ninguém precise recompilar seu projeto.

- **1** — `mode: "cms" | "baas" | "static"`, `entry.static` como diretório único,
  `entry.admin` para uma interface administrativa empacotada.
- **2** — `kind: "backend" | "static"`, `entry.static` como lista, `entry.admin`
  removido. O formato 1 ainda é lido, através de `upgradeLegacyManifest`.

**Incremente quando** o layout mudar de tal forma que um runtime mais antigo leria incorretamente
um bundle mais novo. O incremento é o que converte "inicializa e não serve nada" em uma
recusa de inicialização.

### 3 — `RUNTIME_CONTRACT_VERSION` (atualmente 1)

A versão principal (major) do contrato bundle↔runtime. Distinta da versão do pacote
`@rebasepro/server`, que pode lançar qualquer quantidade de minors e patches enquanto esta permanece inalterada.

**Leia isto antes de mexer aqui.** A verificação é `!==`, não `>`:

> um bundle que tem como alvo o contrato *N* executa **apenas** em um runtime que implementa *N*

portanto, incrementá-lo invalida **todos os bundles já compilados**, todos de uma vez, até
que cada um seja reconstruído. Essa é a severidade pretendida — é a alavanca de "nada antigo pode
rodar aqui" —, mas significa que um incremento é uma migração em toda a frota, não apenas uma nota de lançamento.
Para a camada gerenciada, isso deve ser coordenado com a recompilação do bundle de cada tenant.

Se uma alteração for *aditiva* e os bundles antigos continuarem corretos, ela deve ser tratada em
`BUNDLE_FORMAT_VERSION` (ou em lugar nenhum), não aqui.

### 4 — `AUTH_SCHEMA_VERSION` (atualmente 2)

Carimbado em `rebase.schema_meta` e comparado na inicialização. Um runtime **se recusa a
iniciar** contra um banco de dados migrado por uma versão mais recente do framework, em vez
de operar sobre uma estrutura que ele não compreende — durante um rolling deploy, essa é a
diferença entre metade da frota apresentar erros e metade da frota corromper dados.

A migração progressiva é automática: `ensureAuthTablesExist` atualiza um banco de dados mais antigo.
Note que este bloco de migração é deliberadamente envolvido em `try/catch` e registra logs em vez
de lançar exceções — uma inicialização capenga é melhor do que um crash loop — portanto, **"inicializou"
não prova nada**. Cada asserção na suíte de atualização lê o catálogo ou os dados reais.

**Incremente quando** uma migração não puder ser ignorada por um runtime mais antigo. Não
incremente para uma coluna aditiva e retrocompatível; há um exemplo prático desse critério
em `packages/server-postgres/src/auth/ensure-tables.ts`.

### 5 — `manifest.schemaVersion`

Um hash das definições de coleções compiladas, emitido no manifesto do bundle e reproduzido
por um SDK gerado no cabeçalho `x-rebase-schema` (`SCHEMA_VERSION_HEADER`). Ele existe para
que a plataforma possa informar "este aplicativo foi compilado contra um esquema mais antigo"
em vez de falhar misteriosamente na primeira requisição.

`rebase generate-sdk` escreve o valor em `schema.meta.ts`; passe-o para o cliente para enviá-lo:

```typescript
import { SCHEMA_VERSION } from "./generated/sdk/schema.meta";

const rebase = createRebaseClient<Database>({
    baseUrl: "http://localhost:3001",
    collections: collectionsDictionary,
    schemaVersion: SCHEMA_VERSION,
});
```

O backend lê esse cabeçalho a cada requisição de dados. O descompasso (drift) nunca recusa
uma chamada — um SDK uma versão de esquema atrás geralmente ainda é compatível, e implantar
o backend antes do frontend é a ordem normal de deploy —, mas quando uma requisição falha
com um erro 400 ou 404, o erro carrega a discrepância como causa:

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

Assim, uma coluna renomeada é interpretada como "seu SDK está desatualizado, gere-o novamente"
em vez de um campo que seus próprios tipos insistem que existe. Uma requisição bem-sucedida
nunca é notificada disso.

Isso cobre **apenas coleções**. A edição de um hook ou de uma function não altera o contrato
do cliente e não deve invalidar todos os SDKs gerados.

### Quem está chamando

Mais dois sinais de identificação, nenhum dos quais impõe bloqueios por conta própria:

- **`GET /api/meta/schema-version`** não requer autenticação e responde com o `schemaVersion`
  do projeto *e* seu `runtime` (`version` e `contract`). Um job de CI comparando seu SDK
  gerado com um projeto em execução não precisa de credenciais, e nem um cliente perguntando
  com qual runtime está se comunicando.
- **`User-Agent: rebase-cli/<version>`** vai em todas as requisições de `rebase cloud`.
  O formato de rede do control plane evolui mais rápido do que o que é publicado no npm,
  portanto ele precisa ser capaz de responder a um cliente antigo com `CLI_TOO_OLD` e a versão
  mínima necessária — o que só pode ser feito para um chamador que declare quem é.

### 6 — Identificadores de banco de dados derivados

Cada nome que este framework descobre por conta própria em vez de receber pronto: uma coluna
de chave estrangeira, uma restrição (constraint) de chave estrangeira, uma tabela de junção
e suas duas colunas de chave, um tipo enum, um nome de política (policy), a coluna em `snake_case`
de uma propriedade em `camelCase`.

> **Um identificador derivado é congelado no instante em que uma versão o emite.**

Não "congelado até a próxima versão principal" — congelado. A razão é diferente dos outros
cinco contratos, e mais rígida. Aqueles são versionados, permitindo que uma incompatibilidade
seja *detectada* e recusada. Este não pode: o nome é gravado no banco de dados do cliente no
dia em que ele faz o deploy, e não existe carimbo de versão em uma coluna. Cada banco de dados
provisionado por cada versão já lançada carrega tudo o que ela derivou, e nenhum código neste
repositório tem como intervir e renomear todos eles.

A versão 0.13 é o exemplo prático. `generateForeignKeyName` aprendeu a singularizar corretamente
— `categorie_id` → `category_id`, `addres_id` → `address_id` —, o que é indiscutivelmente uma derivação
melhor, mas quebrou todos os bancos de dados antigos que tinham um plural irregular. O boot-ensure
migrou a coluna, então os dados sobreviveram; o `schema.generated.ts` commitado no projeto não acompanhou,
e a inicialização travava em uma coluna que existia. Três commits, um novo teste de fronteira (seam test)
e uma entrada definitiva nas notas de atualização, tudo em troca de um nome de coluna mais elegante
pelo qual ninguém havia perguntado.

**Se uma derivação estiver genuinamente incorreta**, ela mudará para coleções criadas
*posteriormente*, sob uma estratégia de nomenclatura registrada no projeto — nunca retroativamente,
e nunca como efeito colateral da melhoria da função subjacente.

**A única substituição legítima** é uma alteração que faça o código coincidir com um nome que
o banco de dados *já possui*. O exemplo prático é o truncamento de identificadores: o Postgres
trunca silenciosamente um identificador para 63 bytes, de modo que um nome de constraint derivada
mais longo nunca foi o nome que constava no catálogo — a derivação descrevia um objeto que não existia
com aquela grafia, e o boot-ensure reemitia `ADD CONSTRAINT` a cada inicialização porque sua
comparação nunca coincidia. Truncar na construção altera o que este repositório *deriva* e não muda
nada sobre o que qualquer banco de dados já implantado *contém*. Esse é o critério a ser aplicado:
não "o novo nome é melhor", mas "algum banco de dados existente precisará mudar".

O outro caso em que um nome pode mudar é quando há um conjunto de nomes que nunca poderiam existir
simultaneamente. Uma regra abrangendo várias operações em uma tabela de 42 bytes ou mais derivava
`<table>_default_admin_write_insert`, `_update` e `_delete`, e todas as três eram truncadas para
os mesmos 63 bytes. O Postgres armazenava apenas uma política, DELETE, e recusava todos os INSERTs
e UPDATEs administrativos. Apenas quando nomes de regras colidem dessa maneira eles são derivados
pelo sufixo primeiro, como `<head>_<hash8>_<op>`. Todo nome que funciona hoje mantém sua grafia.
A próxima inicialização ou push remove a política truncada única e cria uma política para cada operação.

A única coisa sempre segura é *reconhecer* um nome antigo para migrá-lo: `legacyForeignKeyName`
existe para ser detectado, nunca para ser gerado, e a baseline fixa essas detecções também.
Remover uma desfaz silenciosamente a migração de qualquer banco de dados que ainda carregue essa grafia.

**O gate.** `tooling/scripts/derived-names.mts` executa uma fixture de teste de estresse de nomenclatura
— plurais irregulares, terminação com `ss`, siglas, junções a partir de um slug no plural,
substituições explícitas, um slug longo o suficiente para ser truncado — através de ambos os produtores
de DDL de esquema, e renderiza cada identificador que qualquer um deles nomeia:

```bash
pnpm check:derived-names
```

Uma linha alterada ou removida falha como uma violação de contrato, exibindo a grafia antiga e a nova
lado a lado. Uma alteração puramente aditiva também falha, mas com a mensagem "regenerate" — garantindo
que a baseline não sofra deriva inadvertida para ninguém.

Ele também assegura que o `rebase db push` e o boot-ensure do runtime gerenciado derivem os *mesmos* nomes,
o que é um segundo contrato oculto dentro do primeiro: eles compilam as mesmas coleções por meio de
códigos diferentes, e um projeto enviado uma vez e inicializado mais tarde não pode terminar com dois esquemas.

## O que *não* está congelado

Dito claramente, para que ninguém deduza promessas que nunca foram feitas:

- A API TypeScript escrita — configuração de coleções, opções de `initializeRebaseBackend`,
  props de admin, nomes de métodos de SDK. Alterações incompatíveis chegam em minors e são anunciadas no changelog.
- `@rebasepro/studio`, `@rebasepro/mcp`, `@rebasepro/inference`, `@rebasepro/plugin-*` — estes avançam
  mais rápido e têm menos consumidores.
- Qualquer coisa sob o diretório `src/` de um pacote que não seja reexportada a partir de seu barrel.
  `packages/client/src/index.ts` traz uma nota explicando que sua lista de exportações é mantida
  rigorosamente para que uma exportação interna não se torne pública por acidente.
- O esquema de banco de dados das *suas* coleções. Isso pertence a você; o Rebase possui apenas
  o esquema `rebase` (e, em um banco de dados provisionado antes da 0.13, o esquema antigo `auth`
  até que a inicialização o descontinue).

## Os gates que garantem isso

Nada do que foi dito acima é convenção — cada item tem um teste que falha quando violado:

| Gate | O que ele fixa |
|---|---|
| `pnpm verify:corpus` | todos os formatos de bundle já lançados, inicializados no runtime atual. As fixtures em `tests/fixtures/bundles/` são **escritas à mão e congeladas** — uma fixture que o builder regenera muda sempre que o builder muda |
| `pnpm verify:selfhost` | um bundle real compilado, empacotado, inicializado e requisitado como um navegador faria |
| `upgrade-e2e.test.ts` | esquemas de banco de dados antigos (`schema-snapshots/`) encontrados pelo runtime atual |
| `tests/e2e/tests/cli-init-e2e.ts` | um projeto estruturado instalado a partir de **tarballs reais**, não de links de workspace |
| `tests/e2e/tests/client-sdk-e2e.ts` | o fluxo do usuário final: registrar → fazer login → leituras no escopo de RLS → refresh → storage → realtime |
| `pnpm check:derived-names` | cada nome de coluna, constraint, junção, enum e política que o framework deriva — e se o boot e o `db push` os derivam de forma idêntica |
| `pnpm rls:check` | as políticas do esquema gerado |
| `pnpm check:api-surface` | cada exportação, e seus membros, dos cinco pacotes fornecidos pela imagem — `@rebasepro/server`, `types`, `client`, `common`, `utils` — além do ponto de entrada `@rebasepro/server/functions`, comparados com as seis seções de `contracts/server.api.txt`. Esses são os pacotes que `infra/docker/entrypoint.mjs` sobrescreve com links simbólicos sobre as cópias do próprio bundle implantado; portanto, remover uma exportação de um deles não resulta em erro de compilação para ninguém — resulta em falha de inicialização em toda a frota durante uma distribuição não solicitada |
| `pnpm test:gates` | os próprios testes dos gates, sobre fixtures — quarenta e sete arquivos, incluindo `check:api-surface` e a verificação de bump de release abaixo — de modo que um gate que deixe de monitorar o que protege falha aqui. `check:api-surface` passou toda a sua vida sem conseguir notar um membro desaparecer de `const rebase` |
| `node tooling/scripts/check-release-bump.mjs` | garante que o nível de incremento de versão com o qual um release é lançado corresponda ao que o release fez com as baselines acima — executado pelo `publish.yml` antes que o changelog seja carimbado |
| saas CI | o control plane compilado contra a branch `main` deste repositório, em seus próprios pushes e nightly |

**Registre uma fixture de bundle e um snapshot de esquema uma vez por release.** O valor
de ambos os corpora reside inteiramente em quão longe no tempo o mais antigo alcança,
e nenhum dos dois pode ser preenchido retroativamente depois.

### Ainda sem gates

A tabela acima é o que está garantido. Estas são as partes da política que nada garante
ainda, listadas para que ninguém presuma compromissos inexistentes:

- **Sem janela de depreciação ou suporte.** Enquanto o Rebase for `0.x`, não há regra escrita
  determinando quanto tempo uma exportação depreciada sobrevive antes de ser removida, ou por
  quanto tempo uma minor anterior recebe correções. Correções de segurança saem apenas na minor mais recente.
- **O formato de rede HTTP não possui gate.** Nenhum script `check:*` compara os formatos de
  requisição e resposta com uma baseline da mesma forma que `check:api-surface` faz com exportações;
  uma alteração no formato de resposta só é detectada por uma suíte e2e que por acaso a leia.
- **Flags de CLI não possuem baseline de compatibilidade.** O verificador da documentação falha
  quando uma flag usada pelas skills, pelos exemplos ou pelo site de marketing desaparece; nada
  detecta a remoção de qualquer outra flag ou a mudança no significado de uma delas.
- **Uma release de CI não registra nenhum dos corpora.** O fluxo de publicação não registra
  nenhuma fixture de bundle e nenhum snapshot de esquema; apenas o script de lançamento local tenta
  fazer isso, emitindo avisos em vez de interromper quando não consegue. Da versão 0.18 até a 0.21
  não há snapshot de projeto registrado.
- **A superfície de exportação é um gate, não um contrato.** Se as exportações públicas dos
  pacotes fornecidos pelo runtime se tornarão um sétimo contrato numerado — declarado como a
  baseline do `check:api-surface`, compatível de forma aditiva dentro de uma major do contrato —
  é uma decisão em aberto.

## Alterando um contrato

1. Decida qual dos seis contratos está sendo alterado. A maioria das mudanças não se enquadra
   em nenhum deles — mas "nenhum dos seis" não significa "isento de controvérsias". Remover ou
   renomear uma exportação de `@rebasepro/server`, ou um membro dela, não faz parte dos seis e é
   a mudança mais perigosa em todo o repositório, pois o código que ela quebra já está compilado
   e não será recompilado. `pnpm check:api-surface` é o que sustenta essa linha; se isso se tornará
   um sétimo contrato numerado é uma decisão em aberto (consulte *Ainda sem gates*, acima).
2. Adicione primeiro uma fixture ou snapshot para o formato **antigo** e confirme que ela passa.
3. Faça a alteração e incremente a constante correspondente.
4. Confirme que a fixture antiga ainda passa, ou que agora falha *com a mensagem de que o usuário
   precisaria*. Ambos são resultados válidos; o silêncio não é.
5. Para o contrato 3, planeje a recompilação de cada bundle implantado antes de realizar o merge.
6. O contrato 6 é a exceção aos passos 3 e 4: não há constante para incrementar e nenhuma versão
   onde recusar, pois uma coluna não traz carimbo de versão. O passo que os substitui é a decisão
   de não fazer a alteração — veja a seção acima para entender como é a alternativa.

## Relacionado

- [Atualização](/docs/upgrading/) — o que realmente quebrou, versão por versão
- [Changelog](/docs/changelog/) — cada alteração, incluindo as que não quebraram nada
- [Runtime e Bundles](/docs/architecture/runtime-and-bundles/) — contrato 3 — o formato de bundle contra o qual um projeto implantado já foi construído
