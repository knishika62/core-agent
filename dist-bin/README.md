# core-agent(配布版)

core-agentの単一実行ファイル版です。OpenAI/Anthropic互換の任意のLLMエンドポイントを使う
コーディングエージェントで、TUI(ターミナル)版とGUI(ブラウザ)版があります。

## 必要なもの

| 必須度 | 何が | 何のため |
|---|---|---|
| 必須 | [Python](https://www.python.org/)(`python3`または`python`がPATH上) | LLMがグラフ作成・データ分析等で自発的にコードを書いて実行する用途で事実上必須。初回起動時に専用venvを自動作成 |
| skillを使うなら | [Node.js](https://nodejs.org/) | 同梱skill(`mail_send`/`pdf_export`)がNode.jsスクリプトなため。skillを使わないなら不要 |
| Web閲覧・検索を使うなら | Google Chrome | `google_search`/`visit_page`ツールに必要 |

## TUI版とGUI版、どちらを使う？

同じフォルダに**2種類**の実行ファイルが入っています。ツール・設定ファイル・skill/hooks/cronは
完全に共有していて、違いは入口(見た目)だけです。

- **`core-agent`(TUI版)**: ターミナル(コマンドプロンプト)の中でチャットするタイプ。
- **`core-agent-gui`(GUI版)**: 実行するとローカルにサーバーが立ち上がり、ブラウザ
  (`http://localhost:8787`)からチャットするタイプ。日本語IMEの変換候補が崩れず、
  画像/動画/音声もブラウザ上にそのまま表示されます。ターミナル操作に慣れていない場合は
  こちらの方が扱いやすいはずです。

どちらか片方だけで十分です(両方同時に起動すると、後述の通りcronジョブが二重に動く
点だけ注意してください)。

## フォルダ構成

```
dist-bin/
├── macos-arm64/
│   ├── core-agent        macOS (Apple Silicon) 用バイナリ(TUI版)
│   └── core-agent-gui    macOS (Apple Silicon) 用バイナリ(GUI版)
├── windows-x64/
│   ├── core-agent.exe        Windows (64bit) 用バイナリ(TUI版)
│   └── core-agent-gui.exe    Windows (64bit) 用バイナリ(GUI版)
├── skills/
│   ├── mail_send/      同梱skill(SMTP経由メール送信)
│   └── pdf_export/     同梱skill(Markdown→PDF変換)
└── env.example        環境変数テンプレート
```

## セットアップ

1. お使いのOSに合わせて、対応するフォルダ(`macos-arm64/`または`windows-x64/`)の中から、
   使いたい方の実行ファイル(TUI版`core-agent`[`.exe`]、またはGUI版`core-agent-gui`[`.exe`])を、
   PATHの通った好きな場所に置いてください。
2. どこからでも良いので一度起動してください(下記「実行方法」参照)。Pythonが無い場合は
   案内を出してそのまま終了します(何もファイルは作られません)。Pythonがあれば、専用venvを
   作成した上で`~/.core-agent/.env`にテンプレートを自動生成し、以下のような案内を出して
   終了します:

   ```
   First run: created /Users/you/.core-agent/.env
   Edit it with your LLM endpoint/API key, then run core-agent again.

   Also created a dedicated Python venv at /Users/you/.core-agent/venv and set PYTHON_PATH in
   .env to it, so Python scripts have a place to pip-install into without touching your system
   Python — no extra setup needed there.

   To use the built-in mail-send/PDF-export skills, copy this build's skills/ folder to
   /Users/you/.core-agent/skills (requires Node.js to be installed).

   Press any key to exit...
   ```

3. 案内の通り`~/.core-agent/.env`をエディタで開いて値を埋めてください。
   (`--env`オプションで起動すると、パスを自分で探さなくてもOS標準のエディタ
   [`$EDITOR`未設定ならmacOS/Linuxは`vi`、Windowsは`notepad`] で`.env`を開けます。
   下記「CLIオプション」参照。)最低限、以下を設定すれば動きます:

   ```
   OPENAI_BASE_URL=http://127.0.0.1:8000/v1
   OPENAI_API_KEY=
   LLM_MODEL=deepseek-v4-flash
   # Set to "anthropic" to speak /v1/messages instead of OpenAI's /v1/chat/completions.
   LLM_PROTOCOL=openai
   ```

   以下は**オプション**です(`view_image`ツールを使わないなら空のままで構いません):

   ```
   # Vision fallback model, used only via the view_image tool call.
   # Most strong coding models (DeepSeek/GLM family) have no vision support,
   # so a separate vision-capable model is routed to on demand.
   VISION_BASE_URL=
   VISION_API_KEY=
   VISION_MODEL=
   ```

   `mail_send`スキルを使う場合は`EMAIL_*`系も設定してください。`pdf_export`(Markdown→PDF)は
   設定不要で、インストール済みのChromeでそのまま動きます。

4. skillツール(`mail_send`・`pdf_export`)を使う場合は、配布物内の`skills/`フォルダを
   案内メッセージに出た場所(`~/.core-agent/skills/`)にコピーし、Node.jsをインストールして
   ください。skillを使わないなら、この手順は不要です。
5. もう一度起動すれば通常通り動きます。

**プロジェクトごとに設定を変えたい場合**: 特定のフォルダに`cd`してから起動する場合は、
そのフォルダ直下に`.env`(または`skills/`・`.core-agent/hooks.json`・`.core-agent/cron.json`)を
置けば、グローバル側より優先されます。普段は上記のグローバル設定だけで十分です。
(詳しいファイル配置ルールは後述「設定ファイル一覧」参照)

## 実行方法

**macOS:**
```
cd macos-arm64
./core-agent
```

初回はGatekeeperにブロックされる場合があります。その場合はシステム設定 > プライバシーとセキュリティ
から「このまま開く」を選択するか、以下を実行してください:

```
xattr -d com.apple.quarantine ./core-agent
```

**Windows:**
```
cd windows-x64
.\core-agent.exe
```

Windows Defender SmartScreenの警告が出る場合は「詳細情報」→「実行」を選択してください。

### GUI版の起動

TUI版と同じフォルダに入っている`core-agent-gui`(`.exe`)を実行します(Gatekeeper/SmartScreenの
案内は上記TUI版と同じです)。ターミナル操作が不要な点を除けば、`.env`の初回作成などの流れは
TUI版と全く同じです(上記「セットアップ」参照)。

```
cd macos-arm64
./core-agent-gui
```

```
cd windows-x64
.\core-agent-gui.exe
```

以下のように表示されたら起動成功です(このウィンドウは閉じずに開いたままにしてください。
閉じるとサーバーも終了します):

```
core-agent GUI v0.0.2 — model: deepseek-v4-flash @ http://127.0.0.1:8000/v1
Listening on http://0.0.0.0:8787 (no auth — trusted networks only)
```

ブラウザで **`http://localhost:8787`** を開いてください。同じLAN内の別のPCからも
`http://<このPCのIPアドレス>:8787`でアクセスできます(既定で認証は一切無いので、
信頼できるネットワーク内だけで使ってください。外部に公開したい場合は`GUI_HOST`を
`127.0.0.1`にして自分のPCからのみアクセス可能にするか、別途リバースプロキシ+認証を
用意してください)。

**TUI版とGUI版を同時に起動するとcronジョブが二重登録されます**(`.core-agent/cron.json`を
使っている場合のみ影響)。同じジョブが1回のスケジュールで複数回実行される(例: 通知メールが
2〜3通届く)ので、cronを使うならどちらか一方だけを起動しっぱなしにしてください。

## CLIオプション

TUI版は本体版(`npm run dev`)と同じオプションが使えます(GUI版は`--env`以外のCLIオプションを
取りません、`GUI_HOST`/`GUI_PORT`等は上記の通り`.env`で設定してください):

```
./core-agent --session work --yes
```

`work`の部分は自分で決める任意のセッション名です(仕事用と個人用を分ける等)。同じ名前で
再度起動すると、その名前の会話履歴を読み込んで続きから再開します。

| オプション | 説明 |
|---|---|
| `--session <name>` | セッション名を指定(未指定なら`default`)。`sessions/<name>.json`に保存/再開される |
| `--yes` / `-y` | `write`/`edit`/`bash`実行前の確認をスキップ |
| `--cron` | REPLを開かず、cron専用ヘッドレスモードで起動(`.core-agent/cron.json`が必要) |
| `--version` / `-v` | バージョンを表示して終了 |
| `--env` | `.env`の簡易編集ツール。グローバル(`~/.core-agent/.env`)かプロジェクト直下(`./.env`)かを選び、無ければテンプレートから新規作成、`$EDITOR`(未設定時はUnix系`vi`/Windows`notepad`)で開く。`core-agent-gui --env`でも同じものが使える |

REPL内コマンド(`/help`(`/?`でも可)/`/list`/`/auto`/`/reset`/`/exit`/`!<command>`)も本体版と同じです。
応答生成中に`Esc`を押すと、そこまでのテキストを残したままストリーミングを中断できます
(実行中のbash等のツールは対象外です)。`Ctrl-C`は`>`プロンプトや確認(y/N)待ちの間は`/exit`と
同じ扱いになりますが、LLM応答待ち・ツール実行中は何も起きません(意図的な仕様です。
ストリーミングを止めたい場合は`Esc`を使ってください)。
`/auto`は確認ゲート(y/N)のON/OFFをその場でトグルするコマンドです。write/edit/bashを
何度も使うタスク(スクリプトを繰り返し実行して調整する等)で、毎回y/Nを聞かれるのが煩わしい時に
使ってください(`--yes`起動と違い、途中からON/OFFを切り替えられます)。**確認プロンプトが
出ている最中でも**、`y`の代わりに`a`と答えれば「今回だけ承認」ではなく「今回承認+以降は
ずっと自動承認」になります(`/auto`コマンドを別途打つ必要はありません)。

## できること

- **バックエンド差し替え可能**: `.env`の`OPENAI_BASE_URL`/`LLM_MODEL`を変えるだけで、ローカルの
  推論サーバーからクラウドAPIまで任意のOpenAI互換エンドポイントに切り替え可能。
  `LLM_PROTOCOL=anthropic`でAnthropicの`/v1/messages`形式にも対応。検索エンジンも
  `SEARCH_ENGINE_URL`でセルフホスト(SearXNG等)に切り替えられる。
- **ツール一式**:
  - `read`/`more`/`write`/`list`/`edit`/`search` — ファイル読み書き・検索・行単位編集
  - `bash`/`bash_status`/`bash_stop` — シェルコマンドの非同期実行・監視・停止
  - `visit_page`/`google_search` — 実Chromeを操作してWebページ閲覧・検索
  - `view_image` — Vision対応の別モデルに画像を見せて質問する(メインモデルがVision非対応でも可)
  - `show_media` — 画像・動画・音声を既定アプリで開いて人間に見せる
- **skill機構**: `skills/`配下にツールを動的追加できる仕組み(任意の言語で実装可能、
  特定のプロトコルに縛られない)。coreは最小限に保ち、ドメイン固有の機能は全部skillに逃がす設計。
  同梱の`mail_send`(SMTP経由メール送信)・`pdf_export`(Markdown→PDF変換)が実例
- **Hooks**: tool実行の前後に外部コマンドを差し込める(`.core-agent/hooks.json`)
- **cron(内蔵スケジューラー)**: `.core-agent/cron.json`を置いておけば、通常のREPL起動時にも
  裏でスケジュール実行される(普段立ち上げっぱなしにするだけでOK)。REPLを開かずヘッドレスに
  常駐させたいだけなら`--cron`専用モードも使える
- **破壊的操作への確認ゲート**: `write`/`edit`/`bash`(・skillツール)は既定で実行前にy/N確認
  (`--yes`で無効化可能)
- **セッション保存/再開・context圧縮**: 長時間の会話でも履歴が自動要約され、途中で終了しても
  `--session <name>`で再開できる
- **色分け+簡易Markdownビューア**: 応答を見出し・箇条書き・強調・コードフェンス付きでANSI装飾
- **画像のドラッグ&ドロップ対応**: ターミナルにドロップした画像パスを`view_image`/`show_media`が
  正しく解決
- **`!<command>`によるシェル直接実行**: LLMを介さずローカルでコマンド実行(`!cd`で作業ディレクトリ変更も可)
- **プロジェクト指示ファイルの自動読込**: カレントディレクトリの`AGENT.md`を起動時にsystem promptへ反映

## 設定ファイル一覧

どのJSON/設定ファイルがどこに置かれるかのまとめです。

`.env`・`skills/`・`.core-agent/hooks.json`・`.core-agent/cron.json`は、**起動したディレクトリ
(カレント)を先に見て、そこに無ければ`~/.core-agent`(グローバル、`CORE_AGENT_HOME`で変更可。
`~`はWindowsでは`C:\Users\<ユーザー名>`)にフォールバック**します。`skills/`だけは両方をスキャンして合算します。

| ファイル | 場所 | 用途 | 自動生成 |
|---|---|---|---|
| `.env` | カレント→`~/.core-agent`(フォールバック) | APIキー・モデル・各種env var | 初回起動時、無ければ`~/.core-agent/.env`にテンプレートを生成 |
| `.core-agent/hooks.json` | カレントの`.core-agent/`→`~/.core-agent`(フォールバック) | tool実行前後のフック定義 | されない(使う場合のみ手動作成) |
| `.core-agent/cron.json` | カレントの`.core-agent/`→`~/.core-agent`(フォールバック) | 定期実行ジョブ定義 | されない(使う場合のみ手動作成) |
| `sessions/<name>.json` | 起動したディレクトリ直下の`sessions/`(フォールバック無し) | 会話履歴(`--session <name>`ごと) | される(初回のやり取り後) |
| `skills/<name>/skill.json` | カレントの`skills/`+`~/.core-agent/skills/`(両方合算) | skillが提供するツールの宣言 | されない(同梱の`mail_send`・`pdf_export`のみ) |
| ブラウザプロファイル | `~/.core-agent/browser` | `google_search`/`visit_page`用Chromeプロファイル | される(初回のブラウザ利用時) |

### `.env`設定一覧

| 変数名 | 必須/既定値 | 説明 |
|---|---|---|
| `CORE_AGENT_HOME` | 既定`~/.core-agent` | `.env`/`skills`/hooks/cronのグローバル置き場を変更(この変数自体は当然、環境変数かカレントの`.env`で設定する必要がある) |
| `OPENAI_BASE_URL` | 既定`http://127.0.0.1:8000/v1` | メインLLMのOpenAI互換エンドポイント |
| `OPENAI_API_KEY` | 任意 | メインLLMのAPIキー(不要なエンドポイントなら空でよい) |
| `LLM_MODEL` | 既定`deepseek-v4-flash` | メインLLMのモデル名 |
| `LLM_PROTOCOL` | 既定`openai` | `anthropic`を指定すると`/v1/messages`形式で通信 |
| `VISION_BASE_URL` / `VISION_API_KEY` / `VISION_MODEL` | 任意 | `view_image`ツール用のVisionモデル。未設定ならVisionは使えない |
| `MAX_TOOL_ROUNDS` | 既定`50` | 1ターンでの最大tool呼び出し回数(無限ループ防止) |
| `MAX_CONTEXT_TOKENS` | 既定`60000` | 会話履歴の概算トークン数がこれを超えると古い部分を自動要約 |
| `PYTHON_PATH` | 任意 | 指定するとPythonスクリプト実行時にシステムPythonの代わりにこのパスを使うようモデルに指示。`pip install`系コマンドも自動的にこのパスのpipへ書き換わる |
| `CORE_AGENT_CHROME` | 任意 | Chrome実行ファイルのパスを明示指定(自動検出できない場合) |
| `CORE_AGENT_CHROME_PROFILE` | 既定`~/.core-agent/browser` | ブラウザプロファイルの保存先を明示指定 |
| `CORE_AGENT_CHROME_HEADLESS` | 任意(`1`で有効) | ヘッドレスモードで起動(既定は可視ウィンドウ) |
| `CORE_AGENT_CHROME_WINDOW_SIZE` | 既定`480,360` | 可視ウィンドウのサイズ(px、`幅,高さ`) |
| `CORE_AGENT_CHROME_WINDOW_POSITION` | 既定`0,0` | 可視ウィンドウの位置(px、`X,Y`。既定は画面左上) |
| `SEARCH_ENGINE_URL` | 任意 | セルフホストの検索エンジン(SearXNG等、`?q=...&format=json`でJSONを返すもの)のベースURL。設定すると`google_search`はChromeを一切使わずこのURLへ直接fetchする(未設定なら従来通りブラウザ経由のGoogle検索) |
| `NO_COLOR` | 任意 | 設定するとCLI出力のANSI色付け・Markdown装飾を無効化 |
| `GUI_HOST` | 既定`0.0.0.0`(GUI版のみ) | GUIサーバーの待ち受けアドレス。既定はLAN内の他PCからもアクセス可能(認証なし、後述) |
| `GUI_PORT` | 既定`8787`(GUI版のみ) | GUIサーバーのポート番号 |
| `GUI_INLINE_MEDIA` | 既定`1`(GUI版のみ) | 画像/動画/音声をブラウザ内に直接表示するか。`0`にすると代わりにサーバー側マシンでネイティブアプリが開く |
| `EMAIL_TO` | 任意 | `mail_send`スキル: `to`省略時のデフォルト送信先 |
| `EMAIL_FROM` | 任意(既定は`EMAIL_SMTP_USER`) | `mail_send`スキル: 送信元アドレス |
| `EMAIL_SMTP_SERVER` / `EMAIL_SMTP_USER` / `EMAIL_SMTP_PASSWORD` | `mail_send`使用時は必須 | `mail_send`スキル: SMTP接続情報(Gmailの場合`EMAIL_SMTP_PASSWORD`は2段階認証のアプリパスワード) |
| `EMAIL_SMTP_PORT` | 既定`587` | `mail_send`スキル: SMTPポート番号 |

## Chromeウィンドウについて

`visit_page`/`google_search`が開くウィンドウは、作業の邪魔にならないよう既定で小さめ
(480×360)・画面左上に開きます(`.env`の`CORE_AGENT_CHROME_WINDOW_SIZE`/
`CORE_AGENT_CHROME_WINDOW_POSITION`で変更可)。また、Chrome自身が表示する
「Chrome は自動テスト ソフトウェアによって制御されています」というバーが出ますが、
これはCDP(自動操作プロトコル)経由で起動した場合にChromeが必ず表示する標準の挙動で、
core-agent側が出しているものではなく、文言も変更できません(非表示にはできますが、
「自動操作中と分かる」目印としてあえてそのまま表示しています)。

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

## Pythonスクリプトを書かせる場合(重要)

グラフ作成・データ分析のようなタスクでは、エージェントは何も指定しないと**PATH上のPythonを
無条件に実行し、足りないライブラリがあれば断りなく`pip install`し始めます**。システムの
Python環境を汚さないよう、**初回起動時に専用のvenv(`~/.core-agent/venv`)が自動で作られ、
`.env`の`PYTHON_PATH`にそのパスが自動設定されます**(「セットアップ」参照)ので、通常は
何も手動でやることはありません。

もしvenvの自動作成がスキップされた(その時Pythonが見つからなかった等)場合や、
プロジェクトごとに別のPython環境を使いたい場合は、`.env`の`PYTHON_PATH`に自分で管理している
venvのPythonインタプリタの絶対パスを設定してください。プロジェクト固有にしたい場合は、
そのプロジェクトフォルダに`.env`を個別に置けば(グローバルより優先されます)、
`PYTHON_PATH`だけそこで上書きできます:

```bash
cd /path/to/your/project
python3 -m venv venv
```

```
PYTHON_PATH=/path/to/your/project/venv/bin/python   # Windowsは venv\Scripts\python.exe
```

ライブラリのインストールは不要です。このvenvは他と共有しない専用環境なので、
足りないパッケージがあればエージェントが自分で`pip install`します。

設定すると、system promptに「Pythonを使う時はこのパスを使え」という指示が自動で入ります。
これだけだと強制力が無いため、`bash`ツール自体にも対策が入っています。モデルがどんな形で
`pip install`/`pip3 install`を実行しようとしても(裸の`pip install`、`python -m pip install`、
別のパスのpipなど)、このvenvのpipへ**自動的に、確認無しで**すり替えられます。
(`cd dir && pip install ...`のような複合コマンドの一部になっている場合は対象外です。)

なお、生成したグラフ画像や一時スクリプトの保存先として、モデルはUnix系の慣習で`/tmp`を
ハードコードしがちですが、**Windowsには`/tmp`が存在しません**。system promptには
OSごとに正しい一時ディレクトリの実際の値が自動的に埋め込まれ、モデルにはそちらを使うよう
指示しています(設定不要)。

## 制限事項・既知の問題

- 日本語IME変換中の表示崩れ(TUI版のみ。ターミナル+IMEの構造的な問題で、ブラウザの
  `<textarea>`を使うGUI版では発生しません)。
- Windows実機でのテストは実施済みです。これまでに見つかった問題(V8 bytecodeキャッシュの
  ビルド元/実行先不一致によるクラッシュ、`cmd.exe`でのpip installコマンドのクォート崩れ、
  ネットワーク瞬断時のLLMリクエスト失敗でプロセス全体が落ちる問題、`visit_page`経由での
  bot検知回避の抜け)はいずれも修正・実機再検証済みです。ただし全機能を網羅した検証では
  ないため、未発見の問題が残っている可能性はあります。
