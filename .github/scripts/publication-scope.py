"""Classify the actual tree delta of a PR merge or push (fail closed)."""
import re
import subprocess
import sys


def classify(base, head):
    if not base or set(base) == {"0"}:
        return "full"
    delta = subprocess.check_output(
        ["git", "diff", "--raw", "-z", "--no-renames", base, head, "--"]
    ).split(b"\0")
    paths = []
    for metadata, path in zip(delta[::2], delta[1::2]):
        old_mode, new_mode, _, _, status = metadata.lstrip(b":").split()
        paths.append((old_mode, new_mode, status, path))
    if not paths:
        return "full"
    video = rb"content/videos/[A-Za-z0-9_-]{11}\.json"
    archive = rb"(?:content/content-manifest\.json|governance/reviews/CHG-[A-Za-z0-9-]+\.yaml|" + video + rb")"
    if any(re.fullmatch(video, path) for *_, path in paths) and all(
        old in (b"000000", b"100644") and new == b"100644"
        and status in (b"A", b"M") and re.fullmatch(archive, path)
        for old, new, status, path in paths
    ):
        return "archive"
    generated = rb"(?:public/data/.+|src/generated/release\.ts|docs/(?:(?:assets|data)/.+|index\.html|404\.html|\.nojekyll|third-party-notices\.txt))"
    if all(
        old in (b"000000", b"100644") and new in (b"000000", b"100644")
        and re.fullmatch(generated, path) for old, new, _, path in paths
    ):
        return "generated"
    return "full"


if __name__ == "__main__":
    print(classify(sys.argv[1], sys.argv[2]))
