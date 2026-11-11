// src/parsers/registry.ts
import { IParserBalanca } from "./types";
import { FrameAsciiParser } from "./ascii-stx";
import { UranoParser } from "./urano";
import { SimuladoParser } from "./simulado";
import { PERFIS } from "../balancas/perfis";

export function criarParser(perfilId: string): IParserBalanca {
  const p = PERFIS[perfilId];
  if (!p) {
    throw new Error(`Perfil desconhecido: "${perfilId}". Disponíveis: ${Object.keys(PERFIS).join(", ")}`);
  }

  if (p.implementacao === "simulado") {
    return new SimuladoParser({ casasDecimais: p.casasDecimais, unidade: p.unidade });
  }
  if (p.implementacao === "urano-longo") return new UranoParser();

  return new FrameAsciiParser({
    nome: p.descricao,
    casasDecimais: p.casasDecimais,
    unidade: p.unidade,
  });
}