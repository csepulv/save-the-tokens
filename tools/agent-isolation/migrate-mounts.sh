#!/usr/bin/env bash
# migrate-mounts.sh — convert an old `mounts.conf` to a new `.agent.yml`.
#
# Usage:
#   ./migrate-mounts.sh <name>.mounts.conf
#       → writes <name>.agent.yml AND prints to stdout
#   ./migrate-mounts.sh --stdout <name>.mounts.conf
#       → stdout only, no file written
#   ./migrate-mounts.sh -f <name>.mounts.conf
#       → overwrite an existing <name>.agent.yml
#   ./migrate-mounts.sh < some.mounts.conf
#       → stdout only (no input filename to derive output from)
#
# Translates each mount line into a YAML mount entry and the optional
# `hostname` keyword line into the top-level YAML key. The new agent.yml
# also carries ports, services / network, env, and on_start blocks
# (data the retired `--services` / `--port` / `--env` / `--network`
# launch flags used to carry); none of those were in mounts.conf, so
# add them to the new YAML by hand.

set -euo pipefail

stdout_only=0
force=0
input=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stdout)  stdout_only=1; shift ;;
    -f|--force) force=1; shift ;;
    -*) echo "Unknown option: $1" >&2; exit 1 ;;
    *)  input="$1"; shift ;;
  esac
done

if [[ -z "${input}" ]]; then
  input="/dev/stdin"
  stdout_only=1   # no input filename → can't derive output name
fi

src_name=$(basename "${input}" 2>/dev/null || echo 'mounts.conf')

# Build the YAML output once, then dispatch to stdout / stdout+file.
output=""
appendln() { output+="$1"$'\n'; }

appendln "# Migrated from ${src_name} on $(date +%Y-%m-%d)."
appendln "# Add ports, services / network, env, or on_start blocks as needed."
appendln "# See agent.yml.example for the full schema."
appendln ""

hostname=""
mounts=()
while IFS= read -r line; do
  line="${line%%#*}"
  line="$(echo "${line}" | xargs)"  # trim
  [[ -z "${line}" ]] && continue

  # Reserved-keyword setting lines.
  case "${line%% *}" in
    hostname)
      hostname="${line#* }"
      continue
      ;;
  esac

  # Mount line: <host> <mode> [<name>] — the third column ("name" in
  # mounts.conf grammar) becomes `target` in the YAML.
  read -r host mode target <<< "${line}"
  if [[ -n "${target}" ]]; then
    mounts+=("  - { host: ${host}, mode: ${mode}, target: ${target} }")
  else
    mounts+=("  - { host: ${host}, mode: ${mode} }")
  fi
done < "${input}"

if [[ -n "${hostname}" ]]; then
  appendln "hostname: ${hostname}"
  appendln ""
fi

if [[ ${#mounts[@]} -gt 0 ]]; then
  appendln "mounts:"
  for m in "${mounts[@]}"; do
    appendln "${m}"
  done
fi

if [[ "${stdout_only}" -eq 1 ]]; then
  printf '%s' "${output}"
  exit 0
fi

# Derive output filename: foo.mounts.conf → foo.agent.yml;
# anything else → input + ".agent.yml".
if [[ "${input}" == *.mounts.conf ]]; then
  outfile="${input%.mounts.conf}.agent.yml"
else
  outfile="${input}.agent.yml"
fi

if [[ -e "${outfile}" && "${force}" -ne 1 ]]; then
  echo "Error: ${outfile} already exists; use -f / --force to overwrite." >&2
  exit 1
fi

printf '%s' "${output}" | tee "${outfile}"
echo "Wrote ${outfile}" >&2
