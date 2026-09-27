/**
 * Colored ASCII-art startup banner printed to the console.
 */

const GREEN = '\x1b[38;2;63;122;89m';     // 瓦松绿
const MINT = '\x1b[38;2;88;176;136m';     // 薄荷绿（桥接）
const CYAN = '\x1b[38;2;124;197;201m';    // 天青
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const LOGO_LINES = [
  ' ███████╗██╗  ██╗ █████╗ ██████╗  ██████╗ ██╗    ██╗',
  ' ██╔════╝██║  ██║██╔══██╗██╔══██╗██╔═══██╗██║    ██║',
  ' ███████╗███████║███████║██║  ██║██║   ██║██║ █╗ ██║',
  ' ╚════██║██╔══██║██╔══██║██║  ██║██║   ██║██║███╗██║',
  ' ███████║██║  ██║██║  ██║██████╔╝╚██████╔╝╚███╔███╔╝',
  ' ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝  ╚═════╝  ╚══╝╚══╝ ',
];

const LOGO_COLORS = [GREEN, GREEN, MINT, MINT, CYAN, CYAN];

/**
 * Print the ShadowVeil banner with endpoint and config info.
 * @param {{port: number, env: string, dbPath: string, version: string}} info
 */
export function printBanner(info) {
  const lines = [];
  LOGO_LINES.forEach((line, i) => lines.push(`${LOGO_COLORS[i]}${line}${RESET}`));
  lines.push('');
  lines.push(`${DIM}        ShadowVeil v${info.version} — online code obfuscation${RESET}`);
  lines.push('');
  lines.push(`  ${GREEN}➜${RESET}  Local:     ${CYAN}http://localhost:${info.port}${RESET}`);
  lines.push(`  ${GREEN}➜${RESET}  API:       ${CYAN}http://localhost:${info.port}/api/v1${RESET}`);
  lines.push(`  ${GREEN}➜${RESET}  Health:    ${CYAN}/api/v1/health${RESET}`);
  lines.push(`  ${DIM}  mode: ${info.env}  ·  db: ${info.dbPath}${RESET}`);
  lines.push('');
  console.log(lines.join('\n'));
}
