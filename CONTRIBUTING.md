# Contributing to taskito

Thanks for your interest in contributing! taskito is a hybrid Rust + Python project, so the dev setup involves both ecosystems.

## Development Setup

### Prerequisites

- Python 3.9+
- Rust (stable) — install via [rustup](https://rustup.rs/)
- [maturin](https://github.com/PyO3/maturin) — builds the Rust extension

### Clone and Install

```bash
git clone https://github.com/ByteVeda/taskito.git
cd taskito

# Create a virtual environment
python -m venv .venv
source .venv/bin/activate

# Install in development mode (compiles Rust + installs Python package)
pip install maturin
maturin develop

# Install dev dependencies
pip install -e ".[dev]"
```

### Rebuilding After Rust Changes

If you modify any `.rs` file, re-run:

```bash
maturin develop
```

Python-only changes don't require a rebuild.

## Running Tests

### Python Tests

```bash
pytest tests/python/
```

### Rust Tests

```bash
cargo test --manifest-path crates/taskito-core/Cargo.toml
```

## Code Style

### Python

taskito uses [ruff](https://github.com/astral-sh/ruff) for linting and formatting:

```bash
# Lint
ruff check py_src/

# Format
ruff format py_src/

# Auto-fix
ruff check --fix py_src/
```

Type checking with [mypy](https://mypy-lang.org/):

```bash
mypy py_src/taskito/
```

### Rust

```bash
cargo fmt --manifest-path crates/taskito-core/Cargo.toml
cargo clippy --manifest-path crates/taskito-core/Cargo.toml
```

## Making Changes

1. Fork the repo and create a branch from `master`
2. Make your changes
3. Add or update tests as needed
4. Run `ruff check`, `mypy`, and `pytest` to verify
5. Run `cargo test` and `cargo clippy` if you changed Rust code
6. Open a pull request against `master`

## Documentation

Docs use [Zensical](https://zensical.com/). To preview locally:

```bash
pip install ".[docs]"
zensical serve
```

Then open http://localhost:8000.

## Questions?

Open an issue on GitHub if you have questions or want to discuss a feature before implementing it.
