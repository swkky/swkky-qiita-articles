---
title: AWS CLI で SSO ログインを起点に任意の IAM ロールにスイッチロールする設定
tags:
  - AWS
  - SSO
  - awscli
  - IAM
  - STS
private: false
updated_at: '2026-09-15T14:45:52+09:00'
id: c851b5dddbed2efaf8a9
organization_url_name: null
slide: false
ignorePublish: false
posting_campaign_uuid: null
agreed_posting_campaign_term: false
---
AWS CLI にて、IAM Identity Center（旧 AWS SSO）でログインした状態から、さらに別の IAM ロールへスイッチロール（AssumeRole）して作業したいことがありました。
この記事では実施した手順をメモしてます。

### スイッチロール先の IAM ロールの信頼ポリシー
```
{
	"Version": "2012-10-17",
	"Statement": [
		{
			"Effect": "Allow",
			"Principal": {
				"AWS": "arn:aws:iam::AAAAAAAAAAAA:root"
			},
			"Action": "sts:AssumeRole",
			"Condition": {}
		}
	]
}
```

この信頼ポリシーは「アカウント内の任意のプリンシパルが AssumeRole 可能」という緩い設定です。  
検証用途なので許容していますが、以下のように Condition の ArnLike で SSO 権限セットのロールに絞った方がベターです。

```
  "Condition": {
    "ArnLike": {
  "aws:PrincipalArn":
  "arn:aws:iam::AAAAAAAAAAAA:role/aws-reserved/sso.amazonaws.com/*/AWSReservedSSO_AdministratorAcc
  ess_*"
    }
```

### ~/.aws/config の記述
```
[sso-session SESSION_NAME]
sso_start_url = https://sso_start_url/start/
sso_region = ap-northeast-1
sso_registration_scopes = sso:account:access

[profile AAAAAAAAAAAA]
sso_session = SESSION_NAME
sso_account_id = AAAAAAAAAAAA
sso_role_name = AdministratorAccess
region = ap-northeast-1

[profile AAAAAAAAAAAA-target-role]
source_profile = AAAAAAAAAAAA
role_arn = arn:aws:iam::AAAAAAAAAAAA:role/ROLE_NAME
```

## スイッチロール手順

1. SSO ログイン
```
$ aws sso login --profile AAAAAAAAAAAA
```

2. スイッチロール
```
$ aws sts get-caller-identity --profile AAAAAAAAAAAA-target-role

{
    "UserId": "XXXXXXXXXXXXX",
    "Account": "AAAAAAAAAAAA",
    "Arn": "arn:aws:sts::AAAAAAAAAAAA:assumed-role/ROLE_NAME/botocore-session-XXXXXXXXXX"
}
```
出力の Arn が assumed-role/ROLE_NAME/... になっていれば、スイッチロール成功です。
