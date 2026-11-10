# ☕ 커피챗 with 민석 & 현우

SNUSV 세미운영진 박민석, 박현우에게 커피챗을 신청하는 웹사이트입니다.
[doonghwi/coffeechat](https://github.com/doonghwi/coffeechat) 을 포크해 백엔드를 Vercel 로 옮겼습니다.

- 신청자는 **이름만** 입력하고 들어갑니다.
- 관리자는 입장 화면에서 **관리자** 탭을 누르고 박현우 또는 박민석을 고른 뒤 비밀번호를 입력합니다.
- 관리자는 **＋ 가능한 시간 추가** 에서 날짜와 시작·종료 시각만 골라 올리거나, 주간 시간표를 드래그해 올립니다.
  휴대폰에서는 시작 칸과 끝 칸을 차례로 누릅니다.
- 잘못 올린 시간은 시간표의 초록 칸을 누르거나 「내가 올린 시간」의 ✕ 로 지웁니다. 지워도 이미 들어온 신청은 남습니다.
- 신청 취소는 일부러 없습니다. 고쳐야 하면 Vercel Blob 의 `coffeechat/production/doc.json` 을 직접 고칩니다.
- 신청자 첫 화면에 「박현우 가능 시간」「박민석 가능 시간」「두 분 함께 가능한 시간」이 날짜별로 나옵니다.
  시간을 누르고 그 안에서 시작·종료 시각(기본 1시간, 최대 2시간)을 정합니다. 신청된 시간은 바로 빠집니다.

## Vercel 배포

1. 작업 브랜치를 포크의 `main` 에 합치고 GitHub 에 push 합니다.
2. [vercel.com/new](https://vercel.com/new) 에서 이 저장소를 Import 합니다. 빌드 설정은 `vercel.json` 에 들어 있어 건드리지 않아도 됩니다.
3. 프로젝트의 **Storage** 탭에서 **Blob** 저장소를 **Private** 으로 만들어 연결합니다. `BLOB_READ_WRITE_TOKEN` 이 자동으로 들어갑니다.
4. **Redeploy** 합니다. 환경 변수는 배포할 때 읽으므로 저장소를 연결한 뒤 한 번 더 배포해야 합니다.
5. 관리자로 로그인해 시간을 올린 뒤 링크를 공유합니다.

저장소를 연결하지 않고 배포하면 신청을 받지 않고 "연결 준비 중" 안내를 보여 줍니다.

### 환경 변수

| 이름 | 필수 | 설명 |
|---|---|---|
| `BLOB_READ_WRITE_TOKEN` (또는 `BLOB_STORE_ID`) | 예 | Blob 저장소 연결 시 자동 입력. 데이터는 `coffeechat/<VERCEL_ENV>/` 아래에 환경별로 따로 저장됩니다 |
| `ADMIN_PASSWORD` | 아니요 | 관리자 비밀번호. 없으면 `0000` 입니다 |

## 지도

네이버 지도 키가 없으면 장소 선택은 리스트로 동작합니다. 지도를 쓰려면
[네이버 클라우드 콘솔](https://console.ncloud.com)에서 Web Dynamic Map 앱을 만들고, 배포 주소를 Web 서비스 URL 에 등록한 뒤
`public/js/config.js` 의 `NAVER_CLIENT_ID` 에 Client ID 를 넣습니다.

## 소개 문구 고치기

`public/index.html` 의 `id="about"` 구역에 있는 `<p>` 를 고치면 됩니다.

## 로컬 실행과 테스트

Node 24 가 필요합니다. `npm install` 로 `@vercel/blob` 하나를 받습니다.

```bash
npm run dev   # http://localhost:3000, 데이터는 메모리에만 저장
npm test
```

## 구조

```
public/             정적 화면 (입장, 신청 위저드, 관리자)
api/schedule.js     공개 일정. 빈 시간만 내보낸다
api/bookings.js     신청 접수
api/admin/*         관리자 로그인, 대시보드, 시간 올리기·지우기 (신청 취소는 없음)
lib/schedule.js     일정 규칙 (순수 함수)
lib/store.js        Blob 저장과 동시 쓰기 처리 (ETag 를 맞춰 본 뒤에만 쓴다)
lib/http.js         응답, 쿠키, 세션
```
