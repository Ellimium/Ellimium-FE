# FE #77 비밀번호 복구 검증

2026-10-12, [FE #77](https://github.com/Ellimium/Ellimium-FE/issues/77)의 로컬 구현과 검증 결과를 기록한다. 로컬 복구 흐름과 `ellimium-test`의 Auth redirect 설정은 확인했다. `ellimium`의 설정은 CLI 조회 실패로 확인하지 못했으므로 환경별 설정 확인의 완료 조건은 아직 충족하지 않았다.

## 구현과 검증 기준

| 저장소 | 브랜치 | 구현 커밋 |
|---|---|---|
| FE | `feat/77-password-recovery` | `f6a75ca` · 복구 메일 요청 화면 |
| FE | `feat/77-password-recovery` | `04eded3` · 복구 링크 검증과 새 비밀번호 설정 |
| BE | `fix/56-password-recovery-redirect` | `a2552f5` · [BE #56](https://github.com/Ellimium/Ellimium-BE/issues/56)의 로컬 redirect 경로 허용 |

로그인 화면의 복구 모드에서 이메일을 입력하면 `resetPasswordForEmail`로 복구 메일을 요청한다. 접수 안내는 계정 존재를 드러내지 않으며, 링크 목적지는 현재 origin의 `/login/reset-password`다.

변경 화면은 `type=recovery`와 토큰이 있는 링크만 처리하고, 별도 Supabase 클라이언트의 `setSession`으로 세션을 검증한다. 이 클라이언트는 세션을 저장하지 않으며 기존 로그인 세션과 분리한다. 읽은 링크의 해시는 URL에서 제거한다. 검증에 성공하면 비밀번호 길이와 확인 값을 검사한 뒤 `updateUser`로 변경한다. 완료 안내에는 로그인 경로를 제공한다. 잘못되거나 만료된 링크에는 `/login?mode=recovery`의 메일 재요청 경로를 제공한다.

## 환경별 Auth 설정 확인

BE에 고정된 Supabase CLI `2.118.0`을 사용했다. 원격 조회는 아래의 project ref를 명시했으며 원격 설정을 변경하지 않았다.

| 환경 | project ref | 확인 결과 |
|---|---|---|
| local | 로컬 프로젝트 `Ellimium-BE` | 실행 중인 Auth 컨테이너에서 Site URL과 허용 목록 확인 완료 |
| ellimium-test | `rxfjkuixoezdrstoljcb` | 초기 HTTP 500 이후 `ACTIVE_HEALTHY` 상태에서 CLI dry-run 조회 성공. Site URL `http://localhost:3000`, 추가 redirect 허용 목록 `[]` |
| ellimium | `qvqjdchhuqjpdevdrlqv` | CLI 인증 후 `config pull --dry-run` 재조회도 HTTP 500. 설정 값 미확인 |

로컬 API는 `http://127.0.0.1:54321`, Mailpit은 `http://127.0.0.1:54324`다. `npx supabase status -o json`의 출력에서 공개 주소만 추출해 실행 상태를 확인했다. 실행 중인 Auth의 URL 관련 환경 변수도 해당 필드만 추출해 확인했다.

로컬 설정은 다음과 같다.

```toml
site_url = "http://localhost:3000"
additional_redirect_urls = [
  "http://127.0.0.1:3000",
  "http://localhost:3000/login/reset-password",
  "http://127.0.0.1:3000/login/reset-password",
]
```

기존 URL을 유지하면서 두 경로를 추가했다. 설정 적용은 기본 `npx supabase stop`과 `npx supabase start`로 수행했다. Stop 결과의 `backup: true`를 확인했으며, 재시작 전후 `auth.users`·`public.rooms`·`storage.objects`의 행 개수가 동일했다. 이는 해당 테이블의 개수 비교이며 모든 행 내용의 동일성을 검사한 것은 아니다.

원격 읽기 전용 조회 명령은 다음과 같다.

```sh
npx supabase config pull --project-ref rxfjkuixoezdrstoljcb --dry-run
npx supabase config pull --project-ref qvqjdchhuqjpdevdrlqv --dry-run
```

초기에는 두 명령 모두 `ConfigPullReadStatusError`, HTTP 500, `internal_server_error`를 반환했다. 앞선 대체 조회인 `npx supabase config diff --project-ref rxfjkuixoezdrstoljcb`도 `ConfigDiffReadStatusError`와 HTTP 500을 반환했다. 당시 프로젝트 목록에서 두 환경의 상태는 `INACTIVE`였다.

같은 날 추가 확인에서는 `ellimium-test`가 `ACTIVE_HEALTHY`였으며 `config pull --dry-run`이 성공했다. 원격 `additional_redirect_urls`는 빈 배열이었다. Site URL은 비교 대상과 같으면 diff에서 생략되므로, 저장소 설정을 변경하지 않고 `/tmp`의 비교용 설정에 임시 Site URL을 지정한 뒤 `--workdir`와 `--dry-run`으로 조회했다. 응답의 원격 Site URL이 `http://localhost:3000`임을 명시적으로 확인했다. 응답의 `written`은 false였고 원격 설정은 변경하지 않았다.

사용자는 원격 테스트의 FE 복귀 주소로 `http://localhost:3000`을 지정했다. [Supabase Auth의 redirect 검증 로직](https://github.com/supabase/auth/blob/master/internal/utilities/request.go)은 Site URL과 같은 origin의 경로를 허용한다. 이를 현재 설정과 대조하면 `http://localhost:3000/login/reset-password`를 허용할 수 있으므로, 이 목적의 추가 BE 설정 변경은 필요하지 않다고 판단했다. 이는 설정과 공식 소스를 대조한 판단이며 원격 메일 링크를 실제로 연 검증은 아니다. 메일 설정 전체도 조회하지 않았다.

`ellimium`은 여전히 `INACTIVE`였고 CLI dry-run 재조회가 HTTP 500을 반환했다. 활성화 상태와 조회 성공 여부가 함께 달라졌지만, 서버 내부 오류의 원인은 확인하지 못했다. 프로덕션 Site URL과 허용 목록은 아직 미확인이다. 조회가 가능해지면 실제 FE 복귀 origin과 대조하고, 변경이 필요한 경우 별도 BE Issue와 루트 TODO로 분리한다.

## 자동 회귀 검증

구현 과정에서 수행한 검증 결과이며, 이번 문서 작성 중에는 제품 코드 변경이 없어 다시 실행하지 않았다.

- `npm run test:login`: 22개 통과. 오류 안내 6개, 복구 요청 6개, 복구 링크·비밀번호 변경 10개.
- `npx tsc --noEmit --incremental false`: 통과.
- `npm run build`: TypeScript 검사와 프로덕션 빌드 통과. `/login/reset-password` 생성 확인.
- `git diff --check`: 통과.

회귀 테스트는 실제 페이지 코드의 이벤트 처리와 렌더링을 실행하되 Supabase 요청과 React 상태·효과를 테스트용으로 대체한다. 요청 제한·네트워크 오류·약한 비밀번호·기존과 같은 비밀번호·세션 만료는 모의 오류로 검증했다. 중복 제출, 비밀번호 확인 불일치, 직접 방문·일반 로그인 링크·토큰 누락의 차단, Strict Mode 효과 재실행, 같은 탭의 링크 전환, 이전 링크의 늦은 응답이 새 상태를 덮어쓰지 않는 동작을 포함한다.

## 실제 로컬 SDK·Auth·Mailpit 검증

브라우저 폼 제출과 구분하여 SDK로 수행한 실제 서비스 검증이다. FE의 `.env.local`에서 로컬 URL과 anon key를 사용했으며 기존 계정의 비밀번호는 변경하지 않았다.

| 시나리오 | 확인 결과 |
|---|---|
| 등록·미등록 이메일의 복구 요청 | 두 요청 모두 오류 없이 접수. 등록 계정의 메일 수신 확인 |
| 두 origin의 메일 링크 | `localhost:3000`과 `127.0.0.1:3000` 각각 HTTP 303, 요청한 origin과 `/login/reset-password`로 redirect |
| 링크의 복구 세션 | redirect 해시에 `type=recovery`와 세션 토큰 포함. 오류 필드 없음 |
| 임시 계정의 전체 복구 흐름 | 가입 → 복구 메일 요청 → Mailpit 링크 → SDK `setSession` → `updateUser` → 새 비밀번호 로그인 성공 |
| 변경 전 비밀번호 | 로그인 요청에 `invalid_credentials` 반환 |
| 사용한 메일 링크 재사용 | `otp_expired` 반환 |

## agent-browser 화면 검증

설치된 `agent-browser`의 전용 세션으로 `http://127.0.0.1:3000`의 프로덕션 빌드를 확인했다.

| 시나리오 | 확인 결과 |
|---|---|
| 복구 화면 직접 방문 | 변경 입력을 제공하지 않고 오류·복구 메일 재요청·로그인 링크 표시 |
| 메일 재요청 링크 | 로그인 화면의 복구 모드로 진입. 이메일 입력과 복구 메일 요청 버튼 표시 |
| 실제 유효한 복구 세션 | 새 비밀번호와 확인 입력, 변경 버튼 표시. URL 해시 제거 확인 |
| 같은 탭에서 사용한 링크 재사용 | 이전 변경 입력이 사라지고 만료·잘못된 링크 안내와 재요청 경로 표시. URL 해시 제거 확인 |
| 브라우저의 실제 복구 메일 요청 | 로그인 화면의 복구 진입점에서 임시 계정 이메일로 요청. 계정 존재를 드러내지 않는 접수 안내와 Mailpit 수신 확인 |
| 메일 링크 → 실제 비밀번호 변경 폼 제출 | Mailpit 링크를 브라우저에서 직접 열어 두 비밀번호 입력을 제출. 실제 Auth 요청 성공 후 완료 안내 표시, 비밀번호 입력 제거 확인 |
| 완료 안내 → 로그인 화면 → 이전 비밀번호 제출 | 로그인 화면으로 복귀. 변경 전 비밀번호는 한국어 자격 증명 오류 안내로 거절 |
| 새 비밀번호로 재시도 | 실제 로그인 성공. 로비(`/`) 도착과 로그아웃 버튼 표시 확인 |
| 로그인 후 사용한 복구 링크 재사용 | 기존 로그인 상태에서도 만료 안내 표시. 변경 입력 0개, URL 해시 제거 확인 |

처음에는 같은 화면에서 해시만 바뀌면 기존 변경 폼이 남는 문제를 발견했다. `hashchange`에서 새 링크를 검증하고, 이전 링크의 비동기 응답을 무시하도록 수정했다. 위 표는 수정 후 다시 확인한 결과다.

초기 검증에서는 실제 비밀번호 변경·로그인을 SDK로 확인했다. 이후 같은 날 로컬 브라우저 검증을 추가해 로그인 화면의 메일 요청부터 링크 열기·변경 폼 제출·로그인 복귀·새 비밀번호 로그인까지 연속 수행했다. 임시 계정을 별도로 사용했으며 Auth 응답을 모의하거나 세션을 브라우저 저장소에 주입하지 않았다. 브라우저 런타임 오류 수집 결과도 비어 있었다. 요청 제한·네트워크 오류 등 실패 조건은 위 자동 회귀 테스트의 모의 검증 결과다.

## 정리와 남은 확인

이번 전체 흐름 검증에서 만든 임시 계정은 삭제했고, 복구 토큰이 포함된 임시 파일과 원격 설정 응답 파일은 제거했다. 검증용 FE 서버와 agent-browser 세션은 종료했다. 로컬 Supabase는 실행 상태로 유지했다. 키·비밀번호·복구 토큰은 이 문서와 커밋에 포함하지 않았다.

프로덕션 Auth URL 설정과 원격 전체 복구 흐름은 미검증이다. Safari·Firefox와 스크린 리더 음성 출력도 검증하지 않았다. 새 비밀번호 설정 화면은 복구 세션을 메모리에만 보관하므로 URL 해시 제거 후 새로고침하면 메일 재요청 안내로 돌아간다.

관련 API와 URL 설정 기준은 [Supabase 복구 메일 API](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail), [사용자 정보 변경 API](https://supabase.com/docs/reference/javascript/auth-updateuser), [Auth redirect URL 설정](https://supabase.com/docs/guides/auth/redirect-urls)을 확인했다.
