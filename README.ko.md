[English](README.md) | **한국어** | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

# discord

Discord 채팅 프로바이더 `bmo-discord`입니다. 기반 라이브러리 `bmo-chat`의 채팅 프로토콜을 통해 채팅 receiver에게
Discord 역할을 합니다. 읽기 모드와 할 수 있는 일, 방에서 쓰는 방언(dialect)을 선언하고, 봇 계정으로 방을 읽으며,
선언한 동사를 보내고, 방에서 오간 말을 receiver에 넘깁니다. 소유자 본인의 계정은 gateway가 확인한 뒤
`human-reader`와 `human-avatar` 목소리로 보냅니다. Discord 약관이 사용자 계정의 자동화를 금지하므로 에이전트용으로
만든 계정은 운용하지 않습니다.

## 테스트와 테스트 계정

- **대부분의 동작 테스트는 미뤄져 있습니다.** 테스트 묶음에는 대역 gateway를 상대로 하는 선언, 방 모드, 듣기,
  health, 문서 전송, 멤버 테스트와, 대역 Discord를 상대로 하는 gateway의 봇 토큰, 소유자 계정, 입력 중·접속 상태,
  멤버 테스트가 들어 있습니다.
- **선언 테스트**는 어떤 토큰이 설정되어 있든, gateway가 소유자 계정에 대해 무엇이라 답하든 서비스가 선언하는
  모드와 기능이 유지되는지 확인합니다.
- **듣기 테스트**는 gateway가 각각을 듣는다고 답하는 대로 `peopleTyping`과 `presence`가 선언되는지, 그리고 서비스가
  입력 중 표시나 접속 상태 변화를 receiver 쪽이 듣고 있는 방에 대해서만 알리는지 확인합니다.
- **health 테스트**는 Discord 애플리케이션이 없을 때 서비스가 준비 상태이되 그 사유가 빠진 설정을 지목하고 모든
  모드가 내려가 있는지, 토큰이 설정되어 gateway가 준비 상태로 답하면 준비 상태가 되는지, gateway가 응답하지 않거나
  Discord가 토큰을 거부했다고 답하면 준비 상태가 아닌지 확인합니다.
- **문서 전송 테스트**는 디스크에 보관된 파일이 gateway로 인라인 전송되는지, 방언의 파일 한도를 넘는 파일은
  gateway에 묻지 않고 크기로 거부되는지 확인합니다.
- **멤버 테스트**는 방의 멤버가 gateway의 목록 그대로 답해지는지, gateway의 `not-found`가 멤버를 보유하지 않음으로
  처리되는지, 설정되지 않은 프로바이더는 gateway에 묻지 않고 아무 멤버도 보유하지 않는지 확인합니다.
- **봇 토큰 테스트**(`gateway/tests/`)는 토큰이 설정되지 않았을 때 gateway의 health가 준비 상태이면서 토큰이 없다고
  말하는지, Discord가 토큰을 받아들이면 준비 상태가 되는지, Discord가 거부하면 그 거부를 밝히며 준비 상태가 아닌지
  확인합니다.
- **입력 중·접속 상태 테스트**(`gateway/tests/`)는 입력 시작이 번호가 매겨진 방에서 10초짜리 표시로 알려지되 봇
  계정이나 소유자 계정을 통한 프로바이더 자신의 입력은 알리지 않는지, 다른 계정을 위한 입력 중 전송이 거부되는지,
  identify의 intents, 새 세션의 길드가 Discord 상태를 매핑한 하나의 전체 목록으로 알려지는지, 각 사람이 자신이 있는
  방과 함께 알려지는지 확인합니다.
- **소유자 계정 테스트**(`gateway/tests/`)는 gateway가 소유자 계정을 확인하는 과정과, `human-avatar` 전송에는 붙고
  `human-reader` 전송에는 붙지 않는 접두어를 확인합니다.
- **gateway의 멤버 테스트**(`gateway/tests/`)는 DM의 멤버가 그 수신자와 봇 계정인지, 길드 채널의 멤버가 봇 계정과
  Discord가 아직 보유한 작성자인지, 그리고 각각이 닉네임, 표시 이름 또는 사용자 이름으로 불리는지 확인합니다.
- **testbed의 `personal-data` 검사는 추적되는 모든 파일을 읽어** 메일 주소, 홈 경로, 전화번호, 토큰, 사설 네트워크
  주소를 찾고, 발견한 것마다 파일, 줄, 종류를 밝힙니다(`PERSONAL-DATA.md`).
- **Discord 테스트 계정은 연결되어 있지 않으므로** 여기 있는 어떤 것도 실제 Discord 서버에서 시험된 적이 없습니다.

## 구성

| 폴더 | 내용 |
|---|---|
| `src/` | 서비스 자체 패키지: 선언, `discord-markdown` 방언, 프로토콜의 라우트, receiver 연결, 생성된 gateway 클라이언트(`seam.rs`) |
| `gateway/` | gateway. 봇 계정의 소켓, 소유자 계정의 토큰, REST 호출, 프로바이더의 번호 저장소, 생성된 서비스 클라이언트(`seam.ts`)를 담은 bun 패키지이며, 테스트는 `gateway/tests/`에 있습니다 |
| `policy/` | 프로바이더의 고정값: 기능, `own-account` 모드를 지원하지 않는다고 선언할 때 쓰는 약관 문구, 소유자 계정의 속도, 번호가 속하는 범위, 방언의 한도와 작성 문장 |
| `lang/` | 이 프로바이더가 그리는, 사람이 읽는 문구: 플랫폼의 레이블과 메시지를 넘길 때 붙는 표시 |
| `tools/` | `docs/openapi.json`에서 두 클라이언트를 생성하는 `generate.ts` |
| `deploy/` | 배포가 연결하는 두 서비스 유닛: Rust 서비스와 bun gateway |
| `tests/` | 서비스의 단일 테스트 하니스 `tests/main.rs`와 그 모듈: 대역 gateway(`stand_in.rs`)를 상대로 하는 선언, 방 모드, 듣기, health, 문서 전송, 멤버 테스트 |
| `docs/` | 프로바이더가 하는 일에 대한 정식 기술 |

루트에는 서비스의 단일 패키지에 대한 Cargo 매니페스트, `VERSION`에 담긴 버전, `testbed.toml`(이 저장소를 어떻게
테스트·검사·빌드·배포하는지에 대한 testbed 선언), testbed 검사가 읽는 한국어 대장, `settings.example.env`(두
프로세스가 읽는 모든 설정과 중립적인 예시 값), `PERSONAL-DATA.md`(여기에 절대 두어서는 안 되는 개인 정보),
`install.toml`(새 머신에 설치할 때 필요한 것으로, `bmo install`이 읽습니다), `rustfmt.toml`, `CLAUDE.md`가 있습니다.

## 문서

| 문서 | 내용 |
|---|---|
| `docs/api.md` | 프로바이더의 고정 API: 와이어 형식, 리소스, 라우트, 코드 |
| `docs/openapi.json` | 같은 API를 OpenAPI 3.1로 기술한 것으로, 두 클라이언트가 여기에서 생성됩니다 |
| `docs/boundary-api.md` | 경계: 제공하는 라우트, receiver 쪽에 하는 호출, 서비스와 gateway 사이의 이음매, 설정, 클라이언트 |
| `docs/discord.md` | 프로바이더: 선언, 소켓, 어느 계정이 방에 답하는지, 동사, 방언, 번호 매기기, 거부 |
| `PERSONAL-DATA.md` | 여기에 절대 두어서는 안 되는 개인 정보와 이를 지키는 검사 |

## 버전

- **저장소 전체에 하나의 버전을 씁니다.** `VERSION`이 그 버전을 담고, 패키지 버전이 이와 같으며, gateway의
  `package.json`도 같은 버전을 가집니다.
- **버전은 소유자가 선언한 릴리스에서만 바뀝니다.** bmo-chat의 `docs/conventions.md` 「Versions」에 적힌 대로입니다.
  커밋, 배포, 수정, 계약 변경으로는 바뀌지 않으며, 배포는 커밋으로 구별합니다.

## 빌드 검사

Cargo는 testbed의 Cargo 동사를 통해 실행되며, 공유 빌드 디렉터리 하나에서 빌드합니다. 설치된 testbed에 자체 Cargo
동사가 없으면 `bmo cargo`가 같은 동사를 수행합니다.

```sh
bmo cargo check --all-targets
bmo cargo clippy --all-targets -- -D warnings
bmo cargo fmt --check
```

gateway의 타입은 `gateway/`에서 검사합니다.

```sh
bun install
./node_modules/.bin/tsc --noEmit
```

두 이음매 클라이언트는 `docs/openapi.json`에서 생성됩니다. 이 문서를 바꾼 뒤에는 다시 생성합니다.

```sh
bun tools/generate.ts
```
