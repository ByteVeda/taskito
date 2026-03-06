.PHONY: docs docs-serve

docs:
	uv run zensical build
	@echo "Copying markdown sources..."
	cd docs && find . -name '*.md' -exec install -D {} ../site/_sources/{} \;

docs-serve:
	uv run zensical serve
