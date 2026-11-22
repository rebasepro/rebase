---
sourceHash: 3f40bdbdc8b0c722
title: Runtime gerenciado do backend
sidebar_label: Runtime Gerenciado
description: O que um backend com runtime "managed" pode e não pode fazer no Rebase Cloud — pacotes e binários, memória e CPU, timeouts e tamanhos de corpo, o sistema de arquivos, estado em memória, segredos, armazenamento para arquivos gerados e rede de saída.
---

Um aplicativo de backend declarado desta forma no `rebase.json` é executado no **runtime
gerenciado**:

```json title="rebase.json"
{
    "apps": {
        "backend": { "type": "backend", "runtime": "managed" }
    }
}
```

Gerenciado (managed) significa que você envia um bundle, não uma imagem. O comando `rebase cloud deploy` compila suas
tabelas, `backend/functions/` e crons em um `dist-bundle`, faz o upload dele, e
o Rebase Cloud o inicializa na imagem pública `rebasepro/server`. Você nunca escreve
um Dockerfile e também não pode alterar o que está na imagem. Esta página lista
o que isso permite, para que você possa planejar uma funcionalidade antes de desenvolvê-la.

Os números aqui apresentados vêm do runtime e da plataforma como eles são hoje. Alguns
são parâmetros que você pode ajustar, e a página indica quais são. As poucas coisas que
ainda não foram prometidas estão reunidas [no final](#ainda-não-prometido).

## Visão geral

| Pergunta | Resposta |
|---|---|
| Versão do Node | Node 22, no Debian slim, `linux`/`x64` |
| Pacotes npm | Sim, do registro público ou de um privado. Instalados no bundle quando você faz o deploy |
| Módulos nativos (`.node`, node-gyp) | Não. O `rebase cloud deploy` recusa o bundle |
| WebAssembly | Sim |
| Criar um processo filho (child process) | Sim, para um binário `linux`/`x64` fornecido por um pacote npm. Consulte [Binários](#binários-e-processos-filhos) |
| Memória e CPU | Definidos por projeto com `rebase cloud compute`. Consulte [Computação](#computação-e-instâncias) |
| Instâncias | 1 por padrão, sempre ativa. Você pode fixar até 5, ou permitir que o autoscaler suba até 16 |
| Timeout de função | 30 segundos, depois `504 FUNCTION_TIMEOUT`. Configurável até 10 minutos |
| Corpo da requisição (Request body) | 10 MiB, depois `413`. Configurável, até os 64 MiB aceitos pelo edge |
| Sistema de arquivos gravável | Sim, mas é temporário e pertence a uma única instância |
| Estado no nível do módulo (um cache `Map`) | Sobrevive entre requisições na mesma instância. Perdido a cada deploy e reinicialização, e não é compartilhado entre instâncias |
| Variáveis de ambiente e segredos | `rebase cloud env set`, aplicados no próximo deploy |
| Armazenamento de arquivos | Um bucket por projeto, servido pelo seu backend em `/api/storage/file/…` |
| HTTP de saída | Sim, nas portas 80 e 443 (e 465, 587, 993 para e-mail). Outras portas são bloqueadas. Um IP de saída fixo: `207.175.138.15` |

## Código e pacotes

**O Node e a imagem.** A imagem de runtime é construída sobre o `node:22-slim`
(Debian), e seu bundle roda em `linux`/`x64` como um usuário não-root. O seu
`tsconfig` e a versão do Node na sua máquina não alteram isso.

**Dependências.** O `rebase cloud deploy` instala as dependências declaradas nos
seus arquivos `package.json` dentro do bundle, para `linux`/`x64`, e faz o upload
delas em conjunto, de modo que uma nova instância não precise instalar nada. Um bundle que
ultrapassaria o limite de upload de 1 GB com elas é enviado sem elas, e o deploy
avisa sobre isso: cada instância então as instala ao inicializar, com `npm ci` (ou
`npm install` se não houver um lockfile). Quatro consequências decorrem de como elas são instaladas:

- **Scripts de instalação nunca são executados.** A instalação usa `--ignore-scripts`. Um pacote
  que baixa um binário ou compila algo no `postinstall` é instalado sem
  essa etapa.
- **Apenas versões de registros são instaladas.** Uma dependência `file:`, `link:`, `git+…` ou `github:`
  falha no build, pois o runtime não tem como resolvê-la.
- **Alguns pacotes vêm da imagem, não de você.** `@rebasepro/server`,
  `@rebasepro/types`, `@rebasepro/client`, `@rebasepro/common`,
  `@rebasepro/utils`, `hono`, `@hono/node-server` e `zod` são removidos das
  dependências do bundle e as próprias cópias da imagem são vinculadas, de modo que a sua
  versão deles não é aplicada. Outros pacotes `@rebasepro/*`, como o
  driver de banco de dados, são instalados a partir do seu `package.json` como qualquer dependência.
  `typescript` e `tsx` também são removidos; eles são ferramentas de build.
- **Pacotes privados precisam de um `.npmrc`.** O `rebase build` copia o `.npmrc` do
  projeto (e `backend/.npmrc`) para o bundle, para que a instalação use as mesmas
  configurações de registro da sua máquina. Cada credencial nele deve ser uma
  referência a variável de ambiente, nunca o token diretamente; um token literal causa falha
  no build, pois o bundle é enviado junto com o seu código:

  ```ini title=".npmrc"
  @acme:registry=https://npm.pkg.github.com
  //npm.pkg.github.com/:_authToken=${NPM_TOKEN}
  ```

  ```bash
  rebase cloud env set NPM_TOKEN=ghp_… --secret
  ```

O upload do bundle é limitado a 1 GB, comprimido.

**Módulos nativos são recusados.** Um pacote que fornece um binário `.node` compilado
não pode ser carregado no runtime gerenciado. O `rebase build` emite um aviso sobre isso, e
o `rebase cloud deploy` é interrompido antes do upload:

```text no-verify
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

A verificação procura por pacotes nativos conhecidos (`sharp`, `canvas`, `bcrypt`,
`argon2`, `sqlite3`, `better-sqlite3`, `re2`, `sodium-native`, `pg-native`, …),
por `binding.gyp` ou `gypfile`, por scripts de instalação que chamam `node-gyp` ou
`prebuild`, e por arquivos `.node`. O
[guia de deployment](/docs/getting-started/deployment/#native-modules-on-the-managed-runtime)
lista as formas comuns de contornar isso. Em resumo: faça o processamento no momento do build,
chame um serviço externo ou faça o deploy com `runtime: "custom"`.

**WebAssembly funciona.** Um pacote que fornece um arquivo `.wasm` e o carrega a partir
do JavaScript não é um módulo nativo, e o Node 22 o executa normalmente. Isso foi verificado
na imagem base do runtime com as configurações de segurança do pod, usando `esbuild-wasm`.
Lembre-se do [limite de memória](#computação-e-instâncias) caso o módulo seja grande,
como um modelo de fala ou de aprendizado de máquina (ML).

### Binários e processos filhos

`child_process` funciona. A imagem em si possui pouquíssimos utilitários para executar: `node`, `npm`,
`sh`, `tar` e as ferramentas cliente do PostgreSQL (`pg_dump`, `pg_restore`). Não há
`ffmpeg`, nem ImageMagick, nem Python e nenhum compilador, e você não pode adicionar
pacotes do sistema, pois não há Dockerfile e o processo não roda como root.

Um binário que um pacote npm inclui **dentro do seu próprio tarball** é instalado com
o pacote e pode ser executado. Ele deve ser compilado para `linux`/`x64` contra a glibc
(Debian), e é executado como um usuário sem privilégios e sem capacidades do Linux (capabilities).
Isso foi verificado com `@esbuild/linux-x64` na imagem base do runtime. Um binário que um
pacote *baixa* no `postinstall` nunca chega a existir, pois os scripts de instalação não
são executados; pacotes como `ffmpeg-static` funcionam dessa forma.

Se um recurso precisar de um binário, use uma API hospedada para essa tarefa, ou migre o
backend para `runtime: "custom"`, onde você compila sua própria imagem.

## Computação e instâncias

Cada projeto roda em seus próprios pods. A memória e a CPU são definidas por instância, e você as
configura com os [parâmetros de computação](/docs/deployment/cloud/#compute-and-what-it-costs):

```bash
rebase cloud compute                              # o que o projeto reserva atualmente
rebase cloud compute set --cpu 500m --memory 1Gi
```

Um projeto que nunca configurou um parâmetro roda como um pod expansível (burstable): ele reserva `100m` de CPU
e `384Mi` de memória, podendo atingir picos de até 2 CPUs e 2 GiB. Uma requisição ajustada mantém
essa proporção entre reserva (request) e limite (limit). Execute `rebase cloud compute` para ver o que
seu projeto possui.

Instâncias:

- **Uma por padrão, sempre em execução.** `--replicas` fixa a quantidade entre 1 e 5.
  Nada escala um backend para zero.
- **Autoscaling é opcional (opt-in).** `--autoscale-max` define um teto de até 16, e
  `--autoscale-cpu-target` (padrão 70) define o uso de CPU que o autoscaler busca atingir.
- **Deploys graduais (rolling deploys).** Uma nova instância é iniciada e fica pronta antes que a antiga
  seja desligada, portanto, durante um breve período, duas versões atendem ao tráfego simultaneamente.

`--spot` fica desativado por padrão; instâncias spot são mais baratas e são reiniciadas sem
aviso prévio.

## Memória e estado no nível do módulo

Um valor no nível do módulo, como `const cache = new Map()` no topo de um arquivo
de função, reside no processo do Node. Ele sobrevive de uma requisição para a outra
na mesma instância. Ele é perdido sempre que esse processo termina:

- a **cada deploy**, porque cada deploy inicializa novas instâncias;
- quando uma **variável de ambiente** é alterada e sofre deploy;
- quando uma instância é reiniciada, reprogramada ou (com `--spot`) recuperada pela infraestrutura.

Com mais de uma instância, cada uma possui sua própria cópia, de forma que duas requisições podem acessar
caches diferentes.

Use um `Map` no nível do módulo como um cache que você pode se dar ao luxo de perder: um cache que torna a
próxima requisição mais rápida, mas que não é a única cópia do dado. Guarde qualquer coisa cujo processamento
tenha tido custo, como áudio gerado ou uma resposta cara de API, no
banco de dados ou no [armazenamento](#armazenamento-para-arquivos-gerados). Para clientes que você instancia
apenas uma vez, como um SDK de API, use `lazyResource` para que o cliente seja criado no primeiro
uso a partir do ambiente da requisição. Consulte
[Configuração e Segredos](/docs/backend/custom-functions/#configuration-and-secrets).

A página [Executando mais de uma instância](/docs/deployment/multiple-instances/) lista
o estado que o próprio Rebase mantém por processo, como contadores de rate-limit e
canais de realtime.

## O sistema de arquivos

O sistema de arquivos do contêiner é gravável, e `/tmp` funciona normalmente. Mas tudo
o que for gravado ali:

- pertence a uma única instância, e as outras instâncias não têm visibilidade sobre isso;
- é excluído quando a instância é interrompida, ou seja, no mais tardar no próximo deploy;
- compartilha um limite de armazenamento temporário de 6 GiB com o bundle e seus
  `node_modules` instalados. Uma instância que exceder esse limite será removida (evicted).

Use-o para arquivos temporários de rascunho durante uma única requisição. Não o utilize como cache entre
deploys ou como armazenamento definitivo para uploads. É também por isso que
[`STORAGE_TYPE=local` fica desativado em produção](/docs/backend/storage/#environment-variables).

## Requisições

| Limite | Padrão | Modifique com |
|---|---|---|
| Timeout de função | 30 s, depois `504` com código `FUNCTION_TIMEOUT` | `REBASE_FUNCTIONS_TIMEOUT_MS` (`0` desativa), ou no próprio `defineFunction(…, { timeoutMs })` da função |
| Timeout próprio de uma função, no máximo | 300 s | `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` |
| Espera na sua instância, no edge | 10 minutos entre leituras ou gravações | Fixo |
| Corpo da requisição, rotas `/api/*` sem limite próprio | 10 MiB, depois `413 PAYLOAD_TOO_LARGE` | `REBASE_MAX_BODY_SIZE`, em bytes |
| Corpo da requisição no edge | 64 MiB | Fixo |
| Um único arquivo via `POST /api/storage/upload` | 50 MB | `STORAGE_MAX_FILE_SIZE` |
| Chamadas anônimas para `/api/functions/*` | 3000 por IP a cada 15 minutos | `rateLimit.anonymousFunctions` |

Alguns detalhes:

- **O timeout libera quem fez a chamada, não o processamento.** Aos 30 segundos, quem chamou recebe
  um `504`, e o `getSignal(c)` é abortado. Passe esse sinal para o `fetch` e
  para qualquer outra coisa que aceite um signal, para que o trabalho também seja interrompido. Consulte
  [Timeouts e Rate Limits](/docs/backend/custom-functions/#timeouts-and-rate-limits).
- **O edge espera por mais tempo do que o runtime.** O ingress à frente das suas
  instâncias aguarda até 10 minutos, portanto o limite atingido pela requisição é o do runtime,
  que responde em JSON e aborta o sinal. Aumente o `REBASE_FUNCTIONS_TIMEOUT_MS`
  até esse patamar, ou defina para a função que necessita o seu próprio
  [`timeoutMs`](/docs/backend/custom-functions/#timeouts-and-rate-limits). Para operações mais demoradas, ou que precisem sobreviver a um deploy (uma
  instância passa por um drain de 15 segundos), responda imediatamente e processe a tarefa em um
  [job](/docs/backend/jobs/).
- **Uploads maiores que 64 MiB** exigem o upload com suporte a retomada (TUS), que envia
  o arquivo em partes (chunks). O método `client.storage.putObject()` alterna para ele automaticamente
  acima de 8 MiB.
- **Tamanho da resposta.** Nem o runtime nem o edge impõem limite para o tamanho da
  resposta. No entanto, uma resposta muito grande continua sendo alocada na memória se o seu handler a construir
  de uma só vez; portanto, envie-a via streaming ou sirva-a a partir do storage.

## Variáveis de ambiente e segredos

Configure-os pela CLI ou pelo console. Não há um campo destinado a eles no
`rebase.json`.

```bash
rebase cloud env set TTS_API_URL=https://api.example.com/v1/speech
rebase cloud env set TTS_API_KEY=sk-… --secret   # write-only: nunca mais é exibido
rebase cloud env list                            # exibe apenas os nomes, nunca os valores
rebase cloud deploy                              # aplica a alteração
```

- **Uma alteração é aplicada no próximo deploy.** As instâncias em execução mantêm os valores
  com os quais inicializaram. Os comandos `set` e `unset` alertam sobre isso
  (`Pending redeploy`).
- **Limites:** até 100 variáveis por projeto, 32 KiB por valor e 256 KiB no
  total. Os nomes seguem o padrão `[A-Za-z_][A-Za-z0-9_]*`.
- **Alguns nomes são reservados.** A plataforma define `DATABASE_URL`,
  `DATABASE_DIRECT_URL`, `DATABASE_READ_URL`, `JWT_SECRET`,
  `REBASE_SERVICE_KEY`, `PORT` e `NODE_ENV` por conta própria, além de travar parâmetros de como o processo
  roda (`REBASE_ROLE`, `TRUSTED_PROXY_HOPS`, …). Tentar definir um desses nomes é
  recusado, e o erro lista todos eles.
- **`CORS_ORIGINS` parte dos seus domínios.** A plataforma define essa variável com o host do
  projeto e seus [domínios personalizados](/docs/deployment/cloud/#the-rest-of-the-surface) verificados.
  Um valor de `CORS_ORIGINS` que você definir é adicionado a essa lista, permitindo que um frontend hospedado em
  outro lugar acesse a API: `rebase cloud env set CORS_ORIGINS=https://app.example.org`.
- **As variáveis de armazenamento são padrões.** A plataforma preenche as variáveis `STORAGE_*`
  e `S3_*` para o bucket nativo, e um valor definido manualmente por você terá prioridade.
- **Nomes de build time são recusados.** Variáveis prefixadas com `VITE_`, `NEXT_PUBLIC_`, `PUBLIC_` e
  `REACT_APP_` destinam-se a frontends durante o build, e o backend
  nunca tem acesso a elas a tempo. A flag `--force` permite armazená-las mesmo assim.

Dentro de uma função, leia-as no escopo do handler, nunca no topo do arquivo:

```typescript
import { defineFunction, requireEnv } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/status", async (c) => {
        const endpoint = requireEnv(c, "TTS_API_URL");   // lança um erro claro se não estiver definida
        return c.json({ configured: Boolean(endpoint) });
    });
});
```

Uma leitura de `process.env` no escopo do módulo que retorne vazia faz com que todo o arquivo
falhe ao ser carregado, e suas rotas responderão com `404`. Consulte
[Configuração e Segredos](/docs/backend/custom-functions/#configuration-and-secrets).

## Armazenamento para arquivos gerados

Um projeto no Cloud ganha armazenamento de arquivos assim que você o cria:

```bash
rebase cloud storage create   # um bucket gerenciado e suas credenciais
rebase cloud deploy           # o backend em execução recebe as credenciais no deploy
```

Ou aponte o projeto para um bucket que você já possui com
`rebase cloud storage attach` (S3, R2, MinIO ou qualquer bucket compatível com S3).
Sem nenhum dos dois, os uploads responderão com `501 STORAGE_NOT_CONFIGURED`. Buckets adicionais podem ser
declarados em `backend/resources.ts`; consulte
[Múltiplos Buckets](/docs/backend/storage/#several-buckets).

Um deploy com storage ativado é recusado até que o projeto defina quem pode ler e gravar
arquivos. O scaffold inclui em `backend/storage.ts` um hook `storageAuthorize` para
essa finalidade. Consulte [Autorização por Objeto](/docs/backend/storage-authorization/).

**Como os arquivos são servidos.** Seu backend serve todos os arquivos em
`GET /api/storage/file/<key>`. Ele lê o objeto do bucket e o transmite via streaming,
junto com o `Content-Type`, suporte a range requests e cabeçalhos de cache. Não existe uma URL direta
do bucket exposta externamente.

- Uma chave sob **`public/`** é servida para qualquer pessoa, sem necessidade de token, em uma URL
  permanente. Use-a para arquivos que qualquer visitante possa carregar, como o áudio gerado
  para um jogo público.
- Qualquer outra chave é privada. O cliente deve requisitar a `/api/storage/metadata/<key>` por uma
  URL de download contendo um token, válido por 300 segundos por padrão
  (`STORAGE_DOWNLOAD_TOKEN_TTL`, ajustável até uma semana).

Dentro de uma função, faça gravações com `rebase.storage` (o bucket padrão) ou
`rebase.bucket(…)` (um bucket específico nomeado). O seu hook `storageAuthorize` continuará sendo responsável por
decidir se a gravação é permitida.

Transformações de imagens (`?width=`, `?format=`) exigem o `sharp`, que é um módulo nativo
e não está presente na imagem gerenciada. No runtime gerenciado, uma requisição de transformação
retorna a imagem original.

### Exemplo: cache de áudio gerado

Uma função que converte texto em fala usando uma API externa, armazena cada resultado
uma única vez e o serve a partir do storage nas requisições seguintes. O `Map` serve apenas para economizar
uma consulta ao storage em uma instância ativa (warm); o bucket é o cache real, de modo que um deploy não perde
nenhum dado.

```typescript
import { defineFunction, getSignal, requireEnv } from "@rebasepro/server/functions";

const known = new Map<string, true>(); // por instância, perdido no deploy: sem problemas

export default defineFunction((app, { rebase }) => {
    app.get("/voice/:id", async (c) => {
        const id = c.req.param("id").replace(/[^a-z0-9-]/gi, "");
        const key = `public/voices/${id}.mp3`;
        const url = `/api/storage/file/${key}`;

        if (known.has(key)) return c.redirect(url);
        const storage = rebase.storage;
        if (!storage) return c.json({ error: "Storage is not configured" }, 501);

        const listed = await storage.listObjects(key, { maxResults: 1 });
        if (listed.items.some(item => item.fullPath === key)) {
            known.set(key, true);
            return c.redirect(url);
        }

        const text = c.req.query("text") ?? "";
        const response = await fetch(requireEnv(c, "TTS_API_URL"), {
            method: "POST",
            headers: {
                authorization: `Bearer ${requireEnv(c, "TTS_API_KEY")}`,
                "content-type": "application/json"
            },
            body: JSON.stringify({ text }),
            signal: getSignal(c)
        });
        if (!response.ok) return c.json({ error: "Speech service failed" }, 502);

        const file = new File([await response.arrayBuffer()], `${id}.mp3`, { type: "audio/mpeg" });
        await storage.putObject({ file, key });
        known.set(key, true);
        return c.redirect(url);
    });
});
```

A rota é pública, como qualquer rota em `backend/functions/` antes de você aplicar
uma proteção. Em um cenário real, você verificaria quem tem permissão para gerar novos áudios, evitando que
terceiros consumam a cota da sua API de voz.

## Rede de saída

As funções podem realizar chamadas para serviços externos. Conexões de saída das suas instâncias
são permitidas para qualquer endereço na internet exclusivamente nestas portas TCP:

| Porta | Utilidade |
|---|---|
| 80, 443 | HTTP e HTTPS |
| 465, 587 | Envio de e-mail via SMTP com TLS ou STARTTLS |
| 993 | IMAP via TLS |

Todas as outras portas são bloqueadas. Isso inclui a porta 25, IMAP não criptografado, e bancos de dados ou
caches em suas portas próprias: Redis na 6379 ou MongoDB na 27017 fora do Rebase
Cloud não podem ser acessados. O endereço de metadados da nuvem (`169.254.169.254`) também
está bloqueado.

A única exceção é o seu próprio banco de dados. Se o projeto trouxer o seu próprio
PostgreSQL (BYODB), cada deploy também autoriza conexões para o host desse banco de dados
na porta indicada na sua string de conexão, e para nada mais nessa porta.
O host é resolvido para seus endereços IP no momento do deploy; portanto, se o seu provedor
alterar o endereço do banco de dados, faça o deploy novamente. O banco de dados deve aceitar
conexões vindas da internet: o aplicativo conecta-se à string de conexão
diretamente. As configurações de bastion SSH são utilizadas apenas pelo teste de conexão, e não
pelo aplicativo em execução.

A plataforma não adiciona proxy nem controle de taxa (rate limit) de saída; os serviços chamados
possuem seus próprios limites. Repasse `getSignal(c)` para o `fetch` para que uma chamada seja cancelada quando a requisição
atingir o timeout.

Todo o tráfego de saída parte de **um único endereço IP fixo, `207.175.138.15`**.
Adicione-o à allowlist de serviços de terceiros que o exigirem. Esse endereço é
compartilhado por todos os projetos no Rebase Cloud; portanto, a allowlist comprova apenas que o autor da chamada roda
no Rebase Cloud, não que se trata especificamente do seu projeto: continue autenticando no
serviço usando chaves ou tokens.

## Inicialização e encerramento

- **Cold start.** Uma nova instância baixa e descompacta o bundle antes de
  atender requisições; portanto, uma árvore de dependências pesada tornará cada escalonamento mais lento. Um bundle
  enviado sem suas dependências também as instalará nessa etapa, o que adiciona de 40 a 60
  segundos. A plataforma aguarda até 300 segundos para que uma instância fique pronta.
- **Verificação de integridade (Health).** A plataforma monitora `/livez` (o processo está rodando) e
  `/health` (ele consegue alcançar o banco de dados). Ambos são fornecidos pelo runtime, então você
  não precisa implementá-los.
- **Encerramento (Shutdown).** Em um deploy ou reinicialização, a instância para de aceitar novas requisições,
  aguarda 5 segundos para que o tráfego seja redirecionado e, em seguida, recebe um `SIGTERM`. Requisições em
  andamento têm até 15 segundos para serem concluídas. Promises passadas para `waitUntil` recebem até
  5 segundos desse período. Qualquer promise não repassada para `waitUntil` é descartada.
  Consulte [Trabalho em Segundo Plano](/docs/backend/custom-functions/#background-work).

## Quando o runtime gerenciado não é a escolha ideal

Migre o backend para `"runtime": "custom"` quando ele precisar de:

- um módulo nativo, ou um binário do sistema não fornecido por nenhum pacote npm, como `sharp`,
  ImageMagick ou um motor de fala local;
- pacotes do sistema operacional ou uma imagem base diferente;
- uma conexão de longa duração para algo fora das portas permitidas.

Um runtime customizado compila seu próprio Dockerfile, e você assume a manutenção da imagem a partir
desse momento. O comando `rebase cloud deploy --eject` realiza essa transição. Consulte
[Rebase Cloud](/docs/deployment/cloud/#deploy).

## Ainda não prometido

- **Histórico de logs.** O comando `rebase cloud logs --runtime` lê os logs das instâncias em
  execução, e `rebase cloud debug logs --previous` lê a última execução de
  uma instância que reiniciou. As saídas de instâncias substituídas por um novo deploy são perdidas. Grave
  qualquer registro que precise manter no banco de dados ou em um serviço externo de logs próprio.
- **Escala para zero (Scale to zero)** não é oferecida. Cada backend mantém pelo menos uma instância em execução
  o tempo todo.

## Páginas relacionadas

- [Rebase Cloud](/docs/deployment/cloud/): vinculação, deploy, parâmetros de computação
  e o que a versão beta não contempla
- [Funções Customizadas](/docs/backend/custom-functions/): escrevendo as rotas em
  `backend/functions/`
- [Runtime e Bundles](/docs/architecture/runtime-and-bundles/): o que é um bundle
  e como o runtime o inicializa
- [Storage](/docs/backend/storage/): buckets, endpoints, limites de tamanho e regras de
  acesso
- [Executando mais de uma instância](/docs/deployment/multiple-instances/): o
  estado mantido pelo Rebase por processo
