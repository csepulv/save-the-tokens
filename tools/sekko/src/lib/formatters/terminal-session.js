export function formatTerminalSessionMarkdown(session) {
  const { commands, sessionStart, sessionEnd, shell } = session;
  const durationMin = Math.round((sessionEnd - sessionStart) / 60000);
  const startTime = new Date(sessionStart).toISOString().replace('T', ' ').replace(/\.\d+Z/, '');

  const lines = [
    '# Terminal Session',
    '',
    `Recorded: ${startTime} (${durationMin} min)`,
    `Shell: ${shell} | Commands: ${commands.length}`,
    '',
  ];

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    const time = new Date(cmd.startMs).toLocaleTimeString('en-US', { hour12: false });
    const durationSec = (cmd.durationMs / 1000).toFixed(1);

    lines.push(`## Command ${i + 1}: \`${cmd.command}\``);
    lines.push(`**Exit:** ${cmd.exitCode} | **Time:** ${time} | **Duration:** ${durationSec}s`);
    lines.push('');

    if (cmd.output) {
      lines.push('```');
      lines.push(cmd.output);
      lines.push('```');
    } else {
      lines.push('_(no output)_');
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function formatTerminalSessionJson(session) {
  return {
    sessionStart: session.sessionStart,
    sessionEnd: session.sessionEnd,
    shell: session.shell,
    commands: session.commands.map((cmd) => ({
      command: cmd.command,
      startMs: cmd.startMs,
      endMs: cmd.endMs,
      exitCode: cmd.exitCode,
      durationMs: cmd.durationMs,
      output: cmd.output || '',
    })),
  };
}
