"""FileHandler — proxy for open file handles."""

from __future__ import annotations

import io
import sys
from typing import Any, ClassVar


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

    _STDIO_FILES: ClassVar[set[int]] = {id(sys.stdin), id(sys.stdout), id(sys.stderr)}

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
        kwargs: dict[str, Any] = {}
        if recipe.get("encoding") is not None:
            kwargs["encoding"] = recipe["encoding"]
        f = open(recipe["path"], recipe["mode"], **kwargs)  # noqa: SIM115
        position = recipe.get("position", 0)
        if position and position > 0:
            f.seek(position)
        return f

    def cleanup(self, obj: Any) -> None:
        if not obj.closed:
            obj.close()
