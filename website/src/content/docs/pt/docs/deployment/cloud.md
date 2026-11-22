---
sourceHash: daa75b0f6ab9dbdf
title: Rebase Cloud
sidebar_label: Rebase Cloud
description: O Rebase Cloud é o mesmo Rebase, operado para você. O que é, como um projeto se conecta e faz deploy, e o que o beta privado ainda não inclui.
---

O Rebase Cloud executa o mesmo Rebase de código aberto que você auto-hospedaria — a mesma imagem `rebasepro/server` publicada, o mesmo bundle, o mesmo Postgres. A diferença é quem o opera.

:::note[Beta privado]
O Rebase Cloud está em **beta privado**. Ele executa tenants reais hoje e é liberado em lotes. [Solicite acesso](https://rebase.pro/pricing).

Não é self-service, portanto, os comandos abaixo precisam de uma conta que tenha recebido acesso. Todo o restante neste site funciona sem ela.
:::

## O que é

Um **projeto** Cloud são três coisas que a plataforma opera para você:

| | O que você recebe |
|---|---|
| **App** | Seu bundle, rodando na imagem de runtime publicada. Deploys são o upload de um bundle, não a compilação de um contêiner |
| **Database** | Um PostgreSQL gerenciado, com backups automatizados e point-in-time recovery |
| **Storage** | Um bucket próprio, se o seu projeto usar armazenamento de arquivos |

O app e o banco de dados são provisionados quando você faz o primeiro deploy; um bucket, só quando você pede um ([Armazenamento de arquivos](#armazenamento-de-arquivos)). Cada um é faturado pelo que reserva, em vez de por usuário.

**Nada no seu projeto muda para rodar lá.** O mesmo repositório pode ser auto-hospedado com `docker compose`, e a rota de escape é real: `rebase build` produz um bundle que inicializa em qualquer lugar onde a imagem de runtime execute.

## Vincular um projeto

A partir do diretório de um projeto:

```bash
rebase cloud login
rebase cloud billing setup
rebase cloud projects create --name "My app" --subdomain my-app --link
```

`login` abre o console no seu navegador e exibe um código curto. Verifique se o console mostra o mesmo código e aprove o login lá: o terminal obtém a sessão e a grava em `~/.rebase/credentials.json`. Se você não estiver conectado ao console, faça login lá primeiro com o provedor que preferir, incluindo Google e GitHub. Via SSH, `rebase cloud login --no-browser` exibe o link para abrir em sua própria máquina.

`projects create` não aceita argumentos posicionais. O nome e o subdomínio são flags, e ambos são obrigatórios — em um terminal eles são solicitados interativamente, e uma execução headless que omita qualquer um deles é encerrada com `input_required` em vez de inventar um. **O subdomínio não pode ser editado posteriormente:** é o host `<slug>.rebase.website` no qual o projeto responde, portanto, escolha-o com atenção.

`--link` vincula este diretório ao projeto na mesma chamada, portanto não há uma etapa `link` separada. Ele grava `.rebase/cloud.json`, que registra o ID e o slug do projeto. Esse arquivo não é um segredo e não contém suas credenciais — elas ficam em `~/.rebase/credentials.json`, gravadas pelo `login`.

No entanto, ele é commitado com o código, para que um repositório clonado possa nomear qualquer plano de controle (control plane). Quando o host vem apenas desse arquivo, e não é o próprio da plataforma nem um no qual você já tenha feito login antes, o `login` o nomeia e pergunta antes de enviar seu e-mail e senha para lá. Sem um terminal, ou com `--json`, ele recusa com `unknown_control_plane`; passe `--url <host>` (ou defina `REBASE_CLOUD_URL`) para fazer login lá intencionalmente.

Para fazer login sem o navegador, passe seu e-mail: `rebase cloud login --email me@example.com` solicita sua senha. **Cadastrou-se com Google, GitHub ou LinkedIn?** Sua conta não possui senha, portanto use um código em vez disso:

```bash
rebase cloud login --code --email me@example.com
```

O control plane envia por e-mail um código de 6 dígitos, válido por dez minutos, e você o digita no prompt. Com `--email` e sem senha, `rebase cloud login` pergunta se você deseja usar sua senha ou um código. Os códigos exigem que o control plane consiga enviar e-mails; se não puder, `--code` informa isso e encerra com `otp_unavailable`.

Se você ativou a autenticação de dois fatores, o `login` pedirá o código do seu aplicativo autenticador, ou um dos seus códigos de recuperação, independentemente de como você fez login. Pelo navegador, o console solicita isso quando você faz login lá. Nem um código de login nem um segundo fator podem ser digitados sem um terminal. Para um script, crie um token de acesso no console (**Settings → Access tokens**) e defina `REBASE_TOKEN`; consulte [CI e agentes](/docs/deployment/cloud-agents/#ci-and-agents).

Uma senha incorreta responde com `invalid_credentials` apresentando as mesmas duas formas de entrada, já que a causa comum é uma conta que nunca teve senha.

`billing setup` vincula um cartão à organização uma única vez. Ele vem primeiro na sequência propositalmente: o primeiro deploy de um projeto é recusado sem um cartão, e descobrir isso após o upload do bundle ter terminado é a pior ordem.

Depois disso, a página **Billing** do console lista as faturas da organização, cada uma com a página hospedada da Stripe e PDF, e pré-visualiza a próxima fatura de cada projeto. `rebase cloud billing invoices` e `rebase cloud billing upcoming` exibem o mesmo. Ambos são destinados aos proprietários e administradores da organização. Onde a plataforma disponibiliza, **Manage billing** abre o portal do cliente da Stripe para gerenciar o cartão, detalhes de faturamento e faturas anteriores.

Com um cartão já cadastrado, criar outro projeto no console não exige um segundo pagamento: o projeto é cobrado nesse cartão e implantado. Se o cartão for recusado ou o banco exigir a confirmação do pagamento, o console leva você para **Billing**, onde **Fix your card** salva outro cartão e **Complete the payment** abre a fatura da Stripe.

O que um projeto consumiu é exibido em sua visão geral, em **Usage this month**, e para todos os projetos de uma vez na página **Billing**: requisições em relação à cota incluída (a barra fica âmbar em 80%), erros 5xx, o excedente até o momento e qual a projeção do mês nesse ritmo. O excedente é calculado pelo mesmo código que o reporta à Stripe, portanto, é o que constará na fatura; ele aparece na fatura do mês seguinte. `rebase cloud usage` exibe o mesmo, e `rebase cloud usage org` mostra para toda a organização. Qualquer membro pode visualizar. Os números indicam o que ainda não conseguem monitorar: o object storage não é medido, portanto nenhum excedente de armazenamento é cobrado; enquanto um projeto executa dois ou mais pods de aplicativo, suas requisições não são contabilizadas; e um dia com amostras perdidas faz uma contagem a menor. Um projeto com autoscaling também mostra os pods que executou acima de `--replicas`, em pod-horas, quanto custaram em suas próprias tarifas e se esta plataforma já os está cobrando. Um projeto reivindicado a partir de um agente conta apenas os dias a partir da reivindicação: antes disso, o projeto pertencia à plataforma.

Um projeto existente pode ser vinculado sem a criação de um novo:

```bash
rebase cloud projects list
rebase cloud link --project my-app
```

## Deploy

```bash
rebase cloud deploy
```

Um comando e nenhuma flag para memorizar. O `rebase.json` gerado pelo scaffold declara `runtime: "managed"` para seu backend, e o comando `deploy` lê essa declaração — ele avisa durante o processo (`rebase.json declares runtime: managed — deploying a bundle`), compila a aplicação em `dist-bundle`, faz o upload do bundle, executa-o na imagem de runtime publicada e acompanha o deployment até um estado terminal. O código de saída é o veredito, portanto a mesma linha funciona de forma autônoma em CI.

Ele termina informando onde cada app agora responde e se a nova versão está ativa lá:

```text
  ✓ Deployed songbuzz in 1m 12s  (deployment fb3c7442-9937-4179-8d3c-88a106da149d)

    game     static   https://songbuzz.rebase.website      live
    backend  backend  https://songbuzz.rebase.website/api  live

  ✓ Live: the new version answers on every address above.
  Something wrong? `rebase cloud rollback` puts the previous deployment back.
```

"Live" significa que o endereço respondeu após a compilação: o `/health` de um backend retornou `ok`, e a página de um app estático carregou (a partir deste deploy, quando a plataforma o serve). A verificação aguarda até `--live-timeout` segundos, 60 por padrão; `0` pula a verificação. Se um app não responder a tempo, o deploy ainda assim sai com código zero, porque o deployment teve sucesso, e a última linha informa qual app não respondeu e o motivo. Já um deploy com falha termina em uma única linha, indicando o app e a razão, com `rebase cloud logs` para visualizar o log completo de build.

Scripts passam `--json` para receber um único objeto contendo os mesmos dados — `apps`, `hosts`, `live`, `liveChecks`, `durationMs` e o id do deployment. Ao contrário do restante do `rebase cloud`, o `deploy` não alterna automaticamente para JSON quando usado com pipes.

O que esse runtime permite — pacotes e módulos nativos, memória e instâncias, timeouts e tamanhos de body, sistema de arquivos, segredos, armazenamento e rede de saída — está em sua própria página: [Runtime de backend gerenciado](/docs/deployment/managed-runtime/).

Para enviar um artefato que foi compilado anteriormente — por exemplo, um job de CI que compila uma vez e faz deploy duas vezes — aponte para o diretório em vez de recompilar:

```bash
rebase build
rebase cloud deploy --bundle-dir dist-bundle
```

Sair do runtime gerenciado tem sua própria flag, `--eject`, e nada mais solicita isso: um build que moveria um projeto gerenciado para uma imagem de contêiner própria é recusado até que você determine explicitamente. Antigamente, `--force` tinha esse significado, o que colocava a ação menos reversível que a CLI pode fazer sob a mesma palavra de "sobrescrever este arquivo"; agora ela é uma opção desconhecida em vez de um alias, portanto, um script que a utilize será interrompido.

### A verificação de sintaxe antes do upload

Os arquivos de um app estático são servidos exatamente como estão. Quando seu `build` apenas copia scripts escritos à mão para `output`, nada os analisou, e um arquivo com um erro de digitação vai para produção e impede a página de carregar. Por isso, antes que qualquer coisa seja enviada, o `deploy` faz o parse de cada arquivo `.js`, `.mjs` e `.cjs` no `output` de cada app estático, juntamente com cada `<script>` inline em seus arquivos `.html`. Isso cobre tanto um app estático implantado isoladamente quanto apps estáticos incorporados ao bundle do backend. Um erro de sintaxe interrompe o deploy mostrando o arquivo, a linha e a coluna:

```
✗ A syntax error in the static output, so nothing was deployed:
    web/cloud.js:42:23  Unexpected token
        42 |     return fetch("/api";
Fix it and deploy again, or pass --no-verify to deploy anyway.
```

Com `--json`, o `code` do erro é `syntax_error`. Scripts inline que um navegador não executa como JavaScript são ignorados: JSON, import maps, templates e qualquer outro `type` que não seja JavaScript, um `<script src>`, e scripts que ainda contenham marcações de template não renderizadas como `{{ }}`. Um arquivo `.js` é aprovado se fizer o parse como um script clássico ou como um módulo, pois a página é quem decide. Nada dentro de `node_modules` é lido, nem um `--bundle-dir` pré-compilado. `--no-verify` ignora a verificação para um único deploy.

Acompanhe:

```bash
rebase cloud logs               # the build log
rebase cloud logs --runtime -f  # what the running app prints, live, until Ctrl-C
rebase cloud status             # what the platform thinks the project is doing
```

O `status` relata `blockedOn` e `nextAction`. Quando `blockedOn` for `null`, a plataforma está trabalhando ativamente e fazer polling é a atitude correta; quando indicar algo, esse algo está esperando por você.

Um deles é `email_not_configured`: o aplicativo ativou o login por magic-link ou código por e-mail (`AUTH_MAGIC_LINK`, `AUTH_EMAIL_OTP`) e não possui serviço de e-mail configurado, de modo que o deployment está ativo mas ninguém consegue fazer login. O Rebase Cloud não envia e-mails para o seu aplicativo: configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e `SMTP_FROM` com `rebase cloud env set` e depois faça o deploy. O `status` lê isso a partir do próprio `GET /api/auth/config` do app (seu campo `unavailable`), e o `deploy` informa o mesmo em sua verificação de disponibilidade (live check).

## Armazenamento de arquivos

Um projeto novo não tem bucket: os uploads são recusados com `501 STORAGE_NOT_CONFIGURED`,
e o resumo do deploy diz isso, em vez de serem gravados num disco que cada deploy substitui.

Dê a ele um dos dois tipos e faça o deploy de novo para que o app o use:

```bash
# Um bucket que o Rebase opera para você. A página Storage do console faz o mesmo.
rebase cloud storage create

# Ou o seu próprio bucket compatível com S3: AWS S3, Cloudflare R2, Backblaze B2, MinIO…
rebase cloud storage attach --bucket <name> \
  --access-key-id <id> --secret-access-key <secret> \
  --endpoint <url>        # omita para a AWS; adicione --force-path-style para o MinIO

rebase cloud deploy
```

`rebase cloud storage` lista os buckets do projeto. Um projeto com vários
anexa cada um com `--source <key>`; um que configura o armazenamento no código não precisa de nenhum.

## Pré-visualizar uma alteração

```bash
rebase cloud deploy --preview
```

Isso compila e envia exatamente o que o `deploy` enviaria, mas disponibiliza em um endereço próprio, como `https://shop--k3x9ab.rebase.website`. A produção continua servindo o que servia antes. O deploy exibe o endereço de preview quando o build termina.

Para manter o mesmo endereço entre deploys, dê um nome ao preview. Fazer o deploy com o mesmo nome novamente o atualiza:

```bash
rebase cloud deploy --preview-name new-checkout
```

Com o que um preview se comunica depende do que você implantou:

- **`rebase cloud deploy --preview`** pré-visualiza o backend, com seus apps estáticos incorporados, da mesma forma que a produção os executa. Ele recebe um backend próprio em um **banco de dados vazio próprio**, nunca o de produção. Inicializar contra o banco de dados de produção aplicaria o schema e as regras de acesso do preview a ele.
- **`rebase cloud deploy web --preview`** pré-visualizaria um app estático isoladamente, com suas páginas chamando o backend de **produção**. Isso exige um control plane que sirva sites estáticos de forma autônoma, e o Rebase Cloud ainda não faz isso: ele recusa com `PREVIEW_STATIC_UNSERVED` e não publica nada. Em vez disso, pré-visualize o backend, que serve os apps estáticos incorporados a ele; um projeto sem backend gerenciado ainda não pode ser pré-visualizado.

Um preview não faz upload de código-fonte e não registra apps ou hostnames, pois qualquer uma dessas ações alteraria o projeto de produção. `--source` e `--eject` não podem ser combinados com `--preview`. Cada um deles cria uma imagem de contêiner para produção.

```bash
rebase cloud previews                      # name, address, app, backend, expiry
rebase cloud logs --preview new-checkout   # its build log; -f follows a build still running
rebase cloud logs --runtime --preview new-checkout -f  # what its backend prints
rebase cloud previews delete new-checkout  # stops serving it and drops its database
```

`rebase cloud logs` sem `--preview` é sempre o de produção.

A página **Deployments** do console lista os mesmos previews e permite abrir, visualizar o log de build ou excluir cada um deles. Criar um continua sendo uma etapa via CLI.

Um preview expira uma semana após o último deploy realizado nele.

Quando termina, o deploy verifica se o endereço de preview responde, assim como faz um deploy de produção (`--live-timeout <seconds>`, `0` para pular). O certificado de um novo preview pode levar um ou dois minutos, de modo que um deploy bem-sucedido pode indicar que o endereço ainda não responde.

Um preview de backend é faturado como uma unidade de app no tamanho padrão (100m de CPU e 384 MiB de memória, na tarifa do seu app para a região e capacidade), proporcional ao tempo em que existir, e aparece na estimativa mensal do projeto no console. `rebase cloud deploy --preview` exibe a mesma estimativa mensal (`cost` sob `--json`). Iniciar um exige um cartão cadastrado, assim como um deploy de produção. Um primeiro deploy que falhe antes de qualquer execução é removido em vez de cobrado. Um projeto pode executar até três previews de backend simultaneamente.

Cada novo endereço de preview recebe seu próprio certificado TLS da Let's Encrypt, que permite a um domínio 50 novos certificados por semana, compartilhados com todos os sites de produção nele. Previews podem utilizar 20 deles em qualquer período de 7 dias, em toda a plataforma. Acima disso, um novo preview é recusado (`429`, `preview_cert_budget`) indicando o momento em que poderá ser implantado; reimplantar um preview já existente nunca entra nessa contagem.

O banco de dados de um preview de backend é um segundo banco de dados no Postgres de **produção**: seus próprios dados, mas na mesma instância e no mesmo disco. Ele é limitado a 10 conexões, para que os previews não esgotem as de produção, e a 2 GB: um preview cujo banco de dados ultrapasse isso é pausado. Seu backend para, seu endereço deixa de responder, `rebase cloud previews` e o console o mostram como `paused` com o motivo, e os proprietários e administradores do projeto são notificados (`preview.paused`). Seus dados são mantidos até expirar. Faça deploy dele novamente para iniciá-lo (ele será pausado novamente enquanto o banco continuar muito grande) ou exclua-o. Um preview pausado continua sendo cobrado até ser excluído ou expirar. Exclua previews que você não precisa mais. Extensões instaladas em produção não são instaladas no banco de dados de um preview.

Os previews estão sendo disponibilizados gradualmente. Um control plane que ainda não os suporte recusa `--preview` com `previews_unavailable` e não faz deploy de nada.

## Roll back

```bash
rebase cloud deployments
rebase cloud rollback
```

Um rollback reaponta o projeto para o que um deployment bem-sucedido anterior entregou, e nunca recompila — o valor de um rollback é entregar um artefato que já foi executado.

Quais deployments se qualificam depende de como o projeto é implantado, e ambos os tipos funcionam:

| Como foi feito o deploy | O que é restaurado |
|---|---|
| `rebase cloud deploy` (uma compilação a partir do código-fonte) | A imagem publicada por esse build |
| `rebase cloud deploy --bundle` (o runtime da plataforma) | O bundle entregue por esse deploy, na versão de runtime que o projeto está executando agora |

Apps estáticos incorporados ao bundle do backend (um `rebase cloud deploy` simples em um projeto com backend) fazem parte desse bundle, portanto sofrem rollback junto com ele.

Um app estático implantado isoladamente (`rebase cloud deploy <app>`) ainda não pode sofrer rollback. Seu deployment registra qual app foi publicado, mas nenhum bundle, portanto o control plane não tem de onde restaurá-lo. A solução é fazer o deploy da última versão válida novamente, por exemplo a partir do commit anterior ao problemático. Após esse tipo de deploy, o `deploy` informa isso em vez de apontar para `rollback`, e `rollback` sem um ID recusa a operação em vez de reimplantar o backend em execução.

Portanto, um rollback necessita de um deployment que tenha registrado um dos dois, o que significa um projeto que tenha feito deploy com sucesso pelo menos duas vezes. `rebase cloud deployments` sinaliza os que se qualificam, e `--json` relata `rollbackable` por linha junto com a `image` ou `bundle` que restauraria.

Dois tipos de deployments são recusados, e a CLI informa quais: um que não obteve sucesso e um anterior ao momento em que a plataforma passou a registrar seus artefatos. Não há o que adivinhar em nenhum dos casos — adivinhar enviaria o que foi compilado ou enviado mais recentemente alegando restaurar este —, portanto, faça deploy da versão desejada diretamente.

Todo deploy bem-sucedido termina informando o caminho de volta (`rebase cloud rollback`), ficando visível no momento em que uma versão com problemas for identificada.

Um rollback adiciona um novo deployment em vez de voltar o histórico, e aguarda a versão restaurada começar a responder antes de reportar sucesso. Acompanhe com `rebase cloud logs -f`.

## Restaurar o banco de dados para um ponto no tempo

Um banco de dados gerenciado pode ser recuperado para qualquer minuto dentro de sua janela de recuperação, em **Database → Backups** no console ou via CLI: `rebase cloud db pitr status | restore --target <ISO> | cutover | discard`. O processo ocorre em duas etapas. Primeiro, uma cópia recuperada é preparada ao lado do banco de dados ativo; sua aplicação continua rodando no banco ativo, e o armazenamento da cópia é cobrado até que você faça o cutover ou a descarte. Depois, quando a cópia estiver pronta, o cutover reaponta a aplicação para ela e a reinicia. Qualquer dado gravado após o horário de destino não estará na cópia. O banco de dados original é mantido como plano de retorno e continua cobrando armazenamento; voltar atrás, removê-lo ou fazer uma segunda restauração exige contato com o suporte. Apenas um proprietário ou administrador pode preparar, fazer cutover ou descartar, e o console solicita o nome do projeto antes de realizar o cutover.

## Proteja sua conta

Sua conta do console pode acessar bancos de dados de produção, segredos e faturamento, portanto proteja-a como tal. Abra **Account security** no menu sob seu avatar no console (ou acesse `/account`). A página pertence a você, não a uma organização: o que você configurar lá se aplica a todas as organizações às quais você pertence.

- **Verificação em duas etapas.** Ative-a com qualquer aplicativo autenticador (1Password, Google Authenticator, Authy). A página exibe uma chave de configuração para adicionar ao aplicativo, ou um link que abre o aplicativo com a chave preenchida no celular, e em seguida solicita o código de 6 dígitos exibido no app. A partir de então, todo login exigirá um código, quer você entre com senha, Google ou GitHub.
- **Códigos de recuperação.** Ativar a verificação fornece dez códigos de uso único, exibidos apenas uma vez. Cada um permite fazer login no lugar do código do autenticador caso perca seu telefone, portanto salve-os antes de fechar a janela. **New recovery codes** os substitui, e os antigos deixam de funcionar. Desativar a verificação em duas etapas e gerar novos códigos exigem a confirmação de um código primeiro.
- **Senha.** Alterá-la desconecta você de todos os outros dispositivos. Uma conta criada com Google, GitHub ou LinkedIn não tem senha; a página oferece a opção de enviar um link por e-mail para você definir uma.
- **Dispositivos conectados.** Todos os navegadores e terminais conectados à sua conta, com seu endereço e quando fizeram login. Desconecte qualquer dispositivo que você não reconheça, ou todos de uma vez.

[Tokens de acesso](/docs/deployment/cloud-agents/#ci-and-agents) não são sessões e não solicitam um segundo fator, permitindo que a CI continue fazendo deploys após a ativação. Revogue um token que você não considere mais seguro em **Settings → Access tokens**.

## Convide sua equipe

**Members → Add member** adiciona alguém que já possui uma conta no Rebase com endereço de e-mail verificado, como admin ou member; um owner pode torná-lo owner posteriormente. O acesso é concedido imediatamente e nada é enviado por e-mail. O Rebase Cloud ainda não envia convites, portanto peça a um colega de equipe sem conta para se cadastrar e verificar o endereço primeiro. A partir de um terminal: [`rebase cloud orgs members invite <email>`](/docs/cli/cloud/#organizations), que avisará se o endereço não possuir conta.

## Veja quem fez o quê

A página **Activity** do console e o comando `rebase cloud activity` mostram aos owners e admins da organização quem fez deploy, definiu ou revelou uma variável de ambiente (por nome, nunca por valor), alterou um domínio, restaurou um backup, redimensionou, parou ou excluiu um projeto, alterou o papel de um membro ou criou um token, e quando. A seção **Settings** de um projeto inclui links para suas próprias entradas; entradas sobre um projeto excluído são mantidas. Um script pode ler isso usando um token criado com `--can audit` na organização. As entradas são mantidas por um ano. Os filtros estão em [`rebase cloud`](/docs/cli/cloud/#organizations).

## CI e agentes

Um job de CI ou um agente não deve carregar sua senha. Forneça a ele um token restrito a algumas ações em um único projeto, criado a partir de um terminal autenticado com `rebase cloud tokens create --project shop --can deploy,logs`, e defina-o como `REBASE_TOKEN`. As configurações de faturamento, log de atividades e notificações de uma organização são permissões próprias (`--can billing`, `audit`, `notifications`) que um token possui apenas quando explicitamente solicitado. As permissões, um fluxo de trabalho do GitHub Actions e o que permanece restrito a uma pessoa autenticada estão em [CI e agentes](/docs/deployment/cloud-agents/#ci-and-agents).

## Um backend sem conta

`rebase cloud init --claim` fornece a um aplicativo um backend ativo antes mesmo de qualquer pessoa ter se cadastrado, e exibe uma URL de reivindicação para que o usuário fique com ele; um projeto que ninguém reivindicar dentro de 72 horas é excluído. O que o token de um projeto não reivindicado pode fazer, o `REBASE_API_TOKEN` que ele grava e o que a reivindicação altera estão em [Um backend sem conta](/docs/deployment/cloud-agents/#a-backend-with-no-account).

## Computação, e quanto custa

O preço de um projeto é calculado a partir do que ele reserva, e não por um plano ou tier. O comando `compute` exibe cada parâmetro e a cotação detalhada do próprio control plane para eles. (`rebase cloud resources` é algo diferente: os bancos de dados e buckets declarados pelo código, e se cada um está provisionado — consulte a [Referência da CLI](/docs/cli/cloud/).)

```bash
rebase cloud compute
rebase cloud compute set --cpu 500m --memory 2Gi
```

| Parâmetro | Unidade, e o que significa |
|---|---|
| `--cpu`, `--memory` | Request da aplicação por instância, ex.: `500m` e `2Gi`. Vazio significa o padrão da plataforma — `100m` e `384Mi`, com burst de até 2 CPUs e `2Gi` |
| `--replicas` | Instâncias que sempre existem: o piso do autoscaler e o que a assinatura do projeto cobra mensalmente |
| `--autoscale-max` | 1–16. O teto que pode alcançar. Instâncias que o autoscaler adiciona acima de `--replicas` são medidas por pod-segundo nas mesmas taxas, e cobradas apenas onde a plataforma tiver ativado isso; **Usage this month** indica isso. `--no-autoscale` desativa |
| `--autoscale-cpu-target` | 10–95. A utilização de CPU que o autoscaler mantém, em relação ao request e não ao limite. Vazio significa 70 |
| `--spot` | `true` ou `false`. Capacidade preemptível: mais barata, e reiniciada sem aviso prévio |
| `--db-instances` | 1–3. `1` é uma instância única sem failover; `2` adiciona um standby automático |
| `--db-cpu`, `--db-memory` | Por instância de banco de dados. Vazio significa `160m` e `1Gi` |

Um parâmetro vazio não é o mesmo que um fixado no mesmo valor: um parâmetro vazio segue o padrão da plataforma e muda quando o padrão muda.

Nada é validado pela CLI, propositalmente — os limites pertencem ao cluster no qual o projeto é executado, e eles variam entre provedores. O control plane recusa um valor que não possa atender e informa o campo. Execute `rebase cloud compute` para ver o valor em €/mês antes e depois; uma alteração se aplica imediatamente, proporcional a partir de hoje, exceto uma que reinicie o banco de dados, que aguarda uma janela de manutenção.

## O restante da superfície

| Grupo de comandos | O que abrange |
|---|---|
| `login`, `logout`, `whoami`, `access-token` | Sua sessão; `access-token` exibe o bearer token que a CLI enviaria agora, para scripts e o servidor MCP |
| `tokens` | Tokens para CI e agentes, cada um limitado a um projeto. Consulte [CI e agentes](/docs/deployment/cloud-agents/#ci-and-agents) |
| `link`, `unlink`, `use`, `open` | Vincular este diretório a um projeto, selecionar uma organização, abrir o console |
| `connect` | Adicionar um servidor Rebase auto-hospedado à sua conta, para que o [Rebase connector](/docs/ai/rebase-connector/#add-your-self-hosted-instances) no Claude o alcance ao lado de seus projetos Cloud. `--list` os exibe, `--remove` remove um. Owners e admins |
| `init`, `claim` | Com `--claim`: um backend ativo sem conta e um link para reivindicá-lo; `claim` exibe esse link novamente. Consulte [Um backend sem conta](/docs/deployment/cloud-agents/#a-backend-with-no-account) |
| `projects` | Criar, listar, inspecionar, excluir |
| `deploy`, `logs`, `deployments`, `rollback`, `cancel` | Fazer deploy e monitorar |
| `deploy-hooks` | URLs secretas que um host git ou CI chama para fazer deploy do projeto: listar, criar (a URL é exibida uma única vez), revogar. |
| `previews` | Builds servidos em seu próprio endereço por `deploy --preview`, e sua exclusão. Consulte [Pré-visualizar uma alteração](#pré-visualizar-uma-alteração) |
| `start`, `stop`, `restart` | Pausar um projeto e reativá-lo. Um projeto pausado mantém sua assinatura, a menos que a plataforma fature projetos parados apenas pelo armazenamento e taxa da plataforma; a linha **Billing** no console indica quando for esse o caso |
| `status`, `metrics`, `debug` | O que está fazendo, e por que não está |
| `alerts` | Incidentes abertos do projeto, e confirmar ou adiar um deles. |
| `cron` | Os cron jobs da aplicação implantada e suas execuções registradas, lidos com o seu login no `rebase cloud`. Somente leitura |
| `env` | Variáveis de ambiente. `list` nunca exibe valores; `--secret` é somente gravação |
| `app-key` | A chave que `init --claim` gravou em `.env` como `REBASE_API_TOKEN`, repassada na reivindicação; `rotate` a substitui e revoga a antiga. Owners e admins |
| `service-key` | `REBASE_SERVICE_KEY`, admin na própria API do app: quando foi rotacionada pela última vez; `rotate` fornece uma nova ao app. Owners e admins |
| `domains` | Domínios personalizados, registros DNS a adicionar e verificação. Um projeto pode responder em vários, cada um verificado separadamente; `verify` e `remove` recebem o domínio sobre o qual agir, que só pode ser omitido quando houver apenas um (para `verify`, um ainda pendente). Cada domínio verificado serve o projeto diretamente; `primary <domain>` escolhe o canônico e `redirect <domain>` responde a outro com um 308 para ele, mantendo path e query (`--off` volta a servi-lo normalmente) — faça isso para `www.` ao lado de um apex, já que o login do Google, cookies e passkeys são por origem. Um domínio no qual um app é servido (um `path` de app com hostname) nunca redireciona. Um domínio apex (`example.com`, sem subdomínio) requer um registro **A**, pois o DNS não permite CNAME no apex. Esse endereço é o ingress da plataforma e não há garantia de que permanecerá o mesmo: se a plataforma mudar, um registro A continuará apontando para o endereço antigo. Onde seu provedor DNS oferecer ALIAS, ANAME ou CNAME flattening no apex, aponte o apex para o `tenantHost` do projeto, que acompanha a plataforma. O CNAME de um subdomínio já a acompanha automaticamente. `list` indica `verified, certificate pending` até que o HTTPS responda com um certificado real. `list --json` retorna `{ projectId, tenantHost, domains: [...] }` |
| `db` | Anexar ou criar um banco de dados, conectar-se a ele a partir da sua máquina, backups, restauração e point-in-time recovery |
| `guests` | Os usuários convidados deixados pelo login anônimo: conte-os, exclua um, limpe os que não são vistos há muito tempo. Consulte [Guests](/docs/cli/cloud/#guests). Owners e admins |
| `extensions` | A lista de permissões de extensões do Postgres |
| `storage` | O bucket do projeto |
| `resources` | Quais bancos de dados e buckets a plataforma mantém, em relação ao que o código declara |
| `compute` | O que este projeto reserva, quanto custa e como alterá-lo |
| `events` | O que aconteceu com o backend, do mais recente para o mais antigo: escalonamento do app, alterações de banco agendadas e aplicadas, um standby assumindo, o disco aumentando |
| `usage` | Requisições utilizadas este mês contra a cota incluída e o excedente até o momento, conforme contabilizado na fatura. `usage org` lista todos os projetos da organização |
| `clusters` | Os clusters nos quais os tenants rodam. Apenas para administradores da plataforma |
| `settings`, `orgs`, `billing` | Configurações do projeto, organizações e seus membros e convites, pagamento |
| `activity` | O log de auditoria da organização: quem fez deploy, alterou uma variável de ambiente (por nome), um domínio, um backup, um membro ou um token. Owners e admins. Consulte [Veja quem fez o quê](#veja-quem-fez-o-quê) |
| `notifications` | Para onde os eventos do projeto são enviados via POST: Slack, Discord ou qualquer URL https ([Cloud notifications](/docs/deployment/cloud-notifications/)) |

Cada grupo nessa tabela responde a `--help` com uma página própria — uma linha de uso, suas flags e exemplos — e `--help` nunca executa o comando. Um teste mantém o índice para as páginas, portanto um grupo adicionado sem uma página faz o build falhar em vez de responder com o índice. `verify:docs` vincula a própria tabela a esse índice: todo grupo que a CLI despacha aparece aqui exatamente uma vez, portanto um grupo adicionado sem uma linha também fará o build falhar.

Quando usado em pipe, `--help` responde em JSON: a mesma linha de uso, flags e exemplos estruturados para leitura em vez de sessenta linhas de sequências de escape de terminal.

## O que o beta não inclui

Explicado de forma clara, porque descobrir mais tarde é pior:

- **Sem escolha de região.** Tudo roda em uma única região atualmente. O modelo de posicionamento existe na plataforma, mas um projeto não pode escolher uma região. `projects create --provider` e `--region` não são a exceção que parecem ser: registram a qual dos alvos de deploy cadastrados no control plane um projeto pertence, e há apenas um, portanto ambos adotam esse padrão e nenhum deles move o projeto para outro lugar. `rebase cloud projects create --help` diz o mesmo.
- **Não é self-service.** O acesso é concedido em lotes; não há cadastro e pagamento imediato.
- **Sem SLA publicado** e sem SOC 2. Se você precisar de qualquer um deles, mencione ao solicitar acesso em vez de presumir.
- **Sem branch deploys** e sem GitHub App oficial. Deploy hooks — URLs secretas para as quais você aponta um webhook de repositório — são a automação suportada. [Deploys de preview](#pré-visualizar-uma-alteração) estão sendo implementados e são iniciados via CLI.
- **Tokens atuam como uma pessoa.** Um [token](/docs/deployment/cloud-agents/#ci-and-agents) é gerado por uma conta e atua em nome dela; ainda não há identidade de máquina pertencente à organização. Se você fizer login via CI, passe `REBASE_CLOUD_EMAIL` e `REBASE_CLOUD_PASSWORD` a partir de um cofre de segredos — `--password` coloca a senha no histórico do seu shell e na tabela de processos, avisando sobre isso antes de autenticar. Se o arquivo `.rebase/cloud.json` do repositório indicar um control plane diferente do da plataforma, passe-o também como `--url`: sem um terminal, o `login` recusa enviar uma senha para um host nomeado apenas pelo arquivo baixado no checkout.
- **Sem endpoint público de banco de dados.** Um banco de dados gerenciado não fica exposto à internet, portanto o host exibido no console é o endereço que seu backend usa para ele e não resolve para nada na sua máquina. O comando `rebase cloud db connect` abre uma porta local conectada a esse banco de dados, encapsulada via túnel pelo control plane, enquanto você mantiver o comando em execução — mas não existe um hostname permanente ao qual um serviço de terceiros possa se conectar. Para rodar SQL sem um cliente Postgres local, `rebase cloud db query "<sql>"` ou `rebase cloud db query --file file.sql` abre o mesmo túnel para uma consulta, executa o texto como um único script (interrompendo no primeiro erro) e exibe o que cada instrução respondeu (`--json` para scripts). Esse túnel e a senha por trás de `rebase cloud db info --reveal` exigem o papel de owner ou admin na organização: o mesmo exigido pelo editor SQL do Studio, pois todos os três resultam em uma sessão aberta sobre seus dados de produção.
- **Fazer deploy é executar código com os segredos de produção.** O ambiente do app armazena `REBASE_SERVICE_KEY` (administrador de sua própria API), `DATABASE_URL` e `JWT_SECRET`, de modo que o código que um membro implanta pode lê-los, embora apenas owners e admins possam revelá-los no console. Convide como membro apenas pessoas a quem você confiaria esses valores.
- **A chave de serviço pode ser substituída.** A seção **Settings** do projeto (ou `rebase cloud service-key rotate`) emite uma nova `REBASE_SERVICE_KEY` e reinicia o app utilizando-a. A chave antiga funciona até que o reinício seja concluído, e nada além disso; portanto, qualquer chamada que a tenha copiado será recusada a partir de então. Reivindicar um projeto faz o mesmo.

## Auto-hospedagem como alternativa

Nada aqui é um lock-in. O [guia de auto-hospedagem](/docs/deployment/self-hosting/) executa a mesma imagem e bundle com `docker compose`, e o [guia de Kubernetes](/docs/deployment/kubernetes/) reproduz a mesma topologia a partir do Helm chart.
