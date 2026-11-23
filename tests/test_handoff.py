"""Run the official-runtime browser scenarios from the existing pytest entry point."""
import subprocess
from pathlib import Path


def test_official_runtime_browser_handoff():
    result = subprocess.run(
        ['node', '--test', 'tests/test_runtime.mjs'],
        cwd=Path(__file__).resolve().parents[1],
        capture_output=True,
        text=True,
        timeout=150,
    )
    assert result.returncode == 0, result.stdout + result.stderr
