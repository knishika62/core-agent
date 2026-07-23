# my-agent

[antirez/ds4](https://github.com/antirez/ds4)の`ds4_agent`(エージェントハーネス、CLI/tool-use loop等を持つ。
todo/memory機能は実際には無い、下記調査ログ参照)を、LLMバックエンドを差し替え可能にする形で作り直すプロジェクト。
2026-07-23、LTX-timelineプロジェクトのセッション内での雑談から着想し、別プロジェクトとして開始することになった。

判明した事実は都度このファイル(または適切な箇所)に追記していく運用とする。

**2026-07-23〜**: 単発の調査レポート・メモ書きの類は`md/`フォルダ配下に置く。CLAUDE.md本体は、
プロジェクトの背景・決定事項・実装状況など「常に参照すべき生きた記録」に絞り、詳細な調査ログや
込み入った経緯は`md/`側のファイルとして分離した。必要な時は都度`md/`配下を参照すること:
- `md/investigation-ds4_agent.md` — ds4_agent.c調査ログ
- `md/investigation-ds4_server.md` — ds4_server.c調査ログ
- `md/tool-spec.md` — ツール群(read/write/edit/search/bash系/google_search/visit_page)の仕様棚卸し
- `md/google-search-bot-detection.md` — google_search実装とbot検知まわりの一連の経緯・最終方針

## 背景・元ネタ

- 元コードは `/Volumes/SSD1TB/ds4`(外付けSSD、gitリポジトリ)。**このフォルダには一切書き込まない**(参照専用)。
- `ds4.c`(推論エンジン本体)は`AGENT.md`に明記されている通り「DeepSeek V4 Flash specific inference engine.
  It is not a generic GGUF runner」——MoEルーティング・テンソル形状までこのモデル専用に書かれたMetal/CUDAカーネル。
  **エンジン自体を汎用化する話ではない**(そこは今回のスコープ外)。
- `ds4_agent.c`(11,185行)がハーネス部分。`ds4_chat_append_message(engine, ...)`のように`ds4.h`のengine構造体に
  **in-process直結**しており、HTTP/curl/api_key等の外部API呼び出しは一切無い(grep 0件で確認済み)。
  つまり現状は、ネイティブエンジンを直接ドライブする以外の経路が存在しない。
- 一方`ds4_server.c`は既に「OpenAI/Anthropic compatible HTTP API」サーバーを実装済み(README/AGENT.mdより)。

## ハーネスに対する考え方(設計哲学、2026-07-23、ユーザー明言)

**「ハーネスってそもそもそういうもの。みんな無駄に機能を詰め込んで肥大化し過ぎ」**——これが
このプロジェクト全体を貫くユーザー自身の設計哲学。ハーネス本来の役割は「LLMとツール実行を
つなぐ最小限のループ」を提供することであり、それ以上の機能(メール送信・画像生成・天気API・
特定のワークフロー等)は本質的に無限に増え続けるドメイン固有の話。それをcoreに全部抱え込もうと
すると、汎用ハーネスとしての本体が特定用途に肥大化・特化していってしまう。

**「coreに入れたら意味が無い、skillだから何でもできる」**——skill機構(まだ未実装、
「今後のアイディアメモ」参照)さえきちんと作れば、「何でも足せる」拡張性はskill側に逃がせて、
core自体はずっと小さく汎用のまま保てる。これが今回、拡張候補(Hooks/サブエージェント/LSP/MCP)の
中でMCPを見送り、メール・天気・ComfyUI連携等のドメイン固有機能を全てskillとして切り出す方針に
した最大の理由であり、プロジェクト全体で最も重視すべき軸。

一次実装のcore(11+1ツール、tool-use loop、context圧縮、確認ゲート)が約2,300行に収まっているのも、
「機能を絞ったから小さい」のではなく、「ハーネスが本来持つべき責務だけに絞ったら自然とこの
大きさになった」という結果論に近い。

## やりたいこと

1. **LLMバックエンドの差し替え可能化**: ハーネス(tool-use loop・todo・memory・REPL等)を、
   ネイティブds4エンジンへのin-process呼び出しから、任意のOpenAI互換HTTPエンドポイントを叩ける形に
   抽象化する。LTX-timelineプロジェクトの`LLM_MODEL`/`OPENAI_BASE_URL`(`.env`で差し替え)と同じ発想。
2. **Vision自動ルーティング**: 通常はテキスト特化モデルで回し、画像(スクショ・添付・ツール結果の画像)が
   絡むターンだけVision対応モデルに自動的に一時切り替えする。
   - **モデル選定方針(重要)**: 通常運用は**速度よりコーディング性能を優先**(多少遅くてもよい)。
     理由: コーディング性能が高いモデル(DeepSeek系・GLM系等)は軒並みVision非対応であることが多いため、
     Visionは「メインモデルの機能不足を補うフォールバック」という位置づけ。

## 設計決定: Vision自動ルーティング(2026-07-23)

**Visionを合成tool callとして実装する**方式に決定。メインモデルに`view_image(path_or_url, question)`
という常時利用可能なツールを渡しておき、メインモデルが画像を見る必要があると判断したら通常のtool call
として呼ぶ。ツール実装内部でVisionモデルに`質問+画像`だけを渡して問い合わせ、返ってきたテキストの
説明をそのまま「ツール結果」としてメインモデルの`messages`に返す。

**理由**: 検知(メインモデル自身のtool call判断に委ねるため推測ロジック不要)・コンテキスト引き継ぎ
(質問+画像だけで済み全履歴を渡す必要がない)・統合(既存tool-use loopにそのまま乗る)の3つの課題を
同時に解消でき、既存構造への追加コストが最小。

**確認済みのスコープ限定(ユーザー確認)**:
- 主な用途は画像のみ(音声・映像対応モデルもあるが今回は主用途から対象外)
- セッション(会話履歴)をVisionモデル側に引き継ぐ必要はない。画像の内容をtextで説明させて
  メインモデルに戻すだけの一問一答的ツールでよい。

## 調査ログ(要約 — 詳細は`md/`参照)

- **ds4_agent.c**(11,185行): engineへのin-process呼び出しは3経路に集約(`worker_run_turn`他)。
  会話履歴は「トークン列」でありメッセージ配列ではない。tool-use loopは独自DSML/GLMタグ形式。
  Vision・todo・永続memory機能は無い。詳細 → `md/investigation-ds4_agent.md`
- **ds4_server.c**(約17,538行): 自前HTTPサーバー実装。OpenAI/Anthropic両エンドポイント対応、
  streaming・tool_calls実装済みだが認証機構なし。messages→トークン変換はds4_agent.cと別実装。
  詳細 → `md/investigation-ds4_server.md`
- **ツール仕様棚卸し**: read/write/edit/list/search/bash系/google_search/visit_pageの11ツール。
  詳細 → `md/tool-spec.md`

## 方針決定

- **2026-07-23決定**: ハーネス側は汎用のOpenAI互換HTTPクライアント抽象化層を独立実装する
  (`ds4_server.c`を踏み台/特別扱いにはしない)。
  **理由**: `ds4_server.c`は既に標準的なOpenAI互換API(`/v1/chat/completions`等)を喋るため、
  汎用クライアント層さえ作れば`ds4_server.c`は追加の特別対応なしに「接続先の一つ」として
  自動的に使えるようになる。逆に`ds4_server.c`固有の癖に依存する設計にすると、
  CLAUDE.md冒頭の本来のゴール(任意のOpenAI互換エンドポイントへの差し替え可能性)からズレるリスクがある。
  LTX-timelineの`LLM_MODEL`/`OPENAI_BASE_URL`方式と同じ発想。

- **2026-07-23決定**: 実装言語は**Node/TypeScript**。C継続は不採用。
  **理由**: HTTP+JSON越しの設計になった時点でCの強み(engineへのin-process直結)が消え、
  自前JSON/HTTPパーサ等のコストだけが残るため([[#方針決定]]参照)。Python案もあったが、
  「後になってNodeにしたくなりそう」という判断で最初からNodeに決定。
- **visit_page相当のツールもNode化可能**: `ds4_web.c`を調査した結果、`visit_page`ツールは
  単純HTTP fetchではなく**実際にChromeプロセスを起動しChrome DevTools Protocol(CDP)を
  WebSocket越しに叩いて**動的ページのナビゲーション/JS実行/スクロールを行う本格実装だった
  (`web_chrome_executable`, `web_cdp_navigate`, `web_cdp_eval_string`, `web_scroll_dynamic_page`等)。
  Node版では自前CDP実装は不要で、**Puppeteer/Playwright**で同等以上の機能を代替可能。

## 次にやること

1. ~~`ds4_agent.c`のtool-use loop・メッセージ送信箇所の構造把握~~ → 完了(上記調査ログ参照)
2. ~~`ds4_server.c`の構造・OpenAI/Anthropic互換範囲の把握~~ → 完了(上記調査ログ参照)
3. ~~接続方式の方針決定~~ → 完了(上記「方針決定」参照。独立HTTPクライアント層を実装する)
4. ~~HTTP経由の汎用バックエンド+Visionルーティングの設計~~ → 完了
   (データモデル/tool-use loop/セッション永続化/Vision自動ルーティング、上記各セクション参照)
5. ~~実装言語決定~~ → 完了(Node/TypeScript。上記参照)
6. ~~各ツール実装(read/write/edit/search/bash/google_search/visit_page)の仕様棚卸し~~ → 完了
   (上記「ツール群の仕様棚卸し」参照)
7. ~~Node/TSプロジェクトのスキャフォールディング~~ → 一次実装完了(2026-07-23、下記「実装状況」参照)
8. ~~セッションのCLI組み込み~~ → 完了(下記参照)
9. ~~Anthropic `/v1/messages`形式対応~~ → 完了(下記参照)
10. ~~Vision実エンドポイントでの動作確認~~ → 完了(下記参照)
11. ~~実運用しながらのUX改善(色分け・`/help`・`!`コマンド・Markdownビューア・画像D&D対応・
    `/exit`時のChrome終了・`/list`)~~ → 完了(下記各セクション参照)
12. ~~ds4_agentとの機能ギャップ整理~~ → 完了(「ds4_agentとの機能ギャップ整理・`/list`実装」
    セクション参照)。実装可能なギャップは埋まり、残りは構造的に対象外と結論
13. 現状、設計・棚卸し・実装・実運用テストは一通り完了。残りは日本語IME問題(保留中、
    「日本語IMEの折り返し問題」セクション参照)への対応要否の判断と、ロングランでの安定性確認

### Vision実エンドポイント設定・動作確認(2026-07-23)

- `.env`の`VISION_BASE_URL`/`VISION_API_KEY`/`VISION_MODEL`に、LTX-timelineの`.env`内
  コメントアウトされていたローカルパイプラインLLM(`http://192.168.11.100:8888/v1`、
  `sakamakismile/Ornith-1.0-35B-NVFP4`、`LLM_API_KEY=DUMMY`)を設定。
  メイン(`opencode.ai`のdeepseek-v4-flash)とは別エンドポイントで、この構成が
  当初の設計方針([[#設計決定-vision自動ルーティング2026-07-23]])通り
  「メインはテキスト特化・重い処理はfallback」の実例になっている。
- 疎通確認: `curl /v1/models`でHTTP 200、モデルID一致を確認。
- `view_image`ツールの実エンドポイントでのend-to-end動作確認: 赤い正方形のPNGを生成して
  質問したところ`"Red"`と正しく回答。Vision as tool call設計([[#設計決定-vision自動ルーティング2026-07-23]])
  が実際に機能することを確認済み。

## 実装状況(2026-07-23)

Node/TypeScriptでプロジェクトを起こし、以下を実装・型チェック・ツール単体smoke test済み:

- `package.json`/`tsconfig.json`: ESM, Node標準`fetch`使用(追加HTTPライブラリ不要)、`tsx`でdev実行
- `.env.example`: `OPENAI_BASE_URL`/`LLM_MODEL`(メイン)、`VISION_BASE_URL`/`VISION_MODEL`(Vision、
  LTX-timelineの`.env`差し替え方式を踏襲)
- `src/types.ts`: `Message`(role/content/toolCalls/toolCallId)・`ToolCall`・`ToolDefinition`・
  `ToolResult`の型定義。[[#調査ログ]]で決めた「messages配列モデル」を反映
- `src/llmClient.ts`: `chatCompletion`(非streaming、Visionツール用)と`chatCompletionStream`
  (SSE、メインturn用)。OpenAI互換`/v1/chat/completions`のみ対応(Anthropic形式は現状未対応)
- `src/agent.ts`: `runTurn` — ds4_agent.cの`worker_run_turn`相当のtool-use loop。
  `config.maxToolRounds`(既定50)で無限ループgarde
- `src/tools/`: `context.ts`(ToolContext=cwd/moreState/bashJobs)、`read.ts`/`write.ts`/`list.ts`/
  `edit.ts`/`search.ts`/`bash.ts`/`viewImage.ts`、`index.ts`(JSON Schema定義+dispatch)。
  [[#ツール群の仕様棚卸し]]の仕様に準拠(read 16MB拒否、edit `[upto]`アンカー、bashのhead/tail
  差分観測、write無条件上書き等)。**bashは子プロセスのexit eventベースで実装**(C版のような
  手動waitpidポーリングではなくNode流に書き直し、observationフォーマット/タイムアウト/
  SIGTERM→SIGKILLの挙動は仕様通り)
- `src/session.ts`: messages配列をJSONファイルに保存/読込(KVキャッシュ不要という設計方針の実装)
- `src/cli.ts`: 簡易REPL(`/exit`で終了)

### セッションのCLI組み込み(2026-07-23実装)

- `cli.ts`起動時に`--session <name>`引数(既定`"default"`)でセッション名を指定。既存の
  `sessions/<name>.json`があれば`loadSession`で再開、無ければ新規system promptで開始。
  各ターン完了後に自動保存(`saveSession`)。`/reset`コマンドでセッションを空にリセット可能。
- `session.ts`に**パストラバーサル対策**を追加(`path.basename(name) !== name`なら拒否)。
  `--session`はユーザー入力なので`../evil`等を弾く必要があった。動作確認済み(round-trip・
  トラバーサル拒否とも正常)。

### Anthropic /v1/messages対応(2026-07-23実装)

- `llmClient.ts`に`protocol: "openai" | "anthropic"`を追加(`EndpointConfig`)。
  `LLM_PROTOCOL=anthropic`(`.env`)で切り替え、既定は`"openai"`(後方互換)。
  `config.main.protocol`経由で`agent.ts`の`runTurn`に伝播。
- 変換ロジック(`toAnthropicMessages`): 内部の`messages配列`(system/user/assistant/tool)を
  Anthropic形式(system別出し、tool役割は無くuserメッセージ内`tool_result`content blockとして
  畳み込み、assistantのtool_callsは`tool_use`content block)に変換。連続する`role:"tool"`
  メッセージは1つのuserメッセージにまとめる(Anthropic APIの制約に対応)。
  `chatCompletion`/`chatCompletionStream`の両方でOpenAI/Anthropicを分岐。
- Anthropic側SSEイベント(`content_block_start`/`content_block_delta`/`message_delta`等)の
  パーサも実装。text_delta・input_json_deltaの蓄積・stop_reason取得に対応。
- **検証方法**: 実際のAnthropic APIキーが手元に無いため、`global.fetch`をモックしてSSEイベント列を
  返す結線テストで検証(リクエスト形式・ストリームパース・tool_use抽出まで一通りPASS確認)。
  実クレデンシャルでのend-to-endは未検証。
- Vision(`view_image`)は現状OpenAI形式決め打ちのまま(`viewImage.ts`はllmClient.tsを介さず
  直接fetch)。Anthropic Vision対応が必要になったら要拡張。

### google_search / visit_page(2026-07-23実装、Puppeteer導入)

`puppeteer-core`でインストール済みChromeを操作。`visit_page`は動作確認済み。`google_search`は
実装当初Googleのbot検知に引っかかったが、原因は「新規プロファイルだから」と判明し、
最終的に「初回のみユーザーに実ブラウジングを促す案内を出し、以降は自前で育てたプロファイルで
自然に通す」設計に落ち着いた(ds4依存の自動シードは筋が悪いとして撤回済み)。
一連の調査・試行錯誤・最終方針の詳細 → `md/google-search-bot-detection.md`

## 「もっとアイディアを出して」への対応(2026-07-23)

ユーザーから「LTX-timelineの時もそうだったが、ほぼユーザーが指示しアシスタントは実装するだけになっている、
もっとアイディアを出してほしい」というフィードバックを受け、以下をこちらから提案し、ユーザーが
「破壊的操作の安全弁」「context圧縮」「自動テスト整備」「プロジェクト指示ファイル自動読込
(CLAUDE.md相当)」の4つを採用(REPL上でのモデル動的切替は不要、との回答。理由: 個人利用で
扱うモデル数はそう多くないため`.env`のメイン/Vision設定で足りる)。plan modeは別途検討することに。
このフィードバック自体は`~/.claude/projects/.../memory/feedback_be_proactive.md`と
`feedback_propose_solutions.md`にグローバルなfeedback memoryとして保存済み(このプロジェクト固有ではなく
セッション横断で適用する行動指針のため)。

### 破壊的操作への安全弁(2026-07-23実装)

- `src/tools/context.ts`に`ConfirmFn`型と`ToolContext.confirm`(オプショナル)、
  および`requireConfirmation(ctx, tool, description, preview?)`ヘルパーを追加。
  `ctx.confirm`が未設定(既定)なら何もせず素通り——テストやプログラム的呼び出しは今まで通り無確認で動く。
- `write.ts`(上書き前)・`edit.ts`(書き込み前、old/newのdiffをpreviewとして渡す)・`bash.ts`
  (プロセス起動前、コマンド文字列を渡す)の3ツールに確認ゲートを追加。
- `cli.ts`で`ctx.confirm`をreadlineのy/N質問に配線。`--yes`/`-y`起動フラグで確認を全スキップ
  (=事実上のauto mode)。
- ユーザーが却下した場合は`Tool error: <tool> was not approved by the user.\n`をモデルに返し、
  実際の副作用(ファイル書き込み・プロセス起動)は発生しない。

### context圧縮/compaction(2026-07-23実装)

- ds4_agent.cの`agent_worker_compact`相当。`src/compaction.ts`に実装。
  - トークン数は`chars/4`の粗い推定(`estimateTokens`、実トークナイザ非依存)。
  - `config.maxContextTokens`(`.env`の`MAX_CONTEXT_TOKENS`、既定60,000)を超えたら発火。
  - `findSafeCutIndex(messages, minKeep)`: system prompt(index0)は必ず残し、末尾`minKeep`件
    (既定10)より手前で最初に現れる`role:"user"`メッセージの位置で切る。user役割は常に新規ターンの
    開始でtoolCallsを持たないため、assistantのtool_calls⇄tool結果のペアを分断する心配がない、
    という安全性を保証する設計。
  - 切り出した古い範囲をLLMに要約させ(`chatCompletion`非streaming呼び出し)、1つの
    `role:"user"`メッセージ(`[Earlier conversation summary, N messages compacted]`見出し付き)に
    置き換える。`messages.splice`で**配列を破壊的に変更**(参照を保つことで`cli.ts`の
    セッション永続化・呼び出し元の変数と自動的に同期)。
  - `agent.ts`の`runTurn`ループ先頭で毎ラウンド`maybeCompact(messages)`を呼び、圧縮発生時は
    `options.onCompact`コールバックでCLIに通知。

### 自動テスト整備(2026-07-23実装、vitest導入)

- `vitest`を追加、`npm test`(`vitest run`)で実行。**53件全てPASS**確認済み(10ファイル)。
- カバー範囲: `edit.test.ts`(一意マッチ・非一意エラー・`[upto]`アンカー・tailスコープ限定・
  複数`[upto]`エラー・confirmゲート)、`read.test.ts`(whole/truncate+more継続/raw/エラー系)、
  `write.test.ts`(新規・上書き・confirmゲート)、`list.test.ts`、`search.test.ts`
  (literal/regex/バイナリ除外/.git除外/大小無視/エラー系)、`bash.test.ts`
  (実行・タイムアウトkill・bash_status/bash_stop・confirmゲート、実プロセスを使うため
  タイムアウト値は短め)、`session.test.ts`(round-trip・パストラバーサル拒否)、
  `compaction.test.ts`(`findSafeCutIndex`の安全境界ロジック・`maybeCompact`のmocked fetch経由
  end-to-end)、`llmClient.test.ts`(OpenAI/Anthropic双方のSSEパース・tool_calls/tool_use抽出・
  連続tool結果メッセージの畳み込み)、`projectInstructions.test.ts`。
- 従来の使い捨て`_e2e_*.ts`スクリプトによる検証パターンから、正式なテストスイートに移行。
  今後の変更はここに追加していく。

### プロジェクト指示ファイル自動読込(2026-07-23実装、CLAUDE.md相当)

- `src/projectInstructions.ts`: `loadProjectInstructions(cwd)`が`AGENT.md`/`AGENTS.md`/`.agent.md`
  を順に探し、最初に見つかった空でないファイルの中身を返す(Claude Code自身のCLAUDE.md自動読込に相当)。
  `buildSystemPrompt(base, instructions)`でbase system promptに`# Project instructions`見出し付きで合成。
  未実装だったこの機能により、my-agentは今回のプロジェクトのような「CLAUDE.mdを都度読ませる」
  手動運用ではなく、起動時の自動読込に対応した。
- `cli.ts`で起動時に読み込み、新規セッションのsystem promptに反映。**再開セッションでも毎回
  system prompt(index 0)を最新の指示ファイル内容で上書き**する設計(指示ファイルが変更されている
  可能性を考慮)。`/reset`時も同様。

## 初めての`cli.ts`通しend-to-end動作確認・バグ修正(2026-07-23)

それまでの検証はツール単体・`runTurn`直接呼び出しが中心で、**`cli.ts`(実際のエントリポイント)を
通しで動かしたことが無かった**。「もう動く?」というユーザーの質問をきっかけに実際に動かしたところ、
2つ見つかった:

- **バグ**: パイプ入力(非対話的stdin)で`ERR_USE_AFTER_CLOSE`により最初の1行すら処理されず終了。
  原因は`createInterface`から最初の`rl.question()`呼び出しまでの間(`loadProjectInstructions`/
  `loadSession`のawait)にパイプ入力がEOFに達し、`.question()`ベースのやり取りだと
  バッファされた行を取りこぼす(readlineのpromise版`.question()`はTTY前提の設計で、
  非TTYの一括流入データとは相性が悪い)。対話端末での通常利用では発生しないが、
  スクリプト/CI/自動テストのようなパイプ利用では確実に踏む。
  **修正**: `stdin.isTTY`で分岐し、非TTY時は`rl[Symbol.asyncIterator]()`での行読み取りに切り替え。
  EOFは`null`を返して正常終了扱いにする(`nextLine()`ヘルパーに集約)。
- **未整備だった点**: 確認ゲート(`ctx.confirm`)が非TTY環境でどう振る舞うか未定義だった。
  修正で「非TTYでは確認できないので拒否し、`--yes`を使うよう促すメッセージを出す」動作に統一。

**動作確認**(修正後、実際にLLMエンドポイント相手に`cli.ts`をパイプ実行):
1. `--yes`ありで「ファイル一覧を教えて」→ `list`ツール実行→モデルが要約→セッションJSON
   (system/user/assistant+toolCalls/tool/assistant の5メッセージ)が正しく保存されることを確認
2. `--yes`無しで「ファイルを書いて」→ `write`が自動拒否され、ファイルは作られず、
   モデルが拒否を理解してユーザーに承認を求める応答を返すことを確認(`bash`での回避策提案も
   一緒に拒否され、副作用ゼロのまま応答が完結)

## 実運用テスト: 「PC Watchの概要をレポート」(2026-07-23、ユーザー実施)

ユーザーが対話モードで実際に使ってみたところ、以下が一度に確認できた:

- **`google_search`がbot検知に引っかからず成功**。新規プロファイル向けウォームアップ設計
  ([[#新規プロファイル向けウォームアップ案内]]参照)が想定通り機能し、`~/.my-agent/browser`が
  それまでの操作で育ってきていることの実証になった。
- **head+一時ファイルパターンが実利用で機能**: `visit_page`が長いページを`<head -100 ...>`で
  切り詰めて返し、モデル自身が`read`ツールで`start_line=100`から続きを自発的に読みに行った。
  ds4_agent.c由来の設計([[#ツール群の仕様棚卸し]]参照)がトークン節約の実シーンで再現できている。
- **複数ツールの自律的な連携**: `visit_page`(対象サイト)→`read`(続き)→`google_search`
  (補足情報)→`visit_page`(Wikipedia)→`visit_page`(広告資料ページ)→レポート統合、という
  一連の調査行動をモデルが自律的に組み立て、表形式を含む構成の整ったレポートを生成した。

## CLI出力の色分け・`/help`コマンド追加(2026-07-23)

上記テストの副産物として、「ユーザー入力とエージェント出力が同じ色で区別しづらい」という
フィードバックを受けて対応。

- `src/cliColors.ts`を新規追加。ANSIエスケープで`color.user`(太字シアン、入力プロンプト)・
  `color.agent`/`rawColor`(太字白、エージェント応答)・`color.dim`(グレー、tool call/result・
  システム情報)・`color.warn`(黄、確認プロンプト)・`color.error`(赤)を定義。
  **`stdout.isTTY`でないとき、および`NO_COLOR`環境変数が立っているときは自動的に無効化**
  (パイプ/ログ出力にエスケープコードが混ざらないようにするため)。
- `cli.ts`のプロンプト・ストリーミング応答・tool call/result・確認ゲート全てに配線。
- ついでに、**`/help`が実は登録済みコマンドではなく通常のユーザーメッセージとしてモデルに
  送られていた**(ユーザーが`/help`と打った際、モデルが自分でツール一覧を説明する応答を
  即興で生成していた)ことに気づき、ローカルで完結する本物の`/help`コマンドを追加。
  REPLコマンド一覧+`toolDefinitions`からツール一覧を表示し、**モデル呼び出しを消費しない**。
- 動作確認: `/help`がLLMリクエストを発生させずローカル応答することを確認。色分けは
  疑似TTY(`script`コマンド)経由でANSIコードの発火(dim/bold white等)を確認済み。

## ビルド成果物にテストが混入するバグ修正(2026-07-23)

CLI色分けの動作確認中、テストが53件→106件に倍増していることに気づいた。原因は`npm run build`
(`tsc -p tsconfig.json`)が`*.test.ts`もコンパイルして`dist/`に出力しており、vitestが
`src/`と`dist/`の両方からテストを拾って二重実行していたため。

- **修正**: `tsconfig.build.json`(`tsconfig.json`を継承し`src/**/*.test.ts`を除外)を新設し、
  `package.json`の`build`スクリプトをこちらに向けた。型チェック用の`tsconfig.json`本体は
  従来通りテストも含めてチェックする(テストコードの型安全性は引き続き担保)。
  さらに`vitest.config.ts`で`include: ["src/**/*.test.ts"]`を明示し、
  仮に`dist/`が古いビルドのまま残っていても拾わないよう二重に対策した。
- 動作確認: `npm run build`後、`dist/`に`*.test.*`が一切生成されないこと、
  `vitest run`が53件(重複なし)に戻ることを確認。

## `!`コマンド(shell passthrough)追加(2026-07-23)

ユーザーから「ds4では`!`コマンドが使えたが、これは?」と質問があり、`ds4_agent.c`を調査したところ
**該当機能は存在しなかった**(`!`によるshell-passthroughの実装はgrep 0件。スラッシュコマンドは
`/help`/`/save`/`/compact`/`/list`/`/power`/`/quit`/`/exit`のみ)。恐らくClaude Codeセッション
自体の`! <command>`機能との記憶混同。ただし有用な機能なので、my-agentに独自追加することにした。

- 「フォルダ移動(`!cd xxxx`)に一番使う」という要望を踏まえ、`cd`だけは特別扱いが必要だと判断:
  `!cd xxx`を子プロセス(`bash -c`等)で実行しても、その`cd`はサブプロセス内で完結してしまい、
  エージェント自体の作業ディレクトリには反映されない。
- `src/cli.ts`に実装。`!`で始まる入力はLLMを呼ばずローカルで処理:
  - `!cd [dir]`(引数省略時はホームディレクトリ): `path.resolve(ctx.cwd, dir)`で解決し、
    `process.chdir()`(プロセス自体のcwd)と`ctx.cwd`(全ツールがパス解決に使う値)の**両方**を
    更新。これでシェルコマンドだけでなく、以降の`read`/`write`/`list`等のツール呼び出しにも
    ディレクトリ変更が反映される。
  - `cd`以外は`execSync(cmd, { cwd: ctx.cwd, stdio: "inherit" })`でそのまま実行(出力は端末に
    直接ストリーム)。
  - `/help`のREPLコマンド一覧にも`!<command>`を追加。
- 動作確認: `!pwd`→`!cd /tmp`→`!pwd`で`/private/tmp`に変わることを確認。さらに`!cd /tmp`後に
  モデルへ`list`ツールを呼ばせたところ、実際に`/tmp`配下を見ていることを確認
  (`ctx.cwd`変更がツール実行系にも正しく伝播している)。

## 簡易Markdownビューア追加(2026-07-23)

「モデルの回答が生Markdownのまま出て人間には読みづらい、ds4でも不満点だった」という指摘を受けて
実装。ds4_agent.c側にも`renderer_*`系のMarkdown/シンタックスハイライト表示機構があった
([[#調査ログ]]参照)のと同様の位置づけ。

- **設計方針**: フルパース(文書全体を見ないと閉じフェンス等が分からない)ではなく、
  **行単位のストリーミング対応レンダラー**にした。ストリーミング表示の体験を保ったまま、
  「簡易でいい」という要望に対して十分な複雑度に抑える狙い。
- `src/cliColors.ts`にMarkdown用ANSIコードを追加(bold/italic/underline/strike/code(cyan)/
  codeBlock(green)/heading(bold+underline))。
- `src/cliMarkdown.ts`: `MarkdownStreamRenderer`クラス。`write(chunk)`で断片を受け取り、
  改行が来るたびに1行分をレンダリングして出力、未完の行は内部バッファに保持。`flush()`で
  未完バッファを強制出力(tool call/result表示の直前、ターン終了時に呼ぶ)。
  対応構文: 見出し(`#`〜`######`)、箇条書き(`-`/`*`/`+`→`•`)、番号付きリスト、引用(`>`)、
  水平線、フェンスコードブロック(``` ```` ```` ```` ```)、インライン`**bold**`/`*italic*`/`` `code` ``/
  `~~strike~~`/`[text](url)`。**テーブルは意図的に生テキストのまま**(「簡易ビューア」としての
  費用対効果でスコープ外に)。
- `ansiEnabled`(非TTY/`NO_COLOR`で自動無効)を`cliColors.ts`からexportし、無効時は
  `write()`が素通りでraw textを出力する(パイプ出力を汚さない)。
- `cli.ts`の`onTextDelta`を`renderer.write()`に、tool call/result/compact通知の直前と
  ターン終了後に`renderer.flush()`を呼ぶよう配線。
- **動作確認**: 疑似TTY(`script`コマンド)経由で、見出し(太字下線)・箇条書き(•)・**bold**・
  `inline code`(シアン)・フェンスコードブロック(green)が全て意図通りANSI装飾されることを確認。
  ユニットテストではなく実際のANSI出力の目視確認で検証(端末描画という性質上、この方が実効性が高いと判断)。

## 画像のドラッグ&ドロップ対応(2026-07-23)

「Visionで画像をドラッグ&ドロップできるか」という質問への対応。結論としては**元々概ね動く**
はずだった——iTerm2/Terminal.app等は画像をドロップするとファイルパスをテキストとして入力欄に
挿入するので、それをメッセージとして送ればsystem promptの指示(「画像は直接見えないので
view_imageを使う」)に従いモデルが呼び出せる。ただし1点抜けがあった:

- ターミナルはドロップしたパスをそのまま渡さず、**スペース等を`\ `でバックスラッシュエスケープ**
  するか、**シングル/ダブルクォートで囲む**(ターミナルアプリ依存)。`viewImage.ts`の
  `resolveImageUrl`はこの種のエスケープを一切考慮しておらず、`path.resolve`にそのまま
  渡すとファイルが見つからず失敗する状態だった。
- `cleanDroppedPath()`を追加し、前後の対応する引用符を1層だけ除去、バックスラッシュエスケープを
  展開(`\<char>` → `<char>`)してから`path.resolve`に渡すよう修正。URL判定は生の文字列に対して
  先に行う(URLにこの種のエスケープ処理は不要かつ副作用のリスクがあるため)。
- **動作確認**: スペース入りファイル名の画像に対し、(1)生パス、(2)`\ `エスケープ、
  (3)シングルクォート囲み、の3パターン全てで`view_image`が正しく画像を認識し
  (テスト画像の色を正答)することを確認。

## `/exit`後にプロセスが終了しないバグ修正(2026-07-23)

「`google_search`/`visit_page`でChromeが起動していると`/exit`で終わらず、Ctrl-Cが必要」という
報告への対応。原因は単純で、`getBrowser()`(`src/tools/browser.ts`)が起動したChromeプロセスを
**`cli.ts`側で一度も`closeBrowser()`していなかった**ため、Puppeteerが保持するCDP接続が
Node のイベントループを生かし続け、`main()`が return しても実プロセスが終了しなかった。

- **修正**: `cli.ts`の`main().catch().finally(() => closeBrowser())`で、正常終了・エラー終了
  どちらの経路でも`closeBrowser()`を呼ぶよう変更。`process.on("SIGINT", ...)`でもCtrl-C時に
  同様に`closeBrowser()`してから`process.exit(0)`するようにした(orphanプロセスやプロファイルの
  ロックファイル破損を避けるため)。
- **ユーザーからの重要な懸念**: 「それ、他の無関係のChromeも閉じませんか?」という指摘があり、
  推測で済ませず実際に検証した。
  - 検証方法: 事前に稼働中のChromeプロセス(通常使用分50個、うち`~/.ds4/browser`のds4用も含む)の
    PID一覧を取得→my-agentの`getBrowser()`を起動→新規PIDが`~/.my-agent/browser`のプロファイルで
    増えることを確認→`closeBrowser()`実行→(1)新規PIDが消えている、(2)事前に動いていた
    無関係なPIDが1つも消えていない、の両方をPID差分(`comm`)で確認。
  - **結果**: 新規PIDのみ正しく終了、既存の無関係なChrome(ds4用含む)は一切影響なし。
    Puppeteerの`browser.close()`は自身が`puppeteer.launch()`で起動した特定の
    `--user-data-dir`インスタンスのみをCDP経由で終了させる仕組みであるため、当然の結果ではあるが、
    「多分大丈夫」で済ませず実測で裏付けた。
  - 副次的な確認: `closeBrowser()`を呼ばずにNodeプロセスをkillした場合、子プロセスのChromeも
    一緒に終了する(orphan化しない)ことも確認済み——念のための安心材料。
- **実運用でも確認済み(ユーザー実施)**: `google_search`でChromeが起動している状態から`/exit`
  したところ、Chromeも含めて自動的に正常終了することを確認。修正が実際の利用シーンでも機能している。

## 実運用テスト: Vision・再起動後のセッション復元(2026-07-23、ユーザー実施)

- Visionが実利用でも正常に機能することを確認(`view_image`のend-to-end動作、
  「Vision実エンドポイント設定・動作確認」セクションの追試)。
- LLMエンドポイントが一時的に落ちた後(opencode.ai側の瞬断と思われる、こちらの実装起因ではなさそう)、
  my-agentを再起動したところ**セッションの会話履歴が正しく復元された**ことを確認。
  `--session <name>`指定時に`sessions/<name>.json`へ自動保存され、次回起動時に`loadSession`で
  再開する設計(「セッションのCLI組み込み」セクション参照)が実運用でも機能することの実証。

## 日本語IMEの折り返し問題(2026-07-23、対応保留)

「`ds4_agent.c`同様、日本語IME変換中の候補が右端で折り返すと表示が崩れる」という指摘。
原因はターミナル+IME側の描画がアプリの制御外で行われるため、readline(や、ds4の自前エディタである
linenoise改造版)のカーソル位置計算とずれること——**ds4も自前エディタを持ってなお未解決**という
事実が、アプリ側のコードだけでは根本解決しづらい種類の問題であることを示唆している。

対策として、ローカルWebサーバー+ブラウザ(`<textarea>`はIMEネイティブ対応)によるGUI化を検討し、
plan modeで実装方式(ローカルWebサーバー+ブラウザ推奨/Electron/Tauri)の選定に入りかけたが、
**「Claude Code自身も同じ制約(ターミナル+readline系)を抱えている」とユーザーが気づき、
my-agent固有の欠陥ではなく業界共通の根深い問題と判断、優先度を下げてこのタスクは保留**とすることに
なった。詳細は`~/.claude/plans/delightful-jingling-waterfall.md`(このセッションのplanファイル)参照。
再着手する際は、既存の`agent.ts`/`tools/`/`session.ts`/`compaction.ts`はフロントエンド非依存なので
そのまま再利用でき、`cli.ts`と並ぶ新しいプレゼンテーション層を追加する形になる想定。

## ds4_agentとの機能ギャップ整理・`/list`実装(2026-07-23)

ユーザーから「ほぼds4_agentに追いついた?」という問いを受け、機能ごとに棚卸しした。

**追いついた/並んだ**: ツール一式(11個)、context圧縮、セッション永続化(方式は別)、
簡易Markdown表示。
**+α(ds4に無い/上回った)**: バックエンド差し替え可能(本プロジェクトの主目的)、Vision、
破壊的操作の確認ゲート、プロジェクト指示ファイル自動読込、google_searchの明確なエラー化、
`!`コマンド。
**構造的に届かない/対象外と結論**: KVキャッシュによるprefill再利用(HTTP越しの設計では原理的に
不可、ユーザーも了承)、bot検知回避系の作り込み(コンフリクト対策そのものなので不要、との判断)、
think-mode/effort扱い(エンドポイント越しではモデル依存でパラメータが効いたり効かなかったりする
ため対応不可)、GPU電力管理(`/power`相当。engineを直接ドライブしないアーキテクチャなので無意味)。
**唯一の実装可能なギャップとして`/list`(セッション一覧)コマンドを追加**:

- `src/session.ts`に`listSessions()`を追加。`sessions/`配下の`*.json`を走査し、
  `{name, messageCount, updatedAt}`を新しい順(`mtime`降順)で返す。壊れた/非JSONファイルは
  一覧全体を落とさず個別にスキップ。
- `cli.ts`に`/list`コマンドを追加。現在のセッションに`*`マーカー、相対時刻表示
  (`just now`/`Nm ago`/`Nh ago`/`Nd ago`)付きで一覧表示。
- テスト3件追加(空配列、新しい順ソート+メッセージ数、非JSON/壊れたJSONのスキップ)、
  56件全PASS。実際のCLI経由でも複数セッション作成→`/list`で正しく一覧・マーカー・件数が
  出ることを確認。

## Claude Code/OpenCode級ハーネスとの規模比較・今後の拡張候補(2026-07-23)

「今動いているClaude CodeやOpenCodeもハーネスだが、規模が違いすぎる。何をやっているのか」という
問いから始まった議論。整理すると、**コアループ(messages配列+tool_calls+tool-use loop)自体は
同じ**で、規模の差は周辺機能の積み上げ量から来ている: (1) MCP/hooks/サブエージェント等の
拡張性インフラ、(2) ツール遅延ロード等のcontext管理の精緻さ、(3) 許可パターンのallow/deny等
安全機構の精緻さ、(4) LSP連携、(5) IDE拡張・複数プロバイダ対応等のエコシステム/配布面。

このうち(2)(3)(5)は「不特定多数のユーザー/環境で使われる」ことへの投資であり、個人の単一
セットアップ専用ツールであるmy-agentには基本的に不要、という結論になった(これまでのスコープ
判断——Search API不採用、REPL上のモデル動的切替不要、GUI化保留——と一貫している)。
一方(4) LSP連携は「多数のユーザー」ではなく「編集の正しさの機械的検証」という個人利用でも
価値がある性質のため、拡張候補として残すことにした。

**拡張候補の優先順位(簡単な順)を整理**:
1. **Hooks**(最も簡単): 既存の`!command`(execSync)パターンをほぼそのまま流用できる。
   設定ファイルでtool実行前後にコマンドを差し込むだけ。
2. **サブエージェント**(やや簡単): `view_image`(別モデルへの一問一答委譲)と同じ発想の一般化。
   `view_image`との違いは、ツールを持たない一問一答か、`runTurn()`をフル再帰させて複数ターンの
   tool-use loopを回せるか、の一点のみ——見積もりは当初想定より低い。ユーザーから
   「`view_image`は既に一種のサブエージェントでは」という指摘があり、この認識が確定した。
3. **LSP連携**(難しい): 実プロトコル実装が必要(`vscode-jsonrpc`等で負担軽減は可能)。
   最初はTypeScript限定に絞れば現実的な規模に収まる想定。
4. **MCP対応**: **当面見送り**。ユーザーからの実利用イメージは「MySQL連動程度」で、
   その用途なら既存の`bash`ツール(`mysql -e "..."`)や専用ツール1個の追加で十分であり、
   MCPプロトコル一式(JSON-RPC・複数サーバー管理・動的スキーマ変換、アーキテクチャ全体に
   影響する規模)を実装するコストに見合わないと判断。

**結論**: 次に着手するなら**Hooks→サブエージェント→LSP(TS限定)**の順。MCPはロードマップから
一旦外す。いずれも今回のセッションでは未着手(議論・優先順位整理のみ)。

**補足(2026-07-23)**: ユーザーより「AI界隈でも最近MCPよりskillという話になっている」との情報。
MCPは常駐サーバー+プロトコルという重い構成が要る一方、skillは実質「指示書(+必要ならスクリプト)を
パッケージ化しただけ」で作成コスト・実行時オーバーヘッドとも低い。今回の「MySQL連動程度なら
bashツール+専用ツール1個で十分」という判断と方向性が一致しており、MCP見送りの判断を後押しする
外部文脈として記録。

## 今後のアイディアメモ(2026-07-23、未着手)

ユーザーがしばらく実運用で試してから、Hooks(1)とLSPを検討する意向。合わせて出たアイディア2つ:

- **skill対応**: MCPの代わりにskill的な仕組み(指示書+必要ならスクリプトのパッケージ化)が
  欲しいとのこと。Hooksの実装と合わせて設計候補になりそう。
- **cron的な自動実行(「openclaw対抗」的なポジション)**: 今のmy-agentは対話駆動(REPLでユーザーが
  都度メッセージを送る)のみ。決まった時間に自動でタスクを実行するループを持たせるとしたら、
  (a) 定期実行の仕組み(node-cron/setInterval、またはOSのcron/launchdから`--yes --session x`で
  叩く)、(b) 毎回何をさせるかのタスク定義(これがskillと重なりそう)、の組み合わせになる想定。
  - **ユーザーが具体化した用途イメージ**: 「特定のskill(タスク定義)を決まったスケジュールで
    自動実行する」組み合わせ。例: 毎朝リポジトリのTODOをチェックして報告、定期的にログを監視して
    異常があれば知らせる、等。skill対応とcron機能はセットで設計するのが筋が良さそう。
  - **実際の現行運用(openclaw)での具体例**: 毎日18時に、今日のニュース(一般・AI関連等)を
    クロール→要約→メール送信、というワークフローを既にopenclawで運用中とのこと。
    これをmy-agentで再現する場合、既存ツール(`google_search`/`visit_page`+LLMによる要約)で
    クロール・要約部分は足りるが、**メール送信ツールが無い**(元のds4_agent 11ツールにも
    含まれておらず、完全新規実装が必要)。
  - **メール送信も core tool ではなく skill として持たせる方針**(ユーザー方針): つまりskillは
    単なる指示書パッケージではなく、**独自ツールを追加登録できる仕組み**である必要がある
    (Claude Code自身のskillがスクリプトを同梱できるのと同じ発想)。実装的にはGmail SMTP+
    アプリパスワード(2段階認証有効化後にGoogleアカウント設定から発行)+nodemailerが
    有力候補、とユーザーから技術的な当たりも共有あり。
  - cron機能・skill機構(ツール追加登録対応)・このメール送信skillの3点セットが揃えば、
    openclawで運用中の実例(毎日18時にニュースクロール→要約→メール送信)を置き換えられる想定。
    最初のターゲットユースケース候補。
  - **openclawでの実例その2**: 天気・時間帯に応じて好きなコーデを選び、ComfyUI(API経由)で
    ポートレート画像を生成してメール送信、というワークフローも現在Python+cronで運用中とのこと。
    my-agentで再現する場合に必要な要素——**天気取得・時間帯判定・ComfyUI連携、全てcore toolでは
    なくskillとして持たせる方針**(ユーザー方針、メール送信と同じ扱い)。
    - **天気取得skill**(天気APIを叩く)
    - **コーデ選定ロジック**: LLM自身の判断に任せる/skillにPython等の明示的ロジックを同梱する、
      どちらの方式も選べる設計にしておくのが良さそう(現行運用はPythonの明示的ロジック)
    - **ComfyUI連携skill**(画像生成のHTTP APIコール)。LTX-timelineの`.env`に既に
      `COMFYUI_IMAGE_URL`/`COMFYUI_VIDEO_URL`があり、そちらの実装パターンが参考にできそう
    - メール送信skill(上記と共通)
  - **設計原則として確定**: core tool(read/write/edit/search/bash系/google_search/visit_page/
    view_image)は汎用的な最小セットに留め、ドメイン固有の機能(メール・天気・画像生成等)は
    全てskillとして追加登録する、という切り分けが一貫した方針になった。
    **理由(ユーザー明言)**: 「coreに入れたら意味が無い、skillだから何でもできる」——
    機能を足すたびにcoreに実装すると、汎用ハーネスとしての本体がドメイン固有の用途に
    肥大化・特化していってしまう。skill機構さえきちんと作れば「何でも足せる」拡張性は
    skill側に逃がせて、core自体はずっと小さく汎用のまま保てる。これがskill機構を作る
    最大の動機であり、今回の設計で最も重視すべき軸。
  - まだアイディア段階、設計・実装とも未着手。

## 参考: LTX-timelineプロジェクトとの関係

このプロジェクトとは無関係の別アプリだが、設計思想としてLTX-timeline(`../LTX-timeline`)の
「モデル/ワークフローエンジンを差し替え可能にしておく」設計(`T2V_VIDEO_ENGINE`/`I2V_VIDEO_ENGINE`、
`.env`の`LLM_MODEL`)を参考にしている。
