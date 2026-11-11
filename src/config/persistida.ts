// src/config/persistida.ts
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { PERFIS } from "../balancas/perfis";

export interface ConfigPersistida {
  perfil: string;
  porta: string;
  /** Gerado na primeira execução; exigido em endpoints de escrita. */
  tokenLocal: string;
  atualizadoEm: string;
}

const ARQUIVO = path.resolve(process.cwd(), "config.json");

function validar(dados: unknown): ConfigPersistida {
  const d = dados as Partial<ConfigPersistida>;

  if (!d || typeof d !== "object") {
    throw new Error("config.json inválido: conteúdo não é um objeto");
  }
  if (!d.perfil || !PERFIS[d.perfil]) {
    throw new Error(
      `config.json: perfil "${d.perfil}" desconhecido. Disponíveis: ${Object.keys(PERFIS).join(", ")}`
    );
  }
  if (!d.porta || typeof d.porta !== "string") {
    throw new Error("config.json: campo 'porta' ausente ou inválido");
  }
  if (!d.tokenLocal || typeof d.tokenLocal !== "string") {
    throw new Error("config.json: campo 'tokenLocal' ausente");
  }

  return {
    perfil: d.perfil,
    porta: d.porta,
    tokenLocal: d.tokenLocal,
    atualizadoEm: d.atualizadoEm ?? new Date().toISOString(),
  };
}

export async function existe(): Promise<boolean> {
  try {
    await fs.access(ARQUIVO);
    return true;
  } catch {
    return false;
  }
}

export async function carregar(): Promise<ConfigPersistida> {
  const bruto = await fs.readFile(ARQUIVO, "utf-8");
  return validar(JSON.parse(bruto));
}

/**
 * Escrita atômica: grava em arquivo temporário e renomeia.
 * Evita config.json corrompido se o processo morrer no meio.
 */
export async function salvar(cfg: Omit<ConfigPersistida, "atualizadoEm">): Promise<ConfigPersistida> {
  const dados = validar({ ...cfg, atualizadoEm: new Date().toISOString() });
  const temporario = `${ARQUIVO}.tmp`;

  await fs.writeFile(temporario, JSON.stringify(dados, null, 2), "utf-8");
  await fs.rename(temporario, ARQUIVO);

  return dados;
}

/**
 * Semente inicial: cria config.json a partir do .env quando ele não existe.
 * Depois disso, config.json é a única fonte de verdade do perfil.
 */
export async function semearDoEnv(): Promise<ConfigPersistida> {
  const perfil = process.env.BALANCA_PERFIL;
  const porta = process.env.BALANCA_PORTA;

  if (!perfil || !porta) {
    throw new Error(
      "config.json não existe e o .env não define BALANCA_PERFIL/BALANCA_PORTA. " +
      "Crie o .env com esses dois valores para a primeira execução."
    );
  }

  return salvar({
    perfil,
    porta,
    tokenLocal: crypto.randomBytes(24).toString("hex"),
  });
}

/** Carrega config.json, semeando do .env se ainda não existir. */
export async function obterOuSemear(): Promise<ConfigPersistida> {
  return (await existe()) ? carregar() : semearDoEnv();
}