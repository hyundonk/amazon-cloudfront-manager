# AWS WAF 인프라 구현

## 개요

이 문서는 CloudFront Manager 애플리케이션을 위한 AWS WAF 인프라 및 데이터 모델 구현에 대해 설명합니다. 이 구현은 Web ACL 생성, 규칙 관리, 템플릿 시스템을 포함한 포괄적인 WAF 관리 기능을 제공합니다.

## 인프라 구성 요소

### 1. DynamoDB 테이블

#### WafWebAclsTable
- **목적**: WAF Web ACL 메타데이터 및 구성 저장
- **파티션 키**: `webAclId` (STRING)
- **GSI**: `NameIndex` - Web ACL 이름으로 쿼리 가능
- **기능**: 
  - 요청당 과금 방식
  - 특정 시점 복구
  - AWS 관리형 암호화

**데이터 구조:**
```json
{
  "webAclId": "waf-acl-12345678",
  "name": "Production Web ACL",
  "arn": "arn:aws:wafv2:global:123456789012:webacl/Production-Web-ACL/...",
  "awsId": "12345678-1234-1234-1234-123456789012",
  "scope": "CLOUDFRONT",
  "description": "프로덕션 환경 WAF 규칙",
  "defaultAction": "ALLOW",
  "rules": [...],
  "associatedDistributions": ["E1234567890123"],
  "createdAt": "2025-01-26T10:30:00Z",
  "createdBy": "admin@example.com",
  "updatedAt": "2025-01-26T11:00:00Z"
}
```

#### WafRulesTable
- **목적**: 개별 WAF 규칙 및 구성 저장
- **파티션 키**: `ruleId` (STRING)
- **GSI**: `WebAclIndex` - Web ACL ID로 규칙 쿼리 및 우선순위 정렬
- **기능**: 
  - 요청당 과금 방식
  - 특정 시점 복구
  - AWS 관리형 암호화

**데이터 구조:**
```json
{
  "ruleId": "rule-12345678",
  "webAclId": "waf-acl-12345678",
  "name": "속도 제한 규칙",
  "priority": 1,
  "action": "BLOCK",
  "ruleType": "RATE_BASED",
  "statement": {
    "rateBasedStatement": {
      "limit": 2000,
      "aggregateKeyType": "IP"
    }
  },
  "visibilityConfig": {
    "sampledRequestsEnabled": true,
    "cloudWatchMetricsEnabled": true,
    "metricName": "RateLimitingRule"
  },
  "createdAt": "2025-01-26T10:30:00Z",
  "createdBy": "admin@example.com"
}
```

#### WafTemplatesTable
- **목적**: 일반적인 보안 구성을 위한 재사용 가능한 WAF 규칙 템플릿 저장
- **파티션 키**: `templateId` (STRING)
- **GSI**: `CategoryIndex` - 카테고리별 템플릿 쿼리
- **기능**: 
  - 요청당 과금 방식
  - 특정 시점 복구
  - AWS 관리형 암호화

**데이터 구조:**
```json
{
  "templateId": "waf-template-12345678",
  "name": "기본 보안 템플릿",
  "category": "security",
  "description": "웹 애플리케이션을 위한 기본 보안 규칙",
  "rules": [
    {
      "name": "속도 제한",
      "ruleType": "RATE_BASED",
      "priority": 1,
      "action": "BLOCK",
      "rateLimit": 2000
    }
  ],
  "defaultAction": "ALLOW",
  "createdAt": "2025-01-26T10:30:00Z",
  "createdBy": "admin@example.com",
  "updatedAt": "2025-01-26T11:00:00Z"
}
```

### 2. IAM 권한

Lambda 실행 역할에 포괄적인 WAF 권한이 추가되었습니다:

```typescript
// Web ACL 및 규칙 관리를 위한 WAF 권한
lambdaRole.addToPolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: [
    'wafv2:CreateWebACL',
    'wafv2:GetWebACL',
    'wafv2:UpdateWebACL',
    'wafv2:DeleteWebACL',
    'wafv2:ListWebACLs',
    'wafv2:CreateRuleGroup',
    'wafv2:GetRuleGroup',
    'wafv2:UpdateRuleGroup',
    'wafv2:DeleteRuleGroup',
    'wafv2:ListRuleGroups',
    'wafv2:CreateIPSet',
    'wafv2:GetIPSet',
    'wafv2:UpdateIPSet',
    'wafv2:DeleteIPSet',
    'wafv2:ListIPSets',
    'wafv2:AssociateWebACL',
    'wafv2:DisassociateWebACL',
    'wafv2:GetWebACLForResource',
    'wafv2:ListResourcesForWebACL',
    'wafv2:TagResource',
    'wafv2:UntagResource',
    'wafv2:ListTagsForResource'
  ],
  resources: ['*']
}));
```

### 3. 환경 변수

모든 Lambda 함수는 WAF 관련 환경 변수를 받습니다:

```typescript
const lambdaEnv = {
  // ... 기존 변수들
  WAF_WEB_ACLS_TABLE: props.wafWebAclsTable.tableName,
  WAF_RULES_TABLE: props.wafRulesTable.tableName,
  WAF_TEMPLATES_TABLE: props.wafTemplatesTable.tableName,
  // ... 기타 변수들
};
```

## Lambda 함수 구조

### WAF Web ACL 관리
```
functions-python/waf/web-acls/
├── create/          # 새 Web ACL 생성
├── list/            # 필터링을 통한 Web ACL 목록 조회
├── get/             # Web ACL 상세 정보 조회
├── update/          # Web ACL 구성 업데이트
└── delete/          # Web ACL 삭제
```

### WAF 규칙 관리
```
functions-python/waf/rules/
├── create/          # 새 WAF 규칙 생성
├── list/            # Web ACL의 규칙 목록 조회
├── update/          # 규칙 구성 업데이트
└── delete/          # WAF 규칙 삭제
```

### WAF 템플릿 관리
```
functions-python/waf/templates/
├── create/          # 새 템플릿 생성
├── list/            # 카테고리별 템플릿 목록 조회
├── get/             # 템플릿 상세 정보 조회
├── update/          # 템플릿 업데이트
├── delete/          # 템플릿 삭제
└── apply/           # 템플릿을 적용하여 Web ACL 생성
```

## 지원되는 규칙 유형

### 1. 속도 기반 규칙 (Rate-Based Rules)
- **목적**: 단일 IP에서 5분 기간당 요청 수 제한
- **구성**: 속도 제한 (기본값: 2000 요청)
- **액션**: BLOCK 또는 COUNT

### 2. 지리적 매치 규칙 (Geographic Match Rules)
- **목적**: 특정 국가의 트래픽 차단 또는 허용
- **구성**: 국가 코드 목록
- **액션**: BLOCK 또는 ALLOW

### 3. IP 세트 규칙 (IP Set Rules)
- **목적**: 특정 IP 주소/범위의 트래픽 차단 또는 허용
- **구성**: IP 세트 ARN
- **액션**: BLOCK 또는 ALLOW

### 4. 관리형 규칙 그룹 (향후 구현)
- **목적**: 일반적인 보호를 위한 AWS 관리형 규칙 그룹 사용
- **예시**: SQL 인젝션, XSS 보호, 알려진 악성 입력

## AWS WAF API 통합

### 중요: AWS WAF API 리전 요구사항

**AWS WAF API는 CloudFront와 함께 사용할 때 반드시 `us-east-1` 리전을 사용해야 합니다:**

```python
# ✅ 올바른 WAF 클라이언트 초기화
wafv2_client = boto3.client('wafv2', region_name='us-east-1')

# ❌ 잘못된 예시 (리전 미지정 시 현재 Lambda 리전 사용)
wafv2_client = boto3.client('wafv2')  # WAFInvalidParameterException 발생
```

**리전 요구사항 이유:**
- CloudFront는 글로벌 서비스이며 `us-east-1`에서 관리됨
- WAF Web ACL의 `Scope: CLOUDFRONT`는 `us-east-1`에서만 유효
- 다른 리전에서 호출 시 `WAFInvalidParameterException: The scope is not valid` 오류 발생

**영향받는 모든 WAF API 작업:**
- `create_web_acl()` - Web ACL 생성
- `get_web_acl()` - Web ACL 조회  
- `update_web_acl()` - Web ACL 수정
- `delete_web_acl()` - Web ACL 삭제
- `list_web_acls()` - Web ACL 목록 조회
- `create_rule_group()` - 규칙 그룹 생성
- `create_ip_set()` - IP 세트 생성
- 기타 모든 WAFv2 API 호출

### 사용된 AWS WAFv2 API

WAF 연동 기능 구현에 사용된 주요 AWS WAFv2 API들과 각각의 역할:

#### 1. Web ACL 관리 API

**CreateWebACL**
- **목적**: 새로운 WAF Web ACL 생성
- **사용 위치**: `functions-python/waf/web-acls/create/lambda_function.py`
- **주요 파라미터**:
  - `Name`: Web ACL 이름
  - `Scope`: CLOUDFRONT (CloudFront 배포용)
  - `DefaultAction`: 기본 액션 (ALLOW/BLOCK)
  - `Rules`: 적용할 규칙 목록
  - `VisibilityConfig`: CloudWatch 메트릭 설정
- **응답**: Web ACL ARN 및 ID 반환
- **API 참조**: [CreateWebACL - AWS WAF API Reference](https://docs.aws.amazon.com/waf/latest/APIReference/API_CreateWebACL.html)

**GetWebACL**
- **목적**: 특정 Web ACL의 상세 정보 조회
- **사용 위치**: WAF Web ACL 상세 조회 기능
- **주요 파라미터**:
  - `Scope`: CLOUDFRONT
  - `Id`: Web ACL의 AWS ID
- **응답**: Web ACL 전체 구성 정보
- **API 참조**: [GetWebACL - AWS WAF API Reference](https://docs.aws.amazon.com/waf/latest/APIReference/API_GetWebACL.html)

**UpdateWebACL**
- **목적**: 기존 Web ACL 구성 수정
- **사용 위치**: WAF Web ACL 업데이트 기능
- **주요 파라미터**:
  - `Scope`: CLOUDFRONT
  - `Id`: Web ACL의 AWS ID
  - `LockToken`: 동시성 제어를 위한 토큰
  - `Rules`: 수정된 규칙 목록
- **API 참조**: [UpdateWebACL - AWS WAF API Reference](https://docs.aws.amazon.com/waf/latest/APIReference/API_UpdateWebACL.html)

**DeleteWebACL**
- **목적**: Web ACL 삭제
- **사용 위치**: WAF Web ACL 삭제 기능
- **주요 파라미터**:
  - `Scope`: CLOUDFRONT
  - `Id`: Web ACL의 AWS ID
  - `LockToken`: 동시성 제어를 위한 토큰
- **API 참조**: [DeleteWebACL - AWS WAF API Reference](https://docs.aws.amazon.com/waf/latest/APIReference/API_DeleteWebACL.html)

**ListWebACLs**
- **목적**: 계정의 모든 Web ACL 목록 조회
- **사용 위치**: WAF Web ACL 목록 표시
- **주요 파라미터**:
  - `Scope`: CLOUDFRONT
  - `Limit`: 반환할 최대 항목 수
- **API 참조**: [ListWebACLs - AWS WAF API Reference](https://docs.aws.amazon.com/waf/latest/APIReference/API_ListWebACLs.html)

#### 2. CloudFront 연동 API

**AssociateWebACL**
- **목적**: Web ACL을 CloudFront 배포에 연결
- **사용 위치**: CloudFront 배포 생성/수정 시
- **주요 파라미터**:
  - `WebACLArn`: 연결할 Web ACL의 ARN
  - `ResourceArn`: CloudFront 배포의 ARN
- **API 참조**: [AssociateWebACL - AWS WAF API Reference](https://docs.aws.amazon.com/waf/latest/APIReference/API_AssociateWebACL.html)

**DisassociateWebACL**
- **목적**: CloudFront 배포에서 Web ACL 연결 해제
- **사용 위치**: WAF 연결 해제 기능
- **주요 파라미터**:
  - `ResourceArn`: CloudFront 배포의 ARN
- **API 참조**: [DisassociateWebACL - AWS WAFv2 API Reference](https://docs.aws.amazon.com/wafv2/latest/APIReference/API_DisassociateWebACL.html)

**GetWebACLForResource**
- **목적**: 특정 CloudFront 배포에 연결된 Web ACL 조회
- **사용 위치**: 배포 상세 정보 표시
- **주요 파라미터**:
  - `ResourceArn`: CloudFront 배포의 ARN
- **API 참조**: [GetWebACLForResource - AWS WAFv2 API Reference](https://docs.aws.amazon.com/wafv2/latest/APIReference/API_GetWebACLForResource.html)

**ListResourcesForWebACL**
- **목적**: Web ACL에 연결된 모든 리소스 목록 조회
- **사용 위치**: Web ACL 사용 현황 추적
- **주요 파라미터**:
  - `WebACLArn`: Web ACL의 ARN
  - `ResourceType`: CLOUDFRONT
- **API 참조**: [ListResourcesForWebACL - AWS WAFv2 API Reference](https://docs.aws.amazon.com/wafv2/latest/APIReference/API_ListResourcesForWebACL.html)

#### 3. 규칙 그룹 관리 API

**CreateRuleGroup**
- **목적**: 재사용 가능한 규칙 그룹 생성
- **사용 위치**: 복잡한 규칙 세트 관리
- **주요 파라미터**:
  - `Name`: 규칙 그룹 이름
  - `Scope`: CLOUDFRONT
  - `Capacity`: 규칙 그룹의 WCU (Web ACL Capacity Units)
  - `Rules`: 포함할 규칙 목록
- **API 참조**: [CreateRuleGroup - AWS WAFv2 API Reference](https://docs.aws.amazon.com/wafv2/latest/APIReference/API_CreateRuleGroup.html)

**GetRuleGroup**
- **목적**: 규칙 그룹 상세 정보 조회
- **사용 위치**: 규칙 그룹 관리 기능
- **API 참조**: [GetRuleGroup - AWS WAFv2 API Reference](https://docs.aws.amazon.com/wafv2/latest/APIReference/API_GetRuleGroup.html)

**UpdateRuleGroup**
- **목적**: 규칙 그룹 수정
- **사용 위치**: 규칙 그룹 업데이트 기능
- **API 참조**: [UpdateRuleGroup - AWS WAFv2 API Reference](https://docs.aws.amazon.com/wafv2/latest/APIReference/API_UpdateRuleGroup.html)

**DeleteRuleGroup**
- **목적**: 규칙 그룹 삭제
- **사용 위치**: 규칙 그룹 정리 기능
- **API 참조**: [DeleteRuleGroup - AWS WAFv2 API Reference](https://docs.aws.amazon.com/wafv2/latest/APIReference/API_DeleteRuleGroup.html)

**ListRuleGroups**
- **목적**: 계정의 모든 규칙 그룹 목록 조회
- **사용 위치**: 규칙 그룹 선택 UI
- **API 참조**: [ListRuleGroups - AWS WAFv2 API Reference](https://docs.aws.amazon.com/wafv2/latest/APIReference/API_ListRuleGroups.html)

#### 4. IP 세트 관리 API

**CreateIPSet**
- **목적**: IP 주소 목록을 포함하는 IP 세트 생성
- **사용 위치**: IP 기반 차단/허용 규칙
- **주요 파라미터**:
  - `Name`: IP 세트 이름
  - `Scope`: CLOUDFRONT
  - `IPAddressVersion`: IPv4 또는 IPv6
  - `Addresses`: IP 주소 목록 (CIDR 형식)
- **API 참조**: [CreateIPSet - AWS WAFv2 API Reference](https://docs.aws.amazon.com/wafv2/latest/APIReference/API_CreateIPSet.html)

**GetIPSet**
- **목적**: IP 세트 상세 정보 조회
- **사용 위치**: IP 세트 관리 기능
- **API 참조**: [GetIPSet - AWS WAFv2 API Reference](https://docs.aws.amazon.com/wafv2/latest/APIReference/API_GetIPSet.html)

**UpdateIPSet**
- **목적**: IP 세트의 IP 주소 목록 수정
- **사용 위치**: 동적 IP 차단/허용 목록 관리
- **API 참조**: [UpdateIPSet - AWS WAFv2 API Reference](https://docs.aws.amazon.com/wafv2/latest/APIReference/API_UpdateIPSet.html)

**DeleteIPSet**
- **목적**: IP 세트 삭제
- **사용 위치**: IP 세트 정리 기능
- **API 참조**: [DeleteIPSet - AWS WAFv2 API Reference](https://docs.aws.amazon.com/wafv2/latest/APIReference/API_DeleteIPSet.html)

**ListIPSets**
- **목적**: 계정의 모든 IP 세트 목록 조회
- **사용 위치**: IP 세트 선택 UI
- **API 참조**: [ListIPSets - AWS WAFv2 API Reference](https://docs.aws.amazon.com/wafv2/latest/APIReference/API_ListIPSets.html)

#### 5. 태깅 및 메타데이터 API

**TagResource**
- **목적**: WAF 리소스에 태그 추가
- **사용 위치**: 리소스 분류 및 관리
- **주요 파라미터**:
  - `ResourceARN`: 태그를 추가할 리소스의 ARN
  - `Tags`: 키-값 쌍의 태그 목록
- **API 참조**: [TagResource - AWS WAFv2 API Reference](https://docs.aws.amazon.com/wafv2/latest/APIReference/API_TagResource.html)

**UntagResource**
- **목적**: WAF 리소스에서 태그 제거
- **사용 위치**: 태그 정리 기능
- **API 참조**: [UntagResource - AWS WAFv2 API Reference](https://docs.aws.amazon.com/wafv2/latest/APIReference/API_UntagResource.html)

**ListTagsForResource**
- **목적**: 특정 리소스의 모든 태그 조회
- **사용 위치**: 리소스 메타데이터 표시
- **API 참조**: [ListTagsForResource - AWS WAFv2 API Reference](https://docs.aws.amazon.com/wafv2/latest/APIReference/API_ListTagsForResource.html)

### API 사용 패턴

#### Web ACL 생성 플로우
```python
# 1. Web ACL 생성
waf_response = wafv2_client.create_web_acl(
    Name='Production-WebACL',
    Scope='CLOUDFRONT',
    DefaultAction={'ALLOW': {}},
    Rules=[...],
    VisibilityConfig={
        'SampledRequestsEnabled': True,
        'CloudWatchMetricsEnabled': True,
        'MetricName': 'ProductionWebACL'
    }
)

# 2. DynamoDB에 메타데이터 저장
table.put_item(Item={
    'webAclId': web_acl_id,
    'arn': waf_response['Summary']['ARN'],
    'awsId': waf_response['Summary']['Id'],
    # ... 기타 메타데이터
})
```

#### CloudFront 연동 플로우
```python
# 1. Web ACL을 CloudFront 배포에 연결
wafv2_client.associate_web_acl(
    WebACLArn=web_acl_arn,
    ResourceArn=f'arn:aws:cloudfront::{account_id}:distribution/{distribution_id}'
)

# 2. DynamoDB에서 연결 정보 업데이트
table.update_item(
    Key={'webAclId': web_acl_id},
    UpdateExpression='SET associatedDistributions = list_append(associatedDistributions, :dist)',
    ExpressionAttributeValues={':dist': [distribution_id]}
)
```

### 에러 처리 및 재시도 로직

#### 일반적인 WAF API 에러
- **WAFDuplicateItemException**: 동일한 이름의 리소스가 이미 존재
- **WAFLimitsExceededException**: AWS WAF 서비스 한도 초과
- **WAFInvalidParameterException**: 잘못된 파라미터 값
- **WAFOptimisticLockException**: 동시 수정으로 인한 충돌

#### 구현된 에러 처리
```python
try:
    waf_response = wafv2_client.create_web_acl(**web_acl_config)
except ClientError as e:
    error_code = e.response['Error']['Code']
    if error_code == 'WAFDuplicateItemException':
        return cors_response(409, {'error': '이 이름의 Web ACL이 이미 존재합니다'})
    elif error_code == 'WAFLimitsExceededException':
        return cors_response(429, {'error': 'WAF 한도가 초과되었습니다'})
    else:
        return cors_response(500, {'error': f'Web ACL 생성 실패: {error_message}'})
```

## API 엔드포인트 구조

다음 API 엔드포인트들이 구현될 예정입니다:

```
/api/waf/
├── /web-acls                    # Web ACL 관리
│   ├── GET, POST               # 목록 조회, 생성
│   └── /{id}
│       ├── GET, PUT, DELETE    # 조회, 업데이트, 삭제
│       └── /rules              # Web ACL의 규칙 관리
│           ├── GET, POST       # 규칙 목록, 규칙 추가
│           └── /{ruleId}
│               └── PUT, DELETE # 규칙 업데이트, 삭제
└── /templates                  # 템플릿 관리
    ├── GET, POST              # 목록 조회, 생성
    └── /{id}
        ├── GET, PUT, DELETE   # 조회, 업데이트, 삭제
        └── /apply             # 템플릿 적용
```

## CloudFront 통합

### 배포-WAF 연결
- Web ACL은 CloudFront 배포와 연결될 수 있습니다
- 연결은 `associatedDistributions` 필드에서 추적됩니다
- CloudFront 배포는 생성/업데이트 시 WAF 선택 옵션을 가집니다

### 스코프 고려사항
- 모든 Web ACL은 `CLOUDFRONT` 스코프로 생성됩니다
- 이는 CloudFront 배포에 대한 글로벌 보호를 허용합니다
- 지역별 Web ACL (ALB/API Gateway용)은 이 구현에서 지원되지 않습니다

## 보안 고려사항

### 1. 접근 제어
- 모든 WAF 관리 기능은 관리자 권한이 필요합니다
- 향상된 Lambda 권한 부여자가 사용자 그룹 멤버십을 검증합니다
- 사용자 정보와 함께 DynamoDB에 감사 추적이 유지됩니다

### 2. 데이터 보호
- 모든 DynamoDB 테이블은 AWS 관리형 암호화를 사용합니다
- 데이터 보호를 위해 특정 시점 복구가 활성화됩니다
- 감사 기록 보존을 위해 TTL은 구현되지 않습니다

### 3. 리소스 제한
- AWS WAF에는 서비스 제한이 있습니다 (Web ACL, Web ACL당 규칙 등)
- 함수들은 제한 초과 시나리오에 대한 에러 처리를 포함합니다
- 적절한 에러 메시지가 사용자에게 제한 제약사항을 안내합니다

## 모니터링 및 로깅

### CloudWatch 통합
- 모든 Web ACL은 CloudWatch 메트릭이 활성화된 상태로 생성됩니다
- 디버깅을 위해 샘플 요청이 활성화됩니다
- Lambda 함수에서 구조화된 로깅을 사용합니다

### 사용 가능한 메트릭
- 허용된 요청 수
- 차단된 요청 수
- 규칙별 매치 수
- 요청의 지리적 분포

## 향후 개선사항

### 1. 고급 규칙 유형
- 사용자 정의 정규식 패턴
- 요청 헤더/본문 검사
- 봇 탐지 규칙

### 2. 자동화
- 패턴 기반 자동 IP 차단
- 위협 인텔리전스 피드와의 통합
- 예약된 규칙 업데이트

### 3. 보고
- WAF 통계가 포함된 보안 대시보드
- 자동화된 보안 보고서
- 위협 분석 및 권장사항

## 배포

WAF 인프라는 주요 CDK 스택의 일부로 배포됩니다:

1. **코어 스택**: DynamoDB 테이블 및 IAM 권한 생성
2. **백엔드 스택**: Lambda 함수 및 API 엔드포인트 생성
3. **프론트엔드 스택**: WAF 관리 UI 포함 (향후 작업)

배포 방법:
```bash
cdk deploy --all
```

## 테스트

인프라를 검증하기 위한 기본 Lambda 함수들이 생성되었습니다:
- `functions-python/waf/web-acls/create/lambda_function.py`
- `functions-python/waf/web-acls/list/lambda_function.py`
- `functions-python/waf/templates/create/lambda_function.py`

이 함수들은 다음을 보여줍니다:
- CloudFront 스코프를 사용한 WAF Web ACL 생성
- 메타데이터 저장을 위한 DynamoDB 통합
- 적절한 에러 처리 및 CORS 응답
- API Gateway 이벤트에서 사용자 추출

## 요구사항 매핑

이 구현은 다음 요구사항들을 다룹니다:

- **13.1**: WAF Web ACL 생성 및 관리 인프라
- **13.3**: CloudFront 배포 및 WAF 통합 구조
- **13.4**: WAF 작업을 위한 IAM 권한
- **13.5**: WAF 메타데이터 추적을 위한 DynamoDB 테이블
- **13.6**: 효율적인 쿼리를 위한 GSI 인덱스

인프라는 이제 후속 작업에서 완전한 WAF 관리 시스템 구현을 위한 준비가 완료되었습니다.