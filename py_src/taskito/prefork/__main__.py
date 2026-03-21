"""Entry point for child worker processes: ``python -m taskito.prefork``."""

from taskito.prefork.child import main

if __name__ == "__main__":
    main()
