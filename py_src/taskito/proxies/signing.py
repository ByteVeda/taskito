"""HMAC-SHA256 recipe signing for proxy markers."""

from __future__ import annotations

import hashlib
import hmac
import json
from typing import Any

from taskito.exceptions import ProxyReconstructionError


def sign_recipe(handler_name: str, version: int, recipe: dict[str, Any], secret: str) -> str:
    """Compute HMAC-SHA256 over handler_name + version + canonical JSON."""
    canonical = f"{handler_name}:{version}:" + json.dumps(
        recipe, sort_keys=True, separators=(",", ":")
    )
    return hmac.new(secret.encode(), canonical.encode(), hashlib.sha256).hexdigest()


def verify_recipe(
    handler_name: str,
    version: int,
    recipe: dict[str, Any],
    checksum: str,
    secret: str,
) -> bool:
    """Return True if checksum matches; raise ProxyReconstructionError if not."""
    expected = sign_recipe(handler_name, version, recipe, secret)
    if not hmac.compare_digest(expected, checksum):
        raise ProxyReconstructionError(
            f"Recipe integrity check failed for handler '{handler_name}': "
            "checksum mismatch (possible tampering)"
        )
    return True
