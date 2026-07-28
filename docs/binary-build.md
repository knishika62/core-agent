# バイナリのビルド方法

TUI版(`cli.ts`)・GUI版(`webServer.ts`)それぞれを、Node.jsのインストール無しで動く単一実行
ファイルとしてビルドできます。macOS(Apple Silicon)とWindows(64bit)向けです。この場合、
どこからでも起動できるので、実行ファイルをPATHの通った場所に置いておけば、`cd`で毎回
リポジトリに移動しなくても好きなディレクトリで`core-agent`と打つだけで使えます
(`.env`/`skills`/`hooks`/`cron`の設定はカレント→`~/.core-agent`のフォールバックで解決されます)。

このページは**ビルドする側**(開発者)向けです。**ビルド済みバイナリの使い方**
(セットアップ・実行方法・設定項目)は [`dist-bin/README.md`](../dist-bin/README.md) を
参照してください。

## 一発でビルド

```bash
bash scripts/build-binaries.sh
```

`npm install`済みであること以外の前提はありません(`esbuild`/`@yao-pkg/pkg`は
`devDependencies`に含まれています)。実行すると:

1. 前回ビルドの`dist-bin/{macos-arm64,windows-x64,skills,env.example}`だけを削除
   (このスクリプトが生成する物だけが対象。`dist-bin/README.md`のような手動管理ファイルは
   触らない — `dist-bin/`自体は`.gitignore`対象でgit管理外のため、丸ごと消すと復元できない)
2. TUI・GUIそれぞれmacOS/Windows向けの計4本をビルド
3. `skills/`を`dist-bin/skills/`にコピーし、`node_modules/.bin`配下のシンボリックリンクを削除
   (下記「既知の注意点」参照)
4. `.env.example`を`dist-bin/env.example`にコピー
5. 生成物の一覧をサイズ付きで表示

## npmスクリプトで個別にビルド

```bash
npm run package        # 4本まとめて(TUI+GUI、mac+win)
npm run package:macos      # TUI、macOSのみ
npm run package:win        # TUI、Windowsのみ
npm run package:gui:macos  # GUI、macOSのみ
npm run package:gui:win    # GUI、Windowsのみ
npm run package:gui        # GUI、mac+win
```

`scripts/build-binaries.sh`との違いは、skillsのコピーや`.bin`シンボリックリンク削除等の
後処理をしないことです。`dist-bin/`にskillを同梱したい場合や配布物一式を作りたい場合は
`build-binaries.sh`を使ってください。

## 出力先

```
dist-bin/
├── macos-arm64/
│   ├── core-agent          TUI版
│   └── core-agent-gui      GUI版
└── windows-x64/
    ├── core-agent.exe      TUI版
    └── core-agent-gui.exe  GUI版
```

いずれも1本あたり約50MB(macOS)/約64MB(Windows)です。

## 仕組み

各`package:*`スクリプトは2段階です:

1. **esbuild**でTypeScriptソースを単一のCJSバンドル(`bundle/cli.cjs`または
   `bundle/webServer.cjs`)にまとめる
2. **`@yao-pkg/pkg`**でNode.js本体ごと単一実行ファイル化する

## 既知の注意点

- **`--public`フラグが必須**: 無しでビルドしたWindowsバイナリを実機で実行すると、
  `[pkg] V8 rejected the bytecode cache`というエラーで即クラッシュします。macOS上での
  Windows向けクロスビルドではV8 bytecodeキャッシュのビルド元/実行先が不一致になるためで、
  `--public`(bytecode生成自体を無効化し、素のJSとして同梱する)を付けることで回避しています。
- **ターゲット選定**: `node20-macos-arm64`/`node22-win-x64`という一見バラバラなバージョン
  指定は、`@yao-pkg/pkg`がターゲットごとにプリビルド済みのNode本体をGitHub releasesから
  取得する仕組み上、**プリビルドが実在する組み合わせ**を選んでいるためです
  (`node20-win-x64`/`node18-win-x64`は本プロジェクトの検証時点でプリビルドが存在せず
  ビルドできませんでした)。新しいターゲットを追加する場合は、まず対象releaseの
  アセット一覧を確認してください。
- **`import.meta.url`の扱い**: esbuildはCJS出力時に`import.meta.url`を空オブジェクト`{}`に
  潰してしまい、それに依存するESM由来パッケージ(`open`パッケージ、`show_media`ツールが使用)が
  実行時にクラッシュします。各`bundle`/`bundle:gui`スクリプトは
  `--define:import.meta.url=import_meta_url`と`--banner:js`で
  `require('url').pathToFileURL(__filename).href`相当の実値を注入することで対処しています。
  `webServer.ts`はさらに`process.argv[1] === fileURLToPath(import.meta.url)`という
  エントリポイント判定(テストからimportされた時にサーバーが誤って起動しないためのガード)も
  行っており、この仕組みがバンドル後も正しく動くことは実機ビルドでの起動確認済みです。
- **`yauzl`の警告は無害**: ビルド時に`Cannot find module 'yauzl' from '.../bundle'`という
  警告が出ますが、これはPuppeteerのブラウザ自動ダウンロード機能が使うオプション依存で、
  本プロジェクトは`puppeteer-core`(インストール済みのシステムChromeを操作、自動ダウンロード
  機能を使わない)を使っているため無視して問題ありません。
- **配布skillの`node_modules/.bin`**: `skills/pdf_export`等がmacOS上の`npm install`で
  生成する`.bin`配下のシンボリックリンク(`marked`・`browsers`等のCLIショートカット)は、
  単純なコピー操作ではWindows側が再現に失敗しエラーになります。これらのスクリプト内で
  実際に使われることは無い(通常の`import`でパッケージ本体を読み込んでいるだけ)ため、
  `scripts/build-binaries.sh`は`dist-bin/`へコピーする際にこの`.bin`ディレクトリを
  自動的に削除します。
