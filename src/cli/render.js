const SYMBOLS = { ok: '✔', warn: '!', dot: '·', arrow: '→' };

export function line(message = '') {
  process.stdout.write(`${message}\n`);
}

export function heading(message) {
  line(`\n${message}`);
}

export function info(message) {
  line(`  ${SYMBOLS.dot} ${message}`);
}

export function success(message) {
  line(`  ${SYMBOLS.ok} ${message}`);
}

export function warn(message) {
  line(`  ${SYMBOLS.warn} ${message}`);
}

export function arrow() {
  return SYMBOLS.arrow;
}

export function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/** Renders a simple aligned table. */
export function table(rows, headers) {
  if (rows.length === 0) return;
  const widths = headers.map((header, column) => Math.max(
    header.length,
    ...rows.map((row) => String(row[column] ?? '').length),
  ));
  const render = (cells) => cells.map((cell, index) => String(cell ?? '').padEnd(widths[index])).join('  ').trimEnd();

  line(`  ${render(headers)}`);
  line(`  ${widths.map((width) => '─'.repeat(width)).join('  ')}`);
  for (const row of rows) line(`  ${render(row)}`);
}
