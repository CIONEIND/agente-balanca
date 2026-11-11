import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

const NOME_COOKIE = "agente_token";
const VALIDADE_MS = 8 * 60 * 60 * 1000; // 8 horas — uma jornada de trabalho

function tokensIguais(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Lê o cookie do header sem depender de cookie-parser. */
function lerCookie(req: Request, nome: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;

  for (const parte of header.split(";")) {
    const [chave, ...resto] = parte.trim().split("=");
    if (chave === nome) return decodeURIComponent(resto.join("="));
  }
  return null;
}

/**
 * Aceita o token por cookie HttpOnly (preferencial) ou pelo header
 * x-token-local (para curl e integrações que não usam navegador).
 */
export function exigirToken(tokenLocal: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const doCookie = lerCookie(req, NOME_COOKIE);
    const doHeader = req.header("x-token-local") ?? "";
    const enviado = doCookie ?? doHeader;

    if (!enviado || !tokensIguais(enviado, tokenLocal)) {
      res.status(401).json({ erro: "não autenticado" });
      return;
    }
    next();
  };
}

/** POST /auth/login — troca o token pelo cookie HttpOnly. */
export function rotaLogin(tokenLocal: string) {
  return (req: Request, res: Response) => {
    const enviado = (req.body?.token ?? "").toString().trim();

    if (!enviado || !tokensIguais(enviado, tokenLocal)) {
      res.status(401).json({ erro: "token inválido" });
      return;
    }

    res.cookie(NOME_COOKIE, tokenLocal, {
      httpOnly: true,   // inacessível a JavaScript
      sameSite: "strict",
      secure: false,    // true quando houver HTTPS
      maxAge: VALIDADE_MS,
      path: "/",
    });

    res.json({ ok: true, expiraEm: new Date(Date.now() + VALIDADE_MS).toISOString() });
  };
}

/** POST /auth/logout — apaga o cookie. */
export function rotaLogout() {
  return (_req: Request, res: Response) => {
    res.clearCookie(NOME_COOKIE, { path: "/" });
    res.json({ ok: true });
  };
}

/** GET /auth/sessao — informa se o cookie atual é válido. */
export function rotaSessao(tokenLocal: string) {
  return (req: Request, res: Response) => {
    const doCookie = lerCookie(req, NOME_COOKIE);
    const doHeader = req.header("x-token-local") ?? "";
    const enviado = doCookie ?? doHeader;

    const autenticado = !!enviado && tokensIguais(enviado, tokenLocal);
    res.json({ autenticado });
  };
}