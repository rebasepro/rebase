---
sourceHash: 5de8d85cb2d31896
slug: pt/docs/compatibility
title: Compatibilidade
description: O que o Rebase promete entre versões e o que não promete — os seis contratos versionados, como cada um falha e o que ainda pode mudar em uma minor.
---

O que o Rebase promete entre versões, e o que não promete.

Este é o documento para ler antes de alterar qualquer coisa da qual um projeto em
produção ou um tenant em execução no Rebase Cloud já dependa. É também a resposta
honesta para "se eu construir no Rebase hoje, o que vai quebrar no futuro?"

## O que "beta" significa aqui

O Rebase está em beta público. A maioria dos projetos usa essa palavra para
significar "qualquer coisa pode quebrar", o que não dá ao leitor nada sobre o
qual se planejar, então aqui está o limite que este projeto realmente estabelece:

> **A API contra a qual você escreve pode mudar em uma versão minor, com uma entrada no changelog.
> Seus dados não podem quebrar silenciosamente.**

A primeira metade é o comportamento comum de `0.x` e é descrita abaixo. A segunda
metade é a parte que vale a pena verificar, pois é uma afirmação sobre mecanismos
e não sobre intenções: os contratos versionados na próxima seção são carimbados
em um artefato ou em um banco de dados, cada um é verificado na inicialização ou
no consumo, e cada um **falha de forma ruidosa e específica** em vez de degradar.
Um push de schema que removeria uma coluna é recusado por uma barreira de segurança
destrutiva (`packages/server-postgres/test/e2e/db-push-safety.test.ts`), e o próprio
caminho de upgrade é um teste: `upgrade-e2e.test.ts` restaura bancos de dados como
versões anteriores os deixaram, executa o caminho de migração atual sobre cada um
e valida que as linhas sobrevivem — e não apenas que a inicialização ocorreu.

O que beta de fato significa: recursos ainda estão ausentes, alguns subsistemas
são mais novos que outros, e o formato de uma aresta a ser aparada é que algo está
ausente ou é estranho, e não que corrompa algo silenciosamente. Quais subsistemas
são quais é algo publicado e datado, em vez de deixado para ser descoberto.

## A promessa do 0.x

O Rebase está em `0.x` — 0.16 no momento da escrita. Esta seção foi escrita para
ser válida para todas as versões 0.x em vez de apenas uma delas, para que não fique
obsoleta a cada lançamento. **Breaking changes na API TypeScript que você utiliza
ainda são permitidas em uma minor**, e o changelog é onde elas são anunciadas. O
que *não* é permitido quebrar silenciosamente é o conjunto de contratos versionados
abaixo: cada um é carimbado em um artefato ou em um banco de dados, cada um é
verificado na inicialização ou no consumo, e cada um falha **de forma ruidosa e
específica** em vez de degradar.

Essa distinção é toda a promessa. Uma exportação renomeada custa um erro de
compilação e cinco minutos. Um bundle que inicializa com o runtime errado e serve
dados sutilmente incorretos custa um incidente, e os contratos existem para que essa
segunda categoria não ocorra silenciosamente.

O Rebase Cloud consome exatamente esses contratos e nada mais. Qualquer coisa não
listada aqui é um detalhe de implementação do qual a plataforma não depende.

## Os contratos versionados

Os valores abaixo são lidos a partir do código-fonte; trate as referências de
arquivos como a verdade e esta tabela como o mapa.

```bash
grep -rn "BUNDLE_FORMAT_VERSION =\|RUNTIME_CONTRACT_VERSION =" packages/types/src/types/project_manifest.ts
grep -n "AUTH_SCHEMA_VERSION =" packages/server-postgres/src/auth/schema-version.ts
```

| # | Contrato | Declarado em | Verificado em | Direção de compatibilidade |
|---|---|---|---|---|
| 1 | intervalo de `rebase` em `rebase.json` | o projeto do usuário | CLI no build | o projeto declara quais runtimes aceita |
| 2 | `BUNDLE_FORMAT_VERSION` | `packages/types/src/types/project_manifest.ts` | `packages/server/src/boot/bundle.ts` | **retrocompatível** — novo runtime lê bundles antigos |
| 3 | `RUNTIME_CONTRACT_VERSION` | mesmo arquivo | mesmo arquivo | **correspondência exata, ambas as direções** |
| 4 | `AUTH_SCHEMA_VERSION` | `packages/server-postgres/src/auth/schema-version.ts` | na inicialização, contra `rebase.schema_meta` | **apenas para frente (forward only)** — novo runtime migra bancos de dados antigos |
| 5 | `manifest.schemaVersion` | emitido por `rebase build` | enviado pelo SDK como `x-rebase-schema` | consultivo — identifica contra qual schema um cliente foi construído |
| 6 | Identificadores de banco de dados derivados | `contracts/derived-names.txt` | `pnpm check:derived-names` | **congelado** — um nome emitido por uma versão nunca é rederivado |

### 1 — `rebase` em `rebase.json`

Um intervalo semver, lido como `engines` em um `package.json`: quais versões de
runtime este projeto aceita. Nomeado `rebase` em vez de `runtime` deliberadamente,
porque `runtime` já significa *quem é o proprietário do processo* (`managed` | `custom`)
em uma aplicação.

### 2 — `BUNDLE_FORMAT_VERSION` (atualmente 2)

O layout em disco de um bundle compilado. Um runtime aceita qualquer bundle cujo
formato seja **menor ou igual** ao seu próprio, o que permite que a camada gerenciada
mova um tenant para uma nova imagem sem que ninguém precise recompilar o projeto.

- **1** — `mode: "cms" | "baas" | "static"`, `entry.static` um único diretório,
  `entry.admin` para um admin empacotado.
- **2** — `kind: "backend" | "static"`, `entry.static` uma lista, `entry.admin`
  removido. O formato 1 ainda é lido, via `upgradeLegacyManifest`.

**Incremente quando** o layout mudar de modo que um runtime mais antigo interprete
incorretamente um bundle mais novo. O incremento é o que converte "inicializa e não
serve nada" em uma recusa de inicialização.

### 3 — `RUNTIME_CONTRACT_VERSION` (atualmente 1)

O major do contrato bundle↔runtime. Distinto da versão do pacote `@rebasepro/server`,
que pode lançar qualquer número de minors e patches enquanto este permanece inalterado.

**Leia isto antes de mexer nele.** A verificação é `!==`, não `>`:

> um bundle visando o contrato *N* executa **apenas** em um runtime que implementa *N*

portanto, incrementá-lo invalida **todos os bundles já construídos**, de uma só vez,
até que cada um seja reconstruído. Essa é a severidade pretendida — é a alavanca de
"nada antigo pode rodar aqui" —, mas significa que um incremento é uma migração em
toda a frota, não uma nota de lançamento. Para a camada gerenciada, isso deve ser
sequenciado com a reconstrução do bundle de cada tenant.

Se uma alteração for *aditiva* e os bundles antigos ainda estiverem corretos, ela
requer `BUNDLE_FORMAT_VERSION` (ou nada), não este.

### 4 — `AUTH_SCHEMA_VERSION` (atualmente 2)

Carimbado em `rebase.schema_meta` e comparado na inicialização. Um runtime **se
recusa a iniciar** contra um banco de dados migrado por uma versão mais recente do
framework, em vez de operar em uma estrutura que ele não compreende — durante um
rolling deploy, essa é a diferença entre metade da frota dar erro e metade da frota
corromper dados.

A migração direta (forward migration) é automática: `ensureAuthTablesExist` atualiza
um banco de dados mais antigo. Observe que este bloco de migração é deliberadamente
envolvido em `try/catch` e registra logs em vez de lançar erros — uma inicialização
capenga é melhor que um crash loop —, portanto **"inicializou" não prova nada**. Cada
asserção na suíte de upgrade lê o catálogo ou os dados em vez disso.

**Incremente quando** uma migração não puder ser ignorada por um runtime mais antigo.
Não incremente para uma coluna aditiva e retrocompatível; há um exemplo prático
dessa decisão em `packages/server-postgres/src/auth/ensure-tables.ts`.

### 5 — `manifest.schemaVersion`

Um hash das definições de collections compiladas, emitido no manifesto do bundle
e retornado por um SDK gerado no cabeçalho `x-rebase-schema` (`SCHEMA_VERSION_HEADER`).
Ele existe para que a plataforma possa dizer "esta aplicação foi construída contra
um schema mais antigo" em vez de falhar misteriosamente na primeira requisição.

Ele cobre **apenas collections**. A edição de um hook ou função não altera o contrato
de um cliente e não deve invalidar todos os SDKs gerados.

### 6 — Identificadores de banco de dados derivados

Todo nome que este framework descobre por conta própria em vez de ser informado:
uma coluna de chave estrangeira, uma constraint de chave estrangeira, uma tabela de
junção e suas duas colunas de chave, um tipo enum, um nome de policy, a coluna em
`snake_case` de uma propriedade em `camelCase`.

> **Um identificador derivado é congelado no momento em que uma versão o emite.**

Não "congelado até o próximo major" — congelado. O raciocínio é diferente dos outros
cinco contratos, e mais forte. Aqueles são versionados, portanto uma incompatibilidade
pode ser *detectada* e recusada. Este não pode: o nome é gravado no banco de dados
de um cliente no dia em que ele faz o deploy, e não há carimbo de versão em uma
coluna. Todo banco de dados provisionado por qualquer versão já lançada carrega o
que quer que ela tenha derivado, e nenhum código neste repositório pode acessá-los
e renomear todos.

O 0.13 é o exemplo prático. O `generateForeignKeyName` aprendeu a singularizar
corretamente — `categorie_id` → `category_id`, `addres_id` → `address_id` — o que é
comprovadamente a melhor derivação, e isso quebrou todos os bancos de dados antigos
que tinham um plural irregular. O boot-ensure migrou a coluna, então os dados
sobreviveram; o `schema.generated.ts` versionado do projeto não, e a inicialização
falhou em uma coluna que existia. Três commits, um novo teste de integração (seam
test) e uma entrada permanente nas notas de upgrade, em troca de um nome de coluna
mais bonito pelo qual ninguém havia perguntado.

**Se uma derivação estiver genuinamente incorreta**, ela muda para collections criadas
*depois*, atrás de uma estratégia de nomenclatura registrada no projeto — nunca
retroativamente, e nunca como um efeito colateral de melhorar a função subjacente.

**A única sobreposição legítima** é uma alteração que faz o código concordar com um
nome que o banco de dados *já possui*. O exemplo prático é o truncamento de
identificadores: o Postgres silenciosamente corta um identificador em 63 bytes,
portanto um nome de constraint derivado mais longo nunca foi o nome no catálogo — a
derivação estava descrevendo um objeto que não existia sob aquela grafia, e o
boot-ensure reemitia `ADD CONSTRAINT` em cada inicialização porque sua comparação
nunca coincidia. Truncar na construção altera o que este repositório *deriva* e não
muda nada sobre o que qualquer banco de dados implantado *contém*. Esse é o teste a
ser aplicado: não "o novo nome é melhor", mas "algum banco de dados existente precisa
mudar".
A única coisa que é sempre segura é *reconhecer* um nome antigo para migrá-lo:
`legacyForeignKeyName` existe para ser detectado, nunca para ser gerado, e a baseline
fixa essas detecções também. Remover uma desfaz silenciosamente a migração de todo
banco de dados que ainda carrega essa grafia.

**A barreira de verificação (gate).** `scripts/derived-names.mts` executa uma fixture
de teste de estresse de nomenclatura — plurais irregulares, terminação em `ss`, um
acrônimo, uma junção a partir de um slug plural, sobreposições explícitas, um slug
longo o suficiente para truncar — através de ambos os produtores de DDL de schema, e
renderiza todos os identificadores que qualquer um deles nomeia:

```bash
pnpm check:derived-names
```

Uma linha alterada ou removida falha como uma quebra de contrato, com a grafia antiga
e a nova lado a lado. Uma alteração puramente aditiva também falha, mas com
"regenerate" — para que a baseline não sofra desvios sem que ninguém perceba.

Também fixa que o `rebase db push` e o boot-ensure do runtime gerenciado derivam os
*mesmos* nomes, o que é um segundo contrato escondido dentro do primeiro: eles
compilam as mesmas collections através de códigos diferentes, e um projeto enviado
via push uma vez e inicializado posteriormente não pode terminar com dois schemas.

## O que *não* está congelado

Dito de forma clara, para que ninguém deduza uma promessa que nunca foi feita:

- A API TypeScript utilizada — configuração de collection, opções de
  `initializeRebaseBackend`, props de admin, nomes de métodos do SDK. Breaking changes
  ocorrem em minors e são anunciadas no changelog.
- `@rebasepro/studio`, `@rebasepro/mcp`, `@rebasepro/inference`,
  `@rebasepro/plugin-*` — estes mudam mais rápido e têm menos consumidores.
- Qualquer coisa sob o `src/` de um pacote que não seja reexportada a partir de seu
  barrel. `packages/client/src/index.ts` traz uma nota explicando que sua lista de
  exportação é selecionada precisamente para que uma exportação interna não se torne
  pública por acidente.
- O schema do banco de dados das *suas* collections. Isso é seu; o Rebase é
  proprietário apenas dos schemas `rebase` e `auth`.

## As barreiras (gates) que garantem isso

Nada do que foi dito acima é uma convenção — cada item tem um teste que falha
quando é quebrado:

| Barreira (Gate) | O que ela garante/fixa |
|---|---|
| `pnpm verify:corpus` | todo formato de bundle já lançado, inicializado no runtime de hoje. As fixtures em `fixtures/bundles/` são **escritas à mão e congeladas** — uma fixture que o builder regenera muda sempre que o builder muda |
| `pnpm verify:selfhost` | um bundle real compilado, compactado, inicializado e requisitado como um navegador faria |
| `upgrade-e2e.test.ts` | schemas de banco de dados antigos (`schema-snapshots/`) recebidos pelo runtime atual |
| `e2e/tests/cli-init-e2e.ts` | um projeto gerado a partir de scaffolding instalado a partir de **tarballs reais**, não links de workspace |
| `e2e/tests/client-sdk-e2e.ts` | o fluxo do usuário final: cadastro → login → leituras com escopo de RLS → refresh → storage → realtime |
| `pnpm check:derived-names` | todo nome de coluna, constraint, junção, enum e policy que o framework deriva — e que o boot e o `db push` os derivam de forma idêntica |
| `pnpm rls:check` | as policies do schema gerado |
| `pnpm check:api-surface` | toda exportação de `@rebasepro/server`, e seus membros, contra `contracts/server.api.txt`. Este é o pacote para o qual `infra/docker/entrypoint.mjs` cria um symlink sobre a própria cópia de um bundle implantado, portanto remover uma exportação dele não é um erro de compilação para ninguém — é uma falha de inicialização em toda a frota, durante um rollout que ninguém pediu |
| `pnpm test:gates` | as duas barreiras acima, sobre fixtures. O `check:api-surface` passou toda a sua existência incapaz de ver um membro desaparecer de `const rebase` |
| `node scripts/check-release-bump.mjs` | que o nível de incremento (bump) com o qual uma versão é lançada corresponde ao que a versão fez nas baselines acima — executado por `publish.yml` antes do changelog ser carimbado |
| CI do SaaS | o plano de controle construído contra a `main` deste repositório, em seus próprios pushes e nightly |

**Grave uma fixture de bundle e um snapshot de schema uma vez por lançamento.** O
valor de ambos os conjuntos reside inteiramente em quão longe no passado o mais
antigo vai, e nenhum deles pode ser preenchido retroativamente após o fato.

## Alterando um contrato

1. Decida qual dos seis ele é. A maioria das alterações não é nenhum deles — mas
   "nenhum dos seis" não significa "incontverso". Remover ou renomear uma
   exportação de `@rebasepro/server`, ou um membro de uma, não é nenhum dos seis e
   é a alteração mais perigosa de todo o repositório, porque o código que ela
   quebra já está construído e não será recompilado. `pnpm check:api-surface` é o
   que mantém essa linha; se isso se tornará um sétimo contrato numerado é uma
   decisão em aberto (`docs/audits/81-compat-policy.md`).
2. Adicione uma fixture ou snapshot para a estrutura **antiga** primeiro e veja o
   teste passar.
3. Faça a alteração e incremente a constante.
4. Confirme que a fixture antiga ainda passa, ou que agora ela falha *com a mensagem
   que um usuário precisaria*. Ambos são resultados válidos; o silêncio não é.
5. Para o contrato 3, planeje a reconstrução de cada bundle implantado antes de
   fazer o merge.
6. O contrato 6 é a exceção aos passos 3 e 4: não há constante para incrementar e
   nenhuma versão na qual recusar, porque uma coluna não carrega carimbo de versão.
   O passo que os substitui é decidir não fazer a alteração — veja a seção acima
   para entender como é a alternativa.

---
