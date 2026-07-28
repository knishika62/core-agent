# Web閲覧・検索ツール(`google_search` / `visit_page`)

`google_search`・`visit_page`はTUI版・GUI版で完全に共通の実装です。このページはどちらからも
参照されています。

## Chromeウィンドウについて

`visit_page`/`google_search`は既定でインストール済みのGoogle Chromeを操作します
(`CORE_AGENT_CHROME`でパスを明示指定可能)。開くウィンドウは作業の邪魔にならないよう既定で
小さめ(480×360)・画面左上に開きます(`CORE_AGENT_CHROME_WINDOW_SIZE`/
`CORE_AGENT_CHROME_WINDOW_POSITION`で変更可)。また、Chrome自身が表示する
「Chrome は自動テスト ソフトウェアによって制御されています」というバーが出ますが、
これはCDP(自動操作プロトコル)経由で起動した場合にChromeが必ず表示する標準の挙動で、
core-agent側が出しているものではなく、文言も変更できません(非表示にはできますが、
「自動操作中と分かる」目印として意図的にそのまま表示しています)。

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

このウォームアップは`visit_page`が先に呼ばれた場合も同様に発生します(`google_search`専用の
仕組みではなく、Chromeを使う両ツールが共有するゲートのため)。

検知を回避するための小細工(fingerprint偽装等)は意図的に行っていないため、稀に検索が
ブロックされることがあります。その場合は`Tool error: google_search was blocked...`という
エラーが明確に返るので、少し時間を置くか、ユーザーに手動検索を委ねてください。

## セルフホストの検索エンジンに切り替える(`SEARCH_ENGINE_URL`)

`google_search`はGoogleの検索結果ページをChrome経由でスクレイピングする実装ですが、
`.env`に`SEARCH_ENGINE_URL`を設定すると、**Chrome・ウォームアップ・bot検知回避を一切使わず、
指定したURLへ直接JSON APIとしてfetchする方式に切り替わります**。

対応しているのは`<url>/search?q=<query>&format=json`の形式で
`{ "results": [{ "title": ..., "url": ..., "content": ... }, ...] }`というJSONを返すエンドポイントです。
これは[SearXNG](https://docs.searxng.org/)(セルフホスト可能なオープンソースのメタ検索エンジン)の
JSON出力形式にそのまま対応しています。自前のSearXNGインスタンス(または同じJSON形式を話す
互換エンドポイント)がある場合は、これを指すよう設定してください:

```bash
SEARCH_ENGINE_URL=http://192.168.1.50:8888
```

SearXNGを自分で立てる場合は、Docker Compose構成の実例として
[stgmakarov/openclaw-searxng-plugin](https://github.com/stgmakarov/openclaw-searxng-plugin)
が参考になります。

**メリット**:
- Chromeのインストール・ウォームアップ儀式が一切不要になる(`google_search`に関しては)
- ヘッドレス環境(Dockerコンテナ等、可視ウィンドウを表示する相手がいない環境)でも
  問題なく動く
- core-agent自身のChrome自動操作がGoogleにbot扱いされる心配はなくなる(ただし、
  SearXNGインスタンス自身がバックエンドの検索エンジンへリクエストしている以上、
  SearXNG側がレート制限・ブロックされる可能性は残る——そちらの対策はSearXNGの
  設定・運用側の話であり、core-agentの管轄外)

**注意**: `SEARCH_ENGINE_URL`が効くのは`google_search`ツールのみです。`visit_page`
(任意のURLを実際に開いてページ内容を読む)は引き続きChromeが必要で、この設定の影響を受けません。
