// src/parsers/urano.ts
import { IParserBalanca, LeituraBalanca } from "./types";

/**
 * Port fiel do script VB do TopManager (em produção há anos).
 *
 *   lPeso = Replace(lPeso, Chr(&H2), "")
 *   lPeso = Replace(lPeso, "kg","") ... "J","?","N","G","L","P","M",":"
 *   lPeso = Trim(Mid(lPeso, 46, 12))
 *   lPeso = lPeso / 10
 *
 * A ordem importa: os Replace REMOVEM caracteres, então a posição 46
 * é válida na string JÁ sanitizada, não no frame cru.
 *
 * ⚠️ Terminador e tamanho do frame ainda não capturados.
 * Se o frame não terminar em ETX, o polling vai dar timeout.
 */
const REMOCOES = ["kg", "J", "?", "N", "G", "L", "g", "P", "M", ":"];
const POS_VB = 46;      // 1-based, sobre string sanitizada
const TAM_CAMPO = 12;
const FATOR = 10;

export class UranoParser implements IParserBalanca {
  readonly nome = "Urano (frame longo, port do VB)";
  readonly casasDecimais = 1;
  readonly unidade: "kg" | "g" = "kg";

  parse(frame: Buffer): LeituraBalanca | null {
    let texto = frame.toString("latin1");

    texto = texto.split("\x02").join("").split("\x03").join("");
    for (const rem of REMOCOES) texto = texto.split(rem).join("");
    texto = texto.replace(/,/g, ".").trim();

    const inicio = POS_VB - 1;
    const campo = texto.substring(inicio, inicio + TAM_CAMPO);

    const digitos = campo.replace(/[^0-9]/g, "");
    if (!digitos) return null;

    const negativo = campo.includes("-");
    const valor = Number(digitos) / FATOR;

    return {
      peso: negativo ? -valor : valor,
      unidade: this.unidade,
      casasDecimais: this.casasDecimais,
      estavel: false,
      origemEstabilidade: "software",
      bruto: null,
      tara: null,
      negativo,
      sobrecarga: false,
      erro: null,
      raw: frame.toString("hex"),
      recebidoEm: new Date(),
    };
  }

  comandoLeitura(): Buffer {
    return Buffer.from([0x05]);
  }
}