# Installation

## From PyPI

```bash
pip install taskito
```

taskito has a single runtime dependency: [`cloudpickle`](https://github.com/cloudpipe/cloudpickle) for serializing task arguments and results. It is installed automatically.

!!! note "SQLite is bundled"
    taskito ships with SQLite compiled in via Rust's `libsqlite3-sys` crate. You do **not** need a system SQLite installation.

## From Source

Building from source requires a Rust toolchain (1.70+).

```bash
# Install Rust (if needed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Clone and build
git clone https://github.com/pratyush618/taskito.git
cd taskito
python -m venv .venv
source .venv/bin/activate
pip install maturin
maturin develop --release
```

## Development Setup

```bash
pip install -e ".[dev]"     # Tests, linting, type checking
pip install -e ".[docs]"    # Documentation (MkDocs Material)
```

## Verify Installation

```python
import taskito
print(taskito.__version__)  # 0.1.0
```

## Requirements

- Python 3.9+
- Any OS with SQLite support (Linux, macOS, Windows)
- Rust toolchain only needed for building from source
