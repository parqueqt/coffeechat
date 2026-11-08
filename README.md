# ☕ 커피챗 with 민석 & 현우

SNUSV 세미운영진 박민석, 박현우에게 커피챗을 신청하는 웹사이트입니다.
[doonghwi/coffeechat](https://github.com/doonghwi/coffeechat) 을 포크해 백엔드를 Vercel 로 옮겼습니다.

- 신청자는 **이름만** 입력하고 들어갑니다.
- 관리자는 입장 화면에서 **관리자** 탭을 누르고 박현우 또는 박민석을 고른 뒤 비밀번호를 입력합니다.
- 관리자는 주간 시간표에서 드래그해 가능한 시간을 올립니다. 휴대폰에서는 시작 칸과 끝 칸을 차례로 누릅니다.
- 관리자가 올린 시간만 신청할 수 있습니다. 신청하면 그 시간은 닫히고, 시간표와 신청 현황에 신청자 이름이 뜹니다. 관리자가 취소해야만 다시 열립니다.
- 신청자는 박민석, 박현우, 두 분 다 중에서 고릅니다. 두 분 다를 고르면 함께 비는 시간만 보입니다.

## Vercel 배포

1. 작업 브랜치를 포크의 `main` 에 합치고 GitHub 에 push 합니다.
2. [vercel.com/new](https://vercel.com/new) 에서 이 저장소를 Import 합니다. 빌드 설정은 `vercel.json` 에 들어 있어 건드리지 않아도 됩니다.
3. 프로젝트의 **Storage** 탭에서 **Upstash for Redis** 를 만들어 연결합니다. 서울과 가까운 지역을 고르세요. `KV_REST_API_URL` 과 `KV_REST_API_TOKEN` 이 자동으로 들어갑니다.
4. **Redeploy** 합니다. 환경 변수는 배포할 때 읽으므로 저장소를 연결한 뒤 한 번 더 배포해야 합니다.
5. 관리자로 로그인해 시간을 올린 뒤 링크를 공유합니다.

저장소를 연결하지 않고 배포하면 신청을 받지 않고 "연결 준비 중" 안내를 보여 줍니다.

### 환경 변수

| 이름 | 필수 | 설명 |
|---|---|---|
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | 예 | Upstash 연결 시 자동 입력. `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` 도 읽습니다 |
| `ADMIN_PASSWORD` | 아니요 | 관리자 비밀번호. 없으면 `0000` 입니다 |

## 지도

네이버 지도 키가 없으면 장소 선택은 리스트로 동작합니다. 지도를 쓰려면
[네이버 클라우드 콘솔](https://console.ncloud.com)에서 Web Dynamic Map 앱을 만들고, 배포 주소를 Web 서비스 URL 에 등록한 뒤
`public/js/config.js` 의 `NAVER_CLIENT_ID` 에 Client ID 를 넣습니다.

## 소개 문구 고치기

`public/index.html` 의 `id="about"` 구역에 있는 `<p>` 를 고치면 됩니다.

## 로컬 실행과 테스트

Node 24 가 필요합니다. 설치할 패키지는 없습니다.

```bash
npm run dev   # http://localhost:3000, 데이터는 메모리에만 저장
npm test
```

## 구조

```
public/             정적 화면 (입장, 신청 위저드, 관리자)
api/schedule.js     공개 일정. 빈 시간만 내보낸다
api/bookings.js     신청 접수
api/admin/*         관리자 로그인, 대시보드, 시간 올리기, 신청 취소
lib/schedule.js     일정 규칙 (순수 함수)
lib/store.js        Redis 저장과 동시 쓰기 처리
lib/http.js         응답, 쿠키, 세션
```
