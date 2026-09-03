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


class GithubMergeReviewFallbackTest(TestCase):
    def test_resolves_review_from_a_github_two_parent_merge(self) -> None:
        root = Path("/repository")
        review_path = root / "governance/reviews/CHG-example.yaml"

        def git_result(_root: Path, *args: str) -> str:
            command = args[0]
            if command == "rev-parse":
                return "merge-sha"
            if command == "show":
                if args[-1] == "head-sha":
                    return "🐛 fix(ci): merge検証を修正"
                return "Merge pull request #567 from owner/fix-review"
            if command == "rev-list":
                if "--parents" not in args:
                    return "head-sha"
                return "merge-sha base-sha head-sha"
            if command == "diff-tree":
                return "governance/reviews/CHG-example.yaml"
            if command == "log":
                return "head-sha"
            raise AssertionError(args)

        with (
            patch.object(validate, "git_text", side_effect=git_result),
            patch.object(validate, "safe_repo_path", return_value=review_path),
            patch.object(
                validate, "validate_commit", return_value=review_path
            ) as validate_head,
            patch.object(
                validate,
                "validate_review_file",
                return_value={"impact_flags": {"bug_fix": True}},
            ) as validate_review,
            patch.object(validate, "validate_commit_type_flags") as validate_type,
        ):
            result = validate.validate_github_merge_review(root, "HEAD")

        self.assertEqual(result, review_path)
        validate_head.assert_called_once_with(root, "head-sha")
        validate_review.assert_called_once_with(root, review_path, "head-sha")
        validate_type.assert_called_once_with(
            "🐛 fix(ci): merge検証を修正", {"impact_flags": {"bug_fix": True}}
        )

    def test_resolves_every_review_from_a_multi_commit_merge(self) -> None:
        root = Path("/repository")
        first_review = root / "governance/reviews/CHG-first.yaml"
        second_review = root / "governance/reviews/CHG-second.yaml"

        def git_result(_root: Path, *args: str) -> str:
            command = args[0]
            if command == "rev-parse":
                return "merge-sha"
            if command == "show":
                messages = {
                    "first-sha": "✨ feat(ci): 最初の変更",
                    "head-sha": "🐛 fix(ci): 次の変更",
                }
                return messages.get(
                    args[-1], "Merge pull request #567 from owner/fix-review"
                )
            if command == "rev-list":
                if "--parents" in args:
                    return "merge-sha base-sha head-sha"
                return "first-sha\nhead-sha"
            if command == "diff-tree":
                return (
                    "governance/reviews/CHG-first.yaml\n"
                    "governance/reviews/CHG-second.yaml"
                )
            if command == "log":
                return args[3]
            raise AssertionError(args)

        def commit_review(_root: Path, commit: str) -> Path:
            return first_review if commit == "first-sha" else second_review

        def review_result(_root: Path, path: Path, _source: str) -> dict:
            return {"impact_flags": {"bug_fix": path == second_review}}

        with (
            patch.object(validate, "git_text", side_effect=git_result),
            patch.object(validate, "validate_commit", side_effect=commit_review),
            patch.object(
                validate, "validate_review_file", side_effect=review_result
            ) as validate_review,
            patch.object(validate, "validate_commit_type_flags") as validate_type,
        ):
            result = validate.validate_github_merge_review(root, "HEAD")

        self.assertEqual(result, second_review)
        self.assertEqual(validate_review.call_count, 2)
        self.assertEqual(validate_type.call_count, 2)

    def test_rejects_a_merge_without_exactly_two_parents(self) -> None:
        root = Path("/repository")

        def git_result(_root: Path, *args: str) -> str:
            if args[0] == "rev-parse":
                return "merge-sha"
            if args[0] == "show":
                return "Merge pull request #567 from owner/fix-review"
            if args[0] == "rev-list":
                return "merge-sha parent-sha"
            raise AssertionError(args)

        with (
            patch.object(validate, "git_text", side_effect=git_result),
            self.assertRaisesRegex(
                validate.ContractError, "exactly two merge parents"
            ),
        ):
            validate.validate_github_merge_review(root, "HEAD")

    def test_rejects_a_merge_when_head_points_to_another_review(self) -> None:
        root = Path("/repository")
        review_path = root / "governance/reviews/CHG-example.yaml"
        other_review = root / "governance/reviews/CHG-other.yaml"

        def git_result(_root: Path, *args: str) -> str:
            if args[0] == "rev-parse":
                return "merge-sha"
            if args[0] == "show":
                return "Merge pull request #567 from owner/fix-review"
            if args[0] == "rev-list":
                if "--parents" not in args:
                    return "head-sha"
                return "merge-sha base-sha head-sha"
            if args[0] == "diff-tree":
                return "governance/reviews/CHG-example.yaml"
            if args[0] == "log":
                return "head-sha"
            raise AssertionError(args)

        with (
            patch.object(validate, "git_text", side_effect=git_result),
            patch.object(validate, "safe_repo_path", return_value=review_path),
            patch.object(validate, "validate_commit", return_value=other_review),
            self.assertRaisesRegex(
                validate.ContractError, "merge review set does not match"
            ),
        ):
            validate.validate_github_merge_review(root, "HEAD")
