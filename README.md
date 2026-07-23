# my-agent

[antirez/ds4](https://github.com/antirez/ds4) の `ds4_agent`(ネイティブ推論エンジンに
in-process直結したCLIコーディングエージェント)を、任意のOpenAI/Anthropic互換HTTPエンドポイントを
差し替え可能な形で作り直したNode/TypeScript版のハーネスです。

## 特徴

- **バックエンド差し替え可能**: `.env`の`OPENAI_BASE_URL`/`LLM_MODEL`を変えるだけで、ローカルの
  推論サーバー(`ds4-server`等)からクラウドAPIまで任意のOpenAI互換エンドポイントに切り替え可能。
  `LLM_PROTOCOL=anthropic`でAnthropicの`/v1/messages`形式にも対応。
- **Vision自動ルーティング**: メインモデルがVision非対応でも、`view_image`という合成tool call経由で
  別のVision対応モデルに自動フォールバックする。
- **ツール一式**: `read`/`more`/`write`/`list`/`edit`/`search`/`bash`/`bash_status`/`bash_stop`/
  `google_search`/`visit_page`(Puppeteerでブラウザ操作)。
- **破壊的操作への確認ゲート**: `write`/`edit`/`bash`は既定で実行前にy/N確認(`--yes`で無効化可能)。
- **長時間セッション対応**: context圧縮(古い履歴の自動要約)、セッションの保存/再開。
- **プロジェクト指示ファイルの自動読込**: cwdの`AGENT.md`(または`AGENTS.md`/`.agent.md`)を
  起動時に読み込みsystem promptに反映(Claude CodeのCLAUDE.md相当)。
- **色分け+簡易Markdownビューア**: ユーザー入力/エージェント応答/ツール情報を色分け、応答は
  見出し・箇条書き・強調・コードフェンス等をストリーミングのまま行単位でANSI装飾。
- **`!<command>`によるシェル直接実行**: LLMを介さずローカルでコマンド実行。`!cd <dir>`は
  作業ディレクトリの変更として維持される(ツール実行にも反映)。
- **画像のドラッグ&ドロップ対応**: ターミナルが挿入するエスケープ済み/クォート付きパスも
  `view_image`ツールが正しく解決する。

背景や設計の詳細な経緯は [CLAUDE.md](./CLAUDE.md) と [`md/`](./md) 配下を参照してください。

## インストール

Node.js 18以上(`fetch`/`ReadableStream`をネイティブ利用)が必要です。

```bash
npm install
cp .env.example .env
```

`.env`を編集して、最低限メインモデルのエンドポイントを設定してください:

```bash
# メインモデル(コーディング用、OpenAI互換)
OPENAI_BASE_URL=http://127.0.0.1:8000/v1
OPENAI_API_KEY=
LLM_MODEL=deepseek-v4-flash
# Anthropic互換(/v1/messages)にしたい場合のみ
LLM_PROTOCOL=openai

# Vision fallback(任意。view_imageツールを使う場合のみ必要)
VISION_BASE_URL=
VISION_API_KEY=
VISION_MODEL=
```

`google_search`/`visit_page`ツールはインストール済みのGoogle Chromeを操作します
(`MY_AGENT_CHROME`でパスを明示指定可能)。

## 使い方

```bash
npm run dev
```

REPLが起動し、そのままメッセージを入力するとエージェントが応答します。

```
my-agent — model: deepseek-v4-flash @ http://127.0.0.1:8000/v1
Starting new session "default".
Type your message, /help for commands, /exit to quit.

> このディレクトリのファイル一覧を教えて
```

### CLIオプション

| オプション | 説明 |
|---|---|
| `--session <name>` | セッション名を指定(既定`default`)。`sessions/<name>.json`に保存/再開される |
| `--yes` / `-y` | `write`/`edit`/`bash`実行前の確認をすべてスキップ |

### REPL内コマンド

| コマンド | 説明 |
|---|---|
| `/help` | コマンド一覧とツール一覧を表示(モデルは呼ばない) |
| `/list` | 保存済みセッションの一覧を表示(現在のセッションに`*`、更新日時つき) |
| `/reset` | 現在のセッションの会話履歴をクリア |
| `/exit` | 終了 |
| `!<command>` | シェルコマンドを直接実行(LLMを介さない)。`!cd <dir>`で作業ディレクトリ変更 |

### ビルド

```bash
npm run build   # tsc でdist/にコンパイル
npm run typecheck
```

### ビルド済みで起動

`npm run dev`は`tsx`でソースを直接実行しますが、ビルド後は`npm start`(`node dist/cli.js`)でも
起動できます。CLIオプションを渡す場合はnpmの流儀で`--`を挟んでください:

```bash
npm run build
npm start                                  # 引数なし
npm start -- --session work --yes          # オプション付き
```

### テスト

```bash
npm test        # vitest run
```

## プロジェクト指示ファイル

カレントディレクトリに`AGENT.md`(`AGENTS.md`/`.agent.md`でも可)を置くと、起動時に自動で
system promptに合成されます。Claude Codeを使ったことがあれば、CLAUDE.mdと同じ役割です。

## 環境変数一覧

`.env.example`を参照してください。主なもの:

- `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `LLM_MODEL` / `LLM_PROTOCOL` — メインモデル
- `VISION_BASE_URL` / `VISION_API_KEY` / `VISION_MODEL` — Vision fallback(`view_image`ツール用)
- `MAX_TOOL_ROUNDS` — 1ターンあたりのtool呼び出し上限回数(既定50)
- `MAX_CONTEXT_TOKENS` — この値(粗いトークン数推定)を超えると古い履歴を自動要約(既定60,000)
- `MY_AGENT_CHROME` — 使用するChrome実行ファイルのパスを明示指定
- `MY_AGENT_CHROME_PROFILE` — Chromeプロファイルディレクトリを明示指定(既定`~/.my-agent/browser`)
- `MY_AGENT_CHROME_HEADLESS=1` — ブラウザをheadlessで起動
- `NO_COLOR` — 設定すると色分け/Markdown装飾を無効化(非TTY実行時は自動的に無効)

## 既知の制限

- **日本語IME入力時の表示崩れ**: 変換候補がターミナルの右端で折り返すと表示が乱れる場合が
  あります。IMEの変換候補描画はターミナル側が行っておりアプリの制御が及ばないため、
  Node標準の`readline`ベースの実装では根本的な解決が難しい既知の問題です(`ds4_agent`の
  自前エディタでも未解決)。確定済みのテキストを貼り付ける分には問題ありません。
- **KVキャッシュのprefill再利用は無し**: HTTP経由のバックエンドという設計上、セッション再開時に
  推論エンジン側のキャッシュを引き継ぐことはできません(接続先サーバー側の実装次第)。
- **think-mode/reasoning系パラメータは非対応**: エンドポイント越しではモデルごとに効き方が
  異なるため、明示的なハンドリングはしていません。

## 開発元ネタとの関係

このプロジェクトの元ネタである [antirez/ds4](https://github.com/antirez/ds4) には一切書き込みを
行っていません(参照専用)。`ds4.c`(推論エンジン本体)はDeepSeek V4 Flash専用のネイティブ実装で
汎用化の対象外、`ds4_agent.c`(ハーネス)の設計を参考にしつつ、Node/TypeScriptでスクラッチ実装しています。
