import { writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

export function generateZshHookScript() {
  return `
zmodload zsh/datetime

__sekko_preexec() {
  local ms=\${$(( EPOCHREALTIME * 1000 ))%.*}
  echo "<<<SEKKO_CMD_START:\${ms}:\$1>>>"
}

__sekko_precmd() {
  local exit_code=\$?
  local ms=\${$(( EPOCHREALTIME * 1000 ))%.*}
  echo "<<<SEKKO_CMD_END:\${ms}:\${exit_code}>>>"
}

autoload -Uz add-zsh-hook
add-zsh-hook preexec __sekko_preexec
add-zsh-hook precmd __sekko_precmd
`.trim();
}

export function generateBashHookScript() {
  return `
if [ -f ~/.bash-preexec.sh ]; then
  source ~/.bash-preexec.sh
elif [ -f /opt/homebrew/etc/profile.d/bash-preexec.sh ]; then
  source /opt/homebrew/etc/profile.d/bash-preexec.sh
elif [ -f /usr/local/etc/profile.d/bash-preexec.sh ]; then
  source /usr/local/etc/profile.d/bash-preexec.sh
else
  echo "[sekko] Warning: bash-preexec not found. Install with: brew install bash-preexec" >&2
  echo "[sekko] Command boundaries will not be captured." >&2
fi

__sekko_preexec() {
  local ts=$(date +%s)000
  echo "<<<SEKKO_CMD_START:\${ts}:\$1>>>"
}

__sekko_precmd() {
  local exit_code=$?
  local ts=$(date +%s)000
  echo "<<<SEKKO_CMD_END:\${ts}:\${exit_code}>>>"
}

if declare -F __bp_preexec_invoke_exec &>/dev/null; then
  preexec_functions+=(__sekko_preexec)
  precmd_functions+=(__sekko_precmd)
fi
`.trim();
}

export function generateHookScript(shell) {
  if (shell === 'bash') return generateBashHookScript();
  return generateZshHookScript();
}

export async function writeHookFile(shell) {
  const script = generateHookScript(shell);
  const ext = shell === 'bash' ? '.bash' : '.zsh';
  const path = join(tmpdir(), `sekko-hooks-${process.pid}${ext}`);
  await writeFile(path, script);
  return path;
}
