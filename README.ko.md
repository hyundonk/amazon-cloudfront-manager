# CloudFront Manager CDK 프로젝트

본 프로젝트는 개발자들이 사용자 친화적인 인터페이스를 통해 CloudFront 배포를 생성, 수정 및 관리할 수 있도록 하는 CloudFront Manager 애플리케이션을 배포하기 위한 AWS CDK 인프라 코드를 포함하고 있습니다.

## 아키텍처

CloudFront Manager 애플리케이션은 다음과 같은 구성 요소들로 이루어져 있습니다:

1. **프론트엔드**:
   - Amazon S3에 호스팅되는 정적 UI
   - 콘텐츠 전송을 위한 CloudFront 배포
   - React 기반 단일 페이지 애플리케이션

2. **백엔드**:
   - RESTful API 엔드포인트를 위한 API Gateway
   - CloudFront 관리 작업을 위한 Lambda 함수들
   - 배포 구성 및 템플릿 저장을 위한 DynamoDB 테이블들
   - 장기 실행 작업 처리를 위한 Step Functions
   - 인증 및 권한 부여를 위한 Cognito User Pool

3. **상태 모니터링 시스템**:
   - 자동화된 CloudFront 배포 상태 추적
   - 주기적인 상태 확인 및 데이터베이스 업데이트
   - 스케줄링을 위한 CloudWatch Events
   - 상태 처리를 위한 Lambda 함수들

4. **SSL 인증서 관리**:
   - AWS Certificate Manager(ACM)와의 통합
   - CloudFront 배포에서 사용자 정의 SSL 인증서 지원
   - 자동화된 인증서 검증 및 관리
   - 인증서 만료 모니터링

5. **Origin Access Control(OAC) 관리**:
   - 각 S3 오리진에 대한 자동화된 OAC 생성
   - CloudFront와 S3 버킷 간의 보안 액세스 제어
   - 자동 정책 관리 및 배포 추적
   - 세밀한 보안을 위한 오리진당 하나의 OAC 아키텍처

6. **CI/CD 파이프라인**:
   - 지속적 통합 및 배포를 위한 CodePipeline
   - 애플리케이션 빌드 및 테스트를 위한 CodeBuild
   - 아티팩트 저장을 위한 S3

## 프로젝트 구조

```
cf-manager-cdk/
├── bin/                    # CDK 앱 진입점
├── lib/                    # CDK 스택 정의
│   ├── cf-manager-stack.ts             # 핵심 인프라 스택
│   ├── cf-manager-frontend-stack.ts    # 프론트엔드 스택
│   ├── cf-manager-backend-stack.ts     # 백엔드 스택
│   ├── cf-manager-status-monitor-stack.ts # 상태 모니터링 스택
│   └── cf-manager-pipeline-stack.ts    # CI/CD 파이프라인 스택
├── functions/              # Lambda 함수 코드
│   ├── distributions/      # 배포 관리 함수들
│   ├── templates/          # 템플릿 관리 함수들
│   ├── origins/            # S3 오리진 관리 함수들 (OAC 포함)
│   ├── certificates/       # SSL 인증서 관리 함수들
│   └── common/             # 공유 유틸리티 함수들
├── frontend-simple/        # 프론트엔드 애플리케이션
│   ├── index.html          # 메인 HTML 파일
│   ├── js/                 # JavaScript 파일들
│   ├── css/                # 스타일시트
│   └── deploy.sh           # 프론트엔드 배포 스크립트
├── test/                   # CDK 스택 테스트
└── cdk.json                # CDK 구성
```

## AWS Certificate Manager를 활용한 SSL 인증서 관리

CloudFront Manager는 이제 AWS Certificate Manager(ACM)를 사용한 포괄적인 SSL 인증서 관리 기능을 포함하고 있습니다. 이 기능을 통해 사용자 정의 도메인 이름으로 보안 HTTPS 배포를 생성하실 수 있습니다.

### 개요

AWS Certificate Manager는 CloudFront와 같은 AWS 서비스에서 사용할 수 있는 무료 SSL/TLS 인증서를 제공합니다. 핵심 요구사항은 CloudFront용 인증서는 다른 리소스들의 위치와 관계없이 **반드시 미국 동부(버지니아 북부) 리전에서 생성되어야 한다**는 점입니다.

### 구현된 기능들

1. **인증서 API 통합**:
   - ACM에서 사용 가능한 SSL 인증서 목록 조회
   - 상세한 인증서 정보 가져오기
   - 인증서 만료 모니터링

2. **템플릿 SSL 지원**:
   - 배포 템플릿에서 SSL 인증서 구성
   - 사용자 정의 도메인 이름 지원
   - HTTPS 정책 구성 (리디렉션, 강제, 허용)
   - TLS 버전 선택

3. **프론트엔드 통합**:
   - 템플릿 생성 시 인증서 드롭다운
   - SSL 구성 양식
   - 인증서 상태 표시

## 사전 요구사항

- 적절한 자격 증명으로 구성된 AWS CLI
- Node.js 18.x 이상
- 전역으로 설치된 AWS CDK v2 (`npm install -g aws-cdk`)
- API Gateway CloudWatch Logs 역할 구성 (아래 설정 지침을 참조하시기 바랍니다)

### API Gateway CloudWatch Logs 역할 설정

API Gateway가 로깅을 활성화하려면 계정 수준에서 CloudWatch Logs 역할이 구성되어야 합니다. 이는 AWS 계정당 한 번만 설정하시면 됩니다.

**1단계: API Gateway용 IAM 역할 생성**

```bash
# API Gateway용 신뢰 정책으로 역할을 생성합니다
aws iam create-role \
    --role-name APIGatewayCloudWatchLogsRole \
    --assume-role-policy-document '{
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Principal": {
                    "Service": "apigateway.amazonaws.com"
                },
                "Action": "sts:AssumeRole"
            }
        ]
    }'
```

**2단계: CloudWatch Logs 정책 연결**

```bash
# CloudWatch Logs용 AWS 관리형 정책을 연결합니다
aws iam attach-role-policy \
    --role-name APIGatewayCloudWatchLogsRole \
    --policy-arn arn:aws:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs
```

**3단계: API Gateway 계정 설정 구성**

```bash
# AWS 계정 ID를 가져옵니다
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# API Gateway 계정 설정에서 CloudWatch Logs 역할 ARN을 설정합니다
aws apigateway update-account \
    --patch-operations op=replace,path=/cloudwatchRoleArn,value=arn:aws:iam::${ACCOUNT_ID}:role/APIGatewayCloudWatchLogsRole
```

**검증:**

```bash
# 역할이 올바르게 설정되었는지 확인합니다
aws apigateway get-account
```

다음과 유사한 출력이 표시되어야 합니다:
```json
{
    "cloudwatchRoleArn": "arn:aws:iam::123456789012:role/APIGatewayCloudWatchLogsRole",
    "throttleSettings": {
        "burstLimit": 5000,
        "rateLimit": 10000.0
    }
}
```

**참고**: 이 설정은 AWS 계정당 한 번만 필요합니다. 배포 중에 "CloudWatch Logs role ARN must be set in account settings to enable logging" 오류가 발생하시면 이 사전 요구사항 단계가 완료되지 않았음을 의미합니다.

## 배포

1. 종속성을 설치합니다:

```bash
npm install
```

2. CDK 환경을 부트스트랩합니다 (아직 수행하지 않으신 경우):

```bash
cdk bootstrap
```

3. 스택을 배포합니다:

```bash
cdk deploy --all --require-approval never
```

또는 개별 스택을 배포하실 수 있습니다:

```bash
cdk deploy CfManagerStack --require-approval never
cdk deploy CfManagerFrontendStack --require-approval never
cdk deploy CfManagerBackendStack --require-approval never
cdk deploy CfManagerPipelineStack --require-approval never
cdk deploy CfManagerStatusMonitorStack --require-approval never
```

## 프론트엔드 개발

프론트엔드 코드는 별도의 저장소에서 개발하셔야 합니다. 프론트엔드를 빌드하신 후, `CfManagerFrontendStack`에서 생성된 S3 버킷에 자산을 배포하실 수 있습니다.

```bash
# 프론트엔드 자산 배포 예시
aws s3 sync ./frontend/build/ s3://BUCKET_NAME --delete
aws cloudfront create-invalidation --distribution-id DISTRIBUTION_ID --paths "/*"
```

## API 엔드포인트

CloudFront Manager API는 다음과 같은 엔드포인트들을 제공합니다:

### 배포

- `GET /distributions` - 모든 배포 목록을 조회합니다
- `POST /distributions` - 새로운 배포를 생성합니다
- `GET /distributions/{id}` - 배포 세부 정보를 조회합니다
- `PUT /distributions/{id}` - 배포를 업데이트합니다
- `DELETE /distributions/{id}` - 배포를 삭제합니다
- `GET /distributions/{id}/status` - 배포 상태를 조회합니다
- `POST /distributions/{id}/invalidate` - 무효화를 생성합니다

### 템플릿

- `GET /templates` - 모든 템플릿 목록을 조회합니다
- `POST /templates` - 새로운 템플릿을 생성합니다
- `GET /templates/{id}` - 템플릿 세부 정보를 조회합니다
- `PUT /templates/{id}` - 템플릿을 업데이트합니다
- `DELETE /templates/{id}` - 템플릿을 삭제합니다
- `POST /templates/{id}/apply` - 템플릿을 적용하여 배포를 생성합니다

### 오리진

- `GET /origins` - 모든 S3 오리진 목록을 조회합니다
- `POST /origins` - 새로운 S3 오리진을 생성합니다 (자동으로 OAC 생성)
- `GET /origins/{id}` - 오리진 세부 정보를 조회합니다
- `PUT /origins/{id}` - 오리진을 업데이트합니다
- `DELETE /origins/{id}` - 오리진을 삭제합니다 (자동으로 OAC 삭제)

**참고**: 오리진 작업들은 Origin Access Control(OAC)을 자동으로 관리합니다:
- **오리진 생성** 시 S3 버킷용 전용 OAC를 자동으로 생성합니다
- **오리진 삭제** 시 연결된 OAC를 자동으로 삭제합니다 (배포에서 사용 중이지 않은 경우)
- **배포 생성** 시 오리진의 OAC와 자동으로 연결됩니다
- **배포 삭제** 시 오리진의 OAC에서 연결을 자동으로 제거합니다

## 보안

본 애플리케이션은 다음과 같은 보안 조치들을 구현하고 있습니다:

1. **인증**: 사용자 인증을 위한 Cognito User Pool
2. **권한 부여**: JWT 토큰 검증을 위한 API Gateway 권한 부여자
3. **최소 권한**: 최소한의 권한을 가진 IAM 역할들
4. **암호화**: S3 버킷 암호화 및 모든 통신에 대한 HTTPS
5. **로깅**: 모든 Lambda 함수들 및 API Gateway에 대한 CloudWatch Logs

## 모니터링

- Lambda 함수들 및 API Gateway용 CloudWatch Logs
- API Gateway 및 Lambda용 CloudWatch Metrics
- 오류율 및 지연 시간에 대한 CloudWatch Alarms

## 상태 모니터링 시스템

CloudFront Manager에는 CloudFront 배포 상태가 애플리케이션 데이터베이스에서 최신 상태로 유지되도록 하는 자동화된 상태 모니터링 시스템이 포함되어 있습니다.

### 개요

상태 모니터링 시스템은 DynamoDB 테이블에서 CloudFront 배포들의 상태를 주기적으로 확인하고 업데이트합니다. 이는 배포가 실제로 배포된 후에도 프론트엔드에서 "InProgress" 상태로 남아있는 문제를 해결합니다.

### 구성 요소들

1. **상태 확인 함수**:
   - 배포 ID와 CloudFront ID를 입력으로 받습니다
   - CloudFront 배포의 현재 상태를 확인합니다
   - 상태가 변경된 경우 DynamoDB 레코드를 업데이트합니다
   - 히스토리 테이블에 상태 변경을 기록합니다

2. **대기 중인 배포 찾기 함수**:
   - "Creating" 또는 "InProgress" 상태의 배포를 위해 DynamoDB 테이블을 스캔합니다
   - 각 대기 중인 배포에 대해 상태 확인 함수를 호출합니다
   - 스케줄에 따라 실행되어 대기 중인 배포들을 지속적으로 모니터링합니다

3. **CloudWatch Events 규칙**:
   - 5분마다 대기 중인 배포 찾기 함수를 트리거합니다
   - 수동 개입 없이 정기적인 상태 업데이트를 보장합니다

## 할 일 목록

### 프론트엔드 구성 관리

#### 현재 방법
본 애플리케이션은 현재 **빌드 타임 구성**을 사용하여 `deploy.sh` 스크립트가 CloudFormation 출력의 실제 값들로 `env.js`의 플레이스홀더를 교체합니다. 이 접근 방식은 구성을 프론트엔드 빌드 아티팩트에 직접 포함시킵니다.

**제한사항들:**
- 구성이 클라이언트 측 코드에 포함됩니다
- 구성 변경 시 재배포가 필요합니다
- AWS Well-Architected Framework 모범 사례와 일치하지 않을 수 있습니다.특히 아래 권장 개선사항들을 참조하세요.

#### 권장 개선사항들

**옵션 1: API를 통한 런타임 구성**
- 구성 값들을 반환하는 `/api/config` 엔드포인트를 추가합니다
- 프론트엔드가 런타임에 구성을 동적으로 로드합니다
- 장점: 더 나은 보안, 구성 변경 시 재배포 불필요

**옵션 2: AWS Systems Manager Parameter Store**
- AWS Systems Manager Parameter Store에 구성 매개변수들을 저장합니다
- 매개변수들을 안전하게 검색하는 API 엔드포인트를 생성합니다
- 장점: 중앙 집중식 구성 관리, 버전 히스토리, 세밀한 액세스 제어

## 유용한 명령어들

* `npm run build`   TypeScript를 JavaScript로 컴파일합니다
* `npm run watch`   변경사항을 감시하고 컴파일합니다
* `npm run test`    Jest 단위 테스트를 실행합니다
* `cdk deploy`      기본 AWS 계정/리전에 이 스택을 배포합니다
* `cdk diff`        배포된 스택과 현재 상태를 비교합니다
* `cdk synth`       합성된 CloudFormation 템플릿을 출력합니다
