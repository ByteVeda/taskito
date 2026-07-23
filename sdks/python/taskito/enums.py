"""Coercion helper for the closed-set enums on public entry points."""

from __future__ import annotations

import enum
from typing import TypeVar

E = TypeVar("E", bound=enum.Enum)


def coerce_enum(enum_cls: type[E], value: E | str, *, param: str) -> E:
    """Accept an enum member or its wire string, else raise naming the valid set.

    Public entry points keep taking plain strings, so a typo would otherwise
    surface as a bare ``'x' is not a valid Y`` — or, where nothing validated,
    not at all.
    """
    try:
        return enum_cls(value)
    except ValueError:
        valid = ", ".join(repr(member.value) for member in enum_cls)
        raise ValueError(f"{param} must be one of {valid}, got {value!r}") from None
