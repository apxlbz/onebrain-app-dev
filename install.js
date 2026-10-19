/* /install — one public page, every MCP client, no secrets. Every snippet
 * carries only the HTTP address; OAuth 2.1 (dynamic client registration +
 * PKCE) is what actually signs a client in on first connect, so nothing
 * here needs a token. */
import { SUPA_ORIGIN } from "./env.js?v=1";

const MCP_URL = `${SUPA_ORIGIN}/functions/v1/mcp`;

document.querySelectorAll("[data-mcp-url]").forEach((el) => { el.textContent = MCP_URL; });

const $ = (id) => document.getElementById(id);

$("s-code").textContent = `claude mcp add --scope user --transport http onebrain ${MCP_URL}`;
$("s-claude").textContent = MCP_URL;
$("s-cursor").textContent = JSON.stringify(
  { mcpServers: { onebrain: { url: MCP_URL } } }, null, 2);
$("s-vscode").textContent = JSON.stringify(
  { servers: { onebrain: { type: "http", url: MCP_URL } } }, null, 2);
$("s-windsurf").textContent = JSON.stringify(
  { mcpServers: { onebrain: { serverUrl: MCP_URL } } }, null, 2);
$("s-codex").textContent = `[mcp_servers.onebrain]\nurl = "${MCP_URL}"`;
$("s-zed").textContent = JSON.stringify(
  { context_servers: { onebrain: { source: "custom", url: MCP_URL } } }, null, 2);
$("s-gemini").textContent = `gemini mcp add --transport http onebrain ${MCP_URL}`;
$("s-other").textContent = MCP_URL;

$("link-cursor").href = "cursor://anysphere.cursor-deeplink/mcp/install?name=onebrain&config="
  + btoa(JSON.stringify({ url: MCP_URL }));
$("link-vscode").href = "vscode:mcp/install?" + encodeURIComponent(JSON.stringify(
  { name: "onebrain", type: "http", url: MCP_URL }));

document.querySelectorAll("[data-copy]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const text = $(btn.dataset.copy).textContent;
    try {
      await navigator.clipboard.writeText(text);
      const prior = btn.textContent;
      btn.textContent = "Copied";
      setTimeout(() => { btn.textContent = prior; }, 1500);
    } catch {
      btn.textContent = "Select & copy";
    }
  });
});
