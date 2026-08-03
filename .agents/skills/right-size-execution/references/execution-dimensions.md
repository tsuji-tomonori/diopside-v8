# 実行profileの四軸

実行規模を一つの段階値に畳み込まず、次を独立に決めます。

| 軸 | 値 | 判断対象 |
|---|---|---|
| scope | local / module / repository | 読取・変更・機能検証の広さ |
| assurance | standard / elevated / critical | 失敗影響に対して必要な保証の深さ |
| compute | economy / standard / capable と reasoning effort | 意味判断に必要な計算資源 |
| mode | direct-edit / agent / agent-with-review | 実行と独立reviewの構成 |

高リスクはscopeを広げる理由ではありません。認可の一行修正は`local + critical`、全体の機械的renameは`repository + standard`になり得ます。

## 決定特徴

- scope: 明示path、想定ファイル数、module・domain数、依存metadata、契約影響
- assurance: risk tag、成果物、外部副作用、不可逆性、データ分類
- compute: 機械的変更か意味判断か、制約間相互作用、失敗した試行の具体的証拠
- mode: assurance floor、独立reviewの必要性、作業の分割可能性

検証集合は`scopeの機能検証 ∪ assuranceの追加検証 ∪ 受入条件 ∪ repository必須gate`として決定的に導出します。

confidenceはモデルの自己申告値ではありません。`deterministic-features-v1`が観測できた特徴をlow／medium／highへ分類し、校正済みrouterを導入するまでは`score=null`とします。

この四軸は初期profileを表します。実行中の拡張では、初期`mode`を`review`へ分解し、初期profileから導出された`verification`を独立に追跡するため、`scope`、`assurance`、`verification`、`review`、`compute`の五つを拡張controlとして扱います。軸体系の矛盾ではなく、初期選択と実行中制御の粒度差です。
