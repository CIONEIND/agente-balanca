const ws = new WebSocket("ws://127.0.0.1:3333/weight");

ws.onopen = () => console.log("[aberto]");
ws.onclose = (e) => console.log(`[fechado] code=${e.code}`);
ws.onerror = () => console.log("[erro]");

ws.onmessage = (e) => {
  const { tipo, dados } = JSON.parse(e.data);
  if (tipo === "leitura") {
    console.log(`leitura: ${dados.peso} ${dados.unidade} estavel=${dados.estavel}`);
  } else {
    console.log(`snapshot: estado=${dados.estado} perfil=${dados.perfil}`);
  }
};