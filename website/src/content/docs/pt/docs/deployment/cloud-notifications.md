---
sourceHash: 958615612ce5d124
title: Notificações do Cloud
sidebar_label: Notificações
description: Como o Rebase Cloud avisa as pessoas quando um deploy falha, os backups param, um pagamento é recusado ou o uso passa de 80% — webhooks assinados para o Slack, o Discord ou qualquer URL, e e-mail por pessoa.
---

A plataforma avisa as pessoas quando um deploy falha, um banco de dados para de fazer
backup, um pagamento é recusado, ou um projeto passa de 80% e depois de 100% da sua
franquia do mês.
Ela faz parte do [Rebase Cloud](/docs/deployment/cloud/), e todo comando aqui descrito
está na [referência de cloud da CLI](/docs/cli/cloud/).

## Webhooks

<span class="since-badge" data-since="0.26">A partir da versão 0.26</span>

Um projeto pode enviar esses eventos para um webhook de entrada do Slack ou do Discord,
ou para qualquer URL https, em **Settings → Notifications** no console ou com a CLI:

```bash
rebase cloud notifications add https://hooks.slack.com/services/T000/B000/XXXX
rebase cloud notifications add https://ops.example.com/rebase --events deploy.failed,backup.unhealthy
rebase cloud notifications test <id>
rebase cloud notifications            # each destination, and how its last delivery went
rebase cloud notifications remove <id>
```

Os eventos são `deploy.failed` (o padrão), `deploy.succeeded`, `deploy.rolled_back`,
`backup.unhealthy`, `billing.payment_failed`, `usage.threshold` e `preview.paused` (um
preview de backend cujo banco de dados cresceu além do limite de preview foi parado).
Cada POST é um JSON com um `type`, o `project`, os fatos do evento, uma `url` do console e
um `text` de uma linha. O Slack exibe o `text` como a mensagem, então a URL de um webhook
de entrada do Slack funciona sem nenhuma configuração. Para o Discord, acrescente `/slack`
ao final da URL do webhook dele. `--format slack` envia apenas `{ "text" }`, para um
receptor que rejeita campos que não conhece. Um log de build nunca vai para um webhook.

Todo POST é assinado: `X-Webhook-Signature: sha256=<hex HMAC-SHA256 of the raw
body>`, com o segredo mostrado uma única vez, quando o destino é adicionado. Ele também
carrega `X-Webhook-Event` e um id `X-Webhook-Delivery` que permanece o mesmo ao longo das
novas tentativas de uma mesma entrega. Uma entrega é tentada três vezes, com 1 e 5
segundos de intervalo, 5 segundos cada. Um 4xx diferente de 429, um redirecionamento ou
um endereço recusado não é tentado de novo. A URL precisa ser https. O plano de controle
recusa uma que resolva para um endereço privado, de loopback, link-local ou de metadados
de nuvem, tanto quando ela é adicionada quanto no endereço ao qual cada entrega se
conecta. Qualquer membro da organização pode listar os destinos de um projeto, com as
URLs mascaradas. Adicionar, testar e remover um exige o papel de owner ou admin.

## E-mail

Cada membro escolhe quais e-mails recebe, por organização, em **Account → Notifications**
no console. As falhas vêm ativadas por padrão: um deploy que falhou vai para quem o
iniciou e para os owners e admins. Um deploy bem-sucedido vem desativado por padrão, e,
quando ativado, vai apenas para quem o iniciou. Um pagamento recusado vai para os owners e
para o e-mail de cobrança, uma vez por fatura. Um backup com problema vai para os owners e
admins no máximo uma vez por dia por banco de dados. Cada marca de uso é enviada uma vez
por mês por projeto. Um plano de controle sem envio de e-mail configurado não envia
e-mail algum, e essa página diz isso. Os webhooks funcionam de qualquer forma.

Cada evento chega a cada pessoa ou destino uma vez, por mais vezes que seja reportado.
Um deploy cancelado por uma pessoa e uma atualização da plataforma que foi bem-sucedida
não são reportados.

`rebase cloud webhooks` foi aposentado. Ele nunca entregou nada, e agora toda ação
encerra com o código 1 e `command_retired`. Para receber um POST quando linhas mudam nas
tabelas do seu próprio app, use um `WebhookDispatcher` no código do seu app (veja
[a receita de webhook](/docs/recipes/webhooks/)).
