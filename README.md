# Michelle Oficial — deploy na Vercel

Projeto em Vite/TanStack Start. Para executar localmente, use `npm install` e `npm run dev`.

## Integração SmokePay

O backend cria cobranças Pix em `POST https://smokepay.com.br/api/pix/create`, autenticando com o header `x-api-key`. O status é consultado em `GET https://smokepay.com.br/api/pix/{id}`. O código Pix copia-e-cola e o QR Code são lidos da resposta da transação.

Configure em **Vercel → Project → Settings → Environment Variables** (e faça um **Redeploy** depois):

- `SMOKEPAY_API_KEY` (obrigatória): chave de API do painel da SmokePay.
- `SMOKEPAY_WEBHOOK_SECRET` (opcional): segredo de webhook, se configurado no painel.
- `APP_BASE_URL` (opcional): URL HTTPS pública do projeto, por exemplo `https://seu-projeto.vercel.app`. Se definida, a cobrança envia `webhook_url` apontando para `/api/webhooks/smokepay`.
- `SMOKEPAY_API_BASE` (opcional): só altere se a SmokePay informar outra URL base. O padrão é `https://smokepay.com.br/api`.

Cadastre credenciais reais diretamente na Vercel. Não as coloque no GitHub, no frontend ou em variáveis com prefixo `VITE_`. Pode apagar as variáveis antigas (`OMEGAPAY_*`, `ATENASPAY_*`) depois de confirmar que o deploy novo funciona.

O checkout Pix não pede nome, e-mail, CPF ou telefone. O `external_id` enviado à SmokePay é a chave de idempotência da tentativa somada ao valor em centavos: repetir o mesmo pedido não duplica a cobrança, e mudar o valor (por exemplo, ao adicionar um extra) gera uma cobrança nova com o valor correto. O site consulta o status periodicamente e só libera o acesso quando o status retorna `paid`. Valide com uma cobrança de baixo valor antes de liberar vendas reais.
