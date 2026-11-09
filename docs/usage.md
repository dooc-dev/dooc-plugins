# Linear / GitHub / Slack viewer plugins

URLから取得した情報を、doocのブロックUIで表示するLinear・GitHub・Slackのプラグイン集です。表示はJSONで定義し、本体がテーマに合わせてDOMへ描画します。`@dooc-dev/dooc` 0.0.4とSDK `@dooc-dev/dooc-plugin` 0.0.2を使用します。GitHubへの接続は本体0.0.4で追加されたDevice Flowを利用します。

3サービスの `read` はSDKの `PluginBlockContent` に従う `{ header, blocks, collapsed }` を返します。SDK 0.0.2で廃止された `format` は通常表示・折りたたみ表示の両方から削除しています。`src/cards.ts` で見出し・プロパティ・表・メッセージを組み立て、`header` にサービス情報、`collapsed` に折りたたみ表示を指定します。編集箇所の `edit.action` と操作ブロックの `ids` は、各プラグインの `actions` / `act` APIに結びつけます。プラグイン管理画面にはサービス名と公式アイコンを表示します。

## サービス別ZIPをインストール

[GitHub Release v0.0.4](https://github.com/dooc-dev/dooc-plugins/releases/tag/v0.0.4) から各サービスのZIPと `SHA256SUMS` を取得できます。各ZIPには1サービスの実装・依存ライブラリ・公式SVGを同梱しています。

配布者が公開Client IDを組み込んだZIPをdoocのプラグイン管理画面に追加し、各サービスの接続ボタンを押します。利用者が `DOOC_SLACK_CLIENT_ID` などの環境変数を設定する必要はありません。Linear・Slackはブラウザで承認し、GitHubは表示された確認コードをGitHubの認証画面に入力します。組織がSSOを利用している場合は、そのサービス側のログイン設定に従います。

v0.0.4はLinearの公開Client IDを設定済みです。GitHubとSlackには明示的なダミーID（`unconfigured-github-client-id`、`unconfigured-slack-client-id`）を同梱しています。この2つのZIPはインストールできますが、実サービスへのOAuth接続はできません。配布者が `src/oauth-clients.json` のダミー値を登録済みClient IDへ置き換え、再配布する必要があります。Linearを含め、実アカウントでの認証は未検証です。v0.0.3のプラグインZIPは旧方式のままです。

配布者は下記のOAuthアプリ設定を済ませて `npm ci && npm run pack:plugins` を実行します。`dist/releases/` に3つのZIPと `SHA256SUMS` を出力します。Client Secretや利用者のトークンはZIPに含めません。`npm run test:packages` はテスト専用IDで一時ZIPを作り、利用者の環境変数なしで読み込めることを検証します。

設定済みZIPのCLIからの追加・接続は次のとおりです。`plugin add` が起動する本体の接続画面で認証します。インストール済みのプラグインには `plugin login` を使えます。

```bash
gh release download v0.0.4 --repo dooc-dev/dooc-plugins --pattern '*.zip' --pattern SHA256SUMS
sha256sum --check SHA256SUMS
npx @dooc-dev/dooc@0.0.4 plugin add ./dooc-linear-0.0.4.zip /path/to/documents/dooc.yaml 5179
npx @dooc-dev/dooc@0.0.4 plugin login linear /path/to/documents/dooc.yaml 5179
```

## localhost で試す

このリポジトリでは次のコマンドで、3サービスの plugin を登録した dooc を起動できます。

```bash
npm ci
mise run dev
```

`http://localhost:5179` を開くと、Issue・PR・Slack thread が自動表示されます。左側のサービス別ページでは Project、Cycle、差分、ファイル、Actions、チャンネルなども試せます。5179 が使用中の場合は dooc が次の空きポートを選ぶので、ターミナルに表示される URL を開いてください。

これは架空の fixture データを使うローカルテストモードです。`.env` や外部アカウントの認証は不要で、実際の plugin の URL 判定・API リクエスト・表示処理を dooc の mock transport で実行します。実サービスへの通信は行いません。`dev/` とテスト fixture は配布パッケージには含めません。

Linearは本文とプロパティ欄、GitHubは状態・ブランチ・レビュー・差分、Slackはメッセージとスレッドを表示します。公式アイコン・サービス名・識別子はカード上枠に置き、タイトルは本文側の見出しに表示します。色・フォント・入力欄はdoocのテーマを継承し、狭い画面ではプロパティ欄を縦に並べます。折りたたむとタイトルと状態の要約を表示します。

カード下端のハンドルをドラッグすると高さを変更できます。ハンドルにフォーカスして上下矢印キーでも調整でき、選んだ高さはカード内の保存・折りたたみ後も維持します。

ロゴは [Linear](https://linear.app/brand)、[GitHub](https://brand.github.com/foundations/logo)、[Slack](https://slack.com/media-kit) の公式配布 SVG を使用しています。原本・配布元・SHA-256 は `assets/brands/` に保存し、パッケージに同梱します。ライト・ダーク用に公式のバリエーションを切り替え、表示時に外部画像を取得しません。

`npm ci` にGitHub Packagesの認証は不要です。`npm run dev` / `mise run dev` は `src/` と `dev/` のTypeScriptを監視し、コンパイル成功後にプレビューを再起動します。本体の配布ファイルへのパッチは不要です。型エラーの間は直前のプレビューを維持します。開発サーバー再起動時にはダミーデータと接続が初期化され、未保存入力も失われます。終了は `Ctrl+C`。

## 起動

Node.js 22以上とdooc 0.0.4を用意します。配布者のClient ID設定を含むモジュールは次のように読み込めます。

```bash
npm ci
npm run build
npx --no-install dooc view /path/to/repository/dooc.yaml 5179 --viewer-plugins ./dist/src/viewer.js
```

`http://localhost:5179` を開き、埋め込みの接続ボタンでサービスごとに承認します。`src/oauth-clients.json` に登録されたサービスだけが有効です。利用者の環境変数からClient IDやSecretを読み込む処理はありません。

`examples/dooc.yaml` と `examples/services.md` にドキュメント例があります。URLを自分のリソースに置き換えて使用できます。

文書には通常のリンクではなく、埋め込み形式で URL を書きます。

```markdown
![Linear issue](https://linear.app/my-workspace/issue/ENG-123/title)
![GitHub PR](https://github.com/my-org/my-repo/pull/123)
![Slack thread](https://my-workspace.slack.com/archives/C0123456789/p1700000000123456)
```

plugin はZIPのインストール、または文書の外から `--viewer-plugins` で登録します。OAuth 情報や実行モジュールを `dooc.yaml` に書く必要はありません。プレビュー内の詳細はクリック・キーボードで開閉できます。外部 URL を開く、コピーする、全体を折りたたむ操作は dooc 標準の埋め込みコントロールを使います。

## URL に対する CRUD

カード上枠の編集ボタンで編集モードを有効にします。タイトル・本文・プロパティはダブルクリック、またはTabで移動してEnter / F2で編集します。直接編集は入力停止・選択変更・フォーカス移動時に自動保存されます。自分のコメント・Slack投稿、GitHubのファイル内容・Project項目値も編集できます。投稿などの追加操作はカード内の対応するボタンから実行します。

入力欄にはブラウザ標準のラベル付きフォームを使用します。Ctrl / Cmd + Enterでも保存できます。日本語変換中のEnterは送信しません。コメント投稿などは送信ボタンで確定し、直接編集の自動保存中も未送信の下書きを維持します。保存失敗時は入力を保持し、再編集して保存を試せます。削除やマージなどは対象を表示して確認します。編集モードを終了すると直接編集の変更を保存して閉じます。Escapeによる変更破棄はありません。

以下の操作を提供します。対応する権限がある場合のみカード内に表示され、編集モードで操作できます。

| URL の対象 | 操作APIの対応範囲 |
| --- | --- |
| Linear Issue | タイトル・本文・状態・優先度・担当者・Project・Cycle・ラベル・期限・見積の変更、コメント投稿、自分のコメントの編集・削除、Issue削除 |
| Linear Project | 名前・本文・概要・状態・担当者・開始日・期限の変更、health付き進捗投稿 |
| Linear Cycle | 名前・説明・開始日・終了日の変更 |
| Linear Document / Initiative / Team / Custom View | 名前またはタイトル・本文または説明の変更。Initiativeは期限も変更可能 |
| GitHub Issue / PR | タイトル・本文・Close / Reopen、担当者・ラベル・Milestone、コメント投稿、自分のコメントの編集・削除、リアクション追加・自分のリアクション解除 |
| GitHub PR | レビュー送信、自分のレビュー本文編集、保留レビュー削除、自分の行コメントの編集・削除、行コメントへの返信、レビュー依頼・解除、Draft切替、マージ |
| GitHub Actions Run / Job | Runの停止、完了したRun / Jobの再実行、Runの失敗Job再実行 |
| GitHub Workflow | 有効・無効切替、手動実行。既定ブランチのWorkflow定義から文字列・数値・真偽値・choice・environmentの入力欄を生成 |
| GitHub file (`blob`) | 既存ブランチ上のUTF-8テキストをコミット、削除。現在のSHAとブランチを固定して送信 |
| GitHub Project | タイトル・本文・Open / Closed、Draft追加、text・number・date・single-select・iterationの項目値変更・クリア、項目のアーカイブ・復元・Projectからの除去 |
| GitHub Release / Milestone | 名前またはタイトル・本文または説明の変更、削除。MilestoneはOpen / Closedも変更可能 |
| GitHub Repository / Issues / Milestones | IssueまたはMilestoneを作成 |
| Slack メッセージ | スレッド返信、リアクション、自分のメッセージ・返信の編集・削除 |
| Slack チャンネル | メッセージ投稿 |

GitHubのマージはリポジトリが許可した方式だけを提示し、PRのhead SHAを送信します。保護ルールや権限はGitHubが最終判定します。マージ・停止・無効化・削除は対象をモーダルで確認してから実行します。権限がないリポジトリや読み取り専用Projectには管理操作を出しません。

操作対象の候補数は既存の取得上限に従います。LinearのIssue用選択肢は各100件（状態とコメントは50件）、GitHubの候補は最大90件、Projectのfield定義は30件です。取得済みの現在値は候補に残します。本文・ファイル編集は4,000文字までです。バイナリや大きなファイル、タグ・コミットを指定したファイルは閲覧のみです。APIの全機能を一般化した管理コンソールではなく、上表のURLに結びついた操作を提供します。未対応操作はカード見出しのリンクから元サービスで行います。

対象は実行時にも URL とユーザーから解決し、プロバイダーが権限を判定します。自分のコメント・投稿だけを編集・削除候補にします。更新と削除は表示時の版を照合し、削除には画面での確認が必要です。確認後にサービス側で同時変更された場合まで排他制御するものではありません。同じリクエスト ID の再送はセッション内で一度だけ実行し、不明な通信結果を自動再試行しません。1 接続あたり 128 操作に達したら再接続が必要です。

開発モードではすべてダミーデータへの反映です。データは OAuth 接続ごとに分離され、トークン更新時には保持され、再接続・サーバー再起動で初期化されます。

実装は `src/`、開発用fixtureは `dev/`、検証は `test/` にあります。`npm run build` で型検査とJavaScript生成、`npm test` で本体の正式な `actions` / `act` APIを通した検証を行います。旧 `host/prepare.ts` とiframe用UIアダプターは不要になりました。

OAuth のユーザートークンはサーバー内だけで扱います。SSO を使う組織もサービス側のログイン・組織承認を経由します。汎用 IdP の SSO トークンを直接 API に送る機能ではありません。以前の読み取り scope で接続していた場合は、新しい scope を設定して再接続してください。

## OAuth アプリの設定（配布者のみ）

各サービスでdooc用のOAuthアプリを一度登録し、公開Client IDだけを `src/oauth-clients.json` に保存します。値は登録画面の実際のIDに置き換えます。

```json
{
  "LINEAR": "registered-linear-client-id",
  "GITHUB": "registered-github-client-id",
  "SLACK": "registered-slack-client-id"
}
```

Secretのキーや未知のキーはパッケージ作成時に拒否します。別の公開IDファイルを使う場合は `npm run pack:plugins -- --clients /path/to/oauth-clients.json` を指定できます。

| サービス | 認証方式 | Redirect URL |
| --- | --- | --- |
| Linear | PKCE、ユーザー承認 | `http://localhost:5179/api/plugins/callback/linear` |
| GitHub | Device Flowを有効化 | Device Flowでは使用しません |
| Slack | PKCE、User Token Scopes | `http://localhost:5179/api/plugins/callback/slack` |

LinearとSlackのポートを変えた場合はRedirect URLも合わせます。ブラウザと登録URLを `localhost` に揃えてください。GitHubの登録画面にCallback URL欄が必須の場合は `http://localhost:5179/api/plugins/callback/github` を登録できますが、このフローでは使いません。

- **Linear:** PKCEを利用するOAuthアプリを作成します。他のworkspaceへ配布する場合は `distribution=public` にし、Client Credentialsは有効にする必要がありません。`actor=user` と `read,write` scope を使い、認証した workspace と URL の workspace が一致することを確認します。5179から起動する場合、本体の空きポート探索に対応するには5179〜5189の各コールバックURLを個別登録します。ポートの `*` 記法への対応は未確認です。[Linear OAuth 仕様](https://linear.app/developers/oauth-2-0-authentication)、[公開範囲・Redirect URLの仕様](https://linear.app/developers/oauth-app-manifests)
- **GitHub:** OAuth Appを作成し、**Enable Device Flow** を有効にします。Client Secretは配布しません。[GitHub Device Flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow)を使います。scope は `repo`, `read:user`, `read:discussion`, `project` です。Project編集のため、以前の `read:project` 接続は再認証が必要です。`repo` scope で非公開リポジトリの取得と、その URL に対するコメント・レビュー・更新を実行します。[GitHub scope 仕様](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)
- **Slack:** dooc 用のアプリを作成し、OAuth & Permissions で **PKCE** を有効にしてください。有効化は Slack support を介さないと元に戻せない設定です。以下を **User Token Scopes** に登録します。bot scope は使いません。dooc が送信する PKCE パラメーターを使い、`client_secret` を送らずにコード交換・更新を行います。[Slack PKCE 仕様](https://docs.slack.dev/authentication/using-pkce/)

```text
channels:read channels:history
groups:read groups:history
im:read im:history
mpim:read mpim:history
users:read files:read reactions:read
pins:read bookmarks:read search:read team:read
chat:write reactions:write
```

Slack は `authed_user` のトークンだけを採用し、更新応答のユーザートークンにも対応します。bot / app identity、無効な認証応答、別 workspace の URL は拒否します。アプリのインストールや非公開チャンネルへのアクセスには、それぞれの管理設定と利用者の権限が必要です。

## 対応 URL と取得する情報

`{workspace}`, `{owner}`, `{repo}`, `{id}` などを実際の値に置き換えます。URL のクエリとフラグメントは、下記で対応を明示しているもの以外はサービス側の UI 表示指定として扱います。

| サービス / URL | 取得する情報 |
| --- | --- |
| Linear `/{workspace}/issue/ENG-123[/title]` | 本文、状態、優先度、担当者、期限、見積、Project / Cycle / 親、ラベル、コメント、リアクション、添付、子 Issue、双方向の関連、履歴、Document |
| Linear `/{workspace}/project/{slug-or-uuid}[/overview]` | 概要・本文、進捗、health、期限、担当者、Issue、更新、Milestone、Document、メンバー、チーム、ラベル、リンク、コメント |
| Linear `/{workspace}/team/{key}/cycle/{number-or-uuid}` | Cycle の期間、進捗、Issue、終了時未完了 Issue、Document。`active` / `current` と `cycles` 形式にも対応 |
| Linear `/{workspace}/team/{key}[/all]` | チーム概要、Issue、Project、Cycle、メンバー、ラベル、workflow state |
| Linear `/{workspace}/document/{slug-or-uuid}` | 本文、作成者・更新者、所属、コメント。Project 配下の `/document/...` も対応 |
| Linear `/{workspace}/initiative/{slug-or-uuid}[/overview]` | 概要・本文、状態、health、担当者、期限、Project、Document、更新、リンク |
| Linear `/{workspace}/view/{slug-or-uuid}` | Custom View の情報、Issue、Project、Initiative |
| GitHub `/{owner}/{repo}` | リポジトリ情報、README、ルートのファイル一覧、Release、Branch、Contributor |
| GitHub `/{owner}/{repo}/issues/{number}` | 本文、状態、担当者・ラベル・Milestone 等の詳細、コメント、リアクション、timeline |
| GitHub `/{owner}/{repo}/pull/{number}[/files]` | PR 詳細、コメント、review / review comment、変更ファイル・patch、commit、check run、commit status。`/checks`, `/commits` も同じ全体表示 |
| GitHub `/{owner}/{repo}/issues`, `/pulls` | 一覧。`q` のある URL は search API を使い repository と種別を指定 |
| GitHub `/{owner}/{repo}/commit/{sha}`, `/compare/{base}...{head}` | commit、比較、変更ファイル・patch、コメント、check。比較の commit 一覧 |
| GitHub `/{owner}/{repo}/blob/{ref}/{path}`, `/tree/{ref}[/{path}]` | UTF-8 テキスト、ファイル情報、directory。スラッシュを含む ref に対応 |
| GitHub `/{owner}/{repo}/releases[/tag/{tag}]`, `/releases/latest` | Release 一覧・本文・asset。タグ中のスラッシュも対応 |
| GitHub `/{owner}/{repo}/actions[/runs/{run}]` | run 一覧、run の状態・結果、job、artifact metadata |
| GitHub `/{owner}/{repo}/actions/runs/{run}/job/{job}` | job 詳細と step の結果 |
| GitHub `/{owner}/{repo}/actions/workflows/{file-or-id}` | workflow 情報、run 一覧 |
| GitHub `/{owner}/{repo}/milestone/{number}`, `/milestones` | Milestone の説明・期限・状態・Issue と一覧 |
| GitHub `/{owner}/{repo}/discussions/{number}` | 本文、カテゴリ、解決状態、回答、コメント・返信 |
| GitHub `/orgs/{owner}/projects/{number}`, `/users/{owner}/projects/{number}` | Projects v2 の概要、field / view 定義、Issue / PR / draft、text・number・date・single-select・iteration の field value。`/views/{number}` も対応 |
| GitHub `/{owner}`, `/{owner}/{repo}/branches`, `/tags`, `/commits` | プロフィールと repository 一覧、branch / tag / commit 一覧 |
| Gist `https://gist.github.com/{owner}/{id}[/{revision}]` | ファイルの内容・metadata、コメント |
| Slack `https://{workspace}.slack.com/archives/{channel}/p{timestamp}` | 指定メッセージ、thread、author、channel、reaction、attachment、file、Block Kit のデータ。`thread_ts` を尊重 |
| Slack `https://{workspace}.slack.com/archives/{channel}` | topic、purpose、member count、直近メッセージ、メンバー、pin、bookmark |
| Slack `https://{workspace}.slack.com/files/{user}/{file}[/name]` | file metadata と API が返す text preview。`files.slack.com/files-pri/{team}-{file}/...` も対応 |
| Slack `https://{workspace}.slack.com/docs/{team}/{file}` | canvas の file metadata / preview。`/canvas/...` も対応 |
| Slack `https://{workspace}.slack.com/team/{user}` | profile、status、timezone |
| Slack `https://{workspace}.slack.com/search?q=...` | メッセージとファイルの検索結果 |
| Slack `https://app.slack.com/client/{team}` | workspace 情報、利用者がアクセスできる conversation 一覧 |
| Slack `https://app.slack.com/client/{team}/{channel}[/{timestamp}]` | channel / message。`/thread/{channel}-{timestamp}` と `/client/{team}/search?q=...` も対応 |

Linear は [公式 GraphQL schema](https://github.com/linear/linear/blob/master/packages/sdk/src/schema.graphql)、GitHub は [REST API](https://docs.github.com/en/rest) / [GraphQL schema](https://docs.github.com/public/fpt/schema.docs.graphql)、Slack は [Web API](https://docs.slack.dev/reference/methods/) を使います。

## 表示・API の制限

- 各 collection は原則 30 件 × 最大 3 ページ。追加ページの失敗時は取得済みの項目を残し、途中までの表示であることを示します。Slack の検索は最大 3 ページです。
- Slack history / thread は原則 15 件 × 1 ページ。古い返信の permalink だけ追加の絞り込みを行うことがあります。レート制限時に連続再試行や待機はせず、エラーを表示します。[Slack thread API](https://docs.slack.dev/reference/methods/conversations.replies/)
- GitHub の compare は API が返す最大 300 ファイルまで、Discussion の各コメントの返信は最大 30 件。Projects v2 の field 定義・view・各 item の field value は各 30 件までです。保存済み Project view や Linear team URL の UI フィルターは再現せず、全体の一覧であることを表示します。
- GitHub `/issues` の REST 一覧には API の仕様により PR も含まれます。Issue に絞る場合は `?q=is%3Aissue` を付けてください。ファイル・directory・Gist には provider 固有のサイズ上限があります。
- body の Markdown / mrkdwn は、太字・インラインコード・見出し・リスト・中空のチェックリスト・安全なHTTPSリンクを整形します。列挙はTable、差分・ファイル本文は折りたたみリストです。関連項目・レビューの返信・Projectのfield値も通常の表示に含めます。APIの生JSONや内部IDは表示しません。ID・SHA・ブランチ・メールなど、表示に必要な識別値にはコピー操作を付けます。Block Kitの独自操作は実行しません。
- 大きい本文・100 件を超える表示リストは上限を設け、取得制限は詳細ボタンとツールチップに表示します。出力は SDK の 2 MiB 制限内に収めます。
- SDK の request は JSON のみなので、private file のバイナリダウンロード、full canvas HTML、Actions のログ・artifact ZIP、画像の直接表示は行いません。元サービスで確認してください。
- HTTPS の既知のサービス URL のみ対応します。GitHub Enterprise Server、GovSlack、短縮 URL、未知の URL は対象外です。ソース文書に指定された任意の API へ認証情報を送る機能はありません。
- データは閲覧者の権限で取得します。トークン、PKCE / state、認証付き通信、セッションはdoocのサーバー側で管理します。カードは検証済みブロックから本体が描画し、プラグイン独自のHTMLやJavaScriptをDOMに注入しません。リンクを検証し、`noopener noreferrer` を付けます。編集時には権限と最新バージョンを再確認し、リクエストIDで重複実行を防ぎます。認証情報の保存・更新はdooc本体が管理します。

## 個別登録と確認

配布者のホスト側モジュールから、必要なfactoryと登録済みの公開Client IDを指定することもできます。

```typescript
import { createLinearPlugin, createGitHubPlugin, createSlackPlugin } from "@sasaki-s-sci/dooc-plugins";

export default {
  plugins: [
    createLinearPlugin({ clientId: "registered-linear-client-id" }),
    createGitHubPlugin({ clientId: "registered-github-client-id" }),
    createSlackPlugin({ clientId: "registered-slack-client-id" }),
  ],
};
```

このパッケージをインストールした環境では `--viewer-plugins @sasaki-s-sci/dooc-plugins/viewer` で登録済みIDを含むモジュールを使えます。`npm pack` で配布用の tarball を作れます。このリポジトリから自動 publish はしません。

```bash
npm run check
# With npm run dev running: verify reloads and recovery from a temporary type error.
node dist/test/hotreload.js
# Integration check against the installed dooc release.
node dist/test/host.js
```

通常のテストは API fixture を使い、認証情報やネットワークを必要としません。描画前に公開版doocのview検証を通し、ブロックの形式・サイズ・リンクを検証します。`npm run check` の結合確認ではインストール済みのdooc 0.0.4を使い、GitHubのDevice Flow（承認待ち・ポーリング・接続完了）とLinear・SlackのPKCE・refreshをClient Secretなしで通します。隣接するdoocのソースは不要です。実アカウントでの OAuth 承認・API 通信は別途必要です。

## UIの設計

繰り返し見る画面では、操作をレイアウト・アイコン・短いラベルで表します。説明はツールチップまたは専用ボタンの詳細モーダルに置きます。空欄はプレースホルダーにし、本文・ラベル・担当者などを同じ粒度で重複表示しません。スクロールバーは細く、表示の有無で内容幅を変えません。開閉は縦方向に限定し、編集・送信・エラーで操作ボタンを移動しません。

追加操作は [Linearの公開schema](https://github.com/linear/linear/blob/master/packages/sdk/src/schema.graphql)、[GitHub PR API](https://docs.github.com/en/rest/pulls/pulls)、[Actions API](https://docs.github.com/en/rest/actions/workflow-runs)、[Projects API](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects) に合わせています。Workflow入力定義の解析にはdoocにも導入済みの `yaml@2.9.1` を使用します。
