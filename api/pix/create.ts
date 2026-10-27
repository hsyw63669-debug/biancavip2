import type { VercelRequest, VercelResponse } from "@vercel/node";

// SmokePay — POST https://smokepay.com.br/api/pix/create  (header x-api-key)
const API_BASE = (process.env.SMOKEPAY_API_BASE || "https://smokepay.com.br/api").replace(/\/+$/, "");

const json = (res: VercelResponse, status: number, body: unknown) =>
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8").json(body);

function text(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

// Devolve o primeiro campo de texto preenchido entre os nomes informados.
function pick(obj: any, keys: string[], max = 10000): string {
  if (!obj || typeof obj !== "object") return "";
  for (const key of keys) {
    const value = text(obj[key], max);
    if (value) return value;
  }
  return "";
}

function readBody(req: VercelRequest): Record<string, any> {
  const body: unknown = req.body;
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return body && typeof body === "object" ? (body as Record<string, any>) : {};
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return json(res, 405, { error: "Método não permitido" });

  const apiKey = (process.env.SMOKEPAY_API_KEY || "").trim();
  if (!apiKey) {
    return json(res, 500, { error: "Configure SMOKEPAY_API_KEY nas variáveis de ambiente da Vercel." });
  }

  const body = readBody(req);

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 1 || amount > 100000) {
    return json(res, 400, { error: "Valor inválido. Informe um valor entre R$ 1,00 e R$ 100.000,00." });
  }
  const amountFixed = Number(amount.toFixed(2));
  const cents = Math.round(amountFixed * 100);

  // A SmokePay usa o external_id como chave de idempotência. Somamos o valor em centavos para que
  // uma nova tentativa com valor diferente (ex.: cliente adicionou um extra) gere uma cobrança nova,
  // enquanto repetir o mesmo valor continua devolvendo a mesma cobrança, sem duplicar.
  const baseId =
    text(body.idempotency_key, 48) || `bianca_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const external_id = `${baseId}_${cents}`;
  const description = text(body.description, 120) || "Acesso exclusivo - Bianca Souza";

  const payload: Record<string, unknown> = {
    amount: amountFixed,
    description,
    external_id,
    expiration: 1800,
  };

  // Webhook é opcional: o site confirma o pagamento consultando o status.
  const appBase = (process.env.APP_BASE_URL || "").trim().replace(/\/+$/, "");
  if (/^https:\/\//i.test(appBase)) payload.webhook_url = `${appBase}/api/webhooks/smokepay`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const upstream = await fetch(`${API_BASE}/pix/create`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "checkout-pix/1.0",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const raw = await upstream.text();
    let result: any = {};
    try {
      result = raw ? JSON.parse(raw) : {};
    } catch {
      result = {};
    }

    if (!upstream.ok || result?.success === false) {
      const message =
        (typeof result?.message === "string" && result.message) ||
        (typeof result?.error === "string" && result.error) ||
        (upstream.status === 401 || upstream.status === 403
          ? "Chave de API da SmokePay inválida ou sem permissão."
          : "A SmokePay recusou a cobrança Pix.");
      console.error("SmokePay error", { status: upstream.status, body: raw.slice(0, 500) });
      const status = upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502;
      return json(res, status, { error: message, details: result?.details || result?.errors || undefined });
    }

    const tx = result?.transaction ?? result?.data?.transaction ?? result?.data ?? result;
    const transactionId = pick(tx, ["id", "txid", "transaction_id"], 200);
    const pixCode = pick(tx, [
      "pix_copia_cola",
      "pix_copy_paste",
      "pix_code",
      "copia_e_cola",
      "brcode",
      "br_code",
      "emv",
      "qr_code_text",
      "qr_code",
    ]);
    let pixImage = pick(tx, ["qr_code_base64", "qrcode_base64", "qr_code_image", "pix_image", "qr_code_url"], 200000);
    if (pixImage && !pixImage.startsWith("data:") && !pixImage.startsWith("http")) {
      pixImage = `data:image/png;base64,${pixImage}`;
    }

    if (!pixCode) {
      console.error("Resposta inesperada da SmokePay", {
        status: upstream.status,
        keys: Object.keys(result || {}),
        txKeys: Object.keys(tx || {}),
        body: raw.slice(0, 500),
      });
      return json(res, 502, { error: "A SmokePay respondeu, mas não retornou o código Pix." });
    }

    return json(res, 200, {
      identifier: transactionId || external_id,
      pix_code: pixCode,
      pix_image: pixImage,
      payment: {
        id: transactionId || external_id,
        status: tx?.status || "pending",
        expires_at: tx?.expires_at || null,
      },
    });
  } catch (error: any) {
    console.error("Erro ao conectar à SmokePay", error);
    const timedOut = error?.name === "AbortError";
    return json(res, 502, {
      error: timedOut
        ? "A SmokePay demorou para responder. Tente novamente."
        : "Não foi possível conectar à SmokePay. Tente novamente em instantes.",
    });
  } finally {
    clearTimeout(timer);
  }
}
