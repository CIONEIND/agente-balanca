import { Router } from "express";
import { GerenciadorBalanca } from "../estado/GerenciadorBalanca";
import { ConfigAgente } from "../config";
import { PERFIS } from "../balancas/perfis";
import { exigirToken, rotaLogin, rotaLogout, rotaSessao } from "./auth";
import { SerialPort } from "serialport";

export function criarRotas(gerenciador: GerenciadorBalanca, config: ConfigAgente): Router {
  const router = Router();
  const auth = exigirToken(config.tokenLocal);

  // --- autenticação ---
  router.post("/auth/login", rotaLogin(config.tokenLocal));
  router.post("/auth/logout", rotaLogout());
  router.get("/auth/sessao", rotaSessao(config.tokenLocal));

  // --- leitura ---
router.get("/status", (_req, res) => {
  const estado = gerenciador.estadoAtual;
  if (!estado) {
    res.status(503).json({ erro: "agente não inicializado" });
    return;
  }
  const s = estado.snapshot();
  res.json({
    estado: s.estado,
    muda: s.muda,
    perfil: s.perfil,
    descricaoPerfil: s.descricaoPerfil,
    porta: s.porta,
    ciclosFalha: s.ciclosFalha,
    tentativaReconexao: s.tentativaReconexao,   // <- novo
  });
});

  router.get("/weight", (_req, res) => {
    const estado = gerenciador.estadoAtual;
    if (!estado) {
      res.status(503).json({ erro: "agente não inicializado" });
      return;
    }
    const s = estado.snapshot();
    const valida = estado.leituraValida();

    res.json({
      peso: s.ultimaLeitura?.peso ?? null,
      unidade: s.ultimaLeitura?.unidade ?? null,
      casasDecimais: s.ultimaLeitura?.casasDecimais ?? null,
      estavel: s.ultimaLeitura?.estavel ?? false,
      origemEstabilidade: s.ultimaLeitura?.origemEstabilidade ?? null,
      sobrecarga: s.ultimaLeitura?.sobrecarga ?? false,
      recebidoEm: s.ultimaLeituraEm,
      validaParaPesagem: valida !== null,
      estado: s.estado,
      muda: s.muda,
    });
  });

  // --- configuração ---
  router.get("/perfis", (_req, res) => {
    res.json(
      Object.values(PERFIS).map((p) => ({
        id: p.id,
        descricao: p.descricao,
        casasDecimais: p.casasDecimais,
        unidade: p.unidade,
        serial: p.serial,
        origem: p.origem,
      }))
    );
  });

  router.get("/config", (_req, res) => {
    const cfg = gerenciador.configAtual;
    if (!cfg) {
      res.status(503).json({ erro: "agente não inicializado" });
      return;
    }
    res.json({
      perfil: cfg.perfilId,
      porta: cfg.porta,
      descricaoPerfil: cfg.perfil.descricao,
    });
  });

  router.post("/config", auth, async (req, res) => {
    const { perfil, porta } = req.body ?? {};

    if (!perfil || !PERFIS[perfil]) {
      res.status(400).json({ erro: `perfil inválido: ${perfil}` });
      return;
    }
    if (!porta || typeof porta !== "string") {
      res.status(400).json({ erro: "porta é obrigatória" });
      return;
    }

    const resultado = await gerenciador.trocarPerfil(perfil, porta);

    if (!resultado.ok) {
      // 409 = conflito de estado (peso na balança, leitura instável)
      res.status(409).json({ erro: resultado.motivo });
      return;
    }

    res.json({
      ok: true,
      mensagem: `Perfil ativo: ${resultado.config!.perfil.descricao} na porta ${resultado.config!.porta}`,
      perfil: resultado.config!.perfilId,
      porta: resultado.config!.porta,
    });
  });

 router.post("/config/testar", auth, async (req, res) => {
  const { perfil, porta } = req.body ?? {};

  if (!perfil || !PERFIS[perfil]) {
    res.status(400).json({ erro: `perfil inválido: ${perfil}` });
    return;
  }
  if (!porta || typeof porta !== "string") {
    res.status(400).json({ erro: "porta é obrigatória" });
    return;
  }

  try {
    const resultado = await gerenciador.testarPerfil(perfil, porta);
    res.json(resultado);
  } catch (err) {
    res.status(500).json({
      erro: err instanceof Error ? err.message : String(err),
    });
  }
});

router.get("/portas", async (_req, res) => {
  try {
    const portas = await SerialPort.list();

    const reais = portas
      .map((p) => p.path)
      .filter((p) => /^COM\d+$/i.test(p))
      .sort((a, b) => {
        const na = Number(a.replace(/\D/g, ""));
        const nb = Number(b.replace(/\D/g, ""));
        return na - nb;
      });

    res.json({
      portas: [...reais, "SIM"],
      origem: "sistema",
    });
  } catch {
    // fallback: lista fixa quando a enumeração falha
    res.json({
      portas: ["COM1", "COM2", "COM3", "COM4", "SIM"],
      origem: "fallback",
    });
  }
});
// POST /reconectar — força tentativa imediata
router.post("/reconectar", auth, async (_req, res) => {
  const r = await gerenciador.reconectarAgora();
  if (!r.ok) {
    res.status(409).json({ erro: r.motivo });
    return;
  }
  res.json({ ok: true, mensagem: "reconexão solicitada" });
});

  return router;
}