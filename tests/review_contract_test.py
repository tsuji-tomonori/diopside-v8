from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

from governance.reviews import validate


class GithubSquashReviewFallbackTest(TestCase):
    def test_resolves_exactly_one_review_from_a_github_squash_commit(self) -> None:
        root = Path("/repository")
        review_path = root / "governance/reviews/CHG-example.yaml"

        def git_result(_root: Path, *args: str) -> str:
            command = args[0]
            if command == "rev-parse":
                return "verified-sha"
            if command == "show":
                return "✨ feat(timestamp): exampleを追加 (#90)"
            if command == "rev-list":
                return "verified-sha parent-sha"
            if command == "diff-tree":
                return "governance/reviews/CHG-example.yaml"
            raise AssertionError(args)

        with (
            patch.object(validate, "git_text", side_effect=git_result),
            patch.object(validate, "safe_repo_path", return_value=review_path),
            patch.object(validate, "validate_review_file", return_value={"impact_flags": {"bug_fix": False}}),
            patch.object(validate, "validate_commit_type_flags") as validate_type,
        ):
            result = validate.validate_github_squash_review(root, "HEAD")

        self.assertEqual(result, review_path)
        validate_type.assert_called_once()

    def test_rejects_a_non_github_subject(self) -> None:
        root = Path("/repository")

        def git_result(_root: Path, *args: str) -> str:
            if args[0] == "rev-parse":
                return "verified-sha"
            if args[0] == "show":
                return "✨ feat(timestamp): PR番号のないcommit"
            raise AssertionError(args)

        with patch.object(validate, "git_text", side_effect=git_result):
            with self.assertRaisesRegex(validate.ContractError, "GitHub squash subject"):
                validate.validate_github_squash_review(root, "HEAD")

    def test_rejects_multiple_changed_reviews(self) -> None:
        root = Path("/repository")

        def git_result(_root: Path, *args: str) -> str:
            command = args[0]
            if command == "rev-parse":
                return "verified-sha"
            if command == "show":
                return "🧪 fix(ci): releaseを回復 (#300)"
            if command == "rev-list":
                return "verified-sha parent-sha"
            if command == "diff-tree":
                return "governance/reviews/CHG-one.yaml\ngovernance/reviews/CHG-two.yaml"
            raise AssertionError(args)

        with patch.object(validate, "git_text", side_effect=git_result):
            with self.assertRaisesRegex(validate.ContractError, "exactly one changed CHG review"):
                validate.validate_github_squash_review(root, "HEAD")
