// src/config.ts
import dotenv from "dotenv";
import { PERFIS, PerfilBalanca, SerialConfig } from "./balancas/perfis";
import { ConfigPersistida, obterOuSemear } from "./config/persistida";

dotenv.config();

export interface ConfigAgente {
  porta: string;
  perfilId: string;
  perfil: PerfilBalanca;
  serial: SerialConfig;
  modo: "comando" | "continuo";
  terminador: "etx" | "silencio";
  tokenLocal: string;
}

export async function carregarConfig(): Promise<ConfigAgente> {
  const persistida: ConfigPersistida = await obterOuSemear();
  const perfil = PERFIS[persistida.perfil];

  if (!perfil) {
    throw new Error(
      `Perfil "${persistida.perfil}" inválido. Disponíveis: ${Object.keys(PERFIS).join(", ")}`
    );
  }

  return {
    porta: persistida.porta,
    perfilId: persistida.perfil,
    perfil,
    serial: perfil.serial,
    modo: perfil.comando ? "comando" : "continuo",
    terminador: perfil.terminador,
    tokenLocal: persistida.tokenLocal,
  };
}

export function descrever(cfg: ConfigAgente): string {
  const s = cfg.serial;
  const paridade = s.parity === "none" ? "N" : s.parity === "even" ? "E" : "O";
  return (
    `${cfg.porta} | ${cfg.perfil.descricao} | ` +
    `${s.baudRate} ${s.dataBits}${paridade}${s.stopBits} | ` +
    `casas=${cfg.perfil.casasDecimais} unidade=${cfg.perfil.unidade} | ` +
    `terminador=${cfg.terminador} | origem=${cfg.perfil.origem}`
  );
}