"""Binary-fuse8 membership filter: the no-false-negatives guarantee + a sane FP rate.

(Cross-language byte-identity with the TS reader is validated out-of-band; here we pin the
properties the gameplay logic relies on: a real key is NEVER rejected.)
"""
from __future__ import annotations

from apps.gamedata.membership import build_filter, filter_contains


def test_no_false_negatives_and_low_fp_rate() -> None:
    present = [f"taxon name {i}" for i in range(20000)] + ["honey bee", "panthera leo", "wallabies"]
    blob = build_filter(present)

    # The core safety property: every inserted key is reported present (no false negatives).
    assert all(filter_contains(blob, k) for k in present)

    # Absent keys are mostly rejected; the false-positive rate is ~0.39% (binary-fuse8).
    absent = [f"definitely absent {i}" for i in range(20000)]
    fp = sum(filter_contains(blob, a) for a in absent) / len(absent)
    assert fp < 0.02, f"false-positive rate too high: {fp}"


def test_filter_is_deterministic() -> None:
    keys = [f"k{i}" for i in range(5000)]
    assert build_filter(keys) == build_filter(list(reversed(keys)))


def test_empty_and_tiny_sets_build() -> None:
    # The loader builds a filter even for tiny scopes (hybrid test fixtures); must not crash.
    for n in (0, 1, 2, 3):
        blob = build_filter([f"x{i}" for i in range(n)])
        assert all(filter_contains(blob, f"x{i}") for i in range(n))
