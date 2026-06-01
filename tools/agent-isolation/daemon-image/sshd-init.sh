#!/command/with-contenv sh
# s6-overlay cont-init hook — start sshd at container init. Runs as root,
# before the supervised services. Replaces hermes' entrypoint-wrapper approach
# (the new s6 base owns the ENTRYPOINT, so sshd hooks in here instead).
[ "${SSH_ENABLED:-true}" = "true" ] || exit 0

mkdir -p /run/sshd
ssh-keygen -A >/dev/null 2>&1 || true
if [ -n "${SSH_PASSWORD:-}" ]; then
  echo "hermes:${SSH_PASSWORD}" | chpasswd
fi
/usr/sbin/sshd
echo "cont-init 01-sshd: sshd started"
