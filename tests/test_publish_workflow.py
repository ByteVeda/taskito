"""Tests for the publish GitHub Actions workflow configuration.

Verifies that the publish.yml workflow has the correct configuration,
including the ``skip-existing: true`` option added to the PyPI publish step
to allow reruns without failing on already-uploaded wheels.
"""

from pathlib import Path

import pytest
import yaml


WORKFLOW_PATH = Path(__file__).parent.parent / ".github" / "workflows" / "publish.yml"


@pytest.fixture(scope="module")
def workflow() -> dict:
    """Parse and return the publish workflow YAML as a dict."""
    return yaml.safe_load(WORKFLOW_PATH.read_text())


@pytest.fixture(scope="module")
def publish_job(workflow: dict) -> dict:
    """Return the publish job definition from the workflow."""
    return workflow["jobs"]["publish"]


@pytest.fixture(scope="module")
def pypi_publish_step(publish_job: dict) -> dict:
    """Return the PyPI publish step from the publish job."""
    for step in publish_job["steps"]:
        if "pypa/gh-action-pypi-publish" in step.get("uses", ""):
            return step
    pytest.fail("No pypa/gh-action-pypi-publish step found in publish job")


# ---------------------------------------------------------------------------
# Tests focused on the changed line: skip-existing: true
# ---------------------------------------------------------------------------


def test_skip_existing_is_present(pypi_publish_step: dict) -> None:
    """The pypi-publish step must have skip-existing configured."""
    assert "skip-existing" in pypi_publish_step.get("with", {}), (
        "skip-existing must be set in the pypa/gh-action-pypi-publish step "
        "so that reruns do not fail on already-uploaded packages"
    )


def test_skip_existing_is_true(pypi_publish_step: dict) -> None:
    """skip-existing must be boolean True (not a string or falsy value)."""
    value = pypi_publish_step["with"]["skip-existing"]
    assert value is True, (
        f"skip-existing should be boolean True, got {value!r} ({type(value).__name__})"
    )


def test_skip_existing_is_not_string(pypi_publish_step: dict) -> None:
    """YAML should parse skip-existing as a boolean, not the string 'true'."""
    value = pypi_publish_step["with"]["skip-existing"]
    assert not isinstance(value, str), (
        "skip-existing must be a YAML boolean (true), not a quoted string"
    )


# ---------------------------------------------------------------------------
# Regression tests: existing required config must not have been broken
# ---------------------------------------------------------------------------


def test_packages_dir_still_configured(pypi_publish_step: dict) -> None:
    """packages-dir must still be set to dist/ after the change."""
    assert pypi_publish_step.get("with", {}).get("packages-dir") == "dist/", (
        "packages-dir must remain 'dist/' in the pypi-publish step"
    )


def test_pypi_publish_action_version(pypi_publish_step: dict) -> None:
    """The pypi-publish action must use the expected pinned release channel."""
    uses = pypi_publish_step.get("uses", "")
    assert uses == "pypa/gh-action-pypi-publish@release/v1", (
        f"Expected pypa/gh-action-pypi-publish@release/v1, got {uses!r}"
    )


def test_publish_job_needs_all_build_jobs(publish_job: dict) -> None:
    """The publish job must depend on all build jobs to avoid partial releases."""
    expected_needs = {
        "build-wheels-linux",
        "build-wheels-musllinux",
        "build-wheels-macos",
        "build-wheels-windows",
        "build-sdist",
    }
    actual_needs = set(publish_job.get("needs", []))
    missing = expected_needs - actual_needs
    assert not missing, (
        f"publish job is missing needs entries: {missing}. "
        "All build jobs must complete before publishing."
    )


def test_publish_job_environment_is_pypi(publish_job: dict) -> None:
    """The publish job must target the 'pypi' environment for OIDC auth."""
    assert publish_job.get("environment") == "pypi", (
        "publish job must use the 'pypi' GitHub environment for trusted publishing"
    )


def test_publish_job_has_id_token_write_permission(publish_job: dict) -> None:
    """The publish job needs id-token: write for PyPI trusted publishing (OIDC)."""
    permissions = publish_job.get("permissions", {})
    assert permissions.get("id-token") == "write", (
        "publish job must have id-token: write permission for OIDC-based PyPI publishing"
    )


# ---------------------------------------------------------------------------
# Structural / edge-case tests
# ---------------------------------------------------------------------------


def test_workflow_file_is_valid_yaml() -> None:
    """The publish.yml file must be parseable as valid YAML."""
    content = WORKFLOW_PATH.read_text()
    parsed = yaml.safe_load(content)
    assert isinstance(parsed, dict), "Workflow YAML must parse to a mapping"


def test_publish_job_exists(workflow: dict) -> None:
    """A 'publish' job must be present in the workflow."""
    assert "publish" in workflow.get("jobs", {}), (
        "Expected a 'publish' job in .github/workflows/publish.yml"
    )


def test_pypi_publish_step_has_with_block(pypi_publish_step: dict) -> None:
    """The pypi-publish step must have a 'with' block for its inputs."""
    assert "with" in pypi_publish_step, (
        "pypa/gh-action-pypi-publish step must have a 'with' block"
    )


def test_no_duplicate_pypi_publish_steps(publish_job: dict) -> None:
    """There must be exactly one pypi-publish step to avoid double-publishing."""
    publish_steps = [
        step for step in publish_job["steps"]
        if "pypa/gh-action-pypi-publish" in step.get("uses", "")
    ]
    assert len(publish_steps) == 1, (
        f"Expected exactly 1 pypi-publish step, found {len(publish_steps)}"
    )


def test_workflow_triggers_on_version_tags(workflow: dict) -> None:
    """The workflow must be triggered by version tags only (not arbitrary pushes)."""
    on_push = workflow.get("on", {}).get("push", {})
    tags = on_push.get("tags", [])
    assert tags, "publish workflow must be triggered by version tags"
    # At least one tag pattern should look like a semver pattern
    assert any("[0-9]" in tag for tag in tags), (
        f"Expected a semver-like tag pattern, got {tags!r}"
    )
