/**
 * Captura bruta de tráfego serial (hex + ascii).
 * Uso: npx tsx src/tools/capturar.ts
 *
 * Envia ENQ automaticamente quando o perfil é em modo comando.
 * Perfis simulados não abrem porta — geram frames sintéticos.
 */
import { createWriteStream } from "fs";
import { SerialPort } from "serialport";
import { carregarConfig, descrever, ConfigAgente } from "../config";
import { criarParser } from "../parsers/registry";
import { SimuladoParser } from "../parsers/simulado";

const INTERVALO_ENQ_MS = 500;
const INTERVALO_SIMULADO_MS = 400;

const arquivo = `captura-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.log`;
const log = createWriteStream(arquivo);

function formatar(buf: Buffer): string {
  if (buf.length === 0) return "(vazio)";
  const hex = buf.toString("hex").match(/.{2}/g)?.join(" ") ?? "";
  const ascii = buf.toString("latin1").replace(/[^\x20-\x7E]/g, ".");
  return `${hex}  |"${ascii}"`;
}

function registrar(msg: string) {
  console.log(msg);
  log.write(msg + "\n");
}

function capturarSimulado(parser: SimuladoParser): void {
  registrar("Perfil simulado: nenhuma porta serial será aberta.");
  registrar("Ctrl+C para encerrar.\n");

  const intervalo = setInterval(() => {
    const frame = parser.gerarFrame();
    if (!frame) {
      registrar(`[RX ${new Date().toISOString()}] (timeout simulado)`);
      return;
    }
    registrar(`[RX ${new Date().toISOString()}] ${formatar(frame)}`);
  }, INTERVALO_SIMULADO_MS);

  process.on("SIGINT", () => {
    clearInterval(intervalo);
    log.end(() => process.exit(0));
  });
}

function capturarSerial(config: ConfigAgente): void {
  const s = config.serial;

  const port = new SerialPort({
    path: config.porta,
    baudRate: s.baudRate,
    dataBits: s.dataBits,
    stopBits: s.stopBits,
    parity: s.parity,
    autoOpen: false,
  });

  port.on("data", (d: Buffer) => registrar(`[RX ${new Date().toISOString()}] ${formatar(d)}`));
  port.on("error", (err: Error) => registrar(`[ERRO] ${err.message}`));

  port.open((err) => {
    if (err) {
      registrar(`[ERRO] falha ao abrir ${config.porta}: ${err.message}`);
      log.end(() => process.exit(1));
      return;
    }

    registrar(`Capturando — ${descrever(config)}`);

    const intervalo =
      config.modo === "comando"
        ? setInterval(() => {
            if (!port.isOpen) return;
            port.write(Buffer.from([0x05]), (e) => {
              if (e) registrar(`[ERRO] escrita: ${e.message}`);
            });
          }, INTERVALO_ENQ_MS)
        : null;

    if (intervalo) registrar(`Modo comando: enviando ENQ a cada ${INTERVALO_ENQ_MS} ms`);
    registrar("Coloque peso na balança. Ctrl+C para encerrar.\n");

    process.on("SIGINT", () => {
      if (intervalo) clearInterval(intervalo);
      if (port.isOpen) port.close(() => log.end(() => process.exit(0)));
      else log.end(() => process.exit(0));
    });
  });
}

async function main() {
  const config = await carregarConfig();
  const parser = criarParser(config.perfilId);

  registrar(`Perfil : ${config.perfil.descricao}`);
  registrar(`Config : ${descrever(config)}`);
  registrar(`Parser : ${parser.nome}\n`);

  if (parser instanceof SimuladoParser) {
    capturarSimulado(parser);
    return;
  }

  capturarSerial(config);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  registrar(`[ERRO] ${msg}`);
  log.end(() => process.exit(1));
});