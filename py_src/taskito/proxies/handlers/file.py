"""FileHandler — proxy for open file handles."""

from __future__ import annotations

import io
import pathlib
import sys
from typing import Any, ClassVar

from taskito.exceptions import ProxyReconstructionError
from taskito.proxies.schema import FieldSpec


class FileHandler:
    """Deconstructs/reconstructs open file handles."""

    name = "file"
    version = 1
    handled_types: tuple[type, ...] = (
        io.TextIOWrapper,
        io.BufferedReader,
        io.BufferedWriter,
        io.FileIO,
    )
    schema: ClassVar[dict[str, FieldSpec]] = {
        "path": FieldSpec(str),
        "mode": FieldSpec(str),
        "encoding": FieldSpec((str, type(None)), required=False),
        "position": FieldSpec(int, required=False),
    }

    _STDIO_FILES: ClassVar[set[int]] = {id(sys.stdin), id(sys.stdout), id(sys.stderr)}

    def __init__(self, path_allowlist: list[str] | None = None) -> None:
        self._path_allowlist = [str(pathlib.Path(p).resolve()) for p in (path_allowlist or [])]

    def detect(self, obj: Any) -> bool:
        if not isinstance(obj, self.handled_types):
            return False
        if getattr(obj, "closed", True):
            return False
        if id(obj) in self._STDIO_FILES:
            return False
        name = getattr(obj, "name", None)
        if not isinstance(name, str):
            return False
        return name not in ("<stdin>", "<stdout>", "<stderr>")

    def deconstruct(self, obj: Any) -> dict[str, Any]:
        return {
            "path": obj.name,
            "mode": obj.mode,
            "encoding": getattr(obj, "encoding", None),
            "position": obj.tell(),
        }

    def reconstruct(self, recipe: dict[str, Any], version: int) -> Any:
        path = recipe["path"]

        # Path allowlist enforcement
        if self._path_allowlist:
            resolved = str(pathlib.Path(path).resolve())
            allowed = any(resolved.startswith(prefix) for prefix in self._path_allowlist)
            if not allowed:
                raise ProxyReconstructionError(f"File path '{path}' is not in the allowed paths")

        kwargs: dict[str, Any] = {}
        if recipe.get("encoding") is not None:
            kwargs["encoding"] = recipe["encoding"]
        f = open(path, recipe["mode"], **kwargs)  # noqa: SIM115
        position = recipe.get("position", 0)
        if position and position > 0:
            f.seek(position)
        return f

    def cleanup(self, obj: Any) -> None:
        if not obj.closed:
            obj.close()
