"""Host-side regression: timer output, exit codes, and safe update gates."""
import os
from pathlib import Path
import pty
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
master, slave = pty.openpty()
proc = subprocess.Popen(['bash', '-c', 'source docker/progress.sh; nakhl_timed test bash -c "sleep 2; exit 7"'], cwd=ROOT, stdout=slave, stderr=slave)
os.close(slave)
output = b''
while True:
    try:
        data = os.read(master, 4096)
        if not data:
            break
        output += data
    except OSError:
        break
os.close(master)
assert proc.wait() == 7, output
assert '1 ثانیه' in output.decode(), output

with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    (root / 'docker').mkdir()
    for name in ('update.sh', 'progress.sh'):
        (root / 'docker' / name).write_text((ROOT / 'docker' / name).read_text())
    (root / 'docker/backup.sh').write_text('#!/bin/bash\nexit 0\n')
    fake = root / 'docker-cli'
    fake.mkdir()
    cli = fake / 'docker'
    cli.write_text('''#!/bin/bash
printf '%s\\n' "$*" >> "$MOCK_LOG"
case "$*" in
  'compose --progress plain build') exit "${BUILD_RESULT:-0}" ;;
  *upgrade-test.mjs) exit "${UPGRADE_RESULT:-0}" ;;
  *migration-test.mjs) exit "${MIGRATION_RESULT:-0}" ;;
  'inspect '*) echo healthy ;;
esac
exit 0
''')
    cli.chmod(0o755)
    for name, settings, expected, replace in [
        ('build failure', {'BUILD_RESULT': '9'}, 1, False),
        ('upgrade failure', {'UPGRADE_RESULT': '8'}, 1, False),
        ('migration failure', {'MIGRATION_RESULT': '7'}, 1, False),
        ('missing approval', {}, 1, False),
        ('explicit approval', {'NAKHL_ALLOW_DESTRUCTIVE_UPGRADE': 'yes'}, 0, True),
    ]:
        log = root / 'calls.log'
        log.write_text('')
        env = {**os.environ, 'PATH': f'{fake}:{os.environ["PATH"]}', 'MOCK_LOG': str(log)}
        env.pop('NAKHL_ALLOW_DESTRUCTIVE_UPGRADE', None)
        env.update(settings)
        result = subprocess.run(['bash', 'docker/update.sh'], cwd=root, env=env, stdin=subprocess.DEVNULL, capture_output=True, timeout=20)
        assert result.returncode == expected, (name, result.stdout, result.stderr)
        assert ('compose up -d' in log.read_text()) == replace, name
        assert 'ثانیه' in result.stderr.decode(), name
        print(f'PASS: {name}')
print('PASS: live seconds and original command failure status')
