# Expand契約

初期profileを覆す新しい証拠がある場合だけ、一回につき一軸を拡張します。

許可理由:

- `verification-failed`
- `impact-surface-exceeded`
- `dependency-discovered`
- `contract-impact-discovered`
- `assurance-floor-insufficient`
- `requirements-conflict`
- `evidence-insufficient`
- `compute-insufficient`
- `review-required`

拡張軸は`scope`、`assurance`、`verification`、`review`、`compute`です。dependencyは軸ではなくscope拡張の証拠です。

一律の回数上限は設けません。代わりに、同一failure signature、新証拠のない反復、同一軸の無変化、情報不足をモデル能力で補おうとする挙動をstagnationとして拒否または警告します。`compute`の引上げには`compute-insufficient`の直接証拠が必要です。
