"""Tests for the proxy system (Layer 3 — transparent reconstruction)."""

from __future__ import annotations

import logging
from typing import Any

import pytest

from taskito import ProxyReconstructionError, Queue
from taskito.proxies import ProxyRegistry, cleanup_proxies, reconstruct_proxies
from taskito.proxies.built_in import register_builtin_handlers
from taskito.proxies.handlers.file import FileHandler
from taskito.proxies.handlers.logger import LoggerHandler

# ---------------------------------------------------------------------------
# FileHandler
# ---------------------------------------------------------------------------


class TestFileHandler:
    def test_detect_open_file(self, tmp_path) -> None:
        f = open(tmp_path / "test.txt", "w")  # noqa: SIM115
        try:
            handler = FileHandler()
            assert handler.detect(f) is True
        finally:
            f.close()

    def test_detect_closed_file(self, tmp_path) -> None:
        f = open(tmp_path / "test.txt", "w")  # noqa: SIM115
        f.close()
        handler = FileHandler()
        assert handler.detect(f) is False

    def test_detect_stdin(self) -> None:
        import sys

        handler = FileHandler()
        assert handler.detect(sys.stdin) is False

    def test_deconstruct_text_file(self, tmp_path) -> None:
        path = tmp_path / "data.txt"
        path.write_text("hello world")
        with open(path) as f:
            handler = FileHandler()
            recipe = handler.deconstruct(f)
            assert recipe["path"] == str(path)
            assert recipe["mode"] == "r"
            assert recipe["encoding"] is not None
            assert recipe["position"] == 0

    def test_deconstruct_binary_file(self, tmp_path) -> None:
        path = tmp_path / "data.bin"
        path.write_bytes(b"\x00\x01\x02")
        with open(path, "rb") as f:
            handler = FileHandler()
            recipe = handler.deconstruct(f)
            assert recipe["mode"] == "rb"
            assert recipe["encoding"] is None

    def test_reconstruct_text_file(self, tmp_path) -> None:
        path = tmp_path / "data.txt"
        path.write_text("hello world")
        handler = FileHandler()
        recipe = {"path": str(path), "mode": "r", "encoding": "utf-8", "position": 0}
        f = handler.reconstruct(recipe, version=1)
        try:
            assert f.read() == "hello world"
        finally:
            f.close()

    def test_reconstruct_at_position(self, tmp_path) -> None:
        path = tmp_path / "data.txt"
        path.write_text("hello world")
        handler = FileHandler()
        recipe = {"path": str(path), "mode": "r", "encoding": "utf-8", "position": 6}
        f = handler.reconstruct(recipe, version=1)
        try:
            assert f.read() == "world"
        finally:
            f.close()

    def test_cleanup_closes_file(self, tmp_path) -> None:
        path = tmp_path / "data.txt"
        path.write_text("test")
        f = open(path)  # noqa: SIM115
        handler = FileHandler()
        handler.cleanup(f)
        assert f.closed

    def test_cleanup_already_closed(self, tmp_path) -> None:
        path = tmp_path / "data.txt"
        path.write_text("test")
        f = open(path)  # noqa: SIM115
        f.close()
        handler = FileHandler()
        handler.cleanup(f)  # no error


# ---------------------------------------------------------------------------
# LoggerHandler
# ---------------------------------------------------------------------------


class TestLoggerHandler:
    def test_detect_logger(self) -> None:
        handler = LoggerHandler()
        lgr = logging.getLogger("test.proxies.detect")
        assert handler.detect(lgr) is True

    def test_detect_non_logger(self) -> None:
        handler = LoggerHandler()
        assert handler.detect("not a logger") is False

    def test_round_trip(self) -> None:
        handler = LoggerHandler()
        lgr = logging.getLogger("test.proxies.roundtrip")
        lgr.setLevel(logging.WARNING)
        recipe = handler.deconstruct(lgr)
        reconstructed = handler.reconstruct(recipe, version=1)
        assert reconstructed.name == "test.proxies.roundtrip"
        assert reconstructed.level == logging.WARNING

    def test_cleanup_noop(self) -> None:
        handler = LoggerHandler()
        lgr = logging.getLogger("test.proxies.cleanup")
        handler.cleanup(lgr)  # no error


# ---------------------------------------------------------------------------
# ProxyRegistry
# ---------------------------------------------------------------------------


class TestProxyRegistry:
    def test_register_and_get(self) -> None:
        reg = ProxyRegistry()
        handler = FileHandler()
        reg.register(handler)
        assert reg.get("file") is handler

    def test_get_missing(self) -> None:
        reg = ProxyRegistry()
        assert reg.get("nonexistent") is None

    def test_find_handler(self, tmp_path) -> None:
        reg = ProxyRegistry()
        register_builtin_handlers(reg)
        f = open(tmp_path / "test.txt", "w")  # noqa: SIM115
        try:
            found = reg.find_handler(f)
            assert found is not None
            assert found.name == "file"
        finally:
            f.close()

    def test_find_handler_no_match(self) -> None:
        reg = ProxyRegistry()
        register_builtin_handlers(reg)
        assert reg.find_handler(42) is None


# ---------------------------------------------------------------------------
# Reconstruction
# ---------------------------------------------------------------------------


class TestReconstruct:
    def test_proxy_marker_reconstructed(self, tmp_path) -> None:
        path = tmp_path / "data.txt"
        path.write_text("content")
        reg = ProxyRegistry()
        reg.register(FileHandler())

        marker = {
            "__taskito_proxy__": True,
            "handler": "file",
            "version": 1,
            "identity": "id-1",
            "recipe": {
                "path": str(path),
                "mode": "r",
                "encoding": "utf-8",
                "position": 0,
            },
        }
        args, _kwargs, cleanup_list = reconstruct_proxies((marker,), {}, reg)
        try:
            assert hasattr(args[0], "read")
            assert args[0].read() == "content"
            assert len(cleanup_list) == 1
        finally:
            cleanup_proxies(cleanup_list)

    def test_cleanup_list_populated(self, tmp_path) -> None:
        path = tmp_path / "data.txt"
        path.write_text("test")
        reg = ProxyRegistry()
        reg.register(FileHandler())

        marker = {
            "__taskito_proxy__": True,
            "handler": "file",
            "version": 1,
            "identity": "id-2",
            "recipe": {
                "path": str(path),
                "mode": "r",
                "encoding": "utf-8",
                "position": 0,
            },
        }
        _, _, cleanup_list = reconstruct_proxies((marker,), {}, reg)
        assert len(cleanup_list) == 1
        handler, obj = cleanup_list[0]
        assert handler.name == "file"
        assert not obj.closed
        cleanup_proxies(cleanup_list)
        assert obj.closed

    def test_cleanup_runs_lifo(self, tmp_path) -> None:
        """Cleanup runs in reverse reconstruction order."""
        p1 = tmp_path / "a.txt"
        p1.write_text("a")
        p2 = tmp_path / "b.txt"
        p2.write_text("b")
        reg = ProxyRegistry()
        reg.register(FileHandler())

        markers = [
            {
                "__taskito_proxy__": True,
                "handler": "file",
                "version": 1,
                "identity": f"id-{i}",
                "recipe": {
                    "path": str(p),
                    "mode": "r",
                    "encoding": "utf-8",
                    "position": 0,
                },
            }
            for i, p in enumerate([p1, p2])
        ]
        args, _, cleanup_list = reconstruct_proxies(tuple(markers), {}, reg)
        assert not args[0].closed
        assert not args[1].closed
        cleanup_proxies(cleanup_list)
        assert args[0].closed
        assert args[1].closed

    def test_cleanup_catches_errors(self) -> None:
        """Cleanup errors are logged, not raised."""

        class BadHandler:
            name = "bad"
            version = 1
            handled_types: tuple[type, ...] = ()

            def detect(self, obj: Any) -> bool:
                return False

            def deconstruct(self, obj: Any) -> dict[str, Any]:
                return {}

            def reconstruct(self, recipe: dict[str, Any], version: int) -> Any:
                return "obj"

            def cleanup(self, obj: Any) -> None:
                raise RuntimeError("cleanup boom")

        cleanup_list = [(BadHandler(), "obj")]  # type: ignore[list-item]
        cleanup_proxies(cleanup_list)  # should not raise

    def test_missing_handler_raises(self) -> None:
        reg = ProxyRegistry()
        marker = {
            "__taskito_proxy__": True,
            "handler": "nonexistent",
            "version": 1,
            "recipe": {},
        }
        with pytest.raises(ProxyReconstructionError, match="No proxy handler"):
            reconstruct_proxies((marker,), {}, reg)

    def test_no_markers_passthrough(self) -> None:
        """Args without markers pass through unchanged."""
        reg = ProxyRegistry()
        register_builtin_handlers(reg)
        args, kwargs, cleanup = reconstruct_proxies((1, "hello", [3, 4]), {"key": "val"}, reg)
        assert args == (1, "hello", [3, 4])
        assert kwargs == {"key": "val"}
        assert cleanup == []


# ---------------------------------------------------------------------------
# Identity tracking
# ---------------------------------------------------------------------------


class TestIdentityTracking:
    def test_same_object_deduped(self, tmp_path) -> None:
        """Same file handle passed twice produces one marker and one ref."""
        path = tmp_path / "data.txt"
        path.write_text("test")

        queue = Queue(db_path=str(tmp_path / "q.db"), interception="strict")
        f = open(path)  # noqa: SIM115
        try:
            walker = queue._interceptor._walker
            args, _kw, _res = walker.walk((f, f), {})

            # First should be a full proxy marker
            assert args[0].get("__taskito_proxy__") is True
            # Second should be a reference to the first
            assert "__taskito_ref__" in args[1]
            assert args[1]["__taskito_ref__"] == args[0]["identity"]
        finally:
            f.close()

    def test_identity_reconstructed_once(self, tmp_path) -> None:
        """Reconstruction creates one object; both positions share it."""
        path = tmp_path / "data.txt"
        path.write_text("shared")
        reg = ProxyRegistry()
        reg.register(FileHandler())

        identity = "shared-id"
        marker = {
            "__taskito_proxy__": True,
            "handler": "file",
            "version": 1,
            "identity": identity,
            "recipe": {
                "path": str(path),
                "mode": "r",
                "encoding": "utf-8",
                "position": 0,
            },
        }
        ref = {"__taskito_ref__": identity}

        args, _, cleanup = reconstruct_proxies((marker, ref), {}, reg)
        try:
            assert args[0] is args[1]  # same object
            assert len(cleanup) == 1  # only one cleanup entry
        finally:
            cleanup_proxies(cleanup)

    def test_different_objects_separate(self, tmp_path) -> None:
        """Two different file handles get separate recipes."""
        p1 = tmp_path / "a.txt"
        p1.write_text("a")
        p2 = tmp_path / "b.txt"
        p2.write_text("b")

        queue = Queue(db_path=str(tmp_path / "q.db"), interception="strict")
        f1 = open(p1)  # noqa: SIM115
        f2 = open(p2)  # noqa: SIM115
        try:
            walker = queue._interceptor._walker
            args, _, _ = walker.walk((f1, f2), {})
            assert args[0].get("__taskito_proxy__") is True
            assert args[1].get("__taskito_proxy__") is True
            assert args[0]["identity"] != args[1]["identity"]
        finally:
            f1.close()
            f2.close()


# ---------------------------------------------------------------------------
# Proxy in nested structures
# ---------------------------------------------------------------------------


def test_proxy_in_nested_dict(tmp_path) -> None:
    """File inside a dict is proxied."""
    path = tmp_path / "nested.txt"
    path.write_text("nested content")

    queue = Queue(db_path=str(tmp_path / "q.db"), interception="strict")
    f = open(path)  # noqa: SIM115
    try:
        walker = queue._interceptor._walker
        _, kwargs, _ = walker.walk((), {"config": {"file": f}})
        inner = kwargs["config"]["file"]
        assert inner.get("__taskito_proxy__") is True
        assert inner["handler"] == "file"
    finally:
        f.close()


# ---------------------------------------------------------------------------
# End-to-end with Queue test mode
# ---------------------------------------------------------------------------


def test_proxy_roundtrip_in_test_mode(queue: Queue) -> None:
    """In test mode, original objects pass through (no serialization)."""
    captured: list = []

    @queue.task()
    def use_logger(lgr):
        captured.append(lgr)

    lgr = logging.getLogger("test.proxy.e2e")
    with queue.test_mode() as results:
        use_logger.delay(lgr)

    assert len(results) == 1
    assert results[0].succeeded
    assert captured[0] is lgr


def test_logger_proxy_marker_production(tmp_path) -> None:
    """Logger produces a proxy marker when interception is on."""
    queue = Queue(db_path=str(tmp_path / "q.db"), interception="strict")
    lgr = logging.getLogger("test.proxy.marker")

    walker = queue._interceptor._walker
    args, _, _ = walker.walk((lgr,), {})
    assert args[0].get("__taskito_proxy__") is True
    assert args[0]["handler"] == "logger"
    assert args[0]["recipe"]["name"] == "test.proxy.marker"
