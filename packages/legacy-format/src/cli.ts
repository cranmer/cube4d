#!/usr/bin/env node
/**
 * mc4d-convert — translate between MagicCube4D `.log` files and this project's JSON save format.
 *
 * The same codec the app uses for drag-and-drop import, exposed as a command so existing solve
 * archives can be converted in bulk without opening a browser.
 *
 *   mc4d-convert solve.log              → solve.json
 *   mc4d-convert solve.json             → solve.log
 *   mc4d-convert solve.log -o out.json
 *   mc4d-convert --inspect solve.log    describe the file without converting
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

import { formatLog, LogFormatError, parseLog } from './log.js';
import { logToSave, saveToLog, type SaveDoc } from './save.js';

function usage(): never {
  process.stderr.write(
    [
      'usage: mc4d-convert [--inspect] [-o OUTPUT] INPUT',
      '',
      '  Converts a MagicCube4D .log file to JSON, or JSON back to .log.',
      '  The direction is chosen from the input file extension.',
      '',
      '  --inspect   describe the file instead of converting it',
      '  -o PATH     write here instead of alongside the input',
      '',
    ].join('\n'),
  );
  process.exit(2);
}

function main(argv: string[]): void {
  let output: string | undefined;
  let inspect = false;
  let input: string | undefined;

  for (let i = 0; i < argv.length; ++i) {
    const arg = argv[i];
    if (arg === '--inspect') inspect = true;
    else if (arg === '-o') output = argv[++i];
    else if (arg === '-h' || arg === '--help') usage();
    else if (arg.startsWith('-')) usage();
    else if (input === undefined) input = arg;
    else usage();
  }
  if (!input) usage();

  const text = readFileSync(input, 'utf8');
  const isJson = input.endsWith('.json');

  try {
    if (isJson) {
      const doc = JSON.parse(text) as SaveDoc;
      const out = output ?? input.replace(/\.json$/, '.log');
      if (inspect) return describeSave(doc, input);
      writeFileSync(out, formatLog(saveToLog(doc)));
      process.stdout.write(`${basename(input)} → ${basename(out)}  (${doc.moves.length} moves)\n`);
    } else {
      const { log, warnings } = parseLog(text);
      for (const w of warnings) process.stderr.write(`warning: ${w.message}\n`);
      if (inspect) return describeLog(log, input);
      const out = output ?? input.replace(/\.log$/, '') + '.json';
      writeFileSync(out, JSON.stringify(logToSave(log), null, 2) + '\n');
      process.stdout.write(`${basename(input)} → ${basename(out)}  (${log.moves.length} moves)\n`);
    }
  } catch (error) {
    if (error instanceof LogFormatError) {
      process.stderr.write(`${basename(input)}: ${error.message}\n`);
      if (error.detail?.version === 1) {
        process.stderr.write(
          'note: log format version 1 stores the position as a grid of colour digits and does ' +
            'not record which puzzle it is. MagicCube4D 4.3 cannot open these either.\n',
        );
      }
      process.exit(1);
    }
    throw error;
  }
}

function describeLog(log: ReturnType<typeof parseLog>['log'], path: string): void {
  const scrambleAt = log.marks.find((m) => m.kind === 'scramble');
  process.stdout.write(
    [
      `${basename(path)}`,
      `  format        MagicCube4D log version ${log.version}`,
      `  puzzle        ${log.schlafli} ${log.edgeLength}`,
      `  scramble      ${log.scrambleState}`,
      `  header twists ${log.twistCount}`,
      `  moves         ${log.moves.length}${
        scrambleAt ? ` (${scrambleAt.at} scramble, ${log.moves.length - scrambleAt.at} solution)` : ''
      }`,
      `  marks         ${log.marks.map((m) => m.kind).join(', ') || 'none'}`,
      `  line endings  ${log.lineEnding === '\r\n' ? 'CRLF' : 'LF'}`,
      '',
    ].join('\n'),
  );
}

function describeSave(doc: SaveDoc, path: string): void {
  process.stdout.write(
    [
      `${basename(path)}`,
      `  format        ${doc.format} version ${doc.version}`,
      `  puzzle        ${doc.puzzle.id}`,
      `  scramble      ${doc.scrambleState}${doc.scramble ? ` (seed ${doc.scramble.seed})` : ''}`,
      `  moves         ${doc.moves.length}, ${doc.index} applied`,
      `  assets        ${doc.assetsVersion ?? 'unspecified'}`,
      '',
    ].join('\n'),
  );
}

main(process.argv.slice(2));
