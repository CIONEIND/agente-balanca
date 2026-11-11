/**
 * FASE 0 — Diagnóstico v2 (passivo + sob demanda)
 * Uso: npx tsx src/tools/diagnostico.ts COM2
 *
 * COLOQUE PESO NA BALANÇA antes de rodar.
 */
import { SerialPort } from "serialport";
import { createWriteStream } from "fs";

const PORTA = process.argv[2] ?? "COM2";
const ESCUTA_PASSIVA_MS = 2000;
const ESPERA_RESPOSTA_MS = 1500;
const INTERVALO_ENTRE_COMANDOS_MS = 300;

const arquivo = `diagnostico2-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.log`;
const logStream = createWriteStream(arquivo);

function log(msg: string) {
  console.log(msg);
  logStream.write(msg + "\n");
}

function hex(b: Buffer): string {
  if (b.length === 0) return "(vazio)";
  const h = b.toString("hex").match(/.{2}/g)?.join(" ") ?? "";
  const ascii = b.toString("latin1").replace(/[^\x20-\x7E]/g, ".");
  return `${h}  |"${ascii}"`;
}

interface Candidato {
  baudRate: number;
  dataBits: 7 | 8;
  parity: "none" | "even" | "odd";
  stopBits: 1 | 2;
  label: string;
}

// A configuração do software de teste vem primeiro — já está validada
const CANDIDATOS: Candidato[] = [
  { baudRate: 56000, dataBits: 7, parity: "none",    stopBits: 2, label: "56000 7N2  (software de teste)" },
  { baudRate: 56000, dataBits: 7, parity: "none",    stopBits: 1, label: "56000 7N1" },
  { baudRate: 56000, dataBits: 8, parity: "none",    stopBits: 1, label: "56000 8N1" },
  { baudRate: 56000, dataBits: 8, parity: "even",    stopBits: 1, label: "56000 8E1" },
  { baudRate: 9600,  dataBits: 8, parity: "none",    stopBits: 1, label: "9600 8N1" },
  { baudRate: 9600,  dataBits: 8, parity: "none",    stopBits: 2, label: "9600 8N2" },
  { baudRate: 4800,  dataBits: 8, parity: "none",    stopBits: 1, label: "4800 8N1" },
  { baudRate: 4800,  dataBits: 7, parity: "even",    stopBits: 1, label: "4800 7E1" },
];

const COMANDOS = [
  { nome: "ENQ (0x05)",        bytes: Buffer.from([0x05]) },
  { nome: "ENQ + CR",          bytes: Buffer.from([0x05, 0x0d]) },
  { nome: "STX ENQ ETX",       bytes: Buffer.from([0x02, 0x05, 0x03]) },
  { nome: "P + CR",            bytes: Buffer.from("P\r", "ascii") },
  { nome: "CR (0x0D)",         bytes: Buffer.from([0x0d]) },
];

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

function abrir(c: Candidato): Promise<SerialPort> {
  return new Promise((resolve, reject) => {
    const p = new SerialPort({
      path: PORTA,
      baudRate: c.baudRate,
      dataBits: c.dataBits,
      parity: c.parity,
      stopBits: c.stopBits,
      autoOpen: false,
    });
    p.open((err) => (err ? reject(err) : resolve(p)));
  });
}

function fechar(p: SerialPort): Promise<void> {
  return new Promise((resolve) => {
    if (!p.isOpen) return resolve();
    p.close(() => resolve());
  });
}

function coletar(p: SerialPort, ms: number): Promise<Buffer> {
  return new Promise((resolve) => {
    const partes: Buffer[] = [];
    const onData = (d: Buffer) => partes.push(d);
    p.on("data", onData);
    setTimeout(() => {
      p.off("data", onData);
      resolve(Buffer.concat(partes));
    }, ms);
  });
}

interface Achado {
  candidato: Candidato;
  modo: "continuo" | "sob demanda";
  comando?: string;
  amostra: Buffer;
}

async function testar(c: Candidato): Promise<Achado | null> {
  let p: SerialPort;
  try {
    p = await abrir(c);
  } catch (e: any) {
    log(`[${c.label}] FALHA ao abrir porta: ${e?.message ?? e}`);
    return null;
  }

  // 1) Escuta passiva — funciona se a balança estiver em modo contínuo
  const passivo = await coletar(p, ESCUTA_PASSIVA_MS);
  if (passivo.length > 0) {
    log(`[${c.label}] PASSIVO: ${passivo.length} bytes -> ${hex(passivo)}`);
    await fechar(p);
    return { candidato: c, modo: "continuo", amostra: passivo };
  }
  log(`[${c.label}] passivo: 0 bytes (balança não transmite sozinha)`);

  // 2) Escuta ativa — pergunta e espera resposta
  for (const cmd of COMANDOS) {
    const resp = await new Promise<Buffer>((resolve) => {
      const partes: Buffer[] = [];
      const onData = (d: Buffer) => partes.push(d);
      p.on("data", onData);
      p.write(cmd.bytes, (err) => {
        if (err) log(`[${c.label}] erro ao enviar "${cmd.nome}": ${err.message}`);
      });
      setTimeout(() => {
        p.off("data", onData);
        resolve(Buffer.concat(partes));
      }, ESPERA_RESPOSTA_MS);
    });

    if (resp.length > 0) {
      log(`[${c.label}] ATIVO "${cmd.nome}": enviado ${hex(cmd.bytes)} -> recebido ${hex(resp)}`);
      await fechar(p);
      return { candidato: c, modo: "sob demanda", comando: cmd.nome, amostra: resp };
    }
    log(`[${c.label}] ativo "${cmd.nome}": 0 bytes`);
    await espera(INTERVALO_ENTRE_COMANDOS_MS);
  }

  await fechar(p);
  return null;
}

async function main() {
  log(`Data: ${new Date().toISOString()}`);
  log(`Node: ${process.version} | SO: ${process.platform} ${process.arch}`);
  log(`Porta: ${PORTA}`);
  log("");

  try {
    const lista = await SerialPort.list();
    log(`Portas no sistema: ${lista.map((p) => p.path).join(", ") || "nenhuma"}`);
  } catch (e: any) {
    log(`FALHA ao listar portas: ${e?.message}`);
  }
  log("");

  for (const c of CANDIDATOS) {
    log(`=== ${c.label} ===`);
    const achado = await testar(c);
    if (achado) {
      log("");
      log("################ RESULTADO ################");
      log(`Configuração : ${achado.candidato.label}`);
      log(`Baud rate    : ${achado.candidato.baudRate}`);
      log(`Enquadramento: ${achado.candidato.dataBits}${achado.candidato.parity === "none" ? "N" : achado.candidato.parity === "even" ? "E" : "O"}${achado.candidato.stopBits}`);
      log(`Modo         : ${achado.modo}`);
      if (achado.comando) log(`Comando      : ${achado.comando}`);
      log(`Amostra      : ${hex(achado.amostra)}`);
      log(`Amostra HEX  : ${achado.amostra.toString("hex")}`);
      log("##########################################");
      log("");
      log("Encontrado. Me envie este arquivo.");
      return;
    }
    log("");
  }

  log("Nenhuma configuração respondeu.");
  log("Se o software de teste funciona, capture os bytes que ele envia com um monitor de porta serial.");
}

main().catch((e) => log(`Erro fatal: ${e?.message ?? e}`));