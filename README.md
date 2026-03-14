# 📈 Investing Portfolio Manager

> 장기투자 및 배당주 포트폴리오를 체계적으로 관리하고, NDX/SPX 대비 성과를 비교하는 데스크톱 애플리케이션

![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)
![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-lightgrey)
![License](https://img.shields.io/badge/License-GPL%203.0-blue)

---

## 개요

단타/선물 매매로 수익을 창출하고, 그 수익을 장기투자와 배당주에 재투자하는 투자 스타일에 최적화된 포트폴리오 관리 도구입니다.

**핵심 컨셉**: 생활비 지출 후에도 계좌가 성장하고 있는가? 내 투자 실력은 시장 지수를 이기고 있는가?

---

## 주요 기능

### 🗂️ 자유로운 탭 시스템
- 원하는 이름으로 탭을 무제한 추가/삭제/이름 변경
- 탭별 독립 포트폴리오 관리 (예: "장기투자", "배당주", "성장주" 등)
- 원하는 탭들을 선택해서 합산 결과 조회 가능

### 📝 5가지 거래 유형
| 유형 | 설명 | 현금 영향 |
|------|------|-----------|
| **매수** | 종목, 수량, 매수단가, 환율 입력 | 현금 감소 |
| **매도** | 종목, 수량, 매도단가 입력 → 실현손익 자동 계산 | 현금 증가 |
| **배당** | 종목별 배당금 입력 | 현금 증가 |
| **입금** | 시드머니 / 수익 입금 구분 | 현금 증가 |
| **출금** | 생활비 등 출금 기록 | 현금 감소 |

### 💰 자동 계산
- **매수 평단가**: 동일 종목 복수 매수 시 자동 평균 계산
  - 액면분할/병합 대응을 위한 수동 수정 지원
- **실현 손익**: 매도 시 평단가 대비 자동 계산
- **미실현 손익**: 현재가 vs 매수 평단가 실시간 계산
- **현금 잔고**: 모든 거래에서 자동 추적

### 📊 이중 퍼포먼스 비교 (vs NDX / SPX)

**메인 지표 — 실질 계좌 성장**
- 시드머니(자본 증자) 제외
- 수익 입금, 출금, 투자 성과 모두 반영
- "내 전체 자산 운용 시스템이 잘 돌아가는가?"

**보조 지표 — 순수 투자 수익률**
- 모든 외부 입출금 제외
- 미실현 손익 + 실현 손익 + 배당만 계산
- "내 종목 선정 실력이 지수를 이기는가?"

### 🌐 자동 조회
- **주가 조회**: Yahoo Finance API (당일 종가 기준)
- **환율 조회**: 다중 API 폴백 지원
- **NDX/SPX YTD 수익률**: 자동 조회 + 수동 입력

### 💱 원화 환산
- 매수 시점 원달러 환율 기록
- 모든 금액 USD + KRW 동시 표시
- 소수점 4째 자리까지 표시

### 📅 연간 요약
- 연도별 매수/매도/배당/입출금/실현손익 집계
- 시드머니 입금과 수익 입금 구분 표시

---

## 설치 및 빌드

### 요구사항
- Node.js 18+
- npm 9+

### 설치
```bash
git clone https://github.com/YOUR_USERNAME/investing-portfolio-manager.git
cd investing-portfolio-manager
npm install
```

### 개발 모드
```bash
npm run dev
```

### 빌드

**macOS** (.dmg)
```bash
npm run build:mac
```

**Windows** (포터블 .exe — 설치 불필요)
```bash
npm run build:win
```

**macOS + Windows 동시**
```bash
npm run build:all
```

빌드 결과물은 `release/` 디렉토리에 생성됩니다.

> ⚠️ 크로스 빌드 참고사항:
> - macOS에서 Windows용 빌드 시 Wine 필요
> - Windows에서 macOS용 빌드는 불가
> - 각 OS에서 해당 플랫폼용으로 빌드하는 것을 권장합니다

---

## 프로젝트 구조

```
investing-portfolio-manager/
├── package.json            # 의존성 및 electron-builder 설정
├── vite.config.js          # Vite 번들러 설정
├── index.html              # HTML 엔트리포인트
├── electron/
│   ├── main.js             # Electron 메인 프로세스 + IPC 핸들러
│   └── preload.js          # window.storage API 브릿지
├── src/
│   ├── main.jsx            # React 엔트리포인트
│   └── App.jsx             # 앱 전체 컴포넌트 (단일 파일)
└── README.md
```

---

## 데이터 저장

모든 데이터는 로컬에 JSON 형태로 자동 저장됩니다.

| OS | 경로 |
|----|------|
| macOS | `~/Library/Application Support/investing-portfolio-manager/investing-portfolio-data.json` |
| Windows | `%APPDATA%/investing-portfolio-manager/investing-portfolio-data.json` |

- 앱 종료/재시작 시 데이터 자동 유지
- 앱 내 설정에서 전체 데이터 초기화 가능
- JSON 파일이므로 백업/복원이 간편

---

## 기술 스택

| 영역 | 기술 |
|------|------|
| 프레임워크 | Electron 33 |
| UI | React 18 |
| 번들러 | Vite 6 |
| 데이터 저장 | electron-store |
| 패키징 | electron-builder |
| 주가 조회 | Yahoo Finance API |
| 환율 조회 | open.er-api, fawazahmed0/currency-api |

---

## 사용 시나리오

```
[선물/단타 계좌] ──수익──→ [이 앱: 메인 투자 계좌]
                              ├── 장기투자 탭 (성장주)
                              ├── 배당주 탭 (월배당)
                              └── ... (자유 추가)
                                    │
                              ──출금──→ [생활비]
```

1. **시드머니 입금** → 초기 자본 설정 (퍼포먼스 계산에서 제외)
2. **매수** → 종목별 주식 매수 기록
3. **수익 입금** → 단타/선물 수익 입금 (퍼포먼스에 반영)
4. **배당 입금** → 월 배당금 기록
5. **출금** → 생활비 지출 기록
6. **성과 비교** → NDX/SPX YTD 대비 내 계좌 퍼포먼스 확인

---

## 라이선스

이 프로젝트는 [GNU General Public License v3.0](LICENSE) 하에 배포됩니다.

- ✅ 자유롭게 사용, 수정, 배포 가능
- ✅ 파생 작업물도 반드시 GPL 3.0으로 소스 공개 필수
- ❌ 소스 비공개로 닫아서 배포 불가
