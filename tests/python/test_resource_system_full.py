"""Tests for the full resource system — all phases A through M."""

import collections
import contextvars
import tempfile
import threading
from typing import NamedTuple
from unittest.mock import MagicMock

import pytest

from taskito import Inject, MockResource, Queue
from taskito.exceptions import (
    ProxyReconstructionError,
    ResourceError,
    ResourceUnavailableError,
)
from taskito.inject import _InjectAlias
from taskito.interception.built_in import build_default_registry
from taskito.interception.converters import (
    convert_named_tuple,
    convert_ordered_dict,
    reconstruct_converted,
    reconstruct_named_tuple,
    reconstruct_ordered_dict,
)
from taskito.interception.metrics import InterceptionMetrics
from taskito.interception.walker import ArgumentWalker
from taskito.proxies.metrics import ProxyMetrics
from taskito.proxies.no_proxy import NoProxy as NoProxyClass
from taskito.proxies.schema import FieldSpec, validate_recipe
from taskito.proxies.signing import sign_recipe, verify_recipe
from taskito.resources.definition import ResourceDefinition, ResourceScope
from taskito.resources.frozen import FrozenResource
from taskito.resources.pool import PoolConfig, ResourcePool
from taskito.resources.runtime import ResourceRuntime
from taskito.resources.thread_local import ThreadLocalStore

# ─── Phase A — NamedTuple / OrderedDict / lambda / tempfile ───


class Point(NamedTuple):
    x: int
    y: int


class TestNamedTupleConvert:
    def test_round_trip(self) -> None:
        p = Point(3, 7)
        data = convert_named_tuple(p)
        assert data["__taskito_convert__"] is True
        assert data["type_key"] == "named_tuple"
        result = reconstruct_named_tuple(data)
        assert result == p
        assert isinstance(result, Point)

    def test_via_reconstruct_dispatch(self) -> None:
        data = convert_named_tuple(Point(1, 2))
        result = reconstruct_converted(data)
        assert result == Point(1, 2)


class TestOrderedDictConvert:
    def test_round_trip(self) -> None:
        od = collections.OrderedDict([("b", 2), ("a", 1)])
        data = convert_ordered_dict(od)
        assert data["__taskito_convert__"] is True
        assert data["type_key"] == "ordered_dict"
        result = reconstruct_ordered_dict(data)
        assert result == od
        assert isinstance(result, collections.OrderedDict)
        assert list(result.keys()) == ["b", "a"]  # order preserved


class TestWalkerPhaseA:
    def _make_walker(self) -> ArgumentWalker:
        reg = build_default_registry()
        return ArgumentWalker(reg, max_depth=10)

    def test_named_tuple_auto_detected(self) -> None:
        walker = self._make_walker()
        args = (Point(10, 20),)
        new_args, _, _result = walker.walk(args, {})
        assert new_args[0]["__taskito_convert__"] is True
        assert new_args[0]["type_key"] == "named_tuple"

    def test_lambda_rejected(self) -> None:
        walker = self._make_walker()
        fn = lambda x: x + 1  # noqa: E731
        args = (fn,)
        _, _, result = walker.walk(args, {})
        assert len(result.failures) == 1
        assert "lambda" in result.failures[0].type_name.lower()

    def test_tempfile_rejected(self) -> None:
        walker = self._make_walker()
        with tempfile.NamedTemporaryFile() as f:
            _, _, result = walker.walk((f,), {})
            assert len(result.failures) == 1
            reason = result.failures[0].reason.lower()
            assert "tempfile" in reason or "temporary" in reason

    def test_ordered_dict_converted(self) -> None:
        walker = self._make_walker()
        od = collections.OrderedDict([("x", 1)])
        new_args, _, _ = walker.walk((od,), {})
        assert new_args[0]["__taskito_convert__"] is True
        assert new_args[0]["type_key"] == "ordered_dict"

    def test_contextvars_context_rejected(self) -> None:
        reg = build_default_registry()
        walker = ArgumentWalker(reg, max_depth=10)
        ctx = contextvars.copy_context()
        _, _, result = walker.walk((ctx,), {})
        assert len(result.failures) == 1
        assert "context" in result.failures[0].reason.lower()


class TestRegisterType:
    def test_register_redirect(self, tmp_path: object) -> None:
        q = Queue(
            db_path=":memory:",
            interception="strict",
        )

        class MyDB:
            pass

        q.register_type(MyDB, "redirect", resource="db")
        # Verify it's registered
        entry = q._interceptor._registry.resolve(MyDB())
        assert entry is not None

    def test_requires_interception(self) -> None:
        q = Queue(db_path=":memory:", interception="off")
        with pytest.raises(RuntimeError, match="Interception is disabled"):
            q.register_type(int, "pass")


# ─── Phase B — Proxy signing / schema / NoProxy ───


class TestRecipeSigning:
    def test_valid_signature(self) -> None:
        recipe = {"path": "/tmp/f", "mode": "r"}
        sig = sign_recipe("file", 1, recipe, "secret")
        assert verify_recipe("file", 1, recipe, sig, "secret")

    def test_invalid_signature_raises(self) -> None:
        recipe = {"path": "/tmp/f", "mode": "r"}
        with pytest.raises(ProxyReconstructionError, match="checksum mismatch"):
            verify_recipe("file", 1, recipe, "bad-checksum", "secret")

    def test_deterministic(self) -> None:
        recipe = {"b": 2, "a": 1}
        s1 = sign_recipe("h", 1, recipe, "key")
        s2 = sign_recipe("h", 1, recipe, "key")
        assert s1 == s2


class TestSchemaValidation:
    def test_valid_recipe(self) -> None:
        schema = {"path": FieldSpec(str), "mode": FieldSpec(str)}
        validate_recipe("test", {"path": "/f", "mode": "r"}, schema)

    def test_extra_key_raises(self) -> None:
        schema = {"path": FieldSpec(str)}
        with pytest.raises(ProxyReconstructionError, match="unexpected keys"):
            validate_recipe("test", {"path": "/f", "extra": 1}, schema)

    def test_missing_required_raises(self) -> None:
        schema = {"path": FieldSpec(str), "mode": FieldSpec(str)}
        with pytest.raises(ProxyReconstructionError, match="missing required"):
            validate_recipe("test", {"path": "/f"}, schema)

    def test_optional_field_ok(self) -> None:
        schema = {"path": FieldSpec(str), "enc": FieldSpec(str, required=False)}
        validate_recipe("test", {"path": "/f"}, schema)

    def test_wrong_type_raises(self) -> None:
        schema = {"count": FieldSpec(int)}
        with pytest.raises(ProxyReconstructionError, match="expected"):
            validate_recipe("test", {"count": "not-an-int"}, schema)


class TestNoProxy:
    def test_unwrap_in_walker(self) -> None:
        reg = build_default_registry()
        walker = ArgumentWalker(reg, max_depth=10)
        sentinel = object()
        wrapped = NoProxyClass(sentinel)
        new_args, _, _ = walker.walk((wrapped,), {})
        assert new_args[0] is sentinel


# ─── Phase D — Resource scopes ───


class TestResourceScopes:
    def test_all_scopes_exist(self) -> None:
        assert ResourceScope.WORKER.value == "worker"
        assert ResourceScope.TASK.value == "task"
        assert ResourceScope.THREAD.value == "thread"
        assert ResourceScope.REQUEST.value == "request"

    def test_pool_config(self) -> None:
        cfg = PoolConfig(pool_size=5, pool_min=2)
        assert cfg.pool_size == 5
        assert cfg.pool_min == 2

    def test_resource_pool_acquire_release(self) -> None:
        created = []

        def factory() -> dict:
            d: dict = {"id": len(created)}
            created.append(d)
            return d

        pool = ResourcePool(
            "test",
            factory,
            teardown=None,
            config=PoolConfig(pool_size=2, acquire_timeout=1.0),
        )
        inst = pool.acquire()
        assert inst["id"] == 0
        pool.release(inst)
        # Re-acquire should return same instance
        inst2 = pool.acquire()
        assert inst2 is inst
        pool.shutdown()

    def test_pool_exhaustion_raises(self) -> None:
        pool = ResourcePool(
            "test",
            lambda: {},
            teardown=None,
            config=PoolConfig(pool_size=1, acquire_timeout=0.1),
        )
        pool.acquire()
        with pytest.raises(ResourceUnavailableError, match="timed out"):
            pool.acquire()
        pool.shutdown()

    def test_pool_stats(self) -> None:
        pool = ResourcePool(
            "test",
            lambda: {},
            teardown=None,
            config=PoolConfig(pool_size=3),
        )
        inst = pool.acquire()
        s = pool.stats()
        assert s["active"] == 1
        assert s["size"] == 3
        pool.release(inst)
        s2 = pool.stats()
        assert s2["active"] == 0
        assert s2["idle"] == 1
        pool.shutdown()

    def test_thread_local_store(self) -> None:
        counter = {"n": 0}

        def factory() -> int:
            counter["n"] += 1
            return counter["n"]

        store = ThreadLocalStore("test", factory, teardown=None)
        v1 = store.get_or_create()
        v2 = store.get_or_create()
        assert v1 == v2  # Same thread → same instance

        results: list[int] = []

        def worker() -> None:
            results.append(store.get_or_create())

        t = threading.Thread(target=worker)
        t.start()
        t.join()
        assert results[0] != v1  # Different thread → different instance
        store.teardown_all()


class TestFrozenResource:
    def test_read_allowed(self) -> None:
        class Config:
            db_url = "postgres://localhost"

        frozen = FrozenResource(Config(), "config")
        assert frozen.db_url == "postgres://localhost"

    def test_write_raises(self) -> None:
        class Config:
            db_url = "x"

        frozen = FrozenResource(Config(), "config")
        with pytest.raises(ResourceError, match="read-only"):
            frozen.db_url = "y"

    def test_delete_raises(self) -> None:
        class Config:
            db_url = "x"

        frozen = FrozenResource(Config(), "config")
        with pytest.raises(ResourceError, match="read-only"):
            del frozen.db_url


class TestRuntimeScopeAware:
    def test_worker_scope_resolve(self) -> None:
        defn = ResourceDefinition(
            name="config",
            factory=lambda: {"key": "value"},
            scope=ResourceScope.WORKER,
        )
        rt = ResourceRuntime({"config": defn})
        rt.initialize()
        result = rt.resolve("config")
        assert result == {"key": "value"}
        rt.teardown()

    def test_acquire_for_task_worker(self) -> None:
        defn = ResourceDefinition(
            name="config",
            factory=lambda: 42,
            scope=ResourceScope.WORKER,
        )
        rt = ResourceRuntime({"config": defn})
        rt.initialize()
        inst, release = rt.acquire_for_task("config")
        assert inst == 42
        assert release is None
        rt.teardown()

    def test_acquire_for_task_request_scope(self) -> None:
        counter = {"n": 0}

        def factory() -> int:
            counter["n"] += 1
            return counter["n"]

        defn = ResourceDefinition(
            name="req",
            factory=factory,
            scope=ResourceScope.REQUEST,
        )
        rt = ResourceRuntime({"req": defn})
        rt.initialize()
        inst1, release1 = rt.acquire_for_task("req")
        inst2, release2 = rt.acquire_for_task("req")
        assert inst1 != inst2  # Fresh each time
        assert release1 is not None
        assert release2 is not None
        release1()
        release2()
        rt.teardown()

    def test_frozen_resource_in_runtime(self) -> None:
        defn = ResourceDefinition(
            name="cfg",
            factory=lambda: MagicMock(value=10),
            scope=ResourceScope.WORKER,
            frozen=True,
        )
        rt = ResourceRuntime({"cfg": defn})
        rt.initialize()
        inst = rt.resolve("cfg")
        assert inst.value == 10
        with pytest.raises(ResourceError, match="read-only"):
            inst.new_attr = "x"
        rt.teardown()

    def test_reload_reloadable(self) -> None:
        counter = {"n": 0}

        def factory() -> int:
            counter["n"] += 1
            return counter["n"]

        defn = ResourceDefinition(
            name="svc",
            factory=factory,
            scope=ResourceScope.WORKER,
            reloadable=True,
        )
        rt = ResourceRuntime({"svc": defn})
        rt.initialize()
        assert rt.resolve("svc") == 1
        results = rt.reload()
        assert results["svc"] is True
        assert rt.resolve("svc") == 2
        rt.teardown()

    def test_reload_skips_non_reloadable(self) -> None:
        defn = ResourceDefinition(
            name="fixed",
            factory=lambda: 1,
            scope=ResourceScope.WORKER,
            reloadable=False,
        )
        rt = ResourceRuntime({"fixed": defn})
        rt.initialize()
        results = rt.reload()
        assert "fixed" not in results
        rt.teardown()

    def test_status_includes_pool(self) -> None:
        defn = ResourceDefinition(
            name="db",
            factory=lambda: {},
            scope=ResourceScope.TASK,
            pool_size=5,
        )
        rt = ResourceRuntime({"db": defn})
        rt.initialize()
        status = rt.status()
        assert len(status) == 1
        assert status[0]["name"] == "db"
        assert "pool" in status[0]
        assert status[0]["pool"]["size"] == 5
        rt.teardown()


# ─── Phase E — Inject annotation ───


class TestInjectAnnotation:
    def test_inject_alias_created(self) -> None:
        alias = Inject["db"]
        assert isinstance(alias, _InjectAlias)
        assert alias.resource_name == "db"

    def test_inject_alias_equality(self) -> None:
        assert Inject["db"] == Inject["db"]
        assert Inject["db"] != Inject["redis"]

    def test_inject_annotation_detected_in_task(self) -> None:
        q = Queue(db_path=":memory:")

        @q.task()
        def my_task(x: int, db: Inject["db"]) -> None:  # type: ignore[valid-type]  # noqa: F821
            pass

        assert "db" in q._task_inject_map.get(my_task.name, [])

    def test_inject_annotation_merged_with_explicit(self) -> None:
        q = Queue(db_path=":memory:")

        @q.task(inject=["redis"])
        def my_task(x: int, db: Inject["db"]) -> None:  # type: ignore[valid-type]  # noqa: F821
            pass

        injects = q._task_inject_map.get(my_task.name, [])
        assert "redis" in injects
        assert "db" in injects


# ─── Phase F — TOML config ───


class TestTomlConfig:
    def test_load_resources(self, tmp_path: object) -> None:
        import pathlib

        path = pathlib.Path(str(tmp_path)) / "resources.toml"
        path.write_text('[resources.config]\nfactory = "builtins:dict"\nscope = "worker"\n')
        from taskito.resources.toml_config import load_resources_from_toml

        defs = load_resources_from_toml(str(path))
        assert len(defs) == 1
        assert defs[0].name == "config"
        assert defs[0].scope == ResourceScope.WORKER

    def test_missing_factory_raises(self, tmp_path: object) -> None:
        import pathlib

        path = pathlib.Path(str(tmp_path)) / "bad.toml"
        path.write_text('[resources.db]\nscope = "worker"\n')
        from taskito.resources.toml_config import load_resources_from_toml

        with pytest.raises(ValueError, match="missing required 'factory'"):
            load_resources_from_toml(str(path))

    def test_queue_load_resources(self, tmp_path: object) -> None:
        import pathlib

        path = pathlib.Path(str(tmp_path)) / "res.toml"
        path.write_text('[resources.cfg]\nfactory = "builtins:dict"\n')
        q = Queue(db_path=":memory:")
        q.load_resources(str(path))
        assert "cfg" in q._resource_definitions


# ─── Phase H — Proxy metrics ───


class TestProxyMetrics:
    def test_record_and_retrieve(self) -> None:
        m = ProxyMetrics()
        m.record_reconstruction("file", 15.5)
        m.record_reconstruction("file", 20.0)
        m.record_error("file")
        result = m.to_list()
        assert len(result) == 1
        assert result[0]["handler"] == "file"
        assert result[0]["total_reconstructions"] == 2
        assert result[0]["total_errors"] == 1
        assert result[0]["avg_duration_ms"] == 17.75

    def test_queue_proxy_stats(self) -> None:
        q = Queue(db_path=":memory:")
        stats = q.proxy_stats()
        assert isinstance(stats, list)


# ─── Phase I — Interception metrics ───


class TestInterceptionMetrics:
    def test_record_and_retrieve(self) -> None:
        m = InterceptionMetrics()
        m.record(5.0, {"pass": 3, "convert": 1}, max_depth=2)
        d = m.to_dict()
        assert d["total_intercepts"] == 1
        assert d["strategy_counts"]["pass"] == 3
        assert d["max_depth_reached"] == 2

    def test_queue_interception_stats(self) -> None:
        q = Queue(db_path=":memory:", interception="strict")
        stats = q.interception_stats()
        assert "total_intercepts" in stats

    def test_walker_tracks_strategy_counts(self) -> None:
        reg = build_default_registry()
        walker = ArgumentWalker(reg, max_depth=10)
        _, _, result = walker.walk((42, "hello"), {})
        assert result.strategy_counts.get("pass", 0) >= 2


# ─── Phase L — MockResource ───


class TestMockResource:
    def test_return_value(self) -> None:
        mock = MockResource("db", return_value="fake-db")
        assert mock.get() == "fake-db"

    def test_wraps(self) -> None:
        real = {"conn": True}
        mock = MockResource("db", wraps=real)
        assert mock.get() is real

    def test_track_calls(self) -> None:
        mock = MockResource("db", return_value="x", track_calls=True)
        mock.get()
        mock.get()
        assert mock.call_count == 2

    def test_mock_in_test_mode(self) -> None:
        q = Queue(db_path=":memory:")
        mock_db = MockResource("db", return_value="mock-db", track_calls=True)

        @q.task(inject=["db"])
        def use_db(db: object = None) -> object:
            return db

        with q.test_mode(resources={"db": mock_db}) as results:
            use_db.delay()

        assert len(results) == 1
        assert results[0].return_value == "mock-db"
        assert mock_db.call_count == 1  # .get() called once during setup


# ─── Phase M — Test-mode proxy passthrough ───


class TestTestModePassthrough:
    def test_test_mode_sets_flag(self) -> None:
        q = Queue(db_path=":memory:")
        assert q._test_mode_active is False
        with q.test_mode():
            assert q._test_mode_active is True
        assert q._test_mode_active is False

    def test_interception_skipped_in_test_mode(self) -> None:
        q = Queue(db_path=":memory:", interception="strict")

        @q.task()
        def identity(x: object) -> object:
            return x

        sentinel = object()
        with q.test_mode() as results:
            identity.delay(sentinel)
        # In test mode, the sentinel passes through without interception
        assert len(results) == 1


# ─── Integration: resource injection end-to-end ───


class TestResourceInjectionE2E:
    def test_inject_in_test_mode(self) -> None:
        q = Queue(db_path=":memory:")

        @q.worker_resource("db")
        def create_db() -> str:
            return "real-db-connection"

        @q.task(inject=["db"])
        def process(order_id: int, db: object = None) -> str:
            return f"processed {order_id} with {db}"

        with q.test_mode(resources={"db": "mock-db"}) as results:
            process.delay(42)

        assert len(results) == 1
        assert results[0].return_value == "processed 42 with mock-db"

    def test_inject_annotation_in_test_mode(self) -> None:
        q = Queue(db_path=":memory:")

        @q.task()
        def process(order_id: int, db: Inject["db"] = None) -> str:  # type: ignore[valid-type,assignment]  # noqa: F821
            return f"{order_id}:{db}"

        with q.test_mode(resources={"db": "injected"}) as results:
            process.delay(1)

        assert results[0].return_value == "1:injected"
