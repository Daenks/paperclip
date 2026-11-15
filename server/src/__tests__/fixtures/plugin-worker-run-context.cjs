const readline = require("node:readline");

// Behavior comes from the worker config: answer, slow, or throw.
let mode = "answer";
const requests = [];

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on("line", (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  const method = message && typeof message.method === "string" ? message.method : null;

  if (method === "initialize") {
    mode = message.params?.config?.mode ?? "answer";
    send({ jsonrpc: "2.0", id: message.id, result: { ok: true, supportedMethods: ["contributeRunContext", "health"] } });
    return;
  }
  if (method === "contributeRunContext") {
    requests.push(message.params);
    if (mode === "throw") {
      send({ jsonrpc: "2.0", id: message.id, error: { code: -32002, message: "policy store unavailable: SECRET_DETAIL" } });
      return;
    }
    const answer = () => send({ jsonrpc: "2.0", id: message.id,
      result: { sections: [{ title: "Company policies", markdown: `Policy for ${message.params.companyId}.` }] } });
    if (mode === "slow") setTimeout(answer, 10_000);
    else answer();
    return;
  }
  if (method === "health") {
    send({ jsonrpc: "2.0", id: message.id, result: { status: "ok", details: { requests } } });
    return;
  }
  if (method === "shutdown") {
    send({ jsonrpc: "2.0", id: message.id, result: {} });
    setImmediate(() => process.exit(0));
    return;
  }
  send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Unhandled method: ${method}` } });
});
