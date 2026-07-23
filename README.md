　# core-agent

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
  `google_search`/`visit_page`(Puppeteerでブラウザ操作)/`show_media`(画像・動画・音声を
  既定アプリで開き、人間に見せる。ターミナルセッション内には埋め込めないための代替)。
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
- **Hooks**: tool実行の前後に外部コマンドを差し込める(`.core-agent/hooks.json`)。
- **skill機構**: メール送信・天気取得・画像生成のようなドメイン固有機能はcoreに入れず、
  `skills/<name>/skill.json`でツールとして動的登録する(Python等、任意の言語で実装可能)。
- **cron(内蔵スケジューラー)**: `--cron`で常駐し、`.core-agent/cron.json`の設定に従って
  決まった時刻にskillを使ったタスクを自動実行する。

背景や設計の詳細な経緯は [CLAUDE.md](./CLAUDE.md) と [`md/`](./md) 配下を参照してください。

## 設定ファイル一覧

どのJSON/設定ファイルがどこに置かれるかのまとめです(詳細は各セクション参照)。

| ファイル | 場所 | 用途 | 自動生成 |
|---|---|---|---|
| `.env` | プロジェクト直下 | APIキー・モデル・各種env var | されない(`.env.example`をコピー) |
| `.core-agent/hooks.json` | 起動したディレクトリ直下 | tool実行前後のフック定義 | されない(使う場合のみ手動作成) |
| `.core-agent/cron.json` | 起動したディレクトリ直下 | 定期実行ジョブ定義 | されない(使う場合のみ手動作成) |
| `sessions/<name>.json` | 起動したディレクトリ直下の`sessions/` | 会話履歴(`--session <name>`ごと) | される(初回のやり取り後) |
| `skills/<name>/skill.json` | `skills/<name>/` | skillが提供するツールの宣言 | されない(同梱または自作) |
| ブラウザプロファイル | `~/.core-agent/browser`(ホームディレクトリ固定。`~`はWindowsでは`C:\Users\<ユーザー名>`) | `google_search`/`visit_page`用Chromeプロファイル | される(初回のブラウザ利用時) |

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
(`CORE_AGENT_CHROME`でパスを明示指定可能)。

## `google_search`を初めて使う場合(重要)

新品のブラウザプロファイル(Cookie・閲覧履歴が無い状態)からGoogle検索すると、
「自動化された怪しいアクセス」としてbot検知に引っかかりやすくなります
(Googleの標準的な仕組みで、core-agent固有の問題ではありません)。

このため、**`google_search`を初めて呼び出した時は、実際の検索は行わず、代わりに可視のChrome
ウィンドウが開きます**。エージェントからも「このプロファイルは初回利用なので、数分間ブラウザを
普通に使ってから(適当にサイトを見る、任意でGoogleアカウントにログインする等)、**そのウィンドウを
閉じてから**もう一度検索を試してほしい」という案内が返ります。**そのウィンドウを閉じるまでは、
`google_search`を呼んでも「まだ待っている」という応答が返るだけで実際の検索は行われません**
(ウィンドウを閉じる前に検索してしまうと、プロファイルがまだ育っていない状態でGoogleに
アクセスすることになり、ウォームアップの意味が無くなるため)。これは**一度きりのセットアップ**で、
ウィンドウを閉じれば以降は自動で検索できるようになります(プロファイルはホームディレクトリ配下の
`.core-agent/browser`[Windowsでは`C:\Users\<ユーザー名>\.core-agent\browser`]に保存され、
使うたびに「信頼されたブラウザ」として育っていきます)。

検知を回避するための小細工(fingerprint偽装等)は意図的に行っていないため、稀に検索が
ブロックされることがあります。その場合は`Tool error: google_search was blocked...`という
エラーが明確に返るので、少し時間を置くか、ユーザーに手動検索を委ねてください。

## 使い方

```bash
npm run dev
```

REPLが起動し、そのままメッセージを入力するとエージェントが応答します。

```
core-agent — model: deepseek-v4-flash @ http://127.0.0.1:8000/v1
Starting new session "default".
Type your message, /help for commands, /exit to quit.

> このディレクトリのファイル一覧を教えて
```

### CLIオプション

`<name>`の部分は自分で決める任意のセッション名です(例: `--session work`で仕事用と
個人用を分ける等)。同じ名前で再度起動すると、その名前の会話履歴を読み込んで続きから再開します。

| オプション | 説明 |
|---|---|
| `--session <name>` | セッション名を指定(既定`default`)。`sessions/<name>.json`に保存/再開される |
| `--yes` / `-y` | `write`/`edit`/`bash`実行前の確認をすべてスキップ |

### REPL内コマンド

| コマンド | 説明 |
|---|---|
| `/help`, `/?` | コマンド一覧とツール一覧を表示(モデルは呼ばない) |
| `/list` | 保存済みセッションの一覧を表示(現在のセッションに`*`、更新日時つき) |
| `/auto` | 確認ゲート(y/N)のON/OFFをトグル。連続してwrite/edit/bashを使うタスクで毎回聞かれたくない時に。確認プロンプト自体で`a`と答えても同様にON(今回だけ承認+以降は自動承認) |
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

## Hooks

`.core-agent/hooks.json`にtool実行前後のフックを定義できます:

```json
{
  "preToolUse": [
    { "match": "write|edit", "command": "echo blocking risky edits; exit 1" }
  ],
  "postToolUse": [
    { "match": "*", "command": "echo \"$CORE_AGENT_TOOL_NAME finished\" >> tool.log" }
  ]
}
```

- `match`: tool名にマッチする正規表現(省略または`"*"`で全ツール対象)
- `preToolUse`のコマンドが非ゼロ終了すると、そのtool呼び出しはブロックされる
  (stderr/stdoutが理由としてモデルに返る)
- `postToolUse`は副作用専用(ロギング・通知等)。失敗してもtool結果には影響しない
- コマンドには環境変数`CORE_AGENT_TOOL_NAME`/`CORE_AGENT_TOOL_ARGS`(+ postは`CORE_AGENT_TOOL_RESULT`/
  `CORE_AGENT_TOOL_ERROR`)が渡される

## skill機構

`skills/<skill-name>/skill.json`に、そのskillが提供するツールを宣言します:

```json
{
  "name": "weather",
  "description": "Weather lookups",
  "tools": [
    {
      "name": "get_weather",
      "description": "Get the current weather for a city",
      "parameters": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      },
      "command": "python3 get_weather.py"
    }
  ]
}
```

- `command`はskillディレクトリを作業ディレクトリとして実行され、ツール呼び出しの引数がJSONとして
  **標準入力**に渡される。標準出力がそのままツール結果になる(非ゼロ終了は失敗として扱われる)。
  任意の言語で実装可能(Python等)。
- skillツールも`write`/`edit`/`bash`と同じ確認ゲート(`ctx.confirm`)を通る。
- core組み込みツールと名前が衝突するskillツールは登録されない(警告を出してスキップ)。
- 起動時に`skills/`配下を自動スキャンして読み込む。
- skillが独自の依存パッケージを必要とする場合は、そのskillディレクトリに独自の`package.json`を
  置いて`npm install`する(coreの依存を汚さないため)。例: `skills/mail_send`。

### 同梱skill: `mail_send`(SMTP)

skill機構の実例として、SMTP経由でメールを送る`send_mail`ツールを同梱しています
(`skills/mail_send`)。使うには`.env`に以下を設定してください:

```bash
EMAIL_TO=you@example.com          # `to`省略時のデフォルト宛先(cronジョブ等で便利)
EMAIL_FROM=you@example.com        # 省略時はEMAIL_SMTP_USERを使用
EMAIL_SMTP_SERVER=smtp.gmail.com
EMAIL_SMTP_PORT=587
EMAIL_SMTP_USER=you@gmail.com
EMAIL_SMTP_PASSWORD=xxxx xxxx xxxx xxxx   # Gmailの場合はアプリパスワード(通常パスワード不可)
```

Gmailの場合、2段階認証を有効にした上でGoogleアカウント > セキュリティ > アプリパスワードで
発行した**アプリパスワード**が必要です(通常のアカウントパスワードは使えません)。
Gmail以外の任意のSMTPサーバーにも対応しています。未設定の場合、`send_mail`呼び出し時に
分かりやすいエラーで失敗します(黙って落ちません)。

## cron(内蔵スケジューラー)

`.core-agent/cron.json`でジョブを定義します:

```json
{
  "jobs": [
    {
      "name": "news-mail",
      "schedule": "0 18 * * *",
      "prompt": "Search today's general and AI news, summarize it, and email it via the mail_send skill.",
      "session": "cron-news-mail"
    }
  ]
}
```

**通常のREPL起動時にも自動でスケジュールされます**。普段からcore-agentを立ち上げっぱなしにしている
なら、それだけでcronジョブも裏で動きます(対話とジョブ実行は同一プロセス内で共存する)。

```bash
npm run dev    # 対話しつつ、裏でcronジョブも動く
```

REPLを開きたくない・ヘッドレスに常駐させたいだけの場合は`--cron`専用モードも使えます
(この場合はREPLに入らず、スケジュール実行のみを行う):

```bash
npm start -- --cron
```

- `schedule`は標準的な5フィールドcron式(`node-cron`で検証)。
- 各ジョブは指定した`session`(省略時は`name`)を使って会話履歴を継続する(対話セッションとは別)。
- 無人実行のため確認ゲートは掛からない(`--yes`相当)。skillの副作用は自己責任で設計すること。
- プロセスを起動したままにする必要がある(`node-cron`の内部タイマーがイベントループを維持)。
  停止はCtrl-C。

## 環境変数一覧

`.env.example`を参照してください。主なもの:

- `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `LLM_MODEL` / `LLM_PROTOCOL` — メインモデル
- `VISION_BASE_URL` / `VISION_API_KEY` / `VISION_MODEL` — Vision fallback(`view_image`ツール用)
- `MAX_TOOL_ROUNDS` — 1ターンあたりのtool呼び出し上限回数(既定50)
- `MAX_CONTEXT_TOKENS` — この値(粗いトークン数推定)を超えると古い履歴を自動要約(既定60,000)
- `CORE_AGENT_CHROME` — 使用するChrome実行ファイルのパスを明示指定
- `CORE_AGENT_CHROME_PROFILE` — Chromeプロファイルディレクトリを明示指定(既定`~/.core-agent/browser`)
- `CORE_AGENT_CHROME_HEADLESS=1` — ブラウザをheadlessで起動
- `NO_COLOR` — 設定すると色分け/Markdown装飾を無効化(非TTY実行時は自動的に無効)
- `PYTHON_PATH` — Pythonインタプリタの絶対パス(自分で管理しているvenv等)。設定すると、
  system promptでこのパスを使うよう明示され、素の`python`/`python3`を叩いてシステム環境を
  汚すのを避けられる。詳しくは「Pythonスクリプトを書かせる場合」セクション参照。

## Pythonスクリプトを書かせる場合

グラフ作成・データ分析のようなタスクでは、エージェントは何も指定しないと**PATH上のPythonを
無条件に実行し、足りないライブラリがあれば断りなく`pip install`し始めます**。これはシステムの
Python環境を汚す原因になります。

`PYTHON_PATH`に自分で管理しているvenv等のPythonインタプリタの絶対パスを設定しておくと、
system promptに「Pythonを使う時はこのパスを使え」という指示が自動的に埋め込まれます:

```bash
python3 -m venv ~/.venvs/core-agent
~/.venvs/core-agent/bin/pip install pandas matplotlib requests
# .envに設定
PYTHON_PATH=/Users/you/.venvs/core-agent/bin/python
```

system promptの指示だけでは強制力が無いため、`bash`ツール自体にも対策が入っています。
`PYTHON_PATH`を設定していると、モデルがどんな形で`pip install`/`pip3 install`を実行しようと
しても(裸の`pip install`、`python -m pip install`、別のパスのpipなど)、指定venvの
pip(`"$PYTHON_PATH" -m pip install ...`)へ**自動的に、確認無しで**すり替えられます。
指定venvに無いパッケージだからこそpip installが必要になる、という前提のもと、
システムPython(や他のPython環境)を汚す余地が無いようにするための仕組みです。
(`cd dir && pip install ...`のような複合コマンドの一部になっている場合は検知対象外で、
書いたコマンドがそのまま実行されます。)

なお、生成したグラフ画像や一時スクリプトの保存先として、モデルはUnix系の慣習で
`/tmp`をハードコードしがちですが、**Windowsには`/tmp`が存在しません**。system promptには
Node標準の`os.tmpdir()`(OSごとに正しい一時ディレクトリを返す)の実際の値が自動的に
埋め込まれており、モデルにはそちらを使うよう指示しています(設定不要、常に有効)。

## 既知の制限

- **日本語IME入力時の表示崩れ**: 変換候補がターミナルの右端で折り返すと表示が乱れる場合が
  あります。IMEの変換候補描画はターミナル側が行っておりアプリの制御が及ばないため、
  Node標準の`readline`ベースの実装では根本的な解決が難しい既知の問題です(`ds4_agent`の
  自前エディタでも未解決)。確定済みのテキストを貼り付ける分には問題ありません。
- **KVキャッシュのprefill再利用は無し**: HTTP経由のバックエンドという設計上、セッション再開時に
  推論エンジン側のキャッシュを引き継ぐことはできません(接続先サーバー側の実装次第)。
- **think-mode/reasoning系パラメータは非対応**: エンドポイント越しではモデルごとに効き方が
  異なるため、明示的なハンドリングはしていません。
- **Windows実機での動作確認は未実施**: `bash`ツール・Chrome自動検出はWindows向けの実装
  (OS既定シェルの自動選択、`taskkill`によるプロセスツリー終了、標準的なインストール先パス)を
  入れていますが、実機での検証はまだ行っていません。

## 開発元ネタとの関係

このプロジェクトの元ネタである [antirez/ds4](https://github.com/antirez/ds4) には一切書き込みを
行っていません(参照専用)。`ds4.c`(推論エンジン本体)はDeepSeek V4 Flash専用のネイティブ実装で
汎用化の対象外、`ds4_agent.c`(ハーネス)の設計を参考にしつつ、Node/TypeScriptでスクラッチ実装しています。
