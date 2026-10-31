---
sourceHash: ec6f07e74d4a291d
title: Ambiente e Configuração
sidebar_label: Configuração
description: Todas as variáveis de ambiente e opções de configuração para projetos Rebase.
---

## Variáveis de Ambiente

Toda a configuração é feita por meio de variáveis de ambiente no arquivo `.env` na raiz do projeto.

> **Importante**: O Rebase valida as variáveis de ambiente com o **Zod** durante a inicialização. Se
> algo obrigatório estiver ausente ou malformado (uma URL que não é uma URL, uma porta que
> não é um número), o servidor se recusa a inicializar e informa o nome da variável.
>
> O local onde o schema reside depende de como você executa o backend. Um projeto inicializado pelo
> runtime — `rebase dev`, `rebase start`, a imagem publicada — usa o
> schema que pertence ao runtime (`loadBootEnv` em `@rebasepro/server`), que é a
> união de todas as tabelas abaixo. Um projeto que executou [`rebase eject`](/docs/cli)
> possui um arquivo `backend/src/env.ts` chamando `loadEnv({ extend })`, e pode adicionar suas próprias
> variáveis tipadas lá.

### Obrigatórias

| Variável | Descrição | Exemplo |
|----------|-------------|---------|
| `DATABASE_URL` | String de conexão do PostgreSQL. **Opcional em desenvolvimento** — se não definida, o `rebase dev` executa um PostgreSQL gerenciado para o projeto, com seus dados sob `.rebase/`. Obrigatória em todos os outros ambientes. | `postgresql://user:pass@localhost:5432/mydb` |
| `JWT_SECRET` | Chave secreta para assinar tokens JWT. Use uma string aleatória forte (mínimo de 32 caracteres). **Obrigatória em produção** (gerada automaticamente em desenvolvimento). | `a1b2c3d4e5...` |

> **`sslmode=no-verify` é uma grafia do node-postgres, não do libpq.**
>
> O Rebase e o driver do Node a aceitam — criptografa, mas não verifica o
> certificado. O `psql`, `pg_dump`, `pg_restore` e Atlas não a aceitam e não
> degradam graciosamente: recusam-se a iniciar com `invalid sslmode value: "no-verify"`.
>
> Os próprios comandos do Rebase (`rebase db push`, `rebase db backup`, `rebase db restore`)
> reescrevem o valor para o equivalente `sslmode=require` antes de invocar o shell,
> de modo que funcionam com a URL conforme configurada. Executar o `psql` manualmente não faz
> isso — substitua por `sslmode=require` nesses casos, o que criptografa sem verificar exatamente
> da mesma maneira.

### Frontend

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `VITE_API_URL` | URL da API do backend para o SDK tipado. **Defina apenas em desenvolvimento** — veja abaixo. | page origin |
| `VITE_GOOGLE_CLIENT_ID` | Client ID do Google OAuth. Habilita o "Entrar com o Google". | — |

> **Deixe `VITE_API_URL` não definido em builds de produção.**
>
> Em desenvolvimento, o frontend e o backend possuem origens distintas, de modo que o servidor
> de desenvolvimento injeta isso. Em produção, o backend do Rebase serve a SPA, portanto a
> API é a própria origem da página e o cliente a resolve dessa forma por conta própria.
>
> Embutir uma URL absoluta em um bundle de produção funciona até o momento em que um segundo
> hostname aponta para a mesma aplicação: um domínio personalizado então carrega a página a partir de
> `example.com` e chama a API em `example.rebase.website`, o que é cross-origin,
> fazendo com que toda requisição falhe no preflight. Permitir a origem no CORS
> **não** resolve o problema — o cookie de atualização (refresh cookie) é `SameSite=Lax` e não é
> enviado cross-site, o que removeria os erros no console mas ainda deixaria a
> autenticação quebrada. Deixando o valor não definido, todo domínio apontando para a aplicação funciona sem
> qualquer configuração de CORS.

### Backend

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `PORT` | Porta para o servidor HTTP do backend. Lida por `rebase start`. O `rebase dev` a lê **apenas do ambiente do shell** — um `PORT` no `.env` não é lido nesse caso, porque a porta é resolvida antes do carregamento desse arquivo — e, caso contrário, vincula uma porta derivada do caminho do projeto, permitindo que vários projetos rodem ao mesmo tempo. `rebase dev --port` tem prioridade sobre ambos, e o banner de inicialização informa qual foi usado. | `3001` |
| `LOG_LEVEL` | Verbosidade dos logs: `error`, `warn`, `info`, `debug` | `info` |
| `REBASE_LOG_RAW_QUERIES` | Exibe o SQL por trás de uma linha `Failed query: [redacted]`. Cada instrução com falha é ocultada por padrão, porque uma consulta com falha carrega seus parâmetros vinculados — um e-mail, um hash de senha. Defina como `true` ao diagnosticar uma falha de DDL, RLS ou captura de alterações. Ignorado quando `NODE_ENV=production`. | `false` |
| `NODE_ENV` | Ambiente: `development`, `production` ou `test` | `development` |
| `CORS_ORIGINS` | Lista separada por vírgulas de origens permitidas. **Obrigatório em produção**, a menos que `FRONTEND_URL` esteja definido: uma inicialização em produção sem nenhum dos dois se recusa a iniciar. Em desenvolvimento, é *adicionado ao* localhost — veja abaixo. | — |
| `FRONTEND_URL` | URL da aplicação frontend. Usada como alternativa ao CORS_ORIGINS, em ambos os ambientes. | — |
| `ADMIN_CONNECTION_STRING` | String de conexão com o banco de dados em nível de administrador (usada para introspecção de schema e operações administrativas). O banco de dados informado não é aquele que o console SQL considera atual, nem o que um novo branch copia por padrão: ambos são o banco de dados no qual a conexão da própria aplicação está (veja `REBASE_BRANCH_PARENT_DATABASE` para um servidor em um branch). | `DATABASE_URL` |
| `DISABLE_DB_ROLE_SWITCHING` | Desativa a troca de papéis (roles) do PostgreSQL no Editor SQL (útil para autenticação personalizada onde os papéis do BD não estão mapeados). O console SQL do Studio indicará então que as linhas foram lidas como o proprietário da conexão, informará o nome dele e desabilitará o seletor de papéis. | `false` |
| `REBASE_BRANCH_PARENT_DATABASE` | O banco de dados do qual o branch em que este servidor roda foi copiado. O `rebase dev` o define em um checkout [alternado para um branch](/docs/backend/branching/#cli-integration). Um servidor com essa variável mantém o registro de branches nesse banco de dados e copia novos branches a partir dele por padrão, de modo que o painel Branches do Studio exibe os branches do banco de dados principal. | — |

#### CORS em desenvolvimento

O desenvolvimento permite **o localhost, mais qualquer valor informado em `CORS_ORIGINS` (ou `FRONTEND_URL`)**
— a mesma lista usada em produção, com o localhost adicionado em vez de
substituído. Assim, a variável funciona da mesma maneira em ambos os ambientes, e os
casos que precisam dela em desenvolvimento são os habituais:

```bash
# A phone on the LAN, a colleague's machine, an ngrok tunnel,
# a forwarded Codespaces port — all non-localhost origins.
CORS_ORIGINS=http://192.168.1.5:5173
```

Uma origem que não seja o localhost nem esteja listada é recusada, e a recusa é
registrada nos logs **uma vez por origem** com a linha exata que a permitiria. Recusar
não é cautela desnecessária: a API envia credenciais, portanto refletir uma
`Origin` arbitrária permitiria que qualquer site visitado pelo desenvolvedor fizesse
requisições autenticadas contra o servidor de desenvolvimento com sua sessão e lesse
as respostas.

### Autenticação

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `JWT_SECRET` | Chave secreta para assinatura JWT (obrigatória em produção, gerada automaticamente em desenvolvimento) | — |
| `JWT_PRIVATE_KEY` | Chave privada PEM para assinar tokens de acesso assimetricamente (RS256), permitindo que qualquer serviço com o JWKS verifique uma sessão sem conseguir forjar uma. Aceita PEM com quebras de linha reais, PEM com escapes `\n` ou o PEM completo em base64. Sem ela, os tokens permanecem em HS256. | — |
| `JWT_KEY_ID` | Identifica a `JWT_PRIVATE_KEY` no cabeçalho do token e no JWKS. Altere-o sempre que a chave for trocada — a rotação depende da distinção entre a antiga e a nova. | `default` |
| `JWT_ACCESS_EXPIRES_IN` | Tempo de vida do token de acesso | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Tempo de vida do token de atualização (refresh token). Janela deslizante — cada rotação o renova, controlando quanto tempo uma sessão sobrevive à **inatividade**. Defina `400d` para sessões que sobrevivem a uma longa ausência; os navegadores limitam o cookie de atualização a esse período. | `30d` |
| `ALLOW_REGISTRATION` | Permitir o registro de novos usuários (`true`/`false`). Fora de produção, o **primeiro** usuário sempre pode se registrar, independentemente desta configuração — uma tabela de usuários vazia precisa admitir alguém, e esse alguém se torna o administrador. Em produção (`NODE_ENV=production`), essa janela é fechada: uma tabela vazia recusa o registro inicial com `SETUP_REQUIRED`, uma primeira conta criada por meio de registro aberto é uma conta comum, e o administrador é definido via `REBASE_ADMIN_EMAIL` abaixo ou atribuído via service key. O `.env.example` do scaffold o define como `true`; o padrão do framework é desativado. | `false` |
| `DISABLE_SELF_REGISTRATION` | Chave de segurança emergencial (kill switch). Fecha a janela de bootstrap do primeiro usuário que `ALLOW_REGISTRATION=false` deixa deliberadamente aberta fora de produção, bloqueando o registro mesmo contra um banco de dados vazio. Combine com `REBASE_ADMIN_EMAIL` abaixo, caso contrário o deploy não terá como produzir seu primeiro usuário autenticado. Todos os artefatos de deploy distribuídos a definem. | — |
| `REBASE_ADMIN_EMAIL` | E-mail da primeira conta de administrador, criada na inicialização **enquanto a tabela de usuários ainda estiver vazia** e nunca após isso. É assim que um deploy de produção obtém seu administrador: o operador define a primeira conta em vez de disputar contra a internet aberta. A inicialização avisa quando a tabela estiver vazia em produção e essa variável não estiver definida. | — |
| `REBASE_ADMIN_PASSWORD` | Senha para essa conta. No mínimo 12 caracteres, caso contrário será recusada e a conta não será criada. Altere-a após o primeiro login. | — |
| `MFA_ENCRYPTION_KEY` | Criptografa todos os segredos TOTP armazenados. Se não definida, os segredos são criptografados com o `JWT_SECRET` e a inicialização exibe um aviso — o que significa que rotacionar o `JWT_SECRET` desconecta todos os usuários *e* torna indecifrável todo autenticador configurado. Defina uma chave dedicada (32+ caracteres aleatórios) antes de qualquer usuário configurar MFA. | — |
| `MFA_ENCRYPTION_KEY_PREVIOUS` | A chave anterior durante um processo de rotação. Defina ambas durante a troca: novos segredos são gravados com `MFA_ENCRYPTION_KEY` e os existentes continuam legíveis, impedindo que usuários percam o acesso à conta no meio da rotação. Remova-a quando todos os segredos tiverem sido recriptografados. | — |
| `ALLOW_ANONYMOUS` | Habilita login anônimo (`POST /api/auth/anonymous`). Habilitação explícita (opt-in) e deliberadamente não restringida por `ALLOW_REGISTRATION`. | `false` |
| `AUTH_REQUIRE` | Exige autenticação para a API de dados. Defina como `false` para uma superfície de leitura totalmente pública — as políticas de RLS ainda se aplicam. | `true` |
| `AUTH_DEFAULT_ROLE` | Papel (role) atribuído a um usuário recém-registrado quando nenhum é fornecido. | — |
| `AUTH_ALLOW_USER_LOOKUP` | Habilita o endpoint `POST /api/auth/find-user`, que resolve um e-mail para um perfil público mínimo (`uid`, `displayName`, `photoURL`) para fluxos de convite por e-mail. Apenas chamadores autenticados têm acesso, e ele nunca retorna o e-mail, os papéis ou metadados do usuário encontrado. Desativado por padrão: representa uma superfície de enumeração. | `false` |
| `AUTH_COOKIE_SAME_SITE` | Atributo `SameSite` no cookie de atualização: `Strict`, `Lax` ou `None`. `None` requer HTTPS e serve apenas para frontends genuinamente cross-site. | `Lax` |
| `AUTH_COOKIE_SECURE` | Atributo `Secure` no cookie de atualização. Ativo por padrão; use `AUTH_COOKIE_SECURE=false` para HTTP comum — por exemplo, em um deploy em um endereço de LAN onde o navegador descartaria o cookie e a sessão expiraria junto com o token de acesso sem exibir erros. Um aviso é emitido no boot. `http://localhost` não precisa disso. | `true` |
| `GOOGLE_CLIENT_ID` | Client ID do Google OAuth (validação no backend) | — |
| `GOOGLE_CLIENT_SECRET` | Client Secret do Google OAuth | — |
| `GITHUB_CLIENT_ID` | Client ID do GitHub OAuth | — |
| `GITHUB_CLIENT_SECRET` | Client Secret do GitHub OAuth | — |
| `MICROSOFT_CLIENT_ID` | Client ID do Microsoft OAuth | — |
| `MICROSOFT_CLIENT_SECRET` | Client Secret do Microsoft OAuth | — |
| `LINKEDIN_CLIENT_ID` | Client ID do LinkedIn OAuth | — |
| `LINKEDIN_CLIENT_SECRET` | Client Secret do LinkedIn OAuth | — |
| `FACEBOOK_CLIENT_ID` | Client ID do Facebook OAuth | — |
| `FACEBOOK_CLIENT_SECRET` | Client Secret do Facebook OAuth | — |
| `TWITTER_CLIENT_ID` | Client ID do X/Twitter OAuth | — |
| `TWITTER_CLIENT_SECRET` | Client Secret do X/Twitter OAuth | — |
| `DISCORD_CLIENT_ID` | Client ID do Discord OAuth | — |
| `DISCORD_CLIENT_SECRET` | Client Secret do Discord OAuth | — |
| `GITLAB_CLIENT_ID` | Client ID do GitLab OAuth. A `baseUrl` de uma instância auto-hospedada não possui variável de ambiente — configure o GitLab no bloco `auth` para isso. | — |
| `GITLAB_CLIENT_SECRET` | Client Secret do GitLab OAuth | — |
| `BITBUCKET_CLIENT_ID` | Client ID do Bitbucket OAuth | — |
| `BITBUCKET_CLIENT_SECRET` | Client Secret do Bitbucket OAuth | — |
| `SLACK_CLIENT_ID` | Client ID do Slack OAuth | — |
| `SLACK_CLIENT_SECRET` | Client Secret do Slack OAuth | — |
| `SPOTIFY_CLIENT_ID` | Client ID do Spotify OAuth | — |
| `SPOTIFY_CLIENT_SECRET` | Client Secret do Spotify OAuth | — |
| `APPLE_CLIENT_ID` | Services ID da Apple. A Apple não possui um client secret estático — o Rebase assina um JWT ES256 de curta duração por troca de token —, portanto precisa de todos os quatro valores `APPLE_*` e não configura nada sem eles. | — |
| `APPLE_TEAM_ID` | Team ID da Apple Developer, o emissor do JWT. | — |
| `APPLE_KEY_ID` | Key ID da chave privada registrada na Apple. | — |
| `APPLE_PRIVATE_KEY` | Conteúdo do arquivo de chave privada `.p8`, incluindo quebras de linha (escapes `\n` são aceitos). | — |
| `REBASE_SERVICE_KEY` | Chave de API estática de administrador. Ignora a autenticação normal por JWT para chamadas server-to-server quando passada como `Authorization: Bearer <key>`. (Gerada automaticamente em desenvolvimento). | — |
| `REBASE_PLATFORM_TOKEN_KEY` | Chave pública da plataforma de hospedagem (PEM, EC P-256) contra a qual os tokens de plataforma `rpt_` são verificados; múltiplos blocos PEM durante rotação de chave. A plataforma a define no deploy e ela não contém segredos. Junto com `REBASE_PLATFORM_TOKEN_AUDIENCE`, permite que a validação administrativa aceite um token de plataforma para `cron:read`, e para nada mais. | — |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | O ID do projeto com o qual o `aud` do token de plataforma deve ser igual, garantindo que tokens emitidos para outro projeto sejam recusados. Se apenas uma das duas variáveis for definida, o servidor inicializa, registra um aviso e responde a qualquer token `rpt_` com `401 PLATFORM_TOKENS_OFF`. | — |
| `REBASE_RATE_LIMIT_STORE` | Onde os contadores de limitação de taxa (rate limit) de autenticação residem: `memory` (por processo) ou `sql` (compartilhado entre réplicas). Um processo não enxerga sua própria contagem de réplicas, então um deploy distribuído deve informar isso — três réplicas com a configuração padrão aplicam três vezes o limite pretendido. Qualquer outro valor **impede a inicialização** em vez de aplicar fallback, incluindo `postgres`. | `memory` |
| `AUTH_MAGIC_LINK` | Habilita o fluxo de link de login sem senha (magic link). Requer um serviço de e-mail configurado, caso contrário o link não tem para onde ir. | `false` |
| `AUTH_EMAIL_OTP` | Habilita login sem senha com código de seis dígitos enviado por e-mail. Requer serviço de e-mail como acima. | `false` |
| `AUTH_MAGIC_LINK_CREATES_USERS` | Cadastro sem senha: uma solicitação de magic link ou código por e-mail para um endereço desconhecido cria a conta, enquanto o registro estiver aberto. | `false` |
| `AUTH_REFRESH_TOKEN_REUSE` | Ação tomada quando um token de atualização é reutilizado após sua janela de reutilização: `reject` (recusa a requisição, mantém a sessão) ou `revoke-session` (encerra a sessão). Qualquer outro valor impede a inicialização. | `reject` |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Registro com confirmação prévia: nenhum login com senha é permitido até que o endereço de e-mail seja verificado. Requer e-mail configurado; caso contrário, a inicialização é recusada. | `false` |
| `CAPTCHA_PROVIDER` | Habilita verificação por captcha nas rotas de autenticação: `turnstile` ou `hcaptcha`. Não definido significa sem captcha. | — |
| `CAPTCHA_SECRET` | O secret do provedor, usado no servidor para verificar o token enviado pelo navegador. Obrigatório quando `CAPTCHA_PROVIDER` estiver definido. | — |
| `CAPTCHA_ROUTES` | Rotas de autenticação a serem protegidas separadas por vírgula (por exemplo `register,login`). Não definido protege o conjunto padrão do provedor. | — |

### Armazenamento

:::caution[O armazenamento não tem segurança em nível de linha, portanto precisa de um modelo de acesso]
As coleções são protegidas pelo RLS do Postgres. O armazenamento de objetos não possui equivalente —
as chaves compartilham um único namespace simples — de modo que, com um bucket configurado e nenhum modelo de acesso,
o servidor **se recusa a inicializar em produção**. Atenda a essa exigência com exatamente um dos seguintes itens:
um hook `storageAuthorize` exportado de `config/index.ts` (o que o scaffold
já inclui), `STORAGE_PUBLIC_READ` ou `STORAGE_ALLOW_ANY_AUTHENTICATED`.
:::

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `STORAGE_TYPE` | Backend de armazenamento: `local`, `s3` ou `gcs`. Em produção, `local` desativa o armazenamento a menos que `FORCE_LOCAL_STORAGE=true` | `local` |
| `STORAGE_PATH` | Caminho base para o armazenamento local. Um caminho relativo é lido a partir do diretório onde o servidor executa: a raiz do projeto sob `rebase dev`, `backend/` em um servidor gerado por `rebase eject` | `<project>/uploads` |
| `FORCE_LOCAL_STORAGE` | Permite armazenamento local em produção — apenas com um volume persistente mantendo `STORAGE_PATH` e os diretórios `<STORAGE_PATH>__<key>` dos buckets locais nomeados ao lado dele | `false` |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | Segundos durante os quais a URL de download de um arquivo privado é válida — o token adicionado por `getSignedUrl()`. No máximo `604800` (uma semana) | `300` |
| `STORAGE_MAX_FILE_SIZE` | Maior tamanho de arquivo que a fonte aceita, em bytes, em todas as rotas de upload — `__<KEY>` para uma fonte nomeada. Valores que não forem números inteiros impedem a inicialização | `52428800` (50 MB) |
| `S3_BUCKET` | Nome do bucket S3 (quando `STORAGE_TYPE=s3`) | — |
| `S3_REGION` | Região da AWS | — |
| `S3_ACCESS_KEY_ID` | Chave de acesso da AWS | — |
| `S3_SECRET_ACCESS_KEY` | Chave secreta da AWS | — |
| `S3_ENDPOINT` | Endpoint customizado do S3 (para MinIO, Cloudflare R2, etc.) | — |
| `S3_FORCE_PATH_STYLE` | Força URLs no estilo path-style para o bucket S3 (`true`/`false`) | `false` |
| `GCS_BUCKET` | Nome do bucket GCS (quando `STORAGE_TYPE=gcs`) | — |
| `GCS_PROJECT_ID` | Projeto GCP. Geralmente inferido a partir das credenciais. | — |
| `GCS_KEY_FILENAME` | Caminho para o arquivo de chave da conta de serviço. Omitir no GCP, onde o Workload Identity fornece as credenciais. | — |
| `STORAGE_PUBLIC_READ` | Serve todos os objetos para qualquer pessoa, sem token. Apenas para buckets que atuam genuinamente como CDN pública. Uma das três maneiras de satisfazer a trava de inicialização mencionada acima. | `false` |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Permite que qualquer usuário autenticado leia, grave, liste e exclua todos os objetos. Nomeado como `INSECURE` no objeto de configuração por um motivo: defensável apenas em aplicações single-tenant onde todas as contas têm permissão sobre todos os arquivos. | `false` |
| `STORAGE_RENDITION_CACHE` | Armazena em cache as variações de imagem geradas (redimensionamentos, conversões de formato) em vez de processá-las a cada requisição. | `false` |

### E-mail (Opcional)

| Variável | Descrição |
|----------|-------------|
| `SMTP_HOST` | Host do servidor SMTP |
| `SMTP_PORT` | Porta do servidor SMTP |
| `SMTP_SECURE` | Habilitar conexão segura (`true`/`false`) |
| `SMTP_USER` | Usuário SMTP |
| `SMTP_PASS` | Senha SMTP |
| `SMTP_FROM` | Endereço do remetente para e-mails do sistema |
| `SMTP_NAME` | Nome de exibição no endereço do remetente |
| `APP_NAME` | Nome do produto usado nos assuntos e corpos dos e-mails (padrão: `Rebase`) |
| `EMAIL_LOGO_URL` | Logo exibido no topo dos modelos de e-mail padrão. PNG ou JPG absoluto com `http(s)` — clientes de e-mail removem SVG e bloqueiam URIs `data:`. Se não definido, uma aplicação ainda chamada `Rebase` recebe o logotipo do Rebase e uma aplicação renomeada não exibe nenhum |

### Pool de conexões com o banco de dados

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `DB_POOL_MAX` | Número máximo de conexões no pool | `20` |
| `DB_POOL_IDLE_TIMEOUT` | Milissegundos em que uma conexão ociosa é mantida | `30000` |
| `DB_POOL_CONNECT_TIMEOUT` | Milissegundos de espera por uma conexão | `10000` |
| `DATABASE_DIRECT_URL` | Conexão direta (não agrupada/pooled). Recursos de [Realtime](/docs/backend/realtime) necessitam de uma: `LISTEN`/`NOTIFY` não sobrevive a poolers de transação como o PgBouncer, e sem isso as notificações de alteração são desativadas com um aviso em vez de serem perdidas silenciosamente. O [job worker](/docs/backend/jobs) também mantém seu `LISTEN` de ativação por meio dela. Preenche o `directConnectionString` do adaptador Postgres quando não estiver configurado. | — |
| `DATABASE_READ_URL` | Réplica de leitura. As leituras são direcionadas para cá quando definida e diferente de `DATABASE_URL`; se a conexão falhar, todas as operações retornam para o primário com um aviso. Preenche o `readConnectionString` do adaptador Postgres quando não estiver configurado; na versão 0.24 essa opção é ignorada. | — |
| `REBASE_DB_POOL_MAX` | Um teto para cada pool no processo, aplicado independentemente do que cada um solicitou. Aceita apenas dígitos puros: um valor malformado é ignorado em vez de serializar o servidor silenciosamente. | — |

### Comportamento em tempo de execução (Runtime)

Lido pelo runtime — `rebase dev`, `rebase start` e a imagem de servidor publicada.
Um projeto que fez eject assume essas decisões em seu próprio código.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_RLS_AUDIT` | `true` executa a [auditoria de row-level security](/docs/rls-check#running-it-on-a-schedule) agendada, que reporta tabelas expostas sem políticas. O projeto deve declarar `@rebasepro/rls-check` entre suas dependências: o runtime não inclui nenhuma cópia e, sem o pacote, o boot é recusado informando o nome dele. `false` mantém a verificação desativada neste processo. | — |
| `REBASE_BASE_PATH` | Caminho base para todas as rotas da API. O cliente deve ser configurado com o mesmo valor — veja [Alterando `basePath`](#alterando-basepath). | `/api` |
| `REBASE_SERVE_STATIC` | Serve os assets estáticos/administrativos do bundle a partir deste processo. Desative quando houver uma CDN à frente. | `true` |
| `REBASE_HISTORY` | Registra o [histórico de alterações de entidades](/docs/backend/history). | `true` |
| `REBASE_COMPRESSION` | Respostas comprimidas com gzip/brotli. | `true` |
| `REBASE_MAX_BODY_SIZE` | Corpo máximo da requisição, **em bytes** (`10485760`, não `10MB` — um valor que não seja número impede a inicialização em vez de remover o limite silenciosamente). `0` desativa o limite. | `10485760` (10 MiB) |
| `REBASE_ENABLE_SWAGGER` | Superfície OpenAPI. Três estados: não definido significa ativo em desenvolvimento, inativo em produção; `false` desativa ambos em qualquer lugar. Observe que `true` em produção serve a **especificação** em `/api/docs`, mas não a **UI** do Swagger em `/api/swagger` — a UI é condicionada separadamente pelo `NODE_ENV`. | — |
| `REBASE_METRICS` | Expõe métricas do Prometheus em `/metrics`. | `false` |
| `REBASE_HSTS_INCLUDE_SUBDOMAINS` | Adiciona `includeSubDomains` ao cabeçalho `Strict-Transport-Security`, fazendo com que os navegadores recusem HTTP não criptografado em todos os subdomínios do host por seis meses — incluindo hosts não atendidos por este processo. Ative somente quando todos os subdomínios do domínio forem estritamente HTTPS. Qualquer valor diferente de `true`/`false` impede a inicialização. Veja [Cabeçalhos de segurança](/docs/deployment/self-hosting/#security-headers). | `false` |
| `REBASE_METRICS_TOKEN` | Bearer token de proteção para `/metrics`. Se não definido, deixa o endpoint aberto para qualquer requisição que alcance a porta — aceitável em uma rede privada, mas inadequado em rede pública, conforme indicado nos logs de inicialização. | — |
| `REBASE_MIGRATE_ON_BOOT` | O que o runtime pode fazer com o schema de coleções durante a inicialização. `ensure` (o padrão em todos os ambientes — inclusive produção) executa a passagem **aditiva**: cria tabelas, colunas e tipos enum ausentes, nunca descartando ou reescrevendo nenhum. `none` não altera o schema de coleções, mas as tabelas do próprio framework (auth, chaves de API, jobs, cron) continuam sendo criadas e atualizadas; `REBASE_PROVISION=false` desativa essas também. A imagem publicada aceita apenas essas duas opções e **se recusa a inicializar com `push`**. Em um [deploy dividido](/docs/deployment/split-processes), exatamente um processo pode realizar o provisionamento, portanto todos os outros papéis devem definir `none` ou a inicialização falhará. | `ensure` |
| `REBASE_PROVISION` | `false` faz com que o runtime não altere nada no banco de dados: nenhuma tabela, coluna, índice, função, trigger, política, papel ou grant, na inicialização ou posteriormente, incluindo as tabelas do framework. Ele apenas reporta o que está ausente pelo nome. Indicado para bancos de dados onde apenas seu processo de migração/mudança tem permissão de escrita. Veja [Quando apenas seu processo de mudança pode alterar o banco de dados](/docs/deployment/self-hosting/#when-only-your-change-process-may-change-the-database). Apenas `true` e `false` são aceitos. | `true` |
| `REBASE_REQUIRE_SCHEMA_MATCH` | Recusa a inicialização quando o banco de dados foi provisionado pela última vez a partir de um conjunto de coleções diferente daquele usado para compilar este processo. Não definido (ou qualquer valor diferente de `true`/`1`) apenas emite um aviso. | warn |
| `REBASE_REQUIRE_FILES_LOADED` | Recusa a inicialização quando um arquivo de função ou cron lança um erro ou falha no parse durante a importação, indicando cada arquivo e o motivo, garantindo que um rolling deploy mantenha a versão antiga servindo. Um reinício também segue essa regra. Não definido (ou qualquer valor diferente de `true`) ignora o arquivo com falha e serve os demais. Um arquivo importado sem erros que não exporta função ou job é sempre ignorado, e não recusado. | skip |
| `REALTIME_CDC` | Captura de alterações em nível de banco de dados (CDC): `auto` (habilita onde a conexão suportar, fallback silencioso caso contrário), `trigger` (força o uso, avisa se impossível), `wal` (atualmente degrada para `trigger`), `off`. Veja [Realtime](/docs/backend/realtime-cdc/). Tem precedência sobre `realtime.cdc`. | `auto` |
| `REALTIME_CHANNEL_BUS` | Transporte entre instâncias para canais de broadcast e presence: `memory` ou `postgres`. Ignorado quando `realtime.bus` recebe um transporte já instanciado. | `memory` |
| `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` | Quantas inscrições um socket de realtime pode manter; a próxima inscrição é recusada com `TOO_MANY_SUBSCRIPTIONS`. Número inteiro positivo — qualquer outro valor interrompe o servidor na inicialização. Tem precedência sobre `realtime.maxSubscriptionsPerSocket`. Veja [Realtime](/docs/backend/realtime#what-a-write-costs-and-the-limits). | `1000` |
| `REALTIME_MAX_SOCKETS_PER_USER` | Quantos sockets de realtime um usuário, ou chave de API, pode manter abertos em uma única instância do servidor. Sockets de personificação de um administrador contam contra o administrador. A tentativa de login seguinte é recusada com `TOO_MANY_SOCKETS` e o socket é encerrado (4002); o SDK continua tentando reconectar, obtendo acesso quando outro socket for fechado. Número inteiro positivo — qualquer outro valor interrompe o servidor na inicialização. Tem precedência sobre `realtime.maxSocketsPerUser`. | Sem teto |
| `REALTIME_REFETCH_MAX_WAIT_MS` | Tempo máximo que uma alteração aguarda pela reconsulta que a entrega aos inscritos em tempo real, em ms. Uma reconsulta aguarda 300 ms sem novas alterações, e no máximo este tempo sob um fluxo constante de escritas. Número inteiro positivo — qualquer outro valor interrompe o servidor na inicialização. Tem precedência sobre `realtime.refetchMaxWaitMs`. | `1000` |
| `REALTIME_RECOUNT_INTERVAL_MS` | Por quanto tempo o total de uma inscrição de lista grande pode ser reutilizado antes de ser recalculado, em ms; frames que o reutilizam carregam `meta.totalAsOf`. Não definido significa que cada frame recalcula. Tem precedência sobre `realtime.recountIntervalMs`. | Não definido |
| `REALTIME_RECOUNT_MIN_ROWS` | O menor total recente ao qual `REALTIME_RECOUNT_INTERVAL_MS` se aplica; listas menores têm sua contagem recalculada a cada frame. Tem precedência sobre `realtime.recountMinRows`. | `100000` |
| `ALLOW_LOCALHOST_IN_PRODUCTION` | Permite valores de `localhost`/loopback sob `NODE_ENV=production`. Desativado por padrão, para que uma inicialização em produção falhe explicitamente em vez de tentar conectar a um banco que não existe. | `false` |
| `REBASE_STRICT_COLLECTION_CONFIG` | O que a inicialização faz com chaves em suas coleções que esta versão não reconhece: `warn`, `error` (recusa a inicialização — recomendado ativar em CI) ou `off`. Aplica-se apenas a chaves não *reconhecidas*, que geralmente são erros de digitação e ocasionalmente metadados deliberados; uma chave que o sistema sabe que mudou de local sempre causa erro fatal, pois a funcionalidade configurada ficaria ausente silenciosamente. | `warn` |
| `REBASE_PROVISION_ONLY` | `1`/`true` executa a etapa de schema e encerra sem abrir conexões de socket — exatamente o formato esperado por um Job de migração, a partir da mesma imagem e do mesmo bundle do servidor subsequente. Também cria tabelas que um processo ativo criaria no primeiro uso, e não inicia filas de cron ou jobs. Um valor vazio é considerado *não definido*, garantindo que uma variável `${VARIAVEL}` não substituída em um compose file não transforme um deploy normal em um que executa migrações e não serve requisições. Recusado em conjunto com `REBASE_PROVISION=false`. | — |
| `REBASE_PROVISION_SQL_OUT` | Caminho de arquivo. Uma execução de provisionamento (`REBASE_PROVISION_ONLY=true`) grava nela todas as alterações de schema realizadas, em ordem, como um script SQL para revisão e aplicação via `psql`. Linhas de dados inseridas não são incluídas. Recusado em processos que servem tráfego. | — |
| `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` | `true` permite que uma máquina — um agente, um job de CI — *aplique* alterações de schema por meio de `/api/admin/schema`, não apenas planeje. Desativado a menos que solicitado: a credencial com privilégios para tais alterações é a mais provável de estar presente em variáveis de CI. | `false` |
| `REBASE_FUNCTIONS_TIMEOUT_MS` | Tempo máximo de execução de uma custom function antes que sua requisição seja abortada. Mesmo controle que a opção `functionsTimeoutMs`. `0` desativa o limite. | `30000` |
| `REBASE_EXIT_ON_UNHANDLED_REJECTION` | `true` faz com que uma rejeição de promise não tratada finalize o processo em vez de apenas registrar um log. Recomendado sob orquestradores que realizarão o reinício; desative onde um reinício for pior que um leak pontual. | `false` |
| `REBASE_CRON_ALWAYS_ON` | Mantém o agendador de cron ativo em plataformas que o runtime detectaria como scale-to-zero, onde um timer acionado em uma instância ociosa não seria executado em nenhuma instância. | — |
| `TRUSTED_PROXY_HOPS` | Quantos proxies estão à frente deste servidor, permitindo que o rate limiter extraia o endereço real do cliente a partir do `X-Forwarded-For`. Padrão seguro `0`: sem proxy, confiar no cabeçalho permitiria que qualquer chamador forjasse sua identidade. | `0` |

:::note[O provisionamento na inicialização é aditivo e não é uma ferramenta de migração]
A etapa de inicialização executa de forma autônoma sem supervisão de diffs, portanto nunca removerá
uma coluna, estreitará um tipo ou reescreverá uma tabela. É por isso também que a imagem recusa
`REBASE_MIGRATE_ON_BOOT=push`: um push completo calcula um diff e executará tranquilamente um
`DROP COLUMN`, e o reinício de um container nunca deve ser capaz de destruir uma
coluna de produção como efeito colateral de um reagendamento.

Alterações destrutivas ou de reestruturação permanecem onde podem ser revisadas: `rebase db generate` + `rebase db migrate`, ou `rebase db push` a partir de um checkout local ou CI,
que simula a alteração (dry-run), recusa ações destrutivas sem confirmação prévia e
pode realizar um backup antes de prosseguir.
:::

### Deploys divididos (Split deployments)

Uma mesma imagem e um mesmo bundle podem ser inicializados várias vezes, cada um servindo uma
parte diferente do projeto. Resumidos em uma linha cada aqui, já que esta página documenta
todas as variáveis; o que cada combinação *monta e controla* — e quais
combinações impedem a inicialização — está documentado em
**[Processos Divididos](/docs/deployment/split-processes)**.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_ROLE` | Qual parte este processo atende: `all`, `api`, `functions` ou `worker`. | `all` |
| `REBASE_CRON_SCHEDULER` | Sobrescreve se *este* processo executa os timers de cron. Não definido segue o role. | — |
| `REBASE_JOB_WORKERS` | Sobrescreve se este processo executa os workers de fila de jobs. Não definido segue o role. | — |
| `REBASE_FUNCTIONS_ONLY` | Atende apenas as custom functions especificadas neste processo. | — |
| `REBASE_FUNCTIONS_EXCLUDE` | Atende todas as custom functions, exceto as especificadas. | — |
| `REBASE_FUNCTIONS_UPSTREAM` | Para onde o processo de API encaminha requisições de funções que ele mesmo não atende. Em um `worker`, para onde suas próprias chamadas `rebase.functions` são enviadas. Uma URL `http(s)`. | — |

### Superfície MCP

Um endpoint Model Context Protocol opcional em `/mcp`, permitindo que um cliente de IA leia
e grave dados neste projeto **como o usuário autenticado**. Desativado por padrão e — diferente
de qualquer outra superfície — nenhum `REBASE_ROLE` o ativa automaticamente: os outros definem
o formato do processo, enquanto este representa a decisão de fornecer credenciais a software
de terceiros, devendo ser uma decisão humana em vez de herdada da função de um container.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_MCP_ENABLED` | Habilita a superfície MCP. Requer `REBASE_PUBLIC_URL`; sem ela, a superfície não é montada e avisa no log de inicialização. | `false` |
| `REBASE_PUBLIC_URL` | Origem publicamente acessível deste deploy, ex.: `https://app.example.com`. A superfície MCP não pode inferi-la — extrair a origem do cabeçalho `Host` tornaria a identidade do emissor e a audiência validada nos tokens valores controlados pelo chamador. | — |
| `REBASE_MCP_OPEN_REGISTRATION` | Permite registro dinâmico de clientes OAuth (RFC 7591), permitindo que um cliente se registre de forma autônoma. Defina como `false` para exigir que os clientes sejam registrados previamente. | `true` |

### Edição de schema ao vivo a partir de um bundle

Desativado a menos que `REBASE_LIVE_SCHEMA_REPOSITORY` esteja definido. Um bundle compilado não possui
código-fonte de coleções para editar, portanto, com essas variáveis configuradas, o editor de coleções
no painel administrativo lê o código-fonte do repositório, realiza o commit de cada alteração de volta
e executa o DDL correspondente neste banco de dados. Exclusivo para administradores e aplicado por uma pessoa,
a menos que `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` indique o contrário. Um repositório informado
sem credencial válida impede a inicialização. Veja
[Edição de schema ao vivo](/docs/backend/live-schema-editing#from-a-built-bundle).

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_LIVE_SCHEMA_REPOSITORY` | Repositório GitHub para onde as alterações de schema receberão commit, no formato `owner/name`. Defini-lo é o que ativa a funcionalidade. | — |
| `REBASE_LIVE_SCHEMA_BRANCH` | Branch onde o commit será aplicado. | `main` |
| `REBASE_LIVE_SCHEMA_COLLECTIONS_PATH` | Localização do código das coleções no repositório, relativo à raiz do repositório. | `config/collections` |
| `REBASE_LIVE_SCHEMA_GITHUB_TOKEN` | Token com permissões granulares de leitura e escrita para o conteúdo do repositório. Defina este token ou as três variáveis `_GITHUB_APP_*`, mas não ambos. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_ID` | ID de um GitHub App, para realizar commits como o app em vez de usar um token pessoal. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_INSTALLATION_ID` | ID de instalação do app no repositório. | — |
| `REBASE_LIVE_SCHEMA_GITHUB_APP_PRIVATE_KEY` | Chave privada do app: PEM, PEM com quebras de linha escapadas ou base64. | — |

### Backups

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `BACKUP_SCHEDULE` | Expressão cron para backups agendados. Não definido significa backups agendados desativados. | — |
| `BACKUP_DESTINATION` | Caminho local ou URL no formato `s3://bucket/prefix` / `gs://bucket/prefix`. | `./backups` |
| `BACKUP_RETENTION_DAYS` | Exclui backups com mais de N dias. Não definido ou `0` mantém todos. | — |
| `BACKUP_KEEP_MINIMUM` | Mantém sempre pelo menos N backups mais recentes, independentemente da retenção por dias. | — |
| `PG_DUMP_PATH` | Sobrescreve o binário `pg_dump` — deve ser da versão principal do servidor ou mais recente. | — |
| `PG_RESTORE_PATH` | Sobrescreve o binário `pg_restore`. | — |
| `PSQL_PATH` | Sobrescreve o binário `psql` executado por `rebase db restore --clean` para consolidar a restauração em uma transação única. | — |
| `PG_DUMPALL_PATH` | Caminho onde o `pg_dumpall` reside, quando não estiver no `PATH`. Sem ele — e sem as ferramentas de cliente do PostgreSQL instaladas —, o backup de globais falhará com um erro mencionando esta variável. | — |

A imagem oficial do runtime (`rebasepro/server`) inclui as ferramentas de cliente
do PostgreSQL 18, de modo que um backup agendado roda perfeitamente contra qualquer servidor até o Postgres 18.
Fora da imagem, instale-as manualmente (`apt-get install postgresql-client-18`,
`brew install libpq`).

Backups contêm credenciais e dados pessoais (PII). Utilize um destino privado com criptografia em repouso.

### Entrega de bundle

Um deploy gerenciado não inclui seu código diretamente na imagem: o runtime busca
o bundle durante a inicialização. Estas variáveis definem qual bundle buscar e como.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_BUNDLE` | Caminho para um diretório de bundle já extraído. O que o `rebase start` define localmente. | — |
| `REBASE_BUNDLE_URL` | De onde baixar o arquivo compactado do bundle, quando não houver versão local. | — |
| `REBASE_BUNDLE_TOKEN` | Credencial bearer para o download. Trate-a como um segredo: é ela que autoriza o tenant a baixar seu próprio código. | — |
| `REBASE_BUNDLE_FETCH_DIR` | Onde o bundle baixado é extraído. Deve ter permissão de escrita e persistir entre o download e a inicialização. | — |
| `REBASE_RUNTIME_MODULES` | Módulos extras que a imagem de runtime fornece ao bundle, além dos declarados por ele próprio. | — |

### Vinculações de recursos (Resource bindings)

Cada banco de dados, bucket e tópico declarado pelo projeto em `config/resources.ts` é
vinculado por variáveis de ambiente nomeadas a partir dele. Os nomes base estão descritos abaixo;
um recurso não padrão adiciona `__` e sua respectiva chave em letras maiúsculas, de modo que um bucket chamado
`media` lerá `S3_BUCKET__MEDIA`. O comando `rebase status` exibe, para cada recurso,
a variável exata sendo consultada e se ela está definida.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_DRIVER` | O pacote npm que implementa o driver de uma fonte de dados, quando não for o padrão do Postgres. Recebe sufixo por fonte: `REBASE_DRIVER__ANALYTICS`. | — |
| `REBASE_TOPIC_URL` | String de conexão para um tópico declarado. Recebe sufixo por tópico. | — |

### Ambiente da própria CLI

Lido pelo `rebase`, não pelo servidor. Nada nesta seção afeta o deploy em execução.

| Variável | Descrição | Padrão |
|----------|-------------|---------|
| `REBASE_BASE_URL` | Para onde comandos como `rebase api-keys`, `rebase storage` e `rebase auth reset-password` enviam a service key, no shell ou no `.env`. Defina quando o servidor rodar de outra forma que não `rebase dev` neste projeto: `rebase start`, um container, outro host. Se não definida, eles usam o servidor registrado por `rebase dev` enquanto ele estiver rodando, e não enviam nada se não estiver. | — |
| `REBASE_SERVICE_KEY` | A service key com a qual esses comandos se autenticam, lida do `.env`: a mesma variável que o servidor lê (veja acima). | — |
| `SERVICE_KEY` | Nome legado para essa chave. Quando definida no `.env`, `rebase api-keys` e `rebase storage` a utilizam no lugar de `REBASE_SERVICE_KEY`. | — |
| `REBASE_ENV_FILE_PATH` | Qual arquivo `.env` a CLI deve ler e gravar, caso não seja o do projeto. | — |
| `REBASE_CLOUD_URL` | O control plane com o qual o comando `rebase cloud` se comunica. | — |
| `REBASE_CLOUD_EMAIL` | A conta com a qual `rebase cloud login` autentica, sem solicitar interativamente. | — |
| `REBASE_CLOUD_PASSWORD` | Sua respectiva senha, permitindo que um cofre de segredos a forneça sem expô-la no histórico do shell. | — |
| `REBASE_TOKEN` | Um token gerado via `rebase cloud tokens create`. Se definido, todos os comandos `rebase cloud` se autenticam com ele em vez da sessão de `rebase cloud login`, nunca lendo ou gravando a sessão armazenada. Em um diretório vinculado por `rebase cloud init --claim`, ele é reservado para o próprio token do projeto caso não tenha escopo sobre ele. A forma ideal de rodar `rebase cloud` em CI — veja [CI e agentes](/docs/deployment/cloud/#ci-and-agents). O [servidor MCP](/docs/ai/mcp/) o repassa para a CLI invocada por suas ferramentas em nuvem, nunca enviando-o para a aplicação: defina `REBASE_API_TOKEN` para essa finalidade. | — |
| `REBASE_DEBUG` | `1` imprime o erro original subjacente e detalhes da requisição em vez da mensagem resumida. O primeiro item a definir quando um comando `rebase cloud` falhar sem detalhes suficientes. | — |
| `REBASE_ATLAS_DEV_URL` | Banco de dados vazio contra o qual comandos como `rebase db push`, `db generate` e `db migrate` planejam o diff, em vez de usar `<db>_dev_diff` criado ao lado de `DATABASE_URL`. O Rebase não cria nem remove o banco informado aqui, e recusa um valor idêntico a `DATABASE_URL`. No banco de desenvolvimento gerenciado, a CLI o define automaticamente para um PGlite em memória temporário. Defina onde permissões de `CREATE DATABASE` não existirem. | `<db>_dev_diff` |
| `REBASE_DEV_NO_DB` | `rebase dev` não inicializa banco de dados nem provisiona nada — você fornece o seu próprio. Equivalente à flag `--no-db`. | — |
| `REBASE_FRONTEND_PORT` | Fixa a porta do servidor de desenvolvimento do frontend, que normalmente o `rebase dev` deriva a partir do caminho do projeto. | — |
| `REBASE_DEV_READY_TIMEOUT_MS` | Quanto tempo o `rebase dev` aguarda o backend anunciar que subiu antes de reportar que ele não iniciou. `0` desativa o alerta. | `30000` |
| `DATABASE_PASSWORD` | A senha que `rebase dev --docker` insere na string de conexão derivada do `docker-compose.yml`. | — |
| `DO_NOT_TRACK` | Convenção comum entre ferramentas. Qualquer valor diferente de `0` faz com que a CLI não envie telemetria. | — |
| `REBASE_TELEMETRY_DISABLED` | O mesmo efeito anterior, específico para o Rebase. Não requer arquivo físico, ideal para uso em CI e dentro de imagens de container. | — |
| `REBASE_TELEMETRY_ENDPOINT` | Para onde a telemetria é enviada, no caso de um coletor auto-hospedado. | — |

## Segredos em desenvolvimento

O `JWT_SECRET` é obrigatório em produção. Ele e o `REBASE_SERVICE_KEY` são
gerados automaticamente fora dela, para que você possa começar a desenvolver sem configurar nada previamente.

Esses valores gerados são armazenados em cache em `.rebase-dev-secrets.json`, ao lado de
`.rebase-dev-port` e `.rebase-dev-url`, e adicionados ao gitignore com eles. Anteriormente, eles
eram gerados a cada inicialização — o que significava que reiniciar o servidor de desenvolvimento desconectava
você da sua própria aplicação e invalidava qualquer chave de API recém-criada.

- Defina qualquer uma das variáveis explicitamente e o seu valor será usado; nada é armazenado ou lido do cache.
- Aponte o cache para outro local com `REBASE_DEV_SECRETS_FILE` — um caminho, e a
  única variável desta seção que você configuraria deliberadamente.
- Exclua o arquivo para renovar ambos os segredos. A próxima inicialização criará um novo.
- Se o arquivo não puder ser gravado — em um container somente leitura, por exemplo —, o servidor inicia
  normalmente com um segredo temporário em memória, exatamente como antes.

Nada é armazenado em cache em produção ou sob executores de teste. Em produção, nenhum valor
é gerado automaticamente: uma inicialização sem `JWT_SECRET` falha, indicando o nome da variável:

```
The environment is not valid:
  JWT_SECRET: is required
```

## Objeto de Configuração do Backend

O `RebaseBackendConfig` passado para `initializeRebaseBackend()` fornece controle programático:

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";
import { env } from "./env";

await initializeRebaseBackend({
    app,
    server,
    collectionsDir: "./config/collections",
    basePath: "/api",        // Base path for all API routes (default: "/api")

    database: createPostgresAdapter({
        connection: db,
        schema: { tables, enums, relations }
    }),

    auth: {                  // Authentication config
        jwtSecret: env.JWT_SECRET,
        accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
        refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
        requireAuth: true,    // Require auth for data API (default: true)
        allowRegistration: env.ALLOW_REGISTRATION,
        google: env.GOOGLE_CLIENT_ID
            ? {
                clientId: env.GOOGLE_CLIENT_ID,
                clientSecret: env.GOOGLE_CLIENT_SECRET
            }
            : undefined,
        serviceKey: env.REBASE_SERVICE_KEY
    },

    // No bucket configured in production means storage is off, not local:
    // uploads answer 501 rather than landing on a filesystem that is erased
    // on the next redeploy.
    storage: env.STORAGE_TYPE === "s3"
        ? {
            type: "s3",
            bucket: env.S3_BUCKET!,
            region: env.S3_REGION,
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
            endpoint: env.S3_ENDPOINT
        }
        : env.STORAGE_TYPE === "gcs"
            ? {
                type: "gcs",
                bucket: env.GCS_BUCKET!,
                projectId: env.GCS_PROJECT_ID,
                keyFilename: env.GCS_KEY_FILENAME
            }
            : isProduction && !env.FORCE_LOCAL_STORAGE
                ? undefined
                : {
                    type: "local",
                    basePath: env.STORAGE_PATH || "./uploads"
                },

    history: true,           // Enable entity change history

    enableSwagger: true,     // Enable OpenAPI docs at /api/docs

    logging: {
        level: "info"
    }
});
```

As mesmas opções,
sem `app`, `server` e `basePath`, e com a propriedade obrigatória `provision`, constroem um
backend que não atende requisições até que você o monte: `createRebaseBackend`. Veja
[Integração com Servidor Customizado](/docs/backend/custom-server/).

### Alterando `basePath`

O `basePath` move todas as rotas da API, portanto o cliente precisa ser configurado com o mesmo valor —
caso contrário, continuará chamando `/api/...` e recebendo respostas 404:

```typescript
import { createRebaseClient } from "@rebasepro/client";

export const rebase = createRebaseClient({
    baseUrl: "https://api.example.com",
    apiPath: "/v1"          // must match the backend's basePath
});
```

O painel administrativo obtém essa informação automaticamente a partir do cliente configurado; nenhuma outra
configuração é necessária. Caso monte uma URL de requisição manualmente, concatene-a a partir do cliente
em vez de escrever `/api` no código:

```typescript
import { useApiBase } from "@rebasepro/app";

function Widget() {
    const apiBase = useApiBase();   // e.g. "https://api.example.com/v1"
    // fetch(`${apiBase}/data/products`)
}
```

## Solução de Problemas

### Permissão Negada no SQL Editor (`permission denied for table <name>`)

* **Sintomas:** Consultas customizadas executadas no SQL Editor do Rebase Studio falham com `cause: error: permission denied for table <name>`, mesmo que a visualização de planilha do CMS carregue os dados normalmente.
* **Causa:** Por padrão, o Rebase tenta executar consultas do SQL Editor alternando temporariamente os papéis (roles) do banco de dados para corresponder ao papel do usuário ativo na aplicação (ex.: `SET LOCAL ROLE "admin"`). Se você utiliza autenticação customizada em que os papéis existem apenas em tabelas da aplicação em vez de papéis reais do PostgreSQL, a troca de papel falha ou faltam privilégios no banco. A visualização de planilha do CMS executa sob o usuário proprietário da conexão padrão e ignora essa troca.
* **Solução:** Adicione `DISABLE_DB_ROLE_SWITCHING=true` à configuração do seu `.env` no backend. Isso força o Rebase a executar as consultas do SQL Editor usando os privilégios do proprietário da conexão (geralmente um superuser/owner). O SQL Editor exibirá acima dos resultados que eles foram lidos como o proprietário da conexão e desativará o seletor de papéis.

### Falha ao Carregar o Schema no SQL Editor (`Cross-database execution requires adminConnectionString`)

* **Sintomas:** O Studio falha ao carregar a árvore de schemas, ou o SQL Editor apresenta o erro `Failed to fetch schema: Cross-database execution requires adminConnectionString to be configured in the backend.`
* **Causa:** O Rebase exige privilégios administrativos para consultar os catálogos do sistema e executar comandos administrativos. Se `adminConnectionString` não for fornecida ao bootstrapper, ou se `getAdmin()` for sobrescrito para retornar `undefined`, essas operações falham.
* **Solução:** Certifique-se de que `adminConnectionString` esteja configurada durante a inicialização do bootstrapper no backend:
  ```typescript
  createPostgresBootstrapper({
      connection: db,
      schema: { tables, enums, relations },
      adminConnectionString: process.env.ADMIN_CONNECTION_STRING || process.env.DATABASE_URL
  })
  ```

## Próximos Passos

- **[Deploy](/docs/getting-started/deployment)** — Guia de deploy em produção
- **[Visão Geral do Backend](/docs/backend)** — Referência completa de configuração do backend
