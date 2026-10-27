import type { VercelRequest, VercelResponse } from "@vercel/node";

// SmokePay — GET https://smokepay.com.br/api/pix/{id}  (header x-api-key)
const API_BASE = (process.env.SMOKEPAY_API_BASE || "https://smokepay.com.br/api").replace(/\/+$/, "");

const json = (res: VercelResponse, status: number, body: unknown) =>
  res
    .status(status)
    .setHeader("Content-Type", "application/json; charset=utf-8")
    .setHeader("Cache-Control", "no-store")
    .json(body);

const PAID = ["paid", "completed", "confirmed", "approved", "success", "succeeded", "settled", "concluded", "pago"];
const FAILED = ["expired", "cancelled", "canceled", "failed", "refunded", "rejected", "denied", "expirado", "cancelado"];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return json(res, 405, { error: "Método não permitido" });

  const apiKey = (process.env.SMOKEPAY_API_KEY || "").trim();
  const raw = req.query.identifier;
  const id = String(Array.isArray(raw) ? raw[0] : raw || "").trim();

  if (!apiKey) return json(res, 500, { error: "Configure SMOKEPAY_API_KEY na Vercel." });
  if (!id || id.length > 200) return json(res, 400, { error: "Identificador inválido." });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const upstream = await fetch(`${API_BASE}/pix/${encodeURIComponent(id)}`, {
      headers: {
        "x-api-key": apiKey,
        Accept: "application/json",
        "User-Agent": "checkout-pix/1.0",
      },
      signal: controller.signal,
    });

    const body = await upstream.text();
    let result: any = {};
    try {
      result = body ? JSON.parse(body) : {};
    } catch {
      result = {};
    }

    if (!upstream.ok) {
      const message =
        (typeof result?.message === "string" && result.message) ||
        (typeof result?.error === "string" && result.error) ||
        "Não foi possível consultar o Pix na SmokePay.";
      return json(res, upstream.status, { error: message });
    }

    const tx = result?.transaction ?? result?.data?.transaction ?? result?.data ?? result;
    const rawStatus = String(tx?.status ?? result?.status ?? "pending").toLowerCase();
    const failed = FAILED.includes(rawStatus);
    const paid = !failed && (PAID.includes(rawStatus) || Boolean(tx?.paid_at));

    return json(res, 200, {
      payment: {
        id: tx?.id || tx?.txid || id,
        amount: tx?.amount,
        status: paid ? "paid" : failed ? "failed" : "pending",
        paid,
        failed,
      },
    });
  } catch (error: any) {
    console.error("Erro ao consultar SmokePay", error);
    return json(res, 502, { error: "Não foi possível consultar o status na SmokePay." });
  } finally {
    clearTimeout(timer);
  }
}
