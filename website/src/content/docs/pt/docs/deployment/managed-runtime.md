---
sourceHash: 63d8ba53bb0e0c67
title: Runtime de backend gerenciado
sidebar_label: Runtime Gerenciado
description: O que um backend com runtime "managed" pode e não pode fazer no Rebase Cloud — pacotes e binários, memória e CPU, timeouts e tamanhos de body, o sistema de arquivos, estado em memória, segredos, armazenamento para arquivos gerados e rede de saída.
---

Um app de backend declarado desta forma no `rebase.json` roda no **runtime
gerenciado**:

```json title="rebase.json"
{
    "apps": {
        "backend": { "type": "backend", "runtime": "managed" }
    }
}
```

Gerenciado significa que você envia um bundle, não uma imagem. O comando `rebase cloud deploy`
compila suas collections, `backend/functions/` e crons em um `dist-bundle`, faz o upload
e o Rebase Cloud o inicializa na imagem publicada `rebasepro/server`. Você nunca precisa
escrever um Dockerfile, e você também não pode alterar o conteúdo da imagem. Esta página
lista o que isso permite, para que você possa planejar uma funcionalidade antes de desenvolvê-la.

Os números aqui vêm do runtime e da plataforma como estão hoje. Alguns são
parâmetros que você pode alterar, e a página indica quais são. Algumas coisas ainda não
estão definidas; elas estão marcadas como **Não definido** e reunidas
[no final](#ainda-não-definido). Não desenvolva dependendo delas sem consultar antes.

## Visão geral

| Pergunta | Resposta |
|---|---|
| Versão do Node | Node 22, no Debian slim, `linux`/`x64` |
| Pacotes npm | Sim, pacotes puramente em JavaScript. Instalados quando cada instância inicia |
| Módulos nativos (`.node`, node-gyp) | Não. O `rebase cloud deploy` recusa o bundle |
| WebAssembly | Não verificado nem bloqueado. **Não definido** se há suporte |
| Criar processo filho (spawn) | Não bloqueado, mas quase não há nada para executar. Veja [Binários](#binários-e-processos-filhos) |
| Memória e CPU | Definidos por projeto com `rebase cloud compute`. Veja [Computação](#computação-e-instâncias) |
| Instâncias | 1 por padrão. Você pode fixar até 5 ou permitir que o autoscaler escale até 16 |
| Timeout de função | 30 segundos, depois `504 FUNCTION_TIMEOUT`. Configurável |
| Corpo da requisição (body) | 10 MiB, depois `413`. Configurável, até os 64 MiB que o edge aceita |
| Sistema de arquivos com permissão de escrita | Sim, mas é temporário e pertence a uma única instância |
| Estado no nível do módulo (um cache com `Map`) | Sobrevive entre requisições em uma mesma instância. Perdido a cada deploy e reinicialização, e não compartilhado entre instâncias |
| Variáveis de ambiente e segredos | `rebase cloud env set`, aplicados no próximo deploy |
| Armazenamento de arquivos | Um bucket por projeto, servido pelo seu backend em `/api/storage/file/…` |
| HTTP de saída | Sim, nas portas 80 e 443 (e 465, 587, 993 para e-mail). Outras portas são bloqueadas |

## Código e pacotes

**O Node e a imagem.** A imagem de runtime é construída com base no `node:22-slim`
(Debian), e seu bundle roda em `linux`/`x64` como um usuário não root. Seu
`tsconfig` e a versão do Node na sua máquina não alteram isso.

**Dependências.** O bundle lista as dependências que seus arquivos `package.json`
declaram. O upload não inclui `node_modules`. Cada instância instala as
dependências a partir do registro público do npm quando inicializa, usando `npm ci` (ou
`npm install` sem um lockfile). Três consequências decorrem disso:

- **Scripts de instalação nunca são executados.** A instalação usa `--ignore-scripts`. Um pacote
  que faz download de um binário ou compila algo no `postinstall` será instalado sem
  isso.
- **Apenas versões do registro são instaladas.** Uma dependência `file:`, `link:`, `git+…` ou `github:`
  causa falha no build, porque o runtime não tem como resolvê-la.
- **Alguns pacotes vêm da imagem, não de você.** `@rebasepro/*`, `hono`,
  `zod` e `typescript` são removidos das dependências do bundle e as próprias cópias da
  imagem são utilizadas, portanto a sua versão deles não é aplicada.

O upload do bundle é limitado a 100 MB, compactado, sem as dependências.

**Módulos nativos são recusados.** Um pacote que distribui um binário `.node` compilado
não pode ser carregado no runtime gerenciado. O comando `rebase build` emite um aviso sobre isso e o
`rebase cloud deploy` é interrompido antes do upload:

```text no-verify
This bundle depends on native modules (sharp), which the managed runtime cannot run
```

A verificação procura por pacotes nativos conhecidos (`sharp`, `canvas`, `bcrypt`,
`argon2`, `sqlite3`, `better-sqlite3`, `re2`, `sodium-native`, `pg-native`, …),
por `binding.gyp` ou `gypfile`, por scripts de instalação que chamam `node-gyp` ou
`prebuild` e por arquivos `.node`. O
[guia de deployment](/docs/getting-started/deployment/#native-modules-on-the-managed-runtime)
lista as soluções alternativas comuns. Em resumo: faça o trabalho em tempo de build,
chame um serviço externo ou faça o deploy com `runtime: "custom"`.

**WebAssembly.** Nada no build ou no runtime inspeciona arquivos `.wasm`.
Um pacote puramente em JavaScript que carrega um arquivo `.wasm` não é recusado, e o Node 22
pode executá-lo. O fato de funcionar não foi testado no runtime gerenciado, portanto
trate isso como **não definido**. Lembre-se do [limite de memória](#computação-e-instâncias) se
o módulo for grande, como um modelo de voz ou de ML.

### Binários e processos filhos

Nada bloqueia o `child_process`, mas a imagem possui pouquíssimos recursos para executar: `node`,
`npm`, `sh`, `tar` e as ferramentas de cliente do PostgreSQL (`pg_dump`, `pg_restore`).
Não há `ffmpeg`, nem ImageMagick, nem Python e nenhum compilador. Você não pode adicionar
pacotes do sistema, pois não há Dockerfile e o processo não é executado como root.

Um binário que um pacote npm inclui dentro de seu próprio tarball é instalado com
o pacote. Se a execução desse binário é suportada ainda é algo **não definido**. Um binário que
um pacote baixa durante o `postinstall` nunca chega a existir, pois os scripts de instalação não
são executados.

Se uma funcionalidade precisa de um binário, utilize uma API hospedada para esse processamento ou
migre o backend para `runtime: "custom"`, onde você cria sua própria imagem.

## Computação e instâncias

Cada projeto executa em seus próprios pods. Memória e CPU são alocadas por instância, e você as define
por meio dos [parâmetros de computação](/docs/deployment/cloud/#compute-and-what-it-costs):

```bash
rebase cloud compute                              # what the project reserves now
rebase cloud compute set --cpu 500m --memory 1Gi
```

Um projeto que nunca configurou um parâmetro roda como um pod com capacidade de burst: ele reserva uma pequena
quantidade e pode ultrapassá-la (burst). Execute `rebase cloud compute` para ver a requisição
e o limite que o seu projeto realmente possui. A requisição padrão documentada é de
`250m` de CPU e `512Mi` de memória; o código da plataforma atualmente tem valores padrão mais baixos,
com um limite de burst de 2 CPUs e 2 GiB, portanto esse número **não está definido**.

Instâncias:

- **Uma por padrão.** `--replicas` fixa entre 1 e 5.
- **O autoscaling é opcional.** `--autoscale-max` define um teto de até 16, e
  `--autoscale-cpu-target` (padrão 70) define a utilização de CPU almejada pelo autoscaler.
- **Os deploys são graduais (rolling).** Uma nova instância é iniciada e fica pronta antes
  que a antiga seja interrompida, de modo que, por um breve período, duas versões atendem ao tráfego.

`--spot` e `--scale-to-zero` vêm desativados por padrão. Instâncias spot são
reiniciadas sem aviso prévio. Se `--scale-to-zero` surte efeito atualmente **não está
definido**; planeje considerando uma instância sempre em execução.

## Memória e estado no nível do módulo

Um valor no nível do módulo, como `const cache = new Map()` no topo de um arquivo
de função, reside no processo do Node. Ele sobrevive de uma requisição para a próxima
na mesma instância. Ele é perdido sempre que esse processo é encerrado:

- a **cada deploy**, porque cada deploy inicia novas instâncias;
- quando uma **variável de ambiente** é alterada e publicada;
- quando uma instância é reiniciada, reagendada ou (com `--spot`) revogada.

Com mais de uma instância, cada uma mantém sua própria cópia, de modo que duas requisições podem
ver caches diferentes.

Use um `Map` no nível do módulo como um cache que você pode se dar ao luxo de perder: um que torna a
próxima requisição mais rápida, mas não é a única cópia de nenhum dado. Guarde qualquer coisa que você tenha
custado para produzir, como áudios gerados ou respostas caras de APIs, no
banco de dados ou no [armazenamento](#armazenamento-para-arquivos-gerados). Para clientes que você instancia
uma única vez, como um SDK de API, use `lazyResource` para que o cliente seja criado no primeiro
uso a partir do ambiente da requisição. Veja
[Configuração e Segredos](/docs/backend/custom-functions/#configuration-and-secrets).

[Executando mais de uma instância](/docs/deployment/multiple-instances/) lista
o estado que o próprio Rebase mantém por processo, como contadores de rate limit e
canais em tempo real.

## O sistema de arquivos

O sistema de arquivos do container permite escrita, e o diretório `/tmp` funciona. Porém, tudo o que for
gravado ali:

- pertence a uma única instância, e as outras instâncias não têm acesso a isso;
- é excluído quando a instância para, portanto, no mais tardar no próximo deploy;
- compartilha um limite de armazenamento efêmero de 6 GiB com o bundle e seus
  `node_modules` instalados. Uma instância que exceder esse limite será despejada (evicted).

Utilize-o para arquivos temporários de rascunho durante uma única requisição. Não o utilize como cache entre
deploys ou como armazenamento para uploads. É por isso também que
[`STORAGE_TYPE=local` é desativado em produção](/docs/backend/storage/#environment-variables).

## Requisições

| Limite | Padrão | Como alterar |
|---|---|---|
| Timeout de função | 30 s, depois `504` com código `FUNCTION_TIMEOUT` | `REBASE_FUNCTIONS_TIMEOUT_MS` (`0` desativa) |
| Corpo da requisição (body), todas as rotas `/api/*` | 10 MiB, depois `413 PAYLOAD_TOO_LARGE` | `REBASE_MAX_BODY_SIZE`, em bytes |
| Corpo da requisição no edge | 64 MiB | Fixo |
| Um único arquivo via `POST /api/storage/upload` | 50 MB | `STORAGE_MAX_FILE_SIZE` |
| Chamadas anônimas para `/api/functions/*` | 3.000 por IP a cada 15 minutos | `rateLimit.anonymousFunctions` |

Alguns detalhes:

- **O timeout libera quem fez a chamada, não o processamento.** Aos 30 segundos, o cliente recebe
  um `504` e `getSignal(c)` é abortado. Passe esse sinal para o `fetch` e
  qualquer outra chamada que aceite um sinal de cancelamento, para que o processamento também seja interrompido. Veja
  [Timeouts e Limites de Taxa](/docs/backend/custom-functions/#timeouts-and-rate-limits).
- **O edge possui seu próprio timeout.** As requisições chegam às suas instâncias por meio de um
  ingress nginx que não define um timeout de leitura próprio, aplicando-se o
  padrão do controller (60 segundos no ingress-nginx). Aumentar
  `REBASE_FUNCTIONS_TIMEOUT_MS` além disso **não está definido**: o edge pode fechar
  a conexão antes. Para tarefas que levam minutos, responda imediatamente e processe
  o trabalho em um [job](/docs/backend/jobs/) ou no `waitUntil`.
- **Uploads maiores que 64 MiB** necessitam de upload retomável (TUS), que envia
  o arquivo em partes (chunks). O método `client.storage.putObject()` alterna para ele automaticamente
  acima de 8 MiB.
- **Tamanho da resposta.** Nem o runtime nem o edge impõem um limite ao tamanho
  da resposta. Uma resposta grande ainda será mantida na memória se o seu handler a construir
  inteira de uma só vez; portanto, envie-a via streaming ou sirva-a a partir do storage.

## Variáveis de ambiente e segredos

Defina-os com a CLI ou no console. Não há campo para eles no
`rebase.json`.

```bash
rebase cloud env set TTS_API_URL=https://api.example.com/v1/speech
rebase cloud env set TTS_API_KEY=sk-… --secret   # write-only: never shown again
rebase cloud env list                            # names only, never values
rebase cloud deploy                              # applies the change
```

- **Uma alteração é aplicada no próximo deploy.** As instâncias em execução mantêm os valores
  com os quais foram iniciadas. Os comandos `set` e `unset` lembram você disso
  (`Pending redeploy`).
- **Limites:** até 100 variáveis por projeto, 32 KiB por valor e 256 KiB no
  total. Os nomes seguem `[A-Za-z_][A-Za-z0-9_]*`.
- **Alguns nomes são reservados.** A plataforma define `DATABASE_URL`,
  `DATABASE_DIRECT_URL`, `DATABASE_READ_URL`, `JWT_SECRET`,
  `REBASE_SERVICE_KEY`, `PORT` e o próprio `NODE_ENV`, além de fixar o modo como o processo
  roda (`REBASE_ROLE`, `TRUSTED_PROXY_HOPS`, …). Tentar definir um desses nomes é
  recusado, e o erro lista todos eles.
- **`CORS_ORIGINS` vem dos seus domínios.** A plataforma o define com base no host do
  projeto e nos seus [domínios personalizados](/docs/deployment/cloud/#the-rest-of-the-surface) verificados,
  e esse valor prevalece sobre qualquer um que você definir. Adicione uma origem com
  `rebase cloud domains`, não com `env set`.
- **As variáveis de storage são padrões.** A plataforma preenche as variáveis `STORAGE_*`
  e `S3_*` para o seu próprio bucket, e qualquer valor que você definir tem precedência.
- **Nomes de variáveis para tempo de build são recusados.** Variáveis `VITE_`, `NEXT_PUBLIC_`, `PUBLIC_` e
  `REACT_APP_` são destinadas a frontends em tempo de build, e o backend
  nunca as vê a tempo. A flag `--force` permite armazená-las mesmo assim.

Em uma função, leia-as dentro do handler, nunca no topo do arquivo:

```typescript
import { defineFunction, requireEnv } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/status", async (c) => {
        const endpoint = requireEnv(c, "TTS_API_URL");   // throws a clear error if unset
        return c.json({ configured: Boolean(endpoint) });
    });
});
```

Uma leitura de `process.env` no escopo do módulo que retorne vazio faz com que todo o arquivo
falhe ao carregar, e suas rotas respondem com `404`. Veja
[Configuração e Segredos](/docs/backend/custom-functions/#configuration-and-secrets).

## Armazenamento para arquivos gerados

Um projeto Cloud ganha armazenamento de arquivos assim que você o cria:

```bash
rebase cloud storage create   # a managed bucket and its credentials
rebase cloud deploy           # the running backend gets the credentials at deploy
```

Ou aponte o projeto para um bucket que você já possui com
`rebase cloud storage attach` (S3, R2, MinIO ou qualquer bucket compatível com S3).
Sem nenhuma dessas opções, os uploads responderão com `501 STORAGE_NOT_CONFIGURED`. Buckets adicionais
são declarados em `config/resources.ts`; veja
[Vários Buckets](/docs/backend/storage/#several-buckets).

Um deploy com storage é recusado até que o projeto defina quem pode ler e gravar
arquivos. O arquivo `config/storage.ts` gerado pelo scaffold exporta um hook `storageAuthorize` para
isso. Veja [Autorização por Objeto](/docs/backend/storage/#per-object-authorization).

**Como os arquivos são servidos.** Seu backend serve cada arquivo em
`GET /api/storage/file/<key>`. Ele lê o objeto do bucket e o transmite via streaming,
com `Content-Type`, suporte a requisições de intervalo (range requests) e headers de cache. Não há uma URL
direta do bucket para disponibilizar publicamente.

- Uma chave sob **`public/`** é servida para qualquer pessoa, sem token, em uma URL
  que nunca muda. Use-a para arquivos que qualquer visitante possa carregar, como o áudio gerado
  para um jogo público.
- Qualquer outra chave é privada. O cliente solicita a `/api/storage/metadata/<key>` uma
  URL de download contendo um token, válido por 300 segundos por padrão
  (`STORAGE_DOWNLOAD_TOKEN_TTL`, configurável para até uma semana).

A partir de uma função, grave usando `rebase.storage` (o bucket padrão) ou
`rebase.bucket(…)` (um bucket nomeado). Seu hook `storageAuthorize` ainda decidirá
se a gravação é permitida.

Transformações de imagem (`?width=`, `?format=`) exigem o `sharp`, que é um módulo nativo
e não está presente na imagem gerenciada. No runtime gerenciado, uma requisição de transformação
retornará a imagem original.

### Exemplo: cache de áudio gerado

Uma função que converte texto em fala usando uma API hospedada, armazena cada resultado
uma única vez e o serve a partir do storage nas requisições seguintes. O `Map` serve apenas para evitar uma
consulta ao storage em uma instância ativa (warm); o bucket é o cache real, de modo que um deploy não perde
nada.

```typescript
import { defineFunction, getSignal, requireEnv } from "@rebasepro/server/functions";

const known = new Map<string, true>(); // per instance, lost on deploy: that is fine

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

A rota é pública, como qualquer rota em `backend/functions/` até que você adicione
proteção. Em um cenário real, você verificaria quem tem permissão para criar novos áudios, para evitar
que qualquer pessoa consuma seu orçamento da API de voz.

## Rede de saída

Funções podem chamar serviços externos. Conexões de saída das suas instâncias
são permitidas para qualquer endereço da internet apenas nestas portas TCP:

| Porta | Finalidade |
|---|---|
| 80, 443 | HTTP e HTTPS |
| 465, 587 | Envio de e-mail via SMTP com TLS ou STARTTLS |
| 993 | IMAP com TLS |

Todo o restante é bloqueado. Isso inclui a porta 25, IMAP sem criptografia e bancos de dados ou
caches em suas próprias portas: um PostgreSQL na 5432, Redis na 6379 ou MongoDB na
27017 fora do Rebase Cloud não poderão ser acessados. O endereço de metadados da nuvem
(`169.254.169.254`) também é bloqueado.

A plataforma não adiciona proxy nem rate limit de saída; os serviços que você consome
têm seus próprios limites. Passe `getSignal(c)` para o `fetch` para que uma chamada seja interrompida
se a requisição atingir o timeout.

O tráfego de saída utiliza um endereço compartilhado, não um exclusivo por projeto. Se esse
endereço é fixo e publicado, para serviços que exigem uma allowlist, **não está
definido**.

## Inicialização e desligamento

- **Cold start.** Uma nova instância faz o download do bundle e instala suas
  dependências antes de atender requisições. Essa instalação representa a maior parte do cold start, que
  geralmente leva de 40 a 60 segundos. A plataforma aguarda até 300 segundos para que uma
  instância fique ativa. Uma árvore de dependências grande torna cada deploy e cada
  aumento de escala (scale-up) mais lentos.
- **Health.** A plataforma verifica `/livez` (o processo está em execução) e
  `/health` (consegue se comunicar com o banco de dados). Ambos são servidos pelo runtime, então você
  não precisa criá-los.
- **Desligamento.** Em um deploy ou reinicialização, a instância para de aceitar novas requisições,
  aguarda 5 segundos para que o tráfego migre e então recebe o sinal `SIGTERM`. Requisições em
  andamento têm até 15 segundos para serem concluídas. Promises passadas para `waitUntil` recebem até
  5 segundos desse tempo. Uma promise não enviada para `waitUntil` é descartada.
  Veja [Trabalho em Segundo Plano](/docs/backend/custom-functions/#background-work).

## Quando o runtime gerenciado não é a escolha certa

Migre o backend para `"runtime": "custom"` quando ele precisar de:

- um módulo nativo ou binário do sistema, como `sharp`, `ffmpeg` ou um
  mecanismo local de conversão de voz;
- pacotes do sistema ou uma imagem base diferente;
- uma conexão de longa duração com algum serviço fora das portas permitidas.

Um runtime customizado compila seu próprio Dockerfile, e você passa a gerenciar a imagem a
partir desse momento. O comando `rebase cloud deploy --eject` realiza a migração. Veja
[Rebase Cloud](/docs/deployment/cloud/#deploy).

## Ainda não definido

Estas questões ainda não têm uma resposta definida no código da plataforma. Consulte antes de
depender de qualquer uma delas.

- **WebAssembly.** Não é bloqueado, mas não foi testado nem prometido como recurso suportado.
- **Execução de um binário distribuído dentro de um pacote npm.** Não é bloqueado, mas também
  não é suportado oficialmente.
- **CPU e memória padrão.** O padrão documentado (`250m`, `512Mi`) e o
  padrão atual da plataforma (requisição inicial menor, com burst de até 2 CPUs e 2 GiB) não
  coincidem. O comando `rebase cloud compute` exibe o que o seu projeto possui.
- **Scale to zero.** O parâmetro `--scale-to-zero` é aceito. Se ele
  atualmente altera a forma como o projeto roda não está confirmado.
- **Requisições com duração superior a 60 segundos.** O timeout da função pode ser aumentado, mas
  o edge à frente pode encerrar a conexão seguindo seu próprio padrão.
- **Um endereço IP de saída fixo** que uma allowlist de terceiros possa utilizar.
- **Uma origem de navegador que não seja um dos domínios do projeto**, como um
  frontend hospedado em outro lugar. A variável `CORS_ORIGINS` da plataforma tem precedência sobre
  a sua.
- **Registros npm privados.** A instalação de dependências não lê arquivos `.npmrc` ou
  tokens, portanto pacotes privados aparentemente não são instalados.
- **Retenção de logs.** O comando `rebase cloud logs --runtime` exibe a saída recente; o tempo pelo qual
  os logs são mantidos não está documentado.

## Páginas relacionadas

- [Rebase Cloud](/docs/deployment/cloud/): vinculação, deploy, os parâmetros
  de computação e o que o beta não inclui
- [Funções Customizadas](/docs/backend/custom-functions/): escrevendo as rotas em
  `backend/functions/`
- [Runtime e Bundles](/docs/architecture/runtime-and-bundles/): o que é um bundle
  e como o runtime o inicializa
- [Storage](/docs/backend/storage/): buckets, endpoints, limites de tamanho e regras
  de acesso
- [Executando mais de uma instância](/docs/deployment/multiple-instances/): o
  estado que o Rebase mantém por processo
