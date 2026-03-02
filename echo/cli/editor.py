from __future__ import annotations

import os
import subprocess
import tempfile


def open_in_editor(initial_text: str) -> str:
    """Open text in the user's $EDITOR and return the edited result."""
    editor = os.environ.get("EDITOR", os.environ.get("VISUAL", "vi"))

    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".txt", prefix="echo_reply_", delete=False
    ) as f:
        f.write(initial_text)
        tmppath = f.name

    try:
        subprocess.run([editor, tmppath], check=True)
        with open(tmppath, "r") as f:
            return f.read().strip()
    finally:
        os.unlink(tmppath)
