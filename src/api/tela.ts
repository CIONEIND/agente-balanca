import { Router } from "express";
import path from "path";

/**
 * Serve a tela de configuração estática.
 * O HTML fica em src/api/public/configuracao.html e é servido em GET /.
 */
export function criarRotaTela(): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.sendFile(path.resolve(__dirname, "public", "configuracao.html"));
  });

  return router;
}