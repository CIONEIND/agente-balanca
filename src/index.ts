import { descrever } from "./config";
import { GerenciadorBalanca } from "./estado/GerenciadorBalanca";
import { iniciarServidor } from "./api/servidor";

async function main() {
  const gerenciador = new GerenciadorBalanca();
  const { conn, config } = await gerenciador.iniciar();

  console.log(`Perfil : ${config.perfil.descricao}`);
  console.log(`Config : ${descrever(config)}`);

  conn.on("erro", (err) => console.error(`[erro] ${err.message}`));
  conn.on("reconectado", (n) => console.log(`[reconexao] ok na tentativa ${n}`));
  conn.on("desistiu", () => console.log("[reconexao] interrompida"));

  conn.on("leitura", (l) => {
    const rotulo = l.estavel ? "ESTAVEL " : "instavel";
    console.log(
      `[${l.recebidoEm.toLocaleTimeString("pt-BR")}] ${rotulo} ` +
        `${l.peso.toFixed(l.casasDecimais).padStart(10)} ${l.unidade}`
    );
  });

  gerenciador.on("trocando", (d) => console.log(`[troca] aplicando ${d.perfil} em ${d.porta}`));
  gerenciador.on("trocado", () => {
    const c = gerenciador.conexao;
    if (!c) return;
    c.on("leitura", (l) => {
      const rotulo = l.estavel ? "ESTAVEL " : "instavel";
      console.log(
        `[${l.recebidoEm.toLocaleTimeString("pt-BR")}] ${rotulo} ` +
          `${l.peso.toFixed(l.casasDecimais).padStart(10)} ${l.unidade}`
      );
    });
  c.on("erro", (err) => console.error(`[erro] ${err.message}`));
});
  gerenciador.on("erro-troca", (m) => console.error(`[troca] falhou: ${m}`));

  const api = await iniciarServidor(gerenciador, config);
  console.log(`\nAPI em http://127.0.0.1:${api.porta}`);
  console.log(`Tela em http://127.0.0.1:${api.porta}/`);
  console.log(`Docs em http://127.0.0.1:${api.porta}/docs\n`);

  const encerrar = async () => {
    console.log("\nEncerrando...");
    await api.fechar();
    const c = gerenciador.conexao;
    if (c) await c.desconectar();
    process.exit(0);
  };

  process.on("SIGINT", encerrar);
  process.on("SIGTERM", encerrar);
}

main().catch((err) => {
  console.error("Falha ao iniciar:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});