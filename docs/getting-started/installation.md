# Installation

## From PyPI

```bash
pip install taskito
```

taskito has a single runtime dependency: [`cloudpickle`](https://github.com/cloudpipe/cloudpickle) for serializing task arguments and results. It is installed automatically.

!!! note "SQLite is bundled"
    taskito ships with SQLite compiled in via Rust's `libsqlite3-sys` crate. You do **not** need a system SQLite installation.

## Postgres Backend

To use PostgreSQL as the storage backend instead of SQLite:

```bash
pip install taskito[postgres]
```

See the [Postgres Backend guide](../guide/postgres.md) for configuration details.

## From Source

Building from source requires a Rust toolchain (1.70+).

```bash
# Install Rust (if needed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Clone and build
git clone https://github.com/ByteVeda/taskito.git
cd taskito
python -m venv .venv
source .venv/bin/activate
pip install maturin
maturin develop --release
```

## Development Setup

```bash
pip install -e ".[dev]"     # Tests, linting, type checking
pip install -e ".[docs]"    # Documentation (Zensical)
```

## Verify Installation

```python
import taskito
print(taskito.__version__)  # 0.3.0
```

## Requirements

- Python 3.9+
- Any OS with SQLite support (Linux, macOS, Windows)
- PostgreSQL 12+ (optional, for `taskito[postgres]`)
- Rust toolchain only needed for building from source
