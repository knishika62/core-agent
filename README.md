　# core-agent

[antirez/ds4](https://github.com/antirez/ds4) の `ds4_agent`(ネイティブ推論エンジンに
in-process直結したCLIコーディングエージェント)を、任意のOpenAI/Anthropic互換HTTPエンドポイントを
差し替え可能な形で作り直した上で機能拡張したNode/TypeScript版のハーネスです。

**TUI(ターミナルREPL)版とGUI(ブラウザ)版**の2つの入口があり、ツール・セッション管理・
LLM接続などのバックエンドは完全に共有しています。

- 📟 **[TUI版のセットアップ・使い方 → `docs/tui.md`](./docs/tui.md)**
- 🌐 **[GUI版のセットアップ・使い方 → `docs/gui.md`](./docs/gui.md)**
- 📦 **[バイナリのビルド方法 → `docs/binary-build.md`](./docs/binary-build.md)**

## 特徴

- **バックエンド差し替え可能**: `.env`の`OPENAI_BASE_URL`/`LLM_MODEL`を変えるだけで、ローカルの
  推論サーバー(`ds4-server`等)からクラウドAPIまで任意のOpenAI互換エンドポイントに切り替え可能。
  `LLM_PROTOCOL=anthropic`でAnthropicの`/v1/messages`形式にも対応。
- **TUI/GUI両対応**: 同じバックエンドに、ターミナルREPL(`cli.ts`)とブラウザUI
  (`webServer.ts`)の2つの入口からアクセスできる。GUI版はネイティブIME対応・Markdownテーブル・
  画像/動画/音声のインライン表示など、TUIには無い機能もある。
- **Vision自動ルーティング**: メインモデルがVision非対応でも、`view_image`という合成tool call経由で
  別のVision対応モデルに自動フォールバックする。
- **ツール一式**: `read`/`more`/`write`/`list`/`edit`/`search`/`bash`/`bash_status`/`bash_stop`/
  `google_search`/`visit_page`(Puppeteerでブラウザ操作)/`show_media`(画像・動画・音声を
  人間に見せる)。
- **破壊的操作への確認ゲート**: `write`/`edit`/`bash`は既定で実行前にy/N確認(スキップ可能)。
- **長時間セッション対応**: context圧縮(古い履歴の自動要約)、セッションの保存/再開。
- **プロジェクト指示ファイルの自動読込**: cwdの`AGENT.md`(または`AGENTS.md`/`.agent.md`)を
  起動時に読み込みsystem promptに反映(Claude CodeのCLAUDE.md相当)。
- **Hooks**: tool実行の前後に外部コマンドを差し込める(`.core-agent/hooks.json`)。
- **skill機構**: メール送信・天気取得・画像生成のようなドメイン固有機能はcoreに入れず、
  `skills/<name>/skill.json`でツールとして動的登録する(Python等、任意の言語で実装可能)。
- **cron(内蔵スケジューラー)**: TUI・GUIどちらを起動していても、`.core-agent/cron.json`の
  設定に従って決まった時刻にskillを使ったタスクを自動実行する。

詳しいセットアップ・使い方は上記の [`docs/tui.md`](./docs/tui.md) / [`docs/gui.md`](./docs/gui.md)
を参照してください(それぞれ単独で読めば動かせるように書かれています)。

## 開発元ネタとの関係

このプロジェクトの元ネタである [antirez/ds4](https://github.com/antirez/ds4) には一切書き込みを
行っていません(参照専用)。`ds4.c`(推論エンジン本体)はDeepSeek V4 Flash専用のネイティブ実装で
汎用化の対象外、`ds4_agent.c`(ハーネス)の設計を参考にしつつ、Node/TypeScriptでスクラッチ実装しています。
